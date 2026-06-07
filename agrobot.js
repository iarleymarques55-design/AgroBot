// ══ REFS ══
const chatArea = document.getElementById('chatArea');
const messagesWrap = document.getElementById('messagesWrap');
const welcomeScreen = document.getElementById('welcomeScreen');
const chatInput = document.getElementById('chatInput');
const sendBtn = document.getElementById('sendBtn');
const historyList = document.getElementById('historyList');
const conversationHistory = [];
let msgCount = 0, isTyping = false, currentConversationId = null;
let currentServerConversationId = null;
const conversationServerIds = {};
let pendingFiles = [];

// SVG plantinha para avatares do bot
const PLANT_SVG = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:18px;height:18px;"><path d="M12 22V12" stroke="#A3E635" stroke-width="2" stroke-linecap="round"/><path d="M12 12C12 12 7 11 5 6C5 6 10 4 14 8C14 8 16 10 12 12Z" fill="#A3E635" fill-opacity="0.4" stroke="#A3E635" stroke-width="1.5" stroke-linejoin="round"/><path d="M12 17C12 17 16 15 18 10C18 10 13 9 10 14C10 14 9 16 12 17Z" fill="#4ADE80" fill-opacity="0.35" stroke="#4ADE80" stroke-width="1.5" stroke-linejoin="round"/></svg>`;

// ══ USUÁRIO (autenticação real via JWT) ══

// Helpers de sessão — usa sessionStorage (tab/janela) ao invés de localStorage
function getToken()  { return sessionStorage.getItem('agro_token'); }
function getUser()   { try { return JSON.parse(sessionStorage.getItem('agro_user')); } catch { return null; } }
function authHeader(){ return { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }; }

async function fetchServerConversations() {
  try {
    const resp = await fetch('/api/conversations', { headers: authHeader() });
    if (!resp.ok) return [];
    const data = await resp.json();
    return data.conversations || [];
  } catch {
    return [];
  }
}

async function loadServerConversations() {
  const conversations = await fetchServerConversations();
  let firstServerId = null;
  conversations.forEach((conv, index) => {
    const existing = historyList.querySelector(`[data-server-id="${conv.id}"]`);
    if (existing) return;
    addToHistory(conv.title || 'Nova conversa', `server_${conv.id}`, conv.id);
    if (index === 0) firstServerId = conv.id;
  });

  if (!currentServerConversationId && firstServerId) {
    const item = historyList.querySelector(`[data-server-id="${firstServerId}"]`);
    if (item) {
      item.classList.add('active');
      currentConversationId = item.dataset.id;
      currentServerConversationId = firstServerId;
      await loadServerConversation(firstServerId);
    }
  }
}

