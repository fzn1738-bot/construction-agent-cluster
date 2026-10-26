// Variables (grid): one card per variable of the chosen workflow (customer name, PO number…) with its label, its
// default, whether it is secret, and the steps that use it; a card for the logins kept in Connections; a binding table
// where each typing step is set to "typed as recorded" or to a variable; and found fields that look like variables.
import { screen, chip, demoBanner, message, records } from './common.js';
import { wfPicker, noWorkflows, field, text, check, paneLink } from './rpa-common.js';

const ticked = (box) => { const el = box.children[0]; return !!el && (el.checked === undefined ? !!(el.attrs && el.attrs.checked != null) : el.checked === true); };

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  if (!d.selected) return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), noWorkflows(h, 'their variables'));
  const busy = !!ui.busy, can = !!ctx.me.canRun;
  const wf = d.selected.id;

  const card = (v) => {
    const editing = ui.edit === v.name;
    const label = text(h, 'label', 'Label', v.label, { maxlength: '60' });
    const def = text(h, 'default', v.secret ? 'Secrets have no default' : 'Default (optional)', v.default || '', { maxlength: '200', disabled: v.secret ? true : null });
    return h('section', { class: 'cg-card rpa-varcard' + (v.secret ? ' is-secret' : ''), 'aria-label': 'Variable ' + v.name },
      h('div', { class: 'cg-head' }, h('h3', { class: 'cg-mono', text: '{{' + v.name + '}}' }), v.secret ? chip(h, 'Secret', 'warn') : v.default ? chip(h, 'Has a default', 'ok') : chip(h, 'Asked every run', '')),
      h('p', { class: 'cg-note', text: v.label + (v.secret ? ': asked for each run, never stored' : v.default ? ': “' + v.default + '” unless someone types another' : ': whoever runs it types it') }),
      h('small', { text: v.usedBy.length ? 'Used by ' + v.usedBy.map((s) => 'step ' + (s.idx + 1)).join(', ') : 'Not used by any step yet' }),
      editing ? h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); ui.edit = null; api.act('var-update', { workflow: wf, name: v.name, label: label.value, ...(v.secret ? {} : { default: def.value }) }); } },
        field(h, 'Label', label), field(h, 'Default', def), h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy, text: 'Save' }), h('button', { class: 'linkbtn', type: 'button', text: 'Cancel', onclick: () => { ui.edit = null; api.repaint(); } })))
        : can ? h('div', { class: 'cg-actions' }, h('button', { class: 'linkbtn', type: 'button', disabled: busy, text: 'Edit', 'aria-label': 'Edit ' + v.name, onclick: () => { ui.edit = v.name; api.repaint(); } }),
          h('button', { class: 'linkbtn danger', type: 'button', disabled: busy, 'aria-label': 'Remove variable ' + v.name, text: 'Remove', onclick: () => api.act('var-remove', { workflow: wf, name: v.name }) })) : null);
  };

  const vName = text(h, 'vname', 'customer_name', '', { maxlength: '32' });
  const vLabel = text(h, 'vlabel', 'Label, e.g. Customer name', '', { maxlength: '60' });
  const vDef = text(h, 'vdef', 'Default (optional)', '', { maxlength: '200' });
  const vSecret = check(h, 'secret', 'Secret: asked for at run time, never stored');
  const add = h('section', { class: 'cg-card', 'aria-label': 'Add a variable' },
    h('h3', { text: 'Add a variable' }),
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('var-add', { workflow: wf, name: vName.value, label: vLabel.value, default: vDef.value, secret: ticked(vSecret) }); } },
      field(h, 'Name', vName, 'Letters, numbers and underscores'), field(h, 'Label', vLabel), field(h, 'Default', vDef), vSecret,
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn primary', type: 'submit', disabled: busy || !can, text: 'Add variable' }))));

  const logins = h('section', { class: 'cg-card', 'aria-label': 'Logins from Connections' },
    h('h3', { text: 'Logins from Connections' }),
    h('ul', { class: 'cg-plain' }, d.builtins.map((b) => h('li', { class: 'cg-rule' }, h('span', { class: 'cg-rule-main' }, h('b', { class: 'cg-mono', text: '{{' + b.name + '}}' }), h('small', { text: b.label + (b.usedBy.length ? ' · used by ' + b.usedBy.map((s) => 'step ' + (s.idx + 1)).join(', ') : '') })), chip(h, b.saved ? 'Saved' : 'Not saved', b.saved ? 'ok' : 'warn')))),
    h('p', { class: 'cg-note', text: 'The owner saves them under Connections > Desktop automation agent; they are never shown on screen.' }));

  const vars = d.variables;
  const binding = h('section', { class: 'cg-card rpa-wide', 'aria-label': 'Which steps use which variable' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Which steps use them' }), chip(h, d.bindable.filter((b) => b.variable).length + ' of ' + d.bindable.length + ' use a variable', '')),
    records(h, ['Step', 'Recorded value', 'Types'], d.bindable.map((b) => [b, b.recorded, b]), {
      empty: 'No step types or chooses anything.',
      cell: (v, j) => {
        if (j === 0) return h('span', { class: 'rpa-wfcell' }, h('b', { text: (v.idx + 1) + '. ' + v.name }));
        if (j === 1) return String(v || '–');
        return h('select', { class: 'rpa-bind', name: 'bind', 'aria-label': 'What step ' + (v.idx + 1) + ' types', disabled: busy || !can ? true : null, onchange: (e) => api.act('bind', { workflow: wf, step: v.id, variable: e.target.value }) },
          h('option', { value: '', text: 'The recorded value', selected: !v.variable ? true : null }), vars.filter((x) => !x.secret).map((x) => h('option', { value: x.name, selected: x.name === v.variable ? true : null, text: '{{' + x.name + '}}' })));
      }
    }),
    d.suggestions.length ? h('div', { class: 'rpa-suggest' }, h('p', { class: 'cg-note', text: 'These fields look like they change on every run: ' + d.suggestions.map((x) => x.label + ' (“' + x.sample + '”)').join(', ') + '.' }), h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Make them variables', onclick: () => api.act('suggest', { workflow: wf }) })) : null,
    h('div', { class: 'cg-actions' }, paneLink(h, 'rpa-typing', 'Keep a typed value secret in Typed inputs')));

  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d),
    h('section', { class: 'cg-card rpa-wide' }, h('div', { class: 'cg-head' }, h('h3', { text: 'Variables of ' + d.selected.name }), chip(h, vars.length + (vars.length === 1 ? ' variable' : ' variables'), '')), wfPicker(api, d, 'Values like a customer name or PO number that change on every run'), message(h, ui)),
    h('div', { class: 'rpa-vargrid' }, vars.map(card), add, logins),
    binding);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
