// Core agent runtime: continuous loop, retries with backoff, graceful stop, SQLite-backed task state.
import { EventEmitter } from 'node:events';
import { openStore } from './sqlite-utils.mjs';

const sleep = (ms, signal) => new Promise((resolve) => {
  if (signal && signal.aborted) return resolve();
  const t = setTimeout(done, ms);
  function done() { clearTimeout(t); if (signal) signal.removeEventListener('abort', done); resolve(); }
  if (signal) signal.addEventListener('abort', done, { once: true });
});

export class Agent extends EventEmitter {
  /**
   * @param {object} o
   * @param {import('./sqlite-utils.mjs').Store} [o.store]  state store (default: in-memory)
   * @param {number} [o.tickMs]  how often the loop checks for due tasks
   * @param {number} [o.graceMs] how long stop() waits for in-flight tasks
   */
  constructor({ store = openStore(':memory:'), tickMs = 250, graceMs = 10000 } = {}) {
    super();
    this.store = store; this.tickMs = tickMs; this.graceMs = graceMs;
    this.tasks = new Map(); this.inflight = new Map(); this.nextDue = new Map();
    this.running = false; this.timer = null; this.abort = null; this.startedAt = null;
  }

  /** Register a task. run(ctx) gets { signal, attempt, trigger, log }. Failures retry `retries` times with exponential backoff. */
  addTask({ id, run, intervalMs = 5000, retries = 0, backoffMs = 200, maxBackoffMs = 30000, timeoutMs = 0, kind = 'task' }) {
    if (!id || typeof run !== 'function') throw new Error('task needs an id and a run function');
    if (this.tasks.has(id)) throw new Error('duplicate task id: ' + id);
    this.tasks.set(id, { id, run, intervalMs, retries, backoffMs, maxBackoffMs, timeoutMs, kind });
    if (this.running) this.nextDue.set(id, Date.now());
    return this;
  }

  /** Register a monitor from monitors.mjs as a task. */
  addMonitor(monitor, opts = {}) {
    return this.addTask({ id: monitor.id, kind: monitor.type, intervalMs: monitor.intervalMs, retries: monitor.retries ?? 2, ...opts, run: (ctx) => monitor.poll(ctx) });
  }

  log(level, message, details = {}) { this.emit('log', { level, message, details, at: new Date().toISOString() }); }

  async start() {
    if (this.running) return this;
    this.running = true; this.startedAt = new Date().toISOString(); this.abort = new AbortController();
    const interrupted = this.store.recoverInterrupted();
    if (interrupted.length) this.log('warn', 'recovered interrupted tasks: ' + interrupted.join(', '), { interrupted });
    const now = Date.now();
    for (const t of this.tasks.values()) {
      // Resume the schedule from the persisted last run instead of running everything at once.
      const prev = this.store.getTask(t.id);
      const last = prev && prev.status !== 'interrupted' ? Date.parse(prev.timestamp) : NaN;
      this.nextDue.set(t.id, Number.isFinite(last) ? Math.max(now, last + t.intervalMs) : now);
    }
    this.store.log('system', 'started', { tasks: [...this.tasks.keys()] });
    this.log('info', 'agent started', { tasks: this.tasks.size });
    this._schedule(0);
    return this;
  }

  _schedule(ms) { if (this.running) { this.timer = setTimeout(() => this._tick(), ms); } }

  _tick() {
    if (!this.running) return;
    const now = Date.now();
    for (const t of this.tasks.values()) {
      if (this.inflight.has(t.id) || (this.nextDue.get(t.id) ?? 0) > now) continue;
      this.runTask(t.id, 'schedule').catch(() => {});
    }
    this._schedule(this.tickMs);
  }

