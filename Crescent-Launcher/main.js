'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, dialog, net, protocol, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { spawn, execFile } = require('node:child_process');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { scanAll, normName } = require('./scanner');
const { deepScan } = require('./deepscan');
const { listProcesses, matchGame, stopProcesses } = require('./tracker');

// Our own address type for the user's pictures/videos and the bundled wallpapers.
protocol.registerSchemesAsPrivileged([
  { scheme: 'crescent', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

const isDev = process.argv.includes('--dev');
const isMac = process.platform === 'darwin';
const BLOCKED_PROTOCOLS = new Set(['file:', 'javascript:', 'data:', 'vbscript:', 'blob:']);
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const DEEP_SCAN_MAX_AGE_MS = 12 * 60 * 60 * 1000;

// The folders "videos" and "images" sit next to package.json (and next to the app's resources once installed).
const themeRoot = () => (app.isPackaged ? process.resourcesPath : __dirname);
const mediaDir = () => path.join(app.getPath('userData'), 'media');

const THEMES = {
  animated: [
    { id: 'night-sky', name: 'Night Sky', file: 'NightSky.mp4' },
    { id: 'aurora-borealis', name: 'Aurora Borealis', file: 'AuroraBorealis.mp4' },
    { id: 'milkyway', name: 'Milkyway', file: 'Milkyway.mp4' },
    { id: 'singularity', name: 'Singularity', file: 'Singularity.mp4' },
  ],
  still: [
    { id: 'natures-creativity', name: "Nature's Creativity", file: 'NaturesCreativity.png' },
    { id: 'snowy-mountains', name: 'Snowy Mountains', file: 'SnowyMountains.png' },
    { id: 'great-wave', name: 'The Great Wave off Kanagawa', file: 'TheGreatWaveoffKanagawa.png' },
    { id: 'mount-fuji', name: 'Mount Fuji', file: 'MountFuji.png' },
  ],
};
const THEME_DIR = { animated: 'videos', still: 'images' };

log.transports.file.level = 'info';
autoUpdater.logger = log;

let mainWindow = null;
let updaterStatus = { state: 'idle' };
const send = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

/* ------------------------------------------------------------------ */
/* Saved data                                                          */
/* ------------------------------------------------------------------ */

const DEFAULT_SETTINGS = {
  startWithWindows: false, minimizeOnGameStart: false, topGamesLayout: 'list', friendsHidden: false,
  autoScan: true, deepScan: true, trackPlaytime: true,
  autoCheckUpdates: true, autoDownloadUpdates: true, showUpdateLogs: true, notifyGameUpdates: true,
};
const DEFAULTS = () => ({
  profile: { name: 'Player', avatar: null, banner: null, theme: { type: 'none', id: null } },
  settings: { ...DEFAULT_SETTINGS },
  manual: [], hidden: [], stats: {}, metaCache: {},
  deepFound: { at: 0, games: [] }, lastSeenVersion: null,
});

let data = DEFAULTS();
let hadData = false;
const dataFile = () => path.join(app.getPath('userData'), 'library.json');

function loadData() {
  const base = DEFAULTS();
  hadData = fs.existsSync(dataFile());
  try {
    const saved = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
    data = {
      ...base, ...saved,
      profile: { ...base.profile, ...saved.profile },
      settings: { ...base.settings, ...saved.settings },
      deepFound: { ...base.deepFound, ...saved.deepFound },
    };
  } catch (err) {
    if (hadData) log.warn('library.json unreadable, starting fresh', err);
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
/* Game info from the internet: Steam first, then a Steam search by    */
/* name, then Wikipedia. Results are cached.                           */
/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const decodeEntities = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function getJson(url) {
  const res = await net.fetch(url, { headers: { 'user-agent': 'Crescent-Launcher' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function steamArt(appId) {
  const base = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}`;
  return { cover: `${base}/library_600x900.jpg`, hero: `${base}/library_hero.jpg`, header: `${base}/header.jpg` };
}

async function steamSearch(title) {
  const j = await getJson(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&l=english&cc=US`);
  const t = normName(title);
  const items = j.items || [];
  const hit =
    items.find((i) => normName(i.name) === t) ||
    items.find((i) => { const n = normName(i.name); return t.length >= 6 && n.length >= 6 && (n.startsWith(t) || t.startsWith(n)); });
  return hit?.id ? String(hit.id) : null;
}

async function steamDetails(appId) {
  const d = (await getJson(`https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`))?.[appId]?.data;
  if (!d) return null;
  return {
    description: decodeEntities(d.short_description || ''),
    developers: d.developers || [], publishers: d.publishers || [],
    releaseDate: d.release_date?.date || '',
    genres: (d.genres || []).slice(0, 4).map((x) => x.description),
  };
}

async function wikipedia(title) {
  const url =
    'https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=3&prop=extracts|pageimages' +
    `&exintro=1&explaintext=1&exsentences=3&piprop=original&redirects=1&gsrsearch=${encodeURIComponent(title + ' video game')}`;
  const pages = Object.values((await getJson(url)).query?.pages || {}).sort((a, b) => a.index - b.index);
  const t = normName(title);
  const page = pages.find((p) => {
    const pn = normName(p.title.replace(/\(.*?\)/g, ''));
    return pn.length >= 4 && (pn === t || pn.includes(t) || t.includes(pn));
  });
  return page ? { description: page.extract || '', image: page.original?.source || null } : null;
}

// Throws on network problems (so nothing is cached), returns null when nothing was found.
async function fetchMeta(game) {
  const appId = game.store === 'steam' ? game.appId : await steamSearch(game.title);
  let meta = null;
  if (appId) {
    const d = await steamDetails(appId);
    if (d) meta = { ...d, art: steamArt(appId) };
  }
  if (!meta?.description || !meta?.art) {
    const w = await wikipedia(game.title);
    if (w) {
      meta ||= { description: '', developers: [], publishers: [], releaseDate: '', genres: [] };
      meta.description ||= w.description;
      if (!meta.art && w.image) meta.art = { cover: w.image, hero: w.image, header: w.image };
    }
  }
  return meta;
}

let enriching = false;
async function enrich(games) {
  const stale = 7 * 864e5;
  const todo = games.filter((g) => { const m = data.metaCache[g.id]; return !m || (m.none && Date.now() - m.at > stale); });
  if (enriching || !todo.length) return;
  enriching = true;
  try {
    let n = 0;
    for (const g of todo) {
      try {
        const meta = await fetchMeta(g);
        data.metaCache[g.id] = meta ? { ...meta, at: Date.now() } : { none: true, at: Date.now() };
      } catch (err) {
        log.warn(`Game info for ${g.title} unavailable right now`, err.message);
        continue; // offline or rate limited: try again next time
      }
      if (++n % 3 === 0) { saveData(); send('library:changed'); }
      await sleep(400);
    }
    saveData();
    send('library:changed');
  } finally {
    enriching = false;
  }
}

/* ------------------------------------------------------------------ */
/* Library = store scans + games found on the drives + manual games    */
/* ------------------------------------------------------------------ */

let cache = { at: 0, scan: null };
const running = new Map(); // game id -> [pids]
let scanState = { active: false, text: '' };

async function getLibrary(force) {
  if (force || !cache.scan || Date.now() - cache.at > 4000) cache = { at: Date.now(), scan: await scanAll() };
  const hidden = new Set(data.hidden);

  const manual = data.manual.map((m) => ({
    ...m, store: 'manual', version: '', sizeBytes: 0, progress: 0,
    state: fs.existsSync(m.launch.target) ? 'installed' : 'missing',
  }));
  const detected = (data.deepFound.games || []).filter((d) => fs.existsSync(d.exe)).map((d) => ({
    id: d.id, store: 'detected', title: d.title, version: '',
    launch: { type: 'exe', target: d.exe, cwd: path.dirname(d.exe) },
    installPath: d.installPath, sizeBytes: 0, state: 'installed', progress: 0,
  }));

  const seen = new Set();
  const games = [];
  for (const g of [...cache.scan.games, ...manual, ...detected]) {
    if (hidden.has(g.id) || seen.has(g.id)) continue;
    seen.add(g.id);
    const s = data.stats[g.id] || {};
    const m = data.metaCache[g.id];
    const meta = m && !m.none ? m : null;
    games.push({
      ...g,
      meta: meta ? { description: meta.description, developers: meta.developers, publishers: meta.publishers, releaseDate: meta.releaseDate, genres: meta.genres } : null,
      art: g.store === 'steam' ? steamArt(g.appId) : meta?.art || {},
      favorite: !!s.favorite, lastPlayed: s.lastPlayed || null, playSeconds: Math.round(s.playSeconds || 0),
    });
  }
  const stores = { ...cache.scan.stores, detected: { found: data.deepFound.at > 0, count: detected.length } };
  return { games, stores };
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

function publicProfile() {
  const p = data.profile;
  return {
    name: p.name,
    avatarUrl: p.avatar ? `crescent://media/${p.avatar}` : null,
    banner: p.banner ? { url: `crescent://media/${p.banner.file}`, type: p.banner.type, width: p.banner.width, height: p.banner.height } : null,
    theme: p.theme,
  };
}

async function buildList(force) {
  const { games, stores } = await getLibrary(force);
  enrich(games); // fills in descriptions and artwork in the background
  return { games, stores, profile: publicProfile(), settings: data.settings, disk: await diskInfo(games), running: [...running.keys()], scan: scanState };
}

async function findGame(id) {
  const game = (await getLibrary(false)).games.find((g) => g.id === String(id));
  if (!game) throw new Error('That game is no longer in your library.');
  return game;
}

/* ---------------- searching every drive ---------------- */

async function runDeepScan() {
  if (scanState.active) return;
  scanState = { active: true, text: 'Starting…' };
  send('scan:progress', scanState);
  try {
    const lib = await getLibrary(false);
    const known = lib.games.filter((g) => g.store !== 'detected').flatMap((g) => [g.installPath, path.dirname(g.launch?.target || '')]);
    const found = await deepScan({
      known,
      onProgress: (dir) => { scanState.text = dir; send('scan:progress', scanState); },
      shouldStop: () => app.isQuitting,
    });
    data.deepFound = { at: Date.now(), games: found };
    saveData();
    log.info(`Deep scan finished: ${found.length} extra games`);
  } catch (err) {
    log.error('Deep scan failed', err);
  } finally {
    scanState = { active: false, text: '' };
    send('scan:progress', scanState);
    cache.at = 0;
    send('library:changed');
  }
}

/* ------------------------------------------------------------------ */
/* Launching, closing, updating                                        */
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

const spawnDetached = (cmd, args, cwd) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });

async function launchGame(game) {
  const { type, target, cwd } = game.launch || {};
  const args = Array.isArray(game.launch?.args) ? game.launch.args.map(String) : [];

  if (type === 'uri') return openUri(target);
  if (type === 'appx') return spawnDetached('explorer.exe', [`shell:AppsFolder\\${target}`]);
  if (type !== 'exe' || typeof target !== 'string' || !path.isAbsolute(target) || !fs.existsSync(target)) {
    throw new Error(`File not found: ${target}`);
  }
  if ((isMac && target.endsWith('.app')) || /\.(lnk|bat|cmd)$/i.test(target)) return openPath(target);
  try {
    await spawnDetached(target, args, cwd || path.dirname(target));
  } catch (err) {
    // Some games need admin rights; the OS shell can show the elevation prompt.
    log.warn('spawn failed, falling back to shell.openPath', err);
    await openPath(target);
  }
}

// Looks at the running programs every few seconds: counts play time and notices when games start or stop.
let lastTick = Date.now();
async function trackerTick() {
  const now = Date.now();
  const dt = Math.min((now - lastTick) / 1000, 30);
  lastTick = now;
  try {
    const [{ games }, procs] = await Promise.all([getLibrary(false), listProcesses()]);
    const next = new Map();
    for (const g of games) {
      if (g.state === 'missing') continue;
      const hits = matchGame(g, procs);
      if (hits.length) next.set(g.id, hits.map((p) => p.pid));
    }
    let changed = next.size !== running.size;
    for (const [id] of next) {
      if (!running.has(id)) {
        changed = true;
        bumpStats(id, (s) => (s.lastPlayed = now));
        if (data.settings.minimizeOnGameStart && mainWindow) mainWindow.minimize();
      }
      if (data.settings.trackPlaytime) bumpStats(id, (s) => (s.playSeconds = (s.playSeconds || 0) + dt));
    }
    running.clear();
    for (const [id, pids] of next) running.set(id, pids);
    if (changed || next.size) send('games:running', [...running.keys()]);
  } catch (err) {
    log.warn('Tracker tick failed', err.message);
  }
}

/* ------------------------------------------------------------------ */
/* Uploaded pictures and videos                                        */
/* ------------------------------------------------------------------ */

const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm' };
const MAX_UPLOAD = 120 * 1024 * 1024;
const uploads = new Map();

function serveFile(file, req) {
  let stat;
  try { stat = fs.statSync(file); } catch { return new Response('Not found', { status: 404 }); }
  const type = MIME[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream';
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), stat.size - 1) : stat.size - 1;
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), {
      status: 206,
      headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${stat.size}`, 'accept-ranges': 'bytes' },
    });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { headers: { 'content-type': type, 'content-length': String(stat.size), 'accept-ranges': 'bytes' } });
}

function registerMediaProtocol() {
  protocol.handle('crescent', (req) => {
    const url = new URL(req.url);
    const parts = decodeURIComponent(url.pathname).split('/').filter(Boolean);
    if (url.hostname === 'media' && parts.length === 1) return serveFile(path.join(mediaDir(), path.basename(parts[0])), req);
    if (url.hostname === 'theme' && parts.length === 2 && ['videos', 'images'].includes(parts[0])) {
      return serveFile(path.join(themeRoot(), parts[0], path.basename(parts[1])), req);
    }
    return new Response('Not found', { status: 404 });
  });
}

const removeMedia = (file) => file && fs.rm(path.join(mediaDir(), path.basename(file)), { force: true }, () => {});

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
    return { ok: true, ...((await fn()) || {}) };
  } catch (err) {
    log.error(err);
    return { ok: false, error: err.message };
  }
}

const prettify = (name) => name.replace(/[-_.]+/g, ' ').replace(/\s+/g, ' ').trim() || name;
const semver = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
const cmpVer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

function registerIpc() {
  handle('games:list', (force) => buildList(!!force));

  handle('games:launch', (id) => attempt(async () => { await launchGame(await findGame(id)); }));

  handle('games:close', (id) => attempt(async () => {
    const pids = running.get(String(id));
    if (!pids?.length) throw new Error('This game is not running.');
    stopProcesses(pids);
  }));

  handle('games:update', (id) => attempt(async () => {
    const game = await findGame(id);
    if (game.store !== 'steam') throw new Error('Updates for this game are handled inside its own launcher.');
    await openUri(`steam://install/${game.appId}`);
  }));

  handle('games:favorite', (id) => {
    let value = false;
    bumpStats(String(id), (s) => (value = s.favorite = !s.favorite));
    return value;
  });

  handle('games:add', () => attempt(async () => {
    const filters = process.platform === 'win32' ? [{ name: 'Games and shortcuts', extensions: ['exe', 'lnk', 'bat'] }]
      : isMac ? [{ name: 'Applications', extensions: ['app'] }] : [];
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Add a game', properties: ['openFile'], filters });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const target = result.filePaths[0];
    const id = 'manual:' + crypto.createHash('sha1').update(target.toLowerCase()).digest('hex').slice(0, 10);
    data.hidden = data.hidden.filter((h) => h !== id);
    if (!data.manual.some((m) => m.id === id)) {
      data.manual.push({ id, title: prettify(path.parse(target).name), launch: { type: 'exe', target }, installPath: path.dirname(target) });
    }
    saveData();
    cache.at = 0;
    return { id };
  }));

  handle('games:hide', (id) => attempt(async () => {
    const sid = String(id);
    data.manual = data.manual.filter((m) => m.id !== sid);
    if (!data.hidden.includes(sid)) data.hidden.push(sid);
    saveData();
    cache.at = 0;
  }));
  handle('games:unhideAll', () => attempt(async () => { data.hidden = []; saveData(); cache.at = 0; }));

  handle('games:reveal', (id) => attempt(async () => {
    const game = await findGame(id);
    if (game.launch.type === 'exe' && game.store !== 'riot') shell.showItemInFolder(game.launch.target);
    else if (game.installPath && fs.existsSync(game.installPath)) await openPath(game.installPath);
    else throw new Error('The install folder was not found.');
  }));

  handle('scan:deep', () => { runDeepScan(); return true; });

  /* settings and profile */
  handle('settings:set', (key, value) => {
    if (!(key in DEFAULT_SETTINGS) || typeof value !== typeof DEFAULT_SETTINGS[key]) throw new Error('Unknown setting.');
    data.settings[key] = value;
    saveData();
    if (key === 'startWithWindows' && app.isPackaged) app.setLoginItemSettings({ openAtLogin: value });
    if (key === 'autoDownloadUpdates') autoUpdater.autoDownload = value;
    return data.settings;
  });
  handle('settings:clearCache', () => { data.metaCache = {}; saveData(); send('library:changed'); return true; });

  handle('profile:setName', (name) => { data.profile.name = String(name).trim().slice(0, 40) || 'Player'; saveData(); return publicProfile(); });

  handle('themes:list', () => {
    const out = {};
    for (const type of Object.keys(THEMES)) {
      out[type] = THEMES[type].map((t) => ({
        ...t, folder: THEME_DIR[type],
        url: `crescent://theme/${THEME_DIR[type]}/${t.file}`,
        available: fs.existsSync(path.join(themeRoot(), THEME_DIR[type], t.file)),
      }));
    }
    return out;
  });
  handle('themes:set', (type, id) => {
    if (type === 'none') data.profile.theme = { type: 'none', id: null };
    else if (THEMES[type]?.some((t) => t.id === id)) data.profile.theme = { type, id };
    else throw new Error('Unknown theme.');
    saveData();
    return publicProfile();
  });

  /* uploads, sent in pieces so the interface can show real progress */
  handle('media:begin', ({ kind, ext }) => {
    const e = String(ext).toLowerCase();
    if (!['avatar', 'banner'].includes(kind) || !MIME[e]) throw new Error('This kind of file is not supported.');
    fs.mkdirSync(mediaDir(), { recursive: true });
    const id = crypto.randomUUID();
    const file = `${kind}-${Date.now()}.${e}`;
    const tmp = path.join(mediaDir(), `${file}.part`);
    uploads.set(id, { kind, file, tmp, ws: fs.createWriteStream(tmp), bytes: 0 });
    return { id };
  });
  handle('media:chunk', async (id, buf) => {
    const u = uploads.get(id);
    if (!u) throw new Error('Upload was cancelled.');
    const chunk = Buffer.from(buf);
    u.bytes += chunk.length;
    if (u.bytes > MAX_UPLOAD) throw new Error('This file is too large.');
    await new Promise((res, rej) => u.ws.write(chunk, (err) => (err ? rej(err) : res())));
    return true;
  });
  handle('media:end', async (id, info) => {
    const u = uploads.get(id);
    if (!u) throw new Error('Upload was cancelled.');
    await new Promise((res) => u.ws.end(res));
    uploads.delete(id);
    if (u.kind === 'banner') {
      const okSize = info?.width === 1280 && info.height >= 400 && info.height <= 700;
      const okLen = info?.type !== 'video' || info.duration <= 10.05;
      if (!okSize || !okLen) { fs.rmSync(u.tmp, { force: true }); throw new Error('This banner does not meet the size or length rules.'); }
    }
    const final = path.join(mediaDir(), u.file);
    fs.renameSync(u.tmp, final);
    if (u.kind === 'avatar') { removeMedia(data.profile.avatar); data.profile.avatar = u.file; }
    else { removeMedia(data.profile.banner?.file); data.profile.banner = { file: u.file, type: info.type, width: info.width, height: info.height }; }
    saveData();
    return { profile: publicProfile(), fileUrl: pathToFileURL(final).toString() };
  });
  handle('media:abort', (id) => {
    const u = uploads.get(id);
    if (u) { u.ws.destroy(); fs.rmSync(u.tmp, { force: true }); uploads.delete(id); }
    return true;
  });
  handle('media:clear', (kind) => {
    if (kind === 'avatar') { removeMedia(data.profile.avatar); data.profile.avatar = null; }
    if (kind === 'banner') { removeMedia(data.profile.banner?.file); data.profile.banner = null; }
    saveData();
    return publicProfile();
  });

  /* app */
  handle('library:openFolder', () => openPath(app.getPath('userData')));
  handle('app:version', () => app.getVersion());
  handle('clipboard:write', (text) => { clipboard.writeText(String(text)); return true; });
  handle('win:minimize', () => mainWindow?.minimize());
  handle('win:maximize', () => (mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize()));
  handle('win:close', () => mainWindow?.close());

  // What's new: every version between the last one the user saw and the current one.
  handle('app:whatsNew', (all) => {
    const current = app.getVersion();
    let log_ = {};
    try { log_ = JSON.parse(fs.readFileSync(path.join(__dirname, 'changelog.json'), 'utf8')); } catch { return null; }
    const seen = all ? '0.0.0' : data.lastSeenVersion || (hadData ? '1.0.0' : current);
    const versions = Object.keys(log_).filter((v) => cmpVer(v, seen) > 0 && cmpVer(v, current) <= 0).sort((a, b) => cmpVer(b, a));
    if (!versions.length) return null;
    return { current, versions: versions.map((v) => ({ version: v, ...log_[v] })) };
  });
  handle('app:ackVersion', () => { data.lastSeenVersion = app.getVersion(); saveData(); return true; });

  /* launcher updates */
  handle('updater:status', () => updaterStatus);
  handle('updater:check', () => attempt(async () => {
    if (!app.isPackaged) throw new Error('Updates only work in the installed app.');
    await autoUpdater.checkForUpdatesAndNotify();
  }));
  handle('updater:download', () => attempt(async () => { await autoUpdater.downloadUpdate(); }));
  handle('updater:install', () => autoUpdater.quitAndInstall());
}

/* ------------------------------------------------------------------ */
/* Auto-update (electron-updater + GitHub Releases)                    */
/* ------------------------------------------------------------------ */

function setUpdaterStatus(patch) {
  updaterStatus = { ...updaterStatus, ...patch };
  send('updater:status', updaterStatus);
}

function setupAutoUpdater() {
  autoUpdater.autoDownload = data.settings.autoDownloadUpdates;
  autoUpdater.on('checking-for-update', () => { log.info('Updater: checking for update'); setUpdaterStatus({ state: 'checking' }); });
  autoUpdater.on('update-available', (info) => { log.info(`Updater: update available (${info.version})`); setUpdaterStatus({ state: 'available', version: info.version, percent: 0 }); });
  autoUpdater.on('update-not-available', () => { log.info('Updater: already up to date'); setUpdaterStatus({ state: 'idle' }); });
  autoUpdater.on('download-progress', (p) => { log.info(`Updater: downloading ${Math.round(p.percent)}%`); setUpdaterStatus({ state: 'downloading', percent: Math.round(p.percent) }); });
  autoUpdater.on('update-downloaded', (info) => { log.info(`Updater: ${info.version} downloaded, installs on restart`); setUpdaterStatus({ state: 'downloaded', version: info.version, percent: 100 }); });
  autoUpdater.on('error', (err) => { log.error('Updater error', err); setUpdaterStatus({ state: 'error', message: String(err?.message || err) }); });

  const check = () => { if (data.settings.autoCheckUpdates) autoUpdater.checkForUpdatesAndNotify().catch((err) => log.error(err)); };
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS);
}

/* ------------------------------------------------------------------ */
/* Window                                                              */
/* ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    backgroundColor: '#0e0f11', title: 'Crescent',
    icon: path.join(__dirname, 'build', 'icon.png'),
    ...(isMac ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 16 } } : { frame: false }),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
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
    app.setAppUserModelId('com.example.crescent');
    if (!isMac) Menu.setApplicationMenu(null);
    loadData();
    registerMediaProtocol();
    registerIpc();
    createWindow();
    if (app.isPackaged) setupAutoUpdater(); // updates only work in installed builds

    setTimeout(trackerTick, 3000);
    setInterval(trackerTick, 6000);
    const older = Date.now() - data.deepFound.at > DEEP_SCAN_MAX_AGE_MS;
    if (data.settings.deepScan && data.settings.autoScan && older) setTimeout(runDeepScan, 8000);

    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });

  app.on('before-quit', () => { app.isQuitting = true; saveData(); });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
