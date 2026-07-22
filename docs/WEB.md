# OpenSoegaki Web — iPhone-targeted PWA on GitHub Pages

Status: implemented (pending device verification). Backlog: TASK-35 (subtasks
35.1–35.14, all implemented — see the iOS manual smoke-test checklist below for
the real-device verification pass this still needs).

## Goal

Ship an iPhone-focused, installable PWA build of OpenSoegaki from the **same repository**,
reusing the existing `src/editor/` core unchanged, hosted on GitHub Pages. The web build
must be fully client-side (screenshots never leave the device), offline-capable, and must
not change or regress the Windows/macOS desktop (Tauri) build.

## Non-goals

- Full-screen OS capture in the browser (impossible in Safari — dropped, not faked).
- Desktop drag-out and native OS drag-drop on web (dropped).
- Web clipboard *read* parity (Ctrl+Shift+V insert is desktop-only).
- A general platform-abstraction framework — only the smallest seam that lets desktop
  and web share the editor wiring.
- Any server component. There is no backend, ever.

## Architecture

### Shared vs platform-specific map

| Layer | Files | Web | Desktop |
|---|---|---|---|
| Editor engine (annotation object model, canvas render + pointer interaction, undo/redo, crop, resize, hit-test, PNG export, import downscale) | `src/editor/*` (model, canvas, render, exporter, history, hittest, crop, resize, downscale) | shared, identical | shared, identical |
| UI helpers | `src/ui/popover.ts` | shared | shared |
| App wiring (toolbar, palette/size popovers, keyboard shortcuts, paste listener, share-bar routing) | `src/app.ts` (`bootstrapEditor`) | shared | shared |
| Stylesheet | `src/styles.css` | shared (platform-specific rules are no-ops on the other side) | shared |
| Platform contract | `src/platform/io.ts` (`PlatformIO` + `Capabilities`) | shared interface | shared interface |
| Platform I/O implementation | `src/platform/web.ts` / `src/platform/tauri.ts` | **web.ts**: file-input picker, Web Share, ClipboardItem copy | **tauri.ts**: OS capture, native dialogs, OS clipboard, drag-out, file drop |
| Entry point | `src/main-web.ts` / `src/main.ts` | **main-web.ts**: SW registration, install hint, version/privacy fill | **main.ts**: capture button, macOS permission modal |
| HTML shell | `pwa/index.html` / `index.html` | **pwa/index.html** (+ manifest, `sw.js`, icons in `pwa/public/`) | **index.html** |
| Build config / output | `vite.config.web.ts` → `dist-web/` | web only | `vite.config.ts` → `dist/` (Tauri `frontendDist`) |
| Native backend | `src-tauri/` (Rust: capture, tray, hotkeys, drag-out, clipboard) | — (zero inputs from `src-tauri/`) | desktop only |
| Deploy | `.github/workflows/pages.yml` → GitHub Pages | web only | release workflows |

Shared code is parameterized, never forked: the platform difference travels through
`PlatformIO` as data — `capabilities` flags (drive `data-cap` button hiding),
`maxImportDimension` (web 4096 / desktop `null` = unlimited),
`annotationScaleBaseline` (web 900 / desktop `null` = factor 1). `src/editor/*`
imports nothing from `src/platform/`.

### Code structure — one capability-typed IO seam, one shared bootstrap

All Tauri coupling lives in `src/main.ts`. It is inverted behind a single interface:

- `src/platform/io.ts` — the `PlatformIO` interface + `Capabilities` flags (contract below).
- `src/platform/tauri.ts` — `createTauriIO()`: all current `invoke(...)`,
  `writeImage`/`readImage`, `startDrag`, `onDragDropEvent`, and the macOS
  permission-settings call, moved **behavior-identical**.
- `src/platform/web.ts` — `createWebIO()`: file-input picker, Web Share / download,
  best-effort clipboard write.
