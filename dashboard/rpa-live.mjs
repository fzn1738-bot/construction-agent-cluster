// The real Workflow Automation back end: workflows live in dashboard/data/workflows.json (screenshots in data/shots/),
// the desktop automation agent named in Connections watches the screen in Record mode and performs the steps in Run
// mode (agent/rpa-agent.mjs is that agent), and the agent's address, token and logins come from getSettings().
// While those are not saved the dashboard uses the seeded demo (rpa-demo.mjs) instead.
import path from 'node:path';
import * as kit from './store.mjs';
import { getSettings } from './store.mjs';
import { RpaStore, agentDriver } from '../src/rpa.mjs';
import { createRpa } from './rpa-panes.mjs';

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const agentSettings = (s = getSettings()) => ({ url: String(s.rpa_agent_url || '').trim(), token: String(s.rpa_agent_token || '') });
export const agentReady = (s = getSettings()) => { const a = agentSettings(s); return /^https?:\/\/\S+$/i.test(a.url) && !!a.token; };
const driver = () => { const a = agentSettings(); return agentDriver({ url: a.url, token: a.token }); };

/**
 * Record mode through the desktop agent: start asks it to watch the screen for this recording (it answers
 * "permission-denied" when macOS has not allowed it), pull takes the actions it captured since the cursor, each with
 * its screenshot, and stop ends the watching.
 */
export const desktopRecorder = (agent = driver) => ({
  mode: 'desktop',
  start: async (rec) => { const r = await agent().recordStart(rec.id, { app: rec.app }); return r && r.ok ? { ok: true } : { ok: false, code: r && r.code, message: (r && r.message) || 'The desktop agent did not start recording' }; },
  stop: (rec) => agent().recordStop(rec.id),
  pull: async (rec, after) => {
    const r = await agent().events(rec.id, after);
    if (r && r.ok !== false && Array.isArray(r.events)) return { ok: true, events: r.events.slice(0, 200), next: Number.isFinite(Number(r.next)) ? Number(r.next) : after + r.events.length, error: r.error || null };
    return { ok: false, code: r && r.code, message: (r && r.message) || 'The desktop agent did not return the captured actions' };
  }
});

let live = null;
export function liveRpa() {
  if (live) return live;
  const store = new RpaStore({
    file: path.join(kit.DATA, 'workflows.json'), driver,
    settings: () => {
      const s = getSettings();
      return { stepDelayMs: num(s.rpa_step_delay_ms, 400, 0, 60000), maxRetries: num(s.rpa_max_retries, 1, 0, 5), approvalTimeoutMs: num(s.rpa_approval_minutes, 30, 1, 1440) * 60000, builtins: { login_user: s.rpa_login_user || '', login_password: s.rpa_login_password || '' } };
    }
  });
  live = createRpa({
    store, demo: false, recorder: desktopRecorder(),
    clients: () => kit.users().filter((u) => u.role === 'client' && !u.disabled).map((u) => ({ id: u.id, name: u.name })),
    builtinsReady: () => { const s = getSettings(); return { login_user: !!s.rpa_login_user, login_password: !!s.rpa_login_password }; }
  });
  return live;
}

/** A real call to the agent's /health with the saved (or just-typed) address and token. */
export async function probeAgent(s = getSettings()) {
  const a = agentSettings(s);
  if (!a.url) return { ok: false, message: 'No automation agent address set' };
  if (!/^https?:\/\/\S+$/i.test(a.url)) return { ok: false, message: 'The address must start with http:// or https://' };
  if (!a.token) return { ok: false, message: 'No automation agent token set' };
  const t0 = Date.now();
  const h = await agentDriver({ url: a.url, token: a.token, timeoutMs: 8000 }).health();
  if (!h || !h.ok) return { ok: false, message: (h && h.message) || 'The automation agent said it is not ready' };
  const p = h.permissions || {};
  const missing = [p.accessibility === false ? 'Accessibility' : '', p.screen === false ? 'Screen Recording' : ''].filter(Boolean);
  return { ok: true, message: 'Automation agent reachable in ' + (Date.now() - t0) + ' ms' + (h.version ? ' (version ' + String(h.version).slice(0, 20) + ')' : '') + (missing.length ? '. Record mode needs ' + missing.join(' and ') + ' permission on that Mac' : '') };
}

// ---------- triggers from the site's own events ----------
/** Which outcome tab each trigger source belongs to: a client may only be triggered by events it can see. */
export const SOURCE_PANE = { folder: 'documents', ftp: 'transfers', inbox: 'inbox' };
/** The clients an event from `source` belongs to: the owner's own workflows, and each client given that outcome. */
export function triggerClients(source) {
  const pane = SOURCE_PANE[source];
  if (!pane) return [];
  return ['internal', ...kit.users().filter((u) => u.role === 'client' && !u.disabled && kit.allowedPanes(kit.publicUser(u)).some((p) => p.id === pane)).map((u) => u.id)];
}
/** A log row -> { source, payload } for triggers, or null when it is not something worth reacting to. */
export function eventOf(row) {
  const d = row.details || {};
  const base = (p) => Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'string' && v));
  if (row.type === 'folder' && row.status === 'ok' && d.event === 'added') return { source: 'folder', payload: base({ file: path.basename(String(d.path || '')), path: d.path }) };
  if (row.type === 'ftp' && row.status === 'ok' && (d.op === 'download' || d.op === 'upload')) return { source: 'ftp', payload: base({ file: d.file, direction: d.op }) };
  if (row.type === 'imap' && row.status === 'ok' && d.uid != null) return { source: 'inbox', payload: base({ subject: d.subject, from: d.from, rule: d.rule }) };
  return null;
}
/**
 * Turn new log rows into triggers. `logRows(sinceId, limit)` returns { rows (id order), max }. The cursor only moves
 * past rows that were read, a batch at a time, so a burst bigger than one batch is never skipped. The first call
 * starts from the newest row (events from before the dashboard started do not fire).
 */
export function pumpTriggers(store, logRows, cursor, { clientsFor = triggerClients, batch = 200, maxBatches = 50 } = {}) {
  if (cursor == null) { const r = logRows(null, 0); return { cursor: r ? r.max : null, fired: [], read: 0 }; }
  const fired = []; let read = 0;
  for (let b = 0; b < maxBatches; b++) {
    const r = logRows(cursor, batch);
    if (!r || !r.rows.length) break;
    for (const row of r.rows) {
      cursor = row.id; read++;
      const ev = eventOf(row);
      if (!ev) continue;
      // one bad row never stalls the cursor (or fires the rows before it twice)
      try { fired.push(...store.fireTrigger(ev.source, ev.payload, { clients: clientsFor(ev.source) })); } catch { /* skipped */ }
    }
    if (r.rows.length < batch) break;
  }
  return { cursor, fired, read };
}
/** Every 15 s while the agent is connected: start due schedules, and fire triggers from new log rows. */
export function startScheduler(logRows, every = 15000) {
  let cursor = null;
  const timer = setInterval(() => {
    if (!agentReady()) return;
    try {
      const r = liveRpa().store;
      r.tick(Date.now());
      cursor = pumpTriggers(r, logRows, cursor).cursor;
    } catch { /* the next tick tries again from the same cursor */ }
  }, every);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
}
