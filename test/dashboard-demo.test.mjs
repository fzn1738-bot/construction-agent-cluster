import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HQ_APP_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-demo-'));
const demo = await import('../dashboard/demo.mjs');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
const admin = { user: { id: 'owner', name: 'Owner', role: 'admin' } };

test('F7: demo data covers every pane, metric, panel and action', async () => {
  const ms = await demo.metrics(); const ps = await demo.panels(); const st = await demo.paneStatus();
  assert.deepEqual(ms.map((m) => m.key).sort(), spec.metrics.map((m) => m.key).sort());
  assert.deepEqual(ps.map((p) => p.title), spec.panels.map((p) => p.title));
  assert.deepEqual(demo.actions.map((a) => a.id), spec.actions.map((a) => a.id));
  for (const p of spec.panes) {
    const d = await demo.pane(p.id);
    assert.equal(d.source, 'demo', p.id);
    assert.ok(['ok', 'warn', 'bad', 'idle'].includes(st[p.id].state), p.id + ' has a status');
    for (const k of p.metrics) assert.equal(ms.find((m) => m.key === k).pane, p.id, k + ' is tagged with ' + p.id);
    for (const t of p.panels) assert.equal(ps.find((x) => x.title === t).pane, p.id, t + ' is tagged with ' + p.id);
    if (p.columns && !['documents', 'transfers', 'inbox', 'activity-log'].includes(p.id)) {
      assert.deepEqual(d.columns, p.columns, p.id + ' keeps its planned columns');
      assert.ok(d.rows.length > 0, p.id + ' has demo rows');
      assert.ok(d.rows.every((r) => r.length === p.columns.length), p.id + ' rows match the columns');
    }
  }
  for (const p of ps) assert.ok(Array.isArray(p.rows) || Array.isArray(p.series), p.title);
  const s = await demo.status();
  assert.ok(s.headline && s.ring.length === 3); assert.equal(s.primary.label, 'Success rate');
  const t = await demo.pane('transfers');
  assert.ok(t.transfers.some((x) => x.status === 'failed'), 'demo shows a realistic failure');
  assert.equal(st.transfers.state, 'warn');
  assert.equal((await demo.pane('nope')), null);
});

test('F7: demo data is seeded: two reads give the same records', async () => {
  const a = await demo.pane('inbox'), b = await demo.pane('inbox');
  assert.deepEqual(a.messages.map((m) => m.subject), b.messages.map((m) => m.subject));
  assert.deepEqual((await demo.panels())[0].series, (await demo.panels())[0].series);
  assert.deepEqual((await demo.pane('connections-for-every-outside')).rows.map((r) => r[0]), ['Site folder', 'Contractor FTP server', 'Project mailbox (IMAP)', 'Activity record database']);
});

test('F4: demo buttons work and their results land in the records and the history', async () => {
  const before = (await demo.pane('documents')).summary.filed;
  const hist = (await demo.pane('working-actions')).runs.length;
  const r = await demo.run('scan-folders', null, admin);
  assert.equal(r.ok, true); assert.match(r.message, /demo/);
  assert.ok((await demo.pane('documents')).summary.filed > before);
  assert.equal((await demo.pane('working-actions')).runs.length, hist + 1, 'the run lands in Action history');
  assert.equal((await demo.paneAction('transfers', 'sync', null, admin)).ok, true);
  assert.equal((await demo.paneAction('inbox', 'check', null, admin)).data.messages[0].rule, 'rfi');
  assert.equal((await demo.run('run', null, admin)).ok, true);
  assert.equal((await demo.run('run-outcomes', null, admin)).ok, true);
  assert.match((await demo.run('check-outcomes', null, admin)).message, /4 outcomes on demo data/);
  assert.equal((await demo.run('run-monitor', '')).ok, false);
  assert.equal((await demo.run('run-monitor', 'folder:site')).ok, true);
  assert.equal((await demo.run('bogus')).ok, false);
  assert.equal((await demo.run('check-database')).ok, true);
  const snap = await demo.paneAction('a-futuristic-overview-visual-s', 'snapshot', null, admin);
  assert.equal(snap.ok, true);
  assert.ok((await demo.reports()).some((x) => x.href === snap.output.href), 'the snapshot is in Reports');
  assert.equal((await demo.paneAction('give-each-tab-a-real-screen', 'check', null, admin)).ok, true);
  assert.equal((await demo.paneAction('connections-for-every-outside', 'test-all', null, admin)).ok, true);
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
  assert.match(ex.data.export.csv, /^Time,Source,Result,What\n/);
  assert.equal(fs.existsSync(path.join(process.env.HQ_APP_DATA, 'reports', 'activity-record.csv')), false, 'the export is a download, not a shared report');
  assert.equal((await demo.paneAction('activity-log', 'nope', null, admin)).ok, false);
  assert.equal((await demo.paneAction('connections-for-every-outside', 'test', { id: 'ftp' }, { user: { role: 'client' } })).ok, false);
  assert.equal((await demo.testConnection('ftp')).ok, true);
  assert.equal((await demo.testConnection('zzz')).ok, false);
});

test('F6: even in the demo, Keys in Settings shows what is really saved', async () => {
  const k = await demo.pane('keys-entered-in-settings', admin);
  assert.deepEqual(k.columns, ['Key', 'Used by', 'Value', 'Updated', 'Status']);
  assert.ok(k.rows.every((r) => r[2] === 'Not set' && r[4] === 'Missing'), 'nothing is saved in this fresh data folder');
  const sv = await demo.pane('connections-for-every-outside-', admin);
  assert.equal(sv.summary.ready, 0);
});
