// Apps & pages (focus): a full-width route band for the chosen workflow (start, each app switch and each page change
// as a stop on a line, with how its last replay went), then "where the screen had changed" (replays that could not
// find what they were told to touch, or landed on the wrong page), then each stop in detail with its steps and a
// folded editor to correct the page address or app name when a site moves.
import { screen, chip, demoBanner, message } from './common.js';
import { wfPicker, noWorkflows, stateWord, when, text, field, kindChip, paneLink } from './rpa-common.js';

const CODE_WORD = { 'target-missing': 'Could not find it on the screen', 'wrong-page': 'Landed on a different page', 'not-pressable': 'Found it but could not press it', 'app-missing': 'The app was not there' };
const stopTitle = (st) => (st.kind === 'page' ? 'Page' : st.kind === 'app' ? 'App' : 'Start');

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  if (!d.selected) return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d), noWorkflows(h, 'the apps and pages each workflow goes through'));
  const busy = !!ui.busy, can = !!ctx.me.canRun;
  const wf = d.selected.id;
  const lr = d.lastRun;

  // ---------- the route band ----------
  const stopState = (st) => {
    const states = [st.replay, ...st.steps.map((s) => s.replay)].filter(Boolean).map((r) => r.state);
    return states.includes('failed') ? 'failed' : states.length && states.every((x) => x === 'passed') ? 'passed' : states.length ? states[states.length - 1] : 'pending';
  };
  const route = h('ol', { class: 'rpa-route', 'aria-label': 'Route of ' + d.selected.name },
    d.stages.map((st, i) => h('li', { class: 'rpa-stop rpa-stop-' + st.kind + ' is-' + stopState(st) },
      h('span', { class: 'rpa-stop-dot', 'aria-hidden': 'true' }),
      h('small', { text: stopTitle(st) + ' ' + (i + 1) }),
      h('b', { class: st.kind === 'page' ? 'cg-mono' : '', text: st.title || '–' }),
      h('small', { text: st.steps.length + (st.steps.length === 1 ? ' step here' : ' steps here') }),
      lr ? stateWord(h, stopState(st) === 'pending' ? 'skipped' : stopState(st), stopState(st) === 'pending' ? 'Not reached' : undefined) : null)));
  const band = h('section', { class: 'cg-card rpa-routeband', 'aria-label': 'Route' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Route through apps and pages' }),
      h('div', { class: 'cg-top-chips' }, chip(h, d.summary.apps.length + (d.summary.apps.length === 1 ? ' app' : ' apps'), ''), chip(h, d.summary.pages + (d.summary.pages === 1 ? ' page' : ' pages'), ''), lr ? chip(h, 'Last replay ' + lr.word.toLowerCase() + ' · ' + when(lr.at), lr.state === 'passed' ? 'ok' : lr.state === 'failed' ? 'bad' : 'warn') : chip(h, 'Not replayed yet', ''))),
    wfPicker(api, d),
    d.stages.length ? route : h('p', { class: 'cg-note', text: 'This workflow has no steps yet.' }),
    d.summary.apps.length ? h('p', { class: 'cg-note', text: 'Apps: ' + d.summary.apps.join(', ') }) : null);

  // ---------- where the screen had changed ----------
  const alerts = h('section', { class: 'cg-card' + (d.alerts.length ? ' rpa-alertcard' : ''), 'aria-label': 'Screen changes found by replays' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Where the screen had changed' }), chip(h, d.alerts.length ? d.alerts.length + ' in recent runs' : 'None', d.alerts.length ? 'bad' : 'ok')),
    d.alerts.length ? h('ul', { class: 'cg-plain' }, d.alerts.map((a) => h('li', { class: 'cg-rule' },
      h('span', { class: 'cg-rule-main' }, h('b', { text: 'Step ' + (a.idx + 1) + ': ' + a.step }), h('small', { text: (CODE_WORD[a.code] || a.code) + ' · ' + a.message + ' · ' + when(a.at) })))))
      : h('p', { class: 'cg-note', text: 'Recent replays found every button, field and page where it was recorded.' }),
    d.alerts.length ? h('p', { class: 'cg-note', text: 'When a site has moved, correct the page address below, or rename what the step touches in Step editor.' }) : null,
    d.alerts.length ? h('div', { class: 'cg-actions' }, paneLink(h, 'rpa-steps', 'Open Step editor'), paneLink(h, 'rpa-history', 'See the runs')) : null);

  // ---------- each stop in detail ----------
  const stop = (st, i) => {
    const s0 = st.stepId ? d.steps.find((s) => s.id === st.stepId) : null;
    const editing = s0 && ui.edit === s0.id;
    const input = s0 ? text(h, st.kind === 'page' ? 'page' : 'appname', st.kind === 'page' ? 'https://…' : 'App name', st.kind === 'page' ? s0.page : s0.app, { maxlength: st.kind === 'page' ? '300' : '80' }) : null;
    return h('section', { class: 'cg-card rpa-stopcard', 'aria-label': stopTitle(st) + ' ' + (i + 1) },
      h('div', { class: 'cg-head' }, h('h3', { text: stopTitle(st) + ' ' + (i + 1) + ': ' + (st.title || '–') }), st.replay ? stateWord(h, st.replay.state) : null),
      st.replay && st.replay.state === 'failed' ? h('p', { class: 'cg-msg bad', text: '✕ ' + st.replay.message }) : null,
      st.steps.length ? h('ol', { class: 'rpa-mini' }, st.steps.map((s) => h('li', {},
        h('span', { class: 'rpa-mini-n', text: String(s.idx + 1) }), kindChip(h, s.kind), h('span', { text: s.name }),
        s.replay ? stateWord(h, s.replay.state) : null))) : h('p', { class: 'cg-note', text: 'The next stop follows straight away.' }),
      s0 && can ? (editing
        ? h('form', { class: 'cg-form rpa-inline', onsubmit: (e) => { e.preventDefault(); ui.edit = null; api.act(st.kind === 'page' ? 'set-page' : 'set-app', { workflow: wf, step: s0.id, [st.kind === 'page' ? 'page' : 'app']: input.value }); } },
          field(h, st.kind === 'page' ? 'Page address' : 'App name', input), h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy, text: 'Save' }), h('button', { class: 'linkbtn', type: 'button', text: 'Cancel', onclick: () => { ui.edit = null; api.repaint(); } })))
        : h('div', { class: 'cg-actions' }, h('button', { class: 'linkbtn', type: 'button', disabled: busy, text: st.kind === 'page' ? 'Change the page address' : 'Change the app', onclick: () => { ui.edit = s0.id; api.repaint(); } }))) : null);
  };

  return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d), band, message(h, ui), alerts, h('div', { class: 'rpa-stops' }, d.stages.map(stop)));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
