# shellcheck shell=bash
# Shared helpers for scripts/dev-windows.sh, scripts/build-windows.sh and
# scripts/preview-iphone.sh.
# This file is meant to be sourced, not executed directly; it intentionally
# does not set any shell options (set -e/-u/-o pipefail) of its own so it
# does not surprise whatever script sources it. The callers set those.

# Print the path of a usable PowerShell executable to stdout.
#
# Tries, in order: pwsh.exe (PowerShell 7) and powershell.exe (Windows
# PowerShell 5.1) via $PATH, then falls back to resolving the well-known
# Windows PowerShell install location through `wslpath` -- this works even
# when the Windows directories are missing from $PATH entirely, which
# happens when the shell was not started by wsl.exe (e.g. an ssh login, or
# a long-lived tmux/screen server started from such a session). `wslpath`
# is a native Linux binary always present in WSL, so it is used here
# instead of hardcoding /mnt/c, which honours a non-default mount root.
#
# Preferring pwsh.exe over powershell.exe is deliberate, but note that it
# changes the host: every verification of the Windows build so far
# (TASK-3, TASK-51) ran under Windows PowerShell 5.1, and 7 differs from
# 5.1 in -Command exit-code propagation and console encoding. On a machine
# with PowerShell 7 installed, re-verify the build before trusting it.
resolve_powershell() {
  local ps=""

  if ps="$(command -v pwsh.exe 2>/dev/null)" && [ -n "$ps" ]; then
    printf '%s\n' "$ps"
    return 0
  fi

  if ps="$(command -v powershell.exe 2>/dev/null)" && [ -n "$ps" ]; then
    printf '%s\n' "$ps"
    return 0
  fi

  if ps="$(wslpath -u 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' 2>/dev/null)" && [ -x "$ps" ]; then
    printf '%s\n' "$ps"
    return 0
  fi

  # Nothing worked -- diagnose why, but only here, so the happy path stays fast.
  # Newer systemd-enabled WSL registers the handler as WSLInterop-late, so
  # check both names before claiming interop is missing.
  local interop_note interop_reg="" f
  for f in /proc/sys/fs/binfmt_misc/WSLInterop /proc/sys/fs/binfmt_misc/WSLInterop-late; do
    if [ -r "$f" ]; then
      interop_reg="$f"
      break
    fi
  done

  if [ -n "$interop_reg" ]; then
    if grep -q '^enabled$' "$interop_reg" 2>/dev/null; then
      interop_note="WSL interop looks enabled ($interop_reg), so this is not a binfmt problem"
    else
      interop_note="WSL interop is registered but not enabled (see $interop_reg)"
    fi
  else
    interop_note="WSL interop is not registered at all (no WSLInterop or WSLInterop-late under /proc/sys/fs/binfmt_misc), so Windows binaries cannot run from this shell"
  fi

  {
    echo "error: could not find pwsh.exe or powershell.exe."
    echo "The Windows directories are most likely missing from \$PATH -- this"
    echo "typically happens when the shell was not started by wsl.exe (e.g. an"
    echo "ssh login, or a long-lived tmux/screen server started from such a"
    echo "session), so WSL never injected the Windows PATH entries."
    echo "Checked: $interop_note."
    echo "Also check 'appendWindowsPath' under [interop] in /etc/wsl.conf --"
    echo "if it is explicitly set to false, WSL will not add Windows paths to"
    echo "\$PATH by design, regardless of interop or how the shell started."
  } >&2

  return 1
}

# Print the Windows-side path (C:\...) of this repo checkout.
#
# Derived from the library's own location instead of hardcoded, so a
# renamed or relocated clone keeps working. This file lives at
# scripts/lib/windows.sh, so the repo root is two levels up.
win_repo_root() {
  local repo_root
  repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  wslpath -w "$repo_root"
}
