'use strict';

// Finds games already installed on this PC by reading each store's own files.
// Steam, Epic, GOG, EA app, Ubisoft Connect, Battle.net, Rockstar, Riot, Roblox, Xbox / Microsoft Store.

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const NONE = { found: false, games: [] };

const run = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out))
  );
const readText = (file) => fsp.readFile(file, 'utf8').catch(() => null);
const exists = (p) => fsp.access(p).then(() => true, () => false);
const vdf = (text, key) => (text.match(new RegExp(`"${key}"\\s+"([^"]*)"`, 'i')) || [])[1];
const num = (v) => Number(v) || 0;
const normName = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
const stripQuotes = (s) => String(s || '').trim().replace(/^"+|"+$/g, '');
const cleanDir = (p) => path.normalize(stripQuotes(p).replace(/\//g, path.sep)).replace(/[\\/]+$/, '');

/* ---------------- helpers shared by the launcher scanners ---------------- */

// "reg query ... /s" output to a list of { __key, value name: value } objects.
function parseReg(out) {
  const sections = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      cur = { __key: line.trim() };
      sections.push(cur);
      continue;
    }
    const m = cur && line.match(/^\s{4}(.+?)\s{4}REG_\w+(?:\s{4}(.*))?$/);
    if (m) cur[m[1]] = (m[2] || '').trim();
  }
  return sections;
}

// Programs and helper folders that are not games. Used by every scanner except Steam's own list.
const NOT_GAME = new RegExp([
  'windhawk', '\\boverlay\\b', 'epic online services', 'easy ?anti-?cheat', '\\bbattleye\\b', 'redistributable', '\\bredist\\b',
  '\\bruntime\\b', '\\bframework\\b', '\\bvulkan\\b', '\\bdirectx\\b', 'visual c\\+\\+', 'launcher', 'installer', 'updater',
  'uninstall', 'crash ?report', '\\bbenchmark\\b', '\\b(nvidia|geforce|radeon|realtek|logitech|razer|corsair|steelseries|overwolf)\\b',
  'msi afterburner', 'rivatuner', 'cheat engine', 'obs studio', '\\bvlc\\b', '7-zip', 'winrar', 'notepad', '\\bdiscord\\b',
  '\\bspotify\\b', 'visual studio', 'jetbrains', 'powertoys', 'sharex', '\\bsdk\\b', '\\bdriver\\b', '\\bservices?$',
].join('|'), 'i');
// A game folder is never called this; the real name is one level up (Game\\Binaries\\Win64, Game\\Content).
const GENERIC_DIR = /^(content|win64|win32|x64|x86|bin|bin64|binaries|game|data|app|application|release|debug|shipping|client|engine|retail|windows|windowsnoeditor|pak|paks|assets|textures|resources|common|install|files)$/i;

const EXE_SKIP = /(unins|uninst|setup|install|crash|report|redist|vcredist|vc_redist|dxsetup|dotnet|updater|helper|bootstrap|eac|easyanticheat|battleye|beservice|cefprocess|webhelper|notification|touchup|support|prereq)/i;

async function listExes(dir, depth) {
  const out = [];
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isFile() && /\.exe$/i.test(e.name)) {
      const st = await fsp.stat(full).catch(() => null);
      if (st) out.push({ file: full, size: st.size, depth: 0 });
    } else if (e.isDirectory() && depth > 0 && !/^(redist|_commonredist|directx|vcredist|engine|crashreportclient|__installer)$/i.test(e.name)) {
      for (const sub of await listExes(full, depth - 1)) out.push({ ...sub, depth: sub.depth + 1 });
    }
  }
  return out;
}

