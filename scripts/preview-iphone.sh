#!/usr/bin/env bash
# Serve the web (PWA) build on the LAN so a real iPhone on the same Wi-Fi can
# open it, and print the one URL to type on the phone.
#
# Why this exists rather than just `pnpm build:web && pnpm preview:web --host`
# (what docs/WEB.md tells you to run):
#
#   1. That command cannot run in this WSL distro. `node_modules` was installed
#      from Windows, so the only rolldown native binding present is
#      `@rolldown/binding-win32-x64-msvc` -- there is no linux-x64 one -- and
#      WSL's node is 22.6.0, below vite 8's `>=22.12.0` floor. (Same reason
#      build-windows.sh and dev-windows.sh exist. Nothing about WSL is
#      fundamentally incapable here; the checkout is simply provisioned for
#      Windows.) So the build and the server run on the Windows side over
#      PowerShell interop.
#   2. Even with a working toolchain, WSL2 sits behind its own NAT, so a server
#      bound inside WSL is unreachable from the phone without a Windows
#      portproxy rule. Binding on the Windows side puts it on the LAN
#      interface the phone can actually see.
#   3. `--host` makes vite advertise every interface it finds, including the
#      WSL and Hyper-V virtual adapters -- exactly the addresses that silently
#      fail from a phone, with nothing in the output to tell them apart. This
#      script prints the address the route table would actually use.
#
# On a non-WSL host (macOS, native Linux) none of that applies and the vite
# commands are run directly.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/windows.sh"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

MODE="preview"   # "preview" = build once and serve dist-web; "dev" = HMR dev server
# Deliberately NOT 4173: that is playwright.config.ts's webServer port, and its
# `reuseExistingServer: !process.env.CI` means a preview left running on 4173
# would be silently reused by `pnpm test:e2e` -- so the suite CLAUDE.md requires
# before UI sign-off would run against whatever this script is serving (source
# with HMR under --dev) instead of the built dist-web it is supposed to check.
PORT="4174"
DO_BUILD=1

die() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: scripts/preview-iphone.sh [options]

Serve the web (PWA) build on the LAN for a real-device check on an iPhone.

Options:
  --dev            Serve the vite dev server (HMR) from source instead of
                   building. Fastest loop while iterating on UI, but it serves
                   the checkout read-only to the whole network over vite's
                   /@fs/ route -- use it on a trusted network only. No service
                   worker either (registration is PROD-gated in main-web.ts).
  --no-build       Serve the existing dist-web/ as-is. Fast, but silently
                   serves stale code after an edit -- the trap docs/WEB.md
                   warns about. Ignored with --dev.
  --port <n>       Port to bind (default: 4174; 4173 is deliberately avoided,
                   see the comment on PORT in this script).
  -h, --help       Show this help.

Environment:
  PAGES_BASE       Overrides the base path baked into the build and served by
                   the preview (default: /opensoegaki/). PAGES_BASE=/ makes the
                   URL short enough to type comfortably on a phone; it is
                   forwarded across the WSL/Windows boundary for you.

If a previous run's server is stuck holding the port, --strictPort will say so;
from WSL, free it with:
  powershell.exe -NoProfile -Command "Get-NetTCPConnection -LocalPort 4174 -State Listen | %{ Stop-Process -Id \$_.OwningProcess -Force }"
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dev) MODE="dev"; shift ;;
    --no-build) DO_BUILD=0; shift ;;
    --port)
      [ $# -ge 2 ] || die "--port needs a value"
      PORT="$2"; shift 2 ;;
    --port=*) PORT="${1#*=}"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "error: unknown option: $1" >&2; usage >&2; exit 1 ;;
  esac
done

case "$PORT" in
  ''|*[!0-9]*) die "--port must be a number, got: $PORT" ;;
esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || die "--port must be 1-65535, got: $PORT"

# Must match vite.config.web.ts's `base: process.env.PAGES_BASE ?? "/opensoegaki/"`.
# `${PAGES_BASE-...}` (not `:-`) on purpose: `??` is nullish-only, so vite treats
# a set-but-empty PAGES_BASE as a real value while `:-` would silently default
# it here -- the printed URL would then disagree with the build, which is the
# one failure mode this whole script exists to prevent.
BASE="${PAGES_BASE-/opensoegaki/}"
case "$BASE" in
  /*) ;;
  *) die "PAGES_BASE must start with '/', got: '$BASE'" ;;
esac
# The URL needs the trailing slash; vite normalizes the base the same way.
case "$BASE" in
  */) ;;
  *) BASE="$BASE/" ;;
