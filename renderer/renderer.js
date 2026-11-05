(() => {
  'use strict';

  const api = window.launcher;
  const $ = (s) => document.querySelector(s);
  const state = {
    games: [], stores: {}, disk: null, profile: { name: 'Player' }, version: '',
    stack: ['home'], pos: 0, route: 'home',
    query: '', tab: 'all', sort: 'recent', layout: 'grid', featured: 0,
    meta: {}, update: { state: 'idle' }, snapshot: '', poll: null,
  };

  /* ---------------- helpers ---------------- */

  const ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    library: '<path d="M4 4v16M9 4v16M14 5l5 14"/>',
    download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', fwd: '<path d="M9 5l7 7-7 7"/>',
    min: '<path d="M5 12h14"/>', max: '<rect x="6" y="6" width="12" height="12"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5l11 7-11 7z"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    check: '<path d="M5 12l5 5 9-10"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    disk: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 14h.01M17 12h-5"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>', refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',
  };
  function icon(name) {
    const el = document.createElement('span');
    el.className = 'ico';
    el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
    return el;
  }

  // Builds DOM nodes without innerHTML, so game names can never inject markup.
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') el.className = value;
      else if (key === 'text') el.textContent = value;
      else if (key === 'style') el.style.cssText = value;
      else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
      else el.setAttribute(key, value === true ? '' : value);
    }
    for (const child of children.flat()) if (child != null && child !== false) el.append(child);
    return el;
  }
  const button = (label, kind, onclick, iconName) =>
    h('button', { class: `btn ${kind}`, type: 'button', onclick }, iconName ? icon(iconName) : null, label);

  const hue = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const dayStart = (t) => new Date(t).setHours(0, 0, 0, 0);
  function ago(ts) {
    if (!ts) return 'never';
    const d = Math.round((dayStart(Date.now()) - dayStart(ts)) / 864e5);
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  const hours = (s) => (s < 60 ? '' : `${(s / 3600).toFixed(1)} h`);
  const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
  const pct = (g) => Math.round((g.progress || 0) * 100);
  const updateText = (g) => (pct(g) ? `Updating ${pct(g)}%` : 'Update pending');
  const STORES = { steam: 'Steam', epic: 'Epic Games', gog: 'GOG', manual: 'Added by you' };

  function toast(message) {
    const el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (el.hidden = true), 5000);
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

  function loadMeta(game, cb) {
    if (game.id in state.meta) return cb(state.meta[game.id]);
    api.getMeta(game.id).then((m) => cb((state.meta[game.id] = m || null))).catch(() => cb(null));
  }

  const byRecent = (list) => [...list].sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.title.localeCompare(b.title));
  const sortGames = (list) =>
    state.sort === 'name' ? [...list].sort((a, b) => a.title.localeCompare(b.title))
    : state.sort === 'played' ? [...list].sort((a, b) => b.playSeconds - a.playSeconds)
    : byRecent(list);
  const activeDownloads = () => state.games.filter((g) => g.state === 'installing' || g.state === 'updating');

  /* ---------------- actions ---------------- */

  async function play(game) {
    const r = await api.launchGame(game.id);
    if (!r.ok) return toast(`Couldn't start ${game.title}. ${r.error}`);
    setTimeout(() => refresh(true), 1500);
  }
  async function toggleFav(game) {
    game.favorite = await api.toggleFavorite(game.id);
    render();
  }
  async function addGame() {
    const r = await api.addGame();
    if (!r.ok) return toast(`Couldn't add that game. ${r.error}`);
    if (r.canceled) return;
    await refresh(true);
    go(`game:${r.id}`);
  }
  async function rescan() {
    await refresh(true);
    toast(`Library updated. ${state.games.length} games found.`);
  }

  /* ---------------- shared pieces ---------------- */

  function statusBadge(g) {
    if (g.state === 'installed') return h('span', { class: 'badge' }, icon('check'), 'Installed');
    if (g.state === 'missing') return h('span', { class: 'badge busy', text: 'File missing' });
    return h('span', { class: 'badge busy', text: g.state === 'installing' ? `Installing ${pct(g)}%` : updateText(g) });
  }

  function card(g) {
    const played = hours(g.playSeconds);
    const sub = g.state === 'installed' || g.state === 'updating'
      ? [g.lastPlayed ? `Last played ${ago(g.lastPlayed)}` : 'Not played yet', played].filter(Boolean).join(' · ')
      : STORES[g.store];
    const go_ = () => go(`game:${g.id}`);
    return h('article', {
        class: 'card', tabindex: '0', role: 'link', 'aria-label': g.title,
        onclick: go_, onkeydown: (e) => e.key === 'Enter' && go_(),
      },
      artBox(g, ['header', 'hero'], ''),
      statusBadge(g),
      h('button', {
        class: `star${g.favorite ? ' on' : ''}`, type: 'button',
        'aria-label': g.favorite ? 'Remove from favorites' : 'Add to favorites',
        onclick: (e) => { e.stopPropagation(); toggleFav(g); },
      }, icon('star')),
      h('div', { class: 'card-body' },
        h('div', { class: 'card-text' }, h('div', { class: 'card-title', text: g.title }), h('div', { class: 'card-sub', text: sub })),
        h('button', {
          class: 'round', type: 'button', 'aria-label': `Play ${g.title}`,
          disabled: g.state === 'installing' || g.state === 'missing',
          onclick: (e) => { e.stopPropagation(); play(g); },
        }, icon(g.state === 'installing' ? 'download' : 'play'))
      )
    );
  }

  function downloadStrip(list) {
    const g = list[0];
    const sub = g.state === 'installing' ? 'Installing' : 'Update';
    return h('div', { class: 'strip' },
      icon('download'),
      h('div', { class: 'grow' },
        h('div', { text: `${g.title}${list.length > 1 ? ` and ${list.length - 1} more` : ''}` }),
        h('div', { class: 'card-sub', text: `${sub} in progress · ${pct(g)}%` })),
      h('div', { style: 'width:220px' }, h('div', { class: 'bar' }, h('i', { style: `width:${pct(g)}%` }))),
      button('View', 'ghost small', () => go('downloads')));
  }

  function emptyState() {
    return h('section', { class: 'empty' },
      h('h2', { text: 'No games found yet' }),
      h('p', { text: 'Crescent looks for games from Steam, Epic Games and GOG. Games from other places can be added by hand, one at a time.' }),
      h('div', { class: 'btn-stack' }, button('Add a game', 'light', addGame, 'plus'), button('Scan again', 'ghost', rescan, 'refresh')));
  }

  /* ---------------- pages ---------------- */

  function pageHome() {
    const g = state.games;
    const hr = new Date().getHours();
    const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    const root = h('div', {},
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { text: `${greet}, ${state.profile.name}.` }), h('p', { class: 'sub', text: 'A little escape is waiting for you.' })),
        h('span', { class: 'pill-note' }, icon('library'), `${g.length} games in your library`)));
    if (!g.length) { root.append(emptyState()); return root; }

    const playable = byRecent(g.filter((x) => x.state === 'installed' || x.state === 'updating'));
    const list = playable.slice(0, 4);
    if (list.length) root.append(hero(list[state.featured % list.length], list));

    const recent = byRecent(g).slice(0, 3);
    root.append(
      h('div', { class: 'section-head' }, h('h3', { text: g.some((x) => x.lastPlayed) ? 'Recently played' : 'Your games' }),
        h('button', { class: 'link-btn', type: 'button', onclick: () => go('library') }, 'View library', icon('fwd'))),
      h('div', { class: 'cards' }, recent.map(card)));
    const active = activeDownloads();
    if (active.length) root.append(downloadStrip(active));
    return root;
  }

  function hero(g, list) {
    const desc = h('p', { class: 'hero-desc' });
    loadMeta(g, (m) => (desc.textContent = m?.description || ''));
    const stats = [hours(g.playSeconds) && `${hours(g.playSeconds)} played`, g.lastPlayed ? `Last played ${ago(g.lastPlayed)}` : 'Not played yet'].filter(Boolean).join(' · ');
    return h('section', { class: 'hero' },
      artBox(g, ['hero', 'header']),
      h('div', { class: 'hero-shade' }),
      h('div', { class: 'hero-body' },
        h('div', { class: 'eyebrow' }, h('i'), g.lastPlayed ? 'Jump back in' : 'Ready when you are'),
        h('h2', { text: g.title }),
        h('div', { class: 'build', text: [STORES[g.store], g.version && (g.store === 'steam' ? `build ${g.version}` : `v${g.version}`)].filter(Boolean).join(' · ') }),
        desc,
        h('div', { class: 'hero-stats', text: stats }),
        h('div', { class: 'btn-row' }, button('Launch game', 'light', () => play(g), 'play'), button('View details', 'ghost', () => go(`game:${g.id}`)))),
      list.length > 1
        ? h('div', { class: 'dots' }, list.map((x, i) => h('button', { class: `dot${x === g ? ' on' : ''}`, type: 'button', 'aria-label': `Show ${x.title}`, onclick: () => { state.featured = i; render(); } })))
        : null);
  }

  function pageLibrary() {
    const all = state.games;
    const sets = {
      all, installed: all.filter((g) => g.state === 'installed'), favorites: all.filter((g) => g.favorite),
    };
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

    const layoutBtn = (name, label) =>
      h('button', { type: 'button', class: state.layout === name ? 'on' : '', 'aria-label': label, onclick: () => { state.layout = name; render(); } }, icon(name));

    return h('div', {},
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', { text: 'Your library' }), h('p', { class: 'sub', text: 'All your worlds. One place to come back to.' })),
        button('Add a game', 'ghost', addGame, 'plus')),
      h('div', { class: 'tabs', role: 'tablist' },
        [['all', 'All games'], ['installed', 'Installed'], ['favorites', 'Favorites']].map(([key, label]) =>
          h('button', { class: `tab${state.tab === key ? ' on' : ''}`, type: 'button', role: 'tab', onclick: () => { state.tab = key; render(); } }, label, h('small', { text: sets[key].length })))),
      h('div', { class: 'toolbar' },
        h('label', { class: 'field grow' }, icon('search'), search),
        h('label', { class: 'field' }, h('span', { class: 'card-sub', text: 'Sort by' }), sort),
        h('div', { class: 'seg' }, layoutBtn('grid', 'Grid view'), layoutBtn('list', 'List view'))),
      all.length ? grid : emptyState(),
      h('p', { class: 'card-sub' }, count));
  }

  function pageGame(id) {
    const g = state.games.find((x) => x.id === id);
    if (!g) return h('div', {}, h('p', { class: 'sub', text: 'This game is no longer in your library.' }), button('Back to library', 'ghost', () => go('library')));

    const lead = h('p', { class: 'about-lead' });
    const facts = h('div', { class: 'facts', hidden: true });
    const tags = h('div', { class: 'tags' });
    const bannerDesc = h('p', { class: 'hero-desc' });
    loadMeta(g, (m) => {
      lead.textContent = m?.description || 'No description is available for this game yet.';
      bannerDesc.textContent = m?.description || '';
      tags.replaceChildren(...(m?.genres || []).map((t) => h('span', { class: 'tag', text: t })));
      const rows = [['Developer', m?.developers?.join(', ')], ['Publisher', m?.publishers?.join(', ')], ['Released', m?.releaseDate]].filter(([, v]) => v);
      facts.hidden = !rows.length;
      facts.replaceChildren(...rows.map(([k, v]) => h('div', {}, h('span', { class: 'k', text: k }), h('span', { class: 'v', text: v }))));
    });

    const label = g.state === 'installed' ? 'Ready to play' : g.state === 'updating' ? updateText(g) : g.state === 'installing' ? `Installing ${pct(g)}%` : 'File missing';
    const busy = g.state === 'installing' || g.state === 'missing';
    const stat = (k, v) => h('div', { class: 'stat' }, h('div', { class: 'k', text: k }), h('div', { class: 'v', text: v }));
    const disk = state.disk;

    return h('div', {},
      h('button', { class: 'link-btn back-link', type: 'button', onclick: () => goBack('library') }, icon('back'), 'Back to library'),
      h('section', { class: 'hero game' },
        artBox(g, ['hero', 'header']), h('div', { class: 'hero-shade' }),
        h('div', { class: 'hero-body' },
          h('div', { class: `eyebrow${g.state === 'installed' ? ' ready' : ''}` }, h('i'), label),
          h('h2', { text: g.title }),
          h('div', { class: 'build', text: [STORES[g.store], g.version && (g.store === 'steam' ? `build ${g.version}` : `v${g.version}`)].filter(Boolean).join(' · ') }),
          bannerDesc, tags)),
      h('div', { class: 'action-row' },
        h('button', { class: 'btn light big', type: 'button', disabled: busy, onclick: () => play(g) }, icon('play'), busy ? label : 'Play'),
        stat('Total played', hours(g.playSeconds) || (g.store === 'steam' ? 'Not tracked for Steam' : 'Not yet')),
        stat('Last played', g.lastPlayed ? ago(g.lastPlayed) : 'Never'),
        stat('Game status', label),
        h('button', { class: `star${g.favorite ? ' on' : ''}`, style: 'position:static;margin-left:auto', type: 'button', 'aria-label': 'Toggle favorite', onclick: () => toggleFav(g) }, icon('star'))),
      h('div', { class: 'cols' },
        h('section', {}, h('h3', { text: 'About the game' }), h('div', { style: 'height:12px' }), lead, facts),
        h('aside', { class: 'panel' },
          h('h3', {}, 'Storage', icon('disk')),
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Installed size' }), h('span', { class: 'big-num', text: g.sizeBytes ? gb(g.sizeBytes) : 'Unknown' })),
          h('div', { class: 'kv' }, h('span', { class: 'k', text: 'Location' }), h('span', { class: 'v', text: g.installPath || g.launch.target || 'Managed by ' + STORES[g.store] })),
          disk ? h('div', { class: 'kv' }, h('span', { class: 'k', text: `Local disk (${disk.label})` }), h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((1 - disk.free / disk.total) * 100)}%` })), h('span', { class: 'card-sub', text: `${gb(disk.free)} free of ${gb(disk.total)}` })) : null,
          h('div', { class: 'btn-stack' },
            button('Show in folder', 'ghost small', async () => { const r = await api.revealGame(g.id); if (!r.ok) toast(r.error); }, 'folder'),
            g.store === 'manual' ? button('Remove from library', 'ghost small', async () => { await api.removeGame(g.id); await refresh(true); goBack('library'); }) : null))));
  }

  function thumb(g) {
    const a = artBox(g, ['header']);
    a.style.cssText = 'width:120px;height:56px;border-radius:8px;flex:none';
    return a;
  }

  function pageDownloads() {
    const active = activeDownloads();
    const u = state.update;
    const root = h('div', {}, h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Downloads' }), h('p', { class: 'sub', text: 'A little patience. A whole new world.' }))));

    if (['available', 'downloading', 'downloaded'].includes(u.state)) {
      root.append(h('div', { class: 'strip' }, icon('download'),
        h('div', { class: 'grow' }, h('div', { text: `Crescent ${u.version}` }), h('div', { class: 'card-sub', text: u.state === 'downloaded' ? 'Ready to install' : `Launcher update · ${u.percent || 0}%` }), h('div', { class: 'bar', style: 'margin-top:8px' }, h('i', { style: `width:${u.percent || 0}%` }))),
        u.state === 'downloaded' ? button('Restart to update', 'light small', () => api.installUpdate()) : null));
    }
    if (active.length) {
      root.append(...active.map((g) => h('div', { class: 'strip' },
        thumb(g),
        h('div', { class: 'grow' },
          h('div', { text: g.title }),
          h('div', { class: 'card-sub', text: `${g.state === 'installing' ? 'Installing' : 'Update'} · ${gb(g.downloadDone || 0)} of ${gb(g.downloadTotal || 0)}` }),
          h('div', { class: 'bar', style: 'margin-top:8px' }, h('i', { style: `width:${pct(g)}%` }))),
        h('b', { text: `${pct(g)}%` }))));
    } else if (!['available', 'downloading', 'downloaded'].includes(u.state)) {
      root.append(h('section', { class: 'empty', style: 'padding-top:10px' }, h('h2', { text: 'Nothing downloading' }), h('p', { text: 'Installs and updates started in Steam show up here while they run.' })));
    }
    if (state.disk) {
      const d = state.disk;
      root.append(h('div', { class: 'strip' }, icon('disk'), h('div', { class: 'grow' }, h('div', { text: `Local disk (${d.label})` }), h('div', { class: 'card-sub', text: `${gb(d.free)} free of ${gb(d.total)}` })), h('div', { style: 'width:240px' }, h('div', { class: 'bar' }, h('i', { style: `width:${Math.round((1 - d.free / d.total) * 100)}%` })))));
    }
    state.pollTimer = setInterval(() => refresh(true), 4000);
    return root;
  }

  function pageAccount() {
    const total = state.games.reduce((n, g) => n + g.playSeconds, 0);
    const input = h('input', { class: 'input', id: 'name', value: state.profile.name, maxlength: '40' });
    const save = async () => {
      state.profile = await api.setProfileName(input.value);
      toast('Name saved.');
      chrome();
    };
    input.addEventListener('keydown', (e) => e.key === 'Enter' && save());

    return h('div', {},
      h('div', { class: 'page-head' }, h('div', {}, h('h1', { text: 'Your account' }), h('p', { class: 'sub', text: 'Your identity, inside and outside the game.' }))),
      h('section', { class: 'profile' },
        h('span', { class: 'avatar', text: state.profile.name[0]?.toUpperCase() || '?' }),
        h('div', {}, h('h2', { text: state.profile.name }), h('p', { class: 'sub', text: 'Local profile, stored on this PC' }))),
      h('div', { class: 'cols', style: 'grid-template-columns:1.2fr 1fr' },
        h('section', { class: 'panel' }, h('h3', { text: 'Account details' }),
          h('label', { class: 'label', for: 'name', text: 'Display name' }), input,
          h('div', { class: 'btn-stack', style: 'margin-top:14px' }, button('Save name', 'light small', save), button('Open data folder', 'ghost small', () => api.openDataFolder(), 'folder'))),
        h('div', {},
          h('section', { class: 'panel', style: 'margin-bottom:16px' }, h('h3', { text: 'Your Crescent journey' }),
            h('div', { class: 'stats3' },
              h('div', {}, h('span', { class: 'big-num', text: state.games.length }), h('small', { text: 'Games' })),
              h('div', {}, h('span', { class: 'big-num', text: state.games.filter((g) => g.state === 'installed').length }), h('small', { text: 'Installed' })),
              h('div', {}, h('span', { class: 'big-num', text: total ? (total / 3600).toFixed(0) : '0' }), h('small', { text: 'Hours tracked' })))),
          h('section', { class: 'panel' }, h('h3', {}, 'Game stores found', button('Rescan', 'ghost small', rescan, 'refresh')),
            ['steam', 'epic', 'gog'].map((k) => {
              const s = state.stores[k] || {};
              return h('div', { class: 'row' }, h('span', { class: 'grow', text: STORES[k] }), h('span', { class: s.found ? 'ok' : 'no', text: s.found ? `${s.count} games` : 'Not found' }));
            })))));
  }

  /* ---------------- router and chrome ---------------- */

  const page = $('#page');
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
    const route = (state.route = state.stack[state.pos]);
    const i = route.indexOf(':');
    const name = i < 0 ? route : route.slice(0, i);
    const arg = i < 0 ? null : route.slice(i + 1);
    const top = page.scrollTop;
    page.pageSearch = null;

    const view = { home: pageHome, library: pageLibrary, downloads: pageDownloads, account: pageAccount, game: () => pageGame(arg) }[name]();
    page.replaceChildren(view);
    page.scrollTop = resetScroll ? 0 : top;
    chrome();
  }

  function chrome() {
    const route = state.route;
    const game = route.startsWith('game:') ? state.games.find((g) => g.id === route.slice(5)) : null;
    $('#crumb').textContent = route === 'home' ? 'Your launcher. Your universe.'
      : route === 'library' ? 'Library / All games'
      : route === 'downloads' ? 'Downloads / Overview'
      : route === 'account' ? 'Account / Profile'
      : `Library / ${game ? game.title : 'Game'}`;
    document.querySelectorAll('.side-item[data-route], .account-card').forEach((el) => {
      const on = el.dataset.route === route || (route.startsWith('game:') && el.dataset.route === 'library');
      el.classList.toggle('active', on && el.classList.contains('side-item'));
    });
    $('#tb-back').disabled = state.pos === 0;
    $('#tb-fwd').disabled = state.pos >= state.stack.length - 1;

    const active = activeDownloads();
    const count = $('#dl-count');
    count.hidden = !active.length;
    count.textContent = active.length;

    $('#quick').replaceChildren(...byRecent(state.games.filter((g) => g.state === 'installed')).slice(0, 3).map((g) =>
      h('button', { class: 'quick-item', type: 'button', onclick: () => go(`game:${g.id}`) }, h('span', { class: 'avatar', text: g.title[0].toUpperCase() }), h('span', { text: g.title }))));

    $('#acc-name').textContent = state.profile.name;
    $('#acc-avatar').textContent = state.profile.name[0]?.toUpperCase() || '?';
    $('#sb-left').textContent = `${state.games.length} games found on this PC`;
    $('#sb-mid').textContent = active.length ? `${active[0].title} · ${gb(active[0].downloadDone || 0)} / ${gb(active[0].downloadTotal || 0)}` : '';
    $('#sb-right').textContent = `CRESCENT ${state.version}`;
  }

  function renderUpdate(status) {
    state.update = status || { state: 'idle' };
    const s = state.update;
    const show = ['available', 'downloading', 'downloaded'].includes(s.state);
    $('#update-banner').hidden = !show;
    $('#bell').classList.toggle('bell-dot', show);
    $('#update-restart').hidden = s.state !== 'downloaded';
    $('#update-text').textContent = !show ? ''
      : s.state === 'downloaded' ? `Launcher ${s.version} is ready to install.`
      : s.state === 'downloading' ? `Launcher update ${s.version} is downloading (${s.percent}%).`
      : `Launcher update ${s.version} is available.`;
    if (state.route === 'downloads') render(false);
  }

  async function refresh(force) {
    const res = await api.listGames(!!force);
    const snapshot = JSON.stringify([res.games, res.profile, res.stores]);
    state.disk = res.disk;
    if (snapshot === state.snapshot) return;
    // Don't redraw under the user's cursor while they're typing in the page.
    if (document.activeElement && page.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    Object.assign(state, { games: res.games, stores: res.stores, profile: res.profile, snapshot });
    render(false);
  }

  /* ---------------- start up ---------------- */

  document.body.classList.toggle('mac', api.platform === 'darwin');
  document.querySelectorAll('[data-icon]').forEach((el) => el.prepend(icon(el.dataset.icon)));
  document.querySelectorAll('[data-route]').forEach((el) => el.addEventListener('click', () => go(el.dataset.route)));
  $('#tb-back').addEventListener('click', () => { if (state.pos > 0) { state.pos--; render(true); } });
  $('#tb-fwd').addEventListener('click', () => { if (state.pos < state.stack.length - 1) { state.pos++; render(true); } });
  $('#bell').addEventListener('click', () => go('downloads'));
  $('#win-min').addEventListener('click', () => api.window.minimize());
  $('#win-max').addEventListener('click', () => api.window.maximize());
  $('#win-close').addEventListener('click', () => api.window.close());
  $('#update-restart').addEventListener('click', () => api.installUpdate());
  $('#search').addEventListener('input', (e) => setQuery(e.target.value));
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#search').focus(); }
    else if (e.key === 'Escape' && state.route.startsWith('game:')) goBack('library');
  });
  window.addEventListener('focus', () => refresh(true).catch(console.error));

  (async function init() {
    state.version = await api.getAppVersion();
    api.onUpdateStatus(renderUpdate);
    renderUpdate(await api.getUpdateStatus());
    await refresh(true);
    render(true);
  })().catch((err) => toast(`Couldn't load your library. ${err.message}`));
})();
