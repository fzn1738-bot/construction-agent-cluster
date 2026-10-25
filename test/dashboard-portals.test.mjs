import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFtp } from '../testkit/mock-ftp.mjs';
import { startImap } from '../testkit/mock-imap.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-portal-'));
const watch = path.join(dir, 'watch'); fs.mkdirSync(watch);
process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'none.json'); process.env.AGENT_AUTOSTART = '0';
process.env.HQ_APP_DATA = path.join(dir, 'data'); process.env.HQ_ADMIN_KEY = 'test-admin-key';
const { start } = await import('../dashboard/server.mjs');
const hooks = await import('../dashboard/hooks.mjs');
const demo = await import('../dashboard/demo.mjs');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
const hdr = (from, subject) => `From: ${from}\r\nSubject: ${subject}\r\nDate: Mon, 1 Jan 2026 10:00:00 +0000\r\nMessage-ID: <${Math.random()}@x>\r\n\r\n`;

const srv = await start(0);
const base = 'http://127.0.0.1:' + srv.address().port;
const admin = { 'x-app-key': 'test-admin-key' };
const call = (p, h, body) => fetch(base + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
const json = async (p, h, body) => (await call(p, h, body)).json();
const summary = (h = admin) => json('/api/summary', h);
const save = (values) => json('/api/admin/settings', admin, { values });
const pane = async (id, h = admin) => (await json('/api/pane/' + id, h)).data;
const act = (id, action, input, h = admin) => json('/api/pane/' + id + '/do', h, { action, input });
process.on('exit', () => {});

test('F2: the sidebar lists one tab per client outcome and no internal parts', async () => {
  const s = await summary();
  assert.deepEqual(s.panes.map((p) => p.id), ['documents', 'transfers', 'inbox', 'activity-log']);
  assert.deepEqual(spec.panes.map((p) => p.id), s.panes.map((p) => p.id));
  for (const bad of ['loop', 'state', 'scheduler', 'database']) assert.ok(!s.panes.some((p) => p.id === bad || new RegExp('\\b' + bad + '\\b', 'i').test(p.title)), bad + ' is not a client outcome');
  for (const p of s.panes) assert.ok(p.view, p.id + ' has its own screen file');
});

test('F3: every tab has a screen module, metrics, panels and a button, plus the hero', async () => {
  const s = await summary();
  const ms = await hooks.metrics(); const ps = await hooks.panels();
  for (const p of spec.panes) {
    assert.ok(fs.existsSync(new URL('../dashboard/public/panes/' + p.id + '.js', import.meta.url)), p.id + '.js');
    assert.ok(ms.some((m) => m.pane === p.id), p.id + ' has metrics');
    assert.ok(p.actions.length && hooks.actions.some((a) => a.pane === p.id), p.id + ' has a button');
    for (const m of p.metrics) assert.equal(ms.find((x) => x.key === m).pane, p.id);
    for (const t of p.panels) assert.equal(ps.find((x) => x.title === t).pane, p.id, t + ' is tagged with its pane');
    assert.ok(p.columns && p.columns.length, p.id + ' keeps its record columns');
  }
  assert.deepEqual(ms.map((m) => m.key).sort(), spec.metrics.map((m) => m.key).sort());
  assert.equal(s.app.hero, 'hero.js');
  assert.equal((await fetch(base + '/panes/common.js')).status, 200, 'the shared screen helpers are served');
});

test('F7: demo data shows until every key is set, then the dashboard switches to live', async () => {
  let s = await summary();
  assert.equal(s.app.demo, true, 'nothing is connected: demo data');
  assert.ok(s.panes.every((p) => p.state), 'each tab has a status for the hero');
  assert.equal((await pane('documents')).source, 'demo');
  assert.ok((await pane('documents')).arrivals.length > 5, 'demo rows are realistic');
  const r = await json('/api/run', admin, { action: 'scan-folders' });
  assert.equal(r.ok, true); assert.match(r.message, /demo/);

  // only the folder is set: still demo, and its connection is ready and testable
  await save({ watch_folder: watch });
  s = await summary();
  assert.equal(s.app.demo, true, 'FTP and mailbox still need keys');
  const st = await json('/api/admin/state', admin);
  assert.deepEqual(st.connections.map((c) => [c.id, c.ready]), [['folders', true], ['ftp', false], ['imap', false]]);
  const t = await json('/api/admin/connections', admin, { id: 'folders' });
  assert.equal(t.test.ok, true); assert.match(t.test.message, /Folder readable/);
  const miss = await json('/api/admin/connections', admin, { id: 'ftp' });
  assert.equal(miss.test.ok, false); assert.match(miss.test.message, /Missing: .*ftp_host/);
});

test('F5/F6: keys saved in Settings are used for real calls; wrong keys fail clearly', async (t) => {
  const ftp = await startFtp({ files: { '/data/plan-A1.pdf': 'drawing' } });
  const imap = await startImap({ messages: [{ uid: 1, header: hdr('arch@site.example', 'RFI 12 slab edge') }, { uid: 2, header: hdr('bar@x.example', 'Lunch') }] });
  t.after(async () => { await ftp.close().catch(() => {}); await imap.close().catch(() => {}); });
  const sync = path.join(dir, 'sync');
  const good = { ftp_host: '127.0.0.1', ftp_port: ftp.port, ftp_user: 'bob', ftp_password: 'secret', ftp_secure: 'none', ftp_remote_dir: '/data', ftp_local_dir: sync, ftp_direction: 'download',
    imap_host: '127.0.0.1', imap_port: imap.port, imap_user: 'bob', imap_password: 'secret', imap_secure: false, imap_mailbox: 'INBOX', imap_rules: 'rfi: RFI' };

  // invalid credentials are reported, not hidden
  await save({ ...good, ftp_password: 'wrong', imap_password: 'wrong' });
  assert.equal((await json('/api/admin/connections', admin, { id: 'ftp' })).test.ok, false);
  const bad = (await json('/api/admin/connections', admin, { id: 'imap' })).test;
  assert.equal(bad.ok, false); assert.match(bad.message, /IMAP/);

  // replace the keys: both connections test OK and the dashboard goes live
  await save({ ftp_password: 'secret', imap_password: 'secret' });
  assert.equal((await json('/api/admin/connections', admin, { id: 'ftp' })).test.ok, true);
  assert.equal((await json('/api/admin/connections', admin, { id: 'imap' })).test.ok, true);
  const s = await summary();
  assert.equal(s.app.demo, false, 'all three connections are set: live data');
  assert.equal(JSON.stringify(s).includes('secret'), false, 'no key leaks into dashboard data');
  const state = await json('/api/admin/state', admin);
  assert.equal(JSON.stringify(state.settings.values).includes('"secret"'), false, 'saved secrets are masked');
  assert.deepEqual((await hooks.paneStatus()).transfers.state, 'ok');

  // the screens' buttons work on the real records
  fs.writeFileSync(path.join(watch, 'A-101.pdf'), 'plan');
  assert.equal((await act('documents', 'scan')).ok, true);   // first sight: the file settles before it is filed
  await new Promise((r) => setTimeout(r, 1200));
  const scan = await act('documents', 'scan');
  assert.equal(scan.ok, true);
  assert.ok(scan.data.arrivals.some((a) => a.file === 'A-101.pdf'), 'scan result lands on the screen');
  assert.equal((await act('transfers', 'sync')).ok, true);   // a remote file must also settle first
  await new Promise((r) => setTimeout(r, 1200));
  const sy = await act('transfers', 'sync');
  assert.equal(sy.ok, true, sy.message);
  assert.equal(fs.readFileSync(path.join(sync, 'plan-A1.pdf'), 'utf8'), 'drawing');
  assert.equal(sy.data.summary.transferred, 1);
  const chk = await act('inbox', 'check');
  assert.equal(chk.ok, true, chk.message);
  assert.deepEqual(chk.data.messages.map((m) => [m.subject, m.result]).sort(), [['Lunch', 'No rule matched'], ['RFI 12 slab edge', 'Matched']]);
  assert.equal(chk.data.rules[0].name, 'rfi');

  // rules and direction are edited from the screens, and persist in Settings
  const add = await act('inbox', 'add-rule', { name: 'invoice', keyword: 'Invoice' });
  assert.equal(add.ok, true); assert.deepEqual(add.data.rules.map((r) => r.name), ['rfi', 'invoice']);
  assert.equal((await act('inbox', 'add-rule', { name: '', keyword: 'x' })).ok, false);
  assert.equal((await act('inbox', 'remove-rule', { name: 'invoice' })).data.rules.length, 1);
  assert.equal((await act('transfers', 'set-direction', { direction: 'both' })).data.direction, 'both');
  assert.equal((await act('transfers', 'set-direction', { direction: 'sideways' })).ok, false);
  const nope = await act('documents', 'set-folder', { path: path.join(dir, 'missing') });
  assert.equal(nope.ok, false); assert.match(nope.message, /does not exist/);
  const folder2 = path.join(dir, 'watch2'); fs.mkdirSync(folder2);
  assert.equal((await act('documents', 'set-folder', { path: folder2 })).data.folder, folder2);

  // the activity record shows it all, and exports a CSV into Reports
  const rec = await pane('activity-log');
  assert.ok(rec.events.some((e) => e.source === 'ftp') && rec.events.some((e) => e.source === 'imap'));
  const ex = await act('activity-log', 'export');
  assert.equal(ex.ok, true);
  const rs = (await summary()).reports;
  const csv = rs.find((r) => r.href.endsWith('.csv'));
  const body = await (await call('/' + csv.href, admin)).text();
  assert.match(body, /^Time,Source,Result,What/);

  // failure after a previously working connection: the tab and the orb say so
  await ftp.close();
  const down = await act('transfers', 'sync');
  assert.equal(down.ok, false);
  assert.equal((await hooks.paneStatus()).transfers.state, 'bad');
  assert.equal((await hooks.status()).headline, 'Failing');
  assert.equal((await pane('transfers')).summary.failed >= 1, true);
});

test('admin and client portals: a client sees only their tab, its actions and no admin data', async () => {
  const add = await json('/api/admin/users', admin, { action: 'add', name: 'Docs client', role: 'client', panes: ['documents'], canRun: true });
  const view = await json('/api/admin/users', admin, { action: 'add', name: 'Viewer', role: 'client', panes: ['documents'], canRun: false });
  const client = { 'x-app-key': add.code };
  const c = await summary(client);
  assert.deepEqual(c.panes.map((p) => p.id), ['documents']);
  assert.ok(c.metrics.every((m) => m.pane === 'documents' || m.pane === 'overview'));
  assert.ok(c.metrics.some((m) => m.key === 'docsFiled') && !c.metrics.some((m) => m.key === 'ftpTransfers' || m.key === 'emailsProcessed'));
  assert.ok(c.panels.every((p) => p.pane === 'documents' || p.pane === 'overview'));
  assert.deepEqual(c.actions.filter((a) => a.pane !== 'overview').map((x) => x.id), ['scan-folders']);
  assert.equal((await call('/api/run', client, { action: 'sync-ftp' })).status, 404, 'other tab action is hidden');
  assert.equal((await call('/api/run', client, { action: 'run-monitor', input: 'folder:site' })).status, 404, 'admin action is hidden');
  assert.equal((await call('/api/pane/transfers', client)).status, 404);
  assert.equal((await call('/api/pane/inbox/do', client, { action: 'check' })).status, 404);
  assert.equal((await json('/api/run', client, { action: 'scan-folders' })).ok, true);
  const mine = await act('documents', 'scan', null, client);
  assert.equal(mine.ok, true);
  const edit = await act('documents', 'set-folder', { path: watch }, client);
  assert.equal(edit.ok, false); assert.match(edit.message, /Only the admin/);
  assert.equal((await call('/api/admin/state', client)).status, 403);
  assert.equal((await call('/api/admin/connections', client, { id: 'ftp' })).status, 403);
  assert.equal((await call('/api/summary', {})).status, 401);
  const text = JSON.stringify([c, await pane('documents', client)]);
  for (const leak of ['test-admin-key', 'secret', 'ftp_password']) assert.equal(text.includes(leak), false, leak + ' never reaches a client');
  assert.equal((await call('/api/pane/documents/do', { 'x-app-key': view.code }, { action: 'scan' })).status, 403, 'view-only clients cannot press buttons');
  assert.equal((await pane('documents', { 'x-app-key': view.code })).configured, true, 'but they can read their tab');
});

test('the demo build exports everything the real hooks do and keeps clients to their tab', async () => {
  for (const k of Object.keys(hooks).filter((k) => !['hourly', 'parseRules', 'configFromSettings', 'monitorTable', 'init', 'shutdown', 'ACTIVITY_TYPES', 'ACTIVITY_RESULTS'].includes(k))) assert.ok(k in demo, 'demo.mjs exports ' + k);
  const ps = await demo.panels();
  assert.equal(ps.length, spec.panels.length);
  assert.ok(ps.every((p) => p.pane));
});

test('empty data: with no activity every tab still returns a well-formed screen', async () => {
  const ps = await hooks.panels();
  assert.equal(ps.length, spec.panels.length);
  for (const p of ps) assert.ok(Array.isArray(p.rows) || Array.isArray(p.series), p.title + ' has rows or series');
  srv.close(); await hooks.shutdown();
});
