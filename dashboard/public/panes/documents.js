// Site documents: a file list of everything filed from the watched site folder, with a rail for the folder itself.
import { screen, chip, demoChip, demoBanner, bigNumber, message, actionButton, chips, line, bytes, ext, TONE } from './common.js';

const FILTERS = [['all', 'All'], ['Filed', 'Filed'], ['Updated', 'Updated'], ['Failed', 'Failed']];

function folderForm(api) {
  const { h, d, ctx } = api;
  if (ctx.me.role !== 'admin') return null;
  const input = h('input', { type: 'text', name: 'path', value: d.folder || '', placeholder: '/Volumes/Projects/Incoming', 'aria-label': 'Folder path', autocomplete: 'off' });
  return h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('set-folder', { path: input.value }); } },
    h('label', { text: 'Watched folder' }), input,
    h('button', { class: 'btn', type: 'submit', disabled: !!api.ui.busy, text: api.ui.busy === 'set-folder' ? 'Saving…' : 'Save folder' }));
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const rows = d.arrivals || [];
  const filter = ui.filter || 'all';
  const shown = rows.filter((a) => filter === 'all' || a.event === filter);
  const count = (k) => (k === 'all' ? rows.length : rows.filter((a) => a.event === k).length);

  const list = !rows.length
    ? h('div', { class: 'cg-empty-in' }, h('p', { text: 'Nothing has arrived yet. New drawings and documents appear here the moment they land in the folder.' }), actionButton(api, 'Scan site folders', 'scan', null, { busy: 'Scanning…' }))
    : h('ul', { class: 'cg-files' }, shown.map((a) => h('li', { class: 'cg-file ' + (a.status === 'failed' ? 'is-bad' : '') },
      h('span', { class: 'cg-ext', 'aria-hidden': 'true', text: ext(a.file) }),
      h('div', { class: 'cg-file-main' },
        h('b', { text: a.file }),
        h('small', { text: [a.folder, bytes(a.size), a.error].filter(Boolean).join(' · ') })),
      h('div', { class: 'cg-file-end' }, chip(h, a.event, TONE[a.event] || ''), h('small', { text: ctx.ago(a.at) })))));

  const main = h('section', { class: 'cg-card cg-main', 'aria-label': 'Arrivals' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Arrivals' }), demoChip(h, d)),
    chips(h, FILTERS.map(([key, label]) => ({ key, label, n: count(key) })), filter, (k) => { ui.filter = k; api.repaint(); }, 'Filter arrivals'),
    shown.length || !rows.length ? list : h('p', { class: 'cg-note', text: 'No ' + filter.toLowerCase() + ' documents.' }));

  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card' },
      bigNumber(h, d.summary.filed, d.summary.filed === 1 ? 'document filed' : 'documents filed', d.summary.last ? 'Last arrival ' + ctx.ago(d.summary.last) : 'Updated just now'),
      d.summary.waiting ? h('p', { class: 'cg-note' }, chip(h, d.summary.waiting + ' waiting', 'warn'), ' for their action') : null,
      h('div', { class: 'cg-actions' }, actionButton(api, 'Scan site folders', 'scan', null, { primary: true, busy: 'Scanning…' })),
      message(h, ui)),
    h('section', { class: 'cg-card' },
      h('h3', { text: 'Watched folder' }),
      h('p', { class: 'cg-mono', text: d.folder || 'Not set' }),
      (d.monitors || []).map((m) => h('p', { class: 'cg-mon' }, chip(h, m.state, TONE[m.state] || ''), h('span', { text: ' ' + m.name + ' · last run ' + m.last }))),
      folderForm(api)),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Arrivals, last 24 hours' }), line(ctx, 'Arrivals, last 24 hours', 'Files', d.hours)));

  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), h('div', { class: 'cg-pane cg-split' }, main, rail));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
