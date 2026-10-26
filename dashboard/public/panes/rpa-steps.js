// Step editor (split): the chosen workflow's steps as a list; each step can be renamed in place (the name is what the
// run, the log and the approver see), and edited (what it touches, what it types, where, and whether it may be
// skipped). Steps can be added by hand and removed. The rail shows the focused step with its screenshot, so the
// person renaming "Click 'btnSubmit2'" to "Send the order" can see what it is.
import { screen, chip, demoBanner, message } from './common.js';
import { wfPicker, noWorkflows, field, text, select, check, thumb, zoomCard, kindChip, whereOf, paneLink } from './rpa-common.js';

const KIND_LABEL = { click: 'Click', type: 'Type', select: 'Choose from a list', key: 'Press a key', navigate: 'Open a page', app: 'Switch app' };
const ticked = (box) => { const el = box.children[0]; return !!el && (el.checked === undefined ? !!(el.attrs && el.attrs.checked != null) : el.checked === true); };

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  if (!d.selected) return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d), noWorkflows(h, 'their steps'));
  const busy = !!ui.busy, can = !!ctx.me.canRun;
  const wf = d.selected.id;
  const focus = d.focus;

  const row = (s) => {
    const renaming = ui.rename === s.id, editing = ui.edit === s.id;
    const sname = text(h, 'sname', 'Step name', s.name, { maxlength: '100' });
    const starget = text(h, 'target', 'What it touches', s.target, { maxlength: '200' });
    const svalue = text(h, 'value', s.secret ? 'Kept secret' : 'What it types', s.secret ? '' : s.value, { maxlength: '500', disabled: s.secret || s.variable ? true : null });
    const sapp = text(h, 'app', 'App', s.app, { maxlength: '80' });
    const spage = text(h, 'page', 'Page address', s.page, { maxlength: '300' });
    const optional = check(h, 'optional', 'Skip instead of failing if this step cannot be done', s.optional);
    return h('li', { class: 'rpa-step' + (focus && focus.id === s.id ? ' is-focus' : '') },
      h('span', { class: 'rpa-num', text: String(s.idx + 1) }),
      h('button', { class: 'rpa-icon rpa-peek', type: 'button', 'aria-label': 'Show step ' + (s.idx + 1) + ' beside the list', disabled: busy, text: s.hasShot ? '◧' : '–', onclick: () => api.act('focus', { step: s.id }, { quiet: true }) }),
      h('div', { class: 'rpa-step-main' },
        renaming ? h('form', { class: 'cg-form rpa-inline', onsubmit: (e) => { e.preventDefault(); ui.rename = null; api.act('step-rename', { workflow: wf, step: s.id, name: sname.value }); } },
          field(h, 'Name of step ' + (s.idx + 1), sname), h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy, text: 'Save name' }), h('button', { class: 'linkbtn', type: 'button', text: 'Cancel', onclick: () => { ui.rename = null; api.repaint(); } })))
          : h('b', { text: s.name }),
        h('small', { text: [s.target, s.secret ? 'secret, asked at run time' : s.variable ? '{{' + s.variable + '}}' : s.value, whereOf(s)].filter(Boolean).join(' · ') }),
        h('div', { class: 'cg-top-chips' }, kindChip(h, s.kind), s.variable ? chip(h, '{{' + s.variable + '}}', 'ok') : null, s.secret ? chip(h, 'Secret', 'warn') : null, s.approval ? chip(h, 'Approval checkpoint', 'warn') : null, s.optional ? chip(h, 'Optional', '') : null),
        editing ? h('form', { class: 'cg-form rpa-edit rpa-grid2', onsubmit: (e) => { e.preventDefault(); ui.edit = null; api.act('step-update', { workflow: wf, step: s.id, target: starget.value, ...(s.secret || s.variable ? {} : { value: svalue.value }), app: sapp.value, page: spage.value, optional: ticked(optional) }); } },
          field(h, 'What it touches', starget), field(h, 'What it types', svalue, s.variable ? 'Comes from {{' + s.variable + '}}: change it in Variables.' : s.secret ? 'Never stored.' : null),
          field(h, 'App', sapp), field(h, 'Page address', spage), h('div', { class: 'rpa-span' }, optional),
          h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy, text: 'Save step' }), h('button', { class: 'linkbtn', type: 'button', text: 'Cancel', onclick: () => { ui.edit = null; api.repaint(); } }))) : null),
      h('div', { class: 'rpa-step-tools' },
        h('button', { class: 'btn', type: 'button', disabled: busy || !can, 'aria-label': 'Rename step ' + (s.idx + 1), text: 'Rename', onclick: () => { ui.rename = renaming ? null : s.id; ui.edit = null; api.repaint(); } }),
        h('button', { class: 'linkbtn', type: 'button', disabled: busy || !can, 'aria-label': 'Edit step ' + (s.idx + 1), text: editing ? 'Editing' : 'Edit', onclick: () => { ui.edit = editing ? null : s.id; ui.rename = null; api.repaint(); } }),
        h('button', { class: 'linkbtn danger', type: 'button', disabled: busy || !can, 'aria-label': 'Delete step ' + (s.idx + 1), text: 'Delete', onclick: () => api.act('step-delete', { workflow: wf, step: s.id }) })));
  };

  const aKind = select(h, 'kind', d.kinds.map((k) => [k, KIND_LABEL[k]]), 'click');
  const aName = text(h, 'aname', 'Name, e.g. Send the order', '', { maxlength: '100' });
  const aTarget = text(h, 'atarget', 'What it touches, e.g. Send', '', { maxlength: '200' });
  const aValue = text(h, 'avalue', 'What it types (can be {{variable}})', '', { maxlength: '500' });
  const aApp = text(h, 'aapp', 'App, e.g. Safari', '', { maxlength: '80' });
  const list = h('section', { class: 'cg-card', 'aria-label': 'Steps' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Steps of ' + d.selected.name }), chip(h, d.steps.length + (d.steps.length === 1 ? ' step' : ' steps'), '')),
    h('p', { class: 'cg-note', text: 'Step · Action · Target · Value' }),
    wfPicker(api, d, 'Version ' + d.selected.version + ' · every save makes a new version'),
    d.steps.length ? h('ol', { class: 'rpa-steps' }, d.steps.map(row)) : h('p', { class: 'cg-note', text: 'No steps yet. Add one below or record the task.' }),
    h('details', { class: 'cg-more' }, h('summary', { text: 'Add a step by hand' }),
      h('form', { class: 'cg-form rpa-grid2', onsubmit: (e) => { e.preventDefault(); api.act('step-add', { workflow: wf, kind: aKind.value, name: aName.value, target: aTarget.value, value: aValue.value, app: aApp.value, after: focus ? focus.id : null }); } },
        field(h, 'Action', aKind), field(h, 'Name', aName), field(h, 'What it touches', aTarget), field(h, 'What it types', aValue), field(h, 'App', aApp),
        h('div', { class: 'cg-actions rpa-span' }, h('button', { class: 'btn', type: 'submit', disabled: busy || !can, text: focus ? 'Add after step ' + (focus.idx + 1) : 'Add step' })))),
    message(h, ui));

  const rail = h('aside', { class: 'cg-rail' },
    focus ? h('section', { class: 'cg-card rpa-focus', 'aria-label': 'Step ' + (focus.idx + 1) },
      h('div', { class: 'cg-head' }, h('h3', { text: 'Step ' + (focus.idx + 1) }), kindChip(h, focus.kind)),
      focus.shot ? h('button', { class: 'rpa-frame-img', type: 'button', 'aria-label': 'Enlarge the screenshot of step ' + (focus.idx + 1), onclick: () => { ui.zoom = { src: focus.shot, title: (focus.idx + 1) + '. ' + focus.name }; api.repaint(); } }, h('img', { class: 'rpa-shot-big', src: focus.shot, alt: 'Screen at step ' + (focus.idx + 1) + ': ' + focus.name }))
        : thumb(h, null, focus.name, null, focus.shotNote),
      !focus.shot && focus.shotNote ? h('small', { class: 'rpa-shotwhy', text: focus.shotNote }) : null,
      h('b', { text: focus.name }),
      h('dl', { class: 'rpa-dl' }, h('dt', { text: 'Touches' }), h('dd', { text: focus.target || '–' }), h('dt', { text: 'Types' }), h('dd', { text: focus.secret ? 'A secret, asked at run time' : focus.variable ? '{{' + focus.variable + '}}' : focus.value || '–' }), h('dt', { text: 'Where' }), h('dd', { text: whereOf(focus) || '–' }))) : null,
    h('section', { class: 'cg-card' }, h('h3', { text: 'Also for this workflow' }), h('ul', { class: 'cg-plain' },
      h('li', {}, paneLink(h, 'rpa-order', 'Change the order and approval checkpoints')), h('li', {}, paneLink(h, 'rpa-variables', 'Variables such as customer name or PO number')), h('li', {}, paneLink(h, 'rpa-screens', 'All its screenshots')))));

  return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d), zoomCard(h, ui.zoom, () => { ui.zoom = null; api.repaint(); }), h('div', { class: 'cg-split' }, h('div', { class: 'cg-main' }, list), rail));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
