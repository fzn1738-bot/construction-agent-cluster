// Overview centrepiece, "Site plan orb": a blueprint site plan with a glowing state orb wrapped in a success gauge,
// a slow radar sweep, and one live node per client outcome joined to the core by links whose moving dots show
// activity (a stalled link stands still). Below the stage, one keyboard button per tab with its state and number.
// Motion stops for prefers-reduced-motion; the whole picture has a text equivalent (describe()).

const GLYPH = { ok: '✓', warn: '!', bad: '✕', idle: '–' };
const STATE_WORD = { ok: 'Healthy', warn: 'Needs a look', bad: 'Failing', idle: 'Waiting for setup' };
const SHORT = { documents: 'Documents', transfers: 'Transfers', inbox: 'Inbox', 'activity-log': 'Activity' };
export const OUTCOME_IDS = Object.keys(SHORT);
const isOutcome = (p) => OUTCOME_IDS.includes(p.id);
// Workflow automation as one pipeline round the core: Record (9 o'clock) → Build (12) → Run (3), read clockwise.
// Angles grow clockwise on the canvas, so the pipeline runs from π to 2π. Any other cross-outcome tab sits at
// 6 o'clock under "More".
const PHASES = [
  { key: 'record', label: 'Record', a: Math.PI, ids: ['rpa-record', 'rpa-typing', 'rpa-pages', 'rpa-screens'] },
  { key: 'build', label: 'Build', a: Math.PI * 1.5, ids: ['rpa-workflows', 'rpa-steps', 'rpa-order', 'rpa-variables'] },
  { key: 'run', label: 'Run', a: Math.PI * 2, ids: ['rpa-run', 'rpa-history'] }
];
const PHASE_HINT = { record: 'Watch a task once', build: 'Edit, order, add variables', run: 'Replay, approve, review', more: 'Across the outcomes' };
const RANK = { bad: 3, warn: 2, idle: 1, ok: 0 };
const worst = (list) => list.reduce((w, p) => (RANK[stateOf(p)] > RANK[w] ? stateOf(p) : w), 'ok');
/** The non-outcome tabs grouped into pipeline phases, in pipeline order; leftovers go to "More". */
function phasesOf(tools) {
  const out = PHASES.map((ph) => ({ ...ph, panes: ph.ids.map((id) => tools.find((p) => p.id === id)).filter(Boolean) }));
  const rest = tools.filter((p) => !PHASES.some((ph) => ph.ids.includes(p.id)));
  if (rest.length) out.push({ key: 'more', label: 'More', a: Math.PI / 2, panes: rest });
  return out.filter((ph) => ph.panes.length);
}
const isDemo = (ctx, p) => !!(ctx.demo || (p.state && p.state.demo));
const SANS = 'ui-sans-serif, -apple-system, "SF Pro Text", "Segoe UI", sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

const live = new WeakMap();
const reduce = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const triple = (n, fb) => { const m = css(n).match(/^(\d+)[\s,]+(\d+)[\s,]+(\d+)$/); return m ? m.slice(1).join(' ') : fb; };

function palette() {
  return {
    ok: css('--ok') || '#12703d', warn: css('--warn') || '#8a5200', bad: css('--bad') || '#b32a2a', idle: css('--ink-3') || '#566879',
    accent: css('--accent') || '#1b5fc1', soft: css('--accent-soft') || '#dbe8f8', surface: css('--surface') || '#ffffff', ink: css('--ink') || '#14212e', ink2: css('--ink-2') || '#44566a', rule: css('--rule') || '#cfdce7', strong: css('--strong') || '#0b1620',
    ring: [css('--ring-1') || '#12703d', css('--ring-2') || '#1b5fc1', css('--ring-3') || '#7b4fa8'],
    mood: { ok: triple('--orb-ok', '27 95 193'), run: triple('--orb-run', '0 130 170'), wait: triple('--orb-wait', '214 140 10'), bad: triple('--orb-bad', '200 55 50') },
    dark: document.documentElement.dataset.theme === 'dark'
  };
}

