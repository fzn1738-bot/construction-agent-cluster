// Connection health: is each service reachable right now? A card per service (state, endpoint, latency, last
// check, Test), the latency over the last hour, and the same facts as a table.
import { screen, demoBanner, message, actionButton, records, stateWord, updated } from './common.js';

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const admin = ctx.me.role === 'admin';
  const cards = d.cards || [];
  const head = h('section', { class: 'cg-card cg-strip' },
    h('div', { class: 'cg-stat' }, h('b', { text: d.summary.up + ' of ' + d.summary.total }), h('span', { text: 'Connected' })),
    h('div', { class: 'cg-stat' }, h('b', { text: d.summary.avgMs ? d.summary.avgMs + ' ms' : '—' }), h('span', { text: 'Avg service latency' })),
    h('div', { class: 'cg-strip-end' }, updated(h), admin ? actionButton(api, 'Test every connection', 'test-all', null, { primary: true, busy: 'Testing…' }) : null),
    message(h, ui));

  const grid = cards.length ? h('ul', { class: 'cg-grid4' }, cards.map((c) => h('li', { class: 'cg-card cg-svc' },
    h('div', { class: 'cg-head' }, h('h3', { text: c.name }), stateWord(h, c.state, c.stateText)),
    h('p', { class: 'cg-mono', text: c.endpoint }),
    h('div', { class: 'cg-svc-num' }, h('b', { text: c.latency == null ? '—' : String(c.latency) }), h('span', { text: c.latency == null ? 'no latency yet' : 'ms' })),
    h('small', { class: 'cg-note', text: c.checkedAt ? 'Checked ' + ctx.ago(c.checkedAt) : 'Never checked' }),
    admin ? h('button', { class: 'btn', type: 'button', disabled: !!ui.busy || !c.ready, text: ui.busy === 'test' && ui.testing === c.id ? 'Testing…' : 'Test', onclick: () => { ui.testing = c.id; api.act('test', { id: c.id }); } }) : null)))
    : h('p', { class: 'cg-note', text: 'No connections configured — add keys in Settings.' });

  const lat = d.latency || { labels: [], series: [] };
  const chart = h('section', { class: 'cg-card' }, h('h3', { text: 'Latency, last hour' }),
    lat.series.length && lat.series.some((s) => s.values.some((v) => v > 0))
      ? h('div', {}, ctx.chart({ title: 'Latency, last hour', kind: 'line', labels: lat.labels, series: lat.series }),
        h('ul', { class: 'cg-legend' }, lat.series.map((s, i) => h('li', { class: 'cg-key-' + (i + 1) }, h('i', { 'aria-hidden': 'true' }), s.name + ': ' + (s.values.filter((v) => v > 0).pop() || 0) + ' ms latest'))))
      : h('p', { class: 'cg-note', text: 'No sign-ins in the last hour. Press Test to measure one.' }));

  const table = h('section', { class: 'cg-card' }, h('h3', { text: 'Connections' }), records(h, d.columns, d.rows, { empty: 'No connections configured — add keys in Settings.' }));
  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), head, grid, chart, table);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
