// AI Fact Checker — Cloudflare Worker
// Auth + encrypted key storage + AI proxy

const EXTENSION_TOKEN  = 'fc-ext-v1-a9k2m7';
const SESSION_DAYS     = 30;
const BM_TOKEN_MIN_DAYS = 1;
const BM_TOKEN_MAX_DAYS = 365;
const PROVIDERS        = ['anthropic', 'openai', 'openrouter'];
const AUTH_SOURCES     = ['extension', 'bookmarklet', 'userscript'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Extension-Token, X-Session-Token',
};

// ── Router ────────────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const path   = new URL(request.url).pathname;
    const method = request.method;

    try {
      if (path === '/auth/register' && method === 'POST') return await register(request, env);
      if (path === '/auth/login'    && method === 'POST') return await login(request, env);
      if (path === '/auth/logout'   && method === 'POST') return await logout(request, env);
      if (path === '/auth/me'       && method === 'GET')  return await me(request, env);
      if (path === '/keys'       && method === 'GET')    return await getKeys(request, env);
      if (path === '/keys'       && method === 'PUT')    return await setKey(request, env);
      if (path === '/keys'       && method === 'DELETE') return await deleteKey(request, env);
      if (path === '/bm-tokens'  && method === 'GET')    return await listBmTokens(request, env);
      if (path === '/bm-tokens'  && method === 'POST')   return await createBmToken(request, env);
      if (path === '/bm-tokens'  && method === 'DELETE') return await revokeBmToken(request, env);
      if ((path === '/' || path === '/check') && method === 'POST') return await check(request, env);
      return json({ error: 'Not found' }, 404);
    } catch (e) {
      return json({ error: e.message || 'Internal error' }, e.status || 500);
    }
  },
};

// ── Auth handlers ─────────────────────────────────────────────────────────────

async function register(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password)        return json({ error: 'Email and password required' }, 400);
  if (!email.includes('@'))       return json({ error: 'Invalid email' }, 400);
  if (password.length < 8)        return json({ error: 'Password must be at least 8 characters' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email.toLowerCase()).first();
  if (existing) return json({ error: 'Email already registered' }, 409);

  const { hash, salt } = await hashPassword(password);
  const id = crypto.randomUUID();

  await env.DB.prepare(
    'INSERT INTO users (id, email, password_hash, password_salt) VALUES (?, ?, ?, ?)'
  ).bind(id, email.toLowerCase(), hash, salt).run();

  const token = await createSession(id, env);
  return json({ token, user: { id, email: email.toLowerCase() } });
}

async function login(request, env) {
  const { email, password } = await request.json().catch(() => ({}));
  if (!email || !password) return json({ error: 'Email and password required' }, 400);

  const user = await env.DB.prepare(
    'SELECT id, email, password_hash, password_salt FROM users WHERE email = ?'
  ).bind(email.toLowerCase()).first();

  if (!user || !(await verifyPassword(password, user.password_hash, user.password_salt))) {
    return json({ error: 'Invalid email or password' }, 401);
  }

  const token = await createSession(user.id, env);
  return json({ token, user: { id: user.id, email: user.email } });
}

async function logout(request, env) {
  const token = request.headers.get('X-Session-Token');
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  return json({ ok: true });
}

async function me(request, env) {
  const { user } = await requireSession(request, env);
  return json({ user });
}

// ── Key management ────────────────────────────────────────────────────────────

async function getKeys(request, env) {
  const { user } = await requireSession(request, env);
  const rows = await env.DB.prepare(
    'SELECT provider, updated_at FROM api_keys WHERE user_id = ?'
  ).bind(user.id).all();

  const configured = new Set((rows.results || []).map(r => r.provider));
  return json({
    keys: PROVIDERS.map(p => ({ provider: p, configured: configured.has(p) }))
  });
}

async function setKey(request, env) {
  const { user } = await requireSession(request, env);
  const { provider, key } = await request.json().catch(() => ({}));

  if (!provider || !PROVIDERS.includes(provider)) return json({ error: 'Invalid provider' }, 400);
  if (!key || key.trim().length < 10)             return json({ error: 'Invalid key' }, 400);

  const encKey = await getEncKey(env);
  const { encrypted, iv } = await encryptApiKey(key.trim(), encKey);

  await env.DB.prepare(`
    INSERT INTO api_keys (user_id, provider, encrypted_key, iv, updated_at)
    VALUES (?, ?, ?, ?, unixepoch())
    ON CONFLICT (user_id, provider)
    DO UPDATE SET encrypted_key = excluded.encrypted_key,
                  iv            = excluded.iv,
                  updated_at    = excluded.updated_at
  `).bind(user.id, provider, encrypted, iv).run();

  return json({ ok: true });
}

