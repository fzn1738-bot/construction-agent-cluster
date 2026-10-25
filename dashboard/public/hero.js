// Overview centrepiece: a blueprint site plan with a glowing state orb and one live node per client outcome.
// Each node has an accessible text button; motion stops for prefers-reduced-motion.

const GLYPH = { ok: '✓', warn: '!', bad: '✕', idle: '–' };
const STATE_WORD = { ok: 'Healthy', warn: 'Needs a look', bad: 'Failing', idle: 'Waiting for setup' };
const SHORT = { documents: 'Documents', transfers: 'Transfers', inbox: 'Inbox', 'activity-log': 'Record' };
export const OUTCOME_IDS = Object.keys(SHORT);
const isOutcome = (p) => OUTCOME_IDS.includes(p.id);
const isDemo = (ctx, p) => !!(ctx.demo || (p.state && p.state.demo));

const live = new WeakMap();
const reduce = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const triple = (n, fb) => { const m = css(n).match(/^(\d+)[\s,]+(\d+)[\s,]+(\d+)$/); return m ? m.slice(1).join(' ') : fb; };

function palette() {
  return {
    ok: css('--ok') || '#12703d', warn: css('--warn') || '#8a5200', bad: css('--bad') || '#b32a2a', idle: css('--ink-3') || '#566879',
    accent: css('--accent') || '#1b5fc1', soft: css('--accent-soft') || '#dbe8f8', surface: css('--surface') || '#fff', ink: css('--ink') || '#14212e', ink2: css('--ink-2') || '#44566a', rule: css('--rule') || '#cfdce7', strong: css('--strong') || '#0b1620',
    ring: [css('--ring-1') || '#12703d', css('--ring-2') || '#1b5fc1', css('--ring-3') || '#7b4fa8'],
    mood: { ok: triple('--orb-ok', '27 95 193'), run: triple('--orb-run', '0 130 170'), wait: triple('--orb-wait', '214 140 10'), bad: triple('--orb-bad', '200 55 50') },
    dark: document.documentElement.dataset.theme === 'dark'
  };
}

const stateOf = (p) => (p.state && p.state.state) || 'idle';
const fmtVal = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1000 ? Math.round(v / 100) / 10 + 'k' : String(Math.round(v * 10) / 10)) : String(v ?? '–'));

/** The one-line text equivalent of everything the canvas shows. */
const rateOf = (ctx) => (ctx.metrics || []).find((m) => m.key === 'success') || (ctx.metrics || []).find((m) => m.key === 'syncRate');
export function describe(ctx) {
  const st = ctx.status || {};
  const rate = rateOf(ctx);
  const parts = [(st.headline || 'Ready') + (ctx.demo ? ' (demo data)' : '') + '.', rate && rate.value !== '–' ? 'Success rate ' + rate.value + '%.' : ''];
  const ring = (st.ring || []).map((r) => r.label + ' ' + r.value).join(', ');
  if (ring) parts.push(ring + '.');
  const panes = [...(ctx.panes || []).filter(isOutcome), ...(ctx.panes || []).filter((p) => !isOutcome(p))];
  for (const p of panes) parts.push(p.title + ': ' + (STATE_WORD[stateOf(p)] || 'Waiting') + (isDemo(ctx, p) && !ctx.demo ? ' (demo data)' : '') + (p.state && p.state.text ? ', ' + p.state.text : '') + '.');
  return parts.filter(Boolean).join(' ');
}

function layout(w, h, n, m) {
  const small = w < 560;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * (small ? 0.19 : 0.2);
  const ringR = small ? Math.min(w * 0.4, h * 0.38) : Math.min(h * 0.42, w * 0.34);
  const nodes = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1) + Math.PI / Math.max(n, 1); return { x: cx + Math.cos(a) * ringR, y: cy + Math.sin(a) * ringR, a }; });
  // beads for the cross-outcome tabs on the inner survey ring, nudged off the outcome links
  const beadR = Math.min(R * 1.45, ringR * 0.72);
  const near = (a) => nodes.some((nd) => Math.abs(Math.atan2(Math.sin(a - nd.a), Math.cos(a - nd.a))) < 0.21);
  const beads = Array.from({ length: m }, (_, i) => { let a = -Math.PI / 2 + ((i + 0.5) * 2 * Math.PI) / Math.max(m, 1); if (near(a)) a += 0.26; return { x: cx + Math.cos(a) * beadR, y: cy + Math.sin(a) * beadR, a }; });
  return { cx, cy, R, ringR, nodes, beads, beadR, node: small ? 20 : 24, bead: small ? 9 : 10, small };
}
function roundSquare(c, half, r) { c.beginPath(); c.moveTo(-half + r, -half); c.arcTo(half, -half, half, half, r); c.arcTo(half, half, -half, half, r); c.arcTo(-half, half, -half, -half, r); c.arcTo(-half, -half, half, -half, r); c.closePath(); }

