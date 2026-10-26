// Record a workflow (split): the recorder on the left (start, capture, stop, save as a workflow) over the captured steps
// with a screenshot each; the rail says what is kept and what is left out, and lists recent recordings.
import { screen, chip, demoBanner, message, actionButton, records } from './common.js';
import { field, text, select, check, thumb, zoomCard, kindChip, when } from './rpa-common.js';

const STATE_CHIP = { recording: ['Recording', 'bad'], stopped: ['Stopped', 'warn'], denied: ['Permission denied', 'bad'], saved: ['Saved as a workflow', 'ok'] };
let watching = null;   // the document listeners of "Watch this window"

/** Record this browser window's own clicks, typing and page changes (the dashboard itself is left out). */
function watchWindow(api, session, on) {
  if (watching) { watching.off(); watching = null; }
  if (!on || !session || session.state !== 'recording' || typeof document === 'undefined' || !document.addEventListener) return;
  const inside = (el) => { for (let n = el; n; n = n.parentNode) if (n.classList && n.classList.contains('rpa-nowatch')) return true; return false; };
  const label = (el) => String((el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('placeholder'))) || el.name || el.id || el.innerText || el.value || el.tagName || '').trim().slice(0, 80);
  const send = (ev) => api.act('event', { session: session.id, at: Date.now(), page: location.pathname, app: 'Browser', ...ev }, { quiet: true });
  const onClick = (e) => { const el = e.target; if (!el || inside(el) || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return; send({ kind: 'click', target: label(el) }); };
  const onChange = (e) => {
    const el = e.target; if (!el || inside(el)) return;
    if (el.tagName === 'SELECT') send({ kind: 'select', target: label(el), value: el.value, field: el.name });
    else if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) send({ kind: 'type', target: label(el), value: el.value, field: el.name || el.id, inputType: el.type });
  };
  const onHash = () => send({ kind: 'navigate', page: location.pathname + location.hash });
  document.addEventListener('click', onClick, true); document.addEventListener('change', onChange, true);
  if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('hashchange', onHash);
  watching = { off: () => { document.removeEventListener('click', onClick, true); document.removeEventListener('change', onChange, true); if (typeof window !== 'undefined' && window.removeEventListener) window.removeEventListener('hashchange', onHash); } };
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const s = d.session;
  const live = s && s.state === 'recording';
  watchWindow(api, s, !!ui.watch && live);

  // ---------- the recorder ----------
  const name = text(h, 'name', 'Name, e.g. Raise a purchase order', ui.name || '', { maxlength: '80' });
  const app = text(h, 'app', 'Starting app, e.g. Procore', '', { maxlength: '80' });
  const client = d.isAdmin && d.clients.length ? select(h, 'client', d.clients.map((c) => [c.id, c.name]), (d.clients[1] || d.clients[0]).id) : null;
  const startForm = h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => { e.preventDefault(); ui.name = ''; api.act('start', { name: name.value, app: app.value, client: client ? client.value : '' }); } },
    field(h, 'Workflow name', name), field(h, 'Starting app or page', app), client ? field(h, 'Record for client', client, 'Each business customer keeps its own workflows.') : null,
    h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn primary', type: 'submit', disabled: !!ui.busy || !ctx.me.canRun || live, text: ui.busy === 'start' ? 'Starting…' : 'Start recording' })));

  const kind = select(h, 'kind', d.kinds.map((k) => [k, { click: 'Click', type: 'Type', select: 'Choose from a list', key: 'Press a key', navigate: 'Open a page', app: 'Switch app' }[k]]), 'click');
  const target = text(h, 'target', 'What was touched, e.g. Save button', '', { maxlength: '200' });
  const value = text(h, 'value', 'What was typed or chosen', '', { maxlength: '500' });
  const page = text(h, 'page', 'Page or app (optional)', '', { maxlength: '300' });
  const priv = check(h, 'private', 'Private screen: keep no screenshot');
  const sensitive = check(h, 'sensitive', 'Sensitive field: never keep the value');
  const flagOn = (box) => { const el = box.children[0]; return !!el && (el.checked === undefined ? !!(el.attrs && el.attrs.checked != null) : el.checked === true); };
  const eventForm = h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => { e.preventDefault(); api.act('event', { session: s.id, kind: kind.value, target: target.value, value: value.value, page: page.value, app: kind.value === 'app' ? target.value : '', private: flagOn(priv), sensitive: flagOn(sensitive) }, { quiet: false }); } },
    field(h, 'Action', kind), field(h, 'Target', target), field(h, 'Value', value), field(h, 'Page', page), priv, sensitive,
    h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn', type: 'submit', disabled: !!ui.busy || !ctx.me.canRun, text: 'Add this action' })));

  const watchBox = h('label', { class: 'rpa-check' }, h('input', { type: 'checkbox', checked: ui.watch ? true : null, onchange: (e) => { ui.watch = !!e.target.checked; api.repaint(); } }), h('span', { text: 'Also watch clicks and typing in this window' }));
  const saveName = text(h, 'wfname', 'Workflow name', s ? s.name : '', { maxlength: '80' });

  let body;
  if (!s) body = [h('p', { class: 'cg-note', text: 'Start a recording, then do the task once as you normally would. Every click, typed value, app switch and page change becomes a step with a screenshot.' }), startForm];
  else if (s.state === 'recording') body = [
    h('p', { class: 'rpa-live' }, h('i', { class: 'rpa-dot', 'aria-hidden': 'true' }), h('span', { text: 'Recording “' + s.name + '”: ' + s.steps.length + (s.steps.length === 1 ? ' step' : ' steps') + ' so far' })),
    eventForm, watchBox,
    h('div', { class: 'cg-actions' },
      (d.agent && (d.agent.configured || d.agent.demo)) ? actionButton(api, 'Pull actions from the desktop agent', 'pull', { session: s.id }, { busy: 'Pulling…' }) : null,
      actionButton(api, 'Stop recording', 'stop', { session: s.id }, { primary: true, busy: 'Stopping…' })),
    !(d.agent && (d.agent.configured || d.agent.demo)) ? h('p', { class: 'cg-note', text: 'Connect the desktop automation agent in Connections to capture other apps automatically.' }) : null
  ];
  else if (s.state === 'stopped') body = [
    h('p', { class: 'cg-note', text: s.steps.length ? 'Recording stopped with ' + s.steps.length + ' steps. Name it and save it as a workflow you can edit, schedule and run.' : 'Nothing was captured. Discard this recording and try again.' }),
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('save', { session: s.id, name: saveName.value }); } }, field(h, 'Workflow name', saveName),
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: !!ui.busy || !ctx.me.canRun || !s.steps.length, text: ui.busy === 'save' ? 'Saving…' : 'Save as workflow' }), actionButton(api, 'Discard', 'discard', { session: s.id }, { busy: 'Discarding…' }))),
    h('details', { class: 'cg-more' }, h('summary', { text: 'Record another task instead' }), startForm)
  ];
  else if (s.state === 'denied') body = [
    h('div', { class: 'cg-alert rpa-denied', role: 'alert' }, h('b', { text: 'Recording could not start' }), h('p', { class: 'cg-note', text: s.error })),
    h('div', { class: 'cg-actions' }, actionButton(api, 'Discard', 'discard', { session: s.id }, { busy: 'Discarding…' })),
    h('details', { class: 'cg-more', open: true }, h('summary', { text: 'Try again' }), startForm)
  ];
  else body = [h('p', { class: 'cg-note', text: 'This recording was saved as a workflow. Open Workflows to edit and run it.' }), startForm];

  const [sw, st] = s ? STATE_CHIP[s.state] || [s.state, ''] : ['Ready', ''];
  const recorder = h('section', { class: 'cg-card rpa-recorder rpa-nowatch', 'aria-label': 'Recorder' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Record mode' }), chip(h, sw, st)), body, message(h, ui));

  // ---------- captured steps ----------
  const steps = s ? s.steps : [];
  const rows = steps.map((x, i) => [(i + 1) + '. ' + x.name, x.kind, [x.target, x.secret ? 'value redacted' : x.value, x.page].filter(Boolean).join(' · '), x]);
  const list = h('section', { class: 'cg-card', 'aria-label': 'Captured steps' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Captured steps' }), chip(h, steps.length + (steps.length === 1 ? ' step' : ' steps'), '')),
    records(h, ['Step', 'Action', 'Target', 'Screenshot'], rows, {
      empty: 'Nothing captured yet. Start a recording and do the task.',
      cell: (v, j) => j === 1 ? kindChip(h, v) : j === 3 ? h('span', { class: 'rpa-shotcell' }, thumb(h, v.shot, v.name, () => { ui.zoom = { src: v.shot, title: v.name }; api.repaint(); }, v.shotNote && !v.shot ? v.shotNote : ''), v.secret ? chip(h, 'Redacted', 'warn') : null) : String(v ?? '')
    }));

  // ---------- rail ----------
  const stats = s ? s.stats : { events: 0, duplicates: 0, merged: 0, redacted: 0 };
  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card' }, h('h3', { text: 'What is kept' }),
      h('ul', { class: 'cg-plain' },
        h('li', { text: 'Passwords and card numbers are never saved: the step asks for the secret when it runs.' }),
        h('li', { text: 'Pages are saved without their query strings, which often hold tokens.' }),
        h('li', { text: 'Private screens keep the step but no screenshot.' }),
        h('li', { text: 'A double click or repeated event is counted once; typing in one field is one step.' })),
      s ? h('div', { class: 'cg-top-chips' }, chip(h, stats.events + ' seen', ''), chip(h, stats.duplicates + ' repeats dropped', ''), chip(h, stats.merged + ' typing merged', ''), chip(h, stats.redacted + ' redacted', stats.redacted ? 'warn' : '')) : null),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Recent recordings' }),
      (d.recent || []).length ? h('ul', { class: 'cg-plain' }, d.recent.map((r) => h('li', { class: 'cg-rule' },
        h('span', { class: 'cg-rule-main' }, h('b', { text: r.name }), h('small', { text: (d.isAdmin ? r.clientName + ' · ' : '') + r.steps + ' steps · ' + when(r.startedAt) })),
        h('button', { class: 'linkbtn', type: 'button', disabled: !!ui.busy, 'aria-label': 'Show recording ' + r.name, text: s && s.id === r.id ? 'Showing' : 'Show', onclick: () => api.act('select', { id: r.id }, { quiet: true }) }))))
        : h('p', { class: 'cg-note', text: 'No recordings yet.' })));

  return h('div', { class: 'cg-pane rpa-nowatch' }, demoBanner(ctx, d), zoomCard(h, ui.zoom, () => { ui.zoom = null; api.repaint(); }), h('div', { class: 'cg-split' }, h('div', { class: 'cg-main' }, recorder, list), rail));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
