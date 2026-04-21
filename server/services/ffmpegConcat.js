const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// Resolve ffmpeg from env override first, then fall back to "ffmpeg" on PATH.
// On Windows users often install ffmpeg without editing PATH, so setting
// FFMPEG=D:/Tools/ffmpeg/bin/ffmpeg.exe in .env unblocks them.
const FFMPEG_BIN = process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)
  ? process.env.FFMPEG
  : 'ffmpeg';

/**
 * Concatenate a list of video files into a single output mp4.
 *
 * Tries the concat demuxer + stream copy first (fast, no re-encode). Falls
 * back to filter_complex + libx264 re-encode if the clips have mismatched
 * codecs/dimensions.
 *
 * @param {string[]} inputFiles  Absolute paths, in playback order.
 * @param {string}   outputFile  Absolute destination path.
 * @param {(pct:number,msg?:string)=>void} [onProgress]  Called with 0..100.
 * @returns {Promise<{mode:'copy'|'reencode', durationMs?:number}>}
 */
async function concatClips(inputFiles, outputFile, onProgress) {
  if (!Array.isArray(inputFiles) || inputFiles.length === 0) {
    throw new Error('concatClips: no input files');
  }
  for (const f of inputFiles) {
    if (!fs.existsSync(f)) throw new Error(`concatClips: missing input ${f}`);
  }
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const report = (pct, msg) => { if (onProgress) onProgress(pct, msg); };

  if (inputFiles.length === 1) {
    fs.copyFileSync(inputFiles[0], outputFile);
    report(100, 'single clip, copied source');
    return { mode: 'copy' };
  }

  // ── Pass 1: concat demuxer, stream copy ──────────────────────────────
  const listFile = path.join(path.dirname(outputFile), 'concat-list.txt');
  const listBody = inputFiles
    .map(f => `file '${f.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n');
  fs.writeFileSync(listFile, listBody, 'utf8');

  try {
    report(5, 'concat: stream copy');
    await runFfmpeg(
      ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outputFile],
      (pct) => report(5 + Math.round(pct * 0.5), 'concat: stream copy'),
    );
    report(60, 'concat: stream copy ok');
    return { mode: 'copy' };
  } catch (copyErr) {
    // ── Pass 2: re-encode ──────────────────────────────────────────────
    // Mismatched codecs / frame sizes → unify to 1080x1920 (or source
    // resolution, whichever) at 30 fps, libx264 + aac.
    report(60, 'concat: stream copy failed, re-encoding');
    const filterInputs = inputFiles.flatMap(f => ['-i', f]);
    const n = inputFiles.length;
    const filter = inputFiles
      .map((_, i) => `[${i}:v:0]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}];[${i}:a:0]aresample=44100[a${i}]`)
      .concat([`${inputFiles.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${n}:v=1:a=1[vout][aout]`])
      .join(';');
    await runFfmpeg(
      ['-y', ...filterInputs, '-filter_complex', filter,
        '-map', '[vout]', '-map', '[aout]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '192k',
        outputFile],
      (pct) => report(60 + Math.round(pct * 0.4), 'concat: re-encoding'),
    );
    report(100, 'concat: re-encoded');
    return { mode: 'reencode' };
  } finally {
    try { fs.unlinkSync(listFile); } catch (_) { /* ignore */ }
  }
}

function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';
    let totalMs = null;

    proc.stderr.on('data', (chunk) => {
      const s = chunk.toString('utf8');
      stderrTail = (stderrTail + s).slice(-4000);

      if (totalMs === null) {
        const d = s.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (d) totalMs = (+d[1] * 3600 + +d[2] * 60 + parseFloat(d[3])) * 1000;
      }
      const t = s.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (t && totalMs && onProgress) {
        const doneMs = (+t[1] * 3600 + +t[2] * 60 + parseFloat(t[3])) * 1000;
        onProgress(Math.min(100, Math.round(doneMs / totalMs * 100)));
      }
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${stderrTail.split('\n').slice(-5).join(' | ').trim()}`));
    });
  });
}

module.exports = { concatClips };
