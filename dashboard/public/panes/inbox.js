// Project inbox (split): a full-width triage band (headline number, one proportional bar of where mail went, the
// check button), then the message queue beside a rail with the rules (colour-keyed to the bar), the mailbox and
// who writes most.
import { screen, chip, demoBanner, bigNumber, message, actionButton, chips, TONE } from './common.js';

const initial = (from) => ((String(from).replace(/<.*$/, '').trim() || '?').match(/[A-Za-z0-9]/) || ['?'])[0].toUpperCase();
const sender = (from) => String(from).replace(/\s*<.*$/, '').trim() || String(from);
const PAGE = 10;

function ruleForm(api) {
  const { h, ctx } = api;
  if (ctx.me.role !== 'admin') return null;
  const name = h('input', { type: 'text', name: 'name', placeholder: 'Rule name, e.g. rfi', 'aria-label': 'Rule name', autocomplete: 'off', maxlength: '30' });
  const keyword = h('input', { type: 'text', name: 'keyword', placeholder: 'Subject contains, e.g. RFI', 'aria-label': 'Subject keyword', autocomplete: 'off', maxlength: '80' });
  return h('details', { class: 'cg-more' }, h('summary', { text: 'Add a triage rule' }),
    h('form', { class: 'cg-form', onsubmit: (e) => { e.preventDefault(); api.act('add-rule', { name: name.value, keyword: keyword.value }); } },
      name, keyword,
      h('div', { class: 'cg-actions' }, h('button', { class: 'btn', type: 'submit', disabled: !!api.ui.busy, text: api.ui.busy === 'add-rule' ? 'Saving…' : 'Save rule' }))));
}

/** One bar split by rule, each segment in its own series colour with a labelled legend. */
const keyOf = (labels, l) => (l === 'No rule' ? 'none' : String((Math.max(0, labels.indexOf(l)) % 4) + 1));
function splitBar(h, byRule) {
  const labels = (byRule && byRule.labels) || [], values = (byRule && byRule.values) || [];
  const total = values.reduce((s, v) => s + v, 0);
  if (!total) return h('p', { class: 'cg-note', text: 'Where mail went appears here after the first check.' });
  return h('div', { class: 'cg-split-bar' },
    h('div', { class: 'cg-seg-bar', role: 'img', 'aria-label': labels.map((l, i) => l + ' ' + values[i]).join(', ') },
      labels.map((l, i) => h('i', { class: 'cg-segk-' + keyOf(labels, l), 'data-w': String(Math.max(1, Math.round((values[i] / total) * 20))) }))),
    h('ul', { class: 'cg-legend' }, labels.map((l, i) => h('li', { class: 'cg-segk-' + keyOf(labels, l) }, h('i', { 'aria-hidden': 'true' }), h('span', { text: l + ' ' }), h('b', { text: String(values[i]) })))));
}

