import { api, session, download } from '../api.js';
import { h, table, fmtMoney, modal, field, select, toast } from '../ui.js';

// Reusable HO bulk import wizard for master data (doctors / chemists).
function masterImportWizard(base, title, onDone) {
  let csvText = '', filename = '';
  const body = h('div');
  modal(`Import ${title}`, [body], (close) => [h('button', { class: 'btn', onclick: close }, 'Close')]);

  const stepper = (active) => h('div', { class: 'step-tabs' },
    ['1 · Upload', '2 · Validate', '3 · Commit'].map((l, i) =>
      h('span', { class: `step ${i + 1 === active ? 'active' : i + 1 < active ? 'done' : ''}` }, l)));

  function stepUpload() {
    const fileInput = h('input', { type: 'file', accept: '.csv,text/csv' });
    body.innerHTML = '';
    body.append(stepper(1),
      h('div', { class: 'hint', style: 'margin:10px 0;' },
        `Upload a CSV to bulk add/update ${title.toLowerCase()}. Each row's rep_code assigns the account to a rep, so it shows up on that rep's interface. Rows with an existing id are updated; blank id creates a new record.`),
      h('div', { style: 'display:flex; gap:10px; align-items:center; flex-wrap:wrap;' },
        fileInput,
        h('button', { class: 'btn', onclick: () => download(`/masters/${base}/template`, `${base}_template.csv`) }, '⬇ Download template'),
        h('button', { class: 'btn primary', onclick: async () => {
          const f = fileInput.files[0];
          if (!f) return toast('Choose a CSV file first', 'error');
          filename = f.name; csvText = await f.text();
          stepValidate();
        } }, 'Validate →')));
  }

  async function stepValidate() {
    const v = await api(`/masters/${base}/validate`, { method: 'POST', body: { csvText } });
    body.innerHTML = '';
    body.append(stepper(2),
      h('div', { class: 'grid cards-4', style: 'margin:10px 0;' },
        mini('Rows', v.totalRows), mini('New', v.inserts, 'var(--accent)'),
        mini('Updates', v.updates, 'var(--primary)'), mini('Errors', v.errorCount, v.errorCount ? 'var(--danger)' : undefined)),
      v.errorCount ? h('div', {}, h('h3', {}, 'Errors (fix in the file and re-upload)'),
        table(['Row', 'Problem'], v.errors.map((e) => [String(e.row), e.reason]))) : null,
      v.warnings.length ? h('div', { style: 'margin-top:10px;' }, h('h3', {}, 'Warnings'),
        table(['Row', 'Warning'], v.warnings.map((w) => [String(w.row), w.reason]))) : null,
      h('div', { style: 'display:flex; gap:10px; margin-top:14px;' },
        h('button', { class: 'btn', onclick: stepUpload }, '← Back'),
        h('button', { class: 'btn success', disabled: v.errorCount > 0 || v.validCount === 0 ? true : undefined,
          onclick: () => commit(v) }, `Import ${v.validCount} row(s)`)));
  }

  async function commit(v) {
    try {
      const r = await api(`/masters/${base}/import`, { method: 'POST', body: { csvText, filename } });
      body.innerHTML = '';
      body.append(stepper(3),
        h('div', { class: 'card', style: 'margin-top:12px;' },
          h('h3', {}, '✅ Import complete'),
          h('p', {}, `${r.inserted} added · ${r.updated} updated. Records now appear on the assigned reps' interface.`)),
        h('button', { class: 'btn primary', style: 'margin-top:12px;', onclick: () => { onDone(); stepUpload(); } }, 'Done'));
      onDone();
    } catch { stepValidate(); }
  }

  function mini(label, value, color) {
    return h('div', { class: 'card kpi', style: 'padding:12px;' },
      h('div', { class: 'label' }, label),
      h('div', { class: 'value', style: `font-size:20px;${color ? `color:${color};` : ''}` }, String(value)));
  }
  stepUpload();
}

