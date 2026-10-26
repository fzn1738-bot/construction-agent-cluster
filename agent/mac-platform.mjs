// macOS side of the desktop automation agent: the native helper (mac-helper.swift, compiled once and cached) watches
// clicks, typing and app switches and performs steps; `screencapture` + `sips` take a downsized screenshot; and
// AppleScript reads the address of the front browser tab, which turns into page changes while recording and is
// checked before a step that was recorded on a page.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAX_SHOT = 1400000;   // stays under the dashboard's 1.5 MB limit for one screenshot

/** Browsers whose front tab address AppleScript can read. */
export const BROWSERS = {
  Safari: 'tell application "Safari" to get URL of front document',
  'Safari Technology Preview': 'tell application "Safari Technology Preview" to get URL of front document',
  'Google Chrome': 'tell application "Google Chrome" to get URL of active tab of front window',
  'Microsoft Edge': 'tell application "Microsoft Edge" to get URL of active tab of front window',
  'Brave Browser': 'tell application "Brave Browser" to get URL of active tab of front window',
  Arc: 'tell application "Arc" to get URL of active tab of front window',
  Chromium: 'tell application "Chromium" to get URL of active tab of front window'
};

/** One stdout line of the helper -> { event } | { front } | { error } | null. */
export function parseLine(line) {
  let o;
  try { o = JSON.parse(String(line)); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  if (o.error) return { error: { code: String(o.code || 'watch-failed'), message: String(o.message || o.error) } };
  if (o.type === 'front') return { front: String(o.app || '') };
  if (['click', 'type', 'select', 'key', 'navigate', 'app'].includes(o.kind)) return { event: o };
  return null;
}
/** Is the browser on the page a step was recorded on? Same address, ignoring the query, fragment and a trailing slash. */
export function pageMatches(current, expected) {
  const norm = (u) => String(u || '').replace(/[?#].*$/, '').replace(/\/+$/, '').toLowerCase();
  if (!expected) return true;
  if (/\{\{/.test(expected)) return true;
  return norm(current) === norm(expected) || norm(current).startsWith(norm(expected) + '/');
}
const isUrl = (u) => /^https?:\/\/\S+$/i.test(String(u || ''));

const run = (file, args, { timeout = 20000 } = {}) => new Promise((resolve) => {
  execFile(file, args, { timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || ''), error: err }));
});
const lastJson = (s) => { const lines = String(s).trim().split('\n').reverse(); for (const l of lines) { try { return JSON.parse(l); } catch { /* next */ } } return null; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * The real macOS platform. Options are for tests: `exec(file, args)` replaces running programs and `spawnWatch()`
 * replaces starting the watcher.
 */
export function macPlatform({ helperSrc = path.join(HERE, 'mac-helper.swift'), cacheDir = path.join(os.homedir(), 'Library', 'Caches', 'rpa-agent'), exec = run, spawnWatch = null, pollMs = 1000 } = {}) {
  let binPath = null;
  let watch = null;   // { child, timer, front, url }

  /** Compile the helper once per source version; try the default SDK, then each installed one (newest first). */
  async function helper() {
    if (binPath && fs.existsSync(binPath)) return binPath;
    const src = fs.readFileSync(helperSrc);
    const bin = path.join(cacheDir, 'mac-helper-' + crypto.createHash('sha256').update(src).digest('hex').slice(0, 12));
    if (fs.existsSync(bin)) return (binPath = bin);
    fs.mkdirSync(cacheDir, { recursive: true });
    const base = ['-swift-version', '5', '-O', '-o', bin, helperSrc];
    let r = await exec('swiftc', base, { timeout: 240000 });
    if (r.code !== 0) {
      const roots = ['/Library/Developer/CommandLineTools/SDKs', '/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs'];
      const sdks = roots.flatMap((d) => { try { return fs.readdirSync(d).filter((f) => /^MacOSX\d[\d.]*\.sdk$/.test(f)).map((f) => path.join(d, f)); } catch { return []; } })
        .sort((a, b) => path.basename(b).localeCompare(path.basename(a), undefined, { numeric: true }));
      for (const sdk of sdks) { r = await exec('swiftc', ['-sdk', sdk, ...base], { timeout: 240000 }); if (r.code === 0) break; }
    }
    if (r.code !== 0 || !fs.existsSync(bin)) throw new Error('Could not build the macOS helper: install the Xcode command line tools (xcode-select --install). ' + ((r.stderr || '').split('\n').find((l) => /error/.test(l)) || ''));
    return (binPath = bin);
  }
  async function call(args, timeout = 30000) {
    const r = await exec(await helper(), args, { timeout });
    return lastJson(r.stdout) || { ok: false, message: (r.stderr || 'The macOS helper gave no answer').trim().slice(0, 200) };
  }
  async function frontUrl(app) {
    const script = BROWSERS[app]; if (!script) return '';
    const r = await exec('osascript', ['-e', script], { timeout: 4000 });
    const u = r.stdout.trim();
    return r.code === 0 && isUrl(u) ? u : '';
  }
  async function activate(app) {
    if (!app) return { ok: true };
    const r = await exec('open', ['-a', app], { timeout: 10000 });
    if (r.code !== 0) return { ok: false, code: 'app-missing', message: 'Could not open ' + app + ': ' + (r.stderr.trim() || 'not installed') };
    await sleep(600);
    return { ok: true };
  }

  return {
    name: 'macos',
    async permissions() {
      try { const r = await call(['check'], 15000); return { accessibility: r.accessibility === true, screen: r.screen === true }; }
      catch (e) { return { accessibility: false, screen: false, error: String(e.message || e) }; }
    },
    async startWatch({ onEvent, onError }) {
      this.stopWatch();
      const child = spawnWatch ? spawnWatch() : spawn(await helper(), ['watch'], { stdio: ['ignore', 'pipe', 'pipe'] });
      const w = { child, timer: null, front: '', url: '', stopping: false };
      watch = w;
      readline.createInterface({ input: child.stdout }).on('line', (line) => {
        const p = parseLine(line); if (!p) return;
        if (p.error) { onError(p.error.code, p.error.message); return; }
        if (p.front != null) { w.front = p.front; return; }
        if (p.event.kind === 'app') { w.front = p.event.app || w.front; w.url = ''; }
        onEvent(p.event);
      });
      let errText = '';
      if (child.stderr) child.stderr.on('data', (d) => { errText = (errText + d).slice(-400); });
      child.on('exit', (code) => { if (!w.stopping && watch === w) onError(code === 3 ? 'permission-denied' : 'watch-stopped', errText.trim() || 'The screen watcher stopped (exit ' + code + ')'); });
      // page changes: the front browser tab's address, read every second while a browser is in front
      w.timer = setInterval(async () => {
        if (w.busy || !BROWSERS[w.front]) return;
        w.busy = true;
        try { const u = await frontUrl(w.front); if (u && u !== w.url) { w.url = u; onEvent({ kind: 'navigate', page: u, app: w.front, at: Date.now() }); } } finally { w.busy = false; }
      }, pollMs);
      if (w.timer.unref) w.timer.unref();
      return { ok: true };
    },
    stopWatch() {
      if (!watch) return;
      const w = watch; watch = null; w.stopping = true;
      clearInterval(w.timer);
      try { w.child.kill('SIGTERM'); } catch { /* already gone */ }
    },
    /** The whole screen, downsized to 1280 px wide JPEG (re-squeezed if still too large). */
    async screenshot() {
      const tmp = path.join(os.tmpdir(), 'rpa-shot-' + process.pid + '-' + crypto.randomBytes(4).toString('hex') + '.jpg');
      try {
        const cap = await exec('screencapture', ['-x', '-t', 'jpg', tmp], { timeout: 10000 });
        if (cap.code !== 0 || !fs.existsSync(tmp)) return { error: 'screen capture failed' + (cap.stderr ? ': ' + cap.stderr.trim().slice(0, 120) : ' (is Screen Recording allowed?)') };
        for (const [px, q] of [[1280, 60], [960, 45]]) {
          await exec('sips', ['-Z', String(px), '-s', 'format', 'jpeg', '-s', 'formatOptions', String(q), tmp], { timeout: 10000 });
          const url = 'data:image/jpeg;base64,' + fs.readFileSync(tmp).toString('base64');
          if (url.length <= MAX_SHOT) return { url };
        }
        return { error: 'the screen capture was too large even after shrinking it' };
      } finally { fs.rmSync(tmp, { force: true }); }
    },
    frontUrl,
    /** Perform one recorded step in the app (and on the page) it was recorded in. */
    async perform(step) {
      const app = String(step.app || '');
      if (step.kind === 'app') return { ...(await activate(app || step.target)), message: 'Switched to ' + (app || step.target) };
      if (step.kind === 'navigate') {
        const url = step.page || step.target || step.value;
        if (!isUrl(url)) return { ok: false, code: 'bad-page', message: 'Not a web address: ' + String(url).slice(0, 120) };
        const r = await exec('open', BROWSERS[app] ? ['-a', app, url] : [url], { timeout: 15000 });
        if (r.code !== 0) return { ok: false, message: 'Could not open ' + url + ': ' + r.stderr.trim().slice(0, 120) };
        await sleep(1500);
        return { ok: true, message: 'Opened ' + url };
      }
      if (app) { const a = await activate(app); if (!a.ok) return a; }
      if (step.page && BROWSERS[app]) {
        let cur = '';
        for (let i = 0; i < 8; i++) { cur = await frontUrl(app); if (pageMatches(cur, step.page)) break; await sleep(500); }
        if (!pageMatches(cur, step.page)) return { ok: false, code: 'wrong-page', message: app + ' is on ' + (cur || 'an unknown page') + ', not ' + step.page };
      }
      if (step.kind === 'click') return call(['press', app, step.target]);
      if (step.kind === 'type') return call(['settext', app, step.target, String(step.value ?? '')]);
      if (step.kind === 'select') return call(['choose', app, step.target, String(step.value ?? '')]);
      if (step.kind === 'key') return call(['key', String(step.value || step.target)]);
      return { ok: false, message: 'Unknown action ' + step.kind };
    }
  };
}
