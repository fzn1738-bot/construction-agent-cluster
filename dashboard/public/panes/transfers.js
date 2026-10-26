// Contractor file transfers (focus): a full-width flow band (site ⇄ contractor FTP, with counts each way and the
// sync control), then what failed beside the 24-hour trend, then the full-width transfer timeline.
import { screen, chip, demoBanner, bigNumber, message, actionButton, chips, trend, bytes, TONE } from './common.js';

const GLYPH = { download: '↓', upload: '↑' };
const DIRS = [['download', 'Download'], ['upload', 'Upload'], ['both', 'Both ways']];
const PAGE = 12;

function flow(api, all) {
  const { h, d } = api;
  const ok = all.filter((t) => t.status === 'ok');
  const side = (op) => { const list = ok.filter((t) => t.op === op); return { n: list.length, size: list.reduce((s, t) => s + (Number(t.bytes) || 0), 0) }; };
  const down = side('download'), up = side('upload');
  const on = (op) => d.direction === 'both' || d.direction === op;
  const lane = (op, v, label) => h('div', { class: 'cg-lane' + (on(op) ? '' : ' is-off') },
    h('span', { class: 'cg-lane-arrow', 'aria-hidden': 'true', text: op === 'download' ? '←' : '→' }),
    h('span', {}, h('b', { text: String(v.n) }), ' ' + label + (v.size ? ' · ' + bytes(v.size) : '')),
    on(op) ? null : h('small', { text: 'off' }));
  return h('div', { class: 'cg-flow', role: 'img', 'aria-label': down.n + ' files downloaded from the contractor, ' + up.n + ' uploaded to them' },
    h('div', { class: 'cg-end' }, h('small', { text: 'Site' }), h('b', { class: 'cg-mono', text: 'Local mirror' })),
    h('div', { class: 'cg-lanes' }, lane('download', down, 'downloaded'), lane('upload', up, 'uploaded')),
    h('div', { class: 'cg-end' }, h('small', { text: 'Contractor FTP' }), h('b', { class: 'cg-mono', text: (d.host || 'Not set') + (d.remoteDir || '') })));
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const all = d.transfers || [];
  const sum = d.summary || {};
  const failed = all.filter((t) => t.status === 'failed');
  const shown = all.filter((t) => !ui.only || t.status === ui.only);
  const limit = ui.limit || PAGE;
  const mon = (d.monitors || [])[0];

  const top = h('section', { class: 'cg-card cg-top', 'aria-label': 'Sync' },
    h('div', { class: 'cg-top-main' },
      bigNumber(h, sum.transferred ?? 0, sum.transferred === 1 ? 'file transferred' : 'files transferred', sum.last ? 'Last sync ' + ctx.ago(sum.last) : 'Updated just now'),
      h('div', { class: 'cg-top-chips' }, chip(h, (sum.failed || 0) + ' failed', sum.failed ? 'bad' : 'ok'), sum.skipped ? chip(h, sum.skipped + ' skipped', 'warn') : null, mon ? chip(h, mon.name + ' ' + mon.state, mon.tone || '') : null)),
    flow(api, all),
    h('div', { class: 'cg-top-side' },
      h('div', { class: 'cg-actions' }, actionButton(api, 'Sync FTP now', 'sync', null, { primary: true, busy: 'Syncing…' })),
      ctx.me.role === 'admin'
        ? h('div', { class: 'cg-dir' }, h('small', { id: 'cg-dir-label', text: 'Direction' }), h('div', { class: 'cg-seg', role: 'group', 'aria-labelledby': 'cg-dir-label' }, DIRS.map(([k, label]) => h('button', { type: 'button', class: 'cg-pill', 'aria-pressed': d.direction === k ? 'true' : 'false', disabled: !!ui.busy, onclick: () => api.act('set-direction', { direction: k }) }, label))))
        : h('p', { class: 'cg-note', text: 'Direction: ' + (DIRS.find(([k]) => k === d.direction) || [0, d.direction || 'not set'])[1] }),
      message(h, ui)));

  const attention = failed.length ? h('section', { class: 'cg-card cg-alert', 'aria-label': 'Needs attention' },
    h('div', { class: 'cg-head' }, h('h3', { text: failed.length === 1 ? '1 transfer failed' : failed.length + ' transfers failed' }), chip(h, 'Needs attention', 'bad')),
    h('ul', { class: 'cg-plain' }, failed.slice(0, 3).map((t) => h('li', { class: 'cg-fail' }, h('b', { class: 'cg-mono', text: t.file }), h('span', { text: (t.error || 'Failed') + ' · ' + (t.op || '') + ' · ' + ctx.ago(t.at) })))),
    h('p', { class: 'cg-note', text: 'A sync retries every failed file.' })) : null;

  const chart = h('section', { class: 'cg-card' }, h('h3', { text: 'Transfers, last 24 hours' }), trend(ctx, 'Transfers, last 24 hours', 'transfers', d.hours));

  const count = (s) => all.filter((t) => t.status === s).length;
  const timeline = h('section', { class: 'cg-card', 'aria-label': 'Transfer history' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Transfer history' })),
    all.length ? chips(h, [{ key: '', label: 'All', n: all.length }, { key: 'ok', label: 'OK', n: count('ok') }, { key: 'failed', label: 'Failed', n: failed.length }, { key: 'skipped', label: 'Skipped', n: count('skipped') }], ui.only || '', (k) => { ui.only = k; ui.limit = PAGE; api.repaint(); }, 'Filter transfers') : null,
    shown.length ? h('ol', { class: 'cg-timeline' }, shown.slice(0, limit).map((t) => h('li', { class: 'cg-tl ' + (TONE[t.status] || '') },
      h('span', { class: 'cg-tl-dot', 'aria-hidden': 'true', text: t.status === 'failed' ? '✕' : t.status === 'skipped' ? '!' : GLYPH[t.op] || '•' }),
      h('div', { class: 'cg-tl-main' }, h('b', { text: t.file, title: t.file }), h('small', { text: [t.op, bytes(t.bytes), t.reason].filter(Boolean).join(' · ') }), t.error ? h('small', { class: 'cg-err', text: t.error }) : null),
      h('div', { class: 'cg-file-end' }, chip(h, t.status === 'ok' ? 'OK' : t.status, TONE[t.status] || ''), h('small', { text: ctx.ago(t.at) })))))
      : h('p', { class: 'cg-note', text: all.length ? 'Nothing matches that filter.' : 'No transfers yet. Press Sync FTP now to mirror files.' }),
    shown.length > limit ? h('div', { class: 'cg-actions' }, h('button', { class: 'linkbtn', type: 'button', text: 'Show ' + Math.min(PAGE, shown.length - limit) + ' more', onclick: () => { ui.limit = limit + PAGE; api.repaint(); } })) : null);

  return h('div', { class: 'cg-pane cg-focus' }, demoBanner(ctx, d), top, h('div', { class: 'cg-pair' + (attention ? '' : ' is-single') }, attention, chart), timeline);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