// The game's main program: prefer a file named like the game, otherwise the biggest one.
async function findMainExe(dir, title = '') {
  const key = normName(title);
  const list = (await listExes(dir, 2)).filter((e) => !EXE_SKIP.test(path.basename(e.file)));
  if (!list.length) return null;
  const scored = list.map((e) => {
    const base = normName(path.basename(e.file, path.extname(e.file)));
    const named = key && base.length >= 3 && (key.includes(base) || base.includes(key)) ? 1e13 : 0;
    return { ...e, score: named + e.size - e.depth * 1e6 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].file;
}

async function exeGame({ store, id, title, dir, version = '', extra = {} }) {
  const exe = await findMainExe(dir, title);
  if (!exe) return null;
  return {
    id, store, title, version,
    launch: { type: 'exe', target: exe, cwd: path.dirname(exe) },
    installPath: dir, sizeBytes: 0, state: 'installed', progress: 0, ...extra,
  };
}

async function uninstallEntries() {
  if (!IS_WIN) return [];
  const base = '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall';
  const keys = [`HKLM${base}`, `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall`, `HKCU${base}`];
  const all = (await Promise.all(keys.map(async (k) => parseReg(await run('reg', ['query', k, '/s']))))).flat();
  return all
    .filter((e) => e.DisplayName)
    .map((e) => ({ key: e.__key, name: e.DisplayName, publisher: e.Publisher || '', dir: e.InstallLocation ? cleanDir(e.InstallLocation) : '' }));
}

/* ---------------- Steam ---------------- */

const STEAM_SKIP = /^(Steamworks Common Redistributables|Steam Linux Runtime|Proton)/i;
// StateFlags bits: 2 update required, 512 paused, 256/1024/262144/524288/1048576/2097152 update running
const STEAM_RUNNING = 256 | 1024 | 262144 | 524288 | 1048576 | 2097152;
const STEAM_BUSY = 2 | 512 | STEAM_RUNNING;

async function steamRoot() {
  if (IS_WIN) {
    const out = await run('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath']);
    const m = out.match(/SteamPath\s+REG_SZ\s+(.+)/);
    return m ? path.normalize(m[1].trim()) : 'C:\\Program Files (x86)\\Steam';
  }
  if (IS_MAC) return path.join(os.homedir(), 'Library', 'Application Support', 'Steam');
  for (const p of [path.join(os.homedir(), '.steam', 'steam'), path.join(os.homedir(), '.local', 'share', 'Steam')]) {
    if (await exists(p)) return p;
  }
  return null;
}

async function scanSteam() {
  const root = await steamRoot();
  if (!root || !(await exists(root))) return NONE;

  // Windows paths differ only by letter case, so compare them in a normalised form.
  const libraries = new Map();
  const addLibrary = (p) => {
    const clean = path.normalize(p).replace(/[\\/]+$/, '');
    libraries.set(IS_WIN ? clean.toLowerCase() : clean, clean);
  };
  addLibrary(root);
  const folders = await readText(path.join(root, 'steamapps', 'libraryfolders.vdf'));
  if (folders) for (const m of folders.matchAll(/"path"\s+"([^"]+)"/g)) addLibrary(m[1].replace(/\\\\/g, '\\'));

  const games = [];
  const seen = new Set();
  for (const lib of libraries.values()) {
    const dir = path.join(lib, 'steamapps');
    let files = [];
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const file of files.filter((f) => /^appmanifest_\d+\.acf$/.test(f))) {
      const text = await readText(path.join(dir, file));
      if (!text) continue;
      const appId = vdf(text, 'appid');
      const name = vdf(text, 'name');
      if (!appId || !name || STEAM_SKIP.test(name) || seen.has(appId)) continue;
      seen.add(appId);

      const flags = num(vdf(text, 'StateFlags'));
      const total = num(vdf(text, 'BytesToDownload'));
      const done = num(vdf(text, 'BytesDownloaded'));
      const playable = (flags & 4) === 4;
      const installdir = vdf(text, 'installdir') || '';
      const busy = playable && (flags & STEAM_BUSY) !== 0;
      games.push({
        id: `steam:${appId}`, store: 'steam', appId, title: name,
        version: vdf(text, 'buildid') || '',
        launch: { type: 'uri', target: `steam://rungameid/${appId}` },
        installPath: installdir ? path.join(dir, 'common', installdir) : '',
        sizeBytes: num(vdf(text, 'SizeOnDisk')),
        state: !playable ? 'installing' : busy ? 'updating' : 'installed',
        updating: busy ? ((flags & STEAM_RUNNING) !== 0 ? 'running' : 'pending') : null,
        progress: total > 0 ? Math.min(1, done / total) : 0,
        downloadTotal: total, downloadDone: done,
      });
    }
  }
  return { found: true, games };
}

/* ---------------- Epic Games ---------------- */

