// End to end through the dashboard server: the client outcomes as tabs, each with its own screen and buttons,
// keys entered in Settings (and in the Keys tab) going live per screen, demo data until then, the overall state,
// and the admin and client portals keeping every client to the outcomes they were given.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startFtp } from '../testkit/mock-ftp.mjs';
import { startImap } from '../testkit/mock-imap.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-portal-'));
const watch = path.join(dir, 'watch'); fs.mkdirSync(watch);
process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'none.json'); process.env.AGENT_AUTOSTART = '0';
process.env.HQ_APP_DATA = path.join(dir, 'data'); process.env.HQ_ADMIN_KEY = 'test-admin-key';
const { start } = await import('../dashboard/server.mjs');
const hooks = await import('../dashboard/hooks.mjs');
const demo = await import('../dashboard/demo.mjs');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
const hdr = (from, subject) => `From: ${from}\r\nSubject: ${subject}\r\nDate: Mon, 1 Jan 2026 10:00:00 +0000\r\nMessage-ID: <${Math.random()}@x>\r\n\r\n`;
const P = { outcomes: 're-plan-this-solution-from-wha', history: 'working-actions', map: 'a-futuristic-overview-visual-s', screens: 'give-each-tab-a-real-screen', demo: 'demo-data-until-keys-are-set', services: 'connections-for-every-outside-', health: 'connections-for-every-outside', keys: 'keys-entered-in-settings' };
const OUTCOMES = ['documents', 'transfers', 'inbox', 'activity-log'];

const srv = await start(0);
const base = 'http://127.0.0.1:' + srv.address().port;
const admin = { 'x-app-key': 'test-admin-key' };
const call = (p, h, body) => fetch(base + p, { method: body ? 'POST' : 'GET', headers: h, body: body ? JSON.stringify(body) : undefined });
const json = async (p, h, body) => (await call(p, h, body)).json();
const summary = (h = admin) => json('/api/summary', h);
const save = (values) => json('/api/admin/settings', admin, { values });
const pane = async (id, h = admin) => (await json('/api/pane/' + id, h)).data;
const act = (id, action, input, h = admin) => json('/api/pane/' + id + '/do', h, { action, input });
const client = async (name, panes, canRun = true) => { const r = await json('/api/admin/users', admin, { action: 'add', name, role: 'client', panes, canRun }); return { 'x-app-key': r.code }; };

test('F1/F2: the sidebar lists each client outcome as its own tab, plus the planned tabs across them, and no internal parts', async () => {
  const s = await summary();
  assert.deepEqual(s.panes.map((p) => p.id), spec.panes.map((p) => p.id));
  for (const id of OUTCOMES) assert.ok(s.panes.some((p) => p.id === id), id + ' is a tab');
  for (const id of Object.values(P)) assert.ok(s.panes.some((p) => p.id === id), id + ' is a tab');
  for (const bad of ['loop', 'scheduler', 'sqlite', 'database', 'poller', 'Pane 4']) assert.ok(!s.panes.some((p) => new RegExp('\\b' + bad + '\\b', 'i').test(p.title)), bad + ' is not a tab');
  for (const p of s.panes) { assert.ok(p.view, p.id + ' has its own screen file'); assert.ok(p.state && p.state.text, p.id + ' has a live state'); }
  const oc = await pane(P.outcomes);
  assert.deepEqual(oc.columns, ['Outcome', 'Fed by', 'Tab', 'Status', 'Last delivered']);
  assert.deepEqual(oc.rows.map((r) => r[2]), ['Site documents', 'Contractor file transfers', 'Project inbox', 'Activity record'], 'every outcome names the tab that owns it');
  const chk = await act(P.outcomes, 'check');
  assert.equal(chk.ok, true); assert.match(chk.message, /4 outcomes/);
});

