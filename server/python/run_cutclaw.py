"""
VSHORT ↔ CutClaw bridge.

This script is invoked as a subprocess by server/services/videoProcessor.js.
It orchestrates the vendored CutClaw pipeline end-to-end:

    source.mp4 + music.mp3 + instruction
        → (optional faster-whisper ASR if no SRT is provided)
        → local_run.py        (shot plan + shot point JSONs)
        → render/render_video.py  (final MP4)

Progress is emitted as newline-delimited JSON to --progress-file so the Node
side can tail it and update the edit_jobs row:

    {"pct": 42, "stage": "planning", "msg": "Running screenwriter agent"}

CutClaw uses LiteLLM under the hood, so the Anthropic API key in the process
env (ANTHROPIC_API_KEY) is picked up automatically for `anthropic/*` models.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CUTCLAW_DIR = HERE / "cutclaw"

# config.VIDEO_DATABASE_FOLDER is where local_run.py drops all intermediate
# artifacts and where render_video.py reads the shot plan from. We scope it
# per-job so concurrent jobs don't collide.
def job_workspace(output_path: Path) -> Path:
    return output_path.parent / "cutclaw_workspace"


# ─── Stage → percent mapping ────────────────────────────────────────────────
# Keep these in sync with server/services/videoProcessor.js. The Node side
# blends its own concat stage (0–15%) before invoking this script.
STAGE_PCT = {
    "asr":      20,
    "planning": 40,
    "editing":  70,
    "rendering": 90,
    "done":     99,
}


def emit(progress_file: Path | None, stage: str, msg: str, pct: int | None = None) -> None:
    record = {
        "pct": pct if pct is not None else STAGE_PCT.get(stage, 0),
        "stage": stage,
        "msg": msg,
        "t": time.time(),
    }
    line = json.dumps(record, ensure_ascii=False)
    print(f"[cutclaw] {line}", flush=True)
    if progress_file is None:
        return
    try:
        with open(progress_file, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        # Don't let a broken pipe kill the pipeline — Node re-reads the file.
        pass


# ─── Caption generation fallback ────────────────────────────────────────────
def ensure_captions(source_video: Path, srt_out: Path, progress_file: Path | None) -> Path | None:
    """If no SRT is supplied, try faster-whisper. On failure return None and
    let CutClaw's own ASR (pywhispercpp) take over via local_run.py."""
    if srt_out.exists():
        return srt_out
    try:
        from faster_whisper import WhisperModel  # type: ignore
    except ImportError:
        emit(progress_file, "asr", "faster-whisper unavailable, falling back to CutClaw ASR")
        return None

    emit(progress_file, "asr", f"transcribing {source_video.name} with faster-whisper")
    # Small model keeps it tractable on CPU; swap to medium/large if GPU.
    model_size = os.environ.get("VSHORT_WHISPER_MODEL", "base")
    device = "cuda" if _cuda_available() else "cpu"
    compute_type = "float16" if device == "cuda" else "int8"
    try:
        model = WhisperModel(model_size, device=device, compute_type=compute_type)
        segments, _info = model.transcribe(str(source_video), vad_filter=True)
        srt_out.parent.mkdir(parents=True, exist_ok=True)
        with open(srt_out, "w", encoding="utf-8") as f:
            for i, seg in enumerate(segments, start=1):
                f.write(f"{i}\n{_srt_ts(seg.start)} --> {_srt_ts(seg.end)}\n{seg.text.strip()}\n\n")
        return srt_out
    except Exception as exc:  # best-effort
        emit(progress_file, "asr", f"faster-whisper failed: {exc!s} — CutClaw ASR will run")
        return None


def _cuda_available() -> bool:
    try:
        import torch  # type: ignore
        return torch.cuda.is_available()
    except Exception:
        return False


def _srt_ts(seconds: float) -> str:
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


