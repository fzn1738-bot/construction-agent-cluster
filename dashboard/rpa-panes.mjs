// The four Workflow Automation screens' data and buttons, shared by hooks.mjs (live) and demo.mjs (seeded demo):
//   rpa-record     Record mode: watch a task, redact secrets, turn it into a workflow
//   rpa-workflows  The library: rename, reorder, variables, approval checkpoints, schedules, triggers, per-client copies
//   rpa-run        Run mode: start, watch each step live with its screenshot, approve, stop
//   rpa-history    Every run with its log, errors and a resume button
// `createRpa({ store, ... })` wraps one RpaStore (the real one, or the in-memory demo one) and answers for it.
import { RpaError, KINDS, TRIGGER_SOURCES, describeSchedule, BUILTIN_VARS } from '../src/rpa.mjs';

export const PANES = { record: 'rpa-record', workflows: 'rpa-workflows', run: 'rpa-run', history: 'rpa-history' };
export const RPA_PANE_IDS = Object.values(PANES);
export const isRpaPane = (id) => RPA_PANE_IDS.includes(id);
export const RPA_ACTIONS = ['run-due-workflows', 'stop-all-runs'];

const WORD = { passed: 'Passed', failed: 'Failed', stopped: 'Stopped', running: 'Running', waiting: 'Needs approval', queued: 'Queued' };
const STATE_TONE = { passed: 'ok', failed: 'bad', stopped: 'warn', running: 'run', waiting: 'warn', queued: 'wait' };

/** Who is asking: the admin sees every client, a client sees its own records. */
export function scopeOf(ctx, { demoClient = null } = {}) {
  const u = ctx && ctx.user;
  if (!u || u.role === 'admin') return { admin: true, id: u ? u.id : 'admin' };
  return { admin: false, client: demoClient || u.id, id: u.id };
}
const who = (ctx) => (ctx && ctx.user ? { id: ctx.user.id, name: ctx.user.name || (ctx.user.role === 'admin' ? 'Owner' : 'Client') } : { id: 'admin', name: 'Owner' });

function parseMap(v) {
  if (v && typeof v === 'object') return v;
  const out = {};
  for (const part of String(v || '').split(/[,\n]/)) { const [k, val] = part.split('=').map((x) => x && x.trim()); if (k && val) out[k] = val; }
  return out;
}

