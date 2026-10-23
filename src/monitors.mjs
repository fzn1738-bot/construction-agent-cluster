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

export class FolderMonitor {
  /**
   * @param {object} o  { name, dir, store, onAdd, intervalMs=1000, settleMs=1000, recursive, maxEntries=20000, budgetMs=2000, baseline, maxActionAttempts=3 }
   * A file triggers onAdd once it is "settled": its mtime is older than settleMs and its size has not changed since the last scan.
   * With intervalMs=1000 and settleMs=1000 a new file is detected within ~3s, well inside the 5s requirement.
   */
  constructor({ name, dir, store, onAdd = 'log', intervalMs = 1000, settleMs = 1000, recursive = false, maxEntries = 20000, budgetMs = 2000, baseline = false, maxActionAttempts = 3, retries = 1 }) {
    Object.assign(this, { name, dir: path.resolve(dir), store, intervalMs, settleMs, recursive, maxEntries, budgetMs, baseline, maxActionAttempts, retries });
    this.id = 'folder:' + name; this.type = 'folder'; this.action = makeAction(onAdd); this.cursor = 0; this.pass = new Set();
  }

  _scan() {
    // Collect all file paths (relative), then process a budgeted window starting at the cursor.
    const files = [];
    const walk = (d, rel) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        if (files.length >= this.maxEntries) return;
        const r = rel ? rel + '/' + e.name : e.name;
        if (e.isDirectory()) { if (this.recursive) walk(path.join(d, e.name), r); } else if (e.isFile() && !e.name.endsWith('.part') && !e.name.startsWith('.')) files.push(r);
      }
    };
    walk(this.dir, '');
    files.sort();
    return { files };
  }

  async poll() {
    const st = this.store.getCheckpoint(this.id, null);
    const first = st === null;
    const known = (st && st.files) || {};
    const now = Date.now();
    let files;
    try { ({ files } = this._scan()); } catch (e) { throw new Error('folder ' + this.dir + ' is not readable: ' + errText(e)); }

    // Budgeted window: with huge folders, scan a slice per poll and rotate; deletions are judged only after a full pass.
    const start = this.cursor >= files.length ? 0 : this.cursor;
    const deadline = Date.now() + this.budgetMs;
    const seen = new Set(); const fresh = []; const events = []; let scanned = 0, i = start;
    for (; scanned < files.length; scanned++, i = (i + 1) % files.length) {
      if (scanned > 0 && scanned % 200 === 0 && Date.now() > deadline) break;
      const rel = files[i]; seen.add(rel);
      let s; try { s = fs.statSync(path.join(this.dir, rel)); } catch { continue; } // vanished mid-scan
      const prev = known[rel];
      const sig = { size: s.size, mtimeMs: s.mtimeMs, ino: s.ino };
      if (!prev) {
        known[rel] = { ...sig, emitted: false, attempts: 0, stable: false }; fresh.push(rel);
        if (first && this.baseline) { known[rel].emitted = true; known[rel].stable = true; }
      } else if (prev.size !== sig.size || prev.mtimeMs !== sig.mtimeMs) {
        // still being written, or modified after delivery
        const wasEmitted = prev.emitted;
        Object.assign(prev, sig, { stable: false });
        if (wasEmitted) events.push({ kind: 'modified', name: rel });
        continue;
      } else prev.ino = sig.ino;
      const k = known[rel];
      if (!k.emitted && now - s.mtimeMs >= this.settleMs && (k.stable || (prev && prev.size === sig.size))) k.stable = true;
      if (!k.emitted && k.stable) events.push({ kind: 'added', name: rel });
    }
    const complete = scanned >= files.length;
    this.cursor = complete ? 0 : i;

    // Deletions / renames only after a complete pass.
    const removed = [];
    if (complete) for (const rel of Object.keys(known)) if (!seen.has(rel)) removed.push(rel);
    const renamed = [];
    for (const rel of removed) {
      const old = known[rel];
      const to = fresh.find((n) => known[n].ino === old.ino && known[n].size === old.size && !renamed.some((r) => r.to === n));
      if (to && old.emitted) { renamed.push({ from: rel, to }); known[to].emitted = true; }
      delete known[rel];
    }

    const result = { added: 0, modified: 0, removed: removed.length - renamed.length, renamed: renamed.length, failed: 0, scanned: files.length, complete };
    for (const r of renamed) this.store.log('folder', 'ok', { monitor: this.name, event: 'renamed', from: r.from, to: r.to });
    for (const e of events) {
      if (e.kind === 'modified') { result.modified++; this.store.log('folder', 'ok', { monitor: this.name, event: 'modified', path: e.name }); continue; }
      const k = known[e.name];
      if (k.emitted) continue;
      const abs = path.join(this.dir, e.name);
      try {
        const out = await this.action({ kind: 'added', monitor: this.name, name: e.name, path: abs, size: k.size });
        k.emitted = true; result.added++;
        this.store.log('folder', 'ok', { monitor: this.name, event: 'added', path: abs, size: k.size, action: out ?? undefined });
      } catch (err) {
        k.attempts = (k.attempts || 0) + 1; result.failed++;
        if (k.attempts >= this.maxActionAttempts) k.emitted = true; // give up; do not loop forever
        this.store.log('folder', 'failed', { monitor: this.name, event: 'added', path: abs, error: errText(err), attempts: k.attempts, gaveUp: k.emitted });
      }
    }
    for (const rel of removed) if (!renamed.some((r) => r.from === rel)) this.store.log('folder', 'ok', { monitor: this.name, event: 'removed', path: path.join(this.dir, rel) });
    this.store.setCheckpoint(this.id, { files: known, updatedAt: new Date().toISOString() });
    return result;
  }
}

