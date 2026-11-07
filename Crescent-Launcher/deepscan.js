'use strict';

// Walks the drives looking for game folders that no launcher told us about.
// A folder counts as a game when it holds a program plus a typical game-engine or anti-cheat marker.

const fsp = require('node:fs/promises');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { findMainExe } = require('./scanner');

const SKIP = new Set([
  'windows', 'system volume information', 'programdata', 'recovery', 'perflogs', 'users', 'appdata',
  'node_modules', '.git', 'windowsapps', 'steamapps', 'common files', 'windows kits', 'msocache',
  'drivers', 'windows nt', 'dotnet', 'reference assemblies', 'microsoft', 'config.msi', 'temp', 'tmp',
]);
const MARKER_FILES = [
  'unityplayer.dll', 'steam_api.dll', 'steam_api64.dll', 'gameassembly.dll', 'galaxy64.dll',
  'eossdk-win64-shipping.dll', 'unitycrashhandler64.exe', 'unitycrashhandler32.exe', 'physxcommon_64.dll',
];
const MARKER_DIRS = ['easyanticheat', 'battleye', 'easyanticheat_eos', 'engine'];

const norm = (p) => path.normalize(p).replace(/[\\/]+$/, '').toLowerCase();
const yieldNow = () => new Promise((r) => setImmediate(r));

function looksLikeGame(entries) {
  const names = new Set(entries.map((e) => e.name.toLowerCase()));
  if (!entries.some((e) => e.isFile() && /\.exe$/i.test(e.name))) return false;
  if (MARKER_FILES.some((m) => names.has(m))) return true;
  if (MARKER_DIRS.some((m) => names.has(m))) return true;
  return entries.some((e) => e.isDirectory() && /_data$/i.test(e.name));
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
  const candidates = [];
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
    if (depth > 0 && looksLikeGame(entries)) {
      candidates.push(dir);
      return; // do not look inside a game folder
    }
    if (depth >= maxDepth) return;
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith('$') || SKIP.has(e.name.toLowerCase())) continue;
      await walk(path.join(dir, e.name), depth + 1);
    }
  }

  for (const root of roots) await walk(root, 0);

  const found = [];
  for (const dir of candidates) {
    const title = prettify(path.basename(dir));
    const exe = await findMainExe(dir, title);
    if (!exe) continue;
    found.push({ id: 'detected:' + crypto.createHash('sha1').update(norm(dir)).digest('hex').slice(0, 10), title, installPath: dir, exe });
  }
  return found;
}

module.exports = { deepScan, looksLikeGame };
