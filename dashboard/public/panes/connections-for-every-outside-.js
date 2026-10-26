// Outside services: every service the agent signs in to, the outcome it feeds, and a checklist of what it still
// needs. Values are never shown here, only whether each one is saved and where it comes from.
import { screen, chip, demoBanner, message, records, stateWord } from './common.js';

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const cards = d.cards || [];
  const admin = ctx.me.role === 'admin';
  const head = h('section', { class: 'cg-card cg-strip' },
    h('div', { class: 'cg-stat' }, h('b', { text: d.summary.ready + ' of ' + d.summary.total }), h('span', { text: 'Services set up' })),
    h('p', { class: 'cg-note', text: 'Each service is an outside login. Enter its keys in Keys in Settings; the tab it feeds goes live as soon as they are saved.' }),
    message(h, ui));

  const grid = cards.length ? h('ul', { class: 'cg-grid2' }, cards.map((c) => h('li', { class: 'cg-card cg-svc' },
    h('div', { class: 'cg-head' }, h('h3', { text: c.name }), stateWord(h, c.ready ? 'ok' : 'idle', c.ready ? 'Set up' : 'Needs keys')),
    h('p', { class: 'cg-note', text: c.summary }),
    h('p', { class: 'cg-note' }, 'Feeds ', h('b', { text: c.feeds })),
    h('ul', { class: 'cg-check' }, c.fields.map((f) => h('li', { class: f.set ? 'is-set' : 'is-missing' },
      h('i', { 'aria-hidden': 'true', text: f.set ? '✓' : '✕' }), h('span', { text: f.label }), h('small', { text: f.set ? f.source || 'Saved' : 'Missing' })))),
    h('div', { class: 'cg-actions' },
      c.test ? chip(h, (c.test.ok ? 'Test passed ' : 'Test failed ') + ctx.ago(c.test.at), c.test.ok ? 'ok' : 'bad') : chip(h, 'Not tested'),
      admin ? h('button', { class: 'btn', type: 'button', disabled: !!ui.busy || !c.ready, text: ui.busy === 'test' && ui.testing === c.id ? 'Testing…' : 'Test', onclick: () => { ui.testing = c.id; api.act('test', { id: c.id }); } }) : null,
      admin && !c.ready ? h('a', { class: 'btn primary', href: '#/pane/keys-entered-in-settings', text: 'Add keys' }) : null,
      c.docs ? h('a', { class: 'linkbtn', href: c.docs, target: '_blank', rel: 'noopener noreferrer', text: 'About this service' }) : null),
    c.test && !c.test.ok ? h('p', { class: 'cg-msg bad', text: c.test.message }) : null)))
    : h('p', { class: 'cg-note', text: 'No connections configured — add keys in Settings.' });

  const table = h('section', { class: 'cg-card' }, h('h3', { text: 'Outside services' }), records(h, d.columns, d.rows, { empty: 'No connections configured — add keys in Settings.' }));
  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), head, grid, table);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
