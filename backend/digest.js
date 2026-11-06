// Daily digest: one email summarising what moved, what is waiting, and what is
// about to lapse. Admins are subscribed by default and can opt out; everyone
// else opts in from the notifications page.
const db = require('./db');
const { ADMIN_ROLES } = require('./middleware/auth');
const { sendDigestEmail } = require('./email');

// Server clock is UTC. 16:00 UTC is 8am Pacific in winter, 9am in summer.
const SEND_HOUR_UTC = Number(process.env.DIGEST_HOUR_UTC ?? 16);
const PHASE_DEADLINES = { PRESIDENT_REVIEW: 20, CHANCELLOR_REVIEW: 45 };

// NULL = follow the role default, so a role change takes effect immediately.
function wantsDigest(user) {
  if (user.digest_optin === null || user.digest_optin === undefined) {
    return ADMIN_ROLES.includes(user.role);
  }
  return Number(user.digest_optin) === 1;
}

function subscribers() {
  return db.prepare(
    `SELECT id, email, name, role, digest_optin FROM users
     WHERE approved = 1 AND email_verified = 1`
  ).all().filter(wantsDigest);
}

// SQLite stores timestamps as UTC without a zone marker; make them parseable.
function asDate(s) {
  if (!s) return null;
  const d = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(String(s).trim())
    ? new Date(String(s).trim().replace(' ', 'T') + 'Z')
    : new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function buildDigest(sinceHours = 24) {
  const cutoff = new Date(Date.now() - sinceHours * 3600 * 1000).toISOString();

  const moved = db.prepare(`
    SELECT t.id, t.title, ph.phase, ph.entered_at, u.name AS by_name
    FROM ticket_phase_history ph
    JOIN tickets t ON t.id = ph.ticket_id
    LEFT JOIN users u ON u.id = ph.entered_by
    WHERE ph.entered_at >= ?
    ORDER BY ph.entered_at DESC
  `).all(cutoff);

  const comments = db.prepare(`
    SELECT c.ticket_id, t.title, u.name AS author, c.body, c.created_at
    FROM comments c
    JOIN tickets t ON t.id = c.ticket_id
    LEFT JOIN users u ON u.id = c.author_id
    WHERE c.created_at >= ?
    ORDER BY c.created_at DESC
  `).all(cutoff);

  const onHold = db.prepare(
    `SELECT id, title, current_phase FROM tickets WHERE status = 'stuck' ORDER BY updated_at DESC`
  ).all();

  // Anything sitting in a phase with a statutory clock.
  const timed = db.prepare(`
    SELECT t.id, t.title, t.current_phase,
      (SELECT entered_at FROM ticket_phase_history
        WHERE ticket_id = t.id AND phase = t.current_phase AND exited_at IS NULL
        ORDER BY entered_at DESC LIMIT 1) AS entered_at
    FROM tickets t
    WHERE t.status != 'published' AND t.current_phase IN ('PRESIDENT_REVIEW','CHANCELLOR_REVIEW')
  `).all();

  const deadlines = [];
  for (const t of timed) {
    const entered = asDate(t.entered_at);
    if (!entered) continue;
    const limit = PHASE_DEADLINES[t.current_phase];
    const daysLeft = Math.ceil((entered.getTime() + limit * 86400000 - Date.now()) / 86400000);
    deadlines.push({ ...t, limit, daysLeft });
  }
  deadlines.sort((a, b) => a.daysLeft - b.daysLeft);

  return {
    moved, comments, onHold,
    overdue: deadlines.filter(d => d.daysLeft < 0),
    dueSoon: deadlines.filter(d => d.daysLeft >= 0 && d.daysLeft <= 7),
    totals: {
      active: db.prepare("SELECT COUNT(*) c FROM tickets WHERE status = 'active'").get().c,
      onHold: onHold.length,
      complete: db.prepare("SELECT COUNT(*) c FROM tickets WHERE status = 'published'").get().c,
    },
  };
}

// Nothing moved and nothing needs attention — skip rather than send noise.
function isQuiet(d) {
  return !d.moved.length && !d.comments.length && !d.onHold.length
      && !d.overdue.length && !d.dueSoon.length;
}

async function runDigest({ force = false, only = null, sinceHours = 24 } = {}) {
  const day = new Date().toISOString().slice(0, 10);
  if (!force && db.prepare('SELECT 1 FROM digest_runs WHERE day = ?').get(day)) {
    return { skipped: 'already sent today' };
  }

  const data = buildDigest(sinceHours);
  if (!force && isQuiet(data)) {
    db.prepare('INSERT OR REPLACE INTO digest_runs (day, recipients) VALUES (?, 0)').run(day);
    return { skipped: 'nothing to report' };
  }

  const targets = only
    ? db.prepare('SELECT id, email, name, role, digest_optin FROM users WHERE email = ?').all(only)
    : subscribers();

  let sent = 0;
  const failed = [];
  for (const u of targets) {
    try {
      await sendDigestEmail(u.email, u.name, data, { test: !!only });
      sent++;
    } catch (e) {
      failed.push({ email: u.email, error: e.message });
      console.error('[digest] send failed for', u.email, e.message);
    }
  }

  if (!only) {
    db.prepare('INSERT OR REPLACE INTO digest_runs (day, recipients) VALUES (?, ?)').run(day, sent);
  }
  return { sent, failed, recipients: targets.map(t => t.email), quiet: isQuiet(data) };
}

// Checked every 15 minutes; the digest_runs row is what actually prevents a
// second send, so a restart inside the send hour is harmless.
function startScheduler() {
  const tick = async () => {
    try {
      if (new Date().getUTCHours() !== SEND_HOUR_UTC) return;
      const r = await runDigest();
      if (r.sent) console.log(`[digest] sent to ${r.sent} recipient(s)`);
    } catch (e) {
      console.error('[digest] scheduler error:', e.message);
    }
  };
  setInterval(tick, 15 * 60 * 1000);
  console.log(`[digest] scheduler armed for ${SEND_HOUR_UTC}:00 UTC`);
}

module.exports = { runDigest, buildDigest, subscribers, wantsDigest, startScheduler };
