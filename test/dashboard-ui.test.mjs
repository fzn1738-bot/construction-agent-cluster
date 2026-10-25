import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const PUB = new URL('../dashboard/public/', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, PUB), 'utf8');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
const design = fs.readFileSync(new URL('../design/DESIGN.md', import.meta.url), 'utf8');
const { describe } = await import('../dashboard/public/hero.js');
const { bytes, ext } = await import('../dashboard/public/panes/common.js');
const { mask } = await import('../dashboard/outcomes.mjs');

test('F8: the overview visual has a text equivalent naming every tab, its state, demo and partial outages', () => {
  const panes = [
    { id: 'documents', title: 'Site documents', state: { state: 'ok', text: '12 documents filed' } },
    { id: 'transfers', title: 'Contractor file transfers', state: { state: 'warn', text: '1 failed transfer' } },
    { id: 'inbox', title: 'Project inbox', state: { state: 'idle', text: 'Demo data · Add the mailbox host, user and password in Keys in Settings', demo: true } },
    { id: 'activity-log', title: 'Activity record', state: { state: 'bad', text: 'Record problem' } },
    { id: 'connections-for-every-outside', title: 'Connection health', state: { state: 'bad', text: 'Contractor FTP server unreachable' } }];
  const text = describe({ status: { headline: 'Failing', ring: [{ label: 'Runs today', value: 24 }, { label: 'Success', value: '88%' }, { label: 'Last run', value: '2m' }] }, metrics: [{ key: 'success', value: 88 }], panes, demo: false });
  assert.match(text, /^Failing\./); assert.match(text, /Success rate 88%/); assert.match(text, /Runs today 24, Success 88%, Last run 2m/);
  assert.match(text, /Site documents: Healthy, 12 documents filed/);
  assert.match(text, /Contractor file transfers: Needs a look/);
  assert.match(text, /Project inbox: Waiting for setup \(demo data\)/, 'a single outcome on demo data says so');
  assert.match(text, /Activity record: Failing, Record problem/);
  assert.match(text, /Connection health: Failing, Contractor FTP server unreachable/, 'the tabs across outcomes are part of the state too');
  assert.match(describe({ status: { headline: 'Healthy' }, panes: [], demo: true }), /Healthy \(demo data\)/);
});

test('F8: hero.js animates but honours prefers-reduced-motion, and has keyboard buttons per tab', () => {
  const src = read('hero.js');
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /requestAnimationFrame/);
  assert.match(src, /ctx\.go\('pane\/'/, 'each node opens its tab');
  assert.match(src, /aria-label/);
});

test('F3: every pane screen exports render() and update(), and none breaks the strict CSP', () => {
  for (const p of spec.panes) {
    const src = read('panes/' + p.id + '.js');
    assert.match(src, /export (async )?function render\(root, ctx\)/, p.id);
    assert.match(src, /export (async )?function update\(root, ctx\)/, p.id);
    assert.doesNotMatch(src, /innerHTML|\.style\.|setAttribute\('style'|<script|eval\(|fetch\(['"]http/, p.id + ' stays inside the CSP');
    assert.doesNotMatch(src, /TODO|FIXME|lorem/i, p.id);
  }
  assert.doesNotMatch(read('hero.js'), /innerHTML|\.style\.|eval\(|TODO/);
});

test('look and feel: only the design tokens, the system fonts and the type scale', () => {
  const css = read('theme.css');
  const tail = css.slice(css.indexOf('pane screens (panes'));
  assert.doesNotMatch(tail, /#[0-9a-fA-F]{3,8}\b/, 'colours come from var(--token)');
  assert.doesNotMatch(tail, /font-family:\s*(?!var\()/);
  for (const hex of css.match(/#[0-9a-fA-F]{6}\b/g)) assert.ok(design.toLowerCase().includes(hex.toLowerCase()), hex + ' is a colour from design/DESIGN.md');
  assert.doesNotMatch(css, /Roboto|Consolas/, 'system stacks only');
  for (const px of tail.match(/\b(\d+(?:\.\d+)?)px (?:var\(--|\/)/g) || []) assert.ok([12, 14, 16, 20, 28, 44].includes(parseFloat(px)), px + ' is on the type scale');
  for (const m of tail.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) assert.ok([12, 14, 16, 20, 28, 44].includes(Number(m[1])), m[0] + ' is on the type scale');
});

test('helpers format file sizes and extensions, and mask keys for who is looking', () => {
  assert.equal(bytes(null), ''); assert.equal(bytes(512), '512 B'); assert.equal(bytes(2400000), '2.3 MB');
  assert.equal(ext('A-101.pdf'), 'PDF'); assert.equal(ext('README'), '•');
  assert.equal(mask('s3cret-pass-9f2a', true, true), '••••••••9f2a');
  assert.equal(mask('short', true, true), '••••••••');
  assert.equal(mask('s3cret-pass-9f2a', true, false), 'Set', 'a client only learns that it is set');
  assert.equal(mask('ftp.example', false, true), 'ftp.example');
  assert.equal(mask('', true, true), 'Not set');
});

test('F5/F6: no key is read straight from the environment or hard-coded; every connection field is a setting', () => {
  for (const f of ['../dashboard/hooks.mjs', '../dashboard/demo.mjs', '../dashboard/outcomes.mjs']) {
    const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /process\.env\.(FTP|IMAP|SITE|PM)_/i, f);
    assert.doesNotMatch(src, /TODO|FIXME|not implemented/i, f);
  }
  assert.match(fs.readFileSync(new URL('../dashboard/hooks.mjs', import.meta.url), 'utf8'), /getSettings\(\)/);
  const secrets = spec.settings.filter((s) => s.type === 'secret').map((s) => s.key);
  assert.deepEqual(secrets.sort(), ['ftp_password', 'imap_password']);
  assert.deepEqual(spec.connections.map((c) => c.id), ['folders', 'ftp', 'imap']);
  for (const c of spec.connections) for (const f of [...c.fields, ...(c.optional || [])]) assert.ok(spec.settings.some((s) => s.key === f), c.id + ' field ' + f + ' is a setting');
});

test('F6: Settings exposes connection fields and each outcome links to the live setup screen', () => {
  const app = read('app.js');
  const common = read('panes/common.js');
  assert.match(app, /sc = admin\.settings\.schema, v = admin\.settings\.values/, 'Settings includes connection fields');
  assert.match(common, /href: '#\/admin\/settings'/, 'demo outcomes open Settings');
  assert.match(app, /values: \{ \[x\.key\]: null \}/, 'a stored password can be cleared');
});
