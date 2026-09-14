'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  click: () => ipcRenderer.send('pet:click'),
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  contextMenu: () => ipcRenderer.send('pet:context-menu'),
  setHover: (over) => ipcRenderer.send('pet:hover', over),
  onState: (cb) => ipcRenderer.on('pet:state', (_e, state) => cb(state)),
  onNotify: (cb) => ipcRenderer.on('pet:notify', () => cb()),
  onClearNotify: (cb) => ipcRenderer.on('pet:clear-notify', () => cb()),
});
