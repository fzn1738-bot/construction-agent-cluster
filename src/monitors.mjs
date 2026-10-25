// Monitors polled by the agent: local folder, FTP sync and IMAP mailbox. Checkpoints live in SQLite.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { FtpClient } from './ftp-client.mjs';
import { ImapClient, parseHeader } from './email-client.mjs';

const errText = (e) => String((e && e.message) || e);

/** Turn a config action ('log' | { exec: [cmd, ...args] } | function) into an async function(event). */
export function makeAction(spec) {
  if (typeof spec === 'function') return spec;
  if (spec && Array.isArray(spec.exec) && spec.exec.length) {
    const [cmd, ...args] = spec.exec;
    return (ev) => new Promise((resolve, reject) => {
      execFile(cmd, args, { timeout: spec.timeoutMs || 60000, env: { ...process.env, EVENT_PATH: String(ev.path || ''), EVENT_NAME: String(ev.name || '') } }, (err, stdout) => (err ? reject(err) : resolve(String(stdout).slice(0, 500))));
    });
  }
  return async () => null; // 'log' (default): the monitor's own log entry is the action
}

const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

export class FolderMonitor {
  /**
   * @param {object} o  { name, dir, store, onAdd, intervalMs=1000, settleMs=1000, recursive, budgetMs=2000, baseline,
   *                      maxActionAttempts=3, concurrency=4, actionWaitMs=500 }
   * A file triggers onAdd once it is "settled": its mtime is older than settleMs and its size has not changed since the last scan.
   * Every poll lists the whole folder (no entry cap) and always stats new and not-yet-delivered files first, so a new
   * file is seen on the next poll however large the folder is; already-delivered files are re-checked for
   * modifications in a rotating window bounded by budgetMs (the budget includes directory enumeration).
   * Actions run on a small worker pool, decoupled from scanning: a poll waits at most actionWaitMs for them, so a slow
   * action never delays detection of later additions. With intervalMs=1000 and settleMs=1000 a new file is detected
   * and its action started within ~3s, well inside the 5s requirement. Delivery is at-least-once across crashes.
   * A failed action fails the poll (so the agent's retries apply and the task shows as failed) until it succeeds; after
   * maxActionAttempts it is given up and keeps failing every poll until the file is modified (retried) or removed.
   */
  constructor({ name, dir, store, onAdd = 'log', intervalMs = 1000, settleMs = 1000, recursive = false, budgetMs = 2000, baseline = false, maxActionAttempts = 3, retries = 1, concurrency = 4, actionWaitMs = 500 }) {
    Object.assign(this, { name, dir: path.resolve(dir), store, intervalMs, settleMs, recursive, budgetMs, baseline, maxActionAttempts, retries, concurrency: Math.max(1, concurrency), actionWaitMs });
    this.id = 'folder:' + name; this.type = 'folder'; this.action = makeAction(onAdd);
    this.known = null; this.first = false; this.cursor = 0;
    this.queue = []; this.queued = new Set(); this.active = new Map(); this.paused = false; this.saveTimer = null; this.idleWaiters = [];
  }

  /** Files waiting for, or running, their action. */
  get queueDepth() { return this.queue.length + this.active.size; }

