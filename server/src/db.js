// SQLite storage. One file, no database server to run next to everything
// else on the box — at game-hub scale a single writer is plenty, and WAL mode
// keeps reads from ever waiting on it.
//
// Privacy by construction: a user is the opaque Google account id (`sub`) and
// a nickname they pick. No e-mail address, real name or picture is stored.

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY,
  google_sub  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS saves (
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game        TEXT NOT NULL,
  data        TEXT NOT NULL,
  rev         INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, game)
);
`;

export function openDb(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const q = {
    userBySub: db.prepare("SELECT * FROM users WHERE google_sub = ?"),
    userById: db.prepare("SELECT * FROM users WHERE id = ?"),
    insertUser: db.prepare("INSERT INTO users (google_sub, name, created_at) VALUES (?, ?, ?)"),
    renameUser: db.prepare("UPDATE users SET name = ? WHERE id = ?"),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)"),
    sessionUser: db.prepare(`
      SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?`),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    purgeSessions: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),
    getSave: db.prepare("SELECT data, rev, updated_at FROM saves WHERE user_id = ? AND game = ?"),
    listSaves: db.prepare("SELECT game, rev, updated_at FROM saves WHERE user_id = ?"),
    putSave: db.prepare(`
      INSERT INTO saves (user_id, game, data, rev, updated_at) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT (user_id, game) DO UPDATE SET data = excluded.data, rev = saves.rev + 1, updated_at = excluded.updated_at
      RETURNING rev, updated_at`),
  };

  return {
    raw: db,
    findOrCreateUser(sub, makeName) {
      const found = q.userBySub.get(sub);
      if (found) return { user: found, created: false };
      const info = q.insertUser.run(sub, makeName(), Date.now());
      return { user: q.userById.get(info.lastInsertRowid), created: true };
    },
    renameUser: (id, name) => q.renameUser.run(name, id),
    deleteUser: (id) => q.deleteUser.run(id),
    createSession: (tokenHash, userId, ttlMs) => {
      const now = Date.now();
      q.insertSession.run(tokenHash, userId, now, now + ttlMs);
    },
    sessionUser: (tokenHash) => q.sessionUser.get(tokenHash, Date.now()) ?? null,
    deleteSession: (tokenHash) => q.deleteSession.run(tokenHash),
    purgeSessions: () => q.purgeSessions.run(Date.now()),
    getSave: (userId, game) => q.getSave.get(userId, game) ?? null,
    listSaves: (userId) => q.listSaves.all(userId),
    putSave: (userId, game, data) => q.putSave.get(userId, game, data, Date.now()),
    close: () => db.close(),
  };
}
