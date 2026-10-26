// Solution dashboard server (scaffolded by Mac mini HQ). No dependencies.
// Run it with `npm run dashboard`. HQ deploys it and opens it from your phone through /apps/<repo>/.
// Two portions share one page:
//   Admin  (the owner's key): every pane, plus Settings, Users & access, Activity and Control.
//   Client (a code the admin hands out): only the panes that client is given, with run buttons if allowed.
// A left sidebar lists Overview, one pane per feature or service (dashboard.json "panes"), Reports and Feedback.
// The app's own logic lives in ./hooks.mjs: status(), metrics(), panels(), actions, run(), reports(), and for its
// own pane screens pane(id) and paneAction(id, action, input); testConnection(id, settings) checks a connection.
// ./demo.mjs has the same exports with realistic demo data, used while the demo switch is on.
// Each pane can have its own screen (public/panes/<id>.js) and Overview its own centrepiece (public/hero.js).
// Every API call carries the key in the x-app-key header (or ?key= for report links).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as store from './store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const SPEC = store.SPEC;
const MOCK = process.env.HQ_MOCK === '1';
const mock = await import('./mock.mjs');
const real = MOCK ? mock : await import('./hooks.mjs');
const demo = MOCK ? mock : fs.existsSync(path.join(HERE, 'demo.mjs')) ? await import('./demo.mjs') : mock;
// where data comes from right now: demo data while the demo switch is on, else the real hooks
const src = () => (MOCK ? mock : store.demoOn() ? demo : real);
const hasFile = (rel) => fs.existsSync(path.join(PUBLIC, rel));
const paneView = (id) => (hasFile('panes/' + id + '.js') ? 'panes/' + id + '.js' : null);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.csv': 'text/csv; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" };

const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { ...HEADERS, 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const body = (req, limit = 65536) => new Promise((resolve, reject) => {
  let s = ''; req.on('data', (d) => { s += d; if (s.length > limit) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('bad JSON')); } });
});
const PANE_BODY_LIMIT = 2 * 1024 * 1024;
const safely = async (fn, fallback) => { try { const v = await fn(); return v ?? fallback; } catch (e) { return { error: String(e && e.message || e) }; } };
const list = (v) => (Array.isArray(v) ? v : []);

// mock (plan and design mockups): the key just picks the view, "client" or anything else for admin
function userFor(req, url) {
  const key = String(req.headers['x-app-key'] || url.searchParams.get('key') || '').trim().slice(0, 200);
  if (MOCK) return key === 'client' ? { id: 'mock-client', name: 'Client', role: 'client', panes: '*', canRun: true } : { id: 'owner', name: 'Owner', role: 'admin', panes: '*', canRun: true };
  return store.whoIs(key);
}

// which pane an item belongs to: its own `pane`, else the pane in dashboard.json that lists it, else Overview
function paneOf(kind, item, all) {
  if (item && item.pane) return String(item.pane);
  const id = kind === 'metrics' ? (item.key || item.label) : kind === 'panels' ? item.title : item.id;
  const p = all.find((x) => list(x[kind]).map(String).includes(String(id)));
  return p ? p.id : 'overview';
}
function actionList() { return list(src().actions).map((a) => ({ id: String(a.id), label: String(a.label || a.id), description: a.description || '', input: a.input || null, pane: a.pane || null, adminOnly: !!a.adminOnly })); }
function visibleActions(user, allowedIds, allPanes) {
  return actionList().filter((a) => !(a.adminOnly && user.role !== 'admin')).map((a) => ({ ...a, pane: paneOf('actions', a, allPanes) }))
    .filter((a) => user.role === 'admin' || a.pane === 'overview' || allowedIds.has(a.pane));
}

