// What this solution delivers to its clients, and the screens built on top of it. Shared by hooks.mjs (real data)
// and demo.mjs (seeded data): both describe the solution as a "world" (below) and these builders turn it into
// each pane's records, metrics, panels and live states, so live and demo screens can never drift apart.
//
// The client outcomes (one tab each): Site documents filed from the watched folder, Contractor file transfers over
// FTP, the Project inbox triaged over IMAP, and the Activity record kept on this Mac. The other tabs look across
// those outcomes: Client outcomes, Action history, Site map, Screens, Demo data, Outside services, Connection
// health and Keys in Settings.
//
// Access rule used everywhere: a signed-in client sees rows only for the outcomes (tabs) they were given. Panels
// and metrics (shared by every user of a pane) carry counts, never records.
//
// world = {
//   now, demo,                                   // demo: the whole build is the demo build
//   demoSwitch: { on, auto },                    // the dashboard-wide demo switch
//   outcomes: { <id>: { source: 'live'|'demo', configured, state: { state, text }, count, today, last, rows, needs, missing: [labels] } },
//   services: [{ id, name, summary, docs, outcome, outside, ready, missing, fields: [{ label, set, source }], endpoint, test, latency, state, stateText, checkedAt }],
//   keys: [{ key, label, conn, outcome, secret, value, source, updated, status }],
//   runs: [{ at, label, byId, byName, outcome, ms, ok, message }],     // newest first
//   taskHours: { labels, values }, handledHours: { labels, values },
//   latency: { labels, series: [{ name, values }] },
//   success, lastRunAt, rowsByPane: { <pane id>: n }
// }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'dashboard.json'), 'utf8'));

export const PANE = {
  outcomes: 're-plan-this-solution-from-wha', history: 'working-actions', map: 'a-futuristic-overview-visual-s', screens: 'give-each-tab-a-real-screen',
  demo: 'demo-data-until-keys-are-set', services: 'connections-for-every-outside-', health: 'connections-for-every-outside', keys: 'keys-entered-in-settings'
};

export const OUTCOMES = [
  { id: 'documents', title: 'Site documents', short: 'Documents', outcome: 'Site drawings filed on arrival', fedBy: 'Site folder watcher', connection: 'folders', kind: 'folder', action: 'scan-folders', verb: 'scan', button: 'Scan site folders', one: 'document filed', many: 'documents filed', live: 'the site folder is saved in Keys in Settings' },
  { id: 'transfers', title: 'Contractor file transfers', short: 'Transfers', outcome: 'Contractor files mirrored offsite', fedBy: 'Contractor FTP sync', connection: 'ftp', kind: 'ftp', action: 'sync-ftp', verb: 'sync', button: 'Sync FTP now', one: 'file transferred', many: 'files transferred', live: 'the FTP host, user and password are saved' },
  { id: 'inbox', title: 'Project inbox', short: 'Inbox', outcome: 'RFIs and invoices triaged from the inbox', fedBy: 'Project mailbox (IMAP)', connection: 'imap', kind: 'imap', action: 'check-inbox', verb: 'check', button: 'Check inbox now', one: 'email triaged', many: 'emails triaged', live: 'the mailbox host, user and password are saved' },
  { id: 'activity-log', title: 'Activity record', short: 'Record', outcome: 'Every action traceable', fedBy: 'Activity record on this Mac', connection: null, kind: null, action: 'check-database', verb: 'check', button: 'Check the record', one: 'event on record', many: 'events on record', live: 'the agent runs on this Mac (the demo switch goes off)' }
];
export const OUTCOME_IDS = OUTCOMES.map((o) => o.id);
export const outcomeOf = (id) => OUTCOMES.find((o) => o.id === id) || null;
export const outcomeOfKind = (kind) => OUTCOMES.find((o) => o.kind === kind) || null;

