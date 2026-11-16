'use strict';

// Lightweight numbers for the performance overlay: CPU, memory, GPU, and (optionally) FPS through Intel's PresentMon.

const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { execFile, spawn } = require('node:child_process');

const IS_WIN = process.platform === 'win32';
const exec = (cmd, args, timeout = 4000) =>
  new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout }, (err, out) => resolve(err ? '' : out)));

let prev = cpuTimes();
function cpuTimes() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    for (const k in c.times) total += c.times[k];
    idle += c.times.idle;
  }
  return { idle, total };
}
function cpuPercent() {
  const now = cpuTimes();
  const di = now.idle - prev.idle, dt = now.total - prev.total;
  prev = now;
  return dt > 0 ? Math.round(100 * (1 - di / dt)) : 0;
}
const ramPercent = () => Math.round((100 * (os.totalmem() - os.freemem())) / os.totalmem());

// NVIDIA first (fast), then Windows' own GPU counters (any brand).
async function gpuPercent() {
  const nv = (await exec('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'])).trim().split(/\r?\n/)[0];
  if (/^\d+$/.test(nv)) return Number(nv);
  if (!IS_WIN) return null;
  const out = await exec('powershell', ['-NoProfile', '-NonInteractive', '-Command',
    "(Get-Counter '\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples | Measure-Object -Property CookedValue -Sum | Select-Object -ExpandProperty Sum"], 6000);
  const v = parseFloat(out.trim().replace(',', '.'));
  return Number.isFinite(v) ? Math.min(100, Math.round(v)) : null;
}

// FPS needs a tool that watches the game's frames. PresentMon is free from Intel and is not bundled with Crescent.
function findPresentMon(extraDirs) {
  for (const d of extraDirs) {
    for (const n of ['PresentMon.exe', 'PresentMon-2.exe']) {
      const p = path.join(d, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function startFps(exePath, processName, onFps) {
  const child = spawn(exePath, ['--process_name', processName, '--output_stdout', '--no_console_stats', '--stop_existing_session', '--terminate_on_proc_exit'], { windowsHide: true });
  const rl = readline.createInterface({ input: child.stdout });
  let col = -1;
  const frames = [];
  rl.on('line', (line) => {
    const cells = line.split(',');
    if (col < 0) {
      col = cells.findIndex((c) => /^(frametime|msbetweenpresents)$/i.test(c.trim()));
      return;
    }
    const ms = parseFloat(cells[col]);
    if (!(ms > 0)) return;
    frames.push(ms);
    if (frames.length > 60) frames.shift();
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    onFps(Math.round(1000 / avg));
  });
  child.on('error', () => {});
  return () => { try { child.kill(); } catch { /* already stopped */ } };
}

module.exports = { cpuPercent, ramPercent, gpuPercent, findPresentMon, startFps };
