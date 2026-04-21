# Bootstrap the Python venv that powers the VSHORT ↔ CutClaw pipeline.
# Run from the repo root:  pwsh server/python/setup.ps1
#
# Requirements on the host machine (not handled by this script):
#   - Python 3.12 on PATH (`py -3.12 --version` works)
#   - ffmpeg on PATH (`ffmpeg -version` works)
#   - Optional: CUDA toolkit for GPU-accelerated decord / torch

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$venvDir   = Join-Path $scriptDir '.venv'
$reqFile   = Join-Path $scriptDir 'requirements.txt'

Write-Host "[cutclaw-setup] venv target: $venvDir"

if (-not (Test-Path $venvDir)) {
    Write-Host '[cutclaw-setup] creating venv with Python 3.12...'
    & py -3.12 -m venv $venvDir
}

$python = Join-Path $venvDir 'Scripts\python.exe'
if (-not (Test-Path $python)) {
    throw "Python not found at $python — venv creation failed."
}

Write-Host '[cutclaw-setup] upgrading pip...'
& $python -m pip install --upgrade pip wheel setuptools

# madmom's setup.py imports Cython + numpy during build, so both must be
# available BEFORE pip tries to resolve the main requirements file.
Write-Host '[cutclaw-setup] pre-installing Cython + numpy (madmom build deps)...'
& $python -m pip install --upgrade Cython numpy

Write-Host '[cutclaw-setup] installing requirements (this may take a while)...'
& $python -m pip install -r $reqFile

# madmom's setup.py imports Cython before pip can resolve build deps, and pip's
# build isolation hides the venv's Cython from the build env. Installing
# with --no-build-isolation lets it use the Cython we already put in the venv.
Write-Host '[cutclaw-setup] installing madmom with --no-build-isolation...'
& $python -m pip install --no-build-isolation madmom

# Probe for CUDA. If nvidia-smi is present, try the CUDA Decord wheel.
$hasCuda = $false
try { & nvidia-smi -L | Out-Null; if ($LASTEXITCODE -eq 0) { $hasCuda = $true } } catch {}

if ($hasCuda) {
    Write-Host '[cutclaw-setup] CUDA detected — attempting decord-gpu install (best-effort)...'
    & $python -m pip install --upgrade 'decord-gpu' 2>&1 | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Warning '[cutclaw-setup] decord-gpu install failed — CPU decord will be used.'
    }
} else {
    Write-Host '[cutclaw-setup] No CUDA detected — CPU decord will be used.'
}

Write-Host ''
Write-Host '[cutclaw-setup] Done.'
Write-Host "  Python: $python"
Write-Host "  Set PYTHON in .env if this path is not auto-detected by the server."
