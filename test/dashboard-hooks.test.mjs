import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
const watch = path.join(dir, 'watch'); fs.mkdirSync(watch);
fs.writeFileSync(path.join(dir, 'cfg.json'), JSON.stringify({ folders: [{ name: 'w', path: watch, intervalMs: 50, settleMs: 0 }] }));
process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'cfg.json'); process.env.AGENT_AUTOSTART = '0';
const hooks = await import('../dashboard/hooks.mjs');

test('dashboard hooks reflect real agent state after Run Now', async () => {
  fs.writeFileSync(path.join(watch, 'a.txt'), 'x');
  let s = await hooks.status();
  assert.equal(s.primary.label, 'Active Tasks'); assert.equal(s.ring.length, 3);
  assert.equal(s.ring[0].value, 1);
  await hooks.run('run'); const r = await hooks.run('run');
  assert.equal(r.ok, true); assert.match(r.message, /1 task\(s\) run, 0 failed/);
  s = await hooks.status();
  assert.equal(s.headline, 'Stopped', 'loop not autostarted in this test'); assert.equal(s.mood, 'wait');
  const [rate] = (await hooks.metrics()).slice(1);
  assert.equal(rate.value, 100);
  const [runs, logs] = await hooks.panels();
  assert.equal(runs.rows[0][0], 'folder:w'); assert.equal(runs.columns.length, 3);
  assert.ok(logs.rows.some((row) => /a\.txt/.test(row[0])));
  const reps = await hooks.reports();
  assert.ok(reps.every((x) => fs.existsSync(path.join('dashboard/data/reports', path.basename(x.href)))));
});

test('failing monitor turns the orb red', async () => {
  fs.rmSync(watch, { recursive: true });
  const r = await hooks.run('run');
  assert.equal(r.ok, false);
  const s = await hooks.status();
  assert.equal(s.mood, 'bad'); assert.equal(s.headline, 'Failing');
  assert.equal((await hooks.run('nope')).ok, false);
});
