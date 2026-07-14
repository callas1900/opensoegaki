#!/usr/bin/env bash
# Build the Windows release bundle from WSL via PowerShell interop.
# The Tauri app cannot be compiled inside WSL; the Windows toolchain
# (rustup MSVC + VS Build Tools + pnpm) does the work.
set -euo pipefail

powershell.exe -NoProfile -Command '
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  Set-Location C:\Users\calla\Documents\openscrawl
  pnpm tauri build
  exit $LASTEXITCODE
'