export function createRpa({ store, demo = false, clients = () => [], agent = () => ({ configured: false }), pull = null, demoClient = null, missing = [], needs = '' }) {
  const picked = new Map();   // `${pane}:${who}` -> selected id (a screen's selection survives its 5-second refresh)
  const key = (pane, sc) => pane + ':' + (sc.admin ? 'admin:' + sc.id : sc.client);
  const cursors = new Map();  // recording id -> agent event cursor
  const nameOf = (id) => (id === 'internal' ? 'Internal (owner)' : (clients().find((c) => c.id === id) || {}).name || id);
  const sc = (ctx) => scopeOf(ctx, { demoClient });
  const shot = (id) => (id ? store.shotData(id) : null);

  const lightWf = (w) => {
    const last = store.listRuns({ admin: true }, { workflowId: w.id, limit: 1 })[0];
    return { id: w.id, name: w.name, client: w.client, clientName: nameOf(w.client), steps: w.steps.length, variables: w.variables.length, approvals: w.steps.filter((s) => s.approval).length, schedule: describeSchedule(w.schedule), triggerText: w.trigger ? 'On ' + w.trigger.kind + (w.trigger.match ? ' containing "' + w.trigger.match + '"' : '') + (w.trigger.enabled === false ? ' (paused)' : '') : 'No trigger', nextRunAt: w.nextRunAt, updatedAt: w.updatedAt, lastRun: last ? { state: last.state, at: last.startedAt } : null };
  };
  const detailWf = (w) => ({
    ...lightWf(w), description: w.description, version: w.version, source: w.source, variables: w.variables, builtins: Object.entries(BUILTIN_VARS).map(([name, d]) => ({ name, label: d.label })),
    schedule: w.schedule, scheduleText: describeSchedule(w.schedule), scheduleValues: w.scheduleValues, trigger: w.trigger,
    steps: w.steps.map((s) => ({ id: s.id, kind: s.kind, name: s.name, target: s.target, value: s.secret ? '' : s.value, secret: s.secret, page: s.page, app: s.app, approval: s.approval, approvalNote: s.approvalNote, optional: s.optional, recorded: s.recorded || '', shot: shot(s.shot), shotNote: s.shotNote }))
  });
  const lightRun = (r) => ({ id: r.id, workflowId: r.workflowId, name: r.name, client: r.client, clientName: nameOf(r.client), state: r.state, word: WORD[r.state] || r.state, tone: STATE_TONE[r.state] || 'wait', trigger: r.trigger, by: r.by.name, startedAt: r.startedAt, endedAt: r.endedAt, ms: r.ms || 0, steps: r.steps.length, passedSteps: r.steps.filter((s) => s.state === 'passed').length, error: r.error, resumeOf: r.resumeOf });
  const detailRun = (r) => ({
    ...lightRun(r), values: r.values, secretNames: r.secretNames, log: r.log.slice(-200), live: store.isActive(r.id),
    steps: r.steps.map((s) => ({ id: s.id, idx: s.idx, name: s.name, kind: s.kind, target: s.target, state: s.state, message: s.message, ms: s.ms, attempts: s.attempts, approval: s.approval, approvalNote: s.approvalNote, optional: s.optional, shot: shot(s.shot || s.refShot) }))
  });
  const lightRec = (r) => ({ id: r.id, name: r.name, state: r.state, steps: r.steps.length, client: r.client, clientName: nameOf(r.client), startedAt: r.startedAt, workflowId: r.workflowId || null });
  const detailRec = (r) => ({ ...lightRec(r), app: r.app, error: r.error, stats: r.stats, steps: r.steps.map((s) => ({ id: s.id, kind: s.kind, name: s.name, target: s.target, value: s.secret ? '' : s.value, secret: s.secret, page: s.page, app: s.app, shot: shot(s.shot), shotNote: s.shotNote })) });

  const base = (scope) => ({ source: demo ? 'demo' : 'live', configured: !demo, needs, missing, isAdmin: scope.admin, clients: scope.admin ? [{ id: 'internal', name: nameOf('internal') }, ...clients()] : [], updatedAt: new Date().toISOString() });

  function pane(id, ctx) {
    const scope = sc(ctx); const b = base(scope);
    if (id === PANES.record) {
      const recs = store.listRecordings(scope);
      const sel = picked.get(key(id, scope));
      const cur = recs.find((r) => r.id === sel) || recs.find((r) => r.state === 'recording') || recs[0] || null;
      const steps = cur ? cur.steps : [];
      return { ...b, columns: ['Step', 'Action', 'Target', 'Screenshot'], rows: steps.map((x, i) => [(i + 1) + '. ' + x.name, x.kind, [x.target, x.secret ? 'value redacted' : x.value, x.page].filter(Boolean).join(' · '), x.secret ? 'Withheld' : x.shot ? 'Saved' : 'None']), kinds: KINDS, agent: agent(), session: cur ? detailRec(cur) : null, recent: recs.slice(0, 8).map(lightRec) };
    }
    if (id === PANES.workflows) {
      const list = store.listWorkflows(scope).sort((a, c) => c.updatedAt.localeCompare(a.updatedAt));
      const sel = picked.get(key(id, scope));
      const cur = list.find((w) => w.id === sel) || list[0] || null;
      return { ...b, columns: ['Workflow', 'Steps', 'Schedule', 'Last run'], rows: list.map((w) => { const l = lightWf(w); return [l.name, String(l.steps), l.schedule, l.lastRun ? WORD[l.lastRun.state] : 'Never run']; }), kinds: KINDS, triggers: TRIGGER_SOURCES, workflows: list.map(lightWf), selected: cur ? detailWf(cur) : null, suggestions: cur ? store.suggestVariables(scope, cur.id) : [] };
    }
    if (id === PANES.run) {
      const list = store.listWorkflows(scope);
      const runs = store.listRuns(scope, { limit: 40 });
      const sel = picked.get(key(id, scope));
      const cur = runs.find((r) => r.id === sel) || runs.find((r) => ['running', 'waiting'].includes(r.state)) || runs[0] || null;
      return { ...b, columns: ['Step', 'State', 'Time', 'Screenshot'], rows: cur ? cur.steps.map((x) => [(x.idx + 1) + '. ' + x.name, x.state, x.ms ? x.ms + ' ms' : '–', x.shot || x.refShot ? 'Saved' : 'None']) : [], workflows: list.map((w) => ({ ...lightWf(w), variableList: w.variables, usesLogin: w.steps.some((s) => /\{\{\s*login_(user|password)\s*\}\}/i.test(s.value + ' ' + s.target)) })), active: cur ? detailRun(cur) : null, recent: runs.slice(0, 6).map(lightRun), waiting: store.waiting(scope) };
    }
    if (id === PANES.history) {
      const runs = store.listRuns(scope, { limit: 100 });
      const sel = picked.get(key(id, scope));
      const cur = runs.find((r) => r.id === sel) || null;
      const done = runs.filter((r) => ['passed', 'failed'].includes(r.state));
      return { ...b, columns: ['Workflow', 'Result', 'Started', 'Time'], rows: runs.map((r) => [r.name, WORD[r.state] || r.state, r.startedAt, (r.ms || 0) + ' ms']), runs: runs.map(lightRun), selected: cur ? detailRun(cur) : null, workflows: store.listWorkflows(scope).map((w) => ({ id: w.id, name: w.name })), summary: { total: runs.length, passed: runs.filter((r) => r.state === 'passed').length, failed: runs.filter((r) => r.state === 'failed').length, stopped: runs.filter((r) => r.state === 'stopped').length, successRate: done.length ? Math.round((done.filter((r) => r.state === 'passed').length / done.length) * 100) : 100, last: runs[0] ? runs[0].startedAt : null } };
    }
    return null;
  }

  async function act(id, action, input, ctx) {
    const scope = sc(ctx); const inp = input && typeof input === 'object' ? input : {};
    const done = (message, extra = {}) => ({ ok: true, message: message + (demo ? ' (demo)' : ''), data: pane(id, ctx), ...extra });
    try {
      if (action === 'select') { picked.set(key(id, scope), String(inp.id || '')); return { ok: true, message: '', data: pane(id, ctx) }; }
      if (id === PANES.record) {
        if (action === 'start') { const r = store.startRecording(scope, { name: inp.name, app: inp.app, client: inp.client }); picked.set(key(id, scope), r.id); return done('Recording started: do the task as you normally would'); }
        if (action === 'event') {
          const r = store.recordEvent(scope, String(inp.session || ''), inp);
          return { ok: true, message: r.dropped ? (r.dropped === 'merged' ? 'Typing added to the previous step' : 'Ignored: the same action twice in a moment') : 'Step ' + store.getRecording(scope, String(inp.session)).steps.length + ' captured: ' + r.step.name, data: pane(id, ctx) };
        }
        if (action === 'deny') { store.denyRecording(scope, String(inp.session || ''), inp.reason); return { ok: false, message: store.getRecording(scope, String(inp.session)).error, data: pane(id, ctx) }; }
        if (action === 'stop') { const r = store.stopRecording(scope, String(inp.session || '')); return done('Recording stopped with ' + r.steps.length + ' step(s)'); }
        if (action === 'discard') { store.discardRecording(scope, String(inp.session || '')); picked.delete(key(id, scope)); return done('Recording discarded'); }
        if (action === 'save') { const wf = store.saveRecording(scope, String(inp.session || ''), { name: inp.name }); picked.set(key(PANES.workflows, scope), wf.id); return done('Saved as workflow "' + wf.name + '" with ' + wf.steps.length + ' steps: open Workflows to edit it', { output: { workflow: wf.id } }); }
        if (action === 'pull') {
          const a = agent();
          if (!demo && !a.configured) return { ok: false, message: 'The desktop automation agent is not connected: add its address and token in Connections', data: pane(id, ctx) };
          const sid = String(inp.session || '');
          const rec = store.getRecording(scope, sid);
          const got = await pull(rec, cursors.get(sid) || 0, scope);
          if (!got.ok) return { ok: false, message: got.message, data: pane(id, ctx) };
          let kept = 0;
          for (const ev of got.events) { const r = store.recordEvent(scope, sid, ev); if (!r.dropped) kept++; }
          cursors.set(sid, got.next);
          return done(got.events.length ? 'Pulled ' + got.events.length + ' action(s) from the desktop agent; ' + kept + ' kept' : 'The desktop agent saw nothing new');
        }
      }
      if (id === PANES.workflows) {
        const wf = String(inp.workflow || '');
        if (action === 'create') { const w = store.createWorkflow(scope, { name: inp.name, client: inp.client }); picked.set(key(id, scope), w.id); return done('Workflow "' + w.name + '" created: add steps below'); }
        if (action === 'rename') { store.renameWorkflow(scope, wf, inp.name); return done('Workflow renamed'); }
        if (action === 'describe') { store.describeWorkflow(scope, wf, inp.text); return done('Description saved'); }
        if (action === 'step-rename') { store.renameStep(scope, wf, String(inp.step), inp.name); return done('Step renamed'); }
        if (action === 'step-move') { store.moveStep(scope, wf, String(inp.step), { by: Number(inp.by) }); return done('Step moved ' + (Number(inp.by) < 0 ? 'up' : 'down')); }
        if (action === 'step-update') { store.updateStep(scope, wf, String(inp.step), Object.fromEntries(['target', 'value', 'optional'].filter((k) => inp[k] !== undefined).map((k) => [k, inp[k]]))); return done('Step saved'); }
        if (action === 'step-add') { store.addStep(scope, wf, { kind: inp.kind, target: inp.target, value: inp.value, name: inp.name, after: inp.after }); return done('Step added'); }
        if (action === 'step-delete') { store.deleteStep(scope, wf, String(inp.step)); return done('Step removed'); }
        if (action === 'approval') { store.setApproval(scope, wf, String(inp.step), inp.on === true || inp.on === 'true', inp.note); return done(inp.on === true || inp.on === 'true' ? 'Approval checkpoint added: the run will pause here' : 'Approval checkpoint removed'); }
        if (action === 'var-add') { store.addVariable(scope, wf, { name: inp.name, label: inp.label, default: inp.default, secret: inp.secret === true || inp.secret === 'true' }); return done('Variable {{' + String(inp.name).trim() + '}} added'); }
        if (action === 'var-remove') { store.removeVariable(scope, wf, inp.name); return done('Variable removed'); }
        if (action === 'bind') { store.bindVariable(scope, wf, String(inp.step), inp.variable || null, inp.original); return done(inp.variable ? 'Step now uses {{' + inp.variable + '}}' : 'Step uses its recorded value again'); }
        if (action === 'suggest') {
          const sug = store.suggestVariables(scope, wf);
          if (!sug.length) return { ok: true, message: 'No customer, PO or reference fields found to turn into variables', data: pane(id, ctx) };
          for (const s of sug) { store.addVariable(scope, wf, { name: s.name, label: s.label, default: '' }); store.bindVariable(scope, wf, s.stepId, s.name); }
          return done(sug.length + ' variable(s) created: ' + sug.map((s) => '{{' + s.name + '}}').join(', '));
        }
        if (action === 'duplicate') { const c = store.duplicateWorkflow(scope, wf, { name: inp.name }); picked.set(key(id, scope), c.id); return done('Copied as "' + c.name + '"'); }
        if (action === 'assign') { const c = store.assignWorkflow(scope, wf, inp.client); return done('A copy was given to ' + nameOf(c.client), { output: { workflow: c.id } }); }
        if (action === 'delete') { store.deleteWorkflow(scope, wf); picked.delete(key(id, scope)); return done('Workflow deleted'); }
        if (action === 'set-schedule') {
          const days = Array.isArray(inp.days) ? inp.days : String(inp.days || '').split(',').filter((x) => x !== '');
          store.setSchedule(scope, wf, { kind: inp.kind, everyMin: inp.everyMin, at: inp.at, days, enabled: inp.enabled !== false && inp.enabled !== 'false' }, inp.values && typeof inp.values === 'object' ? inp.values : null);
          return done('Schedule saved: ' + describeSchedule(store.getWorkflow(scope, wf).schedule));
        }
        if (action === 'clear-schedule') { store.clearSchedule(scope, wf); return done('Schedule removed'); }
        if (action === 'set-trigger') { store.setTrigger(scope, wf, { kind: inp.kind, match: inp.match, map: parseMap(inp.map), enabled: inp.enabled !== false && inp.enabled !== 'false' }); return done('Trigger saved'); }
        if (action === 'clear-trigger') { store.clearTrigger(scope, wf); return done('Trigger removed'); }
        if (action === 'test-trigger') {
          const w = store.getWorkflow(scope, wf);
          if (!w.trigger) return { ok: false, message: 'This workflow has no trigger yet', data: pane(id, ctx) };
          const started = store.fireTrigger(w.trigger.kind, parseMap(inp.payload), { client: w.client }).filter((r) => r.workflowId === w.id);
          if (!started.length) return { ok: true, message: 'The test event did not match this trigger (it needs "' + w.trigger.match + '")', data: pane(id, ctx) };
          picked.set(key(PANES.run, scope), started[0].id);
          return done('Trigger fired: ' + (started[0].state === 'failed' ? 'the run could not start (' + started[0].error + ')' : 'run started, watch it in Run a workflow'));
        }
      }
      if (id === PANES.run) {
        if (action === 'start') {
          const r = store.startRun(scope, String(inp.workflow || ''), { values: inp.values && typeof inp.values === 'object' ? inp.values : {}, by: who(ctx) });
          picked.set(key(id, scope), r.id); return done('Run started: ' + r.name);
        }
        if (action === 'stop') { store.stopRun(scope, String(inp.run || ''), who(ctx).name); return done('Stop requested: the run halts at this step'); }
        if (action === 'approve') {
          const yes = inp.approve === true || inp.approve === 'true';
          store.decide(scope, String(inp.run || ''), String(inp.step || ''), yes, { by: who(ctx).name, note: inp.note });
          return done(yes ? 'Approved: the run continues' : 'Rejected: the run stops');
        }
      }
      if (id === PANES.history) {
        if (action === 'resume') { const r = store.resumeRun(scope, String(inp.run || ''), { values: inp.values && typeof inp.values === 'object' ? inp.values : {}, by: who(ctx) }); picked.set(key(PANES.run, scope), r.id); return done('Continuing from the step that failed: watch it in Run a workflow'); }
        if (action === 'rerun') {
          const old = store.getRun(scope, String(inp.run || ''));
          const r = store.startRun(scope, old.workflowId, { values: { ...old.values, ...(inp.values && typeof inp.values === 'object' ? inp.values : {}) }, by: who(ctx) });
          picked.set(key(PANES.run, scope), r.id); return done('Started again from the first step: watch it in Run a workflow');
        }
      }
    } catch (e) {
      if (e instanceof RpaError) return { ok: false, message: e.message, data: pane(id, ctx) };
      throw e;
    }
    return { ok: false, message: 'Unknown action' };
  }

  /** Dashboard-wide buttons. */
  function run(id, ctx) {
    const scope = sc(ctx);
    if (id === 'run-due-workflows') {
      if (!scope.admin) return { ok: false, message: 'Only the admin can start the scheduled workflows.' };
      const started = store.tick(Date.now());
      return { ok: true, message: started.length ? started.length + ' scheduled workflow(s) started' : 'No workflow is due right now' + (demo ? ' (demo)' : ''), output: started.map((r) => ({ id: r.id, name: r.name, state: r.state })) };
    }
    if (id === 'stop-all-runs') { const n = store.stopAll(scope, who(ctx).name); return { ok: true, message: n ? 'Stop requested for ' + n + ' running workflow(s)' : 'Nothing is running' + (demo ? ' (demo)' : '') }; }
    return null;
  }

  function metrics() {
    const s = store.stats({ admin: true });
    return [
      { key: 'wfRuns', label: 'Workflow runs today', value: s.today, unit: '', trend: s.hours.values, good: 'up', pane: PANES.history },
      { key: 'wfSuccess', label: 'Workflow success rate', value: s.successRate, unit: '%', trend: [s.successRate], good: 'up', pane: PANES.history },
      { key: 'wfAvg', label: 'Avg workflow run time', value: s.avgSeconds, unit: 's', trend: [s.avgSeconds], good: 'down', pane: PANES.history },
      { key: 'wfErrors', label: 'Workflow failures', value: s.failed, unit: '', trend: [s.failed], good: 'down', pane: PANES.history },
      { key: 'wfCount', label: 'Workflows trained', value: s.workflows, unit: '', trend: [s.workflows], good: 'up', pane: PANES.workflows },
      { key: 'wfScheduled', label: 'On a schedule or trigger', value: s.scheduled, unit: '', trend: [s.scheduled], good: 'up', pane: PANES.workflows },
      { key: 'wfRecorded', label: 'Steps recorded', value: s.recordedSteps, unit: '', trend: [s.recordedSteps], good: 'up', pane: PANES.record },
      { key: 'wfWaiting', label: 'Waiting for approval', value: s.waiting, unit: '', trend: [s.waiting], good: 'down', pane: PANES.run }
    ];
  }
  function panels() {
    const s = store.stats({ admin: true });
    return [
      { title: 'Workflow runs, last 24 hours', kind: 'line', labels: s.hours.labels, series: [{ name: 'Runs', values: s.hours.values }], pane: PANES.history },
      { title: 'Workflow results', kind: 'bar', labels: ['Passed', 'Failed', 'Stopped'], series: [{ name: 'Runs', values: [s.passed, s.failed, s.stopped] }], pane: PANES.history }
    ];
  }
  function states() {
    const s = store.stats({ admin: true });
    const pl = (n, a, b) => n + ' ' + (n === 1 ? a : b);
    const out = {
      [PANES.record]: s.recording ? { state: 'ok', text: 'Recording now' } : s.recordedSteps ? { state: 'ok', text: pl(s.recordedSteps, 'step', 'steps') + ' recorded' } : { state: 'idle', text: 'Nothing recorded yet' },
      [PANES.workflows]: s.workflows ? { state: 'ok', text: pl(s.workflows, 'workflow', 'workflows') + (s.scheduled ? ', ' + s.scheduled + ' automatic' : '') } : { state: 'idle', text: 'No workflows yet' },
      [PANES.run]: s.waiting ? { state: 'warn', text: pl(s.waiting, 'run waits', 'runs wait') + ' for approval' } : s.running ? { state: 'ok', text: pl(s.running, 'run', 'runs') + ' working' } : { state: 'ok', text: 'Ready to run' },
      [PANES.history]: !s.runs ? { state: 'idle', text: 'No runs yet' } : s.successRate < 80 ? { state: 'bad', text: s.successRate + '% success, ' + pl(s.failed, 'failure', 'failures') } : s.failed ? { state: 'warn', text: s.successRate + '% success, ' + pl(s.failed, 'failure', 'failures') } : { state: 'ok', text: s.successRate + '% success over ' + pl(s.runs, 'run', 'runs') }
    };
    if (demo) for (const k of Object.keys(out)) out[k] = { ...out[k], demo: true };
    return out;
  }
  return { pane, act, run, metrics, panels, states, store };
}
