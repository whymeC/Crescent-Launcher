(() => {
  'use strict';
  const box = document.getElementById('box');
  const rows = [['FPS', 'fps', ''], ['CPU', 'cpu', '%'], ['GPU', 'gpu', '%'], ['RAM', 'ram', '%']];
  window.overlay.onStats((s) => {
    box.replaceChildren();
    for (const [label, key, unit] of rows) {
      const k = document.createElement('span');
      k.className = 'k';
      k.textContent = label;
      const v = document.createElement('span');
      v.className = 'v';
      const val = s[key];
      v.textContent = val == null ? '-' : `${val}${unit}`;
      if (unit === '%' && val >= 90) v.classList.add('hot');
      box.append(k, v);
    }
  });
})();