- `src/app.ts` — `bootstrapEditor(io: PlatformIO)`: everything platform-neutral from
  today's `main.ts` (tool buttons, palette, size popover, undo/redo, editing keyboard
  shortcuts, the `paste` listener, inline text editing, copy/save/insert routed through `io`).
- `src/main.ts` — thin desktop entry: `bootstrapEditor(createTauriIO())` + the
  desktop-only capture button + permission modal.
- `src/main-web.ts` — thin web entry: `bootstrapEditor(createWebIO())` + service-worker
  registration + iOS install hint.

**Capability-gated UI:** capability-specific buttons in the shared HTML carry
`data-cap="<name>"`; `bootstrapEditor` hides any element whose capability is false.
There is exactly one toolbar wiring path — no duplication between entries.

### `PlatformIO` contract

```ts
export interface Capabilities {
  capture: boolean;            // OS full-screen capture (desktop only)
  pickImage: boolean;          // choose an image from disk/photos
  savePng: boolean;            // persist/share a PNG
  copyPng: boolean;            // put a PNG on the clipboard
  readClipboardImage: boolean; // read an image from the clipboard (Ctrl+Shift+V)
  dragOut: boolean;            // native drag-out of the rendered PNG (desktop only)
}

export interface PlatformIO {
  readonly capabilities: Capabilities;
  readonly maxImportDimension: number | null; // desktop: null (unlimited); web: MAX_IMPORT_DIMENSION
  readonly annotationScaleBaseline: number | null; // desktop: null (fixed sizes); web: ANNOTATION_SCALE_BASELINE
  captureBackground?(): Promise<Uint8Array>;          // desktop: capture_fullscreen
  pickImage(): Promise<Uint8Array | null>;            // desktop: pick_image; web: <input type=file>
  savePng(png: Uint8Array, defaultName: string): Promise<void>; // desktop: save_png; web: share/download
  copyPng(getPng: () => Promise<Uint8Array>): Promise<void>; // desktop: clipboard writeImage; web: ClipboardItem
  readClipboardImage?(): Promise<ImageBitmap | null>; // desktop only
  beginDragOut?(png: Uint8Array, name: string): Promise<void>;  // desktop only
  onExternalImageDrop?(handler: (bytes: Uint8Array) => void): void; // desktop only
  openCapturePermissionSettings?(): Promise<void>;    // macOS only
}
```

**Implementation note (TASK-35.2):** `onExternalImageDrop`'s handler dropped the
`insert: boolean` parameter from the original draft. The platform layer (`tauri.ts`)
only decodes the dropped file's bytes; it has no visibility into whether the editor
currently holds a background image, so the insert-vs-background decision must be
made by the caller (`bootstrapEditor` in `src/app.ts`), which already holds that
state via `editor.hasImage()`. The handler signature is therefore `(bytes: Uint8Array) => void`.

**Implementation note (architect ruling, round 3, Option A):** `copyPng` takes a
lazy `getPng: () => Promise<Uint8Array>` producer instead of pre-computed bytes.
The original signature let `bootstrapEditor` `await exportPng()` before calling
`io.copyPng`, which on Safari already burned the user-gesture window by the time
`navigator.clipboard.write()` ran inside `copyPng` — wrapping the already-resolved
bytes in `Promise.resolve()` at that point fixed nothing, since there was no
remaining async work left to defer. With the lazy producer, `copyToClipboard`
calls `io.copyPng(() => exportPng(editor.doc))` with no preceding `await`; the web
implementation calls `navigator.clipboard.write()` synchronously (still zero
awaits deep) with the export's `Promise<Blob>` as the pending `ClipboardItem`
value, so the gesture window is preserved end to end.

