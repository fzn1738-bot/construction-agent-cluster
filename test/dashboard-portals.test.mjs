// Client outcomes and the HQ admin shell, exercised through the HTTP API with local FTP/IMAP fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFtp } from '../testkit/mock-ftp.mjs';
import { startImap } from '../testkit/mock-imap.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-portal-'));
const watch = path.join(dir, 'watch'); fs.mkdirSync(watch);
process.env.AGENT_DB = path.join(dir, 'agent.db');
process.env.AGENT_CONFIG = path.join(dir, 'none.json');
process.env.AGENT_AUTOSTART = '0';
process.env.HQ_APP_DATA = path.join(dir, 'data');
process.env.HQ_ADMIN_KEY = 'test-admin-key';
const { start } = await import('../dashboard/server.mjs');
const hooks = await import('../dashboard/hooks.mjs');
const demo = await import('../dashboard/demo.mjs');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
const srv = await start(0);
const base = 'http://127.0.0.1:' + srv.address().port;
const admin = { 'x-app-key': 'test-admin-key' };
const call = (route, headers = admin, body) => fetch(base + route, { method: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined });
const json = async (route, headers = admin, body) => (await call(route, headers, body)).json();
const summary = (headers = admin) => json('/api/summary', headers);
const pane = async (id, headers = admin) => (await json('/api/pane/' + id, headers)).data;
const act = (id, action, input, headers = admin) => json('/api/pane/' + id + '/do', headers, { action, input });
const save = (values) => json('/api/admin/settings', admin, { values });
const client = async (panes, canRun = true) => {
  const r = await json('/api/admin/users', admin, { action: 'add', name: 'Site client', role: 'client', panes, canRun });
  return { 'x-app-key': r.code };
};
const outcomes = ['documents', 'transfers', 'inbox', 'activity-log'];
const rpaPanes = ['rpa-record', 'rpa-typing', 'rpa-pages', 'rpa-screens', 'rpa-workflows', 'rpa-steps', 'rpa-order', 'rpa-variables', 'rpa-run', 'rpa-history'];

test('F1/F2/F3/F8: only delivered client outcomes are tabs, each with its own live screen and overview state', async () => {
  const s = await summary();
  assert.deepEqual(s.panes.map((p) => p.id), [...outcomes, ...rpaPanes]);
  assert.deepEqual(spec.panes.map((p) => p.id), [...outcomes, ...rpaPanes]);
  assert.equal(s.app.hero, 'hero.js');
  const ms = await hooks.metrics(), ps = await hooks.panels();
  assert.deepEqual(ms.map((m) => m.key).sort(), spec.metrics.map((m) => m.key).sort());
  assert.deepEqual(ps.map((p) => p.title), spec.panels.map((p) => p.title));
  for (const p of s.panes) {
    assert.equal(p.view, 'panes/' + p.id + '.js');
    assert.ok(p.state && p.state.text);
    assert.ok(await pane(p.id));
    const def = spec.panes.find((x) => x.id === p.id);
    for (const key of def.metrics) assert.equal(ms.find((m) => m.key === key).pane, p.id);
    for (const title of def.panels) assert.equal(ps.find((x) => x.title === title).pane, p.id);
  }
  assert.ok(s.panes.filter((p) => p.state.demo).length >= 3);
});

test('F4/F7: a demo action updates its records, then one saved folder moves only that outcome to live', async () => {
  assert.equal((await summary()).app.demo, true);
  const before = (await pane('documents')).summary.filed;
  assert.equal((await act('documents', 'scan')).ok, true);
  assert.ok((await pane('documents')).summary.filed > before);
  await save({ watch_folder: watch });
  assert.equal((await summary()).app.demo, false);
  assert.equal((await pane('documents')).source, 'live');
  assert.equal((await pane('transfers')).source, 'demo');
  assert.equal((await pane('inbox')).source, 'demo');
  assert.equal((await pane('activity-log')).source, 'live');
  assert.equal((await json('/api/admin/connections', admin, { id: 'folders' })).test.ok, true);
  fs.writeFileSync(path.join(watch, 'A-101.pdf'), 'drawing');
  await act('documents', 'scan');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await act('documents', 'scan')).ok, true);
  assert.ok((await pane('documents')).arrivals.some((x) => x.file === 'A-101.pdf'));
});