async function deleteKey(request, env) {
  const { user } = await requireSession(request, env);
  const { provider } = await request.json().catch(() => ({}));
  if (!provider || !PROVIDERS.includes(provider)) return json({ error: 'Invalid provider' }, 400);
  await env.DB.prepare(
    'DELETE FROM api_keys WHERE user_id = ? AND provider = ?'
  ).bind(user.id, provider).run();
  return json({ ok: true });
}

// ── Bookmarklet token handlers ────────────────────────────────────────────────

async function listBmTokens(request, env) {
  const { user } = await requireSession(request, env);
  const now = Math.floor(Date.now() / 1000);
  const rows = await env.DB.prepare(
    'SELECT token, label, created_at, expires_at FROM bookmarklet_tokens WHERE user_id = ? ORDER BY created_at DESC'
  ).bind(user.id).all();

  const tokens = (rows.results || []).map(r => ({
    prefix:     r.token.slice(0, 8) + '…',
    label:      r.label,
    created_at: r.created_at,
    expires_at: r.expires_at,
    expired:    r.expires_at <= now,
  }));
  return json({ tokens });
}

async function createBmToken(request, env) {
  const { user } = await requireSession(request, env);
  const { days = 7, label = 'My Bookmarklet' } = await request.json().catch(() => ({}));

  const clampedDays = Math.max(BM_TOKEN_MIN_DAYS, Math.min(BM_TOKEN_MAX_DAYS, Math.floor(Number(days))));
  if (!clampedDays) return json({ error: 'Invalid days value' }, 400);

  const token     = genToken();
  const expiresAt = Math.floor(Date.now() / 1000) + clampedDays * 86400;
  const safeLabel = String(label).trim().slice(0, 64) || 'My Bookmarklet';

  await env.DB.prepare(
    'INSERT INTO bookmarklet_tokens (token, user_id, label, expires_at) VALUES (?, ?, ?, ?)'
  ).bind(token, user.id, safeLabel, expiresAt).run();

  // Return the full token once — it is never returned again
  return json({ token, label: safeLabel, expires_at: expiresAt, days: clampedDays });
}

async function revokeBmToken(request, env) {
  const { user } = await requireSession(request, env);
  const { prefix } = await request.json().catch(() => ({}));
  if (!prefix) return json({ error: 'Missing token prefix' }, 400);

  // Match by prefix — safe because we only delete the user's own tokens
  const row = await env.DB.prepare(
    "SELECT token FROM bookmarklet_tokens WHERE user_id = ? AND token LIKE ?"
  ).bind(user.id, prefix.replace('…', '') + '%').first();

  if (!row) return json({ error: 'Token not found' }, 404);

  await env.DB.prepare('DELETE FROM bookmarklet_tokens WHERE token = ?').bind(row.token).run();
  return json({ ok: true });
}

// ── Check handler ─────────────────────────────────────────────────────────────

async function check(request, env) {
  if (request.headers.get('X-Extension-Token') !== EXTENSION_TOKEN) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const body   = await request.json().catch(() => ({}));
  const text   = (body.text || '').trim().slice(0, 3000);
  const source = body.source || 'webapp';
  if (!text) return json({ error: 'Missing text' }, 400);

  // Resolve user (required for extension/bookmarklet/userscript, optional for webapp)
  let userId = null;
  if (AUTH_SOURCES.includes(source)) {
    const sessionToken = request.headers.get('X-Session-Token');
    if (!sessionToken) return json({ error: 'Login required to use this tool' }, 401);
    const session = await getSession(sessionToken, env);
    if (!session)     return json({ error: 'Session expired — please log in again' }, 401);
    userId = session.user_id;
  } else {
    const sessionToken = request.headers.get('X-Session-Token');
    if (sessionToken) {
      const session = await getSession(sessionToken, env);
      if (session) userId = session.user_id;
    }
  }

  // Resolve API key: user's most-recently-updated key, else default
  let apiKey = env.DEFAULT_API_KEY;
  if (userId) {
    const row = await env.DB.prepare(
      'SELECT encrypted_key, iv FROM api_keys WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1'
    ).bind(userId).first();
    if (row) {
      const encKey = await getEncKey(env);
      apiKey = await decryptApiKey(row.encrypted_key, row.iv, encKey);
    }
  }

  const provider = detectProvider(apiKey);
  const result   = await callProvider(provider, apiKey, buildPrompt(text));
  return json({ result, provider });
}

