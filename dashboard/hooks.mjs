// The solution's dashboard logic, backed by the agent's SQLite state.
//   status()   -> { mood, headline, detail, primary, ring }     metrics() / panels() / reports() / run(id)
// Config: AGENT_CONFIG (default ./agent.config.json, optional). Database: AGENT_DB (default dashboard/data/agent.db).
// init() is called by server.mjs at startup, so with monitors configured the continuous loop runs inside the dashboard
// process from boot, not from the first page view. Without monitors, Run Now fails and says what to configure.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Agent } from '../src/agent-core.mjs';
import { openStore } from '../src/sqlite-utils.mjs';
import { buildMonitors } from '../src/monitors.mjs';
import { getSettings } from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DATA = path.join(HERE, 'data');
const REPORTS = path.join(DATA, 'reports');
// dashboard.json is the layout spec: panels() returns exactly the panels it lists, in its order.
const SPEC_PANELS = JSON.parse(fs.readFileSync(path.join(HERE, 'dashboard.json'), 'utf8')).panels.map((p) => p.title);

const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'dashboard.json'), 'utf8'));
// Actions come from dashboard.json (the layout spec); each is attached to the pane that lists it.
export const actions = SPEC.actions.map((a) => {
  const pane = SPEC.panes.find((p) => (p.actions || []).includes(a.id));
  return { id: a.id, label: a.label, description: a.description || '', input: a.input || null, ...(pane ? { pane: pane.id } : {}), ...(a.adminOnly ? { adminOnly: true } : {}) };
});
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const cfg = () => { const s = getSettings(); return { staleMs: num(s.staleAfterMin, 30) * 60000, rows: Math.min(100, Math.round(num(s.recentRows, 12))), target: num(s.successTarget, 90) }; };

let rt = null;
function runtime() {
  if (rt) return rt;
  fs.mkdirSync(DATA, { recursive: true });
  const store = openStore(process.env.AGENT_DB || path.join(DATA, 'agent.db'));
  const cfgFile = process.env.AGENT_CONFIG || path.join(ROOT, 'agent.config.json');
  let config = {}; let configError = null;
  try { if (fs.existsSync(cfgFile)) config = JSON.parse(fs.readFileSync(cfgFile, 'utf8')); } catch (e) { configError = 'agent.config.json: ' + e.message; }
  const agent = new Agent({ store, tickMs: config.tickMs || 250 });
  const monitors = new Map();
  try { for (const m of buildMonitors(config, store)) { agent.addMonitor(m); monitors.set(m.id, m); } } catch (e) { configError = e.message; }
  agent.on('log', (l) => { if (l.level === 'error') store.log('system', 'error', { message: l.message }); });
  rt = { store, agent, monitors, configError };
  if (agent.tasks.size && process.env.AGENT_AUTOSTART !== '0') agent.start().catch((e) => { rt.configError = e.message; });
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => shutdown().finally(() => process.exit(0)));
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

/** Called once by server.mjs when it starts listening: opens the store and starts the loop. */
export async function init() {
  const { agent, configError } = runtime();
  return { tasks: agent.tasks.size, running: agent.running, configError };
}

const rel = (iso) => {
  const s = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return s < 60 ? s + 's ago' : s < 3600 ? Math.floor(s / 60) + ' min ago' : s < 86400 ? Math.floor(s / 3600) + ' h ago' : Math.floor(s / 86400) + ' d ago';
};
const TASK_TYPES = ['task', 'folder', 'ftp', 'imap'];
const MON_KIND = { folder: 'Folder', ftp: 'FTP', imap: 'Email' };
const monitorRows = ({ agent, monitors }) => agent.snapshot().tasks.map((t) => {
  const st = t.state; const m = monitors.get(t.id);
  const state = t.lingering ? { text: 'Stuck', tone: 'bad' } : t.inflight ? { text: 'Running', tone: 'run' }
    : !st ? { text: 'Waiting', tone: 'wait' } : st.status === 'ok' ? { text: 'OK', tone: 'ok' }
    : st.status === 'failed' ? { text: 'Failed', tone: 'bad' } : { text: st.status[0].toUpperCase() + st.status.slice(1), tone: 'wait' };
  const last = st && (st.details.lastRunAt || st.timestamp);
  const r = (st && st.details.result) || {};
  // Queue depth: folder files awaiting their action; email messages left past maxPerPoll; FTP transfers that failed.
  const queue = m && typeof m.queueDepth === 'number' ? m.queueDepth : t.kind === 'imap' ? Number(r.backlog || 0) : t.kind === 'ftp' ? Number(r.failed || 0) : 0;
  return [MON_KIND[t.kind] + ' · ' + t.id.slice(t.id.indexOf(':') + 1), state, last ? rel(last) : 'never', queue];
});
const taskRuns = (store, limit = 100) => store.db.prepare("SELECT * FROM sync_log WHERE type IN ('folder','ftp','imap','task') AND json_extract(details, '$.attempt') IS NOT NULL ORDER BY timestamp DESC, id DESC LIMIT ?").all(limit).map((r) => ({ ...r, details: JSON.parse(r.details) }));

