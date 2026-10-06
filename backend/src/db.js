'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'subtitles.db');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('editor', 'reviewer')),
  display_name  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cues (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  seq        INTEGER NOT NULL,
  start_ms   INTEGER NOT NULL CHECK (start_ms >= 0),
  end_ms     INTEGER NOT NULL CHECK (end_ms >= 0 AND end_ms > start_ms),
  text       TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  orig_start_ms INTEGER NOT NULL DEFAULT 0,
  orig_end_ms   INTEGER NOT NULL DEFAULT 0,
  orig_text     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS proposals (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  cue_id            INTEGER NOT NULL REFERENCES cues(id) ON DELETE CASCADE,
  author_id         INTEGER NOT NULL REFERENCES users(id),
  author_name       TEXT NOT NULL,
  based_on_version  INTEGER NOT NULL,
  new_text          TEXT NOT NULL,
  new_start_ms      INTEGER NOT NULL CHECK (new_start_ms >= 0),
  new_end_ms        INTEGER NOT NULL CHECK (new_end_ms >= 0 AND new_end_ms > new_start_ms),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'accepted', 'rejected')),
  review_reason     TEXT,
  reviewer_id       INTEGER REFERENCES users(id),
  reviewer_name     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at       TEXT
);

CREATE INDEX IF NOT EXISTS idx_proposals_cue    ON proposals(cue_id);
CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
CREATE INDEX IF NOT EXISTS idx_cues_start       ON cues(start_ms);
`);

function seedUsers() {
  if (process.env.SEED_USERS === 'false') return;
  const insert = db.prepare(
    `INSERT OR IGNORE INTO users (username, password_hash, role, display_name)
     VALUES (?, ?, ?, ?)`
  );
  const accounts = [
    { username: 'editor', password: 'editor123', role: 'editor', display_name: '编辑者（示例）' },
    { username: 'reviewer', password: 'reviewer123', role: 'reviewer', display_name: '审校者（示例）' }
  ];
  for (const a of accounts) {
    insert.run(a.username, bcrypt.hashSync(a.password, 10), a.role, a.display_name);
  }
}

function seedSampleSrt() {
  if (process.env.SEED_SAMPLE_SRT === 'false') return;
  const count = db.prepare('SELECT COUNT(*) AS n FROM cues').get().n;
  if (count > 0) return;

  const sample = [
    [0, 4200, '【示例工程】\n清晨，第一缕阳光掠过山脊。'],
    [4300, 9000, '摄制组在海拔四千米的营地等待风停。'],
    [9200, 14000, '他们追踪的雪豹已经消失了整整三周。'],
    [14200, 19500, '今天，红外相机传回了新的画面。'],
    [19700, 25000, '母豹带着两只幼崽，正在巡视领地。']
  ];
  const insertCue = db.prepare(
    `INSERT INTO cues (seq, start_ms, end_ms, text, version, orig_start_ms, orig_end_ms, orig_text)
     VALUES (?, ?, ?, ?, 1, ?, ?, ?)`
  );
  const tx = db.transaction((rows) => {
    rows.forEach((r, i) => insertCue.run(i + 1, r[0], r[1], r[2], r[0], r[1], r[2]));
  });
  tx(sample);
  console.log('[seed] inserted sample documentary cues');
}

seedUsers();
seedSampleSrt();

module.exports = db;
