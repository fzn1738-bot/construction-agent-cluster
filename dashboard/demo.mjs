// Demo data for the Construction Agent dashboard: the same exports as hooks.mjs, filled with a realistic, seeded
// site (Harlow Build, a four-storey office fit-out). The server serves this while no outcome is set up. Everything
// here is in memory: nothing touches the real folder, FTP server, mailbox or database, and buttons add records so
// every screen can be tried. Two screens are deliberately real even here, because they are how you leave the demo:
// The admin Settings and Connections screens show what is really saved, and saving a key there uses the live connection.
// hooks.mjs also borrows these records for any single outcome that is not set up yet.
import fs from 'node:fs';
import path from 'node:path';
import * as kit from './store.mjs';
import * as O from './outcomes.mjs';

const DATA = kit.DATA;
const REPORTS = path.join(DATA, 'reports');
const SPEC = O.SPEC;
const { PANE } = O;

export const actions = O.actionsFromSpec();

// ---------- seeded records ----------
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rand = rng(839);
const BOOT = Date.now();
const iso = (minsAgo) => new Date(BOOT - minsAgo * 60000).toISOString();
const nowIso = () => new Date().toISOString();
const rel = (at) => O.rel(at);

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
  // who pressed what, newest first: scheduled runs every few minutes plus a few people
  runs: [
    [3, 'Scheduled scan of the site folder', 'schedule', 'Schedule', 'documents', 1400, true, '1 document filed'],
    [9, 'Scan site folders', 'owner', 'Fayez N.', 'documents', 3100, true, '2 documents filed'],
    [11, 'Scheduled FTP sync', 'schedule', 'Schedule', 'transfers', 18400, true, '2 files transferred, 0 failed'],
    [15, 'Scheduled inbox check', 'schedule', 'Schedule', 'inbox', 2200, true, '1 email triaged'],
    [41, 'Sync FTP now', 'c-ops', 'Dana (Harlow ops)', 'transfers', 12900, true, '2 files transferred, 0 failed'],
    [58, 'Scheduled inbox check', 'schedule', 'Schedule', 'inbox', 2600, true, '1 email triaged'],
    [96, 'Scheduled FTP sync', 'schedule', 'Schedule', 'transfers', 15100, true, '2 files transferred, 0 failed'],
    [102, 'Check inbox now', 'owner', 'Fayez N.', 'inbox', 1900, true, '1 email triaged'],
    [171, 'Scheduled FTP sync', 'schedule', 'Schedule', 'transfers', 31000, false, 'Failed: Crane_Lift_Plan.pdf: connection timed out after 10 s'],
    [205, 'Scheduled scan of the site folder', 'schedule', 'Schedule', 'documents', 1200, true, '1 document filed'],
    [246, 'Scheduled FTP sync', 'schedule', 'Schedule', 'transfers', 21700, true, '2 files transferred, 0 failed'],
    [330, 'Check the record', 'owner', 'Fayez N.', 'activity-log', 600, true, 'Record integrity check passed'],
    [415, 'Scheduled scan of the site folder', 'schedule', 'Schedule', 'documents', 1300, true, '1 document filed'],
    [520, 'Scheduled inbox check', 'schedule', 'Schedule', 'inbox', 2400, true, '1 email triaged']
  ].map(([m, label, byId, byName, outcome, ms, ok, message]) => ({ at: iso(m), label, byId, byName, outcome, ms, ok, message })),
  runsPerHour: Array.from({ length: 24 }, (_, i) => Math.round(2 + rand() * 4 + (i > 6 && i < 19 ? 3 : 0))),
  latency: { ftp: Array.from({ length: 12 }, () => Math.round(180 + rand() * 90)), imap: Array.from({ length: 12 }, () => Math.round(150 + rand() * 70)) },
  tests: { folders: { ok: true, message: 'Folder readable: 1,284 item(s)', at: iso(1) }, ftp: { ok: true, message: 'Logged in in 212 ms', at: iso(3) }, imap: { ok: true, message: 'Signed in in 187 ms', at: iso(2) } },
  checked: 0, snapshots: 0
};
let seq = 0;
const POOL = ['A-102_Level3_Plan_RevA.pdf', 'S-210_Roof_Framing.dwg', 'Site_Photo_0413.jpg', 'Inspection_Request_44.pdf', 'Rebar_Delivery_Docket.pdf', 'M-310_Pipework_RevA.pdf'];
const word = { ok: 'OK', failed: 'Failed', skipped: 'Skipped' };
const pushRun = (label, outcome, ms, ok, message, by = { id: 'owner', name: 'Owner' }) => st.runs.unshift({ at: nowIso(), label, byId: by.id, byName: by.name, outcome, ms, ok, message });

// ---------- the four outcome tabs (same shapes as hooks.mjs) ----------
const hourly = (items) => O.hourly(items);
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
const OUTCOME_DATA = { documents: documentsData, transfers: transfersData, inbox: inboxData, 'activity-log': activityData };

// ---------- the demo world (see outcomes.mjs) ----------
const STATE = {
  documents: () => ({ state: 'ok', text: filed() + ' documents filed' }),
  transfers: () => (failedT() ? { state: 'warn', text: failedT() + ' failed transfer' + (failedT() === 1 ? '' : 's') + ' to retry' } : { state: 'ok', text: moved() + ' files transferred' }),
  inbox: () => ({ state: 'ok', text: triaged() + ' emails triaged' }),
  'activity-log': () => ({ state: 'ok', text: logRows() + ' events on record' })
};
const FACTS = {
  documents: () => ({ count: filed(), list: st.arrivals.filter((a) => a.status === 'ok'), rows: st.arrivals.length, last: st.arrivals[0].at }),
  transfers: () => ({ count: moved(), list: st.transfers.filter((t) => t.status === 'ok'), rows: st.transfers.length, last: st.transfers[0].at }),
  inbox: () => ({ count: triaged(), list: st.messages, rows: st.messages.length, last: st.messages[0].at }),
  'activity-log': () => ({ count: logRows(), list: activityEvents(), rows: Math.min(200, activityEvents().length), last: activityEvents()[0].at })
};
const ENDPOINT = { folders: '/Volumes/Projects/Harlow/Incoming', ftp: 'ftp.northbeam.example:21', imap: 'imap.harlowbuild.example:993', database: 'agent.db' };

/** The real state of the keys and services: it is what Keys in Settings and Outside services are for, even in the demo. */
function realSetup() {
  const s = kit.getSettings();
  const conns = kit.connections();
  const updates = kit.readJSON('key-updates.json', {});
  const keys = O.KEYS.map((k) => {
    const value = s[k.key] == null || s[k.key] === '' ? null : String(s[k.key]);
    const test = (conns.find((c) => c.id === k.conn) || {}).test || null;
    const updated = updates[k.key] ? updates[k.key].at : null;
    const src = kit.settingSource(k.key);
    return { ...k, value, source: src === 'settings' ? 'Settings' : src === 'env' ? '.env' : null, updated, status: !value ? 'Missing' : test && (!updated || Date.parse(test.at) >= Date.parse(updated)) ? (test.ok ? 'Valid' : 'Failed') : 'Set' };
  });
  const setup = O.SERVICES.filter((x) => x.outside).map((svc) => {
    const c = conns.find((x) => x.id === svc.id) || { ready: false, missing: [], test: null };
    return { ...svc, ready: c.ready, missing: c.missing.map(O.settingLabel), fields: (svc.fields || []).map((key) => ({ label: O.settingLabel(key), set: !!s[key], source: kit.settingSource(key) === 'settings' ? 'Settings' : kit.settingSource(key) === 'env' ? '.env' : 'Not set' })), test: c.test || null, state: c.ready ? 'ok' : 'idle', stateText: c.ready ? 'Set up' : 'Key missing' };
  });
  return { keys, setup };
}

