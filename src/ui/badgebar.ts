/**
 * Badge fixed-number bottom bar (TASK-38 round 3): a persistent MODE, not a
 * flyout, so it is deliberately never registered with `./popover.ts` — that
 * keeps it immune to outside-tap dismissal, the popover manager's iOS
 * soft-keyboard resize/scroll guard, and the single-open-popover invariant.
 * This controller owns the bar's DOM, drives `editor.setBadgeFixedNumber`,
 * and swaps the badge tool button's icon between its auto/fixed glyphs.
 *
 * Invariant: the bar is open iff `editor.getBadgeFixedNumber() !== null` —
 * `editor.getBadgeFixedNumber()` stays the single source of truth for fixed
 * mode; `isOpen()` reads it directly rather than tracking a parallel flag.
 */
import type { Editor } from "../editor/canvas";
import type { Tool } from "../editor/model";
import { closeOpenPopover } from "./popover";

/**
 * iOS standalone-PWA quirk: after the soft keyboard closes, the layout
 * viewport can stay panned/shrunk, leaving the whole app squashed until the
 * next real resize. Scrolling back to origin nudges WebKit into restoring
 * it. No-op everywhere else (the app never scrolls the window).
 */
function restoreViewport(): void {
  window.scrollTo(0, 0);
}

export interface BadgeBar {
  /** Second-tap on the badge tool button: open if closed, close if open. */
  toggle(): void;
  /** Enter fixed mode, pinned to the last-used number (default 1). */
  open(): void;
  /** Exit to auto-sequence mode. Returns true iff the bar was open. */
  close(): boolean;
  isOpen(): boolean;
  /** Wired into `editor.onToolChanged`: leaving the badge tool closes the bar. */
  handleToolChange(t: Tool): void;
}

export function createBadgeBar(editor: Editor): BadgeBar {
  const bar = document.querySelector<HTMLElement>("#badge-bar")!;
  const closeBtn = document.querySelector<HTMLButtonElement>("#badge-bar-close")!;
  const digits = document.querySelector<HTMLDivElement>("#badge-digits")!;
  const input = document.querySelector<HTMLInputElement>("#badge-num-input")!;
  const chip = document.querySelector<HTMLButtonElement>("#badge-num-chip")!;

  const badgeToolBtn = document.querySelector<HTMLButtonElement>('[data-tool="badge"]')!;
  const iconAuto = badgeToolBtn.querySelector<SVGElement>('[data-badge-icon="auto"]')!;
  const iconFixed = badgeToolBtn.querySelector<SVGElement>('[data-badge-icon="fixed"]')!;
  const iconGlyph = iconFixed.querySelector<SVGTextElement>("[data-badge-glyph]")!;

  // Session-scoped: survives close/reopen within this run, resets on reload.
  let lastPinned = 1;
  // The custom chip's own pinned value (TASK-38 round 5), independent of
  // `lastPinned` (which also tracks plain digit-chip taps): only a commit
  // via the chip itself sets this, so a later digit tap can move
  // `lastPinned` without losing the chip's one-tap-back-to-custom label.
  let lastCustom: number | null = null;

  /**
   * The custom chip is a live label, not a static button: while the input
   * has text it mirrors exactly what's typed; once the input is cleared (by
   * a digit tap, a commit, or on open) it falls back to the last committed
   * custom value, or an empty (disabled) label if there has never been one.
   * Called on every input edit and whenever something else clears the
   * input, so the chip never shows a stale label.
   */
  function refreshChipLabel(): void {
    const typed = input.value;
    const label = typed !== "" ? typed : lastCustom !== null ? String(lastCustom) : "";
    chip.textContent = label;
    chip.disabled = typed === "" && lastCustom === null;
    // Step the font down for longer labels so 3-4 digit numbers still fit
    // the digit-chip-sized box (see #badge-num-chip[data-len] in styles.css).
    // The empty fallback label has no length to step, so skip it rather
    // than leaving a stale/misleading data-len on the disabled chip.
    if (label === "") delete chip.dataset.len;
    else chip.dataset.len = String(label.length);
  }

  /** Highlight the digit chip matching `n` (0..9), or the custom chip for anything else (10+ in practice). */
  function syncActiveState(n: number): void {
    for (const btn of digits.querySelectorAll<HTMLButtonElement>("button[data-num]")) {
      btn.classList.toggle("active", btn.dataset.num === String(n));
    }
    // A custom-typed value that happens to be 0-9 lights the matching digit
    // chip above instead (handled by the loop) — don't double-highlight.
    chip.classList.toggle("active", n === lastCustom && n > 9);
  }

  function updateIcon(fixed: number | null): void {
    // `hidden` is untyped on SVGElement (unlike HTMLElement) even though the
    // boolean attribute works identically at the DOM level; toggleAttribute
    // sidesteps the missing IDL property.
    iconAuto.toggleAttribute("hidden", fixed !== null);
    iconFixed.toggleAttribute("hidden", fixed === null);
    if (fixed === null) return;
    iconGlyph.textContent = String(fixed);
    const digitCount = String(fixed).length;
    iconGlyph.setAttribute("font-size", digitCount === 1 ? "11" : digitCount === 2 ? "9" : "7");
  }

  function isOpen(): boolean {
    return editor.getBadgeFixedNumber() !== null;
  }

  function open(): void {
    editor.setBadgeFixedNumber(lastPinned);
    bar.hidden = false;
    document.body.classList.add("badge-bar-open");
    input.value = "";
    // Restore the chip's label/disabled state from `lastCustom` before
    // syncing the active accent, so reopening on a pinned custom value
    // shows the chip lit up rather than looking unselected.
    refreshChipLabel();
    syncActiveState(lastPinned);
    updateIcon(lastPinned);
    closeOpenPopover();
  }

  function close(): boolean {
    const wasOpen = isOpen();
    bar.hidden = true;
    document.body.classList.remove("badge-bar-open");
    editor.setBadgeFixedNumber(null);
    updateIcon(null);
    restoreViewport();
    return wasOpen;
  }

  function toggle(): void {
    if (isOpen()) close();
    else open();
  }

  for (const btn of digits.querySelectorAll<HTMLButtonElement>("button[data-num]")) {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.num);
      lastPinned = n;
      editor.setBadgeFixedNumber(n);
      input.value = "";
      // The digit tap clears the input, which would otherwise leave the
      // custom chip showing a stale typed label; refresh it back to
      // `lastCustom` (unaffected by this tap) or empty.
      refreshChipLabel();
      syncActiveState(n);
      updateIcon(n);
    });
  }

  /** Shared tail of the custom-chip tap and Enter-in-input paths. */
  function commit(): void {
    const v = input.value !== "" ? parseInt(input.value, 10) : lastCustom;
    if (v === null || !Number.isFinite(v)) return;
    lastCustom = v;
    lastPinned = v;
    editor.setBadgeFixedNumber(v);
    syncActiveState(v);
    updateIcon(v);
    input.value = "";
    refreshChipLabel();
    // Dismiss the iOS keyboard; the existing blur listener below fires
    // restoreViewport.
    input.blur();
  }
  chip.addEventListener("click", commit);
  input.addEventListener("input", refreshChipLabel);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      // Keep Enter from reaching the global keydown handler (crop-apply).
      e.preventDefault();
      e.stopPropagation();
      commit();
    }
  });
  input.addEventListener("blur", restoreViewport);

  closeBtn.addEventListener("click", () => close());

  function handleToolChange(t: Tool): void {
    if (t !== "badge" && isOpen()) close();
  }

  return { toggle, open, close, isOpen, handleToolChange };
}
