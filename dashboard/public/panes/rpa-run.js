// Run a workflow (focus): a start band (pick a workflow, fill its variables), then the live run: every step with its
// screenshot and pass or fail, the picture of the step in progress, approval buttons when a checkpoint waits, a stop
// button, and the log. While a run is going the screen refreshes every 1.5 seconds.
import { screen, chip, demoBanner, message, chips } from './common.js';
import { field, text, select, stateWord, runSteps, logList, zoomCard, dur, when, keepFresh } from './rpa-common.js';

let mounted = null;   // { root, ctx, stop } of the open screen
const live = (d) => !!(d && d.active && d.active.live);

function ensureFresh(self) {
  if (!mounted || mounted.stop) return;
  mounted.stop = keepFresh(mounted.root, mounted.ctx, (r, c) => self.update(r, c), (d) => { const on = live(d); if (!on && mounted) mounted.stop = null; return on; });
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const can = !!ctx.me.canRun, busy = !!ui.busy;
  const run = d.active;
  const wfs = d.workflows;
  const chosen = wfs.find((w) => w.id === ui.wf) || wfs[0] || null;
  ui.vals = ui.vals || {};

  // ---------- start ----------
  const pickWf = select(h, 'workflow', wfs.map((w) => [w.id, w.name + (d.isAdmin ? ' (' + w.clientName + ')' : '')]), chosen ? chosen.id : '');
  pickWf.addEventListener('change', () => { ui.wf = pickWf.value; api.repaint(); });
  const inputs = chosen ? chosen.variableList.map((v) => [v, text(h, 'v_' + v.name, v.label, ui.vals[v.name] ?? v.default ?? '', { maxlength: '200', type: v.secret ? 'password' : 'text', autocomplete: v.secret ? 'off' : 'off' })]) : [];
  const start = h('section', { class: 'cg-card', 'aria-label': 'Start a run' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Run a workflow' }), d.waiting ? chip(h, d.waiting + (d.waiting === 1 ? ' run needs approval' : ' runs need approval'), 'warn') : chip(h, 'Ready', 'ok')),
    wfs.length ? h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => {
      e.preventDefault();
      const values = {}; for (const [v, i] of inputs) { values[v.name] = i.value; if (!v.secret) ui.vals[v.name] = i.value; }
      api.act('start', { workflow: chosen.id, values });
    } },
      field(h, 'Workflow', pickWf, chosen ? chosen.steps + ' steps' + (chosen.approvals ? ', ' + chosen.approvals + ' approval' + (chosen.approvals === 1 ? '' : 's') : '') : ''),
      inputs.map(([v, i]) => field(h, v.label, i, v.secret ? 'Asked each time, never stored' : v.default ? 'Default: ' + v.default : 'Required')),
      chosen && chosen.usesLogin ? h('p', { class: 'cg-note rpa-span', text: 'Uses the login saved in Connections.' }) : null,
      h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can || (run && run.live && run.workflowId === chosen.id), text: ui.busy === 'start' ? 'Starting…' : 'Start run' }),
        h('button', { class: 'btn', type: 'button', disabled: !can, text: 'Stop everything that is running', onclick: () => ctx.run('stop-all-runs').then((r) => { ui.msg = { ok: r.ok !== false, text: r.message || '' }; api.repaint(); }) })))
      : h('p', { class: 'cg-note', text: 'No workflows yet. Record a task first, then run it here.' }),
    message(h, ui));

  if (!run) return h('div', { class: 'cg-pane rpa-nowatch' }, demoBanner(ctx, d), start);
  ensureFresh(module_self);

  // ---------- the run ----------
  const done = run.steps.filter((s) => ['passed', 'skipped'].includes(s.state)).length;
  const nowStep = run.steps.find((s) => ['running', 'waiting'].includes(s.state));
  const lastShot = (nowStep && nowStep.shot) || [...run.steps].reverse().map((s) => s.shot).find(Boolean) || null;
  const lastTitle = nowStep ? (nowStep.idx + 1) + '. ' + nowStep.name : 'Last screenshot';
  const note = text(h, 'note', 'Reason (optional)', '', { maxlength: '160' });
  const waitingStep = run.steps.find((s) => s.state === 'waiting');
  const approval = run.state === 'waiting' && waitingStep ? h('div', { class: 'cg-alert rpa-approval', role: 'alert' },
    h('b', { text: 'Approval needed: ' + waitingStep.name }),
    h('p', { class: 'cg-note', text: waitingStep.approvalNote || 'Check the screen, then approve to continue or reject to stop the run.' }),
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('approve', { run: run.id, step: waitingStep.id, approve: true, note: note.value }); } }, field(h, 'Note', note),
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can, text: 'Approve and continue' }),
        h('button', { class: 'btn danger', type: 'button', disabled: busy || !can, text: 'Reject', onclick: () => api.act('approve', { run: run.id, step: waitingStep.id, approve: false, note: note.value }) })))) : null;

  const head = h('div', { class: 'cg-head' },
    h('div', { class: 'rpa-runhead' }, h('h3', { text: run.name }), h('small', { text: (d.isAdmin ? run.clientName + ' · ' : '') + 'started ' + when(run.startedAt) + ' by ' + run.by + ' (' + run.trigger + ')' })),
    h('div', { class: 'cg-actions' }, stateWord(h, run.state, run.live && run.state === 'running' ? 'Running' : undefined), run.live ? h('button', { class: 'btn danger rpa-stop', type: 'button', disabled: busy || !can, text: ui.busy === 'stop' ? 'Stopping…' : 'Stop', onclick: () => api.act('stop', { run: run.id }) }) : null));
  const dots = h('div', { class: 'rpa-dots', role: 'img', 'aria-label': done + ' of ' + run.steps.length + ' steps done' }, run.steps.map((s) => h('i', { class: 'rpa-d-' + s.state, title: s.name })));
  const current = h('section', { class: 'cg-card rpa-live-run', 'aria-label': 'Live run' }, head, dots,
    h('div', { class: 'cg-top-chips' }, chip(h, done + ' of ' + run.steps.length + ' steps', ''), chip(h, run.live ? 'Elapsed ' + dur(Date.now() - Date.parse(run.startedAt)) : 'Took ' + dur(run.ms), ''), run.resumeOf ? chip(h, 'Continued from ' + run.resumeOf, '') : null),
    run.error ? h('div', { class: 'cg-alert rpa-error', role: 'alert' }, h('b', { text: 'What went wrong' }), h('p', { class: 'cg-note', text: run.error })) : null,
    approval,
    h('div', { class: 'rpa-stage' }, h('div', { class: 'rpa-stage-steps' }, runSteps(api, run)),
      h('figure', { class: 'rpa-stage-shot' }, lastShot ? h('img', { class: 'rpa-shot-big', src: lastShot, alt: lastTitle }) : h('p', { class: 'cg-note', text: 'The screenshot appears here as each step finishes.' }), h('figcaption', { text: lastTitle }))));

  const log = h('section', { class: 'cg-card', 'aria-label': 'Log' }, h('h3', { text: 'Log' }), logList(h, run.log.slice(-12)));
  const recent = d.recent.length > 1 ? h('section', { class: 'cg-card', 'aria-label': 'Recent runs' }, h('h3', { text: 'Recent runs' }),
    chips(h, d.recent.map((r) => ({ key: r.id, label: r.name + ' · ' + r.word })), run.id, (k) => api.act('select', { id: k }, { quiet: true }), 'Choose a run')) : null;

  return h('div', { class: 'cg-pane rpa-nowatch' }, demoBanner(ctx, d), zoomCard(h, ui.zoom, () => { ui.zoom = null; api.repaint(); }), start, current, recent, log);
});
const module_self = { update: (r, c) => pane.update(r, c) };

export async function render(root, ctx) {
  if (mounted && mounted.stop) mounted.stop();
  mounted = { root, ctx, stop: null };
  await pane.render(root, ctx);
}
export function update(root, ctx) { if (mounted && mounted.root === root) mounted.ctx = ctx; return pane.update(root, ctx); }
