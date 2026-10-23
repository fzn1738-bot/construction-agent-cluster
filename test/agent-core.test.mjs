import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../src/agent-core.mjs';
import { openStore, SCHEMA_VERSION } from '../src/sqlite-utils.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'agent-'));
const until = async (fn, ms = 3000) => { const t = Date.now(); while (!(await fn())) { if (Date.now() - t > ms) throw new Error('timeout waiting'); await new Promise((r) => setTimeout(r, 10)); } };

test('F1: loop runs tasks repeatedly until stopped, logging status', async () => {
  const store = openStore(':memory:');
  const agent = new Agent({ store, tickMs: 10 });
  let n = 0;
  agent.addTask({ id: 'count', intervalMs: 20, run: () => ++n });
  const logs = []; agent.on('log', (l) => logs.push(l.message));
  await agent.start();
  await until(() => n >= 3);
  await agent.stop();
  const after = n;
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(n, after, 'no runs after stop');
  assert.equal(store.getTask('count').status, 'ok');
  assert.ok(store.countLogs('task', 'ok') >= 3);
  assert.ok(logs.some((m) => /task count ok/.test(m)));
});

test('F1: failing task retries with backoff then succeeds', async () => {
  const store = openStore(':memory:');
  const agent = new Agent({ store });
  let calls = 0;
  agent.addTask({ id: 'flaky', retries: 3, backoffMs: 5, run: () => { if (++calls < 3) throw new Error('boom ' + calls); return 'fine'; } });
  const r = await agent.runTask('flaky');
  assert.equal(r.status, 'ok'); assert.equal(r.attempts, 3);
  assert.equal(store.countLogs('task', 'failed'), 2);
});

test('F1: retries are limited and final failure is persisted', async () => {
  const store = openStore(':memory:');
  const agent = new Agent({ store });
  agent.addTask({ id: 'bad', retries: 1, backoffMs: 1, run: () => { throw new Error('always'); } });
  const r = await agent.runTask('bad');
  assert.equal(r.status, 'failed'); assert.equal(r.attempts, 2);
  const t = store.getTask('bad');
  assert.equal(t.status, 'failed'); assert.equal(t.details.error, 'always');
});

test('F1: task timeout counts as a failure and aborts the attempt signal, then retries', async () => {
  const agent = new Agent();
  let calls = 0; const aborted = [];
  agent.addTask({ id: 'slow', timeoutMs: 20, retries: 1, backoffMs: 1, run: ({ signal }) => new Promise((_, rej) => {
    calls++; signal.addEventListener('abort', () => { aborted.push(signal.reason.message); rej(signal.reason); });
  }) });
  const r = await agent.runTask('slow');
  assert.equal(r.status, 'failed'); assert.match(r.error, /timed out after 20ms/);
  assert.equal(calls, 2); assert.equal(r.attempts, 2);
  assert.deepEqual(aborted, ['timed out after 20ms', 'timed out after 20ms']);
});

test('F1: a timed-out attempt that ignores abort finishes before its retry starts (no overlap)', async () => {
  const store = openStore(':memory:');
  const agent = new Agent({ store });
  let running = 0, maxRunning = 0; const spans = [];
  agent.addTask({ id: 'stubborn', timeoutMs: 50, timeoutGraceMs: 2000, retries: 1, backoffMs: 1, run: async ({ attempt }) => {
    running++; maxRunning = Math.max(maxRunning, running); const s0 = Date.now();
    await new Promise((r) => setTimeout(r, attempt === 1 ? 200 : 5)); // attempt 1 overruns and ignores the signal
    running--; spans.push([s0, Date.now()]);
    return 'done';
  } });
  const r = await agent.runTask('stubborn');
  assert.equal(r.status, 'ok'); assert.equal(r.attempts, 2);
  assert.equal(maxRunning, 1, 'attempts never overlapped');
  assert.ok(spans[1][0] >= spans[0][1], 'retry started after the timed-out attempt ended');
});

