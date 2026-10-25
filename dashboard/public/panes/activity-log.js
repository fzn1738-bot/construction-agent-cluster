// Activity record: a filterable event ledger, a source breakdown, and the integrity of the record itself.
import { screen, chip, demoChip, demoBanner, bigNumber, message, actionButton, chips, TONE } from './common.js';

const LEVEL = { error: 'bad', warn: 'warn', info: 'ok' };

const matches = (e, f) => (f.type === 'all' || e.source === f.type)
  && (f.result === 'all' || (f.result === 'ok' ? e.result === 'ok' : f.result === 'failed' ? ['failed', 'error'].includes(e.result) : !['ok', 'failed', 'error'].includes(e.result)));

// The export arrives with the action's reply and is offered as a download from this tab (never a shared report).
function download(api) {
  const { h, d, ui } = api;
  if (d.export && ui.exportFor !== d.export.filename) {
    if (ui.url) URL.revokeObjectURL(ui.url);
    ui.url = URL.createObjectURL(new Blob([d.export.csv], { type: 'text/csv' }));
    ui.exportFor = d.export.filename;
  }
  return ui.url ? h('a', { class: 'btn', href: ui.url, download: ui.exportFor, text: 'Download ' + ui.exportFor }) : null;
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const f = ui.filter || d.filter;
  const events = d.events.filter((e) => matches(e, f));
  const pick = (patch) => { ui.filter = { ...f, ...patch }; api.repaint(); };
  const typeChips = chips(h, d.types.map((t) => ({ key: t, label: t === 'all' ? 'All sources' : t })), f.type, (k) => pick({ type: k }), 'Filter by source');
  const resultChips = chips(h, d.results.map((t) => ({ key: t, label: t === 'all' ? 'Any result' : t })), f.result, (k) => pick({ result: k }), 'Filter by result');

  const ledger = h('section', { class: 'cg-card cg-main', 'aria-label': 'Events' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Events' }), demoChip(h, d)),
    typeChips, resultChips,
    events.length ? h('ol', { class: 'cg-ledger' }, events.map((e) => h('li', { class: 'cg-ev' },
      h('span', { class: 'cg-ev-src', text: e.source }),
      h('span', { class: 'cg-ev-what', text: e.what }),
      chip(h, e.result, TONE[e.result] || LEVEL[e.level] || ''),
      h('small', { text: ctx.ago(e.at) }))))
      : h('p', { class: 'cg-note', text: d.summary.rows ? 'No events match those filters.' : 'No events recorded yet. Run an action to start the record.' }));

  const max = Math.max(...d.byType.values, 1);
  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card' },
      bigNumber(h, d.summary.rows, 'events on record', d.summary.integrity ? 'Record integrity verified' : 'Record problem found'),
      chip(h, d.summary.integrity ? 'Intact' : 'Needs repair', d.summary.integrity ? 'ok' : 'bad'),
      (d.summary.problems || []).map((p) => h('p', { class: 'cg-note', text: p })),
      h('div', { class: 'cg-actions' },
        actionButton(api, 'Check the record', 'check', null, { primary: true, busy: 'Checking…' }),
        actionButton(api, 'Export CSV', 'export', null, { busy: 'Exporting…' })),
      download(api),
      message(h, ui)),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Events by source' }),
      h('ul', { class: 'cg-bars' }, d.byType.labels.map((l, i) => h('li', {}, h('span', { text: l }), h('i', { class: 'cg-bar', 'data-w': String(Math.round((d.byType.values[i] / max) * 10)) }), h('b', { text: String(d.byType.values[i]) }))))),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Stored tables' }),
      h('ul', { class: 'cg-plain' }, (d.summary.tables || []).map(([n, c]) => h('li', { class: 'cg-rule' }, h('span', { class: 'cg-mono', text: n }), h('b', { text: String(c) }))))));
  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), h('div', { class: 'cg-pane cg-split' }, ledger, rail));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
