// ════════════════════════════════════════════════════════
//  routes/auth.js — Registro, login, perfil, logout
// ════════════════════════════════════════════════════════
const bcrypt = require('bcrypt');
const jwt    = require('jsonwebtoken');
const { pool } = require('../db');

const JWT_SECRET  = process.env.JWT_SECRET  || 'agrobot_secret_mude_em_producao';
const SALT_ROUNDS = 12;

// ── Helpers ──────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}

async function saveSessionRecord(userId, token) {
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await pool.query(
    'INSERT INTO sessions (user_id, token, expires_at) VALUES ($1, $2, $3)',
    [userId, token, expiresAt]
  );
}

function jsonRes(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function extractToken(req) {
  const auth = req.headers['authorization'] || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : null;
}

// Middleware: verifica JWT e valida sessão ativa
async function requireAuth(req) {
  const token = extractToken(req);
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const result = await pool.query('SELECT 1 FROM sessions WHERE token=$1', [token]);
    if (!result.rows.length) return null;
    return payload.sub;
  } catch {
    return null;
  }
}

// ── POST /api/register ───────────────────────────────────
async function register(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return jsonRes(res, 400, { error: 'Preencha todos os campos.' });

  if (!email.includes('@'))
    return jsonRes(res, 400, { error: 'E-mail inválido.' });

  if (password.length < 8)
    return jsonRes(res, 400, { error: 'Senha mínimo 8 caracteres.' });

  try {
    // Verifica se e-mail já existe
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length)
      return jsonRes(res, 409, { error: 'E-mail já cadastrado. Faça login.' });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = await pool.query(
      `INSERT INTO users (name, email, password)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, plan`,
      [name.trim(), email.toLowerCase(), hash]
    );
    const user  = result.rows[0];
    const token = signToken(user.id);
    await saveSessionRecord(user.id, token);

    jsonRes(res, 201, {
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan }
    });
  } catch (err) {
    console.error('[register]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── POST /api/login ──────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password)
    return jsonRes(res, 400, { error: 'Preencha e-mail e senha.' });

  try {
    const result = await pool.query(
      'SELECT id, name, email, password, plan FROM users WHERE email=$1',
      [email.toLowerCase()]
    );

    if (!result.rows.length)
      return jsonRes(res, 401, { error: 'E-mail ou senha incorretos.' });

    const user = result.rows[0];

    if (!user.password)
      return jsonRes(res, 401, { error: 'Esta conta usa login pelo Google.' });

    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return jsonRes(res, 401, { error: 'E-mail ou senha incorretos.' });

    const token = signToken(user.id);
    await saveSessionRecord(user.id, token);
    jsonRes(res, 200, {
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan }
    });
  } catch (err) {
    console.error('[login]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── POST /api/google-auth ────────────────────────────────
// O frontend já validou com Google e nos passa os dados do usuário
async function googleAuth(req, res) {
  const { name, email, picture, sub } = req.body;

  if (!email || !sub)
    return jsonRes(res, 400, { error: 'Dados do Google incompletos.' });

  try {
    // Verifica se já existe
    let result = await pool.query(
      'SELECT id, name, email, plan FROM users WHERE email=$1',
      [email.toLowerCase()]
    );

    let user;
    if (result.rows.length) {
      // Atualiza google_sub e picture se necessário
      await pool.query(
        'UPDATE users SET google_sub=$1, picture=$2 WHERE email=$3',
        [sub, picture || '', email.toLowerCase()]
      );
      user = result.rows[0];
    } else {
      // Cria conta nova via Google (sem senha)
      const ins = await pool.query(
        `INSERT INTO users (name, email, google_sub, picture)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, plan`,
        [name || email.split('@')[0], email.toLowerCase(), sub, picture || '']
      );
      user = ins.rows[0];
    }

    const token = signToken(user.id);
    await saveSessionRecord(user.id, token);
    jsonRes(res, 200, {
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan }
    });
  } catch (err) {
    console.error('[googleAuth]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── GET /api/me ──────────────────────────────────────────
async function me(req, res) {
  const userId = await requireAuth(req);
  if (!userId) return jsonRes(res, 401, { error: 'Não autenticado.' });

  try {
    const result = await pool.query(
      'SELECT id, name, email, plan, picture FROM users WHERE id=$1',
      [userId]
    );
    if (!result.rows.length) return jsonRes(res, 404, { error: 'Usuário não encontrado.' });
    jsonRes(res, 200, { user: result.rows[0] });
  } catch (err) {
    console.error('[me]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── POST /api/logout ─────────────────────────────────────
async function logout(req, res) {
  const token = extractToken(req);
  if (token) {
    try {
      await pool.query('DELETE FROM sessions WHERE token=$1', [token]);
    } catch (err) {
      console.error('[logout]', err.message);
    }
  }
  jsonRes(res, 200, { ok: true });
}

module.exports = { register, login, googleAuth, me, logout, requireAuth };
