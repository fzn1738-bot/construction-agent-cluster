// Data the dashboard keeps on disk (dashboard/data/, never committed): settings, users and their access,
// the activity log, runs and feedback. hooks.mjs can read settings with getSettings().
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DATA = process.env.HQ_APP_DATA || path.join(HERE, 'data');
export const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'dashboard.json'), 'utf8'));
fs.mkdirSync(DATA, { recursive: true });

const file = (f) => path.join(DATA, f);
export function readJSON(f, fallback) { try { return JSON.parse(fs.readFileSync(file(f), 'utf8')); } catch { return fallback; } }
export function writeJSON(f, v) { const tmp = file(f) + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(v, null, 2)); fs.renameSync(tmp, file(f)); }
export function readLines(f, n = 200) { try { return fs.readFileSync(file(f), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; } }
export function appendLine(f, o) { fs.appendFileSync(file(f), JSON.stringify(o) + '\n'); }

// ---------- secrets ----------
function secret() {
  let s = readJSON('secret.json', null);
  if (!s || !s.salt) { s = { salt: crypto.randomBytes(16).toString('hex') }; writeJSON('secret.json', s); try { fs.chmodSync(file('secret.json'), 0o600); } catch {} }
  return s;
}
export const hashCode = (code) => crypto.createHash('sha256').update(secret().salt + ':' + String(code)).digest('hex');
const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
export function newCode() { const b = crypto.randomBytes(12); return [0, 4, 8].map((o) => [...b.subarray(o, o + 4)].map((x) => ALPHA[x % ALPHA.length]).join('')).join('-'); }
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// The owner's key: HQ passes HQ_ADMIN_KEY; run on its own, the dashboard makes one and prints it once.
export function adminKey() {
  if (process.env.HQ_ADMIN_KEY) return process.env.HQ_ADMIN_KEY;
  let k = readJSON('admin.json', null);
  if (!k || !k.key) { k = { key: newCode() }; writeJSON('admin.json', k); try { fs.chmodSync(file('admin.json'), 0o600); } catch {} k.fresh = true; }
  return k.key;
}

// ---------- panes ----------
// One pane per feature or service the solution delivers, from dashboard.json. Each lists the metrics, panels and
// actions it shows; anything not listed in a pane shows on Overview.
export function panes() {
  const vis = readJSON('panes.json', {});
  return (Array.isArray(SPEC.panes) ? SPEC.panes : []).filter((p) => p && p.id).map((p) => ({
    id: String(p.id), title: String(p.title || p.id), summary: String(p.summary || ''), feature: p.feature || null,
    metrics: p.metrics || [], panels: p.panels || [], actions: p.actions || [],
    layout: ['grid', 'focus', 'split'].includes(p.layout) ? p.layout : 'grid',
    clientVisible: vis[p.id] ? vis[p.id].clientVisible !== false : p.client !== false
  }));
}
export function setPaneVisibility(id, clientVisible) { const v = readJSON('panes.json', {}); v[id] = { clientVisible: !!clientVisible }; writeJSON('panes.json', v); }

// ---------- settings ----------
export const settingsSchema = () => (Array.isArray(SPEC.settings) ? SPEC.settings : []).filter((s) => s && s.key).map((s) => ({
  key: String(s.key), label: String(s.label || s.key), type: ['text', 'number', 'toggle', 'select', 'secret', 'textarea'].includes(s.type) ? s.type : 'text',
  options: Array.isArray(s.options) ? s.options.map(String) : [], help: String(s.help || ''), default: s.default ?? (s.type === 'toggle' ? false : s.type === 'number' ? 0 : ''), group: String(s.group || 'General')
}));
// A setting left empty falls back to an environment variable of the same name in capitals (youtube_api_key ->
// YOUTUBE_API_KEY), so keys already in a .env keep working; anything saved in Settings wins.
const envOf = (k) => process.env[String(k).toUpperCase().replace(/[^A-Z0-9_]/g, '_')];
export function getSettings() {
  const saved = readJSON('settings.json', {});
  const out = {};
  for (const s of settingsSchema()) {
    const v = saved[s.key] !== undefined && saved[s.key] !== '' ? saved[s.key] : undefined;
    out[s.key] = v !== undefined ? v : ((s.type === 'secret' || s.type === 'text') && envOf(s.key)) || s.default;
  }
  for (const [k, v] of Object.entries(saved)) if (!(k in out)) out[k] = v;
  return out;
}
export function saveSettings(values) {
  const cur = readJSON('settings.json', {});
  const changed = [];
  for (const s of settingsSchema()) {
    if (!(s.key in values)) continue;
    let v = values[s.key];
    if (v === null) {
      if (cur[s.key] !== undefined) { delete cur[s.key]; changed.push(s.key); }
      continue;
    }
    if (s.type === 'secret' && (v === '' || v === '••••••')) continue;   // left blank: keep the saved secret
    if (s.type === 'number') { v = Number(v); if (!Number.isFinite(v)) continue; }
    else if (s.type === 'toggle') v = v === true || v === 'true' || v === 'on' || v === 1;
    else if (s.type === 'select' && s.options.length && !s.options.includes(String(v))) continue;
    else v = String(v).slice(0, 4000);
    if (cur[s.key] !== v) { cur[s.key] = v; changed.push(s.key); }
  }
  writeJSON('settings.json', cur);
  return changed;
}
export const settingSource = (key) => { const saved = readJSON('settings.json', {}); return saved[key] !== undefined && saved[key] !== '' ? 'settings' : envOf(key) ? 'env' : null; };
export const maskedSettings = () => { const v = getSettings(); for (const s of settingsSchema()) if (s.type === 'secret' && v[s.key]) v[s.key] = '••••••'; return v; };

// ---------- users and access ----------
// role admin: everything. role client: only the panes they are given (or every client-visible pane), and run
// buttons only when canRun is on.
export const users = () => readJSON('users.json', []);
const saveUsers = (u) => writeJSON('users.json', u);
export const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role, panes: u.panes, canRun: !!u.canRun, disabled: !!u.disabled, createdAt: u.createdAt, lastSeen: u.lastSeen || null, builtIn: !!u.builtIn });
export function addUser({ name, role = 'client', panes: p = '*', canRun = true }) {
  const code = newCode();
  const u = { id: crypto.randomBytes(5).toString('hex'), name: String(name || 'Client').slice(0, 80), role: role === 'admin' ? 'admin' : 'client', panes: p === '*' ? '*' : (Array.isArray(p) ? p.map(String) : []), canRun: !!canRun, disabled: false, codeHash: hashCode(code), createdAt: new Date().toISOString() };
  const all = users(); all.push(u); saveUsers(all);
  return { user: publicUser(u), code };
}
export function updateUser(id, patch) {
  const all = users(); const u = all.find((x) => x.id === id); if (!u) return null;
  if (patch.name != null) u.name = String(patch.name).slice(0, 80);
  if (patch.role) u.role = patch.role === 'admin' ? 'admin' : 'client';
  if (patch.panes != null) u.panes = patch.panes === '*' ? '*' : (Array.isArray(patch.panes) ? patch.panes.map(String) : u.panes);
  if (patch.canRun != null) u.canRun = !!patch.canRun;
  if (patch.disabled != null) u.disabled = !!patch.disabled;
  let code = null;
  if (patch.resetCode) { code = newCode(); u.codeHash = hashCode(code); }
  saveUsers(all);
  return { user: publicUser(u), code };
}
export function removeUser(id) { const all = users(); const n = all.filter((u) => u.id !== id); saveUsers(n); return n.length !== all.length; }

