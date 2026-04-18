# resources/

This folder holds runtime assets bundled into the packaged app.

## cloakbrowser-windows-x64/ (NOT IN GIT — too large)

The patched Chromium binary (~526 MB) lives here in dev mode and gets copied
into the packaged app via `electron-builder`'s `extraResources` config.

It is **excluded from git** because of size. To set up a dev environment:

1. Download `cloakbrowser-windows-x64.zip` from
   <https://github.com/CloakHQ/cloakbrowser/releases>
   (current pinned version: `chromium-v145.0.7632.159.7`)
2. Extract so you end up with:
   ```
   resources/cloakbrowser-windows-x64/chrome.exe
   resources/cloakbrowser-windows-x64/...
   ```
3. Run `npm run dev` — the launcher auto-detects the extracted binary.

Or use the in-app **设置 → CloakBrowser 二进制** importer to point to a zip.

## presets/

Static fingerprint preset templates (small, in git).
