---
id: TASK-15
title: 'Release pipeline: matrix build (Windows + macOS) in CI'
status: Done
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-18 01:38'
labels:
  - platform
dependencies: []
priority: high
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
CI only lints today. Add a tag-triggered release workflow using tauri-apps/tauri-action with a matrix over windows-latest and macos-latest, producing installable bundles for both platforms (Windows: NSIS .exe / MSI; macOS: .app / .dmg), plus a version-bump flow. Cross-compilation is not possible with Tauri, so each platform builds on its own runner. Code signing is explicitly out of scope for now: Windows bundles will trigger SmartScreen warnings and macOS bundles are unsigned/un-notarized (Gatekeeper requires right-click Open); document this in the README. Note: the macOS bundle only needs to build — runtime verification on macOS hardware is TASK-14's job.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Windows job produces an installable NSIS/MSI bundle attached as a release/CI artifact
- [x] #2 macOS job produces a .app/.dmg bundle attached as a release/CI artifact (build success only; runtime check deferred to TASK-14)
- [x] #3 Windows artifact installs and launches on Windows 11
- [x] #4 A documented version-bump flow keeps tauri.conf.json/package.json/Cargo.toml versions in sync with the tag
- [x] #5 README documents that bundles are unsigned (SmartScreen/Gatekeeper caveats)
- [x] #6 Pushing a version tag triggers a release workflow that builds on a windows-latest + macos-latest matrix
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-07-18 (pending on-device verification before Done).

- tauri.conf.json: removed literal version (Cargo.toml is now the single source of truth for the bundle version); bundle.targets changed to "all" (per-OS resolution: Windows nsis+msi, macOS app+dmg).
- .github/workflows/release.yml (new): tag push v* -> verify-version job (fails unless tag == Cargo.toml == package.json version) -> create-release job (github-script, draft release, outputs release_id) -> matrix build (windows-latest; macos-latest --target aarch64-apple-darwin) via tauri-apps/tauri-action@v0 with releaseId -> publish-release job flips draft to published. Draft-then-publish avoids the tauri-action matrix race; a failed leg leaves only a private draft. User decision: auto-publish on tag (no manual publish step); macOS build is Apple Silicon only (user's verification Mac is M-series).
- README: Download & install section with unsigned-binary caveats (SmartScreen / Gatekeeper right-click-Open). CONTRIBUTING: Releasing checklist (bump both files, tag vX.Y.Z, push). ARCHITECTURE: Release pipeline section.
- Reviewed by reviewer agent (2 passes): blocking release-race fixed, APPROVE. AC regression pass over Done tasks: no AC broken.

Remaining for Done: push a v0.1.0 tag, confirm both runners produce artifacts (AC1/2/6), install+launch NSIS/MSI on Windows 11 (AC3).

2026-07-18: First tag push (v0.1.0) failed — pnpm/action-setup@v4 in ci.yml/release.yml pinned 'version: 9', conflicting with package.json packageManager 'pnpm@9.15.0' (pre-existing bug: CI frontend job had been failing since 2026-07-15 for the same reason). Fixed by removing the version input from both workflows so the action resolves from packageManager. Draft-then-publish safety worked as designed: publish-release skipped, only a private draft was left. Needs re-tag of v0.1.0 after the fix commit.

2026-07-18: Re-run of the Release workflow succeeded end-to-end: published release 'OpenSoegaki v0.1.0' with all four assets (x64-setup.exe 2.0MB, x64 en-US.msi 3.1MB, aarch64.dmg 2.7MB, aarch64.app.tar.gz 2.6MB). Note: the first successful run's published release had been deleted during draft cleanup (drafts and the published release share the same name — delete only entries labeled Draft). ACs 1/2/4/5/6 verified by the real workflow run; AC 3 (install+launch on Windows 11) still pending.

AC #3 verified by the user on Windows 11 (2026-07-18): downloaded OpenSoegaki_0.1.0_x64-setup.exe from the published v0.1.0 release, SmartScreen warning appeared as documented (More info -> Run anyway), installed and launched successfully, app usable. All 6 ACs now verified; task Done.
<!-- SECTION:NOTES:END -->