test('F3: every tab has a screen module, its own metrics, panels and columns, plus the hero', async () => {
  const s = await summary();
  const ms = await hooks.metrics(); const ps = await hooks.panels();
  assert.deepEqual(ms.map((m) => m.key).sort(), spec.metrics.map((m) => m.key).sort());
  assert.deepEqual(ps.map((p) => p.title), spec.panels.map((p) => p.title));
  for (const p of spec.panes) {
    assert.ok(fs.existsSync(new URL('../dashboard/public/panes/' + p.id + '.js', import.meta.url)), p.id + '.js');
    for (const m of p.metrics) assert.equal(ms.find((x) => x.key === m).pane, p.id, m + ' is tagged with its pane');
    for (const t of p.panels) assert.equal(ps.find((x) => x.title === t).pane, p.id, t + ' is tagged with its pane');
    assert.ok(ms.some((m) => m.pane === p.id), p.id + ' has a metric');
    const d = await pane(p.id);
    assert.ok(d, p.id + ' returns data');
    if (p.columns && !OUTCOMES.includes(p.id)) assert.deepEqual(d.columns, p.columns, p.id + ' keeps its columns');
  }
  for (const a of hooks.actions) assert.ok(a.pane === 'overview' || spec.panes.some((p) => p.id === a.pane), a.id + ' is tagged with its pane');
  const sc = await pane(P.screens);
  assert.equal(sc.cards.length, spec.panes.length);
  assert.ok(sc.cards.every((c) => c.main && c.actions.length), 'every screen has a main view and buttons');
  assert.equal((await act(P.screens, 'check')).ok, true);
  assert.equal(s.app.hero, 'hero.js');
  assert.equal((await fetch(base + '/panes/common.js')).status, 200, 'the shared screen helpers are served');
});

test('F7: demo data until keys are set, then each screen goes live as soon as its own keys are saved', async () => {
  let s = await summary();
  assert.equal(s.app.demo, true, 'nothing is set up: demo data');
  assert.equal((await pane('documents')).source, 'demo');
  assert.ok((await pane('documents')).arrivals.length > 5, 'demo rows are realistic');
  const r = await json('/api/run', admin, { action: 'scan-folders' });
  assert.equal(r.ok, true); assert.match(r.message, /demo/);

  // only the folder is set: the dashboard goes live, the folder tab with it; FTP and inbox keep their demo records
  await save({ watch_folder: watch });
  s = await summary();
  assert.equal(s.app.demo, false, 'one outcome is live: the demo switch follows the keys');
  assert.equal((await pane('documents')).source, 'live');
  const tr = await pane('transfers');
  assert.equal(tr.source, 'demo'); assert.equal(tr.configured, false);
  assert.deepEqual(tr.missing, ['FTP host', 'FTP user', 'FTP password']);
  assert.equal(s.panes.find((p) => p.id === 'transfers').state.demo, true, 'the hero marks it D');
  assert.ok(!s.panes.find((p) => p.id === 'documents').state.demo);
  const dd = await pane(P.demo);
  assert.deepEqual(dd.rows.map((x) => [x[0], x[1]]), [['Site documents', 'Live'], ['Contractor file transfers', 'Demo sample'], ['Project inbox', 'Demo sample'], ['Activity record', 'Live']]);
  assert.match(dd.rows[1][3], /^Live when the FTP host, user and password are saved/);
  const sync = await act('transfers', 'sync');
  assert.equal(sync.ok, true); assert.match(sync.message, /^Demo data: /, 'its button works on the demo records and says so');
  const st = await json('/api/admin/state', admin);
  assert.deepEqual(st.connections.map((c) => [c.id, c.ready]), [['folders', true], ['ftp', false], ['imap', false]]);
  const t = await json('/api/admin/connections', admin, { id: 'folders' });
  assert.equal(t.test.ok, true); assert.match(t.test.message, /Folder readable/);
  const miss = await json('/api/admin/connections', admin, { id: 'ftp' });
  assert.equal(miss.test.ok, false); assert.match(miss.test.message, /Missing: .*ftp_host/);

  // a demo switch set by hand holds until saved Settings change what is live; the Demo data tab resets it
  await json('/api/admin/demo', admin, { on: true });
  assert.equal((await summary()).app.demo, true);
  assert.equal((await pane(P.demo)).switch.auto, false);
  const auto = await act(P.demo, 'auto');
  assert.equal(auto.ok, true); assert.equal((await summary()).app.demo, false);
  assert.equal(auto.data.switch.auto, true);
});

