const API = '/BylawsTracker/api';

function getToken() { return localStorage.getItem('bylaws_token'); }
function getUser() { try { return JSON.parse(localStorage.getItem('bylaws_user')); } catch { return null; } }

function setAuth(token, user) {
  localStorage.setItem('bylaws_token', token);
  localStorage.setItem('bylaws_user', JSON.stringify(user));
}

function clearAuth() {
  localStorage.removeItem('bylaws_token');
  localStorage.removeItem('bylaws_user');
}

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(API + path, { ...opts, headers });
  if (res.status === 401) {
    clearAuth();
    window.location.href = '/BylawsTracker/login.html';
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function requireLogin() {
  if (!getToken()) {
    window.location.href = '/BylawsTracker/login.html';
  }
}

function requireAdmin() {
  const user = getUser();
  if (!user || user.role !== 'admin') {
    window.location.href = '/BylawsTracker/dashboard.html';
  }
}

function relativeTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function statusBadge(status, phase) {
  if (status === 'stuck') return '<span class="phase-badge phase-stuck">STUCK</span>';
  if (status === 'published') return '<span class="phase-badge phase-published">PUBLISHED</span>';
  const waitPhases = ['PRESIDENT_REVIEW','CHANCELLOR_REVIEW','PROVOST_REVIEW','GENERAL_COUNSEL','OFA_REVIEW'];
  if (waitPhases.includes(phase)) return `<span class="phase-badge phase-waiting">${phase.replace(/_/g,' ')}</span>`;
  return `<span class="phase-badge phase-active">${phase.replace(/_/g,' ')}</span>`;
}

// Render nav for logged-in users
function renderNav(activePage) {
  const user = getUser();
  if (!user) return;
  const isAdmin = user.role === 'admin';

  document.getElementById('nav-user-name').textContent = user.name.split(' ')[0];
  document.getElementById('nav-role').textContent = user.role.replace(/_/g, ' ');

  if (activePage) {
    document.querySelectorAll('.nav-links a').forEach(a => {
      if (a.dataset.page === activePage) a.classList.add('active');
    });
  }
  if (!isAdmin) {
    document.querySelectorAll('[data-admin]').forEach(el => el.remove());
  }

  // Notification SSE
  const token = getToken();
  if (token) {
    const es = new EventSource(`${API}/notifications/stream?token=${token}`);
    es.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.unread !== undefined) updateBadge(data.unread);
      if (data.type === 'notification') updateBadge(data.unread);
    };
  }

  // Fetch initial unread count
  apiFetch('/notifications/unread-count').then(d => updateBadge(d?.count || 0)).catch(() => {});
}

function updateBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

// SSE also needs token in headers but EventSource doesn't support headers
// We pass it as query param and check on server
