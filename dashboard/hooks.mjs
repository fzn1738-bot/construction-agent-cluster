// The solution's dashboard logic, backed by the agent's SQLite state.
//   status() / metrics() / panels() / reports() / run(id) / pane(id) / paneAction(id, action, input, ctx)
//   paneStatus() / testConnection(id, settings) / onSettings(settings)
// What the client gets (one tab each): Site documents (watched folder), Contractor file transfers (FTP), Project inbox
// (IMAP triage) and the Activity record (SQLite). Overview combines their live states. Folder, FTP and mailbox
// details are Settings (getSettings(); never the environment directly).
// Database: AGENT_DB (default dashboard/data/agent.db).
//
// Demo data per screen: an outcome whose service is not set up yet shows the seeded demo records (marked
// source 'demo'), and its buttons work on those, while the outcomes that are set up show live data. The
// dashboard-wide demo switch follows the keys: on while nothing is set up, off as soon as one outcome is live, and
// reset to that automatic behaviour whenever saved Settings change which outcomes are live.
//
// Access: the server checks which tabs a user may open; inside the cross-outcome tabs and every action a client
// only sees and runs the outcomes they were given (allowFor()). Reports carry the overall state only.
//
// init() runs at import, so with monitors configured the continuous loop runs from boot. Saving Settings rebuilds
// the monitors (onSettings) one at a time, waiting for the old loop to drain before the new one opens.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '../src/agent-core.mjs';
import { openStore } from '../src/sqlite-utils.mjs';
import { buildMonitors } from '../src/monitors.mjs';
import { FtpClient } from '../src/ftp-client.mjs';
import { ImapClient } from '../src/email-client.mjs';
import * as kit from './store.mjs';
import { getSettings, saveSettings } from './store.mjs';
import * as demo from './demo.mjs';
import * as O from './outcomes.mjs';
import { isRpaPane, RPA_ACTIONS } from './rpa-panes.mjs';
import { demoRpa } from './rpa-demo.mjs';
import { liveRpa, agentReady, probeAgent, startScheduler } from './rpa-live.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DATA = kit.DATA;
const REPORTS = path.join(DATA, 'reports');
const SPEC = O.SPEC;
const { PANE } = O;

export const actions = O.actionsFromSpec();
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const cfg = () => { const s = getSettings(); return { staleMs: num(s.staleAfterMin, 30) * 60000, rows: Math.min(100, Math.round(num(s.recentRows, 12))), target: num(s.successTarget, 90), slowMs: num(s.latencyWarnMs, 1500) }; };
const truthy = (v) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

// ---------- monitors from Settings ----------
export function parseRules(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    const name = (i > 0 ? l.slice(0, i) : l).trim(); const subject = (i > 0 ? l.slice(i + 1) : l).trim();
    return { name: name.slice(0, 30) || 'rule', subject, action: 'log' };
  }).filter((r) => r.subject);
}
const serialiseRules = (rules) => rules.map((r) => r.name + ': ' + r.subject).join('\n');

/** Dashboard monitors use only values saved in Settings. The config file may still set loop timing. */
export function configFromSettings(file = {}, s = getSettings()) {
  const out = { tickMs: file.tickMs, folders: [], ftp: [], imap: [] };
  const put = (list, m) => { const i = list.findIndex((x) => x.name === m.name); if (i >= 0) list.splice(i, 1, m); else list.push(m); };
  if (s.watch_folder) put(out.folders, { name: 'site', path: String(s.watch_folder), intervalMs: 2000, settleMs: 1000, recursive: true });
  if (s.ftp_host && s.ftp_user && s.ftp_password) {
    put(out.ftp, {
      name: 'site', host: String(s.ftp_host), port: num(s.ftp_port, 21), user: String(s.ftp_user), password: String(s.ftp_password),
      secure: s.ftp_secure === 'implicit' ? 'implicit' : s.ftp_secure === 'explicit' ? 'explicit' : false,
      remoteDir: String(s.ftp_remote_dir || '/'), localDir: String(s.ftp_local_dir || path.join(DATA, 'sync', 'site')),
      direction: ['download', 'upload', 'both'].includes(s.ftp_direction) ? s.ftp_direction : 'download', intervalMs: 300000
    });
  }
  if (s.imap_host && s.imap_user && s.imap_password) {
    put(out.imap, {
      name: 'pm', host: String(s.imap_host), port: num(s.imap_port, 993), user: String(s.imap_user), password: String(s.imap_password),
      secure: s.imap_secure === undefined ? true : truthy(s.imap_secure), mailbox: String(s.imap_mailbox || 'INBOX'), intervalMs: 60000, rules: parseRules(s.imap_rules)
    });
  }
  return out;
}

// ---------- the runtime and its lifecycle ----------
// One runtime (database + agent loop) at a time. Rebuilds run one after another (serial()); while the old loop drains
// it stays the current runtime (its database open), and only once it has closed can a new one be created.
let rt = null; let signalsHooked = false;
const life = { opened: 0, closed: 0 };
let chain = Promise.resolve();
function serial(fn) { const p = chain.then(fn); chain = p.catch(() => {}); return p; }
const settled = () => chain;

function runtime() {
  if (rt) return rt;
  fs.mkdirSync(DATA, { recursive: true });
  const dbFile = process.env.AGENT_DB || path.join(DATA, 'agent.db');
  const store = openStore(dbFile);
  const cfgFile = process.env.AGENT_CONFIG || path.join(ROOT, 'agent.config.json');
  let file = {}; let configError = null;
  try { if (fs.existsSync(cfgFile)) file = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { configError = 'agent.config.json: ' + e.message; }
  const config = configFromSettings(file);
  const agent = new Agent({ store, tickMs: config.tickMs || 250 });
  const monitors = new Map();
  try { for (const m of buildMonitors(config, store)) { agent.addMonitor(m); monitors.set(m.id, m); } } catch (e) { configError = e.message; }
  agent.on('log', (l) => { if (l.level === 'error') store.log('system', 'error', { message: l.message }); });
  life.opened++;
  rt = { store, agent, monitors, configError, dbFile, config };
  const mine = rt;
  if (agent.tasks.size && process.env.AGENT_AUTOSTART !== '0') agent.start().catch((e) => { mine.configError = e.message; });
  if (!signalsHooked) { signalsHooked = true; for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => shutdown().finally(() => process.exit(0))); }
  return rt;
}

async function stopRuntime(waitMs) {
  const cur = rt;
  if (!cur) return { forced: false, closed: Promise.resolve() };
  cur.closing = true;
  const { forced } = await cur.agent.stop();
  const closed = cur.agent.idle().then(() => { cur.store.close(); life.closed++; if (rt === cur) rt = null; });
  if (!forced) await closed;
  else if (waitMs) {
    await Promise.race([closed, sleep(waitMs)]);
    if (rt === cur) rt = null;   // gave up waiting: the old attempt finishes into its own connection, then closes it
  }
  return { forced, closed };
}

/**
 * Stop the loop (waiting up to the grace period for in-flight work) and close the database. If work outlasted the
 * grace period the database is closed only once that work has finished, so it can still record its result.
 */
export function shutdown() { return serial(() => stopRuntime(0)); }

