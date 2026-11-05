'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// Only these functions are visible to the web page. ipcRenderer itself is never exposed.
contextBridge.exposeInMainWorld('launcher', {
  platform: process.platform,

  listGames: call('games:list'),
  launchGame: call('games:launch'),
  getMeta: call('games:meta'),
  toggleFavorite: call('games:favorite'),
  addGame: call('games:add'),
  removeGame: call('games:remove'),
  revealGame: call('games:reveal'),
  setProfileName: call('profile:setName'),
  openDataFolder: call('library:openFolder'),
  getAppVersion: call('app:version'),

  window: {
    minimize: call('win:minimize'),
    maximize: call('win:maximize'),
    close: call('win:close'),
  },

  getUpdateStatus: call('updater:status'),
  installUpdate: call('updater:install'),
  onUpdateStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.removeListener('updater:status', listener);
  },
});
