'use strict';

// Walks the drives looking for game folders that no launcher told us about.
// A folder only counts as a game when it has a program, strong proof of a game engine, and real weight (not
// just a few textures). Folders named after programs that are not games are left alone.

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { findMainExe, NOT_GAME, GENERIC_DIR, EXE_SKIP } = require('./scanner');

const SKIP = new Set([
  'windows', 'system volume information', 'programdata', 'recovery', 'perflogs', 'users', 'appdata',
  'node_modules', '.git', 'windowsapps', 'steamapps', 'common files', 'windows kits', 'msocache',
  'drivers', 'windows nt', 'dotnet', 'reference assemblies', 'microsoft', 'config.msi', 'temp', 'tmp',
  // inside a game: never a game of their own
  'content', 'binaries', 'win64', 'win32', 'engine', 'plugins', 'thirdparty', 'saved', 'textures', 'resources',
  'assets', 'redist', '_commonredist', 'directx', 'vcredist', 'logs', 'crashes', 'cache', 'easyanticheat', 'battleye',
]);
const MARKER_FILES = ['unityplayer.dll', 'steam_api.dll', 'steam_api64.dll', 'gameassembly.dll', 'galaxy64.dll', 'eossdk-win64-shipping.dll'];
const MIN_WEIGHT = 50 * 1024 * 1024; // a real game is far bigger than this

const norm = (p) => path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
const yieldNow = () => new Promise((r) => setImmediate(r));
const exists = (p) => fsp.access(p).then(() => true, () => false);

// Total size of a folder, counting stops early once it is big enough.
async function weighs(dir, min, depth = 4, budget = { files: 1500, total: 0 }) {
  let entries;
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const e of entries) {
    if (budget.total >= min || budget.files <= 0) break;
    const full = path.join(dir, e.name);
    if (e.isFile()) {
      budget.files--;
      const st = await fsp.stat(full).catch(() => null);
      if (st) budget.total += st.size;
    } else if (e.isDirectory() && depth > 0) await weighs(full, min, depth - 1, budget);
  }
  return budget.total >= min;
}

// Strong proof that this folder is the root of an installed game.
async function isGameDir(dir, entries) {
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  const exes = entries.filter((e) => e.isFile() && /\.exe$/i.test(e.name) && !EXE_SKIP.test(e.name));
  if (!exes.length) return false;

  const unity = entries.some((e) => e.isDirectory() && /_data$/i.test(e.name) &&
    exes.some((x) => x.name.toLowerCase() === e.name.toLowerCase().replace(/_data$/, '.exe')));
  const marker = MARKER_FILES.some((m) => names.has(m));
  const anticheat = names.has('easyanticheat') || names.has('battleye');
  const unreal = names.has('engine') && ((await exists(path.join(dir, 'Engine', 'Binaries'))) || (await exists(path.join(dir, 'Engine', 'Content'))));
  if (!(unity || marker || anticheat || unreal)) return false;
  return weighs(dir, MIN_WEIGHT);
}

function driveRoots() {
  if (process.platform === 'win32') {
    return 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => `${l}:\\`).filter((d) => fs.existsSync(d));
  }
  const home = require('node:os').homedir();
  return [path.join(home, 'Games'), '/opt/games'].filter((d) => fs.existsSync(d));
}

const prettify = (name) => name.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim() || name;

async function deepScan({ roots = driveRoots(), known = [], onProgress, shouldStop, budgetMs = 120000, maxDepth = 6 } = {}) {
  const knownPaths = known.filter(Boolean).map(norm);
  const rootSet = new Set(roots.map(norm));
  const candidates = new Set();
  const started = Date.now();
  let visited = 0;

  const isKnown = (dir) => {
    const n = norm(dir);
    return knownPaths.some((k) => n === k || n.startsWith(k + path.sep));
  };

  async function walk(dir, depth) {
    if (shouldStop?.() || Date.now() - started > budgetMs) return;
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (++visited % 40 === 0) {
      onProgress?.(dir);
      await yieldNow();
    }
    if (isKnown(dir)) return;
    if (depth > 0 && (await isGameDir(dir, entries))) {
      candidates.add(dir);
      return; // do not look inside a game folder
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('$') || NOT_GAME.test(e.name)) continue;
      const lower = e.name.toLowerCase();
      if (SKIP.has(lower)) {
        // Folders like Content or Win64 are never searched, but a real game can live inside one
        // (Xbox games do). It then counts under the name of the folder above.
        if (GENERIC_DIR.test(lower) && depth > 0) {
          const sub = path.join(dir, e.name);
          const subEntries = await fsp.readdir(sub, { withFileTypes: true }).catch(() => null);
          if (subEntries && !isKnown(sub) && (await isGameDir(sub, subEntries))) candidates.add(sub);
        }
        continue;
      }
      await walk(path.join(dir, e.name), depth + 1);
    }
  }

  for (const root of roots) await walk(root, 0);

  // A folder called "Win64" or "Content" belongs to the game one level up.
  const dirs = new Set();
  for (let dir of candidates) {
    while (GENERIC_DIR.test(path.basename(dir)) && !rootSet.has(norm(path.dirname(dir)))) dir = path.dirname(dir);
    if (GENERIC_DIR.test(path.basename(dir)) || isKnown(dir)) continue;
    dirs.add(dir);
  }
  const list = [...dirs].filter((d) => ![...dirs].some((o) => o !== d && norm(d).startsWith(norm(o) + path.sep)));

  const found = [];
  for (const dir of list) {
    const title = prettify(path.basename(dir));
    if (NOT_GAME.test(title)) continue;
    const exe = await findMainExe(dir, title);
    if (!exe) continue;
    found.push({ id: 'detected:' + crypto.createHash('sha1').update(norm(dir)).digest('hex').slice(0, 10), title, installPath: dir, exe });
  }
  return found;
}

module.exports = { deepScan, isGameDir };