function initNow() { const { agent, configError } = runtime(); return { tasks: agent.tasks.size, running: agent.running, configError }; }
/** Called once when the server starts: opens the store and starts the loop. */
export function init() { return serial(async () => initNow()); }

/** After the admin saves Settings the monitors are rebuilt, so new keys are used straight away. */
export function onSettings() {
  return serial(async () => {
    await stopRuntime(30000);
    const r = initNow();
    trackKeys(); syncDemo(true); invalidate();
    return r;
  });
}
/** Runtimes opened and closed so far (one is open at a time). */
export const lifecycle = () => ({ ...life, open: rt ? 1 : 0 });

// ---------- the demo switch follows the keys ----------
let liveSig = null;
const liveKinds = () => (rt ? [...new Set([...rt.agent.tasks.values()].map((t) => t.kind))].sort().join(',') : '');
/** Demo data while no outcome is live. An explicit choice in Control holds until saved Settings change what is live. */
export function syncDemo(settingsSaved = false) {
  if (!rt || SPEC.demo === false) return null;
  const sig = liveKinds();
  const changed = liveSig !== null && sig !== liveSig;
  liveSig = sig;
  const d = kit.readJSON('demo.json', null);
  if (d && d.auto !== true && !(settingsSaved && changed)) return d.on;
  const want = !sig;
  if (!d || d.on !== want || d.auto !== true) kit.writeJSON('demo.json', { on: want, auto: true, at: new Date().toISOString() });
  return want;
}
function demoSwitch() { const d = kit.readJSON('demo.json', null); return { on: d ? !!d.on : kit.demoOn(), auto: !d || d.auto === true }; }

// ---------- when each key last changed (fingerprints only, never values) ----------
function trackKeys() {
  const s = getSettings();
  const rec = kit.readJSON('key-updates.json', {});
  let base = null; try { base = fs.statSync(path.join(DATA, 'settings.json')).mtime.toISOString(); } catch { base = null; }
  let changed = false;
  for (const k of O.KEYS) {
    const v = s[k.key];
    const fp = v ? kit.hashCode('key:' + k.key + ':' + String(v)) : '';
    const cur = rec[k.key];
    if (!cur) { rec[k.key] = { fp, at: fp ? base || new Date().toISOString() : null }; changed = true; }
    else if (cur.fp !== fp) { rec[k.key] = { fp, at: fp ? new Date().toISOString() : null }; changed = true; }
  }
  if (changed) kit.writeJSON('key-updates.json', rec);
  return rec;
}

// ---------- who may see what ----------
/** A predicate over pane ids for this user: admins (and direct calls) see everything, clients their own tabs. */
export function allowFor(user) {
  if (!user || user.role === 'admin') return () => true;
  let u = null;
  if (user.id === 'preview-client') u = { role: 'client', panes: '*' };
  else { const f = kit.users().find((x) => x.id === user.id && !x.disabled); if (f) u = kit.publicUser(f); }
  if (!u) return () => false;
  const ids = new Set(kit.allowedPanes(u).map((p) => p.id));
  return (id) => ids.has(id);
}
const isAdmin = (ctx) => !ctx || !ctx.user || ctx.user.role === 'admin';
/** Workflow automation: the real store once the automation agent is saved in Connections, the seeded demo until then. */
const rpa = () => (agentReady() ? liveRpa() : demoRpa());

// ---------- helpers ----------
const rel = (iso) => O.rel(iso);
const MON_KIND = { folder: 'Folder', ftp: 'FTP', imap: 'Email' };
const lastRun = (t) => t.state && (t.state.details.lastRunAt || t.state.timestamp);
const staleIds = (tasks) => tasks.filter((t) => { const l = lastRun(t); return l && !t.inflight && Date.now() - Date.parse(l) > cfg().staleMs; }).map((t) => t.id);
const monitorRows = ({ agent, monitors }) => agent.snapshot().tasks.map((t) => {
  const st = t.state; const m = monitors.get(t.id);
  const state = t.lingering ? { text: 'Stuck', tone: 'bad' } : t.inflight ? { text: 'Running', tone: 'run' }
    : !st ? { text: 'Waiting', tone: 'wait' } : st.status === 'ok' ? { text: 'OK', tone: 'ok' }
    : st.status === 'failed' ? { text: 'Failed', tone: 'bad' } : { text: st.status[0].toUpperCase() + st.status.slice(1), tone: 'wait' };
  const last = lastRun(t);
  const r = (st && st.details.result) || {};
  // Queue depth: folder files awaiting their action; email messages left past maxPerPoll; FTP transfers that failed.
  const queue = m && typeof m.queueDepth === 'number' ? m.queueDepth : t.kind === 'imap' ? Number(r.backlog || 0) : t.kind === 'ftp' ? Number(r.failed || 0) : 0;
  return [MON_KIND[t.kind] + ' · ' + t.id.slice(t.id.indexOf(':') + 1), state, last ? rel(last) : 'never', queue];
});
const parseRow = (r) => ({ ...r, details: JSON.parse(r.details) });
const logsOf = (store, type, limit = 500) => store.db.prepare('SELECT * FROM sync_log WHERE type = ? ORDER BY timestamp DESC, id DESC LIMIT ?').all(type, limit).map(parseRow);
const taskRuns = (store, limit = 100) => store.db.prepare("SELECT * FROM sync_log WHERE type IN ('folder','ftp','imap','task') AND json_extract(details, '$.attempt') IS NOT NULL ORDER BY timestamp DESC, id DESC LIMIT ?").all(limit).map(parseRow);
const count1 = (store, where) => Number(store.db.prepare('SELECT COUNT(*) AS n FROM sync_log WHERE ' + where).get().n);
// Event rows only: a task's own per-poll 'ok' row (it has details.attempt) is not a transfer or an email.
const FTP_TRANSFERS = "type = 'ftp' AND status = 'ok' AND json_extract(details, '$.op') IN ('download', 'upload')";
// An email counts once it is acknowledged: handled by a rule, ignored, malformed, or given up after failed rule runs.
const EMAILS_PROCESSED = "type = 'imap' AND json_extract(details, '$.uid') IS NOT NULL AND (status IN ('ok', 'ignored', 'malformed') OR (status = 'failed' AND json_extract(details, '$.gaveUp') = 1))";
const DOCS_FILED = "type = 'folder' AND status = 'ok' AND json_extract(details, '$.event') = 'added'";

/** 24 hourly buckets, oldest first, ending now. */
export function hourly(rows, now = Date.now()) { return O.hourly(rows, now); }
const line = (title, name, b, pane) => ({ title, kind: 'line', labels: b.labels, series: [{ name, values: b.values }], pane });
const tally = (items) => { const m = new Map(); for (const i of items) m.set(i, (m.get(i) || 0) + 1); return m; };
const baseName = (p) => (p ? path.basename(String(p)) : '');

function kindState(kind) {
  const { agent } = runtime();
  const tasks = agent.snapshot().tasks.filter((t) => t.kind === kind);
  return { tasks, configured: tasks.length > 0, failed: tasks.filter((t) => t.state && t.state.status === 'failed'), stale: staleIds(tasks), running: tasks.some((t) => t.inflight), last: tasks.map(lastRun).filter(Boolean).sort().pop() || null };
}
const NEEDS = { documents: 'Add the site folder in Settings', transfers: 'Add the FTP host, user and password in Settings', inbox: 'Add the mailbox host, user and password in Settings' };
const missingOf = (connId) => { const c = kit.connections().find((x) => x.id === connId); return c ? c.missing.map(O.settingLabel) : []; };