test('F1: an attempt that never ends after timeout locks the task instead of overlapping it', async () => {
  const store = openStore(':memory:');
  const agent = new Agent({ store, tickMs: 10, graceMs: 100 });
  let calls = 0; let release;
  agent.addTask({ id: 'hang', intervalMs: 10, timeoutMs: 20, timeoutGraceMs: 30, retries: 3, backoffMs: 1, run: () => { calls++; return new Promise((r) => { release = r; }); } });
  const r = await agent.runTask('hang');
  assert.equal(r.status, 'failed'); assert.equal(r.attempts, 1, 'no retry while the attempt is still running');
  assert.match(r.error, /still running/);
  assert.equal(agent.snapshot().tasks[0].lingering, true);
  const again = await agent.runTask('hang');
  assert.equal(again.skipped, true); assert.equal(calls, 1);
  await agent.start(); await new Promise((res) => setTimeout(res, 80));
  assert.equal(calls, 1, 'the loop does not start the task while it is locked');
  release(); await new Promise((res) => setTimeout(res, 60));
  await agent.stop();
  assert.ok(calls >= 2, 'runs again once the old attempt has finished');
});

test('F1: stop() waits for a task drain hook (e.g. running folder actions)', async () => {
  const agent = new Agent({ tickMs: 10 });
  let drained = false;
  agent.addTask({ id: 'd', intervalMs: 100000, run: () => 1, drain: async () => { await new Promise((r) => setTimeout(r, 50)); drained = true; } });
  await agent.start(); await agent.stop();
  assert.equal(drained, true);
});

test('F1: stop waits for in-flight task and aborts retry backoff', async () => {
  const agent = new Agent({ tickMs: 10 });
  let finished = false;
  agent.addTask({ id: 'work', intervalMs: 10000, run: async () => { await new Promise((r) => setTimeout(r, 100)); finished = true; } });
  agent.addTask({ id: 'retrying', intervalMs: 10000, retries: 5, backoffMs: 60000, run: () => { throw new Error('x'); } });
  await agent.start();
  await until(() => agent.inflight.has('work'));
  const t0 = Date.now();
  await agent.stop();
  assert.ok(finished, 'in-flight task completed before stop resolved');
  assert.ok(Date.now() - t0 < 5000, 'backoff sleep was aborted');
  assert.equal(agent.snapshot().running, false);
});

test('F1: runAll triggers every task and does not double-run in-flight tasks', async () => {
  const agent = new Agent();
  let n = 0;
  agent.addTask({ id: 'a', run: async () => { n++; await new Promise((r) => setTimeout(r, 30)); } });
  agent.addTask({ id: 'b', run: () => { n++; } });
  const [first] = await Promise.all([agent.runAll(), agent.runAll()]);
  assert.equal(first.length, 2); assert.equal(n, 2);
});

test('F5: state persists across restart and interrupted tasks are recovered', async () => {
  const dir = tmp(); const file = path.join(dir, 's.db');
  let store = openStore(file);
  store.setTask('job', 'running', { attempt: 1 }); // simulate crash mid-run
  store.setTask('other', 'ok', { n: 1 });
  store.setCheckpoint('cp', { lastUid: 7 });
  store.close();
  store = openStore(file);
  assert.deepEqual(store.getCheckpoint('cp'), { lastUid: 7 });
  const agent = new Agent({ store, tickMs: 10 });
  agent.addTask({ id: 'job', intervalMs: 10000, run: () => 1 });
  const warnings = []; agent.on('log', (l) => l.level === 'warn' && warnings.push(l.message));
  await agent.start();
  assert.equal(store.getTask('job').status, 'interrupted');
  assert.equal(store.getTask('other').status, 'ok');
  assert.ok(warnings.some((w) => /interrupted/.test(w)));
  await agent.stop();
  store.close();
});

test('F5: schedule resumes from persisted last run', async () => {
  const store = openStore(':memory:');
  store.setTask('t', 'ok', {});
  const agent = new Agent({ store, tickMs: 10 });
  let n = 0;
  agent.addTask({ id: 't', intervalMs: 300, run: () => n++ });
  await agent.start();
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(n, 0, 'not run immediately after a recent run');
  await agent.stop();
});