async function createServerConversation(title) {
  try {
    const resp = await fetch('/api/conversations', {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ title: title || 'Nova conversa' }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.conversation?.id || null;
  } catch {
    return null;
  }
}

async function saveServerMessage(convId, role, content) {
  if (!convId) return null;
  try {
    const resp = await fetch(`/api/conversations/${convId}/messages`, {
      method: 'POST',
      headers: authHeader(),
      body: JSON.stringify({ role, content }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.message || null;
  } catch {
    return null;
  }
}

async function loadServerConversation(convId) {
  try {
    const resp = await fetch(`/api/conversations/${convId}/messages`, { headers: authHeader() });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!Array.isArray(data.messages)) return null;

    messagesWrap.querySelectorAll('.message').forEach(m => m.remove());
    welcomeScreen.style.display = 'none';
    conversationHistory.length = 0;
    msgCount = 0;

    data.messages.forEach(msg => {
      addMessage(msg.role, msg.content || '');
      conversationHistory.push({ role: msg.role, content: msg.content || '' });
    });

    return data.messages;
  } catch {
    return null;
  }
}

async function loadUser() {
  const token = getToken();

  // Sem token → redireciona para o login
  if (!token) { window.location.href = '/'; return; }

  // Verifica token com o servidor
  try {
    const r = await fetch('/api/me', { headers: authHeader() });
    if (!r.ok) {
      // Token inválido ou expirado
      sessionStorage.clear();
      window.location.href = '/';
      return;
    }
    const data = await r.json();
    // Atualiza sessão com dados frescos do banco
    sessionStorage.setItem('agro_user', JSON.stringify(data.user));
    applyUser(data.user);
    await loadServerConversations();
  } catch {
    // Sem conexão — usa cache local se disponível
    const cached = getUser();
    if (cached) { applyUser(cached); }
    else { window.location.href = '/'; }
  }
}

function applyUser(u) {
  const ini = (u.name || '?').charAt(0).toUpperCase();
  document.getElementById('uAvatar').textContent = ini;
  document.getElementById('uName').textContent = (u.name || '').toUpperCase();
  document.getElementById('uPlan').textContent = (u.plan || 'AGRONOMIA IA').toUpperCase();
  document.getElementById('welcomeName').textContent = (u.name || 'Usuário') + '!';
  window._uIni = ini; window._uName = u.name || 'Você';
}

// saveUser / openEditModal continuam funcionando localmente
// (edição de nome opcional — sem rota de PATCH por ora)
function saveUser() {
  const name = document.getElementById('inputName').value.trim();
  if (!name) { document.getElementById('inputName').focus(); return; }
  const plan = document.getElementById('inputPlan').value.trim();
  const u = Object.assign(getUser() || {}, { name, plan });
  sessionStorage.setItem('agro_user', JSON.stringify(u));
  document.getElementById('loginModal').classList.remove('open');
  applyUser(u);
}
function openEditModal() {
  closeUserMenu();
  const u = getUser() || {};
  document.getElementById('editName').value = u.name || '';
  document.getElementById('editPlan').value = u.plan || '';
  document.getElementById('editModal').classList.add('open');
}
function updateUser() {
  const name = document.getElementById('editName').value.trim();
  if (!name) return;
  const plan = document.getElementById('editPlan').value.trim();
  const u = Object.assign(getUser() || {}, { name, plan });
  sessionStorage.setItem('agro_user', JSON.stringify(u));
  closeModal('editModal');
  applyUser(u);
}
function logout() {
  fetch('/api/logout', { method: 'POST', headers: authHeader() }).finally(() => {
    sessionStorage.clear();
    window.location.href = '/';
  });
}
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ══ MENU USUÁRIO ══
function toggleUserMenu() { document.getElementById('userMenuPopup').classList.toggle('open'); }
function closeUserMenu() { document.getElementById('userMenuPopup').classList.remove('open'); }

// ══ CONFIGURAÇÕES ══
function openSettings() {
  const s = getSavedSettings();
  document.getElementById('setTokens').value = s.tokens;
  document.getElementById('setLang').value = s.lang;
  document.getElementById('togCompact').classList.toggle('on', s.compact);
  document.getElementById('togAnim').classList.toggle('on', s.anim);
  document.getElementById('settingsPanel').classList.add('open');
}
function closeSettings() { document.getElementById('settingsPanel').classList.remove('open'); }
function saveSettings() {
  const s = {
    tokens: parseInt(document.getElementById('setTokens').value) || 1000,
    lang: document.getElementById('setLang').value,
    compact: document.getElementById('togCompact').classList.contains('on'),
    anim: document.getElementById('togAnim').classList.contains('on'),
  };
  sessionStorage.setItem('agro_settings', JSON.stringify(s));
  closeSettings();
}
function getSavedSettings() {
  return Object.assign({ tokens:1000, lang:'pt-BR', compact:false, anim:true }, JSON.parse(sessionStorage.getItem('agro_settings') || '{}'));
}
function applyCompact(on) {
  document.querySelectorAll('.message').forEach(m => m.style.padding = on ? '10px 0' : '');
}
function applyAnim(on) {
  document.querySelectorAll('.message').forEach(m => m.style.animation = on ? '' : 'none');
}
function clearHistory() {
  historyList.innerHTML = '<div class="history-empty" id="historyEmpty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg><span>Nenhuma conversa ainda</span></div>';
  closeSettings();
}

// ══ EXPORT ══
function toggleExport() { document.getElementById('exportPanel').classList.toggle('open'); }
function closeExport() { document.getElementById('exportPanel').classList.remove('open'); }
function exportChat(fmt) {
  closeExport();
  const msgs = document.querySelectorAll('.message');
  if (!msgs.length) return;
  let out = fmt === 'md' ? '# Conversa AgroBot\n\n' : 'Conversa AgroBot\n\n';
  msgs.forEach(m => {
    const n = m.querySelector('.msg-name')?.textContent || '';
    const t = m.querySelector('.msg-text')?.innerText || '';
    out += fmt === 'md' ? `**${n}**\n${t}\n\n---\n\n` : `${n}\n${t}\n\n`;
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out], {type:'text/plain'}));
  a.download = `agrobot.${fmt}`; a.click();
}
function copyAllChat() {
  closeExport();
  let out = '';
  document.querySelectorAll('.message').forEach(m => {
    out += (m.querySelector('.msg-name')?.textContent || '') + '\n' + (m.querySelector('.msg-text')?.innerText || '') + '\n\n';
  });
  navigator.clipboard.writeText(out);
}

// ══ ARQUIVOS ══
function handleFiles(input) {
  Array.from(input.files).forEach(file => {
    const reader = new FileReader();
    reader.onload = e => {
      pendingFiles.push({ name: file.name, type: file.type, data: e.target.result });
      renderPreviews();
      sendBtn.disabled = false;
      document.getElementById('attachBtn').classList.add('has-files');
    };
    if (file.type.startsWith('image/')) reader.readAsDataURL(file);
    else reader.readAsText(file);
  });
  input.value = '';
}
function renderPreviews() {
  const bar = document.getElementById('filePreviewBar');
  bar.innerHTML = '';
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('div');
    chip.className = 'file-chip';
    if (f.type.startsWith('image/')) {
      chip.innerHTML = `<img src="${f.data}" class="file-chip-img"><span class="file-chip-name">${f.name}</span><button class="file-chip-rm" onclick="removeFile(${i})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
    } else {
      chip.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="width:16px;height:16px;color:var(--green);flex-shrink:0"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg><span class="file-chip-name">${f.name}</span><button class="file-chip-rm" onclick="removeFile(${i})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>`;
    }
    bar.appendChild(chip);
  });
}
function removeFile(i) {
  pendingFiles.splice(i, 1);
  renderPreviews();
  if (!pendingFiles.length) document.getElementById('attachBtn').classList.remove('has-files');
  if (!pendingFiles.length && !chatInput.value.trim()) sendBtn.disabled = true;
}

