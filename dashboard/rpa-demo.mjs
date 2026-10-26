// Seeded demo for the Workflow Automation screens: two business customers (Harlow Build, Northbeam Architects), each with
// their own trained workflows, a week of runs (a few failing, one stopped, one resumed) and a half-finished recording.
// Everything is in memory; steps are simulated, so buttons work before any automation agent is connected. The demo
// recorder stands in for the desktop agent: while a recording runs it hands over one action of a sample task per poll,
// with an illustration of the screen where the real agent sends its screen capture.
import { RpaStore, demoDriver, renderShot } from '../src/rpa.mjs';
import { createRpa } from './rpa-panes.mjs';

export const DEMO_CLIENTS = [{ id: 'demo-harlow', name: 'Harlow Build' }, { id: 'demo-northbeam', name: 'Northbeam Architects' }];
const HARLOW = DEMO_CLIENTS[0].id, NORTH = DEMO_CLIENTS[1].id;

/** The sample task the demo recorder "watches": a site manager raising an RFI in Procore. */
export const SAMPLE_EVENTS = [
  { kind: 'app', app: 'Safari' },
  { kind: 'navigate', page: 'https://app.procore.example/harlow/rfis/new?session=demo', app: 'Safari' },
  { kind: 'click', target: 'Sign in', app: 'Safari' },
  { kind: 'type', target: 'Password', value: 'not-kept', inputType: 'password', sensitive: true, app: 'Safari' },
  { kind: 'type', target: 'RFI subject', value: 'Slab edge detail at gridline C', app: 'Safari' },
  { kind: 'type', target: 'Customer name', value: 'Harlow Build', app: 'Safari' },
  { kind: 'select', target: 'Priority', value: 'High', app: 'Safari' },
  { kind: 'click', target: 'Create RFI', app: 'Safari' },
  { kind: 'app', app: 'Outlook' },
  { kind: 'click', target: 'Send', app: 'Outlook' }
];
/** An illustration of the screen for a demo action (the desktop agent sends a real capture instead). */
const pictured = (e) => (e.sensitive ? { ...e, value: '' } : { ...e, screenshot: renderShot({ ...e, name: e.target || e.page || e.app }) });

/** Stands in for the desktop agent in Record mode: one action of the sample task per poll, then nothing more. */
export function demoRecorder(events = SAMPLE_EVENTS) {
  const sessions = new Map();
  return {
    mode: 'demo',
    start: async (rec) => { sessions.set(rec.id, 0); return { ok: true }; },
    stop: async (rec) => { sessions.delete(rec.id); return { ok: true }; },
    pull: async (rec, after) => {
      if (!sessions.has(rec.id)) return { ok: false, message: 'The demo recorder is not watching this recording' };
      const i = Number(after) || 0;
      if (i >= events.length) return { ok: true, events: [], next: i };
      return { ok: true, events: [pictured({ ...events[i], at: Date.now() })], next: i + 1 };
    }
  };
}

