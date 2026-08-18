import { api, session } from '../api.js';
import { h, toast, BRAND_SVG } from '../ui.js';

export default function loginPage(onSuccess) {
  const email = h('input', { type: 'email', placeholder: 'you@company.com', autocomplete: 'username' });
  const password = h('input', { type: 'password', placeholder: '••••••••', autocomplete: 'current-password' });

  async function submit(e) {
    e.preventDefault();
    try {
      const { token, user } = await api('/auth/login', { method: 'POST', body: { email: email.value, password: password.value } });
      session.set(token, user);
      toast(`Welcome back, ${user.name.split(' ')[0]}!`, 'success');
      onSuccess();
    } catch { /* toast already shown */ }
  }

  // Demo accounts grouped by role. Kept in one compact dropdown instead of a wall of chips.
  const DEMO_GROUPS = [
    ['Sales reps (SER)', [
      ['kenya@pharmatrack.demo', 'Kenya'], ['uganda@pharmatrack.demo', 'Uganda'],
      ['tanzania@pharmatrack.demo', 'Tanzania'], ['rwanda@pharmatrack.demo', 'Rwanda'],
      ['mauritius@pharmatrack.demo', 'Mauritius'], ['zambia@pharmatrack.demo', 'Zambia'],
    ]],
    ['Cluster Leads (CLM)', [
      ['clm.kenya@pharmatrack.demo', 'CLM · Kenya'], ['clm.uganda@pharmatrack.demo', 'CLM · Uganda'],
      ['clm.tanzania@pharmatrack.demo', 'CLM · Tanzania'], ['clm.rwanda@pharmatrack.demo', 'CLM · Rwanda'],
      ['clm.mauritius@pharmatrack.demo', 'CLM · Mauritius'], ['clm.zambia@pharmatrack.demo', 'CLM · Zambia'],
    ]],
    ['Management & Head Office', [
      ['cm@pharmatrack.demo', 'Country Manager (all countries)'],
      ['amit@pharmatrack.demo', 'Marketing'], ['admin@pharmatrack.demo', 'Admin / Operations'],
    ]],
  ];

  const picker = h('select', {
    class: 'demo-select',
    style: 'width:100%; padding:9px 10px; border-radius:8px;',
    onchange: (e) => { if (e.target.value) { email.value = e.target.value; password.value = 'demo123'; password.focus(); } },
  },
    h('option', { value: '' }, 'Quick demo login — choose an account…'),
    DEMO_GROUPS.map(([label, items]) =>
      h('optgroup', { label },
        items.map(([mail, name]) => h('option', { value: mail }, name)))));

  return h('div', { class: 'login-wrap' },
    h('form', { class: 'login-card', onsubmit: submit },
      h('div', { class: 'logo' }, h('div', { class: 'logo-mark', html: BRAND_SVG }), 'Pharos'),
      h('div', { class: 'tagline' }, 'Illuminate every move in the field.'),
      h('div', { class: 'field' }, h('label', {}, 'Email'), email),
      h('div', { class: 'field' }, h('label', {}, 'Password'), password),
      h('button', { class: 'btn primary', style: 'width:100%; padding:10px;' }, 'Sign in'),
      h('div', { class: 'field', style: 'margin-top:14px;' },
        h('label', {}, 'Demo accounts'),
        picker,
        h('span', { class: 'hint', style: 'display:block; margin-top:4px;' }, 'Password for every demo account: demo123'))));
}