// ══ SYSTEM PROMPT DINÂMICO ══
function buildSystemPrompt() {
  const s = getSavedSettings();
  const langMap = {'pt-BR':'português brasileiro','en':'English','es':'español'};
  const lang = langMap[s.lang] || 'português brasileiro';
  return `Você é o AgroBot, um assistente especialista em agronomia e agricultura tropical brasileira. Você tem vasto conhecimento em:
- Solos: análise, correção de pH, adubação, calagem, manejo de fertilidade
- Culturas: soja, milho, café, cana, tomate, feijão, hortaliças, fruticultura e outras
- Pragas e doenças: diagnóstico, manejo integrado (MIP), defensivos
- Irrigação: gotejamento, aspersão, pivô central, manejo hídrico
- Sustentabilidade: plantio direto, rotação de culturas, agroecologia
- Colheita, pós-colheita e armazenamento
- Clima e zoneamento agrícola do Brasil

Quando o usuário enviar uma imagem, analise-a detalhadamente: identifique plantas, pragas, doenças, deficiências nutricionais, solo ou qualquer elemento agrícola visível. Forneça diagnóstico técnico preciso.

GERAÇÃO DE DOCUMENTOS: Quando o usuário pedir para gerar um relatório, laudo, receituário agronômico, ficha técnica, plano de manejo ou qualquer documento técnico, você deve SEMPRE redigir o documento completo e formatado no chat, incluindo todos os campos necessários (data, produtor, propriedade, cultura, diagnóstico, recomendações, responsável técnico, etc.). O sistema irá oferecer automaticamente os botões para baixar em PDF e Word. Estruture o documento com seções claras usando títulos (## SEÇÃO) e campos em **negrito**.

Responda sempre em ${lang}. Use **negrito** para termos técnicos importantes. Seja direto, técnico e completo.`;
}

// ══ API ══
async function callAgroAPI(text, imgFiles) {
  const s = getSavedSettings();
  let userContent;
  if (imgFiles && imgFiles.length > 0) {
    userContent = [];
    imgFiles.forEach(f => {
      const mime = f.type || 'image/jpeg';
      const b64 = f.data.includes(',') ? f.data.split(',')[1] : f.data;
      userContent.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
    });
    if (text) userContent.push({ type: 'text', text });
  } else {
    userContent = text;
  }
  conversationHistory.push({ role: 'user', content: userContent });

  const resp = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + getToken(),
    },
    body: JSON.stringify({
      max_tokens: s.tokens,
      system: buildSystemPrompt(),
      messages: conversationHistory,
      stream: true
    })
  });
  if (resp.status === 401) { sessionStorage.clear(); window.location.href = '/'; return; }
  if (!resp.ok) throw new Error('Erro API: ' + resp.status);
  return resp;
}

