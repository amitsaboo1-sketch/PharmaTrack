import { api, session } from '../api.js';
import { h, table, badge, fmtMoney, fmtDate, modal, field, select, toast } from '../ui.js';

const STAGE_LABEL = { clm: 'Cluster Lead (CLM)', cm: 'Country Manager (CM)', admin: 'Admin (Operations)' };

export default async function dailyAllowancePage(root) {
  const user = session.user;
  const isAdmin = user.role === 'ho' && user.sub_role === 'Admin';
  // DA chain is SER -> CLM -> CM -> Admin. Marketing / Finance are not involved.
  if (isAdmin || user.role === 'clm' || user.role === 'cm') return approvalView(root, user);
  if (user.role === 'sales') return repView(root, user);
  root.append(h('div', { class: 'empty' },
    'Daily allowance approvals are handled by the Cluster Lead (CLM), Country Manager (CM) and Admin — your role is not part of this flow.'));
}

// ---------------- Rep view: log claims + attach expenses ----------------
async function repView(root, user) {
  const categories = await api('/da/categories');
  const listBox = h('div');

  root.append(h('div', { class: 'page-head' },
    h('div', { class: 'hint' }, 'Log your daily allowance and attach expense proofs. Amounts are in your country currency; claims route to your Cluster Lead (CLM) → Country Manager (CM) → Admin for approval.'),
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: () => newClaimModal(categories, load) }, '+ New DA Claim')),
    listBox);

  async function load() {
    const claims = await api('/da');
    const totals = { approved: 0, submitted: 0, rejected: 0 };
    claims.forEach((c) => { totals[c.status] = (totals[c.status] || 0) + c.da_amount; });
    const cur = claims[0] ? claims[0].currency_code : null;

    listBox.innerHTML = '';
    listBox.append(h('div', { class: 'card' },
      table(['Date', 'Location', 'Purpose', 'DA Amount', 'Expense Proofs', 'Status', ''],
        claims.map((c) => [
          fmtDate(c.da_date), c.location || '—', c.purpose || '—',
          fmtMoney(c.da_amount, c.currency_code),
          `${c.attachment_count} file(s) · ${fmtMoney(c.expense_total, c.currency_code)}`,
          badge(c.status === 'submitted' ? 'submitted' : c.status),
          h('div', { style: 'display:flex; gap:6px;' },
            h('button', { class: 'btn sm', onclick: (e) => { e.stopPropagation(); openClaim(c.id); } }, 'View'),
            c.status !== 'approved'
              ? h('button', { class: 'btn sm danger', onclick: async (e) => {
                  e.stopPropagation();
                  if (!confirm('Delete this claim?')) return;
                  await api(`/da/${c.id}`, { method: 'DELETE' }); toast('Claim deleted'); load();
                } }, 'Delete') : ''),
        ]))));
  }

  async function openClaim(id) {
    const c = await api(`/da/${id}`);
    modal(`DA Claim — ${fmtDate(c.da_date)}`, [
      infoRow('Location', c.location || '—'),
      infoRow('Purpose', c.purpose || '—'),
      infoRow('DA amount', fmtMoney(c.da_amount, c.currency_code)),
      infoRow('Status', c.status),
      c.remarks ? infoRow('HO remarks', c.remarks) : null,
      h('h3', { style: 'margin:14px 0 8px;' }, 'Attached expense proofs'),
      c.attachments.length
        ? table(['Category', 'Amount', 'File'], c.attachments.map((a) => [
            a.category, fmtMoney(a.amount, c.currency_code), attachmentLink(a)]))
        : h('div', { class: 'empty' }, 'No attachments'),
    ], (close) => [h('button', { class: 'btn primary', onclick: close }, 'Close')]);
  }

  function newClaimModal(categories, onDone) {
    const daDate = h('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    const location = h('input', { placeholder: 'Town / area covered' });
    const purpose = h('input', { placeholder: 'e.g. doctor calls, chemist visits' });
    const amount = h('input', { type: 'number', min: 0, placeholder: '0' });

    const lines = [];
    const linesBox = h('div');
    const addLine = () => {
      const cat = select(categories.map((c) => [c, c]));
      const amt = h('input', { type: 'number', min: 0, placeholder: 'Amount', style: 'width:110px;' });
      const fileName = h('span', { class: 'hint' }, 'no file');
      let fileData = null, fileMime = '', realName = '';
      const file = h('input', { type: 'file', accept: 'image/*,.pdf', style: 'display:none;' });
      file.addEventListener('change', () => {
        const f = file.files[0];
        if (!f) return;
        if (f.size > 4 * 1024 * 1024) { toast('File too large (max 4MB)', 'error'); file.value = ''; return; }
        const reader = new FileReader();
        reader.onload = () => { fileData = reader.result; fileMime = f.type; realName = f.name; fileName.textContent = f.name; };
        reader.readAsDataURL(f);
      });
      const pick = h('button', { class: 'btn sm', type: 'button', onclick: () => file.click() }, 'Attach file');
      const row = h('div', { style: 'display:flex; gap:6px; align-items:center; margin-bottom:6px;' },
        cat, amt, pick, fileName, file,
        h('button', { class: 'btn sm', type: 'button', onclick: () => { row.remove(); lines.splice(lines.indexOf(line), 1); } }, '✕'));
      const line = { get: () => ({ category: cat.value, amount: Number(amt.value) || 0, filename: realName || (cat.value + '-proof'), mime: fileMime, dataUrl: fileData }) };
      lines.push(line);
      linesBox.append(row);
    };
    addLine();

    modal('New Daily Allowance Claim', [
      h('div', { class: 'form-row' }, field('Date *', daDate), field('DA amount *', amount)),
      h('div', { class: 'form-row' }, field('Location', location), field('Purpose', purpose)),
      h('div', { class: 'field' },
        h('label', {}, 'Expense proofs (attach receipts)'),
        linesBox,
        h('button', { class: 'btn sm', type: 'button', onclick: addLine }, '+ Add expense')),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!daDate.value) return toast('Date is required', 'error');
        if (!(Number(amount.value) >= 0)) return toast('Enter a valid DA amount', 'error');
        const attachments = lines.map((l) => l.get()).filter((a) => a.amount > 0 || a.dataUrl);
        await api('/da', { method: 'POST', body: {
          daDate: daDate.value, location: location.value, purpose: purpose.value,
          daAmount: Number(amount.value), attachments,
        } });
        toast('DA claim submitted', 'success'); close(); onDone();
      } }, 'Submit claim'),
    ]);
  }

  await load();
}

