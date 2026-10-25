// Shared building blocks for the pane screens: a small state/repaint loop and a few UI pieces.
// Each pane module calls screen(build) and exports render/update from it.

export function bytes(n) {
  if (n == null || n === '') return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0; let v = Number(n);
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i ? v.toFixed(1) : String(Math.round(v))) + ' ' + u[i];
}
export const ext = (name) => (String(name).match(/\.([A-Za-z0-9]{1,4})$/) || [0, '•'])[1].toUpperCase();
export const TONE = { ok: 'ok', Filed: 'ok', Matched: 'ok', OK: 'ok', Updated: 'ok', failed: 'bad', Failed: 'bad', error: 'bad', skipped: 'warn', Skipped: 'warn', warn: 'warn', ignored: 'warn', malformed: 'warn', 'No rule matched': 'warn', Unreadable: 'warn' };

export function chip(h, text, tone = '') { return h('span', { class: 'cg-chip ' + (tone || ''), text }); }
export const demoChip = (h, d) => (d && d.source === 'demo' ? chip(h, 'Demo data', 'demo') : null);

/**
 * A screen showing demo records says so, and what makes it live. While its own service is not set up an outcome
 * tab shows demo records (d.configured false); the admin gets a link to Settings.
 */
export function demoBanner(ctx, d) {
  const { h } = ctx;
  if (!d || d.source !== 'demo') return null;
  const own = d.configured === false;
  return h('section', { class: 'cg-banner', role: 'note' },
    chip(h, 'Demo data', 'demo'),
    h('div', { class: 'cg-banner-text' },
      h('b', { text: own ? 'Showing demo records' : 'Sample numbers' }),
      h('span', { text: own ? (d.needs || 'Enter the keys for this service') + ' to see your own records here. Buttons work on the demo records until then.' : 'Every number on this screen is a demo sample until the keys are saved.' }),
      own && d.missing && d.missing.length ? h('small', { text: 'Still missing: ' + d.missing.join(', ') }) : null),
    ctx.me.role === 'admin' ? h('a', { class: 'btn', href: '#/admin/settings', text: 'Open Settings' }) : null);
}

/** A small wireframe of a screen's layout: split (main + rail), focus (stacked bands) or grid (tiles). */
export function wireframe(h, layout) {
  const blocks = layout === 'split' ? ['main', 'rail', 'main', 'rail'] : layout === 'focus' ? ['band', 'band', 'band'] : ['tile', 'tile', 'tile', 'tile'];
  return h('span', { class: 'cg-wire cg-wire-' + layout, 'aria-hidden': 'true' }, blocks.map((b) => h('i', { class: 'cg-wire-' + b })));
}

/** A state dot with its word, so colour is never alone. */
export const GLYPH = { ok: '✓', warn: '!', bad: '✕', idle: '–', demo: 'D' };
export function stateWord(h, tone, text) { return h('span', { class: 'cg-state ' + (tone || 'idle') }, h('i', { 'aria-hidden': 'true', text: GLYPH[tone] || '–' }), h('span', { text })); }

export function bigNumber(h, value, label, note) {
  return h('div', { class: 'cg-big' }, h('b', { text: String(value) }), h('span', { text: label }), note ? h('small', { text: note }) : null);
}

/**
 * screen(build, { loader }) -> { render, update }.
 * build({ ctx, d, ui, h, act, repaint }) returns the DOM for the pane. `ui` survives repaints (filters, messages).
 * act(action, input, { quiet }) calls the pane's paneAction, shows its message and takes the fresh data it returns.
 */
const sigOf = (d, ctx) => JSON.stringify([d, (ctx.metrics || []).map((m) => m.value)]);

