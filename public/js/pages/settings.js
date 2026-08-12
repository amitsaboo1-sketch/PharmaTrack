import { api, session } from '../api.js';
import { h, field, toast } from '../ui.js';

export default async function settingsPage(root) {
  const user = session.user;

  // change password
  const oldPw = h('input', { type: 'password' });
  const newPw = h('input', { type: 'password' });
  root.append(h('div', { class: 'grid cols-2' },
    h('div', { class: 'card' },
      h('h3', {}, 'Change Password'),
      field('Current password', oldPw),
      field('New password (min 6 chars)', newPw),
      h('button', { class: 'btn primary', onclick: async () => {
        try {
          await api('/auth/change-password', { method: 'POST', body: { oldPassword: oldPw.value, newPassword: newPw.value } });
          toast('Password changed', 'success'); oldPw.value = newPw.value = '';
        } catch { /* toast shown */ }
      } }, 'Update password')),
    h('div', { class: 'card' },
      h('h3', {}, 'My Profile'),
      ...[['User ID', user.id], ['Name', user.name], ['Email', user.email],
          ['Role', `${user.role} · ${user.sub_role}`], ['Territory', user.territory || '—']]
        .map(([k, v]) => h('div', { style: 'display:flex; gap:10px; padding:5px 0; font-size:13px;' },
          h('div', { style: 'width:110px; color:var(--muted);' }, k), h('div', {}, v))))));

  // Marketing Effectiveness configuration (HO only; save requires Admin)
  if (user.role === 'ho') {
    const cfg = await api('/config');
    const winSel = h('select', {},
      ['3', '6'].map((v) => h('option', { value: v, selected: cfg.roi_window_months === v || undefined }, `${v} months`)));
    const margin = h('input', { type: 'number', min: 1, max: 100, value: cfg.gross_margin_pct });
    const overrun = h('input', { type: 'number', min: 100, max: 300, value: cfg.overrun_threshold_pct });
    const isAdmin = user.sub_role === 'Admin';
    root.append(h('div', { class: 'card', style: 'margin-top:14px;' },
      h('h3', {}, 'Marketing Effectiveness Engine Configuration'),
      h('div', { class: 'form-row' },
        field('Attribution window (before/after)', winSel),
        field('Gross margin %', margin)),
      field('Cost overrun alert threshold (% of estimate)', overrun),
      isAdmin
        ? h('button', { class: 'btn primary', onclick: async () => {
            await api('/config', { method: 'PUT', body: { roi_window_months: winSel.value, gross_margin_pct: margin.value, overrun_threshold_pct: overrun.value } });
            toast('Configuration saved — Marketing Effectiveness figures recompute on next view', 'success');
          } }, 'Save configuration')
        : h('div', { class: 'hint' }, 'Only Admin can change configuration.')));
  }
}
