import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../src/sqlite-utils.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-boot-'));
const watch = path.join(dir, 'watch'); fs.mkdirSync(watch);
process.env.HQ_APP_DATA = path.join(dir, 'data'); process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'cfg.json'); delete process.env.AGENT_AUTOSTART;
const { saveSettings } = await import('../dashboard/store.mjs');
saveSettings({ watch_folder: watch });
const { start } = await import('../dashboard/server.mjs');
const { adminKey } = await import('../dashboard/store.mjs');
const H = { 'x-app-key': adminKey() };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('the loop starts with the server, before any page or API request', async () => {
  const srv = await start(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const reader = openStore(process.env.AGENT_DB);
  try {
    await fetch(base + '/api/admin/demo', { method: 'POST', headers: H, body: JSON.stringify({ on: false }) });   // the keys aren't entered: look at the real data
    fs.writeFileSync(path.join(watch, 'A-101.pdf'), 'plan');
    const t0 = Date.now();
    const added = () => reader.recentLogs({ type: 'folder' }).some((l) => l.details.event === 'added' && /A-101\.pdf$/.test(l.details.path));
    while (!added() && Date.now() - t0 < 5000) await sleep(25);
    assert.ok(added(), 'file handled by the loop without any dashboard traffic');

    // Run Now while the loop is also running: both requests share one run per task, nothing overlaps.
    const before = reader.countLogs('folder', 'ok');
    const post = () => fetch(base + '/api/run', { method: 'POST', headers: H, body: JSON.stringify({ action: 'run' }) }).then((r) => r.json());
    const [a, b] = await Promise.all([post(), post()]);
    assert.equal(a.ok, true); assert.equal(b.ok, true);
    assert.match(a.message, /1 task\(s\) run, 0 failed/);
    assert.ok(reader.countLogs('folder', 'ok') >= before);

    const s = await (await fetch(base + '/api/summary', { headers: H })).json();
    assert.equal(s.status.headline === 'Healthy' || s.status.headline === 'Working', true, 'loop running: ' + s.status.headline);
    const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
    assert.deepEqual(s.panels.map((p) => p.title), spec.panels.map((p) => p.title), 'panels follow dashboard.json');
    assert.equal(s.app.demo, false);
    const hooks = await import('../dashboard/hooks.mjs');
    const mons = hooks.monitorTable();
    assert.deepEqual(mons.columns, ['Monitor', 'State', 'Last run', 'Queue']);
    assert.equal(mons.rows[0][0], 'Folder · site');
    assert.ok(['OK', 'Running'].includes(mons.rows[0][1].text), 'state chip ' + JSON.stringify(mons.rows[0][1]));
    assert.match(mons.rows[0][2], /ago$|just now/); assert.equal(typeof mons.rows[0][3], 'number');
  } finally {
    reader.close(); srv.close();
    const hooks = await import('../dashboard/hooks.mjs');
    await hooks.shutdown();
  }
});