test('F5/F6: Settings credentials drive real FTP and IMAP connections, failure, replacement and clearing', async (t) => {
  const ftp = await startFtp({ files: { '/data/plan-A1.pdf': 'drawing' } });
  const imap = await startImap({ messages: [{ uid: 1, header: 'From: arch@site.example\r\nSubject: RFI 12 slab edge\r\n\r\n' }] });
  t.after(async () => { await ftp.close().catch(() => {}); await imap.close().catch(() => {}); });
  const sync = path.join(dir, 'sync');
  const values = { ftp_host: '127.0.0.1', ftp_port: ftp.port, ftp_user: 'bob', ftp_password: 'wrong', ftp_secure: 'none', ftp_remote_dir: '/data', ftp_local_dir: sync,
    imap_host: '127.0.0.1', imap_port: imap.port, imap_user: 'bob', imap_password: 'wrong', imap_secure: false, imap_rules: 'rfi: RFI' };
  await save(values);
  assert.equal((await json('/api/admin/connections', admin, { id: 'ftp' })).test.ok, false);
  assert.equal((await json('/api/admin/connections', admin, { id: 'imap' })).test.ok, false);
  await save({ ftp_password: 'secret', imap_password: 'secret' });
  assert.equal((await json('/api/admin/connections', admin, { id: 'ftp' })).test.ok, true);
  assert.equal((await json('/api/admin/connections', admin, { id: 'imap' })).test.ok, true);
  assert.equal((await pane('transfers')).source, 'live');
  assert.equal((await pane('inbox')).source, 'live');
  await act('transfers', 'sync');
  await new Promise((r) => setTimeout(r, 1200));
  assert.equal((await act('transfers', 'sync')).ok, true);
  assert.equal(fs.readFileSync(path.join(sync, 'plan-A1.pdf'), 'utf8'), 'drawing');
  assert.equal((await act('inbox', 'check')).ok, true);
  assert.ok((await pane('inbox')).messages.some((m) => m.subject === 'RFI 12 slab edge'));
  assert.equal(JSON.stringify(await summary()).includes('"value":"secret"'), false);
  assert.equal(JSON.stringify((await json('/api/admin/state')).settings.values).includes('"secret"'), false);
  await save({ imap_password: null });
  assert.equal((await pane('inbox')).source, 'demo');
});

test('F2/F4: client permissions hide other outcomes and reject their actions', async () => {
  const docs = await client(['documents']);
  assert.deepEqual((await summary(docs)).panes.map((p) => p.id), ['documents']);
  assert.equal((await call('/api/pane/transfers', docs)).status, 404);
  assert.equal((await call('/api/pane/inbox/do', docs, { action: 'check' })).status, 404);
  assert.equal((await call('/api/admin/state', docs)).status, 403);
  assert.equal((await json('/api/run', docs, { action: 'scan-folders' })).ok, true);
  assert.equal((await call('/api/run', docs, { action: 'sync-ftp' })).status, 404);
  const viewer = await client(['documents'], false);
  assert.equal((await call('/api/pane/documents/do', viewer, { action: 'scan' })).status, 403);
  assert.equal((await call('/api/summary', {})).status, 401);
});

test('F7: demo exports the real dashboard contract for all four panes', async () => {
  for (const key of ['status','metrics','panels','actions','pane','paneAction','paneStatus','run','testConnection','reports']) assert.ok(key in demo, key);
  assert.equal((await demo.panels()).length, spec.panels.length);
  assert.equal((await hooks.panels()).length, spec.panels.length);
  for (const p of spec.panes) assert.equal((await demo.pane(p.id)).source, 'demo');
  srv.close(); await hooks.shutdown();
});