async function summary(user) {
  const allPanes = store.panes();
  const allowed = store.allowedPanes(user);
  const ids = new Set(allowed.map((p) => p.id));
  const keep = (kind) => (arr) => list(arr).map((x) => ({ ...x, pane: paneOf(kind, x, allPanes) })).filter((x) => user.role === 'admin' || x.pane === 'overview' || ids.has(x.pane));
  const runs = store.readLines('runs.jsonl', 50).reverse();
  const fb = store.readLines('feedback.jsonl', 200);
  const ok = runs.filter((r) => r.ok).length;
  const mine = user.role === 'admin' ? runs : runs.filter((r) => r.by === user.id || ids.has(r.pane) || r.pane === 'overview');
  const m = store.maintenance();
  const h = src();
  // A client's overview must only count the workflows and runs belonging to that client.
  const who = { user: { id: user.id, name: user.name, role: user.role } };
  const states = await safely(() => (h.paneStatus ? h.paneStatus(who) : {}), {});
  const cs = store.connectionSummary();
  return {
    app: { name: SPEC.title || 'Dashboard', tagline: SPEC.tagline || '', ring: list(SPEC.ring).map((r) => r.label), mock: MOCK, demo: !MOCK && store.demoOn(), hero: hasFile('hero.js') ? 'hero.js' : null },
    me: { name: user.name, role: user.role, canRun: user.role === 'admin' || !!user.canRun },
    panes: allowed.map((p) => ({ id: p.id, title: p.title, summary: p.summary, feature: p.feature, layout: p.layout, clientVisible: p.clientVisible, view: paneView(p.id), state: states && states[p.id] ? states[p.id] : null })),
    connections: user.role === 'admin' ? cs : { total: cs.total, ready: cs.ready },
    status: await safely(() => h.status(who), {}),
    metrics: keep('metrics')(await safely(() => h.metrics(who), [])),
    panels: keep('panels')(await safely(() => h.panels(who), [])),
    actions: visibleActions(user, ids, allPanes),
    reports: list(await safely(() => (h.reports ? h.reports() : []), [])),
    runs: mine.slice(0, 20),
    health: { runs: runs.length, successRate: runs.length ? Math.round((ok / runs.length) * 100) : null, avgMs: runs.length ? Math.round(runs.reduce((a, r) => a + (r.ms || 0), 0) / runs.length) : null },
    feedback: user.role === 'admin' ? { up: fb.filter((f) => f.vote === 'up').length, down: fb.filter((f) => f.vote === 'down').length, recent: fb.slice(-8).reverse() } : { up: 0, down: 0, recent: fb.filter((f) => f.by === user.id).slice(-5).reverse() },
    maintenance: m.on ? { on: true, message: m.message || '' } : { on: false },
    at: new Date().toISOString()
  };
}

function adminState() {
  return {
    settings: { schema: store.settingsSchema(), values: store.maskedSettings() },
    users: store.users().map(store.publicUser),
    previewClient: store.previewClientOn(),
    panes: store.panes().map((p) => ({ id: p.id, title: p.title, summary: p.summary, feature: p.feature, clientVisible: p.clientVisible })),
    connections: store.connections(),
    demo: { on: store.demoOn(), available: fs.existsSync(path.join(HERE, 'demo.mjs')) },
    actions: actionList(),
    maintenance: store.maintenance(),
    audit: store.readLines('audit.jsonl', 100).reverse(),
    feedback: store.readLines('feedback.jsonl', 50).reverse()
  };
}

