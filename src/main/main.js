const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, shell, clipboard,
} = require('electron');
const path = require('path');
const store = require('./store');
const auth = require('./auth');
const spotify = require('./spotify');

const isMac = process.platform === 'darwin';
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const WIN_SIZE = { width: 300, height: 336 };
const SHORTCUTS = {
  'CommandOrControl+Alt+Right': () => spotify.control('next'),
  'CommandOrControl+Alt+Left': () => spotify.control('prev'),
  'CommandOrControl+Alt+Down': () => spotify.control('toggle'),
  'CommandOrControl+Alt+Up': () => toggleWindow(),
};

if (!app.requestSingleInstanceLock()) app.exit(0);

let win = null;
let tray = null;
let quitting = false;
let ui = { phase: 'setup', busy: false, error: null, player: null, redirectUri: auth.REDIRECT_URI };

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function setUi(patch) {
  ui = { ...ui, ...patch };
  send('state', ui);
}

function syncPhase() {
  const phase = !store.get('clientId') ? 'setup' : auth.isLoggedIn() ? 'ready' : 'login';
  if (phase === 'ready') {
    setUi({ phase });
    spotify.start();
  } else {
    spotify.stop();
    setUi({ phase, player: null });
  }
}

function initialPosition() {
  const saved = store.get('position');
  if (saved) {
    const cx = saved.x + WIN_SIZE.width / 2;
    const cy = saved.y + WIN_SIZE.height / 2;
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height);
    if (onScreen) return saved;
  }
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - WIN_SIZE.width - 24, y: a.y + a.height - WIN_SIZE.height - 24 };
}

function createWindow() {
  const { x, y } = initialPosition();
  win = new BrowserWindow({
    ...WIN_SIZE,
    x,
    y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    show: false,
    title: 'Backspin',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  win.setAlwaysOnTop(store.get('alwaysOnTop') !== false, 'floating');
  if (isMac) win.setVisibleOnAllWorkspaces(true);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());

  win.on('moved', () => {
    const [px, py] = win.getPosition();
    store.set('position', { x: px, y: py });
  });
  win.on('show', () => spotify.setVisible(true));
  win.on('hide', () => spotify.setVisible(false));
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win.hide();
    }
  });
  // Right-clicking a drag area on Windows normally shows the system menu; show ours instead.
  win.on('system-context-menu', (e) => {
    e.preventDefault();
    buildMenu().popup({ window: win });
  });
  // Links (e.g. the developer dashboard) open in the real browser, never inside the widget.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function showWindow() {
  if (!win) return;
  win.show();
  win.focus();
}

function toggleWindow() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else showWindow();
}

function buildMenu() {
  const ready = ui.phase === 'ready';
  return Menu.buildFromTemplate([
    { label: win?.isVisible() ? 'Hide Backspin' : 'Show Backspin', click: toggleWindow },
    { type: 'separator' },
    { label: 'Play / Pause', enabled: ready, click: () => spotify.control('toggle') },
    { label: 'Next Track', enabled: ready, click: () => spotify.control('next') },
    { label: 'Previous Track', enabled: ready, click: () => spotify.control('prev') },
    { type: 'separator' },
    {
      label: 'Always on Top',
      type: 'checkbox',
      checked: store.get('alwaysOnTop') !== false,
      click: (item) => {
        store.set('alwaysOnTop', item.checked);
        win.setAlwaysOnTop(item.checked, 'floating');
      },
    },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    { type: 'separator' },
    {
      label: 'Log Out of Spotify',
      enabled: auth.isLoggedIn(),
      click: () => { auth.logout(); syncPhase(); },
    },
    {
      label: 'Change Client ID…',
      click: () => { resetClientId(); showWindow(); },
    },
    { type: 'separator' },
    { label: 'Quit Backspin', click: () => app.quit() },
  ]);
}

function resetClientId() {
  auth.cancelLogin();
  auth.logout();
  store.set('clientId', null);
  syncPhase();
}

function createTray() {
  let icon;
  if (isMac) {
    icon = nativeImage.createFromPath(path.join(ASSETS, 'trayTemplate.png'));
    icon.setTemplateImage(true);
  } else {
    icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  }
  tray = new Tray(icon);
  tray.setToolTip('Backspin');
  if (isMac) {
    tray.on('click', () => tray.popUpContextMenu(buildMenu()));
  } else {
    tray.on('click', toggleWindow);
    tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));
  }
}

function registerShortcuts() {
  for (const [accelerator, fn] of Object.entries(SHORTCUTS)) {
    if (!globalShortcut.register(accelerator, fn)) {
      console.warn(`Shortcut ${accelerator} is taken by another app`);
    }
  }
}

function registerIpc() {
  ipcMain.handle('init', () => ui);
  ipcMain.handle('set-client-id', (_e, value) => {
    const id = String(value || '').trim();
    if (!/^[0-9a-f]{32}$/i.test(id)) {
      return { ok: false, error: 'That doesn’t look like a Client ID (32 letters and numbers).' };
    }
    auth.logout();
    store.set('clientId', id);
    syncPhase();
    return { ok: true };
  });
  ipcMain.handle('login', async () => {
    setUi({ busy: true, error: null });
    try {
      await auth.login();
      setUi({ busy: false });
      syncPhase();
    } catch (err) {
      setUi({ busy: false, error: err.cancelled ? null : err.message });
    }
  });
  ipcMain.on('cancel-login', () => auth.cancelLogin());
  ipcMain.on('reset-client-id', resetClientId);
  ipcMain.on('control', (_e, action) => spotify.control(action));
  ipcMain.on('open-dashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));
  ipcMain.on('copy-redirect', () => clipboard.writeText(auth.REDIRECT_URI));
  ipcMain.on('menu', () => buildMenu().popup({ window: win }));
}

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* keep running in the tray */ });

app.whenReady().then(() => {
  if (isMac) app.dock?.hide();
  spotify.init({
    onPlayer: (player) => setUi({ player }),
    onLoggedOut: () => syncPhase(),
    onToast: (message) => send('toast', message),
  });
  registerIpc();
  createWindow();
  createTray();
  registerShortcuts();
  syncPhase();
});
