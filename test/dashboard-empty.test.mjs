import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-empty-'));
process.env.HQ_APP_DATA = path.join(dir, 'data'); process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'missing.json');
const hooks = await import('../dashboard/hooks.mjs');
const store = await import('../dashboard/store.mjs');

test('with no monitors configured the orb says Idle and Run Now fails instead of claiming success', async () => {
  const boot = await hooks.init();
  assert.deepEqual(boot, { tasks: 0, running: false, configError: null });
  const s = await hooks.status();
  assert.equal(s.headline, 'Idle'); assert.equal(s.mood, 'wait');
  assert.match(s.detail, /Settings/);
  const r = await hooks.run('run');
  assert.equal(r.ok, false); assert.match(r.message, /No monitors configured/);
  const st = await hooks.paneStatus();
  assert.deepEqual(['documents', 'transfers', 'inbox'].map((k) => [st[k].state, st[k].demo]), [['idle', true], ['idle', true], ['idle', true]], 'unconfigured tabs wait for their keys, on demo records');
  assert.match(st.documents.text, /Settings/);
  const docs = await hooks.pane('documents');
  assert.equal(docs.configured, false); assert.equal(docs.source, 'demo');
  assert.ok(docs.arrivals.length > 5, 'the tab is not empty: it shows demo records');
  assert.deepEqual(hooks.monitorTable().rows, []);
  assert.equal(store.demoOn(), true, 'nothing is set up: the dashboard-wide demo switch is on');
  assert.deepEqual(store.readJSON('demo.json', null).auto, true, 'and it follows the keys');
});

test('a button on a tab without keys works on its demo records and says so', async () => {
  const r = await hooks.run('sync-ftp');
  assert.equal(r.ok, true); assert.match(r.message, /^Demo data: .*FTP host, user and password/);
  const p = await hooks.paneAction('transfers', 'sync', null, { user: { id: 'owner', name: 'Owner', role: 'admin' } });
  assert.equal(p.data.source, 'demo');
  await hooks.shutdown();
});
