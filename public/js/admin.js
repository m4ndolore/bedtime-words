/* Maintainer page: decide shared affirmations. Cloudflare Access signs the maintainer in;
 * the Worker checks that sign-in again on every /api/admin call. */
(() => {
  'use strict';

  const ACTIONS = {
    pending: [['approve', 'Approve', 'approve'], ['reject', 'Reject', 'reject']],
    approved: [['unpublish', 'Unpublish', 'reject']],
    rejected: [['approve', 'Approve after all', 'approve']],
  };
  let current = 'pending';
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');

  async function decide(id, decision) {
    $('status').textContent = 'Saving…';
    const response = await fetch('/api/admin/decide', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, decision }),
    });
    const payload = await response.json().catch(() => ({}));
    $('status').textContent = response.ok ? `Done: ${payload.status}.` : (payload.error || `Could not save (${response.status}).`);
    show(current, false);
  }

  async function show(status, clearStatus = true) {
    current = status;
    for (const tab of document.querySelectorAll('.tabs button')) tab.setAttribute('aria-pressed', String(tab.dataset.status === status));
    if (clearStatus) $('status').textContent = 'Loading…';
    const response = await fetch(`/api/admin/submissions?status=${status}`);
    if (!response.ok) {
      $('status').textContent = response.status === 403 ? 'Sign in as a maintainer to see this.' : `Could not load (${response.status}).`;
      $('list').replaceChildren();
      return;
    }
    const { maintainer, submissions } = await response.json();
    $('who').textContent = `Signed in as ${maintainer}`;
    if (clearStatus) $('status').textContent = submissions.length ? '' : 'Nothing here.';
    $('list').replaceChildren(...submissions.map((item) => {
      const row = el('article', 'submission');
      const words = el('p', 'review-words');
      words.append(el('span', 'c', item.challenge), ' ', el('span', 'r', item.response));
      const meta = [item.category, `from ${item.contact || 'no name given'}`, `shared ${when(item.created_at)}`];
      if (item.decided_at) meta.push(`${item.status} ${when(item.decided_at)} by ${item.decided_by}`);
      if (item.status === 'approved') meta.push(`${item.hearts} ${item.hearts === 1 ? 'heart' : 'hearts'}`);
      const actions = el('div', 'admin-actions');
      for (const [decision, label, cls] of ACTIONS[item.status]) {
        const button = el('button', cls, label);
        button.type = 'button';
        button.addEventListener('click', () => decide(item.id, decision));
        actions.append(button);
      }
      row.append(words, el('p', 'note', meta.join(' · ')), actions);
      return row;
    }));
  }

  async function channels() {
    const response = await fetch('/api/admin/channels');
    if (!response.ok) return;
    const rows = (await response.json()).channels;
    $('channels').replaceChildren(...(rows.length ? rows : [null]).map((row) => {
      const tr = el('tr');
      if (!row) {
        const td = el('td', 'note', 'No visits through /go/ links yet.');
        td.colSpan = 4;
        tr.append(td);
        return tr;
      }
      tr.append(el('td', null, `/go/${row.channel}`), el('td', null, String(row.week)), el('td', null, String(row.total)), el('td', null, row.last));
      return tr;
    }));
  }

  for (const tab of document.querySelectorAll('.tabs button')) tab.addEventListener('click', () => show(tab.dataset.status));
  show('pending');
  channels();
})();
