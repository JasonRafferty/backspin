// Checks GitHub Releases for a newer version.
// Windows: downloads in the background and installs on restart (electron-updater).
// macOS: auto-install needs a code-signed app, so we just point you at the new download.
const { app, shell } = require('electron');

const REPO = 'JasonRafferty/backspin';
const CHECK_EVERY = 6 * 60 * 60 * 1000;

let onAvailable = () => {};
let winUpdater = null;

function isNewer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

async function check() {
  if (winUpdater) {
    winUpdater.checkForUpdates().catch((err) => console.warn('Update check failed:', err.message));
    return;
  }
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return;
    const release = await res.json();
    const version = String(release.tag_name || '').replace(/^v/, '');
    if (isNewer(version, app.getVersion())) onAvailable({ version, url: release.html_url });
  } catch {
    // Offline — try again next time.
  }
}

function start(callback) {
  if (!app.isPackaged) return; // nothing to update when running from source
  onAvailable = callback;
  if (process.platform === 'win32') {
    winUpdater = require('electron-updater').autoUpdater;
    winUpdater.on('update-downloaded', (info) => onAvailable({ version: info.version, ready: true }));
  }
  check();
  setInterval(check, CHECK_EVERY);
}

function install(update) {
  if (update.ready && winUpdater) winUpdater.quitAndInstall();
  else shell.openExternal(update.url);
}

module.exports = { start, install };
