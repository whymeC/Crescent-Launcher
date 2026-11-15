'use strict';

// Updates games with the tool that fits each store:
//   Steam -> SteamCMD, Epic -> Legendary, EA / Ubisoft / Battle.net -> their URI protocol handlers,
//   Xbox and Microsoft Store -> PowerShell, Riot / Rockstar -> their launcher's command line,
//   everything else (found on this PC, added by hand) -> the local program itself.
// SteamCMD and Legendary run as processes Crescent owns, so those two updates can be paused and resumed.

const { spawn, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const IS_WIN = process.platform === 'win32';

const TOOL_NAMES = {
  steam: 'SteamCMD', epic: 'Legendary', ea: 'EA app URI protocol handler', ubisoft: 'Ubisoft Connect URI protocol handler',
  battlenet: 'Battle.net client protocol', xbox: 'PowerShell (winget and Get-AppxPackage)', riot: 'Riot Client command line',
  rockstar: 'Rockstar Launcher command line', minecraft: 'The launcher itself', roblox: 'Roblox', detected: 'Local executable (standalone or DRM-free)',
  manual: 'Local executable (standalone or DRM-free)',
};

const BATTLENET_CODES = [
  [/world of warcraft/i, 'WoW'], [/overwatch/i, 'Pro'], [/diablo iv/i, 'Fen'], [/diablo iii/i, 'D3'], [/diablo ii/i, 'OSI'],
  [/hearthstone/i, 'WTCG'], [/heroes of the storm/i, 'Hero'], [/starcraft ii/i, 'S2'], [/starcraft/i, 'S1'], [/warcraft iii/i, 'W3'], [/call of duty/i, 'ODIN'],
];

/* ---- reading what the tools print ---- */
function parseSteamCmd(line) {
  const m = line.match(/progress:\s*([\d.]+)\s*\((\d+)\s*\/\s*(\d+)\)/i);
  return m ? { percent: parseFloat(m[1]), done: Number(m[2]), total: Number(m[3]) } : null;
}
function parseLegendary(line) {
  const p = line.match(/Progress:\s*([\d.]+)%/i);
  if (p) { const eta = line.match(/ETA:\s*([\d:]+)/i); return { percent: parseFloat(p[1]), eta: eta ? eta[1] : null }; }
  const s = line.match(/Download\s*-\s*([\d.]+)\s*MiB\/s/i);
  return s ? { speed: parseFloat(s[1]) * 1048576 } : null;
}
const SIGN_IN_PROBLEM = /cached credentials not found|invalid password|login failure|two-factor|not logged in|no valid login|please (log|sign) ?in|auth/i;

function createUpdates({ app, net, log, send, openUri, spawnDetached, shell }) {
  const toolsDir = () => path.join(app.getPath('userData'), 'tools');
  const steamCmdPath = () => path.join(toolsDir(), 'steamcmd', IS_WIN ? 'steamcmd.exe' : 'steamcmd.sh');
  const legendaryPath = () => path.join(toolsDir(), IS_WIN ? 'legendary.exe' : 'legendary');
  const jobs = new Map();
  let timer = null;

  const pub = (j) => ({ id: j.id, title: j.title, tool: j.tool, state: j.state, percent: j.percent || 0, done: j.done || 0, total: j.total || 0, speed: j.speed || 0, eta: j.eta || null, line: j.line || '', error: j.error || null, needsSignIn: !!j.needsSignIn, pausable: true });
  const list = () => [...jobs.values()].map(pub);
  const changed = () => { if (timer) return; timer = setTimeout(() => { timer = null; send('updates:changed', list()); }, 400); };

  async function download(url, dest) {
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    const res = await net.fetch(url, { headers: { 'user-agent': 'Crescent-Launcher' } });
    if (!res.ok) throw new Error(`Download failed (HTTP ${res.status}).`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  }
  const run = (cmd, args, timeout = 60000) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout }, (err) => resolve(!err)));

  async function ensureSteamCmd() {
    const exe = steamCmdPath();
    if (fs.existsSync(exe)) return exe;
    if (!IS_WIN) throw new Error('Crescent sets SteamCMD up automatically on Windows only.');
    const zip = path.join(toolsDir(), 'steamcmd.zip');
    await download('https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip', zip);
    const ok = await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -Force -LiteralPath '${zip}' -DestinationPath '${path.dirname(exe)}'`], 120000);
    if (!ok || !fs.existsSync(exe)) throw new Error('SteamCMD could not be unpacked.');
    return exe;
  }
  async function ensureLegendary() {
    const exe = legendaryPath();
    if (fs.existsSync(exe)) return exe;
    if (!IS_WIN) throw new Error('Crescent sets Legendary up automatically on Windows only.');
    await download('https://github.com/derrod/legendary/releases/latest/download/legendary.exe', exe);
    return exe;
  }

  /* ---- a running job (SteamCMD or Legendary) ---- */
  function runStep(job, step) {
    return new Promise(async (resolve) => {
      let cmd;
      try { cmd = typeof step.cmd === 'function' ? await step.cmd() : step.cmd; } catch (err) { job.error = err.message; return resolve(1); }
      const child = spawn(cmd, step.args, { windowsHide: true });
      job.child = child;
      let buf = '';
      const feed = (chunk) => {
        buf += chunk.toString();
        const parts = buf.split(/[\r\n]+/);
        buf = parts.pop();
        for (const line of parts.filter(Boolean)) {
          job.line = line.slice(0, 200);
          job.tail.push(line);
          if (job.tail.length > 12) job.tail.shift();
          const p = step.parse?.(line);
          if (p) Object.assign(job, p);
          changed();
        }
      };
      child.stdout.on('data', feed);
      child.stderr.on('data', feed);
      child.on('error', (err) => { job.error = err.message; resolve(1); });
      child.on('close', (code) => resolve(code ?? 1));
    });
  }

  async function execute(job) {
    job.state = 'running';
    job.error = null;
    changed();
    while (job.step < job.steps.length) {
      const step = job.steps[job.step];
      const code = await runStep(job, step);
      if (job.paused) { job.state = 'paused'; changed(); return; }
      if (job.cancelled) { jobs.delete(job.id); changed(); return; }
      if (code !== 0 && !step.ignoreFail) {
        const tail = job.tail.join('\n');
        job.needsSignIn = SIGN_IN_PROBLEM.test(tail);
        job.error = job.error || (job.needsSignIn ? `${job.tool} needs you to sign in first. Use the sign-in button in Settings, Updates.` : `${job.tool} stopped with an error. ${job.line || ''}`.trim());
        job.state = 'error';
        log.warn(`${job.tool} failed for ${job.title}`, tail);
        changed();
        return;
      }
      job.step++;
    }
    job.state = 'done';
    job.percent = 100;
    changed();
    setTimeout(() => { if (jobs.get(job.id)?.state === 'done') { jobs.delete(job.id); send('updates:changed', list()); send('library:changed'); } }, 8000);
  }

  function begin(game, tool, steps) {
    const old = jobs.get(game.id);
    if (old && ['running', 'paused'].includes(old.state)) throw new Error(`${game.title} is already being updated.`);
    const job = { id: game.id, title: game.title, tool, state: 'running', steps, step: 0, tail: [], percent: 0, paused: false, cancelled: false };
    jobs.set(game.id, job);
    execute(job);
    return job;
  }

  const killTree = (child) => {
    if (!child || child.killed) return;
    if (IS_WIN) execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
    else child.kill('SIGTERM');
  };

  /* ---- what "Update" does for each store ---- */
  async function start(game, settings) {
    const tool = TOOL_NAMES[game.store] || TOOL_NAMES.detected;
    const done = (message) => ({ tool, started: false, message });

    switch (game.store) {
      case 'steam': {
        const user = String(settings.steamUsername || '').trim();
        if (!user) throw new Error('Enter your Steam username in Settings, Updates first. SteamCMD needs it to sign in.');
        if (!game.installPath) throw new Error('Crescent does not know where this game is installed.');
        begin(game, tool, [{ cmd: ensureSteamCmd, args: ['+@ShutdownOnFailedCommand', '1', '+@NoPromptForPassword', '1', '+force_install_dir', game.installPath, '+login', user, '+app_update', String(game.appId), 'validate', '+quit'], parse: parseSteamCmd }]);
        return { tool, started: true, message: `SteamCMD is updating ${game.title}. You can pause it on the Downloads page.` };
      }
      case 'epic': {
        const appName = game.id.split(':')[1];
        begin(game, tool, [
          { cmd: ensureLegendary, args: ['import', appName, game.installPath || ''], ignoreFail: true },
          { cmd: ensureLegendary, args: ['update', appName, '-y'], parse: parseLegendary },
        ]);
        return { tool, started: true, message: `Legendary is updating ${game.title}. You can pause it on the Downloads page.` };
      }
      case 'ubisoft':
        await openUri(`uplay://launch/${game.id.split(':')[1]}/0`);
        return done('Ubisoft Connect opened. It checks the game for updates as it starts.');
      case 'ea': {
        const exe = ['C:\\Program Files\\Electronic Arts\\EA Desktop\\EA Desktop\\EADesktop.exe'].find((p) => fs.existsSync(p));
        if (exe) await spawnDetached(exe, []); else await openUri('origin2://library/open');
        return done('The EA app opened. It updates games from its Library.');
      }
      case 'battlenet': {
        const code = (BATTLENET_CODES.find(([re]) => re.test(game.title)) || [null, ''])[1];
        await openUri(`battlenet://${code}`);
        return done('The Battle.net app opened on this game. Use its Update button if one is shown.');
      }
      case 'riot':
        await spawnDetached(game.launch.target, game.launch.args || []);
        return done('The Riot Client opened. It updates the game before it starts.');
      case 'rockstar': {
        const exe = ['C:\\Program Files\\Rockstar Games\\Launcher\\Launcher.exe', 'C:\\Program Files (x86)\\Rockstar Games\\Launcher\\Launcher.exe'].find((p) => fs.existsSync(p));
        if (!exe) throw new Error('The Rockstar Games Launcher was not found.');
        await spawnDetached(exe, []);
        return done('The Rockstar Games Launcher opened. It updates games when they need it.');
      }
      case 'xbox':
        await run('powershell', ['-NoProfile', '-NonInteractive', '-Command',
          "try { Get-CimInstance -Namespace 'Root\\cimv2\\mdm\\dmmap' -ClassName 'MDM_EnterpriseModernAppManagement_AppManagement01' | Invoke-CimMethod -MethodName UpdateScanMethod | Out-Null } catch {}; Start-Process 'ms-windows-store://downloadsandupdates'"], 25000);
        return done('Windows is checking for updates, and the Microsoft Store opened on its updates page.');
      default:
        if (game.installPath && fs.existsSync(game.installPath)) await shell.openPath(game.installPath);
        return done('This game has no launcher to update it. Its folder opened, so you can use its own updater or website.');
    }
  }

  const get = (id) => {
    const j = jobs.get(id);
    if (!j) throw new Error('This update is not running in Crescent.');
    return j;
  };
  function pause(id) {
    const j = get(id);
    if (j.state !== 'running') return;
    j.paused = true;
    killTree(j.child);
  }
  function resume(id) {
    const j = get(id);
    if (j.state !== 'paused' && j.state !== 'error') return;
    j.paused = false;
    execute(j);
  }
  function cancel(id) {
    const j = jobs.get(id);
    if (!j) return;
    j.cancelled = true;
    if (j.state === 'running') killTree(j.child); else { jobs.delete(id); changed(); }
  }

  // Opens a normal console window so you can sign in yourself. Crescent never sees your password.
  async function signIn(store, settings) {
    if (!IS_WIN) throw new Error('Sign-in windows are set up for Windows.');
    if (store === 'steam') {
      const user = String(settings.steamUsername || '').trim();
      if (!user) throw new Error('Enter your Steam username first.');
      const exe = await ensureSteamCmd();
      execFile('cmd.exe', ['/c', 'start', 'SteamCMD sign-in', exe, '+login', user], { windowsHide: false }, () => {});
      return 'A SteamCMD window opened. Type your password (and Steam Guard code) there once. Then close it.';
    }
    if (store === 'epic') {
      const exe = await ensureLegendary();
      execFile('cmd.exe', ['/c', 'start', 'Legendary sign-in', exe, 'auth'], { windowsHide: false }, () => {});
      return 'A Legendary window opened. Follow the steps there to sign in to Epic Games once.';
    }
    throw new Error('Unknown store.');
  }

  const toolsStatus = () => ({ steamcmd: fs.existsSync(steamCmdPath()), legendary: fs.existsSync(legendaryPath()) });

  return { list, start, pause, resume, cancel, signIn, toolsStatus, TOOL_NAMES, _begin: begin };
}

module.exports = { createUpdates, parseSteamCmd, parseLegendary, TOOL_NAMES };
