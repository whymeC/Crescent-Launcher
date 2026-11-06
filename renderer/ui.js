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
    uploadBox: '<path d="M12 15V4m0 0L8 8m4-4l4 4"/><path d="M4 14v3a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-3"/>',
    // Hide Friends List: a window with a side panel and an arrow pointing into it
    panel: '<rect x="3" y="5" width="18" height="14" rx="4"/><path d="M15 5v14M6.5 12h5M9.5 9.5l2.5 2.5-2.5 2.5"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    palette: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.6-1.2.2-2.5 1.5-2.5H17a4 4 0 0 0 4-4c0-5-4-9.5-9-9.5z"/>',
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
      clearTimeout(timer);
      if (model.timeout) timer = setTimeout(close, model.timeout);
    }

    const controller = {
      update(patch) { model = { ...model, ...patch }; draw(); },
      set(kind, patch) { model = { ...model, kind, progress: 0, actions: [], ...patch }; draw(); },
      close,
    };
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

  // The "Upload your file." window. Resolves with the chosen File, or null when it is closed.
  function uploadModal({ noun = 'your file.', accept = '', hint = '' } = {}) {
    return new Promise((resolve) => {
      let picked = false;
      const finish = (file) => { picked = true; resolve(file); };
      const close = modal((closeModal) => {
        const input = h('input', { type: 'file', accept, hidden: true });
        const zone = h('div', { class: 'drop', tabindex: '0' },
          icon('uploadBox'),
          h('b', { text: 'Drop here' }),
          h('span', {}, 'or ', h('a', { href: '#', class: 'browse', onclick: (e) => { e.preventDefault(); input.click(); } }, 'browse')),
          hint ? h('small', { text: hint }) : null);
        input.addEventListener('change', () => { if (input.files[0]) { finish(input.files[0]); closeModal(); } });
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('over'));
        zone.addEventListener('drop', (e) => {
          e.preventDefault();
          const file = e.dataTransfer.files[0];
          if (file) { finish(file); closeModal(); }
        });
        zone.addEventListener('keydown', (e) => e.key === 'Enter' && input.click());
        return [
          h('button', { class: 'u-x', type: 'button', 'aria-label': 'Close', onclick: closeModal }, icon('close')),
          h('h3', {}, 'Upload ', h('em', { text: noun })),
          zone, input,
        ];
      }, { cls: 'upload', onClose: () => !picked && resolve(null) });
      return close;
    });
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

  return { icon, h, popup, modal, uploadModal, moons };
})();
