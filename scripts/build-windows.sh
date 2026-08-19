#!/usr/bin/env bash
# Build the Windows release bundle from WSL via PowerShell interop.
# The Tauri app cannot be compiled inside WSL; the Windows toolchain
# (rustup MSVC + VS Build Tools + pnpm) does the work.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/windows.sh"

# Resolve the interpreter first: when the Windows side is unreachable at all,
# resolve_powershell's diagnostic is far more useful than wslpath failing.
PS="$(resolve_powershell)"
WIN_REPO_ROOT="$(win_repo_root)"

"$PS" -NoProfile -Command "
  \$env:PATH = \"\$env:USERPROFILE\\.cargo\\bin;\$env:PATH\"
  Set-Location '$WIN_REPO_ROOT'
  pnpm tauri build
  exit \$LASTEXITCODE
"
