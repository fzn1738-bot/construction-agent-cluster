// Scaffolded by Mac mini HQ: keeps the solution dashboard working. HQ deploys it after every build.
import test from 'node:test';
import assert from 'node:assert/strict';
import { start } from '../dashboard/server.mjs';
import { adminKey } from '../dashboard/store.mjs';

test('dashboard serves its page, admin and client portals, and keeps clients to their panes', async () => {
  const srv = await start(0);
  const base = 'http://127.0.0.1:' + srv.address().port;
  const admin = { 'x-app-key': adminKey() };
  const get = (p, headers = admin) => fetch(base + p, { headers });
  const post = (p, body, headers = admin) => fetch(base + p, { method: 'POST', headers, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/healthz')).status, 200);
    const page = await (await fetch(base + '/')).text();
    assert.match(page, /id="orb"/);
    assert.match(page, /id="nav"/, 'the left sidebar is on the page');
    assert.equal((await get('/api/summary', {})).status, 401, 'nothing without an access code');

    const s = await (await get('/api/summary')).json();
    assert.equal(s.me.role, 'admin');
    assert.ok(s.status && typeof s.status.headline === 'string', 'status() returns a headline');
    assert.ok(Array.isArray(s.metrics) && Array.isArray(s.panels), 'metrics() and panels() return lists');
    assert.ok(Array.isArray(s.panes), 'panes for the sidebar');
    assert.ok(Array.isArray(s.actions) && s.actions.length > 0, 'at least one action runs the solution');
    const run = await (await post('/api/run', { action: s.actions[0].id })).json();
    assert.equal(typeof run.ok, 'boolean');

    const st = await (await get('/api/admin/state')).json();
    assert.ok(st.settings && Array.isArray(st.settings.schema) && Array.isArray(st.users), 'admin sees settings and users');

    // a client given one pane sees only that pane and can't reach admin
    const first = s.panes[0];
    const add = await (await post('/api/admin/users', { action: 'add', name: 'Test client', role: 'client', panes: first ? [first.id] : [], canRun: false })).json();
    assert.ok(add.ok && add.code, 'admin creates a client access code');
    const client = { 'x-app-key': add.code };
    const cs = await (await get('/api/summary', client)).json();
    assert.equal(cs.me.role, 'client');
    assert.deepEqual(cs.panes.map((p) => p.id), first ? [first.id] : []);
    assert.ok(cs.metrics.concat(cs.panels).every((x) => x.pane === 'overview' || (first && x.pane === first.id)), 'client data stays inside their panes');
    assert.equal((await get('/api/admin/state', client)).status, 403, 'clients cannot open admin');
    if (cs.actions.length) assert.equal((await post('/api/run', { action: cs.actions[0].id }, client)).status, 403, 'view-only clients cannot run');
    await post('/api/admin/users', { action: 'remove', id: add.user.id });
    assert.equal((await get('/api/summary', client)).status, 401, 'removed clients are signed out');
  } finally { srv.close(); }
});
