import { expect, type Page } from "@playwright/test";

/**
 * Shared image fixtures for the e2e suite, plus the loader every spec used to
 * carry its own copy of.
 *
 * Still inlined as base64 rather than checked in as binary files (no fixture
 * directory, no new dependency) — but inlined ONCE, here. Four specs
 * previously held their own copy and three of those copies were silently
 * truncated: a valid IHDR followed by an IDAT cut short mid-stream. WebKit
 * renders a truncated PNG anyway, so the WebKit-only suite never noticed;
 * Chromium rejects it outright ("The source image could not be decoded"),
 * which is how they surfaced once a desktop-chromium project existed.
 *
 * `fixtures.spec.ts` loads every constant below in BOTH projects, so a
 * re-broken fixture fails there rather than as a confusing timeout in
 * whichever spec happens to use it.
 *
 * Regenerating one: build the IHDR/IDAT/IEND chunks by hand (zlib deflate
 * over rows each prefixed with a 0 filter byte, CRC32 per chunk), then
 * confirm it decodes in Chromium — not just WebKit — before inlining.
 */

/**
 * 120x90 RGB: white background with a 10x10 BLACK square at (20,20)-(29,29)
 * inclusive, center (25,25).
 *
 * The square is load-bearing for magnifier.spec.ts only (it samples
 * magnified pixels); every other spec just needs a decodable image of known
 * size. Keep the square if you regenerate this.
 */
export const SMALL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAABaCAIAAAD8YgW4AAAAlklEQVR42u3XMQ0AAAgEsfdvGhwwEkJ6ErpdSisFAWjQAg0atECDFmjQoAUatECDBi3QoAX6IXTG4IIGDRo0aNACDRo0aNAWXKBBgxZo0AINGrRAgxZo0KAFGrRAgwYt0KAFGjRogQYt0KBBCzRogQYNWqBBCzRo0AINWqBBgxZo0AINGrRAgxZo0KAFGjRoBKBBC/TZGmHU7eEWUTvKAAAAAElFTkSuQmCC";

/**
 * 120x900 RGB, horizontal 100px bands. Portrait and extremely tall, so it is
 * height-constrained on the 390x844 iPhone viewport — the shape that makes
 * shrinking #stage (badge bar opening, soft-keyboard inset) the binding
 * constraint on the canvas's fitted size.
 */
export const TALL_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAOECAIAAADlvmJ6AAAEo0lEQVR42u3QMQ3AQAwEsAK7OXDC4LmXRXSDJSPwlwwHPgWiRSNatGgLokUjWrRoC6JFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGdEn07uOAaNGiES1atALRohEtWrQF0aIRLVq0BdGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIR3RKdDAdEixaNaNGiFYgWjWjRoi2IFo1o0aItiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo3olujdxwHRokUjWrRoBaJFI1q0aAuiRSNatGgLokUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSO6JToZDogWLRrRokUrEC0a0aJFWxAtGtGiRVsQLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtEt0buPA6JFi0a0aNEKRItGtGjRFkSLRrRo0RZEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0okWLRrRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRnRLdDIcEC1aNKJFi1YgWjSiRYu2IFo0okWLtiBaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaNaNGiES0a0aJFI1o0oluidx8HRIsWjWjRohWIFo1o0aItiBaNaNGiLYgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEixaNaNGIFi0a0aIRLVo0okUjWrRoRItGtGjRiBaN6JboZDggWrRoRIsWrUC0aESLFm1BtGhEixZtQbRoRIsWjWjRiBYtGtGiES1aNKJFI1q0aESLRrRo0YgWjWjRohEtGtGiRSNaNKJFi0a0aESLFo1o0YgWLRrRohEtWjSiRSNatGhEi0a0aNGIFo1o0aIRLRrRokUjWjSiRYtGtGhEl/gB3sm7tzpUPr0AAAAASUVORK5CYII=";

/**
 * 800x200 RGB, horizontal 25px bands. Landscape and wide enough to be
 * width-constrained on both projects' viewports, so the fitted canvas's right
 * edge sits at the stage's right edge — the geometry that made the inline
 * text editor's input hang past #stage and drag the canvas sideways
 * (text-editor-shift.spec.ts).
 */
export const WIDE_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAyAAAADICAIAAACf7RJNAAADHklEQVR42u3WMRHAQAzEwABz/XDMwNxD4q7bmUWgSt/MAwAg6JMAAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwDAYAEAGCwAAIMFAIDBAgAwWAAABgsAAIMFAGCwAAAMFgAABgsAwGABABgsAAAMFgBAb7B2DwCAIIMFAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBgsAAADBYAgMECAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwCgOFgzDwCAIIMFAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBgsAAADBYAgMECAMBgAQAYLAAAgwUAgMECADBYAAAGCwAAgwUAYLAAAAwWAAAGCwCgOFi7BwBAkMECADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBQHKyZBwBAkMECADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAwWAAABgsAwGABAGCwAAAMFgCAwQIAwGABABgsAACDBQCAwQIAMFgAAAYLAACDBQBQHKzdAwAgyGABABgsAACDBQBgsAAAMFgAAAYLAMBgAQBgsAAADBYAgMECAMBgAQAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAoDtbMAwAgyGABABgsAACDBQBgsAAAMFgAAAYLAMBgAQBgsAAADBYAgMECAMBgAQAYLAAAgwUAYLAAADBYAAAGCwDAYAEAYLAAAAwWAIDBAgDAYAEAGCwAAIMFAIDBAgAoDtbuAQAQZLAAAAwWAIDBAgAwWAAAGCwAAIMFAGCwAAAwWAAABgsAwGABAGCwAAAMFgCAwQIAMFgAABgsAACDBQBgsAAAMFgAAAYLAMBgAQBgsAAADBYAgMECAMBgAQD0/LQgOcRAMuNxAAAAAElFTkSuQmCC";

/**
 * Load a fixture through the welcome screen's "Choose Photo" button
 * (`#welcome-pick`, which lazily opens the web platform's hidden file input —
 * see src/platform/web.ts's pickImage). `page.waitForEvent` arms the listener
 * before the tap so the file-chooser dialog is never missed.
 *
 * #stage carries the "empty" class while no image is loaded (see src/app.ts's
 * syncEmptyState); it is removed once the picked image lands, which is what
 * makes this await a real "the image decoded and rendered" signal.
 */
export async function loadTestImage(page: Page, base64: string): Promise<void> {
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#welcome-pick").tap();
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "fixture.png",
    mimeType: "image/png",
    buffer: Buffer.from(base64, "base64"),
  });
  await expect(page.locator("#stage")).not.toHaveClass(/empty/);
}
