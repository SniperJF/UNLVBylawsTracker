const API = '/BylawsTracker/api';

// ── Theme ────────────────────────────────────────────────
function initTheme() {
  const saved = localStorage.getItem('bylaws_theme');
  const dark = saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}

function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('bylaws_theme', next);
  _updateThemeIcon();
}
function _updateThemeIcon() {
  const btn = document.getElementById('theme-toggle-btn');
  if (!btn) return;
  const isDark = (document.documentElement.getAttribute('data-theme') || 'dark') === 'dark';
  btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  btn.innerHTML = isDark
    ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
    : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
}
// Apply saved theme immediately on script load (prevents flash)
initTheme();

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

  // Inject theme toggle into nav-right
  const navRight = document.querySelector('.nav-right');
  if (navRight && !document.getElementById('theme-toggle-btn')) {
    const btn = document.createElement('button');
    btn.id = 'theme-toggle-btn';
    btn.className = 'theme-toggle';
    btn.addEventListener('click', toggleTheme);
    navRight.insertBefore(btn, navRight.firstChild);
    _updateThemeIcon();
  }

  // Fetch initial unread count
  apiFetch('/notifications/unread-count').then(d => updateBadge(d?.count || 0)).catch(() => {});

  // Open SSE connection using a short-lived one-time token (not the JWT)
  // so the long-lived JWT never appears in nginx access logs
  connectSSE();
}

async function connectSSE() {
  try {
    const { token: sseToken } = await apiFetch('/auth/sse-token', { method: 'POST' });
    const es = new EventSource(`${API}/notifications/stream?token=${encodeURIComponent(sseToken)}`);
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.unread !== undefined) updateBadge(data.unread);
        if (data.type === 'notification') updateBadge(data.unread);
      } catch {}
    };
    es.onerror = () => {
      es.close();
      // Retry after 30s if connection drops
      setTimeout(connectSSE, 30000);
    };
  } catch {
    // If SSE token exchange fails (e.g. logged out), don't retry
  }
}

function updateBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.classList.remove('hidden'); }
  else badge.classList.add('hidden');
}

