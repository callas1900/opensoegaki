# Contributing to OpenSoegaki

Thanks for your interest! OpenSoegaki is young, so contributions of every size are welcome.

## Development setup

1. Install [Rust](https://rustup.rs/), Node.js 20+, and pnpm 9+ (`corepack enable`).
2. `pnpm install`
3. `pnpm tauri dev`

We use **pnpm only** — please do not commit `package-lock.json` or `yarn.lock`.

## Workflow

1. Open or pick an issue before starting significant work, so we can align on design.
2. Fork, create a feature branch (`feat/...`, `fix/...`).
3. Keep PRs focused; one logical change per PR.
4. Before pushing: `pnpm check` (typecheck) and `cargo fmt && cargo clippy` in `src-tauri/`.

## Design principles

- **Annotations are objects, not pixels** — every tool manipulates the object model in
  `src/editor/`; rasterization happens only at export time.
- **Rust owns the OS, TypeScript owns the canvas** — capture, tray, hotkeys, drag-out
  and clipboard live in `src-tauri/`; all drawing and interaction live in `src/`.
- **Stay light** — this is a tray utility. Think twice before adding dependencies.

## AI-assisted development

This repository ships Claude Code agent definitions in `.claude/agents/`
(see `CLAUDE.md`). Their use is optional. Human review is required for every PR
regardless of how the code was produced, and you are responsible for any code you submit.

## Code of conduct

Be kind, be constructive, assume good faith. Harassment of any kind is not tolerated.
