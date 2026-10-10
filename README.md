# Backspin

A little spinning record player for your desktop. It shows the album art of whatever you're
playing on Spotify and lets you skip tracks fast. Runs on macOS and Windows.

## Setup (once per computer)

1. `npm install`
   - If npm says it skipped Electron's install script, run `node node_modules/electron/install.js`.
2. `npm start`
3. The widget walks you through connecting Spotify:
   - Create an app at https://developer.spotify.com/dashboard (tick **Web API**)
   - Add the Redirect URI `http://127.0.0.1:8888/callback`
   - Paste the app's Client ID, then log in in your browser

Spotify Premium is required for skip / play / pause / seek.

## Controls

| Action | How |
| --- | --- |
| Next / previous | Spin or flick the record clockwise / anticlockwise (the next cover peeks in as you spin), scroll over it, or ◀ ▶ |
| Play / pause | The big button, or click the album label |
| Seek | Drag the tonearm across the record — lift it back to its rest to pause |
| Global hotkeys | `⌘⌥→` `⌘⌥←` `⌘⌥↓` (play/pause) `⌘⌥↑` (show/hide) — `Ctrl+Alt+…` on Windows |
| Resize | Drag the grip in the bottom-right corner |
| Menu | Right-click the widget, or the menu bar / tray icon (sound effects, always on top, launch at login…) |
| Move it | Drag the turntable body |

## Releasing a new version

```
npm version patch        # bumps the version and tags it
git push --follow-tags
```

GitHub Actions builds the Mac (`.dmg`) and Windows (`.exe`) installers and publishes them as a
GitHub Release. Installed copies check for updates: Windows downloads and installs on restart;
macOS shows a "Download Update" item in the menu (auto-install on Mac needs a paid Apple
code-signing certificate).

The builds aren't code-signed, so the first launch shows a security warning
(macOS: right-click → Open; Windows: "More info" → "Run anyway").

## Code map

- `src/main/main.js` — window, tray, hotkeys, resizing, IPC
- `src/main/auth.js` — Spotify PKCE login + token refresh
- `src/main/spotify.js` — polling now-playing, queue/history for peeking, playback commands
- `src/main/updater.js` — update checks against GitHub Releases
- `src/main/store.js` — settings file; refresh token encrypted with the OS keychain
- `src/renderer/` — the turntable UI and synthesised sound effects
- `scripts/make-icons.js` — regenerates the icons in `assets/`
