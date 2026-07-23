/**
 * Minimal hand-rolled popover/flyout manager (no deps). A popover is a trigger
 * <button> plus a panel element. Only one popover is open at a time. Panels are
 * position:fixed, anchored below their trigger, and moved to <body> on
 * registration so no ancestor overflow/transform can clip them.
 */

interface Popover {
  trigger: HTMLButtonElement;
  panel: HTMLElement;
}

const popovers: Popover[] = [];
let openPanel: HTMLElement | null = null;

const EDGE_MARGIN = 8; // keep the panel this far from the window edges
const ANCHOR_GAP = 4;  // vertical gap between trigger and panel

/**
 * Register a trigger/panel pair. Call once per popover during app init.
 */
export function registerPopover(trigger: HTMLButtonElement, panel: HTMLElement): void {
  panel.classList.add("popover");
  panel.hidden = true;
  document.body.appendChild(panel); // escape any clipping ancestor
  trigger.setAttribute("aria-haspopup", "true");
  trigger.setAttribute("aria-expanded", "false");

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePopover(trigger, panel);
  });

  if (popovers.length === 0) installGlobalListeners();
  popovers.push({ trigger, panel });
}

/** Close `panel` if it's the currently open popover, else open it (closing whatever else was open). */
export function togglePopover(trigger: HTMLButtonElement, panel: HTMLElement): void {
  if (openPanel === panel) closeOpenPopover();
  else openPopover(trigger, panel);
}

function openPopover(trigger: HTMLButtonElement, panel: HTMLElement): void {
  closeOpenPopover();
  panel.hidden = false;
  const r = trigger.getBoundingClientRect();
  const pw = panel.offsetWidth;
  let left = Math.min(r.left, window.innerWidth - pw - EDGE_MARGIN);
  left = Math.max(EDGE_MARGIN, left);
  panel.style.left = `${left}px`;
  panel.style.top = `${r.bottom + ANCHOR_GAP}px`;
  openPanel = panel;
  trigger.classList.add("popover-open");
  trigger.setAttribute("aria-expanded", "true");
}

/** Close the currently open popover, if any. Returns true if one was closed. */
export function closeOpenPopover(): boolean {
  if (!openPanel) return false;
  const owner = popovers.find((p) => p.panel === openPanel);
  openPanel.hidden = true;
  if (owner) {
    owner.trigger.classList.remove("popover-open");
    owner.trigger.setAttribute("aria-expanded", "false");
  }
  openPanel = null;
  return true;
}

export function isPopoverOpen(): boolean {
  return openPanel !== null;
}

function installGlobalListeners(): void {
  // Capture phase: a press outside the open panel and its triggers closes the
  // popover. If the press is on the canvas, swallow it so the dismiss press
  // does not also start an annotation (badge/text place on pointer-down).
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (!openPanel) return;
      const t = e.target as Node;
      if (openPanel.contains(t)) return;
      if (popovers.some((p) => p.trigger.contains(t))) return; // trigger toggles itself
      closeOpenPopover();
      if (t instanceof HTMLCanvasElement) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    true,
  );
  // iOS fires `resize` (and sometimes a capture-phase `scroll`) on the
  // window when the soft keyboard opens/closes — not just on an actual
  // dismiss gesture. If a field inside the open panel is still focused,
  // the user is typing, not dismissing: closing here would yank the
  // popover out from under them mid-keystroke. Only skip the close in that
  // one case; every other resize/scroll still closes as before. (The badge
  // fixed-number bar's own numeric input lives outside the popover registry
  // entirely — see src/ui/badgebar.ts — so this guard no longer concerns it.)
  const keyboardGuardedClose = () => {
    if (openPanel && openPanel.contains(document.activeElement)) return;
    closeOpenPopover();
  };
  window.addEventListener("resize", keyboardGuardedClose);
  window.addEventListener("scroll", keyboardGuardedClose, true);
}
