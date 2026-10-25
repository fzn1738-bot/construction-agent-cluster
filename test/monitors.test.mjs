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
  await m.poll(); // first sighting: recorded, action runs once the size is confirmed stable
  for (let i = 0; i < 6; i++) await assert.rejects(m.poll(), /1 file action\(s\) failed: a/);
  assert.equal(tries, 2);
  assert.ok(store.recentLogs({ type: 'folder' }).some((l) => l.status === 'failed' && l.details.gaveUp));
});

test('F2: a permanently failing action shows as a failed task until the file is fixed or removed', async () => {
  const dir = tmp(); const store = openStore(':memory:'); let broken = true; const done = [];
  const mon = new FolderMonitor({ name: 'p', dir, store, settleMs: 0, maxActionAttempts: 2, retries: 1, onAdd: (e) => { if (broken) throw new Error('printer offline'); done.push(e.name); } });
  const agent = new Agent({ store }).addMonitor(mon, { backoffMs: 1 });
  const f = path.join(dir, 'rfi.pdf'); fs.writeFileSync(f, 'v1'); old(f);
  assert.equal((await agent.runTask(mon.id)).status, 'ok', 'first sighting only records the file');
  let r = await agent.runTask(mon.id);
  assert.equal(r.status, 'failed'); assert.equal(r.attempts, 2, 'agent retried the poll');
  assert.match(r.error, /rfi\.pdf \(gave up\): printer offline/);
  assert.equal(store.getTask(mon.id).status, 'failed', 'visible task state is failed');
  r = await agent.runTask(mon.id);
  assert.equal(r.status, 'failed', 'given-up file keeps the task failed'); assert.deepEqual(done, []);
  broken = false; fs.writeFileSync(f, 'v2 fixed'); old(f);
  assert.equal((await agent.runTask(mon.id)).status, 'ok', 'modified: failure cleared, waiting for the file to settle');
  r = await agent.runTask(mon.id);
  assert.equal(r.status, 'ok', r.error); assert.deepEqual(done, ['rfi.pdf'], 'modified file is retried and delivered');
  broken = true; fs.writeFileSync(path.join(dir, 'bad.dwg'), 'x'); old(path.join(dir, 'bad.dwg'));
  await agent.runTask(mon.id);
  assert.equal((await agent.runTask(mon.id)).status, 'failed');
  fs.rmSync(path.join(dir, 'bad.dwg'));
  assert.equal((await agent.runTask(mon.id)).status, 'ok', 'removing the file clears the failure');
});

test('F2/F5: a slow action that outlasts graceMs still records its result before the store is closed', async () => {
  const dir = tmp(); const file = path.join(tmp(), 'state.db'); const store = openStore(file); let finished = false;
  const mon = new FolderMonitor({ name: 'slow', dir, store, settleMs: 0, actionWaitMs: 0, onAdd: async () => { await sleep(300); finished = true; } });
  const agent = new Agent({ store, graceMs: 50 }).addMonitor(mon);
  fs.writeFileSync(path.join(dir, 'model.ifc'), 'x');
  await agent.start();
  while (!mon.active.size) await sleep(5);
  const { forced } = await agent.stop();
  assert.equal(forced, true); assert.equal(finished, false, 'action still running after the grace period');
  await agent.idle(); store.close();
  assert.equal(finished, true);
  const again = openStore(file);
  try {
    assert.equal(again.getCheckpoint('folder:slow').files['model.ifc'].emitted, true, 'checkpoint saved before close');
    assert.ok(again.recentLogs({ type: 'folder' }).some((l) => l.details.event === 'added'));
    assert.ok(again.recentLogs({ type: 'system' }).some((l) => l.status === 'stopped-forced'));
  } finally { again.close(); }
});

test('F5: writes after close are dropped instead of throwing', () => {
  const store = openStore(':memory:'); store.close();
  assert.equal(store.log('folder', 'ok', {}), null);
  assert.equal(store.setTask('t', 'ok'), null);
  assert.doesNotThrow(() => store.setCheckpoint('c', {}));
});

test('F2: scans large folders within budget and still finds everything', async () => {
  const dir = tmp(); const store = openStore(':memory:'); let n = 0;
  for (let i = 0; i < 600; i++) fs.writeFileSync(path.join(dir, 'f' + i), 'x');
  const m = new FolderMonitor({ name: 'big', dir, store, settleMs: 0, budgetMs: 0, onAdd: () => { n++; } });
  for (let i = 0; i < 12 && n < 600; i++) await m.poll();
  assert.equal(n, 600);
});

