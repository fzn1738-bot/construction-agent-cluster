// SQLite state store (node:sqlite): task state, sync log and monitor checkpoints.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MIGRATIONS = [
  `CREATE TABLE task_state (id TEXT PRIMARY KEY, status TEXT NOT NULL, timestamp TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}');
   CREATE TABLE sync_log (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL, timestamp TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}');
   CREATE TABLE checkpoints (name TEXT PRIMARY KEY, value TEXT NOT NULL, updated TEXT NOT NULL);`,
  `CREATE INDEX sync_log_time ON sync_log (timestamp);
   CREATE INDEX sync_log_type ON sync_log (type, timestamp);`
];
export const SCHEMA_VERSION = MIGRATIONS.length;

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

export class Store {
  constructor(db, file, recovered = null) { this.db = db; this.file = file; this.recovered = recovered; this._depth = 0; this._seq = 0; this.closed = false; }

  /** Run fn inside one transaction; nested calls join the outer one. Rolls back on throw. */
  transaction(fn) {
    if (this._depth > 0) return fn();
    this.db.exec('BEGIN IMMEDIATE');
    this._depth++;
    try { const r = fn(); this.db.exec('COMMIT'); return r; }
    catch (e) { try { this.db.exec('ROLLBACK'); } catch { /* already rolled back */ } throw e; }
    finally { this._depth--; }
  }

  setTask(id, status, details = {}) {
    if (this.closed) return null; // late write from work that outlived a forced shutdown: dropped, never a crash
    const row = { id: String(id), status, timestamp: new Date().toISOString(), details: JSON.stringify(details) };
    this.db.prepare('INSERT INTO task_state (id, status, timestamp, details) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, timestamp = excluded.timestamp, details = excluded.details')
      .run(row.id, row.status, row.timestamp, row.details);
    return { ...row, details };
  }
  getTask(id) { const r = this.db.prepare('SELECT * FROM task_state WHERE id = ?').get(String(id)); return r && { ...r, details: parse(r.details, {}) }; }
  listTasks() { return this.db.prepare('SELECT * FROM task_state ORDER BY id').all().map((r) => ({ ...r, details: parse(r.details, {}) })); }

  /** Tasks left 'running' by a crash cannot still be running: mark them interrupted. */
  recoverInterrupted() {
    return this.transaction(() => {
      const stale = this.listTasks().filter((t) => t.status === 'running');
      for (const t of stale) {
        this.setTask(t.id, 'interrupted', { ...t.details, interruptedAt: new Date().toISOString() });
        this.log('task', 'interrupted', { task: t.id, note: 'agent restarted while task was in flight' });
      }
      return stale.map((t) => t.id);
    });
  }

  log(type, status, details = {}) {
    if (this.closed) return null;
    // Sortable unique id: timestamp + counter + random, so same-millisecond rows stay ordered.
    const ts = new Date().toISOString();
    const id = ts + '-' + String(this._seq++ % 1e6).padStart(6, '0') + '-' + randomUUID().slice(0, 8);
    this.db.prepare('INSERT INTO sync_log (id, type, status, timestamp, details) VALUES (?, ?, ?, ?, ?)').run(id, type, status, ts, JSON.stringify(details));
    return id;
  }
  recentLogs({ type, limit = 50 } = {}) {
    const rows = type
      ? this.db.prepare('SELECT * FROM sync_log WHERE type = ? ORDER BY timestamp DESC, id DESC LIMIT ?').all(type, limit)
      : this.db.prepare('SELECT * FROM sync_log ORDER BY timestamp DESC, id DESC LIMIT ?').all(limit);
    return rows.map((r) => ({ ...r, details: parse(r.details, {}) }));
  }
  countLogs(type, status) {
    const q = status ? 'SELECT COUNT(*) AS n FROM sync_log WHERE type = ? AND status = ?' : 'SELECT COUNT(*) AS n FROM sync_log WHERE type = ?';
    return Number((status ? this.db.prepare(q).get(type, status) : this.db.prepare(q).get(type)).n);
  }

  setCheckpoint(name, value) {
    if (this.closed) return;
    this.db.prepare('INSERT INTO checkpoints (name, value, updated) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated = excluded.updated')
      .run(name, JSON.stringify(value), new Date().toISOString());
  }
  getCheckpoint(name, fallback = null) { const r = this.db.prepare('SELECT value FROM checkpoints WHERE name = ?').get(name); return r ? parse(r.value, fallback) : fallback; }

  integrity() { const rows = this.db.prepare('PRAGMA integrity_check').all(); return rows.length === 1 && Object.values(rows[0])[0] === 'ok' ? { ok: true, problems: [] } : { ok: false, problems: rows.map((r) => Object.values(r)[0]) }; }
  version() { return Number(this.db.prepare('PRAGMA user_version').get().user_version); }
  close() { this.closed = true; try { this.db.close(); } catch { /* already closed */ } }
}

function migrate(db) {
  const current = Number(db.prepare('PRAGMA user_version').get().user_version);
  if (current > SCHEMA_VERSION) throw new Error('database schema v' + current + ' is newer than this agent (v' + SCHEMA_VERSION + ')');
  for (let v = current; v < SCHEMA_VERSION; v++) {
    db.exec('BEGIN IMMEDIATE');
    try { db.exec(MIGRATIONS[v]); db.exec('PRAGMA user_version = ' + (v + 1)); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

// SQLITE_CORRUPT (11) and SQLITE_NOTADB (26), including extended result codes.
const CORRUPT_CODES = new Set([11, 26]);
class CorruptDatabaseError extends Error {}

/** True only for confirmed corruption. Locks, permissions, disk-full and migration errors are not corruption. */
export function isCorruption(e) {
  if (e instanceof CorruptDatabaseError) return true;
  return Boolean(e && typeof e.errcode === 'number' && CORRUPT_CODES.has(e.errcode & 0xff));
}

function openRaw(file) {
  const db = new DatabaseSync(file);
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    const check = db.prepare('PRAGMA integrity_check').all();
    if (!(check.length === 1 && Object.values(check[0])[0] === 'ok')) throw new CorruptDatabaseError('integrity_check failed: ' + check.map((r) => Object.values(r)[0]).join('; '));
    migrate(db);
    return db;
  } catch (e) { try { db.close(); } catch { /* ignore */ } throw e; }
}

/**
 * Open (and migrate) the database. Only a confirmed corrupt file (SQLITE_CORRUPT / SQLITE_NOTADB or a failed
 * integrity_check) is moved aside and replaced by a fresh one; any other error (locked, permission denied,
 * failed migration, newer schema) is rethrown so valid state is never discarded.
 */
export function openStore(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  try { return new Store(openRaw(file), file); }
  catch (e) {
    if (file === ':memory:' || !isCorruption(e)) throw e;
    const aside = file + '.corrupt-' + Date.now();
    for (const ext of ['', '-wal', '-shm']) { try { fs.renameSync(file + ext, aside + ext); } catch { /* missing */ } }
    const store = new Store(openRaw(file), file, { reason: e.message, movedTo: aside });
    store.log('system', 'recovered', store.recovered);
    return store;
  }
}
