'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, dialog, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { scanAll } = require('./scanner');

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';
const BLOCKED_PROTOCOLS = new Set(['file:', 'javascript:', 'data:', 'vbscript:', 'blob:']);
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

log.transports.file.level = 'info';
autoUpdater.logger = log;

let mainWindow = null;
let updaterStatus = { state: 'idle' };

/* ------------------------------------------------------------------ */
/* Saved data: profile, manually added games, favourites, play stats   */
/* ------------------------------------------------------------------ */

let data = { profile: { name: 'Player' }, manual: [], stats: {}, metaCache: {} };
const dataFile = () => path.join(app.getPath('userData'), 'library.json');

function loadData() {
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(dataFile(), 'utf8')) };
  } catch (err) {
    if (fs.existsSync(dataFile())) log.warn('library.json unreadable, starting fresh', err);
  }
}
function saveData() {
  try {
    fs.mkdirSync(path.dirname(dataFile()), { recursive: true });
    fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2));
  } catch (err) {
    log.error('Could not save library.json', err);
  }
}
function bumpStats(id, fn) {
  fn((data.stats[id] ||= {}));
  saveData();
}

/* ------------------------------------------------------------------ */
/* Library = detected store games + games the user added by hand       */
/* ------------------------------------------------------------------ */

let cache = { at: 0, scan: null };

function artFor(game) {
  if (game.store !== 'steam') return {};
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${game.appId}`;
  return { cover: `${base}/library_600x900.jpg`, hero: `${base}/library_hero.jpg`, header: `${base}/header.jpg` };
}

async function getLibrary(force) {
  if (force || !cache.scan || Date.now() - cache.at > 4000) {
    cache = { at: Date.now(), scan: await scanAll() };
  }
  const manual = data.manual.map((m) => ({
    ...m,
    store: 'manual',
    version: '',
    sizeBytes: 0,
    progress: 0,
    state: fs.existsSync(m.launch.target) ? 'installed' : 'missing',
  }));
  const games = [...cache.scan.games, ...manual].map((g) => {
    const s = data.stats[g.id] || {};
    return { ...g, art: artFor(g), favorite: !!s.favorite, lastPlayed: s.lastPlayed || null, playSeconds: Math.round(s.playSeconds || 0) };
  });
  return { games, stores: cache.scan.stores };
}

async function diskInfo(games) {
  const probe = games.find((g) => g.installPath && fs.existsSync(g.installPath))?.installPath || os.homedir();
  try {
    const s = await fs.promises.statfs(probe);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize, label: path.parse(probe).root || '/' };
  } catch {
    return null;
  }
}

const decodeEntities = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

// Description, developer and release date from Steam's public store page (Steam games only).
async function getMeta(game) {
  if (game.store !== 'steam') return null;
  if (game.appId in data.metaCache) return data.metaCache[game.appId];
  try {
    const res = await net.fetch(`https://store.steampowered.com/api/appdetails?appids=${game.appId}&l=english`);
    const d = (await res.json())?.[game.appId]?.data;
    const meta = d
      ? {
          description: decodeEntities(d.short_description || ''),
          developers: d.developers || [],
          publishers: d.publishers || [],
          releaseDate: d.release_date?.date || '',
          genres: (d.genres || []).slice(0, 4).map((x) => x.description),
        }
      : null;
    data.metaCache[game.appId] = meta;
    saveData();
    return meta;
  } catch (err) {
    log.warn('Could not fetch game details', err.message);
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Launching. The renderer sends only a game id; paths and URIs come   */
/* from the scanner or library.json, never from the web page.          */
/* ------------------------------------------------------------------ */

async function openPath(target) {
  const error = await shell.openPath(target);
  if (error) throw new Error(error);
}

async function openUri(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error('That link is not a valid URL.');
  }
  if (BLOCKED_PROTOCOLS.has(url.protocol)) throw new Error(`Links that start with ${url.protocol} are not allowed.`);
  await shell.openExternal(target);
}

async function launchGame(game) {
  const { type, target, cwd } = game.launch || {};
  if (type === 'uri') return openUri(target);
  if (type !== 'exe' || typeof target !== 'string' || !path.isAbsolute(target) || !fs.existsSync(target)) {
    throw new Error(`File not found: ${target}`);
  }
  if ((isMac && target.endsWith('.app')) || /\.(lnk|bat|cmd)$/i.test(target)) return openPath(target);

  try {
    await new Promise((resolve, reject) => {
      const child = spawn(target, [], { cwd: cwd || path.dirname(target), detached: true, stdio: 'ignore' });
      const started = Date.now();
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref(); // the game keeps running if the launcher closes
        resolve();
      });
      child.once('exit', () => bumpStats(game.id, (s) => (s.playSeconds = (s.playSeconds || 0) + (Date.now() - started) / 1000)));
    });
  } catch (err) {
    // Some games need admin rights; the OS shell can show the elevation prompt.
    log.warn('spawn failed, falling back to shell.openPath', err);
    await openPath(target);
  }
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

