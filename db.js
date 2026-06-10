// ════════════════════════════════════════════════════════
//  db.js — Conexão com PostgreSQL + criação das tabelas
// ════════════════════════════════════════════════════════
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL
    ? { rejectUnauthorized: false }
    : false,
});

// ── Criação das tabelas (executa ao iniciar o servidor) ──
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name          TEXT NOT NULL,
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT,
        google_sub    TEXT,
        picture       TEXT,
        plan          TEXT DEFAULT 'free',
        created_at    TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title      TEXT DEFAULT 'Nova conversa',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS messages (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        role            TEXT NOT NULL CHECK (role IN ('user','assistant')),
        content         TEXT NOT NULL,
        created_at      TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token      TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id);
      CREATE INDEX IF NOT EXISTS idx_messages_conv      ON messages(conversation_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_token     ON sessions(token);
    `);
    console.log('[DB] Tabelas verificadas/criadas com sucesso.');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };