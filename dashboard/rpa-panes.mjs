// The Workflow Automation screens' data and buttons, shared by hooks.mjs (live) and demo.mjs (seeded demo). One pane
// per thing a customer gets from it:
//   rpa-record     (F1) Record mode: the desktop recorder watches the screen; every action arrives with its screenshot
//   rpa-typing     (F2) Typed inputs: what was typed, what is kept secret, what becomes a variable
//   rpa-pages      (F3) Apps & pages: the route through apps and pages, and where a replay found the screen changed
//   rpa-screens    (F4) Step screenshots: every capture of a recording, workflow or run, recorded beside replayed
//   rpa-workflows  (F5) Workflows: the library per client; recordings become workflows; schedules and triggers
//   rpa-steps      (F6) Step editor: rename steps, change what they touch or type, add and remove them
//   rpa-order      (F7) Order & checkpoints: the replay order, and where a run waits for approval
//   rpa-variables  (F8) Variables: customer name, PO number and the like, and which steps use them
//   rpa-run        Run mode: start, watch each step live with its screenshot, approve, stop
//   rpa-history    Every run with its log, errors and a resume button
// `createRpa({ store, recorder, ... })` wraps one RpaStore (the real one, or the in-memory demo one) and answers for it.
// Who asks decides what is seen: the admin sees every client; a client sees its own workflows, runs and numbers.
import { RpaError, KINDS, TRIGGER_SOURCES, describeSchedule, BUILTIN_VARS, refsIn } from '../src/rpa.mjs';

export const PANES = {
  record: 'rpa-record', typing: 'rpa-typing', pages: 'rpa-pages', screens: 'rpa-screens', workflows: 'rpa-workflows',
  steps: 'rpa-steps', order: 'rpa-order', variables: 'rpa-variables', run: 'rpa-run', history: 'rpa-history'
};
export const RPA_PANE_IDS = Object.values(PANES);
export const isRpaPane = (id) => RPA_PANE_IDS.includes(id);
export const RPA_ACTIONS = ['run-due-workflows', 'stop-all-runs'];
// the panes that work on one chosen workflow share the choice, so moving between them keeps it
const WF_PANES = [PANES.typing, PANES.pages, PANES.workflows, PANES.steps, PANES.order, PANES.variables];

const WORD = { passed: 'Passed', failed: 'Failed', stopped: 'Stopped', running: 'Running', waiting: 'Needs approval', queued: 'Queued' };
const STATE_TONE = { passed: 'ok', failed: 'bad', stopped: 'warn', running: 'run', waiting: 'warn', queued: 'wait' };
const LAYOUT_CODES = ['target-missing', 'wrong-page', 'not-pressable', 'app-missing'];

/** Who is asking: the admin sees every client, a client sees its own records. */
export function scopeOf(ctx, { demoClient = null } = {}) {
  const u = ctx && ctx.user;
  if (!u || u.role === 'admin') return { admin: true, id: u ? u.id : 'admin' };
  return { admin: false, client: demoClient || u.id, id: u.id };
}
const who = (ctx) => (ctx && ctx.user ? { id: ctx.user.id, name: ctx.user.name || (ctx.user.role === 'admin' ? 'Owner' : 'Client') } : { id: 'admin', name: 'Owner' });
const varOf = (v) => (/^\{\{\s*(\w+)\s*\}\}$/.exec(String(v || '')) || [])[1] || '';

function parseMap(v) {
  if (v && typeof v === 'object') return v;
  const out = {};
  for (const part of String(v || '').split(/[,\n]/)) { const [k, val] = part.split('=').map((x) => x && x.trim()); if (k && val) out[k] = val; }
  return out;
}

/**
 * @param {object} o
 * @param {RpaStore} o.store
 * @param {object} o.recorder  the screen recorder: { mode, start(rec) -> {ok, code?, message?}, stop(rec), pull(rec, after) -> {ok, events, next, code?, message?} }
 * @param {number} [o.pollMs]  how often a running recording is asked for new actions
 * @param {function} [o.builtinsReady]  () -> { login_user: bool, login_password: bool } (saved in Connections?)
 * @param {function} [o.triggerClients]  (source) -> client ids a site event belongs to (for the test button)
 */
