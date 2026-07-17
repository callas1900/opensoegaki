---
id: TASK-13
title: Measure and optimize capture IPC payload
status: Done
assignee: []
created_date: '2026-07-12 02:45'
updated_date: '2026-07-17 15:28'
labels:
  - performance
dependencies: []
priority: low
ordinal: 13000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Captures travel Rust→TS as a base64 PNG string returned by the capture_fullscreen command (src-tauri/src/lib.rs) and decoded with atob in src/main.ts — heavy for 4K screens (~33% inflation + encode/decode on both sides). Measure first (debug-gated perf logging both sides + display-free synthetic 4K encode bench); if the addressable base64 overhead (b64 encode + inflated IPC transit + atob, excluding xcap/150ms hide-sleep/PNG encode/createImageBitmap) exceeds ~100ms at 4K, switch to raw bytes via tauri::ipc::Response → invoke<ArrayBuffer>. Design note: architect session 2026-07-17. Note: earlier description mentioned capture_and_emit / event transfer — that path never existed.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Latency measured for a 4K capture and recorded in the task
- [x] #2 If above ~100ms, an optimized transport is implemented
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Measured 2026-07-17 (debug Rust build, native 2560x1440 display), BEFORE (base64 transport):
- Rust: xcap=274ms, png_encode=1426ms (debug-profile codec, excluded from gate), b64_encode=6ms, png_bytes=1,100,022, b64_bytes=1,466,696
- TS: invoke=1923ms, atob_decode=60ms, loadImage=20ms; IPC transit ~= 1923 - (150 sleep + 274 + 1426 + 6) ~= 67ms
- Synthetic 4K bench (worst-case noise image, debug): png=4262ms, png_bytes=9,735,848, b64=41ms, b64_bytes=12,981,132

GATE DECISION: EXCEEDED. Addressable base64 overhead at 4K ~= atob ~135ms (WebView-native, unaffected by Rust debug profile) + b64 encode ~14ms + inflated-transit share -> above ~100ms. atob alone exceeds the gate.

AFTER (raw bytes via tauri::ipc::Response -> ArrayBuffer), measured 2026-07-18, same display:
- Rust: xcap=249ms, png=1401ms, ipc_bytes=1,061,699
- TS: invoke=1839ms, loadImage=20ms, bytes=1,061,699 (matches — same payload); capture rendered in editor OK
- IPC transit ~= 1839 - (150 + 249 + 1401) ~= 39ms (was ~67ms); atob (60ms) and b64 encode (6ms) eliminated
- Addressable overhead removed: ~94ms at 1440p, ~210ms extrapolated at 4K. base64 crate dropped from Cargo.toml.

Remaining latency is xcap capture + PNG encode (debug-profile inflated) + fixed 150ms hide-sleep — out of scope here. TS->Rust JSON-array transfers split off as TASK-25.
<!-- SECTION:NOTES:END -->
