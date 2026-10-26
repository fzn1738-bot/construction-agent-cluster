// Workflow automation engine: recording, editing, variables, approvals, runs, schedules, triggers and client isolation.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { RpaStore, RpaError, demoDriver, agentDriver, nextOccurrence, renderShot, validShot, cleanPage } from '../src/rpa.mjs';

const ADMIN = { admin: true };
const acme = { admin: false, client: 'acme' };
const globex = { admin: false, client: 'globex' };
const make = (o = {}) => new RpaStore({ driver: demoDriver(), settings: () => ({ stepDelayMs: 0, maxRetries: 0, builtins: {} }), ...o });
const throwsCode = (fn, code) => assert.throws(fn, (e) => e instanceof RpaError && e.code === code, 'expected ' + code);

function recorded(store, scope = acme) {
  const rec = store.startRecording(scope, { name: 'Raise PO', app: 'Procurement' });
  const ev = (e) => store.recordEvent(scope, rec.id, { at: 1000 + (ev.n = (ev.n || 0) + 5000), ...e });
  ev({ kind: 'app', app: 'Chrome' });
  ev({ kind: 'navigate', page: 'https://erp.example/orders/new?token=abc123#x' });
  ev({ kind: 'type', target: 'Customer name', value: 'Harlow Build' });
  ev({ kind: 'type', target: 'PO number', value: 'PO-1001' });
  ev({ kind: 'click', target: 'Save' });
  return { rec, ev };
}

test('F1/F2/F3: record mode captures clicks, typing, app and page changes in order', () => {
  const s = make(); const { rec } = recorded(s);
  const got = s.getRecording(acme, rec.id);
  assert.deepEqual(got.steps.map((x) => x.kind), ['app', 'navigate', 'type', 'type', 'click']);
  assert.equal(got.steps[0].name, 'Switch to Chrome');
  assert.equal(got.steps[1].page, 'https://erp.example/orders/new', 'query string and fragment (tokens) are stripped');
  assert.equal(got.steps[2].name, 'Type into "Customer name"');
  assert.equal(got.stats.events, 5);
});

test('F2: typing in the same field merges into one step; double-fired events are dropped', () => {
  const s = make(); const rec = s.startRecording(acme, { name: 'x' });
  s.recordEvent(acme, rec.id, { kind: 'type', target: 'Notes', value: 'He', at: 1000 });
  const m = s.recordEvent(acme, rec.id, { kind: 'type', target: 'Notes', value: 'Hello', at: 1200 });
  assert.equal(m.dropped, 'merged');
  s.recordEvent(acme, rec.id, { kind: 'click', target: 'Go', at: 5000 });
  const d = s.recordEvent(acme, rec.id, { kind: 'click', target: 'Go', at: 5100 });
  assert.equal(d.dropped, 'duplicate');
  const again = s.recordEvent(acme, rec.id, { kind: 'click', target: 'Go', at: 9000 });
  assert.equal(again.dropped, null, 'a deliberate second click later is kept');
  const got = s.getRecording(acme, rec.id);
  assert.equal(got.steps.length, 3);
  assert.equal(got.steps[0].value, 'Hello');
  assert.deepEqual([got.stats.merged, got.stats.duplicates], [1, 1]);
  s.recordEvent(acme, rec.id, { kind: 'navigate', page: '/a', at: 20000 });
  assert.equal(s.recordEvent(acme, rec.id, { kind: 'navigate', page: '/a?x=1', at: 30000 }).dropped, 'duplicate');
});

test('F3: bad events are refused with a clear message', () => {
  const s = make(); const rec = s.startRecording(acme, {});
  throwsCode(() => s.recordEvent(acme, rec.id, { kind: 'teleport', target: 'x' }), 'bad-event');
  throwsCode(() => s.recordEvent(acme, rec.id, { kind: 'click' }), 'bad-event');
  s.stopRecording(acme, rec.id);
  throwsCode(() => s.recordEvent(acme, rec.id, { kind: 'click', target: 'x' }), 'not-recording');
  throwsCode(() => s.startRecording(acme, {}) && s.startRecording(acme, {}), 'busy');
});