function world() {
  const now = Date.now();
  const outcomes = {};
  for (const d of O.OUTCOMES) {
    const f = FACTS[d.id]();
    outcomes[d.id] = { source: 'live', configured: true, state: STATE[d.id](), needs: null, missing: [], count: f.count, today: f.list.filter((x) => O.isToday(x.at, now)).length, last: f.last, rows: f.rows };
  }
  const services = O.SERVICES.map((svc) => {
    const latency = svc.id === 'ftp' ? st.latency.ftp[11] : svc.id === 'imap' ? st.latency.imap[11] : svc.id === 'folders' ? 4 : 1;
    return { ...svc, ready: true, missing: [], fields: (svc.fields || []).map((k) => ({ label: O.settingLabel(k), set: true, source: 'Settings' })), endpoint: ENDPOINT[svc.id], test: st.tests[svc.id] || null, latency, state: 'ok', stateText: 'Connected', checkedAt: (st.tests[svc.id] || {}).at || new Date(now).toISOString() };
  });
  const { keys, setup } = realSetup();
  const labels = Array.from({ length: 12 }, (_, i) => (i === 11 ? 'now' : '-' + (11 - i) * 5 + 'm'));
  const hours = hourly([]).labels;
  const handled = hourly([...st.arrivals, ...st.transfers.filter((t) => t.status === 'ok'), ...st.messages]);
  const recent = st.runs.slice(0, 50);
  const w = {
    now, demo: true, demoSwitch: (() => { const d = kit.readJSON('demo.json', null); return { on: d ? !!d.on : true, auto: !d || d.auto === true }; })(), outcomes, services, setup, keys, runs: st.runs,
    success: Math.round((recent.filter((r) => r.ok).length / recent.length) * 100), lastRunAt: st.runs[0].at, problem: null, idle: null, working: 0,
    taskHours: { labels: hours, values: st.runsPerHour }, handledHours: handled,
    latency: { labels, series: [{ name: 'FTP', service: 'ftp', values: st.latency.ftp }, { name: 'IMAP', service: 'imap', values: st.latency.imap }] },
    rowsByPane: {}
  };
  w.rowsByPane = O.rowsOf(w);
  for (const id of Object.values(PANE)) if (id !== PANE.screens) w.rowsByPane[id] = (O.metaPane(id, w, () => true, { admin: true }, {}) || { rows: [] }).rows.length;
  w.rowsByPane[PANE.screens] = (SPEC.panes || []).length;
  return w;
}
// Outside services in the demo: the real setup checklist (it is how the demo is left), with the demo story for the rest.
const demoServices = (w) => ({ ...w, services: [...w.setup, ...w.services.filter((s) => !s.outside)] });

// ---------- the exports ----------
export async function pane(id, ctx = {}) {
  if (OUTCOME_DATA[id]) return OUTCOME_DATA[id]();
  if (!Object.values(PANE).includes(id)) return null;
  const w = world();
  const allow = await allowOf(ctx);
  const opts = { admin: !ctx || !ctx.user || ctx.user.role === 'admin', me: ctx && ctx.user ? ctx.user.id : null };
  return O.metaPane(id, id === PANE.services ? demoServices(w) : w, allow, opts, O.paneStates(w));
}
// The same access rule as the real hooks (a client sees rows only for the outcomes they were given).
async function allowOf(ctx) {
  if (!ctx || !ctx.user || ctx.user.role === 'admin') return () => true;
  if (ctx.user.id === 'preview-client') return () => true;
  const u = kit.users().find((x) => x.id === ctx.user.id && !x.disabled);
  if (!u) return () => false;
  const ids = new Set(kit.allowedPanes(kit.publicUser(u)).map((p) => p.id));
  return (pid) => ids.has(pid);
}

export async function status() { return O.statusOf(world()); }
export async function paneStatus() { const w = world(); return { ...O.paneStates(w), [PANE.services]: O.paneStates(demoServices(w))[PANE.services] }; }

