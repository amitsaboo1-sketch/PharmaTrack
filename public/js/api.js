// Fetch wrapper with JWT + error handling.
import { toast } from './ui.js';

const TOKEN_KEY = 'pharmatrack_token';
const USER_KEY = 'pharmatrack_user';

export const session = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  get user() {
    try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
  },
  set(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export async function api(path, { method = 'GET', body, silent } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (res.status === 401 && !path.startsWith('/auth/login')) {
    session.clear();
    location.hash = '#/login';
    throw new Error('Session expired — please sign in again');
  }
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = data && data.error ? data.error : `Request failed (${res.status})`;
    if (!silent) toast(msg, 'error');
    const err = new Error(msg);
    err.payload = data;
    throw err;
  }
  return data;
}

// Authenticated file download (reports, CSV template).
export async function download(path, filename) {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!res.ok) { toast('Download failed', 'error'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
