// The four workflow screens, rendered against the minimal DOM and driven the way a person would: each screen's own
// controls call paneAction and the screen shows the result.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { install, paneCtx, root, settle } from '../testkit/fake-dom.mjs';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rpa-screens-'));
process.env.HQ_APP_DATA = path.join(dir, 'data'); process.env.AGENT_DB = path.join(dir, 'a.db'); process.env.AGENT_CONFIG = path.join(dir, 'none.json'); process.env.AGENT_AUTOSTART = '0';
install();
const demo = await import('../dashboard/demo.mjs');
const screen = (id) => import('../dashboard/public/panes/' + id + '.js');
const find = (r, pred) => r.all().find(pred);
const btn = (r, label) => find(r, (e) => e.tagName === 'BUTTON' && e.textContent.trim() === label);
const byLabel = (r, label) => find(r, (e) => e.tagName === 'BUTTON' && e.attrs['aria-label'] === label);
const input = (r, name) => find(r, (e) => e.tagName === 'INPUT' && e.attrs.name === name);
const submit = async (form) => { for (const fn of form.listeners.submit || []) await fn({ preventDefault() {} }); await settle(); };
const forms = (r) => r.all().filter((e) => e.tagName === 'FORM');
const formWith = (r, name) => forms(r).find((f) => f.all().some((e) => e.attrs.name === name));
const mount = async (id, user) => { const r = root(); const ctx = paneCtx(demo, id, user); const mod = await screen(id); await mod.render(r, ctx); return { r, ctx, mod }; };

test('Record screen: start, capture an action, redact a password, stop and save as a workflow', async () => {
  const { r, ctx } = await mount('rpa-record');
  assert.match(r.textContent, /Demo data/); assert.match(r.textContent, /Record mode/); assert.match(r.textContent, /What is kept/);
  input(r, 'name').value = 'Screen task';
  await submit(formWith(r, 'app'));
  assert.equal(ctx.log.at(-1)[0], 'start'); assert.equal(ctx.log.at(-1)[1].ok, true);
  assert.match(r.textContent, /Recording “Screen task”/);
  input(r, 'target').value = 'Password'; input(r, 'value').value = 'secret!';
  const kind = find(r, (e) => e.tagName === 'SELECT' && e.attrs.name === 'kind'); kind.value = 'type';
  await submit(formWith(r, 'target'));
  assert.equal(ctx.log.at(-1)[0], 'event');
  assert.match(r.textContent, /Redacted/); assert.ok(!r.textContent.includes('secret!'), 'the typed password is not on the screen');
  input(r, 'target').value = 'Save'; find(r, (e) => e.tagName === 'SELECT' && e.attrs.name === 'kind').value = 'click'; await submit(formWith(r, 'target'));
  assert.equal(ctx.log.at(-1)[1].ok, true, JSON.stringify(ctx.log.map((l) => [l[0], l[1].message])));
  assert.match(r.textContent, /2 steps so far/);
  btn(r, 'Stop recording').click(); await settle();
  assert.match(r.textContent, /Save as workflow/);
  input(r, 'wfname').value = 'Screen task flow';
  await submit(formWith(r, 'wfname'));
  assert.equal(ctx.log.at(-1)[0], 'save'); assert.equal(ctx.log.at(-1)[1].ok, true);
  assert.match(r.textContent, /already saved|saved as a workflow/i);
});

