const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/tickets/:ticketId/comments
router.get('/', (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, u.name as author_name, u.email as author_email, u.role as author_role
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.ticket_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.ticketId);
  res.json(comments);
});

// POST /api/tickets/:ticketId/comments
router.post('/', (req, res) => {
  const { body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Comment body required' });

  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const result = db.prepare('INSERT INTO comments (ticket_id, author_id, body) VALUES (?, ?, ?)').run(req.params.ticketId, req.user.id, body.trim());

  // Notify ticket originator and assignee (not self)
  const notify = new Set([ticket.originator_id, ticket.assignee_id].filter(id => id && id !== req.user.id));
  for (const userId of notify) {
    db.prepare('INSERT INTO notifications (user_id, type, message, ticket_id) VALUES (?, ?, ?, ?)').run(userId, 'comment', `${req.user.name} commented on "${ticket.title}"`, ticket.id);
  }

  const comment = db.prepare(`
    SELECT c.*, u.name as author_name, u.email as author_email, u.role as author_role
    FROM comments c LEFT JOIN users u ON c.author_id = u.id WHERE c.id = ?
  `).get(result.lastInsertRowid);
  res.status(201).json(comment);
});

// DELETE /api/tickets/:ticketId/comments/:id
router.delete('/:id', (req, res) => {
  const comment = db.prepare('SELECT * FROM comments WHERE id = ? AND ticket_id = ?').get(req.params.id, req.params.ticketId);
  if (!comment) return res.status(404).json({ error: 'Comment not found' });
  if (comment.author_id !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Cannot delete this comment' });
  }
  db.prepare('DELETE FROM comments WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
