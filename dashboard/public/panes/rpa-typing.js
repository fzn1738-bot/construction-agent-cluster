// Typed inputs (grid): everything a workflow types or chooses, in three plain groups (typed as recorded / a variable
// asked on every run / kept secret), each row with what to do next: make it a variable, keep it secret, or type the
// recorded value again. Tiles count the groups; a card lists typing still waiting in unsaved recordings.
import { screen, chip, demoBanner, message, chips, bigNumber, updated } from './common.js';
import { wfPicker, noWorkflows, whereOf, paneLink, text, field } from './rpa-common.js';

const GROUPS = [['all', 'All'], ['plain', 'Typed as recorded'], ['variable', 'Variables'], ['secret', 'Kept secret']];
const groupOf = (s) => (s.secret ? 'secret' : s.variable ? 'variable' : 'plain');

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  if (!d.selected) return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), noWorkflows(h, 'the values each workflow types'));
  const busy = !!ui.busy, can = !!ctx.me.canRun;
  const wf = d.selected.id;
  const sum = d.summary;
  const group = ui.group || 'all';
  const shown = d.typed.filter((s) => group === 'all' || groupOf(s) === group);

  const tiles = h('div', { class: 'rpa-tiles' },
    h('section', { class: 'cg-card' }, bigNumber(h, sum.typed, sum.typed === 1 ? 'field typed or chosen' : 'fields typed or chosen', d.selected.name), updated(h)),
    h('section', { class: 'cg-card' }, bigNumber(h, sum.variables, 'asked on every run', sum.plain ? sum.plain + ' still typed as recorded' : 'none fixed to the recording')),
    h('section', { class: 'cg-card' }, bigNumber(h, sum.secret, 'kept secret', 'never stored, asked when it runs')));

  const row = (s) => {
    const nameIn = text(h, 'vname', 'variable name, e.g. po_number', '', { maxlength: '32' });
    const naming = ui.naming === s.id;
    const now = s.secret ? h('span', { class: 'rpa-typed is-secret', text: '•••• kept secret' })
      : s.variable ? h('span', { class: 'rpa-typed is-var cg-mono', text: '{{' + s.variable + '}}' })
        : h('span', { class: 'rpa-typed', text: s.value || '(empty)' });
    const tools = s.secret ? [h('small', { text: 'Asked for when the workflow runs' })]
      : [
        s.variable ? h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Type the recorded value', onclick: () => api.act('bind', { workflow: wf, step: s.id, variable: '' }) })
          : h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Make a variable', onclick: () => { ui.naming = naming ? null : s.id; api.repaint(); } }),
        h('button', { class: 'linkbtn danger', type: 'button', disabled: busy || !can, 'aria-label': 'Keep ' + (s.target || s.name) + ' secret', text: 'Keep secret', onclick: () => api.act('make-secret', { workflow: wf, step: s.id }) })
      ];
    return h('li', { class: 'rpa-input rpa-g-' + groupOf(s) },
      h('div', { class: 'rpa-input-main' },
        h('b', { text: s.target || s.name }),
        h('small', { text: 'Step ' + (s.idx + 1) + (s.kind === 'select' ? ' · chosen from a list' : ' · typed') + (whereOf(s) ? ' · ' + whereOf(s) : '') }),
        now,
        s.variable && s.recorded ? h('small', { text: 'Recorded as “' + s.recorded + '”' }) : null),
      h('div', { class: 'cg-actions rpa-input-tools' }, tools),
      naming ? h('form', { class: 'cg-form rpa-inline rpa-span', onsubmit: (e) => { e.preventDefault(); ui.naming = null; api.act('make-variable', { workflow: wf, step: s.id, name: nameIn.value }); } },
        field(h, 'Name the variable (leave empty to name it after the field)', nameIn), h('button', { class: 'btn primary', type: 'submit', disabled: busy, text: 'Make it a variable' })) : null);
  };
  const list = h('section', { class: 'cg-card rpa-wide', 'aria-label': 'Typed inputs' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'What this workflow types' }), chip(h, shown.length + ' shown', '')),
    h('p', { class: 'cg-note', text: 'Field · Typed · Becomes · Where' }),
    wfPicker(api, d, 'Each customer’s own workflows'),
    chips(h, GROUPS.map(([k, l]) => ({ key: k, label: l, n: k === 'all' ? d.typed.length : d.typed.filter((s) => groupOf(s) === k).length })), group, (k) => { ui.group = k; api.repaint(); }, 'Show'),
    shown.length ? h('ul', { class: 'rpa-inputs' }, shown.map(row)) : h('p', { class: 'cg-note', text: d.typed.length ? 'Nothing in this group.' : 'This workflow does not type or choose anything.' }),
    d.suggestions.length ? h('div', { class: 'rpa-suggest' }, h('p', { class: 'cg-note', text: d.suggestions.length + ' field(s) look like they change every time: ' + d.suggestions.map((x) => x.label).join(', ') + '.' }), h('button', { class: 'btn', type: 'button', disabled: busy || !can, text: 'Make them all variables', onclick: () => api.act('suggest', { workflow: wf }) })) : null,
    message(h, ui),
    h('div', { class: 'cg-actions' }, paneLink(h, 'rpa-variables', 'Defaults and labels in Variables')));

  const pending = d.pending.length ? h('section', { class: 'cg-card', 'aria-label': 'Typing in unsaved recordings' },
    h('h3', { text: 'Typing in recordings not saved yet' }),
    h('ul', { class: 'cg-plain' }, d.pending.map((p) => h('li', { class: 'cg-rule' }, h('span', { class: 'cg-rule-main' }, h('b', { text: p.target || 'A field' }), h('small', { text: p.recording })), p.secret ? chip(h, 'Redacted', 'warn') : chip(h, 'Kept', '')))),
    h('div', { class: 'cg-actions' }, paneLink(h, 'rpa-workflows', 'Turn a recording into a workflow'))) : null;

  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), tiles, list, pending);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
