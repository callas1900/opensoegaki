#!/usr/bin/env bash
# Run the app in dev mode from WSL via PowerShell interop.
# Same constraints as build-windows.sh: the Tauri app cannot be compiled
# inside WSL, and cargo is not on the default Windows PATH.
set -euo pipefail

# Derive the Windows-side path of this checkout instead of hardcoding it, so a
# renamed or relocated clone keeps working.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WIN_REPO_ROOT="$(wslpath -w "$REPO_ROOT")"

powershell.exe -NoProfile -Command "
  \$env:PATH = \"\$env:USERPROFILE\\.cargo\\bin;\$env:PATH\"
  Set-Location '$WIN_REPO_ROOT'
  pnpm tauri dev
  exit \$LASTEXITCODE
"
