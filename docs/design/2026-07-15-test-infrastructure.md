# Design Note — TASK-12: Test infrastructure for TS + Rust, wired into CI

## Problem

OpenSoegaki has zero automated tests; `.github/workflows/ci.yml` only runs `pnpm check` (tsc) and `cargo fmt`/`clippy`. The pure-logic core that the object-model architecture depends on — model invariants, snapshot undo/redo (including background-by-reference), and hit-test geometry on the Rust side, plus `prepare_drag_file`'s temp-file contract — is entirely unguarded. We need a minimal, pragmatic test setup that runs headless (no monitor, no browser, no network), works in WSL and on Windows, and adds as few dependencies as the "keep the app light" rule permits.

## Decision

**TS runner: Vitest, node environment, no DOM shim.** Vitest is confirmed. It reuses the existing Vite pipeline (same ESM/TS resolution as the app, zero extra transform config), integrates with pnpm, and its `run` mode is CI-friendly. The important call is **rejecting jsdom/happy-dom**: every module worth unit-testing is pure or takes its canvas context as an argument, so we test in the default **node** environment and inject a tiny fake 2D context where text measurement is needed. That avoids a heavyweight DOM dependency entirely.

Dependencies to add (dev only, one package):

- `vitest` — install via `pnpm add -D vitest`, let pnpm resolve the release whose `vite` peer range covers the installed Vite 8 (the 3.2+/4.x line at that point); commit the caret range pnpm writes. No `@types/*` (Vitest ships its own types), **no jsdom/happy-dom, no coverage provider** (coverage tooling — `@vitest/coverage-v8`/istanbul — is deferred; it is added weight with little value on a codebase this size).

Config: a dedicated `vitest.config.ts` (not folded into `vite.config.ts`) so build and test concerns stay decoupled:

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

Tests are colocated as `src/editor/<module>.test.ts` and use **explicit imports** (`import { describe, it, expect } from "vitest"`) — no globals, so `tsconfig.json` needs no `types` entry and stays untouched. `pnpm check` (include `["src"]`) will typecheck the test files, which is desirable.

**Rust: extract two pure helpers, test them inline on the existing windows-latest job.** `cargo test` runs in the already-present `rust` job; no new job, no new OS, no new system deps.

### What is tested vs descoped (TS)

| Module | Decision | Why |
| --- | --- | --- |
| `model.ts` | **Test** | Pure; no canvas. |
| `history.ts` | **Test** | Pure (uses `structuredClone`, native on Node 22); bitmap is a by-reference sentinel object in tests. |
| `hittest.ts` | **Test** | Pure geometry; text path needs only a trivial fake `measureText`. |
| `render.ts` | **Descope** | Imperative wrapper over `CanvasRenderingContext2D` with no exported branching logic; the only real math (arrow-head trig) is private. A recording-fake assertion would lock in draw-call order (brittle) without catching visual regressions. If arrow geometry ever regresses, extract a pure `arrowHeadPoints(from, to, strokeWidth)` and test that — not in scope now. |
| `exporter.ts` | **Descope** | Requires `OffscreenCanvas.convertToBlob`, unavailable in node and unimplemented by jsdom/happy-dom without a native `canvas` build (heavy dep — violates "keep light"). Also the only path where screenshot pixels flow; keeping it out of tests keeps sensitive data out of the harness. Covered by the project's manual E2E "Done" gate. |

### Concrete TS test cases

**`model.test.ts`**
1. `nextId()` returns strings matching `/^a[0-9a-z]+$/`.
2. `nextId()` returns N distinct values over a tight loop (uniqueness via the counter, not just the timestamp).
3. `translateAnnotation` arrow: `from`/`to` both shifted by (dx,dy); `color`/`strokeWidth`/`id` preserved.
4. rect: `a`/`b` both shifted; other fields preserved.
5. text: `at` shifted; `text`/`fontSize` preserved.
6. Immutability: the input annotation is not mutated (deep-equal to a pre-call snapshot) for each kind.
7. Preset sanity: `STROKE_PRESETS.S < .M < .L` and same for `FONT_PRESETS`; `DEFAULTS.color` is in `PALETTE`.

