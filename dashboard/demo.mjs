// Demo data for the Construction Agent dashboard: the same exports as hooks.mjs, filled with a realistic, seeded
// site (Harlow Build, a four-storey office fit-out). The server serves this until the site folder, the contractor
// FTP login and the project mailbox are set up in Connections. Everything here is in memory: nothing touches
// the real folder, FTP server, mailbox or database. Buttons add records so every screen can be tried.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA = process.env.HQ_APP_DATA || path.join(HERE, 'data');
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'dashboard.json'), 'utf8'));
const SPEC_PANELS = SPEC.panels.map((p) => p.title);
const PANE_OF_PANEL = Object.fromEntries(SPEC.panes.flatMap((p) => p.panels.map((t) => [t, p.id])));

export const actions = SPEC.actions.map((a) => {
  const pane = SPEC.panes.find((p) => (p.actions || []).includes(a.id));
  return { id: a.id, label: a.label, description: a.description || '', input: a.input || null, pane: pane ? pane.id : 'overview', ...(a.adminOnly ? { adminOnly: true } : {}) };
});

// ---------- seeded records ----------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(839);
const iso = (minsAgo) => new Date(Date.now() - minsAgo * 60000).toISOString();
const rel = (at) => { const m = Math.max(0, Math.round((Date.now() - Date.parse(at)) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' d ago'; };

const st = {
  folder: '/Volumes/Projects/Harlow/Incoming',
  direction: 'both',
  rules: [{ name: 'rfi', subject: 'RFI' }, { name: 'invoice', subject: 'Invoice' }, { name: 'variation', subject: 'Variation' }],
  arrivals: [
    [2, 'A-101_Level2_Plan_RevC.pdf', 'Filed', 2400000], [9, 'S-204_Steel_Details.dwg', 'Filed', 6100000], [26, 'Site_Photo_0412.jpg', 'Filed', 3800000],
    [47, 'RFI-118_Response.pdf', 'Filed', 310000], [88, 'M-301_Ductwork_RevB.pdf', 'Updated', 1900000], [140, 'Concrete_Pour_Record_L3.xlsx', 'Filed', 88000],
    [205, 'Safety_Walk_Checklist.pdf', 'Filed', 150000], [330, 'E-110_Panel_Schedule.pdf', 'Filed', 760000], [415, 'Delivery_Docket_8821.pdf', 'Filed', 120000],
    [610, 'Site_Photo_0411.jpg', 'Filed', 3500000], [880, 'Programme_Wk43.pdf', 'Filed', 540000], [1180, 'Temp_Works_Cert.pdf', 'Failed', 0]
  ].map(([m, file, event, size]) => ({ file, folder: 'site', event, status: event === 'Failed' ? 'failed' : 'ok', at: iso(m), size, error: event === 'Failed' ? 'File was still being written after 3 attempts' : null })),
  transfers: [
    [11, 'S-204_Steel_Details.dwg', 'download', 'ok', 6100000, 'new'], [11, 'S-205_Steel_Connections.dwg', 'download', 'ok', 4900000, 'new'], [41, 'Pour_Schedule_Wk43.xlsx', 'upload', 'ok', 91000, 'local changed'],
    [41, 'A-101_Level2_Plan_RevC.pdf', 'upload', 'ok', 2400000, 'new'], [96, 'M-301_Ductwork_RevB.pdf', 'download', 'ok', 1900000, 'remote changed'], [96, 'Subcontractor_Insurance.pdf', 'download', 'ok', 210000, 'new'],
    [171, 'Crane_Lift_Plan.pdf', 'upload', 'failed', null, null], [246, 'Site_Photo_0410.jpg', 'upload', 'ok', 3300000, 'new'], [246, 'E-110_Panel_Schedule.pdf', 'upload', 'ok', 760000, 'new'],
    [411, 'Programme_Wk43.pdf', 'upload', 'ok', 540000, 'new'], [411, 'Fire_Strategy_RevD.pdf', 'download', 'ok', 2800000, 'remote changed'], [700, 'Handover_Template.docx', 'download', 'skipped', null, 'local copy changed since last sync; not overwriting']
  ].map(([m, file, op, status, bytes, reason]) => ({ file, op, status, bytes, monitor: 'site', at: iso(m), reason: status === 'ok' ? reason : null, error: status === 'failed' ? 'Connection timed out after 10 s' : status === 'skipped' ? reason : null })),
  messages: [
    [4, 'Priya Shah <priya@northbeam.example>', 'RFI 122: slab edge detail at gridline C', 'ok', 'rfi'], [19, 'accounts@steelwerks.example', 'Invoice 7731 - structural steel, October', 'ok', 'invoice'],
    [33, 'Tom Alvarez <tom@harlowbuild.example>', 'Lunch order for Friday', 'ignored', null], [58, 'Priya Shah <priya@northbeam.example>', 'RFI 121: stair core fire rating', 'ok', 'rfi'],
    [102, 'billing@liftco.example', 'Invoice L-0192 - lift installation stage 2', 'ok', 'invoice'], [160, 'Mina Okoye <mina@cityplanning.example>', 'Variation 14: added fire damper', 'ok', 'variation'],
    [215, 'noreply@weather.example', 'Wind warning for Thursday', 'ignored', null], [330, 'Priya Shah <priya@northbeam.example>', 'RFI 120: balustrade fixings', 'ok', 'rfi'],
    [520, 'accounts@glazeco.example', 'Invoice 3310 - curtain wall deposit', 'ok', 'invoice'], [760, 'unknown@mailer.example', '(unreadable header)', 'malformed', null]
  ].map(([m, from, subject, status, rule], i) => ({ uid: 9040 - i, from, subject, status, rule, at: iso(m), result: { ok: 'Matched', ignored: 'No rule matched', malformed: 'Unreadable', failed: 'Failed' }[status] })),
  runsPerHour: Array.from({ length: 24 }, (_, i) => Math.round(2 + rand() * 4 + (i > 6 && i < 19 ? 3 : 0))),
  checked: 0
};
let seq = 0;
const POOL = ['A-102_Level3_Plan_RevA.pdf', 'S-210_Roof_Framing.dwg', 'Site_Photo_0413.jpg', 'Inspection_Request_44.pdf', 'Rebar_Delivery_Docket.pdf', 'M-310_Pipework_RevA.pdf'];
const word = { ok: 'OK', failed: 'Failed', skipped: 'Skipped' };

// ---------- derived views (same shapes as hooks.mjs) ----------
function hourly(items) {
  const values = new Array(24).fill(0);
  for (const r of items) { const age = Math.floor((Date.now() - Date.parse(r.at)) / 3600000); if (age >= 0 && age < 24) values[23 - age]++; }
  return { labels: values.map((_, i) => (i === 23 ? 'now' : '-' + (23 - i) + 'h')), values };
}
const filed = () => st.arrivals.filter((a) => a.status === 'ok').length;
const moved = () => st.transfers.filter((t) => t.status === 'ok').length;
const failedT = () => st.transfers.filter((t) => t.status === 'failed').length;
const triaged = () => st.messages.length;
const logRows = () => 3400 + st.arrivals.length + st.transfers.length + st.messages.length;
const monitorsOf = (kind) => ({ folder: [{ name: 'Folder · site', state: 'OK', tone: 'ok', last: '1 min ago', queue: 0 }], ftp: [{ name: 'FTP · site', state: 'OK', tone: 'ok', last: '4 min ago', queue: failedT() }], imap: [{ name: 'Email · pm', state: 'OK', tone: 'ok', last: '1 min ago', queue: 0 }] }[kind]);

function activityEvents(filter = {}) {
  const all = [
    ...st.arrivals.map((a) => ({ source: 'folder', result: a.status, what: 'site: ' + (a.status === 'failed' ? 'added failed ' : (a.event === 'Updated' ? 'modified ' : 'added ')) + a.file, at: a.at })),
    ...st.transfers.map((t) => ({ source: 'ftp', result: t.status, what: 'site: ' + t.op + ' ' + t.file, at: t.at })),
    ...st.messages.map((m) => ({ source: 'imap', result: m.status, what: 'pm: ' + (m.rule || m.status) + ' ' + m.subject, at: m.at })),
    ...[3, 8, 14, 20, 31].map((m, i) => ({ source: 'task', result: 'ok', what: ['folder:site', 'imap:pm', 'ftp:site', 'folder:site', 'imap:pm'][i] + ': scheduled run', at: iso(m) }))
  ].map((e) => ({ ...e, level: e.result === 'failed' ? 'error' : e.result === 'ok' ? 'info' : 'warn' }));
  return all.filter((e) => (!filter.type || filter.type === 'all' || e.source === filter.type)
    && (!filter.result || filter.result === 'all' || (filter.result === 'ok' ? e.result === 'ok' : filter.result === 'failed' ? e.result === 'failed' : e.result !== 'ok' && e.result !== 'failed')))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
const TYPES = ['all', 'folder', 'ftp', 'imap', 'task', 'system'];
const RESULTS = ['all', 'ok', 'failed', 'other'];

function documentsData() {
  return { source: 'demo', configured: true, needs: null, folder: st.folder, monitors: monitorsOf('folder'), summary: { filed: filed(), waiting: 0, last: st.arrivals[0].at }, arrivals: st.arrivals, hours: hourly(st.arrivals), canEdit: true };
}
function transfersData() {
  return { source: 'demo', configured: true, needs: null, host: 'ftp.northbeam.example', remoteDir: '/projects/harlow', direction: st.direction, monitors: monitorsOf('ftp'),
    summary: { transferred: moved(), failed: failedT(), skipped: st.transfers.filter((t) => t.status === 'skipped').length, last: st.transfers[0].at }, transfers: st.transfers, hours: hourly(st.transfers.filter((t) => t.status === 'ok')), canEdit: true };
}
function inboxData() {
  const tally = new Map();
  for (const m of st.messages) { const k = m.status === 'ok' ? m.rule : m.status === 'ignored' ? 'No rule' : null; if (k) tally.set(k, (tally.get(k) || 0) + 1); }
  return { source: 'demo', configured: true, needs: null, mailbox: 'INBOX', host: 'imap.harlowbuild.example', rules: st.rules.map((r) => ({ ...r, action: 'log' })), monitors: monitorsOf('imap'),
    summary: { triaged: triaged(), backlog: 0, ignored: st.messages.filter((m) => m.status === 'ignored').length, last: st.messages[0].at }, messages: st.messages,
    byRule: { labels: [...tally.keys()], values: [...tally.values()] }, canEdit: true };
}
function activityData(filter = {}) {
  const all = activityEvents();
  const types = new Map(); for (const e of all) types.set(e.source, (types.get(e.source) || 0) + 1);
  return { source: 'demo', configured: true, filter: { type: TYPES.includes(filter.type) ? filter.type : 'all', result: RESULTS.includes(filter.result) ? filter.result : 'all' }, types: TYPES, results: RESULTS,
    summary: { rows: logRows(), integrity: true, problems: [], tables: [['checkpoints', 4], ['sync_log', logRows()], ['task_state', 3]] }, events: activityEvents(filter).slice(0, 200), byType: { labels: [...types.keys()], values: [...types.values()] } };
}

export async function pane(id) {
  if (id === 'documents') return documentsData();
  if (id === 'transfers') return transfersData();
  if (id === 'inbox') return inboxData();
  if (id === 'activity-log') return activityData();
  return null;
}

export async function status() {
  return { mood: 'ok', headline: 'Healthy', detail: 'Demo data: 3 task(s) scheduled, loop running', primary: { label: 'Active Tasks', value: '0' },
    ring: [{ label: 'Polling Folders', value: 1 }, { label: 'FTP Transfers', value: moved() }, { label: 'Emails Processed', value: triaged() }] };
}

export async function paneStatus() {
  const f = failedT();
  return {
    documents: { state: 'ok', text: filed() + ' documents filed' },
    transfers: f ? { state: 'warn', text: f + ' failed transfer' + (f === 1 ? '' : 's') + ' to retry' } : { state: 'ok', text: moved() + ' files transferred' },
    inbox: { state: 'ok', text: triaged() + ' emails triaged' },
    'activity-log': { state: 'ok', text: logRows() + ' events on record' }
  };
}

export async function metrics() {
  const t = (items) => hourly(items).values;
  return [
    { key: 'activeTasks', label: 'Active tasks', value: 0, unit: '', trend: [0, 1, 0, 0, 1, 0], good: 'down', pane: 'overview' },
    { key: 'syncRate', label: 'Sync rate', value: 96, unit: '%', trend: [92, 94, 95, 93, 97, 96, 96], good: 'up', pane: 'overview' },
    { key: 'avgRunMs', label: 'Avg run time', value: 840, unit: 'ms', trend: [910, 870, 860, 820, 850, 830, 840], good: 'down', pane: 'overview' },
    { key: 'docsFiled', label: 'Documents filed', value: filed(), unit: '', trend: t(st.arrivals), good: 'up', pane: 'documents' },
    { key: 'docsWaiting', label: 'Files waiting', value: 0, unit: '', trend: [0, 1, 0, 0], good: 'down', pane: 'documents' },
    { key: 'ftpTransfers', label: 'Files transferred', value: moved(), unit: '', trend: t(st.transfers), good: 'up', pane: 'transfers' },
    { key: 'ftpFailed', label: 'Transfer failures', value: failedT(), unit: '', trend: [0, 0, 1, 0, 1], good: 'down', pane: 'transfers' },
    { key: 'emailsProcessed', label: 'Emails triaged', value: triaged(), unit: '', trend: t(st.messages), good: 'up', pane: 'inbox' },
    { key: 'emailBacklog', label: 'Inbox backlog', value: 0, unit: '', trend: [2, 1, 0, 0], good: 'down', pane: 'inbox' },
    { key: 'logRows', label: 'Events on record', value: logRows(), unit: '', trend: [3380, 3392, 3401, 3410, logRows()], good: 'up', pane: 'activity-log' },
    { key: 'dbIntegrity', label: 'Record integrity', value: 100, unit: '%', trend: [100, 100, 100], good: 'up', pane: 'activity-log' }
  ];
}

export async function panels() {
  const docs = documentsData(), tr = transfersData(), inb = inboxData(), act = activityData();
  const line = (title, name, b, pane) => ({ title, kind: 'line', labels: b.labels, series: [{ name, values: b.values }], pane });
  const all = {
    'Runs, last 24 hours': () => line('Runs, last 24 hours', 'Runs', { labels: docs.hours.labels, values: st.runsPerHour }, 'overview'),
    Monitors: () => ({ title: 'Monitors', kind: 'table', columns: ['Monitor', 'State', 'Last run', 'Queue'], rows: [...monitorsOf('folder'), ...monitorsOf('ftp'), ...monitorsOf('imap')].map((m) => [m.name, { text: m.state, tone: m.tone }, m.last, m.queue]), pane: 'overview' }),
    'Arrivals, last 24 hours': () => line('Arrivals, last 24 hours', 'Files', docs.hours, 'documents'),
    'Recent arrivals': () => ({ title: 'Recent arrivals', kind: 'table', columns: ['File', 'Folder', 'Event', 'When'], rows: docs.arrivals.slice(0, 12).map((a) => [a.file, a.folder, a.event, rel(a.at)]) }),
    'Transfers, last 24 hours': () => line('Transfers, last 24 hours', 'Transfers', tr.hours, 'transfers'),
    'Transfer history': () => ({ title: 'Transfer history', kind: 'table', columns: ['File', 'Direction', 'Result', 'When'], rows: tr.transfers.slice(0, 12).map((t) => [t.file, t.op, t.status === 'failed' ? 'Failed: ' + t.error : word[t.status], rel(t.at)]) }),
    'Triage by rule': () => ({ title: 'Triage by rule', kind: 'bar', labels: inb.byRule.labels, series: [{ name: 'Messages', values: inb.byRule.values }] }),
    'Recent messages': () => ({ title: 'Recent messages', kind: 'table', columns: ['From', 'Subject', 'Result', 'When'], rows: inb.messages.slice(0, 12).map((m) => [m.from, m.subject, m.result + (m.rule ? ': ' + m.rule : ''), rel(m.at)]) }),
    'Events by source': () => ({ title: 'Events by source', kind: 'bar', labels: act.byType.labels, series: [{ name: 'Events', values: act.byType.values }] }),
    'Latest events': () => ({ title: 'Latest events', kind: 'table', columns: ['Source', 'Result', 'What', 'When'], rows: act.events.slice(0, 12).map((e) => [e.source, e.result, e.what, rel(e.at)]) })
  };
  return SPEC_PANELS.filter((t) => all[t]).map((t) => ({ pane: PANE_OF_PANEL[t] || 'overview', ...all[t]() }));
}

// ---------- actions (they add records so the screens respond) ----------
function scan() {
  const n = 1 + (seq % 2); const files = [];
  for (let i = 0; i < n; i++) { const file = POOL[seq++ % POOL.length]; files.push(file); st.arrivals.unshift({ file, folder: 'site', event: 'Filed', status: 'ok', at: iso(0), size: 400000 + seq * 91000, error: null }); }
  return { ok: true, message: 'Scanned 1 folder: ' + n + ' new document' + (n === 1 ? '' : 's') + ' filed (demo)', output: { files } };
}
function sync() {
  const file = POOL[seq++ % POOL.length];
  st.transfers.unshift({ file, op: seq % 2 ? 'upload' : 'download', status: 'ok', bytes: 750000 + seq * 53000, monitor: 'site', at: iso(0), reason: 'new', error: null });
  return { ok: true, message: '1 file transferred, 0 failed (demo)', output: { file } };
}
function check() {
  st.checked++;
  st.messages.unshift({ uid: 9041 + st.checked, from: 'Priya Shah <priya@northbeam.example>', subject: 'RFI ' + (122 + st.checked) + ': follow-up on slab edge', status: 'ok', rule: 'rfi', at: iso(0), result: 'Matched' });
  return { ok: true, message: '1 new email triaged: matched rule rfi (demo)', output: { checked: st.checked } };
}

export async function run(id, input) {
  if (id === 'scan-folders') return scan();
  if (id === 'sync-ftp') return sync();
  if (id === 'check-inbox') return check();
  if (id === 'run') { const a = scan(), b = sync(), c = check(); return { ok: true, message: '3 task(s) run, 0 failed (demo)', output: [a, b, c].map((x, i) => ({ id: ['folder:site', 'ftp:site', 'imap:pm'][i], status: 'ok', attempts: 1 })) }; }
  if (id === 'check-database') return { ok: true, message: 'Record integrity check passed (demo)', output: { tables: activityData().summary.tables } };
  if (id === 'run-monitor') {
    const want = String(input || '').trim();
    const map = { 'folder:site': scan, 'ftp:site': sync, 'imap:pm': check };
    if (!want) return { ok: false, message: 'Enter a monitor id, e.g. folder:site' };
    if (!map[want]) return { ok: false, message: 'Unknown monitor "' + want.slice(0, 80) + '". Available: folder:site, ftp:site, imap:pm' };
    return map[want]();
  }
  return { ok: false, message: 'Unknown action' };
}

const ADMIN_ONLY = 'Only the admin can change settings.';
export async function paneAction(id, action, input, ctx = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const admin = ctx && ctx.user && ctx.user.role === 'admin';
  const fresh = async (r) => ({ ...r, data: await pane(id) });
  const kindRun = { documents: 'scan-folders', transfers: 'sync-ftp', inbox: 'check-inbox' }[id];
  if (kindRun && ['scan', 'sync', 'check'].includes(action)) return fresh(await run(kindRun));
  if (id === 'documents' && action === 'set-folder') {
    if (!admin) return { ok: false, message: ADMIN_ONLY };
    const p = String(inp.path || '').trim();
    if (!p || !path.isAbsolute(p)) return { ok: false, message: 'Enter the full path of the folder, e.g. /Volumes/Projects/Incoming' };
    st.folder = p; return fresh({ ok: true, message: 'Now watching ' + p + ' (demo)' });
  }
  if (id === 'transfers' && action === 'set-direction') {
    if (!admin) return { ok: false, message: ADMIN_ONLY };
    if (!['download', 'upload', 'both'].includes(String(inp.direction))) return { ok: false, message: 'Direction must be download, upload or both' };
    st.direction = String(inp.direction); return fresh({ ok: true, message: 'Sync direction set to ' + st.direction + ' (demo)' });
  }
  if (id === 'inbox' && (action === 'add-rule' || action === 'remove-rule')) {
    if (!admin) return { ok: false, message: ADMIN_ONLY };
    const name = String(inp.name || '').trim();
    if (!/^[\w][\w .-]{0,29}$/.test(name)) return { ok: false, message: 'Give the rule a short name (letters, numbers, spaces)' };
    st.rules = st.rules.filter((r) => r.name.toLowerCase() !== name.toLowerCase());
    if (action === 'add-rule') {
      const keyword = String(inp.keyword || '').trim();
      if (!keyword || keyword.length > 80) return { ok: false, message: 'Enter the subject keyword to match (up to 80 characters)' };
      st.rules.push({ name, subject: keyword });
    }
    return fresh({ ok: true, message: (action === 'add-rule' ? 'Rule "' + name + '" saved' : 'Rule "' + name + '" removed') + ' (demo)' });
  }
  if (id === 'activity-log') {
    if (action === 'export') { await reports(); return { ok: true, message: 'Exported ' + activityEvents().length + ' events (demo)', data: { ...activityData(), href: 'reports/activity-record.csv' } }; }
    if (action === 'check') return fresh(await run('check-database'));
  }
  return { ok: false, message: 'Unknown action' };
}

export async function testConnection(id) {
  const ms = { folders: 4, ftp: 212, imap: 187 }[id];
  if (!ms) return { ok: false, message: 'Unknown connection' };
  return { ok: true, message: 'Demo: connection simulated, ' + ms + ' ms. Enter your own details to test the real service.' };
}

export async function onSettings() {}

export async function reports() {
  fs.mkdirSync(path.join(DATA, 'reports'), { recursive: true });
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(DATA, 'reports', 'task-history.md'), ['# Task History (demo)', 'Generated ' + now, '', '- folder:site: ok', '- ftp:site: ok', '- imap:pm: ok', ''].join('\n'));
  fs.writeFileSync(path.join(DATA, 'reports', 'sync-performance.md'), ['# Sync Performance (demo)', 'Generated ' + now, '', 'Sync rate: 96% (48/50 of the last runs)', '', '- folder: 20/20 ok', '- ftp: 14/16 ok', '- imap: 14/14 ok', ''].join('\n'));
  fs.writeFileSync(path.join(DATA, 'reports', 'activity-record.csv'), ['Time,Source,Result,What', ...activityEvents().map((e) => [e.at, e.source, e.result, e.what].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n') + '\n');
  return [{ title: 'Task History', href: 'reports/task-history.md', createdAt: now }, { title: 'Sync Performance', href: 'reports/sync-performance.md', createdAt: now }, { title: 'Activity record (CSV)', href: 'reports/activity-record.csv', createdAt: now }];
}
