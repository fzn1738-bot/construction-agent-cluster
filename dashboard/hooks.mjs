// The solution's dashboard logic, backed by the agent's SQLite state.
//   status() / metrics() / panels() / reports() / run(id) / pane(id) / paneAction(id, action, input, ctx)
//   paneStatus() / testConnection(id, settings) / onSettings(settings)
// What the client gets (one dashboard tab each): Site documents (watched folder), Contractor file transfers (FTP),
// Project inbox (IMAP triage) and the Activity record (SQLite). Folder, FTP and mailbox details are Settings
// (read with getSettings(), never from the environment directly); agent.config.json (AGENT_CONFIG) is still read
// and merged for monitors defined there. Database: AGENT_DB (default dashboard/data/agent.db).
// init() runs at import, so with monitors configured the continuous loop runs from boot. Saving Settings rebuilds
// the monitors (onSettings), so a newly entered key goes live without a restart.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '../src/agent-core.mjs';
import { openStore } from '../src/sqlite-utils.mjs';
import { buildMonitors } from '../src/monitors.mjs';
import { FtpClient } from '../src/ftp-client.mjs';
import { ImapClient } from '../src/email-client.mjs';
import { getSettings, saveSettings } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DATA = process.env.HQ_APP_DATA || path.join(HERE, 'data');
const REPORTS = path.join(DATA, 'reports');
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'dashboard.json'), 'utf8'));
const SPEC_PANELS = SPEC.panels.map((p) => p.title);
const PANE_OF_PANEL = Object.fromEntries(SPEC.panes.flatMap((p) => p.panels.map((t) => [t, p.id])));

// Actions come from dashboard.json (the layout spec); each is attached to the pane that lists it.
export const actions = SPEC.actions.map((a) => {
  const pane = SPEC.panes.find((p) => (p.actions || []).includes(a.id));
  return { id: a.id, label: a.label, description: a.description || '', input: a.input || null, pane: pane ? pane.id : 'overview', ...(a.adminOnly ? { adminOnly: true } : {}) };
});
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const cfg = () => { const s = getSettings(); return { staleMs: num(s.staleAfterMin, 30) * 60000, rows: Math.min(100, Math.round(num(s.recentRows, 12))), target: num(s.successTarget, 90) }; };
const truthy = (v) => v === true || v === 'true' || v === 'on' || v === 1 || v === '1';

// ---------- monitors from Settings ----------
export function parseRules(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
    const i = l.indexOf(':');
    const name = (i > 0 ? l.slice(0, i) : l).trim(); const subject = (i > 0 ? l.slice(i + 1) : l).trim();
    return { name: name.slice(0, 30) || 'rule', subject, action: 'log' };
  }).filter((r) => r.subject);
}
const serialiseRules = (rules) => rules.map((r) => r.name + ': ' + r.subject).join('\n');

/** The agent config: agent.config.json plus the monitors described by Settings (a name already in the file wins). */
export function configFromSettings(file = {}, s = getSettings()) {
  const cfgOut = { ...file, folders: [...(file.folders || [])], ftp: [...(file.ftp || [])], imap: [...(file.imap || [])] };
  const has = (list, name) => list.some((m) => m.name === name);
  if (s.watch_folder && !has(cfgOut.folders, 'site')) cfgOut.folders.push({ name: 'site', path: String(s.watch_folder), intervalMs: 2000, settleMs: 1000, recursive: true });
  if (s.ftp_host && s.ftp_user && s.ftp_password && !has(cfgOut.ftp, 'site')) {
    cfgOut.ftp.push({
      name: 'site', host: String(s.ftp_host), port: num(s.ftp_port, 21), user: String(s.ftp_user), password: String(s.ftp_password),
      secure: s.ftp_secure === 'implicit' ? 'implicit' : s.ftp_secure === 'explicit' ? 'explicit' : false,
      remoteDir: String(s.ftp_remote_dir || '/'), localDir: String(s.ftp_local_dir || path.join(DATA, 'sync', 'site')),
      direction: ['download', 'upload', 'both'].includes(s.ftp_direction) ? s.ftp_direction : 'download', intervalMs: 300000
    });
  }
  if (s.imap_host && s.imap_user && s.imap_password && !has(cfgOut.imap, 'pm')) {
    cfgOut.imap.push({
      name: 'pm', host: String(s.imap_host), port: num(s.imap_port, 993), user: String(s.imap_user), password: String(s.imap_password),
      secure: s.imap_secure === undefined ? true : truthy(s.imap_secure), mailbox: String(s.imap_mailbox || 'INBOX'), intervalMs: 60000, rules: parseRules(s.imap_rules)
    });
  }
  return cfgOut;
}