const stateOf = (p) => (p.state && p.state.state) || 'idle';
const fmtVal = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1000 ? Math.round(v / 100) / 10 + 'k' : String(Math.round(v * 10) / 10)) : String(v ?? '–'));
const stateText = (p) => String((p.state && p.state.text) || STATE_WORD[stateOf(p)] || '').replace(/^Demo data · /, '');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** The one-line text equivalent of everything the canvas shows. */
const rateOf = (ctx) => (ctx.metrics || []).find((m) => m.key === (ctx.status && ctx.status.workflowAutomation ? 'wfSuccess' : 'success')) || (ctx.metrics || []).find((m) => m.key === 'syncRate');
const pctOf = (ctx) => { const r = rateOf(ctx); const v = r && r.value !== '–' ? r.value : ctx.status && ctx.status.primary && ctx.status.primary.value; const n = parseFloat(String(v ?? '')); return isNaN(n) ? null : n; };
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

/** Ring numbers for the captions, minus the success rate the orb already shows in its centre. */
const ringOf = (ctx) => { const r = rateOf(ctx); return ((ctx.status && ctx.status.ring) || []).filter((x) => !(r && /success/i.test(String(x.label)))).slice(0, 3); };

function layout(w, h, n, m) {
  const small = w < 560;
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) * (small ? 0.17 : 0.17);
  const ringR = small ? Math.min(w * 0.36, h * 0.36) : Math.min(h * 0.36, w * 0.3);
  // outcomes sit on the diagonals, clear of the captions at 9, 3 and 6 o'clock
  const nodes = Array.from({ length: n }, (_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1) + Math.PI / Math.max(n, 1); return { x: cx + Math.cos(a) * ringR, y: cy + Math.sin(a) * ringR, a }; }).map((nd) => ({ ...nd, x: cx + Math.cos(nd.a) * ringR * (small ? 1 : 1.6) }));
  // beads for the cross-outcome tabs on the inner survey ring, grouped by pipeline phase between the outcome links
  const beadR = Math.min(R * 1.6, ringR * 0.78);
  const beads = []; const arcs = [];
  // each phase spreads its beads only as far as the nearest outcome link allows (links run flatter on wide stages)
  const linkA = nodes.map((nd) => Math.atan2(nd.y - cy, nd.x - cx));
  const gap = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const bead = small ? 9 : 10, clear = (bead + 6) / beadR;
  for (const ph of m) {
    const k = ph.panes.length;
    const room = linkA.length ? Math.min(...linkA.map((la) => gap(ph.a, la))) - clear : Math.PI / 3;
    const step = Math.max((bead * 2 + 4) / beadR, Math.min(0.28, (2 * room) / (k + 0.1)));
    const first = ph.a - ((k - 1) / 2) * step;
    ph.panes.forEach((p, j) => { const a = first + j * step; beads.push({ x: cx + Math.cos(a) * beadR, y: cy + Math.sin(a) * beadR, a, p }); });
    arcs.push({ ph, a0: first - step * 0.55, a1: first + (k - 1) * step + step * 0.55 });
  }
  return { cx, cy, R, ringR, nodes, beads, arcs, beadR, node: small ? 18 : 22, bead, small };
}
function roundSquare(c, half, r) { c.beginPath(); c.moveTo(-half + r, -half); c.arcTo(half, -half, half, half, r); c.arcTo(half, half, -half, half, r); c.arcTo(-half, half, -half, -half, r); c.arcTo(-half, -half, half, -half, r); c.closePath(); }
// the point where a link from the core to a node starts and ends
const ends = (L, n) => { const dx = n.x - L.cx, dy = n.y - L.cy, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len; return [L.cx + ux * L.R * 1.32, L.cy + uy * L.R * 1.32, n.x - ux * (L.node + 4), n.y - uy * (L.node + 4)]; };

