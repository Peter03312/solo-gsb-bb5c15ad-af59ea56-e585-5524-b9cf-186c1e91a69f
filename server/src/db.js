import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

let db;

/**
 * 打开数据库并初始化表结构。
 * @param {string} dbPath SQLite 文件路径（:memory: 用于测试）
 */
export function initDb(dbPath) {
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('editor', 'reviewer')),
      display_name  TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS subtitles (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      seq         INTEGER NOT NULL,            -- 导入时的原始顺序
      text        TEXT NOT NULL,              -- 已接受文本
      start_ms    INTEGER NOT NULL,           -- 已接受起点
      end_ms      INTEGER NOT NULL,           -- 已接受终点
      version     INTEGER NOT NULL DEFAULT 1, -- 已接受版本号
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS proposals (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      subtitle_id        INTEGER NOT NULL REFERENCES subtitles(id) ON DELETE CASCADE,
      proposer_id        INTEGER NOT NULL REFERENCES users(id),
      base_version       INTEGER NOT NULL,  -- 提议所依据的已接受版本
      new_text           TEXT NOT NULL,
      new_start_ms       INTEGER NOT NULL,
      new_end_ms         INTEGER NOT NULL,
      status             TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','accepted','rejected','conflicted')),
      conflict_reason    TEXT,
      reviewed_by        INTEGER REFERENCES users(id),
      reviewed_at        TEXT,
      created_at         TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_subtitles_start ON subtitles(start_ms);
    CREATE INDEX IF NOT EXISTS idx_proposals_subtitle ON proposals(subtitle_id);
    CREATE INDEX IF NOT EXISTS idx_proposals_status ON proposals(status);
  `);

  return db;
}

export function getDb() {
  if (!db) throw new Error('数据库尚未初始化');
  return db;
}

/**
 * 首次启动时创建默认账号；users 表已有数据则跳过（不覆盖改密结果）。
 */
export function seedUsersIfEmpty({ editor, reviewer }) {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (row.n > 0) return;
  const insert = db.prepare(
    'INSERT INTO users (username, password_hash, role, display_name) VALUES (?, ?, ?, ?)'
  );
  for (const u of [editor, reviewer]) {
    insert.run(u.username, bcrypt.hashSync(u.password, 10), u.role, u.displayName);
  }
}
