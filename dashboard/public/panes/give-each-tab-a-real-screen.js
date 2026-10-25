// Screens: one card per tab with a wireframe of its layout, its main view, its buttons and whether it has data.
import { screen, chip, demoBanner, message, actionButton, wireframe, records, updated } from './common.js';

const DATA_TONE = { Live: 'ok', Demo: 'demo', Empty: 'warn' };

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const cards = d.cards || [];
  const strip = h('section', { class: 'cg-card cg-strip' },
    h('div', { class: 'cg-stat' }, h('b', { text: String(d.summary.ready) }), h('span', { text: 'Screens ready' })),
    h('div', { class: 'cg-stat' }, h('b', { text: String(d.summary.empty) }), h('span', { text: 'Screens without data' })),
    h('div', { class: 'cg-strip-end' }, updated(h), actionButton(api, 'Check every screen', 'check', null, { primary: true, busy: 'Checking…' })),
    message(h, ui));

  const grid = cards.length ? h('ul', { class: 'cg-grid2' }, cards.map((c) => h('li', { class: 'cg-card cg-screen' },
    h('a', { class: 'cg-screen-head', href: '#/pane/' + c.id }, wireframe(h, c.layout), h('span', {}, h('b', { text: c.title }), h('small', { text: c.layout + ' layout · ' + c.main }))),
    h('div', { class: 'cg-top-chips' }, chip(h, c.data === 'Demo' ? 'Demo data' : c.data, DATA_TONE[c.data]), chip(h, c.rows + ' row' + (c.rows === 1 ? '' : 's')), c.state ? chip(h, c.state.text, c.state.state === 'idle' ? '' : c.state.state) : null),
    c.actions.length ? h('p', { class: 'cg-note' }, 'Buttons: ', c.actions.join(', ')) : null)))
    : h('p', { class: 'cg-note', text: 'Every screen shows demo data until connected.' });

  const table = h('section', { class: 'cg-card' }, h('h3', { text: 'Screen readiness' }),
    records(h, d.columns, d.rows, { empty: 'Every screen shows demo data until connected.', cell: (v, j) => (j === 4 ? chip(h, v === 'Demo' ? 'Demo data' : v, DATA_TONE[v]) : String(v)) }));
  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), strip, grid, table);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