test('F4: every step keeps a screenshot; real ones are stored, unusable ones fall back to a schematic', () => {
  const s = make(); const rec = s.startRecording(acme, {});
  const real = 'data:image/png;base64,iVBORw0KGgo=';
  const a = s.recordEvent(acme, rec.id, { kind: 'click', target: 'Open', screenshot: real, at: 1000 });
  const b = s.recordEvent(acme, rec.id, { kind: 'click', target: 'Next', screenshot: 'javascript:alert(1)', at: 9000 });
  const c = s.recordEvent(acme, rec.id, { kind: 'click', target: 'Huge', screenshot: 'data:image/png;base64,' + 'A'.repeat(300000), at: 20000 });
  assert.equal(s.shotData(a.step.shot), real);
  for (const x of [b, c]) { assert.ok(validShot(s.shotData(x.step.shot))); assert.match(x.step.shotNote, /could not be used/); }
  assert.ok(s.getRecording(acme, rec.id).steps.every((x) => x.shot));
  assert.equal(validShot(renderShot({ name: '<b>x</b>', kind: 'click' })), true);
  assert.equal(cleanPage('https://a.example/p?token=1'), 'https://a.example/p');
});

test('F2/F4: passwords and private steps are redacted and their screenshots withheld', () => {
  const s = make(); const rec = s.startRecording(acme, {});
  const a = s.recordEvent(acme, rec.id, { kind: 'type', target: 'Password', value: 'hunter2', screenshot: 'data:image/png;base64,AAAA', at: 1000 });
  const b = s.recordEvent(acme, rec.id, { kind: 'type', target: 'Card number', value: '4111111111111111', at: 9000 });
  const c = s.recordEvent(acme, rec.id, { kind: 'type', target: 'Search', value: 'x', inputType: 'password', at: 20000 });
  const d = s.recordEvent(acme, rec.id, { kind: 'click', target: 'Inbox', private: true, at: 30000 });
  for (const x of [a, b, c]) { assert.equal(x.step.secret, true); assert.match(x.step.value, /^\{\{\w+\}\}$/); assert.equal(x.step.shot, null); assert.match(x.step.shotNote, /withheld/); }
  assert.equal(a.step.value, '{{login_password}}');
  assert.equal(d.step.shot, null);
  assert.ok(!JSON.stringify(s.state).includes('hunter2') && !JSON.stringify(s.state).includes('4111111111111111'));
  const wf = s.saveRecording(acme, rec.id, { name: 'Login' });
  assert.ok(wf.variables.find((v) => v.name === 'card_number_secret' && v.secret));
  throwsCode(() => s.updateStep(acme, wf.id, wf.steps[0].id, { value: 'plain' }), 'secret');
});

test('permission denied ends the recording with a message and records nothing', () => {
  const s = make(); const rec = s.startRecording(acme, {});
  const d = s.denyRecording(acme, rec.id, '');
  assert.equal(d.state, 'denied'); assert.match(d.error, /permission/i);
  throwsCode(() => s.recordEvent(acme, rec.id, { kind: 'click', target: 'x' }), 'denied');
  throwsCode(() => s.saveRecording(acme, rec.id, {}), 'denied');
  assert.doesNotThrow(() => s.startRecording(acme, {}), 'a new recording can start after a denial');
});

test('F5: saving a recording makes an editable workflow; empty recordings cannot be saved', () => {
  const s = make(); const { rec } = recorded(s);
  const wf = s.saveRecording(acme, rec.id, { name: 'Raise PO' });
  assert.equal(wf.steps.length, 5); assert.equal(wf.client, 'acme'); assert.equal(wf.source, rec.id);
  assert.ok(wf.steps.every((x) => x.id && x.name && x.shot));
  throwsCode(() => s.saveRecording(acme, rec.id, {}), 'saved');
  const empty = s.startRecording(globex, {}); throwsCode(() => s.saveRecording(globex, empty.id, {}), 'empty');
  assert.equal(s.getRecording(acme, rec.id).state, 'saved');
});

