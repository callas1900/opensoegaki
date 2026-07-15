# OpenSoegaki — Claude Code project guide

OpenSoegaki is an open-source screenshot-annotation tool (Tauri 2: Rust core +
TypeScript/Canvas UI), a spiritual successor to the discontinued Skitch for Windows.
Primary target: Windows 11. macOS support is planned — never block it in a design.

## Agent workflow (important)

This project splits AI work by model tier. Follow this routing:

| Kind of work | Agent | Model |
| --- | --- | --- |
| Design, architecture, technology choices, IPC contracts, ambiguity resolution | `architect` | Opus (or higher) |
| Feedback: code review, UX critique, design-doc review | `reviewer` | Opus (or higher) |
| Writing/editing code against an agreed spec | `implementer` | Sonnet |

Rules:

1. **Design before code.** For any non-trivial feature, delegate to `architect` first
   and get a design note with an implementation task list.
2. **Implementation goes to `implementer`.** Hand it the design note or a precise task.
   It must not make architecture decisions on its own.
3. **Review after implementation.** Delegate the diff to `reviewer` before committing
   non-trivial changes. Fix blocking issues via `implementer`, then re-review.
4. If `implementer` reports a design-level problem, route it back to `architect` —
   do not let Sonnet improvise the design, and do not silently fix it in the main session.

## Acceptance criteria are regression contracts

The acceptance criteria of every **Done** backlog task are living regression
contracts: no later change may silently break them.

1. **Every review includes an AC regression pass.** Enumerate Done tasks
   (`backlog task list --plain`), read their ACs (`backlog task view <id> --plain`),
   and verify the diff breaks none of them. A broken past AC is a blocking finding.
2. **Conflicts are proposed, never absorbed.** If new work genuinely conflicts with a
   past AC, do not pick a side silently — present the conflict to the user as a
   proposal (options + recommendation), let them decide, and record the decision in
   the affected task(s).
3. **Done means verified.** A task may be marked Done only after its ACs have been
   exercised in the running app (`pnpm tauri dev` on Windows) or by automated tests.
   Typecheck, compile, and code-trace review are *not* AC verification; until the ACs
   are exercised, the task stays In Progress.

## Hard conventions

- Package manager: **pnpm only** (no npm, no yarn; do not create package-lock.json).
- All documentation, code comments, and commit messages: **English**.
- Annotations are an **object model** (arrow/rect/text as data). Rasterize only at export.
- Responsibility split: Rust (`src-tauri/`) = OS integration (capture, tray, hotkeys,
  drag-out, clipboard). TypeScript (`src/`) = Canvas rendering and interaction.
- Screenshots are sensitive data: never add code that transmits them over the network.
- Keep the app light: challenge every new dependency.

## Commands

```sh
pnpm install          # install JS deps
pnpm dev              # frontend only (Vite)
pnpm tauri dev        # full app in dev mode
pnpm check            # TypeScript typecheck
pnpm tauri build      # release bundle
cargo fmt / clippy    # run inside src-tauri/
```

## Key files

- `src/editor/model.ts` — annotation object model (single source of truth for shapes)
- `src/editor/canvas.ts` — rendering + pointer interaction
- `src-tauri/src/capture.rs` — screen capture (xcap)
- `src-tauri/src/lib.rs` — Tauri setup: tray, hotkeys, commands, drag-out
- `docs/ARCHITECTURE.md` — design overview; update it when architecture changes