export default async function mastersPage(root, tab) {
  const user = session.user;
  if (tab === 'doctors') return doctors(root, user);
  if (tab === 'chemists') return chemists(root, user);
  if (tab === 'brands') return brands(root);
  if (tab === 'users') return users(root);
}

async function doctors(root, user) {
  const search = h('input', { placeholder: 'Search doctors…' });
  const listBox = h('div');
  root.append(h('div', { class: 'page-head' },
    h('div', { class: 'filters' }, search),
    h('div', { class: 'spacer' }),
    user.role === 'ho'
      ? h('div', { style: 'display:flex; gap:8px;' },
          h('button', { class: 'btn', onclick: () => masterImportWizard('doctors', 'Doctors', load) }, '⬆ Import'),
          h('button', { class: 'btn', onclick: () => download('/masters/doctors/export', 'doctors.csv') }, '⬇ Export'),
          h('button', { class: 'btn primary', onclick: () => addDoctorModal(load) }, '+ Add Doctor'))
      : h('button', { class: 'btn primary', onclick: () => addAdhocModal('hcp', load) }, '+ Add Doctor (field)')),
    listBox);

  async function load() {
    const hcps = await api(`/hcps${search.value ? `?q=${encodeURIComponent(search.value)}` : ''}`);
    listBox.innerHTML = '';
    listBox.append(h('div', { class: 'card' },
      table(['ID', 'Name', 'Speciality', 'Hospital / Clinic', 'Location', 'Class', 'Category', 'Status'],
        hcps.map((x) => [
          x.id, h('b', {}, x.name), x.speciality || '—', x.clinic || '—', x.city || '—',
          tierPill(x.class), h('span', { style: 'font-weight:600;' }, x.category || '—'),
          x.verified ? h('span', { class: 'badge ok' }, 'Verified') : h('span', { class: 'badge unverified' }, 'Unverified'),
        ]),
        (i) => (location.hash = `#/doctor/${hcps[i].id}`))));
  }
  search.addEventListener('input', () => load());
  await load();
}

const CLASSES = ['Diamond', 'Ruby', 'Pearl', 'Opal'];
const CATEGORIES = ['A', 'B', 'C'];

export function tierPill(cls) {
  const c = { Diamond: '#4f46e5', Ruby: '#dc2626', Pearl: '#0891b2', Opal: '#7c3aed' }[cls] || '#6b7280';
  return h('span', { style: `display:inline-flex; align-items:center; gap:5px; font-weight:700; color:${c};` },
    h('span', { style: `width:8px; height:8px; border-radius:999px; background:${c};` }), cls || '—');
}

// Reusable chemist multi-select (link chemists to the doctor right here).
function chemistPicker(chemists) {
  const picked = new Set();
  const box = h('div', { class: 'check-list', style: 'max-height:150px;' });
  const search = h('input', { placeholder: 'Search chemists…', style: 'margin-bottom:6px;' });
  const render = () => {
    const query = search.value.toLowerCase();
    box.innerHTML = '';
    chemists.filter((c) => c.name.toLowerCase().includes(query)).forEach((c) => {
      const cb = h('input', { type: 'checkbox', checked: picked.has(c.id) || undefined, onchange: () => (cb.checked ? picked.add(c.id) : picked.delete(c.id)) });
      box.append(h('label', { class: 'check-item' }, cb, c.name, h('span', { class: 'meta' }, c.city || '')));
    });
  };
  search.addEventListener('input', render);
  render();
  return { node: h('div', {}, search, box), get: () => [...picked] };
}