async function adminPost(p, b, user) {
  if (p === '/api/admin/settings') {
    const changed = store.saveSettings(b.values || {});
    if (changed.length) store.audit(user, 'Changed settings: ' + changed.join(', '));
    if (real.onSettings) await safely(() => real.onSettings(store.getSettings()), null);
    return { ok: true, changed };
  }
  if (p === '/api/admin/users') {
    const panesIn = b.panes === '*' ? '*' : list(b.panes);
    if (b.action === 'add') { const r = store.addUser({ name: b.name, role: b.role, panes: panesIn, canRun: b.canRun !== false }); store.audit(user, 'Added ' + r.user.role + ' ' + r.user.name); return { ok: true, ...r }; }
    if (b.action === 'remove') { const ok = store.removeUser(String(b.id)); if (ok) store.audit(user, 'Removed user ' + b.id); return { ok }; }
    if (b.action === 'update' || b.action === 'reset') {
      const r = store.updateUser(String(b.id), { name: b.name, role: b.role, panes: b.panes == null ? null : panesIn, canRun: b.canRun, disabled: b.disabled, resetCode: b.action === 'reset' });
      if (!r) return { ok: false, message: 'No such user' };
      store.audit(user, (b.action === 'reset' ? 'New access code for ' : 'Updated access for ') + r.user.name);
      return { ok: true, ...r };
    }
    if (b.action === 'preview-client') { store.setPreviewClient(!b.on); store.audit(user, 'Preview client link turned ' + (b.on ? 'on' : 'off')); return { ok: true }; }
    return { ok: false, message: 'Unknown action' };
  }
  if (p === '/api/admin/panes') {
    if (!store.panes().some((x) => x.id === String(b.id))) return { ok: false, message: 'No such pane' };
    store.setPaneVisibility(String(b.id), !!b.clientVisible);
    store.audit(user, 'Pane ' + b.id + (b.clientVisible ? ' shown to' : ' hidden from') + ' clients');
    return { ok: true };
  }
  if (p === '/api/admin/connections') {
    const c = store.connections().find((x) => x.id === String(b.id || ''));
    if (!c) return { ok: false, message: 'No such connection' };
    let r;
    if (!c.ready) r = { ok: false, message: 'Missing: ' + c.missing.join(', ') };
    else if (!real.testConnection) r = { ok: true, message: 'Saved. This solution has no live test for ' + c.name + ' yet.' };
    else { try { r = (await real.testConnection(c.id, store.getSettings())) || { ok: true, message: 'Connected' }; } catch (e) { r = { ok: false, message: String(e && e.message || e) }; } }
    const saved = store.saveConnectionTest(c.id, r);
    store.audit(user, 'Tested ' + c.name + ': ' + (saved.ok ? 'connected' : 'failed') + (saved.message ? ' (' + saved.message.slice(0, 120) + ')' : ''));
    return { ok: true, test: saved };
  }
  if (p === '/api/admin/demo') {
    store.setDemo(!!b.on);
    store.audit(user, 'Demo data turned ' + (b.on ? 'on' : 'off'));
    return { ok: true, on: store.demoOn() };
  }
  if (p === '/api/admin/maintenance') {
    store.setMaintenance(!!b.on, b.message);
    store.audit(user, b.on ? 'Paused client access' + (b.message ? ': ' + b.message : '') : 'Resumed client access');
    return { ok: true };
  }
  return null;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') { const cs = store.connectionSummary(); return send(res, 200, { ok: true, app: SPEC.title || 'dashboard', id: process.env.HQ_APP_ID || null, mock: MOCK, demo: !MOCK && store.demoOn(), portals: ['admin', 'client'], panes: store.panes().length, paneViews: store.panes().filter((x) => paneView(x.id)).length, hero: hasFile('hero.js'), connections: { total: cs.total, ready: cs.ready } }); }
    if (p.startsWith('/api/') || p.startsWith('/reports/')) {
      const user = userFor(req, url);
      if (!user) return send(res, 401, { ok: false, message: 'Sign in with your access code.' });
      const m = store.maintenance();
      if (m.on && user.role !== 'admin' && p !== '/api/me') return send(res, 503, { ok: false, maintenance: true, message: m.message || 'Paused for maintenance. Try again soon.' });
      if (p === '/api/me') return send(res, 200, { ok: true, name: user.name, role: user.role, maintenance: m.on && user.role !== 'admin' ? { on: true, message: m.message || '' } : { on: false } });
      if (p === '/api/summary' && req.method === 'GET') return send(res, 200, await summary(user));
      if (p === '/api/run' && req.method === 'POST') {
        const b = await body(req);
        const allPanes = store.panes();
        const ids = new Set(store.allowedPanes(user).map((x) => x.id));
        const a = visibleActions(user, ids, allPanes).find((x) => x.id === String(b.action || ''));
        if (!a) return send(res, 404, { ok: false, message: 'Unknown action' });
        if (user.role !== 'admin' && !user.canRun) return send(res, 403, { ok: false, message: 'Your access can view but not run.' });
        const t0 = Date.now();
        let out;
        try { out = (await src().run(a.id, typeof b.input === 'string' ? b.input.slice(0, 4000) : '', { user: { id: user.id, name: user.name, role: user.role }, settings: store.getSettings() })) || { ok: true, message: 'Done' }; }
        catch (e) { out = { ok: false, message: String(e && e.message || e) }; }
        const rec = { at: new Date().toISOString(), action: a.id, label: a.label, pane: a.pane, by: user.id, byName: user.name, ok: out.ok !== false, ms: Date.now() - t0, message: String(out.message || '').slice(0, 500) };
        store.appendLine('runs.jsonl', rec);
        return send(res, 200, { ...rec, output: out.output ?? null });
      }
      // a pane's own screen: GET its data, POST an action it offers
      const pm = p.match(/^\/api\/pane\/([a-z0-9-]{1,40})(\/do)?$/);
      if (pm) {
        const pane = store.allowedPanes(user).find((x) => x.id === pm[1]);
        if (!pane) return send(res, 404, { ok: false, message: 'This pane is not part of your access.' });
        const ctx = { user: { id: user.id, name: user.name, role: user.role }, settings: store.getSettings(), demo: !MOCK && store.demoOn() };
        const h = src();
        if (!pm[2] && req.method === 'GET') return send(res, 200, { ok: true, pane: pane.id, data: await safely(() => (h.pane ? h.pane(pane.id, ctx) : null), null) });
        if (pm[2] && req.method === 'POST') {
          if (user.role !== 'admin' && !user.canRun) return send(res, 403, { ok: false, message: 'Your access can view but not change things.' });
          const b = await body(req, PANE_BODY_LIMIT);
          const t0 = Date.now();
          let out;
          try { out = h.paneAction ? (await h.paneAction(pane.id, String(b.action || ''), b.input ?? null, ctx)) || { ok: true, message: 'Done' } : { ok: false, message: 'This pane has no actions.' }; }
          catch (e) { out = { ok: false, message: String(e && e.message || e) }; }
          const rec = { at: new Date().toISOString(), action: pane.id + ':' + String(b.action || '').slice(0, 40), label: pane.title + ': ' + String(b.action || '').slice(0, 40), pane: pane.id, by: user.id, byName: user.name, ok: out.ok !== false, ms: Date.now() - t0, message: String(out.message || '').slice(0, 500) };
          store.appendLine('runs.jsonl', rec);
          return send(res, 200, { ...rec, output: out.output ?? null, data: out.data ?? null });
        }
        return send(res, 405, { ok: false, message: 'Method not allowed' });
      }
      if (p === '/api/feedback' && req.method === 'POST') {
        const b = await body(req, 8192);
        if (!['up', 'down'].includes(b.vote)) return send(res, 400, { ok: false, message: 'vote must be up or down' });
        store.appendLine('feedback.jsonl', { at: new Date().toISOString(), vote: b.vote, note: String(b.note || '').slice(0, 1000), about: String(b.about || '').slice(0, 120), by: user.id, byName: user.name, role: user.role });
        return send(res, 200, { ok: true });
      }
      if (p.startsWith('/api/admin/')) {
        if (user.role !== 'admin') return send(res, 403, { ok: false, message: 'Admins only.' });
        if (p === '/api/admin/state' && req.method === 'GET') return send(res, 200, adminState());
        if (req.method === 'POST') { const r = await adminPost(p, await body(req), user); if (r) return send(res, r.ok === false ? 400 : 200, r); }
        return send(res, 404, { ok: false, message: 'Not found' });
      }
      if (p.startsWith('/reports/')) {
        const f = path.join(store.DATA, 'reports', path.basename(p));
        if (fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'text/plain; charset=utf-8');
        return send(res, 404, 'Not found', 'text/plain');
      }
      return send(res, 404, { ok: false, message: 'Not found' });
    }
    const file = p === '/' ? 'index.html' : p.slice(1);
    // files in public/ and its folders (panes/, fonts/, img/), never outside it
    if (/^[\w-][\w.-]*(\/[\w-][\w.-]*){0,3}$/.test(file) && !file.split('/').includes('..') && fs.existsSync(path.join(PUBLIC, file)) && fs.statSync(path.join(PUBLIC, file)).isFile()) return send(res, 200, fs.readFileSync(path.join(PUBLIC, file)), TYPES[path.extname(file)] || 'application/octet-stream');
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) { send(res, 400, { ok: false, message: e.message }); }
});

// PORT=0 asks the system for a free port (plan mockups use it), so only fall back to the spec when PORT is unset
export function start(port = process.env.PORT != null && process.env.PORT !== '' ? Number(process.env.PORT) : (SPEC.port || 4100), host = process.env.HOST || '127.0.0.1') {
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = await start();
  const where = 'http://' + (process.env.HOST || '127.0.0.1') + ':' + s.address().port;
  console.log((SPEC.title || 'Dashboard') + ' on ' + where + (MOCK ? ' (sample data)' : ''));
  if (!MOCK && !process.env.HQ_ADMIN_KEY) console.log('Admin access code: ' + store.adminKey() + '  (open ' + where + '/#key=' + store.adminKey() + ')');
}
