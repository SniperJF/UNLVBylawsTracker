const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const dbPath = path.resolve(__dirname, process.env.SQLITE_PATH || '../bylaws.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'read_only',
    password_hash TEXT NOT NULL,
    approved INTEGER NOT NULL DEFAULT 0,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verify_token TEXT,
    reset_token TEXT,
    reset_expires INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS account_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    role_requested TEXT NOT NULL DEFAULT 'read_only',
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    reviewed_by INTEGER REFERENCES users(id),
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tickets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL CHECK(type IN ('university_amendment','unit_bylaws')),
    title TEXT NOT NULL,
    description TEXT,
    bylaws_section TEXT,
    current_phase TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','stuck','published')),
    originator_id INTEGER REFERENCES users(id),
    assignee_id INTEGER REFERENCES users(id),
    unit_name TEXT,
    senate_meeting_date TEXT,
    vote_result TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ticket_phase_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    phase TEXT NOT NULL,
    entered_at TEXT NOT NULL DEFAULT (datetime('now')),
    exited_at TEXT,
    entered_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS ticket_attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT,
    size INTEGER,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
    uploaded_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id),
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    ticket_id INTEGER REFERENCES tickets(id),
    read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Seed admin account on first run
function seedAdmin() {
  const adminEmail = process.env.ADMIN_EMAIL || 'jorge.fonsecacacho@unlv.edu';
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(adminEmail);
  if (!existing) {
    const hash = bcrypt.hashSync('Admin#UNLV2026!', 12);
    db.prepare(`
      INSERT INTO users (email, name, role, password_hash, approved, email_verified)
      VALUES (?, ?, 'admin', ?, 1, 1)
    `).run(adminEmail, 'Jorge Fonseca', hash);
    console.log(`[db] Seeded admin account: ${adminEmail}`);
  }
}

seedAdmin();

module.exports = db;
