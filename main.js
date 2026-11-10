'use strict';

const { app, BrowserWindow, ipcMain, shell, Menu, dialog, net, protocol, clipboard, Tray, nativeImage, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');
const { spawn, execFile } = require('node:child_process');
const { Readable } = require('node:stream');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { scanAll, normName, NOT_GAME, GENERIC_DIR } = require('./scanner');
const { deepScan } = require('./deepscan');
const { listProcesses, matchGame, stopProcesses } = require('./tracker');
const { dominantAccent, isHex } = require('./color');
const { BORDERS, totalSeconds, checkMilestones } = require('./milestones');
const perf = require('./perf');

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
  startWithWindows: false, topGamesLayout: 'list', friendsHidden: false,
  onGameStart: 'keep', restoreAfterGame: true, overlayEnabled: false, transitions: true,
  autoScan: true, deepScan: true, trackPlaytime: true,
  autoCheckUpdates: true, autoDownloadUpdates: true, showUpdateLogs: true, notifyGameUpdates: true,
  heroTransition: true,
};
const DEFAULTS = () => ({
  profile: {
    name: 'Player', avatar: null, banner: null, theme: { type: 'none', id: null },
    status: { preset: 'online', message: '' }, border: 'none', glow: { on: false, color: '#6c8cff' },
    accent: { mode: 'default', color: '#f1f1f3' }, uiTheme: 'default',
  },
  settings: { ...DEFAULT_SETTINGS },
  manual: [], hidden: [], stats: {}, metaCache: {},
  deepFound: { at: 0, games: [] }, lastSeenVersion: null,
  widgets: [], tags: [], gameTags: {}, milestones: [], milestoneKeys: [], milestonesSeeded: false,
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
    if ((data.deepFound.v || 0) < DEEP_SCAN_VERSION) data.deepFound = { at: 0, games: [], v: DEEP_SCAN_VERSION };
    // older versions had a single "minimize" switch
    if (saved.settings?.minimizeOnGameStart && !saved.settings.onGameStart) data.settings.onGameStart = 'taskbar';
    delete data.settings.minimizeOnGameStart;
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
  const close = (n) => (n === t) || (t.length >= 6 && n.length >= 6 && (n.startsWith(t) || t.startsWith(n)) && Math.min(n.length, t.length) / Math.max(n.length, t.length) >= 0.75);
  const hit = items.find((i) => normName(i.name) === t) || items.find((i) => close(normName(i.name)));
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
const runningInfo = new Map(); // game id -> { pids, exe }
let hiddenByGame = false;
let tray = null;

function showWindow() {
  if (!mainWindow) createWindow();
  else {
    mainWindow.show();
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  hiddenByGame = false;
  if (tray) { tray.destroy(); tray = null; }
}
function ensureTray() {
  if (tray) return;
  let img;
  try { img = nativeImage.createFromBuffer(fs.readFileSync(path.join(__dirname, 'build', 'icon.png'))).resize({ width: 16, height: 16 }); }
  catch { img = nativeImage.createEmpty(); }
  tray = new Tray(img);
  tray.setToolTip('Crescent');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Open Crescent', click: showWindow }, { label: 'Quit', click: () => app.quit() }]));
  tray.on('click', showWindow);
}
// What Crescent does when a game starts: keep open, hide in the tray, or minimize to the taskbar.
function applyLaunchBehavior() {
  const mode = data.settings.onGameStart;
  if (!mainWindow || mode === 'keep') return;
  hiddenByGame = true;
  if (mode === 'tray') { ensureTray(); mainWindow.hide(); } else mainWindow.minimize();
}

/* ---- performance overlay: a small see-through window that never takes clicks ---- */
let overlayWin = null, overlayTimer = null, fpsStop = null, fpsValue = null, gpuValue = null, gpuAt = 0;
function destroyOverlay() {
  clearInterval(overlayTimer);
  if (fpsStop) fpsStop();
  fpsStop = null; fpsValue = null;
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy();
  overlayWin = null;
}
function createOverlay() {
  const { workArea } = screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    x: workArea.x + 6, y: workArea.y + 6, width: 200, height: 130, transparent: true, frame: false, alwaysOnTop: true,
    focusable: false, skipTaskbar: true, resizable: false, hasShadow: false, show: false,
    webPreferences: { preload: path.join(__dirname, 'overlay-preload.js'), contextIsolation: true, sandbox: true },
  });
  overlayWin.setAlwaysOnTop(true, 'screen-saver');
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay.html'));
  overlayWin.once('ready-to-show', () => overlayWin && overlayWin.showInactive());
  // FPS only when PresentMon (a free tool from Intel) sits in the tools folder
  const pm = perf.findPresentMon([path.join(themeRoot(), 'tools')]);
  const exe = [...runningInfo.values()][0]?.exe;
  if (pm && exe) fpsStop = perf.startFps(pm, path.basename(exe), (v) => { fpsValue = v; });
  overlayTimer = setInterval(() => {
    if (!overlayWin || overlayWin.isDestroyed()) return;
    if (Date.now() - gpuAt > 3000) { gpuAt = Date.now(); perf.gpuPercent().then((v) => { gpuValue = v; }).catch(() => {}); }
    overlayWin.webContents.send('overlay:stats', { cpu: perf.cpuPercent(), ram: perf.ramPercent(), gpu: gpuValue, fps: fpsValue });
  }, 1000);
}
function updateOverlay() {
  const want = data.settings.overlayEnabled && running.size > 0;
  if (want && !overlayWin) createOverlay();
  else if (!want && overlayWin) destroyOverlay();
}
let scanState = { active: false, text: '' };

async function getLibrary(force) {
  if (force || !cache.scan || Date.now() - cache.at > 4000) cache = { at: Date.now(), scan: await scanAll() };
  const hidden = new Set(data.hidden);

  const manual = data.manual.map((m) => ({
    ...m, store: 'manual', version: '', sizeBytes: 0, progress: 0,
    state: fs.existsSync(m.launch.target) ? 'installed' : 'missing',
  }));
  const detected = (data.deepFound.games || [])
    .filter((d) => fs.existsSync(d.exe) && !NOT_GAME.test(d.title) && !GENERIC_DIR.test(path.basename(d.installPath)))
    .map((d) => ({
    id: d.id, store: 'detected', title: d.title, version: '',
    launch: { type: 'exe', target: d.exe, cwd: path.dirname(d.exe) },
    installPath: d.installPath, sizeBytes: 0, state: 'installed', progress: 0,
  }));

  const seen = new Set();
  const games = [];
  const fromStores = cache.scan.games.filter((g) => g.store === 'steam' || !NOT_GAME.test(g.title));

  // A game found by the drive search is dropped when a launcher (or you) already added the same game:
  // same folder, a folder inside or around it, same program, or the same name.
  const normPath = (p) => path.normalize(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
  const related = (a, b) => a && b && (a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep));
  const others = [...fromStores, ...manual];
  const uniqueDetected = detected.filter((d) => !others.some((o) =>
    related(normPath(o.installPath), normPath(d.installPath)) ||
    normPath(o.launch?.target) === normPath(d.launch.target) ||
    normName(o.title) === normName(d.title)));

  for (const g of [...fromStores, ...manual, ...uniqueDetected]) {
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

const ANIM_ACCENT = { 'night-sky': '#7c8cff', 'aurora-borealis': '#4fe3b0', milkyway: '#b894ff', singularity: '#ff9a4d' };
let accentKey = '';

function accentFromFile(file) {
  try {
    const img = nativeImage.createFromPath(file);
    if (img.isEmpty()) return null;
    return dominantAccent(img.resize({ width: 48, height: 48 }).toBitmap());
  } catch {
    return null;
  }
}
// The colour taken from the wallpaper or the banner; null when it cannot be read (videos, WEBP and GIF banners).
function resolveAccent(mode) {
  const p = data.profile;
  if (mode === 'wallpaper') {
    if (p.theme.type === 'animated') return ANIM_ACCENT[p.theme.id] || null;
    const t = THEMES.still.find((x) => x.id === p.theme.id);
    return p.theme.type === 'still' && t ? accentFromFile(path.join(themeRoot(), 'images', t.file)) : null;
  }
  if (mode === 'banner') return p.banner?.type === 'image' ? accentFromFile(path.join(mediaDir(), p.banner.file)) : null;
  return null;
}
// Keeps a "from my wallpaper / banner" accent in step when the wallpaper or banner changes.
function refreshAccent() {
  const a = data.profile.accent;
  if (a.mode !== 'wallpaper' && a.mode !== 'banner') { accentKey = ''; return; }
  const key = `${a.mode}|${data.profile.theme.id}|${data.profile.banner?.file}`;
  if (key === accentKey) return;
  accentKey = key;
  const c = resolveAccent(a.mode);
  if (c) a.color = c;
}

function publicProfile() {
  refreshAccent();
  const p = data.profile;
  return {
    name: p.name, status: p.status, border: p.border, glow: p.glow, accent: p.accent, uiTheme: p.uiTheme,
    avatarUrl: p.avatar ? `crescent://media/${p.avatar}` : null,
    banner: p.banner ? { url: `crescent://media/${p.banner.file}`, type: p.banner.type, width: p.banner.width, height: p.banner.height } : null,
    theme: p.theme,
  };
}

async function buildList(force) {
  const { games, stores } = await getLibrary(force);
  enrich(games); // fills in descriptions and artwork in the background
  return {
    games, stores, profile: publicProfile(), settings: data.settings, disk: await diskInfo(games), running: [...running.keys()], scan: scanState,
    widgets: data.widgets, tags: data.tags, gameTags: data.gameTags, milestones: data.milestones.slice(0, 60),
    borders: BORDERS, totalSeconds: Math.round(totalSeconds(data)),
  };
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
    data.deepFound = { at: Date.now(), games: found, v: DEEP_SCAN_VERSION };
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
    const info = new Map();
    for (const g of games) {
      if (g.state === 'missing') continue;
      const hits = matchGame(g, procs);
      if (hits.length) { next.set(g.id, hits.map((p) => p.pid)); info.set(g.id, { pids: hits.map((p) => p.pid), exe: hits[0].path }); }
    }
    const before = running.size;
    let changed = next.size !== running.size;
    let startedNow = false;
    for (const [id] of next) {
      if (!running.has(id)) {
        changed = true;
        startedNow = true;
        bumpStats(id, (s) => (s.lastPlayed = now));
      }
      if (data.settings.trackPlaytime) bumpStats(id, (s) => (s.playSeconds = (s.playSeconds || 0) + dt));
    }
    running.clear();
    for (const [id, pids] of next) running.set(id, pids);
    runningInfo.clear();
    for (const [id, v] of info) runningInfo.set(id, v);

    if (startedNow) applyLaunchBehavior();
    if (before > 0 && running.size === 0 && hiddenByGame && data.settings.restoreAfterGame) showWindow();
    updateOverlay();

    // milestones: the first run only remembers play time from before this feature, silently
    if (!data.milestonesSeeded) {
      checkMilestones(data, games, { silent: true });
      data.milestones.unshift({ id: 'welcome', kind: 'info', text: 'Milestones started. Your achievements show up here.', at: now });
      data.milestoneKeys.push('welcome');
      data.milestonesSeeded = true;
      saveData();
    } else {
      const fresh = checkMilestones(data, games);
      if (fresh.length) { saveData(); send('milestones:new', fresh.map((m) => m.text)); }
    }
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
const BANNER = { minW: 1280, maxW: 3840, minH: 400, maxH: 700, maxSeconds: 10 };
const DEEP_SCAN_VERSION = 3; // bump when the drive search gets smarter, so old results are thrown away
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
    await openUri('steam://nav/downloads'); // starts Steam if it is closed, so its queued update can run
    await sleep(2500);
    await openUri(`steam://validate/${game.appId}`); // Steam has no "update now" link; verifying downloads the newest files
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
    if (key === 'overlayEnabled') updateOverlay();
    return data.settings;
  });
  handle('settings:clearCache', () => { data.metaCache = {}; saveData(); send('library:changed'); return true; });

  handle('profile:setStatus', (preset, message) => {
    if (!['online', 'ingame', 'afk', 'dnd', 'chilling'].includes(preset)) throw new Error('Unknown status.');
    data.profile.status = { preset, message: String(message || '').trim().slice(0, 60) };
    saveData();
    return publicProfile();
  });
  handle('profile:setBorder', (id) => attempt(async () => {
    const b = BORDERS.find((x) => x.id === id);
    if (!b) throw new Error('Unknown border.');
    if (totalSeconds(data) / 3600 < b.hours) throw new Error(`Play ${b.hours} hours in total to unlock this border.`);
    data.profile.border = id;
    saveData();
    return { profile: publicProfile() };
  }));
  handle('profile:setGlow', (on, color) => {
    data.profile.glow = { on: !!on, color: isHex(color) ? color.toLowerCase() : data.profile.glow.color };
    saveData();
    return publicProfile();
  });
  handle('profile:setUiTheme', (id) => {
    if (!['default', 'glass', 'cartoon'].includes(id)) throw new Error('Unknown style.');
    data.profile.uiTheme = id;
    saveData();
    return publicProfile();
  });
  handle('accent:set', (mode, color) => attempt(async () => {
    if (mode === 'default') data.profile.accent = { mode, color: '#f1f1f3' };
    else if (mode === 'custom') {
      if (!isHex(color)) throw new Error('That is not a colour.');
      data.profile.accent = { mode, color: color.toLowerCase() };
    } else if (mode === 'wallpaper' || mode === 'banner') {
      const c = resolveAccent(mode);
      if (!c) throw new Error(mode === 'banner'
        ? 'Crescent could not read a colour from your banner. A PNG or JPG banner picture works best (not a video).'
        : 'Pick a wallpaper first, then Crescent can take its colour.');
      data.profile.accent = { mode, color: c };
      accentKey = `${mode}|${data.profile.theme.id}|${data.profile.banner?.file}`;
    } else throw new Error('Unknown accent mode.');
    saveData();
    return { profile: publicProfile() };
  }));

  handle('widgets:add', (w) => attempt(async () => {
    if (!['home', 'milestones'].includes(w?.page) || !['game-time', 'border-hours'].includes(w?.type)) throw new Error('Unknown widget.');
    if (data.widgets.length >= 12) throw new Error('You can have up to 12 widgets.');
    data.widgets.push({ id: crypto.randomUUID().slice(0, 8), page: w.page, type: w.type, gameId: String(w.gameId || ''), borderId: String(w.borderId || 'next') });
    saveData();
  }));
  handle('widgets:remove', (id) => { data.widgets = data.widgets.filter((w) => w.id !== String(id)); saveData(); return true; });

  handle('tags:create', (name) => attempt(async () => {
    const clean = String(name || '').trim().slice(0, 24);
    if (!clean) throw new Error('Give the tag a name.');
    if (data.tags.some((t) => t.name.toLowerCase() === clean.toLowerCase())) throw new Error('You already have a tag with that name.');
    const tag = { id: 't' + Date.now().toString(36), name: clean };
    data.tags.push(tag);
    saveData();
    return { tag };
  }));
  handle('tags:delete', (id) => {
    data.tags = data.tags.filter((t) => t.id !== String(id));
    for (const k of Object.keys(data.gameTags)) data.gameTags[k] = data.gameTags[k].filter((t) => t !== String(id));
    saveData();
    return true;
  });
  handle('games:setTag', (gameId, tagId, on) => {
    if (!data.tags.some((t) => t.id === tagId)) throw new Error('Unknown tag.');
    const list = new Set(data.gameTags[gameId] || []);
    if (on) list.add(tagId); else list.delete(tagId);
    data.gameTags[gameId] = [...list];
    saveData();
    return data.gameTags;
  });

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
      const okSize = info?.width >= BANNER.minW && info.width <= BANNER.maxW && info.height >= BANNER.minH && info.height <= BANNER.maxH;
      const okLen = info?.type !== 'video' || info.duration <= BANNER.maxSeconds + 0.05;
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

  app.on('before-quit', () => { app.isQuitting = true; destroyOverlay(); if (tray) tray.destroy(); saveData(); });
  app.on('window-all-closed', () => { if (!isMac) app.quit(); });
}
