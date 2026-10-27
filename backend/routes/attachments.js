const express = require('express');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { upload, uploadsDir } = require('../middleware/upload');
const { logAudit } = require('../middleware/audit');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// POST /api/tickets/:ticketId/attachments
router.post('/', upload.array('files', 10), (req, res) => {
  const ticket = db.prepare('SELECT id, title FROM tickets WHERE id = ?').get(req.params.ticketId);
  if (!ticket) return res.status(404).json({ error: 'Ticket not found' });
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });

  const inserted = req.files.map(file => {
    const result = db.prepare(`
      INSERT INTO ticket_attachments (ticket_id, filename, original_name, mime_type, size, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(ticket.id, file.filename, file.originalname, file.mimetype, file.size, req.user.id);
    return { id: result.lastInsertRowid, filename: file.filename, original_name: file.originalname, mime_type: file.mimetype, size: file.size };
  });

  res.status(201).json(inserted);
});

// GET /api/tickets/:ticketId/attachments
router.get('/', (req, res) => {
  const attachments = db.prepare(`
    SELECT a.*, u.name as uploaded_by_name
    FROM ticket_attachments a LEFT JOIN users u ON a.uploaded_by = u.id
    WHERE a.ticket_id = ? ORDER BY a.uploaded_at DESC
  `).all(req.params.ticketId);
  res.json(attachments);
});

// GET /api/tickets/:ticketId/attachments/:id/download
router.get('/:id/download', (req, res) => {
  const attachment = db.prepare('SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?').get(req.params.id, req.params.ticketId);
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  // Verify the stored filename is a UUID (defense against DB injection/corruption)
  if (!/^[0-9a-f-]{36}\.[a-z]{2,5}$/.test(attachment.filename)) {
    return res.status(500).json({ error: 'Invalid stored filename' });
  }

  const filePath = path.join(uploadsDir, attachment.filename);
  // Ensure resolved path is still inside uploadsDir (path traversal guard)
  if (!filePath.startsWith(uploadsDir + path.sep) && filePath !== uploadsDir) {
    return res.status(400).json({ error: 'Invalid file path' });
  }
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found on disk' });

  // RFC5987-encoded filename — handles unicode, quotes, special characters safely
  const encodedName = encodeURIComponent(attachment.original_name);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedName}`);
  res.setHeader('Content-Type', attachment.mime_type || 'application/octet-stream');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(filePath);
});

// DELETE /api/tickets/:ticketId/attachments/:id
router.delete('/:id', (req, res) => {
  const attachment = db.prepare('SELECT * FROM ticket_attachments WHERE id = ? AND ticket_id = ?').get(req.params.id, req.params.ticketId);
  if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

  if (attachment.uploaded_by !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Cannot delete this attachment' });
  }

  if (!/^[0-9a-f-]{36}\.[a-z]{2,5}$/.test(attachment.filename)) {
    return res.status(500).json({ error: 'Invalid stored filename' });
  }
  const filePath = path.join(uploadsDir, attachment.filename);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  logAudit(req.user.id, req.user.name, 'attachment.delete', 'attachment', attachment.id, { ticket_id: +req.params.ticketId, name: attachment.original_name }, req.ip);
  db.prepare('DELETE FROM ticket_attachments WHERE id = ?').run(req.params.id);
  res.json({ message: 'Deleted' });
});

module.exports = router;