let rt = null; let signalsHooked = false;
function runtime() {
  if (rt) return rt;
  fs.mkdirSync(DATA, { recursive: true });
  const store = openStore(process.env.AGENT_DB || path.join(DATA, 'agent.db'));
  const cfgFile = process.env.AGENT_CONFIG || path.join(ROOT, 'agent.config.json');
  let file = {}; let configError = null;
  try { if (fs.existsSync(cfgFile)) file = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { configError = 'agent.config.json: ' + e.message; }
  const config = configFromSettings(file);
  const agent = new Agent({ store, tickMs: config.tickMs || 250 });
  const monitors = new Map();
  try { for (const m of buildMonitors(config, store)) { agent.addMonitor(m); monitors.set(m.id, m); } } catch (e) { configError = e.message; }
  agent.on('log', (l) => { if (l.level === 'error') store.log('system', 'error', { message: l.message }); });
  rt = { store, agent, monitors, configError };
  if (agent.tasks.size && process.env.AGENT_AUTOSTART !== '0') agent.start().catch((e) => { rt.configError = e.message; });
  if (!signalsHooked) { signalsHooked = true; for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => shutdown().finally(() => process.exit(0))); }
  return rt;
}

/**
 * Stop the loop (waiting up to the grace period for in-flight work) and close the database. If work outlasted the
 * grace period the database is closed only once that work has finished, so it can still record its result.
 */
export async function shutdown() {
  if (!rt) return { forced: false };
  const { agent, store } = rt; rt = null;
  const { forced } = await agent.stop();
  const closed = agent.idle().then(() => store.close());
  if (!forced) await closed;
  return { forced, closed };
}

/** Called once when the server starts: opens the store and starts the loop. */
export async function init() {
  const { agent, configError } = runtime();
  return { tasks: agent.tasks.size, running: agent.running, configError };
}

/** After the admin saves Settings the monitors are rebuilt, so new keys are used straight away. */
export async function onSettings() { await shutdown(); await init(); }

// ---------- helpers ----------
const rel = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago';
};
const TASK_TYPES = ['task', 'folder', 'ftp', 'imap'];
const MON_KIND = { folder: 'Folder', ftp: 'FTP', imap: 'Email' };
const KIND_OF_PANE = { documents: 'folder', transfers: 'ftp', inbox: 'imap' };
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
export function hourly(rows, now = Date.now()) {
  const values = new Array(24).fill(0);
  for (const r of rows) { const age = Math.floor((now - Date.parse(r.timestamp)) / 3600000); if (age >= 0 && age < 24) values[23 - age]++; }
  return { labels: values.map((_, i) => (i === 23 ? 'now' : '-' + (23 - i) + 'h')), values };
}
const line = (title, name, b, pane) => ({ title, kind: 'line', labels: b.labels, series: [{ name, values: b.values }], pane });
const tally = (items) => { const m = new Map(); for (const i of items) m.set(i, (m.get(i) || 0) + 1); return m; };
const baseName = (p) => (p ? path.basename(String(p)) : '');