  _list() {
    const files = [];
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) { if (this.recursive) walk(path.join(d, e.name), r); } else if (e.isFile() && !e.name.endsWith('.part') && !e.name.startsWith('.')) files.push(r);
      }
    };
    walk(this.dir, '');
    return files.sort();
  }

  _load() {
    if (this.known) return;
    const st = this.store.getCheckpoint(this.id, null);
    this.first = st === null; this.known = (st && st.files) || {};
  }
  _save() { clearTimeout(this.saveTimer); this.saveTimer = null; this.store.setCheckpoint(this.id, { files: this.known, updatedAt: new Date().toISOString() }); }
  _saveSoon() { if (!this.saveTimer) { this.saveTimer = setTimeout(() => this._save(), 200); if (this.saveTimer.unref) this.saveTimer.unref(); } }

  /** Stat one file and update its record. Returns 'new' | 'modified' | 'stable' | 'pending' | null (vanished). */
  _check(rel, now) {
    let s; try { s = fs.statSync(path.join(this.dir, rel)); } catch { return null; } // vanished mid-scan
    const known = this.known; const prev = known[rel];
    const sig = { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino };
    if (!prev) {
      known[rel] = { ...sig, emitted: false, attempts: 0, stable: false };
      if (this.first && this.baseline) Object.assign(known[rel], { emitted: true, stable: true });
      return 'new';
    }
    if (prev.size !== sig.size || prev.mtimeMs !== sig.mtimeMs) { // still being written, or modified after delivery
      const wasEmitted = prev.emitted && !prev.gaveUp;
      Object.assign(prev, sig, { stable: false });
      if (prev.gaveUp) Object.assign(prev, { emitted: false, gaveUp: false, attempts: 0, error: undefined }); // new content: try again
      return wasEmitted ? 'modified' : 'pending';
    }
    prev.ino = sig.ino;
    // Date.now() is whole milliseconds while mtimeMs is fractional: floor it so a file from "this" millisecond can settle.
    if (!prev.emitted && now - Math.floor(s.mtimeMs) >= this.settleMs) prev.stable = true;
    return prev.stable ? 'stable' : 'pending';
  }

  async poll() {
    const t0 = Date.now(); const deadline = t0 + this.budgetMs;
    this._load();
    let names;
    try { names = this._list(); } catch (e) { throw new Error('folder ' + this.dir + ' is not readable: ' + errText(e)); }
    const known = this.known; const now = Date.now();
    const present = new Set(names);
    const result = { added: 0, modified: 0, removed: 0, renamed: 0, failed: 0, detected: 0, scanned: names.length, checked: 0, complete: true };

    // 1. New and not-yet-delivered files: always checked, whatever the folder size (this is the detection guarantee).
    const fresh = [];
    for (const rel of names) {
      if (known[rel] && known[rel].emitted) continue;
      const r = this._check(rel, now); result.checked++;
      if (r === 'new') fresh.push(rel);
    }
    // 2. Delivered files: rotating window, bounded by the time budget, to spot modifications.
    const freshSet = new Set(fresh);
    const done = names.filter((f) => known[f] && known[f].emitted && !freshSet.has(f));
    let i = this.cursor >= done.length ? 0 : this.cursor, n = 0;
    for (; n < done.length; n++, i = (i + 1) % done.length) {
      if (n > 0 && n % 200 === 0 && Date.now() > deadline) break;
      if (this._check(done[i], now) === 'modified') { result.modified++; this.store.log('folder', 'ok', { monitor: this.name, event: 'modified', path: path.join(this.dir, done[i]) }); }
      result.checked++;
    }
    result.complete = n >= done.length;
    this.cursor = result.complete ? 0 : i;

    // 3. Deletions and renames come from the full listing, so they are exact on every poll.
    for (const rel of Object.keys(known)) {
      if (present.has(rel)) continue;
      const old = known[rel];
      const to = fresh.find((f) => known[f].ino === old.ino && known[f].size === old.size);
      if (to && old.emitted) {
        Object.assign(known[to], { emitted: true, stable: true }, old.gaveUp ? { gaveUp: true, error: old.error, attempts: old.attempts } : {}); fresh.splice(fresh.indexOf(to), 1); result.renamed++;
        this.store.log('folder', 'ok', { monitor: this.name, event: 'renamed', from: rel, to });
      } else {
        result.removed++;
        this.store.log('folder', 'ok', { monitor: this.name, event: 'removed', path: path.join(this.dir, rel) });
      }
      delete known[rel]; this.queued.delete(rel);
    }

    // 4. Queue settled, undelivered files and start actions on the worker pool.
    for (const rel of names) {
      const k = known[rel];
      if (!k || k.emitted || !k.stable || this.queued.has(rel) || this.active.has(rel)) continue;
      this.queue.push(rel); this.queued.add(rel); result.detected++;
      this.store.log('folder', 'ok', { monitor: this.name, event: 'detected', path: path.join(this.dir, rel), size: k.size, detectedInMs: Math.max(0, now - Math.round(k.mtimeMs)) });
    }
    this.first = false;
    this._pump(result);
    if (this.queueDepth) {
      let waiter;
      const idle = new Promise((resolve) => { waiter = resolve; this.idleWaiters.push(resolve); });
      await Promise.race([idle, sleep(Math.max(0, this.actionWaitMs - (Date.now() - t0)))]);
      this.idleWaiters = this.idleWaiters.filter((w) => w !== waiter);
    }
    this._save();
    result.queued = this.queueDepth;
    // Undelivered files (failed actions, including ones already finished after an earlier poll) fail the poll.
    const failing = Object.entries(known).filter(([, k]) => k.error);
    if (failing.length) {
      const err = new Error(failing.length + ' file action(s) failed: ' + failing.map(([f, k]) => f + (k.gaveUp ? ' (gave up)' : '') + ': ' + k.error).join('; ').slice(0, 300));
      err.result = result;
      throw err;
    }
    return result;
  }

  _pump(result) {
    while (!this.paused && this.active.size < this.concurrency && this.queue.length) {
      const rel = this.queue.shift(); this.queued.delete(rel);
      const k = this.known[rel];
      if (!k || k.emitted) continue;
      const p = this._deliver(rel, k, result).finally(() => {
        this.active.delete(rel); this._saveSoon(); this._pump(result);
        if (!this.queueDepth) for (const w of this.idleWaiters.splice(0)) w();
      });
      this.active.set(rel, p);
    }
  }

  async _deliver(rel, k, result) {
    const abs = path.join(this.dir, rel);
    try {
      const out = await this.action({ kind: 'added', monitor: this.name, name: rel, path: abs, size: k.size });
      Object.assign(k, { emitted: true, error: undefined }); result.added++;
      this.store.log('folder', 'ok', { monitor: this.name, event: 'added', path: abs, size: k.size, action: out ?? undefined });
    } catch (err) {
      k.attempts = (k.attempts || 0) + 1; k.error = errText(err); result.failed++;
      if (k.attempts >= this.maxActionAttempts) Object.assign(k, { emitted: true, gaveUp: true }); // stop re-running it, keep reporting it
      this.store.log('folder', 'failed', { monitor: this.name, event: 'added', path: abs, error: k.error, attempts: k.attempts, gaveUp: Boolean(k.gaveUp) });
    }
  }

  /** Wait for running actions (used by Agent.stop); queued ones resume on the next poll. */
  async drain() {
    this.paused = true;
    try { await Promise.allSettled([...this.active.values()]); } finally { this.paused = false; if (this.known) this._save(); }
  }
}

