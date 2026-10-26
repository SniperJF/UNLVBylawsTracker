const express = require('express');
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const TRACK_A_PHASES = ['COMMITTEE_VOTE','EC_REVIEW','SENATE_AGENDA','SENATE_FLOOR','GENERAL_COUNSEL','PROVOST_REVIEW','PRESIDENT_REVIEW','CHANCELLOR_REVIEW','PUBLISHED'];
const TRACK_B_PHASES = ['UNIT_DRAFTING','SUBMITTED_OFA','OFA_REVIEW','GENERAL_COUNSEL','PROVOST_REVIEW','PRESIDENT_REVIEW','CHANCELLOR_REVIEW','PUBLISHED'];

// Roles that can advance tickets through governance phases
const MOVER_ROLES = ['admin','bylaws_chair','senate_manager','ec_member','provost_office'];
// Roles that can create tickets
const CREATOR_ROLES = ['admin','bylaws_chair','senate_manager','ec_member','unit_submitter'];

function phasesFor(type) {
  return type === 'university_amendment' ? TRACK_A_PHASES : TRACK_B_PHASES;
}

function createNotification(userId, type, message, ticketId) {
  if (!userId) return;
  db.prepare('INSERT INTO notifications (user_id, type, message, ticket_id) VALUES (?, ?, ?, ?)').run(userId, type, message, ticketId || null);
}

// GET /api/tickets — all roles can view
router.get('/', (req, res) => {
  const { type, status, phase, assignee_id } = req.query;
  let sql = `
    SELECT t.*,
      u1.name as originator_name, u1.email as originator_email,
      u2.name as assignee_name, u2.email as assignee_email,
      (SELECT COUNT(*) FROM comments WHERE ticket_id = t.id) as comment_count,
      (SELECT COUNT(*) FROM ticket_attachments WHERE ticket_id = t.id) as attachment_count,
      (SELECT entered_at FROM ticket_phase_history
       WHERE ticket_id = t.id AND phase = t.current_phase AND exited_at IS NULL
       ORDER BY entered_at DESC LIMIT 1) as current_phase_entered_at
    FROM tickets t
    LEFT JOIN users u1 ON t.originator_id = u1.id
    LEFT JOIN users u2 ON t.assignee_id = u2.id
    WHERE 1=1
  `;
  const params = [];
  if (type) { sql += ' AND t.type = ?'; params.push(type); }
  if (status) { sql += ' AND t.status = ?'; params.push(status); }
  if (phase) { sql += ' AND t.current_phase = ?'; params.push(phase); }
  if (assignee_id) { sql += ' AND t.assignee_id = ?'; params.push(assignee_id); }
  sql += ' ORDER BY t.updated_at DESC';
  res.json(db.prepare(sql).all(...params));
});

// GET /api/tickets/:id — all roles can view
router.get('/:id', (req, res) => {
  const ticket = db.prepare(`
    SELECT t.*,
      u1.name as originator_name, u1.email as originator_email,
      u2.name as assignee_name, u2.email as assignee_email
    FROM tickets t
    LEFT JOIN users u1 ON t.originator_id = u1.id
    LEFT JOIN users u2 ON t.assignee_id = u2.id
    WHERE t.id = ?
  `).get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const history = db.prepare(`
    SELECT ph.*, u.name as entered_by_name
    FROM ticket_phase_history ph
    LEFT JOIN users u ON ph.entered_by = u.id
    WHERE ph.ticket_id = ?
    ORDER BY ph.entered_at ASC
  `).all(req.params.id);

  const attachments = db.prepare(`
    SELECT a.*, u.name as uploaded_by_name
    FROM ticket_attachments a
    LEFT JOIN users u ON a.uploaded_by = u.id
    WHERE a.ticket_id = ?
    ORDER BY a.uploaded_at DESC
  `).all(req.params.id);

  const comments = db.prepare(`
    SELECT c.*, u.name as author_name, u.email as author_email, u.role as author_role
    FROM comments c
    LEFT JOIN users u ON c.author_id = u.id
    WHERE c.ticket_id = ?
    ORDER BY c.created_at ASC
  `).all(req.params.id);

  res.json({ ...ticket, history, attachments, comments });
});

