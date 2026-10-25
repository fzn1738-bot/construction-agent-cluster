// Project inbox: the triaged message queue on the left, the triage rules and their split on the right.
import { screen, chip, demoChip, needsSetup, bigNumber, message, actionButton, chips, TONE } from './common.js';

const initial = (from) => ((String(from).replace(/<.*$/, '').trim() || '?').match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();

function ruleForm(api) {
  const { h, ctx } = api;
  if (ctx.me.role !== 'admin') return null;
  const name = h('input', { type: 'text', name: 'name', placeholder: 'Rule name, e.g. rfi', 'aria-label': 'Rule name', autocomplete: 'off', maxlength: '30' });
  const keyword = h('input', { type: 'text', name: 'keyword', placeholder: 'Subject contains, e.g. RFI', 'aria-label': 'Subject keyword', autocomplete: 'off', maxlength: '80' });
  return h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('add-rule', { name: name.value, keyword: keyword.value }); } },
    h('label', { text: 'Add a triage rule' }), name, keyword,
    h('button', { class: 'btn', type: 'submit', disabled: !!api.ui.busy, text: api.ui.busy === 'add-rule' ? 'Saving…' : 'Save rule' }));
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  if (!d.configured) return h('div', { class: 'cg-pane' }, needsSetup(ctx, d, 'No mailbox connected yet'));
  const msgs = d.messages || [];
  const ruleKeys = [...new Set(msgs.filter((m) => m.rule).map((m) => m.rule))];
  const pick = ui.rule || 'all';
  const shown = msgs.filter((m) => pick === 'all' || (pick === '__none' ? !m.rule : m.rule === pick));

  const queue = h('section', { class: 'cg-card cg-main', 'aria-label': 'Message queue' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Triaged messages' }), demoChip(h, d)),
    chips(h, [{ key: 'all', label: 'All', n: msgs.length }, ...ruleKeys.map((r) => ({ key: r, label: r, n: msgs.filter((m) => m.rule === r).length })), { key: '__none', label: 'No rule', n: msgs.filter((m) => !m.rule).length }], pick, (k) => { ui.rule = k; api.repaint(); }, 'Filter by rule'),
    shown.length ? h('ul', { class: 'cg-mail' }, shown.map((m) => h('li', { class: 'cg-msg-row' },
      h('span', { class: 'cg-avatar', 'aria-hidden': 'true', text: initial(m.from) }),
      h('div', { class: 'cg-file-main' }, h('b', { text: m.subject }), h('small', { text: m.from })),
      h('div', { class: 'cg-file-end' }, chip(h, m.rule || m.result, TONE[m.result] || ''), h('small', { text: ctx.ago(m.at) })))))
      : h('p', { class: 'cg-note', text: msgs.length ? 'No messages for that rule.' : 'No messages triaged yet. Press Check inbox now.' }));

  const split = d.byRule.labels.length ? h('ul', { class: 'cg-bars' }, d.byRule.labels.map((l, i) => {
    const max = Math.max(...d.byRule.values, 1);
    return h('li', {}, h('span', { text: l }), h('i', { class: 'cg-bar', 'data-w': String(Math.round((d.byRule.values[i] / max) * 10)) }), h('b', { text: String(d.byRule.values[i]) }));
  })) : h('p', { class: 'cg-note', text: 'Rule matches will appear here.' });

  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card' },
      bigNumber(h, d.summary.triaged, d.summary.triaged === 1 ? 'email triaged' : 'emails triaged', d.summary.backlog ? d.summary.backlog + ' still in the backlog' : 'No backlog'),
      h('div', { class: 'cg-actions' }, actionButton(api, 'Check inbox now', 'check', null, { primary: true, busy: 'Checking…' })),
      message(h, ui)),
    h('section', { class: 'cg-card' }, h('h3', { text: 'Triage by rule' }), split),
    h('section', { class: 'cg-card' },
      h('h3', { text: 'Rules' }), h('p', { class: 'cg-note', text: 'Mailbox ' + d.mailbox + (d.host ? ' on ' + d.host : '') }),
      (d.rules || []).length
        ? h('ul', { class: 'cg-plain' }, d.rules.map((r) => h('li', { class: 'cg-rule' }, h('span', {}, h('b', { text: r.name }), ' matches “' + r.subject + '”'),
          ctx.me.role === 'admin' ? h('button', { class: 'linkbtn danger', type: 'button', disabled: !!ui.busy, 'aria-label': 'Remove rule ' + r.name, text: 'Remove', onclick: () => api.act('remove-rule', { name: r.name }) }) : null)))
        : h('p', { class: 'cg-note', text: 'No rules yet. Every message will be logged as “No rule matched”.' }),
      ruleForm(api)));
  return h('div', { class: 'cg-pane cg-split' }, queue, rail);
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