test('F5/F6: keys entered in Settings and the Keys tab are used for real calls; wrong keys fail clearly', async (t) => {
  const ftp = await startFtp({ files: { '/data/plan-A1.pdf': 'drawing' } });
  const imap = await startImap({ messages: [{ uid: 1, header: hdr('arch@site.example', 'RFI 12 slab edge') }, { uid: 2, header: hdr('bar@x.example', 'Lunch') }] });
  t.after(async () => { await ftp.close().catch(() => {}); await imap.close().catch(() => {}); });
  const sync = path.join(dir, 'sync');
  const good = { ftp_host: '127.0.0.1', ftp_port: ftp.port, ftp_user: 'bob', ftp_password: 'secret', ftp_secure: 'none', ftp_remote_dir: '/data', ftp_local_dir: sync, ftp_direction: 'download',
    imap_host: '127.0.0.1', imap_port: imap.port, imap_user: 'bob', imap_password: 'secret', imap_secure: false, imap_mailbox: 'INBOX', imap_rules: 'rfi: RFI' };

  // invalid credentials are reported, not hidden
  await save({ ...good, ftp_password: 'wrong', imap_password: 'wrong' });
  assert.equal((await json('/api/admin/connections', admin, { id: 'ftp' })).test.ok, false);
  const bad = (await json('/api/admin/connections', admin, { id: 'imap' })).test;
  assert.equal(bad.ok, false); assert.match(bad.message, /IMAP/);
  let keys = await pane(P.keys);
  assert.equal(keys.keys.find((k) => k.key === 'ftp_password').status, 'Failed');
  assert.equal(keys.keys.find((k) => k.key === 'ftp_password').value, '••••••••', 'a short secret shows no characters');
  assert.equal((await hooks.paneStatus())[P.keys].state, 'bad');

  // replace a key from the Keys tab: Save and test, the result chip, and the tab switches to live
  const fixFtp = await act(P.keys, 'save-key', { key: 'ftp_password', value: 'secret' });
  assert.equal(fixFtp.ok, true, fixFtp.message); assert.match(fixFtp.message, /FTP password saved\. Test passed: Logged in/);
  assert.equal(fixFtp.data.keys.find((k) => k.key === 'ftp_password').status, 'Valid');
  assert.equal((await act(P.keys, 'save-key', { key: 'nope', value: 'x' })).ok, false);
  assert.equal((await act(P.keys, 'save-key', { key: 'imap_password', value: '' })).ok, false);
  await save({ imap_password: 'secret' });
  assert.equal((await json('/api/admin/connections', admin, { id: 'imap' })).test.ok, true);
  const s = await summary();
  assert.equal(s.app.demo, false);
  assert.equal(JSON.stringify(s).includes('secret'), false, 'no key leaks into dashboard data');
  const state = await json('/api/admin/state', admin);
  assert.equal(JSON.stringify(state.settings.values).includes('"secret"'), false, 'saved secrets are masked');
  assert.equal((await pane('transfers')).source, 'live');
  assert.deepEqual((await hooks.paneStatus()).transfers.state, 'ok');

  // the Outside services and Connection health tabs test the real services
  const svc = await pane(P.services);
  assert.equal(svc.summary.ready, 3);
  assert.ok(svc.cards.every((c) => c.fields.every((f) => f.set && f.source === 'Settings')));
  const test1 = await act(P.services, 'test', { id: 'ftp' });
  assert.equal(test1.ok, true, test1.message);
  const all = await act(P.health, 'test-all');
  assert.equal(all.ok, true, all.message);
  const health = all.data;
  assert.equal(health.cards.find((c) => c.id === 'ftp').state, 'ok');
  assert.ok(Number.isFinite(health.cards.find((c) => c.id === 'ftp').latency), 'latency is measured');
  assert.ok(health.latency.series.find((x) => x.name === 'FTP').values.some((v) => v > 0), 'the latency line has the sign-in');
  assert.equal((await act(P.health, 'test', { id: 'database' })).ok, true);

  // the screens' buttons work on the real records
  fs.writeFileSync(path.join(watch, 'A-101.pdf'), 'plan');
  assert.equal((await act('documents', 'scan')).ok, true);   // first sight: the file settles before it is filed
  await new Promise((r) => setTimeout(r, 1200));
  const scan = await act('documents', 'scan');
  assert.equal(scan.ok, true);
  assert.ok(scan.data.arrivals.some((a) => a.file === 'A-101.pdf'), 'scan result lands on the screen');
  assert.equal((await act('transfers', 'sync')).ok, true);   // a remote file must also settle first
  await new Promise((r) => setTimeout(r, 1200));
  const sy = await act(P.history, 'sync');
  assert.equal(sy.ok, true, sy.message);
  assert.equal(fs.readFileSync(path.join(sync, 'plan-A1.pdf'), 'utf8'), 'drawing');
  assert.ok(sy.data.runs[0].label.length && sy.data.runs.some((r) => r.outcome === 'transfers'), 'the run lands in Action history');
  assert.equal((await pane('transfers')).summary.transferred, 1);
  const chk = await act('inbox', 'check');
  assert.equal(chk.ok, true, chk.message);
  assert.deepEqual(chk.data.messages.map((m) => [m.subject, m.result]).sort(), [['Lunch', 'No rule matched'], ['RFI 12 slab edge', 'Matched']]);
  assert.equal(chk.data.rules[0].name, 'rfi');
  const hist = await pane(P.history);
  assert.ok(hist.summary.runsToday >= 4); assert.deepEqual(hist.columns, ['Action', 'Started by', 'Started', 'Duration', 'Result']);

  // rules and direction are edited from the screens, and persist in Settings
  const add = await act('inbox', 'add-rule', { name: 'invoice', keyword: 'Invoice' });
  assert.equal(add.ok, true); assert.deepEqual(add.data.rules.map((r) => r.name), ['rfi', 'invoice']);
  assert.equal((await act('inbox', 'add-rule', { name: '', keyword: 'x' })).ok, false);
  assert.equal((await act('inbox', 'remove-rule', { name: 'invoice' })).data.rules.length, 1);
  assert.equal((await act('transfers', 'set-direction', { direction: 'both' })).data.direction, 'both');
  assert.equal((await act('transfers', 'set-direction', { direction: 'sideways' })).ok, false);
  const nope = await act('documents', 'set-folder', { path: path.join(dir, 'missing') });
  assert.equal(nope.ok, false); assert.match(nope.message, /does not exist/);

  // the activity record exports a CSV download from its own tab
  const rec = await pane('activity-log');
  assert.ok(rec.events.some((e) => e.source === 'ftp') && rec.events.some((e) => e.source === 'imap'));
  const ex = await act('activity-log', 'export');
  assert.equal(ex.ok, true);
  assert.match(ex.data.export.csv, /^Time,Source,Result,What\n/);
  assert.match(ex.data.export.filename, /^activity-record-.*\.csv$/);

  // the Site map snapshot goes to Reports, with the overall state only
  const snap = await act(P.map, 'snapshot');
  assert.equal(snap.ok, true);
  const rs = (await summary()).reports;
  assert.ok(rs.some((r) => r.href.startsWith('reports/site-map-')));
  const body = await (await call('/' + rs.find((r) => r.href.startsWith('reports/site-map-')).href, admin)).text();
  assert.match(body, /Success rate/); assert.doesNotMatch(body, /A-101|plan-A1|RFI 12/, 'no outcome records in a shared report');

  // clearing a key takes its tab back to demo records; failure after a working connection shows on tab and orb
  const cleared = await act(P.keys, 'clear-key', { key: 'imap_password' });
  assert.equal(cleared.ok, true, cleared.message);
  assert.equal((await pane('inbox')).source, 'demo');
  assert.equal(cleared.data.keys.find((k) => k.key === 'imap_password').status, 'Missing');
  await ftp.close();
  const down = await act('transfers', 'sync');
  assert.equal(down.ok, false);
  assert.equal((await hooks.paneStatus()).transfers.state, 'bad');
  assert.equal((await hooks.status()).headline, 'Failing');
  assert.equal((await pane('transfers')).summary.failed >= 1, true);
  assert.equal((await pane(P.health)).cards.find((c) => c.id === 'ftp').state, 'bad');
  assert.equal((await hooks.paneStatus())[P.map].state, 'bad', 'the Site map turns red with it');
});