function draw(g, state, t) {
  const { ctx: c, w, h, ctxData: d, pal } = state;
  const panes = (d.panes || []).filter(isOutcome);
  const tools = (d.panes || []).filter((p) => !isOutcome(p));
  const L = layout(w, h, panes.length, tools.length);
  state.L = L;
  c.clearRect(0, 0, w, h);
  const moving = !state.still;
  const grid = 24;
  const drift = moving ? (t / 1000) * 1.5 : 0;
  // blueprint grid
  c.save(); c.globalAlpha = pal.dark ? 0.4 : 0.55; c.strokeStyle = pal.rule; c.lineWidth = 1; c.beginPath();
  for (let x = -((drift) % grid); x < w; x += grid) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h); }
  for (let y = -((drift * 0.6) % grid); y < h; y += grid) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
  c.stroke(); c.restore();
  // survey rings
  const mood = (d.status && d.status.mood) || 'ok';
  const rgb = pal.mood[mood] || pal.mood.ok;
  [[1.4, 120, 1], [1.9, 180, -1]].forEach(([k, secs, dir]) => {
    const rr = Math.min(L.R * k, L.ringR * (k === 1.9 ? 1.02 : 0.74));
    c.save(); c.translate(L.cx, L.cy); c.rotate(moving ? dir * ((t / 1000) / secs) * Math.PI * 2 : 0);
    c.setLineDash([2, 7]); c.strokeStyle = pal.rule; c.globalAlpha = 0.9; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.stroke(); c.restore();
  });
  // links with flowing dots
  panes.forEach((p, i) => {
    const n = L.nodes[i]; const s = stateOf(p);
    const col = s === 'idle' ? pal.idle : pal[s];
    c.save(); c.strokeStyle = col; c.globalAlpha = s === 'idle' ? 0.5 : 0.7; c.lineWidth = 1.5;
    if (s === 'idle') c.setLineDash([4, 5]);
    c.beginPath(); c.moveTo(L.cx + Math.cos(n.a) * L.R, L.cy + Math.sin(n.a) * L.R); c.lineTo(n.x - Math.cos(n.a) * L.node, n.y - Math.sin(n.a) * L.node); c.stroke(); c.restore();
    const speed = s === 'ok' ? 0.22 : s === 'warn' ? 0.1 : 0;   // a stalled link stays still, so freezing reads as trouble
    const dots = s === 'ok' ? 3 : s === 'warn' ? 2 : 0;
    for (let k = 0; k < dots; k++) {
      const u = moving ? (((t / 1000) * speed + k / dots + i * 0.17) % 1) : (k + 0.5) / dots;
      const x0 = L.cx + Math.cos(n.a) * L.R, y0 = L.cy + Math.sin(n.a) * L.R, x1 = n.x - Math.cos(n.a) * L.node, y1 = n.y - Math.sin(n.a) * L.node;
      c.fillStyle = col; c.beginPath(); c.arc(x0 + (x1 - x0) * (1 - u), y0 + (y1 - y0) * (1 - u), 3, 0, Math.PI * 2); c.fill();
    }
  });
  // core orb
  const breathe = moving ? 1 + 0.02 * Math.sin((t / 1000 / 7) * Math.PI * 2) : 1;
  const R = L.R * breathe;
  const glow = c.createRadialGradient(L.cx, L.cy, R * 0.2, L.cx, L.cy, R * 1.9);
  glow.addColorStop(0, 'rgb(' + rgb + ' / ' + (pal.dark ? 0.5 : 0.3) + ')'); glow.addColorStop(1, 'rgb(' + rgb + ' / 0)');
  c.fillStyle = glow; c.beginPath(); c.arc(L.cx, L.cy, R * 1.9, 0, Math.PI * 2); c.fill();
  const body = c.createRadialGradient(L.cx - R * 0.3, L.cy - R * 0.4, R * 0.1, L.cx, L.cy, R);
  body.addColorStop(0, pal.dark ? 'rgb(' + rgb + ' / 0.35)' : '#ffffff'); body.addColorStop(1, 'rgb(' + rgb + ' / ' + (pal.dark ? 0.12 : 0.22) + ')');
  c.fillStyle = body; c.beginPath(); c.arc(L.cx, L.cy, R, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgb(' + rgb + ' / 0.7)'; c.lineWidth = 2; c.stroke();
  const rate = rateOf(d);
  const big = rate ? fmtVal(rate.value) + (rate.value === '–' ? '' : rate.unit || '') : d.status && d.status.primary ? fmtVal(d.status.primary.value) : '–';
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = pal.strong;
  c.font = '700 ' + Math.round(Math.min(44, R * 0.56)) + 'px ui-sans-serif, -apple-system, "Segoe UI", sans-serif'; c.fillText(big, L.cx, L.cy - R * 0.1);
  c.fillStyle = 'rgb(' + rgb + ')'; c.font = '650 ' + Math.round(Math.max(13, R * 0.2)) + 'px ui-sans-serif, -apple-system, "Segoe UI", sans-serif';
  c.fillText((d.status && d.status.headline) || 'Ready', L.cx, L.cy + R * 0.34);
  c.fillStyle = pal.ink2; c.font = '12px ui-sans-serif, -apple-system, "Segoe UI", sans-serif'; c.fillText(rate ? rate.label : d.status && d.status.primary ? d.status.primary.label : '', L.cx, L.cy + R * 0.6);
  // nodes
  panes.forEach((p, i) => {
    const n = L.nodes[i]; const s = stateOf(p); const half = L.node;
    const col = s === 'idle' ? pal.idle : pal[s];
    c.save(); c.translate(n.x, n.y);
    roundSquare(c, half, 10);
    const dm = isDemo(d, p);
    if (dm) { c.fillStyle = pal.soft; c.fill(); c.setLineDash([4, 3]); c.strokeStyle = pal.accent; c.lineWidth = 2; c.stroke(); }
    else { c.fillStyle = s === 'idle' ? pal.surface : col; c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); }
    c.setLineDash([]); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = dm ? pal.accent : s === 'idle' ? col : pal.surface; c.font = '700 ' + (L.small ? 16 : 20) + 'px ui-sans-serif, sans-serif';
    c.fillText(dm ? 'D' : GLYPH[s], 0, 1);
    c.restore();
    c.fillStyle = pal.ink2; c.font = '12px ui-sans-serif, -apple-system, "Segoe UI", sans-serif'; c.textAlign = 'center';
    const below = n.y > L.cy ? 1 : -1;
    c.fillText(L.small ? (SHORT[p.id] || p.title).slice(0, 10) : p.title.length > 22 ? (SHORT[p.id] || p.title) : p.title, Math.max(44, Math.min(w - 44, n.x)), n.y + below * (half + 14));
  });
  // beads: one per cross-outcome tab, state colour plus glyph (D for demo data)
  tools.forEach((p, i) => {
    const b = L.beads[i]; const s = stateOf(p); const col = s === 'idle' ? pal.idle : pal[s]; const dm = isDemo(d, p);
    c.save(); c.translate(b.x, b.y); roundSquare(c, L.bead, 5);
    if (dm) { c.fillStyle = pal.soft; c.fill(); c.setLineDash([3, 2]); c.strokeStyle = pal.accent; }
    else { c.fillStyle = s === 'idle' ? pal.surface : col; c.fill(); c.strokeStyle = col; }
    c.lineWidth = 1.5; c.stroke(); c.setLineDash([]);
    c.fillStyle = dm ? pal.accent : s === 'idle' ? col : pal.surface; c.font = '700 12px ui-sans-serif, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(dm ? 'D' : GLYPH[s], 0, 1); c.restore();
  });
  // ring captions at 10, 2 and 6 o'clock
  const ring = ((d.status && d.status.ring) || []).slice(0, 3);
  const spots = L.small ? [[0.2, 0.08], [0.8, 0.08], [0.5, 0.95]] : [[0.1, 0.14], [0.9, 0.14], [0.5, 0.95]];
  ring.forEach((r, i) => {
    const [fx, fy] = spots[i];
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = pal.ring[i]; c.font = '700 20px ui-monospace, "SF Mono", Menlo, monospace';
    c.fillText(fmtVal(r.value), w * fx, h * fy);
    c.fillStyle = pal.ink2; c.font = '12px ui-sans-serif, -apple-system, "Segoe UI", sans-serif'; c.fillText(r.label, w * fx, h * fy + 16);
  });
}