// ══ INPUT ══
function handleInput(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 180) + 'px';
  sendBtn.disabled = el.value.trim().length === 0 && pendingFiles.length === 0;
  const len = el.value.length;
  document.getElementById('charCount').textContent = len > 0 ? len + ' chars' : '';
}
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled && !isTyping) sendMessage();
  }
}

// ══ ENVIAR ══
async function sendMessage() {
  const text = chatInput.value.trim();
  if ((!text && !pendingFiles.length) || isTyping) return;

  if (msgCount === 0) {
    welcomeScreen.style.display = 'none';
    const title = text || pendingFiles[0]?.name || 'Nova conversa';
    const serverId = await createServerConversation(title);
    currentConversationId = serverId ? `server_${serverId}` : Date.now();
    addToHistory(text || pendingFiles[0]?.name || 'Arquivo', currentConversationId, serverId);

    if (serverId) {
      currentServerConversationId = serverId;
    }
  }

  if (!currentServerConversationId) {
    const title = text || pendingFiles[0]?.name || 'Nova conversa';
    currentServerConversationId = await createServerConversation(title);
    if (currentServerConversationId) {
      const item = historyList.querySelector(`[data-id="${currentConversationId}"]`);
      if (item) item.dataset.serverId = currentServerConversationId;
    }
  }

  const files = [...pendingFiles];
  pendingFiles = [];
  document.getElementById('filePreviewBar').innerHTML = '';
  document.getElementById('attachBtn').classList.remove('has-files');
  // Contexto de arquivos não-imagem para o texto
  let apiText = text;
  const imgFiles = files.filter(f => f.type && f.type.startsWith('image/'));
  const otherFiles = files.filter(f => !f.type || !f.type.startsWith('image/'));
  otherFiles.forEach(f => { apiText += `\n[Arquivo: ${f.name}]\n${String(f.data).slice(0,2000)}`; });

  addMessage('user', text, files);
  if (currentServerConversationId) {
    saveServerMessage(currentServerConversationId, 'user', apiText);
  }
  chatInput.value = ''; chatInput.style.height = 'auto';
  sendBtn.disabled = true;
  document.getElementById('charCount').textContent = '';

  showTyping();
  try {
    const resp = await callAgroAPI(apiText, imgFiles);
    removeTyping();
    const botDiv = createBotContainer();
    const textEl = botDiv.querySelector('.msg-text');
    let full = '';
    const reader = resp.body.getReader();
    const dec = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const d = line.slice(6).trim();
        if (d === '[DONE]') continue;
        try {
          const p = JSON.parse(d);
          if (p.type === 'content_block_delta' && p.delta?.type === 'text_delta') {
            full += p.delta.text;
            textEl.innerHTML = fmtMd(full);
            scrollBot();
          }
        } catch {}
      }
    }
    conversationHistory.push({ role: 'assistant', content: full });
    if (currentServerConversationId) {
      saveServerMessage(currentServerConversationId, 'assistant', full);
    }
    addActions(botDiv, text);
    // Salvar snapshot desta conversa
    if (currentConversationId) saveCurrentToSnapshot(currentConversationId);
  } catch (err) {
    removeTyping();
    const botDiv = createBotContainer();
    botDiv.querySelector('.msg-text').innerHTML = '<p>⚠️ Erro ao conectar com a IA. Verifique sua conexão.</p>';
    addActions(botDiv, '');
    console.error(err);
  }
}

function fmtMd(t) {
  return t
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*(.*?)\*/g,'<em>$1</em>')
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/^### (.+)$/gm,'<h3 style="color:var(--green);font-family:var(--mono);font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:14px 0 6px">$1</h3>')
    .replace(/^## (.+)$/gm,'<h3 style="color:var(--green);font-family:var(--mono);font-size:12px;letter-spacing:2px;text-transform:uppercase;margin:14px 0 6px">$1</h3>')
    .replace(/^- (.+)$/gm,'<li style="margin-left:16px;margin-bottom:4px">$1</li>')
    .replace(/^\d+\. (.+)$/gm,'<li style="margin-left:16px;margin-bottom:4px">$1</li>')
    .replace(/\n\n/g,'</p><p>').replace(/\n/g,'<br>')
    .replace(/^/,'<p>').replace(/$/,'</p>');
}