function kindState(kind) {
  const { agent } = runtime();
  const tasks = agent.snapshot().tasks.filter((t) => t.kind === kind);
  return { tasks, configured: tasks.length > 0, failed: tasks.filter((t) => t.state && t.state.status === 'failed'), stale: staleIds(tasks), running: tasks.some((t) => t.inflight), last: tasks.map(lastRun).filter(Boolean).sort().pop() || null };
}
const NEEDS = { documents: 'Add the site folder in Connections', transfers: 'Add the FTP login in Connections', inbox: 'Add the mailbox login in Connections' };

// ---------- status, metrics, panels ----------
export async function status() {
  const { store, agent, configError } = runtime();
  const lowRate = () => { const r = taskRuns(store, 50); if (r.length < 5) return 0; const p = Math.round((r.filter((x) => x.status === 'ok').length / r.length) * 100); return p < cfg().target ? p : 0; };
  const snap = agent.snapshot();
  const tasks = snap.tasks;
  const failing = tasks.filter((t) => t.state && t.state.status === 'failed');
  const integ = store.integrity();
  const count = (kind) => tasks.filter((t) => t.kind === kind).length;
  const ring = [
    { label: 'Polling Folders', value: count('folder') },
    { label: 'FTP Transfers', value: count1(store, FTP_TRANSFERS) },
    { label: 'Emails Processed', value: count1(store, EMAILS_PROCESSED) }
  ];
  let mood = 'ok', headline = 'Healthy', detail = tasks.length + ' task(s) scheduled' + (snap.running ? ', loop running' : '');
  if (!integ.ok) { mood = 'bad'; headline = 'Database problem'; detail = integ.problems[0]; }
  else if (configError) { mood = 'bad'; headline = 'Config error'; detail = configError; }
  else if (failing.length) { mood = 'bad'; headline = 'Failing'; detail = failing.map((t) => t.id).join(', ') + ' failed: ' + String(failing[0].state.details.error || '').slice(0, 120); }
  else if (!tasks.length) { mood = 'wait'; headline = 'Idle'; detail = 'No monitors configured. Add the site folder, FTP or mailbox login in Connections.'; }
  else if (!snap.running) { mood = 'wait'; headline = 'Stopped'; detail = 'The loop is not running'; }
  else if (staleIds(tasks).length) { mood = 'wait'; headline = 'Stale'; detail = staleIds(tasks).join(', ') + ' has not run for over ' + Math.round(cfg().staleMs / 60000) + ' min'; }
  else if (lowRate()) { mood = 'wait'; headline = 'Below target'; detail = 'Sync rate ' + lowRate() + '% is under the ' + cfg().target + '% target'; }
  else if (snap.active) { mood = 'run'; headline = 'Working'; detail = snap.active + ' task(s) running now'; }
  return { mood, headline, detail, primary: { label: 'Active Tasks', value: String(snap.active) }, ring };
}

/** One state per client-facing tab, for the Overview centrepiece. Reads local state only (polled often). */
export async function paneStatus() {
  const { store } = runtime();
  const out = {};
  const word = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const monitored = (pane, text) => {
    const k = kindState(KIND_OF_PANE[pane]);
    if (!k.configured) return { state: 'idle', text: NEEDS[pane] };
    if (k.failed.length) return { state: 'bad', text: k.failed.map((t) => t.id).join(', ') + ' failed' };
    if (k.stale.length) return { state: 'warn', text: 'Not run for over ' + Math.round(cfg().staleMs / 60000) + ' min' };
    return { state: 'ok', text: k.running ? 'Working now' : text() };
  };
  out.documents = monitored('documents', () => word(count1(store, DOCS_FILED), 'document', 'documents') + ' filed');
  out.transfers = monitored('transfers', () => word(count1(store, FTP_TRANSFERS), 'file', 'files') + ' transferred');
  out.inbox = monitored('inbox', () => word(count1(store, EMAILS_PROCESSED), 'email', 'emails') + ' triaged');
  const integ = store.integrity();
  out['activity-log'] = integ.ok ? { state: 'ok', text: word(Number(store.db.prepare('SELECT COUNT(*) AS n FROM sync_log').get().n), 'event', 'events') + ' on record' } : { state: 'bad', text: 'Record problem: ' + integ.problems[0] };
  return out;
}

