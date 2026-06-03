const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const MUSIC_PRESETS_DIR = path.join(ROOT, 'server', 'assets', 'music');
const CHROME_PATH = 'C:\\Users\\Zhang\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe';
const NPX_BIN = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const FFMPEG_BIN = process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)
  ? process.env.FFMPEG
  : 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE && fs.existsSync(process.env.FFPROBE)
  ? process.env.FFPROBE
  : 'ffprobe';

async function renderWithHyperFrames({ sourceMp4, outputMp4, jobDir, config = {}, onProgress }) {
  const projectDir = path.join(jobDir, 'hyperframes');
  fs.mkdirSync(projectDir, { recursive: true });

  const sourceTarget = path.join(projectDir, 'source.mp4');
  await ensureBrowserMp4(sourceMp4, sourceTarget, onProgress);

  const duration = await probeDuration(sourceTarget);
  const music = await prepareMusic({ projectDir, presetId: config.music, duration, onProgress });
  const format = config.exportFormat || 'tiktok';
  const size = format === 'landscape'
    ? { width: 1920, height: 1080 }
    : format === 'square'
      ? { width: 1080, height: 1080 }
      : { width: 1080, height: 1920 };

  onProgress(20, 'Writing HyperFrames composition');
  fs.writeFileSync(path.join(projectDir, 'DESIGN.md'), designDoc(), 'utf8');
  fs.writeFileSync(path.join(projectDir, 'index.html'), buildHtml({
    duration,
    width: size.width,
    height: size.height,
    music,
    musicVolume: Number(config.musicVolume || 0.42),
    captionStyle: config.captionStyle || 'viral',
    exportFormat: format
  }), 'utf8');

  onProgress(30, 'Linting HyperFrames composition');
  await run(NPX_BIN, ['hyperframes', 'lint'], { cwd: projectDir, env: browserEnv(), capture: true });

  onProgress(38, 'Rendering with HyperFrames');
  await run(NPX_BIN, ['hyperframes', 'render', '--output', outputMp4, '--quality', 'standard'], {
    cwd: projectDir,
    env: browserEnv(),
    onData: (text) => {
      const match = text.match(/(\d+)%/);
      if (match) {
        const pct = Math.max(38, Math.min(98, 38 + Number(match[1]) * 0.6));
        onProgress(pct, 'Rendering with HyperFrames');
      }
    }
  });

  onProgress(100, 'Ready to download');
  return outputMp4;
}

async function ensureBrowserMp4(inputFile, outputFile, onProgress) {
  const media = await probeCodecs(inputFile);
  const browserReady = media.videoCodec === 'h264' && (!media.hasAudio || media.audioCodec === 'aac');

  if (browserReady) {
    fs.copyFileSync(inputFile, outputFile);
    return;
  }

  if (onProgress) onProgress(8, 'Normalizing video for HyperFrames');
  await run(FFMPEG_BIN, [
    '-y',
    '-i', inputFile,
    '-map', '0:v:0',
    '-map', '0:a:0?',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputFile,
  ], { capture: true });
}

async function probeCodecs(file) {
  const result = await run(FFPROBE_BIN, [
    '-v', 'error',
    '-show_entries', 'stream=codec_type,codec_name',
    '-of', 'json',
    file,
  ], { capture: true });
  const parsed = JSON.parse(result.stdout || '{}');
  const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
  const video = streams.find(stream => stream.codec_type === 'video');
  const audio = streams.find(stream => stream.codec_type === 'audio');
  return {
    videoCodec: video?.codec_name || null,
    audioCodec: audio?.codec_name || null,
    hasAudio: Boolean(audio),
  };
}

async function prepareMusic({ projectDir, presetId, duration, onProgress }) {
  if (!presetId || presetId === 'none') return null;
  const existing = resolveMusic(presetId);
  if (existing) {
    const target = path.join(projectDir, `music${path.extname(existing)}`);
    fs.copyFileSync(existing, target);
    return path.basename(target);
  }

  onProgress(12, 'Generating HyperFrames BGM');
  const output = path.join(projectDir, 'music.m4a');
  await generateFallbackMusic(output, presetId, duration);
  return 'music.m4a';
}