const pane = screen((api) => {
  const { ctx, d, ui, h } = api;
  const msgs = d.messages || [];
  const sum = d.summary || {};
  const ruleKeys = [...new Set(msgs.filter((m) => m.rule).map((m) => m.rule))];
  const pick = ui.rule || 'all';
  // "No rule" is mail the rules passed over; mail the agent could not read is its own group, as in the rule bar
  const group = (m) => (m.rule ? m.rule : m.status === 'ignored' ? '__none' : '__other');
  const shown = msgs.filter((m) => pick === 'all' || group(m) === pick);
  const nOf = (k) => msgs.filter((m) => group(m) === k).length;
  const limit = ui.limit || PAGE;

  const band = h('section', { class: 'cg-card cg-triage', 'aria-label': 'Triage' },
    bigNumber(h, sum.triaged ?? 0, sum.triaged === 1 ? 'email triaged' : 'emails triaged', sum.last ? 'Last message ' + ctx.ago(sum.last) : 'Updated just now'),
    h('div', { class: 'cg-triage-mid' },
      h('div', { class: 'cg-head' }, h('h3', { text: 'Triage by rule' }),
        h('div', { class: 'cg-top-chips' }, chip(h, sum.backlog ? sum.backlog + ' in the backlog' : 'No backlog', sum.backlog ? 'warn' : 'ok'), sum.ignored ? chip(h, sum.ignored + ' with no rule', '') : null)),
      splitBar(h, d.byRule)),
    h('div', { class: 'cg-top-side' },
      h('div', { class: 'cg-actions' }, actionButton(api, 'Check inbox now', 'check', null, { primary: true, busy: 'Checking…' })),
      message(h, ui)));

  const queue = h('section', { class: 'cg-card cg-main', 'aria-label': 'Message queue' },
    h('div', { class: 'cg-head' }, h('h3', { text: 'Triaged messages' })),
    msgs.length ? chips(h, [{ key: 'all', label: 'All', n: msgs.length }, ...ruleKeys.map((r) => ({ key: r, label: r, n: nOf(r) })), { key: '__none', label: 'No rule', n: nOf('__none') }, ...(nOf('__other') ? [{ key: '__other', label: 'Unreadable', n: nOf('__other') }] : [])], pick, (k) => { ui.rule = k; ui.limit = PAGE; api.repaint(); }, 'Filter by rule') : null,
    shown.length ? h('ul', { class: 'cg-mail' }, shown.slice(0, limit).map((m) => h('li', { class: 'cg-msg-row' + (group(m) === '__other' ? ' is-bad' : '') },
      h('span', { class: 'cg-avatar', 'aria-hidden': 'true', text: initial(m.from) }),
      h('div', { class: 'cg-file-main' }, h('b', { text: m.subject, title: m.subject }), h('small', { text: sender(m.from) })),
      h('div', { class: 'cg-file-end' }, chip(h, m.rule || m.result, m.rule ? 'ok' : TONE[m.result] || ''), h('small', { text: ctx.ago(m.at) })))))
      : h('p', { class: 'cg-note', text: msgs.length ? 'No messages for that rule.' : 'No messages triaged yet. Press Check inbox now.' }),
    shown.length > limit ? h('div', { class: 'cg-actions' }, h('button', { class: 'linkbtn', type: 'button', text: 'Show ' + Math.min(PAGE, shown.length - limit) + ' more', onclick: () => { ui.limit = limit + PAGE; api.repaint(); } })) : null);

  const rules = d.rules || [];
  const mon = (d.monitors || [])[0];
  const tally = {};
  for (const m of msgs) if (m.rule) { const k = sender(m.from); tally[k] = (tally[k] || 0) + 1; }
  const senders = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 4);
  const hits = (name) => { const i = ((d.byRule && d.byRule.labels) || []).indexOf(name); return i >= 0 ? d.byRule.values[i] : 0; };
  const rail = h('aside', { class: 'cg-rail' },
    h('section', { class: 'cg-card' },
      h('div', { class: 'cg-head' }, h('h3', { text: 'Rules' }), chip(h, rules.length + (rules.length === 1 ? ' rule' : ' rules'), '')),
      rules.length
        ? h('ul', { class: 'cg-plain cg-rules' }, rules.map((r) => h('li', { class: 'cg-rule' },
          h('i', { class: 'cg-swatch cg-segk-' + keyOf(((d.byRule && d.byRule.labels) || []), r.name), 'aria-hidden': 'true' }),
          h('span', { class: 'cg-rule-main' }, h('b', { text: r.name }), h('small', { text: 'Subject contains “' + r.subject + '” · ' + hits(r.name) + ' matched' })),
          ctx.me.role === 'admin' ? h('button', { class: 'linkbtn danger', type: 'button', disabled: !!ui.busy, 'aria-label': 'Remove rule ' + r.name, text: 'Remove', onclick: () => api.act('remove-rule', { name: r.name }) }) : null)))
        : h('p', { class: 'cg-note', text: 'No rules yet. Every message will be logged as “No rule matched”.' }),
      ruleForm(api)),
    h('section', { class: 'cg-card' },
      h('div', { class: 'cg-head' }, h('h3', { text: 'Mailbox' }), mon ? chip(h, mon.state, mon.tone || TONE[mon.state] || '') : null),
      h('p', { class: 'cg-mono cg-path', text: (d.mailbox || 'INBOX') + (d.host ? ' @ ' + d.host : '') }),
      mon && mon.last ? h('p', { class: 'cg-note', text: 'Checked ' + mon.last + (mon.queue ? ' · ' + mon.queue + ' waiting' : '') }) : null),
    senders.length ? h('section', { class: 'cg-card' }, h('h3', { text: 'Who writes most' }),
      h('ul', { class: 'cg-bars is-names' }, senders.map(([who, n]) => h('li', {}, h('span', { text: who, title: who }), h('i', { class: 'cg-bar', 'data-w': String(Math.max(1, Math.round((n / senders[0][1]) * 10))) }), h('b', { text: String(n) }))))) : null);

  return h('div', { class: 'cg-pane' }, demoBanner(ctx, d), band, h('div', { class: 'cg-split' }, queue, rail));
});

export function render(root, ctx) { return pane.render(root, ctx); }
export function update(root, ctx) { return pane.update(root, ctx); }