**Implementation note (user decision + architect ruling, round 6):** the import
clamp (TASK-35.14) is **web-only**. Desktop has no canvas size ceiling, so
`maxImportDimension` is `null` there, meaning exact pre-clamp full-resolution
behavior — `desktop's readClipboardImage`/`loadImage`/`loadImageBlob` decode
paths never redraw through an `OffscreenCanvas` at any size, at all. Web sets
`maxImportDimension: MAX_IMPORT_DIMENSION` (`src/editor/downscale.ts`). Both
`clampImportSize(w, h, max: number | null)` and
`decodeClampedBitmap(source, max: number | null)` take `max` as a required
(not defaulted) parameter specifically so every call site has to state its
platform's answer explicitly rather than silently inheriting a shared default;
`bootstrapEditor` sets `editor.maxImportDimension = io.maxImportDimension`
once, and `Editor.loadImage`/`loadImageBlob` plus `app.ts`'s `bytesToBitmap`
(used by the insert-as-annotation paths) all read that one value — still a
single decode code path, now parameterized instead of platform-forked.

No new Tauri commands; the desktop IPC surface is unchanged.

### Build — separate `vite.config.web.ts`

- `vite.config.ts` stays untouched (Tauri `frontendDist ../dist` intact).
- `vite.config.web.ts`: `root: "pwa"`, `build.outDir: "../dist-web"`,
  `base: process.env.PAGES_BASE ?? "/opensoegaki/"`. `pwa/index.html` is the web shell
  and imports `../src/main-web.ts`.
- Scripts: `build:web` = `tsc --noEmit && vite build --config vite.config.web.ts`;
  `preview:web` = `vite preview --config vite.config.web.ts`.

### PWA — hand-rolled manifest + minimal service worker (no vite-plugin-pwa)

- `pwa/manifest.webmanifest`: standalone display, **relative** `start_url`/`scope`
  (so they inherit `base`), icons copied from `src-tauri/icons/` into
  `pwa/public/icons/` (both actually 256×256 — declared as such, not the
  512/1024 guessed at design time). **Implementation note (TASK-35.8):**
  `purpose` is `"any"` only, not `"any maskable"` — `icon.svg`'s stroke art
  fills nearly the whole viewBox with no safe-zone padding, so a maskable
  variant would get clipped by a circular/rounded-square mask; revisit if a
  padded icon variant is ever produced. Same icon also serves as
  apple-touch-icon.
- The welcome-screen icon (`pwa/public/icon.svg`) is a copy, not a reference
  into `src-tauri/icons/` — the web build has zero inputs from `src-tauri/`
  (round 3 review finding).
- iOS meta: `viewport-fit=cover`, `apple-mobile-web-app-*`, apple-touch-icon,
  theme-color. A CSP `<meta>` tag (`default-src/script-src/style-src 'self'`,
  `img-src 'self' data: blob:`, `connect-src`/`manifest-src 'self'`,
  `base-uri 'self'`) is always present. iOS has no `beforeinstallprompt` →
  one-time "Add to Home Screen via the Share sheet" hint on iOS Safari,
  dismissal persisted to `localStorage` (best-effort; failures there — e.g.
  Safari private browsing — are swallowed, not fatal).
- `pwa/sw.js`: stale-while-revalidate app-shell cache, versioned cache name
  `soegaki-v<APP_VERSION>` (Vite `define __APP_VERSION__`), `skipWaiting()` +
  `clients.claim()`, purge old caches on activate. **Never caches user content.**

### iPhone UX

- **Input:** photo library / camera via `<input type="file" accept="image/*">`; DOM
  `paste` still works. Empty editor → picked image becomes background; loaded → insert.
- **Export:** primary Web Share (`navigator.share({files})`, gated on `canShare`),
  fallback `<a download>`. Copy is best-effort `ClipboardItem`, hidden when unsupported.
