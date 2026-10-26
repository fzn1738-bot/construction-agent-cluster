// Workflow automation (RPA) engine: Record mode -> editable workflows -> Run mode, with schedules, triggers,
// per-client isolation and a run history. Pure Node, no network of its own: the thing that actually clicks and types
// is a "driver" (an automation agent over HTTP, or the demo driver), so the whole engine is testable offline.
//
//   const store = new RpaStore({ file, driver, settings });
//   const s = store.startRecording(scope, { name }); store.recordEvent(scope, s.id, { kind: 'click', target: 'Save' });
//   const wf = store.saveRecording(scope, s.id, { name: 'Raise PO' });
//   const run = store.startRun(scope, wf.id, { values: { po_number: 'PO-1' } }); await store.whenIdle(run.id);
//
// scope = { admin: true } sees every client; scope = { admin: false, client: '<user id>' } sees only its own records.
import fs from 'node:fs';
import path from 'node:path';

export class RpaError extends Error {
  constructor(code, message) { super(message); this.name = 'RpaError'; this.code = code; }
}
const fail = (code, message) => { throw new RpaError(code, message); };

export const KINDS = ['click', 'type', 'select', 'key', 'navigate', 'app'];
export const BUILTIN_VARS = { login_user: { label: 'Login user (from Connections)', secret: true }, login_password: { label: 'Login password (from Connections)', secret: true } };
const VAR_RE = /^[a-z][a-z0-9_]{0,31}$/i;
const REF_RE = /\{\{\s*([a-z][a-z0-9_]{0,31})\s*\}\}/gi;
const SENSITIVE_RE = /(^|[^a-z])(pass(word|code|wd)?|pwd|secret|token|api[-_ ]?key|card( number)?|cvv|cvc|iban|ssn|otp|pin)([^a-z]|$)/i;
const SHOT_RE = /^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/;
export const MAX_SHOT = 1500000;   // a 1280-px JPEG from the desktop agent is ~100–300 KB; this leaves room for a full screen
const SHOT_EXT = { png: 'png', jpeg: 'jpg', webp: 'webp', 'svg+xml': 'svg' };
const MASK = '••••';

const cut = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);
const clone = (o) => JSON.parse(JSON.stringify(o));
const slug = (s) => cut(s, 40).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'v$1') || 'field';

