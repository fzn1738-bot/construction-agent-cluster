import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../src/agent-core.mjs';
import { openStore } from '../src/sqlite-utils.mjs';
import { FolderMonitor, FtpMonitor, ImapMonitor, buildMonitors, makeAction } from '../src/monitors.mjs';
import { startFtp } from '../testkit/mock-ftp.mjs';
import { startImap } from '../testkit/mock-imap.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mon-'));
const old = (f) => { const t = new Date(Date.now() - 10000); fs.utimesSync(f, t, t); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('F2: folder monitor detects a new file within 5s when run by the agent loop', async () => {
  const dir = tmp(); const store = openStore(':memory:'); const seen = [];
  const mon = new FolderMonitor({ name: 'inbox', dir, store, intervalMs: 100, settleMs: 100, onAdd: (ev) => { seen.push(ev.name); } });
  const agent = new Agent({ store, tickMs: 20 }).addMonitor(mon);
  await agent.start();
  const t0 = Date.now();
  fs.writeFileSync(path.join(dir, 'plan.pdf'), 'x');
  while (!seen.length && Date.now() - t0 < 5000) await sleep(20);
  await agent.stop();
  assert.deepEqual(seen, ['plan.pdf']);
  assert.ok(Date.now() - t0 < 5000);
  assert.ok(store.recentLogs({ type: 'folder' }).some((l) => l.details.event === 'added'));
});

test('F2: default timing (1s poll, 1s settle) detects well inside 5 seconds', async () => {
  const dir = tmp(); const store = openStore(':memory:'); const seen = [];
  const mon = new FolderMonitor({ name: 'd', dir, store, onAdd: (ev) => seen.push(ev.name) });
  const agent = new Agent({ store, tickMs: 50 }).addMonitor(mon);
  await agent.start();
  const t0 = Date.now(); fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  while (!seen.length && Date.now() - t0 < 5000) await sleep(50);
  await agent.stop();
  assert.equal(seen.length, 1); assert.ok(Date.now() - t0 < 5000, 'took ' + (Date.now() - t0) + 'ms');
});

test('F2: no duplicates, waits for files still being written, survives restart', async () => {
  const dir = tmp(); const file = path.join(dir, 'db.sqlite'); let store = openStore(file); const seen = [];
  const mk = () => new FolderMonitor({ name: 'w', dir: path.join(dir, 'in'), store, settleMs: 50, onAdd: (e) => seen.push(e.name) });
  fs.mkdirSync(path.join(dir, 'in'));
  const f = path.join(dir, 'in', 'big.bin');
  fs.writeFileSync(f, 'a'); await mk().poll();
  fs.appendFileSync(f, 'b'); await sleep(60); const m = mk(); await m.poll(); // size changed: not stable yet
  assert.deepEqual(seen, []);
  await sleep(60); await m.poll();
  assert.deepEqual(seen, ['big.bin']);
  await m.poll(); await m.poll();
  assert.equal(seen.length, 1, 'no duplicate detection');
  store.close(); store = openStore(file);
  await mk().poll();
  assert.equal(seen.length, 1, 'restart does not re-trigger');
  store.close();
});

test('F2: ignores .part files, handles deletions and renames, baseline option', async () => {
  const dir = tmp(); const store = openStore(':memory:'); const seen = [];
  fs.writeFileSync(path.join(dir, 'existing.txt'), 'e'); old(path.join(dir, 'existing.txt'));
  const m = new FolderMonitor({ name: 'r', dir, store, settleMs: 0, baseline: true, onAdd: (e) => seen.push(e.name) });
  await m.poll(); fs.writeFileSync(path.join(dir, 'new.txt'), 'n'); fs.writeFileSync(path.join(dir, 'tmp.part'), 'p');
  await m.poll(); await m.poll();
  assert.deepEqual(seen, ['new.txt']);
  fs.renameSync(path.join(dir, 'new.txt'), path.join(dir, 'renamed.txt'));
  await m.poll(); await m.poll();
  assert.deepEqual(seen, ['new.txt'], 'rename is not a new addition');
  fs.rmSync(path.join(dir, 'existing.txt'));
  const r = await m.poll();
  assert.equal(r.removed, 0 + 1);
  const events = store.recentLogs({ type: 'folder' }).map((l) => l.details.event);
  assert.ok(events.includes('renamed') && events.includes('removed'));
});

test('F2: inaccessible folder fails the poll; failed actions retry then give up', async () => {
  const store = openStore(':memory:');
  await assert.rejects(new FolderMonitor({ name: 'x', dir: '/nonexistent/zzz', store }).poll(), /not readable/);
  const dir = tmp(); let tries = 0;
  const m = new FolderMonitor({ name: 'f', dir, store, settleMs: 0, maxActionAttempts: 2, onAdd: () => { tries++; throw new Error('action broke'); } });
  fs.writeFileSync(path.join(dir, 'a'), '1');
  for (let i = 0; i < 6; i++) await m.poll();
  assert.equal(tries, 2);
  assert.ok(store.recentLogs({ type: 'folder' }).some((l) => l.status === 'failed' && l.details.gaveUp));
});

test('F2: scans large folders within budget and still finds everything', async () => {
  const dir = tmp(); const store = openStore(':memory:'); let n = 0;
  for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(dir, 'f' + i), 'x');
  const m = new FolderMonitor({ name: 'big', dir, store, settleMs: 0, budgetMs: 0, onAdd: () => { n++; } });
  for (let i = 0; i < 12 && n < 600; i++) await m.poll();
  assert.equal(n, 600);
});

