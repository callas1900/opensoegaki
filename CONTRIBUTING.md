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

## Releasing

To cut a release:

1. Set the same `X.Y.Z` version in **both** `src-tauri/Cargo.toml` (`[package].version`)
   and `package.json` (`version`).
2. Commit the version bump.
3. Tag the commit: `git tag vX.Y.Z`
4. Push the tag: `git push origin vX.Y.Z`

Pushing the tag triggers the release workflow (`.github/workflows/release.yml`), which
builds Windows and macOS bundles via `tauri-action` and attaches them to a GitHub Release.
The workflow's `verify-version` job fails the release if the tag version doesn't match
both `Cargo.toml` and `package.json` — fix the mismatch and re-tag rather than trying to
push over an existing tag.

Note: `src-tauri/tauri.conf.json` intentionally has no `version` field; Tauri falls back
to `src-tauri/Cargo.toml`'s version, which is the single source of truth for the bundle
version.

## AI-assisted development

This repository ships Claude Code agent definitions in `.claude/agents/`
(see `CLAUDE.md`). Their use is optional. Human review is required for every PR
regardless of how the code was produced, and you are responsible for any code you submit.

## Code of conduct

Be kind, be constructive, assume good faith. Harassment of any kind is not tolerated.
