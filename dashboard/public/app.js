'use strict';
// Solution dashboard client. Polls api/summary (relative, so it works behind HQ's /apps/<repo>/ proxy),
// draws the orb, run buttons, metric tiles, charts, runs, reports and feedback. No libraries.
(() => {
  const $ = (s) => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else el.setAttribute(k, v === true ? '' : String(v)); }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  };
  const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
  const replace = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1000 ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v) : String(Math.round(v * 10) / 10)) : String(v ?? '–'));
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return isNaN(m) ? '' : m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* sandboxed: not saved */ } } };

  // theme: saved choice, else the system setting
  const theme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('#themeBtn').setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    $('#themeBtn').setAttribute('aria-label', t === 'dark' ? 'Light mode' : 'Dark mode');
    if (window.Orb && Orb.theme) Orb.theme(t);
  }
  applyTheme(store.get('app-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#themeBtn').addEventListener('click', () => { const t = theme() === 'dark' ? 'light' : 'dark'; store.set('app-theme', t); applyTheme(t); });

  const MOOD = { ok: 'ok', run: 'run', busy: 'run', wait: 'wait', warn: 'wait', bad: 'bad', idle: 'ok' };
  let last = null, sig = {};
  const once = (key, data, fn) => { const k = JSON.stringify(data); if (sig[key] !== k) { sig[key] = k; fn(); } };

  function spark(values) {
    const svg = s('svg', { class: 'spark', viewBox: '0 0 100 34', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const v = (values || []).filter((x) => typeof x === 'number');
    if (v.length < 2) return svg;
    const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
    const pts = v.map((x, i) => [(i / (v.length - 1)) * 100, 31 - ((x - lo) / span) * 28]);
    const d = 'M' + pts.map((p) => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' L');
    svg.append(s('path', { class: 'area', d: d + ' L100 34 L0 34 Z' }), s('path', { d, 'vector-effect': 'non-scaling-stroke' }));
    return svg;
  }

  function chart(p) {
    const W = 420, H = 180, L = 34, B = 22, T = 8;
    const svg = s('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': p.title });
    const series = (p.series || []).slice(0, 4);
    const all = series.flatMap((x) => x.values || []).filter((x) => typeof x === 'number');
    if (!all.length) return svg;
    const hi = Math.max(...all, 0) * 1.1 || 1;
    const n = (p.labels || series[0].values).length;
    const y = (v) => T + (H - B - T) * (1 - v / hi), x = (i) => L + ((W - L - 6) * (n === 1 ? 0.5 : i / (n - 1)));
    for (let g = 0; g <= 3; g++) { const yy = T + ((H - B - T) * g) / 3; svg.append(s('line', { class: 'grid', x1: L, x2: W - 4, y1: yy, y2: yy })); const t = s('text', { class: 'axis', x: L - 6, y: yy + 4, 'text-anchor': 'end' }); t.textContent = fmt(hi * (1 - g / 3)); svg.append(t); }
    const step = Math.max(1, Math.ceil(n / 6));
    (p.labels || []).forEach((lab, i) => { if (i % step) return; const t = s('text', { class: 'axis', x: p.kind === 'bar' ? L + ((W - L - 6) * (i + 0.5)) / n : x(i), y: H - 6, 'text-anchor': 'middle' }); t.textContent = String(lab).slice(0, 10); svg.append(t); });
    series.forEach((se, k) => {
      const col = `var(--s${k + 1})`;
      if (p.kind === 'bar') {
        const bw = ((W - L - 6) / n) * (0.7 / series.length);
        (se.values || []).forEach((v, i) => { const bx = L + ((W - L - 6) * i) / n + ((W - L - 6) / n) * 0.15 + bw * k; const r = s('rect', { class: 'bar', x: bx, y: y(v), width: Math.max(bw - 2, 2), height: Math.max(H - B - y(v), 0), fill: col }); const tt = s('title'); tt.textContent = (p.labels && p.labels[i] ? p.labels[i] + ': ' : '') + fmt(v); r.append(tt); svg.append(r); });
      } else {
        const d = 'M' + (se.values || []).map((v, i) => x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' L');
        svg.append(s('path', { class: 'line', d, stroke: col }));
      }
    });
    return svg;
  }

  function panel(p) {
    const box = h('div', { class: 'panel' }, h('h2', { text: p.title || 'Panel' }));
    if (p.kind === 'line' || p.kind === 'bar') {
      box.append(chart(p));
      if ((p.series || []).length) box.append(h('div', { class: 'legend' }, (p.series || []).slice(0, 4).map((se, k) => { const i = h('i'); i.style.setProperty('--k', `var(--s${k + 1})`); return h('span', {}, i, se.name || 'Series ' + (k + 1)); })));
    } else if (p.kind === 'list') {
      box.append((p.rows || []).length ? h('ul', { class: 'rlist' }, (p.rows || []).slice(0, 12).map((r) => h('li', {}, h('span', { text: Array.isArray(r) ? r[0] : r }), Array.isArray(r) && r[1] != null ? h('small', { text: r[1] }) : null))) : h('p', { class: 'empty', text: 'Nothing yet.' }));
    } else {
      const cols = p.columns || [];
      box.append((p.rows || []).length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', { text: c })))), h('tbody', {}, (p.rows || []).slice(0, 25).map((r) => h('tr', {}, (Array.isArray(r) ? r : cols.map((c) => r[c])).map((c) => h('td', { class: typeof c === 'number' ? 'num' : null, text: fmt(c) }))))))) : h('p', { class: 'empty', text: 'Nothing yet.' }));
    }
    return box;
  }

  async function runAction(a, btn, input) {
    btn.disabled = true;
    const out = $('#runOut');
    out.hidden = false; out.className = 'runout'; out.textContent = 'Running ' + a.label + '…';
    if (window.Orb) Orb.set('run', 0.8);
    try {
      const r = await fetch('api/run', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: a.id, input }) });
      const d = await r.json();
      out.className = 'runout ' + (d.ok ? 'ok' : 'bad');
      out.textContent = (d.ok ? '✓ ' : '✕ ') + a.label + ': ' + (d.message || (d.ok ? 'done' : 'failed')) + (d.ms != null ? ' (' + (d.ms / 1000).toFixed(1) + 's)' : '');
    } catch (e) { out.className = 'runout bad'; out.textContent = '✕ ' + a.label + ': ' + e.message; }
    btn.disabled = false;
    poll();
  }

  function render(d) {
    const st = d.status || {};
    document.title = d.app.name;
    $('#appName').textContent = d.app.name; $('#tagline').textContent = d.app.tagline || '';
    $('#coreCtx').textContent = st.detail || ''; $('#coreBig').textContent = st.headline || 'Ready';
    $('#coreVal').textContent = st.primary ? fmt(st.primary.value) : '–'; $('#coreCap').textContent = st.primary ? st.primary.label : '';
    const ring = (st.ring || []).slice(0, 3);
    if (window.Orb) {
      Orb.set(MOOD[st.mood] || 'ok', st.mood === 'run' || st.mood === 'busy' ? 0.7 : 0.2);
      if (Orb.caps) Orb.caps(ring.map((r) => r.label).concat(d.app.ring || []).slice(0, 3));
      Orb.ring({ conn: fmt(ring[0] && ring[0].value), engine: fmt(ring[1] && ring[1].value), repos: fmt(ring[2] && ring[2].value) }, { connBad: st.mood === 'bad' });
    }
    $('#orbSummary').textContent = (st.headline || '') + '. ' + ring.map((r) => r.label + ' ' + fmt(r.value)).join(', ');
    once('actions', d.actions, () => replace($('#actions'), (d.actions || []).map((a, i) => {
      const btn = h('button', { class: 'btn' + (i === 0 ? ' primary' : ''), type: 'button', title: a.description || null, text: a.label });
      if (a.input) {
        const inp = h('input', { type: 'text', 'aria-label': a.input.label || a.label, placeholder: a.input.placeholder || a.input.label || '' });
        btn.addEventListener('click', () => runAction(a, btn, inp.value));
        return h('div', { class: 'actin' }, inp, btn);
      }
      btn.addEventListener('click', () => runAction(a, btn, ''));
      return btn;
    })));
    once('tiles', d.metrics, () => replace($('#tiles'), (Array.isArray(d.metrics) ? d.metrics : []).map((m) => {
      const t = (m.trend || []).filter((x) => typeof x === 'number');
      const delta = t.length > 1 ? t[t.length - 1] - t[0] : null;
      const good = delta == null ? null : (m.good === 'down' ? delta <= 0 : delta >= 0);
      return h('div', { class: 'tile' }, h('div', { class: 'l', text: m.label }), h('div', { class: 'v' }, fmt(m.value), m.unit ? h('small', { text: m.unit }) : null), spark(t),
        delta == null ? null : h('div', { class: 'd ' + (good ? 'good' : 'bad'), text: (delta >= 0 ? '▲ ' : '▼ ') + fmt(Math.abs(delta)) + ' over the period' }));
    })));
    once('panels', d.panels, () => replace($('#panels'), (Array.isArray(d.panels) ? d.panels : []).map(panel)));
    const hl = d.health || {};
    $('#health').textContent = hl.successRate == null ? 'no runs yet' : hl.successRate + '% ok · avg ' + (hl.avgMs / 1000).toFixed(1) + 's';
    $('#health').className = 'chip' + (hl.successRate == null ? '' : hl.successRate >= 90 ? ' ok' : ' bad');
    once('runs', d.runs, () => replace($('#runs'), (d.runs || []).length ? h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', { text: 'Run' }), h('th', { text: 'Result' }), h('th', { class: 'num', text: 'Time' }), h('th', { text: 'When' }))),
      h('tbody', {}, d.runs.slice(0, 10).map((r) => h('tr', {}, h('td', { text: r.label }), h('td', { text: (r.ok ? '✓ ' : '✕ ') + (r.message || '') }), h('td', { class: 'num', text: (r.ms / 1000).toFixed(1) + 's' }), h('td', { text: ago(r.at) })))))) : h('p', { class: 'empty', text: 'Run something with the buttons under the orb.' })));
    once('reports', d.reports, () => replace($('#reports'), (Array.isArray(d.reports) && d.reports.length) ? h('ul', { class: 'rlist' }, d.reports.slice(0, 10).map((r) => h('li', {}, r.href ? h('a', { href: r.href, text: r.title }) : h('span', { text: r.title }), h('small', { text: ago(r.createdAt) })))) : h('p', { class: 'empty', text: 'No reports yet.' })));
    const fb = d.feedback || {};
    $('#fbCount').textContent = '👍 ' + (fb.up || 0) + ' · 👎 ' + (fb.down || 0);
    once('fb', fb.recent, () => replace($('#fbRecent'), (fb.recent || []).map((f) => h('li', {}, (f.vote === 'up' ? '👍 ' : '👎 ') + (f.note || '(no note)') + ' ', h('small', { text: ago(f.at) })))));
    replace($('#foot'), d.app.mock ? [h('b', { text: 'Sample data' }), ' — this is the planned layout; the build fills in real numbers.'] : 'Updated ' + new Date(d.at).toLocaleTimeString());
  }

  let vote = null;
  document.querySelectorAll('.vote').forEach((b) => b.addEventListener('click', () => { vote = b.dataset.vote; document.querySelectorAll('.vote').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); }));
  $('#fb').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!vote) { $('#fbCount').textContent = 'Pick 👍 or 👎 first'; return; }
    await fetch('api/feedback', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ vote, note: $('#fbNote').value }) });
    $('#fbNote').value = ''; vote = null; document.querySelectorAll('.vote').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    poll();
  });

  async function poll() {
    try {
      const r = await fetch('api/summary', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      last = await r.json();
      $('#live').classList.remove('off'); $('#live').textContent = 'Live';
      render(last);
    } catch { $('#live').classList.add('off'); $('#live').textContent = 'Offline'; }
  }
  poll();
  setInterval(() => { if (!document.hidden) poll(); }, 5000);
})();