async function addDoctorModal(onDone) {
  const [chemists, reps] = await Promise.all([api('/chemists'), api('/performance/reps').catch(() => [])]);
  const f = {
    name: h('input', { placeholder: 'Dr. Full Name *' }),
    speciality: h('input', { placeholder: 'e.g. Cardiology' }),
    clinic: h('input', { placeholder: 'Hospital / Clinic name *' }),
    city: h('input', { placeholder: 'City / area *' }),
    rep: select([['', '— assign rep —'], ...reps.map((r) => [r.repId, `${r.name} (${r.country})`])]),
    cls: select(CLASSES.map((c) => [c, c])),
    cat: select(CATEGORIES.map((c) => [c, c])),
  };
  const chem = chemistPicker(chemists);

  modal('Add Doctor to Master', [
    h('div', { class: 'form-row' }, field('Name *', f.name), field('Speciality', f.speciality)),
    h('div', { class: 'form-row' }, field('Hospital / Clinic *', f.clinic), field('Location *', f.city)),
    h('div', { class: 'form-row' }, field('Class', f.cls), field('Category', f.cat)),
    field('Assigned Rep', f.rep),
    h('div', { class: 'field' }, h('label', {}, 'Map chemists (dispensing pharmacies for this doctor)'), chem.node),
  ], (close) => [
    h('button', { class: 'btn', onclick: close }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: async () => {
      if (!f.name.value.trim()) return toast('Name is required', 'error');
      if (!f.clinic.value.trim() || !f.city.value.trim()) return toast('Hospital/Clinic and Location are required', 'error');
      const rep = reps.find((r) => r.repId === f.rep.value);
      await api('/hcps', { method: 'POST', body: {
        name: f.name.value, speciality: f.speciality.value, clinic: f.clinic.value, city: f.city.value,
        territory: rep ? rep.country : '', repId: f.rep.value || null, class: f.cls.value, category: f.cat.value,
        chemistIds: chem.get(),
      } });
      toast('Doctor added', 'success'); close(); onDone();
    } }, 'Add Doctor'),
  ]);
}

export async function addAdhocModal(type, onDone) {
  if (type === 'chemist') {
    const name = h('input', { placeholder: 'Name *' });
    const ctype = select(CHEMIST_TYPES.map((t) => [t, t]));
    const addr = h('input', { placeholder: 'Address' });
    return modal('Add chemist / wholesaler from the field', [
      h('div', { class: 'hint', style: 'margin-bottom:10px;' }, 'Usable immediately; stays "unverified" until Head Office approves or merges it.'),
      h('div', { class: 'form-row' }, field('Name *', name), field('Type', ctype)),
      field('Address', addr),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!name.value.trim()) return toast('Name is required', 'error');
        await api('/chemists/adhoc', { method: 'POST', body: { name: name.value, type: ctype.value, address: addr.value } });
        toast('Added — pending HO verification', 'success'); close(); onDone();
      } }, 'Add'),
    ]);
  }

  const chemists = await api('/chemists');
  const f = {
    name: h('input', { placeholder: 'Dr. Full Name *' }), speciality: h('input', { placeholder: 'e.g. Cardiology' }),
    clinic: h('input', { placeholder: 'Hospital / Clinic name *' }), city: h('input', { placeholder: 'City / area *' }),
    cls: select(CLASSES.map((c) => [c, c])), cat: select(CATEGORIES.map((c) => [c, c])),
  };
  const chem = chemistPicker(chemists);
  modal('Add doctor from the field', [
    h('div', { class: 'hint', style: 'margin-bottom:10px;' }, 'Usable immediately; stays "unverified" until Head Office approves or merges it.'),
    h('div', { class: 'form-row' }, field('Name *', f.name), field('Speciality', f.speciality)),
    h('div', { class: 'form-row' }, field('Hospital / Clinic *', f.clinic), field('Location *', f.city)),
    h('div', { class: 'form-row' }, field('Class', f.cls), field('Category', f.cat)),
    h('div', { class: 'field' }, h('label', {}, 'Map chemists for this doctor'), chem.node),
  ], (close) => [
    h('button', { class: 'btn', onclick: close }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: async () => {
      if (!f.name.value.trim()) return toast('Name is required', 'error');
      if (!f.clinic.value.trim() || !f.city.value.trim()) return toast('Hospital/Clinic and Location are required', 'error');
      await api('/hcps/adhoc', { method: 'POST', body: {
        name: f.name.value, speciality: f.speciality.value, clinic: f.clinic.value, city: f.city.value,
        class: f.cls.value, category: f.cat.value, chemistIds: chem.get(),
      } });
      toast('Added — pending HO verification', 'success'); close(); onDone();
    } }, 'Add Doctor'),
  ]);
}

