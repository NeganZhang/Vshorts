// Render pipeline (image-to-video) on Supabase. Scenes → per-scene Seedance
// clip → normalize → concat → optional BGM → browser-safe MP4. DB state lives
// in Supabase (data.js); generated clips + final video go to Supabase Storage.
// FFmpeg work still happens on local disk (ephemeral per job).
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const data = require('../data');
const { concatClips } = require('./ffmpegConcat');
const { generateClipFromImage, clampDuration } = require('./seedanceVideo');
const { prepareMusic } = require('./hyperframesRenderer');

const ROOT = path.resolve(__dirname, '..', '..');
const UPLOADS_ROOT = path.join(ROOT, 'uploads');
const SCENE_CLIPS_DIR = path.join(UPLOADS_ROOT, 'scene-clips');

const FFMPEG_BIN = process.env.FFMPEG && fs.existsSync(process.env.FFMPEG) ? process.env.FFMPEG : 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE && fs.existsSync(process.env.FFPROBE) ? process.env.FFPROBE : 'ffprobe';

const MAX_RENDER_SCENES = Number(process.env.MAX_RENDER_SCENES) || 8;
const MAX_TOTAL_SECONDS = Number(process.env.MAX_TOTAL_SECONDS) || 80;
const RENDER_CONCURRENCY = Math.max(1, Number(process.env.ARK_RENDER_CONCURRENCY) || 1);

// Progress updates are fire-and-forget (called from sync ffmpeg callbacks too).
function setProgress(jobId, pct, stage, msg) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  data.jobs.setStage(jobId, clamped, stage, msg ? String(msg).slice(0, 500) : null).catch(() => {});
}

function targetSize(format) {
  if (format === 'landscape') return { w: 1920, h: 1080 };
  if (format === 'square') return { w: 1080, h: 1080 };
  return { w: 1080, h: 1920 };
}
function aspectForFormat(format) {
  if (format === 'landscape') return '16:9';
  if (format === 'square') return '1:1';
  return '9:16';
}
function durationFromScene(scene) {
  const m = String(scene.duration || '').match(/(\d+)\s*-\s*(\d+)\s*s/i);
  if (m) return clampDuration(Number(m[2]) - Number(m[1]));
  return clampDuration(5);
}
function motionPromptForScene(scene) {
  return [
    (scene.prompt || '').trim(),
    scene.camera_move ? `Camera: ${scene.camera_move}.` : '',
    `Subtle, natural motion${scene.shot_type ? `, ${scene.shot_type}` : ''}.`,
  ].filter(Boolean).join(' ');
}