export function createRpa({ store, demo = false, clients = () => [], recorder, pollMs = 1500, demoClient = null, missing = [], needs = '', builtinsReady = () => ({}) }) {
  const picked = new Map();   // `${slot}:${who}` -> chosen id (a screen's choice survives its 5-second refresh)
  const slotOf = (pane) => (WF_PANES.includes(pane) ? 'wf' : pane);
  const key = (pane, sc) => slotOf(pane) + ':' + (sc.admin ? 'admin:' + sc.id : sc.client);
  const pick = (pane, sc, v) => picked.set(key(pane, sc), v);
  const chosen = (pane, sc) => picked.get(key(pane, sc));
  const nameOf = (id) => (id === 'internal' ? 'Internal (owner)' : (clients().find((c) => c.id === id) || {}).name || id);
  const sc = (ctx) => scopeOf(ctx, { demoClient });
  const shot = (id) => (id ? store.shotData(id) : null);

  // ---------- Record mode: the capture loop ----------
  const captures = new Map();   // recording id -> { scope, cursor, timer, busy, error, events, kept, rejected, lastEventAt, lastPullAt }
  async function pull(id, c) {
    if (c.busy) return c.busy;
    c.busy = (async () => {
      let rec;
      try { rec = store.getRecording(c.scope, id); } catch { endCapture(id); return; }
      if (rec.state !== 'recording') { endCapture(id); return; }
      let got;
      try { got = await recorder.pull(rec, c.cursor); } catch (e) { got = { ok: false, message: String((e && e.message) || e) }; }
      c.lastPullAt = Date.now();
      if (!got || !got.ok) {
        if (got && got.code === 'permission-denied') { store.denyRecording(c.scope, id, got.message); endCapture(id); try { await recorder.stop(rec); } catch { /* it already stopped */ } return; }
        c.error = (got && got.message) || 'The recorder did not answer';
        return;
      }
      c.error = got.error || null;
      for (const ev of got.events || []) {
        c.events++;
        try { const r = store.recordEvent(c.scope, id, ev); if (!r.dropped) { c.kept++; c.lastEventAt = Date.now(); } }
        catch (e) { if (!(e instanceof RpaError)) throw e; if (e.code === 'not-recording' || e.code === 'denied') break; c.rejected++; }
      }
      if (Number.isFinite(Number(got.next))) c.cursor = Number(got.next);
      return (got.events || []).length;
    })().finally(() => { c.busy = null; });
    return c.busy;
  }
  function beginCapture(id, scope) {
    const c = { scope, cursor: 0, timer: null, busy: null, error: null, events: 0, kept: 0, rejected: 0, lastEventAt: null, lastPullAt: null };
    c.timer = setInterval(() => { pull(id, c).catch(() => {}); }, pollMs);
    if (c.timer.unref) c.timer.unref();
    captures.set(id, c);
    return c;
  }
  function endCapture(id) { const c = captures.get(id); if (c) { clearInterval(c.timer); captures.delete(id); } return c; }
  /** Stop watching the screen, then take every action still on its way (each keeps its screenshot). */
  async function finishCapture(scope, id) {
    const c = endCapture(id);
    const rec = store.getRecording(scope, id);
    if (rec.state !== 'recording') return;
    try { await recorder.stop(rec); } catch { /* the final pull still runs */ }
    if (!c) return;
    if (c.busy) await c.busy;
    for (let i = 0; i < 20; i++) { const n = await pull(id, c); if (!n) break; }
  }
  const captureOf = (rec) => {
    const c = rec ? captures.get(rec.id) : null;
    return { mode: recorder.mode, watching: !!c, error: c ? c.error : null, events: c ? c.events : 0, kept: c ? c.kept : 0, rejected: c ? c.rejected : 0, lastEventAt: c ? c.lastEventAt : null, lastPullAt: c ? c.lastPullAt : null, pollMs };
  };

  // ---------- shapes ----------
  const lightWf = (w) => {
    const last = store.listRuns({ admin: true }, { workflowId: w.id, limit: 1 })[0];
    return { id: w.id, name: w.name, client: w.client, clientName: nameOf(w.client), steps: w.steps.length, variables: w.variables.length, approvals: w.steps.filter((s) => s.approval).length, schedule: describeSchedule(w.schedule), triggerText: w.trigger ? 'On ' + w.trigger.kind + (w.trigger.match ? ' containing "' + w.trigger.match + '"' : '') + (w.trigger.enabled === false ? ' (paused)' : '') : 'No trigger', nextRunAt: w.nextRunAt, updatedAt: w.updatedAt, version: w.version, lastRun: last ? { state: last.state, at: last.startedAt, id: last.id } : null };
  };
  const stepOf = (s, i, withShot = false) => ({ id: s.id, idx: i, kind: s.kind, name: s.name, target: s.target, value: s.secret ? '' : s.value, secret: s.secret, page: s.page || '', app: s.app || '', approval: s.approval, approvalNote: s.approvalNote, optional: s.optional, recorded: s.recorded || '', variable: s.secret ? '' : varOf(s.value), hasShot: !!s.shot, shotNote: s.shotNote || '', ...(withShot ? { shot: shot(s.shot) } : {}) });
  const lightRun = (r) => ({ id: r.id, workflowId: r.workflowId, name: r.name, client: r.client, clientName: nameOf(r.client), state: r.state, word: WORD[r.state] || r.state, tone: STATE_TONE[r.state] || 'wait', trigger: r.trigger, by: r.by.name, startedAt: r.startedAt, endedAt: r.endedAt, ms: r.ms || 0, steps: r.steps.length, passedSteps: r.steps.filter((s) => s.state === 'passed').length, error: r.error, resumeOf: r.resumeOf });
  const detailRun = (r) => ({
    ...lightRun(r), values: r.values, secretNames: r.secretNames, log: r.log.slice(-200), live: store.isActive(r.id),
    steps: r.steps.map((s) => ({ id: s.id, idx: s.idx, name: s.name, kind: s.kind, target: s.target, page: s.page || '', app: s.app || '', state: s.state, message: s.message, code: s.code || '', ms: s.ms, attempts: s.attempts, approval: s.approval, approvalNote: s.approvalNote, optional: s.optional, shot: shot(s.shot), shotNote: s.shotNote || '' }))
  });
  const lightRec = (r) => ({ id: r.id, name: r.name, state: r.state, steps: r.steps.length, client: r.client, clientName: nameOf(r.client), startedAt: r.startedAt, workflowId: r.workflowId || null });
  const detailRec = (r) => ({ ...lightRec(r), app: r.app, error: r.error, stats: r.stats, steps: r.steps.map((s, i) => ({ ...stepOf(s, i), shot: shot(s.shot) })) });

  const base = (scope) => ({ source: demo ? 'demo' : 'live', configured: !demo, needs, missing, isAdmin: scope.admin, clients: scope.admin ? [{ id: 'internal', name: nameOf('internal') }, ...clients()] : [], updatedAt: new Date().toISOString() });
  const libraryOf = (scope) => store.listWorkflows(scope).sort((a, c) => c.updatedAt.localeCompare(a.updatedAt));
  /** The workflow a workflow screen works on: the one chosen on any of them, else the most recently changed. */
  function current(pane, scope) {
    const list = libraryOf(scope);
    const w = list.find((x) => x.id === chosen(pane, scope)) || list[0] || null;
    return { list, w, picker: list.map(lightWf) };
  }
  const recentRuns = (scope, wfId, n = 5) => store.listRuns(scope, { workflowId: wfId, limit: n });

  // ---------- each screen's data ----------
  const PANE_DATA = {
    [PANES.record](scope) {
      const recs = store.listRecordings(scope);
      const cur = recs.find((r) => r.id === chosen(PANES.record, scope)) || recs.find((r) => r.state === 'recording') || recs[0] || null;
      const steps = cur ? cur.steps : [];
      return {
        columns: ['Step', 'Action', 'Target', 'Screenshot'],
        rows: steps.map((x, i) => [(i + 1) + '. ' + x.name, x.kind, [x.app, x.target, x.secret ? 'value redacted' : x.value, x.page].filter(Boolean).join(' · '), x.secret ? 'Withheld' : x.shot ? 'Captured' : 'None']),
        kinds: KINDS, capture: captureOf(cur), session: cur ? detailRec(cur) : null, recent: recs.slice(0, 8).map(lightRec)
      };
    },
    [PANES.typing](scope) {
      const { w, picker } = current(PANES.typing, scope);
      const typed = w ? w.steps.map((s, i) => stepOf(s, i)).filter((s) => ['type', 'select'].includes(s.kind)) : [];
      const pending = store.listRecordings(scope).filter((r) => r.state !== 'saved').flatMap((r) => r.steps.filter((s) => s.kind === 'type').map((s) => ({ recording: r.name, target: s.target, secret: s.secret })));
      return {
        columns: ['Field', 'Typed', 'Becomes', 'Where'],
        rows: typed.map((s) => [s.target || s.name, s.secret ? 'Kept secret' : s.variable ? '{{' + s.variable + '}}' : s.value, s.secret ? 'Asked at run time' : s.variable ? 'Variable' : 'Typed as recorded', [s.app, s.page].filter(Boolean).join(' · ')]),
        workflows: picker, selected: w ? { ...lightWf(w), variables: w.variables } : null, typed,
        summary: { typed: typed.length, secret: typed.filter((s) => s.secret).length, variables: typed.filter((s) => s.variable).length, plain: typed.filter((s) => !s.secret && !s.variable).length },
        suggestions: w ? store.suggestVariables(scope, w.id) : [], pending: pending.slice(0, 20)
      };
    },
    [PANES.pages](scope) {
      const { w, picker } = current(PANES.pages, scope);
      const last = w ? recentRuns(scope, w.id, 1)[0] || null : null;
      const steps = w ? w.steps.map((s, i) => stepOf(s, i)) : [];
      const stages = [];
      for (const s of steps) {
        const where = s.kind === 'navigate' ? 'page' : s.kind === 'app' ? 'app' : null;
        const top = stages[stages.length - 1];
        const replay = last ? last.steps.find((x) => x.id === s.id) : null;
        const r = replay ? { state: replay.state, message: replay.message, code: replay.code || '' } : null;
        if (where || !top) stages.push({ kind: where || 'start', app: s.app, page: s.kind === 'navigate' ? s.page : s.page || '', stepId: where ? s.id : null, idx: s.idx, title: where === 'page' ? s.page : where === 'app' ? s.app : s.app || 'Where the recording began', replay: where ? r : null, steps: where ? [] : [{ ...s, replay: r }] });
        else top.steps.push({ ...s, replay: r });
      }
      const alerts = w ? recentRuns(scope, w.id, 10).flatMap((run) => run.steps.filter((x) => x.state === 'failed' && LAYOUT_CODES.includes(x.code)).map((x) => ({ run: run.id, at: run.startedAt, step: x.name, idx: x.idx, code: x.code, message: x.message }))).slice(0, 8) : [];
      return {
        columns: ['Step', 'App', 'Page', 'Last replay'],
        rows: steps.map((s) => { const rp = last && last.steps.find((x) => x.id === s.id); return [(s.idx + 1) + '. ' + s.name, s.app, s.page, rp ? rp.state : 'Not run']; }),
        workflows: picker, selected: w ? lightWf(w) : null, stages, steps, alerts,
        lastRun: last ? { id: last.id, state: last.state, at: last.startedAt, word: WORD[last.state] || last.state } : null,
        summary: { apps: [...new Set(steps.map((s) => s.app).filter(Boolean))], pages: [...new Set(steps.map((s) => s.page).filter(Boolean))].length, changes: steps.filter((s) => ['navigate', 'app'].includes(s.kind)).length }
      };
    },
    [PANES.screens](scope) {
      const wfs = libraryOf(scope); const recs = store.listRecordings(scope); const runs = store.listRuns(scope, { limit: 15 });
      const src = chosen(PANES.screens, scope) || '';
      const [kind, id] = src.split(':');
      let source = null;
      if (kind === 'recording') { const r = recs.find((x) => x.id === id); if (r) source = { kind, id, name: r.name, owner: r }; }
      if (kind === 'run') { const r = runs.find((x) => x.id === id) || (() => { try { return store.getRun(scope, id); } catch { return null; } })(); if (r) source = { kind, id, name: r.name + ' · ' + (WORD[r.state] || r.state), owner: r }; }
      if (!source && kind === 'workflow') { const w = wfs.find((x) => x.id === id); if (w) source = { kind, id, name: w.name, owner: w }; }
      if (!source) { const w = wfs[0]; if (w) source = { kind: 'workflow', id: w.id, name: w.name, owner: w }; else if (recs[0]) source = { kind: 'recording', id: recs[0].id, name: recs[0].name, owner: recs[0] }; }
      const frames = !source ? [] : source.owner.steps.map((s, i) => source.kind === 'run'
        ? { stepId: s.id, idx: s.idx, name: s.name, kind: s.kind, state: s.state, shot: shot(s.shot), recorded: shot(s.refShot), note: s.shot ? '' : s.shotNote || (s.state === 'skipped' ? 'Not run' : 'No screenshot'), secret: s.secret }
        : { stepId: s.id, idx: i, name: s.name, kind: s.kind, state: null, shot: shot(s.shot), recorded: null, note: s.shot ? '' : s.shotNote || 'No screenshot', secret: s.secret });
      const withheld = frames.filter((f) => !f.shot && /withheld|removed/i.test(f.note)).length;
      const captured = frames.filter((f) => f.shot).length;
      return {
        columns: ['Step', 'Screenshot', 'Recorded', 'Note'],
        rows: frames.map((f) => [(f.idx + 1) + '. ' + f.name, f.shot ? 'Captured' : 'None', f.recorded ? 'Recorded' : '', f.note]),
        sources: { workflows: wfs.map((w) => ({ id: w.id, name: w.name, clientName: nameOf(w.client) })), recordings: recs.slice(0, 10).map(lightRec), runs: runs.map(lightRun) },
        source: source ? { kind: source.kind, id: source.id, name: source.name } : null, frames,
        coverage: { total: frames.length, captured, withheld, missing: frames.length - captured - withheld, pct: frames.length ? Math.round((captured / Math.max(1, frames.length - withheld)) * 100) : 100 }
      };
    },
    [PANES.workflows](scope) {
      const { list, w, picker } = current(PANES.workflows, scope);
      const ready = store.listRecordings(scope).filter((r) => r.state === 'stopped' && r.steps.length).map(lightRec);
      return {
        columns: ['Workflow', 'Steps', 'Schedule', 'Last run'],
        rows: list.map((x) => { const l = lightWf(x); return [l.name, String(l.steps), l.schedule, l.lastRun ? WORD[l.lastRun.state] : 'Never run']; }),
        triggers: TRIGGER_SOURCES, workflows: picker, recordings: ready,
        selected: w ? { ...lightWf(w), description: w.description, source: w.source, schedule: w.schedule, scheduleText: describeSchedule(w.schedule), scheduleValues: w.scheduleValues, trigger: w.trigger, variableList: w.variables.filter((v) => !v.secret), recentRuns: recentRuns(scope, w.id, 5).map(lightRun) } : null
      };
    },
    [PANES.steps](scope) {
      const { w, picker } = current(PANES.steps, scope);
      const focus = w ? (w.steps.find((s) => s.id === chosen('step', scope)) || w.steps[0] || null) : null;
      return {
        columns: ['Step', 'Action', 'Target', 'Value'],
        rows: w ? w.steps.map((s, i) => [(i + 1) + '. ' + s.name, s.kind, s.target, s.secret ? 'Kept secret' : s.value]) : [],
        kinds: KINDS, workflows: picker, selected: w ? { ...lightWf(w), variables: w.variables.map((v) => v.name) } : null,
        steps: w ? w.steps.map((s, i) => stepOf(s, i)) : [], focus: focus ? stepOf(focus, w.steps.indexOf(focus), true) : null
      };
    },
    [PANES.order](scope) {
      const { w, picker } = current(PANES.order, scope);
      const steps = w ? w.steps.map((s, i) => stepOf(s, i)) : [];
      return {
        columns: ['#', 'Step', 'Where', 'Checkpoint'],
        rows: steps.map((s) => [String(s.idx + 1), s.name, [s.app, s.page].filter(Boolean).join(' · '), s.approval ? 'Waits for approval' : '']),
        workflows: picker, selected: w ? lightWf(w) : null, steps,
        waits: steps.filter((s) => s.approval).map((s) => ({ idx: s.idx, name: s.name, note: s.approvalNote }))
      };
    },
    [PANES.variables](scope) {
      const { w, picker } = current(PANES.variables, scope);
      const steps = w ? w.steps.map((s, i) => stepOf(s, i)) : [];
      const usedBy = (name) => steps.filter((s) => [...refsIn(w.steps[s.idx].value), ...refsIn(s.target), ...refsIn(s.page)].includes(name.toLowerCase())).map((s) => ({ idx: s.idx, name: s.name }));
      const ready = builtinsReady() || {};
      return {
        columns: ['Variable', 'Label', 'Default', 'Used by'],
        rows: w ? w.variables.map((v) => ['{{' + v.name + '}}', v.label, v.secret ? 'Secret' : v.default || 'Asked at run time', String(usedBy(v.name).length)]) : [],
        workflows: picker, selected: w ? lightWf(w) : null,
        variables: w ? w.variables.map((v) => ({ ...v, usedBy: usedBy(v.name) })) : [],
        builtins: Object.entries(BUILTIN_VARS).map(([name, d]) => ({ name, label: d.label, saved: !!ready[name], usedBy: w ? usedBy(name) : [] })),
        bindable: steps.filter((s) => !s.secret && ['type', 'select', 'key', 'navigate'].includes(s.kind)).map((s) => ({ id: s.id, idx: s.idx, name: s.name, kind: s.kind, variable: s.variable, recorded: s.recorded || (s.variable ? '' : s.value) })),
        suggestions: w ? store.suggestVariables(scope, w.id) : [], scheduleValues: w ? w.scheduleValues : {}
      };
    },
    [PANES.run](scope) {
      const list = libraryOf(scope);
      const runs = store.listRuns(scope, { limit: 40 });
      const cur = runs.find((r) => r.id === chosen(PANES.run, scope)) || runs.find((r) => ['running', 'waiting'].includes(r.state)) || runs[0] || null;
      return {
        columns: ['Step', 'State', 'Time', 'Screenshot'],
        rows: cur ? cur.steps.map((x) => [(x.idx + 1) + '. ' + x.name, x.state, x.ms ? x.ms + ' ms' : '–', x.shot ? 'Captured' : 'None']) : [],
        workflows: list.map((w) => ({ ...lightWf(w), variableList: w.variables, usesLogin: w.steps.some((s) => /\{\{\s*login_(user|password)\s*\}\}/i.test(s.value + ' ' + s.target)) })),
        active: cur ? detailRun(cur) : null, recent: runs.slice(0, 6).map(lightRun), waiting: store.waiting(scope)
      };
    },
    [PANES.history](scope) {
      const runs = store.listRuns(scope, { limit: 100 });
      const cur = runs.find((r) => r.id === chosen(PANES.history, scope)) || null;
      const done = runs.filter((r) => ['passed', 'failed'].includes(r.state));
      return {
        columns: ['Workflow', 'Result', 'Started', 'Time'],
        rows: runs.map((r) => [r.name, WORD[r.state] || r.state, r.startedAt, (r.ms || 0) + ' ms']),
        runs: runs.map(lightRun), selected: cur ? detailRun(cur) : null, workflows: libraryOf(scope).map((w) => ({ id: w.id, name: w.name })),
        summary: { total: runs.length, passed: runs.filter((r) => r.state === 'passed').length, failed: runs.filter((r) => r.state === 'failed').length, stopped: runs.filter((r) => r.state === 'stopped').length, successRate: done.length ? Math.round((done.filter((r) => r.state === 'passed').length / done.length) * 100) : 100, last: runs[0] ? runs[0].startedAt : null }
      };
    }
  };

  function pane(id, ctx) {
    const scope = sc(ctx);
    const f = PANE_DATA[id];
    return f ? { ...base(scope), ...f(scope) } : null;
  }

  // ---------- each screen's buttons ----------
  const bool = (v) => v === true || v === 'true' || v === 'on';
  const valuesOf = (inp) => (inp.values && typeof inp.values === 'object' ? inp.values : {});
  const WF_ACTIONS = {
    rename: (s, wf, inp) => { store.renameWorkflow(s, wf, inp.name); return 'Workflow renamed'; },
    describe: (s, wf, inp) => { store.describeWorkflow(s, wf, inp.text); return 'Description saved'; },
    'step-rename': (s, wf, inp) => { store.renameStep(s, wf, String(inp.step), inp.name); return 'Step renamed'; },
    'step-move': (s, wf, inp) => {
      if (inp.to !== undefined && inp.to !== null && inp.to !== '') { store.moveStep(s, wf, String(inp.step), { to: Number(inp.to) }); return 'Step moved to position ' + (Number(inp.to) + 1); }
      store.moveStep(s, wf, String(inp.step), { by: Number(inp.by) }); return 'Step moved ' + (Number(inp.by) < 0 ? 'up' : 'down');
    },
    'step-update': (s, wf, inp) => { store.updateStep(s, wf, String(inp.step), Object.fromEntries(['target', 'value', 'optional', 'page', 'app'].filter((k) => inp[k] !== undefined).map((k) => [k, k === 'optional' ? bool(inp[k]) : inp[k]]))); return 'Step saved'; },
    'step-add': (s, wf, inp) => { store.addStep(s, wf, { kind: inp.kind, target: inp.target, value: inp.value, name: inp.name, after: inp.after || null, page: inp.page, app: inp.app }); return 'Step added'; },
    'step-delete': (s, wf, inp) => { store.deleteStep(s, wf, String(inp.step)); return 'Step removed'; },
    approval: (s, wf, inp) => { const on = bool(inp.on); store.setApproval(s, wf, String(inp.step), on, inp.note); return on ? 'Approval checkpoint set: the run waits here for someone to approve' : 'Approval checkpoint removed'; },
    'var-add': (s, wf, inp) => { store.addVariable(s, wf, { name: inp.name, label: inp.label, default: inp.default, secret: bool(inp.secret) }); return 'Variable {{' + String(inp.name).trim() + '}} added'; },
    'var-update': (s, wf, inp) => { store.updateVariable(s, wf, inp.name, { label: inp.label, default: inp.default }); return 'Variable {{' + inp.name + '}} saved'; },
    'var-remove': (s, wf, inp) => { store.removeVariable(s, wf, inp.name); return 'Variable removed'; },
    bind: (s, wf, inp) => { store.bindVariable(s, wf, String(inp.step), inp.variable || null, inp.original); return inp.variable ? 'Step now uses {{' + inp.variable + '}}' : 'Step types its recorded value again'; },
    'make-variable': (s, wf, inp) => {
      const w = store.getWorkflow(s, wf); const st = w.steps.find((x) => x.id === String(inp.step));
      if (!st) throw new RpaError('not-found', 'No such step');
      const name = String(inp.name || '').trim() || (st.target || st.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'v$1').slice(0, 32) || 'value';
      if (!w.variables.find((v) => v.name.toLowerCase() === name.toLowerCase())) store.addVariable(s, wf, { name, label: inp.label || st.target, default: '' });
      store.bindVariable(s, wf, st.id, name);
      return '"' + (st.target || st.name) + '" now asks for {{' + name + '}} on every run';
    },
    'make-secret': (s, wf, inp) => { store.makeSecret(s, wf, String(inp.step), inp.name); return 'Kept secret: the value is no longer stored and is asked for when the workflow runs'; },
    suggest: (s, wf) => {
      const sug = store.suggestVariables(s, wf);
      if (!sug.length) return 'No customer, PO or reference fields found to turn into variables';
      for (const x of sug) { store.addVariable(s, wf, { name: x.name, label: x.label, default: '' }); store.bindVariable(s, wf, x.stepId, x.name); }
      return sug.length + ' variable(s) created: ' + sug.map((x) => '{{' + x.name + '}}').join(', ');
    },
    'set-page': (s, wf, inp) => { store.updateStep(s, wf, String(inp.step), { page: inp.page }); return 'Page address saved'; },
    'set-app': (s, wf, inp) => { store.updateStep(s, wf, String(inp.step), { app: inp.app }); return 'App saved'; },
    'set-schedule': (s, wf, inp) => {
      const days = Array.isArray(inp.days) ? inp.days : String(inp.days || '').split(',').filter((x) => x !== '');
      store.setSchedule(s, wf, { kind: inp.kind, everyMin: inp.everyMin, at: inp.at, days, enabled: inp.enabled !== false && inp.enabled !== 'false' }, inp.values && typeof inp.values === 'object' ? inp.values : null);
      return 'Schedule saved: ' + describeSchedule(store.getWorkflow(s, wf).schedule);
    },
    'clear-schedule': (s, wf) => { store.clearSchedule(s, wf); return 'Schedule removed'; },
    'set-trigger': (s, wf, inp) => { store.setTrigger(s, wf, { kind: inp.kind, match: inp.match, map: parseMap(inp.map), enabled: inp.enabled !== false && inp.enabled !== 'false' }); return 'Trigger saved'; },
    'clear-trigger': (s, wf) => { store.clearTrigger(s, wf); return 'Trigger removed'; }
  };
  // which buttons each workflow screen offers
  const OFFERS = {
    [PANES.typing]: ['make-variable', 'make-secret', 'bind', 'suggest'],
    [PANES.pages]: ['set-page', 'set-app'],
    [PANES.workflows]: ['rename', 'describe', 'set-schedule', 'clear-schedule', 'set-trigger', 'clear-trigger'],
    [PANES.steps]: ['step-rename', 'step-update', 'step-add', 'step-delete'],
    [PANES.order]: ['step-move', 'approval'],
    [PANES.variables]: ['var-add', 'var-update', 'var-remove', 'bind', 'suggest']
  };

  async function act(id, action, input, ctx) {
    const scope = sc(ctx); const inp = input && typeof input === 'object' ? input : {};
    const done = (message, extra = {}) => ({ ok: true, message: message + (demo ? ' (demo)' : ''), data: pane(id, ctx), ...extra });
    const no = (message) => ({ ok: false, message, data: pane(id, ctx) });
    try {
      if (action === 'select') { pick(id, scope, String(inp.id || '')); return { ok: true, message: '', data: pane(id, ctx) }; }
      if (id === PANES.steps && action === 'focus') { pick('step', scope, String(inp.step || '')); return { ok: true, message: '', data: pane(id, ctx) }; }
      if (id === PANES.screens && action === 'pick') { pick(id, scope, String(inp.kind || '') + ':' + String(inp.id || '')); return { ok: true, message: '', data: pane(id, ctx) }; }
      if (id === PANES.record) {
        if (action === 'start') {
          const r = store.startRecording(scope, { name: inp.name, app: inp.app, client: inp.client });
          pick(id, scope, r.id);
          let st;
          try { st = await recorder.start(r); } catch (e) { st = { ok: false, message: String((e && e.message) || e) }; }
          if (!st || !st.ok) {
            const why = (st && st.message) || 'The desktop recorder did not start';
            store.denyRecording(scope, r.id, st && st.code === 'permission-denied' ? why : 'Recording could not start: ' + why);
            return no(store.getRecording(scope, r.id).error);
          }
          beginCapture(r.id, scope);
          return done(recorder.mode === 'desktop' ? 'Recording: the desktop agent is watching the screen. Do the task as you normally would' : 'Recording: the demo recorder plays a sample task');
        }
        if (action === 'event') {
          const sid = String(inp.session || '');
          const r = store.recordEvent(scope, sid, inp);
          return { ok: true, message: r.dropped ? (r.dropped === 'merged' ? 'Typing added to the previous step' : 'Ignored: the same action twice in a moment') : 'Step ' + store.getRecording(scope, sid).steps.length + ' added: ' + r.step.name, data: pane(id, ctx) };
        }
        if (action === 'pull') { const c = captures.get(String(inp.session || '')); if (!c) return no('This recording is not being captured'); const n = await pull(String(inp.session), c); return done(n ? n + ' new action(s) captured' : 'Nothing new on the screen yet'); }
        if (action === 'stop') { const sid = String(inp.session || ''); await finishCapture(scope, sid); const r = store.stopRecording(scope, sid); return done('Recording stopped with ' + r.steps.length + ' step(s)'); }
        if (action === 'discard') { const sid = String(inp.session || ''); await finishCapture(scope, sid); store.discardRecording(scope, sid); picked.delete(key(id, scope)); return done('Recording discarded'); }
        if (action === 'save') {
          const sid = String(inp.session || ''); await finishCapture(scope, sid);
          const wf = store.saveRecording(scope, sid, { name: inp.name }); pick(PANES.workflows, scope, wf.id);
          return done('Saved as workflow "' + wf.name + '" with ' + wf.steps.length + ' steps: edit it in Step editor, Order & checkpoints and Variables', { output: { workflow: wf.id } });
        }
        if (action === 'drop-shot') { store.dropShot(scope, { recording: String(inp.session || '') }, String(inp.step || ''), who(ctx).name); return done('Screenshot removed'); }
      }
      if (id === PANES.screens && action === 'drop-shot') {
        const [kind, sid] = String(inp.source || '').split(':');
        if (kind === 'run') return no('A run\'s screenshots are its evidence and stay with the run');
        store.dropShot(scope, kind === 'recording' ? { recording: sid } : { workflow: sid }, String(inp.step || ''), who(ctx).name);
        return done('Screenshot removed');
      }
      if (id === PANES.workflows) {
        const wf = String(inp.workflow || '');
        if (action === 'create') { const w = store.createWorkflow(scope, { name: inp.name, client: inp.client }); pick(id, scope, w.id); return done('Workflow "' + w.name + '" created: add its steps in Step editor'); }
        if (action === 'convert') { const sid = String(inp.session || ''); await finishCapture(scope, sid); const w = store.saveRecording(scope, sid, { name: inp.name }); pick(id, scope, w.id); return done('"' + w.name + '" is now a workflow with ' + w.steps.length + ' steps', { output: { workflow: w.id } }); }
        if (action === 'duplicate') { const c = store.duplicateWorkflow(scope, wf, { name: inp.name }); pick(id, scope, c.id); return done('Copied as "' + c.name + '"'); }
        if (action === 'assign') { const c = store.assignWorkflow(scope, wf, inp.client); return done('A copy was given to ' + nameOf(c.client), { output: { workflow: c.id } }); }
        if (action === 'delete') { store.deleteWorkflow(scope, wf); picked.delete(key(id, scope)); return done('Workflow deleted'); }
        if (action === 'test-trigger') {
          const w = store.getWorkflow(scope, wf);
          if (!w.trigger) return no('This workflow has no trigger yet');
          // a test event belongs to this workflow's client only
          const started = store.fireTrigger(w.trigger.kind, parseMap(inp.payload), { clients: [w.client] }).filter((r) => r.workflowId === w.id);
          if (!started.length) return { ok: true, message: 'The test event did not match this trigger (it needs "' + w.trigger.match + '")', data: pane(id, ctx) };
          pick(PANES.run, scope, started[0].id);
          return done('Trigger fired: ' + (started[0].state === 'failed' ? 'the run could not start (' + started[0].error + ')' : 'run started, watch it in Run a workflow'));
        }
      }
      if (OFFERS[id] && WF_ACTIONS[action] && OFFERS[id].includes(action)) {
        const wf = String(inp.workflow || '');
        return done(WF_ACTIONS[action](scope, wf, inp));
      }
      if (id === PANES.run) {
        if (action === 'start') { const r = store.startRun(scope, String(inp.workflow || ''), { values: valuesOf(inp), by: who(ctx) }); pick(id, scope, r.id); return done('Run started: ' + r.name); }
        if (action === 'stop') { store.stopRun(scope, String(inp.run || ''), who(ctx).name); return done('Stop requested: the run halts at this step'); }
        if (action === 'approve') {
          const yes = bool(inp.approve);
          store.decide(scope, String(inp.run || ''), String(inp.step || ''), yes, { by: who(ctx).name, note: inp.note });
          return done(yes ? 'Approved: the run continues' : 'Rejected: the run stops');
        }
      }
      if (id === PANES.history) {
        if (action === 'resume') { const r = store.resumeRun(scope, String(inp.run || ''), { values: valuesOf(inp), by: who(ctx) }); pick(PANES.run, scope, r.id); return done('Continuing from the step that failed: watch it in Run a workflow'); }
        if (action === 'rerun') {
          const old = store.getRun(scope, String(inp.run || ''));
          const r = store.startRun(scope, old.workflowId, { values: { ...old.values, ...valuesOf(inp) }, by: who(ctx) });
          pick(PANES.run, scope, r.id); return done('Started again from the first step: watch it in Run a workflow');
        }
      }
    } catch (e) {
      if (e instanceof RpaError) return no(e.message);
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

  // ---------- numbers: always for the person asking ----------
  function metrics(ctx) {
    const s = store.stats(sc(ctx));
    const m = (k, label, value, unit, good, pane) => ({ key: k, label, value, unit, trend: [value], good, pane });
    return [
      { key: 'wfRuns', label: 'Workflow runs today', value: s.today, unit: '', trend: s.hours.values, good: 'up', pane: PANES.history },
      m('wfSuccess', 'Workflow success rate', s.successRate, '%', 'up', PANES.history),
      m('wfAvg', 'Avg workflow run time', s.avgSeconds, 's', 'down', PANES.history),
      m('wfErrors', 'Workflow failures', s.failed, '', 'down', PANES.history),
      m('wfRecorded', 'Steps recorded', s.recordedSteps, '', 'up', PANES.record),
      m('wfTyped', 'Typed inputs', s.typed, '', 'up', PANES.typing),
      m('wfPageChanges', 'App and page changes', s.pageChanges, '', 'up', PANES.pages),
      m('wfShotCoverage', 'Screenshot coverage', s.shotCoverage, '%', 'up', PANES.screens),
      m('wfCount', 'Workflows trained', s.workflows, '', 'up', PANES.workflows),
      m('wfScheduled', 'On a schedule or trigger', s.scheduled, '', 'up', PANES.workflows),
      m('wfSteps', 'Workflow steps', s.steps, '', 'up', PANES.steps),
      m('wfApprovals', 'Approval checkpoints', s.approvals, '', 'up', PANES.order),
      m('wfVariables', 'Variables', s.variables, '', 'up', PANES.variables),
      m('wfWaiting', 'Waiting for approval', s.waiting, '', 'down', PANES.run)
    ];
  }
  function panels(ctx) {
    const s = store.stats(sc(ctx));
    return [
      { title: 'Workflow runs, last 24 hours', kind: 'line', labels: s.hours.labels, series: [{ name: 'Runs', values: s.hours.values }], pane: PANES.history },
      { title: 'Workflow results', kind: 'bar', labels: ['Passed', 'Failed', 'Stopped'], series: [{ name: 'Runs', values: [s.passed, s.failed, s.stopped] }], pane: PANES.history }
    ];
  }
  function states(ctx) {
    const s = store.stats(sc(ctx));
    const pl = (n, a, b) => n + ' ' + (n === 1 ? a : b);
    const none = { state: 'idle', text: 'No workflows yet' };
    const out = {
      [PANES.record]: s.recording ? { state: 'ok', text: 'Recording now' } : s.recordedSteps ? { state: 'ok', text: pl(s.recordedSteps, 'step', 'steps') + ' recorded' } : { state: 'idle', text: 'Nothing recorded yet' },
      [PANES.typing]: !s.workflows ? none : { state: 'ok', text: pl(s.typed, 'typed input', 'typed inputs') + ', ' + s.bound + ' as variables, ' + s.secrets + ' secret' },
      [PANES.pages]: !s.workflows ? none : { state: 'ok', text: pl(s.pageChanges, 'app or page change', 'app and page changes') },
      [PANES.screens]: !s.workflows ? none : { state: s.shotCoverage < 60 ? 'warn' : 'ok', text: s.shotCoverage + '% of steps have a screenshot' },
      [PANES.workflows]: s.workflows ? { state: 'ok', text: pl(s.workflows, 'workflow', 'workflows') + (s.scheduled ? ', ' + s.scheduled + ' automatic' : '') } : none,
      [PANES.steps]: !s.workflows ? none : { state: 'ok', text: pl(s.steps, 'step', 'steps') + ' across ' + pl(s.workflows, 'workflow', 'workflows') },
      [PANES.order]: !s.workflows ? none : { state: 'ok', text: s.approvals ? pl(s.approvals, 'approval checkpoint', 'approval checkpoints') : 'No approval checkpoints' },
      [PANES.variables]: !s.workflows ? none : { state: 'ok', text: pl(s.variables, 'variable', 'variables') },
      [PANES.run]: s.waiting ? { state: 'warn', text: pl(s.waiting, 'run waits', 'runs wait') + ' for approval' } : s.running ? { state: 'ok', text: pl(s.running, 'run', 'runs') + ' working' } : { state: 'ok', text: 'Ready to run' },
      [PANES.history]: !s.runs ? { state: 'idle', text: 'No runs yet' } : s.successRate < 80 ? { state: 'bad', text: s.successRate + '% success, ' + pl(s.failed, 'failure', 'failures') } : s.failed ? { state: 'warn', text: s.successRate + '% success, ' + pl(s.failed, 'failure', 'failures') } : { state: 'ok', text: s.successRate + '% success over ' + pl(s.runs, 'run', 'runs') }
    };
    if (demo) for (const k of Object.keys(out)) out[k] = { ...out[k], demo: true };
    return out;
  }
  /** Test hook and shutdown: take one round of new actions from every recording being captured. */
  async function pumpAll() { let n = 0; for (const [id, c] of [...captures]) n += (await pull(id, c)) || 0; return n; }
  return { pane, act, run, metrics, panels, states, store, pumpAll, captures };
}