test('F6/F7: steps are renamed and reordered, and the edits persist across a restart', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-')), 'w.json');
  const s = make({ file }); const { rec } = recorded(s);
  const wf = s.saveRecording(acme, rec.id, { name: 'Raise PO' });
  const [a, , c, d, e] = wf.steps;
  s.renameWorkflow(acme, wf.id, 'Raise purchase order');
  s.renameStep(acme, wf.id, c.id, 'Enter the customer');
  s.moveStep(acme, wf.id, e.id, { to: 0 });
  s.moveStep(acme, wf.id, d.id, { by: -1 });
  throwsCode(() => s.moveStep(acme, wf.id, a.id, { by: -9 }), 'bad-position');
  throwsCode(() => s.renameStep(acme, wf.id, c.id, '  '), 'bad-name');
  const back = new RpaStore({ file, driver: demoDriver() }).getWorkflow(acme, wf.id);
  assert.equal(back.name, 'Raise purchase order');
  assert.equal(back.steps.find((x) => x.id === c.id).name, 'Enter the customer');
  assert.deepEqual(back.steps.map((x) => x.id), [e.id, a.id, wf.steps[1].id, d.id, c.id]);
  assert.equal(back.version, wf.version + 4);
  s.deleteStep(acme, wf.id, a.id); s.addStep(acme, wf.id, { kind: 'click', target: 'Submit', after: e.id });
  const edited = s.getWorkflow(acme, wf.id);
  assert.equal(edited.steps.length, 5); assert.equal(edited.steps[1].name, 'Click "Submit"');
});

test('F8: variables are defined, bound to steps, suggested, and refuse to dangle', () => {
  const s = make(); const { rec } = recorded(s);
  const wf = s.saveRecording(acme, rec.id, {});
  const sug = s.suggestVariables(acme, wf.id);
  assert.deepEqual(sug.map((x) => x.name), ['customer_name', 'po_number']);
  throwsCode(() => s.bindVariable(acme, wf.id, wf.steps[2].id, 'customer_name'), 'unknown-variable');
  s.addVariable(acme, wf.id, { name: 'customer_name', label: 'Customer name' });
  s.addVariable(acme, wf.id, { name: 'po_number' });
  throwsCode(() => s.addVariable(acme, wf.id, { name: 'po_number' }), 'bad-variable');
  throwsCode(() => s.addVariable(acme, wf.id, { name: '9bad' }), 'bad-variable');
  throwsCode(() => s.addVariable(acme, wf.id, { name: 'pw', secret: true, default: 'x' }), 'bad-variable');
  s.bindVariable(acme, wf.id, wf.steps[2].id, 'customer_name');
  s.bindVariable(acme, wf.id, wf.steps[3].id, 'po_number');
  assert.equal(s.getWorkflow(acme, wf.id).steps[2].value, '{{customer_name}}');
  throwsCode(() => s.removeVariable(acme, wf.id, 'po_number'), 'in-use');
  throwsCode(() => s.updateStep(acme, wf.id, wf.steps[3].id, { value: '{{nope}}' }), 'unknown-variable');
  s.bindVariable(acme, wf.id, wf.steps[3].id, null, 'PO-1');
  assert.doesNotThrow(() => s.removeVariable(acme, wf.id, 'po_number'));
});

function ready(s, scope = acme, defaults = {}) {
  const { rec } = recorded(s, scope);
  const wf = s.saveRecording(scope, rec.id, { name: 'Raise PO' });
  s.addVariable(scope, wf.id, { name: 'customer_name', default: defaults.customer || '' }); s.addVariable(scope, wf.id, { name: 'po_number' });
  s.bindVariable(scope, wf.id, wf.steps[2].id, 'customer_name'); s.bindVariable(scope, wf.id, wf.steps[3].id, 'po_number');
  return s.getWorkflow(scope, wf.id);
}

