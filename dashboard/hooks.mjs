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

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const DATA = path.join(HERE, 'data');
const REPORTS = path.join(DATA, 'reports');

export const actions = [{ id: 'run', label: 'Run Now', description: 'Manually trigger all scheduled tasks', input: null }];

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
  for (const sig of ['SIGTERM', 'SIGINT']) process.once(sig, () => agent.stop().finally(() => process.exit(0)));
  return rt;
}

/** Stop the loop (waiting for in-flight work) and close the database. */
export async function shutdown() {
  if (!rt) return;
  const { agent, store } = rt; rt = null;
  await agent.stop(); store.close();
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

export async function status() {
  const { store, agent, configError } = runtime();
  const snap = agent.snapshot();
  const tasks = snap.tasks;
  const failing = tasks.filter((t) => t.state && t.state.status === 'failed');
  const integ = store.integrity();
  const count = (kind) => tasks.filter((t) => t.kind === kind).length;
  const ring = [
    { label: 'Polling Folders', value: count('folder') },
    { label: 'FTP Transfers', value: store.recentLogs({ type: 'ftp', limit: 5000 }).filter((l) => l.status === 'ok').length },
    { label: 'Emails Processed', value: store.recentLogs({ type: 'imap', limit: 5000 }).filter((l) => l.status === 'ok').length }
  ];
  let mood = 'ok', headline = 'Healthy', detail = tasks.length + ' task(s) scheduled' + (snap.running ? ', loop running' : '');
  if (!integ.ok) { mood = 'bad'; headline = 'Database problem'; detail = integ.problems[0]; }
  else if (configError) { mood = 'bad'; headline = 'Config error'; detail = configError; }
  else if (failing.length) { mood = 'bad'; headline = 'Failing'; detail = failing.map((t) => t.id).join(', ') + ' failed: ' + String(failing[0].state.details.error || '').slice(0, 120); }
  else if (!tasks.length) { mood = 'wait'; headline = 'Idle'; detail = 'No monitors configured. Add agent.config.json (see agent.config.example.json).'; }
  else if (!snap.running) { mood = 'wait'; headline = 'Stopped'; detail = 'The loop is not running'; }
  else if (snap.active) { mood = 'run'; headline = 'Working'; detail = snap.active + ' task(s) running now'; }
  return { mood, headline, detail, primary: { label: 'Active Tasks', value: String(snap.active) }, ring };
}

export async function metrics() {
  const { store, agent } = runtime();
  const runs = taskRuns(store, 200);
  const ok = runs.filter((r) => r.status === 'ok').length;
  // Trend: success % over consecutive buckets of the most recent runs (oldest first).
  const buckets = []; const chrono = runs.slice().reverse();
  for (let i = 0; i < chrono.length; i += 10) { const b = chrono.slice(i, i + 10); buckets.push(Math.round((b.filter((r) => r.status === 'ok').length / b.length) * 100)); }
  const active = agent.snapshot().active;
  return [
    { key: 'activeTasks', label: 'Active Tasks', value: active, unit: 'count', trend: [active], good: 'down' },
    { key: 'syncRate', label: 'Sync Rate', value: runs.length ? Math.round((ok / runs.length) * 100) : 100, unit: '%', trend: buckets.length ? buckets.slice(-14) : [100], good: 'up' }
  ];
}

const WARN = new Set(['skipped', 'malformed', 'interrupted', 'reset', 'stopped-forced', 'recovered']);
const level = (st) => (st === 'failed' || st === 'error' ? 'error' : WARN.has(st) ? 'warn' : 'info');

export async function panels() {
  const { store } = runtime();
  const runs = taskRuns(store, 10);
  // Events (files, transfers, emails, errors), not the routine successful poll of every task: those are Recent Runs.
  const logs = store.db.prepare("SELECT * FROM sync_log WHERE NOT (status = 'ok' AND json_extract(details, '$.attempt') IS NOT NULL) ORDER BY timestamp DESC, id DESC LIMIT 12").all().map((r) => ({ ...r, details: JSON.parse(r.details) }));
  const line = (l) => [(l.details.task || l.details.monitor || l.type) + ': ' + (l.details.event || l.details.op || l.details.error || l.details.note || l.status) + (l.details.path ? ' ' + path.basename(l.details.path) : l.details.file ? ' ' + l.details.file : l.details.subject ? ' ' + l.details.subject : ''), rel(l.timestamp) + ' · ' + level(l.status)];
  return [
    { title: 'Recent Runs', kind: 'table', columns: ['Task', 'Status', 'Time'], rows: runs.map((r) => [r.details.task, r.status === 'ok' ? 'OK' : 'Failed (try ' + r.details.attempt + ')', rel(r.timestamp)]) },
    { title: 'System Logs', kind: 'list', columns: ['Timestamp', 'Level', 'Message'], rows: logs.map(line) },
    { title: 'Monitors', kind: 'table', columns: ['Monitor', 'State', 'Last run', 'Queue'], rows: monitorRows(runtime()) }
  ];
}

export async function run(id) {
  if (id !== 'run') return { ok: false, message: 'Unknown action' };
  const { agent } = runtime();
  if (!agent.tasks.size) return { ok: false, message: 'No monitors configured: add agent.config.json (see agent.config.example.json), then restart the dashboard' };
  const results = await agent.runAll('manual');
  const failed = results.filter((r) => r.status !== 'ok');
  return { ok: failed.length === 0, message: results.length + ' task(s) run, ' + failed.length + ' failed' + (failed.length ? ': ' + failed.map((f) => f.id + ' (' + f.error + ')').join('; ').slice(0, 300) : ''), output: results.map(({ id: i, status, attempts }) => ({ id: i, status, attempts })) };
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
