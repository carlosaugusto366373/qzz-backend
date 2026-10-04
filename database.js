const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync('keys.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT UNIQUE NOT NULL,
    hwid TEXT,
    duration_days INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    activated_at INTEGER,
    active INTEGER DEFAULT 1,
    last_ip TEXT,
    note TEXT
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    key TEXT,
    action TEXT,
    detail TEXT,
    ip TEXT,
    created_at INTEGER NOT NULL
  );
`);

module.exports = db;