import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HQ_APP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-demo-'));
const demo = await import('../dashboard/demo.mjs');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
const admin = { user: { role: 'admin' } };

test('F7: demo data covers every pane, metric, panel and action', async () => {
  const ms = await demo.metrics(); const ps = await demo.panels(); const st = await demo.paneStatus();
  assert.deepEqual(ms.map((m) => m.key).sort(), spec.metrics.map((m) => m.key).sort());
  assert.deepEqual(ps.map((p) => p.title), spec.panels.map((p) => p.title));
  assert.deepEqual(demo.actions.map((a) => a.id), spec.actions.map((a) => a.id));
  for (const p of spec.panes) {
    const d = await demo.pane(p.id);
    assert.equal(d.source, 'demo', p.id);
    assert.ok(['ok', 'warn', 'bad', 'idle'].includes(st[p.id].state), p.id + ' has a status');
    assert.ok(ms.some((m) => m.pane === p.id) && ps.some((x) => x.pane === p.id));
  }
  assert.ok((await demo.status()).headline && (await demo.status()).ring.length === 3);
  const t = await demo.pane('transfers');
  assert.ok(t.transfers.some((x) => x.status === 'failed'), 'demo shows a realistic failure');
  assert.equal(st.transfers.state, 'warn');
  assert.equal((await demo.pane('nope')), null);
});

test('F7: demo data is seeded: two reads give the same records', async () => {
  const a = await demo.pane('inbox'), b = await demo.pane('inbox');
  assert.deepEqual(a.messages.map((m) => m.subject), b.messages.map((m) => m.subject));
  assert.deepEqual((await demo.panels())[0].series, (await demo.panels())[0].series);
});

test('F4: demo buttons work and their results land in the records', async () => {
  const before = (await demo.pane('documents')).summary.filed;
  const r = await demo.run('scan-folders');
  assert.equal(r.ok, true); assert.match(r.message, /demo/);
  assert.ok((await demo.pane('documents')).summary.filed > before);
  assert.equal((await demo.paneAction('transfers', 'sync', null, admin)).ok, true);
  assert.equal((await demo.paneAction('inbox', 'check', null, admin)).data.messages[0].rule, 'rfi');
  assert.equal((await demo.run('run')).ok, true);
  assert.equal((await demo.run('run-monitor', '')).ok, false);
  assert.equal((await demo.run('run-monitor', 'folder:site')).ok, true);
  assert.equal((await demo.run('bogus')).ok, false);
  assert.equal((await demo.run('check-database')).ok, true);
});

test('F4: demo forms validate and only the admin may change settings', async () => {
  assert.equal((await demo.paneAction('documents', 'set-folder', { path: '/x' }, { user: { role: 'client' } })).ok, false);
  assert.equal((await demo.paneAction('documents', 'set-folder', { path: 'relative' }, admin)).ok, false);
  assert.equal((await demo.paneAction('documents', 'set-folder', { path: '/Volumes/Projects/New' }, admin)).data.folder, '/Volumes/Projects/New');
  assert.equal((await demo.paneAction('transfers', 'set-direction', { direction: 'up' }, admin)).ok, false);
  assert.equal((await demo.paneAction('inbox', 'add-rule', { name: 'safety', keyword: 'Incident' }, admin)).data.rules.some((r) => r.name === 'safety'), true);
  assert.equal((await demo.paneAction('inbox', 'remove-rule', { name: 'safety' }, admin)).data.rules.some((r) => r.name === 'safety'), false);
  const ex = await demo.paneAction('activity-log', 'export', null, admin);
  assert.equal(ex.ok, true);
  assert.ok(fs.existsSync(path.join(process.env.HQ_APP_DATA, 'reports', 'activity-record.csv')));
  assert.equal((await demo.paneAction('activity-log', 'nope', null, admin)).ok, false);
  assert.equal((await demo.testConnection('ftp')).ok, true);
  assert.equal((await demo.testConnection('zzz')).ok, false);
});
