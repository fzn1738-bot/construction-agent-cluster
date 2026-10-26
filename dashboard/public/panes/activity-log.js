// Activity record (grid): three tiles across the top (the record's size and integrity with check and export, events
// by source, the stored tables), then a full-width filterable ledger, paged so the screen stays readable.
import { screen, chip, demoBanner, bigNumber, message, actionButton, chips, TONE } from './common.js';

const LEVEL = { error: 'bad', warn: 'warn', info: 'ok' };
const PAGE = 15;
const TABLE_WORD = { sync_log: 'Every action', checkpoints: 'Resume points', task_state: 'Scheduled tasks' };
const TABLE_NOTE = { sync_log: 'one line per file, mail or run', checkpoints: 'where an interrupted job picks up', task_state: 'what runs on a timer, and when' };
// sources in the client's words; the filter keys stay the agent's own
const SOURCE = { folder: 'Site folder', ftp: 'FTP', imap: 'Inbox', task: 'Schedule', system: 'System' };
const srcName = (t) => SOURCE[t] || t;
// "site: added A-101.pdf" -> who ("site") and what ("added A-101.pdf")
const splitWhat = (w) => { const m = String(w || '').match(/^([\w:.-]{1,24}):\s+(.+)$/); return m ? [m[1], m[2]] : ['', String(w || '')]; };

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
  const sum = d.summary || {};
  const f = ui.filter || d.filter || { type: 'all', result: 'all' };
  const all = d.events || [];
  const events = all.filter((e) => matches(e, f));
  const limit = ui.limit || PAGE;
  const pick = (patch) => { ui.filter = { ...f, ...patch }; ui.limit = PAGE; api.repaint(); };
  const nType = (t) => (t === 'all' ? all.length : all.filter((e) => e.source === t).length);
  const nResult = (r) => all.filter((e) => matches(e, { type: 'all', result: r })).length;

  const integrity = h('section', { class: 'cg-card cg-tile-lead', 'aria-label': 'Record integrity' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'The record' }), chip(h, sum.integrity ? '✓ Intact' : '✕ Needs repair', sum.integrity ? 'ok' : 'bad')),
    bigNumber(h, sum.rows ?? 0, sum.rows === 1 ? 'event on record' : 'events on record', sum.integrity ? 'Integrity verified · kept on this Mac' : 'A problem was found in the record'),
    (sum.problems || []).map((p) => h('p', { class: 'cg-err', text: p })),
    h('div', { class: 'cg-actions' },
      actionButton(api, 'Check the record', 'check', null, { primary: true, busy: 'Checking…' }),
      actionButton(api, 'Export CSV', 'export', null, { busy: 'Exporting…' }),
      download(api)),
    message(h, ui));

  const byType = d.byType || { labels: [], values: [] };
  const max = Math.max(...byType.values, 1);
  const sources = h('section', { class: 'cg-card' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Events by source' }), h('small', { class: 'cg-updated', text: 'latest ' + all.length })),
    byType.labels.length ? h('ul', { class: 'cg-bars' }, byType.labels.map((l, i) => h('li', {}, h('span', { text: srcName(l) }), h('i', { class: 'cg-bar', 'data-w': String(Math.max(1, Math.round((byType.values[i] / max) * 10))) }), h('b', { text: String(byType.values[i]) }))))
      : h('p', { class: 'cg-note', text: 'Sources appear once the agent records its first event.' }));

  const tables = h('section', { class: 'cg-card' }, h('h3', { text: 'What is stored' }),
    (sum.tables || []).length ? h('ul', { class: 'cg-plain' }, sum.tables.map(([n, c]) => h('li', { class: 'cg-rule' },
      h('span', { class: 'cg-rule-main', title: 'Table ' + n }, h('b', { text: TABLE_WORD[n] || n }), h('small', { text: TABLE_NOTE[n] || n })),
      h('b', { class: 'cg-num', text: String(c) }))))
      : h('p', { class: 'cg-note', text: 'No tables yet.' }));

  const ledger = h('section', { class: 'cg-card cg-ledger-card', 'aria-label': 'Events' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Events' }), h('small', { class: 'cg-updated', text: events.length + ' shown of the latest ' + all.length })),
    h('div', { class: 'cg-filters' },
      chips(h, (d.types || ['all']).filter((t) => t === 'all' || t === f.type || nType(t)).map((t) => ({ key: t, label: t === 'all' ? 'All sources' : srcName(t), n: nType(t) })), f.type, (k) => pick({ type: k }), 'Filter by source'),
      chips(h, (d.results || ['all']).map((t) => ({ key: t, label: t === 'all' ? 'Any result' : t === 'ok' ? 'OK' : t === 'failed' ? 'Failed' : 'Other', n: nResult(t) })), f.result, (k) => pick({ result: k }), 'Filter by result')),
    events.length ? h('ol', { class: 'cg-ledger' }, events.slice(0, limit).map((e) => h('li', { class: 'cg-ev' },
      h('span', { class: 'cg-ev-src', text: srcName(e.source) }),
      h('span', { class: 'cg-ev-what' }, ...((w) => [w[0] ? h('small', { class: 'cg-mono', text: w[0] }) : null, h('span', { text: w[1] })])(splitWhat(e.what))),
      h('span', { class: 'cg-ev-res' }, chip(h, e.result, TONE[e.result] || LEVEL[e.level] || '')),
      h('small', { class: 'cg-ev-when', text: ctx.ago(e.at) }))))
      : h('p', { class: 'cg-note', text: sum.rows ? 'No events match those filters.' : 'No events yet. Run an action to start the record.' }),
    events.length > limit ? h('div', { class: 'cg-actions' }, h('button', { class: 'linkbtn', type: 'button', text: 'Show ' + Math.min(PAGE, events.length - limit) + ' more', onclick: () => { ui.limit = limit + PAGE; api.repaint(); } })) : null);

  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), h('div', { class: 'cg-grid3' }, integrity, sources, tables), ledger);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