function createBotContainer() {
  msgCount++;
  const div = document.createElement('div');
  div.className = 'message';
  const s = getSavedSettings();
  if (s.compact) div.style.padding = '10px 0';
  if (!s.anim) div.style.animation = 'none';
  div.innerHTML = `<div class="msg-avatar bot">${PLANT_SVG}</div><div class="msg-body"><div class="msg-name bot-name">AgroBot</div><div class="msg-text"></div></div>`;
  messagesWrap.appendChild(div);
  scrollBot();
  return div;
}

function addActions(div, userText) {
  const body = div.querySelector('.msg-body');

  // Botão copiar
  const a = document.createElement('div');
  a.className = 'msg-actions';
  a.innerHTML = `<button class="msg-action" onclick="copyMsg(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar</button>`;
  body.appendChild(a);

  // Botões PDF e Word aparecem em TODA resposta do bot
  const botText = div.querySelector('.msg-text')?.innerText || '';
  const title = userText ? extractDocTitle(userText, botText) : 'Resposta AgroBot';
  const bar = document.createElement('div');
  bar.className = 'doc-action-bar';
  bar.innerHTML = `
    <button class="doc-btn pdf" onclick="generatePDF(${JSON.stringify(title)}, this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="15" y2="17"/></svg>
      Baixar PDF
    </button>
    <button class="doc-btn word" onclick="generateWord(${JSON.stringify(title)}, this)">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="12" y2="17"/></svg>
      Baixar Word
    </button>`;
  body.appendChild(bar);
}

function addMessage(role, text, files = []) {
  msgCount++;
  const s = getSavedSettings();
  const div = document.createElement('div');
  div.className = 'message';
  if (s.compact) div.style.padding = '10px 0';
  if (!s.anim) div.style.animation = 'none';
  const ini = role === 'user' ? (window._uIni || 'U') : '';
  const name = role === 'user' ? (window._uName || 'Você') : 'AgroBot';
  const nameClass = role === 'user' ? '' : 'bot-name';
  const avatar = role === 'user'
    ? `<div class="msg-avatar user">${ini}</div>`
    : `<div class="msg-avatar bot">${PLANT_SVG}</div>`;
  let filesHTML = '';
  files.forEach(f => {
    if (f.type && f.type.startsWith('image/')) {
      filesHTML += `<img src="${f.data}" class="msg-img" alt="${f.name}">`;
    } else {
      filesHTML += `<div class="msg-file-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>${f.name}</div>`;
    }
  });
  const formattedText = text
    ? (role === 'assistant' ? fmtMd(text) : `<p>${esc(text)}</p>`)
    : '';
  div.innerHTML = `${avatar}<div class="msg-body"><div class="msg-name ${nameClass}">${name}</div><div class="msg-text">${formattedText}${filesHTML}</div></div>`;
  messagesWrap.appendChild(div);
  scrollBot();
}

function showTyping() {
  isTyping = true;
  const div = document.createElement('div');
  div.className = 'message'; div.id = 'typingIndicator';
  div.innerHTML = `<div class="msg-avatar bot">${PLANT_SVG}</div><div class="msg-body"><div class="msg-name bot-name">AgroBot</div><div class="typing"><div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div></div></div>`;
  messagesWrap.appendChild(div);
  scrollBot();
}
function removeTyping() { isTyping = false; document.getElementById('typingIndicator')?.remove(); }
function scrollBot() { chatArea.scrollTop = chatArea.scrollHeight; }
function esc(t) { return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function copyMsg(btn) {
  const t = btn.closest('.message').querySelector('.msg-text').innerText;
  navigator.clipboard.writeText(t).then(() => {
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>Copiado`;
    setTimeout(() => { btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copiar`; }, 2000);
  });
}

function useSuggestion(btn) {
  chatInput.value = btn.querySelector('.suggestion-text').textContent;
  handleInput(chatInput); chatInput.focus();
}

