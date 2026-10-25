// Site map: the whole agent's health at one glance. The live site-plan visual (the same centrepiece as Overview,
// fed by this tab's data so it shows only your tabs), Success rate and Last run beneath it, the runs of the last
// 24 hours, and the outcome status table. The visual is mounted once and updated in place, so it keeps animating.
import * as hero from '../hero.js';
import { chip, records, line, bigNumber } from './common.js';

const live = new WeakMap();
const TONE = { Live: 'ok', 'Needs a look': 'warn', Failing: 'bad', Waiting: '', 'Demo data': 'demo' };

function heroCtx(ctx, d) {
  return {
    ...ctx, status: d.status || {}, demo: !!d.demo, panes: d.panes || [],
    metrics: [{ key: 'success', label: 'Success rate', value: d.success == null ? '–' : d.success, unit: d.success == null ? '' : '%' }],
    go: (r) => { location.hash = '#/' + r; }
  };
}

function lower(root, ctx, d) {
  const { h } = ctx;
  const st = live.get(root);
  const lastMin = d.lastRunAt ? ctx.ago(d.lastRunAt) : 'never';
  const msg = st.msg ? h('p', { class: 'cg-msg ' + (st.msg.ok ? 'ok' : 'bad'), role: 'status' }, (st.msg.ok ? '✓ ' : '✕ ') + st.msg.text + ' ', st.msg.ok ? h('a', { href: '#/reports', text: 'Open Reports' }) : null) : null;
  return [
    h('section', { class: 'cg-card cg-top' },
      h('div', { class: 'cg-top-main' }, bigNumber(h, d.success == null ? '–' : d.success + '%', 'success rate', 'Last run ' + lastMin)),
      h('div', { class: 'cg-top-side' },
        h('div', { class: 'cg-top-chips' }, d.demo ? chip(h, 'Demo data', 'demo') : null, chip(h, (d.status && d.status.headline) || 'Ready', d.status && d.status.mood === 'bad' ? 'bad' : d.status && d.status.mood === 'wait' ? 'warn' : 'ok')),
        h('p', { class: 'cg-note', text: (d.status && d.status.detail) || '' }),
        h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'button', disabled: st.busy || !ctx.me.canRun, text: st.busy ? 'Saving…' : 'Save a site map snapshot', onclick: () => snapshot(root, ctx) })),
        msg)),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Runs, last 24 hours' }), line(ctx, 'Runs, last 24 hours', 'Runs', d.hours || { labels: [], values: [] })),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Outcome status' }),
      records(h, d.columns, d.rows, { empty: 'None of the outcome tabs are part of your access.', cell: (v, j) => (j === 1 ? chip(h, v, TONE[v] || '') : String(v)) }))
  ];
}

async function snapshot(root, ctx) {
  const st = live.get(root);
  st.busy = true; paint(root, ctx, st.d);
  let r; try { r = await ctx.act('snapshot'); } catch (e) { r = { ok: false, message: String((e && e.message) || e) }; }
  st.busy = false; st.msg = { ok: r.ok !== false, text: r.message || '' };
  if (r.data) st.d = r.data;
  paint(root, ctx, st.d);
  if (ctx.refresh) ctx.refresh();
}

function paint(root, ctx, d) {
  const st = live.get(root);
  st.rest.replaceChildren(...lower(root, ctx, d));
  hero.update(st.stage, heroCtx(ctx, d));
}

export async function render(root, ctx) {
  const d = (await ctx.load()) || {};
  const stage = ctx.h('div', { class: 'cg-mapstage' });
  const rest = ctx.h('div', { class: 'cg-pane cg-focus' });
  root.replaceChildren(ctx.h('div', { class: 'cg-pane' }, stage, rest));
  live.set(root, { stage, rest, d, sig: JSON.stringify(d), busy: false, msg: null });
  hero.render(stage, heroCtx(ctx, d));
  rest.replaceChildren(...lower(root, ctx, d));
}

export async function update(root, ctx) {
  const st = live.get(root);
  if (!st) return;
  try {
    const d = await ctx.load();
    const sig = JSON.stringify(d);
    if (d && sig !== st.sig) { st.d = d; st.sig = sig; paint(root, ctx, d); }
  } catch { /* keep what is on screen */ }
}
