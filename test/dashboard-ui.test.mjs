import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PUB = new URL('../dashboard/public/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, PUB), 'utf8');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
const { describe } = await import('../dashboard/public/hero.js');
const { bytes, ext } = await import('../dashboard/public/panes/common.js');

test('F8: the overview visual has a text equivalent that names every outcome, its state and demo mode', () => {
  const panes = [
    { id: 'documents', title: 'Site documents', state: { state: 'ok', text: '12 documents filed' } },
    { id: 'transfers', title: 'Contractor file transfers', state: { state: 'warn', text: '1 failed transfer' } },
    { id: 'inbox', title: 'Project inbox', state: { state: 'idle', text: 'Add the mailbox login in Connections' } },
    { id: 'activity-log', title: 'Activity record', state: { state: 'bad', text: 'Record problem' } }];
  const text = describe({ status: { headline: 'Failing' }, metrics: [{ key: 'syncRate', value: 88 }], panes, demo: true });
  assert.match(text, /Failing \(demo data\)/); assert.match(text, /Sync rate 88%/);
  assert.match(text, /Site documents: Healthy, 12 documents filed/);
  assert.match(text, /Contractor file transfers: Needs a look/);
  assert.match(text, /Project inbox: Waiting for setup/);
  assert.match(text, /Activity record: Failing, Record problem/);
});

test('F8: hero.js animates but honours prefers-reduced-motion, and has keyboard buttons per outcome', () => {
  const src = read('hero.js');
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /requestAnimationFrame/);
  assert.match(src, /ctx\.go\('pane\/'/, 'each node opens its tab');
  assert.match(src, /aria-label/);
});

test('F3: every pane screen exports render() and update(), and none breaks the strict CSP', () => {
  for (const p of spec.panes) {
    const src = read('panes/' + p.id + '.js');
    assert.match(src, /export function render\(root, ctx\)/, p.id);
    assert.match(src, /export function update\(root, ctx\)/, p.id);
    assert.doesNotMatch(src, /innerHTML|\.style\.|setAttribute\('style'|<script|eval\(|fetch\(['"]http/, p.id + ' stays inside the CSP');
    assert.doesNotMatch(src, /TODO|FIXME|lorem/i, p.id);
  }
  assert.doesNotMatch(read('hero.js'), /innerHTML|\.style\.|eval\(|TODO/);
});

test('F3: the stylesheet only uses the design tokens (no new colours)', () => {
  const css = read('theme.css');
  const tail = css.slice(css.indexOf('pane screens (panes'));
  assert.doesNotMatch(tail, /#[0-9a-fA-F]{3,8}\b/, 'colours come from var(--token)');
  assert.doesNotMatch(tail, /font-family:\s*(?!var\()/);
});

test('helpers format file sizes and extensions', () => {
  assert.equal(bytes(null), ''); assert.equal(bytes(512), '512 B'); assert.equal(bytes(2400000), '2.3 MB');
  assert.equal(ext('A-101.pdf'), 'PDF'); assert.equal(ext('README'), '•');
});

test('F6: no key is read straight from the environment or hard-coded', () => {
  for (const f of ['../dashboard/hooks.mjs', '../dashboard/demo.mjs']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /process\.env\.(FTP|IMAP|SITE|PM)_/i, f);
    assert.doesNotMatch(src, /TODO|FIXME|not implemented/i, f);
  }
  assert.match(fs.readFileSync(new URL('../dashboard/hooks.mjs', import.meta.url), 'utf8'), /getSettings\(\)/);
  const secrets = spec.settings.filter((s) => s.type === 'secret').map((s) => s.key);
  assert.deepEqual(secrets.sort(), ['ftp_password', 'imap_password']);
  for (const c of spec.connections) for (const f of [...c.fields, ...(c.optional || [])]) assert.ok(spec.settings.some((s) => s.key === f), c.id + ' field ' + f + ' is a setting');
});
