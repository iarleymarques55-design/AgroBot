const bcrypt   = require('bcrypt');
const jwt      = require('jsonwebtoken');
const https    = require('https');
const { pool } = require('../db');

const JWT_SECRET  = process.env.JWT_SECRET || 'agrobot_secret_mude_em_producao';
const SALT_ROUNDS = 12;
const MAILERSEND_KEY    = process.env.MAILERSEND_KEY;
const MAILERSEND_DOMAIN = 'test-pzkmgq7md6ll059v.mlsender.net';
const FROM_EMAIL        = `noreply@${MAILERSEND_DOMAIN}`;
const FROM_NAME         = 'AgroBot';

// ── Helpers ───────────────────────────────────────────────
function signToken(userId) {
  return jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: '30d' });
}

function jsonRes(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function requireAuth(req) {
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    return payload.sub;
  } catch {
    return null;
  }
}

function gerarCodigo() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ── Envio de e-mail via MailerSend API ────────────────────
function enviarEmailConfirmacao(email, nome, codigo) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      from: { email: FROM_EMAIL, name: FROM_NAME },
      to:   [{ email, name: nome }],
      subject: 'Confirme seu cadastro no AgroBot',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;background:#0B0E0A;color:#F0F5EC;padding:32px;border-radius:12px;border:1px solid rgba(163,230,53,0.2)">
          <h2 style="color:#A3E635;margin-bottom:8px;font-family:monospace">AGROBOT</h2>
          <p style="color:#B8CDB0;margin-bottom:24px">Olá, <strong>${nome}</strong>!</p>
          <p style="margin-bottom:16px">Use o código abaixo para confirmar seu cadastro:</p>
          <div style="background:#141A12;border:1px solid rgba(163,230,53,0.3);border-radius:8px;padding:24px;text-align:center;margin:24px 0">
            <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#A3E635;font-family:monospace">${codigo}</span>
          </div>
          <p style="color:#7FBF90;font-size:13px">Este código expira em <strong>10 minutos</strong>.</p>
          <p style="color:#7FBF90;font-size:13px;margin-top:8px">Se não foi você, ignore este e-mail.</p>
        </div>
      `,
    });

    const options = {
      hostname: 'api.mailersend.com',
      path:     '/v1/email',
      method:   'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${MAILERSEND_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
        } else {
          reject(new Error(`MailerSend erro ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ── POST /api/register ────────────────────────────────────
async function register(req, res) {
  const { name, email, password } = req.body;

  if (!name || !email || !password)
    return jsonRes(res, 400, { error: 'Preencha todos os campos.' });
  if (!email.includes('@'))
    return jsonRes(res, 400, { error: 'E-mail inválido.' });
  if (password.length < 8)
    return jsonRes(res, 400, { error: 'Senha mínimo 8 caracteres.' });

  try {
    const exists = await pool.query('SELECT id FROM users WHERE email=$1', [email.toLowerCase()]);
    if (exists.rows.length)
      return jsonRes(res, 409, { error: 'E-mail já cadastrado. Faça login.' });

    const codigo = gerarCodigo();
    const hash   = await bcrypt.hash(password, SALT_ROUNDS);
    const expira = new Date(Date.now() + 10 * 60 * 1000);

    await pool.query(
      `INSERT INTO email_verifications (email, name, password_hash, code, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (email) DO UPDATE
       SET name=$2, password_hash=$3, code=$4, expires_at=$5, created_at=NOW()`,
      [email.toLowerCase(), name.trim(), hash, codigo, expira]
    );

    await enviarEmailConfirmacao(email.toLowerCase(), name.trim(), codigo);

    jsonRes(res, 200, { ok: true, message: 'Código enviado para ' + email });
  } catch (err) {
    console.error('[register]', err.message);
    jsonRes(res, 500, { error: 'Erro ao enviar e-mail. Tente novamente.' });
  }
}