// Event rows only: a task's own per-poll 'ok' row (it has details.attempt) is not a transfer or an email.
const FTP_TRANSFERS = "type = 'ftp' AND status = 'ok' AND json_extract(details, '$.op') IN ('download', 'upload')";
// An email counts once it is acknowledged: handled by a rule, ignored, malformed, or given up after failed rule runs.
const EMAILS_PROCESSED = "type = 'imap' AND json_extract(details, '$.uid') IS NOT NULL AND (status IN ('ok', 'ignored', 'malformed') OR (status = 'failed' AND json_extract(details, '$.gaveUp') = 1))";
const count1 = (store, where) => Number(store.db.prepare('SELECT COUNT(*) AS n FROM sync_log WHERE ' + where).get().n);

const lastRun = (t) => t.state && (t.state.details.lastRunAt || t.state.timestamp);
const staleIds = (tasks) => tasks.filter((t) => { const l = lastRun(t); return l && !t.inflight && Date.now() - Date.parse(l) > cfg().staleMs; }).map((t) => t.id);

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
  else if (!tasks.length) { mood = 'wait'; headline = 'Idle'; detail = 'No monitors configured. Add agent.config.json (see agent.config.example.json).'; }
  else if (!snap.running) { mood = 'wait'; headline = 'Stopped'; detail = 'The loop is not running'; }
  else if (staleIds(tasks).length) { mood = 'wait'; headline = 'Stale'; detail = staleIds(tasks).join(', ') + ' has not run for over ' + Math.round(cfg().staleMs / 60000) + ' min'; }
  else if (lowRate()) { mood = 'wait'; headline = 'Below target'; detail = 'Sync rate ' + lowRate() + '% is under the ' + cfg().target + '% target'; }
  else if (snap.active) { mood = 'run'; headline = 'Working'; detail = snap.active + ' task(s) running now'; }
  return { mood, headline, detail, primary: { label: 'Active Tasks', value: String(snap.active) }, ring };
}

export async function metrics() {
  const { store, agent, monitors } = runtime();
  const runs = taskRuns(store, 200);
  const ok = runs.filter((r) => r.status === 'ok').length;
  // Trend: success % over consecutive buckets of the most recent runs (oldest first).
  const buckets = []; const chrono = runs.slice().reverse();
  for (let i = 0; i < chrono.length; i += 10) { const b = chrono.slice(i, i + 10); buckets.push(Math.round((b.filter((r) => r.status === 'ok').length / b.length) * 100)); }
  const active = agent.snapshot().active;
  const snap = agent.snapshot();
  const ms = runs.map((r) => Number(r.details.ms)).filter(Number.isFinite);
  const kindQueue = (k) => monitorRows({ agent, monitors }).reduce((n, r, i) => n + (snap.tasks[i].kind === k ? r[3] : 0), 0);
  const ev = (type, w) => count1(store, "type = '" + type + "' AND " + w);
  const spark = (v) => [v];
  const integ = store.integrity();
  const rows = Number(store.db.prepare('SELECT COUNT(*) AS n FROM sync_log').get().n);
  const sync = runs.length ? Math.round((ok / runs.length) * 100) : 100;
  const ftpT = count1(store, FTP_TRANSFERS), mail = count1(store, EMAILS_PROCESSED);
  const fq = kindQueue('folder'), eb = kindQueue('imap');
  return [
    { key: 'activeTasks', label: 'Active Tasks', value: active, unit: 'count', trend: [active], good: 'down', pane: 'loop' },
    { key: 'syncRate', label: 'Sync Rate', value: sync, unit: '%', trend: buckets.length ? buckets.slice(-14) : [100], good: 'up', pane: 'loop' },
    { key: 'avgRunMs', label: 'Avg Run Time', value: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : 0, unit: 'ms', trend: ms.length ? ms.slice(0, 14).reverse() : [0], good: 'down', pane: 'loop' },
    { key: 'staleMonitors', label: 'Stale Monitors', value: staleIds(snap.tasks).length, unit: 'count', trend: spark(staleIds(snap.tasks).length), good: 'down', pane: 'loop' },
    { key: 'folderQueue', label: 'Files Waiting', value: fq, unit: 'count', trend: spark(fq), good: 'down', pane: 'folders' },
    { key: 'folderEvents', label: 'Folder Events', value: ev('folder', "json_extract(details, '$.event') = 'added'"), unit: 'count', trend: spark(ev('folder', "json_extract(details, '$.event') = 'added'")), good: 'up', pane: 'folders' },
    { key: 'ftpTransfers', label: 'FTP Transfers', value: ftpT, unit: 'count', trend: spark(ftpT), good: 'up', pane: 'ftp' },
    { key: 'ftpFailed', label: 'FTP Failures', value: ev('ftp', "status = 'failed'"), unit: 'count', trend: spark(ev('ftp', "status = 'failed'")), good: 'down', pane: 'ftp' },
    { key: 'emailsProcessed', label: 'Emails Processed', value: mail, unit: 'count', trend: spark(mail), good: 'up', pane: 'email' },
    { key: 'emailBacklog', label: 'Email Backlog', value: eb, unit: 'count', trend: spark(eb), good: 'down', pane: 'email' },
    { key: 'stateRows', label: 'Log Rows', value: rows, unit: 'count', trend: spark(rows), good: 'up', pane: 'state' },
    { key: 'stateHealth', label: 'Database Integrity', value: integ.ok ? 100 : 0, unit: '%', trend: spark(integ.ok ? 100 : 0), good: 'up', pane: 'state' }
  ];
}