**`history.test.ts`** (use a plain object `{} as unknown as ImageBitmap` as a bitmap sentinel to assert reference identity)
8. `undo` on empty history returns `null`; `redo` on empty returns `null`.
9. `push(A)` then `undo(B)` returns a snapshot deep-equal to A.
10. Snapshot isolation on push: after `push(A)`, mutating a nested point in A's annotations does **not** change what a later `undo` yields (proves `structuredClone` on push).
11. `redo` after `undo` returns the doc that was current at the `undo` call.
12. `push` clears the redo stack: `push(A)`, `undo`, `push(C)` ⇒ `redo` returns `null`.
13. **Background-replacement undo:** start with snapshot `{ imageBitmap: b1, annotations: [...] }`; `push`; make current `{ imageBitmap: b2, annotations: [...changed] }`; `undo` returns a snapshot whose `imageBitmap` is `b1` **by identity (`toBe`)** (bitmap restored by reference, never cloned) and whose annotations equal the pre-push list.

**`hittest.test.ts`** (helper: `const measure = { font: "", measureText: (t: string) => ({ width: t.length * 10 }) } as unknown as CanvasRenderingContext2D`)
14. `boundsOf` arrow and rect: normalized `{x,y,w,h}` regardless of which corner is passed first (swap corners ⇒ same bounds).
15. `boundsOf` text: `x/y === at`, `w === text.length*10`, `h === fontSize*1.2`.
16. `hitTest` arrow: a point on the shaft within tolerance hits; a far point misses; a point just past an endpoint within `tolerance + strokeWidth/2` hits.
17. `hitTest` rect **core invariant:** a point near the perimeter hits; a point in the hollow center **misses**; a degenerate thin rect (inner has no positive area) falls back to a filled hit.
18. `hitTest` text: a point inside the inflated bbox hits; a point outside misses.
19. Topmost-first: two overlapping annotations ⇒ `hitTest` returns the **last** in the list; empty list returns `null`.

## Rust tests

`capture_primary_monitor` cannot run in CI (no monitor) and is left untested. `prepare_drag_file` is testable after a minimal refactor that separates OS-handle plumbing from file logic.

**Refactor in `src-tauri/src/lib.rs` (minimal):**
- Add `const TEMP_SUBDIR: &str = "opensoegaki";` and use it in **both** `prepare_drag_file` (the `.join("opensoegaki")`) and `cleanup_temp` — so a test can assert the write path and cleanup path cannot drift apart.
- Extract a pure helper:
  ```rust
  fn write_drag_file(dir: &std::path::Path, ts: u128, png: &[u8]) -> std::io::Result<std::path::PathBuf> {
      std::fs::create_dir_all(dir)?;
      let path = dir.join(format!("soegaki-{ts}.png"));
      std::fs::write(&path, png)?;
      Ok(path)
  }
  ```
  `prepare_drag_file` keeps its `AppHandle`/`temp_dir`/`SystemTime` logic and delegates to `write_drag_file`, mapping errors to `String` as today. The observable IPC contract is unchanged.

**`#[cfg(test)] mod tests` in `lib.rs`** (unique dir via `std::env::temp_dir().join(format!("opensoegaki-test-{}", <nanos+counter>))`; no `tempfile` crate; `remove_dir_all` at end of each test):
1. `write_drag_file` returns a path whose file name equals `soegaki-<ts>.png` for the given `ts`.
2. File contents read back equal the input bytes exactly.
3. Missing parent directory is created (pass a nested dir that does not exist).
4. Two distinct `ts` values produce two distinct files with no overwrite (both exist afterward).
5. Cleanup round-trip: after `write_drag_file`, `std::fs::remove_dir_all(dir)` leaves the returned path non-existent — asserting the subdir the file lives in is the one `cleanup_temp` targets (both reference `TEMP_SUBDIR`).

## CI wiring — `.github/workflows/ci.yml`

