import { api, session } from '../api.js';
import { h, toast } from '../ui.js';

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

  const demo = (mail) => h('button', {
    type: 'button', class: 'chip',
    onclick: () => { email.value = mail; password.value = 'demo123'; },
  }, mail.split('@')[0]);

  return h('div', { class: 'login-wrap' },
    h('form', { class: 'login-card', onsubmit: submit },
      h('div', { class: 'logo' }, h('div', { class: 'logo-mark' }, 'P'), 'PharmaTrack'),
      h('div', { class: 'tagline' }, 'Marketing Activity Management & ROI Intelligence'),
      h('div', { class: 'field' }, h('label', {}, 'Email'), email),
      h('div', { class: 'field' }, h('label', {}, 'Password'), password),
      h('button', { class: 'btn primary', style: 'width:100%; padding:10px;' }, 'Sign in'),
      h('div', { class: 'demo-chips' },
        h('span', { class: 'hint', style: 'width:100%; text-align:center;' }, 'Demo accounts (password: demo123)'),
        demo('kenya@pharmatrack.demo'), demo('tanzania@pharmatrack.demo'),
        demo('amit@pharmatrack.demo'), demo('kavita@pharmatrack.demo'), demo('admin@pharmatrack.demo'))));
}
