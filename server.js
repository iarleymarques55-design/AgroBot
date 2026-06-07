// ════════════════════════════════════════════════════════
//  server.js — AgroBot com PostgreSQL + Auth JWT
// ════════════════════════════════════════════════════════
require('dotenv').config();   // carrega .env em desenvolvimento

const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const { initDB } = require('./db');
const auth  = require('./routes/auth');
const convs = require('./routes/conversations');

// ── Configurações ────────────────────────────────────────
const GROQ_API_KEY      = process.env.GROQ_API_KEY || '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';
const PORT              = process.env.PORT || 3000;
const GROQ_MODEL_TEXT   = 'llama-3.3-70b-versatile';
const GROQ_MODEL_VISION = 'meta-llama/llama-4-scout-17b-16e-instruct';

// ── MIME types ───────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
};

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

function jsonRes(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── Lê o body JSON de uma request ───────────────────────
function readJSON(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try { resolve(JSON.parse(raw)); }
      catch { reject(new Error('JSON inválido')); }
    });
  });
}

// ── Converte partes de conteúdo para formato Groq ────────
function convertContentParts(parts) {
  return parts.map(part => {
    if (part.type === 'image_url') {
      return { type: 'image_url', image_url: { url: part.image_url.url } };
    }
    return { type: 'text', text: part.text || '' };
  });
}

