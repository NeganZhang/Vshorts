const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const FFMPEG_BIN = process.env.FFMPEG && fs.existsSync(process.env.FFMPEG)
  ? process.env.FFMPEG
  : 'ffmpeg';
const FFPROBE_BIN = process.env.FFPROBE && fs.existsSync(process.env.FFPROBE)
  ? process.env.FFPROBE
  : 'ffprobe';

async function removeSilence(inputFile, outputFile, options = {}, onProgress) {
  if (!fs.existsSync(inputFile)) throw new Error(`removeSilence: missing input ${inputFile}`);
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });

  const opts = {
    thresholdDb: Number(options.thresholdDb ?? -36),
    minSilence: Number(options.minSilence ?? 0.45),
    keepPadding: Number(options.keepPadding ?? 0.11),
    minSegment: Number(options.minSegment ?? 0.18),
    enabled: options.enabled !== false,
  };

  if (!opts.enabled) {
    fs.copyFileSync(inputFile, outputFile);
    return { mode: 'disabled', removedSeconds: 0, segmentCount: 1 };
  }

  report(onProgress, 3, 'Detecting pauses');
  const media = await probeMedia(inputFile);
  if (!media.hasAudio || !media.duration || media.duration <= 0) {
    fs.copyFileSync(inputFile, outputFile);
    return { mode: 'no-audio', removedSeconds: 0, segmentCount: 1 };
  }

  const silences = await detectSilence(inputFile, opts);
  const segments = buildKeepSegments(media.duration, silences, opts);
  const keptDuration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const removedSeconds = Math.max(0, media.duration - keptDuration);

  if (segments.length === 0 || removedSeconds < 0.15) {
    fs.copyFileSync(inputFile, outputFile);
    return { mode: 'unchanged', removedSeconds: 0, segmentCount: 1 };
  }

  report(onProgress, 20, `Removing ${removedSeconds.toFixed(1)}s of pauses`);
  await renderSegments(inputFile, outputFile, segments, onProgress);
  report(onProgress, 100, 'Pauses removed');

  return {
    mode: 'trimmed',
    removedSeconds,
    segmentCount: segments.length,
    originalDuration: media.duration,
    outputDuration: keptDuration,
  };
}

async function probeMedia(inputFile) {
  const json = await runCapture(FFPROBE_BIN, [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-show_entries', 'stream=codec_type',
    '-of', 'json',
    inputFile,
  ]);
  const parsed = JSON.parse(json || '{}');
  return {
    duration: Number(parsed.format?.duration || 0),
    hasAudio: Array.isArray(parsed.streams) && parsed.streams.some(stream => stream.codec_type === 'audio'),
  };
}

async function detectSilence(inputFile, opts) {
  const stderr = await runCapture(FFMPEG_BIN, [
    '-hide_banner',
    '-nostats',
    '-i', inputFile,
    '-af', `silencedetect=noise=${opts.thresholdDb}dB:d=${opts.minSilence}`,
    '-f', 'null',
    '-',
  ], { captureStderr: true, allowFailure: true });

  const starts = [];
  const ranges = [];
  for (const line of stderr.split(/\r?\n/)) {
    const start = line.match(/silence_start:\s*([0-9.]+)/);
    if (start) {
      starts.push(Number(start[1]));
      continue;
    }
    const end = line.match(/silence_end:\s*([0-9.]+)/);
    if (end && starts.length) {
      ranges.push({ start: starts.shift(), end: Number(end[1]) });
    }
  }
  return ranges.filter(range => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start);
}

function buildKeepSegments(duration, silences, opts) {
  const segments = [];
  let cursor = 0;

  for (const silence of silences) {
    const silenceDuration = silence.end - silence.start;
    if (silenceDuration < opts.minSilence) continue;

    const keepEnd = clamp(silence.start + opts.keepPadding, cursor, duration);
    if (keepEnd - cursor >= opts.minSegment) {
      segments.push({ start: cursor, end: keepEnd });
    }
    cursor = clamp(silence.end - opts.keepPadding, keepEnd, duration);
  }

  if (duration - cursor >= opts.minSegment) {
    segments.push({ start: cursor, end: duration });
  }

  return mergeTinyGaps(segments, opts.minSegment).filter(segment => segment.end - segment.start >= opts.minSegment);
}

function mergeTinyGaps(segments, minSegment) {
  const merged = [];
  for (const segment of segments) {
    const last = merged[merged.length - 1];
    if (last && segment.start - last.end < minSegment) {
      last.end = segment.end;
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

async function renderSegments(inputFile, outputFile, segments, onProgress) {
  const trimFilters = [];
  const concatInputs = [];

  segments.forEach((segment, index) => {
    const start = segment.start.toFixed(3);
    const end = segment.end.toFixed(3);
    trimFilters.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v${index}]`);
    trimFilters.push(`[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a${index}]`);
    concatInputs.push(`[v${index}][a${index}]`);
  });

  const filter = [
    ...trimFilters,
    `${concatInputs.join('')}concat=n=${segments.length}:v=1:a=1[vout][aout]`,
  ].join(';');

  await runFfmpeg([
    '-y',
    '-i', inputFile,
    '-filter_complex', filter,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '20',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-movflags', '+faststart',
    outputFile,
  ], pct => report(onProgress, 20 + pct * 0.8, 'Cutting pauses'));
}

function runFfmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFMPEG_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrTail = '';
    let totalMs = null;

    proc.stderr.on('data', chunk => {
      const text = chunk.toString('utf8');
      stderrTail = (stderrTail + text).slice(-4000);

      if (totalMs === null) {
        const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
        if (duration) totalMs = toMs(duration);
      }
      const time = text.match(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (time && totalMs && onProgress) {
        onProgress(Math.min(100, toMs(time) / totalMs * 100));
      }
    });

    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0) return resolve();
      reject(new Error(`ffmpeg exited ${code}: ${stderrTail.split('\n').slice(-5).join(' | ').trim()}`));
    });
  });
}

function runCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', chunk => { stdout += chunk.toString('utf8'); });
    proc.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });
    proc.on('error', reject);
    proc.on('close', code => {
      if (code === 0 || options.allowFailure) {
        resolve(options.captureStderr ? stderr : stdout);
      } else {
        reject(new Error(`${command} exited ${code}: ${stderr.split('\n').slice(-5).join(' | ').trim()}`));
      }
    });
  });
}

function toMs(match) {
  return (+match[1] * 3600 + +match[2] * 60 + parseFloat(match[3])) * 1000;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function report(onProgress, pct, msg) {
  if (onProgress) onProgress(Math.max(0, Math.min(100, pct)), msg);
}

module.exports = { removeSilence };
