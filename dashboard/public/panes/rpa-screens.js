// Step screenshots (grid): choose a workflow, a recording or a run, then every step's screenshot as a contact sheet,
// in order. For a run each frame shows the replayed screen beside the recorded one, so a changed layout is plain to
// see. A coverage bar says how many steps have a real capture, how many were withheld on purpose and how many have
// none (each says why). A screenshot that shows something private can be removed; the step stays.
import { screen, chip, demoBanner, message, chips } from './common.js';
import { select, stateWord, zoomCard, kindChip, STATE_WORD } from './rpa-common.js';

const KINDS = [['workflow', 'Workflows'], ['recording', 'Recordings'], ['run', 'Runs']];

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const busy = !!ui.busy, can = !!ctx.me.canRun;
  const src = d.selection;
  const kind = ui.kind || (src ? src.kind : 'workflow');
  const list = kind === 'workflow' ? d.sources.workflows.map((w) => [w.id, w.name + (d.isAdmin ? ' · ' + w.clientName : '')])
    : kind === 'recording' ? d.sources.recordings.map((r) => [r.id, r.name + ' · ' + r.steps + ' steps'])
      : d.sources.runs.map((r) => [r.id, r.name + ' · ' + r.word + ' · ' + new Date(r.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })]);
  const which = list.length ? select(h, 'source', list, src && src.kind === kind ? src.id : '') : null;
  if (which) which.addEventListener('change', () => api.act('pick', { kind, id: which.value }, { quiet: true }));

  const cov = d.coverage;
  // widths come from classes in 5% steps (the strict CSP allows no inline styles)
  const pct = (n) => (cov.total ? Math.round((n / cov.total) * 20) * 5 : 0);
  const meter = h('div', { class: 'rpa-cover', role: 'img', 'aria-label': cov.captured + ' captured, ' + cov.withheld + ' withheld, ' + cov.missing + ' without a screenshot' },
    h('i', { class: 'rpa-cover-ok rpa-w' + pct(cov.captured) }), h('i', { class: 'rpa-cover-held rpa-w' + pct(cov.withheld) }), h('i', { class: 'rpa-cover-none rpa-w' + pct(cov.missing) }));
  const head = h('section', { class: 'cg-card rpa-sheethead', 'aria-label': 'Choose screenshots' },
    h('div', { class: 'cg-head' }, h('h3', { text: src ? src.name : 'Screenshots' }), chip(h, cov.pct + '% captured', cov.missing ? 'warn' : 'ok')),
    h('p', { class: 'cg-note', text: 'Step · Screenshot · Recorded · Note' }),
    chips(h, KINDS.map(([k, l]) => ({ key: k, label: l, n: k === 'workflow' ? d.sources.workflows.length : k === 'recording' ? d.sources.recordings.length : d.sources.runs.length })), kind, (k) => { ui.kind = k; const first = k === 'workflow' ? d.sources.workflows[0] : k === 'recording' ? d.sources.recordings[0] : d.sources.runs[0]; if (first) api.act('pick', { kind: k, id: first.id }, { quiet: true }); else api.repaint(); }, 'Screenshots of'),
    which ? h('label', { class: 'rpa-field' }, h('span', { text: KINDS.find(([k]) => k === kind)[1].replace(/s$/, '') }), which) : h('p', { class: 'cg-note', text: 'None yet.' }),
    cov.total ? meter : null,
    cov.total ? h('div', { class: 'cg-top-chips' }, chip(h, cov.captured + ' captured', 'ok'), chip(h, cov.withheld + ' withheld', cov.withheld ? 'warn' : ''), chip(h, cov.missing + ' without a screenshot', cov.missing ? 'bad' : '')) : null,
    message(h, ui));

  const open = (src2, title) => { ui.zoom = { src: src2, title }; api.repaint(); };
  const frame = (f) => {
    const title = (f.idx + 1) + '. ' + f.name;
    const img = (s, alt, label) => (s ? h('button', { class: 'rpa-frame-img', type: 'button', 'aria-label': 'Enlarge: ' + alt, onclick: () => open(s, alt) }, h('img', { class: 'rpa-shot-frame', src: s, alt, loading: 'lazy' }), label ? h('small', { text: label }) : null)
      : h('span', { class: 'rpa-frame-none', text: label ? label + ': none' : (/withheld|removed/i.test(f.note) ? 'Withheld' : 'No capture') }));
    return h('li', { class: 'cg-card rpa-frame' + (f.state === 'failed' ? ' is-failed' : '') },
      h('div', { class: 'rpa-frame-head' }, h('b', { text: title }), kindChip(h, f.kind)),
      src && src.kind === 'run' ? h('div', { class: 'rpa-frame-pair' }, img(f.shot, title + ' (replay)', 'Replay'), img(f.recorded, title + ' (recorded)', 'Recorded')) : img(f.shot, title),
      f.state ? stateWord(h, f.state, STATE_WORD[f.state]) : null,
      f.note ? h('small', { class: 'rpa-shotwhy', text: f.note }) : null,
      f.shot && src && src.kind !== 'run' && can ? h('button', { class: 'linkbtn danger', type: 'button', disabled: busy, 'aria-label': 'Remove the screenshot of step ' + (f.idx + 1), text: 'Remove screenshot', onclick: () => api.act('drop-shot', { source: src.kind + ':' + src.id, step: f.stepId }) }) : null);
  };
  const sheet = d.frames.length ? h('ol', { class: 'rpa-sheet', 'aria-label': 'Screenshots, step by step' }, d.frames.map(frame))
    : h('section', { class: 'cg-card' }, h('p', { class: 'cg-note', text: src ? 'This has no steps yet.' : 'No recordings, workflows or runs yet. Record a task to see its screenshots here.' }));

  return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d), zoomCard(h, ui.zoom, () => { ui.zoom = null; api.repaint(); }), head, sheet);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
