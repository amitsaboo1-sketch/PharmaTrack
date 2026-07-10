import { api } from '../api.js';
import { h, toast, select } from '../ui.js';

export default async function mappingsPage(root) {
  const box = h('div');
  root.append(
    h('div', { class: 'hint', style: 'margin-bottom:12px;' },
      'A doctor can dispense through several pharmacies — link each doctor to all their chemists. ' +
      'The ROI engine attributes every mapped chemist\'s monthly sales to that doctor.'),
    box);

  async function load() {
    const [hcps, chemists, mappings] = await Promise.all([api('/hcps'), api('/chemists'), api('/mappings')]);
    const chemById = Object.fromEntries(chemists.map((c) => [c.id, c]));
    const byDoctor = {};
    mappings.forEach((m) => { (byDoctor[m.hcp_id] = byDoctor[m.hcp_id] || []).push(m.chemist_id); });

    box.innerHTML = '';
    if (!hcps.length) { box.append(h('div', { class: 'empty' }, 'No doctors in your territory yet.')); return; }

    box.append(h('div', { class: 'grid', style: 'gap:12px;' },
      hcps.map((doc) => {
        const linked = byDoctor[doc.id] || [];
        const available = chemists.filter((c) => !linked.includes(c.id));
        const chemSel = available.length ? select(available.map((c) => [c.id, c.name])) : null;

        const chips = h('div', { style: 'display:flex; flex-wrap:wrap; gap:6px; margin:8px 0;' },
          linked.length
            ? linked.map((cid) => h('span', {
                style: 'display:inline-flex; align-items:center; gap:6px; background:var(--primary-soft); color:var(--primary); border-radius:999px; padding:4px 10px; font-size:12.5px; font-weight:600;',
              },
              chemById[cid] ? chemById[cid].name : cid,
              h('button', {
                style: 'border:0; background:none; color:var(--primary); cursor:pointer; font-weight:700;',
                title: 'Unlink',
                onclick: async () => {
                  await api(`/mappings?hcpId=${doc.id}&chemistId=${cid}`, { method: 'DELETE' });
                  toast('Chemist unlinked'); load();
                },
              }, '✕')))
            : [h('span', { class: 'hint' }, 'No chemists linked yet')]);

        return h('div', { class: 'card' },
          h('div', { style: 'display:flex; justify-content:space-between; align-items:center;' },
            h('div', {},
              h('a', { href: `#/doctor/${doc.id}`, style: 'font-weight:700; font-size:14px;' }, doc.name),
              h('span', { class: 'hint', style: 'margin-left:8px;' }, `${doc.speciality || ''} · ${doc.city || ''}`)),
            h('span', { class: 'badge approved' }, `${linked.length} chemist${linked.length === 1 ? '' : 's'}`)),
          chips,
          available.length
            ? h('div', { style: 'display:flex; gap:8px; align-items:center;' },
                chemSel,
                h('button', { class: 'btn sm primary', onclick: async () => {
                  await api('/mappings', { method: 'POST', body: { hcpId: doc.id, chemistId: chemSel.value } });
                  toast('Chemist linked'); load();
                } }, '+ Link chemist'))
            : h('div', { class: 'hint' }, 'All chemists in your territory are linked to this doctor.'));
      })));
  }
  await load();
}
