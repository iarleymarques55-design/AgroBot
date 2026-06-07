// Script de testes automatizados: register -> login -> create conversation -> post message
(async () => {
  try {
    const base = 'http://localhost:3000';

    // Register (pode retornar 409 se já existir)
    const reg = await fetch(base + '/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'AutoTest', email: 'autotest1@example.com', password: '12345678' })
    });
    console.log('register ->', reg.status, await reg.text());

    // Login
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'autotest1@example.com', password: '12345678' })
    });
    const loginText = await login.text();
    console.log('login ->', login.status, loginText);
    const token = (() => { try { return JSON.parse(loginText).token } catch { return null } })();
    if (!token) { console.error('No token, aborting tests.'); process.exit(0); }

    // Create conversation
    const conv = await fetch(base + '/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ title: 'Teste API' })
    });
    const convJson = await conv.json();
    console.log('create conversation ->', conv.status, convJson);
    const convId = convJson.conversation?.id;
    if (!convId) { console.error('No conversation id, aborting.'); process.exit(0); }

    // Post message
    const msg = await fetch(base + `/api/conversations/${convId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ role: 'user', content: 'Mensagem de teste via script' })
    });
    console.log('post message ->', msg.status, await msg.json());

    console.log('Testes finalizados.');
    process.exit(0);
  } catch (err) {
    console.error('Erro nos testes:', err);
    process.exit(1);
  }
})();
