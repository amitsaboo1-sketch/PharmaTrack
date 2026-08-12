import { api, session } from '../api.js';
import { h, table, badge, fmtMoney, fmtDate, modal, field, select, toast } from '../ui.js';

export default async function activitiesPage(root) {
  const user = session.user;
  const filters = { status: '', type: '' };

  const listBox = h('div');
  const statusSel = select([['', 'All Status'], ...['draft', 'submitted', 'approved', 'returned', 'rejected', 'executed'].map((s) => [s, s])],
    { onchange: (e) => { filters.status = e.target.value; load(); } });
  const types = await api('/activity-types');
  const typeSel = select([['', 'All types'], ...types.map((t) => [t.id, t.name])],
    { onchange: (e) => { filters.type = e.target.value; load(); } });

  root.append(
    h('div', { class: 'page-head' },
      h('div', { class: 'filters' }, statusSel, typeSel),
      h('div', { class: 'spacer' }),
      user.role === 'sales'
        ? h('button', { class: 'btn primary', onclick: () => proposeModal(types, load) }, '+ Propose Activity')
        : null),
    listBox);

  async function load() {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    const acts = await api(`/activities${qs ? '?' + qs : ''}`);
    listBox.innerHTML = '';
    listBox.append(h('div', { class: 'card' },
      table(['Activity', 'Type', 'Brand', 'Owner', 'Date', 'Est. Cost', 'Actual', 'HCPs (prop→att)', 'Status'],
        acts.map((a) => [
          h('div', {}, h('b', {}, a.title), h('div', { class: 'sub' }, a.id)),
          a.type_name || a.type_id,
          a.brand_name || '—',
          a.proposer_name,
          fmtDate(a.actual_date || a.planned_date),
          fmtMoney(a.estimated_cost),
          a.actual_cost != null ? fmtMoney(a.actual_cost) : '—',
          `${a.proposed_hcps} → ${a.attended_hcps}`,
          badge(a.status),
        ]),
        (i) => (location.hash = `#/activity/${acts[i].id}`))));
  }
  await load();
}

// ---------- proposal modal (2 steps) ----------
export async function proposeModal(types, onDone) {
  const [brands, products, hcps, chemists] = await Promise.all([
    api('/brands'), api('/products'), api('/hcps'), api('/chemists'),
  ]);

  const f = {
    title: h('input', { placeholder: 'e.g. Cardiology CME on Beta Blockers' }),
    type: select(types.map((t) => [t.id, t.name])),
    brand: select([['', '— select —'], ...brands.map((b) => [b.id, b.name])]),
    product: select([['', '— select —'], ...products.map((p) => [p.id, `${p.name} (${p.brand_name})`])]),
    date: h('input', { type: 'date' }),
    venue: h('input', { placeholder: 'Venue' }),
    cost: h('input', { type: 'number', min: 0, placeholder: '0' }),
    expectedSales: h('input', { type: 'number', min: 0, placeholder: '0' }),
    objective: h('textarea', { rows: 2, placeholder: 'What should this activity achieve?' }),
  };

  const picked = new Map(); // key -> {accountId, accountType}
  const checkList = (items, type) => {
    const box = h('div', { class: 'check-list' });
    const search = h('input', { placeholder: `Search ${type === 'hcp' ? 'doctors' : 'chemists'}…`, style: 'margin-bottom:6px;' });
    const render = () => {
      const q = search.value.toLowerCase();
      [...box.children].forEach((c) => c.remove());
      items.filter((x) => x.name.toLowerCase().includes(q)).forEach((x) => {
        const key = `${type}:${x.id}`;
        const cb = h('input', { type: 'checkbox', checked: picked.has(key) || undefined, onchange: () => (cb.checked ? picked.set(key, { accountId: x.id, accountType: type }) : picked.delete(key)) });
        box.append(h('label', { class: 'check-item' }, cb, x.name,
          h('span', { class: 'meta' }, type === 'hcp' ? `${x.speciality || ''} · ${x.class}${x.verified ? '' : ' · unverified'}` : `${x.type || 'Retail'} · ${x.city || ''}`)));
      });
    };
    search.addEventListener('input', render);
    render();
    return h('div', {}, search, box);
  };

  async function addAdhoc(type, refresh) {
    const name = h('input', { placeholder: 'Name *' });
    const extra = type === 'hcp' ? h('input', { placeholder: 'Speciality' }) : h('input', { placeholder: 'Address' });
    modal(`Add new ${type === 'hcp' ? 'doctor' : 'chemist'} (pending HO verification)`,
      [field('Name', name), field(type === 'hcp' ? 'Speciality' : 'Address', extra)],
      (close) => [
        h('button', { class: 'btn', onclick: close }, 'Cancel'),
        h('button', {
          class: 'btn primary', onclick: async () => {
            if (!name.value.trim()) return toast('Name is required', 'error');
            const body = type === 'hcp' ? { name: name.value, speciality: extra.value } : { name: name.value, address: extra.value };
            const r = await api(`/${type === 'hcp' ? 'hcps' : 'chemists'}/adhoc`, { method: 'POST', body });
            picked.set(`${type}:${r.id}`, { accountId: r.id, accountType: type });
            toast(`Added as unverified — HO will review`, 'success');
            close(); refresh();
          },
        }, 'Add'),
      ]);
  }

  function open() {
    modal('Propose Marketing Activity', [
      h('div', { class: 'form-row' }, field('Activity name *', f.title), field('Type *', f.type)),
      h('div', { class: 'form-row' }, field('Brand', f.brand), field('Product', f.product)),
      h('div', { class: 'form-row' }, field('Planned date', f.date), field('Venue', f.venue)),
      h('div', { class: 'form-row' }, field('Estimated cost (₹)', f.cost), field('Expected incremental sales (₹)', f.expectedSales)),
      field('Objective', f.objective),
      h('div', { class: 'form-row' },
        h('div', {},
          h('div', { style: 'display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;' },
            h('label', { style: 'font-size:12px; font-weight:600;' }, 'Target doctors'),
            h('button', { class: 'btn ghost sm', type: 'button', onclick: () => addAdhoc('hcp', open) }, '+ New doctor')),
          checkList(hcps, 'hcp')),
        h('div', {},
          h('div', { style: 'display:flex; align-items:center; justify-content:space-between; margin-bottom:5px;' },
            h('label', { style: 'font-size:12px; font-weight:600;' }, 'Target chemists'),
            h('button', { class: 'btn ghost sm', type: 'button', onclick: () => addAdhoc('chemist', open) }, '+ New chemist')),
          checkList(chemists, 'chemist'))),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn', onclick: () => save(false, close) }, 'Save draft'),
      h('button', { class: 'btn primary', onclick: () => save(true, close) }, 'Submit for approval'),
    ]);
  }

  async function save(submit, close) {
    if (!f.title.value.trim()) return toast('Activity name is required', 'error');
    if (submit && picked.size === 0) return toast('Select at least one target doctor or chemist', 'error');
    await api('/activities', {
      method: 'POST',
      body: {
        title: f.title.value, typeId: f.type.value, brandId: f.brand.value || null, productId: f.product.value || null,
        plannedDate: f.date.value || null, venue: f.venue.value, estimatedCost: Number(f.cost.value) || 0,
        expectedSales: Number(f.expectedSales.value) || 0, objective: f.objective.value,
        expectedHcpCount: [...picked.values()].filter((p) => p.accountType === 'hcp').length,
        targets: [...picked.values()], submit,
      },
    });
    toast(submit ? 'Proposal submitted for approval' : 'Draft saved', 'success');
    close();
    onDone && onDone();
  }

  open();
}
