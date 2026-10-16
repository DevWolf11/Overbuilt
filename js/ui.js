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
  center: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></svg>',
};
function icon(name) { const s = el('span', { class: 'icon' }); s.innerHTML = ICONS[name]; return s; }