test('Run mode: replays each step with a screenshot and pass/fail, filling variables', async () => {
  const seen = [];
  const s = make({ driver: { perform: async (step) => { seen.push(step); return { ok: true, message: 'ok' }; } } });
  const wf = ready(s);
  throwsCode(() => s.startRun(acme, wf.id, { values: { customer_name: 'Harlow' } }), 'missing-variable');
  const run = s.startRun(acme, wf.id, { values: { customer_name: 'Harlow Build', po_number: 'PO-77' } });
  await s.whenIdle(run.id);
  const done = s.getRun(acme, run.id);
  assert.equal(done.state, 'passed');
  assert.deepEqual(done.steps.map((x) => x.state), Array(5).fill('passed'));
  assert.ok(done.steps.every((x) => validShot(s.shotData(x.shot))));
  assert.equal(seen[2].value, 'Harlow Build'); assert.equal(seen[3].value, 'PO-77');
  assert.deepEqual(done.values, { customer_name: 'Harlow Build', po_number: 'PO-77' });
  assert.ok(done.log.length >= 6);
});

test('Run mode: a failing step stops the run, retries are logged, layout change is explained', async () => {
  let calls = 0;
  const s = make({ settings: () => ({ stepDelayMs: 0, maxRetries: 2 }), driver: { perform: async (step) => { if (step.target === 'Save') { calls++; return { ok: false, code: 'target-missing', message: 'No element "Save"' }; } return { ok: true }; } } });
  const wf = ready(s);
  const run = s.startRun(acme, wf.id, { values: { customer_name: 'a', po_number: 'b' } }); await s.whenIdle(run.id);
  const r = s.getRun(acme, run.id);
  assert.equal(r.state, 'failed'); assert.equal(calls, 3);
  assert.equal(r.steps[4].state, 'failed'); assert.equal(r.steps[4].attempts, 3);
  assert.match(r.error, /layout may have changed/);
  assert.equal(r.log.filter((l) => l.level === 'warn').length, 3);
  assert.equal(s.stats(ADMIN).failed, 1);
});

test('Run mode: resume continues from the failed step and keeps earlier work', async () => {
  let broken = true; const calls = [];
  const s = make({ driver: { perform: async (step) => { calls.push(step.name); return broken && step.target === 'Save' ? { ok: false, message: 'down' } : { ok: true }; } } });
  const wf = ready(s);
  const a = s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } }); await s.whenIdle(a.id);
  broken = false; calls.length = 0;
  const b = s.resumeRun(acme, a.id); await s.whenIdle(b.id);
  const r = s.getRun(acme, b.id);
  assert.deepEqual(calls, ['Click "Save"']);
  assert.equal(r.state, 'passed'); assert.equal(r.resumeOf, a.id);
  assert.deepEqual(r.steps.map((x) => x.state), ['skipped', 'skipped', 'skipped', 'skipped', 'passed']);
  throwsCode(() => s.resumeRun(acme, b.id), 'nothing-to-resume');
  s.renameStep(acme, wf.id, wf.steps[0].id, 'changed'); s.moveStep(acme, wf.id, wf.steps[0].id, { by: 1 });
  throwsCode(() => s.resumeRun(acme, a.id), 'changed');
});

test('Run mode: approval checkpoints wait, then continue on approve or fail on reject', async () => {
  const s = make({ settings: () => ({ stepDelayMs: 0, approvalTimeoutMs: 60000 }) });
  const wf = ready(s); s.setApproval(acme, wf.id, wf.steps[4].id, true, 'Check the total');
  const run = s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } });
  await new Promise((r) => setTimeout(r, 30));
  let r = s.getRun(acme, run.id);
  assert.equal(r.state, 'waiting'); assert.equal(r.steps[4].state, 'waiting'); assert.equal(s.waiting(acme), 1);
  throwsCode(() => s.decide(acme, run.id, wf.steps[0].id, true), 'not-waiting');
  throwsCode(() => s.decide(globex, run.id, wf.steps[4].id, true), 'not-found');
  s.decide(acme, run.id, wf.steps[4].id, true, { by: 'Dana' }); await s.whenIdle(run.id);
  assert.equal(s.getRun(acme, run.id).state, 'passed');

  const run2 = s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } });
  await new Promise((r2) => setTimeout(r2, 30));
  s.decide(acme, run2.id, wf.steps[4].id, false, { by: 'Dana', note: 'Total wrong' }); await s.whenIdle(run2.id);
  r = s.getRun(acme, run2.id);
  assert.equal(r.state, 'failed'); assert.equal(r.steps[4].state, 'rejected'); assert.match(r.steps[4].message, /Rejected by Dana: Total wrong/);
});