// ── AI providers ──────────────────────────────────────────────────────────────

function detectProvider(key) {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-or-'))  return 'openrouter';
  return 'openai';
}

async function callProvider(provider, apiKey, prompt) {
  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `Anthropic ${res.status}`); }
    const d = await res.json();
    return d.content?.[0]?.text ?? 'No response.';
  }

  const endpoint = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/chat/completions'
    : 'https://api.openai.com/v1/chat/completions';
  const model = provider === 'openrouter' ? 'openrouter/free' : 'gpt-4o-mini';

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model, max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e?.error?.message || `API ${res.status}`); }
  const d = await res.json();
  const msg = d.choices?.[0]?.message;
  return msg?.content || msg?.reasoning || 'No response.';
}

// ── Session helpers ───────────────────────────────────────────────────────────

function genToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function createSession(userId, env) {
  const token     = genToken();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt).run();
  return token;
}

async function getSession(token, env) {
  const now = Math.floor(Date.now() / 1000);
  // Check full session tokens first
  const session = await env.DB.prepare(
    'SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?'
  ).bind(token, now).first();
  if (session) return session;

  // Fall back to scoped bookmarklet tokens (only valid for /check)
  const bmToken = await env.DB.prepare(
    'SELECT user_id FROM bookmarklet_tokens WHERE token = ? AND expires_at > ?'
  ).bind(token, now).first();
  return bmToken || null;
}

async function requireSession(request, env) {
  const token = request.headers.get('X-Session-Token');
  if (!token) { const e = new Error('Authentication required'); e.status = 401; throw e; }
  const session = await getSession(token, env);
  if (!session) { const e = new Error('Session expired'); e.status = 401; throw e; }
  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(session.user_id).first();
  if (!user) { const e = new Error('User not found'); e.status = 401; throw e; }
  return { user };
}

// ── Crypto helpers ────────────────────────────────────────────────────────────

async function getEncKey(env) {
  const enc = new TextEncoder();
  const km  = await crypto.subtle.importKey('raw', enc.encode(env.ENCRYPTION_KEY), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('afc-v1'), iterations: 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

async function encryptApiKey(plaintext, encKey) {
  const iv        = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, new TextEncoder().encode(plaintext));
  return {
    encrypted: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
    iv:        btoa(String.fromCharCode(...iv)),
  };
}

async function decryptApiKey(encB64, ivB64, encKey) {
  const encrypted = Uint8Array.from(atob(encB64), c => c.charCodeAt(0));
  const iv        = Uint8Array.from(atob(ivB64),  c => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, encKey, encrypted);
  return new TextDecoder().decode(decrypted);
}

async function hashPassword(password) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
  const enc  = new TextEncoder();
  const km   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, km, 256
  );
  return { hash: btoa(String.fromCharCode(...new Uint8Array(bits))), salt };
}

async function verifyPassword(password, hash, salt) {
  const enc  = new TextEncoder();
  const km   = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: enc.encode(salt), iterations: 100000, hash: 'SHA-256' }, km, 256
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits))) === hash;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function buildPrompt(text) {
  return `You are a knowledgeable AI assistant that can both answer questions and fact-check statements. The user has selected the following text:

SELECTED TEXT:
"${text}"

First, determine what type of content this is:
- TYPE A — QUESTION WITH ANSWER OPTIONS: The text contains a question followed by a list of possible answers (multiple choice, checkbox, true/false, quiz, exam, etc.). This includes questions in ANY language.
- TYPE B — FACTUAL CLAIM OR STATEMENT: The text is a statement, claim, or assertion that can be verified.

If TYPE A, respond in this exact format:

TYPE: QUESTION
CORRECT ANSWER(S):
[List each correct option exactly as written in the text, each on its own line starting with "- ".]
CONFIDENCE: [HIGH / MEDIUM / LOW]
EXPLANATION:
[2–4 sentences explaining WHY these are the correct answers. Respond in the same language as the question.]

If TYPE B, respond in this exact format:

TYPE: FACT-CHECK
VERDICT: [TRUE / FALSE / MISLEADING / UNVERIFIABLE / PARTIALLY TRUE]
CONFIDENCE: [HIGH / MEDIUM / LOW]
SUMMARY:
[2–3 sentence plain-language explanation of your verdict]
KEY FACTS:
[Bullet-point list of the most important factual points]
SOURCES TO CHECK:
[Suggest 2–3 types of authoritative sources]

Be accurate, concise, and respond in the same language as the selected text.`;
}
