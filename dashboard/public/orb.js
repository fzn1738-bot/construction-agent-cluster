'use strict';
/* Copied from Mac mini HQ (the same orb as the HQ dashboard). The orb: a drifting network of nodes inside a glowing circle.
   Colour follows the system mood (idle / running / waiting on you / failed). Activity makes the network
   move faster and send more pulses along its links.
   No libraries. Draws on a <canvas>; respects prefers-reduced-motion and pauses when off screen. */
(() => {
  const PALETTES = {
    light: { ok: [28, 150, 230], run: [10, 116, 200], wait: [201, 131, 0], bad: [212, 64, 90] },     // sky idle, deep sky busy
    dark: { ok: [92, 200, 255], run: [205, 238, 255], wait: [244, 196, 106], bad: [255, 138, 154] }   // sky idle, ice-white busy
  };
  const RING_COLOURS = { light: { conn: '#0b7f56', engine: '#0a78c2', repos: '#5145c4', bad: '#bb2f46' }, dark: { conn: '#5ee0b4', engine: '#5cc8ff', repos: '#a9b6ff', bad: '#ff8a9a' } };
  // A solution's theme.css can recolour the orb: --orb-ok / --orb-run / --orb-wait / --orb-bad ("r g b") and
  // --ring-1 / --ring-2 / --ring-3 for the three ring captions. Missing values keep the palettes above.
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const themedMoods = (name) => {
    const out = { ...PALETTES[name] };
    for (const k of ['ok', 'run', 'wait', 'bad']) { const m = cssVar('--orb-' + k).match(/^(\d+)[\s,]+(\d+)[\s,]+(\d+)$/); if (m) out[k] = [+m[1], +m[2], +m[3]]; }
    return out;
  };
  const themedRings = (name) => {
    const out = { ...RING_COLOURS[name] };
    ['conn', 'engine', 'repos'].forEach((k, i) => { const v = cssVar('--ring-' + (i + 1)); if (v) out[k] = v; });
    return out;
  };
  let themeName = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  let MOODS = themedMoods(themeName);
  let connBad = false;

  // ---------- curved labels around the top of the orb (SVG) ----------
  const NS = 'http://www.w3.org/2000/svg';
  const BASE = { v: 202, c: 225 };   // value arc just outside the rim, caption arc outside that
  const RIM = 190;
  const LABELS = [
    { id: 'conn', cap: 'CONNECTIONS', color: themedRings(themeName).conn, at: 0.16 },
    { id: 'engine', cap: 'LOCAL MODEL', color: themedRings(themeName).engine, at: 0.5 },
    { id: 'repos', cap: 'REPOS', color: themedRings(themeName).repos, at: 0.84 }
  ];
  const mk = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
  const semi = (r) => `M ${240 - r} 240 A ${r} ${r} 0 0 1 ${240 + r} 240`;
  const pt = (r, f) => { const th = Math.PI + Math.PI * f; return [240 + r * Math.cos(th), 240 + r * Math.sin(th)]; };
  const ringNodes = {};
  const ringHost = document.getElementById('orbRing');
  if (ringHost) {
    const svg = mk('svg', { viewBox: '0 0 480 480', class: 'ring', focusable: 'false' });
    const defs = mk('defs');
    defs.append(mk('path', { id: 'arcV', d: semi(BASE.v) }), mk('path', { id: 'arcC', d: semi(BASE.c) }));
    svg.append(defs);
    for (const l of LABELS) {
      const pts = []; for (let i = 0; i <= 24; i++) pts.push(pt(RIM, l.at - 0.085 + (0.17 * i) / 24).map((n) => n.toFixed(1)).join(' '));
      const arc = mk('path', { d: 'M ' + pts.join(' L '), fill: 'none', stroke: l.color, 'stroke-width': 2.2, 'stroke-linecap': 'round', opacity: 0.85 });
      svg.append(arc);
      const tv = mk('text', { class: 'rv', 'text-anchor': 'middle' }); const pv = mk('textPath', { href: '#arcV', startOffset: (l.at * 100).toFixed(1) + '%' }); pv.textContent = '–'; tv.append(pv);
      const tc = mk('text', { class: 'rc', 'text-anchor': 'middle', fill: l.color }); const pc = mk('textPath', { href: '#arcC', startOffset: (l.at * 100).toFixed(1) + '%' }); pc.textContent = l.cap; tc.append(pc);
      svg.append(tv, tc);
      ringNodes[l.id] = { value: pv, cap: pc, capText: tc, arc };
    }
    ringHost.append(svg);
  }

  // ---------- network (canvas) ----------
  const cv = document.getElementById('orbCanvas');
  const ctx = cv && cv.getContext ? cv.getContext('2d') : null;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const LINK = 0.34;                 // max link length, in orb radii
  let nodes = [], pulses = [];
  let size = 0, dpr = 1;
  let cur = MOODS.ok.slice(), want = MOODS.ok.slice();
  let moodName = 'ok';
  let energy = 0.15, wantEnergy = 0.15;
  let raf = 0, last = 0, visible = true;

  function seed() {
    const n = cv.clientWidth > 340 ? 84 : 66;
    nodes = Array.from({ length: n }, (_, i) => {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.97;
      const v = Math.random() * Math.PI * 2, s = 0.04 + Math.random() * 0.09;
      return { x: Math.cos(a) * r, y: Math.sin(a) * r, vx: Math.cos(v) * s, vy: Math.sin(v) * s, hub: i % 9 === 0 };
    });
    pulses = [];
  }
  function resize() {
    if (!cv) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    size = Math.round(cv.clientWidth * dpr);
    if (!size) return;
    cv.width = size; cv.height = size;
    if (!nodes.length) seed();
    draw();
  }

  const rgba = (a) => `rgba(${cur[0] | 0},${cur[1] | 0},${cur[2] | 0},${a})`;
  const neighbours = (i) => {
    const out = [], p = nodes[i];
    for (let j = 0; j < nodes.length; j++) {
      if (j === i) continue;
      const dx = nodes[j].x - p.x, dy = nodes[j].y - p.y;
      if (dx * dx + dy * dy < LINK * LINK) out.push(j);
    }
    return out;
  };

  function step(dt) {
    const speed = 0.5 + energy * 1.6;
    for (const p of nodes) {
      p.x += p.vx * dt * speed; p.y += p.vy * dt * speed;
      const d = Math.hypot(p.x, p.y);
      if (d > 0.97) {                // bounce off the rim
        const nx = p.x / d, ny = p.y / d, dot = p.vx * nx + p.vy * ny;
        if (dot > 0) { p.vx -= 2 * dot * nx; p.vy -= 2 * dot * ny; }
        p.x = nx * 0.97; p.y = ny * 0.97;
      }
    }
    // a slow idle shimmer, a busy flurry of signals
    if (Math.random() < dt * (0.7 + energy * 9)) {
      const a = (Math.random() * nodes.length) | 0, nb = neighbours(a);
      if (nb.length) pulses.push({ a, b: nb[(Math.random() * nb.length) | 0], t: 0, dur: 0.45 + Math.random() * 0.5 });
    }
    for (const q of pulses) q.t += dt / q.dur;
    for (let k = pulses.length - 1; k >= 0; k--) {
      const q = pulses[k];
      if (q.t < 1) continue;
      pulses.splice(k, 1);
      if (Math.random() < 0.55 && pulses.length < 40) {   // carry the signal on to a neighbour
        const nb = neighbours(q.b).filter((j) => j !== q.a);
        if (nb.length) pulses.push({ a: q.b, b: nb[(Math.random() * nb.length) | 0], t: 0, dur: 0.4 + Math.random() * 0.45 });
      }
    }
  }

  function draw() {
    if (!ctx || !size) return;
    const R = size / 2;
    ctx.clearRect(0, 0, size, size);
    ctx.save();
    ctx.beginPath(); ctx.arc(R, R, R - 1, 0, Math.PI * 2); ctx.clip();
    const bg = ctx.createRadialGradient(R, R, 0, R, R, R);
    bg.addColorStop(0, rgba(0.03)); bg.addColorStop(0.75, rgba(0.06)); bg.addColorStop(1, rgba(0.12));
    ctx.fillStyle = bg; ctx.fillRect(0, 0, size, size);
    ctx.lineWidth = Math.max(1, dpr * 0.8);
    for (let i = 0; i < nodes.length; i++) {
      const p = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const q = nodes[j], dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
        if (d2 > LINK * LINK) continue;
        const a = (1 - Math.sqrt(d2) / LINK) * 0.55;
        ctx.strokeStyle = rgba(a);
        ctx.beginPath(); ctx.moveTo(R + p.x * R, R + p.y * R); ctx.lineTo(R + q.x * R, R + q.y * R); ctx.stroke();
      }
    }
    for (const p of nodes) {
      const x = R + p.x * R, y = R + p.y * R;
      if (p.hub) {
        const g = ctx.createRadialGradient(x, y, 0, x, y, dpr * 9);
        g.addColorStop(0, rgba(0.45)); g.addColorStop(1, rgba(0));
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, dpr * 9, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = rgba(p.hub ? 0.95 : 0.7);
      ctx.beginPath(); ctx.arc(x, y, dpr * (p.hub ? 1.9 : 1.3), 0, Math.PI * 2); ctx.fill();
    }
    for (const q of pulses) {
      const A = nodes[q.a], B = nodes[q.b], t = Math.min(1, q.t);
      const x = R + (A.x + (B.x - A.x) * t) * R, y = R + (A.y + (B.y - A.y) * t) * R;
      const g = ctx.createRadialGradient(x, y, 0, x, y, dpr * 7);
      g.addColorStop(0, rgba(1)); g.addColorStop(0.35, rgba(0.55)); g.addColorStop(1, rgba(0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, dpr * 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  function applyCssColour() {
    document.documentElement.style.setProperty('--orb', `${cur[0] | 0} ${cur[1] | 0} ${cur[2] | 0}`);
  }
  applyCssColour();   // so the page picks up a themed orb colour straight away, not only once it animates

  function frame(now) {
    raf = 0;
    if (!visible || document.hidden || reduced.matches) return;
    const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
    if (now - last < 33) { raf = requestAnimationFrame(frame); return; }   // ~30 fps is plenty and kind to a phone battery
    last = now;
    let moving = false;
    for (let k = 0; k < 3; k++) {
      const d = want[k] - cur[k];
      if (Math.abs(d) > 0.5) { cur[k] += d * 0.08; moving = true; } else cur[k] = want[k];
    }
    energy += (wantEnergy - energy) * 0.06;
    if (moving) applyCssColour();
    step(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }
  function kick() { if (!raf && visible && !reduced.matches) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  if (cv && ctx) {
    new ResizeObserver(resize).observe(cv);
    if ('IntersectionObserver' in window) new IntersectionObserver((e) => { visible = e[0].isIntersecting; kick(); }, { threshold: 0 }).observe(cv);
    document.addEventListener('visibilitychange', kick);
    reduced.addEventListener('change', () => { kick(); draw(); });
    resize(); kick();
  }

  // ---------- public API ----------
  window.Orb = {
    /** mood: ok | run | wait | bad;  energy: 0..1 */
    set(mood, e) {
      want = (MOODS[mood] || MOODS.ok).slice();
      wantEnergy = Math.max(0, Math.min(1, e));
      document.documentElement.dataset.mood = mood;
      moodName = mood;
      document.documentElement.style.setProperty('--breath', (6.5 - 4.5 * wantEnergy).toFixed(2) + 's');
      if (reduced.matches) { cur = want.slice(); applyCssColour(); draw(); } else kick();
    },
    /** values: { engine, conn, repos } display strings; tones: optional { conn: '#hex' } caption colour */
    /** switch the orb and ring colours between the light and dark palettes */
    theme(name) {
      themeName = name === 'dark' ? 'dark' : 'light';
      MOODS = themedMoods(themeName);
      want = MOODS[moodName].slice();
      if (reduced.matches) { cur = want.slice(); applyCssColour(); draw(); } else kick();
      const rc = themedRings(themeName);
      for (const [k, n] of Object.entries(ringNodes)) {
        const col = k === 'conn' && connBad ? rc.bad : rc[k];
        n.capText.setAttribute('fill', col); n.arc.setAttribute('stroke', col);
      }
    },
    /** captions for the three ring labels, left to right */
    caps(list) {
      ['conn', 'engine', 'repos'].forEach((k, i) => { const n = ringNodes[k]; if (n && list && list[i]) n.cap.textContent = String(list[i]).toUpperCase().slice(0, 18); });
    },
    ring(values, tones = {}) {
      for (const [k, v] of Object.entries(values)) { const n = ringNodes[k]; if (n && n.value.textContent !== v) n.value.textContent = v; }
      if ('connBad' in tones) connBad = !!tones.connBad;
      const rc = themedRings(themeName);
      const n = ringNodes.conn;
      if (n) { const col = connBad ? rc.bad : rc.conn; n.capText.setAttribute('fill', col); n.arc.setAttribute('stroke', col); }
    }
  };
})();