const CHEMIST_TYPES = ['Retail', 'Wholesaler', 'Stockist'];

function typePill(type) {
  const c = { Retail: '#0891b2', Wholesaler: '#7c3aed', Stockist: '#d97706' }[type] || '#6b7280';
  return h('span', { style: `display:inline-flex; align-items:center; gap:5px; font-weight:700; color:${c};` },
    h('span', { style: `width:8px; height:8px; border-radius:999px; background:${c};` }), type || 'Retail');
}

async function chemists(root, user) {
  const listBox = h('div');
  root.append(h('div', { class: 'page-head' },
    h('div', { class: 'hint' }, 'Chemists, wholesalers and stockists. Trade activities on these accounts are measured for marketing effectiveness too.'),
    h('div', { class: 'spacer' }),
    user.role === 'ho'
      ? h('div', { style: 'display:flex; gap:8px;' },
          h('button', { class: 'btn', onclick: () => masterImportWizard('chemists', 'Chemists / Wholesalers', load) }, '⬆ Import'),
          h('button', { class: 'btn', onclick: () => download('/masters/chemists/export', 'chemists.csv') }, '⬇ Export'),
          h('button', { class: 'btn primary', onclick: () => addChemistModal(load) }, '+ Add Chemist'))
      : h('button', { class: 'btn primary', onclick: () => addAdhocModal('chemist', load) }, '+ Add Chemist (field)')),
    listBox);
  async function load() {
    const rows = await api('/chemists');
    listBox.innerHTML = '';
    listBox.append(h('div', { class: 'card' },
      table(['ID', 'Name', 'Type', 'Address', 'City', 'Status'],
        rows.map((c) => [c.id, h('b', {}, c.name), typePill(c.type), c.address || '—', c.city || '—',
          c.verified ? h('span', { class: 'badge ok' }, 'Verified') : h('span', { class: 'badge unverified' }, 'Unverified')]),
        (i) => (location.hash = `#/chemist/${rows[i].id}`))));
  }
  await load();
}

function addChemistModal(onDone) {
  const name = h('input', { placeholder: 'Name *' });
  const type = select(CHEMIST_TYPES.map((t) => [t, t]));
  const address = h('input', { placeholder: 'Address' });
  const city = h('input', { placeholder: 'City / area' });
  modal('Add Chemist / Wholesaler', [
    h('div', { class: 'form-row' }, field('Name *', name), field('Type', type)),
    h('div', { class: 'form-row' }, field('Address', address), field('City', city)),
  ], (close) => [
    h('button', { class: 'btn', onclick: close }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: async () => {
      if (!name.value.trim()) return toast('Name is required', 'error');
      await api('/chemists', { method: 'POST', body: { name: name.value, type: type.value, address: address.value, city: city.value } });
      toast('Chemist added', 'success'); close(); onDone();
    } }, 'Add'),
  ]);
}

