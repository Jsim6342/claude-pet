'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('chat', {
  send: (text) => ipcRenderer.send('chat:send', text),
  stop: () => ipcRenderer.send('chat:stop'),
  close: () => ipcRenderer.send('chat:close'),
  newSession: () => ipcRenderer.send('chat:new-session'),
  pickCwd: () => ipcRenderer.send('chat:pick-cwd'),
  respondPermission: (id, decision) => ipcRenderer.send('chat:permission', { id, decision }),
  openExternal: (url) => ipcRenderer.send('chat:open-external', url),

  onEvent: on('chat:event'),
  onHistory: on('chat:history'),
  onPermission: on('chat:permission'),
  onSession: on('chat:session'),
  onReset: on('chat:reset'),
  onNotice: on('chat:notice'),
  onAnchor: on('chat:anchor'),
  onFocusInput: on('chat:focus-input'),
});
