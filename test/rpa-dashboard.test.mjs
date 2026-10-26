// Workflow automation through the dashboard: demo data until the agent is saved in Connections, then the real flow
// (record -> edit -> run against a real HTTP agent -> history), with clients kept to their own workflows and runs.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-dash-'));
process.env.AGENT_DB = path.join(dir, 'agent.db');
process.env.AGENT_CONFIG = path.join(dir, 'none.json');
process.env.AGENT_AUTOSTART = '0';
process.env.HQ_APP_DATA = path.join(dir, 'data');
process.env.HQ_ADMIN_KEY = 'rpa-admin-key';

// a desktop automation agent: Bearer token, /health, /step (fails on target "Missing"), /events
const stepsSeen = [];
let missingOk = false;
const agent = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    if (req.headers.authorization !== 'Bearer agent-token') { res.statusCode = 401; return res.end(JSON.stringify({ ok: false, message: 'Bad token' })); }
    if (req.url === '/health') return res.end(JSON.stringify({ ok: true, version: '1.2' }));
    if (req.url.startsWith('/events')) return res.end(JSON.stringify({ events: [{ kind: 'click', target: 'From agent', at: Date.now() }], next: 1 }));
    if (req.url === '/step') {
      const step = JSON.parse(b).step; stepsSeen.push(step);
      if (step.target === 'Missing' && !missingOk) return res.end(JSON.stringify({ ok: false, code: 'target-missing', message: 'No element "Missing" on the page' }));
      return res.end(JSON.stringify({ ok: true, message: 'done', screenshot: 'data:image/png;base64,iVBORw0KGgo=' }));
    }
    res.statusCode = 404; res.end('{}');
  });
});
await new Promise((r) => agent.listen(0, '127.0.0.1', r));
const agentUrl = 'http://127.0.0.1:' + agent.address().port;

const { start } = await import('../dashboard/server.mjs');
const hooks = await import('../dashboard/hooks.mjs');
const demo = await import('../dashboard/demo.mjs');
const live = await import('../dashboard/rpa-live.mjs');
const panesMod = await import('../dashboard/rpa-panes.mjs');
const srv = await start(0);
const base = 'http://127.0.0.1:' + srv.address().port;
const admin = { 'x-app-key': 'rpa-admin-key' };
const json = async (route, headers = admin, body) => (await fetch(base + route, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined })).json();
const pane = async (id, headers = admin) => (await json('/api/pane/' + id, headers)).data;
const act = (id, action, input, headers = admin) => json('/api/pane/' + id + '/do', headers, { action, input });
const newClient = async (name, panes = '*') => { const r = await json('/api/admin/users', admin, { action: 'add', name, role: 'client', panes, canRun: true }); return { 'x-app-key': r.code }; };
const settle = async (headers, id, ms = 4000) => { const t0 = Date.now(); for (;;) { const d = await pane('rpa-run', headers); if (d.active && d.active.id === id && !d.active.live) return d.active; if (Date.now() - t0 > ms) throw new Error('run did not finish'); await new Promise((r) => setTimeout(r, 25)); } };
const RPA = ['rpa-record', 'rpa-workflows', 'rpa-run', 'rpa-history'];

test('F1: the four workflow panes, their metrics, panels and run buttons are in the spec and tagged', async () => {
  const s = await json('/api/summary');
  for (const id of RPA) assert.ok(s.panes.some((p) => p.id === id), id);
  const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
  for (const p of spec.panes.filter((x) => RPA.includes(x.id))) assert.ok(p.metrics.length || p.panels.length || p.actions.length, p.id + ' has something tagged');
  assert.ok(s.metrics.some((m) => m.key === 'wfSuccess' && m.pane === 'rpa-history'));
  assert.ok(s.panels.some((x) => x.title === 'Workflow results' && x.pane === 'rpa-history'));
  assert.ok(s.actions.some((a) => a.id === 'stop-all-runs'));
  for (const id of RPA) assert.ok(typeof (await hooks.paneStatus())[id].text === 'string');
});