export async function metrics() {
  const { store, agent } = runtime();
  const runs = taskRuns(store, 200);
  const ok = runs.filter((r) => r.status === 'ok').length;
  const buckets = []; const chrono = runs.slice().reverse();
  for (let i = 0; i < chrono.length; i += 10) { const b = chrono.slice(i, i + 10); buckets.push(Math.round((b.filter((r) => r.status === 'ok').length / b.length) * 100)); }
  const snap = agent.snapshot();
  const ms = runs.map((r) => Number(r.details.ms)).filter(Number.isFinite);
  const queueOf = (kind) => monitorRows(runtime()).reduce((n, r, i) => n + (snap.tasks[i].kind === kind ? r[3] : 0), 0);
  const integ = store.integrity();
  const rows = Number(store.db.prepare('SELECT COUNT(*) AS n FROM sync_log').get().n);
  const sync = runs.length ? Math.round((ok / runs.length) * 100) : 100;
  const ftpT = count1(store, FTP_TRANSFERS), mail = count1(store, EMAILS_PROCESSED), docs = count1(store, DOCS_FILED);
  const ftpFailed = count1(store, "type = 'ftp' AND status = 'failed'");
  const fq = queueOf('folder'), eb = queueOf('imap');
  const trend = (type, where) => hourly(store.db.prepare('SELECT timestamp FROM sync_log WHERE ' + where + ' ORDER BY timestamp DESC LIMIT 1000').all()).values;
  return [
    { key: 'activeTasks', label: 'Active tasks', value: snap.active, unit: '', trend: [snap.active], good: 'down', pane: 'overview' },
    { key: 'syncRate', label: 'Sync rate', value: sync, unit: '%', trend: buckets.length ? buckets.slice(-14) : [100], good: 'up', pane: 'overview' },
    { key: 'avgRunMs', label: 'Avg run time', value: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0, unit: 'ms', trend: ms.length ? ms.slice(0, 14).reverse() : [0], good: 'down', pane: 'overview' },
    { key: 'docsFiled', label: 'Documents filed', value: docs, unit: '', trend: trend('folder', DOCS_FILED), good: 'up', pane: 'documents' },
    { key: 'docsWaiting', label: 'Files waiting', value: fq, unit: '', trend: [fq], good: 'down', pane: 'documents' },
    { key: 'ftpTransfers', label: 'Files transferred', value: ftpT, unit: '', trend: trend('ftp', FTP_TRANSFERS), good: 'up', pane: 'transfers' },
    { key: 'ftpFailed', label: 'Transfer failures', value: ftpFailed, unit: '', trend: trend('ftp', "type = 'ftp' AND status = 'failed'"), good: 'down', pane: 'transfers' },
    { key: 'emailsProcessed', label: 'Emails triaged', value: mail, unit: '', trend: trend('imap', EMAILS_PROCESSED), good: 'up', pane: 'inbox' },
    { key: 'emailBacklog', label: 'Inbox backlog', value: eb, unit: '', trend: [eb], good: 'down', pane: 'inbox' },
    { key: 'logRows', label: 'Events on record', value: rows, unit: '', trend: trend('all', '1 = 1'), good: 'up', pane: 'activity-log' },
    { key: 'dbIntegrity', label: 'Record integrity', value: integ.ok ? 100 : 0, unit: '%', trend: [integ.ok ? 100 : 0], good: 'up', pane: 'activity-log' }
  ];
}

const WARN = new Set(['skipped', 'malformed', 'interrupted', 'reset', 'stopped-forced', 'recovered']);
const level = (st) => (st === 'failed' || st === 'error' ? 'error' : WARN.has(st) ? 'warn' : 'info');
const EVENT_WORD = { added: 'Filed', modified: 'Updated', removed: 'Removed', renamed: 'Renamed', detected: 'Detected' };