/** A tab whose service is not set up shows the demo records, marked as such, with what it waits for. */
async function demoFallback(id) {
  const d = await demo.pane(id);
  const s = getSettings();
  const over = id === 'documents' ? { folder: s.watch_folder || null } : id === 'transfers' ? { host: s.ftp_host || null, direction: s.ftp_direction || 'download' } : id === 'inbox' ? { host: s.imap_host || null, rules: parseRules(s.imap_rules) } : {};
  return { ...d, ...over, source: 'demo', configured: false, needs: NEEDS[id], missing: missingOf(O.outcomeOf(id).connection), canEdit: true };
}

// ---------- the four outcome tabs' records ----------
const EVENT_WORD = { added: 'Filed', modified: 'Updated', removed: 'Removed', renamed: 'Renamed', detected: 'Detected' };
const monitorsOfKind = (prefix) => monitorRows(runtime()).filter((r) => r[0].startsWith(prefix)).map((r) => ({ name: r[0], state: r[1].text, tone: r[1].tone, last: r[2], queue: r[3] }));
async function documentsData() {
  const k = kindState('folder');
  if (!k.configured) return demoFallback('documents');
  const { store } = runtime(); const s = getSettings();
  const events = logsOf(store, 'folder').filter((l) => l.details.event && l.details.event !== 'detected');
  const arrivals = events.map((l) => ({ file: baseName(l.details.path || l.details.to), folder: l.details.monitor || '', event: l.status === 'failed' ? 'Failed' : EVENT_WORD[l.details.event] || l.details.event, status: l.status, at: l.timestamp, size: l.details.size ?? null, error: l.details.error || null }));
  const mons = monitorsOfKind('Folder');
  const folders = (runtime().config.folders || []).map((f) => f.path);
  return {
    source: 'live', configured: true, needs: null, folder: s.watch_folder || folders[0] || null, monitors: mons,
    summary: { filed: count1(store, DOCS_FILED), waiting: mons.reduce((n, m) => n + m.queue, 0), last: k.last },
    arrivals: arrivals.slice(0, 200), hours: hourly(events.map((l) => ({ timestamp: l.timestamp }))), canEdit: true
  };
}
async function transfersData() {
  const k = kindState('ftp');
  if (!k.configured) return demoFallback('transfers');
  const { store } = runtime(); const s = getSettings();
  const items = logsOf(store, 'ftp').filter((l) => l.details.op);
  const transfers = items.map((l) => ({ file: l.details.file || (l.details.op === 'connect' ? 'Connection' : '—'), op: l.details.op, status: l.status, bytes: l.details.bytes ?? null, monitor: l.details.monitor || '', at: l.timestamp, reason: l.details.reason || null, error: l.details.error || null }));
  const conf = (runtime().config.ftp || [])[0] || {};
  return {
    source: 'live', configured: true, needs: null, host: s.ftp_host || conf.host || null, remoteDir: s.ftp_remote_dir || conf.remoteDir || '/', direction: s.ftp_direction || conf.direction || 'download', monitors: monitorsOfKind('FTP'),
    summary: { transferred: count1(store, FTP_TRANSFERS), failed: count1(store, "type = 'ftp' AND status = 'failed'"), skipped: count1(store, "type = 'ftp' AND status = 'skipped'"), last: k.last },
    transfers: transfers.slice(0, 200), hours: hourly(items.filter((l) => l.status === 'ok' && ['download', 'upload'].includes(l.details.op))), canEdit: true
  };
}
const RESULT = { ok: 'Matched', ignored: 'No rule matched', malformed: 'Unreadable', failed: 'Failed' };
async function inboxData() {
  const k = kindState('imap');
  if (!k.configured) return demoFallback('inbox');
  const { store } = runtime(); const s = getSettings();
  const items = logsOf(store, 'imap').filter((l) => l.details.uid != null);
  const messages = items.map((l) => ({ uid: l.details.uid, from: l.details.from || '', subject: l.details.subject || '(no subject)', result: RESULT[l.status] || l.status, status: l.status, rule: l.details.rule || null, at: l.timestamp }));
  const byRule = tally(items.map((l) => (l.status === 'ok' ? l.details.rule || 'rule' : l.status === 'ignored' ? 'No rule' : null)).filter(Boolean));
  const mons = monitorsOfKind('Email');
  const conf = (runtime().config.imap || [])[0] || {};
  return {
    source: 'live', configured: true, needs: null, mailbox: s.imap_mailbox || conf.mailbox || 'INBOX', host: s.imap_host || conf.host || null, rules: s.imap_rules ? parseRules(s.imap_rules) : (conf.rules || []).map((r) => ({ name: r.name, subject: String(r.subject || ''), action: 'log' })), monitors: mons,
    summary: { triaged: count1(store, EMAILS_PROCESSED), backlog: mons.reduce((n, m) => n + m.queue, 0), ignored: count1(store, "type = 'imap' AND status = 'ignored'"), last: k.last },
    messages: messages.slice(0, 200), byRule: { labels: [...byRule.keys()], values: [...byRule.values()] }, canEdit: true
  };
}
export const ACTIVITY_TYPES = ['all', 'folder', 'ftp', 'imap', 'task', 'system'];
export const ACTIVITY_RESULTS = ['all', 'ok', 'failed', 'other'];
const WARN = new Set(['skipped', 'malformed', 'interrupted', 'reset', 'stopped-forced', 'recovered']);
const level = (st) => (st === 'failed' || st === 'error' ? 'error' : WARN.has(st) ? 'warn' : 'info');
const describe = (l) => {
  const d = l.details;
  return (d.task || d.monitor || l.type) + ': ' + (d.event || d.op || d.error || d.note || d.message || l.status)
    + (d.path ? ' ' + baseName(d.path) : d.file ? ' ' + d.file : d.subject ? ' ' + d.subject : '');
};
function activityEvents(store, { type = 'all', result = 'all' } = {}, limit = 100) {
  const where = []; const args = [];
  if (type !== 'all' && ACTIVITY_TYPES.includes(type)) { where.push('type = ?'); args.push(type); }
  if (result === 'ok') where.push("status = 'ok'"); else if (result === 'failed') where.push("status IN ('failed','error')"); else if (result === 'other') where.push("status NOT IN ('ok','failed','error')");
  return store.db.prepare('SELECT * FROM sync_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY timestamp DESC, id DESC LIMIT ?').all(...args, limit).map(parseRow)
    .map((l) => ({ source: l.type, result: l.status, level: level(l.status), what: describe(l), at: l.timestamp }));
}
const stateTables = (store) => store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map((t) => [t.name, Number(store.db.prepare('SELECT COUNT(*) AS n FROM "' + t.name.replace(/"/g, '') + '"').get().n)]);
async function activityData(filter = {}) {
  const { store } = runtime();
  const integ = store.integrity();
  const types = store.db.prepare('SELECT type, COUNT(*) AS n FROM sync_log GROUP BY type ORDER BY n DESC').all();
  return {
    source: 'live', configured: true, filter: { type: ACTIVITY_TYPES.includes(filter.type) ? filter.type : 'all', result: ACTIVITY_RESULTS.includes(filter.result) ? filter.result : 'all' },
    types: ACTIVITY_TYPES, results: ACTIVITY_RESULTS,
    summary: { rows: Number(store.db.prepare('SELECT COUNT(*) AS n FROM sync_log').get().n), integrity: integ.ok, problems: integ.problems.slice(0, 3), tables: stateTables(store) },
    events: activityEvents(store, filter, 200), byType: { labels: types.map((t) => t.type), values: types.map((t) => Number(t.n)) }
  };
}
const OUTCOME_DATA = { documents: documentsData, transfers: transfersData, inbox: inboxData, 'activity-log': activityData };

// ---------- the world: everything the cross-outcome tabs are built from ----------
let cached = null;
const invalidate = () => { cached = null; };

function outcomeState(id, d) {
  const word = (n, one, many) => plural(n, one, many);
  if (id === 'activity-log') return d.summary.integrity ? { state: 'ok', text: word(d.summary.rows, 'event', 'events') + ' on record' } : { state: 'bad', text: 'Record problem: ' + d.summary.problems[0] };
  if (d.source === 'demo') return { state: 'idle', text: 'Demo data · ' + d.needs };
  const k = kindState(O.outcomeOf(id).kind);
  if (k.failed.length) return { state: 'bad', text: k.failed.map((t) => t.id).join(', ') + ' failed' };
  if (k.stale.length) return { state: 'warn', text: 'Not run for over ' + Math.round(cfg().staleMs / 60000) + ' min' };
  if (k.running) return { state: 'ok', text: 'Working now' };
  const o = O.outcomeOf(id);
  const n = id === 'documents' ? d.summary.filed : id === 'transfers' ? d.summary.transferred : d.summary.triaged;
  return { state: 'ok', text: word(n, o.one, o.many) };
}
function outcomeFacts(id, d, now) {
  const today = (list, pick = () => true) => list.filter((x) => pick(x) && O.isToday(x.at, now)).length;
  if (id === 'documents') return { count: d.summary.filed, today: today(d.arrivals, (a) => a.status === 'ok'), last: d.summary.last || (d.arrivals[0] && d.arrivals[0].at) || null, rows: d.arrivals.length };
  if (id === 'transfers') return { count: d.summary.transferred, today: today(d.transfers, (t) => t.status === 'ok'), last: d.summary.last || (d.transfers[0] && d.transfers[0].at) || null, rows: d.transfers.length };
  if (id === 'inbox') return { count: d.summary.triaged, today: today(d.messages), last: d.summary.last || (d.messages[0] && d.messages[0].at) || null, rows: d.messages.length };
  return { count: d.summary.rows, today: today(d.events), last: d.events[0] ? d.events[0].at : null, rows: d.events.length };
}
function resultText(kind, r) {
  if (!r || typeof r !== 'object') return 'Done';
  if (kind === 'folder') return plural(Number(r.added || 0), 'document filed', 'documents filed') + (r.failed ? ', ' + r.failed + ' failed' : '');
  if (kind === 'ftp') return plural(Number(r.downloaded || 0) + Number(r.uploaded || 0), 'file transferred', 'files transferred') + ', ' + Number(r.failed || 0) + ' failed';
  if (kind === 'imap') return plural(Number(r.processed || 0), 'email triaged', 'emails triaged');
  return 'Done';
}
const VERB = { folder: 'scan of the site folder', ftp: 'FTP sync', imap: 'inbox check' };
const readLatency = () => kit.readLines('latency.jsonl', 400);

async function buildWorld() {
  const R = runtime(); const { store, agent } = R;
  const s = getSettings(); const now = Date.now();
  const snap = agent.snapshot();
  const outcomes = {}; const data = {};
  for (const d of O.OUTCOMES) {
    data[d.id] = await OUTCOME_DATA[d.id]();
    outcomes[d.id] = { source: data[d.id].source, configured: data[d.id].configured, state: outcomeState(d.id, data[d.id]), needs: data[d.id].needs || null, missing: data[d.id].missing || [], ...outcomeFacts(d.id, data[d.id], now) };
  }
  // dashboard runs (who pressed what) and the loop's own scheduled runs
  const dash = kit.readLines('runs.jsonl', 300).map((r) => ({ at: r.at, label: r.label || r.action, byId: r.by, byName: r.byName, outcome: O.outcomeOfRun(r), ms: Number(r.ms) || 0, ok: r.ok !== false, message: String(r.message || '') }));
  const sched = store.db.prepare("SELECT * FROM sync_log WHERE type IN ('folder','ftp','imap') AND json_extract(details, '$.attempt') IS NOT NULL AND json_extract(details, '$.trigger') = 'schedule' ORDER BY timestamp DESC, id DESC LIMIT 200").all().map(parseRow)
    .map((l) => ({ at: l.timestamp, label: 'Scheduled ' + VERB[l.type], byId: 'schedule', byName: 'Schedule', outcome: O.outcomeOfKind(l.type).id, ms: Number(l.details.ms) || 0, ok: l.status === 'ok', message: l.status === 'ok' ? resultText(l.type, l.details.result) : 'Failed: ' + String(l.details.error || '').slice(0, 160) }));
  const runs = [...dash, ...sched].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const tr = taskRuns(store, 1000);
  const recent = tr.slice(0, 50);
  const success = recent.length ? Math.round((recent.filter((r) => r.status === 'ok').length / recent.length) * 100) : null;
  const lastRunAt = [tr[0] && tr[0].timestamp, runs[0] && runs[0].at].filter(Boolean).sort().pop() || null;
  const handled = store.db.prepare('SELECT timestamp FROM sync_log WHERE (' + DOCS_FILED + ') OR (' + FTP_TRANSFERS + ') OR (' + EMAILS_PROCESSED + ') ORDER BY timestamp DESC LIMIT 2000').all();

  // services and their latency
  const conns = kit.connections();
  const lat = readLatency();
  const hourAgo = now - 3600000;
  const kindRuns = (kind) => tr.filter((r) => r.type === kind && Date.parse(r.timestamp) >= hourAgo).map((r) => ({ at: r.timestamp, ms: Number(r.details.ms) }));
  const samples = (id, kind) => [...lat.filter((l) => l.id === id && Date.parse(l.at) >= hourAgo), ...kindRuns(kind)];
  const integ = store.integrity();
  const services = O.SERVICES.map((svc) => {
    if (!svc.outside) {
      const t0 = process.hrtime.bigint(); store.db.prepare('SELECT 1').get(); const ms = Math.max(1, Math.round(Number(process.hrtime.bigint() - t0) / 1e6));
      return { ...svc, ready: true, missing: [], fields: [], endpoint: path.basename(R.dbFile), test: null, latency: ms, state: integ.ok ? 'ok' : 'bad', stateText: integ.ok ? 'Connected' : 'Record problem', checkedAt: new Date(now).toISOString() };
    }
    const c = conns.find((x) => x.id === svc.id) || { ready: false, missing: [], fields: [], test: null };
    const kind = { folders: 'folder', ftp: 'ftp', imap: 'imap' }[svc.id];
    const k = kindState(kind);
    const ready = c.ready || k.configured;
    const test = c.test || null;
    const last = [...samples(svc.id, kind)].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).pop();
    const lastTest = lat.filter((l) => l.id === svc.id).pop();
    const latency = last && Number.isFinite(last.ms) ? last.ms : lastTest ? lastTest.ms : null;
    const conf = (R.config[{ folders: 'folders', ftp: 'ftp', imap: 'imap' }[svc.id]] || [])[0] || {};
    const endpoint = svc.id === 'folders' ? s.watch_folder || conf.path || null : svc.id === 'ftp' ? (s.ftp_host || conf.host ? (s.ftp_host || conf.host) + ':' + num(s.ftp_port || conf.port, 21) : null) : (s.imap_host || conf.host ? (s.imap_host || conf.host) + ':' + num(s.imap_port || conf.port, 993) : null);
    const testAfterRun = test && (!k.last || Date.parse(test.at) >= Date.parse(k.last));
    let state = 'ok', stateText = 'Connected';
    if (!ready) { state = 'idle'; stateText = 'Key missing'; }
    else if (k.failed.length) { state = 'bad'; stateText = 'Failing'; }
    else if (test && !test.ok && testAfterRun) { state = 'bad'; stateText = 'Test failed'; }
    else if (!k.configured && !test) { state = 'warn'; stateText = 'Not tested'; }
    else if (latency != null && latency > cfg().slowMs) { state = 'warn'; stateText = 'Slow'; }
    const checkedAt = [test && test.at, k.last].filter(Boolean).sort().pop() || null;
    return { ...svc, ready, missing: c.missing.map(O.settingLabel), fields: (svc.fields || []).map((key) => ({ label: O.settingLabel(key), set: !!s[key], source: kit.settingSource(key) === 'settings' ? 'Settings' : kit.settingSource(key) === 'env' ? '.env' : 'Not set' })), endpoint, test, latency, state, stateText, checkedAt };
  });
  const updates = trackKeys();
  const keys = O.KEYS.map((k) => {
    const value = s[k.key] == null || s[k.key] === '' ? null : String(s[k.key]);
    const test = (conns.find((c) => c.id === k.conn) || {}).test || null;
    const updated = updates[k.key] ? updates[k.key].at : null;
    const status = !value ? 'Missing' : test && (!updated || Date.parse(test.at) >= Date.parse(updated)) ? (test.ok ? 'Valid' : 'Failed') : 'Set';
    const src = kit.settingSource(k.key);
    return { ...k, value, source: src === 'settings' ? 'Settings' : src === 'env' ? '.env' : null, updated, status };
  });
  const tasks = snap.tasks;
  let problem = null, idle = null;
  if (!integ.ok) problem = { headline: 'Database problem', detail: integ.problems[0] };
  else if (R.configError) problem = { headline: 'Config error', detail: R.configError };
  const stale = staleIds(tasks);
  const low = recent.length >= 5 && success < cfg().target;
  if (!tasks.length) idle = { headline: 'Idle', detail: 'No outcome is set up yet. Add the site folder, FTP or mailbox login in Settings.' };
  else if (!snap.running) idle = { headline: 'Stopped', detail: 'The agent loop is not running' };
  else if (stale.length) idle = { headline: 'Stale', detail: plural(stale.length, 'outcome has', 'outcomes have') + ' not run for over ' + Math.round(cfg().staleMs / 60000) + ' min' };
  else if (low) idle = { headline: 'Below target', detail: 'Success rate ' + success + '% is under the ' + cfg().target + '% target' };
  const w = {
    now, demo: false, demoSwitch: demoSwitch(), outcomes, services, keys, runs, success, lastRunAt, problem, idle, working: snap.active,
    taskHours: hourly(tr), handledHours: hourly(handled),
    latency: O.lastHour([{ name: 'FTP', service: 'ftp', samples: samples('ftp', 'ftp') }, { name: 'IMAP', service: 'imap', samples: samples('imap', 'imap') }], now),
    rowsByPane: {}
  };
  w.rowsByPane = O.rowsOf(w);
  for (const id of Object.values(PANE)) if (id !== PANE.screens) w.rowsByPane[id] = (O.metaPane(id, w, () => true, { admin: true }, {}) || { rows: [] }).rows.length;
  w.rowsByPane[PANE.screens] = (SPEC.panes || []).length;
  return { w, data };
}
async function world() {
  if (cached && Date.now() - cached.at < 1500) return cached.v;
  const v = await buildWorld();
  cached = { at: Date.now(), v };
  return v;
}

// ---------- status, metrics, panels ----------
export async function status() {
  syncDemo(false);
  const { w } = await world();
  return O.statusOf(w);
}

/** One state per tab, for the Overview centrepiece and the sidebar. Reads local state only (polled often). */
export async function paneStatus(ctx = {}) {
  const { w } = await world();
  return { ...O.paneStates(w), ...rpa().states(ctx) };
}

/** The numbers; the workflow ones are counted for whoever asks (a client sees its own workflows' numbers only). */
export async function metrics(ctx = {}) {
  const { w, data } = await world();
  const docs = data.documents, tr = data.transfers, inb = data.inbox, act = data['activity-log'];
  const t = (list) => hourly(list.map((x) => ({ at: x.at }))).values;
  return [
    ...O.metaMetrics(w),
    { key: 'docsFiled', label: 'Documents filed', value: docs.summary.filed, unit: '', trend: docs.hours ? docs.hours.values : t(docs.arrivals), good: 'up', pane: 'documents' },
    { key: 'docsWaiting', label: 'Files waiting', value: docs.summary.waiting, unit: '', trend: [docs.summary.waiting], good: 'down', pane: 'documents' },
    { key: 'ftpTransfers', label: 'Files transferred', value: tr.summary.transferred, unit: '', trend: tr.hours ? tr.hours.values : t(tr.transfers), good: 'up', pane: 'transfers' },
    { key: 'ftpFailed', label: 'Transfer failures', value: tr.summary.failed, unit: '', trend: t(tr.transfers.filter((x) => x.status === 'failed')), good: 'down', pane: 'transfers' },
    { key: 'emailsProcessed', label: 'Emails triaged', value: inb.summary.triaged, unit: '', trend: t(inb.messages), good: 'up', pane: 'inbox' },
    { key: 'emailBacklog', label: 'Inbox backlog', value: inb.summary.backlog, unit: '', trend: [inb.summary.backlog], good: 'down', pane: 'inbox' },
    { key: 'logRows', label: 'Events on record', value: act.summary.rows, unit: '', trend: t(act.events), good: 'up', pane: 'activity-log' },
    { key: 'dbIntegrity', label: 'Record integrity', value: act.summary.integrity ? 100 : 0, unit: '%', trend: [act.summary.integrity ? 100 : 0], good: 'up', pane: 'activity-log' },
    ...rpa().metrics(ctx)
  ].filter((m) => SPEC.metrics.some((s) => s.key === m.key));
}

/** One row per monitor: name, state chip, last run, queue depth. */
export function monitorTable() { return { title: 'Monitors', kind: 'table', columns: ['Monitor', 'State', 'Last run', 'Queue'], rows: monitorRows(runtime()), pane: 'overview' }; }

export async function panels(ctx = {}) {
  const { w, data } = await world();
  const n = cfg().rows;
  const docs = data.documents, tr = data.transfers, inb = data.inbox, act = data['activity-log'];
  const own = {
    'Arrivals, last 24 hours': () => line('Arrivals, last 24 hours', 'Files', docs.hours, 'documents'),
    'Recent arrivals': () => ({ title: 'Recent arrivals', kind: 'table', columns: ['File', 'Folder', 'Event', 'When'], rows: docs.arrivals.slice(0, n).map((a) => [a.file, a.folder, a.event, rel(a.at)]), pane: 'documents' }),
    'Transfers, last 24 hours': () => line('Transfers, last 24 hours', 'Transfers', tr.hours, 'transfers'),
    'Transfer history': () => ({ title: 'Transfer history', kind: 'table', columns: ['File', 'Direction', 'Result', 'When'], rows: tr.transfers.slice(0, n).map((x) => [x.file, x.op, x.status === 'ok' ? 'OK' : x.status === 'failed' ? 'Failed: ' + String(x.error || '').slice(0, 80) : 'Skipped', rel(x.at)]), pane: 'transfers' }),
    'Triage by rule': () => ({ title: 'Triage by rule', kind: 'bar', labels: inb.byRule.labels, series: [{ name: 'Messages', values: inb.byRule.values }], pane: 'inbox' }),
    'Recent messages': () => ({ title: 'Recent messages', kind: 'table', columns: ['From', 'Subject', 'Result', 'When'], rows: inb.messages.slice(0, n).map((m) => [m.from, m.subject, m.result + (m.rule ? ': ' + m.rule : ''), rel(m.at)]), pane: 'inbox' }),
    'Events by source': () => ({ title: 'Events by source', kind: 'bar', labels: act.byType.labels, series: [{ name: 'Events', values: act.byType.values }], pane: 'activity-log' }),
    'Latest events': () => ({ title: 'Latest events', kind: 'table', columns: ['Source', 'Result', 'What', 'When'], rows: act.events.slice(0, n).map((e) => [e.source, e.result, e.what, rel(e.at)]), pane: 'activity-log' })
  };
  const meta = Object.fromEntries(O.metaPanels(w).map((p) => [p.title, p]));
  const flow = Object.fromEntries(rpa().panels(ctx).map((p) => [p.title, p]));
  return SPEC.panels.map((p) => (own[p.title] ? own[p.title]() : flow[p.title] || meta[p.title])).filter(Boolean);
}

// ---------- actions ----------
const summarise = (results) => {
  const failed = results.filter((r) => r.status !== 'ok');
  return { ok: failed.length === 0, message: results.length + ' task(s) run, ' + failed.length + ' failed' + (failed.length ? ': ' + failed.map((f) => f.id + ' (' + f.error + ')').join('; ').slice(0, 300) : ''), output: results.map(({ id: i, status, attempts }) => ({ id: i, status, attempts })) };
};
const NO_MONITORS = 'No monitors configured: add the site folder, FTP or mailbox login in Settings';
const NOT_YOURS = 'That outcome is not part of your access.';

/** Run one outcome's monitors; an outcome that is not set up runs on its demo records instead, and says so. */
async function runOutcome(o, allow) {
  if (!allow(o.id)) return { ok: false, message: NOT_YOURS };
  if (o.id === 'activity-log') {
    const { store } = runtime(); const r = store.integrity();
    return { ok: r.ok, message: r.ok ? 'Record integrity check passed' : 'Record problem: ' + r.problems.slice(0, 3).join('; '), output: { tables: stateTables(store) } };
  }
  const { agent } = runtime();
  const ids = [...agent.tasks.values()].filter((t) => t.kind === o.kind).map((t) => t.id);
  if (!ids.length) {
    const r = await demo.run(o.action);
    return { ok: r.ok, demo: true, message: 'Demo data: ' + String(r.message).replace(/ \(demo\)$/, '') + '. ' + NEEDS[o.id] + ' to go live.', output: r.output };
  }
  return summarise(await Promise.all(ids.map((i) => agent.runTask(i, 'manual'))));
}

async function runMine(allow) {
  const mine = O.OUTCOMES.filter((o) => o.kind && allow(o.id));
  if (!mine.length) return { ok: false, message: 'None of the outcomes that run are part of your access.' };
  const parts = [];
  for (const o of mine) parts.push([o, await runOutcome(o, allow)]);
  return { ok: parts.every(([, r]) => r.ok), message: parts.map(([o, r]) => o.short + ': ' + r.message).join(' · ').slice(0, 480), output: parts.map(([o, r]) => ({ outcome: o.id, ok: r.ok, demo: !!r.demo })) };
}

async function checkOutcomes(allow) {
  invalidate();
  const { w } = await world();
  const oc = O.outcomesPane(w, allow);
  if (!oc.items.length) return { ok: true, message: 'None of the outcome tabs are part of your access.', output: [] };
  const live = oc.items.filter((i) => i.status !== 'Demo data');
  const failing = oc.items.filter((i) => i.state.state === 'bad');
  const waits = oc.needsKey.map((n) => n.outcome + ' waits for ' + n.missing).join('; ');
  return { ok: !failing.length, message: oc.items.length + ' outcomes: ' + live.length + ' live, ' + (oc.items.length - live.length) + ' on demo data' + (failing.length ? ', failing: ' + failing.map((i) => i.tab).join(', ') : '') + (waits ? '. ' + waits : ''), output: oc.items.map((i) => ({ id: i.id, status: i.status })) };
}

const stamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
async function snapshot() {
  invalidate();
  const { w } = await world();
  fs.mkdirSync(REPORTS, { recursive: true });
  const file = 'site-map-' + stamp() + '.md';
  fs.writeFileSync(path.join(REPORTS, file), O.snapshotMarkdown(w));
  return { ok: true, message: 'Snapshot saved to Reports: ' + O.statusOf(w).headline, output: { href: 'reports/' + file } };
}

async function testAll() {
  const ready = kit.connections().filter((c) => c.ready);
  if (!ready.length) return { ok: false, message: 'No connection has its keys yet: add them in Settings' };
  const out = [];
  for (const c of ready) { const r = await testConnection(c.id, getSettings()); kit.saveConnectionTest(c.id, r); out.push([c, r]); }
  invalidate();
  return { ok: out.every(([, r]) => r.ok), message: out.map(([c, r]) => c.name + ': ' + (r.ok ? 'connected' : 'failed')).join(' · '), output: out.map(([c, r]) => ({ id: c.id, ok: r.ok, message: r.message })) };
}

export async function run(id, input, ctx = {}) {
  await settled();
  invalidate();
  const allow = allowFor(ctx && ctx.user);
  try {
    if (RPA_ACTIONS.includes(id)) return rpa().run(id, ctx);
    const o = O.OUTCOMES.find((x) => x.action === id);
    if (o) return await runOutcome(o, allow);
    if (id === 'run-outcomes') return await runMine(allow);
    if (id === 'check-outcomes') return await checkOutcomes(allow);
    if (id === 'snapshot') return await snapshot();
    if (id === 'test-connections') return isAdmin(ctx) ? await testAll() : { ok: false, message: 'Only the admin can test connections.' };
    if (id === 'run' || id === 'run-monitor') {
      const { agent } = runtime();
      if (!agent.tasks.size) return { ok: false, message: NO_MONITORS };
      const mineKinds = new Set(O.OUTCOMES.filter((x) => x.kind && allow(x.id)).map((x) => x.kind));
      const tasks = [...agent.tasks.values()].filter((t) => mineKinds.has(t.kind));
      if (id === 'run') return tasks.length ? summarise(await Promise.all(tasks.map((t) => agent.runTask(t.id, 'manual')))) : { ok: false, message: NOT_YOURS };
      if (!isAdmin(ctx)) return { ok: false, message: 'Only the admin can run a single monitor.' };
      const want = String(input || '').trim();
      if (!want) return { ok: false, message: 'Enter a monitor id, e.g. ' + [...agent.tasks.keys()][0] };
      if (!agent.tasks.has(want)) return { ok: false, message: 'Unknown monitor "' + want.slice(0, 80) + '". Available: ' + [...agent.tasks.keys()].join(', ') };
      return summarise([await agent.runTask(want, 'manual')]);
    }
    return { ok: false, message: 'Unknown action' };
  } finally { invalidate(); }
}

const ADMIN_ONLY = 'Only the admin can change settings.';
async function apply(values) { const changed = saveSettings(values); if (changed.length) await onSettings(); return changed; }
const csvCell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

export async function pane(id, ctx = {}) {
  if (isRpaPane(id)) return rpa().pane(id, ctx);
  if (OUTCOME_DATA[id]) return OUTCOME_DATA[id]();
  if (!Object.values(PANE).includes(id)) return null;
  const { w } = await world();
  return O.metaPane(id, w, allowFor(ctx && ctx.user), { admin: isAdmin(ctx), me: ctx && ctx.user ? ctx.user.id : null }, O.paneStates(w));
}

export async function paneAction(id, action, input, ctx = {}) {
  await settled();
  invalidate();
  if (isRpaPane(id)) return rpa().act(id, action, input, ctx);
  const inp = input && typeof input === 'object' ? input : {};
  const allow = allowFor(ctx && ctx.user);
  const admin = isAdmin(ctx);
  const fresh = async (r) => { invalidate(); return { ...r, data: await pane(id, ctx) }; };
  const o = O.outcomeOf(id);
  if (o && o.kind && action === o.verb) return fresh(await run(o.action, null, ctx));
  if (id === 'documents' && action === 'set-folder') {
    if (!admin) return { ok: false, message: ADMIN_ONLY };
    const p = String(inp.path || '').trim();
    if (!p || !path.isAbsolute(p)) return { ok: false, message: 'Enter the full path of the folder, e.g. /Volumes/Projects/Incoming' };
    let st; try { st = fs.statSync(p); } catch { return { ok: false, message: 'That folder does not exist: ' + p.slice(0, 120) }; }
    if (!st.isDirectory()) return { ok: false, message: 'That path is a file, not a folder' };
    await apply({ watch_folder: p });
    return fresh({ ok: true, message: 'Now watching ' + p });
  }
  if (id === 'transfers' && action === 'set-direction') {
    if (!admin) return { ok: false, message: ADMIN_ONLY };
    const d = String(inp.direction || '');
    if (!['download', 'upload', 'both'].includes(d)) return { ok: false, message: 'Direction must be download, upload or both' };
    await apply({ ftp_direction: d });
    return fresh({ ok: true, message: 'Sync direction set to ' + d });
  }
  if (id === 'inbox' && (action === 'add-rule' || action === 'remove-rule')) {
    if (!admin) return { ok: false, message: ADMIN_ONLY };
    const name = String(inp.name || '').trim();
    if (!/^[\w][\w .-]{0,29}$/.test(name)) return { ok: false, message: 'Give the rule a short name (letters, numbers, spaces)' };
    const rules = parseRules(getSettings().imap_rules).filter((r) => r.name.toLowerCase() !== name.toLowerCase());
    if (action === 'add-rule') {
      const keyword = String(inp.keyword || '').trim().replace(/\s+/g, ' ');
      if (!keyword || keyword.length > 80) return { ok: false, message: 'Enter the subject keyword to match (up to 80 characters)' };
      rules.push({ name, subject: keyword });
    }
    await apply({ imap_rules: serialiseRules(rules) });
    return fresh({ ok: true, message: action === 'add-rule' ? 'Rule "' + name + '" saved' : 'Rule "' + name + '" removed' });
  }
  if (id === 'activity-log') {
    if (action === 'check') return fresh(await run('check-database', null, ctx));
    if (action === 'export') {
      const ev = activityEvents(runtime().store, {}, 5000);
      const csv = ['Time,Source,Result,What', ...ev.map((e) => [e.at, e.source, e.result, e.what].map(csvCell).join(','))].join('\n') + '\n';
      return { ok: true, message: 'Exported ' + ev.length + ' events', data: { ...(await activityData()), export: { filename: 'activity-record-' + stamp() + '.csv', csv } } };
    }
  }
  if (id === PANE.outcomes && action === 'check') return fresh(await checkOutcomes(allow));
  if (id === PANE.history) {
    const target = O.OUTCOMES.find((x) => x.kind && x.verb === action);
    if (target) return fresh(await runOutcome(target, allow));
    if (action === 'run-all') return fresh(await runMine(allow));
  }
  if (id === PANE.map && action === 'snapshot') return fresh(await snapshot());
  if (id === PANE.screens && action === 'check') {
    invalidate();
    const d = await pane(id, ctx);
    const empty = d.cards.filter((c) => c.data === 'Empty');
    return { ok: true, message: d.cards.length + ' screens checked: ' + d.summary.ready + ' with data' + (empty.length ? ', empty: ' + empty.map((c) => c.title).join(', ') : ''), data: d };
  }
  if (id === PANE.demo && action === 'auto') {
    if (!admin) return { ok: false, message: 'Only the admin can change the demo switch.' };
    kit.writeJSON('demo.json', { on: !liveKinds(), auto: true, at: new Date().toISOString() });
    kit.audit(ctx.user || null, 'Demo data set to follow the keys');
    return fresh({ ok: true, message: liveKinds() ? 'Live data on: screens without keys keep their demo records until the keys are saved' : 'No outcome is set up yet, so demo data stays on until a key is saved' });
  }
  if ((id === PANE.services || id === PANE.health) && (action === 'test' || action === 'test-all')) {
    if (!admin) return { ok: false, message: 'Only the admin can test connections.' };
    if (action === 'test-all') return fresh(await testAll());
    const cid = String(inp.id || '');
    if (cid === 'database') { const r = runtime().store.integrity(); return fresh({ ok: r.ok, message: r.ok ? 'Activity record database: integrity check passed' : 'Record problem: ' + r.problems[0] }); }
    const c = kit.connections().find((x) => x.id === cid);
    if (!c) return { ok: false, message: 'No such connection' };
    const r = c.ready ? await testConnection(c.id, getSettings()) : { ok: false, message: 'Missing: ' + c.missing.map(O.settingLabel).join(', ') };
    kit.saveConnectionTest(c.id, r);
    kit.audit(ctx.user || null, 'Tested ' + c.name + ': ' + (r.ok ? 'connected' : 'failed'));
    return fresh({ ok: r.ok, message: c.name + ': ' + r.message });
  }
  if (id === PANE.keys && (action === 'save-key' || action === 'clear-key')) {
    if (!admin) return { ok: false, message: 'Only the admin can change keys.' };
    const k = O.KEYS.find((x) => x.key === String(inp.key || ''));
    if (!k) return { ok: false, message: 'Pick one of the keys in the list' };
    if (action === 'clear-key') {
      const cur = kit.readJSON('settings.json', {});
      if (cur[k.key] === undefined || cur[k.key] === '') return { ok: false, message: k.label + ' is not saved in Settings' };
      delete cur[k.key]; kit.writeJSON('settings.json', cur);
      kit.audit(ctx.user || null, 'Cleared ' + k.label);
      await onSettings();
      return fresh({ ok: true, message: k.label + ' cleared' + (kit.settingSource(k.key) === 'env' ? '; the value in .env is used instead' : '') });
    }
    const value = String(inp.value ?? '').trim();
    if (!value) return { ok: false, message: 'Paste the ' + k.label.toLowerCase() + ' first' };
    if (value.length > 400) return { ok: false, message: 'That value is too long' };
    if (k.key === 'watch_folder') { let st; try { st = fs.statSync(value); } catch { return { ok: false, message: 'That folder does not exist: ' + value.slice(0, 120) }; } if (!st.isDirectory()) return { ok: false, message: 'That path is a file, not a folder' }; }
    saveSettings({ [k.key]: value });
    kit.audit(ctx.user || null, 'Changed settings: ' + k.key);
    await onSettings();
    const c = kit.connections().find((x) => x.id === k.conn);
    if (!c || !c.ready) return fresh({ ok: true, message: k.label + ' saved. Still missing for ' + k.service + ': ' + (c ? c.missing.map(O.settingLabel).join(', ') : '') });
    const r = await testConnection(c.id, getSettings());
    kit.saveConnectionTest(c.id, r);
    return fresh({ ok: r.ok, message: k.label + ' saved. ' + (r.ok ? 'Test passed: ' : 'Test failed: ') + r.message });
  }
  return { ok: false, message: 'Unknown action' };
}

// ---------- connections ----------
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms).unref())]);
const errText = (e) => String((e && e.message) || e).slice(0, 200);