test('demo data until the agent is saved: every pane is seeded, buttons work, and nothing is persisted', async () => {
  assert.equal(live.agentReady(), false);
  for (const id of RPA) { const d = await pane(id); assert.equal(d.source, 'demo', id); assert.equal(d.configured, false); assert.match(d.needs, /Connections/); }
  const wfs = (await pane('rpa-workflows')).workflows;
  assert.ok(wfs.length >= 5 && new Set(wfs.map((w) => w.clientName)).size === 2, 'two customers each with their own workflows');
  const hist = await pane('rpa-history');
  assert.ok(hist.runs.some((r) => r.state === 'failed' && /layout|Could not find|read only/.test(r.error)) && hist.runs.some((r) => r.state === 'stopped'));
  assert.deepEqual(demo.pane && Object.keys(await demo.pane('rpa-run')).includes('active'), true);
  // record -> save -> it is a workflow in the demo library
  const r = await act('rpa-record', 'start', { name: 'Demo task', app: 'Excel', client: 'demo-northbeam' });
  assert.equal(r.ok, true); assert.match(r.message, /demo/);
  const sid = r.data.session.id;
  await act('rpa-record', 'event', { session: sid, kind: 'click', target: 'Open' });
  await act('rpa-record', 'event', { session: sid, kind: 'type', target: 'Password', value: 'x' });
  const pulled = await act('rpa-record', 'pull', { session: sid });
  assert.equal(pulled.ok, true);
  const saved = await act('rpa-record', 'save', { session: sid, name: 'Demo task' });
  assert.equal(saved.ok, true);
  assert.ok((await pane('rpa-workflows')).workflows.some((w) => w.name === 'Demo task'));
  assert.equal(fs.existsSync(path.join(dir, 'data', 'workflows.json')), false, 'demo records are not written to disk');
  const stop = await json('/api/run', admin, { action: 'stop-all-runs' });
  assert.equal(stop.ok, true);
});

test('Connections: the agent is a connection with real testing; a wrong token or address fails clearly', async () => {
  const conn = (await json('/api/admin/state')).connections.find((c) => c.id === 'rpa-agent');
  assert.ok(conn, 'listed in Connections'); assert.deepEqual(conn.fields, ['rpa_agent_url', 'rpa_agent_token']);
  assert.equal(conn.ready, false);
  assert.match((await hooks.testConnection('rpa-agent', { rpa_agent_url: '', rpa_agent_token: '' })).message, /No automation agent address/);
  assert.match((await hooks.testConnection('rpa-agent', { rpa_agent_url: 'ftp://x', rpa_agent_token: 't' })).message, /http/);
  assert.match((await hooks.testConnection('rpa-agent', { rpa_agent_url: agentUrl, rpa_agent_token: '' })).message, /token/);
  const bad = await hooks.testConnection('rpa-agent', { rpa_agent_url: agentUrl, rpa_agent_token: 'wrong' });
  assert.equal(bad.ok, false); assert.match(bad.message, /Bad token/);
  assert.equal((await hooks.testConnection('rpa-agent', { rpa_agent_url: 'http://127.0.0.1:1', rpa_agent_token: 't' })).ok, false);
  const ok = await hooks.testConnection('rpa-agent', { rpa_agent_url: agentUrl, rpa_agent_token: 'agent-token' });
  assert.equal(ok.ok, true); assert.match(ok.message, /reachable/);
  assert.equal((await demo.testConnection('rpa-agent')).ok, true);
});

const A_STEPS = [['type', 'Customer name', 'Harlow Build'], ['type', 'PO number', 'PO-1'], ['type', 'Password', 'hunter2'], ['click', 'Save', '']];
let A, B, wfA;

