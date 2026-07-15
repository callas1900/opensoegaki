#!/usr/bin/env bash
# Run the app in dev mode from WSL via PowerShell interop.
# Same constraints as build-windows.sh: the Tauri app cannot be compiled
# inside WSL, and cargo is not on the default Windows PATH.
set -euo pipefail

powershell.exe -NoProfile -Command '
  $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
  Set-Location C:\Users\calla\Documents\opensoegaki
  pnpm tauri dev
  exit $LASTEXITCODE
'