// Who a key belongs to. HQ passes HQ_CLIENT_KEY for a built-in preview client, so you can see the client view.
export function whoIs(key) {
  if (!key) return null;
  if (same(key, adminKey())) return { id: 'owner', name: 'Owner', role: 'admin', panes: '*', canRun: true };
  if (process.env.HQ_CLIENT_KEY && same(key, process.env.HQ_CLIENT_KEY)) {
    const off = readJSON('preview-client.json', {}).disabled;
    return off ? null : { id: 'preview-client', name: 'Preview client', role: 'client', panes: '*', canRun: true, builtIn: true };
  }
  const hsh = hashCode(key);
  const all = users();
  const u = all.find((x) => !x.disabled && same(x.codeHash, hsh));
  if (!u) return null;
  u.lastSeen = new Date().toISOString();
  try { saveUsers(all); } catch {}
  return publicUser(u);
}
export function setPreviewClient(disabled) { writeJSON('preview-client.json', { disabled: !!disabled }); }
export const previewClientOn = () => !!process.env.HQ_CLIENT_KEY && !readJSON('preview-client.json', {}).disabled;

// the panes a user may open
export function allowedPanes(user) {
  const all = panes();
  if (!user) return [];
  if (user.role === 'admin') return all;
  const vis = all.filter((p) => p.clientVisible);
  return user.panes === '*' ? vis : vis.filter((p) => (user.panes || []).includes(p.id));
}

