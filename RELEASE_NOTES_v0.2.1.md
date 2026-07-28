# OpenSoegaki v0.2.1 Release Notes

Changes since v0.1.2.

## New: OpenSoegaki Web (iPhone PWA)

- You can now install OpenSoegaki on iPhone as a web app. Add it to your Home Screen and it opens full-screen, like a normal app.
- The app works offline after you open it once online. Old cached versions are removed automatically when a new version is released.
- The web app deploys automatically to GitHub Pages with each release.
- You can pick a photo, save it with the iOS Share Sheet, and copy it (best effort on iOS).
- The interface is touch-friendly. Actions that used to need a keyboard now work with touch. Double-tap text to edit it again. The layout adjusts when the iOS keyboard opens.
- Annotations (lines, text, badges) scale automatically so they stay easy to see on large phone photos.
- Large photos (12+ megapixels) no longer cause a blank canvas on iOS.
- The welcome screen was redesigned as a clean empty state. Use "New Document" (Ctrl+N) to return to it at any time.
- The welcome screen now shows a privacy note, the app version, and a simple hint on how to add the app to your Home Screen.

## New editing features

- **Rotate tool**: rotate selected shapes (rectangles, images, text, badges) using a drag handle. Hold Shift to snap to 15-degree steps.
- **Fixed badge numbers**: a new number bar lets you pick a specific badge number instead of always using auto-numbering.
- Crop confirm/cancel now always returns you to the select tool correctly.

## Quality improvements

- Added automated browser tests that simulate an iPhone screen, run on every change.
- Made the welcome screen layout more reliable. If content does not fit on very small screens, you can now scroll to see it, instead of it being cut off.