/** One row per monitor: name, state chip, last run, queue depth. */
export function monitorTable() { return { title: 'Monitors', kind: 'table', columns: ['Monitor', 'State', 'Last run', 'Queue'], rows: monitorRows(runtime()), pane: 'overview' }; }

const describe = (l) => {
  const d = l.details;
  return (d.task || d.monitor || l.type) + ': ' + (d.event || d.op || d.error || d.note || d.message || l.status)
    + (d.path ? ' ' + baseName(d.path) : d.file ? ' ' + d.file : d.subject ? ' ' + d.subject : '');
};

// ---------- the four tabs' records ----------
function documentsData() {
  const { store } = runtime();
  const k = kindState('folder'); const s = getSettings();
  const events = logsOf(store, 'folder').filter((l) => l.details.event && l.details.event !== 'detected');
  const arrivals = events.map((l) => ({ file: baseName(l.details.path || l.details.to), folder: l.details.monitor || '', event: l.status === 'failed' ? 'Failed' : EVENT_WORD[l.details.event] || l.details.event, status: l.status, at: l.timestamp, size: l.details.size ?? null, error: l.details.error || null }));
  const queue = monitorRows(runtime()).filter((r) => r[0].startsWith('Folder')).reduce((n, r) => n + r[3], 0);
  return {
    source: 'live', configured: k.configured, needs: k.configured ? null : NEEDS.documents, folder: s.watch_folder || null,
    monitors: monitorRows(runtime()).filter((r) => r[0].startsWith('Folder')).map((r) => ({ name: r[0], state: r[1].text, tone: r[1].tone, last: r[2], queue: r[3] })),
    summary: { filed: count1(store, DOCS_FILED), waiting: queue, last: k.last },
    arrivals: arrivals.slice(0, 200), hours: hourly(events.map((l) => ({ timestamp: l.timestamp }))), canEdit: true
  };
}
function transfersData() {
  const { store } = runtime();
  const k = kindState('ftp'); const s = getSettings();
  const items = logsOf(store, 'ftp').filter((l) => l.details.op);
  const transfers = items.map((l) => ({ file: l.details.file || '—', op: l.details.op, status: l.status, bytes: l.details.bytes ?? null, monitor: l.details.monitor || '', at: l.timestamp, reason: l.details.reason || null, error: l.details.error || null }));
  return {
    source: 'live', configured: k.configured, needs: k.configured ? null : NEEDS.transfers, host: s.ftp_host || null, remoteDir: s.ftp_remote_dir || '/', direction: s.ftp_direction || 'download',
    monitors: monitorRows(runtime()).filter((r) => r[0].startsWith('FTP')).map((r) => ({ name: r[0], state: r[1].text, tone: r[1].tone, last: r[2], queue: r[3] })),
    summary: { transferred: count1(store, FTP_TRANSFERS), failed: count1(store, "type = 'ftp' AND status = 'failed'"), skipped: count1(store, "type = 'ftp' AND status = 'skipped'"), last: k.last },
    transfers: transfers.slice(0, 200), hours: hourly(items.filter((l) => l.status === 'ok' && ['download', 'upload'].includes(l.details.op))), canEdit: true
  };
}
const RESULT = { ok: 'Matched', ignored: 'No rule matched', malformed: 'Unreadable', failed: 'Failed' };
function inboxData() {
  const { store } = runtime();
  const k = kindState('imap'); const s = getSettings();
  const items = logsOf(store, 'imap').filter((l) => l.details.uid != null);
  const messages = items.map((l) => ({ uid: l.details.uid, from: l.details.from || '', subject: l.details.subject || '(no subject)', result: RESULT[l.status] || l.status, status: l.status, rule: l.details.rule || null, at: l.timestamp }));
  const byRule = tally(items.map((l) => (l.status === 'ok' ? l.details.rule || 'rule' : l.status === 'ignored' ? 'No rule' : null)).filter(Boolean));
  return {
    source: 'live', configured: k.configured, needs: k.configured ? null : NEEDS.inbox, mailbox: s.imap_mailbox || 'INBOX', host: s.imap_host || null, rules: parseRules(s.imap_rules),
    monitors: monitorRows(runtime()).filter((r) => r[0].startsWith('Email')).map((r) => ({ name: r[0], state: r[1].text, tone: r[1].tone, last: r[2], queue: r[3] })),
    summary: { triaged: count1(store, EMAILS_PROCESSED), backlog: monitorRows(runtime()).filter((r) => r[0].startsWith('Email')).reduce((n, r) => n + r[3], 0), ignored: count1(store, "type = 'imap' AND status = 'ignored'"), last: k.last },
    messages: messages.slice(0, 200), byRule: { labels: [...byRule.keys()], values: [...byRule.values()] }, canEdit: true
  };
}
export const ACTIVITY_TYPES = ['all', 'folder', 'ftp', 'imap', 'task', 'system'];
export const ACTIVITY_RESULTS = ['all', 'ok', 'failed', 'other'];
function activityEvents(store, { type = 'all', result = 'all' } = {}, limit = 100) {
  const where = []; const args = [];
  if (type !== 'all' && ACTIVITY_TYPES.includes(type)) { where.push('type = ?'); args.push(type); }
  if (result === 'ok') where.push("status = 'ok'"); else if (result === 'failed') where.push("status IN ('failed','error')"); else if (result === 'other') where.push("status NOT IN ('ok','failed','error')");
  return store.db.prepare('SELECT * FROM sync_log' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY timestamp DESC, id DESC LIMIT ?').all(...args, limit).map(parseRow)
    .map((l) => ({ source: l.type, result: l.status, level: level(l.status), what: describe(l), at: l.timestamp }));
}
function activityData(filter = {}) {
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
const stateTables = (store) => store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map((t) => [t.name, Number(store.db.prepare('SELECT COUNT(*) AS n FROM "' + t.name.replace(/"/g, '') + '"').get().n)]);

export async function pane(id) {
  if (id === 'documents') return documentsData();
  if (id === 'transfers') return transfersData();
  if (id === 'inbox') return inboxData();
  if (id === 'activity-log') return activityData();
  return null;
}

export async function panels() {
  const { store } = runtime();
  const n = cfg().rows;
  const runs = taskRuns(store, 300);
  const docs = documentsData(), tr = transfersData(), inb = inboxData(), act = activityData();
  const all = {
    'Runs, last 24 hours': () => line('Runs, last 24 hours', 'Runs', hourly(runs), 'overview'),
    Monitors: monitorTable,
    'Arrivals, last 24 hours': () => line('Arrivals, last 24 hours', 'Files', docs.hours, 'documents'),
    'Recent arrivals': () => ({ title: 'Recent arrivals', kind: 'table', columns: ['File', 'Folder', 'Event', 'When'], rows: docs.arrivals.slice(0, n).map((a) => [a.file, a.folder, a.event, rel(a.at)]) }),
    'Transfers, last 24 hours': () => line('Transfers, last 24 hours', 'Transfers', tr.hours, 'transfers'),
    'Transfer history': () => ({ title: 'Transfer history', kind: 'table', columns: ['File', 'Direction', 'Result', 'When'], rows: tr.transfers.slice(0, n).map((t) => [t.file, t.op, t.status === 'ok' ? 'OK' : t.status === 'failed' ? 'Failed: ' + String(t.error || '').slice(0, 80) : 'Skipped', rel(t.at)]) }),
    'Triage by rule': () => ({ title: 'Triage by rule', kind: 'bar', labels: inb.byRule.labels, series: [{ name: 'Messages', values: inb.byRule.values }] }),
    'Recent messages': () => ({ title: 'Recent messages', kind: 'table', columns: ['From', 'Subject', 'Result', 'When'], rows: inb.messages.slice(0, n).map((m) => [m.from, m.subject, m.result + (m.rule ? ': ' + m.rule : ''), rel(m.at)]) }),
    'Events by source': () => ({ title: 'Events by source', kind: 'bar', labels: act.byType.labels, series: [{ name: 'Events', values: act.byType.values }] }),
    'Latest events': () => ({ title: 'Latest events', kind: 'table', columns: ['Source', 'Result', 'What', 'When'], rows: act.events.slice(0, n).map((e) => [e.source, e.result, e.what, rel(e.at)]) })
  };
  return SPEC_PANELS.filter((t) => all[t]).map((t) => ({ pane: PANE_OF_PANEL[t] || 'overview', ...all[t]() }));
}

// ---------- actions ----------
const summarise = (results) => {
  const failed = results.filter((r) => r.status !== 'ok');
  return { ok: failed.length === 0, message: results.length + ' task(s) run, ' + failed.length + ' failed' + (failed.length ? ': ' + failed.map((f) => f.id + ' (' + f.error + ')').join('; ').slice(0, 300) : ''), output: results.map(({ id: i, status, attempts }) => ({ id: i, status, attempts })) };
};
const NO_MONITORS = 'No monitors configured: add the site folder, FTP or mailbox login in Connections';
const KIND_ACTIONS = { 'scan-folders': ['folder', 'folder'], 'sync-ftp': ['ftp', 'FTP'], 'check-inbox': ['imap', 'email'] };

export async function run(id, input) {
  if (id === 'check-database') {
    const { store } = runtime(); const r = store.integrity();
    return { ok: r.ok, message: r.ok ? 'Record integrity check passed' : 'Record problem: ' + r.problems.slice(0, 3).join('; '), output: { tables: stateTables(store) } };
  }
  if (id !== 'run' && !KIND_ACTIONS[id] && id !== 'run-monitor') return { ok: false, message: 'Unknown action' };
  const { agent } = runtime();
  if (id === 'run' || id === 'run-monitor') {
    if (!agent.tasks.size) return { ok: false, message: NO_MONITORS };
    if (id === 'run') return summarise(await agent.runAll('manual'));
    const want = String(input || '').trim();
    if (!want) return { ok: false, message: 'Enter a monitor id, e.g. ' + [...agent.tasks.keys()][0] };
    if (!agent.tasks.has(want)) return { ok: false, message: 'Unknown monitor "' + want.slice(0, 80) + '". Available: ' + [...agent.tasks.keys()].join(', ') };
    return summarise([await agent.runTask(want, 'manual')]);
  }
  const [kind, name] = KIND_ACTIONS[id];
  const ids = [...agent.tasks.values()].filter((t) => t.kind === kind).map((t) => t.id);
  if (!ids.length) return { ok: false, message: 'No ' + name + ' monitors configured: add them in Connections' };
  return summarise(await Promise.all(ids.map((i) => agent.runTask(i, 'manual'))));
}

const isAdmin = (ctx) => ctx && ctx.user && ctx.user.role === 'admin';
const ADMIN_ONLY = 'Only the admin can change settings.';
async function apply(values) { const changed = saveSettings(values); if (changed.length) await onSettings(); return changed; }
const KIND_RUN = { documents: 'scan-folders', transfers: 'sync-ftp', inbox: 'check-inbox' };

export async function paneAction(id, action, input, ctx = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const fresh = async (r) => ({ ...r, data: await pane(id) });
  if (KIND_RUN[id] && ['scan', 'sync', 'check'].includes(action)) return fresh(await run(KIND_RUN[id]));
  if (id === 'documents' && action === 'set-folder') {
    if (!isAdmin(ctx)) return { ok: false, message: ADMIN_ONLY };
    const p = String(inp.path || '').trim();
    if (!p || !path.isAbsolute(p)) return { ok: false, message: 'Enter the full path of the folder, e.g. /Volumes/Projects/Incoming' };
    let st; try { st = fs.statSync(p); } catch { return { ok: false, message: 'That folder does not exist: ' + p.slice(0, 120) }; }
    if (!st.isDirectory()) return { ok: false, message: 'That path is a file, not a folder' };
    await apply({ watch_folder: p });
    return fresh({ ok: true, message: 'Now watching ' + p });
  }
  if (id === 'transfers' && action === 'set-direction') {
    if (!isAdmin(ctx)) return { ok: false, message: ADMIN_ONLY };
    const d = String(inp.direction || '');
    if (!['download', 'upload', 'both'].includes(d)) return { ok: false, message: 'Direction must be download, upload or both' };
    await apply({ ftp_direction: d });
    return fresh({ ok: true, message: 'Sync direction set to ' + d });
  }
  if (id === 'inbox' && (action === 'add-rule' || action === 'remove-rule')) {
    if (!isAdmin(ctx)) return { ok: false, message: ADMIN_ONLY };
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
    if (action === 'export') {
      const files = await reports();
      const csv = files.find((f) => f.href.endsWith('.csv'));
      return { ok: true, message: 'Exported ' + activityEvents(runtime().store, {}, 5000).length + ' events', data: { ...activityData(), href: csv.href } };
    }
    if (action === 'check') return fresh(await run('check-database'));
  }
  return { ok: false, message: 'Unknown action' };
}

// ---------- connections ----------
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(what + ' timed out')), ms).unref())]);
const errText = (e) => String((e && e.message) || e).slice(0, 200);

export async function testConnection(id, settings = getSettings()) {
  const s = settings;
  const t0 = Date.now();
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
  return { ok: false, message: 'Unknown connection' };
}

// ---------- reports ----------
const csvCell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';

export async function reports() {
  const { store, agent } = runtime();
  fs.mkdirSync(REPORTS, { recursive: true });
  const now = new Date().toISOString();
  const runs = taskRuns(store, 100);
  const history = ['# Task History', 'Generated ' + now, '', ...agent.snapshot().tasks.map((t) => '- ' + t.id + ': ' + (t.state ? t.state.status + ' at ' + t.state.timestamp : 'never run')), '', '## Recent runs', ...runs.slice(0, 50).map((r) => r.timestamp + '  ' + r.details.task + '  ' + r.status + (r.details.error ? '  ' + r.details.error : ''))].join('\n');
  const perType = TASK_TYPES.map((t) => { const rs = runs.filter((r) => r.type === t); return rs.length ? '- ' + t + ': ' + rs.filter((r) => r.status === 'ok').length + '/' + rs.length + ' ok' : null; }).filter(Boolean);
  const ok = runs.filter((r) => r.status === 'ok').length;
  const perf = ['# Sync Performance', 'Generated ' + now, '', 'Sync rate: ' + (runs.length ? Math.round((ok / runs.length) * 100) + '% (' + ok + '/' + runs.length + ' of the last runs)' : 'no runs yet'), '', ...perType].join('\n');
  const csv = ['Time,Source,Result,What', ...activityEvents(store, {}, 5000).map((e) => [e.at, e.source, e.result, e.what].map(csvCell).join(','))].join('\n');
  fs.writeFileSync(path.join(REPORTS, 'task-history.md'), history + '\n');
  fs.writeFileSync(path.join(REPORTS, 'sync-performance.md'), perf + '\n');
  fs.writeFileSync(path.join(REPORTS, 'activity-record.csv'), csv + '\n');
  return [{ title: 'Task History', href: 'reports/task-history.md', createdAt: now }, { title: 'Sync Performance', href: 'reports/sync-performance.md', createdAt: now }, { title: 'Activity record (CSV)', href: 'reports/activity-record.csv', createdAt: now }];
}

// The server only imports this module, so the loop must start at import: monitors run from boot, not the first page view.
try { await init(); } catch (e) { console.error('dashboard init failed: ' + e.message); }