export async function metrics() {
  const w = world();
  const t = (items) => hourly(items).values;
  const meta = O.metaMetrics(w).map((m) => (m.key === 'ready' ? O.metaMetrics(demoServices(w)).find((x) => x.key === 'ready') : m));
  return [
    ...meta,
    { key: 'docsFiled', label: 'Documents filed', value: filed(), unit: '', trend: t(st.arrivals), good: 'up', pane: 'documents' },
    { key: 'docsWaiting', label: 'Files waiting', value: 0, unit: '', trend: [0, 1, 0, 0], good: 'down', pane: 'documents' },
    { key: 'ftpTransfers', label: 'Files transferred', value: moved(), unit: '', trend: t(st.transfers), good: 'up', pane: 'transfers' },
    { key: 'ftpFailed', label: 'Transfer failures', value: failedT(), unit: '', trend: [0, 0, 1, 0, 1], good: 'down', pane: 'transfers' },
    { key: 'emailsProcessed', label: 'Emails triaged', value: triaged(), unit: '', trend: t(st.messages), good: 'up', pane: 'inbox' },
    { key: 'emailBacklog', label: 'Inbox backlog', value: 0, unit: '', trend: [2, 1, 0, 0], good: 'down', pane: 'inbox' },
    { key: 'logRows', label: 'Events on record', value: logRows(), unit: '', trend: [3380, 3392, 3401, 3410, logRows()], good: 'up', pane: 'activity-log' },
    { key: 'dbIntegrity', label: 'Record integrity', value: 100, unit: '%', trend: [100, 100, 100], good: 'up', pane: 'activity-log' }
  ].filter((m) => SPEC.metrics.some((s) => s.key === m.key));
}

export async function panels() {
  const w = world();
  const docs = documentsData(), tr = transfersData(), inb = inboxData(), act = activityData();
  const line = (title, name, b, pane) => ({ title, kind: 'line', labels: b.labels, series: [{ name, values: b.values }], pane });
  const own = {
    'Arrivals, last 24 hours': () => line('Arrivals, last 24 hours', 'Files', docs.hours, 'documents'),
    'Recent arrivals': () => ({ title: 'Recent arrivals', kind: 'table', columns: ['File', 'Folder', 'Event', 'When'], rows: docs.arrivals.slice(0, 12).map((a) => [a.file, a.folder, a.event, rel(a.at)]), pane: 'documents' }),
    'Transfers, last 24 hours': () => line('Transfers, last 24 hours', 'Transfers', tr.hours, 'transfers'),
    'Transfer history': () => ({ title: 'Transfer history', kind: 'table', columns: ['File', 'Direction', 'Result', 'When'], rows: tr.transfers.slice(0, 12).map((t) => [t.file, t.op, t.status === 'failed' ? 'Failed: ' + t.error : word[t.status], rel(t.at)]), pane: 'transfers' }),
    'Triage by rule': () => ({ title: 'Triage by rule', kind: 'bar', labels: inb.byRule.labels, series: [{ name: 'Messages', values: inb.byRule.values }], pane: 'inbox' }),
    'Recent messages': () => ({ title: 'Recent messages', kind: 'table', columns: ['From', 'Subject', 'Result', 'When'], rows: inb.messages.slice(0, 12).map((m) => [m.from, m.subject, m.result + (m.rule ? ': ' + m.rule : ''), rel(m.at)]), pane: 'inbox' }),
    'Events by source': () => ({ title: 'Events by source', kind: 'bar', labels: act.byType.labels, series: [{ name: 'Events', values: act.byType.values }], pane: 'activity-log' }),
    'Latest events': () => ({ title: 'Latest events', kind: 'table', columns: ['Source', 'Result', 'What', 'When'], rows: act.events.slice(0, 12).map((e) => [e.source, e.result, e.what, rel(e.at)]), pane: 'activity-log' })
  };
  const meta = Object.fromEntries([...O.metaPanels(w), O.metaPanels(demoServices(w)).find((p) => p.title === 'Service checklist')].map((p) => [p.title, p]));
  return SPEC.panels.map((p) => (own[p.title] ? own[p.title]() : meta[p.title])).filter(Boolean);
}

