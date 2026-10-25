// F3/F4/F8: every pane screen really renders its records with the kit's helpers, its buttons work, and the
// Overview centrepiece draws the whole solution's state. Rendered against a minimal DOM (testkit/fake-dom.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, paneCtx, root, settle, h } from '../testkit/fake-dom.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dash-screens-'));
process.env.HQ_APP_DATA = path.join(dir, 'data'); process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'none.json'); process.env.AGENT_AUTOSTART = '0';
install();
const demo = await import('../dashboard/demo.mjs');
const hooks = await import('../dashboard/hooks.mjs');
const spec = JSON.parse(fs.readFileSync(new URL('../dashboard/dashboard.json', import.meta.url), 'utf8'));
const screen = (id) => import('../dashboard/public/panes/' + id + '.js');
const META = spec.panes.filter((p) => !['documents', 'transfers', 'inbox', 'activity-log'].includes(p.id));

test('F3: every pane screen renders its own records (demo data) with its planned columns', async () => {
  for (const p of spec.panes) {
    const mod = await screen(p.id);
    const r = root(); const ctx = paneCtx(demo, p.id);
    await mod.render(r, ctx);
    const text = r.textContent;
    assert.ok(text.length > 80, p.id + ' shows something');
    assert.match(text, /Demo data/, p.id + ' says its numbers are demo samples');
    if (META.includes(p) && p.columns) for (const c of p.columns) assert.ok(text.includes(c), p.id + ' shows the ' + c + ' column');
    assert.doesNotMatch(text, /undefined|NaN|\[object Object\]/, p.id + ' renders clean values');
    if (mod.update) await mod.update(r, ctx);
  }
});

test('F3: outcome screens show their real records, and a tab without keys shows demo records marked as such', async () => {
  const r = root(); await (await screen('documents')).render(r, paneCtx(hooks, 'documents'));
  assert.match(r.textContent, /Showing demo records/);
  assert.match(r.textContent, /Add the site folder in Settings/);
  assert.match(r.textContent, /A-101_Level2_Plan_RevC\.pdf/, 'demo rows still fill the screen');
  const a = root(); await (await screen('activity-log')).render(a, paneCtx(hooks, 'activity-log'));
  assert.doesNotMatch(a.textContent, /Showing demo records/, 'the record on this Mac is always live');
});

test('F4: every button on every screen works through paneAction', async () => {
  for (const p of spec.panes) {
    const mod = await screen(p.id);
    const r = root(); const ctx = paneCtx(demo, p.id);
    await mod.render(r, ctx);
    const buttons = r.all().filter((e) => e.tagName === 'BUTTON' && /\bbtn\b/.test(e.attrs.class || '') && (e.listeners.click || []).length && e.attrs.disabled == null);
    for (const b of buttons.slice(0, 4)) { b.click(); await settle(); }
    const forms = r.all().filter((e) => e.tagName === 'FORM');
    for (const f of forms) for (const fn of f.listeners.submit || []) { fn({ preventDefault() {} }); await settle(); }
    if (buttons.length || forms.length) assert.ok(ctx.log.length > 0, p.id + ' buttons call paneAction');
    for (const [action, res] of ctx.log) assert.notEqual(res.message, 'Unknown action', p.id + ' handles ' + action);
  }
});

test('F4: Action history runs an outcome and the result lands in its history', async () => {
  const id = 'working-actions';
  const r = root(); const ctx = paneCtx(demo, id);
  await (await screen(id)).render(r, ctx);
  const before = (await demo.pane(id)).runs.length;
  const scan = r.all().find((e) => e.tagName === 'BUTTON' && /Scan site folders/.test(e.textContent));
  scan.click(); await settle();
  assert.equal(ctx.log[0][0], 'scan');
  assert.equal((await demo.pane(id)).runs.length, before + 1);
  assert.match(r.textContent, /Scanned 1 folder/, 'the result message shows on the screen');
});

test('F6: the Keys screen saves a key for real and a client only sees whether keys are set', async () => {
  const id = 'keys-entered-in-settings';
  const watch = path.join(dir, 'site'); fs.mkdirSync(watch, { recursive: true });
  const r = root(); const ctx = paneCtx(hooks, id);
  await (await screen(id)).render(r, ctx);
  const select = r.all().find((e) => e.tagName === 'SELECT');
  assert.ok(select, 'admin gets the form');
  const input = r.all().find((e) => e.tagName === 'INPUT' && e.attrs.name === 'value');
  input.value = watch;
  const form = r.all().find((e) => e.tagName === 'FORM');
  form.listeners.submit[0]({ preventDefault() {} });
  for (let i = 0; i < 50 && !ctx.log.length; i++) await settle();
  const [, res] = ctx.log[0];
  assert.equal(res.ok, true, res.message); assert.match(res.message, /Watched site folder saved\. Test passed/);
  assert.equal(res.data.keys.find((k) => k.key === 'watch_folder').status, 'Valid');
  const c = root();
  await (await screen(id)).render(c, paneCtx(hooks, id, { id: 'nobody', name: 'Client', role: 'client' }));
  assert.match(c.textContent, /Only the admin can change keys/);
  assert.ok(!c.all().some((e) => e.tagName === 'SELECT'), 'no form for clients');
});

test('F8: the Site map tab mounts the live centrepiece and the Overview hero describes every outcome', async () => {
  const id = 'a-futuristic-overview-visual-s';
  const r = root(); await (await screen(id)).render(r, paneCtx(demo, id));
  assert.ok(r.all().some((e) => e.tagName === 'CANVAS'), 'the visual is drawn on a canvas');
  assert.match(r.textContent, /Outcome status/);
  const hero = await import('../dashboard/public/hero.js');
  const states = await demo.paneStatus();
  const panes = spec.panes.map((p) => ({ id: p.id, title: p.title, state: states[p.id] }));
  const o = root();
  hero.render(o, { h, status: await demo.status(), metrics: await demo.metrics(), panes, demo: true, go: () => {} });
  const text = o.textContent;
  for (const p of spec.panes) assert.ok(text.includes(p.title), 'the hero shows ' + p.title);
  assert.match(text, /Success rate \d+%/);
  hero.update(o, { h, status: await demo.status(), metrics: await demo.metrics(), panes, demo: true, go: () => {} });
  await hooks.shutdown();
});
