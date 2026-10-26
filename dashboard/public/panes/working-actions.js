// Action history: press a run button and watch its result land in the history below.
// Top: the run buttons for the outcomes you have, with Runs today as the one big number. Then the durations line
// and the history itself, filterable by outcome and result.
import { screen, chip, demoBanner, bigNumber, message, chips, line, records, updated } from './common.js';

const clock = (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const runs = d.runs || [];
  const pick = ui.pick || 'all';
  const outcomes = [...new Set(runs.map((r) => r.outcomeTitle).filter(Boolean))];
  const shown = runs.filter((r) => pick === 'all' || (pick === 'failed' ? !r.ok : r.outcomeTitle === pick));
  const busy = !!ui.busy || !ctx.me.canRun;

  const buttons = (d.buttons || []).map((b, i) => h('button', { class: 'btn' + (i === 0 ? ' primary' : ''), type: 'button', disabled: busy, onclick: () => api.act(b.verb) },
    ui.busy === b.verb ? 'Running…' : b.label, b.source === 'demo' ? h('small', { class: 'cg-btn-note', text: ' · demo' }) : null));
  const top = h('section', { class: 'cg-card cg-top' },
    h('div', { class: 'cg-top-main' },
      bigNumber(h, d.summary.runsToday, d.summary.runsToday === 1 ? 'run today' : 'runs today', d.summary.last ? 'Last run ' + ctx.ago(d.summary.last) : 'No runs yet'),
      h('div', { class: 'cg-top-chips' }, d.source === 'demo' ? chip(h, 'Demo data', 'demo') : null,
        chip(h, d.summary.failedToday + ' failed', d.summary.failedToday ? 'bad' : 'ok'), chip(h, 'avg ' + d.summary.avgS + ' s'))),
    h('div', { class: 'cg-top-side' },
      buttons.length ? h('div', { class: 'cg-runbar', role: 'group', 'aria-label': 'Run an outcome now' }, buttons,
        buttons.length > 1 ? h('button', { class: 'btn', type: 'button', disabled: busy, text: ui.busy === 'run-all' ? 'Running…' : 'Run all of mine', onclick: () => api.act('run-all') }) : null)
        : h('p', { class: 'cg-note', text: 'None of the outcomes that run are part of your access.' }),
      !ctx.me.canRun ? h('p', { class: 'cg-note', text: 'Your access can view the history but not run.' }) : null,
      message(h, ui)));

  const durations = h('section', { class: 'cg-card' }, h('div', { class: 'cg-head' }, h('h3', { text: 'Run durations, today' }), updated(h)),
    d.durations.values.length ? line(ctx, 'Run durations, today', 'Seconds', d.durations) : h('p', { class: 'cg-note', text: 'No runs yet today.' }));

  const history = h('section', { class: 'cg-card', 'aria-label': 'Action history' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Action history' }),
      chips(h, [{ key: 'all', label: 'All', n: runs.length }, { key: 'failed', label: 'Failed', n: runs.filter((r) => !r.ok).length }, ...outcomes.map((o) => ({ key: o, label: o, n: runs.filter((r) => r.outcomeTitle === o).length }))], pick, (k) => { ui.pick = k; api.repaint(); }, 'Filter the history')),
    records(h, d.columns, shown.map((r) => [r.label, r.by, clock(r.at), (r.ms / 1000).toFixed(1) + ' s', r]), {
      empty: runs.length ? 'Nothing matches that filter.' : 'No runs yet. Press ' + ((d.buttons || [])[0] ? d.buttons[0].label : 'a run button') + '.',
      cell: (v, j) => (j === 4 ? h('span', { class: 'cg-result' }, chip(h, v.ok ? '✓ OK' : '✕ Failed', v.ok ? 'ok' : 'bad'), ' ', v.message) : String(v))
    }));

  return h('div', { class: 'cg-pane cg-focus' }, demoBanner(ctx, d), top, durations, history);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
