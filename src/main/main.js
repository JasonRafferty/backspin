const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, nativeImage, screen, shell, clipboard,
} = require('electron');
const path = require('path');
const store = require('./store');
const auth = require('./auth');
const spotify = require('./spotify');
const updater = require('./updater');

const isMac = process.platform === 'darwin';
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const BASE_SIZE = { width: 300, height: 336 }; // the UI is designed at this size, then zoomed
const MIN_SCALE = 0.65;
const MAX_SCALE = 2;
// Hotkeys go through the turntable UI so they get the same animation + sounds as clicks.
const SHORTCUTS = {
  'CommandOrControl+Alt+Right': () => remote('next'),
  'CommandOrControl+Alt+Left': () => remote('prev'),
  'CommandOrControl+Alt+Down': () => remote('toggle'),
  'CommandOrControl+Alt+Up': () => toggleWindow(),
};

if (!app.requestSingleInstanceLock()) app.exit(0);

let win = null;
let tray = null;
let quitting = false;
let scale = clampScale(store.get('scale') ?? 1);
let resizeStart = null;
let savePositionTimer = null;
let update = null;
let ui = {
  phase: 'setup',
  busy: false,
  error: null,
  player: null,
  redirectUri: auth.REDIRECT_URI,
  settings: { sounds: store.get('sounds') !== false },
};

function clampScale(s) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Number(s) || 1));
}

function scaledSize() {
  return { width: Math.round(BASE_SIZE.width * scale), height: Math.round(BASE_SIZE.height * scale) };
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function remote(action) {
  send('remote', action);
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

function initialPosition({ width, height }) {
  const saved = store.get('position');
  if (saved) {
    const cx = saved.x + width / 2;
    const cy = saved.y + height / 2;
    const onScreen = screen.getAllDisplays().some(({ workArea: a }) =>
      cx >= a.x && cx <= a.x + a.width && cy >= a.y && cy <= a.y + a.height);
    if (onScreen) return saved;
  }
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - width - 24, y: a.y + a.height - height - 24 };
}

function applyScale(next) {
  scale = clampScale(next);
  const { x, y } = win.getBounds();
  win.setBounds({ x, y, ...scaledSize() });
  win.webContents.setZoomFactor(scale);
}

function createWindow() {
  const size = scaledSize();
  win = new BrowserWindow({
    ...size,
    ...initialPosition(size),
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
    acceptFirstMouse: true, // macOS: first click works even when the widget isn't focused
    title: 'Backspin',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      autoplayPolicy: 'no-user-gesture-required', // sound effects from global hotkeys
    },
  });

  win.setAlwaysOnTop(store.get('alwaysOnTop') !== false, 'floating');
  if (isMac) win.setVisibleOnAllWorkspaces(true);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(scale));
  win.once('ready-to-show', () => win.show());

  // Windows fires 'moved' continuously while dragging, so only save once things settle.
  win.on('moved', () => {
    clearTimeout(savePositionTimer);
    savePositionTimer = setTimeout(() => {
      const [x, y] = win.getPosition();
      store.set('position', { x, y });
    }, 400);
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
  const items = [];
  if (update) {
    items.push(
      {
        label: update.ready ? `Restart to Update (v${update.version})` : `Download Update (v${update.version})…`,
        click: () => updater.install(update),
      },
      { type: 'separator' },
    );
  }
  items.push(
    { label: win?.isVisible() ? 'Hide Backspin' : 'Show Backspin', click: toggleWindow },
    { type: 'separator' },
    { label: 'Play / Pause', enabled: ready, click: () => remote('toggle') },
    { label: 'Next Track', enabled: ready, click: () => remote('next') },
    { label: 'Previous Track', enabled: ready, click: () => remote('prev') },
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
      label: 'Sound Effects',
      type: 'checkbox',
      checked: ui.settings.sounds,
      click: (item) => {
        store.set('sounds', item.checked);
        setUi({ settings: { ...ui.settings, sounds: item.checked } });
      },
    },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
    },
    {
      label: 'Reset Size',
      enabled: scale !== 1,
      click: () => { applyScale(1); store.set('scale', 1); },
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
    { label: `Quit Backspin`, click: () => app.quit() },
  );
  return Menu.buildFromTemplate(items);
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
  ipcMain.on('control', (_e, action, arg) => spotify.control(action, arg));
  ipcMain.on('open-dashboard', () => shell.openExternal('https://developer.spotify.com/dashboard'));
  ipcMain.on('copy-redirect', () => clipboard.writeText(auth.REDIRECT_URI));
  ipcMain.on('menu', () => buildMenu().popup({ window: win }));

  // Resize grip: track the real cursor here, so page zoom doesn't skew the maths.
  ipcMain.on('resize-start', () => {
    resizeStart = { width: win.getBounds().width, cursor: screen.getCursorScreenPoint() };
  });
  ipcMain.on('resize-move', () => {
    if (!resizeStart) return;
    const c = screen.getCursorScreenPoint();
    const grow = Math.max(
      c.x - resizeStart.cursor.x,
      (c.y - resizeStart.cursor.y) * (BASE_SIZE.width / BASE_SIZE.height),
    );
    applyScale((resizeStart.width + grow) / BASE_SIZE.width);
  });
  ipcMain.on('resize-end', () => {
    resizeStart = null;
    store.set('scale', scale);
  });
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
  updater.start((available) => {
    update = available;
    send('toast', available.ready
      ? `Update v${available.version} ready — restart from the menu`
      : `Backspin v${available.version} is out — see the menu`);
  });
});
