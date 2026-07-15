# OpenSoegaki

**Capture. Annotate. Share.** — A fast, lightweight, open-source screenshot annotation tool.

OpenSoegaki is a spiritual successor to the discontinued Skitch for Windows. It lives in
your system tray; shoot a screenshot with the OS tool (Win+Shift+S) and paste it in with
Ctrl+V to annotate it with arrows, boxes and text, then hand the result to any other app with
a single drag.

> **Status:** 🚧 Early development (MVP). Windows 11 first; macOS support is planned.

## Features (MVP scope)

- **Paste to annotate** — paste a screenshot from the clipboard with `Ctrl+V`; a
  **Capture** toolbar button is also available for the full screen
- **Annotate** — outlined arrows, rectangles, and text that stay readable on any background
- **Undo / Redo** — annotations are objects, not pixels, until you export
- **Share** — drag the tab at the bottom of the window straight into Slack, a browser,
  an email draft, or any drop target; or hit `Ctrl+C` to copy the PNG to the clipboard

## Why Tauri?

OpenSoegaki is built with [Tauri 2](https://tauri.app) (Rust core + TypeScript/Canvas UI):

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
| Paste screenshot        | `Ctrl+V`               |
| Copy result to clipboard| `Ctrl+C` (in editor)   |

## Project layout

```
src/           TypeScript frontend (annotation editor, capture overlay)
src-tauri/     Rust core (tray, screen capture, drag-out)
docs/          Architecture and design documents
.claude/       AI-assisted development configuration (Claude Code agents)
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design overview and
[CONTRIBUTING.md](CONTRIBUTING.md) if you'd like to help.

## Non-affiliation notice

OpenSoegaki is an independent open-source project. It is **not** affiliated with,
endorsed by, or connected to Evernote, Bending Spoons, or the Skitch product.
"Skitch" is a trademark of its respective owner; OpenSoegaki re-implements a similar
workflow with an original name, design, and codebase.

## License

[MIT](LICENSE)
