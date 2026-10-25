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
const { saveSettings } = await import('../dashboard/store.mjs');
saveSettings({ watch_folder: watch });
const hooks = await import('../dashboard/hooks.mjs');
const metric = async (k) => (await hooks.metrics()).find((m) => m.key === k).value;

test('dashboard hooks reflect real agent state after a scan', async () => {
  fs.writeFileSync(path.join(watch, 'a.txt'), 'x');
  let s = await hooks.status();
  assert.equal(s.primary.label, 'Success rate');
  assert.deepEqual(s.ring.map((r) => r.label), ['Runs today', 'Success', 'Last run']);
  await hooks.run('scan-folders');
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const r = await hooks.run('scan-folders');
  assert.equal(r.ok, true); assert.match(r.message, /1 task\(s\) run, 0 failed/);
  s = await hooks.status();
  assert.equal(s.headline, 'Stopped', 'loop not autostarted in this test'); assert.equal(s.mood, 'wait');
  assert.equal(await metric('success'), 100);
  assert.equal(s.primary.value, '100%');
  const docs = await hooks.pane('documents');
  assert.equal(docs.configured, true); assert.equal(docs.source, 'live');
  assert.ok(docs.arrivals.some((a) => a.file === 'a.txt' && a.event === 'Filed'), 'the file appears in the arrivals list');
  assert.equal(docs.summary.filed, 1);
  assert.equal(await metric('docsFiled'), 1);
  const recent = (await hooks.panels()).find((p) => p.title === 'Recent arrivals');
  assert.ok(recent.rows.some((row) => row[0] === 'a.txt'));
  const reps = await hooks.reports();
  assert.ok(reps.length >= 1 && reps.every((x) => fs.existsSync(path.join(process.env.HQ_APP_DATA, 'reports', path.basename(x.href)))));
  assert.ok(reps.every((x) => /^reports\/(overall-state|site-map)-/.test(x.href)), 'shared reports carry the overall state only');
  const body = fs.readFileSync(path.join(process.env.HQ_APP_DATA, 'reports', path.basename(reps[0].href)), 'utf8');
  assert.doesNotMatch(body, /a\.txt/, 'no record from an outcome tab leaks into a shared report');
});

test('counts are transfers and processed emails, not routine successful polls', async () => {
  const before = { t: await metric('ftpTransfers'), e: await metric('emailsProcessed') };
  const { openStore } = await import('../src/sqlite-utils.mjs');
  const w = openStore(process.env.AGENT_DB);
  try {
    w.log('ftp', 'ok', { task: 'ftp:site', attempt: 1, trigger: 'schedule', result: { downloaded: 0, uploaded: 0 } });
    w.log('imap', 'ok', { task: 'imap:pm', attempt: 1, trigger: 'schedule', result: { processed: 0 } });
    w.log('ftp', 'skipped', { monitor: 'site', op: 'download', file: 'x' });
    await hooks.paneAction('documents', 'nothing');   // any action drops the cache
    w.log('ftp', 'ok', { monitor: 'site', op: 'download', file: 'a.dwg', bytes: 2048 });
    w.log('ftp', 'ok', { monitor: 'site', op: 'upload', file: 'b.pdf' });
    w.log('ftp', 'failed', { monitor: 'site', op: 'upload', file: 'c.pdf', error: 'timeout' });
    w.log('imap', 'ok', { monitor: 'pm', uid: 1, rule: 'rfi', from: 'a@x.example', subject: 'RFI 1' });
    w.log('imap', 'ignored', { monitor: 'pm', uid: 2, from: 'b@x.example', subject: 'Lunch' });
    w.log('imap', 'malformed', { monitor: 'pm', uid: 3 });
    w.log('imap', 'failed', { monitor: 'pm', uid: 4, gaveUp: false });
    w.log('imap', 'failed', { monitor: 'pm', uid: 4, gaveUp: true });
    await hooks.paneAction('documents', 'nothing');
    // the FTP and mailbox tabs are not set up in this test, so their own screens show demo records;
    // the activity record (always live) holds every real row
    const act = await hooks.pane('activity-log');
    assert.ok(act.events.some((e) => e.source === 'ftp' && /c\.pdf/.test(e.what)));
    assert.ok(act.events.length > 5 && act.summary.integrity === true);
    assert.ok(act.types.includes('ftp') && act.results.includes('failed'));
    const hist = await hooks.pane('working-actions');
    assert.ok(hist.runs.some((r) => r.label === 'Scheduled FTP sync' && r.by === 'Schedule' && r.message === '0 files transferred, 0 failed'), 'scheduled runs land in the history');
    assert.equal(before.t, (await hooks.pane('transfers')).summary.transferred, 'the FTP tab still shows its demo count until it is set up');
  } finally { w.close(); }
});

test('dashboard connections use Settings and ignore credentials from agent.config.json', () => {
  const file = { folders: [{ name: 'site', path: '/old/path' }], ftp: [{ name: 'site', host: 'old.example', user: 'u', password: 'p' }], imap: [{ name: 'pm', host: 'old-mail.example' }, { name: 'other', host: 'keep.example' }] };
  const out = hooks.configFromSettings(file, { watch_folder: '/new/path', ftp_host: 'new.example', ftp_user: 'bob', ftp_password: 'pw', ftp_direction: 'both', imap_host: 'mail.example', imap_user: 'u', imap_password: 'p', imap_rules: 'rfi: RFI' });
  assert.deepEqual(out.folders.map((f) => f.path), ['/new/path']);
  assert.deepEqual(out.ftp.map((f) => [f.host, f.direction]), [['new.example', 'both']]);
  assert.deepEqual(out.imap.map((m) => m.host), ['mail.example']);
  assert.deepEqual(out.imap[0].rules.map((r) => r.name), ['rfi']);
  assert.deepEqual(hooks.configFromSettings(file, {}).folders, [], 'without Settings there is no live folder');
  assert.deepEqual(hooks.configFromSettings(file, {}).ftp, [], 'file credentials cannot bypass Settings');
  assert.deepEqual(hooks.configFromSettings(file, {}).imap, [], 'file credentials cannot bypass Settings');
});

test('concurrent settings saves, polls and runs rebuild one runtime at a time', async () => {
  const before = hooks.lifecycle();
  const work = [hooks.onSettings(), hooks.status(), hooks.run('scan-folders'), hooks.onSettings(), hooks.paneStatus(), hooks.metrics(), hooks.onSettings()];
  const out = await Promise.allSettled(work);
  assert.deepEqual(out.filter((x) => x.status === 'rejected').map((x) => String(x.reason)), [], 'nothing failed');
  const after = hooks.lifecycle();
  assert.equal(after.open, 1);
  assert.equal(after.opened - after.closed, 1, 'every old runtime was closed before the next one was used');
  assert.ok(after.opened >= before.opened + 3, 'three rebuilds happened');
  assert.equal((await hooks.run('scan-folders')).ok, true, 'the rebuilt agent runs');
});

test('failing monitor turns the orb red and its tab bad', async () => {
  fs.rmSync(watch, { recursive: true });
  const r = await hooks.run('scan-folders');
  assert.equal(r.ok, false);
  const s = await hooks.status();
  assert.equal(s.mood, 'bad'); assert.equal(s.headline, 'Failing');
  assert.doesNotMatch(s.detail, /folder:w|not readable/, 'the shared Overview names no record or error text');
  assert.equal((await hooks.paneStatus()).documents.state, 'bad');
  assert.equal((await hooks.paneStatus())['re-plan-this-solution-from-wha'].state, 'bad');
  assert.equal((await hooks.run('nope')).ok, false);
  await hooks.shutdown();
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
