// Image-to-video via Seedance on Volcano Ark (火山方舟).
//
// Async task API:
//   POST {ARK_VIDEO_URL}                      → { id }
//   GET  {ARK_VIDEO_URL}/{id}                 → { status, content:{ video_url }, usage }
// status: queued | running | succeeded | failed | expired | cancelled
// The returned video_url expires ~24h after success, so we download immediately.
//
// PROXY ISOLATION (critical): imageGen.js installs a GLOBAL undici ProxyAgent
// when Gemini-is-used-without-Doubao (our exact config) so international Gemini
// works from China. Seedance is domestic — every fetch here passes its own
// no-proxy undici Agent as `dispatcher` so it bypasses that global proxy.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Agent } = require('undici');

const ROOT = path.resolve(__dirname, '..', '..');

const ARK_API_KEY   = process.env.ARK_API_KEY || process.env.SEEDANCE_API_KEY || '';
const ARK_VIDEO_MODEL = process.env.ARK_VIDEO_MODEL || 'doubao-seedance-1-5-pro-251215';
const ARK_VIDEO_URL = process.env.ARK_VIDEO_URL
  || 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
const ARK_VIDEO_RESOLUTION = process.env.ARK_VIDEO_RESOLUTION || '1080p';
const ARK_CLIP_SECONDS = clampDuration(Number(process.env.ARK_CLIP_SECONDS) || 5);
const ARK_VIDEO_TIMEOUT_MS = Number(process.env.ARK_VIDEO_TIMEOUT_MS) || 360_000;
const ARK_WATERMARK = String(process.env.ARK_WATERMARK || 'false').toLowerCase() === 'true';

const FFMPEG_BIN = process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)
  ? process.env.FFMPEG
  : 'ffmpeg';

// One reusable no-proxy dispatcher. Passing it per-request overrides whatever
// global dispatcher imageGen.js may have installed (the Gemini ProxyAgent).
const directDispatcher = new Agent();

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

if (ARK_API_KEY) {
  console.log(`[seedance] Provider: Seedance/Ark (${ARK_VIDEO_MODEL}) — ${ARK_VIDEO_RESOLUTION}, ${ARK_CLIP_SECONDS}s default`);
} else {
  console.log('[seedance] Provider: mock (no ARK_API_KEY set) — clips are placeholder color frames');
}

function clampDuration(sec) {
  // Seedance accepts 4–15s. Default 5.
  if (!Number.isFinite(sec)) return 5;
  return Math.max(4, Math.min(15, Math.round(sec)));
}

function ratioForAspect(aspect) {
  if (aspect === '9:16') return '9:16';
  if (aspect === '16:9') return '16:9';
  if (aspect === '1:1')  return '1:1';
  return 'adaptive'; // match the input image's own aspect
}

function mockSizeForAspect(aspect) {
  if (aspect === '16:9') return { w: 1280, h: 720 };
  if (aspect === '1:1')  return { w: 720,  h: 720 };
  return { w: 720, h: 1280 }; // default portrait
}

/**
 * Generate one video clip from a single storyboard image.
 *
 * @param {object} args
 * @param {string} args.imagePath        Web path like "/uploads/scenes/{id}.png" OR an absolute disk path.
 * @param {string} args.outputClipPath   Absolute destination .mp4 path (caller owns location).
 * @param {string} [args.prompt]         Motion/text prompt.
 * @param {number} [args.durationSeconds]
 * @param {string} [args.aspect]         '9:16' | '16:9' | '1:1'
 * @param {(pct:number,msg?:string)=>void} [args.onProgress]
 * @returns {Promise<string>} outputClipPath
 */
async function generateClipFromImage({ imagePath, outputClipPath, prompt, durationSeconds, aspect, onProgress }) {
  const duration = clampDuration(durationSeconds || ARK_CLIP_SECONDS);
  const report = (pct, msg) => { if (onProgress) onProgress(Math.max(0, Math.min(100, pct)), msg); };
  fs.mkdirSync(path.dirname(outputClipPath), { recursive: true });

  if (!ARK_API_KEY) {
    report(10, 'mock i2v: rendering placeholder clip');
    await generateMockClip(outputClipPath, { aspect, duration });
    report(100, 'mock clip ready');
    return outputClipPath;
  }

  const imageRef = await imageToRef(imagePath);
  report(4, 'Submitting Seedance task');
  const taskId = await createTask({ imageRef, prompt, duration, aspect });
  report(8, 'Seedance task queued');

  const videoUrl = await pollTask(taskId, report);
  report(92, 'Downloading clip');
  await downloadToFile(videoUrl, outputClipPath);
  report(100, 'Clip ready');
  return outputClipPath;
}