// ---------- actions (they add records so the screens respond) ----------
function scan(by) {
  const n = 1 + (seq % 2); const files = [];
  for (let i = 0; i < n; i++) { const file = POOL[seq++ % POOL.length]; files.push(file); st.arrivals.unshift({ file, folder: 'site', event: 'Filed', status: 'ok', at: nowIso(), size: 400000 + seq * 91000, error: null }); }
  const message = 'Scanned 1 folder: ' + n + ' new document' + (n === 1 ? '' : 's') + ' filed (demo)';
  pushRun('Scan site folders', 'documents', 1100 + seq * 70, true, n + ' document' + (n === 1 ? '' : 's') + ' filed', by);
  return { ok: true, message, output: { files } };
}
function sync(by) {
  const file = POOL[seq++ % POOL.length];
  st.transfers.unshift({ file, op: seq % 2 ? 'upload' : 'download', status: 'ok', bytes: 750000 + seq * 53000, monitor: 'site', at: nowIso(), reason: 'new', error: null });
  st.latency.ftp.push(st.latency.ftp.shift());
  pushRun('Sync FTP now', 'transfers', 9000 + seq * 300, true, '1 file transferred, 0 failed', by);
  return { ok: true, message: '1 file transferred, 0 failed (demo)', output: { file } };
}
function check(by) {
  st.checked++;
  st.messages.unshift({ uid: 9041 + st.checked, from: 'Priya Shah <priya@northbeam.example>', subject: 'RFI ' + (122 + st.checked) + ': follow-up on slab edge', status: 'ok', rule: 'rfi', at: nowIso(), result: 'Matched' });
  pushRun('Check inbox now', 'inbox', 1800 + st.checked * 40, true, '1 email triaged', by);
  return { ok: true, message: '1 new email triaged: matched rule rfi (demo)', output: { checked: st.checked } };
}
const record = (by) => { pushRun('Check the record', 'activity-log', 600, true, 'Record integrity check passed', by); return { ok: true, message: 'Record integrity check passed (demo)', output: { tables: activityData().summary.tables } }; };
const DO = { documents: scan, transfers: sync, inbox: check, 'activity-log': record };
const byOf = (ctx) => (ctx && ctx.user ? { id: ctx.user.id, name: ctx.user.name || 'Owner' } : { id: 'owner', name: 'Owner' });
const NOT_YOURS = 'That outcome is not part of your access.';

async function runMine(allow, by) {
  const mine = O.OUTCOMES.filter((o) => o.kind && allow(o.id));
  if (!mine.length) return { ok: false, message: 'None of the outcomes that run are part of your access.' };
  const parts = mine.map((o) => [o, DO[o.id](by)]);
  return { ok: true, message: parts.map(([o, r]) => o.short + ': ' + r.message).join(' · '), output: parts.map(([o, r]) => ({ outcome: o.id, ok: r.ok, demo: true })) };
}
function snapshot() {
  fs.mkdirSync(REPORTS, { recursive: true });
  st.snapshots++;
  const file = 'site-map-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '.md';
  fs.writeFileSync(path.join(REPORTS, file), O.snapshotMarkdown(world()));
  return { ok: true, message: 'Snapshot saved to Reports (demo): ' + O.statusOf(world()).headline, output: { href: 'reports/' + file } };
}

export async function run(id, input, ctx = {}) {
  const allow = await allowOf(ctx); const by = byOf(ctx);
  const o = O.OUTCOMES.find((x) => x.action === id);
  if (o) return allow(o.id) ? DO[o.id](by) : { ok: false, message: NOT_YOURS };
  if (id === 'run') { const r = await runMine(allow, by); return { ...r, message: r.output ? r.output.length + ' task(s) run, 0 failed (demo)' : r.message }; }
  if (id === 'run-outcomes') return runMine(allow, by);
  if (id === 'check-outcomes') {
    const oc = O.outcomesPane(world(), allow);
    return { ok: true, message: oc.items.length + ' outcomes on demo data: ' + oc.items.map((i) => i.tab + ' ' + i.state.text).join(' · '), output: oc.items.map((i) => ({ id: i.id, status: i.status })) };
  }
  if (id === 'snapshot') return snapshot();
  if (id === 'test-connections') return { ok: true, message: 'Demo: Site folder 4 ms · Contractor FTP 212 ms · Project mailbox 187 ms. Enter your own details to test the real services.' };
  if (id === 'run-monitor') {
    const want = String(input || '').trim();
    const map = { 'folder:site': scan, 'ftp:site': sync, 'imap:pm': check };
    if (!want) return { ok: false, message: 'Enter a monitor id, e.g. folder:site' };
    if (!map[want]) return { ok: false, message: 'Unknown monitor "' + want.slice(0, 80) + '". Available: folder:site, ftp:site, imap:pm' };
    return map[want](by);
  }
  return { ok: false, message: 'Unknown action' };
}

