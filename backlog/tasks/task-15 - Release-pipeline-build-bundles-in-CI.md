---
id: TASK-15
title: 'Release pipeline: matrix build (Windows + macOS) in CI'
status: To Do
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-17 07:07'
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
- [ ] #1 Windows job produces an installable NSIS/MSI bundle attached as a release/CI artifact
- [ ] #2 macOS job produces a .app/.dmg bundle attached as a release/CI artifact (build success only; runtime check deferred to TASK-14)
- [ ] #3 Windows artifact installs and launches on Windows 11
- [ ] #4 A documented version-bump flow keeps tauri.conf.json/package.json/Cargo.toml versions in sync with the tag
- [ ] #5 README documents that bundles are unsigned (SmartScreen/Gatekeeper caveats)
- [ ] #6 Pushing a version tag triggers a release workflow that builds on a windows-latest + macos-latest matrix
<!-- AC:END -->
