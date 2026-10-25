// Keys in Settings: paste a key, save it, and see its connection switch from demo to live.
// Left: the stored keys, masked (the admin sees the last 4 of a secret, a client only whether it is set).
// Right: the add-or-replace form; "Save and test" saves the key, rebuilds the agent and signs in to the service.
import { screen, chip, message, records } from './common.js';

const STATUS_TONE = { Valid: 'ok', Set: '', Missing: 'warn', Failed: 'bad' };

function form(api) {
  const { h, d, ui } = api;
  const keys = d.keys || [];
  if (!keys.length) return null;
  const cur = keys.find((k) => k.key === ui.key) || keys.find((k) => !k.set) || keys[0];
  ui.key = cur.key;
  const value = h('input', { type: cur.secret ? 'password' : 'text', name: 'value', autocomplete: 'off', spellcheck: 'false', placeholder: cur.set ? 'Paste a new value to replace it' : 'Paste here', 'aria-label': cur.label });
  const select = h('select', { name: 'key', 'aria-label': 'Key', onchange: (e) => { ui.key = e.target.value; api.repaint(); } },
    keys.map((k) => h('option', { value: k.key, selected: k.key === cur.key, text: k.label + ' · ' + k.usedBy + (k.set ? '' : ' (missing)') })));
  return h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('save-key', { key: ui.key, value: value.value }); } },
    h('label', { text: 'Key' }), select,
    h('label', { text: cur.set ? 'Replace ' + cur.label.toLowerCase() : cur.label }), value,
    h('div', { class: 'cg-actions' },
      h('button', { class: 'btn primary', type: 'submit', disabled: !!ui.busy, text: ui.busy === 'save-key' ? 'Saving and testing…' : 'Save and test' }),
      cur.set && cur.source === 'Settings' ? h('button', { class: 'btn', type: 'button', disabled: !!ui.busy, text: ui.busy === 'clear-key' ? 'Clearing…' : 'Clear', onclick: () => api.act('clear-key', { key: ui.key }) }) : null));
}

const pane = screen((api) => {
  const { d, ui, h } = api;
  const keys = d.keys || [];
  const list = h('section', { class: 'cg-card cg-main', 'aria-label': 'Stored keys' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Stored keys' }), chip(h, d.summary.set + ' of ' + d.summary.total + ' set', d.summary.set === d.summary.total ? 'ok' : 'warn')),
    d.summary.set ? null : h('p', { class: 'cg-note', text: 'No keys saved. Demo data is showing.' }),
    records(h, d.columns, d.rows, {
      empty: 'No keys saved. Demo data is showing.',
      cell: (v, j) => (j === 2 ? h('span', { class: 'cg-mono', text: v }) : j === 4 ? chip(h, v, STATUS_TONE[v] || '') : String(v))
    }),
    d.canEdit ? h('p', { class: 'cg-note', text: 'A key left in the solution’s .env still works; one saved here wins. Every change is in Activity.' }) : null);

  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card' },
      h('h3', { text: 'Add or replace a key' }),
      d.canEdit ? form(api) : h('p', { class: 'cg-note', text: 'Only the admin can change keys. Values stay hidden here.' }),
      message(h, ui)),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Needed next' }),
      keys.some((k) => !k.set)
        ? h('ul', { class: 'cg-plain' }, keys.filter((k) => !k.set).map((k) => h('li', { class: 'cg-rule' }, h('b', { text: k.label }), h('span', { class: 'cg-note', text: k.usedBy }))))
        : h('p', { class: 'cg-note', text: 'Every key is set.' })));

  return h('div', { class: 'cg-pane cg-split' }, list, rail);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
