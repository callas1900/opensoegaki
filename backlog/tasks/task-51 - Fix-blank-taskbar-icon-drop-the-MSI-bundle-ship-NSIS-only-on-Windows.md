---
id: TASK-51
title: 'Fix blank taskbar icon: drop the MSI bundle, ship NSIS only on Windows'
status: In Progress
assignee: []
created_date: '2026-08-17 00:12'
updated_date: '2026-08-17 17:07'
labels:
  - platform
dependencies: []
priority: high
ordinal: 68000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Pinning the Windows app to the taskbar shows a blank/generic document icon (the tooltip still reads OpenSoegaki). RustDesk shows the same symptom; Chrome/Slack/Zed do not.

Measured root cause (read-only investigation on the users Windows 11 machine, 2026-08-17):
- The pinned .lnk sets its icon location to %SystemRoot%\Installer\{6A560632-...}\ProductIcon; that folder does not exist. The currently installed ProductCode is {612EB23B-...} and its C:\Windows\Installer\{...} folder does not exist either, so the Start Menu shortcut the MSI created is equally dangling.
- The MSI Shortcut table gives ApplicationStartMenuShortcut Icon_ = ProductIcon, while the desktop shortcut has no Icon_ and therefore renders fine from the exe.
- The MSI Icon table has a single row named "ProductIcon" - without the .ico extension Windows Installer requires for shortcut/ARPPRODUCTICON icons, so the icon is never extracted to the cache.
- The exe itself is healthy: RT_GROUP_ICON carries 16/24/32/48/64/128/256 entries and ExtractAssociatedIcon returns the real logo (dominant #ED107B). icon.ico is not the problem.
- RustDesk has the identical structure (%SystemRoot%\Installer\{FF8D35D4-...}\AppIcon, stale GUID), which is why it is the only other broken pin.
- Because Tauri regenerates the ProductCode per version, even a freshly working pin breaks at the next upgrade.

Decision (user, 2026-08-17): drop MSI and ship only the NSIS installer on Windows. NSIS shortcuts point directly at the installed exe, so the icon resolves from the binary and survives upgrades. The alternative - vendoring a custom WiX main.wxs to rename the Icon Id to ProductIcon.ico or drop Icon_ from the shortcut - was rejected: it would tie us to tracking Tauri template changes for a bundle format we do not need.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 A release build produces a Windows NSIS -setup.exe and no .msi
- [x] #2 After installing that build, the Start Menu shortcut icon location points at the installed opensoegaki.exe, not at %SystemRoot%\Installer\{...}
- [x] #3 The app pinned to the Windows 11 taskbar shows the OpenSoegaki logo, both while running and while closed
- [ ] #4 The icon survives an upgrade install to a later version without re-pinning
- [x] #5 README documents the msi-to-nsis migration step for existing users
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented 2026-08-17 (config + docs only):
- src-tauri/tauri.conf.json: bundle.targets "all" -> ["nsis", "app", "dmg"] (Tauri filters per OS; Windows now emits only the NSIS -setup.exe, macOS still emits .app/.dmg).
- docs/ARCHITECTURE.md "Release pipeline": documents the explicit target list and why MSI is excluded.
- README.md "Download & install": new "Upgrading from a .msi install (Windows)" subsection (unpin -> uninstall -> install -setup.exe -> re-pin).
- CI (.github/workflows/_build.yml, release.yml) unchanged: it uploads whatever tauri-action produces.

NOT verified in a real build/install yet. Remaining for Done: build on Windows (scripts/build-windows.sh), confirm bundle/ has nsis/ and no msi/, uninstall the existing MSI, install the -setup.exe, and check ACs 2/3/4 in the real shell.

2026-08-17 verification so far:
- AC#1 PASS (build-verified): pnpm tauri build on Windows finished with "Finished 1 bundle" -> only bundle/nsis/OpenSoegaki_0.2.1_x64-setup.exe. No new .msi (the msi/ dir only holds the stale 0.1.0 artifact from 2026-07-14).
- AC#2 proven at generator level: the generated src-tauri/target/release/nsis/x64/installer.nsi creates all three shortcuts as CreateShortcut "<...>.lnk" "$INSTDIR\${MAINBINARYNAME}.exe" with no icon argument, so the shell resolves the icon from the exe (whose RT_GROUP_ICON was verified healthy). Still needs the post-install .lnk check to be counted as exercised.
- AC#3/#4 not yet exercised: require uninstalling the existing MSI, installing the -setup.exe, pinning, and a later upgrade install.
- pnpm check clean.
Note: scripts/build-windows.sh still points at C:\Users\calla\Documents\opensoegaki, which does not exist (the local folder is still openscrawl); this build was run against the correct path directly. Unrelated to this task.

2026-08-17 (release prep for v0.3.0): scripts/build-windows.sh and scripts/dev-windows.sh no longer hardcode C:\Users\calla\Documents\opensoegaki — both derive the repo root from their own location and convert it with wslpath -w, so the stale-path note above no longer applies. Verified: bash -n on both, and the interop quoting resolves to C:\Users\calla\Documents\openscrawl with cargo on PATH.

2026-08-17: AC#2 and AC#3 device-verified by the user on Windows 11 with bundle/nsis/OpenSoegaki_0.2.1_x64-setup.exe (MSI uninstalled first, then pinned): the Start Menu shortcut's icon location points at the installed opensoegaki.exe and the taskbar pin shows the logo. AC#5 satisfied by the README 'Upgrading from a .msi install (Windows)' section. AC#4 (icon survives an upgrade install) is only testable once a later version exists - it will be checked by upgrade-installing the v0.3.0 -setup.exe after the release; the task stays In Progress until then.
<!-- SECTION:NOTES:END -->