test('F1-F5, live: with the agent saved, a client records a task and it becomes its own editable workflow', async () => {
  const saved = await json('/api/admin/settings', admin, { values: { rpa_agent_url: agentUrl, rpa_agent_token: 'agent-token', rpa_step_delay_ms: 0, rpa_max_retries: 0, rpa_login_password: 'vault-pass-9' } });
  assert.ok(saved.ok !== false);
  assert.equal(live.agentReady(), true);
  A = await newClient('Client A'); B = await newClient('Client B');
  const d0 = await pane('rpa-workflows', A);
  assert.equal(d0.source, 'live'); assert.deepEqual(d0.workflows, []);
  const s = await act('rpa-record', 'start', { name: 'Raise PO', app: 'ERP' }, A);
  assert.equal(s.ok, true);
  const sid = s.data.session.id;
  for (const [kind, target, value] of A_STEPS) assert.equal((await act('rpa-record', 'event', { session: sid, kind, target, value, screenshot: kind === 'click' ? 'data:image/png;base64,iVBORw0KGgo=' : undefined }, A)).ok, true);
  assert.equal((await act('rpa-record', 'event', { session: sid, kind: 'click', target: 'Save' }, A)).ok, true, 'duplicate swallowed');
  const rec = (await pane('rpa-record', A)).session;
  assert.equal(rec.steps.length, 4);
  assert.equal(rec.steps[2].secret, true); assert.equal(rec.steps[2].value, ''); assert.equal(rec.steps[2].shot, null);
  assert.match(rec.steps[3].shot, /^data:image\/png/);
  assert.ok(!JSON.stringify(rec).includes('hunter2'));
  const pull = await act('rpa-record', 'pull', { session: sid }, A);
  assert.equal(pull.ok, true); assert.match(pull.message, /Pulled 1/);
  const saveR = await act('rpa-record', 'save', { session: sid, name: 'Raise PO' }, A);
  assert.equal(saveR.ok, true);
  wfA = (await pane('rpa-workflows', A)).selected;
  assert.equal(wfA.name, 'Raise PO'); assert.equal(wfA.steps.length, 5);
  assert.ok(wfA.steps.filter((x) => !x.secret).every((x) => x.shot), 'every step has a screenshot, except the one holding a password');
});

test('F6/F7/F8, live: rename, reorder, variables and an approval checkpoint persist on disk', async () => {
  const w = wfA.id, step = (i) => wfA.steps[i].id;
  assert.equal((await act('rpa-workflows', 'rename', { workflow: w, name: 'Raise purchase order' }, A)).ok, true);
  assert.equal((await act('rpa-workflows', 'step-rename', { workflow: w, step: step(0), name: 'Enter customer' }, A)).ok, true);
  assert.equal((await act('rpa-workflows', 'step-move', { workflow: w, step: step(3), by: -1 }, A)).ok, true);
  assert.equal((await act('rpa-workflows', 'step-move', { workflow: w, step: step(0), by: -1 }, A)).ok, false, 'cannot go above the top');
  const sg = (await pane('rpa-workflows', A)).suggestions;
  assert.deepEqual(sg.map((x) => x.name), ['customer_name', 'po_number']);
  assert.equal((await act('rpa-workflows', 'suggest', { workflow: w }, A)).ok, true);
  assert.equal((await act('rpa-workflows', 'approval', { workflow: w, step: step(4), on: true, note: 'Check the total' }, A)).ok, true);
  assert.equal((await act('rpa-workflows', 'var-add', { workflow: w, name: 'x y' }, A)).ok, false);
  const d = (await pane('rpa-workflows', A)).selected;
  assert.equal(d.name, 'Raise purchase order');
  assert.deepEqual(d.steps.map((x) => x.name).slice(0, 2), ['Enter customer', d.steps[1].name]);
  assert.equal(d.steps[0].value, '{{customer_name}}');
  assert.equal(d.steps.find((x) => x.id === step(4)).approval, true);
  assert.deepEqual(d.variables.map((v) => v.name), ['customer_name', 'po_number']);
  assert.equal((await act('rpa-workflows', 'set-schedule', { workflow: w, kind: 'daily', at: '07:30', values: { customer_name: 'Harlow Build', po_number: 'PO-AUTO' } }, A)).ok, true);
  assert.equal((await act('rpa-workflows', 'set-trigger', { workflow: w, kind: 'inbox', match: 'purchase', map: 'po_number=subject' }, A)).ok, true);
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'workflows.json'), 'utf8'));
  const saved = onDisk.workflows.find((x) => x.id === w);
  assert.equal(saved.name, 'Raise purchase order'); assert.equal(saved.steps.length, 5); assert.equal(saved.schedule.at, '07:30');
  assert.ok(!JSON.stringify(onDisk).includes('hunter2'), 'the typed password is nowhere on disk');
  wfA = (await pane('rpa-workflows', A)).selected;
});