- **`frontend` job (ubuntu-latest, unchanged runner):** add a step after `pnpm check`:
  ```yaml
  - run: pnpm test
  ```
  with `"test": "vitest run"` in `package.json` scripts. Node environment ⇒ no browser, no display server needed; runs identically in WSL locally and on ubuntu in CI.
- **`rust` job (windows-latest, unchanged runner):** add a step after clippy:
  ```yaml
  - name: test
    run: cargo test
    working-directory: src-tauri
  ```
  reusing the existing `Swatinem/rust-cache`.

**Runner-OS rationale:** the Rust tests are pure std file logic, but the crate compiles against `tauri` + `xcap`, which on Linux drag in system packages (webkit2gtk, libsoup, libxdo, libxcb). Building those on ubuntu just to run temp-file tests is added flakiness and CI weight for zero benefit. The `rust` job is **already** on windows-latest (the primary target) with the toolchain and cache warmed, so `cargo test` there is the minimal, robust choice. No `apt` install step is introduced.

## Constraints satisfied

- **WSL + Windows:** TS tests are node-environment and depend only on Node 22 (present in both); Rust tests use only `std` and the system temp dir.
- **No network / no data transmission:** all TS tests operate on in-memory objects; the one pixel-touching module (`exporter.ts`) is deliberately descoped, so no screenshot bytes ever enter the harness. Rust tests write only to a unique local temp subdir and delete it.
- **Dependency budget:** exactly one new JS devDependency (`vitest`); zero new Rust crates.
- **No IPC contract change.** Command names and payloads are untouched; the `docs/ARCHITECTURE.md` IPC table needs no edit.

## Implementation tasks (for `implementer`)

1. Run `pnpm add -D vitest`; accept the version pnpm resolves against the installed Vite 8 (do not hand-edit to jsdom/coverage packages).
2. Add script `"test": "vitest run"` (and optionally `"test:watch": "vitest"`) to `package.json`.
3. Create `vitest.config.ts` at repo root exactly as shown in the Decision section (`environment: "node"`, `include: ["src/**/*.test.ts"]`).
4. Create `src/editor/model.test.ts` implementing cases 1–7.
5. Create `src/editor/history.test.ts` implementing cases 8–13, using a `{} as unknown as ImageBitmap` sentinel and asserting bitmap identity with `toBe` in case 13.
6. Create `src/editor/hittest.test.ts` implementing cases 14–19 with the fake `measure` context from this note. Do **not** create tests for `render.ts` or `exporter.ts`.
7. In `src-tauri/src/lib.rs`: add `const TEMP_SUBDIR: &str = "opensoegaki";`, use it in both `prepare_drag_file` and `cleanup_temp`, and extract the `write_drag_file(dir, ts, png)` helper; have `prepare_drag_file` delegate to it. Keep all existing error mapping and the command signature/return type identical.
8. In `src-tauri/src/lib.rs`, add a `#[cfg(test)] mod tests` implementing Rust cases 1–5, each using a unique subdir under `std::env::temp_dir()` and cleaning up with `remove_dir_all`. Do not add the `tempfile` crate.
9. Edit `.github/workflows/ci.yml`: add `- run: pnpm test` to the `frontend` job after `pnpm check`, and a `cargo test` step (`working-directory: src-tauri`) to the `rust` job after clippy.
10. Verify locally: `pnpm test` and (on Windows via powershell interop) `cargo test` inside `src-tauri/` both pass; `cargo fmt` and `pnpm check` remain green. Do not commit — surface a recommended commit message for the user.

## Relevant files

- `package.json` — add `vitest` devDep + `test` script
- `vitest.config.ts` — new config file
- `src/editor/model.test.ts`, `history.test.ts`, `hittest.test.ts` — new tests
- `src-tauri/src/lib.rs` — `TEMP_SUBDIR` const + `write_drag_file` extraction + `#[cfg(test)] mod tests`
- `.github/workflows/ci.yml` — `pnpm test` and `cargo test` steps
- Descoped (no test files): `src/editor/render.ts`, `src/editor/exporter.ts`, `src-tauri/src/capture.rs`

Note: `docs/ARCHITECTURE.md` IPC table is unaffected by this task and needs no update.
