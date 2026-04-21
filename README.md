# VSHORT

AI-assisted short-form video workflow: script → storyboard → video editor.
Node.js/Express backend, vanilla HTML/CSS/JS frontend, Supabase auth, SQLite.

## Prerequisites

1. **Node.js 18+** — `npm install`
2. **Python 3.12** — on PATH (`py -3.12 --version` on Windows, `python3.12 --version` elsewhere)
3. **FFmpeg** — on PATH (`ffmpeg -version`)
4. Optional: **CUDA toolkit** for GPU-accelerated video decoding

## First-time setup

```bash
# Node deps
npm install

# Python venv + CutClaw pipeline deps (takes a few minutes)
# Windows:
pwsh server/python/setup.ps1
# macOS / Linux:
bash server/python/setup.sh
```

Copy `.env.example` → `.env` and fill in at least `ANTHROPIC_API_KEY`.

## Run

```bash
npm run dev    # http://localhost:3000
```

## The VSHORT video editor (`/vshorts.html`)

The editor takes one or more uploaded clips and produces an AI-assembled
short-form video. Under the hood:

1. Uploaded clips are concatenated into a single source video (`ffmpegConcat`).
2. The concatenated video is handed to the [CutClaw](https://github.com/GVCLab/CutClaw)
   pipeline (vendored under `server/python/cutclaw/`), which:
   - transcribes audio with faster-whisper (or supplied SRT),
   - runs a multi-agent screenwriter + editor to plan shots,
   - renders the final montage with FFmpeg.
3. Progress streams back to the browser via `edit_jobs.stage` / `stage_msg`.

### Music presets

Drop royalty-free MP3s in `server/assets/music/` matching the preset ids in
`public/vshorts.html`. See `server/assets/music/README.md` for the full list.
If no preset matches, the source video's own audio is used.

### Licensing note

CutClaw is currently vendored without a license file upstream. See
`server/python/cutclaw/VENDORED.md` — **do not ship to production** until the
license situation is resolved.
