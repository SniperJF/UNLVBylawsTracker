const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../email');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, name, password, role_requested, reason } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Missing required fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 12);
  const token = uuidv4();

  try {
    db.prepare(`
      INSERT INTO users (email, name, password_hash, role, approved, email_verified, verify_token)
      VALUES (?, ?, ?, 'read_only', 0, 0, ?)
    `).run(email.toLowerCase(), name, hash, token);

    db.prepare(`
      INSERT INTO account_requests (email, name, role_requested, reason)
      VALUES (?, ?, ?, ?)
    `).run(email.toLowerCase(), name, role_requested || 'read_only', reason || '');

    await sendVerificationEmail(email.toLowerCase(), name, token);
    res.json({ message: 'Registration submitted. Check your email to verify, then await admin approval.' });
  } catch (e) {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /api/auth/verify?token=...
router.get('/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const user = db.prepare('SELECT id FROM users WHERE verify_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

  db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL, updated_at = datetime("now") WHERE id = ?').run(user.id);
  res.json({ message: 'Email verified. Your account is pending admin approval.' });
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.email_verified) return res.status(401).json({ error: 'Email not verified' });
  if (!user.approved) return res.status(401).json({ error: 'Account pending admin approval' });

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

  const token = jwt.sign({ id: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  // Always return success to prevent enumeration
  if (user) {
    const token = uuidv4();
    const expires = Date.now() + 3600 * 1000;
    db.prepare('UPDATE users SET reset_token = ?, reset_expires = ?, updated_at = datetime("now") WHERE id = ?')
      .run(token, expires, user.id);
    await sendPasswordResetEmail(user.email, user.name, token).catch(() => {});
  }
  res.json({ message: 'If that email is registered, a reset link was sent.' });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 8) return res.status(400).json({ error: 'Password too short' });

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_expires || Date.now() > user.reset_expires) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ?, reset_token = NULL, reset_expires = NULL, updated_at = datetime("now") WHERE id = ?')
    .run(hash, user.id);
  res.json({ message: 'Password updated.' });
});

// GET /api/auth/me
router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// POST /api/auth/change-password (own password)
router.post('/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return res.status(400).json({ error: 'Missing fields' });
  if (new_password.length < 8) return res.status(400).json({ error: 'Password too short' });

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(current_password, user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, updated_at = datetime("now") WHERE id = ?').run(hash, user.id);
  res.json({ message: 'Password updated.' });
});

module.exports = router;