function newChat() {
  welcomeScreen.style.display = 'flex';
  messagesWrap.querySelectorAll('.message').forEach(m => m.remove());
  msgCount = 0; currentConversationId = null; currentServerConversationId = null;
  conversationHistory.length = 0;
  pendingFiles = [];
  document.getElementById('filePreviewBar').innerHTML = '';
  document.getElementById('attachBtn').classList.remove('has-files');
  document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
  chatInput.value = ''; chatInput.style.height = 'auto'; sendBtn.disabled = true;
  if (window.innerWidth <= 768) toggleSidebar();
}

// Armazena conversas: { id, title, messages: [{role,html,text}], history: [...] }
const savedConversations = {};

function saveCurrentToSnapshot(id) {
  const msgs = [];
  messagesWrap.querySelectorAll('.message').forEach(m => {
    msgs.push({ outerHTML: m.outerHTML });
  });
  savedConversations[id] = {
    msgs,
    history: [...conversationHistory],
    msgCount
  };
}

function loadSnapshot(id) {
  const snap = savedConversations[id];
  if (!snap) return;
  messagesWrap.querySelectorAll('.message').forEach(m => m.remove());
  welcomeScreen.style.display = 'none';
  snap.msgs.forEach(m => {
    const div = document.createElement('div');
    div.innerHTML = m.outerHTML;
    messagesWrap.appendChild(div.firstElementChild);
  });
  conversationHistory.length = 0;
  snap.history.forEach(h => conversationHistory.push(h));
  msgCount = snap.msgCount;
  currentConversationId = id;
  scrollBot();
}

function addToHistory(text, id, serverId) {
  document.getElementById('historyEmpty')?.remove();
  if (!document.getElementById('todayLabel')) {
    const lbl = document.createElement('div');
    lbl.className = 'history-section-label'; lbl.id = 'todayLabel'; lbl.textContent = 'Hoje';
    historyList.insertBefore(lbl, historyList.firstChild);
  }
  document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
  const item = document.createElement('div');
  item.className = 'history-item active'; item.dataset.id = id;
  if (serverId) item.dataset.serverId = serverId;
  item.onclick = async function() {
    // Salvar conversa atual antes de trocar
    if (currentConversationId && currentConversationId !== id) {
      saveCurrentToSnapshot(currentConversationId);
    }
    document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
    this.classList.add('active');
    currentConversationId = id;
    currentServerConversationId = this.dataset.serverId || null;
    if (currentServerConversationId) {
      await loadServerConversation(currentServerConversationId);
    } else {
      loadSnapshot(id);
    }
    if (window.innerWidth <= 768) toggleSidebar();
  };
  const title = (text||'').slice(0,34) + ((text||'').length > 34 ? '…' : '');
  item.innerHTML = `<div class="history-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div><span class="history-item-text">${title}</span>`;
  document.getElementById('todayLabel').insertAdjacentElement('afterend', item);
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOverlay').classList.toggle('open');
}

// Fechar menus ao clicar fora
document.addEventListener('click', e => {
  if (!e.target.closest('.sidebar-footer') && !e.target.closest('#userMenuPopup')) closeUserMenu();
  if (!e.target.closest('#exportPanel') && !e.target.closest('[onclick="toggleExport()"]')) closeExport();
});

// Enter no modal de login
document.getElementById('inputName').addEventListener('keydown', e => { if(e.key==='Enter') saveUser(); });
document.getElementById('editName').addEventListener('keydown', e => { if(e.key==='Enter') updateUser(); });

chatInput.addEventListener('input', () => handleInput(chatInput));

