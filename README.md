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

Spotify Premium is required for skip / play / pause.

## Controls

| Action | How |
| --- | --- |
| Next / previous | Flick or spin the record clockwise / anticlockwise, scroll over it, or the ◀ ▶ buttons |
| Play / pause | Click the album label |
| Global hotkeys | `⌘⌥→` `⌘⌥←` `⌘⌥↓` (play/pause) `⌘⌥↑` (show/hide) — `Ctrl+Alt+…` on Windows |
| Menu | Right-click the widget, or the menu bar / tray icon |
| Move it | Drag the turntable body |

## Building an installer

Build on the machine you're targeting:

- macOS: `npm run dist:mac` → `dist/Backspin-*.dmg`
- Windows: `npm run dist:win` → `dist/Backspin Setup *.exe`

The builds aren't code-signed, so the first launch shows a security warning
(macOS: right-click → Open; Windows: "More info" → "Run anyway").

## Code map

- `src/main/main.js` — window, tray, hotkeys, IPC
- `src/main/auth.js` — Spotify PKCE login + token refresh
- `src/main/spotify.js` — polling now-playing + playback commands
- `src/main/store.js` — settings file; refresh token encrypted with the OS keychain
- `src/renderer/` — the turntable UI
- `scripts/make-icons.js` — regenerates the icons in `assets/`
