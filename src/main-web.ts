/**
 * Web entry point: wires the shared editor bootstrap against the web
 * `PlatformIO`, registers the offline service worker, shows the one-time
 * iOS "Add to Home Screen" hint, and fills in the welcome screen's version
 * line.
 */
import { createWebIO } from "./platform/web";
import { bootstrapEditor } from "./app";

bootstrapEditor(createWebIO());

// ---- version footer (TASK-35.13) --------------------------------------------

const versionEl = document.querySelector<HTMLElement>("#app-version");
if (versionEl) versionEl.textContent = `v${__APP_VERSION__}`;

// ---- service worker (TASK-35.9) ---------------------------------------------

// Only in production builds: the dev server's constantly-changing modules
// would otherwise fight a cached app shell. import.meta.env.PROD is false
// under `vite`/`vite dev` served straight from source and true for the
// built `dist-web` output (what `pnpm preview:web` actually serves).
if ("serviceWorker" in navigator && import.meta.env.PROD) {
  // BASE_URL always reflects vite.config.web.ts's `base` (e.g.
  // "/opensoegaki/") and always ends in "/", so the registration's default
  // scope is the deployed base path, not the origin root. The `?v=` query
  // makes the SW's own URL byte-different every release, which is what
  // makes the browser notice the update and re-run "install".
  const swUrl = `${import.meta.env.BASE_URL}sw.js?v=${__APP_VERSION__}`;
  void navigator.serviceWorker.register(swUrl);
}

// ---- iOS "Add to Home Screen" hint (TASK-35.8) ------------------------------

/** Non-standard iOS Safari flag: true once launched from the home screen. */
interface IOSNavigator extends Navigator {
  standalone?: boolean;
}

const INSTALL_HINT_DISMISSED_KEY = "soegaki-install-hint-dismissed";

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as IOSNavigator).standalone === true
  );
}

function isIOSSafari(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone();
}

function maybeShowInstallHint(): void {
  const hint = document.querySelector<HTMLElement>("#install-hint");
  if (!hint) return;
  if (!isIOSSafari()) return;
  if (isStandalone()) return;
  // localStorage can throw (e.g. Safari private browsing with storage
  // fully blocked) rather than just being empty; treat that the same as
  // "not previously dismissed" instead of letting it crash bootstrap.
  try {
    if (localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)) return;
  } catch {
    // ignore: fall through and show the hint
  }

  hint.hidden = false;
  document.querySelector<HTMLButtonElement>("#install-hint-dismiss")?.addEventListener("click", () => {
    hint.hidden = true;
    try {
      localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, "1");
    } catch {
      // Best-effort only: if storage is blocked, the hint just reappears
      // next launch — acceptable, not worth surfacing an error for.
    }
  });
}

maybeShowInstallHint();