function build(now) {
  const store = new RpaStore({ driver: demoDriver({ latencyMs: 350 }), settings: () => ({ stepDelayMs: 300, maxRetries: 1, approvalTimeoutMs: 3600000, builtins: { login_user: 'demo', login_password: 'demo' } }), now });
  const rec = (scope, name, app, events) => {
    const r = store.startRecording(scope, { name, app, client: scope.admin ? HARLOW : '' });
    events.forEach((e, i) => store.recordEvent(scope, r.id, pictured({ ...e, at: 1000 + i * 4000 })));
    return r;
  };
  const make = (client, name, events, vars, bind, approvalAt) => {
    const scope = { admin: false, client };
    const r = rec(scope, name, events[0].app || '', events);
    const wf = store.saveRecording(scope, r.id, { name });
    for (const v of vars) store.addVariable(scope, wf.id, v);
    for (const [idx, v] of bind) store.bindVariable(scope, wf.id, wf.steps[idx].id, v);
    for (const idx of approvalAt) store.setApproval(scope, wf.id, wf.steps[idx].id, true, 'Check the amount before it is sent');
    return store.getWorkflow(scope, wf.id);
  };
  const po = make(HARLOW, 'Raise purchase order', [
    { kind: 'app', app: 'Procore' }, { kind: 'navigate', page: 'https://app.procore.example/harlow/commitments/new' },
    { kind: 'type', target: 'Customer name', value: 'Steelwerks Ltd' }, { kind: 'type', target: 'PO number', value: 'PO-4471' },
    { kind: 'select', target: 'Terms', value: 'Net 30' }, { kind: 'click', target: 'Submit for approval' }
  ], [{ name: 'customer_name', label: 'Customer name' }, { name: 'po_number', label: 'PO number' }], [[2, 'customer_name'], [3, 'po_number']], [5]);
  const prog = make(HARLOW, 'Download the weekly programme', [
    { kind: 'app', app: 'Chrome' }, { kind: 'navigate', page: 'https://portal.contractor.example/programme' },
    { kind: 'click', target: 'Latest programme' }, { kind: 'click', target: 'Download PDF' }
  ], [], [], []);
  const chase = make(HARLOW, 'Chase an overdue invoice', [
    { kind: 'app', app: 'Outlook' }, { kind: 'click', target: 'New message' }, { kind: 'type', target: 'To', value: 'accounts@steelwerks.example' },
    { kind: 'type', target: 'Subject', value: 'Overdue: Invoice 7731' }, { kind: 'click', target: 'Send' }
  ], [{ name: 'supplier_email', label: 'Supplier email' }, { name: 'invoice_ref', label: 'Invoice reference' }], [[2, 'supplier_email'], [3, 'invoice_ref']], [4]);
  const dwg = make(NORTH, 'File a drawing revision', [
    { kind: 'app', app: 'Revit' }, { kind: 'click', target: 'Publish sheets' }, { kind: 'type', target: 'Drawing number', value: 'A-101' },
    { kind: 'select', target: 'Revision', value: 'C' }, { kind: 'click', target: 'Issue to site' }
  ], [{ name: 'drawing_number', label: 'Drawing number' }, { name: 'revision', label: 'Revision', default: 'C' }], [[2, 'drawing_number'], [3, 'revision']], []);
  const rfi = make(NORTH, 'Update the RFI log', [
    { kind: 'app', app: 'Excel' }, { kind: 'navigate', page: 'https://sharepoint.example/northbeam/rfi-log' }, { kind: 'type', target: 'RFI reference', value: 'RFI-122' }, { kind: 'click', target: 'Save' }
  ], [{ name: 'rfi_reference', label: 'RFI reference' }], [[2, 'rfi_reference']], []);

  store.setSchedule({ admin: false, client: HARLOW }, po.id, { kind: 'weekly', at: '07:30', days: [1] }, { customer_name: 'Steelwerks Ltd', po_number: 'PO-WEEKLY' });
  store.setTrigger({ admin: false, client: HARLOW }, prog.id, { kind: 'folder', match: 'programme' });
  store.setTrigger({ admin: false, client: HARLOW }, chase.id, { kind: 'inbox', match: 'overdue', map: { invoice_ref: 'subject' } });
  store.setSchedule({ admin: false, client: NORTH }, rfi.id, { kind: 'daily', at: '17:00' }, { rfi_reference: 'RFI-LOG' });

  // a week of history, oldest first
  const seed = (wf, hoursAgo, state, { failAt = -1, by = 'Schedule', trigger = 'schedule', error = null, resumeOf = null } = {}) => {
    const started = now() - hoursAgo * 3600000; const ms = 2800 + wf.steps.length * 900;
    const run = {
      id: 'run-seed-' + store.state.runs.length, workflowId: wf.id, name: wf.name, client: wf.client, version: wf.version, state, trigger, by: { id: 'seed', name: by },
      startedAt: new Date(started).toISOString(), endedAt: new Date(started + ms).toISOString(), ms, error, resumeOf, values: {}, secretNames: [],
      steps: wf.steps.map((s, i) => {
        const st = state === 'passed' ? 'passed' : i < failAt ? 'passed' : i === failAt ? (state === 'stopped' ? 'stopped' : 'failed') : 'skipped';
        const sh = 'shot-seed-' + store.state.runs.length + '-' + i;
        store.state.shots[sh] = renderShot(s, st === 'failed' ? 'failed' : 'ok');
        return { id: s.id, idx: i, name: s.name, kind: s.kind, target: s.target, value: s.value, page: s.page || '', app: s.app || '', code: st === 'failed' && /Could not find/.test(error || '') ? 'target-missing' : '', approval: s.approval, approvalNote: s.approvalNote, optional: false, secret: false, state: st, message: st === 'passed' ? 'Done' : st === 'failed' ? (error || 'The step failed') : st === 'stopped' ? 'Stopped by Dana during this step' : 'Not run: an earlier step failed', ms: st === 'passed' ? 700 + i * 120 : 0, attempts: st === 'skipped' ? 0 : st === 'failed' ? 2 : 1, refShot: s.shot, shot: sh, startedAt: new Date(started + i * 900).toISOString() };
      }),
      log: []
    };
    const at = (off) => new Date(started + off).toISOString();
    run.log.push({ at: at(0), level: 'info', text: 'Run started (' + trigger + ') by ' + by });
    run.steps.forEach((s, i) => { if (s.state === 'passed') run.log.push({ at: at(500 + i * 900), level: 'info', text: 'Step ' + (i + 1) + ' passed: ' + s.name }); });
    if (state === 'failed') { run.log.push({ at: at(900 * failAt + 500), level: 'warn', text: 'Step ' + (failAt + 1) + ' attempt 1 failed: ' + error }); run.log.push({ at: at(900 * failAt + 1500), level: 'error', text: 'Step ' + (failAt + 1) + ' "' + wf.steps[failAt].name + '" failed (the page layout may have changed): ' + error }); }
    if (state === 'stopped') run.log.push({ at: at(900 * failAt + 400), level: 'warn', text: 'Stop requested by Dana' });
    run.log.push({ at: at(ms), level: state === 'passed' ? 'info' : state === 'stopped' ? 'warn' : 'error', text: 'Run ' + state + ' in ' + Math.round(ms / 100) / 10 + ' s' });
    store.state.runs.push(run);
    return run;
  };
  const wfs = [po, prog, chase, dwg, rfi].map((w) => store.state.workflows.find((x) => x.id === w.id));
  const [wPo, wProg, wChase, wDwg, wRfi] = wfs;
  const val = { customer_name: 'Steelwerks Ltd', po_number: 'PO-4471' };
  const layout = 'Could not find "Submit for approval" on the page';
  const seedRuns = [
    [150, wProg, 'passed', { trigger: 'trigger: folder', by: 'Trigger' }], [130, wRfi, 'passed'], [110, wPo, 'passed', { trigger: 'manual', by: 'Dana (Harlow ops)' }],
    [86, wDwg, 'passed', { trigger: 'manual', by: 'Priya Shah' }], [62, wRfi, 'passed'], [49, wChase, 'failed', { failAt: 3, trigger: 'trigger: inbox', by: 'Trigger', error: 'Field "Subject" is read only' }],
    [38, wProg, 'passed', { trigger: 'trigger: folder', by: 'Trigger' }], [29, wRfi, 'failed', { failAt: 2, error: 'Could not find "RFI reference" on the page' }], [27, wPo, 'failed', { failAt: 5, trigger: 'manual', by: 'Dana (Harlow ops)', error: layout }],
    [26, wPo, 'passed', { trigger: 'resume', by: 'Dana (Harlow ops)' }], [18, wDwg, 'stopped', { failAt: 3, trigger: 'manual', by: 'Priya Shah' }], [14, wRfi, 'passed'], [9, wDwg, 'passed', { trigger: 'manual', by: 'Priya Shah' }], [5, wProg, 'passed', { trigger: 'trigger: folder', by: 'Trigger' }],
    [2.5, wPo, 'passed', { trigger: 'manual', by: 'Fayez N.' }], [1.2, wChase, 'passed', { trigger: 'trigger: inbox', by: 'Trigger' }]
  ];
  for (const [h, w, s, o] of seedRuns) { const r = seed(w, h, s, o || {}); if (w === wPo) r.values = val; }
  store.state.runs.find((r) => r.trigger === 'resume').resumeOf = store.state.runs.find((r) => r.error === layout).id;
  // an unfinished recording for the owner's Record screen
  const owner = { admin: true };
  const r = store.startRecording(owner, { name: 'Close out a snag', app: 'Fieldwire', client: HARLOW });
  [{ kind: 'app', app: 'Fieldwire' }, { kind: 'click', target: 'Snag list' }, { kind: 'type', target: 'Snag reference', value: 'SNG-204' }].forEach((e, i) => store.recordEvent(owner, r.id, pictured({ ...e, at: 1000 + i * 4000 })));
  store.stopRecording(owner, r.id);
  // Give the library a stable initial selection. The seeded workflows are created within a few milliseconds,
  // so sorting by their unadjusted updatedAt could otherwise open a workflow with no typed inputs.
  [po, chase, dwg, rfi, prog].forEach((w, i) => {
    const saved = store.state.workflows.find((x) => x.id === w.id);
    saved.updatedAt = new Date(now() - i * 60000).toISOString();
  });
  return store;
}

let cached = null;
/** The one in-memory demo store and its screens (created on first use so importing this file costs nothing). */
export function demoRpa() {
  if (cached) return cached;
  const store = build(Date.now);
  cached = createRpa({
    store, demo: true, clients: () => DEMO_CLIENTS, demoClient: HARLOW, recorder: demoRecorder(),
    needs: 'Run the desktop automation agent on your Mac and add its address and token in Connections', missing: ['Agent address', 'Agent token'],
    builtinsReady: () => ({ login_user: true, login_password: true })
  });
  return cached;
}
