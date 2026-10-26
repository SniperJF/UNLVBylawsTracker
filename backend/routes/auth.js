const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../email');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Brute-force protection on login and forgot-password
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again in 15 minutes' },
  skipSuccessfulRequests: true,
});

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, name, password, role_requested, reason } = req.body;
  if (!email || !name || !password) return res.status(400).json({ error: 'Missing required fields' });
  if (typeof email !== 'string' || email.length > 254) return res.status(400).json({ error: 'Invalid email' });
  if (typeof name !== 'string' || name.length > 200) return res.status(400).json({ error: 'Name too long' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be 8–128 characters' });
  }

  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const hash = await bcrypt.hash(password, 12);
  const token = uuidv4();

  try {
    db.prepare(`
      INSERT INTO users (email, name, password_hash, role, approved, email_verified, verify_token)
      VALUES (?, ?, ?, 'read_only', 0, 0, ?)
    `).run(email.toLowerCase(), name.trim(), hash, token);

    db.prepare(`
      INSERT INTO account_requests (email, name, role_requested, reason)
      VALUES (?, ?, ?, ?)
    `).run(email.toLowerCase(), name.trim(), role_requested || 'read_only', (reason || '').slice(0, 1000));

    await sendVerificationEmail(email.toLowerCase(), name.trim(), token);
    res.json({ message: 'Registration submitted. Check your email to verify, then await admin approval.' });
  } catch {
    res.status(500).json({ error: 'Registration failed' });
  }
});

// GET /api/auth/verify?token=...
router.get('/verify', (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: 'Missing token' });

  const user = db.prepare('SELECT id FROM users WHERE verify_token = ?').get(token);
  if (!user) return res.status(400).json({ error: 'Invalid or expired token' });

  db.prepare('UPDATE users SET email_verified = 1, verify_token = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
  res.json({ message: 'Email verified. Your account is pending admin approval.' });
});

// POST /api/auth/login
router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Missing credentials' });

  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email + '').toLowerCase());
  // Constant-time: still compare even when user not found to prevent timing attacks
  const dummyHash = '$2b$12$invalidhashpaddingtomatchbcryptlength000000000000000000000';
  const hash = user?.password_hash || dummyHash;
  const valid = await bcrypt.compare(password + '', hash);

  if (!user || !valid) return res.status(401).json({ error: 'Invalid credentials' });
  if (!user.email_verified) return res.status(401).json({ error: 'Email not verified' });
  if (!user.approved) return res.status(401).json({ error: 'Account pending admin approval' });

  const token = jwt.sign(
    { id: user.id, role: user.role, pw_version: user.pw_version },
    process.env.JWT_SECRET,
    { expiresIn: '8h' }
  );
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', authLimiter, async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(((email || '') + '').toLowerCase());
  // Always return success to prevent enumeration
  if (user) {
    const token = uuidv4();
    const expires = Date.now() + 3600 * 1000;
    db.prepare('UPDATE users SET reset_token = ?, reset_expires = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(token, expires, user.id);
    await sendPasswordResetEmail(user.email, user.name, token).catch(() => {});
  }
  res.json({ message: 'If that email is registered, a reset link was sent.' });
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Missing fields' });
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ error: 'Password must be 8–128 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE reset_token = ?').get(token);
  if (!user || !user.reset_expires || Date.now() > user.reset_expires) {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  const hash = await bcrypt.hash(password, 12);
  db.prepare('UPDATE users SET password_hash = ?, pw_version = pw_version + 1, reset_token = NULL, reset_expires = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
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
  if (typeof new_password !== 'string' || new_password.length < 8 || new_password.length > 128) {
    return res.status(400).json({ error: 'Password must be 8–128 characters' });
  }

  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const valid = await bcrypt.compare(current_password + '', user.password_hash);
  if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

  const hash = await bcrypt.hash(new_password, 12);
  db.prepare('UPDATE users SET password_hash = ?, pw_version = pw_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(hash, user.id);
  res.json({ message: 'Password updated. Please log in again.' });
});

// POST /api/auth/sse-token — exchange long-lived JWT for a 60-second SSE token
// This keeps JWT off the URL (and out of nginx logs) for EventSource connections
router.post('/sse-token', requireAuth, (req, res) => {
  const token = uuidv4();
  const expiresAt = Date.now() + 60000; // 60 seconds — just enough to open the connection
  db.prepare('INSERT INTO sse_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, req.user.id, expiresAt);
  res.json({ token, expires_in: 60 });
});

module.exports = router;
