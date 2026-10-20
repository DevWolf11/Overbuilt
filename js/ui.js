'use strict';
// Modal dialogs and toasts shared by both screens.

const UI = {
  modal({ title, kicker, body, actions, onClose }) {
    const wrap = $('#modal'), card = $('#modal-card');
    card.innerHTML = '';
    if (kicker) card.append(el('div', { class: 'modal-kicker', text: kicker }));
    if (title) card.append(el('h2', { class: 'modal-title', text: title }));
    if (body) {
      const b = el('div', { class: 'modal-body' });
      if (typeof body === 'string') b.innerHTML = body; else b.append(body);
      card.append(b);
    }
    const row = el('div', { class: 'modal-actions' });
    for (const a of actions || []) {
      row.append(el('button', {
        class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
        text: a.label,
        onclick: () => { if (a.keepOpen) { a.onClick && a.onClick(); return; } UI.closeModal(); a.onClick && a.onClick(); },
      }));
    }
    card.append(row);
    wrap.hidden = false;
    UI._onClose = onClose;
    const first = row.querySelector('.primary') || row.querySelector('button');
    if (first && !isTouch) first.focus();
  },
  closeModal() {
    $('#modal').hidden = true;
    const f = UI._onClose; UI._onClose = null;
    if (f) f();
  },
  get modalOpen() { return !$('#modal').hidden; },

  toast(text, kind) {
    const host = $('#toasts');
    // collapse duplicates
    for (const t of host.children) if (t.dataset.text === text) { t.remove(); }
    const t = el('div', { class: 'toast' + (kind ? ' ' + kind : ''), text });
    t.dataset.text = text;
    host.append(t);
    while (host.children.length > 4) host.firstChild.remove();
    setTimeout(() => t.classList.add('out'), kind === 'achievement' ? 3800 : 2600);
    setTimeout(() => t.remove(), kind === 'achievement' ? 4300 : 3100);
  },
};

// Inline SVG icons (stroke-based, currentColor)
const ICONS = {
  rotL: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5H4v4"/><path d="M4.6 8.6A8 8 0 1 1 4 13"/></svg>',
  rotR: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h4v4"/><path d="M19.4 8.6A8 8 0 1 0 20 13"/></svg>',
  menu: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><ellipse cx="12" cy="12" rx="10" ry="5.5"/></svg>',
  rocket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2c3 3 4 7 4 11l-4 3-4-3c0-4 1-8 4-11z"/><path d="M8 13l-3 4h4M16 13l3 4h-4M10 19l2 3 2-3"/></svg>',
  ff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6l7 6-7 6zM13 6l7 6-7 6z"/></svg>',
  rw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6l-7 6 7 6zM11 6l-7 6 7 6z"/></svg>',
  sound: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 8a5 5 0 0 1 0 8"/></svg>',
  mute: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/></svg>',
  undo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>',
  redo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>',
  save: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>',
  dup: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="11" height="11" rx="1.5"/><rect x="10" y="10" width="11" height="11" rx="1.5"/><path d="M15.5 13.5v5M13 16h5"/></svg>',
  paste: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6v3H9z"/><path d="M9 5H6v16h12V5h-3"/><path d="M9 12h6M9 16h4"/></svg>',
  select: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="1" stroke-dasharray="3 2.5"/><path d="M10 9l7 3.5-3 1 2 3.5-1.5.8-2-3.5-2.5 2z"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>',
  sasHold: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.5"/></svg>',
  sasPro: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="5"/><path d="M12 7V2M7 12H2M17 12h5"/></svg>',
  sasRetro: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="6"/><path d="M8 8l8 8M16 8l-8 8M12 18v4"/></svg>',
  sasUp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20V5M6 11l6-6 6 6"/></svg>',
  sasDown: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v15M6 13l6 6 6-6"/></svg>',
  sasLevel: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 13h20"/><path d="M7 13a5 5 0 0 1 10 0"/><path d="M12 8V5"/></svg>',
  sasHeading: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 6l2.5 6H9.5z"/><path d="M12 12v6"/></svg>',
  sasOff: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v8"/><path d="M6.3 6.3a8 8 0 1 0 11.4 0"/></svg>',
  sasTarget: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l9 9-9 9-9-9z"/><circle cx="12" cy="12" r="1.5"/></svg>',
  plane: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 14h15l4-4h1l-1 6H4z"/><path d="M8 14l3-5h2l-1 5M10 14l2 4h2l-1-4"/></svg>',
  car: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 16v-4l2-4h8l4 4h4v4"/><circle cx="7" cy="16" r="2"/><circle cx="17" cy="16" r="2"/></svg>',
  heli: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M12 5v3"/><path d="M8 8h6l3 4-3 3H9a3.5 3.5 0 0 1-1-7zM3 11h5M2 9v4M9 19h7M11 15v4M14 15v4"/></svg>',
  sym: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v18" stroke-dasharray="2 2.5"/><path d="M9 7L3 17h6zM15 7l6 10h-6z"/></svg>',
  center: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
};
function icon(name) { const s = el('span', { class: 'icon' }); s.innerHTML = ICONS[name]; return s; }