  /** Graceful stop: no new runs, abort backoff sleeps, wait up to graceMs for in-flight work. */
  async stop() {
    if (!this.running) return;
    this.running = false; clearTimeout(this.timer); this.abort.abort();
    const pending = Promise.allSettled([...this.inflight.values()]);
    let timedOut = false;
    await Promise.race([pending, sleep(this.graceMs).then(() => { timedOut = true; })]);
    this.store.log('system', timedOut ? 'stopped-forced' : 'stopped', { inflight: [...this.inflight.keys()] });
    this.log('info', timedOut ? 'agent stopped (grace period expired)' : 'agent stopped');
  }

  /** Run one task now, with retries. Resolves to { id, status, attempts, error?, result? }. */
  runTask(id, trigger = 'manual') {
    const task = this.tasks.get(id);
    if (!task) return Promise.reject(new Error('unknown task: ' + id));
    if (this.inflight.has(id)) return this.inflight.get(id);
    const p = this._execute(task, trigger).finally(() => this.inflight.delete(id));
    this.inflight.set(id, p);
    return p;
  }

  /** Trigger every task now ("Run Now"). */
  async runAll(trigger = 'manual') {
    return Promise.all([...this.tasks.keys()].map((id) => this.runTask(id, trigger)));
  }

  async _execute(task, trigger) {
    const signal = this.abort ? this.abort.signal : undefined;
    const startedAt = Date.now();
    let attempt = 0, error = null, result;
    while (true) {
      attempt++;
      this.store.setTask(task.id, 'running', { attempt, trigger, startedAt: new Date(startedAt).toISOString() });
      this.log('info', 'task ' + task.id + ' running (attempt ' + attempt + ')');
      const t0 = Date.now();
      try {
        result = await this._withTimeout(task, { signal, attempt, trigger, log: (m, d) => this.log('info', m, d) });
        error = null;
        this.store.log(task.kind, 'ok', { task: task.id, attempt, trigger, ms: Date.now() - t0, result: summarise(result) });
        break;
      } catch (e) {
        error = String((e && e.message) || e);
        this.store.log(task.kind, 'failed', { task: task.id, attempt, trigger, ms: Date.now() - t0, error });
        this.log('error', 'task ' + task.id + ' failed: ' + error, { attempt });
        if (attempt > task.retries || (signal && signal.aborted)) break;
        await sleep(Math.min(task.backoffMs * 2 ** (attempt - 1), task.maxBackoffMs), signal);
        if (signal && signal.aborted) break;
      }
    }
    const status = error ? 'failed' : 'ok';
    const details = { attempts: attempt, trigger, durationMs: Date.now() - startedAt, lastRunAt: new Date().toISOString(), ...(error ? { error } : { result: summarise(result) }) };
    this.store.setTask(task.id, status, details);
    this.nextDue.set(task.id, Date.now() + task.intervalMs);
    this.log(error ? 'error' : 'info', 'task ' + task.id + ' ' + status, details);
    this.emit('task', { id: task.id, status, ...details });
    return { id: task.id, status, attempts: attempt, error: error || undefined, result };
  }

  _withTimeout(task, ctx) {
    const work = Promise.resolve().then(() => task.run(ctx));
    if (!task.timeoutMs) return work;
    let timer;
    const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out after ' + task.timeoutMs + 'ms')), task.timeoutMs); });
    return Promise.race([work, limit]).finally(() => clearTimeout(timer));
  }

  /** Current state loaded from SQLite plus live in-flight info. */
  snapshot() {
    const persisted = new Map(this.store.listTasks().map((t) => [t.id, t]));
    return {
      running: this.running, startedAt: this.startedAt, active: this.inflight.size,
      tasks: [...this.tasks.values()].map((t) => ({ id: t.id, kind: t.kind, intervalMs: t.intervalMs, inflight: this.inflight.has(t.id), state: persisted.get(t.id) || null }))
    };
  }
}

function summarise(r) {
  if (r === undefined || r === null) return null;
  try { const s = JSON.stringify(r); return s.length > 500 ? { truncated: s.slice(0, 500) } : r; } catch { return String(r).slice(0, 500); }
}
