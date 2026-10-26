// The real Workflow Automation back end: workflows live in dashboard/data/workflows.json, steps are performed by the
// desktop automation agent named in Connections, and the agent's address, token and logins come from getSettings().
// While those are not saved the dashboard uses the seeded demo (rpa-demo.mjs) instead.
import path from 'node:path';
import * as kit from './store.mjs';
import { getSettings } from './store.mjs';
import { RpaStore, agentDriver } from '../src/rpa.mjs';
import { createRpa } from './rpa-panes.mjs';

const num = (v, d, lo, hi) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
export const agentSettings = (s = getSettings()) => ({ url: String(s.rpa_agent_url || '').trim(), token: String(s.rpa_agent_token || '') });
export const agentReady = (s = getSettings()) => { const a = agentSettings(s); return /^https?:\/\/\S+$/i.test(a.url) && !!a.token; };

let live = null;
export function liveRpa() {
  if (live) return live;
  const driver = () => { const a = agentSettings(); return agentDriver({ url: a.url, token: a.token }); };
  const store = new RpaStore({
    file: path.join(kit.DATA, 'workflows.json'), driver,
    settings: () => {
      const s = getSettings();
      return { stepDelayMs: num(s.rpa_step_delay_ms, 400, 0, 60000), maxRetries: num(s.rpa_max_retries, 1, 0, 5), approvalTimeoutMs: num(s.rpa_approval_minutes, 30, 1, 1440) * 60000, builtins: { login_user: s.rpa_login_user || '', login_password: s.rpa_login_password || '' } };
    }
  });
  live = createRpa({
    store, demo: false,
    clients: () => kit.users().filter((u) => u.role === 'client' && !u.disabled).map((u) => ({ id: u.id, name: u.name })),
    agent: () => ({ configured: agentReady() }),
    pull: async (rec, after) => {
      const r = await driver().events(after);
      if (r && Array.isArray(r.events)) return { ok: true, events: r.events.slice(0, 200), next: Number.isFinite(Number(r.next)) ? Number(r.next) : after + r.events.length };
      return { ok: false, message: (r && r.message) || 'The desktop agent did not return any events' };
    }
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
  if (h && h.ok) return { ok: true, message: 'Automation agent reachable in ' + (Date.now() - t0) + ' ms' + (h.version ? ' (version ' + String(h.version).slice(0, 20) + ')' : '') };
  return { ok: false, message: (h && h.message) || 'The automation agent said it is not ready' };
}

/**
 * Every 15 s: start due schedules, and turn new agent log rows (a file filed, a file transferred, an email triaged) into
 * triggers. `logRows(sinceId)` returns rows { id, type, details } newer than the id, and the highest id seen.
 */
export function startScheduler(logRows, every = 15000) {
  let seen = null;
  const timer = setInterval(() => {
    if (!agentReady()) return;
    try {
      const r = liveRpa().store;
      r.tick(Date.now());
      const got = logRows ? logRows(seen) : null;
      if (got) {
        const first = seen == null; seen = got.max;
        if (!first) for (const row of got.rows) { const ev = eventOf(row); if (ev) r.fireTrigger(ev.source, ev.payload); }
      }
    } catch { /* the next tick tries again */ }
  }, every);
  if (timer.unref) timer.unref();
  return () => clearInterval(timer);
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
