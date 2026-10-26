// Run history (grid): the success rate and 24-hour trend, a filterable list of every run, and for the chosen run its
// error, every step with its screenshot, and the log, with buttons to continue from the failed step or run again.
import { screen, chip, demoBanner, message, records, chips, bigNumber, updated } from './common.js';
import { stateWord, runSteps, logList, zoomCard, dur, when, select } from './rpa-common.js';

const PAGE = 12;

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const can = !!ctx.me.canRun, busy = !!ui.busy;
  const sum = d.summary;
  const pick = ui.state || 'all';
  const wfPick = ui.wf || '';
  const shown = d.runs.filter((r) => (pick === 'all' || r.state === pick) && (!wfPick || r.workflowId === wfPick));
  const limit = ui.limit || PAGE;
  const sel = d.selected;

  const headline = h('section', { class: 'cg-card rpa-hist-head', 'aria-label': 'Summary' },
    bigNumber(h, sum.successRate + '%', 'of runs succeeded', sum.last ? 'Last run ' + ctx.ago(sum.last) : 'No runs yet'),
    h('div', { class: 'cg-top-chips' }, chip(h, sum.total + (sum.total === 1 ? ' run' : ' runs'), ''), chip(h, sum.passed + ' passed', 'ok'), chip(h, sum.failed + ' failed', sum.failed ? 'bad' : ''), chip(h, sum.stopped + ' stopped', sum.stopped ? 'warn' : '')),
    updated(h));
  const charts = (ctx.panels || []).length ? h('div', { class: 'cg-grid2' }, ctx.panels.map((p) => h('section', { class: 'cg-card' }, h('h3', { text: p.title }), ctx.panel(p)))) : null;

  const wfSel = d.workflows.length > 1 ? select(h, 'workflow', [['', 'All workflows'], ...d.workflows.map((w) => [w.id, w.name])], wfPick) : null;
  if (wfSel) wfSel.addEventListener('change', () => { ui.wf = wfSel.value; ui.limit = PAGE; api.repaint(); });
  const list = h('section', { class: 'cg-card', 'aria-label': 'Runs' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Every run' }), chip(h, shown.length + (shown.length === 1 ? ' shown' : ' shown'), '')),
    chips(h, [{ key: 'all', label: 'All', n: d.runs.length }, ...['passed', 'failed', 'stopped'].map((k) => ({ key: k, label: k[0].toUpperCase() + k.slice(1), n: d.runs.filter((r) => r.state === k).length }))], pick, (k) => { ui.state = k; ui.limit = PAGE; api.repaint(); }, 'Filter by result'),
    wfSel ? h('label', { class: 'rpa-field' }, h('span', { text: 'Workflow' }), wfSel) : null,
    records(h, ['Workflow', 'Result', 'Started', 'Time'], shown.slice(0, limit).map((r) => [r, r, r.startedAt, r.ms]), {
      empty: d.runs.length ? 'No runs match that filter.' : 'No runs yet. Start one in Run a workflow.',
      cell: (v, j) => {
        if (j === 0) return h('span', { class: 'rpa-wfcell' }, h('button', { class: 'linkbtn rpa-wfname', type: 'button', 'aria-current': sel && sel.id === v.id ? 'true' : null, disabled: busy, text: v.name, onclick: () => api.act('select', { id: v.id }, { quiet: true }) }), h('small', { text: (d.isAdmin ? v.clientName + ' · ' : '') + v.trigger + ' · ' + v.by }));
        if (j === 1) return h('span', { class: 'rpa-stcell' }, stateWord(h, v.state, v.word), v.error ? h('small', { class: 'rpa-err', text: v.error }) : h('small', { text: v.passedSteps + ' of ' + v.steps + ' steps' }));
        if (j === 2) return when(v);
        return dur(v);
      }
    }),
    shown.length > limit ? h('div', { class: 'cg-actions' }, h('button', { class: 'linkbtn', type: 'button', text: 'Show ' + Math.min(PAGE, shown.length - limit) + ' more', onclick: () => { ui.limit = limit + PAGE; api.repaint(); } })) : null,
    message(h, ui));

  let detail;
  if (!sel) detail = h('section', { class: 'cg-card' }, h('h3', { text: 'Run details' }), h('p', { class: 'cg-note', text: 'Choose a run to see its steps, screenshots, errors and log.' }));
  else {
    const resumable = !sel.live && (sel.state === 'failed' || sel.state === 'stopped') && sel.steps.some((s) => ['failed', 'stopped', 'rejected'].includes(s.state) || (s.state === 'skipped' && /Not run/.test(s.message)));
    detail = h('section', { class: 'cg-card', 'aria-label': 'Run details' },
      h('div', { class: 'cg-head' }, h('div', { class: 'rpa-runhead' }, h('h3', { text: sel.name }), h('small', { text: (d.isAdmin ? sel.clientName + ' · ' : '') + when(sel.startedAt) + ' · ' + sel.by + ' · ' + sel.trigger + ' · ' + dur(sel.ms) })), stateWord(h, sel.state, sel.word)),
      sel.error ? h('div', { class: 'cg-alert rpa-error', role: 'alert' }, h('b', { text: 'What went wrong' }), h('p', { class: 'cg-note', text: sel.error })) : null,
      Object.keys(sel.values || {}).length ? h('p', { class: 'cg-note', text: 'Values: ' + Object.entries(sel.values).map(([k, v]) => k + ' = ' + v).join(', ') + (sel.secretNames.length ? ' · ' + sel.secretNames.length + ' secret(s) not shown' : '') }) : null,
      h('div', { class: 'cg-actions' },
        resumable ? h('button', { class: 'btn primary', type: 'button', disabled: busy || !can, text: ui.busy === 'resume' ? 'Starting…' : 'Continue from the failed step', onclick: () => api.act('resume', { run: sel.id }) }) : null,
        h('button', { class: 'btn', type: 'button', disabled: busy || !can || sel.live, text: 'Run again from the start', onclick: () => api.act('rerun', { run: sel.id }) })),
      sel.secretNames.length && (resumable) ? h('p', { class: 'cg-note', text: 'Secrets are asked for again when a run is repeated; saved logins from Connections are used automatically.' }) : null,
      runSteps(api, sel),
      h('h3', { text: 'Log' }), logList(h, sel.log));
  }

  return h('div', { class: 'cg-pane rpa-nowatch' }, demoBanner(ctx, d), zoomCard(h, ui.zoom, () => { ui.zoom = null; api.repaint(); }), headline, charts, h('div', { class: 'cg-split' }, list, detail));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