function draw(state, t) {
  const { ctx: c, w, h, ctxData: d, pal } = state;
  const panes = (d.panes || []).filter(isOutcome);
  const tools = (d.panes || []).filter((p) => !isOutcome(p));
  const L = layout(w, h, panes.length, phasesOf(tools));
  state.L = L;
  c.clearRect(0, 0, w, h);
  const moving = !state.still;
  const sec = t / 1000;
  const mood = (d.status && d.status.mood) || 'ok';
  const rgb = pal.mood[mood] || pal.mood.ok;

  // blueprint grid with a slow drift, a brighter major line every 4 cells
  const grid = 24, drift = moving ? sec * 1.5 : 0;
  c.save(); c.strokeStyle = pal.rule; c.lineWidth = 1;
  for (let pass = 0; pass < 2; pass++) {
    c.globalAlpha = pass ? (pal.dark ? 0.5 : 0.8) : (pal.dark ? 0.25 : 0.45); c.beginPath();
    for (let i = 0, x = -(drift % (grid * 4)); x < w; i++, x += grid) if ((i % 4 === 0) === !!pass) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h); }
    for (let i = 0, y = -((drift * 0.6) % (grid * 4)); y < h; i++, y += grid) if ((i % 4 === 0) === !!pass) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
    c.stroke();
  }
  c.restore();

  // survey rings, dashed, turning in opposite directions (120s and 180s)
  [[1.6, 120, 1], [2.3, 180, -1]].forEach(([k, secs, dir]) => {
    const rr = Math.min(L.R * k, L.ringR * (k > 2 ? 1.05 : 0.8));
    c.save(); c.translate(L.cx, L.cy); c.rotate(moving ? dir * (sec / secs) * Math.PI * 2 : 0);
    c.setLineDash([2, 7]); c.strokeStyle = pal.ink2; c.globalAlpha = 0.35; c.lineWidth = 1.2; c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.stroke(); c.restore();
  });

  // radar sweep: a soft wedge turning once a minute
  if (moving) {
    const sweepR = Math.max(L.ringR * 1.1, L.R * 2.6);
    c.save(); c.translate(L.cx, L.cy); c.rotate((sec / 60) * Math.PI * 2);
    const sw = c.createRadialGradient(0, 0, L.R, 0, 0, sweepR);
    sw.addColorStop(0, 'rgb(' + rgb + ' / ' + (pal.dark ? 0.2 : 0.12) + ')'); sw.addColorStop(1, 'rgb(' + rgb + ' / 0)');
    c.fillStyle = sw; c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, sweepR, -0.55, 0); c.closePath(); c.fill();
    c.restore();
  }

  // links with flowing dots: speed follows the state; failing or waiting links stand still
  panes.forEach((p, i) => {
    const n = L.nodes[i]; const s = stateOf(p);
    const col = s === 'idle' ? pal.idle : pal[s];
    const [x0, y0, x1, y1] = ends(L, n);
    c.save(); c.strokeStyle = col; c.globalAlpha = s === 'idle' ? 0.5 : 0.75; c.lineWidth = 1.5;
    if (s === 'idle' || isDemo(d, p)) c.setLineDash([4, 5]);
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.stroke(); c.restore();
    const speed = s === 'ok' ? 0.22 : s === 'warn' ? 0.1 : 0;
    const dots = s === 'ok' ? 3 : s === 'warn' ? 2 : 0;
    for (let k = 0; k < dots; k++) {
      const u = moving ? ((sec * speed + k / dots + i * 0.17) % 1) : (k + 0.5) / dots;
      c.fillStyle = col; c.beginPath(); c.arc(x1 + (x0 - x1) * u, y1 + (y0 - y1) * u, 3, 0, Math.PI * 2); c.fill();
    }
  });

  // core orb: glow, body, rim; breathing 1 → 1.04 over 7s
  const breathe = moving ? 1 + 0.02 + 0.02 * Math.sin((sec / 7) * Math.PI * 2) : 1;
  const R = L.R * breathe;
  const glow = c.createRadialGradient(L.cx, L.cy, R * 0.2, L.cx, L.cy, R * 2.1);
  glow.addColorStop(0, 'rgb(' + rgb + ' / ' + (pal.dark ? 0.5 : 0.3) + ')'); glow.addColorStop(1, 'rgb(' + rgb + ' / 0)');
  c.fillStyle = glow; c.beginPath(); c.arc(L.cx, L.cy, R * 2.1, 0, Math.PI * 2); c.fill();
  const body = c.createRadialGradient(L.cx - R * 0.3, L.cy - R * 0.4, R * 0.1, L.cx, L.cy, R);
  body.addColorStop(0, pal.dark ? 'rgb(' + rgb + ' / 0.35)' : pal.surface); body.addColorStop(1, 'rgb(' + rgb + ' / ' + (pal.dark ? 0.12 : 0.22) + ')');
  c.fillStyle = body; c.beginPath(); c.arc(L.cx, L.cy, R, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgb(' + rgb + ' / 0.7)'; c.lineWidth = 2; c.stroke();

  // success gauge round the orb, ticks every 10%
  const pct = pctOf(d);
  const gR = L.R * 1.17;
  c.save(); c.lineCap = 'round'; c.lineWidth = L.small ? 4 : 6;
  c.strokeStyle = pal.rule; c.beginPath(); c.arc(L.cx, L.cy, gR, 0, Math.PI * 2); c.stroke();
  if (pct != null) { c.strokeStyle = 'rgb(' + rgb + ')'; c.beginPath(); c.arc(L.cx, L.cy, gR, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(0, Math.min(100, pct))) / 100); c.stroke(); }
  c.lineCap = 'butt'; c.lineWidth = 1; c.strokeStyle = pal.ink2; c.globalAlpha = 0.6;
  for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + (k * Math.PI) / 5; c.beginPath(); c.moveTo(L.cx + Math.cos(a) * (gR + 7), L.cy + Math.sin(a) * (gR + 7)); c.lineTo(L.cx + Math.cos(a) * (gR + 11), L.cy + Math.sin(a) * (gR + 11)); c.stroke(); }
  c.restore();

  // the primary number and the headline word inside the core
  const rate = rateOf(d);
  const big = rate ? fmtVal(rate.value) + (rate.value === '–' ? '' : rate.unit || '') : d.status && d.status.primary ? fmtVal(d.status.primary.value) : '–';
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = pal.strong;
  c.font = '700 ' + Math.round(Math.min(44, R * 0.5)) + 'px ' + SANS; c.fillText(big, L.cx, L.cy - R * 0.12);
  c.fillStyle = pal.dark ? 'rgb(' + rgb + ')' : pal.ink; c.font = '650 ' + Math.round(Math.max(12, Math.min(16, R * 0.18))) + 'px ' + SANS;
  c.fillText((d.status && d.status.headline) || 'Ready', L.cx, L.cy + R * 0.3);
  // the label under the number stays inside the orb: drop leading words until it fits the chord at that height
  c.fillStyle = pal.ink2; c.font = '12px ' + SANS;
  let sub = String(rate ? rate.label : d.status && d.status.primary ? d.status.primary.label : '');
  const chord = 2 * Math.sqrt(1 - 0.56 * 0.56) * R - 8;
  while (c.measureText(sub).width > chord && sub.includes(' ')) { sub = sub.slice(sub.indexOf(' ') + 1); sub = sub[0].toUpperCase() + sub.slice(1); }
  c.fillText(sub, L.cx, L.cy + R * 0.56);

  // outcome nodes: state colour plus a glyph; demo nodes are outlined and dashed, with the same glyph
  panes.forEach((p, i) => {
    const n = L.nodes[i]; const s = stateOf(p); const half = L.node;
    const col = s === 'idle' ? pal.idle : pal[s];
    const dm = isDemo(d, p);
    c.save(); c.translate(n.x, n.y);
    if (s === 'bad' || s === 'warn') { c.fillStyle = col; c.globalAlpha = 0.14; roundSquare(c, half + 7, 14); c.fill(); c.globalAlpha = 1; }
    roundSquare(c, half, 10);
    if (dm) { c.fillStyle = pal.surface; c.fill(); c.setLineDash([4, 3]); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); }
    else { c.fillStyle = s === 'idle' ? pal.surface : col; c.fill(); c.strokeStyle = col; c.lineWidth = 2; c.stroke(); }
    c.setLineDash([]); c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = dm || s === 'idle' ? col : pal.surface; c.font = '700 ' + (L.small ? 16 : 20) + 'px ' + SANS;
    c.fillText(GLYPH[s], 0, 1);
    c.restore();
    // labels measured and kept inside the stage: name, then the state line on wide stages
    const below = n.y > L.cy ? 1 : -1;
    const name = L.small ? SHORT[p.id] || p.title : p.title;
    const sub = L.small ? '' : clip((dm && !d.demo ? 'Demo · ' : '') + stateText(p), 32);
    c.font = '650 ' + (L.small ? 12 : 14) + 'px ' + SANS; const w1 = c.measureText(name).width;
    c.font = '12px ' + SANS; const w2 = sub ? c.measureText(sub).width : 0;
    const tw = Math.max(w1, w2);
    const lx = Math.max(tw / 2 + 8, Math.min(w - tw / 2 - 8, n.x));
    const ly = below > 0 ? n.y + half + 16 : n.y - half - (sub ? 32 : 16);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillStyle = pal.strong; c.font = '650 ' + (L.small ? 12 : 14) + 'px ' + SANS; c.fillText(name, lx, ly);
    if (sub) { c.fillStyle = pal.ink2; c.font = '12px ' + SANS; c.fillText(sub, lx, ly + 16); }
  });

  // the automation pipeline: a faint guide from Record round to Run, a soft track under each phase, and a packet
  // that travels the pipeline (it stands still when the phase it is in is failing, and under reduced motion)
  if (L.arcs.length) {
    const pipe = L.arcs.filter((a) => a.ph.key !== 'more');
    if (pipe.length > 1) {
      const g0 = pipe[0].a0, end = pipe[pipe.length - 1].a1;
      c.save(); c.strokeStyle = pal.accent; c.globalAlpha = 0.35; c.lineWidth = 1; c.setLineDash([1, 5]);
      c.beginPath(); c.arc(L.cx, L.cy, L.beadR, g0, end); c.stroke(); c.restore();
      // arrowheads between phases, on the guide just before each next phase starts
      for (let i = 1; i < pipe.length; i++) {
        const a = pipe[i].a0 - 0.05; const x = L.cx + Math.cos(a) * L.beadR, y = L.cy + Math.sin(a) * L.beadR;
        c.save(); c.translate(x, y); c.rotate(a + Math.PI / 2); c.fillStyle = pal.accent; c.globalAlpha = 0.7;
        c.beginPath(); c.moveTo(4, 0); c.lineTo(-3, -4); c.lineTo(-3, 4); c.closePath(); c.fill(); c.restore();
      }
      const flowing = moving && worst(tools) !== 'bad';
      const u = flowing ? (sec / 9) % 1 : 0.5;
      const a = g0 + (end - g0) * u;
      c.save(); c.fillStyle = 'rgb(' + rgb + ')'; c.shadowColor = 'rgb(' + rgb + ' / 0.6)'; c.shadowBlur = 8;
      c.beginPath(); c.arc(L.cx + Math.cos(a) * L.beadR, L.cy + Math.sin(a) * L.beadR, 3.5, 0, Math.PI * 2); c.fill(); c.restore();
    }
    L.arcs.forEach(({ ph, a0, a1 }) => {
      const s = worst(ph.panes);
      c.save(); c.lineCap = 'round'; c.strokeStyle = s === 'bad' || s === 'warn' ? pal[s] : pal.soft; c.globalAlpha = s === 'bad' || s === 'warn' ? 0.18 : (pal.dark ? 0.35 : 0.9);
      c.lineWidth = L.bead * 2 + 8; c.beginPath(); c.arc(L.cx, L.cy, L.beadR, a0, a1); c.stroke(); c.restore();
      // phase label just outside its track, kept inside the stage
      // word then state glyph, e.g. "BUILD ✓"; anchored away from the core and clamped inside the stage
      const lr = L.beadR + L.bead + (L.small ? 10 : 14);
      const cosA = Math.cos(ph.a), sinA = Math.sin(ph.a);
      const word = ph.label.toUpperCase() + ' ';
      c.save(); c.font = '650 12px ' + SANS; c.textBaseline = 'middle'; c.textAlign = 'left';
      const ww = c.measureText(word).width, gw = c.measureText(GLYPH[s]).width, tw = ww + gw;
      const ax = L.cx + cosA * lr, ay = L.cy + sinA * lr + (Math.abs(sinA) > 0.5 ? sinA * 4 : 0);
      let x0 = cosA < -0.5 ? ax - tw : cosA > 0.5 ? ax : ax - tw / 2;
      x0 = Math.max(6, Math.min(w - tw - 6, x0));
      const y0 = Math.max(10, Math.min(h - 10, ay));
      c.fillStyle = pal.ink2; c.fillText(word, x0, y0);
      c.fillStyle = s === 'idle' ? pal.idle : pal[s]; c.fillText(GLYPH[s], x0 + ww, y0);
      c.restore();
    });
  }

  // beads: one per cross-outcome tab, state colour plus glyph (white with a dashed outline for demo data)
  L.beads.forEach((b) => {
    const p = b.p; const s = stateOf(p); const col = s === 'idle' ? pal.idle : pal[s]; const dm = isDemo(d, p);
    c.save(); c.translate(b.x, b.y); roundSquare(c, L.bead, 5);
    if (dm) { c.fillStyle = pal.surface; c.fill(); c.setLineDash([3, 2]); c.strokeStyle = col; }
    else { c.fillStyle = s === 'idle' ? pal.surface : col; c.fill(); c.strokeStyle = col; }
    c.lineWidth = 1.5; c.stroke(); c.setLineDash([]);
    c.fillStyle = dm || s === 'idle' ? col : pal.surface; c.font = '700 12px ' + SANS; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(GLYPH[s], 0, 1); c.restore();
  });

  // ring captions at 9, 3 and 6 o'clock on wide stages (phones get the readout under the stage)
  if (L.small) return;
  const ring = ringOf(d);
  const spots = [[w * 0.1, h * 0.5], [w * 0.9, h * 0.5], [L.cx, L.cy + L.R * 1.17 + 46]];
  ring.forEach((r, i) => {
    const [px, py] = spots[i];
    c.textAlign = 'center'; c.textBaseline = 'alphabetic'; c.fillStyle = pal.ring[i]; c.font = '700 28px ' + MONO;
    c.fillText(fmtVal(r.value), px, py);
    c.fillStyle = pal.ink2; c.font = '600 12px ' + SANS; c.fillText(String(r.label).toUpperCase(), px, py + 20);
  });
}

