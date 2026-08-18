import { api } from '../api.js';
import { h, table, toast, modal, field, select } from '../ui.js';

const STAGE_LABEL = { clm: 'Cluster Lead (CLM)', cm: 'Country Manager (CM)', marketing: 'Marketing', admin: 'Admin' };
const STEP_NO = { clm: 1, cm: 2, marketing: 3, admin: 4 };
const NEXT_LABEL = { clm: 'Country Manager (CM)', cm: 'Marketing', marketing: 'Admin' };
const STAGE_BANNER = {
  clm: 'Step 1 of 4 — Cluster Lead (CLM) review for your country. Approving forwards each account to the Country Manager (CM).',
  cm: 'Step 2 of 4 — Country Manager (CM) review. Approving forwards to Marketing.',
  marketing: 'Step 3 of 4 — Marketing review. Add a comment when you approve; it then goes to Admin for final approval.',
  admin: 'Step 4 of 4 — Admin final approval. Each item carries the reason and Marketing’s comment.',
};

export default async function verificationPage(root) {
  const box = h('div');
  root.append(
    h('div', { class: 'hint', style: 'margin-bottom:12px;' },
      'Field reps register — or request removal of — doctors/chemists with a reason. Verification is a four-step sign-off: Cluster Lead (CLM) → Country Manager (CM) → Marketing → Admin. Merging duplicates re-points all activity links, mappings and sales rows automatically.'),
    box);

  async function load() {
    const pending = await api('/verification/pending');
    box.innerHTML = '';
    const stage = pending.stage;
    if (!stage) { box.append(h('div', { class: 'empty' }, 'You do not have a verification stage assigned.')); return; }

    box.append(h('div', { class: 'hint', style: 'margin-bottom:12px;' }, STAGE_BANNER[stage] || ''));

    // Each row carries its OWN stage (derived from its flags) — a covering approver can see a
    // mix of stages when a lower seat is vacant, so labels and the note prompt are per-row.
    const addStageOf = (r) => !r.clm_ok ? 'clm' : !r.cm_ok ? 'cm' : !r.mkt_verified ? 'marketing' : 'admin';
    const remStageOf = (r) => !r.removal_clm_ok ? 'clm' : !r.removal_cm_ok ? 'cm' : !r.removal_mkt_ok ? 'marketing' : 'admin';
    const addLabel = (st) => NEXT_LABEL[st] ? `Approve → ${NEXT_LABEL[st]}` : 'Verify to master (final)';
    const remLabel = (st) => NEXT_LABEL[st] ? `Approve removal → ${NEXT_LABEL[st]}` : 'Confirm removal (final)';

    const addSection = (title, rows, type, masters) => h('div', { class: 'card', style: 'margin-bottom:14px;' },
      h('h3', {}, `${title} (${rows.length})`),
      rows.length
        ? table(['ID', 'Name', 'Details', 'Reason for adding', 'At stage', 'Marketing comment', 'Actions'],
            rows.map((r) => { const st = addStageOf(r); return [
              r.id, h('b', {}, r.name),
              type === 'hcp' ? `${r.speciality || '—'} · ${r.clinic || r.city || ''}` : `${r.type || 'Retail'} · ${r.address || r.city || ''}`,
              h('span', { class: 'hint' }, r.add_reason || '—'),
              STAGE_LABEL[st] || st,
              h('span', { class: 'hint' }, r.mkt_note || '—'),
              h('div', { style: 'display:flex; gap:6px;' },
                h('button', { class: 'btn sm success', onclick: () => approve(type, r, 'add', st) }, addLabel(st)),
                h('button', { class: 'btn sm', onclick: () => mergeModal(type, r, masters) }, 'Merge…'))]; }))
        : h('div', { class: 'empty' }, 'Nothing pending'));

    const remSection = (title, rows, type) => h('div', { class: 'card', style: 'margin-bottom:14px;' },
      h('h3', {}, `${title} (${rows.length})`),
      rows.length
        ? table(['ID', 'Name', 'Reason for removal', 'At stage', 'Marketing comment', 'Actions'],
            rows.map((r) => { const st = remStageOf(r); return [
              r.id, h('b', {}, r.name),
              h('span', { class: 'hint' }, r.removal_reason || '—'),
              STAGE_LABEL[st] || st,
              h('span', { class: 'hint' }, r.removal_mkt_note || '—'),
              h('button', { class: 'btn sm danger', onclick: () => approve(type, r, 'removal', st) }, remLabel(st))]; }))
        : h('div', { class: 'empty' }, 'No removal requests'));

    const [hcps, chemists] = await Promise.all([api('/hcps?verified=1'), api('/chemists')]);
    box.append(
      h('h3', { style: 'margin:6px 0;' }, 'New field accounts'),
      addSection('Doctors', pending.adds.hcps, 'hcp', hcps),
      addSection('Chemists', pending.adds.chemists, 'chemist', chemists.filter((c) => c.verified)),
      h('h3', { style: 'margin:18px 0 6px;' }, 'Removal requests'),
      remSection('Doctors', pending.removals.hcps, 'hcp'),
      remSection('Chemists', pending.removals.chemists, 'chemist'));
  }

  // Marketing approvals require a comment (it is forwarded to Admin); CLM/CM/Admin approve directly.
  function approve(type, rec, kind, stage) {
    if (stage !== 'marketing') { decide(type, rec, 'approve', {}); return; }
    const note = h('textarea', { rows: 2, placeholder: 'Your comment (required)…' });
    modal(kind === 'removal' ? `Approve removal — ${rec.name}` : `Approve — ${rec.name}`, [
      h('div', { class: 'hint', style: 'margin-bottom:8px;' },
        kind === 'removal' ? `Reason for removal: ${rec.removal_reason || '—'}` : `Reason for adding: ${rec.add_reason || '—'}`),
      field('Your comment (sent to Admin) *', note),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: `btn ${kind === 'removal' ? 'danger' : 'primary'}`, onclick: async () => {
        if (!note.value.trim()) return toast('A comment is required before sending to Admin', 'error');
        await decide(type, rec, 'approve', { note: note.value.trim() });
        close();
      } }, kind === 'removal' ? 'Approve removal' : 'Approve'),
    ]);
  }

  async function decide(type, rec, action, extra = {}) {
    try {
      const r = await api('/verification/decide', { method: 'POST', body: { type, id: rec.id, action, ...extra } });
      let msg;
      if (action === 'merge') msg = `${rec.name} merged`;
      else if (r.final) msg = r.kind === 'removal' ? `${rec.name} removed from master` : `${rec.name} fully verified into master`;
      else msg = r.kind === 'removal'
        ? `Removal of ${rec.name} approved — forwarded to ${STAGE_LABEL[r.next] || r.next}`
        : `${rec.name} approved — forwarded to ${STAGE_LABEL[r.next] || r.next}`;
      toast(msg, 'success');
      load();
    } catch { /* toast shown */ }
  }

  function mergeModal(type, rec, masters) {
    const target = select(masters.filter((m) => m.id !== rec.id).map((m) => [m.id, `${m.name} (${m.id})`]));
    modal(`Merge "${rec.name}" into master record`, [
      h('div', { class: 'hint', style: 'margin-bottom:10px;' },
        'Use this when the field entry is a duplicate or misspelling. Its activity participations, chemist links and sales rows move to the selected master account, then the duplicate is deleted.'),
      field('Master account', target),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => { await decide(type, rec, 'merge', { mergeTargetId: target.value }); close(); } }, 'Merge'),
    ]);
  }

  await load();
}
