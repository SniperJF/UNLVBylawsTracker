const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { sendApprovalEmail } = require('../email');
const { logAudit } = require('../middleware/audit');

const router = express.Router();
router.use(requireAuth);

const VALID_ROLES = ['admin','bylaws_chair','faculty_senate_chair','senate_manager','provost_office','unit_submitter','read_only'];

// The seeded owner account must always retain admin. Losing it leaves nobody able
// to approve users, which previously locked the only administrator out entirely.
const PROTECTED_ADMIN_EMAIL = (process.env.ADMIN_EMAIL || '').toLowerCase();

function roleChangeBlockedReason(targetUser, newRole, actor) {
  if (!targetUser) return null;
  if (PROTECTED_ADMIN_EMAIL && targetUser.email.toLowerCase() === PROTECTED_ADMIN_EMAIL && newRole !== 'admin') {
    return 'This is the protected owner account and must remain an admin';
  }
  if (targetUser.id === actor.id && newRole !== actor.role) {
    return 'You cannot change your own role — ask another admin';
  }
  return null;
}

// GET /api/users — admin only
router.get('/', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, email, name, role, approved, email_verified, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// GET /api/users/requests — pending account requests (admin)
router.get('/requests', requireAdmin, (req, res) => {
  // u.id is aliased explicitly: ar.* exposes the *request* id, and callers that
  // mistook it for a user id previously wrote roles onto an unrelated account.
  const requests = db.prepare(`
    SELECT ar.*, u.id AS user_id, u.approved, u.email_verified
    FROM account_requests ar
    LEFT JOIN users u ON u.email = ar.email
    WHERE ar.status = 'pending'
    ORDER BY ar.created_at DESC
  `).all();
  res.json(requests);
});

// POST /api/users/:id/approve — admin approves + sets role
router.post('/:id/approve', requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (role && !VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const assignedRole = role || user.role;
  const blocked = roleChangeBlockedReason(user, assignedRole, req.user);
  if (blocked) return res.status(403).json({ error: blocked });
  db.prepare('UPDATE users SET approved = 1, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(assignedRole, user.id);
  db.prepare('UPDATE account_requests SET status = "approved", reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE email = ? AND status = "pending"')
    .run(req.user.id, user.email);

  // Audit before notifying: a throwing mail call must never lose the record of a
  // change that has already been committed.
  logAudit(req.user.id, req.user.name, 'user.approve', 'user', user.id,
    { email: user.email, role: assignedRole }, req.ip);

  // try/catch, not .catch() — a synchronous throw here would escape a promise handler
  try { await sendApprovalEmail(user.email, user.name); } catch { /* approval still stands */ }

  res.json({ message: 'User approved' });
});

// POST /api/users/:id/reject — admin rejects
router.post('/:id/reject', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE account_requests SET status = "rejected", reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE email = ? AND status = "pending"')
    .run(req.user.id, user.email);
  logAudit(req.user.id, req.user.name, 'user.reject', 'user', user.id, null, req.ip);
  res.json({ message: 'Request rejected' });
});

// PATCH /api/users/:id/role — admin changes role
router.patch('/:id/role', requireAdmin, (req, res) => {
  const { role } = req.body;
  if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const target = db.prepare('SELECT id, email, role FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  const blocked = roleChangeBlockedReason(target, role, req.user);
  if (blocked) return res.status(403).json({ error: blocked });

  db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, target.id);
  logAudit(req.user.id, req.user.name, 'user.role_change', 'user', target.id,
    { email: target.email, from: target.role, to: role }, req.ip);
  res.json({ message: 'Role updated' });
});

// POST /api/users/:id/reset-password — admin resets any user's password
// Increments pw_version to invalidate all existing sessions for that user
router.post('/:id/reset-password', requireAdmin, async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || typeof new_password !== 'string' || new_password.length < 8 || new_password.length > 128) {
    return res.status(400).json({ error: 'Password must be 8–128 characters' });
  }

  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, pw_version = pw_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, req.params.id);
  logAudit(req.user.id, req.user.name, 'user.password_reset', 'user', +req.params.id, null, req.ip);
  res.json({ message: 'Password reset — user sessions invalidated' });
});

module.exports = router;