function fit(state, canvas, box) {
  const w = Math.max(280, Math.round(box.clientWidth || 320));
  const h = w < 560 ? Math.round(w * 1.05) : Math.min(480, Math.round(w * 0.5));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.setAttribute('width', String(canvas.width)); canvas.setAttribute('height', String(canvas.height));
  canvas.classList.add('cg-hero-canvas');
  canvas.dataset.h = String(h);
  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.w = w; state.h = h;
}

function legend(ctx) {
  const { h } = ctx;
  const item = (p) => {
    const s = stateOf(p); const dm = isDemo(ctx, p);
    return h('li', {}, h('button', { type: 'button', class: 'cg-node ' + (dm ? 'demo' : s) + (isOutcome(p) ? '' : ' is-tool'), onclick: () => ctx.go('pane/' + p.id) },
      h('i', { 'aria-hidden': 'true', text: dm ? 'D' : GLYPH[s] }),
      h('span', {}, h('b', { text: p.title }), h('small', { text: (dm ? 'Demo data' : STATE_WORD[s] || '') + (p.state && p.state.text ? ' · ' + p.state.text.replace(/^Demo data · /, '') : '') }))));
  };
  const outs = (ctx.panes || []).filter(isOutcome), tools = (ctx.panes || []).filter((p) => !isOutcome(p));
  return h('div', { class: 'cg-hero-keys' },
    outs.length ? h('ul', { class: 'cg-hero-legend', 'aria-label': 'Client outcomes' }, outs.map(item)) : null,
    tools.length ? h('ul', { class: 'cg-hero-legend is-tools', 'aria-label': 'Across the outcomes' }, tools.map(item)) : null);
}

