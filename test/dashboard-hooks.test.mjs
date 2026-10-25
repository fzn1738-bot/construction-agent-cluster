import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-'));
const watch = path.join(dir, 'watch'); fs.mkdirSync(watch);
fs.writeFileSync(path.join(dir, 'cfg.json'), JSON.stringify({ folders: [{ name: 'w', path: watch, intervalMs: 50, settleMs: 0 }] }));
process.env.HQ_APP_DATA = path.join(dir, 'data');
process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'cfg.json'); process.env.AGENT_AUTOSTART = '0';
const hooks = await import('../dashboard/hooks.mjs');

test('dashboard hooks reflect real agent state after a scan', async () => {
  fs.writeFileSync(path.join(watch, 'a.txt'), 'x');
  let s = await hooks.status();
  assert.equal(s.primary.label, 'Active Tasks'); assert.equal(s.ring.length, 3);
  assert.equal(s.ring[0].value, 1);
  await hooks.run('scan-folders'); const r = await hooks.run('scan-folders');
  assert.equal(r.ok, true); assert.match(r.message, /1 task\(s\) run, 0 failed/);
  s = await hooks.status();
  assert.equal(s.headline, 'Stopped', 'loop not autostarted in this test'); assert.equal(s.mood, 'wait');
  const rate = (await hooks.metrics()).find((m) => m.key === 'syncRate');
  assert.equal(rate.value, 100);
  const docs = await hooks.pane('documents');
  assert.equal(docs.configured, true); assert.equal(docs.source, 'live');
  assert.ok(docs.arrivals.some((a) => a.file === 'a.txt' && a.event === 'Filed'), 'the file appears in the arrivals list');
  assert.equal(docs.summary.filed, 1);
  const recent = (await hooks.panels()).find((p) => p.title === 'Recent arrivals');
  assert.ok(recent.rows.some((row) => row[0] === 'a.txt'));
  const reps = await hooks.reports();
  assert.ok(reps.every((x) => fs.existsSync(path.join(process.env.HQ_APP_DATA, 'reports', path.basename(x.href)))));
});

test('ring counts transfers and processed emails, not routine successful polls', async () => {
  const before = (await hooks.status()).ring;
  const { openStore } = await import('../src/sqlite-utils.mjs');
  const w = openStore(process.env.AGENT_DB);
  try {
    w.log('ftp', 'ok', { task: 'ftp:site', attempt: 1, trigger: 'schedule', result: { downloaded: 0, uploaded: 0 } });
    w.log('imap', 'ok', { task: 'imap:pm', attempt: 1, trigger: 'schedule', result: { processed: 0 } });
    w.log('ftp', 'skipped', { monitor: 'site', op: 'download', file: 'x' });
    let s = await hooks.status();
    assert.deepEqual([s.ring[1].value, s.ring[2].value], [before[1].value, before[2].value], 'polls with no work do not count');
    w.log('ftp', 'ok', { monitor: 'site', op: 'download', file: 'a.dwg', bytes: 2048 });
    w.log('ftp', 'ok', { monitor: 'site', op: 'upload', file: 'b.pdf' });
    w.log('ftp', 'failed', { monitor: 'site', op: 'upload', file: 'c.pdf', error: 'timeout' });
    w.log('imap', 'ok', { monitor: 'pm', uid: 1, rule: 'rfi', from: 'a@x.example', subject: 'RFI 1' });
    w.log('imap', 'ignored', { monitor: 'pm', uid: 2, from: 'b@x.example', subject: 'Lunch' });
    w.log('imap', 'malformed', { monitor: 'pm', uid: 3 });
    w.log('imap', 'failed', { monitor: 'pm', uid: 4, gaveUp: false });
    w.log('imap', 'failed', { monitor: 'pm', uid: 4, gaveUp: true });
    s = await hooks.status();
    assert.equal(s.ring[1].value, before[1].value + 2);
    assert.equal(s.ring[2].value, before[2].value + 4, 'a retried message counts once, when acknowledged');
    const ms = await hooks.metrics();
    assert.equal(ms.find((m) => m.key === 'ftpFailed').value, 1);
    // each tab's records come from the same log
    const tr = await hooks.pane('transfers');
    assert.deepEqual(tr.transfers.filter((t) => t.status === 'failed').map((t) => t.file), ['c.pdf']);
    assert.equal(tr.summary.transferred, 2);
    const inbox = await hooks.pane('inbox');
    assert.ok(inbox.messages.some((m) => m.subject === 'RFI 1' && m.rule === 'rfi' && m.result === 'Matched'));
    assert.deepEqual(inbox.byRule.labels.sort(), ['No rule', 'rfi']);
    const act = await hooks.pane('activity-log');
    assert.ok(act.events.length > 5 && act.summary.integrity === true);
    assert.ok(act.types.includes('ftp') && act.results.includes('failed'));
  } finally { w.close(); }
});

test('failing monitor turns the orb red and its tab bad', async () => {
  fs.rmSync(watch, { recursive: true });
  const r = await hooks.run('scan-folders');
  assert.equal(r.ok, false);
  const s = await hooks.status();
  assert.equal(s.mood, 'bad'); assert.equal(s.headline, 'Failing');
  assert.equal((await hooks.paneStatus()).documents.state, 'bad');
  assert.equal((await hooks.run('nope')).ok, false);
});

test('hourly buckets count events into the last 24 hours, oldest first', () => {
  const now = Date.parse('2026-10-25T12:00:00Z');
  const b = hooks.hourly([{ timestamp: '2026-10-25T11:30:00Z' }, { timestamp: '2026-10-25T11:59:00Z' }, { timestamp: '2026-10-24T13:10:00Z' }, { timestamp: '2026-10-20T13:10:00Z' }], now);
  assert.equal(b.values.length, 24); assert.equal(b.labels[23], 'now');
  assert.equal(b.values[23], 2); assert.equal(b.values[1], 1); assert.equal(b.values.reduce((a, c) => a + c, 0), 3);
});

test('rules parse from the settings text and round-trip', () => {
  assert.deepEqual(hooks.parseRules('rfi: RFI\n\ninvoice: Invoice 77\njust a keyword'), [
    { name: 'rfi', subject: 'RFI', action: 'log' }, { name: 'invoice', subject: 'Invoice 77', action: 'log' }, { name: 'just a keyword', subject: 'just a keyword', action: 'log' }]);
});