esac

# Detect WSL rather than "is Windows reachable": on a Mac or native Linux we
# want the direct path even though resolve_powershell would also fail there.
IS_WSL=0
if [ -n "${WSL_DISTRO_NAME:-}" ] || grep -qi microsoft /proc/version 2>/dev/null; then
  IS_WSL=1
fi

PS=""
WIN_REPO_ROOT=""
if [ "$IS_WSL" -eq 1 ]; then
  # Resolve the interpreter first: when the Windows side is unreachable at all,
  # resolve_powershell's diagnostic is far more useful than wslpath failing.
  PS="$(resolve_powershell)"
  WIN_REPO_ROOT="$(win_repo_root)"
fi

# Quote a value as a PowerShell single-quoted string literal (doubling any
# embedded apostrophe). Without this, a checkout under a path like
# C:\Users\O'Brien\repo is a PowerShell parse error.
ps_quote() {
  printf "'%s'" "${1//\'/\'\'}"
}

# Run a PowerShell snippet in the repo root on the Windows side.
#
# Two details are load-bearing:
#
#   - PAGES_BASE is forwarded explicitly. WSL only exports variables listed in
#     WSLENV, so an inherited PAGES_BASE would be silently dropped and the
#     build would use a different base than the URL this script prints.
#   - `if ($null -eq $LASTEXITCODE) { exit 1 }`. $LASTEXITCODE is set only by
#     NATIVE commands, so a PowerShell-level failure (pnpm not on the Windows
#     PATH, i.e. exactly the misconfiguration resolve_powershell's diagnostic
#     is about) leaves it $null, and a bare `exit $LASTEXITCODE` then exits 0 --
#     `set -e` would not fire, and the script would cheerfully print a URL for
#     a server that never started. `$ErrorActionPreference = 'Stop'` is
#     deliberately NOT used instead: under Windows PowerShell 5.1 it can turn a
#     native command's ordinary stderr output into a terminating error, which
#     would abort perfectly healthy builds.
run_windows() {
  local snippet="$1"
  local forward=""
  if [ -n "${PAGES_BASE+x}" ]; then
    forward="\$env:PAGES_BASE = $(ps_quote "$BASE")"
  fi
  "$PS" -NoProfile -Command "
    Set-Location -LiteralPath $(ps_quote "$WIN_REPO_ROOT") -ErrorAction Stop
    $forward
    $snippet
    if (\$null -eq \$LASTEXITCODE) { exit 1 }
    exit \$LASTEXITCODE
  "
}

# Candidate LAN IPv4 addresses, best first, one per line.
#
# The Windows branch is deliberately not "list every IPv4 address": two classes
# of address look perfect and silently fail from the phone.
#
#   1. The virtual adapters WSL and Hyper-V create (172.x on
#      "vEthernet (WSL ...)"). These are what vite's own `--host` output
#      advertises alongside the real one, with nothing to tell them apart.
#   2. A **disconnected** adapter that kept its old DHCP lease. Observed on the
#      development machine: `Get-NetIPAddress` reports a plausible
#      192.168.50.x on the Wi-Fi adapter whose `Get-NetAdapter` Status is
#      `Disconnected`, while the machine is actually on Ethernet. Filtering by
#      adapter name, or by "prefer Wi-Fi, the phone is on Wi-Fi", picks exactly
#      that dead address. Adapter Status is the only reliable discriminator --
#      do not reintroduce a wireless preference here.
#
# So: keep addresses whose adapter is Up and is not virtual, then put the route
# table's own preferred source address for an off-link destination first --
# `Find-NetRoute` is a routing lookup, it sends no packets. The remaining
# addresses are still printed, since a machine can legitimately sit on two LANs
# and only the human knows which one the phone is on.
lan_ipv4_addresses() {
  if [ "$IS_WSL" -eq 1 ]; then
    "$PS" -NoProfile -Command '
      $good = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" } |
        Where-Object { $_.InterfaceAlias -notmatch "WSL|Hyper-V|vEthernet|Loopback|Bluetooth" } |
        Where-Object { (Get-NetAdapter -InterfaceIndex $_.InterfaceIndex -ErrorAction SilentlyContinue).Status -eq "Up" } |
        Select-Object -ExpandProperty IPAddress
      $preferred = (Find-NetRoute -RemoteIPAddress 1.1.1.1 -ErrorAction SilentlyContinue | Select-Object -First 1).IPAddress
      if ($preferred -and ($good -contains $preferred)) {
        $preferred
        $good | Where-Object { $_ -ne $preferred }
      } else {
        $good
      }
    ' 2>/dev/null | tr -d '\r' | grep -E '^[0-9]+(\.[0-9]+){3}$' || true
  elif [ "$(uname -s)" = "Darwin" ]; then
    # en0 is Wi-Fi on every current Mac; en1 covers the Ethernet-dongle case.
    # A disabled interface prints nothing, so this self-filters.
    local iface
    for iface in en0 en1; do
      ipconfig getifaddr "$iface" 2>/dev/null || true
    done
  else
    hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$' | grep -v '^127\.' || true
  fi
}