test('Run mode, live: a client replays its workflow on the agent; the approval gate, screenshots and masked secret', async () => {
  stepsSeen.length = 0;
  const missing = await act('rpa-run', 'start', { workflow: wfA.id, values: { customer_name: 'Harlow Build' } }, A);
  assert.equal(missing.ok, false); assert.match(missing.message, /missing po_number/);
  const go = await act('rpa-run', 'start', { workflow: wfA.id, values: { customer_name: 'Harlow Build', po_number: 'PO-7' } }, A);
  assert.equal(go.ok, true);
  const id = go.data.active.id;
  // it pauses on the approval checkpoint
  let d; for (let i = 0; i < 100; i++) { d = (await pane('rpa-run', A)).active; if (d.state === 'waiting') break; await new Promise((r) => setTimeout(r, 20)); }
  assert.equal(d.state, 'waiting'); assert.equal((await pane('rpa-run', A)).waiting, 1);
  assert.deepEqual(d.steps.map((s) => s.state), ['passed', 'passed', 'passed', 'passed', 'waiting']);
  assert.ok(d.steps.filter((s) => s.state === 'passed').every((s) => /^data:image\/png/.test(s.shot)), 'real agent screenshots are kept');
  assert.equal((await act('rpa-run', 'approve', { run: id, step: d.steps[4].id, approve: true, note: 'ok' }, B)).ok, false, 'another client cannot approve it');
  assert.equal((await act('rpa-run', 'approve', { run: id, step: d.steps[4].id, approve: true, note: 'ok' }, A)).ok, true);
  const fin = await settle(A, id);
  assert.equal(fin.state, 'passed');
  assert.ok(stepsSeen.some((s) => s.value === 'vault-pass-9'), 'the login from Connections reached the agent');
  assert.ok(stepsSeen.some((s) => s.value === 'Harlow Build') && stepsSeen.some((s) => s.value === 'PO-7'));
  const hist = await pane('rpa-history', A);
  assert.equal(hist.summary.passed, 1);
  assert.ok(!JSON.stringify([hist, await pane('rpa-run', A), await pane('rpa-workflows', A), await json('/api/summary', A)]).includes('vault-pass-9'), 'no secret in anything a client can read');
  assert.ok(!fs.readFileSync(path.join(dir, 'data', 'workflows.json'), 'utf8').includes('vault-pass-9'));
});

