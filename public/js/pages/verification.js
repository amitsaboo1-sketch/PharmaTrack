import { api } from '../api.js';
import { h, table, toast, modal, field, select } from '../ui.js';

export default async function verificationPage(root) {
  const box = h('div');
  root.append(
    h('div', { class: 'hint', style: 'margin-bottom:12px;' },
      'Field reps can register doctors/chemists on the fly. Approve them into the master list, or merge duplicates into the correct master record (all activity links, mappings and sales rows are re-pointed automatically).'),
    box);

  async function load() {
    const pending = await api('/verification/pending');
    box.innerHTML = '';

    const section = (title, rows, type, masters) => h('div', { class: 'card', style: 'margin-bottom:14px;' },
      h('h3', {}, `${title} (${rows.length})`),
      rows.length
        ? table(['ID', 'Name', 'Details', 'Added by', 'Actions'],
            rows.map((r) => [
              r.id, h('b', {}, r.name),
              type === 'hcp' ? `${r.speciality || '—'} · ${r.clinic || r.city || ''}` : r.address || '—',
              r.created_by || r.rep_id || '—',
              h('div', { style: 'display:flex; gap:6px;' },
                h('button', { class: 'btn sm success', onclick: () => decide(type, r, 'approve') }, 'Approve to master'),
                h('button', { class: 'btn sm', onclick: () => mergeModal(type, r, masters) }, 'Merge…'))]))
        : h('div', { class: 'empty' }, 'Nothing pending'));

    const [hcps, chemists] = await Promise.all([api('/hcps?verified=1'), api('/chemists')]);
    box.append(
      section('Unverified Doctors', pending.hcps, 'hcp', hcps),
      section('Unverified Chemists', pending.chemists, 'chemist', chemists.filter((c) => c.verified)));
  }

  async function decide(type, rec, action, mergeTargetId) {
    await api('/verification/decide', { method: 'POST', body: { type, id: rec.id, action, mergeTargetId } });
    toast(action === 'approve' ? `${rec.name} approved to master` : `${rec.name} merged`, 'success');
    load();
  }

  function mergeModal(type, rec, masters) {
    const target = select(masters.filter((m) => m.id !== rec.id).map((m) => [m.id, `${m.name} (${m.id})`]));
    modal(`Merge "${rec.name}" into master record`, [
      h('div', { class: 'hint', style: 'margin-bottom:10px;' },
        'Use this when the field entry is a duplicate or misspelling. Its activity participations, chemist links and sales rows move to the selected master account, then the duplicate is deleted.'),
      field('Master account', target),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => { await decide(type, rec, 'merge', target.value); close(); } }, 'Merge'),
    ]);
  }

  await load();
}
