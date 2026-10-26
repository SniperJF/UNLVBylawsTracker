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

module.exports = { sendVerificationEmail, sendApprovalEmail, sendPasswordResetEmail, sendDeadlineNudge };