# ─── Config → CutClaw CLI mapping ──────────────────────────────────────────
# VSHORT's editJobs config currently carries:
#   enhance:     {autocut, color, zoom, stabilize, denoise}  (all bool)
#   captionStyle: impact | glow | minimal | viral
#   music:       preset id (string, e.g. "upbeat-1")
#   exportFormat: tiktok | youtube | landscape | square
# CutClaw doesn't consume all of these, but exportFormat maps cleanly to
# --crop-ratio on render_video.py, and captionStyle picks fonts/colors.

CROP_RATIO = {
    "tiktok":   "9:16",
    "youtube":  "9:16",   # YouTube Shorts = portrait
    "landscape": "16:9",
    "square":   "1:1",
}

CAPTION_STYLE = {
    "impact":  {"font-color": "white",  "bg-color": "black@0.55"},
    "glow":    {"font-color": "yellow", "bg-color": "black@0.35"},
    "minimal": {"font-color": "white",  "bg-color": "black@0.0"},
    "viral":   {"font-color": "white",  "bg-color": "red@0.4"},
}

MUSIC_PRESETS_DIR = HERE.parent / "assets" / "music"


def resolve_music(preset_id: str | None) -> Path | None:
    if not preset_id:
        return None
    # Accept either "upbeat-1" or "upbeat-1.mp3"
    name = preset_id if preset_id.endswith((".mp3", ".m4a", ".wav")) else f"{preset_id}.mp3"
    candidate = MUSIC_PRESETS_DIR / name
    return candidate if candidate.exists() else None


# ─── Subprocess helpers ────────────────────────────────────────────────────
def run_stream(cmd: list[str], cwd: Path, stage: str, progress_file: Path | None) -> int:
    """Run a subprocess, forwarding stdout lines to progress emissions."""
    emit(progress_file, stage, f"starting: {' '.join(cmd[:3])}...")
    proc = subprocess.Popen(
        cmd,
        cwd=str(cwd),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=os.environ.copy(),
    )
    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.rstrip()
        if not line:
            continue
        print(f"[{stage}] {line}", flush=True)
        # Heuristic: surface a human-friendly progress message when CutClaw
        # prints one of its stage-header lines.
        lowered = line.lower()
        if any(tag in lowered for tag in ("✅", "✨", "screenwriter", "editor", "render", "extract", "scene")):
            emit(progress_file, stage, line[:120])
    proc.wait()
    return proc.returncode