test('F2: exec actions run commands without a shell', async () => {
  const out = await makeAction({ exec: [process.execPath, '-e', 'console.log(process.env.EVENT_NAME)'] })({ name: 'hello.txt', path: '/x' });
  assert.equal(out.trim(), 'hello.txt');
});

test('F3: FTP monitor connects with credentials, downloads, does not retransfer', async () => {
  const srv = await startFtp({ files: { '/data/a.txt': 'alpha', '/data/b.txt': 'bravo!' } });
  const store = openStore(':memory:'); const local = tmp();
  const mk = (o = {}) => new FtpMonitor({ name: 's', store, host: '127.0.0.1', port: srv.port, user: 'bob', password: 'secret', remoteDir: '/data', localDir: local, ...o });
  try {
    const r = await mk().poll();
    assert.equal(r.downloaded, 2);
    assert.equal(fs.readFileSync(path.join(local, 'a.txt'), 'utf8'), 'alpha');
    assert.equal((await mk().poll()).downloaded, 0);
    assert.equal(srv.log.filter((l) => l.startsWith('RETR')).length, 2);
    assert.ok(store.recentLogs({ type: 'ftp' }).some((l) => l.status === 'ok' && l.details.op === 'download'));
    srv.files.set('/data/a.txt', { data: Buffer.from('alpha v2'), modify: '20260105000000' });
    assert.equal((await mk().poll()).downloaded, 1, 'changed remote file is fetched');
    assert.equal(fs.readFileSync(path.join(local, 'a.txt'), 'utf8'), 'alpha v2');
  } finally { await srv.close(); }
});

test('F3: FTP bad credentials fail and are logged', async () => {
  const srv = await startFtp({});
  const store = openStore(':memory:');
  try {
    await assert.rejects(new FtpMonitor({ name: 'b', store, host: '127.0.0.1', port: srv.port, user: 'bob', password: 'wrong', localDir: tmp() }).poll(), /PASS failed/);
    assert.ok(store.recentLogs({ type: 'ftp' }).some((l) => l.status === 'failed'));
  } finally { await srv.close(); }
});

test('F3: partial transfer is rejected and leaves no file; local conflicts are not overwritten', async () => {
  const srv = await startFtp({ files: { '/d/x.txt': '0123456789' }, truncateRetr: true });
  const store = openStore(':memory:'); const local = tmp();
  try {
    await assert.rejects(new FtpMonitor({ name: 'p', store, host: '127.0.0.1', port: srv.port, user: 'bob', password: 'secret', remoteDir: '/d', localDir: local }).poll(), /partial transfer/);
    assert.deepEqual(fs.readdirSync(local), []);
    fs.writeFileSync(path.join(local, 'x.txt'), 'mine');
    const r = await new FtpMonitor({ name: 'p2', store, host: '127.0.0.1', port: srv.port, user: 'bob', password: 'secret', remoteDir: '/d', localDir: local }).poll();
    assert.equal(r.skipped, 1);
    assert.equal(fs.readFileSync(path.join(local, 'x.txt'), 'utf8'), 'mine');
  } finally { await srv.close(); }
});

test('F3: FTP upload sends new local files once, via temp name + rename', async () => {
  const srv = await startFtp({ files: { '/up/keep.txt': 'k' } });
  const store = openStore(':memory:'); const local = tmp();
  fs.writeFileSync(path.join(local, 'report.txt'), 'quarterly'); old(path.join(local, 'report.txt'));
  const mk = () => new FtpMonitor({ name: 'u', store, host: '127.0.0.1', port: srv.port, user: 'bob', password: 'secret', remoteDir: '/up', localDir: local, direction: 'both' });
  try {
    let r = await mk().poll();
    assert.equal(r.uploaded, 1);
    assert.equal(srv.files.get('/up/report.txt').data.toString(), 'quarterly');
    assert.ok(!srv.files.has('/up/report.txt.part'));
    assert.equal(r.downloaded, 1);
    r = await mk().poll();
    assert.equal(r.uploaded, 0); assert.equal(r.downloaded, 0, 'nothing retransferred');
    assert.equal(srv.log.filter((l) => l.startsWith('STOR')).length, 1);
  } finally { await srv.close(); }
});

