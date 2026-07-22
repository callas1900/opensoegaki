/**
 * Web entry point: wires the shared editor bootstrap against the web
 * `PlatformIO`, registers the offline service worker, shows the one-time
 * iOS "Add to Home Screen" hint, and fills in the welcome screen's version
 * line.
 */
import { createWebIO } from "./platform/web";
import { bootstrapEditor } from "./app";

bootstrapEditor(createWebIO());

// ---- canvas-fit routine (round 9: tall-photo overflow bug) ------------------

/**
 * Set #canvas's max size in PIXELS rather than relying solely on the
 * stylesheet's `max-width/height: 100%`. On a real iPhone, a tall photo's
 * canvas was overflowing #stage's bottom edge, putting its lower crop
 * corners unreachably under the share bar. Reproduced in Playwright WebKit
 * 26, the percentage version renders correctly — so this is a
 * version-specific engine bug, not a layout mistake: older iOS Safari
 * resolves a replaced element's percentage `max-height` unreliably inside
 * #stage's auto-sized `display: grid` track. Pixel maxes sidestep
 * percentage resolution entirely and are unambiguous on every engine.
 *
 * The stylesheet's `max-width/height: 100%` stays as a pre-JS fallback
 * (e.g. the brief window before this first runs); an inline style on the
 * same properties wins once it does, per normal CSS cascade rules (same
 * property, inline beats stylesheet).
 *
 * No recompute-on-image-load hook is needed: these are #stage's own box
 * dimensions, not anything derived from the loaded bitmap's size, so
 * loadImage/loadImageBlob/applyCrop etc. can't invalidate this — only
 * #stage's own box changing (viewport resize, rotation, keyboard) can, and
 * those are all covered by the listeners below.
 */
function fitCanvasToStage(): void {
  const stage = document.querySelector<HTMLElement>("#stage");
  const canvas = document.querySelector<HTMLCanvasElement>("#canvas");
  if (!stage || !canvas) return;

  // clientWidth/Height already exclude any scrollbar #stage's own
  // `overflow: auto` might otherwise reserve space for, unlike
  // getBoundingClientRect(); box-sizing is border-box globally and #stage
  // has no border, so subtracting the read (never hardcoded) padding here
  // is exactly the content box.
  const style = window.getComputedStyle(stage);
  const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const width = stage.clientWidth - paddingX;
  const height = stage.clientHeight - paddingY;
  if (width <= 0 || height <= 0) return;

  canvas.style.maxWidth = `${width}px`;
  canvas.style.maxHeight = `${height}px`;
}

fitCanvasToStage();
// First-paint safety: fonts/layout may still be settling on the very first
// frame, so run once more once the browser has actually painted.
requestAnimationFrame(fitCanvasToStage);
window.addEventListener("resize", fitCanvasToStage);
window.addEventListener("orientationchange", fitCanvasToStage);
window.visualViewport?.addEventListener("resize", fitCanvasToStage);

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
