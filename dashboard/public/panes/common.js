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

/** Empty state: what to do next. Admins get a link to Connections. */
export function needsSetup(ctx, d, title) {
  const { h } = ctx;
  return h('section', { class: 'cg-card cg-empty' },
    h('h3', { text: title }),
    h('p', { text: (d.needs || 'Nothing is connected yet') + '. Until then this screen has nothing real to show.' }),
    ctx.me.role === 'admin' ? h('a', { class: 'btn primary', href: '#/admin/connections', text: 'Open Connections' }) : h('p', { class: 'cg-note', text: 'Ask your administrator to connect it.' }));
}

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