test('F3: FTP server down -> agent retries then records failure', async () => {
  const srv = await startFtp({}); const port = srv.port; await srv.close();
  const store = openStore(':memory:');
  const mon = new FtpMonitor({ name: 'down', store, host: '127.0.0.1', port, user: 'bob', password: 'secret', localDir: tmp(), retries: 1 });
  const agent = new Agent({ store }).addMonitor(mon, { backoffMs: 5 });
  const r = await agent.runTask('ftp:down');
  assert.equal(r.status, 'failed'); assert.equal(r.attempts, 2);
});

const hdr = (from, subject) => `From: ${from}\r\nSubject: ${subject}\r\nDate: Mon, 1 Jan 2026 10:00:00 +0000\r\nMessage-ID: <${Math.random()}@x>\r\n\r\n`;
const imapMon = (srv, store, rules, o = {}) => new ImapMonitor({ name: 'mail', store, host: '127.0.0.1', port: srv.port, secure: false, user: 'bob', password: 'secret', rules, ...o });

test('F4: IMAP processes new mail by rules, once, and logs it', async () => {
  const srv = await startImap({ messages: [
    { uid: 1, header: hdr('arch@site.com', 'RFI 12 drawing update') },
    { uid: 2, header: hdr('spam@x.com', 'cheap watches') },
    { uid: 3, header: hdr('pm@site.com', '=?utf-8?B?SW52b2ljZSBjYWbDqQ==?=') }
  ] });
  const store = openStore(':memory:'); const got = [];
  const rules = [{ name: 'rfi', subject: 'rfi', action: (m) => { got.push(m.subject); } }, { name: 'invoice', subject: /invoice/i, action: (m) => { got.push(m.subject); } }];
  try {
    const r = await imapMon(srv, store, rules).poll();
    assert.deepEqual(r, { processed: 3, matched: 2, ignored: 1, malformed: 0, ruleFailures: 0 });
    assert.deepEqual(got, ['RFI 12 drawing update', 'Invoice café']);
    srv.state.messages.push({ uid: 4, header: hdr('arch@site.com', 'RFI 13') });
    const r2 = await imapMon(srv, store, rules).poll();
    assert.equal(r2.processed, 1);
    assert.equal((await imapMon(srv, store, rules).poll()).processed, 0, 'nothing reprocessed');
    assert.equal(store.countLogs('imap', 'ok'), 3);
    assert.equal(store.getCheckpoint('imap:mail').lastUid, 4);
  } finally { await srv.close(); }
});

test('F4: IMAP bad credentials fail; malformed messages and rule failures do not block the mailbox', async () => {
  const srv = await startImap({ messages: [{ uid: 5, header: 'garbage without headers' }, { uid: 6, header: null }, { uid: 7, header: hdr('a@b.c', 'RFI boom') }, { uid: 8, header: hdr('a@b.c', 'RFI ok') }] });
  const store = openStore(':memory:');
  try {
    await assert.rejects(imapMon(srv, store, [], { password: 'nope' }).poll(), /LOGIN failed/);
    let n = 0;
    const r = await imapMon(srv, store, [{ subject: 'rfi', action: () => { if (n++ === 0) throw new Error('rule exploded'); } }]).poll();
    assert.equal(r.malformed, 2); assert.equal(r.ruleFailures, 1); assert.equal(r.matched, 1); assert.equal(r.processed, 4);
    assert.equal(store.getCheckpoint('imap:mail').lastUid, 8);
  } finally { await srv.close(); }
});

test('F4: UIDVALIDITY change restarts from the beginning; restart resumes from checkpoint', async () => {
  const srv = await startImap({ uidValidity: 1, messages: [{ uid: 1, header: hdr('a@b.c', 'one') }, { uid: 2, header: hdr('a@b.c', 'two') }] });
  const store = openStore(':memory:');
  try {
    assert.equal((await imapMon(srv, store, []).poll()).processed, 2);
    srv.state.uidValidity = 2;
    assert.equal((await imapMon(srv, store, []).poll()).processed, 2, 'mailbox was rebuilt: reprocess');
    assert.ok(store.recentLogs({ type: 'imap' }).some((l) => l.status === 'reset'));
    assert.equal((await imapMon(srv, store, []).poll()).processed, 0);
  } finally { await srv.close(); }
});

test('buildMonitors creates monitors from config and reads passwords from env', () => {
  process.env.TEST_PW = 's3';
  const store = openStore(':memory:');
  const ms = buildMonitors({ folders: [{ name: 'f', path: tmp() }], ftp: [{ name: 'x', host: 'h', user: 'u', passwordEnv: 'TEST_PW', localDir: tmp() }], imap: [{ name: 'm', host: 'h', user: 'u', passwordEnv: 'TEST_PW' }] }, store);
  assert.deepEqual(ms.map((m) => m.id), ['folder:f', 'ftp:x', 'imap:m']);
  assert.equal(ms[1].makeClient().password, 's3');
});