// POST /api/tickets — restricted to creator roles
router.post('/', requireRole(...CREATOR_ROLES), (req, res) => {
  const { type, title, description, bylaws_section, unit_name, assignee_id } = req.body;
  if (!type || !title) return res.status(400).json({ error: 'type and title required' });
  if (typeof title !== 'string' || title.length > 500) return res.status(400).json({ error: 'Title too long (max 500)' });
  if (description && description.length > 50000) return res.status(400).json({ error: 'Description too long (max 50000)' });
  if (bylaws_section && bylaws_section.length > 200) return res.status(400).json({ error: 'Bylaws section too long' });

  const phases = phasesFor(type);
  if (!phases) return res.status(400).json({ error: 'Invalid ticket type' });
  const initial_phase = phases[0];

  const result = db.prepare(`
    INSERT INTO tickets (type, title, description, bylaws_section, current_phase, originator_id, assignee_id, unit_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(type, title.trim(), (description || '').trim(), (bylaws_section || '').trim(), initial_phase, req.user.id, assignee_id || null, (unit_name || '').trim());

  const ticketId = result.lastInsertRowid;
  db.prepare('INSERT INTO ticket_phase_history (ticket_id, phase, entered_by) VALUES (?, ?, ?)').run(ticketId, initial_phase, req.user.id);

  res.status(201).json({ id: ticketId, message: 'Ticket created' });
});

// PATCH /api/tickets/:id — originator or privileged roles only
router.patch('/:id', (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const canEdit = req.user.id === ticket.originator_id || ['admin','bylaws_chair','senate_manager'].includes(req.user.role);
  if (!canEdit) return res.status(403).json({ error: 'Only the originator or privileged roles can edit this ticket' });

  const allowed = ['title','description','bylaws_section','assignee_id','unit_name','senate_meeting_date','vote_result'];
  const updates = [];
  const vals = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { updates.push(`${key} = ?`); vals.push(req.body[key]); }
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  vals.push(req.params.id);
  db.prepare(`UPDATE tickets SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  res.json({ message: 'Updated' });
});

// POST /api/tickets/:id/advance — governance roles only
router.post('/:id/advance', requireRole(...MOVER_ROLES), (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (ticket.status === 'published') return res.status(400).json({ error: 'Already published' });

  const phases = phasesFor(ticket.type);
  const idx = phases.indexOf(ticket.current_phase);
  if (idx === -1 || idx === phases.length - 1) return res.status(400).json({ error: 'Already at final phase' });

  const next_phase = phases[idx + 1];
  const now = new Date().toISOString();

  db.prepare('UPDATE ticket_phase_history SET exited_at = ? WHERE ticket_id = ? AND phase = ? AND exited_at IS NULL').run(now, ticket.id, ticket.current_phase);
  db.prepare('INSERT INTO ticket_phase_history (ticket_id, phase, entered_by) VALUES (?, ?, ?)').run(ticket.id, next_phase, req.user.id);

  const newStatus = next_phase === 'PUBLISHED' ? 'published' : 'active';
  db.prepare('UPDATE tickets SET current_phase = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(next_phase, newStatus, ticket.id);

  if (ticket.originator_id) {
    createNotification(ticket.originator_id, 'phase_change', `"${ticket.title}" moved to ${next_phase}`, ticket.id);
  }
  if (ticket.assignee_id && ticket.assignee_id !== ticket.originator_id) {
    createNotification(ticket.assignee_id, 'phase_change', `"${ticket.title}" moved to ${next_phase}`, ticket.id);
  }

  res.json({ message: 'Advanced', new_phase: next_phase });
});

// POST /api/tickets/:id/stuck — governance roles only
router.post('/:id/stuck', requireRole(...MOVER_ROLES), (req, res) => {
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const newStatus = ticket.status === 'stuck' ? 'active' : 'stuck';
  db.prepare('UPDATE tickets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(newStatus, ticket.id);

  if (ticket.originator_id) {
    createNotification(ticket.originator_id, 'stuck_change', `"${ticket.title}" marked ${newStatus}`, ticket.id);
  }
  res.json({ message: 'Updated', status: newStatus });
});

// POST /api/tickets/:id/phase — set arbitrary phase (admin/chair/manager)
router.post('/:id/phase', requireRole('admin','bylaws_chair','senate_manager'), (req, res) => {
  const { phase } = req.body;
  const ticket = db.prepare('SELECT * FROM tickets WHERE id = ?').get(req.params.id);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });

  const phases = phasesFor(ticket.type);
  if (!phases.includes(phase)) return res.status(400).json({ error: 'Invalid phase for this ticket type' });

  const now = new Date().toISOString();
  db.prepare('UPDATE ticket_phase_history SET exited_at = ? WHERE ticket_id = ? AND phase = ? AND exited_at IS NULL').run(now, ticket.id, ticket.current_phase);
  db.prepare('INSERT INTO ticket_phase_history (ticket_id, phase, entered_by) VALUES (?, ?, ?)').run(ticket.id, phase, req.user.id);

  const newStatus = phase === 'PUBLISHED' ? 'published' : ticket.status === 'published' ? 'active' : ticket.status;
  db.prepare('UPDATE tickets SET current_phase = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(phase, newStatus, ticket.id);
  res.json({ message: 'Phase set', new_phase: phase });
});

module.exports = router;