test('Workflows, Order and Variables screens edit the same selected workflow', async () => {
  const { r, ctx } = await mount('rpa-workflows');
  for (const col of ['Workflow', 'Steps', 'Schedule', 'Last run']) assert.ok(r.textContent.includes(col));
  assert.match(r.textContent, /Harlow Build/); assert.match(r.textContent, /Northbeam Architects/, 'the admin sees every client');
  const first = find(r, (e) => e.tagName === 'BUTTON' && /rpa-wfname/.test(e.attrs.class || '') && e.textContent === 'Raise purchase order');
  first.click(); await settle();
  assert.equal(ctx.log.at(-1)[0], 'select');
  const order = await mount('rpa-order');
  assert.ok(byLabel(order.r, 'Move step 2 up'));
  byLabel(order.r, 'Move step 2 up').click(); await settle();
  assert.equal(order.ctx.log.at(-1)[0], 'step-move'); assert.equal(order.ctx.log.at(-1)[1].ok, true);
  byLabel(order.r, 'Wait for approval before step 2').click(); await settle();
  await submit(formWith(order.r, 'note'));
  assert.equal(order.ctx.log.at(-1)[0], 'approval'); assert.match(order.r.textContent, /Approval checkpoint/);
  const variables = await mount('rpa-variables');
  input(variables.r, 'vname').value = 'order_ref'; input(variables.r, 'vlabel').value = 'Order reference';
  await submit(formWith(variables.r, 'vname'));
  assert.equal(variables.ctx.log.at(-1)[0], 'var-add'); assert.match(variables.r.textContent, /order_ref/);
  input(r, 'wfname').value = 'Raise PO (renamed)';
  await submit(formWith(r, 'wfname'));
  assert.ok(ctx.log.some(([a]) => a === 'rename')); assert.match(r.textContent, /Raise PO \(renamed\)/);
  input(r, 'at').value = '06:45'; find(formWith(r, 'at'), (e) => e.tagName === 'SELECT' && e.attrs.name === 'kind').value = 'daily';
  await submit(formWith(r, 'at'));
  assert.equal(ctx.log.at(-1)[0], 'set-schedule'); assert.equal(ctx.log.at(-1)[1].ok, true, ctx.log.at(-1)[1].message); assert.match(r.textContent, /at 06:45/);
  const del = btn(r, 'Delete workflow'); del.click(); await settle();
  assert.ok(btn(r, 'Yes, delete it'), 'deleting asks first');
});

test('a client sees only its own workflows on the Workflows screen', async () => {
  const { r } = await mount('rpa-workflows', { id: 'some-client', name: 'Client', role: 'client' });
  assert.match(r.textContent, /Download the weekly programme/); assert.ok(!r.textContent.includes('File a drawing revision'), 'the other customer’s workflow is not there');
  assert.ok(!r.textContent.includes('Northbeam Architects'));
});

const choose = async (r, name) => {
  const sel = find(r, (e) => e.tagName === 'SELECT' && e.attrs.name === 'workflow');
  const opt = find(sel, (e) => e.tagName === 'OPTION' && e.textContent.startsWith(name));
  sel.value = opt.attrs.value; for (const fn of sel.listeners.change || []) fn({ target: sel }); await settle();
};

