'use strict';

// Local milestones (the Milestones page) and the profile picture frames that unlock with play time.

// Profile picture frames. Frames without a "file" are drawn with CSS rings. Frames with a "file" are PNG pictures
// from the "frames" folder: they sit on top of the profile picture and are lined up automatically (see frames.js).
// To add a frame: drop the PNG in "frames" and add a line here. If a very unusual frame is not lined up right,
// add fit: { cx, cy, r } (the see-through circle in pixels of the PNG) to that line.
const FRAMES = [
  { id: 'none', name: 'No frame', hours: 0 },
  { id: 'classic', name: 'Classic', hours: 0 },
  { id: 'silver', name: 'Silver Frame', hours: 5 },
  { id: 'gold', name: 'Gold Frame', hours: 25 },
  { id: 'emerald', name: 'Emerald Frame', hours: 50 },
  { id: 'aurora', name: 'Aurora Ring', hours: 100 },
  { id: 'stellar', name: 'Stellar Ring', hours: 250 },
  { id: 'sakura', name: 'Sakura Frame', hours: 600, file: 'SakuraFrame.png' },
  { id: 'thorns-and-roses', name: 'Thorns and Roses Frame', hours: 650, file: 'ThornsAndRosesFrame.png' },
  { id: 'chroma', name: 'Chroma Frame', hours: 700, file: 'ChromaFrames.png' },
  { id: 'crescent', name: 'Crescent Frame', hours: 750, file: 'CrescentFrame.png', fit: { cx: 316, cy: 261, r: 183 } },
];
const HOUR_STEPS = [1, 5, 10, 25, 50, 100, 250, 500];
const LIBRARY_STEPS = [10, 25, 50, 100];

const totalSeconds = (data) => Object.values(data.stats || {}).reduce((n, s) => n + (s.playSeconds || 0), 0);

// Adds every milestone that has been reached and is not in the list yet. Returns the new ones.
// With silent = true the milestones are remembered but not shown (used once, for play time from before this feature).
function checkMilestones(data, games, { silent = false, now = Date.now() } = {}) {
  const fresh = [];
  const add = (key, kind, text) => {
    if (data.milestoneKeys.includes(key)) return;
    data.milestoneKeys.push(key);
    if (silent) return;
    const entry = { id: key, kind, text, at: now };
    data.milestones.unshift(entry);
    fresh.push(entry);
  };

  for (const g of games) {
    const secs = data.stats[g.id]?.playSeconds || 0;
    if (secs > 0) add(`first:${g.id}`, 'game', `First time playing ${g.title}`);
    for (const h of HOUR_STEPS) if (secs >= h * 3600) add(`hours:${g.id}:${h}`, 'hours', `You just hit ${h} ${h === 1 ? 'hour' : 'hours'} in ${g.title}`);
  }
  for (const n of LIBRARY_STEPS) if (games.length >= n) add(`library:${n}`, 'library', `Your library grew to ${n} games`);
  const hours = totalSeconds(data) / 3600;
  for (const b of FRAMES) if (b.hours > 0 && hours >= b.hours) add(`border:${b.id}`, 'border', `Unlocked the ${b.name} achievement`);

  if (data.milestones.length > 200) data.milestones.length = 200;
  return fresh;
}

module.exports = { FRAMES, HOUR_STEPS, totalSeconds, checkMilestones };