async function processVideo(jobId, projectId, config = {}) {
  const jobDir = path.join(UPLOADS_ROOT, 'render-jobs', jobId);
  const outputMp4 = path.join(jobDir, 'output.mp4');
  const format = config.exportFormat || 'tiktok';
  const { w, h } = targetSize(format);
  const aspect = aspectForFormat(format);

  try {
    fs.mkdirSync(jobDir, { recursive: true });
    fs.mkdirSync(SCENE_CLIPS_DIR, { recursive: true });

    setProgress(jobId, 1, 'load', 'Loading storyboard scenes');
    let scenes = await data.scenes.doneWithImage(projectId);
    if (!scenes.length) throw new Error('No storyboard scenes with generated images for this project');

    if (scenes.length > MAX_RENDER_SCENES) scenes = scenes.slice(0, MAX_RENDER_SCENES);

    const overrides = new Map((Array.isArray(config.scenes) ? config.scenes : []).map((s) => [s.sceneId, s]));
    const plan = [];
    let total = 0;
    for (const scene of scenes) {
      const ov = overrides.get(scene.id) || {};
      const dur = ov.durationSeconds ? clampDuration(ov.durationSeconds) : durationFromScene(scene);
      if (total + dur > MAX_TOTAL_SECONDS) break;
      total += dur;
      plan.push({ scene, dur, prompt: (ov.motionPrompt || '').trim() || motionPromptForScene(scene) });
    }
    if (!plan.length) throw new Error('No scenes fit within the duration cap');

    const N = plan.length;
    const I2V_START = 2, I2V_END = 78;
    let completed = 0;

    async function renderScene(entry, idx) {
      const { scene, dur, prompt } = entry;
      const sceneClip = path.join(SCENE_CLIPS_DIR, `${scene.id}.mp4`);

      // Reuse a cached clip (Storage URL) so re-renders don't re-bill scenes.
      if (scene.clip_status === 'done' && scene.clip_path) {
        try {
          await downloadToFile(scene.clip_path, sceneClip);
          entry.clipPath = sceneClip;
          return;
        } catch { /* fall through to regenerate */ }
      }

      await data.scenes.setClipStatus(scene.id, 'generating');
      try {
        await generateClipFromImage({
          imagePath: scene.image_path,
          outputClipPath: sceneClip,
          prompt, durationSeconds: dur, aspect,
          onProgress: (pct, msg) => {
            if (RENDER_CONCURRENCY === 1) {
              const lo = I2V_START + (idx / N) * (I2V_END - I2V_START);
              const hi = I2V_START + ((idx + 1) / N) * (I2V_END - I2V_START);
              setProgress(jobId, lo + (pct / 100) * (hi - lo), 'i2v', `Scene ${idx + 1}/${N}: ${msg || 'generating'}`);
            }
          },
        });
        const url = await data.uploadAsset('scene-clips', `${scene.id}.mp4`, sceneClip, 'video/mp4');
        await data.scenes.setClip(scene.id, url, 'done');
        entry.clipPath = sceneClip;
      } catch (err) {
        await data.scenes.setClipStatus(scene.id, 'error');
        throw new Error(`Scene ${idx + 1} i2v failed: ${err.message || err}`);
      } finally {
        completed++;
        if (RENDER_CONCURRENCY > 1) setProgress(jobId, I2V_START + (completed / N) * (I2V_END - I2V_START), 'i2v', `Generated ${completed}/${N} clips`);
      }
    }

    setProgress(jobId, I2V_START, 'i2v', `Generating ${N} clip${N > 1 ? 's' : ''}`);
    await runPool(plan, RENDER_CONCURRENCY, renderScene);

    // Normalize each clip to the job aspect (handles size + missing audio).
    setProgress(jobId, 80, 'normalize', 'Conforming clips');
    const normDir = path.join(jobDir, 'norm');
    fs.mkdirSync(normDir, { recursive: true });
    const normalized = [];
    for (let i = 0; i < plan.length; i++) {
      const out = path.join(normDir, `clip-${String(i).padStart(2, '0')}.mp4`);
      await normalizeClip(plan[i].clipPath, out, w, h);
      normalized.push(out);
    }

    setProgress(jobId, 86, 'concat', 'Stitching clips');
    const stitched = path.join(jobDir, 'stitched.mp4');
    await concatClips(normalized, stitched, (pct) => setProgress(jobId, 86 + pct * 0.06, 'concat', 'Stitching clips'));

    let finalSource = stitched;
    if (config.music && config.music !== 'none') {
      setProgress(jobId, 93, 'mux', 'Adding background music');
      try {
        const musicName = await prepareMusic({ projectDir: jobDir, presetId: config.music, duration: total, onProgress: () => {} });
        if (musicName) {
          const withMusic = path.join(jobDir, 'with-music.mp4');
          await muxMusic(stitched, path.join(jobDir, musicName), withMusic, Number(config.musicVolume || 0.42));
          finalSource = withMusic;
        }
      } catch (e) { console.warn(`[render ${jobId}] music mux skipped: ${e.message}`); }
    }

    setProgress(jobId, 97, 'finalize', 'Finalizing');
    await finalize(finalSource, outputMp4);

    // Upload the final video to Storage; output_path is its public URL.
    const outUrl = await data.uploadAsset('renders', `${jobId}.mp4`, outputMp4, 'video/mp4');
    await data.jobs.markDone(jobId, outUrl);
  } catch (err) {
    console.error(`[render ${jobId}]`, err);
    await data.jobs.markError(jobId, String(err.message || err).slice(0, 500), 'Render failed').catch(() => {});
  }
}

// ── ffmpeg helpers ───────────────────────────────────────────────
async function downloadToFile(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function probeHasAudio(file) {
  try {
    const { stdout } = await runCapture(FFPROBE_BIN, ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', file]);
    return stdout.trim().length > 0;
  } catch { return false; }
}

async function normalizeClip(input, output, w, h) {
  const hasAudio = await probeHasAudio(input);
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
  const args = ['-y'];
  if (hasAudio) args.push('-i', input, '-vf', vf, '-map', '0:v:0', '-map', '0:a:0');
  else args.push('-i', input, '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100', '-vf', vf, '-map', '0:v:0', '-map', '1:a:0', '-shortest');
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '44100', '-ac', '2', '-video_track_timescale', '30000', output);
  await runFfmpeg(args);
}

async function muxMusic(videoIn, musicIn, output, volume) {
  await runFfmpeg(['-y', '-i', videoIn, '-i', musicIn, '-filter_complex', `[1:a]volume=${volume}[bg];[0:a][bg]amix=inputs=2:duration=first:dropout_transition=2[aout]`, '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', output]);
}

async function finalize(input, output) {
  await runFfmpeg(['-y', '-i', input, '-c', 'copy', '-movflags', '+faststart', output]);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    proc.stderr.on('data', (c) => { tail = (tail + c.toString()).slice(-3000); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${tail.split('\n').slice(-4).join(' | ')}`)));
  });
}

function runCapture(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    proc.stdout.on('data', (c) => { stdout += c.toString(); });
    proc.stderr.on('data', (c) => { stderr += c.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}`)));
  });
}

async function runPool(items, limit, fn) {
  if (limit <= 1) { for (let i = 0; i < items.length; i++) await fn(items[i], i); return; }
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; await fn(items[i], i); }
  });
  await Promise.all(workers);
}

module.exports = { processVideo, generateVideoFromScenes: processVideo };
