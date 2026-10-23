import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-empty-'));
process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'missing.json');
const hooks = await import('../dashboard/hooks.mjs');

test('with no monitors configured the orb says Idle and Run Now fails instead of claiming success', async () => {
  const boot = await hooks.init();
  assert.deepEqual(boot, { tasks: 0, running: false, configError: null });
  const s = await hooks.status();
  assert.equal(s.headline, 'Idle'); assert.equal(s.mood, 'wait');
  const r = await hooks.run('run');
  assert.equal(r.ok, false); assert.match(r.message, /No monitors configured/);
  const mons = (await hooks.panels()).find((p) => p.title === 'Monitors');
  assert.deepEqual(mons.rows, []);
});