# ─── Main ──────────────────────────────────────────────────────────────────
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", required=True, help="Path to concatenated source mp4")
    ap.add_argument("--output", required=True, help="Final rendered mp4 path")
    ap.add_argument("--music", default="", help="Music preset id (filename under server/assets/music)")
    ap.add_argument("--subtitles", default="auto", help="Path to SRT file, or 'auto' to transcribe")
    ap.add_argument("--config", default="{}", help="JSON string with edit_jobs config (enhance/captionStyle/exportFormat/…)")
    ap.add_argument("--progress-file", default=None, help="NDJSON progress sink tailed by the Node supervisor")
    ap.add_argument("--instruction", default="Create a dynamic montage that matches the music's energy.", help="Directive passed to CutClaw's Screenwriter")
    ap.add_argument("--type", default="vlog", choices=["film", "vlog"], help="CutClaw pipeline variant")
    args = ap.parse_args()

    source = Path(args.source).resolve()
    output = Path(args.output).resolve()
    progress_file = Path(args.progress_file).resolve() if args.progress_file else None
    output.parent.mkdir(parents=True, exist_ok=True)

    try:
        cfg = json.loads(args.config) if args.config else {}
    except json.JSONDecodeError as exc:
        emit(progress_file, "error", f"invalid --config JSON: {exc}")
        return 2
    if not isinstance(cfg, dict):
        cfg = {}

    # ─── Preflight ────────────────────────────────────────────────────────
    if not source.exists():
        emit(progress_file, "error", f"source video not found: {source}")
        return 2
    if not CUTCLAW_DIR.exists():
        emit(progress_file, "error", f"CutClaw is not vendored at {CUTCLAW_DIR}")
        return 2
    if shutil.which("ffmpeg") is None:
        emit(progress_file, "error", "ffmpeg not found on PATH")
        return 2

    workspace = job_workspace(output)
    workspace.mkdir(parents=True, exist_ok=True)

    # ─── 1. Captions ──────────────────────────────────────────────────────
    srt_path: Path | None = None
    if args.subtitles and args.subtitles != "auto":
        srt_path = Path(args.subtitles).resolve()
        if not srt_path.exists():
            emit(progress_file, "asr", f"supplied SRT missing, falling back: {srt_path}")
            srt_path = None
    if srt_path is None:
        srt_path = ensure_captions(source, workspace / "source.srt", progress_file)

    # ─── 2. Music resolution ──────────────────────────────────────────────
    music_path = resolve_music(args.music)
    if args.music and music_path is None:
        emit(progress_file, "planning", f"music preset '{args.music}' not found — proceeding without bgm")

    # CutClaw *requires* an audio file. If no preset, fall back to the
    # source video's own audio track (extracted with ffmpeg below).
    if music_path is None:
        fallback_audio = workspace / "source_audio.mp3"
        if not fallback_audio.exists():
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(source), "-vn", "-acodec", "libmp3lame",
                 "-q:a", "4", str(fallback_audio)],
                check=True, capture_output=True,
            )
        music_path = fallback_audio

    # ─── 3. Planning + editing (local_run.py) ─────────────────────────────
    # Point VIDEO_DATABASE_FOLDER at our per-job workspace so artifacts are
    # isolated. Passed via --config.VIDEO_DATABASE_FOLDER.
    plan_cmd = [
        sys.executable, "local_run.py",
        "--Video_Path", str(source),
        "--Audio_Path", str(music_path),
        "--Instruction", args.instruction,
        "--type", args.type,
        "--config.VIDEO_DATABASE_FOLDER", str(workspace),
    ]
    if srt_path is not None:
        plan_cmd += ["--SRT_Path", str(srt_path)]

    emit(progress_file, "planning", "running CutClaw planner…")
    rc = run_stream(plan_cmd, cwd=CUTCLAW_DIR, stage="planning", progress_file=progress_file)
    if rc != 0:
        emit(progress_file, "error", f"CutClaw planner exited with code {rc}")
        return rc

    # Locate shot_point.json in the workspace. local_run.py writes it under
    # Output/<video_id>_<audio_id>/shot_point_<slug>.json
    output_dir = workspace / "Output"
    shot_points = sorted(output_dir.rglob("shot_point_*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
    shot_plans  = sorted(output_dir.rglob("shot_plan_*.json"),  key=lambda p: p.stat().st_mtime, reverse=True)
    if not shot_points:
        emit(progress_file, "error", "planner succeeded but no shot_point JSON was produced")
        return 3

    # ─── 4. Render (render/render_video.py) ───────────────────────────────
    cap_style = CAPTION_STYLE.get(cfg.get("captionStyle"), CAPTION_STYLE["minimal"])
    crop = CROP_RATIO.get(cfg.get("exportFormat"))

    render_cmd = [
        sys.executable, "render/render_video.py",
        "--shot-json", str(shot_points[0]),
        "--video",     str(source),
        "--audio",     str(music_path),
        "--output",    str(output),
        "--font-color", cap_style["font-color"],
        "--bg-color",   cap_style["bg-color"],
    ]
    if shot_plans:
        render_cmd += ["--shot-plan", str(shot_plans[0])]
    if crop:
        render_cmd += ["--crop-ratio", crop]

    emit(progress_file, "rendering", "running CutClaw renderer…")
    rc = run_stream(render_cmd, cwd=CUTCLAW_DIR, stage="rendering", progress_file=progress_file)
    if rc != 0:
        emit(progress_file, "error", f"renderer exited with code {rc}")
        return rc

    if not output.exists():
        emit(progress_file, "error", "renderer exit 0 but output file missing")
        return 4

    emit(progress_file, "done", f"output ready: {output}", pct=100)
    return 0


if __name__ == "__main__":
    sys.exit(main())