const mtimeOf = (modify) => modify || null;
const sameLocal = (rec, st) => Boolean(rec && rec.local && st && rec.local.size === st.size && rec.local.mtimeMs === st.mtimeMs);
const sameRemote = (rec, f) => Boolean(rec && f && rec.size === f.size && rec.modify === mtimeOf(f.modify));
/** An upload whose server modify time was never read back (the listing after RNTO failed): adopt it from this listing. */
const confirmUpload = (rec, f) => {
  if (!rec || !rec.unconfirmed || !f) return false;
  delete rec.unconfirmed;
  if (rec.size !== f.size) return false; // changed on the server since: let the normal rules decide
  rec.modify = mtimeOf(f.modify); return true;
};

export class FtpMonitor {
  /**
   * Syncs remoteDir <-> localDir on the agent's schedule. direction: 'download' | 'upload' | 'both'.
   * secure: false | 'explicit' (AUTH TLS) | 'implicit'; certificates are verified unless tlsOptions says otherwise.
   * Each file's last synced state is kept in SQLite: remote size + MLSD modify time and local size + mtime.
   *  - Downloads go to name.part and are renamed only when the byte count matches; uploads go to name.part then RNTO.
   *  - A file is skipped only when BOTH sides still match that record, so a remote change (even with the same size),
   *    a deleted local copy (download) or a deleted remote copy (upload) is transferred again.
   *  - A copy this sync did not write, or that changed on both sides, is never overwritten: it is logged as a conflict.
   * Every poll opens a fresh connection (reconnect after network failures is automatic); a failure fails the poll so
   * the agent's retries and backoff apply. Aborting the poll (agent stop or timeout) closes the connection.
   */
  constructor({ name, store, host, port, user, password, secure = false, remoteDir = '.', localDir, direction = 'download', intervalMs = 60000, retries = 2, timeoutMs, tlsOptions, settleMs = 1000, pollTimeoutMs = 0, client }) {
    Object.assign(this, { name, store, remoteDir, localDir: path.resolve(localDir), direction, intervalMs, retries, settleMs, timeoutMs: pollTimeoutMs });
    this.id = 'ftp:' + name; this.type = 'ftp';
    this.makeClient = client || (() => new FtpClient({ host, port, user, password, secure, timeoutMs, tlsOptions }));
  }