const mtimeOf = (modify) => modify || null;

export class FtpMonitor {
  /**
   * Syncs remoteDir <-> localDir. direction: 'download' | 'upload' | 'both'. Never overwrites a local file we did not
   * write (reported as a conflict), downloads to name.part and renames only when the byte count matches, and
   * remembers what it transferred so nothing is retransferred.
   */
  constructor({ name, store, host, port, user, password, secure = false, remoteDir = '.', localDir, direction = 'download', intervalMs = 60000, retries = 2, timeoutMs, tlsOptions, settleMs = 1000, client }) {
    Object.assign(this, { name, store, remoteDir, localDir: path.resolve(localDir), direction, intervalMs, retries, settleMs });
    this.id = 'ftp:' + name; this.type = 'ftp';
    this.makeClient = client || (() => new FtpClient({ host, port, user, password, secure, timeoutMs, tlsOptions }));
  }

  async poll() {
    fs.mkdirSync(this.localDir, { recursive: true });
    const state = this.store.getCheckpoint(this.id, { files: {} });
    const files = state.files;
    const c = this.makeClient();
    const res = { downloaded: 0, uploaded: 0, skipped: 0, failed: 0 };
    const errors = [];
    const fail = (name, op, e) => { res.failed++; errors.push(name + ': ' + errText(e)); this.store.log('ftp', 'failed', { monitor: this.name, op, file: name, error: errText(e) }); };
    try {
      await c.connect();
      const remote = await c.list(this.remoteDir);
      const rmap = new Map(remote.map((f) => [f.name, f]));
      if (this.direction !== 'upload') {
        for (const f of remote) {
          if (!/^[^/\\]+$/.test(f.name) || f.name.startsWith('.') || f.name.endsWith('.part')) continue; // never escape localDir
          const rec = files[f.name]; const local = path.join(this.localDir, f.name);
          const unchanged = rec && rec.size === f.size && (rec.modify == null || rec.modify === mtimeOf(f.modify));
          if (unchanged) continue;
          let st = null; try { st = fs.statSync(local); } catch { /* absent */ }
          if (st && !(rec && rec.local && rec.local.size === st.size && rec.local.mtimeMs === st.mtimeMs)) {
            res.skipped++; this.store.log('ftp', 'skipped', { monitor: this.name, op: 'download', file: f.name, reason: 'local file exists and was not written by this sync' }); continue;
          }
          const tmp = local + '.part';
          try {
            const t0 = Date.now();
            await c.download(this.remoteDir.replace(/\/$/, '') + '/' + f.name, tmp, f.size);
            fs.renameSync(tmp, local);
            const ls = fs.statSync(local);
            files[f.name] = { size: f.size, modify: mtimeOf(f.modify), local: { size: ls.size, mtimeMs: ls.mtimeMs } };
            res.downloaded++; this.store.log('ftp', 'ok', { monitor: this.name, op: 'download', file: f.name, bytes: f.size, ms: Date.now() - t0 });
          } catch (e) { fs.rmSync(tmp, { force: true }); fail(f.name, 'download', e); }
        }
      }
      if (this.direction !== 'download') {
        for (const e of fs.readdirSync(this.localDir, { withFileTypes: true })) {
          if (!e.isFile() || e.name.startsWith('.') || e.name.endsWith('.part')) continue;
          const local = path.join(this.localDir, e.name); const st = fs.statSync(local);
          const rec = files[e.name];
          if (rec && rec.local && rec.local.size === st.size && rec.local.mtimeMs === st.mtimeMs) continue; // already in sync (downloaded or uploaded)
          if (Date.now() - st.mtimeMs < this.settleMs) continue; // probably still being written
          if (rmap.has(e.name) && !(rec && rec.local)) { res.skipped++; this.store.log('ftp', 'skipped', { monitor: this.name, op: 'upload', file: e.name, reason: 'remote file exists and was not written by this sync' }); continue; }
          const base = this.remoteDir.replace(/\/$/, '') + '/' + e.name;
          try {
            const t0 = Date.now();
            await c.upload(local, base + '.part');
            await c.rename(base + '.part', base);
            files[e.name] = { size: st.size, modify: null, local: { size: st.size, mtimeMs: st.mtimeMs } };
            res.uploaded++; this.store.log('ftp', 'ok', { monitor: this.name, op: 'upload', file: e.name, bytes: st.size, ms: Date.now() - t0 });
          } catch (err) { fail(e.name, 'upload', err); }
        }
      }
    } catch (e) {
      this.store.log('ftp', 'failed', { monitor: this.name, op: 'connect', error: errText(e) });
      throw e;
    } finally {
      this.store.setCheckpoint(this.id, { files, updatedAt: new Date().toISOString() });
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
   * Tracks (UIDVALIDITY, last UID) per mailbox in SQLite. rules: [{ name, from, subject, action }]; the first
   * matching rule's action runs. A rule failure is logged and the message is still marked processed (no endless retries).
   */
  constructor({ name, store, host, port, user, password, secure = true, mailbox = 'INBOX', rules = [], intervalMs = 60000, retries = 2, maxPerPoll = 200, timeoutMs, tlsOptions, client }) {
    Object.assign(this, { name, store, mailbox, intervalMs, retries, maxPerPoll });
    this.id = 'imap:' + name; this.type = 'imap';
    this.rules = rules.map((r) => ({ name: r.name || 'rule', from: r.from, subject: r.subject, action: makeAction(r.action) }));
    this.makeClient = client || (() => new ImapClient({ host, port, user, password, secure, mailbox, timeoutMs, tlsOptions }));
  }

  async poll() {
    const c = this.makeClient();
    const cp = this.store.getCheckpoint(this.id, { uidValidity: null, lastUid: 0 });
    const res = { processed: 0, matched: 0, ignored: 0, malformed: 0, ruleFailures: 0 };
    try {
      await c.connect();
      const box = await c.select(this.mailbox);
      if (cp.uidValidity !== null && cp.uidValidity !== box.uidValidity) {
        this.store.log('imap', 'reset', { monitor: this.name, reason: 'UIDVALIDITY changed', from: cp.uidValidity, to: box.uidValidity });
        cp.lastUid = 0;
      }
      cp.uidValidity = box.uidValidity;
      const uids = (await c.uidsFrom(cp.lastUid + 1)).slice(0, this.maxPerPoll);
      for (const uid of uids) {
        const raw = await c.fetchHeader(uid);
        const msg = parseHeader(raw);
        const entry = { monitor: this.name, uid, from: msg.from, subject: msg.subject };
        if (raw == null || !msg.valid) { res.malformed++; this.store.log('imap', 'malformed', entry); }
        else {
          const rule = this.rules.find((r) => matches(r.from, msg.from) && matches(r.subject, msg.subject));
          if (!rule) { res.ignored++; this.store.log('imap', 'ignored', entry); }
          else {
            try { const out = await rule.action({ kind: 'email', uid, ...msg, rule: rule.name, monitor: this.name, name: msg.subject, path: '' }); res.matched++; this.store.log('imap', 'ok', { ...entry, rule: rule.name, action: out ?? undefined }); }
            catch (e) { res.ruleFailures++; this.store.log('imap', 'failed', { ...entry, rule: rule.name, error: errText(e) }); }
          }
        }
        res.processed++;
        cp.lastUid = uid;
        this.store.setCheckpoint(this.id, { ...cp, updatedAt: new Date().toISOString() }); // per message: a crash never reprocesses acknowledged mail
      }
      this.store.setCheckpoint(this.id, { ...cp, updatedAt: new Date().toISOString() });
    } catch (e) {
      this.store.log('imap', 'failed', { monitor: this.name, op: 'poll', error: errText(e) });
      throw e;
    } finally { await c.logout(); }
    return res;
  }
}

/** Build monitors from a config object (see agent.config.example.json). Passwords come from env vars via passwordEnv. */
export function buildMonitors(config, store) {
  const pw = (o) => (o.passwordEnv ? process.env[o.passwordEnv] || '' : o.password || '');
  return [
    ...(config.folders || []).map((f) => new FolderMonitor({ ...f, dir: f.path, onAdd: f.action, store })),
    ...(config.ftp || []).map((f) => new FtpMonitor({ ...f, password: pw(f), store })),
    ...(config.imap || []).map((m) => new ImapMonitor({ ...m, password: pw(m), store }))
  ];
}
