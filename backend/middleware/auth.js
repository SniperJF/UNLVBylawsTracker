const jwt = require('jsonwebtoken');
const db = require('../db');

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = db.prepare('SELECT id, email, name, role, approved, pw_version FROM users WHERE id = ?').get(payload.id);
    if (!user || !user.approved) return res.status(401).json({ error: 'Account not approved' });

    // Invalidate tokens issued before a password change
    if (payload.pw_version !== undefined && payload.pw_version !== user.pw_version) {
      return res.status(401).json({ error: 'Session expired — please log in again' });
    }

    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
