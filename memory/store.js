/**
 * Kingify v2 — SQLite Storage (sql.js — no native compilation needed)
 * Conversaciones, aprendizajes y preferencias persistentes
 */
const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const config = require('../config');
const DB_PATH = path.join(config.paths.db, 'kingify.db');

let db;

async function init() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const SQL = await initSqlJs();

  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tools_used TEXT,
      model TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS learnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT DEFAULT 'auto',
      created_at TEXT DEFAULT (datetime('now')),
      active INTEGER DEFAULT 1
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS preferences (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(contact_id, key)
    )
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_messages_contact ON messages(contact_id, created_at DESC)');
  db.run('CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category, active)');
  db.run('CREATE INDEX IF NOT EXISTS idx_preferences_contact ON preferences(contact_id)');

  save();
  console.log('[store] SQLite inicializado');
}

function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// --- Mensajes ---

function addMessage(contactId, role, content, meta = {}) {
  db.run(
    `INSERT INTO messages (contact_id, role, content, tools_used, model, tokens_in, tokens_out) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      contactId, role, content,
      meta.toolsUsed ? JSON.stringify(meta.toolsUsed) : null,
      meta.model || null,
      meta.tokensIn || 0,
      meta.tokensOut || 0,
    ]
  );
  save();
}

function getRecentMessages(contactId, limit = 10) {
  const stmt = db.prepare(`
    SELECT role, content, created_at FROM messages
    WHERE contact_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  stmt.bind([contactId, limit]);

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results.reverse();
}

// --- Aprendizajes ---

function addLearning(category, content, source = 'auto') {
  db.run(
    `INSERT INTO learnings (category, content, source) VALUES (?, ?, ?)`,
    [category, content, source]
  );
  save();
  console.log(`[store] Aprendizaje guardado: [${category}] ${content.substring(0, 60)}`);
}

function getLearnings(category = null) {
  let stmt;
  if (category) {
    stmt = db.prepare('SELECT * FROM learnings WHERE category = ? AND active = 1 ORDER BY created_at DESC');
    stmt.bind([category]);
  } else {
    stmt = db.prepare('SELECT * FROM learnings WHERE active = 1 ORDER BY created_at DESC');
  }

  const results = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject());
  }
  stmt.free();
  return results;
}

function searchLearnings(query) {
  const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
  if (words.length === 0) return [];

  const all = getLearnings();
  return all
    .map(l => {
      const text = l.content.toLowerCase();
      const score = words.reduce((s, w) => s + (text.includes(w) ? 1 : 0), 0);
      return { ...l, score };
    })
    .filter(l => l.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

// --- Preferencias ---

function setPreference(contactId, key, value) {
  db.run(
    `INSERT INTO preferences (contact_id, key, value, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(contact_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
    [contactId, key, value]
  );
  save();
}

function getPreferences(contactId) {
  const stmt = db.prepare('SELECT key, value FROM preferences WHERE contact_id = ?');
  stmt.bind([contactId]);

  const prefs = {};
  while (stmt.step()) {
    const row = stmt.getAsObject();
    prefs[row.key] = row.value;
  }
  stmt.free();
  return prefs;
}

// --- Migración desde v1 ---

function migrateFromV1(aprendizajesPath, chatsDir) {
  if (aprendizajesPath && fs.existsSync(aprendizajesPath)) {
    const content = fs.readFileSync(aprendizajesPath, 'utf-8');
    const sections = content.split(/^## /m).filter(Boolean);

    let count = 0;
    for (const section of sections) {
      const lines = section.trim().split('\n');
      const titulo = lines[0].trim();
      const contenido = lines.slice(1).join('\n').replace(/\*Guardado:.*\*/g, '').trim();
      if (contenido) {
        addLearning('preferencia', `${titulo}: ${contenido}`, 'v1-migration');
        count++;
      }
    }
    if (count > 0) console.log(`[store] Migrados ${count} aprendizajes de v1`);
  }

  if (chatsDir && fs.existsSync(chatsDir)) {
    const files = fs.readdirSync(chatsDir).filter(f => f.endsWith('.log'));
    let msgCount = 0;

    for (const file of files) {
      const contactId = file.replace('.log', '');
      const lines = fs.readFileSync(path.join(chatsDir, file), 'utf-8').split('\n').filter(Boolean);

      for (const line of lines) {
        const match = line.match(/\[([^\]]+)\] (👤 David|🤖 Kingify): (.*)/);
        if (match) {
          const role = match[2].includes('David') ? 'user' : 'assistant';
          addMessage(contactId, role, match[3]);
          msgCount++;
        }
      }
    }
    if (msgCount > 0) console.log(`[store] Migrados ${msgCount} mensajes de v1`);
  }
}

// --- Stats ---

function getStats() {
  const msgStmt = db.prepare('SELECT COUNT(*) as count FROM messages');
  msgStmt.step();
  const messages = msgStmt.getAsObject().count;
  msgStmt.free();

  const lrnStmt = db.prepare('SELECT COUNT(*) as count FROM learnings WHERE active = 1');
  lrnStmt.step();
  const learnings = lrnStmt.getAsObject().count;
  lrnStmt.free();

  const ctcStmt = db.prepare('SELECT COUNT(DISTINCT contact_id) as count FROM messages');
  ctcStmt.step();
  const contacts = ctcStmt.getAsObject().count;
  ctcStmt.free();

  return { messages, learnings, contacts };
}

function close() {
  if (db) {
    save();
    db.close();
  }
}

module.exports = {
  init,
  addMessage,
  getRecentMessages,
  addLearning,
  getLearnings,
  searchLearnings,
  setPreference,
  getPreferences,
  migrateFromV1,
  getStats,
  close,
};
