// Scaffolded by Mac mini HQ: keeps the solution dashboard working. HQ deploys it after every build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../dashboard/server.mjs';

test('dashboard serves its page, health check and summary', async () => {
  const srv = await start(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    const status = await (await fetch(base + '/api/status')).json();
    assert.equal(typeof status.headline, 'string');
    assert.equal(status.primary.label, 'Active Tasks');
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /id="orb"/);
    const s = await (await fetch(base + '/api/summary')).json();
    assert.ok(s.status && typeof s.status.headline === 'string', 'status() returns a headline');
    assert.ok(Array.isArray(s.metrics), 'metrics() returns a list');
    assert.ok(Array.isArray(s.panels), 'panels() returns a list');
    assert.ok(Array.isArray(s.actions) && s.actions.length > 0, 'at least one action runs the solution');
    const run = await (await fetch(base + '/api/run', { method: 'POST', body: JSON.stringify({ action: s.actions[0].id }) })).json();
    assert.equal(typeof run.ok, 'boolean');
  } finally { srv.close(); }
});