async function probe(id, s) {
  const t0 = Date.now();
  if (id === 'rpa-agent') return probeAgent(s);
  if (id === 'folders') {
    const p = String(s.watch_folder || '');
    if (!p) return { ok: false, message: 'No folder set' };
    try { const st = fs.statSync(p); if (!st.isDirectory()) return { ok: false, message: p + ' is a file, not a folder' }; fs.accessSync(p, fs.constants.R_OK); return { ok: true, message: 'Folder readable: ' + fs.readdirSync(p).length + ' item(s) in ' + p }; }
    catch (e) { return { ok: false, message: 'Cannot read ' + p + ': ' + errText(e) }; }
  }
  if (id === 'ftp') {
    const c = new FtpClient({ host: String(s.ftp_host), port: num(s.ftp_port, 21), user: String(s.ftp_user), password: String(s.ftp_password), secure: s.ftp_secure === 'implicit' ? 'implicit' : s.ftp_secure === 'explicit' ? 'explicit' : false, timeoutMs: 8000 });
    try {
      await withTimeout(c.connect(), 10000, 'FTP connect');
      const dir = String(s.ftp_remote_dir || '/');
      const list = await withTimeout(c.list(dir), 10000, 'FTP listing');
      return { ok: true, message: 'Logged in to ' + s.ftp_host + ' in ' + (Date.now() - t0) + ' ms; ' + (Array.isArray(list) ? list.length : 0) + ' item(s) in ' + dir };
    } catch (e) { return { ok: false, message: 'FTP: ' + errText(e) }; }
    finally { await c.close().catch(() => {}); }
  }
  if (id === 'imap') {
    const secure = s.imap_secure === undefined ? true : truthy(s.imap_secure);
    const c = new ImapClient({ host: String(s.imap_host), port: num(s.imap_port, secure ? 993 : 143), user: String(s.imap_user), password: String(s.imap_password), secure, mailbox: String(s.imap_mailbox || 'INBOX'), timeoutMs: 8000 });
    try {
      await withTimeout(c.connect(), 12000, 'IMAP connect');
      await withTimeout(c.select(), 10000, 'IMAP select');
      return { ok: true, message: 'Signed in to ' + s.imap_host + ' in ' + (Date.now() - t0) + ' ms; opened ' + (s.imap_mailbox || 'INBOX') };
    } catch (e) { return { ok: false, message: 'IMAP: ' + errText(e) }; }
    finally { await c.logout().catch(() => {}); }
  }
  return null;
}