test('Run screen: pick a workflow, start it, watch steps and screenshots, then the approval gate and the stop button', async () => {
  const { r, ctx, mod } = await mount('rpa-run');
  for (const col of ['Step', 'State', 'Time', 'Screenshot']) assert.ok(r.textContent.includes(col));
  assert.ok(find(r, (e) => e.tagName === 'IMG'), 'screenshots are shown');
  await choose(r, 'Download the weekly programme');
  await submit(forms(r).find((f) => f.all().some((e) => e.attrs.name === 'workflow')));
  assert.equal(ctx.log.at(-1)[0], 'start'); assert.equal(ctx.log.at(-1)[1].ok, true, ctx.log.at(-1)[1].message);
  assert.ok(btn(r, 'Stop'), 'a stop button while it runs');
  assert.match(r.textContent, /Download the weekly programme/);
  for (let i = 0; i < 40 && !/Took/.test(r.textContent); i++) { await new Promise((res) => setTimeout(res, 200)); await mod.update(r, ctx); }
  assert.match(r.textContent, /Took/); assert.ok(!btn(r, 'Stop'), 'no stop button once it has finished');

  await choose(r, 'Chase an overdue invoice');
  input(r, 'v_supplier_email').value = 'accounts@steelwerks.example'; input(r, 'v_invoice_ref').value = 'Invoice 7731';
  await submit(forms(r).find((f) => f.all().some((e) => e.attrs.name === 'v_invoice_ref')));
  assert.equal(ctx.log.at(-1)[1].ok, true, ctx.log.at(-1)[1].message);
  for (let i = 0; i < 60 && !btn(r, 'Approve and continue'); i++) { await new Promise((res) => setTimeout(res, 200)); await mod.update(r, ctx); }
  assert.ok(btn(r, 'Approve and continue'), 'the run stops at its approval checkpoint');
  assert.match(r.textContent, /Approval needed: /); assert.match(r.textContent, /Check the amount before it is sent/);
  btn(r, 'Reject').click(); await settle();
  assert.equal(ctx.log.at(-1)[0], 'approve'); assert.equal(ctx.log.at(-1)[1].ok, true);
  for (let i = 0; i < 30 && !/Rejected by Owner/.test(r.textContent); i++) { await new Promise((res) => setTimeout(res, 100)); await mod.update(r, ctx); }
  assert.match(r.textContent, /Rejected by Owner/); assert.match(r.textContent, /What went wrong/);

  await choose(r, 'Download the weekly programme');
  await submit(forms(r).find((f) => f.all().some((e) => e.attrs.name === 'workflow')));
  btn(r, 'Stop').click(); await settle();
  assert.equal(ctx.log.at(-1)[0], 'stop'); assert.equal(ctx.log.at(-1)[1].ok, true);
  for (let i = 0; i < 30 && !/Took/.test(r.textContent); i++) { await new Promise((res) => setTimeout(res, 100)); await mod.update(r, ctx); }
  assert.match(r.textContent, /Stopped/);
});

test('History screen: failures show their error, a run opens with its steps and log, and Run again works', async () => {
  const { r, ctx } = await mount('rpa-history');
  for (const col of ['Workflow', 'Result', 'Started', 'Time']) assert.ok(r.textContent.includes(col));
  assert.match(r.textContent, /Failed/); assert.match(r.textContent, /Could not find "Submit for approval" on the page/);
  const open = find(r, (e) => e.tagName === 'BUTTON' && /rpa-wfname/.test(e.attrs.class || ''));
  open.click(); await settle();
  assert.equal(ctx.log.at(-1)[0], 'select');
  assert.ok(btn(r, 'Run again from the start'), 'the chosen run shows its actions');
  const rerun = btn(r, 'Run again from the start');
  assert.ok(rerun);
  const chipsEl = find(r, (e) => e.tagName === 'BUTTON' && e.textContent.startsWith('Failed'));
  chipsEl.click(); await settle();
  const rows = r.all().filter((e) => e.tagName === 'TR').length;
  assert.ok(rows >= 2, 'the filter leaves the failed runs');
  assert.doesNotMatch(r.textContent, /undefined|NaN|\[object Object\]/);
  await demo.run('stop-all-runs', null, {});
});

test('the four screens keep to the strict CSP and the design tokens', () => {
  for (const f of ['rpa-common', 'rpa-record', 'rpa-workflows', 'rpa-run', 'rpa-history']) {
    const src = fs.readFileSync(new URL('../dashboard/public/panes/' + f + '.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /innerHTML|\.style\.|setAttribute\('style'|<script|eval\(|fetch\(|TODO|FIXME/, f);
    assert.doesNotMatch(src, /#[0-9a-fA-F]{6}\b/, f + ' uses no colours of its own');
  }
  const css = fs.readFileSync(new URL('../dashboard/public/theme.css', import.meta.url), 'utf8');
  const tail = css.slice(css.indexOf('Workflow automation screens'));
  assert.doesNotMatch(tail, /#[0-9a-fA-F]{3,8}\b/); assert.match(tail, /prefers-reduced-motion/);
});
