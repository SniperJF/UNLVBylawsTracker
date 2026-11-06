const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.EMAIL_PORT || '587'),
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const FROM = process.env.EMAIL_FROM || '"UNLV Bylaws Tracker" <appdev@unlv.edu>';
const BASE_URL = process.env.FRONTEND_URL || 'https://app.cs.unlv.edu/BylawsTracker';

// HTML-escape all user-controlled values before inserting into email templates
function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function sendVerificationEmail(email, name, token) {
  const link = `${BASE_URL}/verify-email.html?token=${encodeURIComponent(token)}`;
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Verify your UNLV Bylaws Tracker account',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;">
        <h2 style="color:#cf0a2c;">UNLV Bylaws Tracker</h2>
        <p>Hi ${esc(name)},</p>
        <p>Please verify your email address to continue registration:</p>
        <p><a href="${link}" style="background:#cf0a2c;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;">Verify Email</a></p>
        <p style="color:#666;font-size:0.85em;">Link expires in 24 hours. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

async function sendApprovalEmail(email, name) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Your UNLV Bylaws Tracker account has been approved',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;">
        <h2 style="color:#cf0a2c;">UNLV Bylaws Tracker</h2>
        <p>Hi ${esc(name)},</p>
        <p>Your account has been approved. You can now <a href="${BASE_URL}/login.html">log in</a>.</p>
      </div>
    `,
  });
}

async function sendPasswordResetEmail(email, name, token) {
  const link = `${BASE_URL}/reset-password.html?token=${encodeURIComponent(token)}`;
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: 'Reset your UNLV Bylaws Tracker password',
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;">
        <h2 style="color:#cf0a2c;">UNLV Bylaws Tracker</h2>
        <p>Hi ${esc(name)},</p>
        <p>You requested a password reset:</p>
        <p><a href="${link}" style="background:#cf0a2c;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;">Reset Password</a></p>
        <p style="color:#666;font-size:0.85em;">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
      </div>
    `,
  });
}

async function sendDeadlineNudge(email, name, ticketTitle, daysLeft, phase) {
  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `Action required: "${esc(ticketTitle)}" deadline in ${daysLeft} day(s)`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;">
        <h2 style="color:#cf0a2c;">UNLV Bylaws Tracker — Deadline Alert</h2>
        <p>Hi ${esc(name)},</p>
        <p>The ticket <strong>"${esc(ticketTitle)}"</strong> has been in <strong>${esc(phase)}</strong> and has <strong>${daysLeft} day(s)</strong> remaining before the deadline.</p>
        <p>If no action is taken, the Senate may need to re-vote on this amendment.</p>
        <p><a href="${BASE_URL}/dashboard.html" style="background:#cf0a2c;color:white;padding:10px 20px;text-decoration:none;border-radius:4px;display:inline-block;">View Dashboard</a></p>
      </div>
    `,
  });
}

const PHASE_LABEL = (p) => String(p || '').replace(/_/g, ' ');

function section(title, rows) {
  if (!rows.length) return '';
  return `
    <h3 style="margin:22px 0 8px;font-size:14px;color:#1c1626;border-bottom:1px solid #e5e1ee;padding-bottom:5px;">${esc(title)}</h3>
    <ul style="margin:0;padding-left:18px;color:#3b3550;font-size:13px;line-height:1.7;">${rows.join('')}</ul>`;
}

async function sendDigestEmail(email, name, d, opts = {}) {
  const link = (id) => `${BASE_URL}/ticket.html?id=${id}`;
  const a = (id, text) => `<a href="${link(id)}" style="color:#cf0a2c;text-decoration:none;">${esc(text)}</a>`;

  const overdue = d.overdue.map(t =>
    `<li><strong style="color:#b91c1c;">${Math.abs(t.daysLeft)} day(s) overdue</strong> — ${a(t.id, t.title)} <span style="color:#6b6480;">(${esc(PHASE_LABEL(t.current_phase))}, ${t.limit}-day limit)</span></li>`);

  const dueSoon = d.dueSoon.map(t =>
    `<li><strong>${t.daysLeft} day(s) left</strong> of ${t.limit} — ${a(t.id, t.title)} <span style="color:#6b6480;">(${esc(PHASE_LABEL(t.current_phase))})</span></li>`);

  const moved = d.moved.map(m =>
    `<li>${a(m.id, m.title)} → <strong>${esc(PHASE_LABEL(m.phase))}</strong>${m.by_name ? ` <span style="color:#6b6480;">by ${esc(m.by_name)}</span>` : ''}</li>`);

  const comments = d.comments.map(c =>
    `<li><strong>${esc(c.author || 'Someone')}</strong> on ${a(c.ticket_id, c.title)}: <span style="color:#6b6480;">${esc(String(c.body).slice(0, 120))}${String(c.body).length > 120 ? '…' : ''}</span></li>`);

  const onHold = d.onHold.map(t =>
    `<li>${a(t.id, t.title)} <span style="color:#6b6480;">(${esc(PHASE_LABEL(t.current_phase))})</span></li>`);

  const body =
    section('⚠ Overdue', overdue) +
    section('Deadlines within 7 days', dueSoon) +
    section('Moved in the last 24 hours', moved) +
    section('New comments', comments) +
    section('On hold', onHold);

  await transporter.sendMail({
    from: FROM,
    to: email,
    subject: `${opts.test ? '[TEST] ' : ''}Bylaws Tracker — daily digest${d.overdue.length ? ` (${d.overdue.length} overdue)` : ''}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:620px;margin:auto;color:#1c1626;">
        <h2 style="color:#cf0a2c;margin-bottom:2px;">UNLV Bylaws Tracker</h2>
        <div style="font-size:12px;color:#6b6480;margin-bottom:16px;">Daily digest · ${new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric', year:'numeric' })}</div>
        ${opts.test ? '<p style="background:#fff4e5;border:1px solid #f0c38e;padding:9px 12px;border-radius:6px;font-size:13px;">This is a test send, triggered manually from the admin page.</p>' : ''}
        <p style="font-size:14px;">Hi ${esc(name)},</p>
        <p style="font-size:13px;color:#3b3550;">
          <strong>${d.totals.active}</strong> active &middot; <strong>${d.totals.onHold}</strong> on hold &middot; <strong>${d.totals.complete}</strong> complete
        </p>
        ${body || '<p style="font-size:13px;color:#6b6480;">Nothing moved in the last 24 hours and nothing needs attention.</p>'}
        <p style="margin-top:26px;">
          <a href="${BASE_URL}/dashboard.html" style="background:#cf0a2c;color:white;padding:10px 18px;text-decoration:none;border-radius:4px;display:inline-block;font-size:13px;">Open the dashboard</a>
        </p>
        <p style="color:#8b8599;font-size:11px;margin-top:22px;border-top:1px solid #e5e1ee;padding-top:10px;">
          You receive this because you are subscribed to the daily digest.
          Change that under Email Digest on the <a href="${BASE_URL}/notifications.html" style="color:#6b6480;">notifications page</a>.
        </p>
      </div>`,
  });
}

module.exports = { sendVerificationEmail, sendApprovalEmail, sendPasswordResetEmail, sendDeadlineNudge, sendDigestEmail };
