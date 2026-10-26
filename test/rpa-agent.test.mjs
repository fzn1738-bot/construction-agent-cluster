import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, listen } from '../agent/rpa-agent.mjs';

test('desktop agent records native actions with screenshots and withholds sensitive input', async (t) => {
  let push;
  let allowed = false;
  let captures = 0;
  const platform = {
    name: 'test Mac',
    permissions: async () => ({ accessibility: allowed, screen: allowed }),
    startWatch: async ({ onEvent }) => { push = onEvent; },
    stopWatch: () => {},
    screenshot: async () => { captures++; return { url: 'data:image/png;base64,iVBORw0KGgo=' }; },
    perform: async () => ({ ok: true, message: 'done' })
  };
  const agent = createAgent({ token: 'test-token-long', platform });
  const server = await listen(agent, { port: 0, host: '127.0.0.1' });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const headers = { authorization: 'Bearer test-token-long', 'content-type': 'application/json' };
  const post = async (route, body) => (await fetch(base + route, { method: 'POST', headers, body: JSON.stringify(body) })).json();
  const events = async (after = 0) => (await fetch(base + '/events?session=r1&after=' + after, { headers })).json();

  assert.equal((await post('/record/start', { session: 'r1' })).code, 'permission-denied');
  allowed = true;
  assert.equal((await post('/record/start', { session: 'r1' })).ok, true);
  push({ kind: 'app', app: 'Safari', at: 1000 });
  push({ kind: 'navigate', page: 'https://example.test/orders', app: 'Safari', at: 2000 });
  push({ kind: 'type', target: 'Customer name', value: 'Harlow Build', at: 3000 });
  push({ kind: 'type', target: 'Password', value: 'never-save-me', sensitive: true, at: 4000 });
  push({ kind: 'click', target: 'Submit', at: 5000 });
  await agent.flush();
  const first = await events();
  assert.deepEqual(first.events.map((e) => e.kind), ['app', 'navigate', 'type', 'type', 'click']);
  assert.equal(first.events[2].value, 'Harlow Build');
  assert.equal(first.events[3].value, '');
  assert.equal(first.events[3].screenshot, undefined);
  assert.equal(captures, 4);
  assert.ok(first.events.filter((e) => e.screenshot).every((e) => e.screenshot.startsWith('data:image/png')));
  assert.deepEqual((await events(3)).events.map((e) => e.kind), ['type', 'click']);
  assert.equal((await post('/record/stop', { session: 'r1' })).events, 5);
  assert.equal((await fetch(base + '/events?session=r1', { headers: { authorization: 'Bearer wrong' } })).status, 401);
});