/** Strip the query string and fragment of a page address: they often carry tokens. */
export function cleanPage(p) {
  const s = cut(p, 300);
  if (!s) return '';
  return s.replace(/[?#].*$/, '');
}
export function isSensitive(ev) {
  return ev.sensitive === true || String(ev.inputType || '').toLowerCase() === 'password' || SENSITIVE_RE.test(String(ev.target || '') + ' ' + String(ev.field || ''));
}
export const validShot = (s) => typeof s === 'string' && s.length <= MAX_SHOT && SHOT_RE.test(s);
export const refsIn = (text) => [...String(text ?? '').matchAll(REF_RE)].map((m) => m[1].toLowerCase());

/**
 * An illustration (SVG) of a step. Only the seeded demo uses it, to show what a captured screen looks like: the engine
 * never puts one in place of a missing capture, so a step without a real screenshot says so.
 */
export function renderShot(step, state = 'ok') {
  const FONT = 'ui-sans-serif, -apple-system, SF Pro Text, Segoe UI, sans-serif';
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const bad = state === 'failed', wait = state === 'waiting';
  const edge = bad ? '#b32a2a' : wait ? '#8a5200' : '#1b5fc1';
  const title = esc(cut(step.app || step.page || 'Application', 36));
  const label = esc(cut(step.name || step.target || step.kind, 34));
  const note = bad ? 'Target not found' : wait ? 'Waiting for approval' : esc(cut(step.kind, 12));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" width="320" height="200">'
    + '<rect width="320" height="200" fill="#f1f6fa"/><rect width="320" height="26" fill="#cfdce7"/>'
    + '<circle cx="14" cy="13" r="4" fill="#566879"/><circle cx="28" cy="13" r="4" fill="#566879"/><circle cx="42" cy="13" r="4" fill="#566879"/>'
    + '<text x="60" y="18" font-family="' + FONT + '" font-size="12" fill="#14212e">' + title + '</text>'
    + '<rect x="20" y="44" width="150" height="10" rx="3" fill="#cfdce7"/><rect x="20" y="64" width="280" height="10" rx="3" fill="#dbe8f8"/>'
    + '<rect x="20" y="84" width="220" height="10" rx="3" fill="#cfdce7"/><rect x="20" y="104" width="260" height="10" rx="3" fill="#dbe8f8"/>'
    + '<rect x="20" y="134" width="150" height="34" rx="8" fill="#ffffff" stroke="' + edge + '" stroke-width="3"/>'
    + '<text x="32" y="155" font-family="' + FONT + '" font-size="12" font-weight="600" fill="#0b1620">' + label + '</text>'
    + '<text x="20" y="191" font-family="' + FONT + '" font-size="12" fill="' + edge + '">' + note + '</text></svg>';
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

/** Human name for a step from what was recorded. */
export function autoName(e) {
  const t = e.target ? '"' + cut(e.target, 40) + '"' : 'the screen';
  switch (e.kind) {
    case 'click': return 'Click ' + t;
    case 'type': return 'Type into ' + t;
    case 'select': return 'Choose ' + (e.value ? '"' + cut(e.value, 30) + '" in ' : 'from ') + t;
    case 'key': return 'Press ' + (cut(e.value || e.target, 20) || 'a key');
    case 'navigate': return 'Open page ' + (cleanPage(e.page || e.target) || 'in the browser');
    case 'app': return 'Switch to ' + (cut(e.app || e.target, 40) || 'another app');
    default: return 'Step';
  }
}

/** The next time a schedule fires after `from` (ms), in local time; null for none. */
export function nextOccurrence(sch, from) {
  if (!sch || sch.enabled === false) return null;
  if (sch.kind === 'interval') return from + Math.max(1, Number(sch.everyMin) || 0) * 60000;
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(sch.at || ''));
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  const days = sch.kind === 'weekly' ? new Set((sch.days || []).map(Number)) : null;
  if (days && !days.size) return null;
  for (let add = 0; add < 8; add++) {
    const d = new Date(from); d.setDate(d.getDate() + add); d.setHours(Number(m[1]), Number(m[2]), 0, 0);
    if (d.getTime() > from && (!days || days.has(d.getDay()))) return d.getTime();
  }
  return null;
}
export function describeSchedule(sch) {
  if (!sch) return 'Not scheduled';
  const off = sch.enabled === false ? ' (paused)' : '';
  if (sch.kind === 'interval') return 'Every ' + sch.everyMin + ' min' + off;
  if (sch.kind === 'daily') return 'Daily at ' + sch.at + off;
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (sch.days || []).map((d) => names[d]).join(', ') + ' at ' + sch.at + off;
}
export const TRIGGER_SOURCES = ['folder', 'ftp', 'inbox'];

const blank = () => ({ seq: 1, workflows: [], recordings: [], runs: [], shots: {} });
const sleepAbortable = (ms, signal) => new Promise((resolve) => {
  if (!ms || signal.aborted) return resolve();
  const t = setTimeout(() => { signal.removeEventListener('abort', done); resolve(); }, ms);
  const done = () => { clearTimeout(t); resolve(); };
  signal.addEventListener('abort', done, { once: true });
});

export class RpaStore {
  /**
   * @param {object} o
   * @param {string} [o.file]  JSON file to persist to (memory only when omitted); screenshots go to `shots/` beside it
   * @param {object|function} o.driver  { perform(step, ctx) -> {ok, message, code?, screenshot?} }, or a function returning one
   * @param {function} [o.settings]  () -> { stepDelayMs, maxRetries, approvalTimeoutMs, builtins: { login_user, login_password } }
   * @param {function} [o.now]
   */
  constructor({ file = null, driver, settings = () => ({}), now = Date.now } = {}) {
    this.file = file; this.driverOf = typeof driver === 'function' ? driver : () => driver; this.settings = settings; this.now = now;
    this.shotsDir = file ? path.join(path.dirname(file), 'shots') : null;
    this.state = blank();
    this.active = new Map();   // run id -> { abort, stopped, waiter, done }
    if (file) this.#load();
  }

  // ---------- persistence ----------
  #load() {
    try { const s = JSON.parse(fs.readFileSync(this.file, 'utf8')); this.state = { ...blank(), ...s, shots: s.shots || {} }; } catch { this.state = blank(); }
    let dirty = false;
    for (const r of this.state.runs) {
      if (['queued', 'running', 'waiting'].includes(r.state)) {
        r.state = 'failed'; r.error = 'Interrupted: the dashboard restarted while this run was working'; r.endedAt = new Date(this.now()).toISOString();
        for (const s of r.steps) if (['running', 'waiting', 'pending'].includes(s.state)) s.state = s.state === 'pending' ? 'skipped' : 'failed';
        this.#log(r, 'error', r.error); dirty = true;
      }
    }
    for (const rec of this.state.recordings) if (rec.state === 'recording') { rec.state = 'stopped'; dirty = true; }
    if (dirty) this.#save();
  }
  #save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.state)); fs.renameSync(tmp, this.file);
  }
  #id(prefix) { return prefix + '-' + (this.state.seq++).toString(36); }
  #iso(t = this.now()) { return new Date(t).toISOString(); }
  /** Keep a screenshot: as a file beside the store when it persists (the JSON stays small), else in memory. */
  #shot(url) {
    const id = this.#id('shot');
    const m = /^data:image\/([a-z+]+);base64,(.*)$/s.exec(url);
    if (this.shotsDir && m) {
      fs.mkdirSync(this.shotsDir, { recursive: true });
      const f = id + '.' + (SHOT_EXT[m[1]] || 'img');
      fs.writeFileSync(path.join(this.shotsDir, f), Buffer.from(m[2], 'base64'));
      this.state.shots[id] = { f, m: 'image/' + m[1] };
    } else this.state.shots[id] = url;
    return id;
  }
  #copyShot(id) { const d = this.shotData(id); return d ? this.#shot(d) : null; }
  #prune() {
    const used = new Set();
    for (const w of this.state.workflows) for (const s of w.steps) if (s.shot) used.add(s.shot);
    for (const r of this.state.recordings) for (const s of r.steps) if (s.shot) used.add(s.shot);
    for (const r of this.state.runs) for (const s of r.steps) { if (s.shot) used.add(s.shot); if (s.refShot) used.add(s.refShot); }
    for (const k of Object.keys(this.state.shots)) {
      if (used.has(k)) continue;
      const v = this.state.shots[k];
      if (v && typeof v === 'object' && this.shotsDir) fs.rmSync(path.join(this.shotsDir, path.basename(v.f)), { force: true });
      delete this.state.shots[k];
    }
  }
  /** A screenshot as a data URL, or null. */
  shotData(id) {
    const v = id ? this.state.shots[id] : null;
    if (!v) return null;
    if (typeof v === 'string') return v;
    if (!this.shotsDir) return null;
    try { return 'data:' + v.m + ';base64,' + fs.readFileSync(path.join(this.shotsDir, path.basename(v.f))).toString('base64'); } catch { return null; }
  }

  // ---------- scope ----------
  #own(rec, scope) { return scope && (scope.admin === true || (scope.client && rec.client === scope.client)); }
  #wf(scope, id) { const w = this.state.workflows.find((x) => x.id === id); if (!w || !this.#own(w, scope)) fail('not-found', 'No such workflow'); return w; }
  #step(wf, id) { const s = wf.steps.find((x) => x.id === id); if (!s) fail('not-found', 'No such step'); return s; }
  #clientFor(scope, requested) {
    if (!scope.admin) { if (!scope.client) fail('forbidden', 'Sign in as a client'); return scope.client; }
    return cut(requested, 60) || 'internal';
  }

  // ---------- Record mode ----------
  startRecording(scope, { name = '', app = '', client = '' } = {}) {
    const owner = this.#clientFor(scope, client);
    const mine = this.state.recordings.find((r) => r.state === 'recording' && r.owner === (scope.admin ? 'admin' : scope.client));
    if (mine) fail('busy', 'A recording is already running: stop or save it first');
    const rec = {
      id: this.#id('rec'), client: owner, owner: scope.admin ? 'admin' : scope.client, name: cut(name, 80) || 'New recording', app: cut(app, 80),
      state: 'recording', startedAt: this.#iso(), stoppedAt: null, error: null, steps: [], stats: { events: 0, duplicates: 0, merged: 0, redacted: 0, captured: 0, shotsMissing: 0 }
    };
    this.state.recordings.push(rec);
    if (this.state.recordings.length > 40) this.state.recordings.splice(0, this.state.recordings.length - 40);
    this.#save();
    return clone(rec);
  }
  #rec(scope, id) {
    const r = this.state.recordings.find((x) => x.id === id);
    if (!r || !(scope.admin || r.owner === scope.client)) fail('not-found', 'No such recording');
    return r;
  }
  /** Permission to watch the screen was refused: the session ends with a message the screen shows. */
  denyRecording(scope, id, reason = '') {
    const r = this.#rec(scope, id);
    r.state = 'denied'; r.stoppedAt = this.#iso();
    r.error = cut(reason, 200) || 'Screen recording permission was denied. Allow it in System Settings > Privacy & Security, then record again.';
    this.#save(); return clone(r);
  }
  recordEvent(scope, id, ev = {}) {
    const r = this.#rec(scope, id);
    if (r.state === 'denied') fail('denied', r.error);
    if (r.state !== 'recording') fail('not-recording', 'This recording has stopped');
    const kind = String(ev.kind || '');
    if (!KINDS.includes(kind)) fail('bad-event', 'Unknown action "' + cut(kind, 20) + '". Use one of: ' + KINDS.join(', '));
    r.stats.events++;
    const at = Number.isFinite(Number(ev.at)) ? Number(ev.at) : this.now();
    // an action without its own app or page happened where the last app switch or page change left the user
    const e = { kind, target: cut(ev.target, 200), value: cut(ev.value, 500), page: cleanPage(ev.page), app: cut(ev.app || r.lastApp || r.app, 80), at, field: cut(ev.field, 80), inputType: cut(ev.inputType, 20) };
    if (!e.page && kind !== 'app' && kind !== 'navigate' && (!ev.app || ev.app === r.lastApp)) e.page = r.lastPage || '';
    if (kind === 'navigate' && !e.page) e.page = cleanPage(e.target || e.value);
    if (kind === 'app') e.app = cut(ev.app || ev.target, 80) || e.app;
    if (!e.target && !e.value && !e.page && !e.app) fail('bad-event', 'The action has nothing to record: give a target, value, page or app');
    if (kind === 'navigate' && !e.page) fail('bad-event', 'A page change needs the page address');
    const last = r.steps[r.steps.length - 1];
    // a second identical event within a moment is a double-fire
    if (last && last.kind === kind && last.key === [e.target, e.value, e.page, e.app].join('|') && at - last.at < 800) { r.stats.duplicates++; this.#save(); return { step: clone(last), dropped: 'duplicate' }; }
    if (last && kind === 'navigate' && last.kind === 'navigate' && last.page === e.page) { r.stats.duplicates++; this.#save(); return { step: clone(last), dropped: 'duplicate' }; }
    if (last && kind === 'app' && last.kind === 'app' && last.app === e.app) { r.stats.duplicates++; this.#save(); return { step: clone(last), dropped: 'duplicate' }; }
    const secret = kind === 'type' && isSensitive(e);
    // typing into the same field again extends the same step
    if (last && kind === 'type' && last.kind === 'type' && last.target === e.target && last.page === e.page && !last.secret && !secret) {
      last.value = e.value; last.name = autoName(last); last.key = [last.target, last.value, last.page, last.app].join('|'); last.at = at; r.stats.merged++;
      this.#save(); return { step: clone(last), dropped: 'merged' };
    }
    if (kind === 'app') { r.lastApp = e.app; r.lastPage = ''; }
    if (kind === 'navigate') { r.lastPage = e.page; if (ev.app) r.lastApp = e.app; }
    const step = { id: this.#id('st'), kind, name: '', target: e.target, value: e.value, page: e.page, app: e.app, at, secret: false, approval: false, approvalNote: '', optional: false, shot: null, shotNote: '' };
    if (secret) {
      // never keep what was typed into a password-like field: the run asks for it (or reads it from Connections)
      step.secret = true; step.value = '{{' + (/pass|pwd/i.test(e.target + ' ' + e.field) ? 'login_password' : slug(e.target || e.field) + '_secret') + '}}';
      r.stats.redacted++;
    }
    step.name = autoName(step);
    step.key = [e.target, kind === 'type' && secret ? '' : e.value, e.page, e.app].join('|');
    // a step only ever shows a real screen capture; when there is none it says why
    if (secret || ev.private === true) { step.shotNote = secret ? 'Screenshot withheld: sensitive field' : 'Screenshot withheld: marked private'; r.stats.redacted += secret ? 0 : 1; }
    else if (ev.screenshot != null && ev.screenshot !== '') {
      if (validShot(ev.screenshot)) { step.shot = this.#shot(ev.screenshot); r.stats.captured++; }
      else { step.shotNote = 'No screenshot: the capture was not an image or was larger than ' + Math.round(MAX_SHOT / 1e6 * 10) / 10 + ' MB'; r.stats.shotsMissing++; }
    } else { step.shotNote = cut(ev.shotError, 160) || 'No screenshot: this action came without a screen capture'; r.stats.shotsMissing++; }
    r.steps.push(step);
    this.#save();
    return { step: clone(step), dropped: null };
  }
  stopRecording(scope, id) { const r = this.#rec(scope, id); if (r.state === 'recording') { r.state = 'stopped'; r.stoppedAt = this.#iso(); this.#save(); } return clone(r); }
  discardRecording(scope, id) { const r = this.#rec(scope, id); this.state.recordings = this.state.recordings.filter((x) => x !== r); this.#prune(); this.#save(); return true; }
  listRecordings(scope) { return this.state.recordings.filter((r) => scope.admin || r.owner === scope.client).map(clone).reverse(); }
  getRecording(scope, id) { return clone(this.#rec(scope, id)); }
  /** Turn a recording into an editable workflow. */
  saveRecording(scope, id, { name = '' } = {}) {
    const r = this.#rec(scope, id);
    if (r.state === 'denied') fail('denied', r.error);
    if (r.state === 'saved') fail('saved', 'This recording is already a workflow');
    if (!r.steps.length) fail('empty', 'Nothing was recorded yet: do the task first, then save');
    if (r.state === 'recording') { r.state = 'stopped'; r.stoppedAt = this.#iso(); }
    const wf = this.#newWorkflow(r.client, cut(name, 80) || r.name);
    wf.source = r.id;
    wf.steps = r.steps.map((s) => { const { key, at, ...rest } = s; return { ...rest }; });
    for (const s of wf.steps) for (const v of refsIn(s.value)) if (!BUILTIN_VARS[v] && !wf.variables.find((x) => x.name === v)) wf.variables.push({ name: v, label: v.replace(/_/g, ' '), default: '', secret: /secret$/.test(v), required: true });
    r.state = 'saved'; r.workflowId = wf.id;
    this.#save();
    return clone(wf);
  }
  #newWorkflow(client, name) {
    const t = this.#iso();
    const wf = { id: this.#id('wf'), client, name, description: '', steps: [], variables: [], schedule: null, nextRunAt: null, scheduleValues: {}, trigger: null, version: 1, source: null, createdAt: t, updatedAt: t };
    this.state.workflows.push(wf); return wf;
  }

  // ---------- Workflows library ----------
  listWorkflows(scope) { return this.state.workflows.filter((w) => this.#own(w, scope)).map(clone); }
  getWorkflow(scope, id) { return clone(this.#wf(scope, id)); }
  createWorkflow(scope, { name = '', client = '' } = {}) {
    const n = cut(name, 80); if (!n) fail('bad-name', 'Give the workflow a name');
    const wf = this.#newWorkflow(this.#clientFor(scope, client), n); this.#save(); return clone(wf);
  }
  #touch(wf) { wf.version++; wf.updatedAt = this.#iso(); wf.nextRunAt = wf.schedule ? nextOccurrence(wf.schedule, this.now()) : null; this.#prune(); this.#save(); return clone(wf); }
  renameWorkflow(scope, id, name) { const w = this.#wf(scope, id); const n = cut(name, 80); if (!n) fail('bad-name', 'Give the workflow a name'); w.name = n; return this.#touch(w); }
  describeWorkflow(scope, id, text) { const w = this.#wf(scope, id); w.description = cut(text, 300); return this.#touch(w); }
  renameStep(scope, wfId, stepId, name) { const w = this.#wf(scope, wfId); const s = this.#step(w, stepId); const n = cut(name, 100); if (!n) fail('bad-name', 'Give the step a name'); s.name = n; return this.#touch(w); }
  updateStep(scope, wfId, stepId, patch = {}) {
    const w = this.#wf(scope, wfId); const s = this.#step(w, stepId);
    if ('target' in patch) s.target = cut(patch.target, 200);
    if ('value' in patch) {
      if (s.secret) fail('secret', 'This step holds a password or secret: it is never stored. Change the variable instead.');
      s.value = cut(patch.value, 500);
      this.#checkRefs(w, s);
    }
    if ('optional' in patch) s.optional = patch.optional === true;
    if ('page' in patch) {
      const p = cleanPage(patch.page);
      if (s.kind === 'navigate' && !p) fail('bad-event', 'A page step needs the page address');
      if (p && !/^(https?:\/\/|\/|\{\{)/i.test(p)) fail('bad-page', 'Give the page as an address, e.g. https://app.example.com/orders');
      s.page = p;
      if (s.kind === 'navigate') s.target = p;
      this.#checkRefs(w, s);
    }
    if ('app' in patch) {
      const a = cut(patch.app, 80);
      if (s.kind === 'app' && !a) fail('bad-event', 'An app step needs the app name');
      s.app = a;
      if (s.kind === 'app') s.target = a;
    }
    return this.#touch(w);
  }
  /**
   * Treat what a step types as a secret from now on: the recorded value is dropped (and its screenshot, which may show
   * it), and the step asks for a secret variable when it runs.
   */
  makeSecret(scope, wfId, stepId, name = '') {
    const w = this.#wf(scope, wfId); const s = this.#step(w, stepId);
    if (s.secret) fail('secret', 'This step is already kept secret');
    if (!['type', 'select'].includes(s.kind)) fail('bad-variable', 'Only typing or choosing steps hold a value to keep secret');
    let n = String(name || '').trim() || slug(s.target || s.name) + '_secret';
    if (!VAR_RE.test(n)) fail('bad-variable', 'Variable names use letters, numbers and underscores');
    if (BUILTIN_VARS[n.toLowerCase()]) fail('bad-variable', n + ' is a built-in variable read from Connections');
    const existing = w.variables.find((v) => v.name.toLowerCase() === n.toLowerCase());
    if (existing && !existing.secret) fail('bad-variable', 'Variable ' + n + ' already exists and is not secret');
    if (!existing) w.variables.push({ name: n, label: cut(s.target, 60) || n.replace(/_/g, ' '), default: '', secret: true, required: true });
    s.secret = true; s.value = '{{' + n + '}}'; delete s.recorded;
    if (s.shot) { s.shot = null; s.shotNote = 'Screenshot removed: it could show the secret'; }
    return this.#touch(w);
  }
  /** Remove a step's screenshot (it showed something private); the step itself stays. */
  dropShot(scope, { workflow = null, recording = null } = {}, stepId, by = 'a user') {
    const owner = workflow ? this.#wf(scope, workflow) : this.#rec(scope, recording);
    const s = owner.steps.find((x) => x.id === stepId); if (!s) fail('not-found', 'No such step');
    if (!s.shot) fail('no-shot', 'That step has no screenshot');
    s.shot = null; s.shotNote = 'Screenshot removed by ' + cut(by, 60);
    if (workflow) return this.#touch(owner);
    this.#prune(); this.#save(); return clone(owner);
  }
  #checkRefs(w, s) {
    for (const v of [...refsIn(s.value), ...refsIn(s.target)]) if (!BUILTIN_VARS[v] && !w.variables.find((x) => x.name === v)) fail('unknown-variable', 'Variable {{' + v + '}} is not defined: add it under Variables first');
  }
  /** Move a step to a position (to: 0-based) or by an offset (by: -1 up, +1 down). */
  moveStep(scope, wfId, stepId, { to, by } = {}) {
    const w = this.#wf(scope, wfId); const i = w.steps.findIndex((x) => x.id === stepId); if (i < 0) fail('not-found', 'No such step');
    const j = Number.isInteger(to) ? to : i + (Number(by) || 0);
    if (j < 0 || j >= w.steps.length) fail('bad-position', 'That is outside the list of steps');
    if (j === i) return clone(w);
    const [s] = w.steps.splice(i, 1); w.steps.splice(j, 0, s);
    return this.#touch(w);
  }
  addStep(scope, wfId, { kind = 'click', target = '', value = '', name = '', after = null, page = '', app = '' } = {}) {
    const w = this.#wf(scope, wfId);
    if (!KINDS.includes(kind)) fail('bad-event', 'Unknown action "' + cut(kind, 20) + '"');
    const s = { id: this.#id('st'), kind, name: '', target: cut(target, 200), value: cut(value, 500), page: '', app: '', secret: false, approval: false, approvalNote: '', optional: false, shot: null, shotNote: 'No screenshot: this step was added by hand' };
    s.app = cut(app, 80); s.page = cleanPage(page);
    if (kind === 'app') s.app = cut(target || app, 80);
    if (kind === 'navigate') s.page = cleanPage(target || value || page);
    if (!s.target && !s.value && !s.page && !s.app) fail('bad-event', 'Give the step a target or value');
    s.name = cut(name, 100) || autoName(s);
    this.#checkRefs(w, s);
    const i = after ? w.steps.findIndex((x) => x.id === after) : w.steps.length - 1;
    w.steps.splice(i + 1, 0, s);
    return this.#touch(w);
  }
  deleteStep(scope, wfId, stepId) { const w = this.#wf(scope, wfId); this.#step(w, stepId); w.steps = w.steps.filter((x) => x.id !== stepId); return this.#touch(w); }
  setApproval(scope, wfId, stepId, on, note = '') { const w = this.#wf(scope, wfId); const s = this.#step(w, stepId); s.approval = on === true; s.approvalNote = s.approval ? cut(note, 160) : ''; return this.#touch(w); }
  addVariable(scope, wfId, { name, label = '', default: def = '', secret = false } = {}) {
    const w = this.#wf(scope, wfId); const n = String(name || '').trim();
    if (!VAR_RE.test(n)) fail('bad-variable', 'Variable names use letters, numbers and underscores, e.g. customer_name or po_number');
    if (BUILTIN_VARS[n.toLowerCase()]) fail('bad-variable', n + ' is a built-in variable read from Connections');
    if (w.variables.find((v) => v.name.toLowerCase() === n.toLowerCase())) fail('bad-variable', 'Variable ' + n + ' already exists');
    if (secret === true && def) fail('bad-variable', 'A secret variable cannot have a stored default: it is asked for when the workflow runs');
    w.variables.push({ name: n, label: cut(label, 60) || n.replace(/_/g, ' '), default: secret === true ? '' : cut(def, 200), secret: secret === true, required: !def });
    return this.#touch(w);
  }
  updateVariable(scope, wfId, name, { label, default: def } = {}) {
    const w = this.#wf(scope, wfId); const v = w.variables.find((x) => x.name.toLowerCase() === String(name || '').toLowerCase());
    if (!v) fail('not-found', 'No such variable');
    if (label !== undefined) v.label = cut(label, 60) || v.name.replace(/_/g, ' ');
    if (def !== undefined) {
      if (v.secret && def) fail('bad-variable', 'A secret variable cannot have a stored default: it is asked for when the workflow runs');
      v.default = cut(def, 200); v.required = !v.default;
    }
    return this.#touch(w);
  }
  removeVariable(scope, wfId, name) {
    const w = this.#wf(scope, wfId); const n = String(name || '').toLowerCase();
    const used = w.steps.filter((s) => refsIn(s.value).includes(n) || refsIn(s.target).includes(n));
    if (used.length) fail('in-use', 'Variable ' + name + ' is used by ' + used.length + ' step(s): unbind it there first');
    if (!w.variables.find((v) => v.name.toLowerCase() === n)) fail('not-found', 'No such variable');
    w.variables = w.variables.filter((v) => v.name.toLowerCase() !== n); delete w.scheduleValues[name];
    return this.#touch(w);
  }
  /** Make a step use a variable instead of its recorded value (variable null puts the recorded value back as typed). */
  bindVariable(scope, wfId, stepId, variable, original = '') {
    const w = this.#wf(scope, wfId); const s = this.#step(w, stepId);
    if (s.secret) fail('secret', 'This step already uses a secret variable');
    if (variable == null || variable === '') { s.value = cut(original, 500) || s.recorded || ''; return this.#touch(w); }
    const v = w.variables.find((x) => x.name.toLowerCase() === String(variable).toLowerCase());
    if (!v) fail('unknown-variable', 'No such variable: add it first');
    if (!['type', 'select', 'key', 'navigate'].includes(s.kind) && !s.value) fail('bad-variable', 'Only steps that type or choose a value can use a variable');
    if (s.value && !refsIn(s.value).length) s.recorded = s.value;   // so "use the recorded value" can put it back
    s.value = '{{' + v.name + '}}';
    return this.#touch(w);
  }
  /** Variables worth making from what was typed: customer, PO, order and reference fields. */
  suggestVariables(scope, wfId) {
    const w = this.#wf(scope, wfId); const out = [];
    for (const s of w.steps) {
      if (!['type', 'select'].includes(s.kind) || s.secret || !s.value || refsIn(s.value).length) continue;
      const hit = /customer|client|company|\bpo\b|purchase|order|invoice|reference|\bref\b|supplier|project|site|amount|quantity|email/i.exec(s.target + ' ' + s.name);
      if (!hit) continue;
      let name = slug(s.target); if (w.variables.find((v) => v.name === name) || out.find((o) => o.name === name)) name += '_' + (out.length + 1);
      out.push({ stepId: s.id, name, label: cut(s.target, 40) || name, sample: s.value });
    }
    return out;
  }
  duplicateWorkflow(scope, id, { name = '' } = {}) {
    const w = this.#wf(scope, id); const c = clone(w);
    const n = this.#newWorkflow(w.client, cut(name, 80) || w.name + ' (copy)');
    Object.assign(n, { description: c.description, variables: c.variables, scheduleValues: c.scheduleValues, source: w.id });
    n.steps = c.steps.map((s) => ({ ...s, id: this.#id('st'), shot: this.#copyShot(s.shot) }));
    this.#save(); return clone(n);
  }
  /** Admin: a copy of a trained workflow for another client. */
  assignWorkflow(scope, id, client) {
    if (!scope.admin) fail('forbidden', 'Only the admin can give a workflow to a client');
    const to = cut(client, 60); if (!to) fail('bad-client', 'Choose a client');
    const w = this.#wf(scope, id); const c = this.duplicateWorkflow(scope, id, { name: w.name });
    const n = this.state.workflows.find((x) => x.id === c.id); n.client = to; n.schedule = null; n.trigger = null; n.nextRunAt = null;
    this.#save(); return clone(n);
  }
  deleteWorkflow(scope, id) {
    const w = this.#wf(scope, id);
    if ([...this.active.keys()].some((rid) => this.state.runs.find((r) => r.id === rid && r.workflowId === id))) fail('busy', 'This workflow is running: stop the run first');
    this.state.workflows = this.state.workflows.filter((x) => x !== w); this.#prune(); this.#save(); return true;
  }

  // ---------- schedules and triggers ----------
  setSchedule(scope, id, sch = {}, values = null) {
    const w = this.#wf(scope, id); const kind = String(sch.kind || '');
    let s;
    if (kind === 'interval') { const m = Math.round(Number(sch.everyMin)); if (!(m >= 1 && m <= 10080)) fail('bad-schedule', 'Repeat every 1 to 10080 minutes'); s = { kind, everyMin: m, enabled: sch.enabled !== false }; }
    else if (kind === 'daily' || kind === 'weekly') {
      if (nextOccurrence({ kind: 'daily', at: sch.at }, 0) == null) fail('bad-schedule', 'Give the time as HH:MM, e.g. 07:30');
      s = { kind, at: String(sch.at).replace(/^(\d):/, '0$1:'), enabled: sch.enabled !== false };
      if (kind === 'weekly') { s.days = [...new Set((sch.days || []).map(Number).filter((d) => d >= 0 && d <= 6))].sort(); if (!s.days.length) fail('bad-schedule', 'Choose at least one day'); }
    } else fail('bad-schedule', 'Choose interval, daily or weekly');
    if (values && typeof values === 'object') w.scheduleValues = this.#cleanValues(w, values);
    w.schedule = s; return this.#touch(w);
  }
  clearSchedule(scope, id) { const w = this.#wf(scope, id); w.schedule = null; return this.#touch(w); }
  #cleanValues(w, values) {
    const out = {};
    for (const v of w.variables) if (!v.secret && values[v.name] !== undefined && values[v.name] !== '') out[v.name] = cut(values[v.name], 200);
    return out;
  }
  /** map: { variable: 'payloadKey' } says which part of the event fills each variable. */
  setTrigger(scope, id, { kind, match = '', map = {}, enabled = true } = {}) {
    const w = this.#wf(scope, id);
    if (!TRIGGER_SOURCES.includes(kind)) fail('bad-trigger', 'A trigger is one of: ' + TRIGGER_SOURCES.join(', '));
    const m = {};
    for (const [k, v] of Object.entries(map || {})) { if (!w.variables.find((x) => x.name === k && !x.secret)) fail('bad-trigger', 'Cannot fill ' + cut(k, 30) + ': it is not a variable of this workflow'); if (v) m[k] = cut(v, 60); }
    w.trigger = { kind, match: cut(match, 80), map: m, enabled: enabled !== false }; return this.#touch(w);
  }
  clearTrigger(scope, id) { const w = this.#wf(scope, id); w.trigger = null; return this.#touch(w); }
  /**
   * An event arrived (a file landed, a message was triaged): start every matching workflow of the clients the event
   * belongs to. `clients` is required: an event never reaches the workflows of a client it was not meant for, so a
   * call that does not say whose event it is starts nothing.
   */
  fireTrigger(source, payload = {}, { clients = null } = {}) {
    if (!Array.isArray(clients)) fail('bad-trigger', 'Say which clients this event belongs to');
    const allowed = new Set(clients.map(String));
    const text = Object.values(payload).filter((x) => typeof x === 'string').join(' ').toLowerCase();
    const started = [];
    for (const w of [...this.state.workflows]) {
      const t = w.trigger;
      if (!t || t.enabled === false || t.kind !== source || !allowed.has(w.client)) continue;
      if (t.match && !text.includes(t.match.toLowerCase())) continue;
      const values = { ...w.scheduleValues };
      for (const [k, key] of Object.entries(t.map)) if (payload[key] !== undefined) values[k] = cut(payload[key], 200);
      started.push(this.#systemRun(w, values, 'trigger: ' + source));
    }
    return started;
  }
  /** Start every workflow whose schedule is due. Call from a timer. */
  tick(now = this.now()) {
    const started = [];
    for (const w of this.state.workflows) {
      if (!w.schedule || w.schedule.enabled === false || w.nextRunAt == null || w.nextRunAt > now) continue;
      w.nextRunAt = nextOccurrence(w.schedule, now);
      started.push(this.#systemRun(w, { ...w.scheduleValues }, 'schedule'));
    }
    if (started.length) this.#save();
    return started;
  }
  #systemRun(w, values, trigger) {
    try { return this.startRun({ admin: true }, w.id, { values, trigger, by: { id: 'system', name: trigger.startsWith('trigger') ? 'Trigger' : 'Schedule' } }); }
    catch (e) {
      if (!(e instanceof RpaError)) throw e;
      // it could not start (missing variable or credential): that is a failed run in the history, not silence
      const run = this.#makeRun(w, trigger, { id: 'system', name: 'Schedule' }, {}, 0);
      run.state = 'failed'; run.error = e.message; run.endedAt = this.#iso(); for (const s of run.steps) s.state = 'skipped';
      this.#log(run, 'error', e.message); this.#save(); return clone(run);
    }
  }

  // ---------- Run mode ----------
  #resolve(w, supplied = {}) {
    const cfg = this.settings() || {}; const built = cfg.builtins || {};
    const values = {}; const secrets = new Set(); const missing = [];
    const defs = [...w.variables, ...Object.entries(BUILTIN_VARS).map(([name, d]) => ({ name, label: d.label, secret: true, builtin: true }))];
    const used = new Set(); for (const s of w.steps) for (const v of [...refsIn(s.value), ...refsIn(s.target)]) used.add(v);
    for (const d of defs) {
      const key = d.name.toLowerCase();
      if (d.builtin && !used.has(key)) continue;
      let v = supplied[d.name];
      if ((v === undefined || v === '') && d.builtin) v = built[d.name];
      if ((v === undefined || v === '') && d.default) v = d.default;
      if (v === undefined || v === '') { missing.push(d); continue; }
      values[key] = String(v); if (d.secret) secrets.add(key);
    }
    for (const s of w.steps) for (const v of refsIn(s.page)) used.add(v);
    for (const u of used) if (!defs.find((d) => d.name.toLowerCase() === u)) missing.push({ name: u, label: u, undefinedVar: true });
    return { values, secrets, missing };
  }
  #interpolate(text, values) { return String(text ?? '').replace(REF_RE, (_, n) => values[n.toLowerCase()] ?? ''); }
  #makeRun(w, trigger, by, values, fromIdx, prior = null) {
    const run = {
      id: this.#id('run'), workflowId: w.id, name: w.name, client: w.client, version: w.version, state: 'queued', trigger, by: by || { id: 'system', name: 'System' },
      startedAt: this.#iso(), endedAt: null, error: null, resumeOf: prior ? prior.id : null, values, secretNames: [],
      steps: w.steps.map((s, i) => ({ id: s.id, idx: i, name: s.name, kind: s.kind, target: s.target, value: s.value, page: s.page || '', app: s.app || '', approval: s.approval, approvalNote: s.approvalNote, optional: s.optional, secret: s.secret, state: 'pending', message: '', ms: 0, attempts: 0, refShot: s.shot, shot: null, startedAt: null })),
      log: []
    };
    run.steps.slice(0, fromIdx).forEach((s) => { s.state = 'skipped'; s.message = 'Already done in run ' + prior.id; });
    this.state.runs.push(run);
    if (this.state.runs.length > 300) { this.state.runs.splice(0, this.state.runs.length - 300); this.#prune(); }
    return run;
  }
  #log(run, level, text, secrets) { run.log.push({ at: this.#iso(), level, text: this.#mask(text, secrets || this.active.get(run.id)?.secretValues) }); if (run.log.length > 400) run.log.splice(0, run.log.length - 400); }
  #mask(text, secretValues) { let t = String(text ?? ''); for (const v of secretValues || []) if (v) t = t.split(v).join(MASK); return t; }

  startRun(scope, wfId, { values = {}, trigger = 'manual', by = null, fromStep = 0, resumeOf = null } = {}) {
    const w = this.#wf(scope, wfId);
    if (!w.steps.length) fail('empty', 'This workflow has no steps yet');
    if (resumeOf == null && [...this.active.keys()].some((rid) => this.state.runs.find((r) => r.id === rid && r.workflowId === w.id))) fail('busy', 'This workflow is already running: wait for it or stop it first');
    const { values: vals, secrets, missing } = this.#resolve(w, values || {});
    if (missing.length) {
      const names = missing.map((m) => m.undefinedVar ? '{{' + m.name + '}} (not defined)' : m.builtin ? m.name + ' (add it in Connections)' : m.name);
      fail('missing-variable', 'Cannot start: missing ' + names.join(', '));
    }
    const prior = resumeOf ? this.state.runs.find((r) => r.id === resumeOf) : null;
    const run = this.#makeRun(w, trigger, by || (scope.admin ? { id: 'admin', name: 'Owner' } : { id: scope.client, name: 'Client' }), Object.fromEntries(Object.entries(vals).filter(([k]) => !secrets.has(k))), fromStep, prior);
    run.secretNames = [...secrets];
    const cfg = this.settings() || {};
    const ctl = { abort: new AbortController(), stopped: false, stoppedBy: null, waiter: null, secretValues: [...secrets].map((k) => vals[k]), done: null };
    this.active.set(run.id, ctl);
    this.#log(run, 'info', 'Run started (' + trigger + ') by ' + run.by.name + (prior ? '; continuing from step ' + (fromStep + 1) + ' of run ' + prior.id : ''));
    run.state = 'running'; this.#save();
    ctl.done = this.#execute(run, ctl, vals, cfg).catch((e) => {
      run.state = 'failed'; run.error = this.#mask(String((e && e.message) || e), ctl.secretValues); run.endedAt = this.#iso(); this.#log(run, 'error', run.error);
    }).finally(() => { this.active.delete(run.id); this.#save(); });
    return clone(run);
  }
  async #execute(run, ctl, vals, cfg) {
    const driver = this.driverOf();
    const delay = Number.isFinite(Number(cfg.stepDelayMs)) ? Number(cfg.stepDelayMs) : 0;
    const retries = Math.max(0, Math.min(5, Number.isFinite(Number(cfg.maxRetries)) ? Number(cfg.maxRetries) : 1));
    const approvalMs = Number.isFinite(Number(cfg.approvalTimeoutMs)) ? Number(cfg.approvalTimeoutMs) : 30 * 60000;
    const started = this.now();
    const first = run.steps.findIndex((s) => s.state === 'pending');
    let outcome = 'passed';
    for (let i = first < 0 ? run.steps.length : first; i < run.steps.length; i++) {
      const st = run.steps[i];
      if (ctl.stopped) { outcome = 'stopped'; break; }
      st.startedAt = this.#iso(); const t0 = this.now();
      if (st.approval) {
        st.state = 'waiting'; run.state = 'waiting'; st.message = st.approvalNote || 'Waiting for someone to approve this step';
        this.#log(run, 'warn', 'Step ' + (i + 1) + ' "' + st.name + '" needs approval' + (st.approvalNote ? ': ' + st.approvalNote : '')); this.#save();
        const decision = await new Promise((resolve) => {
          const timer = setTimeout(() => resolve({ approve: false, timeout: true }), approvalMs); if (timer.unref) timer.unref();
          ctl.waiter = { stepId: st.id, resolve: (d) => { clearTimeout(timer); resolve(d); } };
          ctl.abort.signal.addEventListener('abort', () => { clearTimeout(timer); resolve({ approve: false, stopped: true }); }, { once: true });
        });
        ctl.waiter = null; run.state = 'running';
        if (decision.stopped || ctl.stopped) { st.state = 'stopped'; st.message = 'Stopped while waiting for approval'; outcome = 'stopped'; break; }
        if (!decision.approve) {
          st.state = 'rejected'; st.ms = this.now() - t0;
          st.message = decision.timeout ? 'No answer in time: the step was not approved' : 'Rejected by ' + (decision.by || 'an approver') + (decision.note ? ': ' + decision.note : '');
          run.error = 'Approval ' + (decision.timeout ? 'timed out' : 'rejected') + ' at step ' + (i + 1) + ' "' + st.name + '"';
          this.#log(run, 'error', run.error); outcome = 'failed'; break;
        }
        this.#log(run, 'info', 'Step ' + (i + 1) + ' approved by ' + (decision.by || 'an approver'));
      }
      st.state = 'running'; this.#save();
      // the page and app the step was recorded on travel with it, so the agent acts in the right place
      const resolved = { id: st.id, kind: st.kind, name: st.name, target: this.#interpolate(st.target, vals), value: this.#interpolate(st.value, vals), page: this.#interpolate(st.page, vals), app: st.app || '', optional: st.optional };
      let result = null;
      for (let attempt = 1; attempt <= 1 + retries; attempt++) {
        st.attempts = attempt;
        try { result = await driver.perform(resolved, { run: run.id, attempt, signal: ctl.abort.signal }); }
        catch (e) { result = ctl.stopped ? { ok: false, stopped: true, message: 'Stopped' } : { ok: false, message: String((e && e.message) || e) }; }
        result = result && typeof result === 'object' ? result : { ok: false, message: 'The automation agent gave no answer' };
        if (result.ok || ctl.stopped) break;
        this.#log(run, 'warn', 'Step ' + (i + 1) + ' attempt ' + attempt + ' failed: ' + (result.message || 'unknown error'));
      }
      st.ms = this.now() - t0; st.code = result.ok ? '' : cut(result.code, 40);
      if (validShot(result.screenshot)) st.shot = this.#shot(result.screenshot);
      else st.shotNote = result.screenshot ? 'The agent sent a screenshot that was not an image or was too large' : 'The agent sent no screenshot for this step';
      // Stop wins: a stop that arrived while this step was in flight ends the run as stopped, even if the step passed
      if (ctl.stopped) {
        if (result.ok) { st.state = 'passed'; st.message = this.#mask(cut(result.message, 200), ctl.secretValues) || 'Done'; this.#log(run, 'info', 'Step ' + (i + 1) + ' passed: ' + st.name); }
        else { st.state = 'stopped'; st.message = 'Stopped by ' + (ctl.stoppedBy || 'a user') + ' during this step'; this.#log(run, 'warn', st.message); }
        outcome = 'stopped'; break;
      }
      if (result.ok) { st.state = 'passed'; st.message = this.#mask(cut(result.message, 200), ctl.secretValues) || 'Done'; this.#log(run, 'info', 'Step ' + (i + 1) + ' passed: ' + st.name); }
      else if (st.optional) { st.state = 'skipped'; st.message = 'Optional step skipped: ' + this.#mask(cut(result.message, 200), ctl.secretValues); this.#log(run, 'warn', st.message); }
      else {
        st.state = 'failed'; st.message = this.#mask(cut(result.message, 300), ctl.secretValues) || 'The step failed';
        run.error = 'Step ' + (i + 1) + ' "' + st.name + '" failed' + (result.code === 'target-missing' ? ' (the page layout may have changed)' : '') + ': ' + st.message;
        this.#log(run, 'error', run.error); outcome = 'failed'; break;
      }
      this.#save();
      if (delay && i < run.steps.length - 1) await sleepAbortable(delay, ctl.abort.signal);
    }
    if (ctl.stopped && outcome === 'passed') outcome = 'stopped';
    for (const s of run.steps) if (s.state === 'pending') { s.state = 'skipped'; s.message = outcome === 'stopped' ? 'Not run: the run was stopped' : outcome === 'failed' ? 'Not run: an earlier step failed' : s.message; }
    run.state = outcome; run.endedAt = this.#iso(); run.ms = this.now() - started;
    this.#log(run, outcome === 'passed' ? 'info' : outcome === 'stopped' ? 'warn' : 'error', 'Run ' + outcome + ' in ' + Math.round(run.ms / 100) / 10 + ' s');
  }
  /** Approve or reject the step a run is waiting on. */
  decide(scope, runId, stepId, approve, { by = 'an approver', note = '' } = {}) {
    const r = this.#run(scope, runId); const ctl = this.active.get(r.id);
    if (!ctl || !ctl.waiter || ctl.waiter.stepId !== stepId) fail('not-waiting', 'This run is not waiting for that approval');
    ctl.waiter.resolve({ approve: approve === true, by: cut(by, 60), note: cut(note, 160) }); return true;
  }
  stopRun(scope, runId, by = 'a user') {
    const r = this.#run(scope, runId); const ctl = this.active.get(r.id);
    if (!ctl) fail('not-running', 'This run has already finished');
    ctl.stopped = true; ctl.stoppedBy = cut(by, 60); this.#log(r, 'warn', 'Stop requested by ' + ctl.stoppedBy); ctl.abort.abort(); return true;
  }
  stopAll(scope, by = 'a user') {
    let n = 0;
    for (const id of [...this.active.keys()]) { const r = this.state.runs.find((x) => x.id === id); if (r && this.#own(r, scope)) { this.stopRun(scope, id, by); n++; } }
    return n;
  }
  /** Run again from the first step that did not pass, keeping the work already done. */
  resumeRun(scope, runId, { values = {}, by = null } = {}) {
    const r = this.#run(scope, runId);
    if (['running', 'waiting', 'queued'].includes(r.state)) fail('busy', 'That run is still going');
    const idx = r.steps.findIndex((s) => !['passed', 'skipped'].includes(s.state) || (s.state === 'skipped' && /Not run/.test(s.message)));
    if (idx < 0) fail('nothing-to-resume', 'Every step of that run already passed');
    const wf = this.#wf(scope, r.workflowId);
    if (wf.steps.length !== r.steps.length || wf.steps.some((s, i) => s.id !== r.steps[i].id)) fail('changed', 'The workflow was edited since that run: start a new run instead');
    return this.startRun(scope, r.workflowId, { values: { ...r.values, ...values }, trigger: 'resume', by, fromStep: idx, resumeOf: r.id });
  }
  #run(scope, id) { const r = this.state.runs.find((x) => x.id === id); if (!r || !this.#own(r, scope)) fail('not-found', 'No such run'); return r; }
  getRun(scope, id) { return clone(this.#run(scope, id)); }
  listRuns(scope, { workflowId = null, state = null, limit = 100 } = {}) {
    return this.state.runs.filter((r) => this.#own(r, scope) && (!workflowId || r.workflowId === workflowId) && (!state || r.state === state)).slice(-limit).reverse().map(clone);
  }
  whenIdle(runId) { if (runId) { const c = this.active.get(runId); return c ? c.done : Promise.resolve(); } return Promise.all([...this.active.values()].map((c) => c.done)); }
  isActive(runId) { return this.active.has(runId); }
  waiting(scope) { return this.state.runs.filter((r) => r.state === 'waiting' && this.#own(r, scope)).length; }

  // ---------- numbers ----------
  stats(scope = { admin: true }, now = this.now()) {
    const runs = this.state.runs.filter((r) => this.#own(r, scope));
    const done = runs.filter((r) => ['passed', 'failed'].includes(r.state));   // a run someone stopped is neither
    const passed = done.filter((r) => r.state === 'passed');
    const today = new Date(now); today.setHours(0, 0, 0, 0);
    const timed = passed.filter((r) => r.ms > 0);
    const labels = [], values = [];
    for (let h = 23; h >= 0; h--) { const lo = now - (h + 1) * 3600000, hi = now - h * 3600000; labels.push(h === 0 ? 'now' : h + 'h'); values.push(runs.filter((r) => { const t = Date.parse(r.startedAt); return t > lo && t <= hi; }).length); }
    const wfs = this.state.workflows.filter((w) => this.#own(w, scope));
    const steps = wfs.flatMap((w) => w.steps);
    const shootable = steps.filter((s) => !s.secret);
    return {
      steps: steps.length, typed: steps.filter((s) => ['type', 'select'].includes(s.kind)).length, secrets: steps.filter((s) => s.secret).length,
      bound: steps.filter((s) => !s.secret && refsIn(s.value).length).length, pageChanges: steps.filter((s) => ['navigate', 'app'].includes(s.kind)).length,
      shots: shootable.filter((s) => s.shot).length, shotCoverage: shootable.length ? Math.round((shootable.filter((s) => s.shot).length / shootable.length) * 100) : 100,
      approvals: steps.filter((s) => s.approval).length, variables: wfs.reduce((a, w) => a + w.variables.length, 0),
      runs: runs.length, today: runs.filter((r) => Date.parse(r.startedAt) >= today.getTime()).length, passed: passed.length, failed: done.length - passed.length, stopped: runs.filter((r) => r.state === 'stopped').length,
      successRate: done.length ? Math.round((passed.length / done.length) * 100) : 100,
      avgSeconds: timed.length ? Math.round((timed.reduce((a, r) => a + r.ms, 0) / timed.length / 1000) * 10) / 10 : 0,
      running: runs.filter((r) => r.state === 'running').length, waiting: runs.filter((r) => r.state === 'waiting').length,
      workflows: this.state.workflows.filter((w) => this.#own(w, scope)).length, scheduled: this.state.workflows.filter((w) => this.#own(w, scope) && ((w.schedule && w.schedule.enabled !== false) || (w.trigger && w.trigger.enabled !== false))).length,
      recordedSteps: this.state.recordings.filter((r) => this.#own({ client: r.client }, scope)).reduce((a, r) => a + r.steps.length, 0),
      recording: this.state.recordings.filter((r) => r.state === 'recording' && this.#own({ client: r.client }, scope)).length,
      lastRunAt: runs.length ? runs[runs.length - 1].startedAt : null, hours: { labels, values }
    };
  }
}

// ---------- drivers ----------
/** Runs steps on a desktop automation agent over HTTP (see the Connections screen for its address and token). */
export function agentDriver({ url, token = '', fetchImpl = globalThis.fetch, timeoutMs = 15000 } = {}) {
  const base = String(url || '').replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(base)) throw new RpaError('no-agent', 'The automation agent address is not set: add it in Connections');
  const headers = { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) };
  const call = async (method, p, body, signal) => {
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), timeoutMs); if (timer.unref) timer.unref();
    const onAbort = () => ac.abort(); if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const res = await fetchImpl(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ac.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok && !data.message) return { ok: false, message: 'The automation agent answered HTTP ' + res.status };
      return data;
    } catch (e) {
      if (signal && signal.aborted) return { ok: false, stopped: true, message: 'Stopped' };
      return { ok: false, message: ac.signal.aborted ? 'The automation agent did not answer in ' + Math.round(timeoutMs / 1000) + ' s' : 'Cannot reach the automation agent: ' + cut(e && e.message, 120) };
    } finally { clearTimeout(timer); if (signal) signal.removeEventListener('abort', onAbort); }
  };
  return {
    perform: (step, ctx = {}) => call('POST', '/step', { run: ctx.run, attempt: ctx.attempt, step: { kind: step.kind, target: step.target, value: step.value, name: step.name, page: step.page || '', app: step.app || '' } }, ctx.signal),
    health: () => call('GET', '/health'),
    /** Record mode handshake: the agent starts watching the screen for this recording, and stops. */
    recordStart: (session, { app = '' } = {}) => call('POST', '/record/start', { session, app }),
    recordStop: (session) => call('POST', '/record/stop', { session }),
    events: (session, after = 0) => call('GET', '/events?session=' + encodeURIComponent(session) + '&after=' + encodeURIComponent(after))
  };
}
/**
 * Simulated driver for the demo and tests: every step passes unless `failIf` says otherwise. With `pictures` it sends
 * an illustration of the step as its screenshot, the way a real agent sends its screen capture.
 */
export function demoDriver({ failIf = null, latencyMs = 0, pictures = true } = {}) {
  return {
    perform: async (step, ctx = {}) => {
      if (latencyMs) await sleepAbortable(latencyMs, ctx.signal || new AbortController().signal);
      if (ctx.signal && ctx.signal.aborted) return { ok: false, stopped: true, message: 'Stopped' };
      const why = failIf ? failIf(step, ctx) : null;
      if (why) return { ok: false, code: 'target-missing', message: typeof why === 'string' ? why : 'Could not find "' + step.target + '" on the page', ...(pictures ? { screenshot: renderShot(step, 'failed') } : {}) };
      return { ok: true, message: 'Simulated: ' + step.name, ...(pictures ? { screenshot: renderShot(step, 'ok') } : {}) };
    }
  };
}
