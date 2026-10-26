#!/usr/bin/env node
// Desktop automation agent for Workflow Automation. Run it on the Mac where the work is done:
//
//   node agent/rpa-agent.mjs --port 4610 --token <a long random token>      (or: npm run rpa-agent -- --token ...)
//
// then save its address (http://<that mac>:4610) and the token in the dashboard's Connections > Desktop automation
// agent. Record mode asks it to watch the screen (POST /record/start), pulls each captured action with its
// screenshot (GET /events), and stops it (POST /record/stop); Run mode sends one step at a time (POST /step) and gets
// pass or fail with a screenshot back. The protocol is in docs/rpa-agent-protocol.md.
//
// On macOS it needs Accessibility and Screen Recording permission (System Settings > Privacy & Security); without
// them /record/start answers code "permission-denied" and the dashboard shows that instead of recording.
import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const VERSION = '2.0';
const KINDS = ['click', 'type', 'select', 'key', 'navigate', 'app'];
const cut = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

/** A captured action in the shape the dashboard records, or null when it is not one. */
export function normalise(ev) {
  if (!ev || !KINDS.includes(ev.kind)) return null;
  const e = { kind: ev.kind, target: cut(ev.target, 200), value: cut(ev.value, 500), page: cut(ev.page, 300), app: cut(ev.app, 80), field: cut(ev.field, 80), inputType: cut(ev.inputType, 20), at: Number.isFinite(Number(ev.at)) ? Number(ev.at) : Date.now() };
  if (ev.sensitive === true) { e.sensitive = true; e.value = ''; }   // a password field: never send what was typed
  if (!e.target && !e.value && !e.page && !e.app) return null;
  return e;
}

/**
 * The agent: an HTTP handler around a platform ({ name, permissions(), startWatch({ onEvent, onError }), stopWatch(),
 * screenshot() -> { url } | { error }, perform(step) -> { ok, message, code? } }).
 */