async function brands(root) {
  const [brandRows, productRows, countries] = await Promise.all([api('/brands'), api('/products'), api('/countries')]);

  root.append(h('div', { class: 'card', style: 'margin-bottom:14px;' },
    h('div', { style: 'display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;' },
      h('h3', { style: 'margin:0;' }, 'Brands'),
      h('button', { class: 'btn sm primary', onclick: addBrand }, '+ Brand')),
    table(['ID', 'Name', 'Therapy Area'], brandRows.map((b) => [b.id, h('b', {}, b.name), b.therapy_area || '—']))));

  const PTR_ORDER = ['KE', 'UG', 'TZ', 'MU', 'ZM', 'RW'];
  const orderedCountries = [...countries].sort((a, b) => PTR_ORDER.indexOf(a.code) - PTR_ORDER.indexOf(b.code));
  const countrySel = select([['', 'All countries'], ...orderedCountries.map((c) => [c.code, c.name])],
    { onchange: renderProducts, style: 'max-width:190px;' });

  const productsBox = h('div');
  root.append(h('div', { class: 'card' },
    h('div', { style: 'display:flex; justify-content:space-between; align-items:center; gap:10px; margin-bottom:6px; flex-wrap:wrap;' },
      h('div', { style: 'display:flex; align-items:center; gap:10px;' },
        h('h3', { style: 'margin:0;' }, 'Products'), countrySel),
      h('button', { class: 'btn sm primary', onclick: addProduct }, '+ Product')),
    h('div', { class: 'hint', style: 'margin-bottom:10px;' }, 'No MRP — each product carries a per-country PTR (Price to Retailer) in local currency. Filter by country to focus on one market.'),
    productsBox));
  renderProducts();

  function priceFor(p, code) {
    return (p.prices || []).find((pr) => pr.country_code === code);
  }

  function renderProducts() {
    productsBox.innerHTML = '';
    const code = countrySel.value;
    if (code) {
      // Single-country view: one clean PTR column for the selected market.
      const country = countries.find((c) => c.code === code) || {};
      productsBox.append(table(['Product', 'Brand', 'Pack', `PTR (${country.currency_code || ''})`, ''],
        productRows.map((p) => {
          const pr = priceFor(p, code);
          return [
            h('div', {}, h('b', {}, p.name), h('div', { class: 'sub' }, p.id)),
            p.brand_name, p.pack || '—',
            pr ? h('b', {}, fmtMoney(pr.ptr, country.currency_code)) : h('span', { class: 'hint' }, 'not marketed'),
            h('button', { class: 'btn sm', onclick: () => managePrices(p) }, 'Set PTR'),
          ];
        })));
      return;
    }
    // All countries: compact price matrix — one column per market, values in local currency.
    const headers = [
      'Product', 'Brand',
      ...orderedCountries.map((c) => h('div', { style: 'line-height:1.15;' },
        h('div', { style: 'font-weight:700;' }, c.code),
        h('div', { style: 'font-size:10px; color:var(--muted); font-weight:400;' }, c.currency_code))),
      '',
    ];
    productsBox.append(table(headers,
      productRows.map((p) => [
        h('div', {}, h('b', {}, p.name), h('div', { class: 'sub' }, p.id)),
        p.brand_name,
        ...orderedCountries.map((c) => {
          const pr = priceFor(p, c.code);
          return pr
            ? h('span', { style: 'font-variant-numeric:tabular-nums;' }, fmtMoney(pr.ptr))
            : h('span', { style: 'color:var(--muted);' }, '—');
        }),
        h('button', { class: 'btn sm', onclick: () => managePrices(p) }, 'Set PTR'),
      ])));
  }

  // Per-country PTR grid: one row per country with a PTR input (blank = not marketed).
  function priceGrid(existing) {
    const byCountry = Object.fromEntries((existing || []).map((p) => [p.country_code, p.ptr]));
    const inputs = countries.map((c) => {
      const inp = h('input', { type: 'number', min: 0, placeholder: `PTR in ${c.currency_code}`, style: 'width:150px;',
        value: byCountry[c.code] != null ? byCountry[c.code] : '' });
      return { code: c.code, inp,
        row: h('div', { class: 'check-item', style: 'gap:10px;' },
          h('span', { style: 'width:150px;' }, `${c.name}`),
          h('span', { class: 'hint', style: 'width:44px;' }, c.currency_code), inp) };
    });
    return {
      node: h('div', { class: 'check-list', style: 'max-height:230px;' }, inputs.map((x) => x.row)),
      get: () => inputs.map((x) => ({ country: x.code, ptr: Number(x.inp.value) })).filter((x) => x.ptr > 0),
    };
  }

  function addBrand() {
    const name = h('input', { placeholder: 'Brand name *' });
    const ta = h('input', { placeholder: 'Therapy area' });
    modal('Add Brand', [field('Name *', name), field('Therapy area', ta)], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!name.value.trim()) return toast('Name required', 'error');
        await api('/brands', { method: 'POST', body: { name: name.value, therapyArea: ta.value } });
        toast('Brand added', 'success'); close(); location.reload();
      } }, 'Add'),
    ]);
  }

  function addProduct() {
    const name = h('input', { placeholder: 'Product name *' });
    const brandSel = select(brandRows.map((b) => [b.id, b.name]));
    const pack = h('input', { placeholder: '10x10 Tab' });
    const sku = h('input', { placeholder: 'SKU' });
    const grid = priceGrid([]);
    modal('Add Product', [
      h('div', { class: 'form-row' }, field('Name *', name), field('Brand *', brandSel)),
      h('div', { class: 'form-row' }, field('Pack', pack), field('SKU', sku)),
      h('div', { class: 'field' }, h('label', {}, 'PTR (Price to Retailer) per country — leave blank where not marketed'), grid.node),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!name.value.trim()) return toast('Name required', 'error');
        await api('/products', { method: 'POST', body: { name: name.value, brandId: brandSel.value, pack: pack.value, sku: sku.value, prices: grid.get() } });
        toast('Product added', 'success'); close(); location.reload();
      } }, 'Add'),
    ]);
  }

  function managePrices(p) {
    const grid = priceGrid(p.prices);
    modal(`PTR by country — ${p.name}`, [
      h('div', { class: 'hint', style: 'margin-bottom:10px;' }, 'Set the Price to Retailer in each country\'s local currency. Clear a value to stop marketing the product there.'),
      grid.node,
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        await api(`/products/${p.id}/prices`, { method: 'PUT', body: { prices: grid.get() } });
        toast('PTR updated', 'success'); close();
        p.prices = grid.get().map((x) => ({ country_code: x.country, ptr: x.ptr, currency_code: (countries.find((c) => c.code === x.country) || {}).currency_code }));
        renderProducts();
      } }, 'Save PTR'),
    ]);
  }
}

