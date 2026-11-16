'use strict';

const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('overlay', {
  onStats: (callback) => ipcRenderer.on('overlay:stats', (_event, stats) => callback(stats)),
});