// The outside services (dashboard.json "connections") plus the local record, as cards.
export const SERVICES = [
  ...(SPEC.connections || []).map((c) => ({ id: c.id, name: c.name, summary: c.summary || '', docs: c.docs || '', outcome: (OUTCOMES.find((o) => o.connection === c.id) || {}).id || null, outside: true, fields: c.fields || [] })),
  { id: 'database', name: 'Activity record database', summary: 'The SQLite record on this Mac: every scan, transfer and email, kept for good.', docs: '', outcome: 'activity-log', outside: false, fields: [] }
];
const SETTING = Object.fromEntries((SPEC.settings || []).map((s) => [s.key, s]));
// Every key or login an outside service needs, in the order the owner enters them.
export const KEYS = (SPEC.connections || []).flatMap((c) => (c.fields || []).map((k) => ({
  key: k, label: (SETTING[k] && SETTING[k].label) || k, conn: c.id, service: c.name, outcome: (OUTCOMES.find((o) => o.connection === c.id) || {}).id || null, secret: !!(SETTING[k] && SETTING[k].type === 'secret')
})));
export const settingLabel = (k) => (SETTING[k] && SETTING[k].label) || k;

// What each screen is, for the Screens tab.
export const SCREENS = {
  [PANE.outcomes]: ['Outcome table with a coverage rail', ['Check every outcome']],
  documents: ['Arrivals file list with the watched folder', ['Scan site folders', 'Save folder']],
  transfers: ['Transfer timeline with sync direction', ['Sync FTP now', 'Direction']],
  inbox: ['Message queue with triage rules', ['Check inbox now', 'Add rule']],
  'activity-log': ['Filterable event ledger', ['Check the record', 'Export CSV']],
  [PANE.history]: ['Run buttons over the history', ['Scan', 'Sync', 'Check']],
  [PANE.map]: ['Live site map of every outcome', ['Save a snapshot']],
  [PANE.screens]: ['A card per screen', ['Check every screen']],
  [PANE.demo]: ['Live and demo rows per screen', ['Go live where keys are set']],
  [PANE.services]: ['A setup checklist per service', ['Test']],
  [PANE.health]: ['Service cards with latency', ['Test', 'Test all']],
  [PANE.keys]: ['Stored keys with a replace form', ['Save and test', 'Clear']]
};

