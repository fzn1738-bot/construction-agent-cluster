// Client outcomes: what the agent delivers to the client, which tab owns each outcome, and what still waits on a key.
// Main column: the outcome table. Rail: outcomes delivered, share on live data, coverage today and the missing keys.
import { screen, chip, demoBanner, bigNumber, message, actionButton, records, updated } from './common.js';

const TONE = { Live: 'ok', 'Needs a look': 'warn', Failing: 'bad', Waiting: '', 'Demo data': 'demo' };

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const items = d.items || [];
  const byTab = Object.fromEntries(items.map((i) => [i.tab, i.id]));
  const table = records(h, d.columns, d.rows, {
    empty: 'No outcomes yet — run the scan to discover what the agent delivers.',
    cell: (v, j) => (j === 2 && byTab[v] ? h('a', { href: '#/pane/' + byTab[v], text: v }) : j === 3 ? chip(h, v, TONE[v] || '') : String(v))
  });

  const main = h('section', { class: 'cg-card cg-main', 'aria-label': 'Client outcomes' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'What the agent delivers' }), d.source === 'demo' ? chip(h, 'Demo data', 'demo') : updated(h)),
    h('p', { class: 'cg-note', text: 'Each outcome is a tab of its own. Open a tab to see its records and press its button.' }),
    table,
    !items.length ? actionButton(api, 'Check every outcome', 'check', null, { busy: 'Checking…' }) : null,
    d.hidden ? h('p', { class: 'cg-note', text: d.hidden + ' more outcome' + (d.hidden === 1 ? ' is' : 's are') + ' not part of your access.' }) : null);

  const m = d.metrics || { delivered: 0, total: 0, livePct: 0 };
  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card' },
      bigNumber(h, m.delivered + ' of ' + m.total, 'outcomes delivered', m.livePct + '% running on live data'),
      h('div', { class: 'cg-actions' }, actionButton(api, 'Check every outcome', 'check', null, { primary: true, busy: 'Checking…' })),
      message(h, ui)),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Coverage by outcome' }), h('p', { class: 'cg-note', text: 'Items handled today' }),
      items.length ? ctx.chart({ title: 'Coverage by outcome', kind: 'bar', labels: d.coverage.labels, series: [{ name: 'Items handled today', values: d.coverage.values }] }) : h('p', { class: 'cg-note', text: 'Nothing handled yet today.' })),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Needs a key' }),
      (d.needsKey || []).length
        ? h('ul', { class: 'cg-plain' }, d.needsKey.map((n) => h('li', { class: 'cg-rule' }, h('b', { text: n.outcome }), h('span', { class: 'cg-note', text: n.missing }))))
        : h('p', { class: 'cg-note', text: 'Nothing is waiting on a key.' }),
      ctx.me.role === 'admin' && (d.needsKey || []).length ? h('a', { class: 'btn', href: '#/pane/keys-entered-in-settings', text: 'Add the missing keys' }) : null));

  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), h('div', { class: 'cg-pane cg-split' }, main, rail));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