- **Keyboard-only → touch (TASK-35.11):** a floating delete button (🗑, positioned
  off the selection marquee's NE corner, same idiom as the crop tool's own
  floating overlay below) shown only while an annotation is selected, deleting
  through the exact same `deleteSelected()` path as Delete/Backspace. The crop
  Apply (✓) / Cancel (✗) bar while a crop is pending **already existed** before
  this task (TASK-4 v2.1's always-visible on-canvas overlay) — it needed no
  new code, only confirmation that it's `src/editor/canvas.ts`-owned and
  therefore already shown identically on both platforms. Both overlays are
  `Editor`-owned DOM elements (never toolbar buttons), created/positioned/torn
  down from `render()`/`drawSelectionOverlay()` — no `data-cap`, no HTML
  markup changes, no cross-entry duplication.
- **Double-tap (TASK-35.10):** a `pointerup`-based detector in `canvas.ts`
  (300 ms / 24 CSS-px slop, scale-compensated like the existing hit-test
  tolerance) reuses `onDown`'s exact `openTextEditor(..., { editId, ... })`
  re-edit call for a stationary select-tool tap release on the same text
  annotation twice in a row — touch `pointerdown` doesn't carry a native
  double-click `detail` counter the way mouse does. Purely additive: desktop's
  `e.detail >= 2` path in `onDown` is untouched and still the only path a real
  mouse dblclick takes.
- **Layout:** `touch-action: none` + `overscroll-behavior: none` +
  `user-select: none` on the stage (the inline text `<input>` overrides
  `user-select` back to `text`), `-webkit-touch-callout: none` on the canvas,
  `maximum-scale=1, user-scalable=no` on the **web shell's** viewport only
  (desktop's `index.html` viewport is untouched), `100vh` fallback before
  `100dvh` on `#app`, `env(safe-area-inset-*)` padding on the toolbar and
  share bar. Inline text input kept visible above the soft keyboard via an
  initial `scrollIntoView({block:"center"})` plus re-applying it on every
  `visualViewport` resize/scroll while the editor is open (feature-detected,
  listeners removed on commit/cancel) — a soft keyboard never fires those
  events on desktop, so this is a no-op there in practice.
- **Large images (TASK-35.14, web-only as of round 6):** every bytes/Blob →
  `ImageBitmap` decode, background or inserted annotation alike, funnels
  through one parameterized function (`src/editor/downscale.ts`'s
  `decodeClampedBitmap(source, max)`) that redraws through an
  `OffscreenCanvas` to clamp the longest side to `max` px (preserving aspect)
  if the source exceeds it. `max` is `PlatformIO.maxImportDimension`: `null`
  on desktop (no redraw at any size — exact pre-clamp behavior, desktop has
  no canvas size ceiling), `MAX_IMPORT_DIMENSION` (4096) on web (iOS canvas
  memory limits). One code path, parameterized per platform rather than
  forked. The pure clamp math (`clampImportSize`) has a vitest unit test
  covering both the `null` and numeric-limit cases.
- **Adaptive annotation sizing (TASK-35.16, web-only; round 7 introduced it
  from real-iPhone feedback, round 8 retuned it from further real-iPhone
  feedback that it still read too small):** web annotations auto-scale their
  creation-time stroke width, badge radius, and new-text font size to the
  imported image's long side, mirroring the `maxImportDimension` pattern
  exactly (`src/editor/model.ts`'s `computeAnnotationScale(longestSide,
  baseline)`). Baseline is **900px** (round 8: lowered from 1400 so a ~4000px
  iPhone photo scales ≈4.5× instead of ≈2.9× — "the new M should render like
  the old L"); factor is `1` at or below it, scales up to `longestSide /
  baseline` above it, capped at **`6×`** (round 8: raised from 4 as headroom
  that a `maxImportDimension`-clamped 4096px import never actually reaches:
  4096/900 ≈ 4.55). `PlatformIO.annotationScaleBaseline` is `null` on desktop
  (factor always `1`, fixed presets unchanged) and `ANNOTATION_SCALE_BASELINE`
  on web. A typical iPhone **screenshot** (~1290px long side) now gets a mild
  ~1.4× (previously 1.0× under the old 1400 baseline) — intended: screenshots
  were also on the small side, not just photos. A 12 MP **photo** (~4000px)
  gets ≈4.5× thicker strokes/larger badges/bigger new text so they stay
  legible instead of reading as hairline-thin. Recomputed only on
  `loadImage`/`loadImageBlob` (a new background); cropping does not
  recompute it. Sizes are baked into each annotation at creation as plain
  numbers — export, undo, and re-editing existing text need no changes, and
  already-placed annotations never retroactively resize on a later
  background replacement.

### Deploy — `.github/workflows/pages.yml`

Push to `main` filtered to web paths + `workflow_dispatch` → pnpm frozen install →
`build:web` → `actions/upload-pages-artifact` (`dist-web`) → `actions/deploy-pages`.
Existing `ci.yml` untouched.

### Versioning

Reuse `package.json` version via `__APP_VERSION__` (SW cache name + About line).
The web build presents as "OpenSoegaki" with an on-device privacy statement:
*runs entirely on your device — images are never uploaded*.

## Risk register

| # | Risk | Sev | Likelihood | Mitigation |
|---|------|-----|-----------|------------|
| 1 | iOS clipboard write (ClipboardItem PNG) unsupported/blocked | Low | Med | Gesture-gap failure mode resolved (`copyPng` lazy producer, round 3); residual risk is genuine `ClipboardItem`/`clipboard.write` non-support, still feature-detected — hide Copy, rely on Share |
| 2 | iOS clipboard read spotty | Low | High | Drop Ctrl+Shift+V on web; DOM `paste` path remains |
| 3 | `OffscreenCanvas.convertToBlob` needs iOS 16.4+ | Med | Low-Med | Fallback to `canvas.toBlob`; document 16.4 floor |
| 4 | Web Share with files fails in some contexts | Med | Low | Gate on `canShare`; download fallback |
| 5 | iOS canvas memory limits blank large (12 MP) images | Low | Med | Mitigated on web, where this risk actually applies: `PlatformIO.maxImportDimension` clamps imports to 4096px longest side there (TASK-35.14). Desktop has no such ceiling and is intentionally left unbounded (`maxImportDimension: null`, round 6) — not a risk on that platform to begin with |
| 6 | Toolbar-wiring divergence between two entries | Med | Med | Single `bootstrapEditor` + `data-cap` |
| 7 | Desktop regression from refactoring `main.ts` | High | Med | Behavior-identical move; re-verify all Done ACs on Windows; reviewer AC pass |
| 8 | SW cache staleness after deploy | Med | Med | Versioned cache + skipWaiting/claim + purge |
| 9 | Public hosting vs. sensitive screenshots | High | Low | Fully client-side; SW never caches user content; CSP restricting connect-src; privacy statement |
| 10 | Tauri code leaking into web bundle | Med | Low-Med | Separate entry; CI grep of `dist-web` for "tauri" |
| 11 | Pages subpath/base breaks assets or SW scope | Med | Low-Med | env `base`, relative start_url/scope, verify on real Pages URL |
| 12 | CI complexity / interference | Low | Low | Separate path-filtered workflow |
| 13 | No iOS test automation (dev on Windows/WSL) | Med | High | Real-iPhone manual smoke via checklist below |
| 14 | `user-scalable=no` a11y trade-off | Low | Med | Acceptable for a canvas tool; revisit on feedback |
| 15 | No install prompt on iOS | Low | High | One-time Share-sheet hint |

## iOS manual smoke-test checklist

Run on a real iPhone against the deployed Pages URL:

1. Open the site in Safari — app shell renders, no horizontal scroll, toolbar visible.
2. Choose Photo → pick a 12 MP photo from the library — it loads without blanking.
3. Draw arrow, rect, highlight; add a badge; add text (soft keyboard appears, input
   stays visible above it; return commits).
4. Double-tap existing text — editing reopens.
5. Select an annotation → delete via the delete button.
6. Crop: drag a crop rect → Apply via the confirm bar; repeat with Cancel.
7. Undo/redo several steps.
8. Save → share sheet opens → Save Image → verify annotated PNG in Photos.
9. Copy (if visible) → paste into Notes — image arrives.
10. Add to Home Screen via Share sheet → launch standalone (no Safari chrome).
11. Airplane mode → relaunch from home screen — app loads and edits offline.
12. While drawing, verify the page never scrolls, zooms, or rubber-bands.
