// Demo data: which numbers are real and which are demo samples, per screen, and what switches each one to live.
import { screen, chip, message, actionButton, records } from './common.js';

const SOURCE_TONE = { Live: 'ok', 'Demo sample': 'demo' };

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const items = d.items || [];
  const n = d.summary.onDemo;
  const sw = d.switch || { on: false, auto: true };
  const banner = h('section', { class: 'cg-card ' + (n ? 'cg-banner' : '') },
    h('div', { class: 'cg-head' }, h('h3', { text: n ? n + ' of ' + d.summary.total + ' screens show demo data' : 'Everything is live.' }), n ? chip(h, 'Demo data', 'demo') : chip(h, 'Live', 'ok')),
    h('p', { class: 'cg-note', text: 'Demo switch ' + (sw.on ? 'on' : 'off') + (sw.auto ? ': it follows the keys, so a screen goes live as soon as its keys are saved.' : ': set by hand in Control.') }),
    ctx.me.role === 'admin' && (!sw.auto || sw.on) ? h('div', { class: 'cg-actions' }, actionButton(api, 'Go live where keys are set', 'auto', null, { primary: true, busy: 'Switching…' }),
      h('a', { class: 'btn', href: '#/pane/keys-entered-in-settings', text: 'Enter keys' })) : null,
    message(h, ui));

  const bars = h('section', { class: 'cg-card', 'aria-label': 'Live vs demo rows by screen' },
    h('h3', { text: 'Live vs demo rows by screen' }),
    items.length ? h('ul', { class: 'cg-stack' }, items.map((i) => {
      const total = Math.max(i.live + i.demo, 1);
      const lw = Math.round((i.live / total) * 10);
      return h('li', {},
        h('span', { class: 'cg-stack-label' }, h('b', { text: i.screen }), h('small', { text: i.live + ' live · ' + i.demo + ' demo' })),
        h('span', { class: 'cg-stack-bar', role: 'img', 'aria-label': i.screen + ': ' + i.live + ' live rows, ' + i.demo + ' demo rows' },
          lw ? h('i', { class: 'cg-stack-live', 'data-w': String(lw) }) : null, lw < 10 ? h('i', { class: 'cg-stack-demo', 'data-w': String(10 - lw) }) : null));
    })) : h('p', { class: 'cg-note', text: 'None of the outcome tabs are part of your access.' }));

  const table = h('section', { class: 'cg-card' }, h('h3', { text: 'Data source by screen' }),
    records(h, d.columns, d.rows, { empty: 'Everything is live.', cell: (v, j) => (j === 1 ? chip(h, v, SOURCE_TONE[v] || '') : String(v)) }));

  return h('div', { class: 'cg-pane cg-focus' }, banner, bars, table);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
