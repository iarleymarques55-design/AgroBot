// ════════════════════════════════════════════════════════
//  routes/conversations.js — CRUD de conversas e mensagens
// ════════════════════════════════════════════════════════
const { pool }       = require('../db');
const { requireAuth } = require('./auth');

function jsonRes(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── GET /api/conversations ───────────────────────────────
async function listConversations(req, res) {
  const userId = await requireAuth(req);
  if (!userId) return jsonRes(res, 401, { error: 'Não autenticado.' });

  try {
    const result = await pool.query(
      `SELECT id, title, created_at
       FROM conversations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [userId]
    );
    jsonRes(res, 200, { conversations: result.rows });
  } catch (err) {
    console.error('[listConversations]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── POST /api/conversations ──────────────────────────────
async function createConversation(req, res) {
  const userId = await requireAuth(req);
  if (!userId) return jsonRes(res, 401, { error: 'Não autenticado.' });

  const title = req.body.title || 'Nova conversa';

  try {
    const result = await pool.query(
      `INSERT INTO conversations (user_id, title)
       VALUES ($1, $2)
       RETURNING id, title, created_at`,
      [userId, title]
    );
    jsonRes(res, 201, { conversation: result.rows[0] });
  } catch (err) {
    console.error('[createConversation]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── DELETE /api/conversations/:id ───────────────────────
async function deleteConversation(req, res, convId) {
  const userId = await requireAuth(req);
  if (!userId) return jsonRes(res, 401, { error: 'Não autenticado.' });

  try {
    const result = await pool.query(
      'DELETE FROM conversations WHERE id=$1 AND user_id=$2 RETURNING id',
      [convId, userId]
    );
    if (!result.rows.length) return jsonRes(res, 404, { error: 'Conversa não encontrada.' });
    jsonRes(res, 200, { ok: true });
  } catch (err) {
    console.error('[deleteConversation]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── GET /api/conversations/:id/messages ─────────────────
async function listMessages(req, res, convId) {
  const userId = await requireAuth(req);
  if (!userId) return jsonRes(res, 401, { error: 'Não autenticado.' });

  try {
    // Garante que a conversa pertence ao usuário
    const conv = await pool.query(
      'SELECT id FROM conversations WHERE id=$1 AND user_id=$2',
      [convId, userId]
    );
    if (!conv.rows.length) return jsonRes(res, 404, { error: 'Conversa não encontrada.' });

    const result = await pool.query(
      `SELECT id, role, content, created_at
       FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC`,
      [convId]
    );
    jsonRes(res, 200, { messages: result.rows });
  } catch (err) {
    console.error('[listMessages]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── POST /api/conversations/:id/messages ─────────────────
async function saveMessage(req, res, convId) {
  const userId = await requireAuth(req);
  if (!userId) return jsonRes(res, 401, { error: 'Não autenticado.' });

  const { role, content } = req.body;
  if (!role || !content) return jsonRes(res, 400, { error: 'role e content obrigatórios.' });

  try {
    // Garante que a conversa pertence ao usuário
    const conv = await pool.query(
      'SELECT id, title FROM conversations WHERE id=$1 AND user_id=$2',
      [convId, userId]
    );
    if (!conv.rows.length) return jsonRes(res, 404, { error: 'Conversa não encontrada.' });

    // Se o título ainda é padrão e é mensagem do usuário, atualiza o título
    if (role === 'user' && conv.rows[0].title === 'Nova conversa') {
      const shortTitle = content.substring(0, 60).replace(/\n/g, ' ');
      await pool.query('UPDATE conversations SET title=$1 WHERE id=$2', [shortTitle, convId]);
    }

    const result = await pool.query(
      `INSERT INTO messages (conversation_id, role, content)
       VALUES ($1, $2, $3)
       RETURNING id, role, content, created_at`,
      [convId, role, content]
    );
    jsonRes(res, 201, { message: result.rows[0] });
  } catch (err) {
    console.error('[saveMessage]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

module.exports = {
  listConversations,
  createConversation,
  deleteConversation,
  listMessages,
  saveMessage,
};