  _remote(name) { return this.remoteDir.replace(/\/$/, '') + '/' + name; }

  async poll(ctx = {}) {
    fs.mkdirSync(this.localDir, { recursive: true });
    const state = this.store.getCheckpoint(this.id, { files: {} });
    const files = state.files;
    const c = this.makeClient();
    const onAbort = () => { c.close().catch(() => {}); };
    if (ctx.signal) { if (ctx.signal.aborted) throw new Error('aborted'); ctx.signal.addEventListener('abort', onAbort, { once: true }); }
    const res = { downloaded: 0, uploaded: 0, skipped: 0, failed: 0 };
    const errors = [];
    const fail = (name, op, e) => { res.failed++; errors.push(name + ': ' + errText(e)); this.store.log('ftp', 'failed', { monitor: this.name, op, file: name, error: errText(e) }); };
    const skip = (name, op, reason) => { res.skipped++; this.store.log('ftp', 'skipped', { monitor: this.name, op, file: name, reason }); };
    const save = () => this.store.setCheckpoint(this.id, { files, updatedAt: new Date().toISOString() });
    const lstat = (p) => { try { return fs.statSync(p); } catch { return null; } };
    try {
      await c.connect();
      const remote = (await c.list(this.remoteDir)).filter((f) => /^[^/\\]+$/.test(f.name) && !f.name.startsWith('.') && !f.name.endsWith('.part')); // never escape localDir
      const rmap = new Map(remote.map((f) => [f.name, f]));
      if (remote.reduce((n, f) => n + confirmUpload(files[f.name], f), 0)) save();
      if (this.direction !== 'upload') {
        for (const f of remote) {
          const rec = files[f.name]; const local = path.join(this.localDir, f.name);
          const st = lstat(local);
          const remoteSame = sameRemote(rec, f), localSame = sameLocal(rec, st);
          if (remoteSame && localSame) continue; // in sync
          if (remoteSame && st) { // only the local copy changed
            if (this.direction === 'download') skip(f.name, 'download', 'local copy changed since last sync; not overwriting');
            continue; // 'both': the upload pass sends it
          }
          if (st && !localSame) { skip(f.name, 'download', rec ? 'changed on both sides since last sync (conflict)' : 'local file exists and was not written by this sync'); continue; }
          const tmp = local + '.part';
          try {
            const t0 = Date.now();
            await c.download(this._remote(f.name), tmp, f.size);
            fs.renameSync(tmp, local);
            const ls = fs.statSync(local);
            files[f.name] = { size: f.size, modify: mtimeOf(f.modify), local: { size: ls.size, mtimeMs: ls.mtimeMs } };
            save();
            res.downloaded++; this.store.log('ftp', 'ok', { monitor: this.name, op: 'download', file: f.name, bytes: f.size, ms: Date.now() - t0, reason: rec ? (st ? 'remote changed' : 'local copy missing') : 'new' });
          } catch (e) { fs.rmSync(tmp, { force: true }); fail(f.name, 'download', e); if (ctx.signal && ctx.signal.aborted) throw e; }
        }
      }
      if (this.direction !== 'download') {
        const uploaded = [];
        for (const e of fs.readdirSync(this.localDir, { withFileTypes: true })) {
          if (!e.isFile() || e.name.startsWith('.') || e.name.endsWith('.part')) continue;
          const local = path.join(this.localDir, e.name); const st = lstat(local); if (!st) continue;
          const rec = files[e.name]; const r = rmap.get(e.name);
          const localSame = sameLocal(rec, st), remoteSame = sameRemote(rec, r);
          if (localSame && remoteSame) continue; // in sync (downloaded or uploaded)
          if (localSame && r) { // only the remote copy changed
            if (this.direction === 'upload') skip(e.name, 'upload', 'remote copy changed since last sync; not overwriting');
            continue; // 'both': the download pass handled it
          }
          if (!localSame && Date.now() - st.mtimeMs < this.settleMs) continue; // probably still being written
          if (r && !remoteSame) { skip(e.name, 'upload', rec ? 'changed on both sides since last sync (conflict)' : 'remote file exists and was not written by this sync'); continue; }
          try {
            const t0 = Date.now(); const base = this._remote(e.name);
            await c.upload(local, base + '.part');
            await c.rename(base + '.part', base);
            files[e.name] = { size: st.size, modify: null, unconfirmed: true, local: { size: st.size, mtimeMs: st.mtimeMs } };
            save(); uploaded.push(e.name);
            res.uploaded++; this.store.log('ftp', 'ok', { monitor: this.name, op: 'upload', file: e.name, bytes: st.size, ms: Date.now() - t0, reason: rec ? (r ? 'local changed' : 'remote copy missing') : 'new' });
          } catch (err) { fail(e.name, 'upload', err); if (ctx.signal && ctx.signal.aborted) throw err; }
        }
        if (uploaded.length) {
          // Record the server's own size and modify time for what we wrote, so later remote edits are recognised.
          // If this listing fails the records stay `unconfirmed` and the next successful listing adopts them.
          try {
            const after = new Map((await c.list(this.remoteDir)).map((f) => [f.name, f]));
            for (const name of uploaded) confirmUpload(files[name], after.get(name));
          } catch (err) {
            errors.push('listing after upload: ' + errText(err));
            this.store.log('ftp', 'failed', { monitor: this.name, op: 'confirm', files: uploaded, error: errText(err) });
            if (ctx.signal && ctx.signal.aborted) throw err;
          }
        }
      }
    } catch (e) {
      this.store.log('ftp', 'failed', { monitor: this.name, op: ctx.signal && ctx.signal.aborted ? 'aborted' : 'connect', error: errText(e) });
      throw e;
    } finally {
      save();
      if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
      await c.close();
    }
    if (errors.length) throw new Error(errors.length + ' transfer(s) failed: ' + errors.join('; ').slice(0, 300));
    return res;
  }
}

