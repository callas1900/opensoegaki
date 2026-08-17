# OpenSoegaki v0.3.0 Release Notes

Changes since v0.2.1.

## New: Magnifier (loupe) tool

- A new toolbar tool magnifies part of the picture and shows it enlarged somewhere else on the same picture, so one screenshot carries both the wide view and a readable close-up.
- To place one, pick the magnifier and press on the spot you want to enlarge, then slide: the source marker follows your finger or cursor while the lens rides alongside showing the live magnified content. Release to place it. A simple tap places one too.
- A beam is drawn from the source marker to the lens, so it is always obvious which part of the picture the close-up came from.
- **Two lens shapes.** Tapping the magnifier button again switches between a round lens and a rectangular one ("cube mode"); the button icon follows. The rectangular lens is meant for magnifying a line or strip of text.
- Drag the lens to move the close-up without changing what it shows; drag the source marker to change what is magnified without moving the lens. The source can be dragged even when the magnifier is not selected.
- Resize and zoom: the round lens resizes from its corner handles at a fixed zoom, and the grip on the source rim changes the magnification. The rectangular one resizes from the eight handles around its source, with a zoom grip on the lens corner. The current magnification is shown while the magnifier is selected, and never appears in the exported picture.
- Lens and source sizes are kept inside a range that stays comfortable to grab with a finger, and the lens cannot grow larger than the picture area allows.
- The magnifier stores no pixel copy: it samples the picture as it is drawn. Cropping, undo/redo and export all follow along automatically, and the exported PNG shows the magnified content at full resolution.

## Fixes

- **Text tool at the right edge (Windows):** clicking the text tool near the right edge of the canvas slid the whole image sideways. The canvas now stays put wherever the text box opens.

## Windows installer change

- Windows now ships **only** the `-setup.exe` (NSIS) installer; the `.msi` is no longer built.
- Reason: the MSI registered its Start Menu shortcut with an icon path inside the Windows Installer cache, which changes on every version — that is what made a taskbar pin show a blank icon. The `-setup.exe` shortcut points straight at the installed program, so the icon shows correctly and survives upgrades.
- **If you installed a previous version from the `.msi`:** unpin the app from the taskbar, uninstall it from Settings → Apps → Installed apps, install the `-setup.exe`, then pin it again. See the README for details.

## Quality improvements

- Test coverage grew to 471 unit tests and 44 iPhone-viewport browser tests, most of it covering the new magnifier geometry and gestures.
- `scripts/dev-windows.sh` and `scripts/build-windows.sh` now find the repository themselves instead of relying on a hardcoded path.
