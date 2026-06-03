# VSHORT

AI-assisted short-form video workflow: script -> storyboard -> video editor.
Node.js/Express backend, vanilla HTML/CSS/JS frontend, Supabase auth, SQLite,
FFmpeg media processing, and HyperFrames rendering.

## Prerequisites

1. Node.js 22+ (`node -v`)
2. FFmpeg + FFprobe on PATH (`ffmpeg -version`, `ffprobe -version`)
3. Supabase project keys for auth
4. Optional: Chrome path via `HYPERFRAMES_BROWSER_PATH` when HyperFrames cannot find a browser automatically

## First-Time Setup

```bash
npm install
copy .env.example .env
npm run dev
```

Fill `.env` with at least:

```env
SUPABASE_URL=...
SUPABASE_PUBLISHABLE_KEY=...
```

For production-style signup with server-side auto-confirmed users, also add:

```env
SUPABASE_SERVICE_ROLE_KEY=...
```

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:3000
http://localhost:3000/scripts.html
http://localhost:3000/storyboard.html
http://localhost:3000/vshorts.html
```

## The VSHORT Video Editor

The editor takes one or more uploaded clips and produces a short-form video.
The current export pipeline is:

1. Uploaded clips are stitched into one source video with FFmpeg.
2. Talking-head pauses are detected from audio with FFmpeg `silencedetect`.
3. Long pauses are removed while keeping a small natural audio buffer.
4. The cleaned source is normalized to browser-playable H.264/AAC MP4.
5. HyperFrames generates the motion package, branded overlays, BGM, and final vertical export.
6. Progress streams back through `edit_jobs.stage` and `edit_jobs.stage_msg`.

Default pause-cut behavior:

- `minSilenceSeconds`: `0.45`
- `silenceThresholdDb`: `-36`
- `silencePaddingSeconds`: `0.11`

These can be overridden in the edit job config. Set `autoCutPauses: false` to disable pause cutting.

## Music Presets

Drop royalty-free audio files into `server/assets/music/` using preset ids from
`public/vshorts.html`, for example:

```text
server/assets/music/viral-energy.mp3
server/assets/music/dark-ambient.mp3
server/assets/music/lofi-chill.mp3
```

If a preset is selected but the file is missing, the backend generates a simple
fallback beat so the export still completes locally.

## Notes

- The original frontend pages are preserved: `scripts.html`, `storyboard.html`, and `vshorts.html`.
- The old CutClaw bridge remains in the repository as legacy code, but the active export path no longer calls it.
- Generated uploads, SQLite data, local env files, and local logs are gitignored.