// ---------- small helpers ----------
export const rel = (iso, now = Date.now()) => {
  if (!iso) return 'never';
  const m = Math.max(0, Math.round((now - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.floor(m / 60) + ' h ago' : Math.floor(m / 1440) + ' d ago';
};
export const clock = (iso) => { const d = new Date(iso); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
const startOfDay = (now) => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const isToday = (iso, now = Date.now()) => Date.parse(iso) >= startOfDay(now);

/** 24 hourly buckets, oldest first, ending now. items: ISO strings or { at } / { timestamp }. */
export function hourly(items, now = Date.now()) {
  const values = new Array(24).fill(0);
  for (const r of items) {
    const t = Date.parse(typeof r === 'string' ? r : r.at || r.timestamp);
    const age = Math.floor((now - t) / 3600000);
    if (age >= 0 && age < 24) values[23 - age]++;
  }
  return { labels: values.map((_, i) => (i === 23 ? 'now' : '-' + (23 - i) + 'h')), values };
}

/** 12 five-minute buckets over the last hour: the average of each series' samples [{ at, ms }]. */
export function lastHour(seriesIn, now = Date.now()) {
  const labels = Array.from({ length: 12 }, (_, i) => (i === 11 ? 'now' : '-' + (11 - i) * 5 + 'm'));
  const series = seriesIn.map(({ name, service, samples }) => {
    const sum = new Array(12).fill(0), n = new Array(12).fill(0);
    for (const s of samples) { const age = Math.floor((now - Date.parse(s.at)) / 300000); if (age >= 0 && age < 12 && Number.isFinite(s.ms)) { sum[11 - age] += s.ms; n[11 - age]++; } }
    return { name, service, values: sum.map((v, i) => (n[i] ? Math.round(v / n[i]) : 0)) };
  });
  return { labels, series };
}

/** A key's value as a given user may see it: clients only learn whether it is set; secrets show their last 4 to the admin. */
export function mask(value, secret, admin) {
  const v = value == null ? '' : String(value);
  if (!v) return 'Not set';
  if (!admin) return 'Set';
  if (!secret) return v;
  return v.length >= 8 ? '••••••••' + v.slice(-4) : '••••••••';
}

/** Which outcome a dashboard run belongs to (runs.jsonl): its tab, or the outcome its button works on. */
export function outcomeOfRun(rec) {
  if (!rec) return null;
  if (OUTCOME_IDS.includes(rec.pane)) return rec.pane;
  const a = String(rec.action || '');
  const verb = a.includes(':') ? a.slice(a.indexOf(':') + 1) : a;
  const byVerb = { scan: 'documents', sync: 'transfers', check: 'inbox', 'scan-folders': 'documents', 'sync-ftp': 'transfers', 'check-inbox': 'inbox', 'check-database': 'activity-log' };
  return rec.pane === PANE.history || !a.includes(':') ? byVerb[verb] || null : null;
}

/** Actions from dashboard.json, each tagged with the pane that lists it (Overview when none does). */
export function actionsFromSpec() {
  return (SPEC.actions || []).map((a) => {
    const pane = (SPEC.panes || []).find((p) => (p.actions || []).includes(a.id));
    return { id: a.id, label: a.label, description: a.description || '', input: a.input || null, pane: pane ? pane.id : 'overview', ...(a.adminOnly ? { adminOnly: true } : {}) };
  });
}
export const paneTitle = (id) => ((SPEC.panes || []).find((p) => p.id === id) || {}).title || id;
const all = () => true;

// ---------- words for states ----------
const WORD = { ok: 'Live', warn: 'Needs a look', bad: 'Failing', idle: 'Waiting' };
export function outcomeWord(o) { return o.source === 'demo' ? 'Demo data' : WORD[o.state.state] || 'Waiting'; }
const toneOf = (o) => (o.source === 'demo' ? 'demo' : o.state.state === 'idle' ? '' : o.state.state);

// ---------- per-pane records ----------
export function outcomesPane(w, allow = all) {
  const mine = OUTCOMES.filter((o) => allow(o.id));
  const items = mine.map((d) => {
    const o = w.outcomes[d.id];
    return { id: d.id, outcome: d.outcome, fedBy: d.fedBy, tab: d.title, status: outcomeWord(o), tone: toneOf(o), state: o.state, last: o.last, count: o.count, today: o.today, label: o.count === 1 ? d.one : d.many, needs: o.source === 'demo' ? o.needs : null, missing: o.missing || [] };
  });
  const live = items.filter((i) => i.status !== 'Demo data');
  return {
    source: w.demo ? 'demo' : 'live', columns: ['Outcome', 'Fed by', 'Tab', 'Status', 'Last delivered'],
    rows: items.map((i) => [i.outcome, i.fedBy, i.tab, i.status, i.last ? rel(i.last, w.now) : i.needs ? 'Waiting for key' : 'Not yet']),
    items, hidden: OUTCOMES.length - mine.length,
    metrics: { delivered: live.filter((i) => i.state.state === 'ok' || i.state.state === 'warn').length, total: items.length, livePct: items.length ? Math.round((live.length / items.length) * 100) : 0 },
    coverage: { labels: items.map((i) => outcomeOf(i.id).short), values: items.map((i) => i.today) },
    needsKey: items.filter((i) => i.needs).map((i) => ({ outcome: i.tab, missing: i.missing.length ? i.missing.join(', ') : i.needs }))
  };
}

const byWord = (r, me, admin) => (r.byId === 'schedule' ? 'Schedule' : admin ? r.byName || 'Owner' : r.byId === me ? 'You' : r.byId === 'owner' ? 'Owner' : 'Another user');

export function historyPane(w, allow = all, { admin = true, me = null } = {}) {
  const runs = w.runs.filter((r) => (r.outcome ? allow(r.outcome) : admin));
  const today = runs.filter((r) => isToday(r.at, w.now));
  const durations = today.slice(0, 16).reverse();
  return {
    source: w.demo ? 'demo' : 'live', columns: ['Action', 'Started by', 'Started', 'Duration', 'Result'],
    rows: runs.slice(0, 60).map((r) => [r.label, byWord(r, me, admin), clock(r.at), (r.ms / 1000).toFixed(1) + ' s', r.message]),
    runs: runs.slice(0, 60).map((r) => ({ ...r, by: byWord(r, me, admin), outcomeTitle: r.outcome ? outcomeOf(r.outcome).title : null })),
    buttons: OUTCOMES.filter((o) => o.kind && allow(o.id)).map((o) => ({ verb: o.verb, label: o.button, outcome: o.id, title: o.title, source: w.outcomes[o.id].source })),
    summary: { runsToday: today.length, failedToday: today.filter((r) => !r.ok).length, avgS: today.length ? Math.round((today.reduce((a, r) => a + r.ms, 0) / today.length) / 100) / 10 : 0, last: runs[0] ? runs[0].at : null },
    durations: { labels: durations.map((r) => clock(r.at)), values: durations.map((r) => Math.round(r.ms / 100) / 10) }
  };
}

export function screensPane(w, allow = all, states = {}) {
  const cards = (SPEC.panes || []).filter((p) => allow(p.id)).map((p) => {
    const o = w.outcomes[p.id];
    const rows = w.rowsByPane[p.id] || 0;
    const data = o ? (o.source === 'demo' ? 'Demo' : rows ? 'Live' : 'Empty') : w.demo ? 'Demo' : rows ? 'Live' : 'Empty';
    const [main, actions] = SCREENS[p.id] || ['Records', []];
    return { id: p.id, title: p.title, layout: p.layout || 'grid', main, actions, data, rows, state: states[p.id] || null, summary: p.summary || '' };
  });
  return {
    source: w.demo ? 'demo' : 'live', columns: ['Screen', 'Layout', 'Main view', 'Actions', 'Data'],
    rows: cards.map((c) => [c.title, c.layout[0].toUpperCase() + c.layout.slice(1), c.main, c.actions.join(', '), c.data]),
    cards, summary: { ready: cards.filter((c) => c.data !== 'Empty').length, empty: cards.filter((c) => c.data === 'Empty').length, total: cards.length }
  };
}

export function demoPane(w, allow = all) {
  const mine = OUTCOMES.filter((o) => allow(o.id));
  const items = mine.map((d) => {
    const o = w.outcomes[d.id];
    const demo = w.demo || o.source === 'demo';
    return { id: d.id, screen: d.title, source: demo ? 'Demo sample' : 'Live', rows: o.rows, live: demo ? 0 : o.rows, demo: demo ? o.rows : 0, when: demo ? 'Live when ' + d.live : '—' };
  });
  return {
    source: w.demo ? 'demo' : 'live', columns: ['Screen', 'Source', 'Rows shown', 'Switches to live when'],
    rows: items.map((i) => [i.screen, i.source, i.rows, i.when]), items, switch: w.demoSwitch,
    summary: { onDemo: items.filter((i) => i.source !== 'Live').length, live: items.filter((i) => i.source === 'Live').length, total: items.length }
  };
}

export function servicesPane(w, allow = all, { admin = true } = {}) {
  const cards = w.services.filter((s) => s.outside && (!s.outcome || allow(s.outcome))).map((s) => ({
    id: s.id, name: s.name, summary: s.summary, docs: s.docs, feeds: s.outcome ? outcomeOf(s.outcome).title : '—', ready: s.ready, missing: s.missing,
    fields: s.fields.map((f) => ({ label: f.label, set: f.set, source: admin ? f.source : f.set ? 'Saved' : '' })), test: s.test, state: s.state, stateText: s.stateText
  }));
  return {
    source: w.demo ? 'demo' : 'live', columns: ['Service', 'Feeds', 'Needs', 'Source', 'Last test'],
    rows: cards.map((c) => [c.name, c.feeds, c.missing.length ? c.missing.join(', ') : 'Nothing', c.fields.every((f) => f.set) ? (admin ? [...new Set(c.fields.map((f) => f.source))].join(' + ') : 'Saved') : 'Not set', c.test ? (c.test.ok ? 'Passed ' : 'Failed ') + rel(c.test.at, w.now) : 'Not tested']),
    cards, summary: { ready: cards.filter((c) => c.ready).length, total: cards.length }
  };
}

export function healthPane(w, allow = all) {
  const cards = w.services.filter((s) => !s.outcome || allow(s.outcome)).map((s) => ({ id: s.id, name: s.name, endpoint: s.endpoint || 'Not set', state: s.state, stateText: s.stateText, latency: s.latency, checkedAt: s.checkedAt, outside: s.outside, ready: s.ready }));
  return {
    source: w.demo ? 'demo' : 'live', columns: ['Service', 'Endpoint', 'State', 'Latency', 'Last checked'],
    rows: cards.map((c) => [c.name, c.endpoint, c.stateText, c.latency == null ? '—' : c.latency + ' ms', c.checkedAt ? rel(c.checkedAt, w.now) : 'Never']),
    cards, latency: { labels: w.latency.labels, series: w.latency.series.filter((s) => cards.some((c) => c.id === s.service)) },
    summary: { up: cards.filter((c) => c.state === 'ok').length, total: cards.length, avgMs: avgLatency(cards) }
  };
}
const avgLatency = (cards) => { const l = cards.filter((c) => c.outside && Number.isFinite(c.latency)); return l.length ? Math.round(l.reduce((a, c) => a + c.latency, 0) / l.length) : 0; };

export function keysPane(w, allow = all, { admin = true } = {}) {
  const keys = w.keys.filter((k) => !k.outcome || allow(k.outcome)).map((k) => ({ key: k.key, label: k.label, usedBy: k.service, value: mask(k.value, k.secret, admin), set: !!k.value, secret: k.secret, updated: k.updated, status: k.status, source: admin ? k.source : null }));
  return {
    source: w.demo ? 'demo' : 'live', columns: ['Key', 'Used by', 'Value', 'Updated', 'Status'],
    rows: keys.map((k) => [k.label, k.usedBy, k.value, k.updated ? new Date(k.updated).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—', k.status]),
    keys, canEdit: admin, summary: { set: keys.filter((k) => k.set).length, total: keys.length }
  };
}

export function mapPane(w, allow = all, states = {}) {
  const st = statusOf(w);
  const panes = (SPEC.panes || []).filter((p) => allow(p.id)).map((p) => ({ id: p.id, title: p.title, outcome: OUTCOME_IDS.includes(p.id), state: states[p.id] || null }));
  const mine = OUTCOMES.filter((o) => allow(o.id));
  return {
    source: w.demo ? 'demo' : 'live', columns: ['Outcome', 'State', 'Primary number', 'Updated'],
    rows: mine.map((d) => { const o = w.outcomes[d.id]; return [d.title, outcomeWord(o), plural(o.count, d.one, d.many), o.last ? rel(o.last, w.now) : '—']; }),
    status: st, panes, success: w.success, lastRunAt: w.lastRunAt, hours: w.taskHours, demo: !!w.demo
  };
}

export function rowsOf(w) {
  return Object.fromEntries(Object.entries(w.outcomes).map(([id, o]) => [id, o.rows]));
}

// ---------- states for the Overview centrepiece and the sidebar ----------
export function paneStates(w) {
  const out = {};
  for (const d of OUTCOMES) { const o = w.outcomes[d.id]; out[d.id] = { ...o.state, ...(o.source === 'demo' || w.demo ? { demo: true } : {}) }; }
  const oc = outcomesPane(w);
  const bad = oc.items.filter((i) => i.state.state === 'bad');
  out[PANE.outcomes] = bad.length ? { state: 'bad', text: bad.map((i) => i.tab).join(', ') + ' failing' } : oc.needsKey.length ? { state: 'warn', text: plural(oc.needsKey.length, 'outcome waits', 'outcomes wait') + ' for a key' } : { state: 'ok', text: plural(oc.metrics.delivered, 'outcome', 'outcomes') + ' delivered' };
  const hi = historyPane(w);
  out[PANE.history] = hi.summary.failedToday ? { state: 'warn', text: plural(hi.summary.failedToday, 'failed run', 'failed runs') + ' today' } : hi.summary.runsToday ? { state: 'ok', text: plural(hi.summary.runsToday, 'run', 'runs') + ' today' } : { state: 'idle', text: 'No runs yet today' };
  const st = statusOf(w);
  out[PANE.map] = { state: st.mood === 'bad' ? 'bad' : st.mood === 'wait' ? 'warn' : 'ok', text: st.headline + (w.success == null ? '' : ' · ' + w.success + '% success') };
  const sc = screensPane(w);
  out[PANE.screens] = sc.summary.empty ? { state: 'warn', text: plural(sc.summary.empty, 'screen has', 'screens have') + ' no data yet' } : { state: 'ok', text: plural(sc.summary.ready, 'screen', 'screens') + ' with data' };
  const de = demoPane(w);
  out[PANE.demo] = de.summary.onDemo ? { state: 'warn', text: plural(de.summary.onDemo, 'screen', 'screens') + ' on demo data', demo: true } : { state: 'ok', text: 'Everything is live' };
  const sv = servicesPane(w);
  out[PANE.services] = sv.summary.ready === sv.summary.total ? { state: 'ok', text: 'All ' + sv.summary.total + ' services set up' } : { state: sv.summary.ready ? 'warn' : 'idle', text: sv.summary.ready + ' of ' + sv.summary.total + ' services set up' };
  const he = healthPane(w);
  const down = he.cards.filter((c) => c.state === 'bad');
  out[PANE.health] = down.length ? { state: 'bad', text: down.map((c) => c.name).join(', ') + ' unreachable' } : { state: he.summary.up ? (he.summary.up === he.summary.total ? 'ok' : 'warn') : 'idle', text: he.summary.up + ' of ' + he.summary.total + ' connected' };
  const ke = keysPane(w);
  const failedKey = ke.keys.find((k) => k.status === 'Failed');
  out[PANE.keys] = failedKey ? { state: 'bad', text: failedKey.label + ' was rejected' } : ke.summary.set === ke.summary.total ? { state: 'ok', text: 'All ' + ke.summary.total + ' keys set' } : { state: ke.summary.set ? 'warn' : 'idle', text: ke.summary.set + ' of ' + ke.summary.total + ' keys set' };
  return out;
}

/** The headline state of the whole solution (the Overview centrepiece). Counts only: Overview is shared by everyone. */
export function statusOf(w) {
  const os = OUTCOMES.map((d) => w.outcomes[d.id]);
  const failing = os.filter((o) => o.state.state === 'bad').length;
  const warn = os.filter((o) => o.state.state === 'warn').length;
  const demo = os.filter((o) => o.source === 'demo').length;
  const live = os.filter((o) => o.source !== 'demo' && o.configured).length;
  const runsToday = w.runs.filter((r) => isToday(r.at, w.now)).length;
  const lastMin = w.lastRunAt ? Math.max(0, Math.round((w.now - Date.parse(w.lastRunAt)) / 60000)) : null;
  let mood = 'ok', headline = 'Healthy', detail = live + ' of ' + os.length + ' outcomes live' + (demo ? ', ' + demo + ' on demo data' : '');
  if (w.problem) { mood = 'bad'; headline = w.problem.headline; detail = w.problem.detail; }
  else if (failing) { mood = 'bad'; headline = 'Failing'; detail = plural(failing, 'outcome is', 'outcomes are') + ' failing; open the Site map'; }
  else if (w.idle) { mood = 'wait'; headline = w.idle.headline; detail = w.idle.detail; }
  else if (warn) { mood = 'wait'; headline = 'Needs a look'; detail = plural(warn, 'outcome needs', 'outcomes need') + ' a look'; }
  else if (w.working) { mood = 'run'; headline = 'Working'; detail = plural(w.working, 'task', 'tasks') + ' running now'; }
  else if (w.demo) { detail = 'Demo data: ' + detail; }
  return {
    mood, headline, detail, primary: { label: 'Success rate', value: w.success == null ? '–' : w.success + '%' },
    ring: [{ label: 'Runs today', value: runsToday }, { label: 'Success', value: w.success == null ? '–' : w.success + '%' }, { label: 'Last run', value: lastMin == null ? 'never' : lastMin < 1 ? 'now' : lastMin < 60 ? lastMin + 'm' : Math.floor(lastMin / 60) + 'h' }]
  };
}

// ---------- metrics and panels of the cross-outcome tabs (counts only) ----------
export function metaMetrics(w) {
  const oc = outcomesPane(w), hi = historyPane(w), sc = screensPane(w), de = demoPane(w), sv = servicesPane(w), he = healthPane(w), ke = keysPane(w);
  const errHours = hourly(w.runs.filter((r) => !r.ok), w.now).values;
  const lastMin = w.lastRunAt ? Math.max(0, Math.round((w.now - Date.parse(w.lastRunAt)) / 60000)) : 0;
  const runHours = hourly(w.runs, w.now).values;
  return [
    { key: 'errors', label: 'Errors', value: errHours.reduce((a, b) => a + b, 0), unit: '', trend: errHours, good: 'down', pane: 'overview' },
    { key: 'activeTasks', label: 'Working now', value: w.working || 0, unit: '', trend: [w.working || 0], good: 'down', pane: 'overview' },
    { key: 'outcomes', label: 'Outcomes delivered', value: oc.metrics.delivered, unit: '', trend: [oc.metrics.delivered], good: 'up', pane: PANE.outcomes },
    { key: 'live', label: 'Running on live data', value: oc.metrics.livePct, unit: '%', trend: [oc.metrics.livePct], good: 'up', pane: PANE.outcomes },
    { key: 'runs', label: 'Runs today', value: hi.summary.runsToday, unit: '', trend: runHours, good: 'up', pane: PANE.history },
    { key: 'failed', label: 'Failed', value: hi.summary.failedToday, unit: '', trend: errHours, good: 'down', pane: PANE.history },
    { key: 'avg', label: 'Avg duration', value: hi.summary.avgS, unit: 's', trend: hi.durations.values.length ? hi.durations.values : [0], good: 'down', pane: PANE.history },
    { key: 'success', label: 'Success rate', value: w.success == null ? 0 : w.success, unit: '%', trend: [w.success == null ? 0 : w.success], good: 'up', pane: PANE.map },
    { key: 'last', label: 'Last run', value: lastMin, unit: 'min', trend: [lastMin], good: 'down', pane: PANE.map },
    { key: 'screens', label: 'Screens ready', value: sc.summary.ready, unit: '', trend: [sc.summary.ready], good: 'up', pane: PANE.screens },
    { key: 'empty', label: 'Screens without data', value: sc.summary.empty, unit: '', trend: [sc.summary.empty], good: 'down', pane: PANE.screens },
    { key: 'demo', label: 'Screens on demo data', value: de.summary.onDemo, unit: '', trend: [de.summary.onDemo], good: 'down', pane: PANE.demo },
    { key: 'ready', label: 'Services set up', value: sv.summary.ready, unit: '', trend: [sv.summary.ready], good: 'up', pane: PANE.services },
    { key: 'up', label: 'Connected', value: he.summary.up, unit: '', trend: [he.summary.up], good: 'up', pane: PANE.health },
    { key: 'latency', label: 'Avg service latency', value: he.summary.avgMs, unit: 'ms', trend: w.latency.series.length ? w.latency.series[0].values : [0], good: 'down', pane: PANE.health },
    { key: 'set', label: 'Keys set', value: ke.summary.set, unit: '', trend: [ke.summary.set], good: 'up', pane: PANE.keys }
  ];
}

export function metaPanels(w) {
  const oc = outcomesPane(w), hi = historyPane(w, all, { admin: false }), sc = screensPane(w), de = demoPane(w), sv = servicesPane(w, all, { admin: false }), he = healthPane(w), ke = keysPane(w, all, { admin: false });
  const line = (title, name, b, pane) => ({ title, kind: 'line', labels: b.labels, series: [{ name, values: b.values }], pane });
  return [
    line('Activity', 'Items handled', w.handledHours, 'overview'),
    { title: 'Latest results', kind: 'table', columns: ['Item', 'Status', 'Updated'], rows: hi.runs.slice(0, 8).map((r) => [r.label, (r.ok ? '✓ ' : '✕ ') + r.message, rel(r.at, w.now)]), pane: PANE.history },
    { title: 'Coverage by outcome', kind: 'bar', labels: oc.coverage.labels, series: [{ name: 'Items handled today', values: oc.coverage.values }], pane: PANE.outcomes },
    { title: 'Needs a key', kind: 'list', columns: ['Outcome', 'Missing'], rows: oc.needsKey.map((n) => [n.outcome, n.missing]), pane: PANE.outcomes },
    { title: 'Screen readiness', kind: 'table', columns: sc.columns, rows: sc.rows, pane: PANE.screens },
    line('Run durations, today', 'Seconds', hi.durations, PANE.history),
    { title: 'Action history', kind: 'table', columns: hi.columns, rows: hi.rows.slice(0, 12), pane: PANE.history },
    { title: 'Latency, last hour', kind: 'line', labels: w.latency.labels, series: w.latency.series.map((s) => ({ name: s.name, values: s.values })), pane: PANE.health },
    { title: 'Connection cards', kind: 'list', columns: ['Service', 'State'], rows: he.cards.map((c) => [c.name, c.stateText]), pane: PANE.health },
    { title: 'Add or replace a key', kind: 'list', columns: ['Key', 'Value', 'Save and test'], rows: ke.keys.map((k) => [k.label, k.value, k.status]), pane: PANE.keys },
    { title: 'Live vs demo rows by screen', kind: 'bar', labels: de.items.map((i) => outcomeOf(i.id).short), series: [{ name: 'Live', values: de.items.map((i) => i.live) }, { name: 'Demo', values: de.items.map((i) => i.demo) }], pane: PANE.demo },
    { title: 'Data source by screen', kind: 'table', columns: de.columns, rows: de.rows, pane: PANE.demo },
    line('Runs, last 24 hours', 'Runs', w.taskHours, PANE.map),
    { title: 'Service checklist', kind: 'list', columns: ['Service', 'Needs'], rows: sv.cards.map((c) => [c.name, c.missing.length ? c.missing.join(', ') : 'Nothing: set up']), pane: PANE.services }
  ];
}

/** The pane data for a cross-outcome tab, for one user. */
export function metaPane(id, w, allow, opts, states) {
  if (id === PANE.outcomes) return outcomesPane(w, allow);
  if (id === PANE.history) return historyPane(w, allow, opts);
  if (id === PANE.map) return mapPane(w, allow, states);
  if (id === PANE.screens) return screensPane(w, allow, states);
  if (id === PANE.demo) return demoPane(w, allow);
  if (id === PANE.services) return servicesPane(w, allow, opts);
  if (id === PANE.health) return healthPane(w, allow);
  if (id === PANE.keys) return keysPane(w, allow, opts);
  return null;
}

/** The overall-state report written to Reports. Reports are shared with every signed-in user, so counts only. */
export function snapshotMarkdown(w, title = 'Site map snapshot') {
  const st = statusOf(w);
  const os = OUTCOMES.map((d) => w.outcomes[d.id]);
  return ['# ' + title + (w.demo ? ' (demo data)' : ''), 'Taken ' + new Date(w.now).toISOString(), '',
    '- State: ' + st.headline + ' (' + st.detail + ')', '- Success rate: ' + (w.success == null ? 'no runs yet' : w.success + '%'),
    '- Runs today: ' + st.ring[0].value, '- Last run: ' + st.ring[2].value,
    '- Outcomes live: ' + os.filter((o) => o.source !== 'demo' && o.state.state === 'ok').length + ' of ' + os.length,
    '- Outcomes needing a look: ' + os.filter((o) => o.state.state === 'warn' || o.state.state === 'bad').length,
    '- Outcomes on demo data: ' + os.filter((o) => o.source === 'demo').length, '',
    'Per-outcome detail stays in each outcome\'s own tab, where access is checked.', ''].join('\n');
}