test('Run mode: approval that nobody answers times out as a failure', async () => {
  const s = make({ settings: () => ({ approvalTimeoutMs: 20 }) });
  const wf = ready(s); s.setApproval(acme, wf.id, wf.steps[1].id, true);
  const run = s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } }); await s.whenIdle(run.id);
  assert.match(s.getRun(acme, run.id).error, /timed out/);
});

test('Run mode: the stop button halts the run mid-step and marks the rest as not run', async () => {
  const s = make({ driver: { perform: (step, ctx) => new Promise((resolve) => { if (step.target === 'PO number') { ctx.signal.addEventListener('abort', () => resolve({ ok: false, message: 'aborted' })); } else resolve({ ok: true }); }) } });
  const wf = ready(s);
  const run = s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } });
  await new Promise((r) => setTimeout(r, 30));
  throwsCode(() => s.stopRun(globex, run.id), 'not-found');
  s.stopRun(acme, run.id, 'Dana'); await s.whenIdle(run.id);
  const r = s.getRun(acme, run.id);
  assert.equal(r.state, 'stopped');
  assert.deepEqual(r.steps.map((x) => x.state), ['passed', 'passed', 'passed', 'stopped', 'skipped']);
  assert.match(r.steps[3].message, /Stopped by Dana/);
  throwsCode(() => s.stopRun(acme, run.id), 'not-running');
});

test('Run mode: secrets come from Connections or the caller, are never stored and are masked in logs', async () => {
  const log = [];
  const s = make({ settings: () => ({ builtins: { login_password: 'S3cret!' } }), driver: { perform: async (step) => { log.push(step.value); return { ok: true, message: 'typed S3cret! in the field' }; } } });
  const rec = s.startRecording(acme, {});
  s.recordEvent(acme, rec.id, { kind: 'type', target: 'Password', value: 'x', at: 1 });
  const wf = s.saveRecording(acme, rec.id, { name: 'Login' });
  const run = s.startRun(acme, wf.id, {}); await s.whenIdle(run.id);
  assert.deepEqual(log, ['S3cret!']);
  const done = s.getRun(acme, run.id);
  assert.match(done.steps[0].message, /typed •••• in the field/); assert.ok(!JSON.stringify(done).includes('S3cret!'));
  assert.ok(!JSON.stringify(s.state).includes('S3cret!'), 'the secret never reaches the saved state');
  const bare = make();
  const wf2 = (() => { const r = bare.startRecording(acme, {}); bare.recordEvent(acme, r.id, { kind: 'type', target: 'Password', value: 'x', at: 1 }); return bare.saveRecording(acme, r.id, {}); })();
  throwsCode(() => bare.startRun(acme, wf2.id, {}), 'missing-variable');
  assert.throws(() => bare.startRun(acme, wf2.id, {}), /login_password \(add it in Connections\)/);
});

