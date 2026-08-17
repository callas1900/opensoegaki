#!/usr/bin/env bash
# Build the Windows release bundle from WSL via PowerShell interop.
# The Tauri app cannot be compiled inside WSL; the Windows toolchain
# (rustup MSVC + VS Build Tools + pnpm) does the work.
set -euo pipefail

# Derive the Windows-side path of this checkout instead of hardcoding it, so a
# renamed or relocated clone keeps working.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_REPO_ROOT="$(wslpath -w "$REPO_ROOT")"

powershell.exe -NoProfile -Command "
  \$env:PATH = \"\$env:USERPROFILE\\.cargo\\bin;\$env:PATH\"
  Set-Location '$WIN_REPO_ROOT'
  pnpm tauri build
  exit \$LASTEXITCODE
"
