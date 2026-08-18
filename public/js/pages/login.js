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
      ['kenya@pharos.demo', 'Kenya'], ['uganda@pharos.demo', 'Uganda'],
      ['tanzania@pharos.demo', 'Tanzania'], ['rwanda@pharos.demo', 'Rwanda'],
      ['mauritius@pharos.demo', 'Mauritius'], ['zambia@pharos.demo', 'Zambia'],
    ]],
    ['Cluster Leads (CLM)', [
      ['clm.kenya@pharos.demo', 'CLM · Kenya'], ['clm.uganda@pharos.demo', 'CLM · Uganda'],
      ['clm.tanzania@pharos.demo', 'CLM · Tanzania'], ['clm.rwanda@pharos.demo', 'CLM · Rwanda'],
      ['clm.mauritius@pharos.demo', 'CLM · Mauritius'], ['clm.zambia@pharos.demo', 'CLM · Zambia'],
    ]],
    ['Management & Head Office', [
      ['cm@pharos.demo', 'Country Manager (all countries)'],
      ['amit@pharos.demo', 'Marketing'], ['admin@pharos.demo', 'Admin / Operations'],
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