const ADMIN_ONLY = 'Only the admin can change settings.';
const real = () => import('./hooks.mjs');   // keys are saved for real even from the demo: that is how you leave it

export async function paneAction(id, action, input, ctx = {}) {
  const inp = input && typeof input === 'object' ? input : {};
  const admin = !ctx || !ctx.user || ctx.user.role === 'admin';
  const allow = await allowOf(ctx); const by = byOf(ctx);
  const fresh = async (r) => ({ ...r, data: await pane(id, ctx) });
  const o = O.outcomeOf(id);
  if (o && o.kind && action === o.verb) return fresh(await run(o.action, null, ctx));
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
    if (action === 'check') return fresh(record(by));
    if (action === 'export') {
      const ev = activityEvents();
      const csv = ['Time,Source,Result,What', ...ev.map((e) => [e.at, e.source, e.result, e.what].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','))].join('\n') + '\n';
      return { ok: true, message: 'Exported ' + ev.length + ' events (demo)', data: { ...activityData(), export: { filename: 'activity-record-demo.csv', csv } } };
    }
  }
  if (id === PANE.outcomes && action === 'check') return fresh(await run('check-outcomes', null, ctx));
  if (id === PANE.history) {
    const target = O.OUTCOMES.find((x) => x.kind && x.verb === action);
    if (target) return fresh(allow(target.id) ? DO[target.id](by) : { ok: false, message: NOT_YOURS });
    if (action === 'run-all') return fresh(await runMine(allow, by));
  }
  if (id === PANE.map && action === 'snapshot') return fresh(snapshot());
  if (id === PANE.screens && action === 'check') { const d = await pane(id, ctx); return { ok: true, message: d.cards.length + ' screens checked: ' + d.summary.ready + ' with data (demo)', data: d }; }
  if (id === PANE.health && (action === 'test' || action === 'test-all')) {
    if (!admin) return { ok: false, message: 'Only the admin can test connections.' };
    const ids = action === 'test-all' ? ['folders', 'ftp', 'imap'] : [String(inp.id || '')];
    if (!ids.every((x) => x === 'database' || st.tests[x])) return { ok: false, message: 'No such connection' };
    for (const x of ids) if (st.tests[x]) st.tests[x] = { ...st.tests[x], at: nowIso() };
    return fresh({ ok: true, message: 'Demo: ' + ids.join(', ') + ' reachable. Enter your own details in Settings to test the real services.' });
  }
  // the real way out of the demo: these change and test the real keys
  if ((id === PANE.keys && (action === 'save-key' || action === 'clear-key')) || (id === PANE.services && (action === 'test' || action === 'test-all')) || (id === PANE.demo && action === 'auto')) {
    const r = await (await real()).paneAction(id, action, input, ctx);
    return { ...r, data: await pane(id, ctx) };
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
  fs.mkdirSync(REPORTS, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const overall = 'overall-state-' + day + '.md';
  if (!fs.existsSync(path.join(REPORTS, overall))) fs.writeFileSync(path.join(REPORTS, overall), O.snapshotMarkdown(world(), 'Overall state, ' + day));
  return fs.readdirSync(REPORTS).filter((f) => /^(overall-state|site-map)-[\w-]+\.md$/.test(f))
    .map((f) => ({ f, at: fs.statSync(path.join(REPORTS, f)).mtime.toISOString() }))
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 30)
    .map(({ f, at }) => ({ title: f.startsWith('site-map') ? 'Site map snapshot (demo)' : 'Overall state, ' + f.slice(14, 24), href: 'reports/' + f, createdAt: at }));
}
