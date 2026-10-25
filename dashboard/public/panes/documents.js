// Site documents (split): the arrivals list, grouped by when they landed, beside a rail with the headline number,
// the scan button, what kinds of file arrived, the watched folder and the 24-hour arrivals trend.
import { screen, chip, demoBanner, bigNumber, message, actionButton, chips, trend, bytes, ext, TONE } from './common.js';

const FILTERS = [['all', 'All'], ['Filed', 'Filed'], ['Updated', 'Updated'], ['Failed', 'Failed']];
const HOUR = 3600e3;

/** Arrivals in three time bands so the newest stand out: last hour, earlier today, before today. */
function bands(rows) {
  const now = Date.now(); const midnight = new Date(); midnight.setHours(0, 0, 0, 0);
  const out = [['Last hour', []], ['Earlier today', []], ['Before today', []]];
  for (const a of rows) {
    const t = Date.parse(a.at);
    (now - t < HOUR ? out[0] : t >= midnight.getTime() ? out[1] : out[2])[1].push(a);
  }
  return out.filter(([, list]) => list.length);
}

function folderForm(api) {
  const { h, d, ctx } = api;
  if (ctx.me.role !== 'admin') return null;
  const input = h('input', { type: 'text', name: 'path', value: d.folder || '', placeholder: '/Volumes/Projects/Incoming', 'aria-label': 'Folder path', autocomplete: 'off', spellcheck: 'false' });
  return h('details', { class: 'cg-more' }, h('summary', { text: 'Change the watched folder' }),
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('set-folder', { path: input.value }); } },
      h('label', { class: 'sr', text: 'Folder path' }), input,
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn', type: 'submit', disabled: !!api.ui.busy, text: api.ui.busy === 'set-folder' ? 'Saving…' : 'Save folder' }))));
}

/** What kinds of document arrived: one bar per extension, counted. */
function typeMix(h, rows) {
  const n = {};
  for (const a of rows) { const k = ext(a.file); n[k] = (n[k] || 0) + 1; }
  const list = Object.entries(n).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const max = Math.max(1, ...list.map(([, v]) => v));
  return list.length ? h('ul', { class: 'cg-bars' }, list.map(([k, v]) => h('li', {}, h('span', { class: 'cg-mono', text: k }), h('i', { class: 'cg-bar', 'data-w': String(Math.max(1, Math.round((v / max) * 10))) }), h('b', { text: String(v) }))))
    : h('p', { class: 'cg-note', text: 'File types appear here once documents arrive.' });
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const rows = d.arrivals || [];
  const sum = d.summary || {};
  const filter = ui.filter || 'all';
  const shown = rows.filter((a) => filter === 'all' || a.event === filter);
  const count = (k) => (k === 'all' ? rows.length : rows.filter((a) => a.event === k).length);

  const row = (a) => h('li', { class: 'cg-file' + (a.status === 'failed' ? ' is-bad' : '') },
    h('span', { class: 'cg-ext', 'aria-hidden': 'true', text: ext(a.file) }),
    h('div', { class: 'cg-file-main' },
      h('b', { text: a.file, title: a.file }),
      h('small', { text: [a.folder, bytes(a.size)].filter(Boolean).join(' · ') }),
      a.error ? h('small', { class: 'cg-err', text: a.error }) : null),
    h('div', { class: 'cg-file-end' }, chip(h, a.event, TONE[a.event] || ''), h('small', { text: ctx.ago(a.at) })));

  const list = !rows.length
    ? h('div', { class: 'cg-empty-in' }, h('p', { text: 'Nothing has arrived yet. New drawings and documents appear here the moment they land in the folder.' }), actionButton(api, 'Scan site folders', 'scan', null, { busy: 'Scanning…' }))
    : !shown.length ? h('p', { class: 'cg-note', text: 'No ' + filter.toLowerCase() + ' documents.' })
      : h('div', { class: 'cg-bands' }, bands(shown).map(([label, list]) => h('section', { class: 'cg-band', 'aria-label': label },
        h('h4', { class: 'cg-band-h' }, h('span', { text: label }), h('small', { text: String(list.length) })),
        h('ul', { class: 'cg-files' }, list.map(row)))));

  const main = h('section', { class: 'cg-card cg-main', 'aria-label': 'Arrivals' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Arrivals' }), h('small', { class: 'cg-updated', text: rows.length + ' in view' })),
    rows.length ? chips(h, FILTERS.map(([key, label]) => ({ key, label, n: count(key) })), filter, (k) => { ui.filter = k; api.repaint(); }, 'Filter arrivals') : null,
    list);

  const mon = (d.monitors || [])[0];
  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card cg-lead' },
      bigNumber(h, sum.filed ?? 0, sum.filed === 1 ? 'document filed' : 'documents filed', sum.last ? 'Last arrival ' + ctx.ago(sum.last) : 'Updated just now'),
      h('div', { class: 'cg-top-chips' },
        sum.waiting ? chip(h, sum.waiting + ' waiting', 'warn') : chip(h, 'Nothing waiting', 'ok'),
        count('Failed') ? chip(h, count('Failed') + ' failed', 'bad') : null),
      h('div', { class: 'cg-actions' }, actionButton(api, 'Scan site folders', 'scan', null, { primary: true, busy: 'Scanning…' })),
      message(h, ui)),
    h('section', { class: 'cg-card' },
      h('div', { class: 'cg-head' }, h('h3', { text: 'Watched folder' }), mon ? chip(h, mon.state, mon.tone || TONE[mon.state] || '') : null),
      h('p', { class: 'cg-mono cg-path', text: d.folder || 'Not set yet' }),
      mon ? h('p', { class: 'cg-note', text: 'Checked ' + mon.last + (mon.queue ? ' · ' + mon.queue + ' in the queue' : '') }) : null,
      folderForm(api)),
    h('section', { class: 'cg-card' }, h('h3', { text: 'What arrived' }), typeMix(h, rows)),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Arrivals, last 24 hours' }), trend(ctx, 'Arrivals, last 24 hours', 'files', d.hours)));

  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), h('div', { class: 'cg-split' }, main, rail));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
