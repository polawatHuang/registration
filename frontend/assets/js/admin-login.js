import { get, send } from './api.js';
import { $, busy } from './ui.js';
import { floatingLeaves } from './fx.js';

floatingLeaves(12);
const PAGES = ['dashboard', 'applications', 'catalog', 'ai-knowledge', 'users', 'audit-logs', 'settings', 'retention', 'chat', 'notifications', 'attendance', 'certificates', 'line'];
const wanted = new URLSearchParams(location.search).get('next');
const next = `/admin/${PAGES.includes(wanted) ? wanted : 'dashboard'}.html`;
get('/admin/auth/me').then(() => location.replace(next)).catch(() => {});
$('#login').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target.elements;
  $('#err').textContent = '';
  busy($('#btn'), async () => {
    try { await send('POST', '/admin/auth/login', { username: f.username.value.trim(), password: f.password.value }); location.replace(next); } catch (err) { $('#err').textContent = err.message; f.password.select(); }
  });
});
