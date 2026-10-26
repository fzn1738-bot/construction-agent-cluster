// Record a workflow (split): the recorder console on the left. Start a recording and the desktop automation agent
// watches the screen: each click, typed value, app switch and page change arrives on its own, with its screenshot,
// while the screen refreshes every 1.5 seconds. Beside the live step list sits "what the recorder sees" (the latest
// capture). Stop, then save it as a workflow. The rail says what is kept and lists recent recordings.
import { screen, chip, demoBanner, message, actionButton, records } from './common.js';
import { field, text, select, check, thumb, zoomCard, kindChip, when, keepFresh, whereOf } from './rpa-common.js';

const STATE_CHIP = { recording: ['Recording', 'bad'], stopped: ['Stopped', 'warn'], denied: ['Permission denied', 'bad'], saved: ['Saved as a workflow', 'ok'] };
const KIND_LABEL = { click: 'Click', type: 'Type', select: 'Choose from a list', key: 'Press a key', navigate: 'Open a page', app: 'Switch app' };
const ticked = (box) => { const el = box.children[0]; return !!el && (el.checked === undefined ? !!(el.attrs && el.attrs.checked != null) : el.checked === true); };

let mounted = null;   // { root, ctx, stop } of the open screen
const capturing = (d) => !!(d && d.session && d.session.state === 'recording');
function ensureFresh(self) {
  if (!mounted || mounted.stop) return;
  mounted.stop = keepFresh(mounted.root, mounted.ctx, (r, c) => self.update(r, c), (d) => { const on = capturing(d); if (!on && mounted) mounted.stop = null; return on; });
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const s = d.session;
  const cap = d.capture || {};
  const live = s && s.state === 'recording';
  const busy = !!ui.busy, can = !!ctx.me.canRun;
  if (live) ensureFresh(self);

  // ---------- start ----------
  const name = text(h, 'name', 'Name, e.g. Raise a purchase order', ui.name || '', { maxlength: '80' });
  const app = text(h, 'app', 'Starting app, e.g. Procore', '', { maxlength: '80' });
  const client = d.isAdmin && d.clients.length ? select(h, 'client', d.clients.map((c) => [c.id, c.name]), (d.clients[1] || d.clients[0]).id) : null;
  const startForm = h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => { e.preventDefault(); ui.name = ''; api.act('start', { name: name.value, app: app.value, client: client ? client.value : '' }); } },
    field(h, 'Workflow name', name), field(h, 'Starting app or page', app), client ? field(h, 'Record for client', client, 'Each business customer keeps its own workflows.') : null,
    h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can || live, text: ui.busy === 'start' ? 'Starting…' : 'Start recording' })));

  // ---------- add a correction by hand (folded) ----------
  const kind = select(h, 'kind', d.kinds.map((k) => [k, KIND_LABEL[k]]), 'click');
  const target = text(h, 'target', 'What was touched, e.g. Save button', '', { maxlength: '200' });
  const value = text(h, 'value', 'What was typed or chosen', '', { maxlength: '500' });
  const page = text(h, 'page', 'Page address (optional)', '', { maxlength: '300' });
  const priv = check(h, 'private', 'Private screen: keep no screenshot');
  const sensitive = check(h, 'sensitive', 'Sensitive field: never keep the value');
  const eventForm = h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => { e.preventDefault(); api.act('event', { session: s.id, kind: kind.value, target: target.value, value: value.value, page: page.value, app: kind.value === 'app' ? target.value : '', private: ticked(priv), sensitive: ticked(sensitive) }); } },
    field(h, 'Action', kind), field(h, 'Target', target), field(h, 'Value', value), field(h, 'Page', page), priv, sensitive,
    h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn', type: 'submit', disabled: busy || !can, text: 'Add this action' })));

  const watcher = () => {
    const seen = cap.lastEventAt ? 'last action ' + Math.max(0, Math.round((Date.now() - cap.lastEventAt) / 1000)) + ' s ago' : 'waiting for the first action';
    const who = cap.mode === 'desktop' ? 'The desktop agent is watching the screen' : 'The demo recorder is playing a sample task';
    return h('div', { class: 'rpa-watch', role: 'status' },
      h('p', { class: 'rpa-live' }, h('i', { class: 'rpa-dot', 'aria-hidden': 'true' }), h('span', { text: 'Recording “' + s.name + '”: ' + s.steps.length + (s.steps.length === 1 ? ' step' : ' steps') + ' so far' })),
      h('small', { text: who + ' · ' + seen + (cap.rejected ? ' · ' + cap.rejected + ' unreadable action(s) skipped' : '') }),
      cap.error ? h('p', { class: 'cg-msg bad', text: '✕ ' + cap.error }) : null);
  };

  let body;
  if (!s) body = [h('p', { class: 'cg-note', text: 'Start a recording, then do the task once as you normally would. The desktop agent turns every click, typed value, app switch and page change into a step with a screenshot.' }), startForm];
  else if (s.state === 'recording') body = [
    watcher(),
    h('div', { class: 'cg-actions' }, actionButton(api, 'Stop recording', 'stop', { session: s.id }, { primary: true, busy: 'Stopping…' }), actionButton(api, 'Discard', 'discard', { session: s.id }, { busy: 'Discarding…' })),
    d.source === 'demo' ? h('details', { class: 'cg-more' }, h('summary', { text: 'Try a simulated action' }), eventForm) : null
  ];
  else if (s.state === 'stopped') {
    const saveName = text(h, 'wfname', 'Workflow name', s.name, { maxlength: '80' });
    body = [
      h('p', { class: 'cg-note', text: s.steps.length ? 'Recording stopped with ' + s.steps.length + ' steps. Name it and save it as a workflow you can edit, schedule and run.' : 'Nothing was captured. Discard this recording and try again.' }),
      h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('save', { session: s.id, name: saveName.value }); } }, field(h, 'Workflow name', saveName),
        h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can || !s.steps.length, text: ui.busy === 'save' ? 'Saving…' : 'Save as workflow' }), actionButton(api, 'Discard', 'discard', { session: s.id }, { busy: 'Discarding…' }))),
      h('details', { class: 'cg-more' }, h('summary', { text: 'Record another task instead' }), startForm)
    ];
  } else if (s.state === 'denied') body = [
    h('div', { class: 'cg-alert rpa-denied', role: 'alert' }, h('b', { text: 'Recording could not start' }), h('p', { class: 'cg-note', text: s.error })),
    h('div', { class: 'cg-actions' }, actionButton(api, 'Discard', 'discard', { session: s.id }, { busy: 'Discarding…' })),
    h('details', { class: 'cg-more', open: true }, h('summary', { text: 'Try again' }), startForm)
  ];
  else body = [h('p', { class: 'cg-note', text: 'This recording was saved as a workflow. Edit it in Step editor, or record another task.' }), startForm];

  const [sw, st] = s ? STATE_CHIP[s.state] || [s.state, ''] : ['Ready', ''];
  const recorder = h('section', { class: 'cg-card rpa-recorder', 'aria-label': 'Recorder' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Record mode' }), chip(h, sw, st)), body, message(h, ui));

  // ---------- what the recorder sees: the newest capture ----------
  const steps = s ? s.steps : [];
  const latest = [...steps].reverse().find((x) => x.shot);
  const sees = s ? h('figure', { class: 'cg-card rpa-sees', 'aria-label': 'Latest screenshot' },
    h('div', { class: 'cg-head' }, h('h3', { text: live ? 'What the recorder sees' : 'Last screenshot' }), latest ? kindChip(h, latest.kind) : null),
    latest ? h('img', { class: 'rpa-shot-big', src: latest.shot, alt: 'Screen after: ' + latest.name }) : h('p', { class: 'cg-note', text: 'Each captured action shows the screen here.' }),
    latest ? h('figcaption', { text: (latest.idx + 1) + '. ' + latest.name + (whereOf(latest) ? ' · ' + whereOf(latest) : '') }) : null) : null;

  // ---------- captured steps ----------
  const rows = steps.map((x, i) => [(i + 1) + '. ' + x.name, x.kind, [x.app, x.target, x.secret ? 'value redacted' : x.value, x.page].filter(Boolean).join(' · '), x]);
  const list = h('section', { class: 'cg-card', 'aria-label': 'Captured steps' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Captured steps' }), chip(h, steps.length + (steps.length === 1 ? ' step' : ' steps'), '')),
    records(h, ['Step', 'Action', 'Target', 'Screenshot'], rows, {
      empty: live ? 'Waiting for the first action on the screen…' : 'Nothing captured yet. Start a recording and do the task.',
      cell: (v, j) => j === 1 ? kindChip(h, v) : j === 3 ? h('span', { class: 'rpa-shotcell' }, thumb(h, v.shot, v.name, () => { ui.zoom = { src: v.shot, title: v.name }; api.repaint(); }, v.shotNote), v.secret ? chip(h, 'Redacted', 'warn') : null, !v.shot && v.shotNote && !v.secret ? h('small', { class: 'rpa-shotwhy', text: v.shotNote }) : null) : String(v ?? '')
    }));

  // ---------- rail ----------
  const stats = s ? s.stats : null;
  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card' }, h('h3', { text: 'What is kept' }),
      h('ul', { class: 'cg-plain' },
        h('li', { text: 'Passwords and card numbers are never saved: the step asks for the secret when it runs, and its screenshot is withheld.' }),
        h('li', { text: 'Pages are saved without their query strings, which often hold tokens.' }),
        h('li', { text: 'A step without a real screen capture says so; nothing is drawn in its place.' }),
        h('li', { text: 'A double click or repeated event is counted once; typing in one field is one step.' })),
      stats ? h('div', { class: 'cg-top-chips' }, chip(h, stats.events + ' seen', ''), chip(h, (stats.captured || 0) + ' screenshots', 'ok'), chip(h, stats.duplicates + ' repeats dropped', ''), chip(h, stats.merged + ' typing merged', ''), chip(h, stats.redacted + ' redacted', stats.redacted ? 'warn' : '')) : null),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Recent recordings' }),
      (d.recent || []).length ? h('ul', { class: 'cg-plain' }, d.recent.map((r) => h('li', { class: 'cg-rule' },
        h('span', { class: 'cg-rule-main' }, h('b', { text: r.name }), h('small', { text: (d.isAdmin ? r.clientName + ' · ' : '') + r.steps + ' steps · ' + when(r.startedAt) })),
        h('button', { class: 'linkbtn', type: 'button', disabled: busy, 'aria-label': 'Show recording ' + r.name, text: s && s.id === r.id ? 'Showing' : 'Show', onclick: () => api.act('select', { id: r.id }, { quiet: true }) }))))
        : h('p', { class: 'cg-note', text: 'No recordings yet.' })));

  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), zoomCard(h, ui.zoom, () => { ui.zoom = null; api.repaint(); }),
    h('div', { class: 'cg-split' }, h('div', { class: 'cg-main' }, recorder, sees, list), rail));
});
const self = { update: (r, c) => pane.update(r, c) };

export async function render(root, ctx) {
  if (mounted && mounted.stop) mounted.stop();
  mounted = { root, ctx, stop: null };
  await pane.render(root, ctx);
}
export function update(root, ctx) { if (mounted && mounted.root === root) mounted.ctx = ctx; return pane.update(root, ctx); }
