import { api, session } from '../api.js';
import { h, table, badge, fmtMoney, fmtPct, fmtDate, modal, field, toast } from '../ui.js';

const EXPENSE_CATEGORIES = ['Food', 'Hall', 'Speaker', 'Travel', 'Stay', 'Printing', 'Promotional Material', 'Gift', 'Miscellaneous'];
const ATTACHMENT_KINDS = ['photo', 'invoice', 'attendance', 'presentation', 'other'];

// Reusable uploader: picks real image/PDF files, keeps them as data URLs with a kind.
function fileUploader(defaultKind = 'photo') {
  const items = [];
  const listBox = h('div', { style: 'margin-top:8px; display:flex; flex-direction:column; gap:6px;' });
  const input = h('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, style: 'display:none;' });
  input.addEventListener('change', () => {
    [...input.files].forEach((f) => {
      if (f.size > 4 * 1024 * 1024) { toast(`${f.name} is larger than 4MB`, 'error'); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const isImg = /^image\//.test(f.type);
        const kindSel = h('select', {}, ATTACHMENT_KINDS.map((k) => h('option', { value: k, selected: (isImg ? 'photo' : 'invoice') === k || undefined }, k)));
        const item = { filename: f.name, mime: f.type, dataUrl: reader.result, kindSel };
        items.push(item);
        const row = h('div', { style: 'display:flex; gap:8px; align-items:center;' },
          isImg ? h('img', { src: reader.result, style: 'width:38px;height:38px;object-fit:cover;border-radius:6px;border:1px solid var(--border);' })
                : h('span', { style: 'font-size:20px;' }, '📄'),
          h('span', { style: 'flex:1; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;' }, f.name),
          kindSel,
          h('button', { class: 'btn sm', type: 'button', onclick: () => { row.remove(); items.splice(items.indexOf(item), 1); } }, '✕'));
        listBox.append(row);
      };
      reader.readAsDataURL(f);
    });
    input.value = '';
  });
  const pick = h('button', { class: 'btn sm', type: 'button', onclick: () => input.click() }, '📷 Choose photos / receipts');
  const node = h('div', {}, pick, input, listBox);
  return { node, get: () => items.map((it) => ({ filename: it.filename, mime: it.mime, dataUrl: it.dataUrl, kind: it.kindSel.value })) };
}

function attachmentGallery(attachments) {
  if (!attachments.length) return h('div', { class: 'hint' }, 'No photos or documents attached yet.');
  return h('div', { style: 'display:flex; flex-wrap:wrap; gap:10px;' }, attachments.map((f) => {
    const isImg = f.data_url && /^image\//.test(f.mime || '');
    if (isImg) return h('a', { href: f.data_url, target: '_blank', title: `${f.filename} (${f.kind})` },
      h('img', { src: f.data_url, style: 'width:100px;height:100px;object-fit:cover;border-radius:8px;border:1px solid var(--border);' }));
    if (f.data_url) return h('a', { href: f.data_url, download: f.filename, class: 'btn sm' }, `📄 ${f.filename}`);
    return h('span', { class: 'btn sm', style: 'opacity:.7;' }, `${f.filename} (${f.kind || 'file'})`);
  }));
}

export default async function activityDetailPage(root, id) {
  if (!id) { root.append(h('div', { class: 'empty' }, 'No activity selected')); return; }
  const user = session.user;
  const a = await api(`/activities/${id}`);
  const isOwner = user.role === 'sales' && a.proposed_by === user.id;
  const isMarketing = user.role === 'ho' && ['Product Manager', 'Marketing Head'].includes(user.sub_role);

  const head = h('div', { class: 'page-head' },
    h('button', { class: 'btn sm', onclick: () => (location.hash = '#/activities') }, '← Back'),
    h('h2', { style: 'font-size:18px;' }, a.title), badge(a.status),
    h('div', { class: 'spacer' }));

  if (isMarketing && a.status === 'submitted') {
    head.append(
      h('button', { class: 'btn success', onclick: () => decide('approved') }, 'Approve'),
      h('button', { class: 'btn', onclick: () => decide('returned') }, 'Return'),
      h('button', { class: 'btn danger', onclick: () => decide('rejected') }, 'Reject'));
  }
  if (isOwner) {
    if (['draft', 'returned'].includes(a.status)) {
      head.append(h('button', { class: 'btn primary', onclick: async () => {
        await api(`/activities/${id}/submit`, { method: 'POST', body: {} });
        toast('Submitted for approval', 'success'); location.reload();
      } }, 'Submit for approval'));
    }
    if (a.status === 'approved') {
      head.append(h('button', { class: 'btn primary', onclick: () => executeModal(a) }, 'Record Execution'));
    }
    if (['executed', 'closed'].includes(a.status)) {
      head.append(h('button', { class: 'btn', onclick: () => addPhotosModal() }, '＋ Add Photos / Documents'));
    }
  }
  if (user.role === 'ho' && a.status === 'executed') {
    head.append(h('button', { class: 'btn sm', onclick: async () => {
      await api(`/activities/${id}/reopen`, { method: 'POST', body: {} });
      toast('Reopened for corrections'); location.reload();
    } }, 'Reopen'));
  }
  root.append(head);

  const events = [
    ['Proposed', a.created_at, a.proposer_name],
    a.decided_at ? [{ approved: 'Approved', rejected: 'Rejected', returned: 'Returned' }[a.status] || 'Decided', a.decided_at, a.decision_remarks] : null,
    a.actual_date ? ['Executed', a.actual_date, a.completion_remarks] : null,
  ].filter(Boolean);

  root.append(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' },
      h('h3', {}, 'Proposal'),
      infoRow('Type / Brand / Product', `${a.type_name || ''} · ${a.brand_name || '—'} · ${a.product_name || '—'}`),
      infoRow('Objective', a.objective || '—'),
      infoRow('Planned', `${fmtDate(a.planned_date)} @ ${a.venue || '—'}`),
      infoRow('Estimated cost', fmtMoney(a.estimated_cost)),
      infoRow('Expected sales', fmtMoney(a.expected_sales)),
      infoRow('Owner / Territory', `${a.proposer_name} · ${a.territory}`),
      a.decision_remarks ? infoRow('HO remarks', a.decision_remarks) : null),
    h('div', { class: 'card' },
      h('h3', {}, 'Timeline'),
      h('ul', { class: 'timeline' }, events.map(([label, at, note]) =>
        h('li', {}, h('b', {}, label), ` — ${fmtDate(at)}`, note ? h('div', { class: 'sub', style: 'color:var(--muted); font-size:12px;' }, note) : null))))));

  root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
    h('h3', {}, 'Participants — proposed vs actual'),
    table(['Name', 'Type', 'Proposed', 'Invited', 'Attended', 'Remarks'],
      a.participants.map((p) => [
        h('span', {}, p.name || p.account_id, (p.account_type === 'hcp' ? p.hcp_verified : p.chem_verified) === 0 ? h('span', { class: 'badge unverified', style: 'margin-left:6px;' }, 'unverified') : null),
        p.account_type.toUpperCase(),
        p.proposed ? '✔' : '—', p.invited ? '✔' : '—',
        p.attended ? h('b', { style: 'color:var(--accent)' }, '✔') : '—',
        p.remarks || '']))));

  // ---------- Comments & feedback (operations / HO <-> sales owner) ----------
  const commentsCard = h('div', { class: 'card', style: 'margin-top:14px;' });
  root.append(commentsCard);
  const renderComment = (c) => h('div', { style: 'border:1px solid var(--border); border-radius:8px; padding:10px 12px;' },
    h('div', { style: 'display:flex; justify-content:space-between; gap:10px; margin-bottom:4px; align-items:center;' },
      h('span', {}, h('b', {}, c.author_name || c.author_id),
        c.author_role ? h('span', { style: 'margin-left:8px; font-size:10.5px; font-weight:700; color:var(--primary); background:var(--primary-soft); padding:1px 8px; border-radius:999px;' }, c.author_role) : null),
      h('span', { class: 'hint' }, fmtDate(c.created_at))),
    h('div', { style: 'font-size:13px; white-space:pre-wrap;' }, c.body));
  async function loadComments() {
    const comments = await api(`/activities/${id}/comments`);
    commentsCard.innerHTML = '';
    commentsCard.append(
      h('h3', {}, `Comments & Feedback (${comments.length})`),
      h('div', { class: 'hint', style: 'margin-bottom:10px;' }, 'Operations / Head Office leave notes here — the activity owner is notified and can make the necessary changes.'),
      comments.length
        ? h('div', { style: 'display:flex; flex-direction:column; gap:10px;' }, comments.map(renderComment))
        : h('div', { class: 'hint' }, 'No comments yet.'));
    if (user.role === 'ho' || isOwner) {
      const ta = h('textarea', { rows: 2, placeholder: 'Add a comment…', style: 'width:100%; margin-top:12px;' });
      const btn = h('button', { class: 'btn primary', style: 'margin-top:8px;', onclick: async () => {
        if (!ta.value.trim()) return toast('Write a comment first', 'error');
        try {
          await api(`/activities/${id}/comments`, { method: 'POST', body: { body: ta.value.trim() } });
          ta.value = ''; toast('Comment posted', 'success'); loadComments();
        } catch { /* toast shown */ }
      } }, 'Post comment');
      commentsCard.append(ta, btn);
    }
  }
  loadComments();

  if (a.status === 'executed' || a.status === 'closed') {
    root.append(h('div', { class: 'grid cols-2', style: 'margin-top:14px;' },
      h('div', { class: 'card' },
        h('h3', {}, 'Execution & Feedback Report'),
        infoRow('Actual date / venue', `${fmtDate(a.actual_date)} @ ${a.actual_venue || '—'}`),
        infoRow('Actual cost', fmtMoney(a.actual_cost)),
        infoRow('Variance', a.estimated_cost ? fmtPct(((a.actual_cost / a.estimated_cost) - 1) * 100) : '—'),
        infoRow('Feedback report', a.completion_remarks || '—')),
      h('div', { class: 'card' },
        h('h3', {}, 'Expense Breakup'),
        table(['Category', 'Amount', 'Vendor', 'Invoice #'],
          a.expenses.map((e) => [e.category, fmtMoney(e.amount), e.vendor || '—', e.invoice_no || '—'])))));

    root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
      h('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;' },
        h('h3', { style: 'margin:0;' }, `Event Photos & Documents (${a.attachments.length})`),
        isOwner ? h('button', { class: 'btn sm primary', onclick: () => addPhotosModal() }, '＋ Add') : null),
      attachmentGallery(a.attachments)));

    const roiBox = h('div', { class: 'card', style: 'margin-top:14px;' }, h('h3', {}, 'Marketing Effectiveness — Before vs After attribution'));
    root.append(roiBox);
    const r = await api(`/roi/activity/${id}`);
    if (!r.available) {
      roiBox.append(h('div', { class: 'empty' }, r.reason || 'Marketing Effectiveness not available yet'));
    } else {
      roiBox.append(
        h('div', { class: 'grid cards-4', style: 'margin-bottom:12px;' },
          mini('Cost', fmtMoney(r.cost)), mini('Baseline sales (window)', fmtMoney(r.baselineSales)),
          mini('Post sales (window)', fmtMoney(r.postSales)),
          mini('Marketing Effectiveness', fmtPct(r.roiPct), (r.roiPct ?? 0) >= 0)),
        h('div', { class: 'hint', style: 'margin-bottom:10px;' },
          `Model: ${r.model} · window ±${r.windowMonths} months around ${r.activityMonth} · margin ${r.grossMarginPct}% · cost/account ${fmtMoney(r.costPerAccount)}${r.paybackMonths ? ` · payback ~${r.paybackMonths.toFixed(1)} mo` : ''}`));
      if (r.perDoctor.length) {
        roiBox.append(
          h('h3', { style: 'margin:6px 0;' }, 'Per doctor'),
          table(['Doctor', 'Class', 'Allocated Cost', 'Baseline avg/mo', 'Post avg/mo', 'Incremental'],
            r.perDoctor.map((d) => [
              h('a', { href: `#/doctor/${d.hcpId}` }, d.name), d.class, fmtMoney(d.allocatedCost),
              fmtMoney(d.baselineAvgMonthly), fmtMoney(d.postAvgMonthly),
              h('b', { style: `color:${d.incremental >= 0 ? 'var(--accent)' : 'var(--danger)'}` }, fmtMoney(d.incremental))])));
      }
      if (r.perChemist && r.perChemist.length) {
        roiBox.append(
          h('h3', { style: 'margin:12px 0 6px;' }, 'Per chemist / wholesaler'),
          table(['Account', 'Type', 'Allocated Cost', 'Baseline avg/mo', 'Post avg/mo', 'Incremental'],
            r.perChemist.map((c) => [
              h('a', { href: `#/chemist/${c.chemistId}` }, c.name), c.type, fmtMoney(c.allocatedCost),
              fmtMoney(c.baselineAvgMonthly), fmtMoney(c.postAvgMonthly),
              h('b', { style: `color:${c.incremental >= 0 ? 'var(--accent)' : 'var(--danger)'}` }, fmtMoney(c.incremental))])));
      }
    }
  }

  function infoRow(label, value) {
    return h('div', { style: 'display:flex; gap:10px; padding:5px 0; font-size:13px;' },
      h('div', { style: 'width:150px; color:var(--muted); flex:none;' }, label), h('div', {}, value));
  }
  function mini(label, value, up) {
    return h('div', { class: 'card kpi', style: 'padding:12px;' },
      h('div', { class: 'label' }, label),
      h('div', { class: 'value', style: `font-size:19px;${up === true ? 'color:var(--accent);' : up === false ? 'color:var(--danger);' : ''}` }, value));
  }

  function decide(decision) {
    const remarks = h('textarea', { rows: 3, placeholder: decision === 'approved' ? 'Optional remarks' : 'Remarks (required)' });
    modal(`${decision[0].toUpperCase() + decision.slice(1)} — ${a.title}`, [field('Remarks', remarks)], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', {
        class: `btn ${decision === 'approved' ? 'success' : decision === 'rejected' ? 'danger' : 'primary'}`,
        onclick: async () => {
          try {
            await api(`/activities/${id}/decision`, { method: 'POST', body: { decision, remarks: remarks.value } });
            toast(`Activity ${decision}`, 'success'); close(); location.reload();
          } catch { /* toast shown */ }
        },
      }, 'Confirm'),
    ]);
  }

  function addPhotosModal() {
    const up = fileUploader('photo');
    modal('Add Event Photos / Documents', [
      h('div', { class: 'hint', style: 'margin-bottom:8px;' }, 'Attach photos of the event, invoices or reports (images/PDF, max 4MB each).'),
      up.node,
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        const attachments = up.get();
        if (!attachments.length) return toast('Choose at least one file', 'error');
        await api(`/activities/${id}/attachments`, { method: 'POST', body: { attachments } });
        toast(`Added ${attachments.length} file(s)`, 'success'); close(); location.reload();
      } }, 'Upload'),
    ]);
  }

  function executeModal(act) {
    const actualDate = h('input', { type: 'date', value: act.planned_date || '' });
    const actualVenue = h('input', { value: act.venue || '' });
    const notes = h('textarea', { rows: 3, placeholder: 'Feedback report: outcomes, doctor engagement, key takeaways…' });
    const uploader = fileUploader('photo');

    const attendRows = act.participants.map((p) => {
      const cb = h('input', { type: 'checkbox', checked: p.attended ? true : undefined });
      return { p, cb };
    });
    const expenseLines = [];
    const expenseBox = h('div');
    const totalLabel = h('b', {}, '0');
    const addExpense = () => {
      const cat = h('select', {}, EXPENSE_CATEGORIES.map((c) => h('option', { value: c }, c)));
      const amt = h('input', { type: 'number', min: 0, placeholder: 'Amount', style: 'width:110px;', oninput: sum });
      const vendor = h('input', { placeholder: 'Vendor', style: 'width:130px;' });
      const inv = h('input', { placeholder: 'Invoice #', style: 'width:100px;' });
      const row = h('div', { style: 'display:flex; gap:6px; margin-bottom:6px; align-items:center;' }, cat, amt, vendor, inv,
        h('button', { class: 'btn sm', type: 'button', onclick: () => { row.remove(); expenseLines.splice(expenseLines.indexOf(line), 1); sum(); } }, '✕'));
      const line = { cat, amt, vendor, inv };
      expenseLines.push(line);
      expenseBox.append(row);
    };
    function sum() {
      totalLabel.textContent = expenseLines.reduce((s, l) => s + (Number(l.amt.value) || 0), 0).toLocaleString('en');
    }
    addExpense();

    modal(`Record Execution — ${act.title}`, [
      h('div', { class: 'form-row' }, field('Actual date *', actualDate), field('Actual venue', actualVenue)),
      h('div', { class: 'field' }, h('label', {}, 'Actual attendees (tick who came)'),
        h('div', { class: 'check-list' }, attendRows.map(({ p, cb }) =>
          h('label', { class: 'check-item' }, cb, p.name || p.account_id, h('span', { class: 'meta' }, p.account_type.toUpperCase()))))),
      h('div', { class: 'field' },
        h('div', { style: 'display:flex; justify-content:space-between; align-items:center;' },
          h('label', {}, 'Expense breakup (must total actual cost)'),
          h('span', { class: 'hint' }, 'Total: ', totalLabel)),
        expenseBox,
        h('button', { class: 'btn sm', type: 'button', onclick: addExpense }, '+ Add expense line')),
      h('div', { class: 'field' }, h('label', {}, 'Event photos & receipts'), uploader.node),
      field('Feedback report', notes),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', {
        class: 'btn primary', onclick: async () => {
          const expenses = expenseLines
            .filter((l) => Number(l.amt.value) > 0)
            .map((l) => ({ category: l.cat.value, amount: Number(l.amt.value), vendor: l.vendor.value, invoiceNo: l.inv.value }));
          const actualCost = expenses.reduce((s, e) => s + e.amount, 0);
          try {
            await api(`/activities/${id}/execute`, {
              method: 'POST',
              body: {
                actualDate: actualDate.value, actualVenue: actualVenue.value, actualCost,
                expenses,
                attendees: attendRows.map(({ p, cb }) => ({ accountId: p.account_id, accountType: p.account_type, attended: cb.checked })),
                attachments: uploader.get(),
                completionRemarks: notes.value,
              },
            });
            toast('Execution recorded — activity marked executed', 'success');
            close(); location.reload();
          } catch { /* toast shown */ }
        },
      }, 'Save execution'),
    ]);
  }
}