/** A real sign-in to the service with the given settings; the latency is kept for Connection health. */
export async function testConnection(id, settings = getSettings()) {
  const t0 = Date.now();
  const r = await probe(id, settings || getSettings());
  if (!r) return { ok: false, message: 'Unknown connection' };
  kit.appendLine('latency.jsonl', { at: new Date().toISOString(), id, ms: Date.now() - t0, ok: r.ok });
  invalidate();
  return r;
}

// ---------- reports ----------
// Reports are shared with every signed-in user, so they carry the overall state only (counts); per-outcome records
// stay in each outcome's own tab, where access is checked. The CSV export of the record is a download from its tab.
const LEGACY = ['task-history.md', 'sync-performance.md', 'activity-record.csv'];
let lastOverall = 0;
export async function reports() {
  fs.mkdirSync(REPORTS, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const overall = 'overall-state-' + day + '.md';
  if (Date.now() - lastOverall > 600000 || !fs.existsSync(path.join(REPORTS, overall))) {
    const { w } = await world();
    fs.writeFileSync(path.join(REPORTS, overall), O.snapshotMarkdown(w, 'Overall state, ' + day));
    lastOverall = Date.now();
  }
  return fs.readdirSync(REPORTS).filter((f) => /^(overall-state|site-map)-[\w-]+\.md$/.test(f))
    .map((f) => ({ f, at: fs.statSync(path.join(REPORTS, f)).mtime.toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30)
    .map(({ f, at }) => ({ title: f.startsWith('site-map') ? 'Site map snapshot, ' + f.slice(9, 19) + ' ' + f.slice(20, 25).replace('-', ':') : 'Overall state, ' + f.slice(14, 24), href: 'reports/' + f, createdAt: at }));
}

// The server only imports this module, so the loop must start at import: monitors run from boot, not the first page view.
try {
  await init();
  syncDemo(false); trackKeys();
  // new log rows after the cursor, a batch at a time (rpa-live pumpTriggers moves the cursor row by row)
  startScheduler((since, limit) => {
    try {
      const { store } = runtime();
      const max = Number(store.db.prepare('SELECT MAX(id) AS m FROM sync_log').get().m || 0);
      if (since == null) return { rows: [], max };
      return { rows: store.db.prepare('SELECT * FROM sync_log WHERE id > ? ORDER BY id LIMIT ?').all(since, Math.max(1, limit || 200)).map(parseRow), max };
    } catch { return null; }
  });
  for (const f of LEGACY) fs.rmSync(path.join(REPORTS, f), { force: true });   // older builds wrote per-outcome detail into shared Reports
} catch (e) { console.error('dashboard init failed: ' + e.message); }
