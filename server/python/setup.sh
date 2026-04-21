#!/usr/bin/env bash
# Bootstrap the Python venv that powers the VSHORT ↔ CutClaw pipeline.
# Run from the repo root:  bash server/python/setup.sh
#
# Requirements on the host machine (not handled by this script):
#   - Python 3.12 on PATH
#   - ffmpeg on PATH
#   - Optional: CUDA for GPU-accelerated decord / torch

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
venv_dir="$script_dir/.venv"
req_file="$script_dir/requirements.txt"

echo "[cutclaw-setup] venv target: $venv_dir"

if [ ! -d "$venv_dir" ]; then
  echo "[cutclaw-setup] creating venv with Python 3.12..."
  python3.12 -m venv "$venv_dir"
fi

python="$venv_dir/bin/python"
[ -x "$python" ] || { echo "Python not found at $python — venv creation failed." >&2; exit 1; }

echo "[cutclaw-setup] upgrading pip..."
"$python" -m pip install --upgrade pip wheel setuptools

# madmom's setup.py imports Cython + numpy during build, so both must be
# available BEFORE pip tries to resolve the main requirements file.
echo "[cutclaw-setup] pre-installing Cython + numpy (madmom build deps)..."
"$python" -m pip install --upgrade Cython numpy

echo "[cutclaw-setup] installing requirements (this may take a while)..."
"$python" -m pip install -r "$req_file"

echo "[cutclaw-setup] installing madmom with --no-build-isolation..."
"$python" -m pip install --no-build-isolation madmom

if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  echo "[cutclaw-setup] CUDA detected — attempting decord-gpu install (best-effort)..."
  "$python" -m pip install --upgrade decord-gpu || \
    echo "[cutclaw-setup] decord-gpu install failed — CPU decord will be used."
else
  echo "[cutclaw-setup] No CUDA detected — CPU decord will be used."
fi

echo
echo "[cutclaw-setup] Done."
echo "  Python: $python"
echo "  Set PYTHON in .env if this path is not auto-detected by the server."
