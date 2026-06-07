# AgroBot — Setup com PostgreSQL

## Estrutura do projeto

```
ChatBot-Agro/
├── server.js          ← servidor principal (atualizado)
├── db.js              ← conexão PostgreSQL + criação de tabelas
├── routes/
│   ├── auth.js        ← /api/register, /api/login, /api/me, /api/logout
│   └── conversations.js ← /api/conversations e mensagens
├── agrobot.html       ← chat (atualizado — usa JWT)
├── index.html         ← landing + login/cadastro (atualizado — chama API real)
├── package.json       ← dependências: pg, bcrypt, jsonwebtoken, dotenv
└── .env.example       ← modelo de variáveis de ambiente
```

---

## 1. Setup local

### Pré-requisitos
- Node.js 18+
- PostgreSQL rodando localmente

### Passos

```bash
# 1. Instalar dependências
npm install

# 2. Criar banco de dados no PostgreSQL
psql -U postgres -c "CREATE DATABASE agrobot;"

# 3. Configurar variáveis de ambiente
cp .env.example .env
# Edite o .env com sua DATABASE_URL, JWT_SECRET e GROQ_API_KEY

# 4. Iniciar o servidor (cria as tabelas automaticamente)
npm start
```

Acesse: http://localhost:3000

---

## 2. Deploy no Railway

### Passo a passo

1. **Acesse** https://railway.app e crie uma conta (gratuita)

2. **Crie um novo projeto** → "Deploy from GitHub repo"  
   (ou "Deploy from local" e suba a pasta do projeto)

3. **Adicione um banco PostgreSQL:**  
   No projeto → clique em `+ New` → `Database` → `Add PostgreSQL`

4. **Configure as variáveis de ambiente** no painel do Railway:  
   Vá em seu serviço Node.js → `Variables` → adicione:

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | clique em "Add Reference" → selecione o PostgreSQL |
   | `JWT_SECRET` | gere com: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
   | `GROQ_API_KEY` | sua chave do https://console.groq.com/keys |

5. **Deploy automático** — o Railway detecta o `package.json` e roda `npm start`

6. **Domínio** — Railway gera um URL como `agrobot.up.railway.app` automaticamente.  
   Para domínio próprio: Settings → Networking → Custom Domain

---

## 3. Rotas da API

| Método | Rota | Descrição | Auth? |
|---|---|---|---|
| POST | `/api/register` | Criar conta | Não |
| POST | `/api/login` | Login com e-mail/senha | Não |
| POST | `/api/google-auth` | Login/cadastro via Google | Não |
| GET  | `/api/me` | Dados do usuário logado | ✅ JWT |
| POST | `/api/logout` | Logout (invalida client-side) | ✅ JWT |
| GET  | `/api/conversations` | Listar conversas | ✅ JWT |
| POST | `/api/conversations` | Criar conversa | ✅ JWT |
| DELETE | `/api/conversations/:id` | Deletar conversa | ✅ JWT |
| GET  | `/api/conversations/:id/messages` | Mensagens de uma conversa | ✅ JWT |
| POST | `/api/conversations/:id/messages` | Salvar mensagem | ✅ JWT |
| POST | `/api/chat` | Chat com IA (Groq) | ✅ JWT |

---

## 4. O que mudou no sistema de auth

**Antes (inseguro):**
- Qualquer e-mail + qualquer senha entrava sem verificação
- Dados ficavam só no `localStorage` do navegador
- Sem cadastro real, sem banco de dados

**Agora (seguro):**
- Cadastro cria usuário real no PostgreSQL com senha hasheada (bcrypt)
- Login verifica e-mail + senha no banco
- Se errar e-mail ou senha → erro real, não entra
- Sessão controlada por JWT com validade de 30 dias
- `/api/chat` exige token válido — sem login, sem IA
- Google Sign-In cria/autentica usuário no banco pelo `google_sub`
