# OpenScrawl

**Capture. Scrawl. Share.** — A fast, lightweight, open-source screenshot annotation tool.

OpenScrawl is a spiritual successor to the discontinued Skitch for Windows. It lives in
your system tray, captures your screen with a hotkey, lets you scrawl arrows, boxes and
text on it, and hands the result to any other app with a single drag.

> **Status:** 🚧 Early development (MVP). Windows 11 first; macOS support is planned.

## Features (MVP scope)

- **Capture** — region-select and full-screen capture via a global hotkey
- **Annotate** — outlined arrows, rectangles, and text that stay readable on any background
- **Undo / Redo** — annotations are objects, not pixels, until you export
- **Share** — drag the tab at the bottom of the window straight into Slack, a browser,
  an email draft, or any drop target; or hit `Ctrl+C` to copy the PNG to the clipboard

## Why Tauri?

OpenScrawl is built with [Tauri 2](https://tauri.app) (Rust core + TypeScript/Canvas UI):

- ~10 MB installer and low idle memory — right-sized for an always-resident tray utility
- Screen capture handled natively in Rust via [`xcap`](https://crates.io/crates/xcap)
- The same codebase targets Windows, macOS and Linux, keeping the door open for the
  planned macOS release

## Getting started (development)

Prerequisites:

- [Rust](https://rustup.rs/) (stable)
- [Node.js](https://nodejs.org/) 20+ and [pnpm](https://pnpm.io/) 9+
- Windows 11: WebView2 is preinstalled; nothing extra needed
- See the [Tauri prerequisites](https://tauri.app/start/prerequisites/) for other platforms

```sh
pnpm install
pnpm tauri dev
```

Build a release bundle:

```sh
pnpm tauri build
```

## Default hotkeys

| Action                  | Shortcut               |
| ----------------------- | ---------------------- |
| Region capture          | `Ctrl+Shift+5`         |
| Full-screen capture     | `Ctrl+Shift+6`         |
| Copy result to clipboard| `Ctrl+C` (in editor)   |

## Project layout

```
src/           TypeScript frontend (annotation editor, capture overlay)
src-tauri/     Rust core (tray, hotkeys, screen capture, drag-out)
docs/          Architecture and design documents
.claude/       AI-assisted development configuration (Claude Code agents)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design overview and
[CONTRIBUTING.md](CONTRIBUTING.md) if you'd like to help.

## Non-affiliation notice

OpenScrawl is an independent open-source project. It is **not** affiliated with,
endorsed by, or connected to Evernote, Bending Spoons, or the Skitch product.
"Skitch" is a trademark of its respective owner; OpenScrawl re-implements a similar
workflow with an original name, design, and codebase.

## License

[MIT](LICENSE)