test('schedules compute the next time, fire when due and record a failed run when they cannot start', async () => {
  const t = { now: new Date(2026, 9, 26, 7, 0, 0).getTime() };
  const s = make({ now: () => t.now });
  const wf = ready(s);
  throwsCode(() => s.setSchedule(acme, wf.id, { kind: 'daily', at: '25:00' }), 'bad-schedule');
  throwsCode(() => s.setSchedule(acme, wf.id, { kind: 'weekly', at: '08:00', days: [] }), 'bad-schedule');
  throwsCode(() => s.setSchedule(acme, wf.id, { kind: 'interval', everyMin: 0 }), 'bad-schedule');
  s.setSchedule(acme, wf.id, { kind: 'daily', at: '7:30' }, { customer_name: 'Harlow' });
  assert.equal(new Date(s.getWorkflow(acme, wf.id).nextRunAt).getHours(), 7);
  assert.deepEqual(s.tick(t.now), [], 'not due yet');
  t.now += 31 * 60000;
  const fired = s.tick(t.now);
  assert.equal(fired.length, 1);
  await s.whenIdle();
  const r = s.listRuns(acme)[0];
  assert.equal(r.state, 'failed'); assert.match(r.error, /po_number/); assert.equal(r.trigger, 'schedule');
  s.setSchedule(acme, wf.id, { kind: 'interval', everyMin: 15 }, { customer_name: 'Harlow', po_number: 'PO-9' });
  t.now += 16 * 60000; s.tick(t.now); await s.whenIdle();
  assert.equal(s.listRuns(acme)[0].state, 'passed');
  const mon = new Date(2026, 9, 26, 12, 0).getTime();
  assert.equal(new Date(nextOccurrence({ kind: 'weekly', at: '09:00', days: [3] }, mon)).getDay(), 3);
  assert.equal(nextOccurrence({ kind: 'daily', at: '09:00', enabled: false }, mon), null);
  s.clearSchedule(acme, wf.id); assert.equal(s.getWorkflow(acme, wf.id).nextRunAt, null);
});

test('triggers start matching workflows with variables filled from the event', async () => {
  const s = make(); const wf = ready(s, acme, { customer: 'Harlow Build' }); const other = ready(s, globex);
  throwsCode(() => s.setTrigger(acme, wf.id, { kind: 'fax' }), 'bad-trigger');
  throwsCode(() => s.setTrigger(acme, wf.id, { kind: 'inbox', map: { missing: 'subject' } }), 'bad-trigger');
  s.setTrigger(acme, wf.id, { kind: 'inbox', match: 'invoice', map: { po_number: 'subject' } }, null);
  s.setTrigger(globex, other.id, { kind: 'inbox' });
  assert.deepEqual(s.fireTrigger('inbox', { subject: 'Weather' }, { client: 'acme' }), []);
  const runs = s.fireTrigger('inbox', { subject: 'Invoice 7731' }, { client: 'acme' });
  assert.equal(runs.length, 1); await s.whenIdle();
  const r = s.getRun(acme, runs[0].id);
  assert.equal(r.trigger, 'trigger: inbox'); assert.equal(r.values.po_number, 'Invoice 7731');
  assert.equal(r.state, 'passed'); assert.equal(r.values.customer_name, 'Harlow Build');
  const none = s.fireTrigger('inbox', { subject: 'Invoice 2' }, { client: 'globex' });
  assert.equal(none.length, 1); assert.equal(none[0].state, 'failed', 'the other client\'s trigger ran under its own scope and could not start');
  assert.equal(s.listRuns(acme).length, 1, 'and nothing leaked into acme');
  assert.equal(s.listRuns(globex).length, 1);
});

test('per-client workflows: each client sees, edits and runs only its own; admin sees all', async () => {
  const s = make(); const a = ready(s); const g = ready(s, globex);
  assert.deepEqual(s.listWorkflows(acme).map((w) => w.id), [a.id]);
  assert.deepEqual(s.listWorkflows(globex).map((w) => w.id), [g.id]);
  assert.equal(s.listWorkflows(ADMIN).length, 2);
  for (const op of [() => s.getWorkflow(acme, g.id), () => s.renameWorkflow(acme, g.id, 'x'), () => s.deleteStep(acme, g.id, g.steps[0].id), () => s.startRun(acme, g.id, {}), () => s.duplicateWorkflow(acme, g.id)]) throwsCode(op, 'not-found');
  const run = s.startRun(globex, g.id, { values: { customer_name: 'x', po_number: 'y' } }); await s.whenIdle(run.id);
  assert.equal(s.listRuns(acme).length, 0); assert.equal(s.listRuns(globex).length, 1);
  throwsCode(() => s.getRun(acme, run.id), 'not-found');
  assert.equal(s.stats(acme).runs, 0); assert.equal(s.stats(globex).runs, 1); assert.equal(s.stats(ADMIN).runs, 1);
  throwsCode(() => s.assignWorkflow(acme, a.id, 'globex'), 'forbidden');
  const copy = s.assignWorkflow(ADMIN, a.id, 'globex');
  assert.equal(copy.client, 'globex'); assert.notEqual(copy.id, a.id);
  assert.equal(s.listWorkflows(globex).length, 2); assert.equal(s.listWorkflows(acme).length, 1);
  assert.ok(s.listRecordings(acme).every((r) => r.client === 'acme'));
});