/** Does `value` match a rule pattern (case-insensitive substring, or a RegExp)? */
const matches = (pattern, value) => pattern == null || (pattern instanceof RegExp ? pattern.test(value) : String(value).toLowerCase().includes(String(pattern).toLowerCase()));

export class ImapMonitor {
  /**
   * Tracks (UIDVALIDITY, last UID) per mailbox in SQLite. rules: [{ name, from, subject, action }]; the first matching
   * rule's action runs. Messages are acknowledged (lastUid advanced) one at a time, only after they were handled:
   *  - a malformed message is logged and acknowledged (retrying cannot fix it);
   *  - a failed rule action is NOT acknowledged: the poll stops at that message and fails, so the agent's retries and
   *    later polls run it again. After maxRuleAttempts failures (counted in SQLite, across restarts) it is logged as
   *    given up and acknowledged so one bad message cannot block the mailbox forever.
   * A UIDVALIDITY change means the mailbox was rebuilt, so processing restarts from UID 1.
   */
  constructor({ name, store, host, port, user, password, secure = true, mailbox = 'INBOX', rules = [], intervalMs = 60000, retries = 2, maxPerPoll = 200, maxRuleAttempts = 5, timeoutMs, tlsOptions, pollTimeoutMs = 0, client }) {
    Object.assign(this, { name, store, mailbox, intervalMs, retries, maxPerPoll, maxRuleAttempts, timeoutMs: pollTimeoutMs });
    this.id = 'imap:' + name; this.type = 'imap';
    this.rules = rules.map((r) => ({ name: r.name || 'rule', from: r.from, subject: r.subject, action: makeAction(r.action) }));
    this.makeClient = client || (() => new ImapClient({ host, port, user, password, secure, mailbox, timeoutMs, tlsOptions }));
  }