test('admin and client portals: a client sees and runs only their outcomes, everywhere', async () => {
  const docs = await client('Docs client', ['documents']);
  const view = await client('Viewer', ['documents'], false);
  const c = await summary(docs);
  assert.deepEqual(c.panes.map((p) => p.id), ['documents']);
  assert.ok(c.metrics.every((m) => m.pane === 'documents' || m.pane === 'overview'));
  assert.ok(c.metrics.some((m) => m.key === 'docsFiled') && !c.metrics.some((m) => m.key === 'ftpTransfers' || m.key === 'emailsProcessed'));
  assert.ok(c.panels.every((p) => p.pane === 'documents' || p.pane === 'overview'));
  assert.ok(c.panels.filter((p) => p.pane === 'overview').every((p) => p.kind === 'line'), 'Overview panels carry counts only');
  assert.deepEqual(c.actions.map((x) => x.id), ['scan-folders'], 'the run-everything button is the admin\'s');
  assert.equal((await call('/api/run', docs, { action: 'run' })).status, 404, 'a client cannot run every outcome from Overview');
  assert.equal((await call('/api/run', docs, { action: 'sync-ftp' })).status, 404, 'other tab action is hidden');
  assert.equal((await call('/api/run', docs, { action: 'run-monitor', input: 'folder:site' })).status, 404, 'admin action is hidden');
  assert.equal((await call('/api/pane/transfers', docs)).status, 404);
  assert.equal((await call('/api/pane/inbox/do', docs, { action: 'check' })).status, 404);
  assert.equal((await json('/api/run', docs, { action: 'scan-folders' })).ok, true);
  assert.equal((await act('documents', 'scan', null, docs)).ok, true);
  const edit = await act('documents', 'set-folder', { path: watch }, docs);
  assert.equal(edit.ok, false); assert.match(edit.message, /Only the admin/);
  assert.equal((await call('/api/admin/state', docs)).status, 403);
  assert.equal((await call('/api/admin/connections', docs, { id: 'ftp' })).status, 403);
  assert.equal((await call('/api/summary', {})).status, 401);
  assert.ok(c.status.detail && !/folder:|ftp:|imap:/.test(c.status.detail), 'the shared headline names no monitor');
  for (const r of c.reports) assert.doesNotMatch(await (await call('/' + r.href, docs)).text(), /A-101|plan-A1|RFI 12|Lunch/, r.href + ' carries no records');
  assert.equal((await call('/api/pane/documents/do', view, { action: 'scan' })).status, 403, 'view-only clients cannot press buttons');
  assert.equal((await pane('documents', view)).configured, true, 'but they can read their tab');

  // a client given the cross-outcome tabs and one outcome sees only that outcome's rows inside them
  const mixed = await client('Ops lead', ['documents', P.history, P.outcomes, P.keys, P.health, P.map, P.demo, P.screens, P.services]);
  const hist = await pane(P.history, mixed);
  assert.ok(hist.runs.length && hist.runs.every((r) => r.outcome === 'documents'), 'Action history shows only their outcome');
  assert.deepEqual(hist.buttons.map((b) => b.verb), ['scan']);
  assert.ok(hist.runs.every((r) => ['Schedule', 'You', 'Owner', 'Another user'].includes(r.by)), 'other people are not named');
  const no = await act(P.history, 'sync', null, mixed);
  assert.equal(no.ok, false); assert.match(no.message, /not part of your access/);
  assert.equal((await act(P.history, 'scan', null, mixed)).ok, true);
  const runMine = await act(P.history, 'run-all', null, mixed);
  assert.deepEqual(runMine.output.map((o) => o.outcome), ['documents']); assert.match(runMine.message, /^Documents: /);
  assert.deepEqual((await pane(P.outcomes, mixed)).rows.map((r) => r[2]), ['Site documents']);
  assert.equal((await pane(P.outcomes, mixed)).hidden, 3);
  assert.deepEqual((await pane(P.health, mixed)).cards.map((x) => x.id), ['folders']);
  assert.deepEqual((await pane(P.services, mixed)).cards.map((x) => x.id), ['folders']);
  assert.deepEqual((await pane(P.demo, mixed)).rows.map((r) => r[0]), ['Site documents']);
  assert.deepEqual((await pane(P.map, mixed)).panes.map((p) => p.id).sort(), ['documents', P.history, P.outcomes, P.keys, P.health, P.map, P.demo, P.screens, P.services].sort());
  const k = await pane(P.keys, mixed);
  assert.deepEqual(k.keys.map((x) => [x.key, x.value]), [['watch_folder', 'Set']], 'a client only learns whether a key is set');
  assert.equal(k.canEdit, false);
  assert.equal((await act(P.keys, 'save-key', { key: 'watch_folder', value: dir }, mixed)).ok, false);
  assert.equal((await act(P.health, 'test-all', null, mixed)).ok, false);
  assert.equal((await act(P.demo, 'auto', null, mixed)).ok, false);
  const only = await client('Map only', [P.outcomes]);
  assert.deepEqual((await pane(P.outcomes, only)).rows, [], 'no outcome tab, no outcome rows');
  const text = JSON.stringify([c, await pane('documents', docs), hist, k, await pane(P.health, mixed), await pane(P.services, mixed)]);
  const at = (w) => text.slice(Math.max(0, text.indexOf(w) - 120), text.indexOf(w) + 40);
  for (const leak of ['test-admin-key', ':"secret', 'ftp_password', '"bob"']) assert.equal(text.includes(leak), false, leak + ' never reaches a client: ' + at(leak));
});

test('the demo build exports everything the real hooks do', async () => {
  for (const k of Object.keys(hooks).filter((k) => !['hourly', 'parseRules', 'configFromSettings', 'monitorTable', 'init', 'shutdown', 'ACTIVITY_TYPES', 'ACTIVITY_RESULTS', 'lifecycle', 'allowFor', 'syncDemo'].includes(k))) assert.ok(k in demo, 'demo.mjs exports ' + k);
  const ps = await demo.panels();
  assert.equal(ps.length, spec.panels.length);
  assert.ok(ps.every((p) => p.pane));
});

test('every tab still returns a well-formed screen', async () => {
  const ps = await hooks.panels();
  assert.equal(ps.length, spec.panels.length);
  for (const p of ps) assert.ok(Array.isArray(p.rows) || Array.isArray(p.series), p.title + ' has rows or series');
  srv.close(); await hooks.shutdown();
});