test('run history: filters, stats and restart recovery', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-')), 'w.json');
  const s = make({ file, driver: { perform: async (st) => (st.target === 'Save' ? { ok: false, message: 'boom' } : { ok: true }) } });
  const wf = ready(s);
  const bad = s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } }); await s.whenIdle(bad.id);
  s.renameStep(acme, wf.id, wf.steps[4].id, 'Save it'); s.updateStep(acme, wf.id, wf.steps[4].id, { target: 'Other' });
  const good = s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } }); await s.whenIdle(good.id);
  assert.equal(s.listRuns(acme, { state: 'failed' }).length, 1);
  assert.equal(s.listRuns(acme, { workflowId: wf.id })[0].id, good.id, 'newest first');
  const st = s.stats(acme);
  assert.deepEqual([st.runs, st.passed, st.failed, st.successRate], [2, 1, 1, 50]);
  assert.equal(st.hours.values.length, 24);
  // a run left "running" by a crash is closed as failed on the next start
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')); raw.runs[0].state = 'running'; fs.writeFileSync(file, JSON.stringify(raw));
  const again = new RpaStore({ file, driver: demoDriver() });
  assert.equal(again.getRun(ADMIN, raw.runs[0].id).state, 'failed'); assert.match(again.getRun(ADMIN, raw.runs[0].id).error, /Interrupted/);
});

test('a workflow cannot be deleted while it runs; a second run of it is refused', async () => {
  const s = make({ driver: { perform: (step, ctx) => new Promise((res) => ctx.signal.addEventListener('abort', () => res({ ok: false }))) } });
  const wf = ready(s);
  const run = s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } });
  throwsCode(() => s.deleteWorkflow(acme, wf.id), 'busy');
  throwsCode(() => s.startRun(acme, wf.id, { values: { customer_name: 'x', po_number: 'y' } }), 'busy');
  assert.equal(s.stopAll(acme), 1); await s.whenIdle(run.id);
  assert.equal(s.deleteWorkflow(acme, wf.id), true);
});

test('agent driver talks to a real HTTP agent: steps, auth, failure, unreachable and timeout', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => { b += c; });
    req.on('end', () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body: b ? JSON.parse(b) : null });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/health') return res.end(JSON.stringify({ ok: true }));
      if (req.url === '/step') { const t = JSON.parse(b).step.target; if (t === 'slow') return; if (t === 'gone') return res.end(JSON.stringify({ ok: false, code: 'target-missing', message: 'not on page' })); return res.end(JSON.stringify({ ok: true, message: 'clicked', screenshot: 'data:image/png;base64,AAAA' })); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  try {
    const url = 'http://127.0.0.1:' + srv.address().port;
    const d = agentDriver({ url, token: 'tok', timeoutMs: 300 });
    const ok = await d.perform({ kind: 'click', target: 'Save', value: '', name: 'n' }, { run: 'r1' });
    assert.equal(ok.ok, true); assert.equal(seen.at(-1).auth, 'Bearer tok'); assert.equal(seen.at(-1).body.step.target, 'Save');
    assert.equal((await d.perform({ kind: 'click', target: 'gone' })).code, 'target-missing');
    assert.match((await d.perform({ kind: 'click', target: 'slow' })).message, /did not answer/);
    assert.equal((await d.health()).ok, true);
    assert.match((await agentDriver({ url: 'http://127.0.0.1:1' }).perform({ kind: 'click', target: 'x' })).message, /Cannot reach/);
    const ac = new AbortController(); const p = d.perform({ kind: 'click', target: 'slow' }, { signal: ac.signal }); setTimeout(() => ac.abort(), 20);
    assert.equal((await p).stopped, true);
  } finally { srv.close(); }
  assert.throws(() => agentDriver({ url: '' }), /Connections/);
});
