// Contractor file transfers: a headline number and sync control on top, then a timeline of every transfer.
import { screen, chip, demoChip, demoBanner, bigNumber, message, actionButton, chips, line, bytes, TONE } from './common.js';

const GLYPH = { download: '↓', upload: '↑' };
const DIRS = [['download', 'Download'], ['upload', 'Upload'], ['both', 'Both ways']];

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const all = d.transfers || [];
  const failed = all.filter((t) => t.status === 'failed');
  const shown = all.filter((t) => !ui.only || t.status === ui.only);

  const top = h('section', { class: 'cg-card cg-top' },
    h('div', { class: 'cg-top-main' },
      bigNumber(h, d.summary.transferred, d.summary.transferred === 1 ? 'file transferred' : 'files transferred', d.summary.last ? 'Last sync ' + ctx.ago(d.summary.last) : 'Updated just now'),
      h('div', { class: 'cg-top-chips' }, demoChip(h, d), chip(h, d.summary.failed + ' failed', d.summary.failed ? 'bad' : 'ok'), d.summary.skipped ? chip(h, d.summary.skipped + ' skipped', 'warn') : null)),
    h('div', { class: 'cg-top-side' },
      h('p', { class: 'cg-mono', text: (d.host || 'FTP') + ' ' + d.remoteDir }),
      h('div', { class: 'cg-actions' }, actionButton(api, 'Sync FTP now', 'sync', null, { primary: true, busy: 'Syncing…' })),
      ctx.me.role === 'admin'
        ? h('div', { class: 'cg-seg', role: 'group', 'aria-label': 'Sync direction' }, DIRS.map(([k, label]) => h('button', { type: 'button', class: 'cg-pill', 'aria-pressed': d.direction === k ? 'true' : 'false', disabled: !!ui.busy, onclick: () => api.act('set-direction', { direction: k }) }, label)))
        : h('p', { class: 'cg-note', text: 'Direction: ' + (DIRS.find(([k]) => k === d.direction) || [0, d.direction])[1] }),
      message(h, ui)));

  const attention = failed.length ? h('section', { class: 'cg-card cg-alert', 'aria-label': 'Needs attention' },
    h('h3', { text: 'Needs attention' }),
    h('ul', { class: 'cg-plain' }, failed.slice(0, 3).map((t) => h('li', {}, h('b', { text: t.file }), h('span', { text: ' ' + (t.error || 'failed') + ' · ' + ctx.ago(t.at) }))))) : null;

  const timeline = h('section', { class: 'cg-card', 'aria-label': 'Transfer history' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Transfer history' }),
      chips(h, [{ key: '', label: 'All', n: all.length }, { key: 'ok', label: 'OK', n: all.filter((t) => t.status === 'ok').length }, { key: 'failed', label: 'Failed', n: failed.length }, { key: 'skipped', label: 'Skipped', n: all.filter((t) => t.status === 'skipped').length }], ui.only || '', (k) => { ui.only = k; api.repaint(); }, 'Filter transfers')),
    shown.length ? h('ol', { class: 'cg-timeline' }, shown.map((t) => h('li', { class: 'cg-tl ' + (TONE[t.status] || '') },
      h('span', { class: 'cg-tl-dot', 'aria-hidden': 'true', text: t.status === 'failed' ? '✕' : t.status === 'skipped' ? '!' : GLYPH[t.op] || '•' }),
      h('div', { class: 'cg-tl-main' }, h('b', { text: t.file }), h('small', { text: [t.op, bytes(t.bytes), t.reason, t.error].filter(Boolean).join(' · ') })),
      h('small', { class: 'cg-tl-when', text: ctx.ago(t.at) }))))
      : h('p', { class: 'cg-note', text: all.length ? 'Nothing matches that filter.' : 'No transfers yet. Press Sync FTP now to mirror files.' }));

  const trend = h('section', { class: 'cg-card' }, h('h3', { text: 'Transfers, last 24 hours' }), line(ctx, 'Transfers, last 24 hours', 'Transfers', d.hours));
  return h('div', { class: 'cg-pane cg-focus' }, demoBanner(ctx, d), top, attention, trend, timeline);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