test('F2: no entry cap: a new file in a folder of 21,000 files is detected on the next polls', async () => {
  const dir = tmp(); const store = openStore(':memory:'); const seen = [];
  for (let i = 0; i < 21000; i++) fs.writeFileSync(path.join(dir, 'f' + String(i).padStart(5, '0')), '');
  const m = new FolderMonitor({ name: 'huge', dir, store, settleMs: 0, baseline: true, onAdd: (e) => { seen.push(e.name); } });
  await m.poll();
  fs.writeFileSync(path.join(dir, 'zz-new.dwg'), 'x');
  const t0 = Date.now();
  const r1 = await m.poll(); await m.poll();
  assert.equal(r1.scanned, 21001);
  assert.deepEqual(seen, ['zz-new.dwg']);
  assert.ok(Date.now() - t0 < 5000, 'two polls of 21k files took ' + (Date.now() - t0) + 'ms');
});

test('F2: a slow action does not delay detection of later additions', async () => {
  const dir = tmp(); const store = openStore(':memory:'); const started = {};
  const mon = new FolderMonitor({ name: 's', dir, store, intervalMs: 200, settleMs: 100, onAdd: async (e) => { started[e.name] = Date.now(); if (e.name === 'slow.ifc') await sleep(2500); } });
  const agent = new Agent({ store, tickMs: 20, graceMs: 5000 }).addMonitor(mon);
  await agent.start();
  try {
    fs.writeFileSync(path.join(dir, 'slow.ifc'), 's');
    while (!started['slow.ifc']) await sleep(20);
    const t0 = Date.now(); fs.writeFileSync(path.join(dir, 'quick.pdf'), 'q');
    while (!started['quick.pdf'] && Date.now() - t0 < 5000) await sleep(20);
    assert.ok(started['quick.pdf'], 'quick.pdf action started');
    assert.ok(started['quick.pdf'] - t0 < 2000, 'started after ' + (started['quick.pdf'] - t0) + 'ms while slow.ifc was still running');
    assert.ok(store.recentLogs({ type: 'folder' }).some((l) => l.details.event === 'detected' && /quick\.pdf$/.test(l.details.path)));
    assert.equal(mon.queueDepth, 1, 'slow.ifc still running');
  } finally { await agent.stop(); }
  assert.equal(mon.queueDepth, 0, 'stop() waited for the running action');
  assert.ok(store.recentLogs({ type: 'folder' }).some((l) => l.details.event === 'added' && /slow\.ifc$/.test(l.details.path)));
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

test('F3: deleted local copy is fetched again; same-size remote change is detected for uploaded files', async () => {
  const srv = await startFtp({ files: { '/s/a.txt': 'alpha' } });
  const store = openStore(':memory:'); const local = tmp();
  const mk = (direction) => new FtpMonitor({ name: 'r', store, host: '127.0.0.1', port: srv.port, user: 'bob', password: 'secret', remoteDir: '/s', localDir: local, direction, settleMs: 0 });
  try {
    assert.equal((await mk('download').poll()).downloaded, 1);
    fs.rmSync(path.join(local, 'a.txt'));
    assert.equal((await mk('download').poll()).downloaded, 1, 'local copy missing: downloaded again');
    assert.equal(fs.readFileSync(path.join(local, 'a.txt'), 'utf8'), 'alpha');

    fs.writeFileSync(path.join(local, 'b.txt'), 'bravo'); old(path.join(local, 'b.txt'));
    let r = await mk('both').poll();
    assert.equal(r.uploaded, 1);
    assert.equal(store.getCheckpoint('ftp:r').files['b.txt'].modify, '20260102120000', 'server modify time recorded after upload');
    srv.files.set('/s/b.txt', { data: Buffer.from('BRAVO'), modify: '20260301000000' }); // same size, new content
    r = await mk('both').poll();
    assert.equal(r.downloaded, 1); assert.equal(r.uploaded, 0);
    assert.equal(fs.readFileSync(path.join(local, 'b.txt'), 'utf8'), 'BRAVO');
    r = await mk('both').poll();
    assert.deepEqual([r.downloaded, r.uploaded], [0, 0], 'in sync again');
  } finally { await srv.close(); }
});

test('F3: upload-only re-sends a file deleted on the server and never overwrites a remote change', async () => {
  const srv = await startFtp({});
  const store = openStore(':memory:'); const local = tmp();
  fs.writeFileSync(path.join(local, 'r.txt'), 'v1'); old(path.join(local, 'r.txt'));
  const mk = () => new FtpMonitor({ name: 'up', store, host: '127.0.0.1', port: srv.port, user: 'bob', password: 'secret', remoteDir: '/u', localDir: local, direction: 'upload', settleMs: 0 });
  try {
    assert.equal((await mk().poll()).uploaded, 1);
    assert.equal((await mk().poll()).uploaded, 0);
    srv.files.delete('/u/r.txt');
    assert.equal((await mk().poll()).uploaded, 1, 'remote copy missing: uploaded again');
    srv.files.set('/u/r.txt', { data: Buffer.from('edited on site'), modify: '20260401000000' });
    const r = await mk().poll();
    assert.equal(r.uploaded, 0); assert.equal(r.skipped, 1);
    assert.equal(srv.files.get('/u/r.txt').data.toString(), 'edited on site');
    assert.ok(store.recentLogs({ type: 'ftp' }).some((l) => l.status === 'skipped' && /remote copy changed/.test(l.details.reason)));
  } finally { await srv.close(); }
});

test('F3: a failed listing right after RNTO does not strand the upload; the next poll recovers', async () => {
  const { FtpClient } = await import('../src/ftp-client.mjs');
  const srv = await startFtp({});
  const store = openStore(':memory:'); const local = tmp();
  fs.writeFileSync(path.join(local, 'site.txt'), 'pour log'); old(path.join(local, 'site.txt'));
  let failList = 0;
  const client = () => {
    const c = new FtpClient({ host: '127.0.0.1', port: srv.port, user: 'bob', password: 'secret' });
    const list = c.list.bind(c); let n = 0;
    c.list = async (d) => { n++; if (n === 2 && failList-- > 0) throw new Error('425 cannot open data connection'); return list(d); };
    return c;
  };
  const mk = () => new FtpMonitor({ name: 'cf', store, remoteDir: '/c', localDir: local, direction: 'upload', settleMs: 0, client });
  try {
    failList = 1;
    await assert.rejects(mk().poll(), /listing after upload: 425/);
    assert.equal(srv.files.get('/c/site.txt').data.toString(), 'pour log', 'RNTO happened');
    assert.equal(store.getCheckpoint('ftp:cf').files['site.txt'].unconfirmed, true);
    assert.ok(store.recentLogs({ type: 'ftp' }).some((l) => l.status === 'failed' && l.details.op === 'confirm'));
    let r = await mk().poll();
    assert.deepEqual([r.uploaded, r.skipped], [0, 0], 'recognised as our own upload, not a remote change');
    const rec = store.getCheckpoint('ftp:cf').files['site.txt'];
    assert.equal(rec.unconfirmed, undefined); assert.equal(rec.modify, srv.files.get('/c/site.txt').modify);
    fs.writeFileSync(path.join(local, 'site.txt'), 'pour log v2'); old(path.join(local, 'site.txt'));
    r = await mk().poll();
    assert.equal(r.uploaded, 1, 'later local edits still upload');
    assert.equal(srv.files.get('/c/site.txt').data.toString(), 'pour log v2');
    assert.equal(srv.log.filter((l) => l.startsWith('STOR')).length, 2);
  } finally { await srv.close(); }
});

test('F3: an agent timeout aborts a hung FTP poll by closing the connection', async () => {
  const net = await import('node:net');
  const socks = []; const hung = net.createServer((sk) => socks.push(sk)); // accepts, never greets
  await new Promise((r) => hung.listen(0, '127.0.0.1', r));
  const store = openStore(':memory:');
  const mon = new FtpMonitor({ name: 'hung', store, host: '127.0.0.1', port: hung.address().port, user: 'bob', password: 'secret', localDir: tmp(), timeoutMs: 30000, retries: 0 });
  const agent = new Agent({ store }).addMonitor(mon, { timeoutMs: 100, timeoutGraceMs: 2000 });
  try {
    const t0 = Date.now();
    const r = await agent.runTask('ftp:hung');
    assert.equal(r.status, 'failed'); assert.match(r.error, /timed out after 100ms$/);
    assert.ok(Date.now() - t0 < 1500, 'attempt ended promptly after abort, not after the 30s socket timeout');
    assert.equal(agent.lingering.size, 0);
    assert.ok(store.recentLogs({ type: 'ftp' }).some((l) => l.status === 'failed' && l.details.op === 'aborted'));
  } finally { for (const sk of socks) sk.destroy(); hung.close(); }
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
    assert.deepEqual(r, { processed: 3, matched: 2, ignored: 1, malformed: 0, ruleFailures: 0, gaveUp: 0, backlog: 0 });
    assert.deepEqual(got, ['RFI 12 drawing update', 'Invoice café']);
    srv.state.messages.push({ uid: 4, header: hdr('arch@site.com', 'RFI 13') });
    const r2 = await imapMon(srv, store, rules).poll();
    assert.equal(r2.processed, 1);
    assert.equal((await imapMon(srv, store, rules).poll()).processed, 0, 'nothing reprocessed');
    assert.equal(store.countLogs('imap', 'ok'), 3);
    assert.equal(store.getCheckpoint('imap:mail').lastUid, 4);
  } finally { await srv.close(); }
});

test('F4: IMAP bad credentials fail; malformed mail is skipped; a failed rule is NOT acknowledged and is retried', async () => {
  const srv = await startImap({ messages: [{ uid: 5, header: 'garbage without headers' }, { uid: 6, header: null }, { uid: 7, header: hdr('a@b.c', 'RFI boom') }, { uid: 8, header: hdr('a@b.c', 'RFI ok') }] });
  const store = openStore(':memory:');
  try {
    await assert.rejects(imapMon(srv, store, [], { password: 'nope' }).poll(), /LOGIN failed/);
    const seen = [];
    const rules = [{ subject: 'rfi', action: (m) => { seen.push(m.uid); if (seen.length === 1) throw new Error('rule exploded'); } }];
    await assert.rejects(imapMon(srv, store, rules).poll(), /failed on UID 7 \(attempt 1 of 5\): rule exploded/);
    assert.equal(store.getCheckpoint('imap:mail').lastUid, 6, 'malformed mail acknowledged, failed message is not');
    assert.ok(store.recentLogs({ type: 'imap' }).some((l) => l.status === 'failed' && l.details.uid === 7 && l.details.gaveUp === false));
    const r = await imapMon(srv, store, rules).poll();
    assert.deepEqual(seen, [7, 7, 8], 'UID 7 retried, then UID 8 processed');
    assert.equal(r.matched, 2); assert.equal(r.processed, 2);
    assert.equal(store.getCheckpoint('imap:mail').lastUid, 8);
    assert.deepEqual(store.getCheckpoint('imap:mail').failures, {});
  } finally { await srv.close(); }
});

test('F4: agent retries recover a failed email rule; a permanently failing rule gives up after maxRuleAttempts', async () => {
  const srv = await startImap({ messages: [{ uid: 1, header: hdr('a@b.c', 'RFI 1') }, { uid: 2, header: hdr('a@b.c', 'RFI 2') }] });
  const store = openStore(':memory:');
  try {
    let calls = 0;
    const flaky = [{ subject: 'rfi', action: () => { if (++calls === 1) throw new Error('smtp down'); } }];
    const agent = new Agent({ store }).addMonitor(imapMon(srv, store, flaky), { backoffMs: 1 });
    const r = await agent.runTask('imap:mail');
    assert.equal(r.status, 'ok'); assert.equal(r.attempts, 2, 'retried by the agent');
    assert.equal(calls, 3); assert.equal(store.getCheckpoint('imap:mail').lastUid, 2);

    const store2 = openStore(':memory:');
    const broken = [{ subject: 'rfi 1', action: () => { throw new Error('always'); } }, { subject: 'rfi', action: () => {} }];
    await assert.rejects(imapMon(srv, store2, broken, { maxRuleAttempts: 2 }).poll(), /attempt 1 of 2/);
    assert.equal(store2.getCheckpoint('imap:mail').lastUid, 0);
    const r2 = await imapMon(srv, store2, broken, { maxRuleAttempts: 2 }).poll();
    assert.equal(r2.gaveUp, 1); assert.equal(r2.matched, 1);
    assert.equal(store2.getCheckpoint('imap:mail').lastUid, 2, 'gave up on UID 1, mailbox not blocked');
    assert.ok(store2.recentLogs({ type: 'imap' }).some((l) => l.status === 'failed' && l.details.gaveUp === true));
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

test('buildMonitors creates monitors with supplied credentials', () => {
  const store = openStore(':memory:');
  const ms = buildMonitors({ folders: [{ name: 'f', path: tmp() }], ftp: [{ name: 'x', host: 'h', user: 'u', password: 's3', localDir: tmp() }], imap: [{ name: 'm', host: 'h', user: 'u', password: 's3' }] }, store);
  assert.deepEqual(ms.map((m) => m.id), ['folder:f', 'ftp:x', 'imap:m']);
  assert.equal(ms[1].makeClient().password, 's3');
});
