/**
 * Web entry point: wires the shared editor bootstrap against the web
 * `PlatformIO`, registers the offline service worker, reveals the static
 * PWA install invitation on the welcome screen when the app is not already
 * installed, and fills in the welcome screen's version line.
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

// ---- PWA install invitation (TASK-43) ----------------------------------------

/** Non-standard iOS Safari flag: true once launched from the home screen. */
interface IOSNavigator extends Navigator {
  standalone?: boolean;
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    // `display-mode: standalone` alone is not enough: iOS Safari below 16.4
    // never matches that media query for a home-screen-launched PWA, so the
    // non-standard `navigator.standalone` flag is still required as a
    // second signal.
    (navigator as IOSNavigator).standalone === true
  );
}

// #welcome-install is static prose in pwa/index.html, present at first
// paint. Visibility is split across exactly two properties with exactly one
// owner each, so they cannot disagree with each other — they can only both
// subtract visibility: JS (here) owns the `hidden` attribute, the
// install-state gate, set once and never re-toggled — there is no dismiss
// action, nothing persisted. CSS (styles.css) separately owns `display`, a
// `@media (max-height: 500px)` viewport-height suppression for phone
// landscape, where the invitation would otherwise overflow #stage.
const installEl = document.querySelector<HTMLElement>("#welcome-install");
if (installEl && !isStandalone()) installEl.hidden = false;