// The stage's size comes from CSS (aspect ratio and min/max height); the canvas sits absolutely inside it, so its
// pixel size never feeds back into the page's layout (no sideways overflow on phones).
function fit(state, canvas, box) {
  const w = Math.max(240, Math.round(box.clientWidth || 320));
  const h = Math.max(220, Math.round(box.clientHeight || (w < 560 ? w * 0.95 : Math.max(380, Math.min(460, w * 0.42)))));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
  canvas.setAttribute('width', String(canvas.width)); canvas.setAttribute('height', String(canvas.height));
  canvas.classList.add('cg-hero-canvas');
  canvas.dataset.h = String(h);
  state.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.w = w; state.h = h;
  if (state.readout) { if (w < 560) state.readout.removeAttribute('hidden'); else state.readout.setAttribute('hidden', ''); }
}

/** Ring numbers as text, shown under the stage on phones where the canvas has no room for them. */
function readout(ctx) {
  const { h } = ctx;
  return ringOf(ctx).map((r, i) => h('li', { class: 'cg-read-' + (i + 1) }, h('b', { text: fmtVal(r.value) }), h('small', { text: r.label })));
}

function legend(ctx) {
  const { h } = ctx;
  const metricOf = (p) => (ctx.metrics || []).find((m) => m.pane === p.id);
  const item = (p) => {
    const s = stateOf(p); const dm = isDemo(ctx, p); const m = metricOf(p);
    return h('li', {}, h('button', { type: 'button', class: 'cg-node ' + s + (dm ? ' is-demo' : '') + (isOutcome(p) ? '' : ' is-tool'), 'aria-label': 'Open ' + p.title + ': ' + (STATE_WORD[s] || '') + (dm ? ', demo data' : ''), onclick: () => ctx.go('pane/' + p.id) },
      h('i', { 'aria-hidden': 'true', text: GLYPH[s] }),
      h('span', { class: 'cg-node-main' }, h('b', { text: p.title }), h('small', { text: (dm ? 'Demo data · ' : '') + (STATE_WORD[s] || '') + (p.state && p.state.text ? ' · ' + stateText(p) : '') })),
      m ? h('span', { class: 'cg-node-num' }, h('b', { text: fmtVal(m.value) + (m.unit && /%/.test(m.unit) ? '%' : '') }), h('small', { text: m.label })) : null));
  };
  const outs = (ctx.panes || []).filter(isOutcome), tools = (ctx.panes || []).filter((p) => !isOutcome(p));
  const phases = phasesOf(tools);
  const automation = phases.length ? h('section', { class: 'cg-pipe', 'aria-label': 'Workflow automation' },
    h('h2', { class: 'cg-pipe-title', text: 'Workflow automation' }),
    h('div', { class: 'cg-pipe-cols' }, phases.map((ph, i) => {
      const s = worst(ph.panes);
      return h('section', { class: 'cg-pipe-col', 'aria-label': ph.label },
        h('div', { class: 'cg-pipe-head' },
          h('span', { class: 'cg-pipe-n', 'aria-hidden': 'true', text: ph.key === 'more' ? '+' : String(i + 1) }),
          h('span', {}, h('b', { text: ph.label }), h('small', { text: PHASE_HINT[ph.key] || '' })),
          h('span', { class: 'cg-chip ' + (s === 'idle' ? '' : s), text: GLYPH[s] + ' ' + (STATE_WORD[s] || '') })),
        h('ul', { class: 'cg-hero-legend is-tools' }, ph.panes.map(item)));
    }))) : null;
  return h('div', { class: 'cg-hero-keys' },
    outs.length ? h('ul', { class: 'cg-hero-legend', 'aria-label': 'Client outcomes' }, outs.map(item)) : null,
    automation);
}

