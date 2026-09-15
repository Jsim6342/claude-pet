'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, payload) => cb(payload));

contextBridge.exposeInMainWorld('chat', {
  send: (text, images) => ipcRenderer.send('chat:send', { text, images }),
  setPermissionMode: (mode) => ipcRenderer.send('chat:permission-mode', mode),
  stop: () => ipcRenderer.send('chat:stop'),
  close: () => ipcRenderer.send('chat:close'),
  newSession: () => ipcRenderer.send('chat:new-session'),
  pickCwd: () => ipcRenderer.send('chat:pick-cwd'),
  listSessions: () => ipcRenderer.invoke('chat:list-sessions'),
  resumeSession: (sessionId, cwd) => ipcRenderer.send('chat:resume-session', { sessionId, cwd }),
  respondPermission: (id, decision) => ipcRenderer.send('chat:permission', { id, decision }),
  openExternal: (url) => ipcRenderer.send('chat:open-external', url),

  onEvent: on('chat:event'),
  onHistory: on('chat:history'),
  onLocal: on('chat:local'),
  onPermission: on('chat:permission'),
  onSession: on('chat:session'),
  onReset: on('chat:reset'),
  onNotice: on('chat:notice'),
  onAnchor: on('chat:anchor'),
  onOpenSessions: on('chat:open-sessions'),
  onFocusInput: on('chat:focus-input'),
});