export function createAgent({ token, platform, maxEvents = 2000 } = {}) {
  if (!token || String(token).length < 8) throw new Error('Give the agent a token of at least 8 characters (--token)');
  const want = Buffer.from('Bearer ' + token);
  const sessions = new Map();   // session id -> { id, events, base, error, watching }
  let current = null;
  let chain = Promise.resolve();
  let stepBusy = false;

  const authed = (req) => { const got = Buffer.from(String(req.headers.authorization || '')); return got.length === want.length && crypto.timingSafeEqual(got, want); };
  const session = (id) => sessions.get(String(id || ''));

  function capture(s, raw) {
    // one at a time, in order: each action gets the screen as it is right after it happened
    chain = chain.then(async () => {
      const e = normalise(raw); if (!e) return;
      if (!e.sensitive) {
        let shot;
        try { shot = await platform.screenshot(); } catch (err) { shot = { error: String(err.message || err) }; }
        if (shot && shot.url) e.screenshot = shot.url; else e.shotError = 'No screenshot: ' + ((shot && shot.error) || 'screen capture failed');
      }
      s.events.push(e);
      if (s.events.length > maxEvents) { const drop = s.events.length - maxEvents; s.events.splice(0, drop); s.base += drop; }
    }).catch(() => {});
    return chain;
  }

  async function startRecording(id, app) {
    if (!id) return { ok: false, code: 'bad-request', message: 'Say which recording (session)' };
    if (current && current.id !== id) await stopRecording(current.id);
    const perms = await platform.permissions();
    if (!perms.accessibility || !perms.screen) {
      const missing = [!perms.accessibility ? 'Accessibility' : '', !perms.screen ? 'Screen Recording' : ''].filter(Boolean).join(' and ');
      return { ok: false, code: 'permission-denied', message: missing + ' permission was denied on ' + platform.name + '. Allow the automation agent in System Settings > Privacy & Security, then record again.' };
    }
    const s = session(id) || { id, events: [], base: 0, error: null, watching: false };
    sessions.set(id, s);
    while (sessions.size > 5) sessions.delete(sessions.keys().next().value);
    s.error = null;
    try {
      await platform.startWatch({ app, onEvent: (ev) => capture(s, ev), onError: (code, message) => { s.error = { code, message }; s.watching = false; if (current === s) current = null; } });
    } catch (err) { return { ok: false, code: 'watch-failed', message: 'Could not start watching the screen: ' + String(err.message || err).slice(0, 200) }; }
    s.watching = true; current = s;
    return { ok: true, session: id, message: 'Watching the screen' };
  }
  async function stopRecording(id) {
    const s = session(id);
    if (!s) return { ok: false, code: 'not-found', message: 'No such recording' };
    if (current === s) { platform.stopWatch(); current = null; }
    s.watching = false;
    await chain;   // the last actions keep their screenshots
    return { ok: true, events: s.base + s.events.length };
  }

  async function route(req, url, body) {
    const p = url.pathname;
    if (p === '/health' && req.method === 'GET') return { ok: true, version: VERSION, platform: platform.name, permissions: await platform.permissions(), recording: current ? current.id : null };
    if (p === '/record/start' && req.method === 'POST') return startRecording(cut(body.session, 80), cut(body.app, 80));
    if (p === '/record/stop' && req.method === 'POST') return stopRecording(cut(body.session, 80));
    if (p === '/events' && req.method === 'GET') {
      const s = session(url.searchParams.get('session'));
      if (!s) return { ok: false, code: 'not-found', message: 'No such recording on this agent' };
      if (s.error && s.error.code === 'permission-denied') return { ok: false, ...s.error };
      const after = Math.max(s.base, Number(url.searchParams.get('after')) || 0);
      return { ok: true, events: s.events.slice(after - s.base, after - s.base + 200), next: Math.min(s.base + s.events.length, after + 200), watching: s.watching, error: s.error ? s.error.message : null };
    }
    if (p === '/step' && req.method === 'POST') {
      const step = body.step || {};
      if (!KINDS.includes(step.kind)) return { ok: false, code: 'bad-request', message: 'Unknown action ' + cut(step.kind, 20) };
      if (current) return { ok: false, code: 'busy', message: 'The agent is recording: stop the recording before running a workflow' };
      if (stepBusy) return { ok: false, code: 'busy', message: 'The agent is already performing a step' };
      stepBusy = true;
      try {
        let r;
        try { r = await platform.perform({ kind: step.kind, target: cut(step.target, 200), value: String(step.value ?? '').slice(0, 2000), page: cut(step.page, 300), app: cut(step.app, 80), name: cut(step.name, 100) }); }
        catch (err) { r = { ok: false, message: String(err.message || err).slice(0, 300) }; }
        r = r && typeof r === 'object' ? r : { ok: false, message: 'No answer from the platform' };
        let shot;
        try { shot = await platform.screenshot(); } catch (err) { shot = { error: String(err.message || err) }; }
        return { ok: r.ok === true, message: cut(r.message, 300), ...(r.code ? { code: r.code } : {}), ...(shot && shot.url ? { screenshot: shot.url } : { shotError: (shot && shot.error) || 'screen capture failed' }) };
      } finally { stepBusy = false; }
    }
    return null;
  }

  async function handler(req, res) {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
    if (!authed(req)) return send(401, { ok: false, message: 'Wrong or missing token' });
    let raw = '';
    req.on('data', (d) => { raw += d; if (raw.length > 65536) req.destroy(); });
    await new Promise((r) => req.on('end', r));
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, { ok: false, message: 'Bad JSON' }); }
    try {
      const out = await route(req, new URL(req.url, 'http://agent'), body);
      if (!out) return send(404, { ok: false, message: 'Not found' });
      return send(200, out);
    } catch (err) { return send(500, { ok: false, message: String(err.message || err).slice(0, 300) }); }
  }
  return { handler, startRecording, stopRecording, flush: () => chain, sessions };
}

export function listen(agent, { port = 4610, host = '0.0.0.0' } = {}) {
  const server = http.createServer((req, res) => { agent.handler(req, res); });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}

function argOf(name, fallback) { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.platform !== 'darwin') { console.error('This agent drives macOS. Run it on the Mac where the work is done.'); process.exit(1); }
  const { macPlatform } = await import('./mac-platform.mjs');
  let token = argOf('token', process.env.RPA_AGENT_TOKEN || '');
  if (!token) { token = crypto.randomBytes(18).toString('base64url'); console.log('No --token given; using this one for this session: ' + token); }
  const agent = createAgent({ token, platform: macPlatform() });
  const server = await listen(agent, { port: Number(argOf('port', 4610)), host: argOf('host', '0.0.0.0') });
  console.log('Desktop automation agent ' + VERSION + ' listening on port ' + server.address().port + '. Save http://<this mac>:' + server.address().port + ' and the token in the dashboard\'s Connections.');
}