async function scanEpic() {
  if (!IS_WIN) return NONE;
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files;
  try {
    files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.item'));
  } catch {
    return NONE;
  }
  const games = [];
  for (const file of files) {
    try {
      const m = JSON.parse(await fsp.readFile(path.join(dir, file), 'utf8'));
      if (m.bIsIncompleteInstall || !m.DisplayName || NOT_GAME.test(m.DisplayName)) continue;
      if (m.MainGameAppName && m.MainGameAppName !== m.AppName) continue; // skip DLC
      if (Array.isArray(m.AppCategories) && !m.AppCategories.includes('games')) continue;
      games.push({
        id: `epic:${m.AppName}`, store: 'epic', title: m.DisplayName,
        version: m.AppVersionString || '',
        launch: { type: 'uri', target: `com.epicgames.launcher://apps/${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}?action=launch&silent=true` },
        installPath: m.InstallLocation || '', sizeBytes: num(m.InstallSize), state: 'installed', progress: 0,
      });
    } catch {
      /* skip unreadable manifest */
    }
  }
  return { found: true, games };
}

/* ---------------- GOG ---------------- */

async function scanGog() {
  if (!IS_WIN) return NONE;
  const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games', '/s']);
  if (!out) return NONE;
  const games = parseReg(out)
    .filter((e) => e.gameID && e.gameName && e.exe && e.path)
    .map((e) => ({
      id: `gog:${e.gameID}`, store: 'gog', title: e.gameName, version: e.ver || '',
      launch: { type: 'exe', target: e.exe, cwd: e.path },
      installPath: e.path, sizeBytes: 0, state: 'installed', progress: 0,
    }));
  return { found: true, games };
}

/* ---------------- EA app, Battle.net, Rockstar (found through Windows' installed programs list) ---------------- */

async function scanByPublisher(entries, { store, publisher, skipName }) {
  const hits = entries.filter((e) => publisher.test(e.publisher) && !skipName.test(e.name) && !NOT_GAME.test(e.name) && e.dir && fs.existsSync(e.dir));
  const games = [];
  for (const e of hits) {
    const g = await exeGame({ store, id: `${store}:${normName(e.name)}`, title: e.name, dir: e.dir });
    if (g) games.push(g);
  }
  return { found: games.length > 0, games };
}

const scanEA = (entries) => scanByPublisher(entries, { store: 'ea', publisher: /Electronic Arts/i, skipName: /EA app|EA Desktop|Origin|Redistributable|Visual C|Background|Core/i });
const scanBattleNet = (entries) => scanByPublisher(entries, { store: 'battlenet', publisher: /Blizzard Entertainment/i, skipName: /Battle\.net|Agent/i });
const scanRockstar = (entries) => scanByPublisher(entries, { store: 'rockstar', publisher: /Rockstar Games/i, skipName: /Launcher|Social Club/i });

/* ---------------- Ubisoft Connect ---------------- */