// ── Roteador principal ───────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url    = req.url.split('?')[0];   // ignora query string
  const method = req.method;

  try {
    // ── Arquivos estáticos ──────────────────────────────
    if (method === 'GET') {
      const staticPath =
        (url === '/' || url === '/index.html') ? path.join(__dirname, 'index.html') :
        (url === '/agrobot' || url === '/agrobot.html') ? path.join(__dirname, 'agrobot.html') :
        null;

      if (staticPath) {
        serveFile(res, staticPath, 'text/html; charset=utf-8');
        return;
      }

      // Outros arquivos (png, css, js…)
      const filePath = path.join(__dirname, url);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveFile(res, filePath, MIME[path.extname(filePath)] || 'text/plain');
        return;
      }
    }

    // ══════════════════════════════════════════════════
    //  API de autenticação
    // ══════════════════════════════════════════════════

    if (method === 'POST' && url === '/api/register') {
      req.body = await readJSON(req);
      return auth.register(req, res);
    }

    if (method === 'POST' && url === '/api/login') {
      req.body = await readJSON(req);
      return auth.login(req, res);
    }

    if (method === 'POST' && url === '/api/google-auth') {
      req.body = await readJSON(req);
      return auth.googleAuth(req, res);
    }

    if (method === 'GET' && url === '/api/me') {
      return auth.me(req, res);
    }

    if (method === 'POST' && url === '/api/logout') {
      return auth.logout(req, res);
    }

    // ══════════════════════════════════════════════════
    //  API de conversas
    // ══════════════════════════════════════════════════

    if (method === 'GET' && url === '/api/conversations') {
      return convs.listConversations(req, res);
    }

    if (method === 'POST' && url === '/api/conversations') {
      req.body = await readJSON(req);
      return convs.createConversation(req, res);
    }

    // DELETE /api/conversations/:id
    const delMatch = url.match(/^\/api\/conversations\/([^/]+)$/);
    if (method === 'DELETE' && delMatch) {
      return convs.deleteConversation(req, res, delMatch[1]);
    }

    // GET /api/conversations/:id/messages
    const msgGet = url.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (method === 'GET' && msgGet) {
      return convs.listMessages(req, res, msgGet[1]);
    }

    // POST /api/conversations/:id/messages
    const msgPost = url.match(/^\/api\/conversations\/([^/]+)\/messages$/);
    if (method === 'POST' && msgPost) {
      req.body = await readJSON(req);
      return convs.saveMessage(req, res, msgPost[1]);
    }

    // ══════════════════════════════════════════════════
    //  Proxy Groq — streaming SSE (protegido por JWT)
    // ══════════════════════════════════════════════════

    if (method === 'POST' && url === '/api/chat') {
      // Verifica autenticação
      const userId = await auth.requireAuth(req);
      if (!userId) {
        return jsonRes(res, 401, { error: 'Não autenticado.' });
      }

      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        try {
          const payload = JSON.parse(body);

          const hasImages = payload.messages.some(m =>
            Array.isArray(m.content) && m.content.some(p => p.type === 'image_url')
          );

          const messages = [];
          if (payload.system) messages.push({ role: 'system', content: payload.system });

          for (const m of payload.messages) {
            if (Array.isArray(m.content)) {
              if (m.role === 'assistant') {
                const textOnly = m.content.filter(p => p.type === 'text').map(p => p.text || '').join('');
                messages.push({ role: 'assistant', content: textOnly });
              } else {
                messages.push({ role: m.role, content: convertContentParts(m.content) });
              }
            } else {
              messages.push({ role: m.role, content: m.content });
            }
          }

          const model = hasImages ? GROQ_MODEL_VISION : GROQ_MODEL_TEXT;
          console.log(`[AgroBot] user:${userId} | modelo:${model} | imgs:${hasImages}`);

          const groqBody = JSON.stringify({
            model,
            messages,
            max_tokens: payload.max_tokens || 1000,
            temperature: 0.7,
            stream: true,
          });

          const options = {
            hostname: 'api.groq.com',
            path: '/openai/v1/chat/completions',
            method: 'POST',
            headers: {
              'Content-Type':   'application/json',
              'Authorization':  `Bearer ${GROQ_API_KEY}`,
              'Content-Length': Buffer.byteLength(groqBody),
            },
          };

          res.writeHead(200, {
            'Content-Type':                'text/event-stream',
            'Cache-Control':               'no-cache',
            'Connection':                  'keep-alive',
            'Access-Control-Allow-Origin': '*',
          });

          const apiReq = https.request(options, apiRes => {
            let buffer = '';
            apiRes.on('data', chunk => {
              buffer += chunk.toString();
              const lines = buffer.split('\n');
              buffer = lines.pop();
              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const data = line.slice(6).trim();
                if (!data || data === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(data);
                  if (parsed.error) {
                    console.error('[Groq Error]', parsed.error);
                    res.write(`data: ${JSON.stringify({
                      type: 'content_block_delta',
                      delta: { type: 'text_delta', text: `⚠️ Erro: ${parsed.error.message}` }
                    })}\n\n`);
                    continue;
                  }
                  const text = parsed?.choices?.[0]?.delta?.content;
                  if (text) {
                    res.write(`data: ${JSON.stringify({
                      type: 'content_block_delta',
                      delta: { type: 'text_delta', text }
                    })}\n\n`);
                  }
                } catch (_) {}
              }
            });
            apiRes.on('end',   () => { res.write('data: [DONE]\n\n'); res.end(); });
            apiRes.on('error', err => { console.error('Stream error:', err); res.end(); });
          });

          apiReq.on('error', err => {
            console.error('Request error:', err);
            res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
            res.end();
          });

          apiReq.write(groqBody);
          apiReq.end();
        } catch (err) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: 'JSON inválido' }));
        }
      });
      return;
    }

    // ── 404 ─────────────────────────────────────────────
    res.writeHead(404);
    res.end('Not found');

  } catch (err) {
    console.error('[Server Error]', err);
    jsonRes(res, 500, { error: 'Erro interno do servidor.' });
  }
});

// ── Inicializa banco e sobe o servidor ──────────────────
initDB()
  .then(() => {
    server.listen(PORT, () => {
      console.log('');
      console.log('  ✅ AgroBot rodando em:  http://localhost:' + PORT);
      console.log('  🌐 Landing page:        http://localhost:' + PORT + '/');
      console.log('  💬 Chat:                http://localhost:' + PORT + '/agrobot.html');
      console.log('');
    });
  })
  .catch(err => {
    console.error('❌ Falha ao conectar com banco de dados:', err.message);
    console.error('   Configure DATABASE_URL no arquivo .env');
    process.exit(1);
  });
