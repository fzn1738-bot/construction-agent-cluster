import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-portal-'));
const watch = path.join(dir, 'watch'); fs.mkdirSync(watch);
fs.writeFileSync(path.join(dir, 'cfg.json'), JSON.stringify({ folders: [{ name: 'w', path: watch, intervalMs: 50, settleMs: 0 }] }));
process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'cfg.json'); process.env.AGENT_AUTOSTART = '0';
process.env.HQ_APP_DATA = path.join(dir, 'data'); process.env.HQ_ADMIN_KEY = 'test-admin-key';
const { start } = await import('../dashboard/server.mjs');
const hooks = await import('../dashboard/hooks.mjs');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));

test('every service has a pane with its own metrics, a panel and a run button', async () => {
  assert.deepEqual(spec.panes.map((p) => p.id), ['loop', 'folders', 'ftp', 'email', 'state']);
  const ms = await hooks.metrics(); const ps = await hooks.panels();
  for (const p of spec.panes) {
    assert.ok(ms.some((m) => m.pane === p.id), p.id + ' has metrics');
    assert.ok(p.panels.length && p.actions.length, p.id + ' lists panels and actions');
    assert.ok(hooks.actions.some((a) => a.pane === p.id), p.id + ' has a run button');
    for (const m of p.metrics) assert.equal(ms.find((x) => x.key === m).pane, p.id);
    for (const t of p.panels) assert.ok(ps.some((x) => x.title === t), t);
  }
  assert.deepEqual(ms.map((m) => m.key).sort(), spec.metrics.map((m) => m.key).sort());
});

test('settings drive the hooks and actions validate their input', async () => {
  assert.ok(spec.settings.every((s) => ['staleAfterMin', 'recentRows', 'successTarget'].includes(s.key)));
  assert.equal((await hooks.run('run-monitor', '')).ok, false);
  const bad = await hooks.run('run-monitor', 'folder:nope');
  assert.equal(bad.ok, false); assert.match(bad.message, /Unknown monitor/);
  const good = await hooks.run('run-monitor', 'folder:w'); assert.equal(good.ok, true);
  assert.equal((await hooks.run('run-folders')).ok, true);
  assert.match((await hooks.run('run-ftp')).message, /No FTP monitors/);
  assert.match((await hooks.run('run-imap')).message, /No email monitors/);
  const chk = await hooks.run('check-state'); assert.equal(chk.ok, true);
  assert.ok(chk.output.tables.some(([n]) => n === 'sync_log'));
  assert.equal((await hooks.run('bogus')).ok, false);
  const state = (await hooks.panels()).find((p) => p.title === 'State Tables');
  assert.ok(state.rows.length > 0);
});

test('admin and client portals: a client sees only their pane, its actions and no admin data', async () => {
  const srv = await start(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const admin = { 'x-app-key': 'test-admin-key' };
  const call = (p, h, body) => fetch(base + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
  try {
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /id="nav"/);
    const a = await (await call('/api/summary', admin)).json();
    assert.deepEqual(a.panes.map((p) => p.id), spec.panes.map((p) => p.id), 'admin sidebar lists every pane');
    assert.ok(a.actions.some((x) => x.id === 'run-monitor'));
    const add = await (await call('/api/admin/users', admin, { action: 'add', name: 'Folders client', role: 'client', panes: ['folders'], canRun: true })).json();
    const client = { 'x-app-key': add.code };
    const c = await (await call('/api/summary', client)).json();
    assert.deepEqual(c.panes.map((p) => p.id), ['folders']);
    assert.ok(c.metrics.every((m) => m.pane === 'folders' || m.pane === 'overview'));
    assert.ok(c.metrics.some((m) => m.key === 'folderQueue') && !c.metrics.some((m) => m.key === 'ftpTransfers'));
    assert.ok(c.panels.every((p) => p.pane === 'folders' || p.pane === 'overview'));
    assert.deepEqual(c.actions.map((x) => x.id).sort(), ['run-folders']);
    assert.equal((await call('/api/run', client, { action: 'run-ftp' })).status, 404, 'other pane action is hidden');
    assert.equal((await call('/api/run', client, { action: 'run-monitor', input: 'folder:w' })).status, 404, 'admin action is hidden');
    const r = await (await call('/api/run', client, { action: 'run-folders' })).json();
    assert.equal(r.ok, true);
    assert.equal((await call('/api/admin/state', client)).status, 403);
    assert.equal((await call('/api/summary', {})).status, 401);
    assert.equal(JSON.stringify(c).includes('test-admin-key'), false);
  } finally { srv.close(); await hooks.shutdown(); }
});

test('empty data: with no activity every pane still returns well-formed panels', async () => {
  const ps = await hooks.panels();
  assert.equal(ps.length, spec.panels.length);
  for (const p of ps) assert.ok(Array.isArray(p.rows), p.title + ' rows');
});