  async poll(ctx = {}) {
    const c = this.makeClient();
    const onAbort = () => { c.logout().catch(() => {}); };
    if (ctx.signal) { if (ctx.signal.aborted) throw new Error('aborted'); ctx.signal.addEventListener('abort', onAbort, { once: true }); }
    const cp = this.store.getCheckpoint(this.id, { uidValidity: null, lastUid: 0 });
    cp.failures = cp.failures || {}; // uid -> failed rule attempts for the message at the head of the queue
    const save = () => this.store.setCheckpoint(this.id, { ...cp, updatedAt: new Date().toISOString() });
    const res = { processed: 0, matched: 0, ignored: 0, malformed: 0, ruleFailures: 0, gaveUp: 0 };
    let blocked = null;
    try {
      await c.connect();
      const box = await c.select(this.mailbox);
      if (cp.uidValidity !== null && cp.uidValidity !== box.uidValidity) {
        this.store.log('imap', 'reset', { monitor: this.name, reason: 'UIDVALIDITY changed', from: cp.uidValidity, to: box.uidValidity });
        cp.lastUid = 0; cp.failures = {};
      }
      cp.uidValidity = box.uidValidity;
      const all = await c.uidsFrom(cp.lastUid + 1);
      const uids = all.slice(0, this.maxPerPoll);
      res.backlog = all.length - uids.length; // left for the next poll
      for (const uid of uids) {
        const raw = await c.fetchHeader(uid);
        const msg = parseHeader(raw);
        const entry = { monitor: this.name, uid, from: msg.from, subject: msg.subject };
        if (raw == null || !msg.valid) { res.malformed++; this.store.log('imap', 'malformed', entry); }
        else {
          const rule = this.rules.find((r) => matches(r.from, msg.from) && matches(r.subject, msg.subject));
          if (!rule) { res.ignored++; this.store.log('imap', 'ignored', entry); }
          else {
            try {
              const out = await rule.action({ kind: 'email', uid, ...msg, rule: rule.name, monitor: this.name, name: msg.subject, path: '' });
              res.matched++; this.store.log('imap', 'ok', { ...entry, rule: rule.name, action: out ?? undefined });
            } catch (e) {
              res.ruleFailures++;
              const attempts = (cp.failures[uid] || 0) + 1;
              const gaveUp = attempts >= this.maxRuleAttempts;
              this.store.log('imap', 'failed', { ...entry, rule: rule.name, error: errText(e), attempts, gaveUp });
              if (!gaveUp) { cp.failures = { [uid]: attempts }; save(); blocked = { uid, rule: rule.name, error: errText(e), attempts }; break; }
              res.gaveUp++;
            }
          }
        }
        res.processed++;
        cp.lastUid = uid; delete cp.failures[uid];
        save(); // per message: a crash never reprocesses acknowledged mail
      }
      save();
    } catch (e) {
      this.store.log('imap', 'failed', { monitor: this.name, op: ctx.signal && ctx.signal.aborted ? 'aborted' : 'poll', error: errText(e) });
      throw e;
    } finally {
      if (ctx.signal) ctx.signal.removeEventListener('abort', onAbort);
      await c.logout();
    }
    if (blocked) res.backlog = undefined;
    if (blocked) throw new Error('rule ' + blocked.rule + ' failed on UID ' + blocked.uid + ' (attempt ' + blocked.attempts + ' of ' + this.maxRuleAttempts + '): ' + blocked.error);
    return res;
  }
}

/** Build monitors from a config object. The dashboard supplies credentials from saved Settings. */
export function buildMonitors(config, store) {
  return [
    ...(config.folders || []).map((f) => new FolderMonitor({ ...f, dir: f.path, onAdd: f.action, store })),
    ...(config.ftp || []).map((f) => new FtpMonitor({ ...f, password: f.password || '', store })),
    ...(config.imap || []).map((m) => new ImapMonitor({ ...m, password: m.password || '', store }))
  ];
}
