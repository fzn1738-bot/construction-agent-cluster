// Solution dashboard server (scaffolded by Mac mini HQ). No dependencies.
// Run it with `npm run dashboard`. HQ deploys it and opens it from your phone at /apps/<repo>/.
// The app's own logic lives in ./hooks.mjs: status(), metrics(), panels(), actions, run(), reports().
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, 'public');
const DATA = path.join(HERE, 'data');
const SPEC = JSON.parse(fs.readFileSync(path.join(HERE, 'dashboard.json'), 'utf8'));
const MOCK = process.env.HQ_MOCK === '1';
const hooks = MOCK ? await import('./mock.mjs') : await import('./hooks.mjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" };

fs.mkdirSync(DATA, { recursive: true });
const readLines = (f, n = 200) => { try { return fs.readFileSync(path.join(DATA, f), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map((l) => JSON.parse(l)); } catch { return []; } };
const appendLine = (f, o) => fs.appendFileSync(path.join(DATA, f), JSON.stringify(o) + '\n');
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { ...HEADERS, 'Content-Type': type }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const body = (req, limit = 65536) => new Promise((resolve, reject) => {
  let s = ''; req.on('data', (d) => { s += d; if (s.length > limit) { reject(new Error('too large')); req.destroy(); } });
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch { reject(new Error('bad JSON')); } });
});
const safely = async (fn, fallback) => { try { const v = await fn(); return v ?? fallback; } catch (e) { return { error: String(e && e.message || e) }; } };
const actionList = () => (Array.isArray(hooks.actions) ? hooks.actions : []).map((a) => ({ id: String(a.id), label: String(a.label || a.id), description: a.description || '', input: a.input || null }));

async function summary() {
  const runs = readLines('runs.jsonl', 50).reverse();
  const fb = readLines('feedback.jsonl', 200);
  const ok = runs.filter((r) => r.ok).length;
  return {
    app: { name: SPEC.title || 'Dashboard', tagline: SPEC.tagline || '', ring: (SPEC.ring || []).map((r) => r.label), mock: MOCK },
    status: await safely(() => hooks.status(), {}), metrics: await safely(() => hooks.metrics(), []), panels: await safely(() => hooks.panels(), []),
    actions: actionList(), reports: await safely(() => hooks.reports ? hooks.reports() : [], []),
    runs: runs.slice(0, 20), health: { runs: runs.length, successRate: runs.length ? Math.round((ok / runs.length) * 100) : null, avgMs: runs.length ? Math.round(runs.reduce((a, r) => a + (r.ms || 0), 0) / runs.length) : null },
    feedback: { up: fb.filter((f) => f.vote === 'up').length, down: fb.filter((f) => f.vote === 'down').length, recent: fb.slice(-5).reverse() },
    at: new Date().toISOString()
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/healthz') return send(res, 200, { ok: true, app: SPEC.title || 'dashboard', id: process.env.HQ_APP_ID || null, mock: MOCK });
    if (p === '/api/summary' && req.method === 'GET') return send(res, 200, await summary());
    if (p === '/api/run' && req.method === 'POST') {
      const b = await body(req);
      const a = actionList().find((x) => x.id === String(b.action || ''));
      if (!a) return send(res, 404, { ok: false, message: 'Unknown action' });
      const t0 = Date.now();
      let out;
      try { out = (await hooks.run(a.id, typeof b.input === 'string' ? b.input.slice(0, 4000) : '')) || { ok: true, message: 'Done' }; }
      catch (e) { out = { ok: false, message: String(e && e.message || e) }; }
      const rec = { at: new Date().toISOString(), action: a.id, label: a.label, ok: out.ok !== false, ms: Date.now() - t0, message: String(out.message || '').slice(0, 500) };
      appendLine('runs.jsonl', rec);
      return send(res, 200, { ...rec, output: out.output ?? null });
    }
    if (p === '/api/feedback' && req.method === 'POST') {
      const b = await body(req, 8192);
      if (!['up', 'down'].includes(b.vote)) return send(res, 400, { ok: false, message: 'vote must be up or down' });
      const rec = { at: new Date().toISOString(), vote: b.vote, note: String(b.note || '').slice(0, 1000), about: String(b.about || '').slice(0, 120) };
      appendLine('feedback.jsonl', rec);
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/reports/')) {
      const f = path.join(DATA, 'reports', path.basename(p));
      if (fs.existsSync(f)) return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'text/plain; charset=utf-8');
      return send(res, 404, 'Not found', 'text/plain');
    }
    const file = p === '/' ? 'index.html' : p.slice(1);
    if (/^[\w.-]+$/.test(file) && fs.existsSync(path.join(PUBLIC, file))) return send(res, 200, fs.readFileSync(path.join(PUBLIC, file)), TYPES[path.extname(file)] || 'application/octet-stream');
    send(res, 404, 'Not found', 'text/plain');
  } catch (e) { send(res, 400, { ok: false, message: e.message }); }
});

export function start(port = Number(process.env.PORT) || SPEC.port || 4100, host = process.env.HOST || '127.0.0.1') {
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const s = await start();
  console.log((SPEC.title || 'Dashboard') + ' on http://' + (process.env.HOST || '127.0.0.1') + ':' + s.address().port + (MOCK ? ' (sample data)' : ''));
}