async function scanUbisoft(entries) {
  if (!IS_WIN) return NONE;
  const out = await run('reg', ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Ubisoft\\Launcher\\Installs', '/s']);
  if (!out) return NONE;
  const games = [];
  for (const e of parseReg(out).filter((s) => s.InstallDir)) {
    const id = e.__key.split('\\').pop();
    const dir = cleanDir(e.InstallDir);
    if (!fs.existsSync(dir)) continue;
    const known = entries.find((x) => x.dir && cleanDir(x.dir).toLowerCase() === dir.toLowerCase());
    const title = known?.name || path.basename(dir);
    games.push({
      id: `ubisoft:${id}`, store: 'ubisoft', title, version: '',
      launch: { type: 'uri', target: `uplay://launch/${id}/0` },
      installPath: dir, sizeBytes: 0, state: 'installed', progress: 0,
    });
  }
  return { found: true, games };
}

/* ---------------- Riot Games (Valorant, League of Legends) ---------------- */

async function scanRiot(entries) {
  if (!IS_WIN) return NONE;
  let client = null;
  try {
    const j = JSON.parse(await fsp.readFile(path.join(process.env.ProgramData || 'C:\\ProgramData', 'Riot Games', 'RiotClientInstalls.json'), 'utf8'));
    client = j.rc_default || j.rc_live || null;
  } catch {
    return NONE;
  }
  if (!client || !(await exists(client))) return NONE;
  const defs = [
    ['valorant', 'VALORANT', /^valorant$/i, 'C:\\Riot Games\\VALORANT', ['valorant-win64-shipping.exe']],
    ['league_of_legends', 'League of Legends', /^league of legends/i, 'C:\\Riot Games\\League of Legends', ['league of legends.exe', 'leagueclient.exe']],
  ];
  const games = [];
  for (const [product, title, re, defaultDir, procNames] of defs) {
    const entry = entries.find((e) => re.test(e.name) && /riot/i.test(e.publisher + e.key));
    const dir = entry?.dir && fs.existsSync(entry.dir) ? entry.dir : fs.existsSync(defaultDir) ? defaultDir : null;
    if (!dir) continue;
    games.push({
      id: `riot:${product}`, store: 'riot', title, version: '',
      launch: { type: 'exe', target: client, args: [`--launch-product=${product}`, '--launch-patchline=live'] },
      installPath: dir, procNames, sizeBytes: 0, state: 'installed', progress: 0,
    });
  }
  return { found: true, games };
}

/* ---------------- Roblox ---------------- */

async function scanRoblox() {
  if (!IS_WIN || !process.env.LOCALAPPDATA) return NONE;
  const base = path.join(process.env.LOCALAPPDATA, 'Roblox', 'Versions');
  let dirs = [];
  try {
    dirs = (await fsp.readdir(base, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => path.join(base, d.name));
  } catch {
    return NONE;
  }
  const withExe = dirs.filter((d) => fs.existsSync(path.join(d, 'RobloxPlayerBeta.exe')));
  if (!withExe.length) return NONE;
  withExe.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  const exe = path.join(withExe[0], 'RobloxPlayerBeta.exe');
  return {
    found: true,
    games: [{
      id: 'roblox:player', store: 'roblox', title: 'Roblox', version: '',
      launch: { type: 'exe', target: exe, cwd: withExe[0] },
      installPath: base, procNames: ['robloxplayerbeta.exe'], sizeBytes: 0, state: 'installed', progress: 0,
    }],
  };
}

/* ---------------- Xbox app and Microsoft Store games ---------------- */

async function scanXbox() {
  if (!IS_WIN) return NONE;
  const script =
    "Get-AppxPackage | Where-Object { $_.InstallLocation -and (Test-Path (Join-Path $_.InstallLocation 'MicrosoftGame.config')) } | " +
    'Select-Object Name,PackageFamilyName,InstallLocation | ConvertTo-Json -Compress';
  const out = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (!out.trim()) return NONE;
  let packages;
  try {
    packages = [].concat(JSON.parse(out));
  } catch {
    return NONE;
  }
  const games = [];
  for (const p of packages) {
    const xml = (await readText(path.join(p.InstallLocation, 'MicrosoftGame.config'))) || '';
    const appId = (xml.match(/<Executable\b[^>]*\bId="([^"]+)"/i) || [])[1] || 'Game';
    let title = (xml.match(/DefaultDisplayName="([^"]+)"/i) || [])[1] || '';
    if (!title || /^ms-resource:/i.test(title)) {
      const parts = p.InstallLocation.split(/[\\/]/);
      title = /^content$/i.test(parts[parts.length - 1]) ? parts[parts.length - 2] : String(p.Name).split('.').pop();
    }
    if (NOT_GAME.test(title)) continue;
    games.push({
      id: `xbox:${p.PackageFamilyName}`, store: 'xbox', title, version: '',
      launch: { type: 'appx', target: `${p.PackageFamilyName}!${appId}` },
      installPath: p.InstallLocation, sizeBytes: 0, state: 'installed', progress: 0,
    });
  }
  return { found: true, games };
}

/* ---------------- everything together ---------------- */

async function scanAll() {
  const entries = await uninstallEntries();
  const empty = () => NONE;
  const jobs = {
    steam: scanSteam(), epic: scanEpic(), gog: scanGog(),
    ea: scanEA(entries), ubisoft: scanUbisoft(entries), battlenet: scanBattleNet(entries),
    xbox: scanXbox(), riot: scanRiot(entries), rockstar: scanRockstar(entries), roblox: scanRoblox(),
  };
  const done = {};
  await Promise.all(Object.entries(jobs).map(async ([k, p]) => (done[k] = await p.catch(empty))));

  const unique = new Map(Object.values(done).flatMap((r) => r.games).map((g) => [g.id, g]));
  const stores = {};
  for (const [k, r] of Object.entries(done)) stores[k] = { found: r.found, count: r.games.length };
  return { games: [...unique.values()], stores };
}

module.exports = { scanAll, findMainExe, parseReg, normName, NOT_GAME, GENERIC_DIR, EXE_SKIP };
