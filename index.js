const GOOGLE_CLIENT_ID = '761483976058-0caqmofpr2pfffsj5m7ljbb503t2b0ag.apps.googleusercontent.com';

// ── Modal ──
function openModal(type){
  document.getElementById('modalOverlay').classList.add('active');
  switchModal(type);
}
function closeModal(){
  document.getElementById('modalOverlay').classList.remove('active');
}
function closeModalOutside(e){
  if(e.target===document.getElementById('modalOverlay')) closeModal();
}
function switchModal(type){
  document.getElementById('loginForm').style.display  = type==='login'  ? 'block':'none';
  document.getElementById('signupForm').style.display = type==='signup' ? 'block':'none';
  ['loginError','signupError'].forEach(id=>{ const el=document.getElementById(id); if(el){el.style.display='none';el.textContent='';} });
}

function showError(id, msg){
  const el = document.getElementById(id);
  if(!el) return;
  el.textContent = '⚠ ' + msg;
  el.style.display = 'block';
}

// ── Google Sign-In ──
function googleSignIn(){
  const btnLogin  = document.getElementById('googleLoginBtn');
  const btnSignup = document.getElementById('googleSignupBtn');

  if(btnLogin)  { btnLogin.classList.add('loading');  btnLogin.textContent  = ''; }
  if(btnSignup) { btnSignup.classList.add('loading'); btnSignup.textContent = ''; }

  google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: 'openid email profile',
    callback: async (tokenResponse) => {
      if(tokenResponse.error){
        resetGoogleBtns();
        const activeErr = document.getElementById('loginForm').style.display!=='none' ? 'loginError':'signupError';
        showError(activeErr, 'Erro ao autenticar com o Google.');
        return;
      }
      try {
        const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
          headers: { Authorization: 'Bearer ' + tokenResponse.access_token }
        });
        const user = await r.json();
        onGoogleSuccess({
          name:    user.name  || user.email.split('@')[0],
          email:   user.email,
          picture: user.picture || '',
          sub:     user.sub,
        });
      } catch(e) {
        resetGoogleBtns();
        showError('loginError', 'Não foi possível obter dados do Google.');
      }
    },
    error_callback: (err) => {
      resetGoogleBtns();
      if(err.type !== 'popup_closed') {
        const activeErr = document.getElementById('loginForm').style.display!=='none' ? 'loginError':'signupError';
        showError(activeErr, 'Login com Google cancelado.');
      }
    }
  }).requestAccessToken({ prompt: 'select_account' });
}

// ── Mostrar/ocultar senha ──
function togglePass(inputId, eyeId) {
  const input = document.getElementById(inputId);
  const eye   = document.getElementById(eyeId);
  if (!input) return;
  if (input.type === 'password') {
    input.type = 'text';
    eye.innerHTML = '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/>';
  } else {
    input.type = 'password';
    eye.innerHTML = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
  }
}

// ── Validação de e-mail ──
function isValidEmail(email) {
  const re = /^[a-zA-Z][a-zA-Z0-9._%+\-]*@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;
  return re.test(email);
}

// ── Salva token JWT ──
function saveSession(token, user) {
  sessionStorage.setItem('agro_token', token);
  sessionStorage.setItem('agro_user',  JSON.stringify(user));
}

// ── Google: envia dados para o backend ──
async function onGoogleSuccess(user){
  resetGoogleBtns();
  try {
    const r = await fetch('/api/google-auth', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(user),
    });
    const data = await r.json();
    if (!r.ok) {
      const errId = document.getElementById('loginForm').style.display !== 'none' ? 'loginError' : 'signupError';
      showError(errId, data.error || 'Erro ao autenticar com o Google.');
      return;
    }
    saveSession(data.token, data.user);
    closeModal();
    window.location.href = 'agrobot.html';
  } catch {
    showError('loginError', 'Erro de conexão. Tente novamente.');
  }
}

function resetGoogleBtns(){
  const GSVG = `<svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg> Continuar com o Google`;
  ['googleLoginBtn','googleSignupBtn'].forEach(id=>{
    const el = document.getElementById(id);
    if(el){ el.classList.remove('loading'); el.innerHTML = GSVG; }
  });
}