// -------- Approver view: sequential CLM (country) → CM → Admin sign-off --------
async function approvalView(root, user) {
  const myStage = user.role === 'clm' ? 'clm' : user.role === 'cm' ? 'cm'
    : (user.sub_role === 'Admin' ? 'admin' : null); // other HO roles: read-only
  const filterSel = select([['submitted', 'Pending my approval'], ['', 'All'], ['approved', 'Approved'], ['rejected', 'Rejected']],
    { onchange: (e) => load(e.target.value) });
  const listBox = h('div');
  const chainHint = h('div', { class: 'hint' },
    'Claims route SER → Cluster Lead (CLM) → Country Manager (CM) → Admin. Each level signs off in turn.');
  root.append(h('div', { class: 'page-head' }, h('div', { class: 'filters' }, filterSel), h('div', { class: 'spacer' }), chainHint), listBox);

  async function load(status = 'submitted') {
    // "Pending my approval" shows only claims currently at my stage; other filters show the wider list.
    const claims = await api(status === 'submitted' ? '/da?pending=mine' : `/da${status ? '?status=' + status : ''}`);
    listBox.innerHTML = '';
    listBox.append(h('div', { class: 'card' },
      table(['Rep', 'Date', 'Location', 'Purpose', 'DA Amount', 'Proofs', 'Stage', 'Status', ''],
        claims.map((c) => [
          c.user_name, fmtDate(c.da_date), c.location || '—', c.purpose || '—',
          fmtMoney(c.da_amount, c.currency_code),
          `${c.attachment_count} · ${fmtMoney(c.expense_total, c.currency_code)}`,
          c.status === 'submitted' ? (STAGE_LABEL[c.approval_stage] || '—') : '—',
          badge(c.status === 'submitted' ? 'submitted' : c.status),
          h('button', { class: 'btn sm primary', onclick: () => review(c.id) }, 'Review'),
        ]))));
  }

  async function review(id) {
    const c = await api(`/da/${id}`);
    const canDecide = !!c.can_decide;
    const remarks = h('textarea', { rows: 2, placeholder: 'Remarks (required to reject)' });
    modal(`Review DA — ${c.user_name} · ${fmtDate(c.da_date)}`, [
      infoRow('Location', c.location || '—'),
      infoRow('Purpose', c.purpose || '—'),
      infoRow('DA amount', fmtMoney(c.da_amount, c.currency_code)),
      c.status === 'submitted' ? infoRow('Awaiting', STAGE_LABEL[c.approval_stage] || c.approval_stage) : null,
      h('h3', { style: 'margin:14px 0 8px;' }, 'Expense proofs'),
      c.attachments.length
        ? table(['Category', 'Amount', 'File'], c.attachments.map((a) => [a.category, fmtMoney(a.amount, c.currency_code), attachmentLink(a)]))
        : h('div', { class: 'empty' }, 'No attachments'),
      canDecide ? field('Remarks', remarks) : infoRow('Decision', `${c.status}${c.remarks ? ' — ' + c.remarks : ''}`),
    ], (close) => canDecide
      ? [
          h('button', { class: 'btn', onclick: close }, 'Cancel'),
          h('button', { class: 'btn danger', onclick: () => decide(c.id, 'rejected', remarks.value, close) }, 'Reject'),
          h('button', { class: 'btn success', onclick: () => decide(c.id, 'approved', remarks.value, close) },
            c.approval_stage === 'admin' ? 'Approve (final)' : 'Approve & forward'),
        ]
      : [h('button', { class: 'btn primary', onclick: close }, 'Close')]);
  }

  async function decide(id, decision, remarks, close) {
    try {
      await api(`/da/${id}/decision`, { method: 'POST', body: { decision, remarks } });
      toast(`Claim ${decision}`, 'success'); close(); load(filterSel.value);
    } catch { /* toast shown */ }
  }

  if (!myStage) chainHint.textContent = 'Read-only: daily-allowance approvals are handled by CLM, CM and Admin.';
  await load('submitted');
}

// ---------------- shared helpers ----------------
function infoRow(label, value) {
  return h('div', { style: 'display:flex; gap:10px; padding:5px 0; font-size:13px;' },
    h('div', { style: 'width:120px; color:var(--muted); flex:none;' }, label), h('div', {}, value));
}
function attachmentLink(a) {
  if (a.data_url) return h('a', { href: a.data_url, target: '_blank', download: a.filename }, a.filename || 'view');
  return h('span', { class: 'hint' }, a.filename || '—');
}
