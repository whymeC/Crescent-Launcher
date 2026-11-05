'use strict';

// Finds games already installed on this PC by reading each store's own files.
// Steam: appmanifest_*.acf files. Epic: *.item manifests. GOG: Windows registry.

const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const NONE = { found: false, games: [] };

const run = (cmd, args) =>
  new Promise((resolve) =>
    execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out))
  );
const readText = (file) => fsp.readFile(file, 'utf8').catch(() => null);
const exists = (p) => fsp.access(p).then(() => true, () => false);
const vdf = (text, key) => (text.match(new RegExp(`"${key}"\\s+"([^"]*)"`, 'i')) || [])[1];
const num = (v) => Number(v) || 0;

/* ---------------- Steam ---------------- */

const STEAM_SKIP = /^(Steamworks Common Redistributables|Steam Linux Runtime|Proton)/i;
// StateFlags bits that mean "an update is queued or running" (4 alone = fully installed and idle)
const STEAM_BUSY = 2 | 256 | 512 | 1024 | 262144 | 524288 | 1048576 | 2097152;

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

  // Windows paths differ only by letter case (the registry says "c:/program files", the
  // library file says "C:\\Program Files"), so compare them in a normalised form.
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
      games.push({
        id: `steam:${appId}`,
        store: 'steam',
        appId,
        title: name,
        version: vdf(text, 'buildid') || '',
        launch: { type: 'uri', target: `steam://rungameid/${appId}` },
        installPath: path.join(dir, 'common', vdf(text, 'installdir') || ''),
        sizeBytes: num(vdf(text, 'SizeOnDisk')),
        state: !playable ? 'installing' : flags & STEAM_BUSY ? 'updating' : 'installed',
        progress: total > 0 ? Math.min(1, done / total) : 0,
        downloadTotal: total,
        downloadDone: done,
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
      if (m.bIsIncompleteInstall || !m.DisplayName) continue;
      if (m.MainGameAppName && m.MainGameAppName !== m.AppName) continue; // skip DLC
      if (Array.isArray(m.AppCategories) && !m.AppCategories.includes('games')) continue;
      games.push({
        id: `epic:${m.AppName}`,
        store: 'epic',
        title: m.DisplayName,
        version: m.AppVersionString || '',
        launch: {
          type: 'uri',
          target: `com.epicgames.launcher://apps/${m.CatalogNamespace}%3A${m.CatalogItemId}%3A${m.AppName}?action=launch&silent=true`,
        },
        installPath: m.InstallLocation || '',
        sizeBytes: num(m.InstallSize),
        state: 'installed',
        progress: 0,
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

  const entries = [];
  let cur = null;
  for (const line of out.split(/\r?\n/)) {
    if (/^HKEY_/.test(line)) {
      if (cur) entries.push(cur);
      cur = {};
    } else if (cur) {
      const m = line.match(/^\s+(\w+)\s+REG_\w+\s+(.*)$/);
      if (m) cur[m[1]] = m[2].trim();
    }
  }
  if (cur) entries.push(cur);

  const games = entries
    .filter((e) => e.gameID && e.gameName && e.exe && e.path)
    .map((e) => ({
      id: `gog:${e.gameID}`,
      store: 'gog',
      title: e.gameName,
      version: e.ver || '',
      launch: { type: 'exe', target: e.exe, cwd: e.path },
      installPath: e.path,
      sizeBytes: 0,
      state: 'installed',
      progress: 0,
    }));
  return { found: true, games };
}

async function scanAll() {
  const empty = () => NONE;
  const [steam, epic, gog] = await Promise.all([scanSteam().catch(empty), scanEpic().catch(empty), scanGog().catch(empty)]);
  const unique = new Map([...steam.games, ...epic.games, ...gog.games].map((g) => [g.id, g]));
  return {
    games: [...unique.values()],
    stores: {
      steam: { found: steam.found, count: steam.games.length },
      epic: { found: epic.found, count: epic.games.length },
      gog: { found: gog.found, count: gog.games.length },
    },
  };
}

module.exports = { scanAll };