export function screen(build, { loader } = {}) {
  const S = new WeakMap();
  const paint = (root) => {
    const s = S.get(root);
    const api = {
      ctx: s.ctx, d: s.d, ui: s.ui, h: s.ctx.h,
      repaint: () => paint(root),
      act: async (action, input, opts = {}) => {
        if (!opts.quiet) { s.ui.busy = action; paint(root); }
        let r;
        try { r = await s.ctx.act(action, input); } catch (e) { r = { ok: false, message: String((e && e.message) || e) }; }
        s.ui.busy = null;
        if (!opts.quiet) s.ui.msg = { ok: r.ok !== false, text: r.message || '' };
        if (r.data) { s.d = r.data; s.sig = sigOf(r.data, s.ctx); }
        paint(root);
        if (!opts.quiet && s.ctx.refresh) s.ctx.refresh();
        return r;
      }
    };
    root.replaceChildren(build(api));
  };
  return {
    async render(root, ctx) {
      const d = (await ctx.load()) || { configured: false, needs: 'No data yet' };
      S.set(root, { ctx, d, ui: {}, sig: sigOf(d, ctx) });
      paint(root);
    },
    async update(root, ctx) {
      const s = S.get(root);
      if (!s) return;
      s.ctx = ctx;
      const a = document.activeElement;
      if (root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;   // never repaint under someone typing
      try {
        const d = loader ? await loader(ctx, s.ui) : await ctx.load();
        const sig = sigOf(d, ctx);
        if (d && sig !== s.sig) { s.d = d; s.sig = sig; paint(root); }
      } catch { /* keep what is on screen */ }
    }
  };
}

/** A message line from the last action. */
export function message(h, ui) { return ui.msg ? h('p', { class: 'cg-msg ' + (ui.msg.ok ? 'ok' : 'bad'), role: 'status', text: (ui.msg.ok ? '✓ ' : '✕ ') + ui.msg.text }) : null; }

/** A button that runs a pane action; shows a busy label while it works. */
export function actionButton(api, label, action, input, { primary = false, busy = 'Working…' } = {}) {
  const { h, ui, ctx } = api;
  return h('button', { class: 'btn' + (primary ? ' primary' : ''), type: 'button', disabled: !!ui.busy || !ctx.me.canRun, text: ui.busy === action ? busy : label, onclick: () => api.act(action, input) });
}

/** Filter chips: options [{ key, label, n }], current key, onPick(key). */
export function chips(h, options, current, onPick, label) {
  return h('div', { class: 'cg-chips', role: 'group', 'aria-label': label }, options.map((o) =>
    h('button', { class: 'cg-pill', type: 'button', 'aria-pressed': o.key === current ? 'true' : 'false', onclick: () => onPick(o.key) }, o.label, o.n != null ? h('small', { text: String(o.n) }) : null)));
}

export const line = (ctx, title, name, hours) => ctx.chart({ title, kind: 'line', labels: hours.labels, series: [{ name, values: hours.values }] });

/**
 * A 24-hour trend that fills its card at any width: the area and line stretch (strokes stay 2px), while the
 * axis words are HTML on the type scale, so they never shrink in a narrow rail. Falls back to the kit chart.
 */
export function trend(ctx, title, unit, hours) {
  const { h, s } = ctx;
  const values = ((hours && hours.values) || []).map((v) => Number(v) || 0);
  if (!s || values.length < 2) return line(ctx, title, unit, hours || { labels: [], values: [] });
  const total = values.reduce((a, v) => a + v, 0);
  const hi = Math.max(...values, 1);
  const peak = values.indexOf(Math.max(...values));
  const W = 100, H = 40, x = (i) => (W * i) / (values.length - 1), y = (v) => H - 2 - ((H - 4) * v) / hi;
  const pts = values.map((v, i) => x(i).toFixed(2) + ' ' + y(v).toFixed(2));
  const svg = s('svg', { class: 'cg-trend-svg', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  for (const g of [0.5, 1]) svg.append(s('line', { class: 'cg-trend-grid', x1: 0, x2: W, y1: y(hi * g), y2: y(hi * g), 'vector-effect': 'non-scaling-stroke' }));
  svg.append(s('path', { class: 'cg-trend-area', d: 'M0 ' + H + ' L' + pts.join(' L') + ' L' + W + ' ' + H + ' Z' }));
  svg.append(s('path', { class: 'cg-trend-line', d: 'M' + pts.join(' L'), 'vector-effect': 'non-scaling-stroke' }));
  const label = (hours.labels || [])[peak];
  return h('figure', { class: 'cg-trend', role: 'img', 'aria-label': title + ': ' + total + ' ' + unit + ', peak ' + values[peak] + (label ? ' at ' + label : '') },
    h('div', { class: 'cg-trend-head' }, h('b', { text: String(total) }), h('span', { text: unit + ' in 24 hours' }), h('small', { text: 'peak ' + values[peak] + ' an hour' })),
    h('div', { class: 'cg-trend-plot' }, svg, h('small', { class: 'cg-trend-max', text: String(hi) })),
    h('div', { class: 'cg-trend-axis', 'aria-hidden': 'true' }, h('small', { text: '24 h ago' }), h('small', { text: '12 h' }), h('small', { text: 'now' })));
}

/** A records table that becomes stacked label/value cards under 640px (data-label on each cell). */
export function records(h, columns, rows, { empty = 'Nothing yet.', cell } = {}) {
  if (!rows.length) return h('p', { class: 'cg-note', text: empty });
  const td = (v, j, i) => h('td', { 'data-label': columns[j] }, cell ? cell(v, j, i) : String(v ?? ''));
  const head = h('thead', {}, h('tr', {}, columns.map((c) => h('th', { scope: 'col', text: c }))));
  const body = h('tbody', {}, rows.map((r, i) => h('tr', {}, r.map((v, j) => td(v, j, i)))));
  return h('div', { class: 'cg-records' }, h('table', {}, head, body));
}

/** "Updated just now" next to the numbers on a screen. */
export const updated = (h) => h('small', { class: 'cg-updated', text: 'Updated ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) });