// ---------- maintenance and activity ----------
export const maintenance = () => readJSON('maintenance.json', { on: false, message: '' });
export function setMaintenance(on, message = '') { writeJSON('maintenance.json', { on: !!on, message: String(message || '').slice(0, 300), at: new Date().toISOString() }); }
export function audit(who, what) { appendLine('audit.jsonl', { at: new Date().toISOString(), who: who ? who.name + ' (' + who.role + ')' : 'system', what: String(what).slice(0, 300) }); }

// ---------- connections ----------
// The outside services the solution needs (dashboard.json "connections"): each names the settings that hold its
// keys or logins. A connection is ready when every required setting has a value; the admin can test it.
export const connectionsSpec = () => (Array.isArray(SPEC.connections) ? SPEC.connections : []).filter((c) => c && c.id).map((c) => ({
  id: String(c.id), name: String(c.name || c.id), summary: String(c.summary || ''), docs: String(c.docs || ''), required: c.required !== false,
  fields: (Array.isArray(c.fields) ? c.fields : []).map(String), optional: (Array.isArray(c.optional) ? c.optional : []).map(String)
}));
export function connections() {
  const v = getSettings();
  const tests = readJSON('connections.json', {});
  return connectionsSpec().map((c) => {
    const missing = c.fields.filter((k) => v[k] === undefined || v[k] === '' || v[k] === null);
    return { ...c, ready: !missing.length, missing, from: c.fields.map((k) => ({ key: k, source: settingSource(k) })), test: tests[c.id] || null };
  });
}
export function saveConnectionTest(id, r) { const t = readJSON('connections.json', {}); t[id] = { ok: !!r.ok, message: String(r.message || '').slice(0, 300), at: new Date().toISOString() }; writeJSON('connections.json', t); return t[id]; }
export function connectionSummary() {
  const all = connections();
  const req = all.filter((c) => c.required);
  return { total: all.length, ready: all.filter((c) => c.ready).length, requiredReady: req.every((c) => c.ready), missing: all.filter((c) => !c.ready).map((c) => c.name) };
}

// ---------- demo data ----------
// Until the required connections are set up, the dashboard shows the solution's demo data (dashboard/demo.mjs) so
// every pane can be tried. The admin can switch it on or off in Control; the choice sticks.
export function demoOn() {
  const d = readJSON('demo.json', null);
  if (d && typeof d.on === 'boolean') return d.on;
  if (SPEC.demo === false || !fs.existsSync(path.join(HERE, 'demo.mjs'))) return false;   // no demo data written: real hooks
  return connectionsSpec().length ? !connectionSummary().requiredReady : false;
}
export function setDemo(on) { writeJSON('demo.json', { on: !!on, at: new Date().toISOString() }); }
