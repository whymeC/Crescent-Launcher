'use strict';

// Works out which games are running right now, so the launcher can count play time,
// show "Close Game", and stop a game on request.

const path = require('node:path');
const { execFile } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const exec = (cmd, args) =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, out) => resolve(err ? '' : out)));

async function listProcesses() {
  if (IS_WIN) {
    const out = await exec('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      'Get-Process | Where-Object { $_.Path } | ForEach-Object { "$($_.Id)|$($_.Path)" }',
    ]);
    return out.split(/\r?\n/).map((l) => {
      const i = l.indexOf('|');
      return i > 0 ? { pid: Number(l.slice(0, i)), path: l.slice(i + 1).trim() } : null;
    }).filter(Boolean);
  }
  const out = await exec('ps', ['-axo', 'pid=,command=']);
  return out.split('\n').map((l) => {
    const m = l.trim().match(/^(\d+)\s+(.*)$/);
    return m ? { pid: Number(m[1]), path: m[2] } : null;
  }).filter(Boolean);
}

const norm = (p) => path.normalize(String(p || '')).replace(/[\\/]+$/, '').toLowerCase();
const segments = (p) => p.split(/[\\/]/).filter(Boolean).length;

// Which of these processes belong to this game?
function matchGame(game, procs) {
  const dir = game.installPath ? norm(game.installPath) : '';
  const target = game.launch?.type === 'exe' ? norm(game.launch.target) : '';
  const hints = (game.procNames || []).map((n) => n.toLowerCase());
  const dirOk = dir && segments(dir) >= 2; // never match a whole drive or a top-level folder

  return procs.filter((p) => {
    const pp = norm(p.path);
    if (!IS_WIN) return (dirOk && pp.includes(dir + path.sep)) || (target && pp.startsWith(target));
    if (dirOk && pp.startsWith(dir + path.sep)) return true;
    if (target && game.store !== 'riot' && pp === target) return true;
    return hints.includes(path.basename(pp));
  });
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Ask nicely first, force it a few seconds later if the game is still running.
function stopProcesses(pids) {
  for (const pid of pids) {
    if (IS_WIN) execFile('taskkill', ['/PID', String(pid), '/T'], { windowsHide: true }, () => {});
    else try { process.kill(pid, 'SIGTERM'); } catch { /* already gone */ }
  }
  setTimeout(() => {
    for (const pid of pids.filter(alive)) {
      if (IS_WIN) execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, () => {});
      else try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
    }
  }, 5000);
}

module.exports = { listProcesses, matchGame, stopProcesses };
