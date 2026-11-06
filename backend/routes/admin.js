const express = require('express');
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { uploadsDir } = require('../middleware/upload');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// GET /api/admin/audit-log?limit=200&offset=0&action=&actor_id=
router.get('/audit-log', (req, res) => {
  const limit = Math.min(+req.query.limit || 200, 500);
  const offset = +req.query.offset || 0;
  const params = [];
  let where = 'WHERE 1=1';
  if (req.query.action) { where += ' AND action LIKE ?'; params.push(`%${req.query.action}%`); }
  if (req.query.actor_id) { where += ' AND actor_id = ?'; params.push(+req.query.actor_id); }
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = db.prepare(`SELECT COUNT(*) as c FROM audit_log ${where}`).get(...params).c;
  res.json({ rows, total });
});

// GET /api/admin/backup/data — full JSON export of all non-sensitive data
router.get('/backup/data', (req, res) => {
  const tickets = db.prepare(`
    SELECT t.*, u1.name as originator_name, u2.name as assignee_name
    FROM tickets t
    LEFT JOIN users u1 ON t.originator_id = u1.id
    LEFT JOIN users u2 ON t.assignee_id = u2.id
    ORDER BY t.id
  `).all();
  const history = db.prepare(`
    SELECT ph.*, u.name as entered_by_name
    FROM ticket_phase_history ph LEFT JOIN users u ON ph.entered_by = u.id ORDER BY ph.id
  `).all();
  const comments = db.prepare(`
    SELECT c.*, u.name as author_name
    FROM comments c LEFT JOIN users u ON c.author_id = u.id ORDER BY c.id
  `).all();
  const attachments = db.prepare(`
    SELECT a.*, u.name as uploaded_by_name
    FROM ticket_attachments a LEFT JOIN users u ON a.uploaded_by = u.id ORDER BY a.id
  `).all();
  const users = db.prepare(
    'SELECT id, email, name, role, approved, email_verified, created_at FROM users ORDER BY id'
  ).all();
  const auditLog = db.prepare('SELECT * FROM audit_log ORDER BY id').all();
  res.json({ exported_at: new Date().toISOString(), tickets, history, comments, attachments, users, audit_log: auditLog });
});

// GET /api/admin/backup/zip — build and serve zip of all uploaded attachments
router.get('/backup/zip', (req, res) => {
  const attachments = db.prepare(`
    SELECT a.*, t.title as ticket_title
    FROM ticket_attachments a LEFT JOIN tickets t ON a.ticket_id = t.id
    ORDER BY a.ticket_id, a.uploaded_at
  `).all();

  const date = new Date().toISOString().slice(0, 10);
  // Write to temp file so nginx can serve it with Content-Length (avoids streaming buffer issues)
  const os = require('os');
  const tmpFile = path.join(os.tmpdir(), `bylaws-backup-${Date.now()}.zip`);
  const output = fs.createWriteStream(tmpFile);
  const archive = archiver('zip', { zlib: { level: 6 } });

  archive.on('error', err => {
    console.error('[backup/zip]', err);
    if (!res.headersSent) res.status(500).json({ error: 'Archive failed' });
  });

  output.on('close', () => {
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''bylaws-attachments-${date}.zip`);
    res.sendFile(tmpFile, (err) => {
      fs.unlink(tmpFile, () => {});
      if (err && !res.headersSent) res.status(500).json({ error: 'Send failed' });
    });
  });

  archive.pipe(output);

  for (const att of attachments) {
    const filePath = path.join(uploadsDir, att.filename);
    if (!fs.existsSync(filePath)) continue;
    archive.file(filePath, { name: `ticket-${att.ticket_id}/${att.original_name}` });
  }

  archive.finalize();
});

// ── Daily digest administration ────────────────────────────────────────────
const { runDigest, wantsDigest } = require('../digest');
const { logAudit } = require('../middleware/audit');

// GET /api/admin/digest — who currently receives the digest, and when it last ran
router.get('/digest', (req, res) => {
  const users = db.prepare(
    `SELECT id, name, email, role, approved, email_verified, digest_optin
     FROM users ORDER BY name`
  ).all();
  res.json({
    sendHourUtc: Number(process.env.DIGEST_HOUR_UTC ?? 16),
    lastRuns: db.prepare('SELECT day, sent_at, recipients FROM digest_runs ORDER BY day DESC LIMIT 7').all(),
    users: users.map(u => ({
      id: u.id, name: u.name, email: u.email, role: u.role,
      eligible: !!(u.approved && u.email_verified),
      subscribed: wantsDigest(u),
      explicit: u.digest_optin !== null && u.digest_optin !== undefined,
    })),
  });
});

// PATCH /api/admin/digest/:id — turn the digest on or off for someone
router.patch('/digest/:id', (req, res) => {
  const on = req.body?.subscribed;
  if (typeof on !== 'boolean') return res.status(400).json({ error: 'subscribed must be true or false' });
  const target = db.prepare('SELECT id, email FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'User not found' });

  db.prepare('UPDATE users SET digest_optin = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(on ? 1 : 0, target.id);
  logAudit(req.user.id, req.user.name, 'digest.optin', 'user', target.id,
    { email: target.email, subscribed: on, by: 'admin' }, req.ip);
  res.json({ subscribed: on });
});

// POST /api/admin/digest/test — send one digest now, to a single address
router.post('/digest/test', async (req, res) => {
  const to = String(req.body?.email || req.user.email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'Invalid email' });
  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(to)) {
    return res.status(400).json({ error: 'That address does not belong to a user of this system' });
  }
  try {
    // force: send even if today's digest already went out or there is no news.
    const r = await runDigest({ force: true, only: to });
    logAudit(req.user.id, req.user.name, 'digest.test', 'user', null, { to, sent: r.sent }, req.ip);
    if (!r.sent) return res.status(502).json({ error: r.failed?.[0]?.error || 'Send failed' });
    res.json({ sent: r.sent, to });
  } catch (e) {
    console.error('[digest/test]', e.message);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
