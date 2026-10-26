const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { sendApprovalEmail } = require('../email');

const router = express.Router();
router.use(requireAuth);

// GET /api/users — admin only
router.get('/', requireRole('admin'), (req, res) => {
  const users = db.prepare('SELECT id, email, name, role, approved, email_verified, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// GET /api/users/requests — pending account requests (admin)
router.get('/requests', requireRole('admin'), (req, res) => {
  const requests = db.prepare(`
    SELECT ar.*, u.approved, u.email_verified
    FROM account_requests ar
    LEFT JOIN users u ON u.email = ar.email
    WHERE ar.status = 'pending'
    ORDER BY ar.created_at DESC
  `).all();
  res.json(requests);
});

// POST /api/users/:id/approve — admin approves + sets role
router.post('/:id/approve', requireRole('admin'), async (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin','bylaws_chair','senate_manager','ec_member','provost_office','unit_submitter','read_only'];
  if (role && !validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const assignedRole = role || user.role;
  db.prepare('UPDATE users SET approved = 1, role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(assignedRole, user.id);
  db.prepare('UPDATE account_requests SET status = "approved", reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE email = ? AND status = "pending"')
    .run(req.user.id, user.email);

  await sendApprovalEmail(user.email, user.name).catch(() => {});
  res.json({ message: 'User approved' });
});

// POST /api/users/:id/reject — admin rejects
router.post('/:id/reject', requireRole('admin'), (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE account_requests SET status = "rejected", reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP WHERE email = ? AND status = "pending"')
    .run(req.user.id, user.email);
  res.json({ message: 'Request rejected' });
});

// PATCH /api/users/:id/role — admin changes role
router.patch('/:id/role', requireRole('admin'), (req, res) => {
  const { role } = req.body;
  const validRoles = ['admin','bylaws_chair','senate_manager','ec_member','provost_office','unit_submitter','read_only'];
  if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

  db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(role, req.params.id);
  res.json({ message: 'Role updated' });
});

// POST /api/users/:id/reset-password — admin resets any user's password
// Increments pw_version to invalidate all existing sessions for that user
router.post('/:id/reset-password', requireRole('admin'), async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || typeof new_password !== 'string' || new_password.length < 8 || new_password.length > 128) {
    return res.status(400).json({ error: 'Password must be 8–128 characters' });
  }

  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, pw_version = pw_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, req.params.id);
  res.json({ message: 'Password reset — user sessions invalidated' });
});

module.exports = router;
