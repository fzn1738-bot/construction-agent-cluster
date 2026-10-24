'use strict';
// Solution dashboard client: a sign-in gate, a left sidebar (Overview, one pane per feature or service, Reports,
// Feedback, and for admins Settings, Users & access, Activity and Control) and the views behind it.
// Every API call is relative (so it works behind HQ's /apps/<repo>/ proxy) and carries the access key.
// The key arrives in the link (#key=…) or from the sign-in form, and is kept in memory for this tab. No libraries.
(() => {
  const $ = (s) => document.querySelector(s);
  const NS = 'http://www.w3.org/2000/svg';
  const h = (tag, attrs = {}, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : String(v)); }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  };
  const s = (tag, attrs = {}) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); return el; };
  const replace = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false));
  const fmt = (v) => (typeof v === 'number' ? (Math.abs(v) >= 1000 ? new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(v) : String(Math.round(v * 10) / 10)) : String(v ?? '–'));
  const ago = (iso) => { const m = Math.round((Date.now() - Date.parse(iso)) / 60000); return isNaN(m) ? '' : m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
  // the page may run sandboxed (no storage): every read and write is optional
  const mem = {};
  const store = (area) => ({ get(k) { try { return window[area].getItem(k); } catch { return mem[area + k] ?? null; } }, set(k, v) { try { window[area].setItem(k, v); } catch { mem[area + k] = v; } }, del(k) { try { window[area].removeItem(k); } catch { delete mem[area + k]; } } });
  const local = store('localStorage'), session = store('sessionStorage');

  // ---------- theme ----------
  const theme = () => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    $('#themeBtn').setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
    $('#themeBtn').setAttribute('aria-label', t === 'dark' ? 'Light mode' : 'Dark mode');
    if (window.Orb && Orb.theme) Orb.theme(t);
  }
  applyTheme(local.get('app-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  $('#themeBtn').addEventListener('click', () => { const t = theme() === 'dark' ? 'light' : 'dark'; local.set('app-theme', t); applyTheme(t); });

  // ---------- access key ----------
  let KEY = '';
  const hashKey = location.hash.match(/[#&]key=([^&]+)/);
  if (hashKey) { KEY = decodeURIComponent(hashKey[1]); session.set('app-key', KEY); try { history.replaceState(null, '', location.pathname + location.search + '#/overview'); } catch { location.hash = '#/overview'; } }
  else KEY = session.get('app-key') || '';
  async function api(path, opts = {}) {
    const r = await fetch(path, { cache: 'no-store', ...opts, headers: { 'Content-Type': 'text/plain', 'x-app-key': KEY, ...(opts.headers || {}) } });
    if (r.status === 401) { showGate('That code didn’t work. Check it and try again.'); throw new Error('signed out'); }
    const d = await r.json().catch(() => ({}));
    if (r.status === 503 && d.maintenance) { showNotice(d.message || 'Paused for maintenance.', 'warn'); throw new Error('maintenance'); }
    if (!r.ok && d.message) throw new Error(d.message);
    return d;
  }
  const post = (path, data) => api(path, { method: 'POST', body: JSON.stringify(data) });
  function showGate(msg = '') { $('#gate').hidden = false; $('#shell').hidden = true; $('#gateMsg').textContent = KEY ? msg : ''; $('#code').focus(); }
  $('#signin').addEventListener('submit', async (e) => {
    e.preventDefault();
    KEY = $('#code').value.trim(); session.set('app-key', KEY);
    try { await api('api/me'); $('#gate').hidden = true; $('#shell').hidden = false; $('#code').value = ''; poll(true); } catch {}
  });
  $('#signOut').addEventListener('click', () => { KEY = ''; session.del('app-key'); last = null; showGate(); });

  // ---------- sidebar ----------
  const side = $('#side'), scrim = $('#scrim');
  const setMenu = (open) => { side.classList.toggle('open', open); scrim.hidden = !open; $('#menuBtn').setAttribute('aria-expanded', open ? 'true' : 'false'); };
  $('#menuBtn').addEventListener('click', () => setMenu(!side.classList.contains('open')));
  scrim.addEventListener('click', () => setMenu(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

  const ICON = { overview: 'M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-5H4zm10-11h6V4h-6z', pane: 'M5 5h14v14H5z', reports: 'M7 3h7l5 5v13H7zM14 3v5h5', feedback: 'M4 5h16v11H8l-4 4z', settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm8 3-2-1 .5-2.2-2.3-.4L15 6l-2 1-1-2-1 2-2-1-1.2 2.4-2.3.4L6 11l-2 1 2 1-.5 2.2 2.3.4L9 18l2-1 1 2 1-2 2 1 1.2-2.4 2.3-.4L18 13z', users: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-6 9a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a6 6 0 0 0-4-5.6', activity: 'M3 12h4l3 7 4-14 3 7h4', control: 'M12 3v9M6.3 6.3a8 8 0 1 0 11.4 0' };
  const icon = (k) => { const v = s('svg', { viewBox: '0 0 24 24', 'aria-hidden': 'true' }); v.append(s('path', { d: ICON[k] || ICON.pane })); return v; };
  function renderNav(d) {
    const item = (route, label, ic, sub) => h('a', { href: '#/' + route, class: 'nav-i', 'data-route': route, title: sub || null }, ic === 'pane' ? h('i', { class: 'nav-b', 'aria-hidden': 'true', text: (label.match(/[A-Za-z0-9]/) || ['•'])[0].toUpperCase() }) : icon(ic), h('span', { text: label }));
    const groups = [
      h('div', { class: 'nav-g' }, item('overview', 'Overview', 'overview')),
      (d.panes || []).length ? h('div', { class: 'nav-g' }, h('p', { class: 'nav-h', text: d.me.role === 'admin' ? 'Features and services' : 'Your services' }), d.panes.map((p) => item('pane/' + p.id, p.title, 'pane', p.summary))) : null,
      h('div', { class: 'nav-g' }, item('reports', 'Reports', 'reports'), item('feedback', 'Feedback', 'feedback')),
      d.me.role === 'admin' ? h('div', { class: 'nav-g admin' }, h('p', { class: 'nav-h', text: 'Admin' }), item('admin/settings', 'Settings', 'settings'), item('admin/users', 'Users & access', 'users'), item('admin/activity', 'Activity', 'activity'), item('admin/control', 'Control', 'control')) : null
    ];
    replace($('#nav'), groups);
    $('#whoName').textContent = d.me.name; $('#whoRole').textContent = d.me.role === 'admin' ? 'Admin' : 'Client';
    markNav();
  }
  const route = () => (location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];
  function markNav() { const r = route(); document.querySelectorAll('.nav-i').forEach((a) => a.setAttribute('aria-current', a.dataset.route === r ? 'page' : 'false')); }

  // ---------- pieces ----------
  const MOOD = { ok: 'ok', run: 'run', busy: 'run', wait: 'wait', warn: 'wait', bad: 'bad', idle: 'ok' };
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
      } else svg.append(s('path', { class: 'line', d: 'M' + (se.values || []).map((v, i) => x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' L'), stroke: col }));
    });
    return svg;
  }
  const table = (cols, rows) => h('div', { class: 'tablewrap' }, h('table', {}, h('thead', {}, h('tr', {}, cols.map((c) => h('th', { text: c })))), h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => (c instanceof Node ? h('td', {}, c) : h('td', { class: typeof c === 'number' ? 'num' : null, text: fmt(c) }))))))));
  function panel(p) {
    const box = h('div', { class: 'panel' }, h('h3', { text: p.title || 'Panel' }));
    if (p.kind === 'line' || p.kind === 'bar') {
      box.append(chart(p));
      if ((p.series || []).length) box.append(h('div', { class: 'legend' }, (p.series || []).slice(0, 4).map((se, k) => { const i = h('i'); i.style.setProperty('--k', `var(--s${k + 1})`); return h('span', {}, i, se.name || 'Series ' + (k + 1)); })));
    } else if (p.kind === 'list') {
      box.append((p.rows || []).length ? h('ul', { class: 'rlist' }, (p.rows || []).slice(0, 12).map((r) => h('li', {}, h('span', { text: Array.isArray(r) ? r[0] : r }), Array.isArray(r) && r[1] != null ? h('small', { text: r[1] }) : null))) : h('p', { class: 'empty', text: 'Nothing yet.' }));
    } else {
      const cols = p.columns || [];
      box.append((p.rows || []).length ? table(cols, (p.rows || []).slice(0, 25).map((r) => (Array.isArray(r) ? r : cols.map((c) => r[c])))) : h('p', { class: 'empty', text: 'Nothing yet.' }));
    }
    return box;
  }
  function tile(m) {
    const t = (m.trend || []).filter((x) => typeof x === 'number');
    const delta = t.length > 1 ? t[t.length - 1] - t[0] : null;
    const good = delta == null ? null : (m.good === 'down' ? delta <= 0 : delta >= 0);
    return h('div', { class: 'tile' }, h('div', { class: 'l', text: m.label }), h('div', { class: 'v' }, fmt(m.value), m.unit ? h('small', { text: m.unit }) : null), spark(t),
      delta == null ? null : h('div', { class: 'd ' + (good ? 'good' : 'bad'), text: (delta >= 0 ? '▲ ' : '▼ ') + fmt(Math.abs(delta)) + ' over the period' }));
  }
  async function runAction(a, btn, input, out) {
    btn.disabled = true;
    out.hidden = false; out.className = 'runout'; out.textContent = 'Running ' + a.label + '…';
    if (window.Orb) Orb.set('run', 0.8);
    try {
      const d = await post('api/run', { action: a.id, input });
      out.className = 'runout ' + (d.ok ? 'ok' : 'bad');
      out.textContent = (d.ok ? '✓ ' : '✕ ') + a.label + ': ' + (d.message || (d.ok ? 'done' : 'failed')) + (d.ms != null ? ' (' + (d.ms / 1000).toFixed(1) + 's)' : '');
    } catch (e) { out.className = 'runout bad'; out.textContent = '✕ ' + a.label + ': ' + e.message; }
    btn.disabled = false;
    poll();
  }
  function actionButtons(list, out, canRun) {
    return (list || []).map((a, i) => {
      const btn = h('button', { class: 'btn' + (i === 0 ? ' primary' : ''), type: 'button', title: a.description || null, text: a.label, disabled: !canRun });
      if (a.input) {
        const inp = h('input', { type: 'text', 'aria-label': a.input.label || a.label, placeholder: a.input.placeholder || a.input.label || '', disabled: !canRun });
        btn.addEventListener('click', () => runAction(a, btn, inp.value, out));
        return h('div', { class: 'actin' }, inp, btn);
      }
      btn.addEventListener('click', () => runAction(a, btn, '', out));
      return btn;
    });
  }
  const reportList = (rs, n = 20) => (rs || []).length ? h('ul', { class: 'rlist' }, rs.slice(0, n).map((r) => h('li', {}, r.href ? h('a', { href: r.href + (r.href.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY), text: r.title, target: '_blank', rel: 'noopener' }) : h('span', { text: r.title }), h('small', { text: ago(r.createdAt) })))) : h('p', { class: 'empty', text: 'No reports yet.' });
  const runsTable = (runs, who) => (runs || []).length ? table(['Run', 'Result', ...(who ? ['By'] : []), 'Time', 'When'], runs.slice(0, 25).map((r) => [r.label, (r.ok ? '✓ ' : '✕ ') + (r.message || ''), ...(who ? [r.byName || '–'] : []), (r.ms / 1000).toFixed(1) + 's', ago(r.at)])) : h('p', { class: 'empty', text: 'No runs yet.' });
  function showNotice(text, kind = 'info') { const n = $('#notice'); n.hidden = !text; n.className = 'notice ' + kind; n.textContent = text || ''; }

  // ---------- views ----------
  let last = null, admin = null;
  const sig = {};
  const once = (key, data, fn) => { const k = JSON.stringify(data); if (sig[key] !== k) { sig[key] = k; fn(); } };
  const VIEWS = ['overview', 'pane', 'reports', 'feedback', 'settings', 'users', 'activity', 'control'];
  function show(v, title, sub = '') {
    for (const x of VIEWS) $('#v-' + x).hidden = x !== v;
    $('#pageTitle').textContent = title; $('#pageSub').textContent = sub;
    document.title = title + ' · ' + ((last && last.app.name) || 'Dashboard');
  }
  function renderOverview(d) {
    const st = d.status || {};
    $('#coreCtx').textContent = st.detail || ''; $('#coreBig').textContent = st.headline || 'Ready';
    $('#coreVal').textContent = st.primary ? fmt(st.primary.value) : '–'; $('#coreCap').textContent = st.primary ? st.primary.label : '';
    const ring = (st.ring || []).slice(0, 3);
    if (window.Orb) {
      Orb.set(MOOD[st.mood] || 'ok', st.mood === 'run' || st.mood === 'busy' ? 0.7 : 0.2);
      if (Orb.caps) Orb.caps(ring.map((r) => r.label).concat(d.app.ring || []).slice(0, 3));
      Orb.ring({ conn: fmt(ring[0] && ring[0].value), engine: fmt(ring[1] && ring[1].value), repos: fmt(ring[2] && ring[2].value) }, { connBad: st.mood === 'bad' });
    }
    $('#orbSummary').textContent = (st.headline || '') + '. ' + ring.map((r) => r.label + ' ' + fmt(r.value)).join(', ');
    const here = (x) => x.pane === 'overview';
    once('actions', [d.actions, d.me.canRun], () => replace($('#actions'), actionButtons((d.actions || []).filter(here), $('#runOut'), d.me.canRun)));
    once('tiles', d.metrics, () => replace($('#tiles'), (d.metrics || []).filter(here).map(tile)));
    once('services', [d.panes, d.metrics], () => replace($('#services'), (d.panes || []).length ? [h('h3', { class: 'sec-h', text: d.me.role === 'admin' ? 'Features and services' : 'Your services' }), h('div', { class: 'svc-grid' }, d.panes.map((p) => {
      const m = (d.metrics || []).find((x) => x.pane === p.id);
      return h('a', { class: 'svc', href: '#/pane/' + p.id }, h('b', { text: p.title }), p.summary ? h('span', { text: p.summary }) : null, m ? h('em', {}, fmt(m.value), m.unit ? ' ' + m.unit : '', h('small', { text: ' ' + m.label })) : null, d.me.role === 'admin' && !p.clientVisible ? h('i', { class: 'chip', text: 'Hidden from clients' }) : null);
    }))] : []));
    once('panels', d.panels, () => replace($('#panels'), (d.panels || []).filter(here).map(panel)));
    const hl = d.health || {};
    $('#health').textContent = hl.successRate == null ? 'no runs yet' : hl.successRate + '% ok · avg ' + (hl.avgMs / 1000).toFixed(1) + 's';
    $('#health').className = 'chip' + (hl.successRate == null ? '' : hl.successRate >= 90 ? ' ok' : ' bad');
    once('runs', d.runs, () => replace($('#runs'), runsTable(d.runs.slice(0, 8), d.me.role === 'admin')));
    once('reportsMini', d.reports, () => replace($('#reportsMini'), reportList(d.reports, 6)));
  }
  function renderPane(d, id) {
    const p = (d.panes || []).find((x) => x.id === id);
    if (!p) { show('pane', 'Not available', 'This pane is not part of your access.'); replace($('#paneActions')); replace($('#paneTiles')); replace($('#panePanels')); $('#paneEmpty').hidden = true; return; }
    show('pane', p.title, p.summary);
    const mine = (x) => x.pane === id;
    const acts = (d.actions || []).filter(mine), mets = (d.metrics || []).filter(mine), pans = (d.panels || []).filter(mine);
    once('pane-a', [id, acts, d.me.canRun], () => replace($('#paneActions'), actionButtons(acts, $('#paneOut'), d.me.canRun)));
    once('pane-t', [id, mets], () => replace($('#paneTiles'), mets.map(tile)));
    once('pane-p', [id, pans], () => replace($('#panePanels'), pans.map(panel)));
    $('#paneEmpty').hidden = !!(acts.length || mets.length || pans.length);
    if (sig.paneId !== id) { sig.paneId = id; $('#paneOut').hidden = true; }
  }
  function renderFeedback(d) {
    const fb = d.feedback || {};
    $('#fbCount').textContent = d.me.role === 'admin' ? '👍 ' + (fb.up || 0) + ' · 👎 ' + (fb.down || 0) : '';
    once('fb', fb.recent, () => replace($('#fbRecent'), (fb.recent || []).map((f) => h('li', {}, (f.vote === 'up' ? '👍 ' : '👎 ') + (f.note || '(no note)') + ' ', h('small', { text: (f.byName ? f.byName + ' · ' : '') + ago(f.at) })))));
  }

  // ---------- admin views ----------
  async function loadAdmin() { admin = await api('api/admin/state'); return admin; }
  const say = (el, text, ok = true) => { el.hidden = false; el.className = 'runout ' + (ok ? 'ok' : 'bad'); el.textContent = text; };
  function renderSettings() {
    const f = $('#settingsForm'), sc = admin.settings.schema, v = admin.settings.values;
    const msg = h('div', { class: 'runout', hidden: true, role: 'status' });
    if (!sc.length) return replace(f, h('h3', { text: 'Settings' }), h('p', { class: 'empty', text: 'This solution has no settings yet. The plan lists them in dashboard.json under "settings".' }));
    const groups = [...new Set(sc.map((x) => x.group))];
    const field = (x) => {
      const id = 'set-' + x.key;
      let input;
      if (x.type === 'toggle') input = h('input', { type: 'checkbox', id, name: x.key, checked: !!v[x.key], role: 'switch' });
      else if (x.type === 'select') input = h('select', { id, name: x.key }, x.options.map((o) => h('option', { value: o, text: o, selected: String(v[x.key]) === o })));
      else if (x.type === 'textarea') input = h('textarea', { id, name: x.key, text: v[x.key] ?? '' });
      else input = h('input', { id, name: x.key, type: x.type === 'number' ? 'number' : x.type === 'secret' ? 'password' : 'text', value: v[x.key] ?? '', placeholder: x.type === 'secret' ? (v[x.key] ? 'Saved; type to replace' : 'Not set') : '', autocomplete: 'off' });
      if (x.type === 'secret') input.value = '';
      return h('div', { class: 'field' + (x.type === 'toggle' ? ' toggle' : '') }, h('label', { for: id, text: x.label }), input, x.help ? h('small', { text: x.help }) : null);
    };
    replace(f, groups.map((g) => h('fieldset', {}, groups.length > 1 ? h('legend', { text: g }) : null, sc.filter((x) => x.group === g).map(field))), h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Save settings' })), msg);
    f.onsubmit = async (e) => {
      e.preventDefault();
      const values = {};
      for (const x of sc) { const el = f.elements[x.key]; if (!el) continue; values[x.key] = x.type === 'toggle' ? el.checked : el.value; }
      try { const r = await post('api/admin/settings', { values }); say(msg, r.changed.length ? 'Saved: ' + r.changed.length + ' change' + (r.changed.length > 1 ? 's' : '') + '.' : 'No changes to save.'); await loadAdmin(); }
      catch (err) { say(msg, err.message, false); }
    };
  }
  function paneChecks(name, chosen) {
    const all = admin.panes;
    const allBox = h('input', { type: 'checkbox', name: name + '-all', checked: chosen === '*' });
    const boxes = all.map((p) => h('label', { class: 'chk' }, h('input', { type: 'checkbox', name, value: p.id, checked: chosen === '*' || (chosen || []).includes(p.id), disabled: chosen === '*' }), p.title));
    allBox.addEventListener('change', () => boxes.forEach((b) => { const i = b.querySelector('input'); i.disabled = allBox.checked; if (allBox.checked) i.checked = true; }));
    return h('div', { class: 'chks' }, h('label', { class: 'chk all' }, allBox, 'Every pane'), boxes);
  }
  const chosenPanes = (form, name) => form.elements[name + '-all'] && form.elements[name + '-all'].checked ? '*' : [...form.querySelectorAll('input[name="' + name + '"]:checked')].map((i) => i.value);
  const linkFor = (code) => location.href.split('#')[0] + '#key=' + encodeURIComponent(code);
  function codeBox(name, code) {
    const link = linkFor(code);
    const copy = h('button', { class: 'btn', type: 'button', text: 'Copy link' });
    copy.addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); copy.textContent = 'Copied'; } catch { copy.textContent = 'Select and copy the link'; } });
    return h('div', { class: 'codebox' }, h('p', {}, h('b', { text: name }), ' can sign in with this code. It is shown only now.'), h('code', { text: code }), h('input', { type: 'text', readonly: true, value: link, 'aria-label': 'Sign-in link', onfocus: (e) => e.target.select() }), copy);
  }
  function renderUsers() {
    const f = $('#addUser');
    const out = h('div', { role: 'status' });
    replace(f, h('h3', { text: 'Give someone access' }),
      h('div', { class: 'grid2' },
        h('div', { class: 'field' }, h('label', { for: 'nu-name', text: 'Name' }), h('input', { id: 'nu-name', name: 'name', required: true, placeholder: 'Client or team member' })),
        h('div', { class: 'field' }, h('label', { for: 'nu-role', text: 'Portal' }), h('select', { id: 'nu-role', name: 'role' }, h('option', { value: 'client', text: 'Client: only the panes below' }), h('option', { value: 'admin', text: 'Admin: everything, including settings' })))),
      h('div', { class: 'field' }, h('span', { class: 'lbl', text: 'Panes they can open' }), paneChecks('panes', '*')),
      h('div', { class: 'field toggle' }, h('label', { for: 'nu-run', text: 'Can use run buttons' }), h('input', { type: 'checkbox', id: 'nu-run', name: 'canRun', checked: true, role: 'switch' })),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Create access code' })), out);
    f.onsubmit = async (e) => {
      e.preventDefault();
      try { const r = await post('api/admin/users', { action: 'add', name: f.elements.name.value, role: f.elements.role.value, panes: chosenPanes(f, 'panes'), canRun: f.elements.canRun.checked }); replace(out, codeBox(r.user.name, r.code)); f.elements.name.value = ''; await loadAdmin(); renderUserList(); }
      catch (err) { replace(out, h('p', { class: 'bad', text: err.message })); }
    };
    renderUserList();
  }
  function renderUserList() {
    const paneName = (id) => (admin.panes.find((p) => p.id === id) || { title: id }).title;
    const rows = admin.users.map((u) => {
      const out = h('div', { class: 'u-out' });
      const act = (label, data, cls = '') => { const b = h('button', { class: 'linkbtn ' + cls, type: 'button', text: label }); b.addEventListener('click', async () => { if (cls === 'danger' && b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap again to remove'; return; } const r = await post('api/admin/users', { id: u.id, ...data }); await loadAdmin(); renderUserList(); if (r.code) replace($('#userList').querySelector('[data-u="' + u.id + '"] .u-out') || out, codeBox(u.name, r.code)); }); return b; };
      return h('div', { class: 'u-row' + (u.disabled ? ' off' : ''), 'data-u': u.id },
        h('div', { class: 'u-main' }, h('b', { text: u.name }), h('span', { class: 'chip' + (u.role === 'admin' ? ' ok' : ''), text: u.role === 'admin' ? 'Admin' : 'Client' }), u.disabled ? h('span', { class: 'chip bad', text: 'Disabled' }) : null),
        h('small', { text: (u.role === 'admin' ? 'Everything' : u.panes === '*' ? 'Every client pane' : (u.panes || []).map(paneName).join(', ') || 'No panes') + ' · ' + (u.canRun || u.role === 'admin' ? 'can run' : 'view only') + ' · ' + (u.lastSeen ? 'seen ' + ago(u.lastSeen) : 'not signed in yet') }),
        h('div', { class: 'u-acts' }, act('New code', { action: 'reset' }), act(u.disabled ? 'Enable' : 'Disable', { action: 'update', disabled: !u.disabled }), act(u.canRun ? 'Make view only' : 'Allow runs', { action: 'update', canRun: !u.canRun }), act('Remove', { action: 'remove' }, 'danger')), out);
    });
    const preview = h('div', { class: 'u-row' }, h('div', { class: 'u-main' }, h('b', { text: 'Preview client' }), h('span', { class: 'chip', text: 'Client' })), h('small', { text: 'The client link HQ sends you after each build, so you can check what clients see.' }),
      h('div', { class: 'u-acts' }, (() => { const b = h('button', { class: 'linkbtn', type: 'button', text: admin.previewClient ? 'Turn off' : 'Turn on' }); b.addEventListener('click', async () => { await post('api/admin/users', { action: 'preview-client', on: !admin.previewClient }); await loadAdmin(); renderUserList(); }); return b; })()));
    replace($('#userList'), rows.length ? rows : h('p', { class: 'empty', text: 'Only you so far. Create an access code above for each client.' }), preview);
    replace($('#paneVis'), admin.panes.length ? admin.panes.map((p) => { const cb = h('input', { type: 'checkbox', role: 'switch', checked: p.clientVisible, id: 'pv-' + p.id }); cb.addEventListener('change', async () => { await post('api/admin/panes', { id: p.id, clientVisible: cb.checked }); await loadAdmin(); poll(); }); return h('div', { class: 'field toggle' }, h('label', { for: 'pv-' + p.id }, h('b', { text: p.title }), p.summary ? h('small', { text: ' ' + p.summary }) : null), cb); }) : h('p', { class: 'empty', text: 'No panes in dashboard.json yet.' }));
  }
  function renderActivity() {
    replace($('#auditList'), admin.audit.length ? table(['What', 'Who', 'When'], admin.audit.slice(0, 40).map((a) => [a.what, a.who, ago(a.at)])) : h('p', { class: 'empty', text: 'No changes yet.' }));
    replace($('#runsAll'), runsTable((last && last.runs) || [], true));
    replace($('#fbAll'), admin.feedback.length ? h('ul', { class: 'fbrecent' }, admin.feedback.slice(0, 30).map((f) => h('li', {}, (f.vote === 'up' ? '👍 ' : '👎 ') + (f.note || '(no note)') + ' ', h('small', { text: (f.byName || '') + ' · ' + ago(f.at) })))) : h('p', { class: 'empty', text: 'No feedback yet.' }));
  }
  function renderControl() {
    const f = $('#maintForm'), m = admin.maintenance;
    const msg = h('div', { class: 'runout', hidden: true, role: 'status' });
    replace(f, h('h3', { text: 'Client access' }), h('p', { class: 'hint', text: m.on ? 'Clients see a maintenance message and can’t use the dashboard. Admins can.' : 'Clients can use their panes now.' }),
      h('div', { class: 'field toggle' }, h('label', { for: 'mt-on', text: 'Pause client access' }), h('input', { type: 'checkbox', id: 'mt-on', name: 'on', checked: !!m.on, role: 'switch' })),
      h('div', { class: 'field' }, h('label', { for: 'mt-msg', text: 'Message clients see' }), h('input', { id: 'mt-msg', name: 'message', value: m.message || '', placeholder: 'Back shortly: we’re updating your dashboard.' })),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', type: 'submit', text: 'Save' })), msg);
    f.onsubmit = async (e) => { e.preventDefault(); try { await post('api/admin/maintenance', { on: f.elements.on.checked, message: f.elements.message.value }); await loadAdmin(); renderControl(); say($('#maintForm').querySelector('.runout'), 'Saved.'); } catch (err) { say(msg, err.message, false); } };
    replace($('#allActions'), actionButtons(admin.actions, $('#ctlOut'), true));
  }

  async function renderRoute() {
    if (!last) return;
    markNav();
    const r = route();
    const d = last;
    if (r.startsWith('pane/')) return renderPane(d, decodeURIComponent(r.slice(5)));
    if (r === 'reports') { show('reports', 'Reports'); return replace($('#reports'), reportList(d.reports)); }
    if (r === 'feedback') { show('feedback', 'Feedback', 'Tell us what works and what should change.'); return renderFeedback(d); }
    if (r.startsWith('admin/') && d.me.role === 'admin') {
      const v = r.slice(6);
      const titles = { settings: ['Settings', 'How the solution is configured.'], users: ['Users & access', 'Who can sign in and what each person sees.'], activity: ['Activity', 'Every change, run and piece of feedback.'], control: ['Control', 'Pause client access or run any action.'] };
      if (!titles[v]) return;
      show(v, ...titles[v]);
      try { await loadAdmin(); } catch { return; }
      return ({ settings: renderSettings, users: renderUsers, activity: renderActivity, control: renderControl })[v]();
    }
    show('overview', 'Overview', d.app.tagline || '');
    renderOverview(d);
  }
  window.addEventListener('hashchange', () => { setMenu(false); renderRoute(); });

  let vote = null;
  document.querySelectorAll('.vote').forEach((b) => b.addEventListener('click', () => { vote = b.dataset.vote; document.querySelectorAll('.vote').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false')); }));
  $('#fb').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!vote) { $('#fbCount').textContent = 'Pick 👍 or 👎 first'; return; }
    try { await post('api/feedback', { vote, note: $('#fbNote').value, about: route() }); } catch { return; }
    $('#fbNote').value = ''; vote = null; document.querySelectorAll('.vote').forEach((x) => x.setAttribute('aria-pressed', 'false'));
    $('#fbCount').textContent = 'Thanks, sent.';
    poll();
  });

  async function poll(first = false) {
    if (!KEY) return showGate();
    try {
      const d = await api('api/summary');
      last = d;
      $('#gate').hidden = true; $('#shell').hidden = false;
      $('#live').classList.remove('off'); $('#live').textContent = 'Live';
      $('#appName').textContent = d.app.name; $('#tagline').textContent = d.app.tagline || ''; $('#gateName').textContent = d.app.name;
      once('nav', [d.panes, d.me], () => renderNav(d));
      showNotice(d.maintenance && d.maintenance.on ? 'Client access is paused' + (d.maintenance.message ? ': ' + d.maintenance.message : '.') : '', 'warn');
      replace($('#foot'), d.app.mock ? [h('b', { text: 'Sample data' }), ': this is the planned layout; the build fills in real numbers.'] : 'Updated ' + new Date(d.at).toLocaleTimeString());
      const r = route();
      if (first || !r.startsWith('admin/')) renderRoute();
    } catch (e) { if (e.message !== 'signed out' && e.message !== 'maintenance') { $('#live').classList.add('off'); $('#live').textContent = 'Offline'; } }
  }
  if (!KEY) showGate(); else poll(true);
  setInterval(() => { if (!document.hidden && KEY && $('#gate').hidden) poll(); }, 5000);
})();
