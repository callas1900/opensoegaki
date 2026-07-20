---
id: TASK-32
title: 'MCP server design spike: let AI drive annotation editing'
status: To Do
assignee: []
created_date: '2026-07-20 06:32'
labels:
  - ideas
dependencies: []
priority: medium
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Investigate how to expose OpenSoegaki to AI agents via MCP so an agent can programmatically add/edit annotations (arrows, rects, text, badges) on the open document. This is a design spike for the architect, not implementation: evaluate where the MCP server lives (in-process in the Tauri Rust core vs sidecar process), transport (stdio vs HTTP/SSE) and how a local client like Claude Code connects, what tool surface to expose first (annotation add/edit as the primary scope; capture/export later), and how this coexists with the object model in src/editor/model.ts and the Rust/TS responsibility split. Constraints: screenshots are sensitive — no network transmission of image data beyond the local MCP transport; keep the app light — challenge every new dependency. Output: a design note plus split follow-up implementation tasks.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Design note exists covering server placement, transport, and the initial tool surface (annotation add/edit)
- [ ] #2 Sensitive-data stance is addressed explicitly (image bytes never leave the machine)
- [ ] #3 Follow-up implementation tasks are created (or the idea is explicitly parked) based on the note
<!-- AC:END -->
