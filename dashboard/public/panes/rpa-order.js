// Order & checkpoints (focus): the chosen workflow as the replay sees it, a vertical flow from Start to Done. Each
// step can be dragged to a new place, nudged up or down, or sent straight to a position; between steps an approval
// gate shows where a run stops and waits for a person (with what they should check), and any step can be made one.
// A band on top says how many steps run and where the run will pause.
import { screen, chip, demoBanner, message } from './common.js';
import { wfPicker, noWorkflows, select, text, field, kindChip, whereOf } from './rpa-common.js';

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  if (!d.selected) return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d), noWorkflows(h, 'their replay order'));
  const busy = !!ui.busy, can = !!ctx.me.canRun;
  const wf = d.selected.id;
  const n = d.steps.length;
  const move = (s, input) => api.act('step-move', { workflow: wf, step: s.id, ...input });

  const band = h('section', { class: 'cg-card rpa-orderband', 'aria-label': 'Replay order' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Replay order' }), h('div', { class: 'cg-top-chips' }, chip(h, n + (n === 1 ? ' step' : ' steps'), ''), chip(h, d.waits.length ? 'Pauses ' + d.waits.length + (d.waits.length === 1 ? ' time' : ' times') + ' for approval' : 'Runs straight through', d.waits.length ? 'warn' : 'ok'))),
    wfPicker(api, d),
    d.waits.length ? h('p', { class: 'cg-note', text: 'A run waits before ' + d.waits.map((w) => 'step ' + (w.idx + 1)).join(', ') + '. Whoever runs it (or the owner) approves or rejects on the Run screen.' })
      : h('p', { class: 'cg-note', text: 'Add an approval checkpoint before any step that sends, pays or submits something.' }),
    message(h, ui));

  const node = (s) => {
    const gateOpen = ui.gate === s.id;
    const note = text(h, 'note', 'What should the approver check?', s.approvalNote || '', { maxlength: '160' });
    const pos = select(h, 'position', d.steps.map((_, i) => [String(i), 'Position ' + (i + 1)]), String(s.idx));
    pos.addEventListener('change', () => { if (Number(pos.value) !== s.idx) move(s, { to: Number(pos.value) }); });
    const gate = s.approval ? h('div', { class: 'rpa-gate', role: 'note' },
      h('b', { text: 'Approval checkpoint' }), h('span', { text: s.approvalNote ? 'The approver checks: ' + s.approvalNote : 'The run waits here until someone approves.' }),
      can ? h('div', { class: 'cg-actions' }, h('button', { class: 'linkbtn', type: 'button', disabled: busy, text: 'Change the note', onclick: () => { ui.gate = gateOpen ? null : s.id; api.repaint(); } }), h('button', { class: 'linkbtn danger', type: 'button', disabled: busy, 'aria-label': 'Remove the checkpoint before step ' + (s.idx + 1), text: 'Remove checkpoint', onclick: () => api.act('approval', { workflow: wf, step: s.id, on: false }) })) : null) : null;
    const gateForm = gateOpen ? h('form', { class: 'cg-form rpa-inline', onsubmit: (e) => { e.preventDefault(); ui.gate = null; api.act('approval', { workflow: wf, step: s.id, on: true, note: note.value }); } },
      field(h, 'Checkpoint before step ' + (s.idx + 1), note), h('button', { class: 'btn primary', type: 'submit', disabled: busy, text: s.approval ? 'Save note' : 'Add checkpoint' })) : null;
    const item = h('li', { class: 'rpa-flownode' + (s.approval ? ' has-gate' : '') + (ui.drag === s.id ? ' is-dragging' : ''), draggable: can ? 'true' : null, 'data-step': s.id,
      ondragstart: (e) => { ui.drag = s.id; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', s.id); } },
      ondragend: () => { ui.drag = null; },
      ondragover: (e) => { if (ui.drag && ui.drag !== s.id) e.preventDefault(); },
      ondrop: (e) => { e.preventDefault(); const from = ui.drag; ui.drag = null; if (from && from !== s.id) api.act('step-move', { workflow: wf, step: from, to: s.idx }); } },
      gate, gateForm,
      h('div', { class: 'rpa-flowcard' },
        h('span', { class: 'rpa-num', text: String(s.idx + 1) }),
        h('div', { class: 'rpa-step-main' }, h('b', { text: s.name }), h('small', { text: whereOf(s) || 'Same place as before' }), h('div', { class: 'cg-top-chips' }, kindChip(h, s.kind), s.optional ? chip(h, 'Optional', '') : null)),
        can ? h('div', { class: 'rpa-flowtools' },
          h('button', { class: 'rpa-icon', type: 'button', 'aria-label': 'Move step ' + (s.idx + 1) + ' up', disabled: busy || s.idx === 0, text: '↑', onclick: () => move(s, { by: -1 }) }),
          h('button', { class: 'rpa-icon', type: 'button', 'aria-label': 'Move step ' + (s.idx + 1) + ' down', disabled: busy || s.idx === n - 1, text: '↓', onclick: () => move(s, { by: 1 }) }),
          h('label', { class: 'rpa-posfield' }, h('span', { class: 'rpa-sr', text: 'Move step ' + (s.idx + 1) + ' to' }), pos),
          s.approval ? null : h('button', { class: 'cg-pill', type: 'button', disabled: busy, 'aria-pressed': 'false', 'aria-label': 'Wait for approval before step ' + (s.idx + 1), text: 'Wait for approval', onclick: () => { ui.gate = s.id; api.repaint(); } })) : null));
    return item;
  };
  const flow = h('section', { class: 'cg-card', 'aria-label': 'Steps in replay order' },
    h('p', { class: 'cg-note', text: '# · Step · Where · Checkpoint' }),
    n ? h('ol', { class: 'rpa-flow' }, h('li', { class: 'rpa-flowend', 'aria-hidden': 'true', text: 'Start' }), d.steps.map(node), h('li', { class: 'rpa-flowend', 'aria-hidden': 'true', text: 'Done' }))
      : h('p', { class: 'cg-note', text: 'This workflow has no steps yet.' }),
    can && n > 1 ? h('p', { class: 'cg-note', text: 'Drag a step onto another to put it there, or use the arrows and the position list.' }) : null);

  return h('div', { class: 'cg-pane rpa-pane' }, demoBanner(ctx, d), band, flow);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