test('F5: transactions roll back, concurrent connections do not lose updates', () => {
  const dir = tmp(); const file = path.join(dir, 's.db');
  const a = openStore(file), b = openStore(file);
  assert.throws(() => a.transaction(() => { a.setTask('x', 'ok'); throw new Error('abort'); }), /abort/);
  assert.equal(a.getTask('x'), undefined);
  for (let i = 0; i < 50; i++) { const w = i % 2 ? a : b; w.transaction(() => w.setCheckpoint('n', (w.getCheckpoint('n') || 0) + 1)); }
  assert.equal(b.getCheckpoint('n'), 50);
  a.close(); b.close();
});

test('F5: integrity check, schema version and corrupt-file recovery', () => {
  const dir = tmp(); const file = path.join(dir, 's.db');
  let s = openStore(file);
  assert.equal(s.version(), SCHEMA_VERSION);
  assert.deepEqual(s.integrity(), { ok: true, problems: [] });
  s.close();
  fs.writeFileSync(file, 'this is definitely not a sqlite database'.repeat(50));
  fs.rmSync(file + '-wal', { force: true }); fs.rmSync(file + '-shm', { force: true });
  s = openStore(file);
  assert.ok(s.recovered && fs.existsSync(s.recovered.movedTo), 'corrupt file kept aside');
  assert.equal(s.integrity().ok, true);
  assert.equal(s.recentLogs({ type: 'system' })[0].status, 'recovered');
  s.close();
});

test('F5: only confirmed corruption resets the database; other open errors keep the data', async () => {
  const { isCorruption } = await import('../src/sqlite-utils.mjs');
  assert.equal(isCorruption({ errcode: 11 }), true, 'SQLITE_CORRUPT');
  assert.equal(isCorruption({ errcode: 26 }), true, 'SQLITE_NOTADB');
  assert.equal(isCorruption({ errcode: 267 }), true, 'SQLITE_CORRUPT_VTAB (extended)');
  for (const code of [5, 6, 8, 13, 14]) assert.equal(isCorruption({ errcode: code }), false, 'code ' + code);
  assert.equal(isCorruption(new Error('random')), false);

  // A failing migration is rethrown, and the file and its data are left alone.
  const { DatabaseSync } = await import('node:sqlite');
  const dir = tmp(); const file = path.join(dir, 's.db');
  const raw = new DatabaseSync(file);
  raw.exec("CREATE TABLE task_state (id TEXT PRIMARY KEY, status TEXT NOT NULL, timestamp TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}'); CREATE TABLE sync_log (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}'); CREATE TABLE checkpoints (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL); CREATE INDEX sync_log_time ON task_state (id); INSERT INTO task_state VALUES ('keep','ok','2026-01-01T00:00:00Z','{}'); PRAGMA user_version = 1;");
  raw.close();
  assert.throws(() => openStore(file), /already exists/);
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('corrupt')), [], 'nothing moved aside');
  const check = new DatabaseSync(file);
  assert.equal(check.prepare('SELECT status FROM task_state WHERE id = ?').get('keep').status, 'ok');
  assert.equal(Number(check.prepare('PRAGMA user_version').get().user_version), 1, 'failed migration rolled back');
  check.close();

  // Permission denied is not corruption either.
  if (process.getuid && process.getuid() !== 0) {
    const pfile = path.join(dir, 'p.db'); openStore(pfile).close();
    fs.chmodSync(pfile, 0o000);
    try { assert.throws(() => openStore(pfile)); assert.ok(fs.existsSync(pfile)); assert.deepEqual(fs.readdirSync(dir).filter((f) => f.includes('corrupt')), []); }
    finally { fs.chmodSync(pfile, 0o600); }
  }
});

test('F5: migrates an older schema in place', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const dir = tmp(); const file = path.join(dir, 's.db');
  const raw = new DatabaseSync(file);
  raw.exec("CREATE TABLE task_state (id TEXT PRIMARY KEY, status TEXT NOT NULL, timestamp TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}'); CREATE TABLE sync_log (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}'); CREATE TABLE checkpoints (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL); INSERT INTO task_state VALUES ('old','ok','2026-01-01T00:00:00Z','{}'); PRAGMA user_version = 1;");
  raw.close();
  const s = openStore(file);
  assert.equal(s.version(), SCHEMA_VERSION);
  assert.equal(s.getTask('old').status, 'ok');
  s.close();
});
