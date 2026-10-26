import { records } from './common.js';

// Shared pieces of the four Workflow Automation screens: form fields, step state words, screenshot thumbnails and the
// fast refresh that keeps a live run moving between the kit's 5-second updates.

export const STATE_WORD = { pending: 'Waiting', running: 'Running', waiting: 'Needs approval', passed: 'Passed', failed: 'Failed', stopped: 'Stopped', skipped: 'Skipped', rejected: 'Rejected', queued: 'Queued' };
const TONE = { passed: 'ok', failed: 'bad', rejected: 'bad', waiting: 'warn', stopped: 'warn', running: 'run', skipped: 'idle', pending: 'idle', queued: 'idle' };
const GLYPH = { passed: '✓', failed: '✕', rejected: '✕', waiting: '!', stopped: '■', running: '●', skipped: '–', pending: '–', queued: '–' };

/** State word with a glyph, so colour is never alone. */
export function stateWord(h, state, text) {
  return h('span', { class: 'cg-state rpa-st-' + state + ' ' + (TONE[state] || 'idle') }, h('i', { 'aria-hidden': 'true', text: GLYPH[state] || '–' }), h('span', { text: text || STATE_WORD[state] || state }));
}

export const dur = (ms) => (!ms ? '–' : ms < 1000 ? ms + ' ms' : ms < 60000 ? Math.round(ms / 100) / 10 + ' s' : Math.floor(ms / 60000) + ' min ' + Math.round((ms % 60000) / 1000) + ' s');
export const when = (iso) => { const d = new Date(iso); return isNaN(d) ? '–' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

/** A labelled form control. */
export function field(h, label, control, hint) {
  return h('label', { class: 'rpa-field' }, h('span', { text: label }), control, hint ? h('small', { text: hint }) : null);
}
export const text = (h, name, placeholder, value = '', extra = {}) => h('input', { type: 'text', name, placeholder, value, autocomplete: 'off', 'aria-label': placeholder || name, ...extra });
export const select = (h, name, options, value) => h('select', { name, 'aria-label': name }, options.map(([v, l]) => h('option', { value: v, selected: v === value ? true : null, text: l })));
export function check(h, name, label, on = false) {
  return h('label', { class: 'rpa-check' }, h('input', { type: 'checkbox', name, checked: on ? true : null }), h('span', { text: label }));
}

/** A screenshot thumbnail; pressing it asks the screen to show it large. */
export function thumb(h, src, alt, onOpen, note) {
  // no picture is said plainly: withheld on purpose (a secret, a private screen) or simply not captured
  if (!src) return h('span', { class: 'rpa-noshot', title: note || '', text: /withheld|removed/i.test(note || '') ? 'Withheld' : 'No capture' });
  const img = h('img', { class: 'rpa-shot', src, alt, loading: 'lazy', width: '96', height: '60' });
  return onOpen ? h('button', { class: 'rpa-thumb', type: 'button', 'aria-label': 'Enlarge screenshot: ' + alt, onclick: onOpen }, img) : img;
}
/** The enlarged screenshot card with a close button. */
export function zoomCard(h, zoom, close) {
  if (!zoom || !zoom.src) return null;
  return h('section', { class: 'cg-card rpa-zoom', 'aria-label': 'Screenshot' },
    h('div', { class: 'cg-head' }, h('h3', { text: zoom.title || 'Screenshot' }), h('button', { class: 'linkbtn', type: 'button', text: 'Close', onclick: close })),
    h('img', { class: 'rpa-shot-big', src: zoom.src, alt: zoom.title || 'Screenshot' }));
}

export const KIND_WORD = { click: 'Click', type: 'Type', select: 'Choose', key: 'Key', navigate: 'Page', app: 'App' };
export const kindChip = (h, kind) => h('span', { class: 'cg-chip', text: KIND_WORD[kind] || kind });

/** Keep a live screen moving: re-ask for its data every 1.5 s while `isLive(data)`, until it is gone or the run ends. */
export function keepFresh(root, ctx, update, isLive) {
  let stopped = false;
  const tick = async () => {
    if (stopped || root.isConnected === false) return;
    let d = null;
    try { d = await ctx.load(); } catch { d = null; }
    if (!d || !isLive(d)) return;
    try { await update(root, ctx); } catch { /* the next tick tries again */ }
    const t = setTimeout(tick, 1500); if (t.unref) t.unref();
  };
  const t = setTimeout(tick, 1500); if (t.unref) t.unref();
  return () => { stopped = true; };
}

/** A run's steps as a table: name, state word, time, screenshot (pressing it opens it large). */
export function runSteps(api, run, columns = ['Step', 'State', 'Time', 'Screenshot']) {
  const { h, ui } = api;
  const rows = run.steps.map((s, i) => [s, s, s.ms, s]);
  return records(h, columns, rows, {
    empty: 'This run has no steps.',
    cell: (v, j) => {
      if (j === 0) return h('span', { class: 'rpa-runstep' + (v.state === 'running' || v.state === 'waiting' ? ' is-now' : '') }, h('b', { text: (v.idx + 1) + '. ' + v.name }), h('small', { text: v.message || [v.kind, v.target].filter(Boolean).join(' · ') }), v.attempts > 1 ? h('small', { text: v.attempts + ' attempts' }) : null);
      if (j === 1) return h('span', { class: 'rpa-stcell' }, stateWord(h, v.state), v.approval ? h('small', { text: 'Approval checkpoint' }) : null);
      if (j === 2) return dur(v);
      return thumb(h, v.shot, v.name + ': ' + (STATE_WORD[v.state] || v.state), () => { ui.zoom = { src: v.shot, title: (v.idx + 1) + '. ' + v.name + ' (' + (STATE_WORD[v.state] || v.state) + ')' }; api.repaint(); });
    }
  });
}
/**
 * The workflow a screen works on. The choice is shared by Typed inputs, Apps & pages, Workflows, Step editor, Order &
 * checkpoints and Variables, so moving between them keeps the same workflow open.
 */
export function wfPicker(api, d, hint) {
  const { h } = api;
  if (!d.workflows || !d.workflows.length) return null;
  const sel = select(h, 'workflow', d.workflows.map((w) => [w.id, w.name + (d.isAdmin ? ' · ' + w.clientName : '')]), d.selected ? d.selected.id : '');
  sel.addEventListener('change', () => api.act('select', { id: sel.value }, { quiet: true }));
  return h('div', { class: 'rpa-picker' }, field(h, 'Workflow', sel, hint));
}
/** A link to another workflow screen. */
export const paneLink = (h, id, label) => h('a', { class: 'linkbtn', href: '#/pane/' + id, text: label });
/** What a workflow screen shows before there is any workflow. */
export function noWorkflows(h, what) {
  return h('section', { class: 'cg-card rpa-empty', 'aria-label': 'No workflows yet' },
    h('h3', { text: 'No workflows yet' }),
    h('p', { class: 'cg-note', text: 'Record a task once and save it as a workflow; ' + what + ' appear here.' }),
    h('div', { class: 'cg-actions' }, paneLink(h, 'rpa-record', 'Record a workflow'), paneLink(h, 'rpa-workflows', 'Open Workflows')));
}
/** Where a step happens: the app, then the page. */
export const whereOf = (s) => [s.app, s.page].filter(Boolean).join(' · ');

/** The run log, newest last, one line each. */
export function logList(h, log) {
  if (!log || !log.length) return h('p', { class: 'cg-note', text: 'Nothing logged yet.' });
  return h('ol', { class: 'rpa-log', 'aria-label': 'Run log' }, log.map((l) => h('li', { class: 'rpa-log-' + l.level }, h('time', { text: new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }), h('b', { text: l.level }), h('span', { text: l.text }))));
}
