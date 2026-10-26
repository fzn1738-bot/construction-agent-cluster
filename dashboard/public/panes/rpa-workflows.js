// Workflows (split): each customer's library of trained workflows (filter by client for the owner), the recordings
// waiting to become workflows with a "Make it a workflow" button, and the chosen workflow's card: name, description,
// recent runs, copy to another client, delete, and links to its Step editor, Order & checkpoints and Variables. The
// rail holds when it runs by itself: a schedule, or a trigger (a file arrives, a file is transferred, an email is
// triaged) whose details can fill its variables.
import { screen, chip, demoBanner, message, records, chips } from './common.js';
import { field, text, select, check, stateWord, when, paneLink, dur } from './rpa-common.js';

const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
const TRIGGER_WORD = { folder: 'A file arrives in the site folder', ftp: 'A file is transferred over FTP', inbox: 'An email is triaged in the project inbox' };
const ticked = (box) => { const el = box.children[0]; return !!el && (el.checked === undefined ? !!(el.attrs && el.attrs.checked != null) : el.checked === true); };

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const sel = d.selected;
  const can = !!ctx.me.canRun;
  const busy = !!ui.busy;
  const wf = sel ? sel.id : '';

  // ---------- library ----------
  const clientIds = [...new Set(d.workflows.map((w) => w.client))];
  const pickC = ui.client || 'all';
  const shown = d.workflows.filter((w) => pickC === 'all' || w.client === pickC);
  const newName = text(h, 'name', 'Name of a new workflow', '', { maxlength: '80' });
  const newClient = d.isAdmin && d.clients.length ? select(h, 'client', d.clients.map((c) => [c.id, c.name]), (d.clients[1] || d.clients[0]).id) : null;
  const library = h('section', { class: 'cg-card', 'aria-label': 'Workflow library' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Workflow library' }), chip(h, d.workflows.length + (d.workflows.length === 1 ? ' workflow' : ' workflows'), '')),
    d.isAdmin && clientIds.length > 1 ? chips(h, [{ key: 'all', label: 'All clients', n: d.workflows.length }, ...clientIds.map((c) => ({ key: c, label: (d.workflows.find((w) => w.client === c) || {}).clientName, n: d.workflows.filter((w) => w.client === c).length }))], pickC, (k) => { ui.client = k; api.repaint(); }, 'Filter by client') : null,
    records(h, ['Workflow', 'Steps', 'Schedule', 'Last run'], shown.map((w) => [w, String(w.steps), w.schedule === 'Not scheduled' && w.triggerText === 'No trigger' ? 'Manual' : [w.schedule !== 'Not scheduled' ? w.schedule : '', w.triggerText !== 'No trigger' ? w.triggerText : ''].filter(Boolean).join(' · '), w.lastRun]), {
      empty: 'No workflows yet. Record a task, or create an empty workflow below.',
      cell: (v, j) => j === 0 ? h('span', { class: 'rpa-wfcell' }, h('button', { class: 'linkbtn rpa-wfname', type: 'button', 'aria-current': sel && sel.id === v.id ? 'true' : null, disabled: busy, text: v.name, onclick: () => { ui.confirm = false; api.act('select', { id: v.id }, { quiet: true }); } }), d.isAdmin ? h('small', { text: v.clientName }) : null)
        : j === 3 ? (v ? h('span', { class: 'rpa-last' }, stateWord(h, v.state), h('small', { text: when(v.at) })) : h('span', { class: 'cg-note', text: 'Never run' })) : String(v ?? '')
    }),
    h('details', { class: 'cg-more' }, h('summary', { text: 'Create an empty workflow' }),
      h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => { e.preventDefault(); api.act('create', { name: newName.value, client: newClient ? newClient.value : '' }); } },
        field(h, 'Name', newName), newClient ? field(h, 'For client', newClient) : null,
        h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn', type: 'submit', disabled: busy || !can, text: 'Create workflow' })))),
    message(h, ui));

  // ---------- recordings waiting to become workflows ----------
  const ready = d.recordings.length ? h('section', { class: 'cg-card', 'aria-label': 'Recordings to turn into workflows' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Recordings ready to become workflows' }), chip(h, String(d.recordings.length), 'warn')),
    h('ul', { class: 'cg-plain' }, d.recordings.map((r) => h('li', { class: 'cg-rule' },
      h('span', { class: 'cg-rule-main' }, h('b', { text: r.name }), h('small', { text: (d.isAdmin ? r.clientName + ' · ' : '') + r.steps + ' steps · recorded ' + when(r.startedAt) })),
      h('button', { class: 'btn', type: 'button', disabled: busy || !can, 'aria-label': 'Make ' + r.name + ' a workflow', text: 'Make it a workflow', onclick: () => api.act('convert', { session: r.id, name: r.name }) }))))) : null;

  if (!sel) return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d), ready, library);

  // ---------- the chosen workflow ----------
  const rename = text(h, 'wfname', 'Workflow name', sel.name, { maxlength: '80' });
  const desc = text(h, 'desc', 'What this workflow does', sel.description || '', { maxlength: '300' });
  const giveTo = d.isAdmin ? select(h, 'client', d.clients.filter((c) => c.id !== sel.client).map((c) => [c.id, c.name]), '') : null;
  const card = h('section', { class: 'cg-card', 'aria-label': 'Workflow ' + sel.name },
    h('div', { class: 'cg-head' }, h('h3', { text: sel.name }), h('div', { class: 'cg-top-chips' }, d.isAdmin ? chip(h, sel.clientName, '') : null, chip(h, 'Version ' + sel.version, ''), chip(h, sel.steps + ' steps', ''), sel.approvals ? chip(h, sel.approvals + (sel.approvals === 1 ? ' approval' : ' approvals'), 'warn') : null)),
    h('div', { class: 'cg-actions rpa-links' }, paneLink(h, 'rpa-steps', 'Edit steps'), paneLink(h, 'rpa-order', 'Order & checkpoints'), paneLink(h, 'rpa-variables', 'Variables (' + sel.variables + ')'), paneLink(h, 'rpa-run', 'Run it')),
    sel.description ? h('p', { class: 'cg-note', text: sel.description }) : null,
    h('details', { class: 'cg-more', open: ui.confirm || ui.editWf ? true : null, ontoggle: (e) => { ui.editWf = e.target.open; } }, h('summary', { text: 'Rename, describe, duplicate or delete' }),
    h('form', { class: 'cg-form rpa-grid2', onsubmit: async (e) => { e.preventDefault(); if (rename.value !== sel.name) await api.act('rename', { workflow: wf, name: rename.value }); if (desc.value !== (sel.description || '')) await api.act('describe', { workflow: wf, text: desc.value }); } },
      field(h, 'Workflow name', rename), field(h, 'Description', desc),
      h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can, text: 'Save name' }),
        h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Duplicate', onclick: () => api.act('duplicate', { workflow: wf }) }),
        ui.confirm ? h('span', { class: 'cg-actions' }, h('button', { class: 'btn danger', type: 'button', disabled: busy, text: 'Yes, delete it', onclick: () => { ui.confirm = false; api.act('delete', { workflow: wf }); } }), h('button', { class: 'linkbtn', type: 'button', text: 'Keep it', onclick: () => { ui.confirm = false; api.repaint(); } }))
          : h('button', { class: 'btn danger', type: 'button', disabled: busy || !can, text: 'Delete workflow', onclick: () => { ui.confirm = true; api.repaint(); } })))),
    giveTo && giveTo.children.length ? h('form', { class: 'cg-form rpa-inline', onsubmit: (e) => { e.preventDefault(); api.act('assign', { workflow: wf, client: giveTo.value }); } }, field(h, 'Give a copy to another client', giveTo, 'Each client gets its own copy to train further.'), h('button', { class: 'btn', type: 'submit', disabled: busy, text: 'Give a copy' })) : null,
    h('h3', { text: 'Recent runs' }),
    sel.recentRuns.length ? h('ul', { class: 'cg-plain' }, sel.recentRuns.map((r) => h('li', { class: 'cg-rule' }, h('span', { class: 'cg-rule-main' }, h('b', { text: when(r.startedAt) + ' · ' + r.trigger }), h('small', { text: r.error || r.passedSteps + ' of ' + r.steps + ' steps · ' + dur(r.ms) })), stateWord(h, r.state, r.word))))
      : h('p', { class: 'cg-note', text: 'Not run yet.' }));

  // ---------- schedule ----------
  const sch = sel.schedule;
  const sKind = select(h, 'kind', [['daily', 'Every day'], ['weekly', 'On chosen days'], ['interval', 'Every few minutes']], sch ? sch.kind : 'daily');
  const sEvery = text(h, 'everyMin', 'Minutes', sch && sch.everyMin ? String(sch.everyMin) : '60', { inputmode: 'numeric', maxlength: '5' });
  const sAt = text(h, 'at', 'HH:MM', sch && sch.at ? sch.at : '07:30', { maxlength: '5' });
  const sOn = check(h, 'enabled', 'Schedule is on', !sch || sch.enabled !== false);
  const dayBoxes = DAYS.map(([n, l]) => [n, check(h, 'day', l, sch && sch.days ? sch.days.includes(Number(n)) : n === '1')]);
  const valueInputs = sel.variableList.map((v) => [v.name, text(h, 'v_' + v.name, v.label, (sel.scheduleValues || {})[v.name] || v.default || '', { maxlength: '200' })]);
  const schedule = h('section', { class: 'cg-card', 'aria-label': 'Schedule' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Schedule' }), chip(h, !sch ? 'Off' : sch.enabled === false ? 'Paused' : 'On', sch && sch.enabled !== false ? 'ok' : sch ? 'warn' : '')),
    sch ? h('p', { class: 'rpa-when' }, h('b', { text: sel.scheduleText }), h('small', { text: sch.enabled === false ? 'Paused' : sel.nextRunAt ? 'Next run ' + when(sel.nextRunAt) : 'Waiting for its first run' })) : h('p', { class: 'cg-note', text: 'Not scheduled. Set a time and it runs by itself, with the values below.' }),
    h('details', { class: 'cg-more', open: sch ? null : true }, h('summary', { text: sch ? 'Change the schedule' : 'Set a schedule' }),
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('set-schedule', { workflow: wf, kind: sKind.value, everyMin: sEvery.value, at: sAt.value, days: dayBoxes.filter(([, b]) => ticked(b)).map(([n]) => n), enabled: ticked(sOn), values: Object.fromEntries(valueInputs.map(([n, i]) => [n, i.value])) }); } },
      field(h, 'How often', sKind), field(h, 'Time (daily or weekly)', sAt), field(h, 'Minutes (every few minutes)', sEvery),
      h('div', { class: 'rpa-days', role: 'group', 'aria-label': 'Days for weekly runs' }, dayBoxes.map(([, b]) => b)),
      valueInputs.length ? h('div', { class: 'rpa-values' }, h('p', { class: 'cg-note', text: 'Values used when it runs by itself' }), valueInputs.map(([n, i]) => field(h, '{{' + n + '}}', i))) : null,
      sOn,
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can || !sel.steps, text: 'Save schedule' }), sch ? h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Remove schedule', onclick: () => api.act('clear-schedule', { workflow: wf }) }) : null))));

  // ---------- trigger ----------
  const tr = sel.trigger;
  const tKind = select(h, 'kind', d.triggers.map((k) => [k, TRIGGER_WORD[k] || k]), tr ? tr.kind : 'inbox');
  const tMatch = text(h, 'match', 'Only when it contains…, e.g. invoice', tr ? tr.match : '', { maxlength: '80' });
  const tMap = text(h, 'map', 'variable=detail, e.g. invoice_ref=subject', tr ? Object.entries(tr.map).map(([k, v]) => k + '=' + v).join(', ') : '', { maxlength: '200' });
  const tOn = check(h, 'enabled', 'Trigger is on', !tr || tr.enabled !== false);
  const tTest = text(h, 'payload', 'Test event, e.g. subject=Invoice 7731', '', { maxlength: '200' });
  const trigger = h('section', { class: 'cg-card', 'aria-label': 'Trigger' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Trigger' }), chip(h, !tr ? 'Off' : tr.enabled === false ? 'Paused' : 'On', tr && tr.enabled !== false ? 'ok' : tr ? 'warn' : '')),
    tr ? h('p', { class: 'rpa-when' }, h('b', { text: TRIGGER_WORD[tr.kind] || tr.kind }), h('small', { text: (tr.match ? 'only if it contains “' + tr.match + '”' : 'every time') + (Object.keys(tr.map || {}).length ? ' · fills ' + Object.keys(tr.map).map((k) => '{{' + k + '}}').join(', ') : '') })) : null,
    h('p', { class: 'cg-note', text: 'Start this workflow when something arrives. Only this client’s own outcomes start it. Details of the event (file, subject, from) can fill its variables.' }),
    h('details', { class: 'cg-more', open: tr ? null : true }, h('summary', { text: tr ? 'Change the trigger' : 'Set a trigger' }),
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('set-trigger', { workflow: wf, kind: tKind.value, match: tMatch.value, map: tMap.value, enabled: ticked(tOn) }); } },
      field(h, 'Start when', tKind), field(h, 'Only if it contains', tMatch), field(h, 'Fill variables', tMap, 'file, path, subject, from, rule'), tOn,
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can || !sel.steps, text: 'Save trigger' }), tr ? h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Remove trigger', onclick: () => api.act('clear-trigger', { workflow: wf }) }) : null))),
    tr ? h('form', { class: 'cg-form rpa-inline', onsubmit: (e) => { e.preventDefault(); api.act('test-trigger', { workflow: wf, payload: tTest.value }); } }, field(h, 'Send a test event', tTest), h('button', { class: 'btn', type: 'submit', disabled: busy || !can, text: 'Send test' })) : null);

  return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d),
    h('div', { class: 'cg-split' }, h('div', { class: 'cg-main' }, ready, library, card), h('aside', { class: 'cg-rail rpa-follow' }, schedule, trigger)));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
