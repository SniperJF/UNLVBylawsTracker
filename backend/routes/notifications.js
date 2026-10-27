const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// SSE clients: Map<userId, Set<res>>
const clients = new Map();

function sendToUser(userId, data) {
  const userClients = clients.get(userId);
  if (!userClients) return;
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of userClients) {
    try { res.write(payload); } catch {}
  }
}

router.sendToUser = sendToUser;

// GET /api/notifications/stream — SSE (auth via short-lived SSE token OR Bearer JWT)
router.get('/stream', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '') || req.query.token;
  if (!token) return res.status(401).end();

  let userId;

  // Prefer one-time SSE token (UUID from /auth/sse-token)
  const sseRow = db.prepare('SELECT user_id, expires_at FROM sse_tokens WHERE token = ?').get(token);
  if (sseRow) {
    if (Date.now() > sseRow.expires_at) return res.status(401).end();
    db.prepare('DELETE FROM sse_tokens WHERE token = ?').run(token);
    userId = sseRow.user_id;
  } else {
    // Fall back to direct JWT (Bearer header path)
    let payload;
    try { payload = jwt.verify(token, process.env.JWT_SECRET); }
    catch { return res.status(401).end(); }
    userId = payload.id;
  }

  const user = db.prepare('SELECT id, email, name, role, approved FROM users WHERE id = ?').get(userId);
  if (!user || !user.approved) return res.status(401).end();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  if (!clients.has(userId)) clients.set(userId, new Set());
  clients.get(userId).add(res);

  const count = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0').get(userId);
  res.write(`data: ${JSON.stringify({ type: 'init', unread: count.c })}\n\n`);

  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { clearInterval(heartbeat); }
  }, 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    clients.get(userId)?.delete(res);
  });
});

// All other routes require auth
router.use(requireAuth);

// GET /api/notifications
router.get('/', (req, res) => {
  const notifs = db.prepare(`
    SELECT n.*, t.title as ticket_title
    FROM notifications n
    LEFT JOIN tickets t ON n.ticket_id = t.id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC
    LIMIT 100
  `).all(req.user.id);
  res.json(notifs);
});

// GET /api/notifications/unread-count
router.get('/unread-count', (req, res) => {
  const row = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id);
  res.json({ count: row.c });
});

// PATCH /api/notifications/:id/read
router.patch('/:id/read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(req.params.id, req.user.id);
  res.json({ message: 'Marked read' });
});

// POST /api/notifications/mark-all-read
router.post('/mark-all-read', (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'All marked read' });
});

// DELETE /api/notifications — clear all
router.delete('/', (req, res) => {
  db.prepare('DELETE FROM notifications WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'Cleared' });
});

module.exports = router;