export function render(root, ctx) {
  const { h } = ctx;
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const box = h('div', { class: 'cg-hero-stage' }, canvas);
  const summary = h('p', { class: 'sr', role: 'status' });
  const legendBox = h('div', {});
  const wrap = h('section', { class: 'cg-hero', role: 'group', 'aria-label': 'Whole solution state' }, summary, box, legendBox);
  root.replaceChildren(wrap);
  const state = { ctx: canvas.getContext('2d'), ctxData: ctx, pal: palette(), still: reduce(), w: 0, h: 0, raf: 0, visible: true };
  live.set(root, { state, canvas, box, summary, legendBox });
  const redraw = (t = 0) => draw(canvas, state, t);
  const loop = (t) => { state.raf = 0; if (state.still || !state.visible || document.hidden) return; redraw(t); state.raf = requestAnimationFrame(loop); };
  const kick = () => { if (!state.raf && !state.still) state.raf = requestAnimationFrame(loop); };
  state.redraw = () => { fit(state, canvas, box); redraw(performance.now()); };
  state.kick = kick;
  summary.textContent = describe(ctx); legendBox.replaceChildren(legend(ctx));
  state.redraw(); kick();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (root.isConnected) state.redraw(); }).observe(box);
  if (typeof IntersectionObserver !== 'undefined') new IntersectionObserver((e) => { state.visible = e[0].isIntersecting; if (state.visible) kick(); }).observe(box);
  document.addEventListener('visibilitychange', kick);
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    const L = state.L; if (!L) return;
    const outs = (state.ctxData.panes || []).filter(isOutcome), tools = (state.ctxData.panes || []).filter((p) => !isOutcome(p));
    const i = L.nodes.findIndex((n) => Math.abs(n.x - x) < L.node + 6 && Math.abs(n.y - y) < L.node + 6);
    if (i >= 0 && outs[i]) return state.ctxData.go('pane/' + outs[i].id);
    const j = L.beads.findIndex((n) => Math.abs(n.x - x) < L.bead + 6 && Math.abs(n.y - y) < L.bead + 6);
    if (j >= 0 && tools[j]) state.ctxData.go('pane/' + tools[j].id);
  });
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => { state.still = e.matches; if (state.still) state.redraw(); else kick(); });
}

export function update(root, ctx) {
  const m = live.get(root);
  if (!m) return;
  m.state.ctxData = ctx; m.state.pal = palette();
  m.summary.textContent = describe(ctx);
  m.legendBox.replaceChildren(legend(ctx));
  if (m.state.still) m.state.redraw(); else m.state.kick();
}
