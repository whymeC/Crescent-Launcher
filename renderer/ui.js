// Small interface building blocks shared by the whole launcher: icons, pop-ups, the upload window,
// modals and the moon phase loader.
window.UI = (() => {
  'use strict';

  const ICONS = {
    home: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    library: '<path d="M4 4v16M9 4v16M14 5l5 14"/>',
    download: '<path d="M12 4v11m0 0l-4-4m4 4l4-4M5 20h14"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>',
    bell: '<path d="M6 16v-5a6 6 0 0 1 12 0v5l2 2H4zM10 21h4"/>',
    back: '<path d="M15 5l-7 7 7 7"/>', fwd: '<path d="M9 5l7 7-7 7"/>',
    min: '<path d="M5 12h14"/>', max: '<rect x="6" y="6" width="12" height="12"/>', close: '<path d="M6 6l12 12M18 6L6 18"/>',
    play: '<path d="M8 5l11 7-11 7z"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="1"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    check: '<path d="M5 12l5 5 9-10"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>',
    list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    disk: '<rect x="3" y="7" width="18" height="10" rx="2"/><path d="M7 14h.01M17 12h-5"/>',
    folder: '<path d="M3 6h6l2 2h10v11H3z"/>', refresh: '<path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7"/>',
    upload: '<path d="M12 19V6m0 0l-5 5m5-5l5 5"/>',
    cloudCheck: '<path d="M7.5 18.5a4.5 4.5 0 0 1-.9-8.9 6 6 0 0 1 11.5 1.4 3.9 3.9 0 0 1-.6 7.5z"/><path d="M9.3 13.6l2 2 3.6-3.8"/>',
    eyedropper: '<path d="M14.5 5.5l4 4M4 20l.8-3.6L15.2 6a2 2 0 0 1 2.8 0l0 0a2 2 0 0 1 0 2.8L7.6 19.2z"/>',
    uploadBox: '<path d="M12 15V4m0 0L8 8m4-4l4 4"/><path d="M4 14v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>',
    // Hide Friends List: a window with a side panel and an arrow pointing into it
    panel: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M15 5v14M6.5 12h5M9.5 9.5l2.5 2.5-2.5 2.5"/>',
    // outlined block arrow, pointing left
    arrow: '<path d="M3 12l7.5-7.5v4.5H21v6H10.5v4.5z"/>',
    trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a2 2 0 0 0 2 4M16 6h3a2 2 0 0 1-2 4M12 13v4M9 20h6"/>',
    tag: '<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    pause: '<rect x="7" y="5" width="3.6" height="14" rx="1"/><rect x="13.4" y="5" width="3.6" height="14" rx="1"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.5-2.5H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5z"/>',
  };

  const FILL_ICONS = {
    hideFriends:
      '<path d="M20,24H4c-2.2,0-4-1.8-4-4V4c0-2.2,1.8-4,4-4h16c2.2,0,4,1.8,4,4v16C24,22.2,22.2,24,20,24z M4,2C2.9,2,2,2.9,2,4v16c0,1.1,0.9,2,2,2h16c1.1,0,2-0.9,2-2V4c0-1.1-0.9-2-2-2H4z"/>' +
      '<path d="M8,24c-0.6,0-1-0.4-1-1V1c0-0.6,0.4-1,1-1s1,0.4,1,1v22C9,23.6,8.6,24,8,24z"/>' +
      '<path d="M14,13c-0.3,0-0.5-0.1-0.7-0.3c-0.4-0.4-0.4-1,0-1.4l3-3c0.4-0.4,1-0.4,1.4,0s0.4,1,0,1.4l-3,3C14.5,12.9,14.3,13,14,13z"/>' +
      '<path d="M17,16c-0.3,0-0.5-0.1-0.7-0.3l-3-3c-0.4-0.4-0.4-1,0-1.4s1-0.4,1.4,0l3,3c0.4,0.4,0.4,1,0,1.4C17.5,15.9,17.3,16,17,16z"/>',
    showFriends:
      '<path fill-rule="evenodd" d="M11.28 9.53L8.81 12l2.47 2.47a.75.75 0 11-1.06 1.06l-3-3a.75.75 0 010-1.06l3-3a.75.75 0 111.06 1.06z"/>' +
      '<path fill-rule="evenodd" d="M3.75 2A1.75 1.75 0 002 3.75v16.5c0 .966.784 1.75 1.75 1.75h16.5A1.75 1.75 0 0022 20.25V3.75A1.75 1.75 0 0020.25 2H3.75zM3.5 3.75a.25.25 0 01.25-.25H15v17H3.75a.25.25 0 01-.25-.25V3.75zm13 16.75v-17h3.75a.25.25 0 01.25.25v16.5a.25.25 0 01-.25.25H16.5z"/>',
  };

  function icon(name) {
    const el = document.createElement('span');
    el.className = 'ico';
    if (FILL_ICONS[name]) {
      el.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">${FILL_ICONS[name]}</svg>`;
      return el;
    }
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
    for (const child of children.flat(Infinity)) if (child != null && child !== false) el.append(child);
    return el;
  }

  /* ---------------- pop-ups (progress, success, error, info) ---------------- */

  const POPUP_ICON = { progress: 'upload', success: 'check', error: 'close', info: 'bell' };

  function popup(initial) {
    const root = document.getElementById('popups');
    const el = h('div', { class: 'popup', role: 'status' });
    let model = { kind: 'info', title: '', text: '', progress: 0, actions: [], ...initial };
    let timer = null;
    const AUTO_CLOSE_MS = 5000;
    const arm = (ms) => { clearTimeout(timer); if (model.kind !== 'progress') timer = setTimeout(close, ms); };

    function close() {
      clearTimeout(timer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 220);
    }

    function draw() {
      el.className = `popup ${model.kind}`;
      const body = h('div', { class: 'p-body' }, h('h4', { text: model.title }), model.text ? h('p', { text: model.text }) : null);
      const actions = (model.actions || []).map((a) => h('button', { class: 'p-btn', type: 'button', onclick: () => a.onclick?.(controller), text: a.label }));
      if (model.kind === 'progress') {
        const pct = Math.round(model.progress || 0);
        body.append(h('div', { class: 'p-row' },
          h('div', { class: 'p-bar' }, h('i', { style: `width:${pct}%` })),
          h('span', { class: 'p-pct', text: `${pct}%` }),
          ...actions));
      } else if (actions.length) {
        body.append(h('div', { class: 'p-actions' }, ...actions));
      }
      el.replaceChildren(
        h('button', { class: 'p-x', type: 'button', 'aria-label': 'Close', onclick: close }, icon('close')),
        h('div', { class: 'p-ico' }, icon(POPUP_ICON[model.kind] || 'bell')),
        body);
      arm(AUTO_CLOSE_MS);
    }

    const controller = {
      update(patch) { model = { ...model, ...patch }; draw(); },
      set(kind, patch) { model = { ...model, kind, progress: 0, actions: [], ...patch }; draw(); },
      close,
    };
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', () => arm(2000));
    draw();
    root.append(el);
    return controller;
  }

  /* ---------------- modals ---------------- */

  function modal(build, { cls = '', onClose } = {}) {
    const root = document.getElementById('modal-root');
    const back = h('div', { class: 'modal-back' });
    const close = () => {
      document.removeEventListener('keydown', onKey);
      back.classList.add('out');
      setTimeout(() => back.remove(), 180);
      onClose?.();
    };
    const onKey = (e) => e.key === 'Escape' && close();
    back.append(h('div', { class: `modal ${cls}`, role: 'dialog', 'aria-modal': 'true' }, build(close)));
    back.addEventListener('mousedown', (e) => e.target === back && close());
    document.addEventListener('keydown', onKey);
    root.append(back);
    return close;
  }

  // The upload window: a header, then a dashed drop area with a Browse File button.
  // Resolves with the chosen File, or null when it is closed.
  function uploadModal({ noun = 'your file.', accept = '', hint = '' } = {}) {
    return new Promise((resolve) => {
      let picked = false;
      const finish = (file) => { picked = true; resolve(file); };
      const close = modal((closeModal) => {
        const input = h('input', { type: 'file', accept, hidden: true });
        const browse = h('button', { class: 'u-browse', type: 'button', onclick: () => input.click() }, 'Browse File');
        const zone = h('div', { class: 'drop', tabindex: '0', 'aria-label': `Upload ${noun}` },
          icon('cloudCheck'),
          h('b', { text: 'Choose a file or drag & drop it here' }),
          hint ? h('small', { text: hint }) : null,
          browse);
        input.addEventListener('change', () => { if (input.files[0]) { finish(input.files[0]); closeModal(); } });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('over'));
        zone.addEventListener('drop', (e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) { finish(file); closeModal(); }
        });
        zone.addEventListener('keydown', (e) => e.target === zone && e.key === 'Enter' && input.click());
        return [
          h('button', { class: 'u-x', type: 'button', 'aria-label': 'Close', onclick: closeModal }, icon('close')),
          h('div', { class: 'u-head' },
            h('span', { class: 'u-badge' }, icon('cloudCheck')),
            h('div', {}, h('h3', { text: 'Upload files' }), h('p', { class: 'u-sub', text: 'Select and upload the files of your choice' }))),
          zone, input,
        ];
      }, { cls: 'upload', onClose: () => !picked && resolve(null) });
      return close;
    });
  }

  /* ---- colour picker in the launcher's own style (replaces the grey system colour window) ---- */
  const HEX = /^#[0-9a-f]{6}$/i;
  function hexToRgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function rgbToHex(r, g, b) { return `#${[r, g, b].map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`; }
  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let hue = 0;
    if (d) hue = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hue * 60, max ? d / max : 0, max];
  }
  function hsvToRgb(hue, sat, val) {
    const f = (n) => { const k = (n + hue / 60) % 6; return val - val * sat * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5) * 255, f(3) * 255, f(1) * 255];
  }

  // value: '#rrggbb'. onPreview(hex) runs while dragging, onCommit(hex) when the window closes with a new colour.
  function colorPicker({ value = '#ffffff', label = 'Colour', onPreview, onCommit } = {}) {
    let [hue, sat, val] = rgbToHsv(...hexToRgb(HEX.test(value) ? value : '#ffffff'));
    let startHex = rgbToHex(...hsvToRgb(hue, sat, val));
    const current = () => rgbToHex(...hsvToRgb(hue, sat, val));

    const root = h('div', { class: 'cp' });
    const trigger = h('button', { class: 'cp-swatch', type: 'button', 'aria-label': label, 'aria-haspopup': 'dialog', 'aria-expanded': 'false' });
    const pop = h('div', { class: 'cp-pop', role: 'dialog', 'aria-label': label });
    const sv = h('div', { class: 'cp-sv' }, h('i', { class: 'cp-thumb' }));
    const hueBar = h('div', { class: 'cp-hue' }, h('i', { class: 'cp-thumb' }));
    const dot = h('span', { class: 'cp-dot' });
    const field = (aria) => h('input', { class: 'cp-in', type: 'text', inputmode: 'numeric', maxlength: '3', 'aria-label': aria });
    const hexIn = h('input', { class: 'cp-in cp-hex', type: 'text', maxlength: '7', spellcheck: 'false', 'aria-label': `${label} hex code` });
    const [rIn, gIn, bIn] = [field('Red'), field('Green'), field('Blue')];
    const done = h('button', { class: 'btn light small', type: 'button', onclick: () => close() }, 'Use this colour');

    const top = h('div', { class: 'cp-top' });
    if (window.EyeDropper) {
      top.append(h('button', { class: 'cp-eye', type: 'button', 'aria-label': 'Pick a colour from the screen', onclick: async () => {
        try { const r = await new window.EyeDropper().open(); if (HEX.test(r.sRGBHex)) { [hue, sat, val] = rgbToHsv(...hexToRgb(r.sRGBHex)); sync(true); } } catch { /* cancelled */ }
      } }, icon('eyedropper')));
    }
    top.append(dot, hueBar);
    pop.append(sv, top,
      h('div', { class: 'cp-fields' }, hexIn, rIn, gIn, bIn),
      h('div', { class: 'cp-labels' }, h('span', { text: 'HEX' }), h('span', { text: 'R' }), h('span', { text: 'G' }), h('span', { text: 'B' })),
      done);
    root.append(trigger, pop);

    // fills in every part of the window from hue / sat / val; skip = the box the user is typing in
    function sync(notify, skip) {
      const hex = current();
      const [r, g, b] = hexToRgb(hex);
      trigger.style.background = hex;
      dot.style.background = hex;
      sv.style.backgroundColor = rgbToHex(...hsvToRgb(hue, 1, 1));
      sv.firstChild.style.left = `${sat * 100}%`;
      sv.firstChild.style.top = `${(1 - val) * 100}%`;
      hueBar.firstChild.style.left = `${(hue / 360) * 100}%`;
      if (skip !== hexIn) hexIn.value = hex;
      if (skip !== rIn) rIn.value = String(r);
      if (skip !== gIn) gIn.value = String(g);
      if (skip !== bIn) bIn.value = String(b);
      if (notify) onPreview?.(hex);
    }

    const drag = (el, move) => {
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        el.setPointerCapture(e.pointerId);
        const at = (ev) => { const r = el.getBoundingClientRect(); move(Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height))); sync(true); };
        at(e);
        const onMove = (ev) => at(ev);
        const onUp = () => { el.removeEventListener('pointermove', onMove); el.removeEventListener('pointerup', onUp); el.removeEventListener('pointercancel', onUp); };
        el.addEventListener('pointermove', onMove); el.addEventListener('pointerup', onUp); el.addEventListener('pointercancel', onUp);
      });
    };
    drag(sv, (x, y) => { sat = x; val = 1 - y; });
    drag(hueBar, (x) => { hue = x * 360; });

    hexIn.addEventListener('input', () => {
      const t = hexIn.value.trim().startsWith('#') ? hexIn.value.trim() : `#${hexIn.value.trim()}`;
      if (HEX.test(t)) { [hue, sat, val] = rgbToHsv(...hexToRgb(t)); sync(true, hexIn); }
    });
    const rgbInput = () => {
      const n = [rIn, gIn, bIn].map((i) => Number(i.value));
      if (n.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)) { [hue, sat, val] = rgbToHsv(...n); sync(true, document.activeElement); }
    };
    [rIn, gIn, bIn].forEach((i) => i.addEventListener('input', rgbInput));
    [hexIn, rIn, gIn, bIn].forEach((i) => i.addEventListener('blur', () => sync(false)));

    const onOutside = (e) => { if (!root.contains(e.target)) close(); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(true); } };
    function open() {
      startHex = current();
      root.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      // open downwards, or upwards / to the left when there is more room there
      const r = trigger.getBoundingClientRect();
      root.classList.toggle('up', window.innerHeight - r.bottom < 330 && r.top > window.innerHeight - r.bottom);
      root.classList.toggle('left', window.innerWidth - r.left < 280);
      document.addEventListener('mousedown', onOutside, true);
      document.addEventListener('keydown', onKey, true);
    }
    function close(cancel = false) {
      if (!root.classList.contains('open')) return;
      root.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      if (cancel) { [hue, sat, val] = rgbToHsv(...hexToRgb(startHex)); sync(true); return; }
      if (current() !== startHex) onCommit?.(current());
    }
    trigger.addEventListener('click', () => (root.classList.contains('open') ? close() : open()));
    sync(false);
    return root;
  }

  /* ---------------- drop-down menu that matches the launcher ---------------- */

  let ddReady = false;

  function dropdown({ value, options, onChange, label, align = 'left' }) {
    if (!ddReady) {
      ddReady = true;
      document.addEventListener('mousedown', (e) => document.querySelectorAll('.dd.open').forEach((d) => { if (!d.contains(e.target)) d.classList.remove('open'); }));
    }
    const root = h('div', { class: `dd ${align}` });
    const val = h('span', { class: 'dd-val' });
    const btn = h('button', { class: 'dd-btn', type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'aria-label': label || 'Choose' }, val, icon('chev'));
    const menu = h('div', { class: 'dd-menu', role: 'listbox' });
    const isOpen = () => root.classList.contains('open');
    const setOpen = (open) => {
      root.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
      if (!open) return;
      // use the room that is there: open downwards, or upwards when that is roomier, and scroll when the list is long
      const r = btn.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 28;
      const above = r.top - 28;
      const up = below < 220 && above > below;
      root.classList.toggle('up', up);
      menu.style.maxHeight = `${Math.max(120, Math.min(320, up ? above : below))}px`;
      (menu.querySelector('.dd-opt.on') || menu.querySelector('.dd-opt'))?.focus();
    };
    function draw() {
      val.textContent = (options.find((o) => o[0] === value) || [])[1] ?? '';
      menu.replaceChildren(...options.map(([v, l]) => h('button', {
        class: `dd-opt${v === value ? ' on' : ''}`, type: 'button', role: 'option', 'aria-selected': String(v === value),
        onclick: () => { value = v; setOpen(false); draw(); btn.focus(); onChange(v); },
      }, h('span', { text: l }), v === value ? icon('check') : null)));
    }
    btn.addEventListener('click', () => setOpen(!isOpen()));
    root.addEventListener('keydown', (e) => {
      const opts = [...menu.querySelectorAll('.dd-opt')];
      const i = opts.indexOf(document.activeElement);
      if (e.key === 'Escape' && isOpen()) { e.stopPropagation(); setOpen(false); btn.focus(); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); if (!isOpen()) setOpen(true); else opts[Math.min(opts.length - 1, i + 1)]?.focus(); }
      else if (e.key === 'ArrowUp' && isOpen()) { e.preventDefault(); opts[Math.max(0, i - 1)]?.focus(); }
    });
    root.append(btn, menu);
    draw();
    return root;
  }

  /* ---------------- moon phase loader ---------------- */

  // Lit shape of each phase: waxing (right lit) then waning (left lit).
  function moonSvg(i) {
    const r = 10;
    const rx = [0, 7, 0, 7, 10, 7, 0, 7][i];
    let lit = '';
    if (i === 4) lit = '<circle cx="12" cy="12" r="10"/>';
    else if (i !== 0) {
      const waxing = i < 4;
      const outer = waxing ? 1 : 0;
      const bulgesRight = i === 1 || i === 5;
      const inner = waxing ? (i === 1 ? 0 : 1) : (i === 5 ? 0 : 1);
      lit = `<path d="M12 ${12 - r}A${r} ${r} 0 0 ${outer} 12 ${12 + r}A${rx} ${r} 0 0 ${inner} 12 ${12 - r}Z"/>`;
      void bulgesRight;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" class="moon-dark"/><g class="moon-lit">${lit}</g></svg>`;
  }

  function moons() {
    const row = h('div', { class: 'moons', 'aria-hidden': 'true' });
    for (let i = 0; i < 8; i++) {
      const m = h('span', { class: 'moon' });
      m.innerHTML = moonSvg(i);
      m.style.animationDelay = `${i * 0.16}s`;
      row.append(m);
    }
    return row;
  }

  return { icon, h, popup, modal, uploadModal, moons, dropdown, colorPicker };
})();