function handle(channel, fn) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!(event.senderFrame?.url || '').startsWith('file://')) throw new Error('Untrusted sender.');
    return fn(...args);
  });
}

async function attempt(fn) {
  try {
    return { ok: true, ...(await fn()) };
  } catch (err) {
    log.error(err);
    return { ok: false, error: err.message };
  }
}

async function findGame(id) {
  const game = (await getLibrary(false)).games.find((g) => g.id === String(id));
  if (!game) throw new Error('That game is no longer in your library.');
  return game;
}

const prettify = (name) => name.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim() || name;

function registerIpc() {
  handle('games:list', async (force) => {
    const { games, stores } = await getLibrary(!!force);
    return { games, stores, profile: data.profile, disk: await diskInfo(games) };
  });

  handle('games:launch', (id) =>
    attempt(async () => {
      const game = await findGame(id);
      await launchGame(game);
      bumpStats(game.id, (s) => (s.lastPlayed = Date.now()));
    })
  );

  handle('games:meta', async (id) => getMeta(await findGame(id)));

  handle('games:favorite', (id) => {
    let value = false;
    bumpStats(String(id), (s) => (value = s.favorite = !s.favorite));
    return value;
  });

  handle('games:add', () =>
    attempt(async () => {
      const filters = process.platform === 'win32' ? [{ name: 'Games and shortcuts', extensions: ['exe', 'lnk', 'bat'] }]
        : isMac ? [{ name: 'Applications', extensions: ['app'] }] : [];
      const result = await dialog.showOpenDialog(mainWindow, { title: 'Add a game', properties: ['openFile'], filters });
      if (result.canceled || !result.filePaths[0]) return { canceled: true };
      const target = result.filePaths[0];
      const id = 'manual:' + crypto.createHash('sha1').update(target.toLowerCase()).digest('hex').slice(0, 10);
      if (!data.manual.some((m) => m.id === id)) {
        data.manual.push({ id, title: prettify(path.parse(target).name), launch: { type: 'exe', target }, installPath: path.dirname(target) });
        saveData();
      }
      return { id };
    })
  );

  handle('games:remove', (id) =>
    attempt(async () => {
      data.manual = data.manual.filter((m) => m.id !== String(id));
      saveData();
      return {};
    })
  );

  handle('games:reveal', (id) =>
    attempt(async () => {
      const game = await findGame(id);
      if (game.launch.type === 'exe') shell.showItemInFolder(game.launch.target);
      else if (game.installPath && fs.existsSync(game.installPath)) await openPath(game.installPath);
      else throw new Error('The install folder was not found.');
      return {};
    })
  );

  handle('profile:setName', (name) => {
    data.profile.name = String(name).trim().slice(0, 40) || 'Player';
    saveData();
    return data.profile;
  });
  handle('library:openFolder', () => openPath(app.getPath('userData')));
  handle('app:version', () => app.getVersion());

  handle('win:minimize', () => mainWindow?.minimize());
  handle('win:maximize', () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()));
  handle('win:close', () => mainWindow?.close());

  handle('updater:status', () => updaterStatus);
  handle('updater:install', () => autoUpdater.quitAndInstall());
}

/* ------------------------------------------------------------------ */
/* Auto-update (electron-updater + GitHub Releases)                    */
/* ------------------------------------------------------------------ */

function setUpdaterStatus(patch) {
  updaterStatus = { ...updaterStatus, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:status', updaterStatus);
}

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    log.info('Updater: checking for update');
    setUpdaterStatus({ state: 'checking' });
  });
  autoUpdater.on('update-available', (info) => {
    log.info(`Updater: update available (${info.version})`);
    setUpdaterStatus({ state: 'available', version: info.version, percent: 0 });
  });
  autoUpdater.on('update-not-available', () => {
    log.info('Updater: already up to date');
    setUpdaterStatus({ state: 'idle' });
  });
  autoUpdater.on('download-progress', (p) => {
    log.info(`Updater: downloading ${Math.round(p.percent)}%`);
    setUpdaterStatus({ state: 'downloading', percent: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => {
    log.info(`Updater: ${info.version} downloaded, installs on restart`);
    setUpdaterStatus({ state: 'downloaded', version: info.version, percent: 100 });
  });
  autoUpdater.on('error', (err) => {
    log.error('Updater error', err);
    setUpdaterStatus({ state: 'error', message: String(err?.message || err) });
  });

  const check = () => autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error(err));
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0e0f11',
    title: 'Crescent',
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  mainWindow.on('closed', () => (mainWindow = null));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    if (!isMac) Menu.setApplicationMenu(null);
    loadData();
    registerIpc();
    createWindow();
    if (app.isPackaged) setupAutoUpdater(); // updates only work in installed builds

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