function buildHtml({ duration, width, height, music, musicVolume, captionStyle, exportFormat }) {
  const compositionId = 'vshorts-hyperframes-export';
  const isLandscape = exportFormat === 'landscape';
  const titleSize = isLandscape ? 58 : 48;
  const tag = captionStyle === 'minimal'
    ? 'AUTO EDIT'
    : captionStyle === 'glow'
      ? 'AI CUT'
      : 'VSHORT';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>VSHORT HyperFrames Export</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #06060a; color: #fff; font-family: Inter, Arial, sans-serif; }
    #${compositionId} {
      width: ${width}px;
      height: ${height}px;
      overflow: hidden;
      position: relative;
      background:
        radial-gradient(circle at 78% 16%, rgba(255,92,43,0.26), transparent 28%),
        radial-gradient(circle at 18% 70%, rgba(0,212,255,0.18), transparent 34%),
        #06060a;
    }
    .video-shell {
      position: absolute;
      inset: 0;
      overflow: hidden;
      transform-origin: center;
      will-change: transform;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
      filter: contrast(1.06) saturate(1.08);
    }
    .vignette {
      position: absolute;
      inset: 0;
      background:
        linear-gradient(180deg, rgba(0,0,0,0.24), transparent 28%, transparent 72%, rgba(0,0,0,0.38)),
        radial-gradient(circle at center, transparent 58%, rgba(0,0,0,0.38));
      pointer-events: none;
      z-index: 4;
    }
    .grid {
      position: absolute;
      inset: 0;
      opacity: 0.13;
      z-index: 3;
      background-image: linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px);
      background-size: 72px 72px;
      mask-image: radial-gradient(circle at center, black, transparent 72%);
      pointer-events: none;
    }
    .topline {
      position: absolute;
      left: ${isLandscape ? 64 : 48}px;
      right: ${isLandscape ? 64 : 48}px;
      top: ${isLandscape ? 44 : 58}px;
      z-index: 8;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: rgba(255,255,255,0.72);
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 0;
    }
    .badge {
      padding: 13px 18px;
      border-radius: 999px;
      background: rgba(6,6,10,0.52);
      border: 1px solid rgba(255,255,255,0.18);
      backdrop-filter: blur(16px);
      box-shadow: 0 12px 38px rgba(0,0,0,0.28);
    }
    .caption-card {
      position: absolute;
      left: ${isLandscape ? 64 : 48}px;
      right: ${isLandscape ? 64 : 48}px;
      bottom: ${isLandscape ? 48 : 86}px;
      z-index: 8;
      display: grid;
      gap: 14px;
      padding: ${isLandscape ? 22 : 26}px;
      border-radius: 8px;
      background: ${captionStyle === 'minimal' ? 'rgba(0,0,0,0.32)' : 'linear-gradient(135deg, rgba(255,92,43,0.34), rgba(6,6,10,0.56))'};
      border: 1px solid rgba(255,255,255,0.18);
      backdrop-filter: blur(18px);
      box-shadow: 0 22px 80px rgba(0,0,0,0.36);
    }
    .caption-kicker {
      color: ${captionStyle === 'glow' ? '#7fe6ff' : '#ff9a6c'};
      font-size: 18px;
      font-weight: 900;
      letter-spacing: 0;
    }
    .caption-title {
      margin: 0;
      font-size: ${titleSize}px;
      line-height: 1.03;
      letter-spacing: 0;
      max-width: ${isLandscape ? 920 : 880}px;
      text-shadow: 0 12px 46px rgba(0,0,0,0.48);
    }
    .sweep {
      position: absolute;
      inset: -18%;
      z-index: 7;
      opacity: 0;
      pointer-events: none;
      background: linear-gradient(90deg, transparent 0%, rgba(255,255,255,0) 34%, rgba(255,255,255,0.62) 50%, rgba(255,92,43,0.38) 58%, transparent 74%);
      filter: blur(7px);
      transform: translateX(-120%) rotate(-14deg);
    }
  </style>
