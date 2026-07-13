---
id: TASK-2
title: Install dependencies and get a clean build baseline
status: Done
assignee: []
created_date: '2026-07-12 02:44'
updated_date: '2026-07-13 09:39'
labels:
  - foundation
dependencies: []
priority: high
ordinal: 2000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The project has never been built in this working copy (no node_modules, no target/). Run pnpm install, pnpm check, and cargo fmt --check + cargo clippy inside src-tauri/, fixing anything that fails.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pnpm check passes
- [x] #2 cargo fmt --check and cargo clippy pass with no warnings (-D warnings, same as CI)
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
pnpm install + pnpm check: PASS (0 errors). rustup installed in WSL (stable 1.97.0); cargo fmt --check: PASS. cargo clippy: BLOCKED on WSL — missing Linux system libs (wayland-client via libwayland-dev, plus standard Tauri Linux prereqs: libgtk-3-dev libwebkit2gtk-4.1-dev libjavascriptcoregtk-4.1-dev libsoup-3.0-dev libayatana-appindicator3-dev librsvg2-dev). Needs sudo, or run clippy on Windows where CI runs it anyway.

CLOSED on Windows host: rustup (stable-msvc 1.97.0) + VS Build Tools 2022 (C++ workload) installed via winget/rustup-init; pnpm install + pnpm check PASS on Windows; cargo clippy -- -D warnings PASS (exit 0). WSL clippy remains blocked (missing GTK libs) but Windows is the CI-relevant platform.
<!-- SECTION:NOTES:END -->