test('Run history, live: a failing step is explained and logged, and the run continues from the failed step', async () => {
  await act('rpa-workflows', 'step-add', { workflow: wfA.id, kind: 'click', target: 'Missing', after: wfA.steps[3].id }, A);
  const go = await act('rpa-run', 'start', { workflow: wfA.id, values: { customer_name: 'a', po_number: 'b' } }, A);
  const id = go.data.active.id;
  const fin = await settle(A, id);
  assert.equal(fin.state, 'failed'); assert.match(fin.error, /Step 5 .*Missing.*layout may have changed/);
  assert.ok(fin.log.some((l) => l.level === 'error'));
  assert.deepEqual(fin.steps.map((s) => s.state), ['passed', 'passed', 'passed', 'passed', 'failed', 'skipped']);
  const h = await act('rpa-history', 'select', { id }, A);
  assert.equal(h.data.selected.id, id); assert.equal(h.data.summary.failed, 1);
  missingOk = true;
  const resumed = await act('rpa-history', 'resume', { run: id }, A);
  assert.equal(resumed.ok, true, resumed.message);
  const rid = (await pane('rpa-run', A)).active.id;
  let d; for (let i = 0; i < 100; i++) { d = (await pane('rpa-run', A)).active; if (d.state === 'waiting') break; await new Promise((r) => setTimeout(r, 20)); }
  assert.deepEqual(d.steps.map((s) => s.state), ['skipped', 'skipped', 'skipped', 'skipped', 'passed', 'waiting']);
  assert.match(d.steps[0].message, /Already done in run/);
  await act('rpa-run', 'approve', { run: rid, step: d.steps[5].id, approve: true }, A);
  assert.equal((await settle(A, rid)).state, 'passed');
  // the stop button: start again, stop at the approval gate
  const again = await act('rpa-history', 'rerun', { run: id }, A);
  assert.equal(again.ok, true);
  const aid = (await pane('rpa-run', A)).active.id;
  for (let i = 0; i < 100; i++) { d = (await pane('rpa-run', A)).active; if (d.state === 'waiting') break; await new Promise((r) => setTimeout(r, 20)); }
  assert.equal((await act('rpa-run', 'stop', { run: aid }, B)).ok, false, 'only the owner can stop it');
  assert.equal((await act('rpa-run', 'stop', { run: aid }, A)).ok, true);
  const stopped = await settle(A, aid);
  assert.equal(stopped.state, 'stopped'); assert.equal(stopped.steps[5].state, 'stopped');
  // editing the workflow after a run makes that run's "continue" refuse rather than guess
  const now = (await pane('rpa-workflows', A)).selected.steps;
  await act('rpa-workflows', 'step-delete', { workflow: wfA.id, step: now[4].id }, A);
  const stale = await act('rpa-history', 'resume', { run: id }, A);
  assert.equal(stale.ok, false); assert.match(stale.message, /edited since that run/);
});

test('per-client isolation: another client and a client without the pane see none of it', async () => {
  const dB = await pane('rpa-workflows', B);
  assert.deepEqual(dB.workflows, []); assert.equal(dB.selected, null);
  assert.deepEqual((await pane('rpa-history', B)).runs, []);
  assert.equal((await pane('rpa-run', B)).active, null);
  const hijack = await act('rpa-workflows', 'select', { id: wfA.id }, B);
  assert.equal(hijack.data.selected, null);
  for (const [action, input] of [['rename', { workflow: wfA.id, name: 'mine' }], ['delete', { workflow: wfA.id }], ['step-delete', { workflow: wfA.id, step: wfA.steps[0].id }], ['duplicate', { workflow: wfA.id }]]) {
    const r = await act('rpa-workflows', action, input, B); assert.equal(r.ok, false, action); assert.match(r.message, /No such workflow/);
  }
  assert.equal((await act('rpa-run', 'start', { workflow: wfA.id, values: {} }, B)).ok, false);
  assert.equal((await act('rpa-workflows', 'assign', { workflow: wfA.id, client: 'x' }, B)).ok, false);
  const admin1 = await pane('rpa-workflows');
  assert.ok(admin1.workflows.some((w) => w.id === wfA.id), 'the admin sees every client');
  assert.ok(admin1.clients.length >= 3);
  // admin gives a copy to client B; B now has its own, A is untouched
  const give = await act('rpa-workflows', 'select', { id: wfA.id });
  assert.equal(give.data.selected.id, wfA.id);
  const bId = (await json('/api/admin/state')).users.find((u) => u.name === 'Client B').id;
  const asg = await act('rpa-workflows', 'assign', { workflow: wfA.id, client: bId });
  assert.equal(asg.ok, true);
  const nowB = await pane('rpa-workflows', B);
  assert.equal(nowB.workflows.length, 1); assert.equal(nowB.workflows[0].name, 'Raise purchase order');
  assert.equal(nowB.workflows[0].schedule, 'Not scheduled', 'a copy starts without the schedule');
  assert.equal((await pane('rpa-workflows', A)).workflows.length, 1);
  // a client given only the history pane cannot open the others
  const H = await newClient('History only', ['rpa-history']);
  assert.equal((await fetch(base + '/api/pane/rpa-workflows', { headers: H })).status, 404);
  assert.equal((await fetch(base + '/api/pane/rpa-history', { headers: H })).status, 200);
  const sm = await json('/api/summary', H);
  assert.deepEqual(sm.panes.map((p) => p.id), ['rpa-history']);
  assert.ok(!sm.actions.some((a) => a.id === 'run-due-workflows'));
  assert.equal(JSON.stringify(sm.panels).includes('Raise purchase order'), false, 'panels carry counts, never workflow names');
});

