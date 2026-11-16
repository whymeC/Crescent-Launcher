(() => {
  'use strict';

  const api = window.launcher;
  const { h, icon, popup, modal, uploadModal, moons } = window.UI;
  const $ = (s) => document.querySelector(s);
  const page = $('#page');

  const state = {
    games: [], stores: {}, disk: null, settings: {}, running: new Set(), launching: new Map(),
    profile: { name: 'Player', avatarUrl: null, banner: null, theme: { type: 'none', id: null } },
    themes: null, version: '', update: { state: 'idle' }, scan: { active: false, text: '' },
    stack: ['home'], pos: 0, route: 'home',
    query: '', tab: 'all', sort: 'recent', layout: 'grid', featured: 0, themeTab: 'animated',
    snapshot: '', pollTimer: null, heroTimer: null, themeSig: '',
    bannerCache: null, liveBase: {}, miniSig: '', tip: Math.floor(Math.random() * 1000),
    widgets: [], tags: [], gameTags: {}, milestones: [], borders: [], totalSeconds: 0, searchIndex: 0, searchResults: [],
    jobs: [], openDl: null, dl: {}, afk: false, lastActive: Date.now(), idleTimer: null, lastUi: null, avatarCache: null,
  };

  const STORES = {
    steam: 'Steam', epic: 'Epic Games', gog: 'GOG', ea: 'EA app', ubisoft: 'Ubisoft Connect', battlenet: 'Battle.net',
    xbox: 'Xbox / Microsoft Store', riot: 'Riot Games', rockstar: 'Rockstar Games', roblox: 'Roblox',
    detected: 'Found on this PC', manual: 'Added by you',
  };
  const STORE_LIST = ['steam', 'epic', 'gog', 'ea', 'ubisoft', 'battlenet', 'xbox', 'riot', 'rockstar', 'roblox', 'detected'];

  /* ---------------- helpers ---------------- */

  const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const dayStart = (t) => new Date(t).setHours(0, 0, 0, 0);
  function ago(ts) {
    if (!ts) return 'never';
    const d = Math.round((dayStart(Date.now()) - dayStart(ts)) / 864e5);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  // Seconds, minutes and hours, e.g. "2 h 14 min 8 s"
  function duration(sec) {
    const s = Math.round(sec);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return [hh && `${hh} h`, (hh || mm) && `${mm} min`, `${ss} s`].filter(Boolean).join(' ');
  }
  const durationShort = (sec) => (sec >= 3600 ? `${(sec / 3600).toFixed(1)} h` : sec >= 60 ? `${Math.floor(sec / 60)} min` : sec > 0 ? `${Math.round(sec)} s` : '');
  const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
  const pct = (g) => { const j = jobOf(g); return j && j.percent ? Math.round(j.percent) : Math.round((g.progress || 0) * 100); };
  const button = (label, kind, onclick, iconName) => h('button', { class: `btn ${kind}`, type: 'button', onclick }, iconName ? icon(iconName) : null, label);

  const notify = (title, text, kind = 'info') => popup({ kind, title, text });

  // Play time that ticks every second while a game runs, without redrawing the page.
  const FORMATS = {
    full: (s) => (s > 0 ? duration(s) : 'Not yet'),
    short: durationShort,
    played: (s) => (s > 0 ? `${duration(s)} played` : ''),
  };
  function livePlaySeconds(g, now = Date.now()) {
    const b = state.liveBase[g.id];
    return state.running.has(g.id) && state.settings.trackPlaytime !== false && b ? b.seconds + (now - b.at) / 1000 : g.playSeconds;
  }
  function liveText(g, kind, prefix = '', suffix = '') {
    const el = h('span', { 'data-live': g.id, 'data-kind': kind, 'data-prefix': prefix, 'data-suffix': suffix });
    const t = FORMATS[kind](livePlaySeconds(g));
    el.textContent = t ? prefix + t + suffix : '';
    return el;
  }
  function tickLive() {
    const now = Date.now();
    const byId = new Map(state.games.map((g) => [g.id, g]));
    document.querySelectorAll('[data-live]').forEach((el) => {
      const g = byId.get(el.dataset.live);
      if (!g) return;
      const t = FORMATS[el.dataset.kind](livePlaySeconds(g, now));
      const text = t ? el.dataset.prefix + t + el.dataset.suffix : '';
      if (el.textContent !== text) el.textContent = text;
    });
  }

  const TIPS = [
    "You're doing better than you think.", 'Take a deep breath. You have got this.', 'Be proud of how far you have come.',
    'Every small step still counts.', 'You deserve a good break today.', 'Your effort matters, even when nobody sees it.',
    "It's okay to rest. You'll come back stronger.", 'You make the world a little brighter.', 'Today is a good day to be kind to yourself.',
    "Mistakes mean you're trying. Keep going.", 'You are more capable than you realize.', 'Enjoy the game. You have earned it.',
    'Someone is glad you exist.', 'Progress, not perfection.', 'You are enough, just as you are.', 'Good things are coming your way.',
    'Your curiosity is a strength.', "Win or lose, you're still awesome.", 'Be gentle with yourself today.',
    "You've handled hard days before. You can do it again.", 'Thanks for being you.', 'A little fun is good for the soul.',
    "You're allowed to take your time.", 'Small joys add up to a happy life.', 'Believe in the version of you that keeps going.',
  ];

  const ROUTE_NAMES = { home: 'Home', library: 'Library', downloads: 'Downloads', milestones: 'Milestones', account: 'Account', settings: 'Settings' };
  function routeName(route) {
    if (route.startsWith('game:')) return state.games.find((g) => g.id === route.slice(5))?.title || 'game';
    return ROUTE_NAMES[route] || 'Home';
  }
  // The page the player came from, not always the library.
  const backLabel = () => `Back to ${routeName(state.pos > 0 ? state.stack[state.pos - 1] : 'library')}`;
  function failure(text, retry) {
    const p = popup({
      kind: 'error', title: 'Oops! so sorry', text,
      actions: [retry ? { label: 'Retry', onclick: () => { p.close(); retry(); } } : null, { label: 'Cancel', onclick: () => p.close() }].filter(Boolean),
    });
  }

  // Cover art with fallbacks: tries each image in turn, then shows a typographic tile.
  function artBox(game, kinds, cls = '') {
    const box = h('div', { class: `art ${cls}` }, h('span', { class: 'art-title', text: game.title }));
    box.style.setProperty('--hue', hue(game.title));
    const urls = kinds.map((k) => game.art?.[k]).filter(Boolean);
    (function next() {
      const url = urls.shift();
      if (!url) return;
      const img = h('img', { src: url, alt: '', loading: 'lazy', onerror: () => { img.remove(); next(); } });
      box.append(img);
    })();
    return box;
  }

  const byRecent = (list) => [...list].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.title.localeCompare(b.title));
  const byPlayed = (list) => [...list].sort((a, b) => b.playSeconds - a.playSeconds || (b.lastPlayed || 0) - (a.lastPlayed || 0));
  const sortGames = (list) => (state.sort === 'name' ? [...list].sort((a, b) => a.title.localeCompare(b.title)) : state.sort === 'played' ? byPlayed(list) : byRecent(list));
  const needsUpdate = (g) => g.state === 'updating';
  const jobOf = (g) => state.jobs.find((j) => j.id === g.id && j.state !== 'done');
  const pendingUpdates = () => state.games.filter((g) => g.state === 'updating' && g.updating !== 'running' && !jobOf(g));
  const inProgress = () => state.games.filter((g) => g.state === 'installing' || (g.state === 'updating' && g.updating === 'running') || !!jobOf(g));
  const buildLine = (g) => STORES[g.store] || '';

  /* ---------------- game actions ---------------- */

  async function play(g) {
    state.launching.set(g.id, Date.now());
    render(false);
    const r = await api.launchGame(g.id);
    if (!r.ok) {
      state.launching.delete(g.id);
      render(false);
      return failure(`Couldn't start ${g.title}. ${r.error}`, () => play(g));
    }
    setTimeout(() => { if (!state.running.has(g.id) && state.launching.delete(g.id)) render(false); }, 45000);
  }
  async function closeGame(g) {
    const r = await api.closeGame(g.id);
    if (!r.ok) return failure(`Couldn't close ${g.title}. ${r.error}`, () => closeGame(g));
    notify(`Closing ${g.title}…`, 'Crescent asked the game to close.');
  }
  async function updateGame(g) {
    const r = await api.updateGame(g.id);
    if (!r.ok) return failure(`Couldn't update ${g.title}. ${r.error}`, () => updateGame(g));
    notify(r.started ? 'Update started' : 'Opened for you', r.message);
    setTimeout(() => refresh(false), 1500);
  }

  const TOOL_LABEL = {
    steam: 'SteamCMD', epic: 'Legendary', ea: 'EA app URI protocol handler', ubisoft: 'Ubisoft Connect URI protocol handler',
    battlenet: 'Battle.net client protocol', xbox: 'PowerShell (winget and Get-AppxPackage)', riot: 'Riot Client command line',
    rockstar: 'Rockstar Launcher command line', minecraft: 'The launcher itself', roblox: 'Roblox',
    detected: 'Local executable (standalone or DRM-free)', manual: 'Local executable (standalone or DRM-free)',
  };
  const TOOL_SHORT = { epic: 'Legendary', ea: 'EA app', ubisoft: 'Ubisoft Connect', battlenet: 'Battle.net', xbox: 'PowerShell', riot: 'Riot Client', rockstar: 'Rockstar Launcher' };
  const canToolUpdate = (g) => !!TOOL_SHORT[g.store] && g.state === 'installed';
  const isWideHome = () => !!state.settings.friendsHidden && window.outerWidth >= screen.availWidth - 24 && window.outerHeight >= screen.availHeight - 24;
  const clock = (sec) => {
    const s2 = Math.max(0, Math.round(sec));
    const hh = Math.floor(s2 / 3600), mm = Math.floor((s2 % 3600) / 60), ss = s2 % 60;
    const two = (n) => String(n).padStart(2, '0');
    return hh ? `${hh}:${two(mm)}:${two(ss)}` : `${two(mm)}:${two(ss)}`;
  };

  // The main button for a game: Play, Close Game, Update, or a disabled status.
  function gameAction(g, { big = false, playLabel = 'Play' } = {}) {
    const cls = big ? 'big' : '';
    const disabled = (label) => h('button', { class: `btn ${cls}`, type: 'button', disabled: true }, label);
    if (state.running.has(g.id)) return h('button', { class: `btn danger ${cls}`, type: 'button', onclick: () => closeGame(g) }, icon('stop'), 'Close Game');
    if (state.launching.has(g.id)) return disabled('Starting…');
    const job = jobOf(g);
    if (job && job.state === 'running') return disabled(`Updating ${Math.round(job.percent)}%`);
    if (job && job.state === 'paused') return disabled('Update paused');
    if (g.state === 'installing') return disabled(`Installing ${pct(g)}%`);
    if (g.state === 'missing') return disabled('File missing');
    if (g.state === 'updating') {
      if (g.updating === 'running') return disabled(`Updating ${pct(g)}%`);
      return h('button', { class: `btn update ${cls}`, type: 'button', onclick: () => updateGame(g) }, icon('download'), 'Update');
    }
    return h('button', { class: `btn light ${cls}`, type: 'button', onclick: () => play(g) }, icon('play'), playLabel);
  }

  function roundAction(g, mini = false) {
    const run = state.running.has(g.id);
    const upd = g.state === 'updating' && g.updating !== 'running' && !run;
    const off = state.launching.has(g.id) || g.state === 'installing' || g.state === 'missing' || (g.state === 'updating' && g.updating === 'running');
    const fn = run ? () => closeGame(g) : upd ? () => updateGame(g) : () => play(g);
    return h('button', {
      class: `round${mini ? ' mini' : ''}${run ? ' stop' : upd ? ' upd' : ''}`, type: 'button', disabled: off,
      'aria-label': `${run ? 'Close' : upd ? 'Update' : 'Play'} ${g.title}`,
      onclick: (e) => { e.stopPropagation(); fn(); },
    }, icon(run ? 'stop' : upd ? 'download' : 'play'));
  }

  async function toggleFav(g) {
    g.favorite = await api.toggleFavorite(g.id);
    render(false);
  }
  async function addGame() {
    const r = await api.addGame();
    if (!r.ok) return failure(`Couldn't add that game. ${r.error}`, addGame);
    if (r.canceled) return;
    await refresh(true);
    go(`game:${r.id}`);
  }

  /* ---------------- loader ---------------- */

  const loader = $('#loader');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function withLoader(text, job, min = 1200) {
    $('#loader-text').textContent = text;
    loader.classList.remove('hide');
    await Promise.all([job(), wait(min)]);
    loader.classList.add('hide');
  }

  /* ---------------- shared pieces ---------------- */

  function statusBadge(g) {
    if (state.running.has(g.id)) return h('span', { class: 'badge run', text: 'Running' });
    if (g.state === 'installed') return h('span', { class: 'badge' }, icon('check'), 'Installed');
    if (g.state === 'missing') return h('span', { class: 'badge busy', text: 'File missing' });
    if (g.state === 'installing') return h('span', { class: 'badge busy', text: `Installing ${pct(g)}%` });
    return h('span', { class: 'badge busy', text: g.updating === 'running' ? `Updating ${pct(g)}%` : 'Update available' });
  }

  function card(g) {
    const sub = g.state === 'installing' ? STORES[g.store]
      : g.state === 'updating' && g.updating === 'running' && g.downloadTotal ? `${gb(g.downloadDone || 0)} / ${gb(g.downloadTotal)}`
      : [g.lastPlayed ? `Last played ${ago(g.lastPlayed)}` : 'Not played yet', liveText(g, 'short', ' · ')];
    const open = () => go(`game:${g.id}`);
    return h('article', { class: 'card', tabindex: '0', role: 'link', 'aria-label': g.title, onclick: open, onkeydown: (e) => e.key === 'Enter' && open() },
      artBox(g, ['header', 'hero']),
      statusBadge(g),
      h('button', {
        class: `star${g.favorite ? ' on' : ''}`, type: 'button', 'aria-label': g.favorite ? 'Remove from favorites' : 'Add to favorites',
        onclick: (e) => { e.stopPropagation(); toggleFav(g); },
      }, icon('star')),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-text' }, h('div', { class: 'card-title', text: g.title }), h('div', { class: 'card-sub' }, sub)),
        roundAction(g)));
  }

  function emptyState() {
    return h('section', { class: 'empty' },
      h('h2', { text: 'No games found yet' }),
      h('p', { text: 'Crescent looks through your game launchers and your drives. Games from other places can be added by hand.' }),
      h('div', { class: 'btn-stack' }, button('Add a game', 'light', addGame, 'plus'), button('Scan again', 'ghost', rescan, 'refresh')));
  }

  const rescan = () => withLoader('Looking for your games…', () => refresh(true), 1000);


  /* ---------------- 1.0.5 helpers ---------------- */

  // Chilling and Do Not Disturb are your own choice. In-Game and AFK are worked out by Crescent.
  const STATUS_PRESETS = [{ id: 'online', label: 'Online' }, { id: 'chilling', label: 'Chilling' }, { id: 'dnd', label: 'Do Not Disturb' }];
  function statusInfo() {
    const s2 = state.profile.status || { preset: 'online', message: '' };
    if (s2.preset === 'dnd' || s2.preset === 'chilling') return { id: s2.preset, label: s2.message || STATUS_PRESETS.find((p) => p.id === s2.preset).label };
    const active = state.games.find((g) => state.running.has(g.id) || state.launching.has(g.id));
    if (active) return { id: 'ingame', label: `In-Game: ${active.title}` };
    if (state.afk) return { id: 'afk', label: 'AFK' };
    return { id: 'online', label: s2.message || 'Online' };
  }
  const borderClass = () => (state.profile.border && state.profile.border !== 'none' ? ` bd-${state.profile.border}` : '');
  const when = (ts) => `${ago(ts)[0].toUpperCase()}${ago(ts).slice(1)} · ${new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

  // Readable text colour for the accent colour
  function inkFor(hex) {
    const n = parseInt(hex.slice(1), 16);
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
    return L > 0.4 ? '#111214' : '#ffffff';
  }

  // Interface style, accent colour and the transitions switch
  function applyLook() {
    const p = state.profile;
    const b = document.body;
    b.classList.toggle('ui-glass', p.uiTheme === 'glass');
    b.classList.toggle('ui-cartoon', p.uiTheme === 'cartoon');
    b.classList.toggle('no-transitions', state.settings.transitions === false);
    let color = p.accent?.color || '#f1f1f3';
    if (p.uiTheme === 'cartoon' && (p.accent?.mode || 'default') === 'default') color = '#ff5a4d';
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-ink', inkFor(color));
    document.documentElement.style.setProperty('--wall-dim', String(((p.wallpaperDim ?? 50) / 100) * 0.95));
    if (state.lastUi !== null && state.lastUi !== p.uiTheme) {
      b.classList.add('switching');
      setTimeout(() => b.classList.remove('switching'), 450);
    }
    state.lastUi = p.uiTheme;
  }

  function promptText({ title, text, placeholder = '', confirm = 'Create' }) {
    return new Promise((resolve) => {
      let done = false;
      modal((close) => {
        const input = h('input', { class: 'input', placeholder, maxlength: '24' });
        const ok = () => { done = true; resolve(input.value.trim()); close(); };
        input.addEventListener('keydown', (e) => e.key === 'Enter' && ok());
        setTimeout(() => input.focus(), 60);
        return [h('h3', { text: title }), h('p', { class: 'sub', text }), input,
          h('div', { class: 'modal-actions' }, button('Cancel', 'ghost', close), button(confirm, 'light', ok))];
      }, { cls: 'small', onClose: () => { if (!done) resolve(null); } });
    });
  }

  const statusText = (g) => (state.running.has(g.id) ? 'Running' : g.state === 'installed' ? 'Installed' : g.state === 'updating' ? 'Update available' : g.state === 'installing' ? 'Installing' : 'File missing');

  /* ---- search drop-down in the title bar ---- */
  function drawSearchMenu() {
    const menu = $('#search-menu');
    const raw = $('#search').value;
    const q = raw.trim().toLowerCase();
    if (!q) { menu.hidden = true; return; }
    const rank = (g) => (g.title.toLowerCase().startsWith(q) ? 0 : 1);
    const results = state.games.filter((g) => g.title.toLowerCase().includes(q)).sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title)).slice(0, 6);
    state.searchResults = results;
    state.searchIndex = Math.min(state.searchIndex, Math.max(0, results.length - 1));
    menu.hidden = false;
    menu.replaceChildren(...(results.length
      ? results.map((g, i) => h('div', { class: `sr${i === state.searchIndex ? ' on' : ''}`, role: 'option', onmousedown: (e) => { e.preventDefault(); openSearchResult(g); } },
        artBox(g, ['header', 'hero']), h('div', { class: 'grow' }, h('b', { text: g.title }), h('small', { text: `${STORES[g.store]} · ${statusText(g)}` }))))
      : [h('p', { class: 'sr-empty', text: `No game called "${raw}" in your library.` })]));
  }
  function openSearchResult(g) {
    $('#search').value = '';
    $('#search-menu').hidden = true;
    go(`game:${g.id}`);
  }

  /* ---- tags ---- */
  async function createTagFlow(applyTo) {
    const name = await promptText({ title: 'New tag', text: 'Group your games your own way, for example Co-Op, Indie or Backlog.', placeholder: 'Tag name' });
    if (!name) return;
    const r = await api.createTag(name);
    if (!r.ok) return failure(r.error);
    if (applyTo) await api.setGameTag(applyTo, r.tag.id, true);
    await refresh(false);
  }

  function confirmDialog({ title, text, confirm = 'Delete' }) {
    return new Promise((resolve) => {
      let answered = false;
      modal((close) => [
        h('h3', { text: title }), h('p', { class: 'sub', text }),
        h('div', { class: 'modal-actions' }, button('Cancel', 'ghost', close),
          button(confirm, 'danger', () => { answered = true; resolve(true); close(); })),
      ], { cls: 'small', onClose: () => { if (!answered) resolve(false); } });
    });
  }

  function tagPanel(g) {
    const on = new Set(state.gameTags[g.id] || []);
    const chips = state.tags.map((t) => h('button', {
      class: `chip-btn${on.has(t.id) ? ' on' : ''}`, type: 'button', 'aria-pressed': String(on.has(t.id)),
      onclick: async () => { await api.setGameTag(g.id, t.id, !on.has(t.id)); await refresh(false); },
    }, t.name));
    const quick = state.tags.length ? [] : ['Co-Op', 'Indie', 'Backlog'].map((n) => h('button', {
      class: 'chip-btn', type: 'button', text: `+ ${n}`,
      onclick: async () => { const r = await api.createTag(n); if (r.ok) { await api.setGameTag(g.id, r.tag.id, true); await refresh(false); } },
    }));
    return h('div', { style: 'margin-top:22px' },
      h('h3', { text: 'Tags' }), h('div', { style: 'height:10px' }),
      h('div', { class: 'chips' }, chips, quick, h('button', { class: 'chip-btn', type: 'button', onclick: () => createTagFlow(g.id) }, icon('plus'), 'New tag')));
  }

  /* ---- widgets (the ones you add can be removed; the built-in ones cannot) ---- */
  function borderTarget(id) {
    const hours = state.totalSeconds / 3600;
    const list = state.borders.filter((b) => b.hours > 0);
    return id && id !== 'next' ? list.find((b) => b.id === id) : list.find((b) => b.hours > hours);
  }
  function borderWidget(widget, removable) {
    const hours = state.totalSeconds / 3600;
    const b = borderTarget(widget?.borderId);
    const left = b ? Math.max(0, b.hours - hours) : 0;
    const body = !b
      ? [h('div', { class: 'w-big', text: 'All unlocked' }), h('div', { class: 'card-sub', text: 'You have every border.' })]
      : left === 0
        ? [h('div', { class: 'w-big', text: 'Unlocked' }), h('div', { class: 'card-sub', text: `${b.name} is yours.` })]
        : [h('div', { class: 'w-big', text: `${left.toFixed(1)} h` }), h('div', { class: 'bar' }, h('i', { style: `width:${Math.min(100, (hours / b.hours) * 100)}%` })), h('div', { class: 'card-sub', style: 'margin-top:6px', text: `until the ${b.name} border` })];
    return h('section', { class: 'panel widget' }, h('h3', { text: 'Hours until border' }), body, removable ? removeX(widget) : null);
  }
  const removeX = (w) => h('button', { class: 'w-x', type: 'button', 'aria-label': 'Remove widget', onclick: async () => { state.widgets = await api.removeWidget(w.id); render(false); } }, icon('x'));
  function widgetCard(w) {
    if (w.type === 'border-hours') return borderWidget(w, true);
    if (['image', 'gif', 'video'].includes(w.type)) {
      const box = h('div', { class: 'w-media' });
      box.style.aspectRatio = `${w.width || 16} / ${w.height || 9}`;
      box.append(w.type === 'video' ? videoEl(w.url, null) : h('img', { src: w.url, alt: '' }));
      return h('section', { class: 'panel widget media-widget' }, box, removeX(w));
    }
    const g = state.games.find((x) => x.id === w.gameId);
    return h('section', { class: 'panel widget' }, h('h3', { text: 'Total time' }),
      g ? h('div', { class: 'w-game' }, artBox(g, ['header', 'hero']), h('div', {}, h('div', { class: 'card-title', text: g.title }), h('div', { class: 'w-big' }, liveText(g, 'full'))))
        : h('p', { class: 'sub', text: 'This game is no longer in your library.' }),
      removeX(w));
  }
  function widgetSection(pageName) {
    const mine = state.widgets.filter((w) => w.page === pageName);
    return h('div', {},
      h('div', { class: 'section-head' }, h('h3', { text: 'Your widgets' }), button('Add widget', 'ghost small', () => showAddWidget(pageName), 'plus')),
      mine.length ? h('div', { class: 'widgets' }, mine.map(widgetCard)) : h('p', { class: 'sub', style: 'margin-bottom:20px', text: 'Add a widget to keep an eye on a game, or add your own picture, GIF or video.' }));
  }
  function showAddWidget(pageName) {
    let type = state.games.length ? 'game-time' : 'border-hours';
    let gameValue = state.games[0]?.id;
    let borderValue = 'next';
    modal((close) => {
      const gameBox = h('div', {}, window.UI.dropdown({ value: gameValue, label: 'Game', options: state.games.map((g) => [g.id, g.title]), onChange: (v) => { gameValue = v; } }));
      const borderBox = h('div', {}, window.UI.dropdown({ value: 'next', label: 'Border', options: [['next', 'Next border to unlock'], ...state.borders.filter((b) => b.hours > 0).map((b) => [b.id, `${b.name} (${b.hours} h)`])], onChange: (v) => { borderValue = v; } }));
      const defs = [
        ['game-time', 'Total time on a game', 'Shows how long you have played a game of your choice.'],
        ['border-hours', 'Hours until a profile picture border', 'Shows how many hours you still need to unlock a border.'],
        ['image', 'Image', 'Show a picture of your own.'],
        ['gif', 'GIF', 'Show a GIF of your own (10 seconds at most).'],
        ['video', 'Video', 'Show a video of your own (10 seconds at most).'],
      ];
      const picks = defs.map(([id, title, sub]) => h('button', { class: 'pick', type: 'button', disabled: id === 'game-time' && !state.games.length, onclick: () => set(id) }, h('b', { text: title }), h('small', { text: sub })));
      const addBtn = button('Add widget', 'light', () => add());
      function set(t) {
        type = t;
        picks.forEach((b, i) => b.classList.toggle('on', defs[i][0] === t));
        gameBox.hidden = t !== 'game-time';
        borderBox.hidden = t !== 'border-hours';
        addBtn.lastChild.textContent = ['image', 'gif', 'video'].includes(t) ? 'Choose file…' : 'Add widget';
      }
      set(type);
      async function add() {
        if (['image', 'gif', 'video'].includes(type)) { close(); startWidgetUpload(pageName, type); return; }
        const r = await api.addWidget({ page: pageName, type, gameId: gameValue, borderId: borderValue });
        if (!r.ok) return failure(r.error);
        state.widgets = r.widgets; // show it straight away, without waiting for a rescan
        close();
        render(false);
      }
      return [h('h3', { text: 'Add a widget' }), h('p', { class: 'sub', text: 'Choose what it shows. You can remove it again later.' }),
        h('div', { class: 'pick-list' }, picks), gameBox, borderBox,
        h('div', { class: 'modal-actions' }, button('Cancel', 'ghost', close), addBtn)];
    }, { cls: 'small' });
  }

  /* ---- milestones page ---- */
  const FEED_ICON = { game: 'play', hours: 'trophy', library: 'library', border: 'trophy', info: 'bell' };
  function pageMilestones() {
    const feed = state.milestones.length
      ? h('div', { class: 'feed' }, state.milestones.slice(0, 25).map((m) => h('div', { class: 'feed-item' },
        h('span', { class: 'feed-ico' }, icon(FEED_ICON[m.kind] || 'star')), h('div', { class: 'grow' }, h('div', { text: m.text }), h('small', { text: when(m.at) })))))
      : h('p', { class: 'sub', text: 'Play a game and your milestones show up here.' });
    return h('div', {},
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Milestones' }), h('p', { class: 'sub', text: 'The little moments you have earned.' }))),
      h('div', { class: 'cols even', style: 'margin-bottom:16px' },
        h('section', { class: 'panel' }, h('h3', {}, 'Activity feed', h('small', { class: 'card-sub', text: 'Recent milestones' })), feed),
        h('div', {}, borderWidget(null, false),
          h('section', { class: 'panel', style: 'margin-top:16px' }, h('h3', { text: 'Total play time' }),
            h('div', { class: 'w-big', text: `${(state.totalSeconds / 3600).toFixed(1)} h` }), h('div', { class: 'card-sub', text: 'Across every game in Crescent' })))),
      widgetSection('milestones'));
  }

  /* ---------------- home ---------------- */

  function heroList() {
    const playable = state.games.filter((g) => g.state === 'installed' || g.state === 'updating');
    const top = byPlayed(playable.filter((g) => g.playSeconds > 0)).slice(0, 4);
    for (const g of byRecent(playable)) if (top.length < 4 && !top.includes(g)) top.push(g);
    return top;
  }

  function hero(g, list, onSelect) {
    return h('section', { class: 'hero' },
      artBox(g, ['hero', 'header']),
      h('div', { class: 'hero-shade' }),
      h('div', { class: 'hero-body' },
        h('div', { class: 'eyebrow' }, h('i'), g.playSeconds ? 'Jump back in' : 'Ready when you are'),
        h('h2', { text: g.title }),
        h('div', { class: 'build', text: buildLine(g) }),
        h('p', { class: 'hero-desc', text: g.meta?.description || '' }),
        h('div', { class: 'hero-stats' }, liveText(g, 'played', '', ' · '), g.lastPlayed ? `Last played ${ago(g.lastPlayed)}` : 'Not played yet'),
        h('div', { class: 'btn-row' }, gameAction(g, { playLabel: 'Launch game' }), button('View details', 'ghost', () => go(`game:${g.id}`)))),
      list.length > 1
        ? h('div', { class: 'dots' }, list.map((x, i) => h('button', { class: `dot${x === g ? ' on' : ''}`, type: 'button', 'aria-label': `Show ${x.title}`, onclick: () => onSelect(i) })))
        : null);
  }

  // Two heroes can sit on top of each other: the next game fades in over the current one.
  function heroStage(list) {
    const stage = h('div', { class: 'hero-stage' });
    let index = state.featured % list.length;
    let current;
    const show = (next) => {
      index = ((next % list.length) + list.length) % list.length;
      state.featured = index;
      const el = hero(list[index], list, show);
      if (!current) { current = el; stage.append(el); return; }
      clearInterval(state.heroTimer);
      if (list.length > 1) state.heroTimer = setInterval(() => show(index + 1), 9000);
      if (state.settings.heroTransition === false) { current.replaceWith(el); current = el; return; }
      el.classList.add('enter');
      stage.append(el);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
      const old = current;
      current = el;
      setTimeout(() => old.remove(), 1000);
    };
    show(index);
    if (list.length > 1) state.heroTimer = setInterval(() => show(index + 1), 9000);
    return stage;
  }

  function pageHome() {
    const g = state.games;
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const root = h('div', {},
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { text: `${greet}, ${state.profile.name}.` }), h('p', { class: 'sub', text: 'A little escape is waiting for you.' })),
        h('span', { class: 'pill-note' }, icon('library'), `${g.length} games in your library`)));
    if (!g.length) { root.append(emptyState()); return root; }

    const list = heroList();
    if (list.length) root.append(heroStage(list));

    const recent = byRecent(g).slice(0, 5);
    root.append(
      h('div', { class: 'section-head' }, h('h3', { text: g.some((x) => x.lastPlayed) ? 'Recently played' : 'Your games' }),
        h('button', { class: 'link-btn', type: 'button', onclick: () => go('library') }, 'View library', icon('fwd'))),
      h('div', { class: isWideHome() ? 'cards five' : 'cards list' }, recent.map(card)),
      widgetSection('home'));

    const active = inProgress();
    if (active.length) {
      const a = active[0];
      root.append(h('div', { class: 'strip' }, icon('download'),
        h('div', { class: 'grow' }, h('div', { text: `${a.title}${active.length > 1 ? ` and ${active.length - 1} more` : ''}` }), h('div', { class: 'card-sub', text: `${a.state === 'installing' ? 'Installing' : 'Updating'} · ${pct(a)}%` })),
        h('div', { style: 'width:220px' }, h('div', { class: 'bar' }, h('i', { style: `width:${pct(a)}%` }))),
        button('View', 'ghost small', () => go('downloads'))));
    }
    return root;
  }

  /* ---------------- library ---------------- */

  function pageLibrary() {
    const all = state.games;
    const sets = { all, installed: all.filter((g) => g.state === 'installed'), favorites: all.filter((g) => g.favorite) };
    for (const t of state.tags) sets[`tag:${t.id}`] = all.filter((g) => (state.gameTags[g.id] || []).includes(t.id));
    if (!sets[state.tab]) state.tab = 'all'; // the tag was deleted
    const grid = h('div', { class: `cards${state.layout === 'list' ? ' list' : ''}` });
    const count = h('small');

    function draw() {
      const q = state.query.trim().toLowerCase();
      const list = sortGames(sets[state.tab].filter((g) => !q || g.title.toLowerCase().includes(q)));
      grid.replaceChildren(...list.map(card));
      if (!list.length) grid.replaceChildren(h('p', { class: 'sub', text: q ? `No games match "${state.query}".` : state.tab.startsWith('tag:') ? 'No games have this tag yet. Open a game to add it.' : 'Nothing here yet.' }));
      count.textContent = `Showing ${list.length} of ${all.length} games`;
    }
    draw();

    const search = h('input', { type: 'search', placeholder: `Search ${all.length} games`, value: state.query, 'aria-label': 'Search your library' });
    search.addEventListener('input', () => { state.query = search.value; draw(); });

    const sort = window.UI.dropdown({
      value: state.sort, label: 'Sort games', align: 'right',
      options: [['recent', 'Recently played'], ['name', 'Name'], ['played', 'Most played']],
      onChange: (v) => { state.sort = v; draw(); },
    });

    const layoutBtn = (name, label) => h('button', { type: 'button', class: state.layout === name ? 'on' : '', 'aria-label': label, onclick: () => { state.layout = name; render(false); } }, icon(name));
    const tabs = [['all', 'All games'], ['installed', 'Installed'], ['favorites', 'Favorites'], ...state.tags.map((t) => [`tag:${t.id}`, t.name])];
    const currentTag = state.tab.startsWith('tag:') ? state.tags.find((t) => `tag:${t.id}` === state.tab) : null;

    return h('div', {},
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { text: 'Your library' }), h('p', { class: 'sub', text: 'All your worlds. One place to come back to.' })),
        button('Add a game', 'ghost', addGame, 'plus')),
      h('div', { class: 'tabs', role: 'tablist' },
        tabs.map(([key, label]) => h('button', { class: `tab${state.tab === key ? ' on' : ''}`, type: 'button', role: 'tab', onclick: () => { state.tab = key; render(false); } }, label, h('small', { text: sets[key].length }))),
        h('div', { class: 'tab-actions' },
          currentTag ? button('Delete tag', 'ghost small', async () => {
            if (!(await confirmDialog({ title: `Delete the tag "${currentTag.name}"?`, text: 'The tag is removed from every game. Your games are not deleted.' }))) return;
            await api.deleteTag(currentTag.id); state.tab = 'all'; await refresh(false);
          }, 'trash') : null,
          button('New tag', 'ghost small', () => createTagFlow(), 'tag'))),
      h('div', { class: 'toolbar' },
        h('label', { class: 'field grow' }, icon('search'), search),
        h('div', { class: 'field dd-field' }, h('span', { class: 'card-sub', text: 'Sort by' }), sort),
        h('div', { class: 'seg' }, layoutBtn('grid', 'Grid view'), layoutBtn('list', 'List view'))),
      all.length ? grid : emptyState(),
      h('p', { class: 'card-sub' }, count));
  }

  /* ---------------- game page ---------------- */

  function pageGame(id) {
    const g = state.games.find((x) => x.id === id);
    if (!g) return h('div', {}, h('p', { class: 'sub', text: 'This game is no longer in your library.' }), button('Back to library', 'ghost', () => go('library')));

    const meta = g.meta;
    const running = state.running.has(g.id);
    const label = running ? 'Running' : g.state === 'installed' ? 'Ready to play' : g.state === 'updating' ? (g.updating === 'running' ? `Updating ${pct(g)}%` : 'Update available') : g.state === 'installing' ? `Installing ${pct(g)}%` : 'File missing';
    const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v' }, v));
    const facts = [['Developer', meta?.developers?.join(', ')], ['Publisher', meta?.publishers?.join(', ')], ['Released', meta?.releaseDate]].filter(([, v]) => v);
    const d = state.disk;
    const removable = g.store === 'manual';

    return h('div', {},
      h('button', { class: 'link-btn back-link', type: 'button', onclick: () => goBack('library') }, icon('back'), backLabel()),
      h('section', { class: 'hero game' },
        artBox(g, ['hero', 'header']), h('div', { class: 'hero-shade' }),
        h('div', { class: 'hero-body' },
          h('div', { class: `eyebrow${g.state === 'installed' || running ? ' ready' : ''}` }, h('i'), label),
          h('h2', { text: g.title }),
          h('div', { class: 'build', text: buildLine(g) }),
          h('p', { class: 'hero-desc', text: meta?.description || '' }),
          h('div', { class: 'tags' }, (meta?.genres || []).map((t) => h('span', { class: 'tag', text: t }))))),
      h('div', { class: 'action-row' },
        gameAction(g, { big: true }),
        stat('Total played', liveText(g, 'full')),
        stat('Last played', g.lastPlayed ? ago(g.lastPlayed) : 'Never'),
        stat('Game status', label),
        h('button', { class: `star${g.favorite ? ' on' : ''}`, style: 'position:static;margin-left:auto', type: 'button', 'aria-label': 'Toggle favorite', onclick: () => toggleFav(g) }, icon('star'))),
      h('div', { class: 'cols' },
        h('section', {},
          h('h3', { text: 'About the game' }), h('div', { style: 'height:12px' }),
          h('p', { class: 'about-lead', text: meta?.description || 'No description found yet. Crescent keeps looking in the background.' }),
          facts.length ? h('div', { class: 'facts' }, facts.map(([k, v]) => h('div', {}, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v })))) : null,
          tagPanel(g)),
        h('aside', { class: 'panel' },
          h('h3', {}, 'Storage', icon('disk')),
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Installed size' }), h('span', { class: 'big-num', text: g.sizeBytes ? gb(g.sizeBytes) : 'Unknown' })),
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Location' }), h('span', { class: 'v', text: (g.installPath || g.launch?.target || `Managed by ${STORES[g.store]}`).replace(/([\\/])/g, '$1\u200b') })),
          d ? h('div', { class: 'kv' }, h('span', { class: 'k', text: `Local disk (${d.label})` }), h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((1 - d.free / d.total) * 100)}%` })), h('span', { class: 'card-sub', text: `${gb(d.free)} free of ${gb(d.total)}` })) : null,
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Updates through' }), h('span', { class: 'v', text: TOOL_LABEL[g.store] || TOOL_LABEL.detected })),
          h('div', { class: 'btn-stack' },
            canToolUpdate(g) ? button(`Update with ${TOOL_SHORT[g.store]}`, 'ghost small', () => updateGame(g), 'download') : null,
            button('Show in folder', 'ghost small', async () => { const r = await api.revealGame(g.id); if (!r.ok) notify('Could not open the folder', r.error, 'error'); }, 'folder'),
            button(removable ? 'Remove from library' : 'Hide from library', 'ghost small', async () => { await api.hideGame(g.id); await refresh(true); goBack('library'); }, 'trash')))));
  }

  /* ---------------- downloads ---------------- */

  function thumb(g) {
    const a = artBox(g, ['header']);
    a.style.cssText = 'width:120px;height:56px;border-radius:8px;flex:none';
    return a;
  }

  function downloadRow(g, pending = false) {
    const job = jobOf(g);
    const open = state.openDl === g.id;
    const sample = state.dl[g.id];
    const done = g.downloadDone || job?.done || 0;
    const total = g.downloadTotal || job?.total || 0;
    const percent = pct(g);
    const speed = job?.speed || sample?.speed || 0;
    const eta = job?.eta || (speed > 0 && total > done ? clock((total - done) / speed) : null);
    const paused = job?.state === 'paused';
    const amount = total ? `${gb(done)} of ${gb(total)}` : `${percent}%`;
    const sub = pending ? `Update available${total ? ` · ${gb(total)}` : ''} · ${STORES[g.store]}`
      : paused ? `Paused · ${amount}` : `${g.state === 'installing' ? 'Installing' : 'Updating'} · ${amount}`;
    const toggle = () => { state.openDl = open ? null : g.id; render(false); };
    const stageRatio = g.stageTotal ? g.stageDone / g.stageTotal : percent / 100;
    const stat = (k, v) => h('div', {}, k, h('b', { text: v }));
    const head = h('div', { class: 'strip', role: 'button', tabindex: '0', 'aria-expanded': String(open), onclick: toggle, onkeydown: (e) => e.key === 'Enter' && toggle() },
      thumb(g),
      h('div', { class: 'grow' }, h('div', { text: g.title }), h('div', { class: 'card-sub', text: sub }),
        pending ? null : h('div', { class: 'bar', style: 'margin-top:8px' }, h('i', { style: `width:${percent}%` }))),
      pending ? button('Update', 'update small', (e) => { e.stopPropagation(); updateGame(g); }, 'download')
        : [job ? h('button', {
          class: 'btn small dl-pause', type: 'button',
          onclick: async (e) => { e.stopPropagation(); const r = await (paused ? api.resumeUpdate : api.pauseUpdate)(g.id); if (!r.ok) failure(r.error); },
        }, icon(paused ? 'play' : 'pause'), paused ? 'Resume' : 'Pause') : null, h('b', { text: `${percent}%` })]);
    const detail = !open ? null : h('div', { class: 'dl-detail' },
      pending
        ? h('p', { class: 'dl-note', text: `${total ? `The update is ${gb(total)}. ` : ''}It is updated with ${TOOL_LABEL[g.store] || TOOL_LABEL.detected} when you press Update.` })
        : [
          h('div', { class: 'dl-line' }, h('span', { text: 'Downloading data' }), h('span', { text: total ? `${gb(done)} / ${gb(total)}` : `${percent}%` })),
          h('div', { class: 'bar' }, h('i', { style: `width:${total ? Math.min(100, Math.round((done / total) * 100)) : percent}%` })),
          h('div', { class: 'dl-line' }, h('span', { text: 'Updating files' }), h('span', { text: `${Math.round(stageRatio * 100)}%` })),
          h('div', { class: 'bar' }, h('i', { style: `width:${Math.round(stageRatio * 100)}%` })),
          h('div', { class: 'dl-stats' },
            stat('Speed', speed ? `${(speed / 1e6).toFixed(1)} MB/s` : '-'), stat('Time remaining', eta || '-'),
            stat('Status', paused ? 'Paused' : job?.state === 'error' ? 'Stopped' : 'Downloading'), stat('Updated with', TOOL_LABEL[g.store] || TOOL_LABEL.detected)),
          job?.error ? h('div', { class: 'dl-err', text: job.error }) : null,
          !job ? h('p', { class: 'dl-note', text: 'This update runs inside the store\'s own launcher, so it is paused and resumed there. Updates that Crescent starts can be paused here.' }) : null,
        ]);
    return h('div', { class: 'dl-wrap' }, head, detail);
  }

  function thumb(g) {
    const a = artBox(g, ['header']);
    a.style.cssText = 'width:120px;height:56px;border-radius:8px;flex:none';
    return a;
  }

  function pageDownloads() {
    const pending = pendingUpdates();
    const active = inProgress();
    const u = state.update;
    const root = h('div', {}, h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Downloads' }), h('p', { class: 'sub', text: 'A little patience. A whole new world.' }))));
    let any = false;

    if (['available', 'downloading', 'downloaded'].includes(u.state)) {
      any = true;
      root.append(h('div', { class: 'strip' }, icon('download'),
        h('div', { class: 'grow' }, h('div', { text: `Crescent ${u.version}` }),
          h('div', { class: 'card-sub', text: u.state === 'downloaded' ? 'Ready to install' : u.state === 'available' ? 'Launcher update available' : `Launcher update · ${u.percent || 0}%` }),
          u.state === 'downloading' ? h('div', { class: 'bar', style: 'margin-top:8px' }, h('i', { style: `width:${u.percent || 0}%` })) : null),
        u.state === 'downloaded' ? button('Reload to update', 'light small', () => api.installUpdate(), 'refresh')
          : u.state === 'available' && !state.settings.autoDownloadUpdates ? button('Download', 'light small', () => api.downloadUpdate()) : null));
    }
    if (pending.length) {
      any = true;
      root.append(h('div', { class: 'section-head' }, h('h3', { text: `Updates available · ${pending.length}` })), ...pending.map((g) => downloadRow(g, true)));
    }
    if (active.length) {
      any = true;
      root.append(h('div', { class: 'section-head' }, h('h3', { text: 'In progress' })), ...active.map((g) => downloadRow(g)));
    }
    if (!any) root.append(h('section', { class: 'empty', style: 'padding-top:10px' }, h('h2', { text: 'Everything is up to date' }), h('p', { text: 'Games that need an update show up here, and you choose when to update them.' })));

    if (state.disk) {
      const d = state.disk;
      root.append(h('div', { class: 'strip', style: 'margin-top:14px' }, icon('disk'), h('div', { class: 'grow' }, h('div', { text: `Local disk (${d.label})` }), h('div', { class: 'card-sub', text: `${gb(d.free)} free of ${gb(d.total)}` })), h('div', { style: 'width:240px' }, h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((1 - d.free / d.total) * 100)}%` })))));
    }
    state.pollTimer = setInterval(() => refresh(false), 4000);
    return root;
  }

  /* ---------------- account ---------------- */

  // Zoom and position chosen in the editor. It is applied when the picture is shown, so the original file is never changed.
  function applyEdit(el, edit) {
    const e = edit || {};
    const x = (e.x ?? 0.5) * 100;
    const y = (e.y ?? 0.5) * 100;
    const zoom = e.zoom || 1;
    el.style.objectFit = 'cover';
    el.style.objectPosition = `${x}% ${y}%`;
    el.style.transformOrigin = `${x}% ${y}%`;
    el.style.transform = zoom > 1 ? `scale(${zoom})` : '';
  }

  // `edit` is read while the video plays, so the editor can change the start and end live.
  function videoEl(url, edit) {
    const v = h('video', { src: url, loop: true, playsinline: true, preload: 'auto', autoplay: true });
    v.muted = true;
    v.disablePictureInPicture = true;
    let retried = false;
    const begin = () => (edit?.start > 0 ? edit.start : 0);
    v.addEventListener('loadedmetadata', () => { if (begin() > 0) v.currentTime = begin(); });
    v.addEventListener('timeupdate', () => {
      if (edit?.end && v.currentTime >= edit.end) v.currentTime = begin();
      else if (begin() > 0 && v.currentTime < begin() - 0.3) v.currentTime = begin();
    });
    v.addEventListener('canplay', () => { if (v.paused && !state.afk) v.play()?.catch(() => {}); });
    v.addEventListener('error', () => { if (!retried) { retried = true; setTimeout(() => v.load(), 400); } });
    return v;
  }

  function mediaEl(url, type, edit) {
    const el = type === 'video' ? videoEl(url, edit) : h('img', { src: url, alt: '' });
    applyEdit(el, edit);
    return el;
  }

  // The same banner element is reused on every redraw (a video would otherwise restart each time).
  function bannerBox() {
    const b = state.profile.banner;
    const key = `${b ? b.url : ''}|${JSON.stringify(state.profile.bannerEdit || null)}`;
    if (!state.bannerCache || state.bannerCache.key !== key) {
      const el = h('div', { class: 'banner' });
      if (b) el.append(mediaEl(b.url, b.type, state.profile.bannerEdit));
      state.bannerCache = { key, el };
    }
    const el = state.bannerCache.el;
    el.style.aspectRatio = b ? `${b.width} / ${b.height}` : '1280 / 400'; // the banner takes the shape of the file
    const glow = state.profile.glow;
    el.style.boxShadow = glow?.on ? `0 0 28px 4px ${glow.color}, 0 0 0 1px ${glow.color}` : '';
    const v = el.querySelector('video');
    if (v && !state.afk) setTimeout(() => v.play()?.catch(() => {}), 0); // a video pauses when it leaves the page; carry on where it was
    return el;
  }

  function avatarEl(cls = 'avatar') {
    const p = state.profile;
    const a = h('span', { class: cls + borderClass() });
    if (p.avatarUrl) {
      const key = `${p.avatarUrl}|${JSON.stringify(p.avatarEdit || null)}`;
      if (!state.avatarCache || state.avatarCache.key !== key) state.avatarCache = { key, el: mediaEl(p.avatarUrl, p.avatarType, p.avatarEdit) };
      a.append(state.avatarCache.el);
      const v = state.avatarCache.el.tagName === 'VIDEO' ? state.avatarCache.el : null;
      if (v && !state.afk) setTimeout(() => v.play()?.catch(() => {}), 0);
    } else a.textContent = p.name[0]?.toUpperCase() || '?';
    return a;
  }

  /* ---- the editor: zoom, position and (for videos) start and end ---- */
  function openEditor({ kind, url, type, width, height, duration, edit: initial }) {
    return new Promise((resolve) => {
      const edit = { zoom: 1, x: 0.5, y: 0.5, start: 0, end: null, ...(initial || {}) };
      let saved = false;
      let length = duration || 0;
      const isVideo = type === 'video';
      const titles = { avatar: 'Edit your profile picture', banner: 'Edit your banner', mini: 'Edit your mini profile banner' };
      const subs = {
        avatar: 'Move and zoom it so it looks right in the circle.',
        banner: 'Move and zoom it to choose what shows in your banner.',
        mini: 'This is the strip behind your name in the bottom left. Choose what shows there.',
      };
      modal((close) => {
        const preview = h('div', { class: `editor-preview is-${kind}` });
        preview.style.aspectRatio = kind === 'avatar' ? '1 / 1' : kind === 'mini' ? '176 / 54' : `${width || 16} / ${height || 9}`;
        const media = mediaEl(url, type, edit);
        preview.append(media);
        const rows = [];
        const slider = (label, min, max, step, get, set, fmt) => {
          const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), 'aria-label': label });
          const out = h('output', { text: fmt(get()) });
          const row = { input, out, get, fmt };
          rows.push(row);
          input.addEventListener('input', () => { set(Number(input.value)); out.textContent = fmt(get()); applyEdit(media, edit); });
          return h('div', { class: 'ed-row' }, h('label', { text: label }), input, out);
        };
        const sync = () => rows.forEach((r) => { r.input.value = String(r.get()); r.out.textContent = r.fmt(r.get()); });
        const secs = (v) => `${Number(v).toFixed(1)} s`;
        const controls = [
          slider('Zoom', 1, 3, 0.01, () => edit.zoom, (v) => { edit.zoom = v; }, (v) => `${v.toFixed(2)}x`),
          slider('Left / right', 0, 100, 1, () => Math.round(edit.x * 100), (v) => { edit.x = v / 100; }, (v) => `${v}%`),
          slider('Up / down', 0, 100, 1, () => Math.round(edit.y * 100), (v) => { edit.y = v / 100; }, (v) => `${v}%`),
        ];
        if (isVideo) {
          controls.push(
            slider('Start', 0, length || 10, 0.1, () => edit.start, (v) => { edit.start = Math.min(v, (edit.end ?? length) - 0.5); }, secs),
            slider('End', 0, length || 10, 0.1, () => edit.end ?? length, (v) => { edit.end = v >= length - 0.05 ? null : Math.max(v, edit.start + 0.5); }, secs));
          media.addEventListener('loadedmetadata', () => {
            length = media.duration;
            rows.slice(-2).forEach((r) => { r.input.max = String(length); });
            sync();
          });
        }
        // drag the picture to move it
        preview.addEventListener('pointerdown', (e) => { preview.setPointerCapture(e.pointerId); preview.classList.add('drag'); });
        preview.addEventListener('pointerup', () => preview.classList.remove('drag'));
        preview.addEventListener('pointermove', (e) => {
          if (!preview.classList.contains('drag')) return;
          const r = preview.getBoundingClientRect();
          const k = Math.max(1, edit.zoom);
          edit.x = Math.min(1, Math.max(0, edit.x - e.movementX / r.width / k));
          edit.y = Math.min(1, Math.max(0, edit.y - e.movementY / r.height / k));
          applyEdit(media, edit);
          sync();
        });
        const reset = () => { Object.assign(edit, { zoom: 1, x: 0.5, y: 0.5, start: 0, end: null }); applyEdit(media, edit); sync(); };
        return [
          h('h3', { text: titles[kind] }), h('p', { class: 'sub', text: subs[kind] }),
          h('div', { class: 'editor-stage' }, preview), controls,
          isVideo ? h('p', { class: 'card-sub', style: 'margin-top:6px', text: 'The part between Start and End plays on a loop.' }) : null,
          h('div', { class: 'modal-actions' }, button('Reset', 'ghost', reset), button('Cancel', 'ghost', close),
            button('Save', 'light', () => { saved = true; resolve({ zoom: edit.zoom, x: edit.x, y: edit.y, start: edit.start, end: edit.end }); close(); })),
        ];
      }, { cls: 'editor', onClose: () => { if (!saved) resolve(null); } });
    });
  }

  // Edit a picture, GIF or video that is already uploaded (also the strip in the bottom left)
  async function editExisting(kind) {
    const p = state.profile;
    const src = kind === 'avatar' ? p.avatarUrl : p.banner?.url;
    if (!src) return notify('Nothing to edit yet', kind === 'avatar' ? 'Upload a profile picture first.' : 'Upload a banner first.');
    const edit = await openEditor({
      kind, url: src, type: kind === 'avatar' ? p.avatarType : p.banner.type,
      width: kind === 'avatar' ? 1 : p.banner.width, height: kind === 'avatar' ? 1 : p.banner.height,
      edit: kind === 'avatar' ? p.avatarEdit : kind === 'mini' ? (p.miniEdit || p.bannerEdit) : p.bannerEdit,
    });
    if (!edit) return;
    state.profile = await api.setEdit(kind, edit);
    state.bannerCache = null; state.avatarCache = null; state.miniSig = '';
    chrome();
    render(false);
  }

  function themePanel() {
    const themes = state.themes;
    const cur = state.profile.theme;
    const tab = state.themeTab;
    const items = themes ? themes[tab] : [];
    const cards = items.map((t) => {
      const thumbEl = h('div', { class: 't-thumb thumb' });
      if (t.available) {
        if (tab === 'animated') { const v = h('video', { src: `${t.url}#t=1`, preload: 'metadata' }); v.muted = true; thumbEl.append(v); }
        else thumbEl.append(h('img', { src: t.url, alt: '' }));
      }
      return h('button', {
        class: `theme${cur.type === tab && cur.id === t.id ? ' on' : ''}`, type: 'button', disabled: !t.available,
        onclick: async () => { state.profile = await api.setTheme(tab, t.id); applyTheme(); render(false); },
      }, thumbEl, h('span', { class: 't-name', text: t.name }), h('span', { class: 't-sub', text: t.available ? (cur.type === tab && cur.id === t.id ? 'In use' : 'Use this wallpaper') : `Missing: put ${t.file} in the ${t.folder} folder` }));
    });
    const looks = [['default', 'Default', 'Classic dark'], ['glass', 'Liquid Glass', 'Frosted and shiny'], ['cartoon', 'Cartoony', 'Bold and playful']];
    const uiCards = h('div', { class: 'ui-grid' }, looks.map(([id, name, sub]) => h('button', {
      class: `ui-card${state.profile.uiTheme === id ? ' on' : ''}`, type: 'button',
      onclick: async () => {
        state.profile = await api.setUiTheme(id);
        applyLook();
        uiCards.querySelectorAll('.ui-card').forEach((c, i) => c.classList.toggle('on', looks[i][0] === id));
      },
    }, h('div', { class: `ui-prev ${id}` }), h('b', { text: name }), h('small', { text: sub }))));
    return h('section', { class: 'panel' },
      h('h3', { text: 'Interface style' }), uiCards,
      h('h3', {}, 'Wallpaper', cur.type !== 'none' ? button('Remove wallpaper', 'ghost small', async () => { state.profile = await api.setTheme('none'); applyTheme(); render(false); }) : null),
      cur.type !== 'none'
        ? h('div', { class: 'dim-row' }, h('span', { class: 'card-sub', text: 'Wallpaper visible' }), (() => {
          const dim = h('input', { type: 'range', min: '0', max: '100', step: '1', value: String(state.profile.wallpaperDim ?? 50), 'aria-label': 'Wallpaper darkening' });
          dim.addEventListener('input', () => document.documentElement.style.setProperty('--wall-dim', String((Number(dim.value) / 100) * 0.95)));
          dim.addEventListener('change', async () => { state.profile = await api.setDim(Number(dim.value)); });
          return dim;
        })(), h('span', { class: 'card-sub', text: 'Barely visible' }))
        : h('p', { class: 'sub', style: 'margin-bottom:14px', text: 'Pick a wallpaper below, then you can set how dark it is.' }),
      h('div', { class: 'tabs themes-tabs' },
        [['animated', 'Animated'], ['still', 'Still pictures']].map(([k, l]) => h('button', { class: `tab${tab === k ? ' on' : ''}`, type: 'button', onclick: () => { state.themeTab = k; render(false); } }, l))),
      h('div', { class: 'theme-grid' }, cards));
  }

  function switchEl(on, onchange, label) {
    return h('button', { class: `switch${on ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': label, onclick: () => onchange(!on) }, h('i'));
  }
  const colorSwatches = (colors, current, pick) => h('div', { class: 'swatches' }, colors.map((c) => {
    const b = h('button', { class: `swatch${c.toLowerCase() === (current || '').toLowerCase() ? ' on' : ''}`, type: 'button', 'aria-label': `Colour ${c}`, onclick: () => pick(c) });
    b.style.background = c;
    return b;
  }));

  function bordersPanel() {
    const hours = state.totalSeconds / 3600;
    return h('section', { class: 'panel' }, h('h3', {}, 'Profile picture border', h('small', { class: 'card-sub', text: `${hours.toFixed(1)} h played` })),
      h('div', { class: 'border-grid' }, state.borders.map((b) => {
        const unlocked = hours >= b.hours;
        const current = state.profile.border === b.id;
        const av = h('span', { class: `avatar bd-${b.id}` });
        if (state.profile.avatarUrl) av.append(h('img', { src: state.profile.avatarUrl, alt: '' })); else av.textContent = state.profile.name[0]?.toUpperCase() || '?';
        return h('button', {
          class: `border-opt${current ? ' on' : ''}`, type: 'button', disabled: !unlocked,
          onclick: async () => {
            const r = await api.setBorder(b.id);
            if (!r.ok) return failure(r.error);
            state.profile = r.profile; chrome(); render(false);
          },
        }, av, h('b', { text: b.name }), h('small', { text: unlocked ? (current ? 'In use' : 'Use this') : `${(b.hours - hours).toFixed(1)} h to go` }));
      })));
  }

  function lookPanel() {
    const glow = state.profile.glow || { on: false, color: '#6c8cff' };
    const accent = state.profile.accent || { mode: 'default', color: '#f1f1f3' };
    const glowColor = h('input', { type: 'color', value: glow.color, 'aria-label': 'Banner glow colour' });
    glowColor.addEventListener('change', async () => { state.profile = await api.setGlow(true, glowColor.value); render(false); });
    const accentColor = h('input', { type: 'color', value: accent.color, 'aria-label': 'Accent colour' });
    const setAccent = async (mode, color) => {
      const r = await api.setAccent(mode, color);
      if (!r.ok) return failure(r.error);
      state.profile = r.profile; applyLook(); render(false);
    };
    accentColor.addEventListener('change', () => setAccent('custom', accentColor.value));
    const GLOWS = ['#6c8cff', '#4fe3b0', '#ff6fae', '#ffcf5a', '#ff5a4d', '#c58bff'];
    const ACCENTS = ['#f1f1f3', '#6c8cff', '#4fe3b0', '#ff6fae', '#ffcf5a', '#ff5a4d', '#c58bff', '#4fe3ff'];
    return h('section', { class: 'panel' },
      h('h3', { text: 'Edit your pictures' }),
      h('div', { class: 'btn-stack', style: 'margin-bottom:18px' }, button('Edit picture', 'ghost small', () => editExisting('avatar'), 'edit'), button('Edit banner', 'ghost small', () => editExisting('banner'), 'edit'), button('Edit mini profile', 'ghost small', () => editExisting('mini'), 'edit')),
      h('h3', { text: 'Banner glow' }),
      h('div', { class: 'row-inline', style: 'margin-bottom:12px' }, switchEl(glow.on, async (on) => { state.profile = await api.setGlow(on, glow.color); render(false); }, 'Banner glow'), h('span', { class: 'sub', text: glow.on ? 'The glow is on' : 'Add a glow around your banner' }), glowColor),
      colorSwatches(GLOWS, glow.color, async (c) => { state.profile = await api.setGlow(true, c); render(false); }),
      h('h3', { style: 'margin-top:6px', text: 'Accent colour' }),
      h('p', { class: 'sub', style: 'margin-bottom:12px', text: accent.mode === 'wallpaper' ? 'Taken from your wallpaper' : accent.mode === 'banner' ? 'Taken from your banner' : accent.mode === 'custom' ? 'Your own colour' : 'Default' }),
      colorSwatches(ACCENTS, accent.mode === 'default' ? '#f1f1f3' : accent.color, (c) => (c === '#f1f1f3' ? setAccent('default') : setAccent('custom', c))),
      h('div', { class: 'btn-stack' }, accentColor, button('From my wallpaper', 'ghost small', () => setAccent('wallpaper'), 'palette'), button('From my banner', 'ghost small', () => setAccent('banner'), 'palette')));
  }

  function statusBlock() {
    const cur = state.profile.status || { preset: 'online', message: '' };
    const msg = h('input', { class: 'input', id: 'status-msg', value: cur.message, maxlength: '60', placeholder: 'Custom message, for example "Back in 10 minutes"' });
    const save = async (preset, message) => { state.profile = await api.setStatus(preset, message); chrome(); render(false); };
    msg.addEventListener('keydown', (e) => e.key === 'Enter' && save(cur.preset, msg.value));
    return h('div', { style: 'margin-top:18px' },
      h('label', { class: 'label', text: 'Status' }),
      h('div', { class: 'status-opts' }, STATUS_PRESETS.map((p) => h('button', {
        class: `chip-btn${cur.preset === p.id ? ' on' : ''}`, type: 'button', onclick: () => save(p.id, cur.message),
      }, h('i', { class: `st-dot st-${p.id}` }), p.label))),
      h('div', { class: 'row-inline' }, msg, button('Save', 'light small', () => save(cur.preset, msg.value))),
      h('p', { class: 'card-sub', style: 'margin-top:10px', text: 'In-Game and AFK are set automatically. Offline shows when Crescent is closed.' }));
  }

  function pageAccount() {
    const total = state.games.reduce((n, g) => n + g.playSeconds, 0);
    const input = h('input', { class: 'input', id: 'name', value: state.profile.name, maxlength: '40' });
    const save = async () => { state.profile = await api.setProfileName(input.value); notify('Name saved', `You are now ${state.profile.name}.`); chrome(); render(false); };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && save());

    const top = byPlayed(state.games.filter((g) => g.playSeconds > 0)).slice(0, 4);
    const layout = state.settings.topGamesLayout === 'grid' ? 'grid' : 'list';
    const topList = h('div', { class: `top-games ${layout}` }, top.length
      ? top.map((g, i) => h('button', { class: 'top-item', type: 'button', onclick: () => go(`game:${g.id}`) },
        h('span', { class: 'rank', text: i + 1 }), artBox(g, ['header', 'hero']),
        h('span', { class: 'grow' }, h('b', { text: g.title }), h('small', {}, liveText(g, 'full')))))
      : [h('p', { class: 'sub', text: 'Play a game and it shows up here.' })]);
    const st = statusInfo();

    return h('div', {},
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Your account' }), h('p', { class: 'sub', text: 'Your identity in the launcher.' }))),
      h('section', { class: 'profile v2' },
        bannerBox(),
        h('div', { class: 'profile-bar' },
          avatarEl('avatar'),
          h('div', { class: 'who' }, h('h2', { text: state.profile.name }), h('p', { class: 'sub' }, h('i', { class: `st-dot st-${st.id}` }), st.label)),
          h('div', { class: 'btn-stack' },
            button('Change picture', 'ghost small', () => startUpload('avatar'), 'edit'),
            button('Change banner', 'ghost small', () => startUpload('banner'), 'edit'),
            state.profile.avatarUrl ? button('Remove picture', 'ghost small', async () => { state.profile = await api.clearMedia('avatar'); render(false); chrome(); }) : null,
            state.profile.banner ? button('Remove banner', 'ghost small', async () => { state.profile = await api.clearMedia('banner'); render(false); }) : null))),
      h('div', { class: 'cols even', style: 'margin-bottom:16px' },
        h('section', { class: 'panel' }, h('h3', { text: 'Account details' }),
          h('label', { class: 'label', for: 'name', text: 'Display name' }), input,
          h('div', { class: 'btn-stack', style: 'margin-top:14px' }, button('Save name', 'light small', save), button('Open data folder', 'ghost small', () => api.openDataFolder(), 'folder')),
          statusBlock()),
        h('section', { class: 'panel' }, h('h3', { text: 'Your Crescent journey' }),
          h('div', { class: 'stats3' },
            h('div', {}, h('span', { class: 'big-num', text: state.games.length }), h('small', { text: 'Games' })),
            h('div', {}, h('span', { class: 'big-num', text: state.games.filter((g) => g.state === 'installed').length }), h('small', { text: 'Installed' })),
            h('div', {}, h('span', { class: 'big-num', text: total ? (total / 3600).toFixed(1) : '0' }), h('small', { text: 'Hours played' }))))),
      h('div', { class: 'cols even', style: 'margin-bottom:16px' }, bordersPanel(), lookPanel()),
      themePanel(),
      h('div', { class: 'cols even', style: 'margin-top:16px' },
        h('section', { class: 'panel' }, h('h3', { text: 'Most played' }), topList),
        h('section', { class: 'panel' }, h('h3', {}, 'Game stores found', button('Rescan', 'ghost small', rescan, 'refresh')),
          STORE_LIST.map((k) => {
            const s = state.stores[k] || {};
            return h('div', { class: 'row' }, h('span', { class: 'grow', text: STORES[k] }), h('span', { class: s.found ? 'ok' : 'no', text: s.found ? `${s.count} games` : 'Not found' }));
          }))));
  }

  /* ---------------- settings ---------------- */

  function pageSettings() {
    const row = (label, desc, control) => h('div', { class: 'set-row' }, h('div', { class: 'grow' }, h('b', { text: label }), desc ? h('small', { text: desc }) : null), control);
    const toggle = (key) => {
      const on = !!state.settings[key];
      return h('button', {
        class: `switch${on ? ' on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(on), 'aria-label': key,
        onclick: async () => { state.settings = await api.setSetting(key, !on); if (key === 'friendsHidden') applyFriends(); applyLook(); chrome(); render(false); },
      }, h('i'));
    };
    const seg = (key, options) => h('div', { class: 'seg inline' }, options.map(([v, l]) =>
      h('button', { type: 'button', class: state.settings[key] === v ? 'on' : '', text: l, onclick: async () => { state.settings = await api.setSetting(key, v); render(false); } })));
    const group = (title, ...rows) => h('section', { class: 'set-group' }, h('h3', { text: title }), h('div', { class: 'set-card' }, rows));
    const steamInput = h('input', { class: 'input short', value: state.settings.steamUsername || '', placeholder: 'Steam username', maxlength: '64', 'aria-label': 'Steam username' });
    const saveSteam = async () => { state.settings = await api.setSetting('steamUsername', steamInput.value.trim()); notify('Steam username saved', 'SteamCMD will sign in with it.'); };
    const signInTool = async (store) => {
      if (store === 'steam') await saveSteam();
      const r = await api.signInTool(store);
      if (!r.ok) return failure(r.error);
      notify('Sign-in window opened', r.message);
    };

    return h('div', {},
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Settings' }), h('p', { class: 'sub', text: 'Make Crescent work the way you like.' }))),
      group('Launcher',
        row('Start with Windows', 'Open Crescent when you sign in. Works in the installed app.', toggle('startWithWindows')),
        row('Page transitions', 'A small, smooth movement when you switch pages. Also used by the friends list. Turn off to switch instantly.', toggle('transitions')),
        row('Smooth Jump Back In transition', 'The Jump Back In box on the home screen fades to the next game. Turn off to switch instantly.', toggle('heroTransition')),
        row('Hide the friends list', 'Friends are not available yet. You can also use the button on the list.', toggle('friendsHidden')),
        row('Most played games layout', 'How your top games are shown on the Account page.', seg('topGamesLayout', [['list', 'List'], ['grid', '2 by 2']]))),
      group('Performance',
        row('When a game starts', 'Keep Crescent open, hide it in the system tray, or minimize it to the taskbar to save resources.', seg('onGameStart', [['keep', 'Keep open'], ['tray', 'System tray'], ['taskbar', 'Taskbar']])),
        row('Bring Crescent back when the game closes', 'Only when Crescent was hidden or minimized because a game started.', toggle('restoreAfterGame')),
        row('Performance overlay', 'A small overlay with CPU, GPU and RAM while a game runs. Shows FPS when PresentMon is in the tools folder. Works with windowed and borderless games.', toggle('overlayEnabled')),
        row('AFK Mode', 'When Crescent is minimized, not in front, not used for a while, or a game is starting or running, it stops moving and hides everything so your PC can focus on the game.', toggle('afkMode')),
        row('Go to AFK Mode after', 'How long Crescent can sit unused on the desktop before it sleeps.', window.UI.dropdown({
          value: state.settings.afkMinutes ?? 5, label: 'AFK after', align: 'right',
          options: [[2, '2 minutes'], [5, '5 minutes'], [10, '10 minutes'], [15, '15 minutes']],
          onChange: async (v) => { state.settings = await api.setSetting('afkMinutes', v); },
        })),
        row('Compatibility mode', 'Turns off graphics acceleration. Try this if you see flickering bars while scrolling. Restart Crescent to apply.', toggle('compatibilityMode'))),
      group('Games',
        row('Look for games automatically', 'Checks your game launchers when Crescent starts and when you come back to it.', toggle('autoScan')),
        row('Search every drive', 'Also looks through your drives for games that no launcher reported. Runs in the background.', toggle('deepScan')),
        row('Track play time', 'Counts the seconds, minutes and hours you spend in each game.', toggle('trackPlaytime')),
        row('Scan now', 'Checks all supported game launchers right away.', button('Scan now', 'ghost small', rescan, 'refresh')),
        row('Search every drive now', 'This can take a few minutes. You can keep using Crescent.', button('Start search', 'ghost small', () => { api.deepScan(); notify('Searching your drives', 'Crescent looks for games in the background. New games appear in your library.'); }, 'search')),
        row('Hidden games', 'Show the games you hid from your library again.', button('Show all', 'ghost small', async () => { await api.unhideAll(); await refresh(true); notify('Hidden games are back', 'They are in your library again.'); }))),
      group('Game updating',
        row('Steam username', 'SteamCMD signs in with this account to update Steam games. Crescent never sees your password.', h('div', { class: 'row-inline' }, steamInput, button('Save', 'ghost small', saveSteam))),
        row('Sign in to SteamCMD', 'Opens a SteamCMD window where you sign in once. SteamCMD is downloaded automatically.', button('Sign in', 'ghost small', () => signInTool('steam'))),
        row('Sign in to Epic Games (Legendary)', 'Opens a Legendary window where you sign in to Epic once. Legendary is downloaded automatically.', button('Sign in', 'ghost small', () => signInTool('epic'))),
        row('Which tool updates what', 'Steam: SteamCMD. Epic Games: Legendary. EA app and Ubisoft Connect: their URI protocol handlers. Battle.net: its client protocol. Xbox and Microsoft Store: PowerShell. Riot and Rockstar: their launcher command line. Games found on this PC: the local executable.', null)),
      group('Updates',
        row('Check for launcher updates', 'Looks for a new version when Crescent starts and every few hours.', toggle('autoCheckUpdates')),
        row('Download updates automatically', 'When off, a Download update button appears instead.', toggle('autoDownloadUpdates')),
        row('Show update logs after updating', 'Shows what is new once a new version is installed.', toggle('showUpdateLogs')),
        row('Game update messages', 'Shows a message in the bell when a game needs an update.', toggle('notifyGameUpdates')),
        row('Check now', 'Looks for a launcher update right away.', button('Check for updates', 'ghost small', async () => {
          const r = await api.checkForUpdates();
          if (!r.ok) notify('Could not check for updates', r.error, 'error');
          else if (r.upToDate) popup({ kind: 'success', title: 'Crescent is up to date', text: `You have the newest version (${r.version}).` });
          else popup({ kind: 'info', title: 'Update found', text: `Crescent ${r.version} is available. A green button appears at the top when it is ready.` });
        }, 'refresh')),
        row('Update logs', 'Read what changed in recent versions.', button('View update logs', 'ghost small', () => showWhatsNew(true)))),
      group('Data',
        row('Open data folder', 'Where Crescent keeps your profile, pictures and library.', button('Open folder', 'ghost small', () => api.openDataFolder(), 'folder')),
        row('Clear saved game info', 'Removes saved descriptions and banners. Crescent looks them up again.', button('Clear', 'ghost small', async () => { await api.clearCache(); notify('Saved game info cleared', 'Crescent will look it up again.'); }))));
  }

  /* ---------------- uploads ---------------- */

  const invalid = (message) => Object.assign(new Error(message), { validation: true });

  function readMedia(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const done = (v) => { URL.revokeObjectURL(url); resolve(v); };
      const fail = () => { URL.revokeObjectURL(url); reject(invalid('We could not read this file. Try another picture or video.')); };
      if (file.type.startsWith('video/')) {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => done({ type: 'video', width: v.videoWidth, height: v.videoHeight, duration: v.duration });
        v.onerror = fail;
        v.src = url;
      } else {
        const im = new Image();
        im.onload = () => done({ type: 'image', width: im.naturalWidth, height: im.naturalHeight, duration: 0 });
        im.onerror = fail;
        im.src = url;
      }
    });
  }

  // Length of a GIF: the delays of all its frames added together.
  async function gifSeconds(file) {
    const b = new Uint8Array(await file.arrayBuffer());
    let i = 13;
    if (b[10] & 0x80) i += 3 * (1 << ((b[10] & 7) + 1));
    let total = 0;
    const skipBlocks = () => { while (i < b.length && b[i] !== 0) i += b[i] + 1; i++; };
    while (i < b.length) {
      if (b[i] === 0x3b) break;
      if (b[i] === 0x21) {
        if (b[i + 1] === 0xf9) total += (b[i + 4] | (b[i + 5] << 8)) / 100;
        i += 2;
        skipBlocks();
      } else if (b[i] === 0x2c) {
        const flags = b[i + 9];
        i += 10;
        if (flags & 0x80) i += 3 * (1 << ((flags & 7) + 1));
        i++;
        skipBlocks();
      } else break;
    }
    return total;
  }

  async function inspect(kind, file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'webm'].includes(ext)) throw invalid('Use a PNG, JPG, WEBP or GIF picture, or an MP4 or WEBM video.');
    if (file.size > 100 * 1024 * 1024) throw invalid('That file is bigger than 100 MB.');
    const info = await readMedia(file);
    if (ext === 'gif') info.duration = await gifSeconds(file);
    if (info.duration > 10.05) throw invalid(`GIFs and videos can be at most 10 seconds long. This one is ${info.duration.toFixed(1)} seconds.`);
    if (kind === 'banner') {
      const { width: bw, height: bh } = info;
      if (bw <= bh) throw invalid(`A banner has to be wider than it is tall. This one is ${bw} by ${bh}.`);
      if (bw > 1280 || bh > 1000) throw invalid(`A banner can be 1280 by 1000 pixels at most. This one is ${bw} by ${bh}.`);
      if (bw < 320) throw invalid(`A banner must be at least 320 pixels wide. This one is ${bw} by ${bh}.`);
    }
    return { info, ext };
  }

  const PICTURE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm';

  async function startUpload(kind) {
    const file = await uploadModal(kind === 'avatar'
      ? { noun: 'your picture.', accept: PICTURE_ACCEPT, hint: 'A picture, a GIF or a video. GIFs and videos can be 10 seconds at most.' }
      : { noun: 'your banner.', accept: PICTURE_ACCEPT, hint: 'Pictures, GIFs and videos up to 1280 by 1000 pixels, wider than they are tall. GIFs and videos: 10 seconds at most.' });
    if (file) prepareUpload(kind, file);
  }

  async function startWidgetUpload(pageName, kind) {
    const rules = {
      image: { accept: 'image/png,image/jpeg,image/webp', exts: ['png', 'jpg', 'jpeg', 'webp'], noun: 'your picture.', hint: 'A PNG, JPG or WEBP picture' },
      gif: { accept: 'image/gif', exts: ['gif'], noun: 'your GIF.', hint: 'A GIF of 10 seconds at most' },
      video: { accept: 'video/mp4,video/webm', exts: ['mp4', 'webm'], noun: 'your video.', hint: 'An MP4 or WEBM video of 10 seconds at most' },
    }[kind];
    const file = await uploadModal({ noun: rules.noun, accept: rules.accept, hint: rules.hint });
    if (!file) return;
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (!rules.exts.includes(ext)) return failure(`That is not the right kind of file. ${rules.hint} works here.`, () => startWidgetUpload(pageName, kind));
    prepareUpload('widget', file, { widgetPage: pageName, widgetType: kind });
  }

  // Check the file, let the user edit it (profile picture and banner), then upload it.
  async function prepareUpload(kind, file, extra = {}) {
    let prepared;
    try {
      prepared = await inspect(kind, file);
    } catch (err) {
      const p = popup({
        kind: 'error', title: 'Oops! so sorry', text: err.message,
        actions: [{ label: 'Retry', onclick: () => { p.close(); if (kind === 'widget') startWidgetUpload(extra.widgetPage, extra.widgetType); else startUpload(kind); } }, { label: 'Cancel', onclick: () => p.close() }],
      });
      return;
    }
    let edit = null;
    if (kind === 'avatar' || kind === 'banner') {
      const url = URL.createObjectURL(file);
      edit = await openEditor({ kind, url, type: prepared.info.type, width: prepared.info.width, height: prepared.info.height, duration: prepared.info.duration });
      URL.revokeObjectURL(url);
      if (!edit) return;
    }
    runUpload(kind, file, prepared, edit, extra);
  }

  async function runUpload(kind, file, prepared, edit, extra = {}) {
    let cancelled = false;
    let session = null;
    const p = popup({
      kind: 'progress', title: 'Just a second...', text: 'Right now, your file is being uploaded. Please wait a moment while we finish your upload.', progress: 0,
      actions: [{ label: 'Cancel', onclick: () => { cancelled = true; if (session) api.mediaAbort(session.id); p.close(); } }],
    });
    try {
      session = await api.mediaBegin({ kind, ext: prepared.ext });
      const CHUNK = 1024 * 1024;
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        if (cancelled) return;
        await api.mediaChunk(session.id, await file.slice(offset, offset + CHUNK).arrayBuffer());
        p.update({ progress: Math.min(99, ((offset + CHUNK) / file.size) * 100) });
      }
      if (cancelled) return;
      const res = await api.mediaEnd(session.id, prepared.info, edit);
      if (kind === 'widget') {
        const added = await api.addWidget({ page: extra.widgetPage, type: extra.widgetType, file: res.file, width: prepared.info.width, height: prepared.info.height });
        if (!added.ok) throw new Error(added.error);
        state.widgets = added.widgets;
      } else {
        state.profile = res.profile;
        state.bannerCache = null; state.avatarCache = null; state.miniSig = '';
        applyTheme();
        applyLook();
        chrome();
      }
      render(false);
      p.set('success', {
        title: 'Your file was uploaded!', text: 'Your file was successfully uploaded. You can copy the link to your clipboard.',
        actions: [{ label: 'Copy Link', onclick: () => api.copyText(res.fileUrl) }, { label: 'Done', onclick: () => p.close() }],
      });
    } catch (err) {
      if (cancelled) return;
      if (session) api.mediaAbort(session.id);
      p.set('error', {
        title: 'Oops! so sorry', text: 'Your file could not be uploaded due to an error. Would you want to give it another shot?',
        actions: [{ label: 'Retry', onclick: () => { p.close(); runUpload(kind, file, prepared, edit, extra); } }, { label: 'Cancel', onclick: () => p.close() }],
      });
    }
  }

  /* ---------------- wallpaper and friends panel ---------------- */

  function applyTheme() {
    const t = state.profile.theme;
    const found = state.themes && t.type !== 'none' ? state.themes[t.type]?.find((x) => x.id === t.id && x.available) : null;
    const sig = found ? `${t.type}:${t.id}` : 'none';
    if (sig === state.themeSig) return;
    state.themeSig = sig;
    const layer = $('#wallpaper');
    layer.replaceChildren();
    document.body.classList.toggle('themed', !!found);
    if (!found) return;
    layer.append(t.type === 'animated' ? videoEl(found.url) : h('img', { src: found.url, alt: '' }));
    const v = layer.querySelector('video');
    if (v) v.autoplay = true;
  }

  function applyFriends() {
    const hidden = !!state.settings.friendsHidden;
    $('#shell').classList.toggle('fc', hidden);
    $('#friends-hide').tabIndex = hidden ? -1 : 0;
    $('#friends-show').tabIndex = hidden ? 0 : -1;
  }

  /* ---------------- bell and update button ---------------- */

  function messages() {
    const out = [];
    const u = state.update;
    if (u.state === 'downloaded') out.push({ title: `Crescent ${u.version} is ready`, sub: 'Reload to finish updating', action: ['Reload', () => api.installUpdate()] });
    else if (u.state === 'available' && !state.settings.autoDownloadUpdates) out.push({ title: `Crescent ${u.version} is available`, sub: 'A new launcher version', action: ['Download', () => api.downloadUpdate()] });
    if (state.settings.notifyGameUpdates) {
      for (const g of pendingUpdates()) out.push({ title: `${g.title} needs an update`, sub: STORES[g.store], action: ['Update', () => updateGame(g)] });
      for (const g of inProgress().filter((x) => x.state === 'updating')) out.push({ title: `${g.title} is updating`, sub: `${pct(g)}% done`, action: null });
    }
    return out;
  }

  function drawBell() {
    const msgs = messages();
    $('#bell').classList.toggle('bell-dot', msgs.length > 0);
    const menu = $('#bell-menu');
    if (menu.hidden) return;
    menu.replaceChildren(
      h('h4', { text: 'Messages' }),
      ...(msgs.length
        ? msgs.map((m) => h('div', { class: 'msg' }, h('div', { class: 'grow' }, h('b', { text: m.title }), h('small', { text: m.sub })),
          m.action ? button(m.action[0], 'update small', () => { m.action[1](); menu.hidden = true; }) : null))
        : [h('p', { class: 'msg-empty', text: "You're all caught up." })]),
      h('div', { style: 'padding:6px' }, button('Open downloads', 'ghost small', () => { menu.hidden = true; go('downloads'); })));
  }

  function renderUpdate(status) {
    state.update = status || { state: 'idle' };
    const s = state.update;
    const pill = $('#update-pill');
    pill.hidden = true;
    pill.classList.remove('working');
    pill.replaceChildren();
    pill.onclick = null;
    if (s.state === 'downloaded') {
      pill.hidden = false;
      pill.append(icon('refresh'), 'Reload to update');
      pill.onclick = () => api.installUpdate();
    } else if (s.state === 'available' && !state.settings.autoDownloadUpdates) {
      pill.hidden = false;
      pill.append(icon('download'), 'Download update');
      pill.onclick = () => api.downloadUpdate();
    } else if (s.state === 'downloading') {
      pill.hidden = false;
      pill.classList.add('working');
      pill.append(icon('download'), `Updating ${s.percent || 0}%`);
    }
    drawBell();
    if (state.route === 'downloads') render(false);
  }

  /* ---------------- update logs ---------------- */

  const LOG_SECTIONS = [['features', 'New Features'], ['reworks', 'Reworks'], ['optimizations', 'Optimizations'], ['bugfixes', 'Bug Fixes']];

  async function showWhatsNew(all = false) {
    const data = await api.getWhatsNew(all);
    if (!data) { if (all) notify('No update logs yet', 'Nothing has changed since you installed Crescent.'); return; }
    modal((close) => [
      h('div', { class: 'logs-head' }, h('h3', { text: 'Update Logs' }), h('p', { text: `Crescent ${data.current}${all ? '' : ' is installed. Here is what changed.'}` })),
      h('div', { class: 'logs-body' }, data.versions.map((v) => [
        h('h4', { class: 'ver', text: `Version ${v.version}` }),
        // Sections that did not change are left out.
        LOG_SECTIONS.filter(([key]) => v[key]?.length).map(([key, title]) =>
          h('section', { class: `logs-sec ${key}` }, h('h5', {}, h('i'), title), h('ul', {}, v[key].map((t) => h('li', { text: t }))))),
      ])),
      h('div', { class: 'logs-foot' }, button('Done', 'light', close)),
    ], { cls: 'logs', onClose: () => api.ackVersion() });
  }

  /* ---------------- router and chrome ---------------- */

  function go(route) {
    if (route === state.stack[state.pos]) return render(true);
    state.stack = state.stack.slice(0, state.pos + 1).concat(route);
    state.pos = state.stack.length - 1;
    render(true);
  }
  function goBack(fallback) {
    if (state.pos > 0) { state.pos--; render(true); } else go(fallback);
  }
  function render(resetScroll = false) {
    clearInterval(state.pollTimer);
    clearInterval(state.heroTimer);
    const route = (state.route = state.stack[state.pos]);
    const i = route.indexOf(':');
    const name = i < 0 ? route : route.slice(0, i);
    const arg = i < 0 ? null : route.slice(i + 1);
    const top = page.scrollTop;
    page.pageSearch = null;
    const pages = { home: pageHome, library: pageLibrary, downloads: pageDownloads, milestones: pageMilestones, account: pageAccount, settings: pageSettings, game: () => pageGame(arg) };
    const view = (pages[name] || pageHome)();
    if (resetScroll && state.settings.transitions !== false) view.classList.add('page-enter'); // a small, smooth change of page
    page.replaceChildren(view);
    page.scrollTop = resetScroll ? 0 : top;
    chrome();
  }

  // Bottom left: the player's round picture and banner. Only rebuilt when something changed, so a banner video keeps playing.
  function drawMiniProfile() {
    const p = state.profile;
    const st = statusInfo();
    $('#acc-name').textContent = p.name;
    const sub = $('#acc-sub');
    if (sub.dataset.sig !== `${st.id}|${st.label}`) {
      sub.dataset.sig = `${st.id}|${st.label}`;
      sub.replaceChildren(h('i', { class: `st-dot st-${st.id}` }), st.label);
    }
    const sig = `${p.banner?.url || ''}|${p.avatarUrl || ''}|${p.avatarType}|${p.name}|${p.border}|${JSON.stringify([p.avatarEdit, p.miniEdit])}`;
    if (sig === state.miniSig) return;
    state.miniSig = sig;
    const av = $('#acc-avatar');
    av.className = `avatar${borderClass()}`;
    av.replaceChildren();
    if (p.avatarUrl) av.append(mediaEl(p.avatarUrl, p.avatarType, p.avatarEdit));
    else av.textContent = p.name[0]?.toUpperCase() || '?';
    const bg = $('#acc-bg');
    bg.replaceChildren();
    if (p.banner) bg.append(mediaEl(p.banner.url, p.banner.type, p.miniEdit));
  }

  const tabLabel = () => (state.tab === 'installed' ? 'Installed' : state.tab === 'favorites' ? 'Favorites'
    : state.tab.startsWith('tag:') ? (state.tags.find((t) => `tag:${t.id}` === state.tab)?.name || 'All games') : 'All games');

  function chrome() {
    const route = state.route;
    const game = route.startsWith('game:') ? state.games.find((g) => g.id === route.slice(5)) : null;
    $('#crumb').textContent = route === 'home' ? 'Your launcher. Your universe.'
      : route === 'library' ? `Library / ${tabLabel()}` : route === 'downloads' ? 'Downloads / Overview'
      : route === 'account' ? 'Account / Profile' : route === 'settings' ? 'Settings' : route === 'milestones' ? 'Milestones' : `Library / ${game ? game.title : 'Game'}`;
    document.querySelectorAll('.side-item[data-route]').forEach((el) => el.classList.toggle('active', el.dataset.route === route || (route.startsWith('game:') && el.dataset.route === 'library')));
    $('#tb-back').disabled = state.pos === 0;
    $('#tb-fwd').disabled = state.pos >= state.stack.length - 1;

    const busy = pendingUpdates().length + inProgress().length;
    const count = $('#dl-count');
    count.hidden = !busy;
    count.textContent = busy;
    count.classList.add('warn');

    $('#quick').replaceChildren(...byPlayed(state.games.filter((g) => g.state === 'installed' || g.state === 'updating')).slice(0, 5).map((g) => {
      const open = () => go(`game:${g.id}`);
      return h('div', { class: 'quick-item', tabindex: '0', role: 'link', 'aria-label': g.title, onclick: open, onkeydown: (e) => e.key === 'Enter' && open() },
        h('span', { class: 'avatar', text: g.title[0].toUpperCase() }), h('span', { class: 'grow', text: g.title }), roundAction(g, true));
    }));

    drawMiniProfile();

    const left = $('#sb-left');
    if (state.scan.active) {
      const m = moons();
      const wrap = h('span', { class: 'sb-moons' });
      wrap.append(m);
      left.replaceChildren(h('span', { class: 'scan-line' }, wrap, h('span', { text: `Searching your drives… ${state.scan.text}` })));
    } else {
      const words = TIPS[state.tip % TIPS.length];
      if (left.textContent !== words) left.textContent = words;
    }

    const run = state.games.filter((g) => state.running.has(g.id));
    const act = inProgress()[0];
    $('#sb-mid').textContent = run.length ? `Playing ${run[0].title}` : act ? `${act.title} · ${gb(act.downloadDone || 0)} / ${gb(act.downloadTotal || 0)}` : '';
    $('#sb-right').textContent = `CRESCENT ${state.version}`;
    drawBell();
  }

  // Download speed worked out from how many bytes arrived since the last look
  function sampleDownloads(games, now) {
    for (const g of games) {
      if (g.state !== 'updating' && g.state !== 'installing') { delete state.dl[g.id]; continue; }
      const bytes = g.downloadDone || 0;
      const prev = state.dl[g.id];
      if (!prev) { state.dl[g.id] = { bytes, at: now, speed: 0 }; continue; }
      if (now - prev.at < 1500) continue;
      const inst = (bytes - prev.bytes) / ((now - prev.at) / 1000);
      if (inst >= 0) prev.speed = prev.speed ? prev.speed * 0.6 + inst * 0.4 : inst;
      prev.bytes = bytes;
      prev.at = now;
    }
  }

  async function refresh(force) {
    if (state.afk) return;
    const res = await api.listGames(!!force);
    const running = new Set(res.running);
    // Play time of a running game changes constantly and is shown by the live counter, so it must not trigger a redraw.
    const stable = res.games.map((g) => (running.has(g.id) ? { ...g, playSeconds: 0 } : g));
    const jobs = (res.updateJobs || []).map((j) => ({ id: j.id, state: j.state, error: j.error }));
    const snapshot = JSON.stringify([stable, res.profile, res.stores, res.running, res.settings, res.widgets, res.tags, res.gameTags, res.milestones, jobs]);
    state.disk = res.disk;
    state.scan = res.scan;
    state.games = res.games;
    state.running = running;
    state.jobs = res.updateJobs || [];
    state.totalSeconds = res.totalSeconds;
    state.borders = res.borders;
    const now = Date.now();
    sampleDownloads(res.games, now);
    for (const g of res.games) if (running.has(g.id)) state.liveBase[g.id] = { seconds: g.playSeconds, at: now };
    if (snapshot === state.snapshot) { tickLive(); return; }
    // Don't redraw under the user's cursor while they're typing in the page.
    if (document.activeElement && page.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    if (document.querySelector('.dd.open')) return; // a menu is open: draw again after it closes
    Object.assign(state, { stores: res.stores, profile: res.profile, settings: res.settings, widgets: res.widgets, tags: res.tags, gameTags: res.gameTags, milestones: res.milestones, snapshot });
    for (const id of res.running) state.launching.delete(id);
    applyTheme();
    applyFriends();
    applyLook();
    render(false);
  }

  /* ---------------- AFK mode: Crescent sleeps while you play or are away ---------------- */

  const AFK_WITH_GAME_SECONDS = 15;
  function shouldBeAfk() {
    if (state.settings.afkMode === false) return false;
    if (document.hidden || !document.hasFocus()) return true; // minimized, or not the window in front
    const idle = (Date.now() - state.lastActive) / 1000;
    const gameActive = state.running.size > 0 || state.launching.size > 0;
    return idle >= (state.settings.afkMinutes || 5) * 60 || (gameActive && idle >= AFK_WITH_GAME_SECONDS);
  }
  function enterAfk() {
    state.afk = true;
    document.body.classList.add('afk');
    clearInterval(state.heroTimer);
    clearInterval(state.pollTimer);
    clearInterval(state.idleTimer);
    document.querySelectorAll('video').forEach((v) => v.pause());
    api.setAfk(true).catch(() => {});
  }
  function leaveAfk() {
    state.afk = false;
    state.lastActive = Date.now();
    document.body.classList.remove('afk');
    api.setAfk(false).catch(() => {});
    document.querySelectorAll('video').forEach((v) => v.play()?.catch(() => {}));
    startIdleTimer();
    state.snapshot = ''; // draw again with fresh data
    refresh(false).then(() => render(false)).catch(() => {});
  }
  function evaluateAfk() {
    const want = shouldBeAfk();
    if (want && !state.afk) enterAfk();
    else if (!want && state.afk) leaveAfk();
  }
  function startIdleTimer() {
    clearInterval(state.idleTimer);
    state.idleTimer = setInterval(evaluateAfk, 5000);
  }
  function activity() {
    state.lastActive = Date.now();
    if (state.afk && document.hasFocus() && !document.hidden) leaveAfk();
  }

  /* ---------------- start up ---------------- */

  document.body.classList.toggle('mac', api.platform === 'darwin');
  document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon)));
  document.querySelectorAll('[data-route]').forEach((el) => el.addEventListener('click', () => go(el.dataset.route)));
  $('#tb-back').addEventListener('click', () => { if (state.pos > 0) { state.pos--; render(true); } });
  $('#tb-fwd').addEventListener('click', () => { if (state.pos < state.stack.length - 1) { state.pos++; render(true); } });
  $('#win-min').addEventListener('click', () => api.window.minimize());
  $('#win-max').addEventListener('click', () => api.window.maximize());
  $('#win-close').addEventListener('click', () => api.window.close());
  const searchBox = $('#search');
  searchBox.addEventListener('input', () => { state.searchIndex = 0; drawSearchMenu(); });
  searchBox.addEventListener('focus', drawSearchMenu);
  searchBox.addEventListener('blur', () => { $('#search-menu').hidden = true; });
  searchBox.addEventListener('keydown', (e) => {
    const n = state.searchResults.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); state.searchIndex = (state.searchIndex + 1) % n; drawSearchMenu(); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); state.searchIndex = (state.searchIndex - 1 + n) % n; drawSearchMenu(); }
    else if (e.key === 'Enter' && n) { e.preventDefault(); openSearchResult(state.searchResults[state.searchIndex]); }
    else if (e.key === 'Escape') { searchBox.value = ''; $('#search-menu').hidden = true; searchBox.blur(); }
  });
  api.onMilestone((texts) => texts.forEach((t) => notify('Milestone reached', t)));
  $('#loader-moons').append(moons());

  $('#bell').addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = $('#bell-menu');
    menu.hidden = !menu.hidden;
    drawBell();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('.bell-wrap')) $('#bell-menu').hidden = true; });

  const setFriendsHidden = async (hidden) => {
    state.settings = await api.setSetting('friendsHidden', hidden);
    applyFriends();
    if (['settings', 'home'].includes(state.route)) render(false);
  };
  $('#friends-hide').addEventListener('click', () => setFriendsHidden(true));
  $('#friends-show').addEventListener('click', () => setFriendsHidden(false));

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); }
    else if (e.key === 'Escape') { $('#bell-menu').hidden = true; if (state.route.startsWith('game:') && !document.querySelector('.modal-back')) goBack('library'); }
  });

  window.addEventListener('focus', async () => {
    if (state.settings.autoScan !== false) refresh(true).catch(console.error);
    state.themes = await api.listThemes();
  });
  api.onLibraryChanged(() => refresh(false).catch(console.error));
  api.onRunning(() => refresh(false).catch(console.error));
  api.onScanProgress((s) => { state.scan = s; chrome(); });
  api.onUpdateStatus(renderUpdate);
  api.onUpdateJobs((list) => {
    state.jobs = list;
    if (state.afk) return;
    chrome();
    if (state.route === 'downloads') render(false);
  });
  ['pointermove', 'pointerdown', 'keydown', 'wheel'].forEach((ev) => window.addEventListener(ev, activity, { passive: true }));
  window.addEventListener('blur', evaluateAfk);
  window.addEventListener('focus', activity);
  document.addEventListener('visibilitychange', evaluateAfk);
  let wideNow = isWideHome();
  window.addEventListener('resize', () => {
    const w = isWideHome();
    if (w !== wideNow) { wideNow = w; if (state.route === 'home' && !state.afk) render(false); }
  });

  setInterval(() => { if (!state.afk) tickLive(); }, 1000);
  setInterval(() => {
    const left = $('#sb-left');
    if (state.scan.active || state.afk) return;
    left.classList.add('fade');
    setTimeout(() => { state.tip++; chrome(); left.classList.remove('fade'); }, 380);
  }, 25000);

  (async function init() {
    await withLoader('Looking for your games…', async () => {
      const [version, themes] = await Promise.all([api.getAppVersion(), api.listThemes()]);
      state.version = version;
      state.themes = themes;
      renderUpdate(await api.getUpdateStatus());
      await refresh(true);
      applyTheme();
      applyFriends();
      applyLook();
      render(true);
    }, 2000);
    startIdleTimer();
    const logs = await api.getWhatsNew(false);
    if (logs && state.settings.showUpdateLogs) showWhatsNew(false);
    else if (logs) api.ackVersion();
  })().catch((err) => { loader.classList.add('hide'); notify("Couldn't load your library", err.message, 'error'); });
})();
