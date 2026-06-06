const API = 'https://fact-checker-proxy.kuruczpeter.workers.dev';
const EXT = 'fc-ext-v1-a9k2m7';
const DASHBOARD = 'https://kuruczp.github.io/ai-fact-checker/dashboard.html';

async function init() {
  const { sessionToken } = await chrome.storage.local.get('sessionToken');
  if (!sessionToken) { showLogin(); return; }

  const res = await apiFetch('GET', '/auth/me', sessionToken);
  if (!res.ok) { await chrome.storage.local.remove('sessionToken'); showLogin(); return; }

  const { user } = await res.json();
  showLoggedIn(user);
}

function showLogin() {
  document.getElementById('login-view').style.display = '';
  document.getElementById('logged-view').style.display = 'none';
}

function showLoggedIn(user) {
  document.getElementById('login-view').style.display = 'none';
  document.getElementById('logged-view').style.display = '';
  document.getElementById('p-user-email').textContent = user.email;
}

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('p-login-btn');
  const err = document.getElementById('p-error');
  btn.disabled = true; btn.textContent = 'Logging in…'; err.classList.remove('show');

  const res = await apiFetch('POST', '/auth/login', null, {
    email:    document.getElementById('p-email').value,
    password: document.getElementById('p-pass').value,
  });
  const data = await res.json();

  if (!res.ok) {
    err.textContent = data.error; err.classList.add('show');
    btn.disabled = false; btn.textContent = 'Log in'; return;
  }

  await chrome.storage.local.set({ sessionToken: data.token });
  showLoggedIn(data.user);
});

async function doLogout() {
  const { sessionToken } = await chrome.storage.local.get('sessionToken');
  if (sessionToken) await apiFetch('POST', '/auth/logout', sessionToken);
  await chrome.storage.local.remove('sessionToken');
  showLogin();
}

function openDashboard() {
  chrome.tabs.create({ url: DASHBOARD });
  window.close();
}

function apiFetch(method, path, token, body) {
  const headers = { 'Content-Type': 'application/json', 'X-Extension-Token': EXT };
  if (token) headers['X-Session-Token'] = token;
  return fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
}

init();