async function imageToRef(imagePath) {
  // Seedance accepts a public image URL directly (scene images are Supabase
  // Storage public URLs). Only embed base64 for a local disk file.
  if (/^https?:\/\//i.test(imagePath)) return imagePath;
  const diskPath = path.isAbsolute(imagePath) && fs.existsSync(imagePath)
    ? imagePath
    : path.join(ROOT, imagePath.replace(/^\//, ''));
  if (!fs.existsSync(diskPath)) throw new Error(`i2v: image not found on disk: ${diskPath}`);
  const ext = path.extname(diskPath).toLowerCase();
  const mime = MIME_BY_EXT[ext] || 'image/png';
  const b64 = fs.readFileSync(diskPath).toString('base64');
  return `data:${mime};base64,${b64}`;
}

async function createTask({ imageRef, prompt, duration, aspect }) {
  // Seedance 1.5 Pro takes generation params as --flags appended to the text
  // prompt (not as top-level JSON fields).
  // Seedance 2.0 (BytePlus): generation params are top-level JSON fields; the
  // storyboard image is passed as a reference_image.
  const motion = (prompt && prompt.trim()) || 'Subtle, natural motion. Cinematic short-video clip.';
  const body = {
    model: ARK_VIDEO_MODEL,
    content: [
      { type: 'text', text: motion },
      { type: 'image_url', image_url: { url: imageRef }, role: 'reference_image' },
    ],
    ratio: ratioForAspect(aspect),
    duration,
    watermark: ARK_WATERMARK,
    generate_audio: false,
  };

  const res = await arkFetch(ARK_VIDEO_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ARK_API_KEY}` },
    body: JSON.stringify(body),
  }, 60_000);

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Seedance create ${res.status}: ${txt.slice(0, 400)}`);
  }
  const data = await res.json();
  const id = data?.id || data?.data?.id;
  if (!id) throw new Error(`Seedance create returned no task id: ${JSON.stringify(data).slice(0, 300)}`);
  return id;
}

async function pollTask(taskId, report) {
  const url = `${ARK_VIDEO_URL.replace(/\/$/, '')}/${encodeURIComponent(taskId)}`;
  const deadline = Date.now() + ARK_VIDEO_TIMEOUT_MS;
  let delay = 3000;

  while (Date.now() < deadline) {
    await sleep(delay);
    delay = Math.min(delay + 1500, 10_000); // backoff 3s → 10s

    let res;
    try {
      res = await arkFetch(url, {
        method: 'GET',
        headers: { authorization: `Bearer ${ARK_API_KEY}` },
      }, 30_000);
    } catch (e) {
      continue; // transient network error — keep polling until deadline
    }
    if (!res.ok) continue;

    const data = await res.json().catch(() => ({}));
    const status = data?.status;
    if (status === 'succeeded') {
      const videoUrl = data?.content?.video_url || data?.content?.[0]?.video_url;
      if (!videoUrl) throw new Error(`Seedance succeeded but no video_url: ${JSON.stringify(data).slice(0, 300)}`);
      return videoUrl;
    }
    if (status === 'failed' || status === 'expired' || status === 'cancelled') {
      const reason = data?.error?.message || data?.error || status;
      throw new Error(`Seedance task ${status}: ${String(reason).slice(0, 300)}`);
    }
    // queued / running → ramp progress 8 → 90
    report(Math.min(90, 10 + (Date.now() - (deadline - ARK_VIDEO_TIMEOUT_MS)) / ARK_VIDEO_TIMEOUT_MS * 80),
      status === 'running' ? 'Generating clip' : 'Waiting in queue');
  }
  throw new Error(`Seedance task timed out after ${Math.round(ARK_VIDEO_TIMEOUT_MS / 1000)}s`);
}

async function downloadToFile(url, destPath) {
  const res = await arkFetch(url, { method: 'GET' }, 120_000);
  if (!res.ok) throw new Error(`Seedance download ${res.status}`);
  const ab = await res.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(ab));
}

// Every Ark/network fetch routes through our own no-proxy dispatcher so the
// global Gemini ProxyAgent (installed by imageGen.js) never intercepts it.
async function arkFetch(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function generateMockClip(outputPath, { aspect, duration }) {
  const { w, h } = mockSizeForAspect(aspect);
  // Deterministic-ish hue from path length so successive scenes differ visibly.
  const hue = (outputPath.length * 37) % 360;
  return runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', `color=c=0x202830:s=${w}x${h}:d=${duration}:r=30`,
    '-f', 'lavfi', '-i', `anullsrc=channel_layout=stereo:sample_rate=44100`,
    '-vf', `hue=h=${hue},drawbox=x=0:y=0:w=${w}:h=${h}:color=0x00d4ff@0.0:t=fill`,
    '-t', String(duration),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k',
    '-shortest', '-movflags', '+faststart',
    outputPath,
  ]);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    proc.stderr.on('data', c => { tail = (tail + c.toString()).slice(-2000); });
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${tail.split('\n').slice(-4).join(' | ')}`)));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = { generateClipFromImage, clampDuration };