test('schedules fire against the live store, triggers read the agent log, and the admin button starts due work', async () => {
  const store = live.liveRpa().store;
  const wf = store.listWorkflows({ admin: true }).find((w) => w.schedule);
  assert.ok(wf && wf.nextRunAt > 0);
  const n0 = store.listRuns({ admin: true }).length;
  const started = store.tick(wf.nextRunAt + 1000);
  assert.ok(started.some((r) => r.workflowId === wf.id));
  await new Promise((r) => setTimeout(r, 100)); store.stopAll({ admin: true }, 'test'); await store.whenIdle();
  assert.equal(store.listRuns({ admin: true }).length, n0 + started.length);
  assert.equal(store.listRuns({ admin: true })[0].trigger, 'schedule');
  const ev = (type, status, details) => live.eventOf({ type, status, details });
  assert.deepEqual(ev('imap', 'ok', { uid: 1, subject: 'Purchase 44', from: 'a@b.example', rule: 'po' }), { source: 'inbox', payload: { subject: 'Purchase 44', from: 'a@b.example', rule: 'po' } });
  assert.deepEqual(ev('folder', 'ok', { event: 'added', path: '/x/y/plan.pdf' }), { source: 'folder', payload: { file: 'plan.pdf', path: '/x/y/plan.pdf' } });
  assert.deepEqual(ev('ftp', 'ok', { op: 'download', file: 'a.dwg' }).source, 'ftp');
  assert.equal(ev('imap', 'ignored', { uid: 1 }), null); assert.equal(ev('folder', 'ok', { event: 'modified' }), null);
  const fired = store.fireTrigger('inbox', { subject: 'Purchase order 12' });
  assert.ok(fired.length >= 1); await new Promise((r) => setTimeout(r, 100)); store.stopAll({ admin: true }, 'test'); await store.whenIdle();
  const ctl = await json('/api/run', admin, { action: 'run-due-workflows' });
  assert.equal(ctl.ok, true);
  const Cl = await newClient('Runner', ['rpa-run']);
  const denied = await json('/api/run', Cl, { action: 'run-due-workflows' });
  assert.notEqual(denied.ok, true);
});

test('overview: panes get live status, metrics and panels from the workflow store', async () => {
  const st = await hooks.paneStatus();
  assert.equal(st['rpa-workflows'].state, 'ok'); assert.ok(!st['rpa-workflows'].demo);
  const ms = await hooks.metrics();
  assert.ok(ms.find((m) => m.key === 'wfRuns').value >= 1); assert.ok(ms.find((m) => m.key === 'wfCount').value >= 2);
  const ps = await hooks.panels();
  const line = ps.find((p) => p.title === 'Workflow runs, last 24 hours');
  assert.equal(line.series[0].values.length, 24); assert.equal(line.pane, 'rpa-history');
  assert.equal(panesMod.scopeOf({ user: { id: 'c', role: 'client' } }).client, 'c');
  assert.equal(panesMod.scopeOf({}).admin, true);
  await hooks.shutdown();
  agent.close(); srv.close();
});