// ── POST /api/verify-email ────────────────────────────────
async function verifyEmail(req, res) {
  const { email, code } = req.body;

  if (!email || !code)
    return jsonRes(res, 400, { error: 'E-mail e código obrigatórios.' });

  try {
    const result = await pool.query(
      'SELECT * FROM email_verifications WHERE email=$1',
      [email.toLowerCase()]
    );

    if (!result.rows.length)
      return jsonRes(res, 404, { error: 'Nenhuma verificação pendente para este e-mail.' });

    const v = result.rows[0];

    if (new Date() > new Date(v.expires_at))
      return jsonRes(res, 410, { error: 'Código expirado. Faça o cadastro novamente.' });

    if (v.code !== code.trim())
      return jsonRes(res, 401, { error: 'Código incorreto. Tente novamente.' });

    const user = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, plan`,
      [v.name, v.email, v.password_hash]
    );

    await pool.query('DELETE FROM email_verifications WHERE email=$1', [email.toLowerCase()]);

    const token = signToken(user.rows[0].id);
    jsonRes(res, 201, {
      token,
      user: {
        id:    user.rows[0].id,
        name:  user.rows[0].name,
        email: user.rows[0].email,
        plan:  user.rows[0].plan,
      }
    });
  } catch (err) {
    console.error('[verifyEmail]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── POST /api/login ───────────────────────────────────────
async function login(req, res) {
  const { email, password } = req.body;

  if (!email || !password)
    return jsonRes(res, 400, { error: 'Preencha e-mail e senha.' });

  try {
    const result = await pool.query(
      'SELECT id, name, email, password_hash, plan FROM users WHERE email=$1',
      [email.toLowerCase()]
    );

    if (!result.rows.length)
      return jsonRes(res, 401, { error: 'E-mail ou senha incorretos.' });

    const user = result.rows[0];

    if (!user.password_hash)
      return jsonRes(res, 401, { error: 'Esta conta usa login pelo Google.' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match)
      return jsonRes(res, 401, { error: 'E-mail ou senha incorretos.' });

    const token = signToken(user.id);
    jsonRes(res, 200, {
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan }
    });
  } catch (err) {
    console.error('[login]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── POST /api/google-auth ─────────────────────────────────
async function googleAuth(req, res) {
  const { name, email, picture, sub } = req.body;

  if (!email || !sub)
    return jsonRes(res, 400, { error: 'Dados do Google incompletos.' });

  try {
    let result = await pool.query(
      'SELECT id, name, email, plan FROM users WHERE email=$1',
      [email.toLowerCase()]
    );

    let user;
    if (result.rows.length) {
      await pool.query(
        'UPDATE users SET google_sub=$1, picture=$2 WHERE email=$3',
        [sub, picture || '', email.toLowerCase()]
      );
      user = result.rows[0];
    } else {
      const ins = await pool.query(
        `INSERT INTO users (name, email, google_sub, picture)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name, email, plan`,
        [name || email.split('@')[0], email.toLowerCase(), sub, picture || '']
      );
      user = ins.rows[0];
    }

    const token = signToken(user.id);
    jsonRes(res, 200, {
      token,
      user: { id: user.id, name: user.name, email: user.email, plan: user.plan }
    });
  } catch (err) {
    console.error('[googleAuth]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── GET /api/me ───────────────────────────────────────────
async function me(req, res) {
  const userId = requireAuth(req);
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

// ── PATCH /api/me ─────────────────────────────────────────
async function updateProfile(req, res) {
  const userId = requireAuth(req);
  if (!userId) return jsonRes(res, 401, { error: 'Não autenticado.' });

  const { name, plan } = req.body;
  if (!name) return jsonRes(res, 400, { error: 'Nome obrigatório.' });

  try {
    const result = await pool.query(
      `UPDATE users SET name=$1, plan=$2 WHERE id=$3
       RETURNING id, name, email, plan, picture`,
      [name.trim(), plan || 'free', userId]
    );
    if (!result.rows.length) return jsonRes(res, 404, { error: 'Usuário não encontrado.' });
    jsonRes(res, 200, { user: result.rows[0] });
  } catch (err) {
    console.error('[updateProfile]', err.message);
    jsonRes(res, 500, { error: 'Erro interno.' });
  }
}

// ── POST /api/logout ──────────────────────────────────────
async function logout(req, res) {
  jsonRes(res, 200, { ok: true });
}

module.exports = { register, verifyEmail, login, googleAuth, me, logout, requireAuth, updateProfile };