// ── Login por e-mail ──
async function goToChat(){
  const emailEl = document.getElementById('loginEmail');
  const passEl  = document.getElementById('loginPass');
  const email   = emailEl.value.trim();
  const pass    = passEl.value;
  emailEl.classList.remove('error'); passEl.classList.remove('error');
  document.getElementById('loginError').style.display = 'none';

  if(!email || !email.includes('@')){ emailEl.classList.add('error'); emailEl.focus(); showError('loginError','E-mail inválido.'); return; }
  if(!pass){ passEl.classList.add('error'); passEl.focus(); showError('loginError','Digite sua senha.'); return; }

  const btn = document.querySelector('#loginForm .form-submit');
  if(btn){ btn.disabled = true; btn.textContent = 'Entrando...'; }

  try {
    const r = await fetch('/api/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password: pass }),
    });
    const data = await r.json();

    if (!r.ok) {
      showError('loginError', data.error || 'E-mail ou senha incorretos.');
      emailEl.classList.add('error');
      passEl.classList.add('error');
      return;
    }

    saveSession(data.token, data.user);
    closeModal();
    window.location.href = 'agrobot.html';
  } catch {
    showError('loginError', 'Erro de conexão. Verifique sua internet.');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Entrar →'; }
  }
}

// ── Cadastro por e-mail — cria conta direto, sem verificação ──
async function doSignup(){
  const nameEl  = document.getElementById('signupName');
  const emailEl = document.getElementById('signupEmail');
  const passEl  = document.getElementById('signupPass');
  [nameEl,emailEl,passEl].forEach(el=>el.classList.remove('error'));
  document.getElementById('signupError').style.display = 'none';

  const name  = nameEl.value.trim();
  const email = emailEl.value.trim();
  const pass  = passEl.value;
  let ok = true;

  const confirmEl = document.getElementById('signupPassConfirm');
  const confirm   = confirmEl ? confirmEl.value : '';
  if(confirmEl) confirmEl.classList.remove('error');

  if(!name)                { nameEl.classList.add('error');  nameEl.focus();  showError('signupError','Digite seu nome completo.');      ok=false; }
  if(!isValidEmail(email)) { emailEl.classList.add('error'); if(ok){emailEl.focus(); showError('signupError','Digite um e-mail válido (ex: nome@dominio.com).');} ok=false; }
  if(pass.length<8)        { passEl.classList.add('error');  if(ok){passEl.focus();  showError('signupError','Senha mínimo 8 caracteres.');} ok=false; }
  if(ok && pass !== confirm){ confirmEl.classList.add('error'); confirmEl.focus(); showError('signupError','As senhas não coincidem.'); ok=false; }
  if(!ok) return;

  const btn = document.querySelector('#signupForm .form-submit');
  if(btn){ btn.disabled = true; btn.textContent = 'Criando conta...'; }

  try {
    const r = await fetch('/api/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name, email, password: pass }),
    });
    const data = await r.json();

    if (!r.ok) {
      showError('signupError', data.error || 'Erro ao criar conta.');
      if (data.error && data.error.includes('E-mail')) emailEl.classList.add('error');
      return;
    }

    // Conta criada — salva sessão e entra direto
    saveSession(data.token, data.user);
    closeModal();
    window.location.href = 'agrobot.html';
  } catch {
    showError('signupError', 'Erro de conexão. Verifique sua internet.');
  } finally {
    if(btn){ btn.disabled = false; btn.textContent = 'Criar conta grátis →'; }
  }
}

// ── Waitlist ──
const waitlistBtn = document.querySelector('.waitlist-btn');
if(waitlistBtn) waitlistBtn.addEventListener('click', function(){
  const input = document.querySelector('.waitlist-input');
  if(input.value && input.value.includes('@')){
    this.textContent = 'Cadastrado ✓'; this.style.background='#4ADE80';
    input.value='';
    setTimeout(()=>{ this.textContent='Entrar na lista →'; this.style.background=''; },3000);
  } else {
    input.style.borderColor='#ef4444';
    setTimeout(()=>{ input.style.borderColor=''; },1500);
  }
});