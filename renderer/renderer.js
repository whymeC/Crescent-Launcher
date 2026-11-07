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
  const pct = (g) => Math.round((g.progress || 0) * 100);
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

  const ROUTE_NAMES = { home: 'Home', library: 'Library', downloads: 'Downloads', account: 'Account', settings: 'Settings' };
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
  const pendingUpdates = () => state.games.filter((g) => g.state === 'updating' && g.updating !== 'running');
  const inProgress = () => state.games.filter((g) => g.state === 'installing' || (g.state === 'updating' && g.updating === 'running'));
  const buildLine = (g) => [STORES[g.store], g.version && (g.store === 'steam' ? `build ${g.version}` : `v${g.version}`)].filter(Boolean).join(' · ');

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
    if (!r.ok) return failure(`Couldn't start the update for ${g.title}. ${r.error}`, () => updateGame(g));
    notify(`Update sent to Steam`, `Steam will start updating ${g.title}. If nothing happens, open the Downloads tab in Steam.`);
    setTimeout(() => refresh(true), 3000);
  }

  // The main button for a game: Play, Close Game, Update, or a disabled status.
  function gameAction(g, { big = false, playLabel = 'Play' } = {}) {
    const cls = big ? 'big' : '';
    const disabled = (label) => h('button', { class: `btn ${cls}`, type: 'button', disabled: true }, label);
    if (state.running.has(g.id)) return h('button', { class: `btn danger ${cls}`, type: 'button', onclick: () => closeGame(g) }, icon('stop'), 'Close Game');
    if (state.launching.has(g.id)) return disabled('Starting…');
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
    const sub = g.state === 'installing' ? STORES[g.store] : [g.lastPlayed ? `Last played ${ago(g.lastPlayed)}` : 'Not played yet', liveText(g, 'short', ' · ')];
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

    const recent = byRecent(g).slice(0, 3);
    root.append(
      h('div', { class: 'section-head' }, h('h3', { text: g.some((x) => x.lastPlayed) ? 'Recently played' : 'Your games' }),
        h('button', { class: 'link-btn', type: 'button', onclick: () => go('library') }, 'View library', icon('fwd'))),
      h('div', { class: 'cards' }, recent.map(card)));

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
    const grid = h('div', { class: `cards${state.layout === 'list' ? ' list' : ''}` });
    const count = h('small');

    function draw() {
      const q = state.query.trim().toLowerCase();
      const list = sortGames(sets[state.tab].filter((g) => !q || g.title.toLowerCase().includes(q)));
      grid.replaceChildren(...list.map(card));
      if (!list.length) grid.replaceChildren(h('p', { class: 'sub', text: q ? `No games match "${state.query}".` : 'Nothing here yet.' }));
      count.textContent = `Showing ${list.length} of ${all.length} games`;
    }
    draw();

    const search = h('input', { type: 'search', placeholder: `Search ${all.length} games`, value: state.query, 'aria-label': 'Search your library' });
    search.addEventListener('input', () => setQuery(search.value));
    page.pageSearch = search;

    const sort = h('select', { 'aria-label': 'Sort games' },
      [['recent', 'Recently played'], ['name', 'Name'], ['played', 'Most played']].map(([v, l]) => h('option', { value: v, text: l, selected: state.sort === v })));
    sort.addEventListener('change', () => { state.sort = sort.value; draw(); });

    const layoutBtn = (name, label) => h('button', { type: 'button', class: state.layout === name ? 'on' : '', 'aria-label': label, onclick: () => { state.layout = name; render(false); } }, icon(name));

    return h('div', {},
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { text: 'Your library' }), h('p', { class: 'sub', text: 'All your worlds. One place to come back to.' })),
        button('Add a game', 'ghost', addGame, 'plus')),
      h('div', { class: 'tabs', role: 'tablist' },
        [['all', 'All games'], ['installed', 'Installed'], ['favorites', 'Favorites']].map(([key, label]) =>
          h('button', { class: `tab${state.tab === key ? ' on' : ''}`, type: 'button', role: 'tab', onclick: () => { state.tab = key; render(false); } }, label, h('small', { text: sets[key].length })))),
      h('div', { class: 'toolbar' },
        h('label', { class: 'field grow' }, icon('search'), search),
        h('label', { class: 'field' }, h('span', { class: 'card-sub', text: 'Sort by' }), sort),
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
          facts.length ? h('div', { class: 'facts' }, facts.map(([k, v]) => h('div', {}, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v })))) : null),
        h('aside', { class: 'panel' },
          h('h3', {}, 'Storage', icon('disk')),
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Installed size' }), h('span', { class: 'big-num', text: g.sizeBytes ? gb(g.sizeBytes) : 'Unknown' })),
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Location' }), h('span', { class: 'v', text: (g.installPath || g.launch?.target || `Managed by ${STORES[g.store]}`).replace(/([\\/])/g, '$1\u200b') })),
          d ? h('div', { class: 'kv' }, h('span', { class: 'k', text: `Local disk (${d.label})` }), h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((1 - d.free / d.total) * 100)}%` })), h('span', { class: 'card-sub', text: `${gb(d.free)} free of ${gb(d.total)}` })) : null,
          h('div', { class: 'btn-stack' },
            button('Show in folder', 'ghost small', async () => { const r = await api.revealGame(g.id); if (!r.ok) notify('Could not open the folder', r.error, 'error'); }, 'folder'),
            button(removable ? 'Remove from library' : 'Hide from library', 'ghost small', async () => { await api.hideGame(g.id); await refresh(true); goBack('library'); }, 'trash')))));
  }

  /* ---------------- downloads ---------------- */

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
      root.append(h('div', { class: 'section-head' }, h('h3', { text: `Updates available · ${pending.length}` })));
      root.append(...pending.map((g) => h('div', { class: 'strip' }, thumb(g),
        h('div', { class: 'grow' }, h('div', { text: g.title }), h('div', { class: 'card-sub', text: `Update available · ${STORES[g.store]}` })),
        button('Update', 'update small', () => updateGame(g), 'download'))));
    }

    if (active.length) {
      any = true;
      root.append(h('div', { class: 'section-head' }, h('h3', { text: 'In progress' })));
      root.append(...active.map((g) => h('div', { class: 'strip' }, thumb(g),
        h('div', { class: 'grow' }, h('div', { text: g.title }),
          h('div', { class: 'card-sub', text: `${g.state === 'installing' ? 'Installing' : 'Update'} · ${gb(g.downloadDone || 0)} of ${gb(g.downloadTotal || 0)}` }),
          h('div', { class: 'bar', style: 'margin-top:8px' }, h('i', { style: `width:${pct(g)}%` }))),
        h('b', { text: `${pct(g)}%` }))));
    }

    if (!any) root.append(h('section', { class: 'empty', style: 'padding-top:10px' }, h('h2', { text: 'Everything is up to date' }), h('p', { text: 'Games that need an update show up here, and you choose when to update them.' })));

    if (state.disk) {
      const d = state.disk;
      root.append(h('div', { class: 'strip' }, icon('disk'), h('div', { class: 'grow' }, h('div', { text: `Local disk (${d.label})` }), h('div', { class: 'card-sub', text: `${gb(d.free)} free of ${gb(d.total)}` })), h('div', { style: 'width:240px' }, h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((1 - d.free / d.total) * 100)}%` })))));
    }
    state.pollTimer = setInterval(() => refresh(true), 4000);
    return root;
  }

  /* ---------------- account ---------------- */

  function videoEl(url) {
    const v = h('video', { src: url, loop: true, playsinline: true, preload: 'auto', autoplay: true });
    v.muted = true;
    v.disablePictureInPicture = true;
    let retried = false;
    v.addEventListener('canplay', () => { if (v.paused) v.play().catch(() => {}); });
    v.addEventListener('error', () => { if (!retried) { retried = true; setTimeout(() => v.load(), 400); } });
    return v;
  }

  // The same banner element is reused on every redraw (a video would otherwise restart each time).
  function bannerBox() {
    const b = state.profile.banner;
    const key = b ? b.url : '';
    if (!state.bannerCache || state.bannerCache.key !== key) {
      const el = h('div', { class: 'banner' });
      if (b) el.append(b.type === 'video' ? videoEl(b.url) : h('img', { src: b.url, alt: '' }));
      state.bannerCache = { key, el };
    }
    const el = state.bannerCache.el;
    el.style.aspectRatio = b ? `${b.width} / ${b.height}` : '1280 / 400'; // the banner takes the shape of the file
    const v = el.querySelector('video');
    if (v) setTimeout(() => v.play().catch(() => {}), 0); // a video pauses when it leaves the page; carry on where it was
    return el;
  }

  function avatarEl(cls = 'avatar') {
    const a = h('span', { class: cls });
    if (state.profile.avatarUrl) a.append(h('img', { src: state.profile.avatarUrl, alt: '' }));
    else a.textContent = state.profile.name[0]?.toUpperCase() || '?';
    return a;
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
    return h('section', { class: 'panel' },
      h('h3', {}, 'Wallpaper', cur.type !== 'none' ? button('Remove wallpaper', 'ghost small', async () => { state.profile = await api.setTheme('none'); applyTheme(); render(false); }) : null),
      h('div', { class: 'tabs themes-tabs' },
        [['animated', 'Animated'], ['still', 'Still pictures']].map(([k, l]) => h('button', { class: `tab${tab === k ? ' on' : ''}`, type: 'button', onclick: () => { state.themeTab = k; render(false); } }, l))),
      h('div', { class: 'theme-grid' }, cards));
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

    return h('div', {},
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Your account' }), h('p', { class: 'sub', text: 'Your identity, inside and outside the game.' }))),
      h('section', { class: 'profile v2' },
        bannerBox(),
        h('div', { class: 'profile-bar' },
          avatarEl('avatar'),
          h('div', { class: 'who' }, h('h2', { text: state.profile.name }), h('p', { class: 'sub', text: 'Local profile, stored on this PC' })),
          h('div', { class: 'btn-stack' },
            button('Change picture', 'ghost small', () => startUpload('avatar'), 'edit'),
            button('Change banner', 'ghost small', () => startUpload('banner'), 'edit'),
            state.profile.avatarUrl ? button('Remove picture', 'ghost small', async () => { state.profile = await api.clearMedia('avatar'); render(false); chrome(); }) : null,
            state.profile.banner ? button('Remove banner', 'ghost small', async () => { state.profile = await api.clearMedia('banner'); render(false); }) : null))),
      h('div', { class: 'cols even', style: 'margin-bottom:16px' },
        h('section', { class: 'panel' }, h('h3', { text: 'Account details' }),
          h('label', { class: 'label', for: 'name', text: 'Display name' }), input,
          h('div', { class: 'btn-stack', style: 'margin-top:14px' }, button('Save name', 'light small', save), button('Open data folder', 'ghost small', () => api.openDataFolder(), 'folder'))),
        h('section', { class: 'panel' }, h('h3', { text: 'Your Crescent journey' }),
          h('div', { class: 'stats3' },
            h('div', {}, h('span', { class: 'big-num', text: state.games.length }), h('small', { text: 'Games' })),
            h('div', {}, h('span', { class: 'big-num', text: state.games.filter((g) => g.state === 'installed').length }), h('small', { text: 'Installed' })),
            h('div', {}, h('span', { class: 'big-num', text: total ? (total / 3600).toFixed(1) : '0' }), h('small', { text: 'Hours played' }))))),
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
        onclick: async () => { state.settings = await api.setSetting(key, !on); if (key === 'friendsHidden') applyFriends(); chrome(); render(false); },
      }, h('i'));
    };
    const seg = (key, options) => h('div', { class: 'seg inline' }, options.map(([v, l]) =>
      h('button', { type: 'button', class: state.settings[key] === v ? 'on' : '', text: l, onclick: async () => { state.settings = await api.setSetting(key, v); render(false); } })));
    const group = (title, ...rows) => h('section', { class: 'set-group' }, h('h3', { text: title }), h('div', { class: 'set-card' }, rows));

    return h('div', {},
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Settings' }), h('p', { class: 'sub', text: 'Make Crescent work the way you like.' }))),
      group('Launcher',
        row('Start with Windows', 'Open Crescent when you sign in. Works in the installed app.', toggle('startWithWindows')),
        row('Minimize when a game starts', 'Gets the launcher out of the way while you play.', toggle('minimizeOnGameStart')),
        row('Smooth Jump Back In transition', 'The Jump Back In box on the home screen fades to the next game. Turn off to switch instantly.', toggle('heroTransition')),
        row('Hide the friends list', 'Friends are not available yet. You can also use the button on the list.', toggle('friendsHidden')),
        row('Most played games layout', 'How your top games are shown on the Account page.', seg('topGamesLayout', [['list', 'List'], ['grid', '2 by 2']]))),
      group('Games',
        row('Look for games automatically', 'Checks your game launchers when Crescent starts and when you come back to it.', toggle('autoScan')),
        row('Search every drive', 'Also looks through your drives for games that no launcher reported. Runs in the background.', toggle('deepScan')),
        row('Track play time', 'Counts the seconds, minutes and hours you spend in each game.', toggle('trackPlaytime')),
        row('Scan now', 'Checks all supported game launchers right away.', button('Scan now', 'ghost small', rescan, 'refresh')),
        row('Search every drive now', 'This can take a few minutes. You can keep using Crescent.', button('Start search', 'ghost small', () => { api.deepScan(); notify('Searching your drives', 'Crescent looks for games in the background. New games appear in your library.'); }, 'search')),
        row('Hidden games', 'Show the games you hid from your library again.', button('Show all', 'ghost small', async () => { await api.unhideAll(); await refresh(true); notify('Hidden games are back', 'They are in your library again.'); }))),
      group('Updates',
        row('Check for launcher updates', 'Looks for a new version when Crescent starts and every few hours.', toggle('autoCheckUpdates')),
        row('Download updates automatically', 'When off, a Download update button appears instead.', toggle('autoDownloadUpdates')),
        row('Show update logs after updating', 'Shows what is new once a new version is installed.', toggle('showUpdateLogs')),
        row('Game update messages', 'Shows a message in the bell when a game needs an update.', toggle('notifyGameUpdates')),
        row('Check now', 'Looks for a launcher update right away.', button('Check for updates', 'ghost small', async () => {
          const r = await api.checkForUpdates();
          if (!r.ok) notify('Could not check for updates', r.error, 'error'); else notify('Checking for updates', 'If there is a new version, a green button appears at the top.');
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

  async function inspect(kind, file) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isVideo = file.type.startsWith('video/');
    const imageTypes = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    if (kind === 'avatar') {
      if (!imageTypes.includes(ext)) throw invalid('A profile picture must be a PNG, JPG, WEBP or GIF image.');
      if (file.size > 10 * 1024 * 1024) throw invalid('A profile picture can be at most 10 MB.');
    } else {
      if (!imageTypes.includes(ext) && !['mp4', 'webm'].includes(ext)) throw invalid('A banner must be an image or an MP4 or WEBM video.');
      if (file.size > 100 * 1024 * 1024) throw invalid('A banner can be at most 100 MB.');
    }
    const info = await readMedia(file);
    if (kind === 'avatar') {
      if (info.width < 128 || info.height < 128) throw invalid(`A profile picture must be at least 128 by 128 pixels. This one is ${info.width} by ${info.height}.`);
    } else {
      if (info.width < 1280 || info.width > 3840 || info.height < 400 || info.height > 700) throw invalid(`A banner must be 1280 to 3840 pixels wide and 400 to 700 pixels tall. This one is ${info.width} by ${info.height}.`);
      if (isVideo && info.duration > 10.05) throw invalid(`A banner video can be at most 10 seconds long. This one is ${info.duration.toFixed(1)} seconds.`);
    }
    return { info, ext };
  }

  async function startUpload(kind) {
    const file = await uploadModal(kind === 'avatar'
      ? { noun: 'your picture.', accept: 'image/png,image/jpeg,image/webp,image/gif', hint: 'PNG, JPG, WEBP or GIF, at least 128 by 128 pixels' }
      : { noun: 'your banner.', accept: 'image/*,video/mp4,video/webm', hint: '1280 to 3840 pixels wide, 400 to 700 tall. Video: 10 seconds at most' });
    if (file) runUpload(kind, file);
  }

  async function runUpload(kind, file) {
    let cancelled = false;
    let session = null;
    const p = popup({
      kind: 'progress', title: 'Just a second...', text: 'Checking your file…', progress: 0,
      actions: [{ label: 'Cancel', onclick: () => { cancelled = true; if (session) api.mediaAbort(session.id); p.close(); } }],
    });
    try {
      const { info, ext } = await inspect(kind, file);
      if (cancelled) return;
      p.update({ text: 'Right now, your file is being uploaded. Please wait a moment while we finish your upload.' });
      session = await api.mediaBegin({ kind, ext });
      const CHUNK = 1024 * 1024;
      for (let offset = 0; offset < file.size; offset += CHUNK) {
        if (cancelled) return;
        await api.mediaChunk(session.id, await file.slice(offset, offset + CHUNK).arrayBuffer());
        p.update({ progress: Math.min(99, ((offset + CHUNK) / file.size) * 100) });
      }
      if (cancelled) return;
      const res = await api.mediaEnd(session.id, info);
      state.profile = res.profile;
      applyTheme();
      chrome();
      render(false);
      p.set('success', {
        title: 'Your file was uploaded!', text: 'Your file was successfully uploaded. You can copy the link to your clipboard.',
        actions: [{ label: 'Copy Link', onclick: () => api.copyText(res.fileUrl) }, { label: 'Done', onclick: () => p.close() }],
      });
    } catch (err) {
      if (cancelled) return;
      if (session) api.mediaAbort(session.id);
      const retry = err.validation ? () => startUpload(kind) : () => runUpload(kind, file);
      p.set('error', {
        title: 'Oops! so sorry',
        text: err.validation ? err.message : 'Your file could not be uploaded due to an error. Would you want to give it another shot?',
        actions: [{ label: 'Retry', onclick: () => { p.close(); retry(); } }, { label: 'Cancel', onclick: () => p.close() }],
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
  function setQuery(value) {
    state.query = value;
    $('#search').value = value;
    if (page.pageSearch && page.pageSearch.value !== value) page.pageSearch.value = value;
    if (state.route !== 'library') go('library');
    else render(false);
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
    const pages = { home: pageHome, library: pageLibrary, downloads: pageDownloads, account: pageAccount, settings: pageSettings, game: () => pageGame(arg) };
    page.replaceChildren((pages[name] || pageHome)());
    page.scrollTop = resetScroll ? 0 : top;
    chrome();
  }

  // Bottom left: the player's round picture and banner. Only rebuilt when something changed, so a banner video keeps playing.
  function drawMiniProfile() {
    const p = state.profile;
    $('#acc-name').textContent = p.name;
    const sig = `${p.banner?.url || ''}|${p.avatarUrl || ''}|${p.name}`;
    if (sig === state.miniSig) return;
    state.miniSig = sig;
    const av = $('#acc-avatar');
    av.replaceChildren();
    if (p.avatarUrl) av.append(h('img', { src: p.avatarUrl, alt: '' }));
    else av.textContent = p.name[0]?.toUpperCase() || '?';
    const bg = $('#acc-bg');
    bg.replaceChildren();
    if (p.banner) bg.append(p.banner.type === 'video' ? videoEl(p.banner.url) : h('img', { src: p.banner.url, alt: '' }));
  }

  function chrome() {
    const route = state.route;
    const game = route.startsWith('game:') ? state.games.find((g) => g.id === route.slice(5)) : null;
    $('#crumb').textContent = route === 'home' ? 'Your launcher. Your universe.'
      : route === 'library' ? 'Library / All games' : route === 'downloads' ? 'Downloads / Overview'
      : route === 'account' ? 'Account / Profile' : route === 'settings' ? 'Settings' : `Library / ${game ? game.title : 'Game'}`;
    document.querySelectorAll('.side-item[data-route]').forEach((el) => el.classList.toggle('active', el.dataset.route === route || (route.startsWith('game:') && el.dataset.route === 'library')));
    $('#tb-back').disabled = state.pos === 0;
    $('#tb-fwd').disabled = state.pos >= state.stack.length - 1;

    const busy = pendingUpdates().length + inProgress().length;
    const count = $('#dl-count');
    count.hidden = !busy;
    count.textContent = busy;
    count.classList.add('warn');

    $('#quick').replaceChildren(...byRecent(state.games.filter((g) => g.state === 'installed' || g.state === 'updating')).slice(0, 3).map((g) => {
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

  async function refresh(force) {
    const res = await api.listGames(!!force);
    const running = new Set(res.running);
    // Play time of a running game changes constantly and is shown by the live counter, so it must not trigger a redraw.
    const stable = res.games.map((g) => (running.has(g.id) ? { ...g, playSeconds: 0 } : g));
    const snapshot = JSON.stringify([stable, res.profile, res.stores, res.running, res.settings]);
    state.disk = res.disk;
    state.scan = res.scan;
    state.games = res.games;
    state.running = running;
    const now = Date.now();
    for (const g of res.games) if (running.has(g.id)) state.liveBase[g.id] = { seconds: g.playSeconds, at: now };
    if (snapshot === state.snapshot) { tickLive(); return; }
    // Don't redraw under the user's cursor while they're typing in the page.
    if (document.activeElement && page.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    Object.assign(state, { stores: res.stores, profile: res.profile, settings: res.settings, snapshot });
    for (const id of res.running) state.launching.delete(id);
    applyTheme();
    applyFriends();
    render(false);
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
  $('#search').addEventListener('input', (e) => setQuery(e.target.value));
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
    if (state.route === 'settings') render(false);
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

  setInterval(tickLive, 1000);
  setInterval(() => {
    const left = $('#sb-left');
    if (state.scan.active) return;
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
      render(true);
    }, 2000);
    const logs = await api.getWhatsNew(false);
    if (logs && state.settings.showUpdateLogs) showWhatsNew(false);
    else if (logs) api.ackVersion();
  })().catch((err) => { loader.classList.add('hide'); notify("Couldn't load your library", err.message, 'error'); });
})();