print_banner() {
  local addresses addr label
  addresses="$(lan_ipv4_addresses)"
  if [ "$MODE" = "dev" ]; then
    label="vite dev server (HMR, source)"
  else
    label="production build (dist-web)"
  fi

  printf '\n  iPhone preview -- %s\n\n' "$label"
  printf '  Open this on the phone (same Wi-Fi as this machine):\n\n'
  if [ -n "$addresses" ]; then
    # printf per address rather than sed: the base is interpolated, and sed
    # would eat an `&` and choke on a `|` in it.
    while IFS= read -r addr; do
      [ -n "$addr" ] || continue
      printf '    http://%s:%s%s\n' "$addr" "$PORT" "$BASE"
    done <<ADDRESSES
$addresses
ADDRESSES
  else
    # Not fatal: vite prints its own Network lines a moment later, and the
    # address is only needed by the human reading this.
    printf '    (could not detect a LAN address -- use the Network URL vite prints below)\n'
  fi

  cat <<'BANNER'

  A LAN IP over plain HTTP is not a secure context in Safari, so on this URL:
    - the service worker does NOT register, so there is no offline shell.
      "Add to Home Screen" still works and still launches standalone without
      Safari chrome -- the app it launches simply has no cache.
    - Save/Share falls back to a plain file download (web.ts gates on
      navigator.canShare, which is undefined here), and the Copy button is
      absent rather than broken (it is capability-gated on ClipboardItem).
  Everything else -- layout, touch gestures, crop/rotate, annotations, undo --
  works. Of docs/WEB.md's iOS checklist, steps 8, 9 and 11 need the deployed
  Pages URL; the rest are exercisable here.

  Windows Firewall may prompt on the first run: allow Node on private
  networks, or the phone cannot connect at all.

  Ctrl+C to stop.

BANNER
}

if [ "$MODE" = "dev" ]; then
  SERVE_ARGV=(pnpm exec vite --config vite.config.web.ts --host 0.0.0.0 --port "$PORT" --strictPort)
else
  # Same `--` argument passing playwright.config.ts's webServer uses.
  SERVE_ARGV=(pnpm preview:web -- --host 0.0.0.0 --port "$PORT" --strictPort)

  if [ "$DO_BUILD" -eq 0 ]; then
    # dist-web/ has the base BAKED INTO its asset URLs, so serving an existing
    # build under a different base yields a white screen with no explanation
    # (every asset 404s). This is reachable by combining the two documented
    # conveniences: PAGES_BASE=/ (typable URL) with --no-build (speed).
    index="$REPO_ROOT/dist-web/index.html"
    [ -f "$index" ] || die "dist-web/ has not been built yet -- drop --no-build"
    grep -q "=\"${BASE}assets/" "$index" \
      || die "dist-web/ was built for a different base than '$BASE' -- drop --no-build so it is rebuilt"
  fi
fi

# The Windows side needs one command line rather than an argv. Every element
# above is a literal flag, path or number -- no spaces, no quoting-sensitive
# characters -- so joining on spaces is faithful here, and the argv form stays
# the source of truth for the local branch below.
SERVE_CMD="${SERVE_ARGV[*]}"

if [ "$IS_WSL" -eq 1 ]; then
  if [ "$MODE" = "preview" ] && [ "$DO_BUILD" -eq 1 ]; then
    run_windows "pnpm build:web"
  fi
  print_banner
  run_windows "$SERVE_CMD"
else
  cd "$REPO_ROOT"
  if [ "$MODE" = "preview" ] && [ "$DO_BUILD" -eq 1 ]; then
    pnpm build:web
  fi
  print_banner
  "${SERVE_ARGV[@]}"
fi
