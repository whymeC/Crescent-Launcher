'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const listen = (channel) => (callback) => {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

// Only these functions are visible to the web page. ipcRenderer itself is never exposed.
contextBridge.exposeInMainWorld('launcher', {
  platform: process.platform,

  listGames: call('games:list'),
  launchGame: call('games:launch'),
  closeGame: call('games:close'),
  updateGame: call('games:update'),
  toggleFavorite: call('games:favorite'),
  addGame: call('games:add'),
  hideGame: call('games:hide'),
  unhideAll: call('games:unhideAll'),
  revealGame: call('games:reveal'),
  deepScan: call('scan:deep'),
  onScanProgress: listen('scan:progress'),
  onLibraryChanged: listen('library:changed'),
  onRunning: listen('games:running'),

  setSetting: call('settings:set'),
  clearCache: call('settings:clearCache'),
  setProfileName: call('profile:setName'),
  setStatus: call('profile:setStatus'),
  setBorder: call('profile:setBorder'),
  setGlow: call('profile:setGlow'),
  setUiTheme: call('profile:setUiTheme'),
  setAccent: call('accent:set'),
  addWidget: call('widgets:add'),
  removeWidget: call('widgets:remove'),
  createTag: call('tags:create'),
  deleteTag: call('tags:delete'),
  setGameTag: call('games:setTag'),
  onMilestone: listen('milestones:new'),
  setEdit: call('profile:setEdit'),
  setDim: call('profile:setDim'),
  setAfk: call('app:setAfk'),
  pauseUpdate: call('updates:pause'),
  resumeUpdate: call('updates:resume'),
  cancelUpdate: call('updates:cancel'),
  signInTool: call('updates:signIn'),
  updateTools: call('updates:tools'),
  onUpdateJobs: listen('updates:changed'),
  listThemes: call('themes:list'),
  setTheme: call('themes:set'),

  mediaBegin: call('media:begin'),
  mediaChunk: call('media:chunk'),
  mediaEnd: call('media:end'),
  mediaAbort: call('media:abort'),
  clearMedia: call('media:clear'),

  openDataFolder: call('library:openFolder'),
  getAppVersion: call('app:version'),
  copyText: call('clipboard:write'),
  getWhatsNew: call('app:whatsNew'),
  ackVersion: call('app:ackVersion'),
  window: { minimize: call('win:minimize'), maximize: call('win:maximize'), close: call('win:close') },

  getUpdateStatus: call('updater:status'),
  checkForUpdates: call('updater:check'),
  downloadUpdate: call('updater:download'),
  installUpdate: call('updater:install'),
  onUpdateStatus: listen('updater:status'),
});
