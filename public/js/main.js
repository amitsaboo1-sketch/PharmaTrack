// App shell: hash router + role-based sidebar.
import { api, session } from './api.js';
import { h, BRAND_SVG } from './ui.js';

import loginPage from './pages/login.js';
import dashboardPage from './pages/dashboard.js';
import activitiesPage from './pages/activities.js';
import activityDetailPage from './pages/activity-detail.js';
import approvalsPage from './pages/approvals.js';
import mastersPage from './pages/masters.js';
import doctorPage from './pages/doctor.js';
import chemistPage from './pages/chemist.js';
import mappingsPage from './pages/mappings.js';
import verificationPage from './pages/verification.js';
import salesImportPage from './pages/sales-import.js';
import dailyAllowancePage from './pages/daily-allowance.js';
import countryPage from './pages/country.js';
import roiPage from './pages/roi.js';
import reportsPage from './pages/reports.js';
import auditPage from './pages/audit.js';
import settingsPage from './pages/settings.js';

const routes = {
  '': dashboardPage,
  dashboard: dashboardPage,
  activities: activitiesPage,
  activity: activityDetailPage,   // #/activity/ACT001
  approvals: approvalsPage,
  doctors: (c) => mastersPage(c, 'doctors'),
  doctor: doctorPage,             // #/doctor/HCP001
  chemists: (c) => mastersPage(c, 'chemists'),
  chemist: chemistPage,            // #/chemist/CHEM001
  brands: (c) => mastersPage(c, 'brands'),
  users: (c) => mastersPage(c, 'users'),
  mappings: mappingsPage,
  verification: verificationPage,
  'daily-allowance': dailyAllowancePage,
  country: countryPage,            // #/country/KE
  'sales-import': salesImportPage,
  roi: roiPage,
  reports: reportsPage,
  audit: auditPage,
  settings: settingsPage,
};

const NAV = [
  { section: 'Overview' },
  { route: 'dashboard', label: 'Dashboard', icon: '◧', roles: ['sales', 'ho', 'clm', 'cm'] },
  { section: 'Field Operations' },
  { route: 'activities', label: 'Activities', icon: '▤', roles: ['sales', 'ho', 'clm', 'cm'] },
  { route: 'approvals', label: 'Approvals', icon: '✓', roles: ['clm', 'cm', 'marketing'], badge: 'pending' },
  { route: 'mappings', label: 'Doctor–Chemist Map', icon: '⇄', roles: ['sales'] },
  { route: 'daily-allowance', label: 'Daily Allowance', icon: '＄', roles: ['sales', 'ho', 'clm', 'cm'], badge: 'da' },
  { route: 'verification', label: 'Field Verification', icon: '☑', roles: ['clm', 'cm', 'marketing', 'admin'], badge: 'verify' },
  { section: 'Master Data' },
  { route: 'doctors', label: 'Doctors (HCP)', icon: '⚕', roles: ['sales', 'ho', 'clm', 'cm'] },
  { route: 'chemists', label: 'Chemists', icon: '✚', roles: ['sales', 'ho', 'clm', 'cm'] },
  { route: 'brands', label: 'Brands & Products', icon: '❖', roles: ['ho'] },
  { route: 'users', label: 'Users', icon: '👥', roles: ['admin'] },
  { section: 'Intelligence' },
  { route: 'sales-import', label: 'Sales Import', icon: '⬆', roles: ['ho'] },
  { route: 'roi', label: 'Marketing Effectiveness Analytics', icon: '↗', roles: ['sales', 'ho', 'clm', 'cm'] },
  { route: 'reports', label: 'Reports', icon: '⎙', roles: ['sales', 'ho', 'clm', 'cm'] },
  { route: 'audit', label: 'Audit Trail', icon: '🛡', roles: ['ho'] },
  { section: 'Account' },
  { route: 'settings', label: 'Settings', icon: '⚙', roles: ['sales', 'ho', 'clm', 'cm'] },
];

const TITLES = {
  dashboard: 'Dashboard', activities: 'Marketing Activities', activity: 'Activity Detail',
  approvals: 'Approval Queue', doctors: 'Doctor Master (HCP)', doctor: 'Doctor 360°',
  chemists: 'Chemist / Wholesaler Master', chemist: 'Chemist 360°', brands: 'Brands & Products', users: 'User Management',
  mappings: 'Doctor–Chemist Mapping', verification: 'Field Account Verification',
  'daily-allowance': 'Daily Allowance', country: 'Country Performance', 'sales-import': 'Monthly Sales Import',
  roi: 'Marketing Effectiveness Analytics', reports: 'Reports', audit: 'Audit Trail', settings: 'Settings',
};

function parseHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return { route: parts[0] || 'dashboard', arg: parts[1] ? decodeURIComponent(parts[1]) : null };
}

async function badgeCounts(user) {
  const out = { pending: 0, verify: 0, da: 0, unread: 0 };
  try {
    const notifs = await api('/notifications', { silent: true });
    out.unread = notifs.filter((n) => !n.read).length;
    if (['ho', 'clm', 'cm'].includes(user.role)) {
      // Everything currently awaiting THIS user's stage in the chain.
      const [acts, ver, da] = await Promise.all([
        api('/activities?pending=mine', { silent: true }),
        api('/verification/pending', { silent: true }),
        api('/da?pending=mine', { silent: true }),
      ]);
      out.pending = acts.length;
      out.verify = (ver.adds.hcps.length + ver.adds.chemists.length + ver.removals.hcps.length + ver.removals.chemists.length);
      out.da = da.length;
    }
  } catch { /* non-fatal */ }
  return out;
}

function isVisible(item, user) {
  return item.roles.some((r) => {
    if (r === 'admin') return user.role === 'ho' && user.sub_role === 'Admin';
    if (r === 'marketing') return user.role === 'ho' && ['Product Manager', 'Marketing Head'].includes(user.sub_role);
    return r === user.role;
  });
}

async function render() {
  const app = document.getElementById('app');
  const { route, arg } = parseHash();

  if (!session.token || route === 'login') {
    app.innerHTML = '';
    app.append(loginPage(() => {
      // Go to the dashboard after login. Set the hash WITHOUT relying on the
      // 'hashchange' event (which doesn't fire if the hash is already
      // '#/dashboard', leaving the page blank until a manual reload), then
      // render explicitly so the transition is deterministic.
      history.replaceState(null, '', '#/dashboard');
      render();
    }));
    return;
  }
  const user = session.user;
  const counts = await badgeCounts(user);

  const sidebar = h('aside', { class: 'sidebar' },
    h('div', { class: 'logo' }, h('div', { class: 'logo-mark', html: BRAND_SVG }), 'Pharos'),
    NAV.filter((n) => n.section || isVisible(n, user)).map((n) =>
      n.section
        ? h('div', { class: 'nav-section' }, n.section)
        : h('button', {
            class: `nav-item ${route === n.route || (n.route === 'dashboard' && route === '') ? 'active' : ''}`,
            onclick: () => (location.hash = `#/${n.route}`),
          },
          h('span', { class: 'icon' }, n.icon), n.label,
          n.badge && counts[n.badge] ? h('span', { class: 'nav-badge' }, String(counts[n.badge])) : null)));

  const content = h('div', { class: 'content' });
  const topbar = h('header', { class: 'topbar' },
    h('h1', {}, TITLES[route] || 'Pharos'),
    h('div', { class: 'spacer' }),
    h('button', { class: 'bell', title: 'Notifications', onclick: () => showNotifications() },
      '🔔', counts.unread ? h('span', { class: 'dot' }, String(counts.unread)) : null),
    h('div', { class: 'userchip' },
      h('div', { class: 'avatar' }, user.name.split(' ').map((w) => w[0]).slice(0, 2).join('')),
      h('div', { class: 'meta' },
        h('div', { class: 'name' }, user.name),
        h('div', { class: 'role' }, `${user.sub_role} · ${user.territory}`))),
    h('button', { class: 'btn sm', onclick: logout }, 'Sign out'));

  app.innerHTML = '';
  app.append(h('div', { class: 'shell' }, sidebar, h('div', { class: 'main' }, topbar, content)));

  const page = routes[route] || dashboardPage;
  try {
    await page(content, arg);
  } catch (err) {
    content.append(h('div', { class: 'empty' }, `Failed to load: ${err.message}`));
  }
}

async function showNotifications() {
  const { modal, table, fmtDate } = await import('./ui.js');
  const notifs = await api('/notifications');
  modal('Notifications',
    [table(['When', 'Message'], notifs.map((n) => [fmtDate(n.created_at), n.message]))],
    (close) => [
      h('button', { class: 'btn', onclick: async () => { await api('/notifications/read', { method: 'POST', body: {} }); close(); render(); } }, 'Mark all read'),
      h('button', { class: 'btn primary', onclick: close }, 'Close'),
    ]);
}

function logout() {
  session.clear();
  location.hash = '#/login';
}

window.addEventListener('hashchange', render);
render();