async function users(root) {
  const listBox = h('div');
  root.append(h('div', { class: 'page-head' },
    h('div', { class: 'spacer' }),
    h('button', { class: 'btn primary', onclick: addUser }, '+ Add User')),
    listBox);

  async function load() {
    const rows = await api('/users');
    listBox.innerHTML = '';
    listBox.append(h('div', { class: 'card' },
      table(['ID', 'Name', 'Email', 'Role', 'Territory', 'Active'],
        rows.map((u) => [u.id, h('b', {}, u.name), u.email, `${u.role} · ${u.sub_role}`, u.territory || '—',
          u.active ? h('span', { class: 'badge ok' }, 'Active') : h('span', { class: 'badge rejected' }, 'Disabled')]))));
  }

  function addUser() {
    const f = {
      name: h('input', { placeholder: 'Full name *' }), email: h('input', { type: 'email', placeholder: 'email *' }),
      role: select([['sales', 'Sales'], ['ho', 'Head Office']]),
      subRole: select([['Medical Representative', 'Medical Representative'], ['Territory Manager', 'Territory Manager'], ['Area Manager', 'Area Manager'], ['Regional Manager', 'Regional Manager'], ['Product Manager', 'Product Manager'], ['Marketing Head', 'Marketing Head'], ['Finance', 'Finance'], ['Admin', 'Admin']]),
      territory: h('input', { placeholder: 'Territory' }),
    };
    modal('Add User', [
      h('div', { class: 'form-row' }, field('Name *', f.name), field('Email *', f.email)),
      h('div', { class: 'form-row' }, field('Role group', f.role), field('Designation', f.subRole)),
      field('Territory', f.territory),
    ], (close) => [
      h('button', { class: 'btn', onclick: close }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: async () => {
        if (!f.name.value.trim() || !f.email.value.trim()) return toast('Name and email required', 'error');
        const r = await api('/users', { method: 'POST', body: { name: f.name.value, email: f.email.value, role: f.role.value, subRole: f.subRole.value, territory: f.territory.value } });
        toast(`User created — initial password: ${r.initialPassword}`, 'success');
        close(); load();
      } }, 'Create'),
    ]);
  }
  await load();
}