const WARN = new Set(['skipped', 'malformed', 'interrupted', 'reset', 'stopped-forced', 'recovered']);
const level = (st) => (st === 'failed' || st === 'error' ? 'error' : WARN.has(st) ? 'warn' : 'info');

/** One row per monitor: name, state chip, last run, queue depth. Shown when dashboard.json lists a "Monitors" panel. */
export function monitorTable() { return { title: 'Monitors', kind: 'table', columns: ['Monitor', 'State', 'Last run', 'Queue'], rows: monitorRows(runtime()) }; }

const stateTables = (store) => store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all()
  .map((t) => [t.name, Number(store.db.prepare('SELECT COUNT(*) AS n FROM "' + t.name.replace(/"/g, '') + '"').get().n)]);

export async function panels() {
  const { store } = runtime();
  const n = cfg().rows;
  const runs = taskRuns(store, n);
  // Events (files, transfers, emails, errors), not the routine successful poll of every task: those are Recent Runs.
  const logs = store.db.prepare("SELECT * FROM sync_log WHERE NOT (status = 'ok' AND json_extract(details, '$.attempt') IS NOT NULL) ORDER BY timestamp DESC, id DESC LIMIT ?").all(n).map((r) => ({ ...r, details: JSON.parse(r.details) }));
  const line = (l) => [(l.details.task || l.details.monitor || l.type) + ': ' + (l.details.event || l.details.op || l.details.error || l.details.note || l.status) + (l.details.path ? ' ' + path.basename(l.details.path) : l.details.file ? ' ' + l.details.file : l.details.subject ? ' ' + l.details.subject : ''), rel(l.timestamp) + ' · ' + level(l.status)];
  const typed = (type) => store.recentLogs({ type, limit: n * 3 }).slice(0, n);
  const all = {
    'Recent Runs': () => ({ title: 'Recent Runs', kind: 'table', columns: ['Task', 'Status', 'Time'], rows: runs.map((r) => [r.details.task, r.status === 'ok' ? 'OK' : 'Failed (try ' + r.details.attempt + ')', rel(r.timestamp)]) }),
    'System Logs': () => ({ title: 'System Logs', kind: 'list', columns: ['Timestamp', 'Level', 'Message'], rows: logs.map(line) }),
    Monitors: monitorTable,
    'Folder Activity': () => ({ title: 'Folder Activity', kind: 'table', columns: ['Folder', 'Event', 'File', 'Time'], rows: typed('folder').filter((l) => l.details.event).map((l) => [l.details.monitor || '', l.details.event, l.details.name || (l.details.path ? path.basename(l.details.path) : ''), rel(l.timestamp)]) }),
    'FTP Activity': () => ({ title: 'FTP Activity', kind: 'table', columns: ['Site', 'Operation', 'File', 'Status', 'Time'], rows: typed('ftp').filter((l) => l.details.op).map((l) => [l.details.monitor || '', l.details.op, l.details.file || '', l.status, rel(l.timestamp)]) }),
    'Email Activity': () => ({ title: 'Email Activity', kind: 'table', columns: ['Mailbox', 'Subject', 'Result', 'Time'], rows: typed('imap').filter((l) => l.details.uid != null).map((l) => [l.details.monitor || '', String(l.details.subject || l.details.rule || 'uid ' + l.details.uid), l.status, rel(l.timestamp)]) }),
    'State Tables': () => ({ title: 'State Tables', kind: 'table', columns: ['Table', 'Rows'], rows: stateTables(store) })
  };
  return SPEC_PANELS.filter((t) => all[t]).map((t) => all[t]());
}

const summarise = (results) => {
  const failed = results.filter((r) => r.status !== 'ok');
  return { ok: failed.length === 0, message: results.length + ' task(s) run, ' + failed.length + ' failed' + (failed.length ? ': ' + failed.map((f) => f.id + ' (' + f.error + ')').join('; ').slice(0, 300) : ''), output: results.map(({ id: i, status, attempts }) => ({ id: i, status, attempts })) };
};
const NO_MONITORS = 'No monitors configured: add agent.config.json (see agent.config.example.json), then restart the dashboard';

export async function run(id, input) {
  const kinds = { 'run-folders': ['folder', 'folder'], 'run-ftp': ['ftp', 'FTP'], 'run-imap': ['imap', 'email'] };
  if (id === 'check-state') {
    const { store } = runtime(); const r = store.integrity();
    return { ok: r.ok, message: r.ok ? 'Database integrity check passed' : 'Database problem: ' + r.problems.slice(0, 3).join('; '), output: { tables: stateTables(store) } };
  }
  if (id !== 'run' && !kinds[id] && id !== 'run-monitor') return { ok: false, message: 'Unknown action' };
  const { agent } = runtime();
  if (!agent.tasks.size) return { ok: false, message: NO_MONITORS };
  if (id === 'run') return summarise(await agent.runAll('manual'));
  if (id === 'run-monitor') {
    const want = String(input || '').trim();
    if (!want) return { ok: false, message: 'Enter a monitor id, e.g. ' + [...agent.tasks.keys()][0] };
    if (!agent.tasks.has(want)) return { ok: false, message: 'Unknown monitor \"' + want.slice(0, 80) + '\". Available: ' + [...agent.tasks.keys()].join(', ') };
    return summarise([await agent.runTask(want, 'manual')]);
  }
  const [kind, name] = kinds[id];
  const ids = [...agent.tasks.values()].filter((t) => t.kind === kind).map((t) => t.id);
  if (!ids.length) return { ok: false, message: 'No ' + name + ' monitors configured in agent.config.json' };
  return summarise(await Promise.all(ids.map((i) => agent.runTask(i, 'manual'))));
}

export async function reports() {
  const { store, agent } = runtime();
  fs.mkdirSync(REPORTS, { recursive: true });
  const now = new Date().toISOString();
  const runs = taskRuns(store, 100);
  const history = ['# Task History', 'Generated ' + now, '', ...agent.snapshot().tasks.map((t) => '- ' + t.id + ': ' + (t.state ? t.state.status + ' at ' + t.state.timestamp : 'never run')), '', '## Recent runs', ...runs.slice(0, 50).map((r) => r.timestamp + '  ' + r.details.task + '  ' + r.status + (r.details.error ? '  ' + r.details.error : ''))].join('\n');
  const perType = TASK_TYPES.map((t) => { const rs = runs.filter((r) => r.type === t); return rs.length ? '- ' + t + ': ' + rs.filter((r) => r.status === 'ok').length + '/' + rs.length + ' ok' : null; }).filter(Boolean);
  const ok = runs.filter((r) => r.status === 'ok').length;
  const perf = ['# Sync Performance', 'Generated ' + now, '', 'Sync rate: ' + (runs.length ? Math.round((ok / runs.length) * 100) + '% (' + ok + '/' + runs.length + ' of the last runs)' : 'no runs yet'), '', ...perType].join('\n');
  fs.writeFileSync(path.join(REPORTS, 'task-history.md'), history + '\n');
  fs.writeFileSync(path.join(REPORTS, 'sync-performance.md'), perf + '\n');
  return [{ title: 'Task History', href: 'reports/task-history.md', createdAt: now }, { title: 'Sync Performance', href: 'reports/sync-performance.md', createdAt: now }];
}

// server.mjs only imports this module, so the loop must start at import: monitors run from boot, not the first page view.
try { await init(); } catch (e) { console.error('dashboard init failed: ' + e.message); }
