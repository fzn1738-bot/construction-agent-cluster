// Sample data built from dashboard.json, so the dashboard renders before the real logic exists
// (HQ uses it for the plan mockup). hooks.mjs replaces this with the solution's real data.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SPEC = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'dashboard.json'), 'utf8'));
let seed = [...String(SPEC.title || 'x')].reduce((a, c) => a + c.charCodeAt(0), 7);
const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed % 1000) / 1000; };
const series = (n, base, wiggle) => Array.from({ length: n }, (_, i) => Math.max(0, Math.round((base + (rnd() - 0.4) * wiggle + i * wiggle * 0.08) * 10) / 10));

export const actions = (SPEC.actions || [{ id: 'run', label: 'Run now' }]).map((a, i) => ({ id: a.id || 'action' + i, label: a.label || 'Run', description: a.description || '', input: a.input || null }));

export async function status() {
  const o = SPEC.orb || {};
  const ring = (SPEC.ring || []).slice(0, 3);
  return {
    mood: 'ok', headline: o.headline || 'Healthy', detail: o.detail || 'Sample data until the build lands',
    primary: { label: o.metric || 'Success rate', value: o.value || '98%' },
    ring: ring.map((r) => ({ label: r.label, value: r.sample || r.value || String(Math.round(rnd() * 90 + 10)) }))
  };
}

export async function metrics() {
  return (SPEC.metrics || []).slice(0, 8).map((m) => {
    const [base, wig] = m.unit === '%' ? [82 + rnd() * 10, 6] : /^(d|days?)$/.test(m.unit || '') ? [8 + rnd() * 20, 4] : m.unit === 's' ? [1 + rnd() * 3, 0.8] : m.unit === 'ms' ? [120 + rnd() * 200, 60] : m.unit === '$' ? [20 + rnd() * 200, 30] : [10 + rnd() * 90, 14];
    const t = series(14, base, wig).map((v) => (m.unit === '%' ? Math.min(v, 100) : v));
    return { key: m.key || m.label, label: m.label, value: m.sample ?? t[t.length - 1], unit: m.unit || '', trend: t, good: m.good || 'up' };
  });
}

export async function panels() {
  return (SPEC.panels || []).slice(0, 6).map((p) => {
    const kind = ['line', 'bar', 'table', 'list'].includes(p.kind) ? p.kind : 'table';
    if (kind === 'line' || kind === 'bar') {
      const labels = Array.from({ length: kind === 'bar' ? 6 : 12 }, (_, i) => (p.labels && p.labels[i]) || (kind === 'bar' ? 'Item ' + (i + 1) : 'D' + (i + 1)));
      return { title: p.title, kind, labels, series: [{ name: (p.fields && p.fields[0]) || p.title, values: series(labels.length, 30 + rnd() * 50, 25) }] };
    }
    const cols = (p.fields && p.fields.length ? p.fields : ['Name', 'Status', 'Updated']).slice(0, 5);
    const rows = Array.from({ length: 5 }, (_, r) => cols.map((c, i) => (i === 0 ? c + ' ' + (r + 1) : /status|state/i.test(c) ? ['OK', 'Running', 'OK', 'Queued', 'OK'][r] : /time|date|updated|at$/i.test(c) ? (r + 1) * 7 + ' min ago' : String(Math.round(rnd() * 900) / 10))));
    return { title: p.title, kind, columns: cols, rows };
  });
}

export async function run(id) {
  await new Promise((r) => setTimeout(r, 120));
  return { ok: true, message: 'Sample run of "' + id + '" finished' };
}

export async function reports() {
  return (SPEC.reports || ['Daily summary', 'Weekly performance']).slice(0, 4).map((t, i) => ({ title: typeof t === 'string' ? t : t.title, href: '', createdAt: new Date(Date.now() - i * 864e5).toISOString() }));
}
