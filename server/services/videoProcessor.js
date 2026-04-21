const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { concatClips } = require('./ffmpegConcat');

const ROOT = path.resolve(__dirname, '..', '..');
const UPLOADS_ROOT = path.join(ROOT, 'uploads');
const PY_ROOT = path.join(ROOT, 'server', 'python');
const WRAPPER = path.join(PY_ROOT, 'run_cutclaw.py');

/**
 * Resolve the Python interpreter in this order:
 *   1. process.env.PYTHON (explicit override)
 *   2. server/python/.venv/Scripts/python.exe   (Windows)
 *   3. server/python/.venv/bin/python           (POSIX)
 *   4. fall back to `python` on PATH
 */
function resolvePython() {
  if (process.env.PYTHON && fs.existsSync(process.env.PYTHON)) return process.env.PYTHON;
  const winVenv = path.join(PY_ROOT, '.venv', 'Scripts', 'python.exe');
  if (fs.existsSync(winVenv)) return winVenv;
  const nixVenv = path.join(PY_ROOT, '.venv', 'bin', 'python');
  if (fs.existsSync(nixVenv)) return nixVenv;
  return process.platform === 'win32' ? 'python' : 'python3';
}

// ─── DB helpers ────────────────────────────────────────────────────────────
const updateStage = db.prepare(
  `UPDATE edit_jobs SET progress = ?, stage = ?, stage_msg = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);
const markDone = db.prepare(
  `UPDATE edit_jobs SET status = 'done', progress = 100, stage = 'done',
                        stage_msg = 'Ready to download', output_path = ?,
                        updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);
const markError = db.prepare(
  `UPDATE edit_jobs SET status = 'error', error_msg = ?, stage = 'error',
                        stage_msg = ?, updated_at = CURRENT_TIMESTAMP
   WHERE id = ?`
);

function setProgress(jobId, pct, stage, msg) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  updateStage.run(clamped, stage, msg ? String(msg).slice(0, 500) : null, jobId);
}

// ─── Progress-file tail ────────────────────────────────────────────────────
// Python wrapper appends NDJSON records. We read incrementally and forward
// pct/stage/msg into edit_jobs. Poll-based is fine here; fs.watch on Windows
// is flaky and the file is tiny.
function tailProgressFile(filePath, onRecord) {
  let offset = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    fs.stat(filePath, (err, stat) => {
      if (stopped) return;
      if (!err && stat.size > offset) {
        const stream = fs.createReadStream(filePath, { start: offset, end: stat.size });
        let buf = '';
        stream.on('data', (chunk) => { buf += chunk.toString('utf8'); });
        stream.on('end', () => {
          const lines = buf.split(/\r?\n/);
          // Last element may be a partial line — keep it for next tick.
          const partialLen = Buffer.byteLength(lines.pop() || '', 'utf8');
          offset = stat.size - partialLen;
          for (const line of lines) {
            if (!line.trim()) continue;
            try { onRecord(JSON.parse(line)); }
            catch { /* ignore malformed */ }
          }
          setTimeout(tick, 400);
        });
        stream.on('error', () => setTimeout(tick, 400));
      } else {
        setTimeout(tick, 400);
      }
    });
  };
  setTimeout(tick, 400);
  return () => { stopped = true; };
}

// ─── Main pipeline ────────────────────────────────────────────────────────
async function processVideo(jobId, projectId, config) {
  const jobDir = path.join(UPLOADS_ROOT, 'edit-jobs', jobId);
  const sourceMp4 = path.join(jobDir, 'source.mp4');
  const outputMp4 = path.join(jobDir, 'output.mp4');
  const progressFile = path.join(jobDir, 'progress.ndjson');

  try {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(progressFile, '', 'utf8');

    // ─── 1. Concat uploaded clips into one source video ────────────────
    setProgress(jobId, 1, 'concat', 'Stitching uploaded clips');
    const clips = db
      .prepare('SELECT filepath FROM clips WHERE project_id = ? ORDER BY created_at')
      .all(projectId)
      .map(r => r.filepath)
      .filter(p => p && fs.existsSync(p));
    if (clips.length === 0) throw new Error('No clips on disk for this project');

    await concatClips(clips, sourceMp4, (pct, msg) => {
      // Concat owns 0–15% of the global progress bar.
      setProgress(jobId, pct * 0.15, 'concat', msg || 'Stitching uploaded clips');
    });
    setProgress(jobId, 15, 'concat', 'Source video prepared');

    // ─── 2. Hand off to the Python/CutClaw pipeline ────────────────────
    const python = resolvePython();
    if (!fs.existsSync(WRAPPER)) {
      throw new Error(`Python wrapper missing at ${WRAPPER}`);
    }

    const stopTail = tailProgressFile(progressFile, (rec) => {
      // rec = {pct, stage, msg}. The wrapper emits pct in its own 0–100
      // scale; we map into the 15–99 slice of the global bar.
      const local = Math.max(0, Math.min(100, rec.pct || 0));
      const global = 15 + (local * (99 - 15) / 100);
      setProgress(jobId, global, rec.stage || 'processing', rec.msg || '');
    });

    const args = [
      WRAPPER,
      '--source',        sourceMp4,
      '--output',        outputMp4,
      '--progress-file', progressFile,
      '--music',         config.music || '',
      '--subtitles',     'auto',
      '--config',        JSON.stringify(config || {}),
    ];

    let stderrTail = '';
    // If FFMPEG is a direct binary path, prepend its directory to PATH so
    // the Python side (which calls `ffmpeg` by name) also finds it.
    const subprocessEnv = { ...process.env, PYTHONIOENCODING: 'utf-8' };
    if (process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)) {
      const ffDir = path.dirname(process.env.FFMPEG);
      subprocessEnv.PATH = ffDir + path.delimiter + (subprocessEnv.PATH || '');
    }
    const exitCode = await new Promise((resolve, reject) => {
      const child = spawn(python, args, {
        cwd: ROOT,
        env: subprocessEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stdout.on('data', (d) => process.stdout.write(d));
      child.stderr.on('data', (d) => {
        const s = d.toString('utf8');
        stderrTail = (stderrTail + s).slice(-4000);
        process.stderr.write(s);
      });
      child.on('error', reject);
      child.on('close', resolve);
    });
    stopTail();

    if (exitCode !== 0) {
      const snippet = stderrTail.split('\n').slice(-6).join(' | ').trim();
      throw new Error(`CutClaw exited ${exitCode}: ${snippet || 'see server logs'}`);
    }
    if (!fs.existsSync(outputMp4)) {
      throw new Error('CutClaw finished without producing an output file');
    }

    // ─── 3. Cleanup source / intermediates, keep the output ────────────
    try { fs.unlinkSync(sourceMp4); } catch (_) { /* ignore */ }
    const workspace = path.join(jobDir, 'cutclaw_workspace');
    if (fs.existsSync(workspace)) {
      fs.rmSync(workspace, { recursive: true, force: true });
    }

    markDone.run(outputMp4, jobId);
  } catch (err) {
    console.error(`[edit-job ${jobId}]`, err);
    markError.run(String(err.message || err).slice(0, 500), 'Processing failed', jobId);
  }
}

module.exports = { processVideo };
