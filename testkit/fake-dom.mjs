// A minimal DOM, just enough to render the dashboard's pane screens and the Overview centrepiece under node --test:
// elements with attributes, children, text and listeners, a canvas whose 2D context accepts every drawing call,
// and the window/document globals the modules read. It also provides a ctx like the kit's app.js builds.
class El {
  constructor(tag) { this.tagName = String(tag).toUpperCase(); this.attrs = {}; this.children = []; this.listeners = {}; this.dataset = {}; this.parent = null; this.value = ''; this._text = null; this.isConnected = true; }
  append(...kids) { for (const k of kids.flat()) { if (k == null || k === false) continue; const n = k instanceof El ? k : text(String(k)); n.parent = this; this.children.push(n); } }
  replaceChildren(...kids) { this.children = []; this._text = null; this.append(...kids); }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'value') this.value = String(v); if (k === 'type') this.type = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
  removeEventListener() {}
  contains(n) { for (let x = n; x; x = x.parent) if (x === this) return true; return false; }
  get classList() { const el = this; return { add: (...c) => { el.attrs.class = [el.attrs.class, ...c].filter(Boolean).join(' '); }, contains: (c) => String(el.attrs.class || '').split(/\s+/).includes(c) }; }
  get textContent() { return this._text != null ? this._text : this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this.children = []; this._text = String(v); }
  get clientWidth() { return 800; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 400 }; }
  getContext() { return ctx2d(); }
  click() { for (const fn of this.listeners.click || []) fn({ preventDefault() {}, target: this }); }
  /** every element below this one (depth first) */
  all() { const out = []; const walk = (n) => { for (const c of n.children) { if (c instanceof El) { out.push(c); walk(c); } } }; walk(this); return out; }
}
const text = (s) => { const t = new El('#text'); t._text = s; return t; };
function ctx2d() {
  const grad = { addColorStop() {} };
  return new Proxy({}, { get: (_, k) => (k === 'createRadialGradient' || k === 'createLinearGradient' ? () => grad : k === 'measureText' ? () => ({ width: 10 }) : () => {}), set: () => true });
}

export function install() {
  globalThis.document = { createElement: (t) => new El(t), createElementNS: (_, t) => new El(t), activeElement: null, documentElement: { dataset: {} }, addEventListener() {}, hidden: false };
  globalThis.window = { matchMedia: () => ({ matches: true, addEventListener() {} }), devicePixelRatio: 1 };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '' });
  globalThis.requestAnimationFrame = () => 0;
  globalThis.location = { hash: '' };
}

export function h(tag, attrs = {}, ...kids) {
  const el = new El(tag);
  for (const [k, v] of Object.entries(attrs)) { if (v == null || v === false) continue; if (k === 'text') el.textContent = v; else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : String(v)); }
  el.append(...kids);
  return el;
}

/** A pane ctx like app.js's paneCtx(), wired straight to a hooks module (hooks.mjs or demo.mjs). */
export function paneCtx(mod, id, user = { id: 'owner', name: 'Owner', role: 'admin' }, { canRun = true } = {}) {
  const log = [];
  const chart = (p) => h('svg', { 'data-title': p.title });
  return {
    h, s: (t) => new El(t), fmt: (v) => String(v), ago: () => 'just now', table: (c, r) => h('table', {}, String(c.length * r.length)), panel: chart, tile: chart, chart, spark: chart,
    pane: { id }, me: { name: user.name, role: user.role, canRun: user.role === 'admin' || canRun }, demo: false, metrics: [], panels: [], actions: [], log,
    load: async () => mod.pane(id, { user }),
    act: async (action, input) => { const r = await mod.paneAction(id, action, input ?? null, { user }); log.push([action, r]); return r; },
    run: async (action, input) => mod.run(action, input, { user }), refresh: () => {}
  };
}
export const root = () => new El('div');
export const settle = () => new Promise((r) => setTimeout(r, 20));
