const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, cb) {
  const handler = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('backspin', {
  init: () => ipcRenderer.invoke('init'),
  onState: (cb) => subscribe('state', cb),
  onToast: (cb) => subscribe('toast', cb),
  setClientId: (id) => ipcRenderer.invoke('set-client-id', id),
  login: () => ipcRenderer.invoke('login'),
  cancelLogin: () => ipcRenderer.send('cancel-login'),
  resetClientId: () => ipcRenderer.send('reset-client-id'),
  control: (action) => ipcRenderer.send('control', action),
  openDashboard: () => ipcRenderer.send('open-dashboard'),
  copyRedirect: () => ipcRenderer.send('copy-redirect'),
  menu: () => ipcRenderer.send('menu'),
});
