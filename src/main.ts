/**
 * Desktop entry point: wires the shared editor bootstrap plus the
 * desktop-only full-screen capture button and the macOS permission modal.
 * All other Tauri OS integration lives behind `PlatformIO`
 * (see src/platform/tauri.ts); this file must not import `@tauri-apps/*`
 * directly.
 */
import { createTauriIO } from "./platform/tauri";
import { bootstrapEditor } from "./app";

const io = createTauriIO();

const captureBtn = document.querySelector<HTMLButtonElement>("#capture")!;

// macOS-only: shown when capture_fullscreen rejects with the
// SCREEN_RECORDING_PERMISSION sentinel (no Screen Recording access granted).
// Harmless dead UI on Windows/Linux, where that rejection never occurs.
const permissionModal = document.querySelector<HTMLDivElement>("#permission-modal")!;
const permissionOpenSettingsBtn = document.querySelector<HTMLButtonElement>(
  "#permission-open-settings",
)!;

function showPermissionModal(): void {
  permissionModal.hidden = false;
  permissionOpenSettingsBtn.focus(); // first focusable action, per standard dialog convention
}

function hidePermissionModal(): void {
  permissionModal.hidden = true;
  captureBtn.focus(); // return focus to the control that opened the dialog
}

permissionOpenSettingsBtn.addEventListener("click", () => void io.openCapturePermissionSettings?.());
document.querySelector<HTMLButtonElement>("#permission-dismiss")!.addEventListener("click", hidePermissionModal);
permissionModal.addEventListener("click", (e) => {
  if (e.target === permissionModal) hidePermissionModal(); // click landed on the backdrop, not .modal
});

// The permission modal takes precedence over every other shortcut while
// open, including bootstrapEditor's global keyboard shortcuts below: Escape
// must always dismiss it, even if focus somehow ended up in a text input.
// Registered before bootstrapEditor() so it runs first, and stops the event
// outright so no shared shortcut logic also runs for this keypress —
// matching the single-listener behavior this was split out of.
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !permissionModal.hidden) {
    e.preventDefault();
    e.stopImmediatePropagation();
    hidePermissionModal();
  }
});

const { editor, showLoadedState } = bootstrapEditor(io);

captureBtn.addEventListener("click", async () => {
  captureBtn.disabled = true;
  try {
    const invokeStart = performance.now();
    const bytes = await io.captureBackground!();
    const invokeMs = performance.now() - invokeStart;

    const loadImageStart = performance.now();
    await editor.loadImage(bytes);
    const loadImageMs = performance.now() - loadImageStart;

    // Perf instrumentation only: dev builds log the client-side legs of the
    // capture round-trip (IPC, bitmap decode) so they can be compared against
    // the `[perf] capture ...` lines OpenSoegaki's Rust side prints for the
    // same capture. The IPC response is raw bytes (no base64), so there is no
    // separate decode leg here.
    if (import.meta.env.DEV) {
      console.log(
        `[perf] capture invoke=${invokeMs.toFixed(0)}ms loadImage=${loadImageMs.toFixed(0)}ms ` +
          `bytes=${bytes.byteLength}`,
      );
    }

    showLoadedState();
  } catch (err) {
    // The invoke rejection may arrive as the raw string rather than an Error,
    // so normalize with String() before comparing against the IPC sentinel.
    if (String(err) === "SCREEN_RECORDING_PERMISSION") {
      showPermissionModal();
    } else {
      console.error("capture failed:", err);
    }
  } finally {
    captureBtn.disabled = false;
  }
});
