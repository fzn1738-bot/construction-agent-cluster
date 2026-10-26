// Workflows (split): the customer's library, and for the chosen workflow an editor where steps are renamed, reordered,
// given variables and approval checkpoints; the rail holds its variables, schedule and trigger.
import { screen, chip, demoBanner, message, records, chips } from './common.js';
import { field, text, select, check, thumb, zoomCard, kindChip, stateWord, when } from './rpa-common.js';

const DAYS = [['1', 'Mon'], ['2', 'Tue'], ['3', 'Wed'], ['4', 'Thu'], ['5', 'Fri'], ['6', 'Sat'], ['0', 'Sun']];
const TRIGGER_WORD = { folder: 'A file arrives in the site folder', ftp: 'A file is transferred over FTP', inbox: 'An email is triaged in the project inbox' };
const varOf = (v) => (/^\{\{(\w+)\}\}$/.exec(String(v || '')) || [])[1] || '';
const ticked = (box) => { const el = box.children[0]; return !!el && (el.checked === undefined ? !!(el.attrs && el.attrs.checked != null) : el.checked === true); };

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const sel = d.selected;
  const can = !!ctx.me.canRun;
  const busy = !!ui.busy;
  const wf = sel ? sel.id : '';

  // ---------- library ----------
  const clientIds = [...new Set(d.workflows.map((w) => w.client))];
  const pick = ui.client || 'all';
  const shown = d.workflows.filter((w) => pick === 'all' || w.client === pick);
  const newName = text(h, 'name', 'Name of a new workflow', '', { maxlength: '80' });
  const newClient = d.isAdmin && d.clients.length ? select(h, 'client', d.clients.map((c) => [c.id, c.name]), (d.clients[1] || d.clients[0]).id) : null;
  const library = h('section', { class: 'cg-card', 'aria-label': 'Workflow library' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Workflow library' }), chip(h, d.workflows.length + (d.workflows.length === 1 ? ' workflow' : ' workflows'), '')),
    d.isAdmin && clientIds.length > 1 ? chips(h, [{ key: 'all', label: 'All clients', n: d.workflows.length }, ...clientIds.map((c) => ({ key: c, label: (d.workflows.find((w) => w.client === c) || {}).clientName, n: d.workflows.filter((w) => w.client === c).length }))], pick, (k) => { ui.client = k; api.repaint(); }, 'Filter by client') : null,
    records(h, ['Workflow', 'Steps', 'Schedule', 'Last run'], shown.map((w) => [w, String(w.steps), w.schedule === 'Not scheduled' && w.triggerText === 'No trigger' ? 'Manual' : [w.schedule !== 'Not scheduled' ? w.schedule : '', w.triggerText !== 'No trigger' ? w.triggerText : ''].filter(Boolean).join(' · '), w.lastRun]), {
      empty: 'No workflows yet. Record one, or create an empty workflow below.',
      cell: (v, j) => j === 0 ? h('span', { class: 'rpa-wfcell' }, h('button', { class: 'linkbtn rpa-wfname', type: 'button', 'aria-current': sel && sel.id === v.id ? 'true' : null, disabled: busy, text: v.name, onclick: () => { ui.edit = null; ui.confirm = false; api.act('select', { id: v.id }, { quiet: true }); } }), d.isAdmin ? h('small', { text: v.clientName }) : null)
        : j === 3 ? (v ? h('span', { class: 'rpa-last' }, stateWord(h, v.state), h('small', { text: when(v.at) })) : h('span', { class: 'cg-note', text: 'Never run' })) : String(v ?? '')
    }),
    h('details', { class: 'cg-more' }, h('summary', { text: 'Create an empty workflow' }),
      h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => { e.preventDefault(); api.act('create', { name: newName.value, client: newClient ? newClient.value : '' }); } },
        field(h, 'Name', newName), newClient ? field(h, 'For client', newClient) : null,
        h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn', type: 'submit', disabled: busy || !can, text: 'Create workflow' })))),
    message(h, ui));

  if (!sel) return h('div', { class: 'cg-pane rpa-nowatch' }, demoBanner(ctx, d), library);

  // ---------- header of the chosen workflow ----------
  const rename = text(h, 'wfname', 'Workflow name', sel.name, { maxlength: '80' });
  const desc = text(h, 'desc', 'What this workflow does', sel.description || '', { maxlength: '300' });
  const giveTo = d.isAdmin ? select(h, 'client', d.clients.filter((c) => c.id !== sel.client).map((c) => [c.id, c.name]), '') : null;
  const header = h('section', { class: 'cg-card', 'aria-label': 'Workflow ' + sel.name },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Editing: ' + sel.name }), h('div', { class: 'cg-top-chips' }, d.isAdmin ? chip(h, sel.clientName, '') : null, chip(h, 'Version ' + sel.version, ''), chip(h, sel.steps.length + ' steps', ''), sel.approvals ? chip(h, sel.approvals + (sel.approvals === 1 ? ' approval' : ' approvals'), 'warn') : null)),
    h('form', { class: 'cg-form rpa-grid2', onsubmit: async (e) => { e.preventDefault(); if (rename.value !== sel.name) await api.act('rename', { workflow: wf, name: rename.value }); if (desc.value !== (sel.description || '')) await api.act('describe', { workflow: wf, text: desc.value }); } },
      field(h, 'Workflow name', rename), field(h, 'Description', desc),
      h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can, text: 'Save name' }),
        h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Duplicate', onclick: () => api.act('duplicate', { workflow: wf }) }),
        ui.confirm ? h('span', { class: 'cg-actions' }, h('button', { class: 'btn danger', type: 'button', disabled: busy, text: 'Yes, delete it', onclick: () => { ui.confirm = false; api.act('delete', { workflow: wf }); } }), h('button', { class: 'linkbtn', type: 'button', text: 'Keep it', onclick: () => { ui.confirm = false; api.repaint(); } }))
          : h('button', { class: 'btn danger', type: 'button', disabled: busy || !can, text: 'Delete workflow', onclick: () => { ui.confirm = true; api.repaint(); } }))),
    giveTo && giveTo.children.length ? h('form', { class: 'cg-form rpa-inline', onsubmit: (e) => { e.preventDefault(); api.act('assign', { workflow: wf, client: giveTo.value }); } }, field(h, 'Give a copy to another client', giveTo), h('button', { class: 'btn', type: 'submit', disabled: busy, text: 'Give a copy' })) : null);

  // ---------- steps ----------
  const vars = sel.variables;
  const stepRow = (s, i) => {
    const bound = varOf(s.value);
    const editing = ui.edit === s.id;
    const sname = text(h, 'sname', 'Step name', s.name, { maxlength: '100' });
    const starget = text(h, 'target', 'Target', s.target, { maxlength: '200' });
    const svalue = text(h, 'value', s.secret ? 'Kept secret' : 'Value', s.value, { maxlength: '500', disabled: s.secret || bound ? true : null });
    const snote = text(h, 'note', 'What should the approver check?', s.approvalNote || '', { maxlength: '160' });
    const optional = check(h, 'optional', 'Skip instead of failing if this step cannot be done', s.optional);
    const binder = !s.secret && ['type', 'select', 'key', 'navigate'].includes(s.kind) && (vars.length || bound)
      ? h('select', { class: 'rpa-bind', 'aria-label': 'Use a variable for step ' + (i + 1), disabled: busy || !can, onchange: (e) => api.act('bind', { workflow: wf, step: s.id, variable: e.target.value }) },
        h('option', { value: '', text: s.recorded || s.value ? 'Recorded value' : 'No variable', selected: !bound ? true : null }), vars.map((v) => h('option', { value: v.name, selected: v.name === bound ? true : null, text: '{{' + v.name + '}}' }))) : null;
    return h('li', { class: 'rpa-step' + (s.approval ? ' has-approval' : '') },
      h('span', { class: 'rpa-num', text: String(i + 1) }),
      thumb(h, s.shot, s.name, () => { ui.zoom = { src: s.shot, title: s.name }; api.repaint(); }, s.shotNote && !s.shot ? s.shotNote : ''),
      h('div', { class: 'rpa-step-main' },
        h('b', { text: s.name }),
        h('small', { text: [s.target, s.secret ? 'secret, asked at run time' : bound ? '' : s.value, s.page].filter(Boolean).join(' · ') }),
        h('div', { class: 'cg-top-chips' }, kindChip(h, s.kind), bound ? chip(h, '{{' + bound + '}}', 'ok') : null, s.secret ? chip(h, 'Secret', 'warn') : null, s.approval ? chip(h, 'Approval checkpoint', 'warn') : null, s.optional ? chip(h, 'Optional', '') : null),
        s.approval && s.approvalNote ? h('small', { text: 'Approver checks: ' + s.approvalNote }) : null,
        editing ? h('form', { class: 'cg-form rpa-edit', onsubmit: async (e) => { e.preventDefault(); if (sname.value !== s.name) await api.act('step-rename', { workflow: wf, step: s.id, name: sname.value }); await api.act('step-update', { workflow: wf, step: s.id, target: starget.value, ...(s.secret || bound ? {} : { value: svalue.value }), optional: ticked(optional) }); if (s.approval && snote.value !== (s.approvalNote || '')) await api.act('approval', { workflow: wf, step: s.id, on: true, note: snote.value }); ui.edit = null; api.repaint(); } },
          field(h, 'Step name', sname), field(h, 'Target', starget), field(h, 'Value', svalue, bound ? 'Comes from the variable {{' + bound + '}}.' : null), s.approval ? field(h, 'Approval note', snote) : null, optional,
          h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy, text: 'Save step' }), h('button', { class: 'linkbtn', type: 'button', text: 'Cancel', onclick: () => { ui.edit = null; api.repaint(); } }))) : null),
      h('div', { class: 'rpa-step-tools' },
        h('button', { class: 'rpa-icon', type: 'button', 'aria-label': 'Move step ' + (i + 1) + ' up', disabled: busy || !can || i === 0, text: '↑', onclick: () => api.act('step-move', { workflow: wf, step: s.id, by: -1 }) }),
        h('button', { class: 'rpa-icon', type: 'button', 'aria-label': 'Move step ' + (i + 1) + ' down', disabled: busy || !can || i === sel.steps.length - 1, text: '↓', onclick: () => api.act('step-move', { workflow: wf, step: s.id, by: 1 }) }),
        binder,
        h('button', { class: 'cg-pill', type: 'button', 'aria-pressed': s.approval ? 'true' : 'false', disabled: busy || !can, text: 'Approval', onclick: () => api.act('approval', { workflow: wf, step: s.id, on: !s.approval, note: s.approvalNote }) }),
        h('button', { class: 'linkbtn', type: 'button', disabled: busy || !can, text: editing ? 'Editing' : 'Rename or edit', onclick: () => { ui.edit = editing ? null : s.id; api.repaint(); } }),
        h('button', { class: 'linkbtn danger', type: 'button', disabled: busy || !can, 'aria-label': 'Delete step ' + (i + 1), text: 'Delete', onclick: () => api.act('step-delete', { workflow: wf, step: s.id }) })));
  };
  const aKind = select(h, 'kind', d.kinds.map((k) => [k, { click: 'Click', type: 'Type', select: 'Choose from a list', key: 'Press a key', navigate: 'Open a page', app: 'Switch app' }[k]]), 'click');
  const aTarget = text(h, 'target', 'Target, e.g. Save button', '', { maxlength: '200' });
  const aValue = text(h, 'value', 'Value (can be {{variable}})', '', { maxlength: '500' });
  const steps = h('section', { class: 'cg-card', 'aria-label': 'Steps' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Steps' }), sel.steps.length ? chip(h, 'Replayed top to bottom', '') : null),
    sel.steps.length ? h('ol', { class: 'rpa-steps' }, sel.steps.map(stepRow)) : h('p', { class: 'cg-note', text: 'No steps yet. Add one below or record the task.' }),
    h('details', { class: 'cg-more' }, h('summary', { text: 'Add a step by hand' }),
      h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => { e.preventDefault(); api.act('step-add', { workflow: wf, kind: aKind.value, target: aTarget.value, value: aValue.value }); } },
        field(h, 'Action', aKind), field(h, 'Target', aTarget), field(h, 'Value', aValue),
        h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn', type: 'submit', disabled: busy || !can, text: 'Add step' })))));

  // ---------- variables ----------
  const vName = text(h, 'vname', 'customer_name', '', { maxlength: '32' });
  const vLabel = text(h, 'vlabel', 'Label, e.g. Customer name', '', { maxlength: '60' });
  const vDef = text(h, 'vdef', 'Default (optional)', '', { maxlength: '200' });
  const vSecret = check(h, 'secret', 'Secret: asked for at run time, never stored');
  const variables = h('section', { class: 'cg-card', 'aria-label': 'Variables' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Variables' }), chip(h, vars.length + (vars.length === 1 ? ' variable' : ' variables'), '')),
    h('p', { class: 'cg-note', text: 'Values that change on every run, like a customer name or PO number. Pick one on a step to use it.' }),
    vars.length ? h('ul', { class: 'cg-plain' }, vars.map((v) => h('li', { class: 'cg-rule' },
      h('span', { class: 'cg-rule-main' }, h('b', { class: 'cg-mono', text: '{{' + v.name + '}}' }), h('small', { text: v.label + (v.secret ? ' · secret' : v.default ? ' · default “' + v.default + '”' : ' · asked at run time') })),
      h('button', { class: 'linkbtn danger', type: 'button', disabled: busy || !can, 'aria-label': 'Remove variable ' + v.name, text: 'Remove', onclick: () => api.act('var-remove', { workflow: wf, name: v.name }) })))) : null,
    d.suggestions.length ? h('div', { class: 'rpa-suggest' }, h('p', { class: 'cg-note', text: 'Found ' + d.suggestions.length + ' field(s) that look like variables: ' + d.suggestions.map((x) => x.label).join(', ') + '.' }), h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Make them variables', onclick: () => api.act('suggest', { workflow: wf }) })) : null,
    h('p', { class: 'cg-note', text: 'Built in, from Connections: {{login_user}} and {{login_password}}.' }),
    h('details', { class: 'cg-more' }, h('summary', { text: 'Add a variable' }),
      h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('var-add', { workflow: wf, name: vName.value, label: vLabel.value, default: vDef.value, secret: ticked(vSecret) }); } },
        field(h, 'Name', vName, 'Letters, numbers and underscores'), field(h, 'Label', vLabel), field(h, 'Default', vDef), vSecret,
        h('div', { class: 'cg-actions' }, h('button', { class: 'btn', type: 'submit', disabled: busy || !can, text: 'Add variable' })))));

  // ---------- schedule ----------
  const sch = sel.schedule;
  const sKind = select(h, 'kind', [['daily', 'Every day'], ['weekly', 'On chosen days'], ['interval', 'Every few minutes']], sch ? sch.kind : 'daily');
  const sEvery = text(h, 'everyMin', 'Minutes', sch && sch.everyMin ? String(sch.everyMin) : '60', { inputmode: 'numeric', maxlength: '5' });
  const sAt = text(h, 'at', 'HH:MM', sch && sch.at ? sch.at : '07:30', { maxlength: '5' });
  const sOn = check(h, 'enabled', 'Schedule is on', !sch || sch.enabled !== false);
  const dayBoxes = DAYS.map(([n, l]) => [n, check(h, 'day', l, sch && sch.days ? sch.days.includes(Number(n)) : n === '1')]);
  const valueInputs = vars.filter((v) => !v.secret).map((v) => [v.name, text(h, 'v_' + v.name, v.label, (sel.scheduleValues || {})[v.name] || v.default || '', { maxlength: '200' })]);
  const schedule = h('section', { class: 'cg-card', 'aria-label': 'Schedule' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Schedule' }), chip(h, sel.scheduleText, sch && sch.enabled !== false ? 'ok' : '')),
    sel.nextRunAt ? h('p', { class: 'cg-note', text: 'Next run ' + when(sel.nextRunAt) }) : null,
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('set-schedule', { workflow: wf, kind: sKind.value, everyMin: sEvery.value, at: sAt.value, days: dayBoxes.filter(([, b]) => ticked(b)).map(([n]) => n), enabled: ticked(sOn), values: Object.fromEntries(valueInputs.map(([n, i]) => [n, i.value])) }); } },
      field(h, 'How often', sKind), field(h, 'Time (daily or weekly)', sAt), field(h, 'Minutes (every few minutes)', sEvery),
      h('div', { class: 'rpa-days', role: 'group', 'aria-label': 'Days for weekly runs' }, dayBoxes.map(([, b]) => b)),
      valueInputs.length ? h('div', { class: 'rpa-values' }, h('p', { class: 'cg-note', text: 'Values used when it runs by itself' }), valueInputs.map(([n, i]) => field(h, '{{' + n + '}}', i))) : null,
      sOn,
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can || !sel.steps.length, text: 'Save schedule' }), sch ? h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Remove schedule', onclick: () => api.act('clear-schedule', { workflow: wf }) }) : null)));

  // ---------- trigger ----------
  const tr = sel.trigger;
  const tKind = select(h, 'kind', d.triggers.map((k) => [k, TRIGGER_WORD[k] || k]), tr ? tr.kind : 'inbox');
  const tMatch = text(h, 'match', 'Only when it contains…, e.g. invoice', tr ? tr.match : '', { maxlength: '80' });
  const tMap = text(h, 'map', 'variable=detail, e.g. invoice_ref=subject', tr ? Object.entries(tr.map).map(([k, v]) => k + '=' + v).join(', ') : '', { maxlength: '200' });
  const tOn = check(h, 'enabled', 'Trigger is on', !tr || tr.enabled !== false);
  const tTest = text(h, 'payload', 'Test event, e.g. subject=Invoice 7731', '', { maxlength: '200' });
  const trigger = h('section', { class: 'cg-card', 'aria-label': 'Trigger' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Trigger' }), chip(h, sel.triggerText, tr && tr.enabled !== false ? 'ok' : '')),
    h('p', { class: 'cg-note', text: 'Start this workflow when something arrives. Details of the event (file, subject, from) can fill its variables.' }),
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('set-trigger', { workflow: wf, kind: tKind.value, match: tMatch.value, map: tMap.value, enabled: ticked(tOn) }); } },
      field(h, 'Start when', tKind), field(h, 'Only if it contains', tMatch), field(h, 'Fill variables', tMap, 'file, path, subject, from, rule'), tOn,
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can || !sel.steps.length, text: 'Save trigger' }), tr ? h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Remove trigger', onclick: () => api.act('clear-trigger', { workflow: wf }) }) : null)),
    tr ? h('form', { class: 'cg-form rpa-inline', onsubmit: (e) => { e.preventDefault(); api.act('test-trigger', { workflow: wf, payload: tTest.value }); } }, field(h, 'Send a test event', tTest), h('button', { class: 'btn', type: 'submit', disabled: busy || !can, text: 'Send test' })) : null);

  return h('div', { class: 'cg-pane rpa-nowatch' }, demoBanner(ctx, d), zoomCard(h, ui.zoom, () => { ui.zoom = null; api.repaint(); }),
    h('div', { class: 'cg-split' }, h('div', { class: 'cg-main' }, library, header, steps), h('aside', { class: 'cg-rail' }, variables, schedule, trigger)));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