export function render(root, ctx) {
  const { h } = ctx;
  const canvas = h('canvas', { 'aria-hidden': 'true' });
  const box = h('div', { class: 'cg-hero-stage' }, canvas);
  const summary = h('p', { class: 'sr', role: 'status' });
  const read = h('ul', { class: 'cg-hero-read', 'aria-hidden': 'true' });
  const legendBox = h('div', {});
  const wrap = h('section', { class: 'cg-hero', role: 'group', 'aria-label': 'Whole solution state' }, summary, box, read, legendBox);
  root.replaceChildren(wrap);
  const state = { ctx: canvas.getContext('2d'), ctxData: ctx, pal: palette(), still: reduce(), w: 0, h: 0, raf: 0, visible: true, readout: read };
  live.set(root, { state, canvas, box, summary, legendBox, read });
  const redraw = (t = 0) => draw(state, t);
  const loop = (t) => { state.raf = 0; if (state.still || !state.visible || document.hidden) return; redraw(t); state.raf = requestAnimationFrame(loop); };
  const kick = () => { if (!state.raf && !state.still) state.raf = requestAnimationFrame(loop); };
  state.redraw = () => { fit(state, canvas, box); redraw(typeof performance !== 'undefined' ? performance.now() : 0); };
  state.kick = kick;
  summary.textContent = describe(ctx); read.replaceChildren(...readout(ctx)); legendBox.replaceChildren(legend(ctx));
  state.redraw(); kick();
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => { if (root.isConnected) state.redraw(); }).observe(box);
  if (typeof IntersectionObserver !== 'undefined') new IntersectionObserver((e) => { state.visible = e[0].isIntersecting; if (state.visible) kick(); }).observe(box);
  document.addEventListener('visibilitychange', kick);
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect(); const x = e.clientX - r.left, y = e.clientY - r.top;
    const L = state.L; if (!L) return;
    const outs = (state.ctxData.panes || []).filter(isOutcome);
    const i = L.nodes.findIndex((n) => Math.abs(n.x - x) < L.node + 8 && Math.abs(n.y - y) < L.node + 8);
    if (i >= 0 && outs[i]) return state.ctxData.go('pane/' + outs[i].id);
    const b = L.beads.find((n) => Math.abs(n.x - x) < L.bead + 6 && Math.abs(n.y - y) < L.bead + 6);
    if (b) state.ctxData.go('pane/' + b.p.id);
  });
  if (window.matchMedia) window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => { state.still = e.matches; if (state.still) state.redraw(); else kick(); });
}

export function update(root, ctx) {
  const m = live.get(root);
  if (!m) return;
  m.state.ctxData = ctx; m.state.pal = palette();
  m.summary.textContent = describe(ctx);
  m.read.replaceChildren(...readout(ctx));
  m.legendBox.replaceChildren(legend(ctx));
  if (m.state.still) m.state.redraw(); else m.state.kick();
}