// ══ TOAST ══
function showToast(msg) {
  const t = document.getElementById('agroToast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

// ══ DETECTAR PEDIDO DE DOCUMENTO ══
const DOC_PATTERNS = [
  /\b(gerar?|criar?|fazer|montar|elaborar|preparar|produzir|emitir)\b.{0,40}\b(pdf|relat[oó]rio|laudo|receitu[aá]rio|prescri[cç][aã]o|documento|ficha|boletim|plano|memorial|ata|parecer)\b/i,
  /\b(quero|preciso|pode|consegue|me d[aá]|me manda).{0,30}\b(pdf|relat[oó]rio|laudo|receitu[aá]rio|documento|ficha|boletim|plano)\b/i,
  /\b(relat[oó]rio|laudo|receitu[aá]rio|ficha t[eé]cnica|plano de manejo|boletim|prescri[cç][aã]o|ata|memorial)\b.{0,30}\b(em|como|n[ao]|formato)\b.{0,20}\b(pdf|word|docx|documento)\b/i,
  /\b(exportar?|salvar?|baixar?|download)\b.{0,30}\b(pdf|word|docx|relat[oó]rio|documento)\b/i,
  /\b(pdf|word|docx)\b.{0,30}\b(diss?o|disso|dessa|desse|desta|deste|da conversa|do diagn[oó]stico|do resultado)\b/i,
];
function detectsDocRequest(text) {
  return DOC_PATTERNS.some(p => p.test(text));
}

// ══ EXTRAIR TÍTULO DO DOCUMENTO ══
function extractDocTitle(userText, botText) {
  const m = userText.match(/\b(relat[oó]rio|laudo|receitu[aá]rio|ficha t[eé]cnica|plano de manejo|boletim|prescri[cç][aã]o|diagnóstico|ata|memorial)[^.,\n]*/i);
  if (m) return ucfirst(m[0].trim().slice(0, 60));
  // Pega primeira linha da resposta do bot como fallback
  const firstLine = (botText || '').split('\n').find(l => l.trim().length > 8) || '';
  return firstLine.replace(/[#*]/g, '').trim().slice(0, 60) || 'Relatório AgroBot';
}
function ucfirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ══ COLETAR CONVERSA ══
function collectConversation() {
  const out = [];
  document.querySelectorAll('.message').forEach(m => {
    const name = m.querySelector('.msg-name')?.textContent?.trim() || '';
    const text = m.querySelector('.msg-text')?.innerText?.trim() || '';
    if (text) out.push({ name, text });
  });
  return out;
}

// ══ GERAR PDF (resposta individual) ══
function generatePDF(title, btn) {
  // Pega o texto da mensagem bot pai do botão
  const msgEl = btn.closest('.message');
  const botText = msgEl?.querySelector('.msg-text')?.innerText || '';
  buildPDF(title, [{ name: 'AgroBot', text: botText }]);
}

// ══ EXPORTAR PDF (conversa toda) ══
function exportConversationPDF() {
  buildPDF('Conversa AgroBot', collectConversation());
}

function buildPDF(docTitle, msgs) {
  const jsPDFLib = window.jspdf || window.jsPDF;
  if (!jsPDFLib) { showToast('❌ jsPDF não carregado. Verifique sua conexão.'); return; }
  const { jsPDF } = jsPDFLib;
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W = 210, M = 18, CW = W - M * 2;
  let y = 0;

  function checkPage(needed) {
    if (y + needed > 280) { doc.addPage(); y = M; }
  }

  // ── Cabeçalho ──
  doc.setFillColor(11, 14, 10);
  doc.rect(0, 0, W, 28, 'F');
  doc.setDrawColor(163, 230, 53);
  doc.setLineWidth(0.5);
  doc.line(0, 28, W, 28);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(163, 230, 53);
  doc.text('AGROBOT', M, 12);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(127, 191, 144);
  doc.text('Assistente de Agronomia com IA', M, 19);

  const dateStr = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
  doc.text(dateStr, W - M, 19, { align: 'right' });

  y = 38;

  // ── Título do doc ──
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(240, 245, 236);
  doc.text(docTitle, M, y);
  y += 2;
  doc.setDrawColor(163, 230, 53);
  doc.setLineWidth(0.3);
  doc.line(M, y + 3, W - M, y + 3);
  y += 10;

  // ── Mensagens ──
  msgs.forEach(({ name, text }) => {
    const isBot = /agrobot/i.test(name);
    checkPage(14);

    // Remetente
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(isBot ? 74 : 163, isBot ? 222 : 230, isBot ? 128 : 53);
    doc.text(name.toUpperCase(), M, y);
    y += 6;

    // Texto, quebrado em linhas
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(210, 225, 200);
    // Limpar markdown simples
    const clean = text.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/^#{1,3}\s/gm, '');
    const lines = doc.splitTextToSize(clean, CW);
    lines.forEach(line => {
      checkPage(6);
      doc.text(line, M, y);
      y += 5.5;
    });

    y += 3;
    checkPage(4);
    doc.setDrawColor(30, 42, 24);
    doc.setLineWidth(0.15);
    doc.line(M, y, W - M, y);
    y += 6;
  });

  // ── Rodapés ──
  const total = doc.internal.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(80, 110, 70);
    doc.text(`AgroBot IA  ·  Gerado automaticamente  ·  Página ${i} de ${total}`, W / 2, 291, { align: 'center' });
  }

  const fname = docTitle.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 40);
  doc.save(`agrobot_${fname}.pdf`);
  showToast('✅ PDF gerado com sucesso!');
}

// ══ GERAR WORD (resposta individual) ══
function generateWord(title, btn) {
  const msgEl = btn.closest('.message');
  const botText = msgEl?.querySelector('.msg-text')?.innerText || '';
  buildWord(title, [{ name: 'AgroBot', text: botText }]);
}

// ══ EXPORTAR WORD (conversa toda) ══
function exportConversationWord() {
  buildWord('Conversa AgroBot', collectConversation());
}

function buildWord(docTitle, msgs) {
  const date = new Date().toLocaleDateString('pt-BR', { day:'2-digit', month:'long', year:'numeric' });
  let body = '';
  msgs.forEach(function(m) {
    const name = m.name; const text = m.text;
    const isBot = /agrobot/i.test(name);
    const color = isBot ? '#4ade80' : '#a3e635';
    const clean = text
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/\*\*(.*?)\*\*/g,'<b>$1</b>')
      .replace(/\*(.*?)\*/g,'<i>$1</i>')
      .replace(/^### (.+)$/gm,'<h3>$1</h3>')
      .replace(/^## (.+)$/gm,'<h2>$1</h2>')
      .replace(/^- (.+)$/gm,'<li>$1</li>')
      .replace(/\n\n/g,'</p><p>')
      .replace(/\n/g,'<br>');
    body += '<div style="margin-bottom:16pt;">';
    body += '<p style="font-family:Courier New;font-size:8pt;color:' + color + ';letter-spacing:2pt;margin-bottom:4pt;"><b>' + name.toUpperCase() + '</b></p>';
    body += '<div style="font-family:Calibri;font-size:11pt;color:#1a2b12;line-height:1.6;"><p>' + clean + '</p></div>';
    body += '<hr style="border:none;border-top:1px solid #d4e8c4;margin-top:12pt;"/>';
    body += '</div>';
  });

  const parts = [];
  parts.push('<html xmlns:o="urn:schemas-microsoft-com:office:office"');
  parts.push(' xmlns:w="urn:schemas-microsoft-com:office:word"');
  parts.push(' xmlns="http://www.w3.org/TR/REC-html40">');
  parts.push('<head><meta charset="utf-8">');
  parts.push('<meta name="ProgId" content="Word.Document">');
  parts.push('<style>');
  parts.push('@page { size:A4; margin:2cm 2.5cm; }');
  parts.push('body { font-family:Calibri,sans-serif; font-size:11pt; color:#1a2b12; }');
  parts.push('h1 { font-family:Georgia,serif; color:#2d5a1b; border-bottom:2px solid #a3e635; padding-bottom:6pt; }');
  parts.push('h2,h3 { color:#3a7a24; } li { margin-bottom:4pt; } b { color:#2d5a1b; }');
  parts.push('<' + '/style><' + '/head><body>');
  parts.push('<table width="100%" style="background:#0b0e0a;padding:14pt 20pt;margin-bottom:20pt;"><tr>');
  parts.push('<td><span style="font-family:Courier New;font-size:16pt;font-weight:bold;color:#a3e635;letter-spacing:3pt;">AGROBOT</span><br>');
  parts.push('<span style="font-family:Courier New;font-size:8pt;color:#7fbf90;">Assistente de Agronomia com IA</span></td>');
  parts.push('<td align="right"><span style="font-size:9pt;color:#7fbf90;">' + date + '</span></td>');
  parts.push('</tr></table>');
  parts.push('<h1>' + docTitle + '</h1>');
  parts.push(body);
  parts.push('<p style="font-size:7pt;color:#7fbf90;text-align:center;margin-top:30pt;">AgroBot IA &nbsp;&middot;&nbsp; Gerado automaticamente</p>');
  parts.push('<' + '/body><' + '/html>');

  const docHtml = parts.join('\n');
  const blob = new Blob([docHtml], { type: 'application/msword;charset=utf-8' });
  const fname = docTitle.toLowerCase().replace(/\s+/g,'_').replace(/[^a-z0-9_]/g,'').slice(0,40);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'agrobot_' + fname + '.doc';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast('✅ Documento Word gerado!');
}

loadUser();