</head>
<body>
  <main id="${compositionId}" data-composition-id="${compositionId}" data-width="${width}" data-height="${height}" data-duration="${duration}" data-start="0">
    <div class="video-shell">
      <video id="source-video" data-start="0" data-duration="${duration}" data-track-index="0" src="source.mp4" muted playsinline></video>
    </div>
    <audio id="source-audio" data-start="0" data-duration="${duration}" data-track-index="2" src="source.mp4" data-volume="0.74"></audio>
    ${music ? `<audio id="bgm" data-start="0" data-duration="${duration}" data-track-index="3" src="${music}" data-volume="${musicVolume}"></audio>` : ''}
    <div class="grid" data-layout-ignore></div>
    <div class="vignette" data-layout-ignore></div>
    <div class="sweep" data-layout-ignore></div>
    <div class="topline">
      <div class="badge">VSHORT</div>
      <div class="badge">AI ASSISTED CUT</div>
    </div>
    <section class="caption-card">
      <div class="caption-kicker">${tag}</div>
      <h1 class="caption-title">Turn raw clips into a polished short.</h1>
    </section>
  </main>
  <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    const duration = ${duration};
    const pulseCount = Math.max(1, Math.ceil(duration / 0.5) - 1);
    tl.from(".topline .badge", { y: -28, opacity: 0, stagger: 0.08, duration: 0.55, ease: "expo.out" }, 0.18);
    tl.from(".caption-card", { y: 62, opacity: 0, scale: 0.96, duration: 0.72, ease: "expo.out", overwrite: "auto" }, 0.36);
    tl.from(".caption-title", { y: 28, opacity: 0, duration: 0.5, ease: "power3.out" }, 0.58);
    tl.to(".video-shell", { scale: 1.105, x: -22, y: 18, rotation: -0.22, duration: Math.max(1, duration - 0.4), ease: "sine.inOut" }, 0.25);
    tl.to(".grid", { x: -72, y: -72, duration, ease: "none" }, 0);
    tl.fromTo(".sweep", { opacity: 0, x: "-120%" }, { opacity: 0.86, x: "120%", repeat: pulseCount, repeatDelay: 0.12, duration: 0.34, ease: "power3.inOut" }, 0.8);
    tl.to(".caption-card", { y: 22, opacity: 0, duration: 0.45, ease: "power2.in", overwrite: "auto" }, Math.max(0, duration - 0.55));
    window.__timelines["${compositionId}"] = tl;
  </script>
</body>
</html>`;
}

function designDoc() {
  return `## Style Prompt
VSHORT uses a dark cinematic canvas with orange energy accents, cyan technical light, glassy UI overlays, and fast product-editor motion. The video should feel like a polished short-form editing tool, not a generic slideshow.

## Colors
- Background: #06060a
- Vshort orange: #ff5c2b
- Technical cyan: #00d4ff
- Text: #ffffff
- Glass surface: rgba(6,6,10,0.56)

## Typography
- Inter, Arial, sans-serif

## What NOT to Do
- Do not use beige, cream, or generic blue SaaS colors.
- Do not use decorative cards inside cards.
- Do not make a landing page; this is a rendered short-video composition.
`;
}

function resolveMusic(presetId) {
  if (!presetId || presetId === 'none') return null;
  for (const ext of ['.mp3', '.m4a', '.wav']) {
    const candidate = path.join(MUSIC_PRESETS_DIR, `${presetId}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function generateFallbackMusic(output, presetId, duration) {
  const d = Math.max(1, Number(duration) || 20);
  const frequency = presetId === 'dark-ambient' ? 58 : presetId === 'lofi-chill' ? 82 : 64;
  await run(FFMPEG_BIN, [
    '-y',
    '-f', 'lavfi', '-i', `sine=frequency=${frequency}:duration=${d}`,
    '-f', 'lavfi', '-i', `sine=frequency=${frequency * 2}:duration=${d}`,
    '-f', 'lavfi', '-i', `anoisesrc=color=pink:duration=${d}:amplitude=0.22`,
    '-filter_complex',
    `[0:a]volume=1.8,tremolo=f=4:d=0.78[a0];[1:a]volume=0.9,tremolo=f=8:d=0.55[a1];[2:a]highpass=f=2200,lowpass=f=7600,volume=0.1,tremolo=f=4:d=0.9[a2];[a0][a1][a2]amix=inputs=3:duration=longest,volume=1.6,alimiter=limit=0.88,afade=t=in:st=0:d=0.25,afade=t=out:st=${Math.max(0, d - 1)}:d=1`,
    '-c:a', 'aac',
    '-b:a', '192k',
    output
  ], { capture: true });
}

async function probeDuration(file) {
  const result = await run(FFPROBE_BIN, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file
  ], { capture: true });
  return Number.parseFloat(result.stdout.trim()) || 1;
}

function browserEnv() {
  if (process.env.HYPERFRAMES_BROWSER_PATH || !fs.existsSync(CHROME_PATH)) return {};
  return { HYPERFRAMES_BROWSER_PATH: CHROME_PATH };
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: process.platform === 'win32' && command.endsWith('.cmd'),
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (options.onData) options.onData(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (options.onData) options.onData(text);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) return resolve({ stdout, stderr });
      reject(new Error((stderr || stdout || `${command} exited with ${code}`).trim()));
    });
  });
}

module.exports = { renderWithHyperFrames };
