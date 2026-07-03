/**
 * DividendKill — Cloudflare Worker (API + Static Assets)
 *
 * Auth (Google OAuth + cookie de session HttpOnly):
 *   GET  /auth/login    → redirect Google
 *   GET  /auth/callback → échange code, pose cookie, redirect /
 *   GET  /auth/logout   → supprime cookie, redirect /
 *   GET  /auth/me       → {user} ou {user:null}
 *
 * Routes protégées (cookie requis):
 *   GET    /api/sync              → transactions + settings
 *   POST   /api/transaction       → ajouter transaction
 *   DELETE /api/transaction/:id   → supprimer transaction
 *   PUT    /api/settings          → mettre à jour settings
 *   GET    /api/backup            → export JSON → R2
 *   POST   /api/restore           → restaurer depuis backup
 *
 * Routes publiques:
 *   GET  /api/prices?symbols=JNJ,MMM   → prix FMP (KV cache 30min)
 *   GET  /api/funda?symbol=JNJ         → fondamentaux FMP
 *
 * Cron (toutes les 30min):
 *   Pré-cache les tickers du portefeuille D1 dans KV
 *
 * Secrets (`wrangler secret put`):
 *   SESSION_SECRET       — signe les cookies de session
 *   GOOGLE_CLIENT_SECRET — OAuth Google
 *   FMP_KEY              — API Financial Modeling Prep
 * Vars (wrangler.toml [vars]):
 *   GOOGLE_CLIENT_ID     — OAuth Google (public)
 * Bindings (wrangler.toml):
 *   DB         — Cloudflare D1
 *   BACKUPS    — Cloudflare R2
 *   PRICES_KV  — Cloudflare KV
 *   ASSETS     — Static assets (build Vite)
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

// Injecté uniquement sur les réponses HTML (pas les API JSON)
function _addSecurityHeaders(h) {
  h.set('Content-Security-Policy',
    "default-src 'self'; " +
    "script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' data: https:; " +
    "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com; " +
    "frame-ancestors 'none'; " +
    "form-action 'self'; " +
    "base-uri 'self'"
  );
  h.set('X-Frame-Options', 'DENY');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  h.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const err = (msg, status = 400) => json({ error: msg }, status);

// ── JWT HMAC-SHA256 ──────────────────────────────────────────
function _b64u(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function _b64uDec(s) {
  return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
async function _hmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}
async function signJWT(payload, secret) {
  const h = _b64u(new TextEncoder().encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const b = _b64u(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await _hmacKey(secret, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${h}.${b}`));
  return `${h}.${b}.${_b64u(sig)}`;
}
async function verifyJWT(token, secret) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('invalid');
  const [h, b, sig] = parts;
  const key = await _hmacKey(secret, ['verify']);
  const ok = await crypto.subtle.verify('HMAC', key, _b64uDec(sig),
    new TextEncoder().encode(`${h}.${b}`));
  if (!ok) throw new Error('bad sig');
  const p = JSON.parse(new TextDecoder().decode(_b64uDec(b)));
  if (p.exp && p.exp < Math.floor(Date.now() / 1000)) throw new Error('expired');
  return p;
}


// ── Web Push / VAPID helpers ──────────────────────────────────
function _wpConcat(...arrays) {
  let len = 0; for (const a of arrays) len += a.length;
  const out = new Uint8Array(len); let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}
async function _hkdfExtract(salt, ikm) {
  const k = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, ikm));
}
async function _hkdfExpand(prk, info, len) {
  const k = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t1 = new Uint8Array(await crypto.subtle.sign('HMAC', k, _wpConcat(info, new Uint8Array([1]))));
  return t1.slice(0, len);
}
async function _getVapidKeys(env) {
  const cached = await env.PRICES_KV.get('vapid:keys', { type: 'json' });
  if (cached) return cached;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const privJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const rawPub  = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const publicKey = _b64u(rawPub);
  const keys = { privJwk, publicKey };
  await env.PRICES_KV.put('vapid:keys', JSON.stringify(keys));
  return keys;
}
async function _vapidJwt(endpoint, privJwk) {
  const { origin } = new URL(endpoint);
  const exp = Math.floor(Date.now() / 1000) + 43200;
  const enc = new TextEncoder();
  const header  = _b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payload = _b64u(enc.encode(JSON.stringify({ aud: origin, exp, sub: 'mailto:admin@dividendkill.app' })));
  const unsigned = `${header}.${payload}`;
  const privKey = await crypto.subtle.importKey('jwk', privJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, enc.encode(unsigned));
  return `${unsigned}.${_b64u(sig)}`;
}
async function _encryptPush(sub, body) {
  const enc  = new TextEncoder();
  const uaPub   = _b64uDec(sub.keys.p256dh);
  const authSec = _b64uDec(sub.keys.auth);
  const recipKey = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ephPair  = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub    = new Uint8Array(await crypto.subtle.exportKey('raw', ephPair.publicKey));
  const shared   = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: recipKey }, ephPair.privateKey, 256));
  const salt     = crypto.getRandomValues(new Uint8Array(16));
  // PRK = HKDF-Extract(salt=auth_secret, IKM=ecdh_secret)
  const prk  = await _hkdfExtract(authSec, shared);
  // IKM = HKDF-Expand(PRK, info="WebPush: info\0 || uaPub || asPub", L=32)
  const ikm  = await _hkdfExpand(prk, _wpConcat(enc.encode('WebPush: info'), new Uint8Array([0]), uaPub, asPub), 32);
  // Content PRK via salt
  const cprk = await _hkdfExtract(salt, ikm);
  const cek   = await _hkdfExpand(cprk, _wpConcat(enc.encode('Content-Encoding: aes128gcm'), new Uint8Array([0])), 16);
  const nonce = await _hkdfExpand(cprk, _wpConcat(enc.encode('Content-Encoding: nonce'), new Uint8Array([0])), 12);
  // Encrypt (AES-128-GCM, plaintext + \x02 delimiter)
  const plain  = typeof body === 'string' ? enc.encode(body) : enc.encode(JSON.stringify(body));
  const padded = _wpConcat(plain, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded));
  // RFC 8188 body: salt(16) | rs(4,BE=4096) | idlen(1=65) | asPub(65) | cipher
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096, false);
  return _wpConcat(salt, rs, new Uint8Array([asPub.length]), asPub, cipher);
}
async function _sendWebPush(sub, payload, keys) {
  try {
    const jwt    = await _vapidJwt(sub.endpoint, keys.privJwk);
    const rawPub = _b64uDec(keys.publicKey);
    const body   = await _encryptPush(sub, payload);
    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Authorization':    `vapid t=${jwt},k=${_b64u(rawPub)}`,
        'Content-Encoding': 'aes128gcm',
        'Content-Type':     'application/octet-stream',
        'TTL':              '86400',
      },
      body,
    });
    if (res.status === 410 || res.status === 404) return 'gone';
    return res.ok || res.status === 201;
  } catch(e) { console.warn('[Push]', e.message); return false; }
}
// ── Cookies ──────────────────────────────────────────────────
function getCookie(req, name) {
  const m = (req.headers.get('Cookie') || '').match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`)
  );
  return m ? decodeURIComponent(m[1]) : null;
}
function mkCookie(name, value, maxAge) {
  const base = `${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/`;
  return maxAge !== undefined ? `${base}; Max-Age=${maxAge}` : base;
}

// ── Auth ─────────────────────────────────────────────────────
async function getUser(req, env) {
  if (env.SESSION_SECRET) {
    const tok = getCookie(req, 'dk_session');
    if (!tok) return null;
    try { return await verifyJWT(tok, env.SESSION_SECRET); } catch(_) { return null; }
  }
  // Retro-compat Bearer token
  if (env.PORTFOLIO_TOKEN) {
    const auth = (req.headers.get('Authorization') || '').trim();
    if (auth === `Bearer ${env.PORTFOLIO_TOKEN}`) return { sub: 'legacy', email: 'legacy', name: 'Utilisateur' };
  }
  return null;
}

// ── Hachage mot de passe (PBKDF2-SHA256) ────────────────────
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return `${_b64u(salt)}:${_b64u(hash)}`;
}

async function verifyPassword(password, stored) {
  const [saltB64, hashB64] = stored.split(':');
  const salt    = _b64uDec(saltB64);
  const expected = _b64uDec(hashB64);
  const key     = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash    = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256));
  if (hash.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash[i] ^ expected[i];
  return diff === 0;
}

// ── Token pair (access 1h + refresh 30j rotatif) ───────────
async function issueTokenPair(userId, email, name, env) {
  const access = await signJWT(
    { sub: userId, email, name, exp: Math.floor(Date.now() / 1000) + 3600 },
    env.SESSION_SECRET
  );
  const rtId  = crypto.randomUUID();
  const rtExp = Math.floor(Date.now() / 1000) + 30 * 24 * 3600;
  await env.DB.prepare(
    'INSERT INTO refresh_tokens (id, user_id, email, name, expires_at) VALUES (?,?,?,?,?)'
  ).bind(rtId, userId, email, name || '', rtExp).run();
  return {
    accessCookie:  mkCookie('dk_session', access, 3600),
    refreshCookie: mkCookie('dk_refresh', rtId, 30 * 24 * 3600),
  };
}

async function handleAuthRefresh(req, env) {
  if (!env.SESSION_SECRET || !env.DB) return err('Auth non configurée', 500);
  await ensureMigrations(env.DB);
  const rtId = getCookie(req, 'dk_refresh');
  if (!rtId) return err('Pas de refresh token', 401);
  const rt = await env.DB.prepare(
    'SELECT user_id, email, name, expires_at FROM refresh_tokens WHERE id = ?'
  ).bind(rtId).first();
  if (!rt || rt.expires_at < Math.floor(Date.now() / 1000)) {
    if (rt) await env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?').bind(rtId).run();
    return err('Session expirée, reconnecte-toi', 401);
  }
  await env.DB.prepare('DELETE FROM refresh_tokens WHERE id = ?').bind(rtId).run();
  const pair = await issueTokenPair(rt.user_id, rt.email, rt.name || '', env);
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append('Set-Cookie', pair.accessCookie);
  headers.append('Set-Cookie', pair.refreshCookie);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
}

// ── Migrations D1 ────────────────────────────────────────────
let _migDone = false;
async function ensureMigrations(db) {
  if (_migDone) return;
  try {
    await db.prepare('CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, at INTEGER)').run();
    const done = new Set((await db.prepare('SELECT id FROM _migrations').all()).results.map(r => r.id));
    const migs = [
      ['add_user_id',    "ALTER TABLE transactions ADD COLUMN user_id TEXT NOT NULL DEFAULT ''"],
      ['idx_tx_user',    "CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id)"],
      ['user_settings',  "CREATE TABLE IF NOT EXISTS user_settings (user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (user_id, key))"],
      ['users_table',    "CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pw_hash TEXT NOT NULL, name TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()))"],
      ['users_idx_email',"CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)"],
      ['portfolio_nav',  "CREATE TABLE IF NOT EXISTS portfolio_nav (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, date TEXT NOT NULL, nav_usd REAL NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(user_id, date))"],
      ['idx_nav_user',   "CREATE INDEX IF NOT EXISTS idx_nav_user ON portfolio_nav(user_id, date)"],
      ['ticker_prices',  "CREATE TABLE IF NOT EXISTS ticker_prices (date TEXT NOT NULL, ticker TEXT NOT NULL, price REAL NOT NULL, PRIMARY KEY (date, ticker))"],
      ['idx_tkprice',    "CREATE INDEX IF NOT EXISTS idx_tkprice ON ticker_prices(ticker, date)"],
      ['refresh_tokens', "CREATE TABLE IF NOT EXISTS refresh_tokens (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()))"],
      ['idx_rt_user',    "CREATE INDEX IF NOT EXISTS idx_rt_user ON refresh_tokens(user_id, expires_at)"],
      ['push_subs',      "CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at INTEGER NOT NULL DEFAULT (unixepoch()), UNIQUE(user_id, endpoint))"],
    ];
    for (const [id, sql] of migs) {
      if (done.has(id)) continue;
      try {
        await db.prepare(sql).run();
        await db.prepare('INSERT INTO _migrations (id,at) VALUES (?,?)').bind(id, Math.floor(Date.now() / 1000)).run();
      } catch(e) { console.warn('[Mig]', id, e.message); }
    }
    _migDone = true;
  } catch(e) { console.warn('[Mig] init:', e.message); }
}

// ── Auth: inscription email/mot de passe ─────────────────────
async function handleAuthRegister(req, env) {
  if (!env.SESSION_SECRET) return err('Auth non configurée', 500);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (await isRateLimited(env, `reg:${ip}`, 5)) return err('Trop de tentatives, réessaie dans une minute', 429);
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { email, password, name } = body;
  if (!email || !password) return err('Email et mot de passe requis');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Adresse email invalide');
  if (password.length < 8)  return err('Mot de passe trop court (8 caractères min.)');
  if (password.length > 128) return err('Mot de passe trop long');

  if (env.DB) await ensureMigrations(env.DB);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (existing) return err('Cette adresse email est déjà utilisée', 409);

  const userId = crypto.randomUUID();
  const pwHash = await hashPassword(password);
  const displayName = (name || '').trim() || email.split('@')[0];
  await env.DB.prepare('INSERT INTO users (id,email,pw_hash,name) VALUES (?,?,?,?)').bind(userId, email.toLowerCase(), pwHash, displayName).run();

  const pair = await issueTokenPair(userId, email.toLowerCase(), displayName, env);
  const regHeaders = new Headers({ 'Content-Type': 'application/json' });
  regHeaders.append('Set-Cookie', pair.accessCookie);
  regHeaders.append('Set-Cookie', pair.refreshCookie);
  return new Response(JSON.stringify({ ok: true }), { status: 201, headers: regHeaders });
}

// ── Auth: connexion email/mot de passe ───────────────────────
async function handleAuthLoginEmail(req, env) {
  if (!env.SESSION_SECRET) return err('Auth non configurée', 500);
  const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
  if (await isRateLimited(env, `login:${ip}`, 10)) return err('Trop de tentatives, réessaie dans une minute', 429);
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { email, password } = body;
  if (!email || !password) return err('Email et mot de passe requis');
  if (await isEmailRateLimited(env, email.toLowerCase(), 5)) return err('Trop de tentatives, réessaie dans 15 min', 429);

  if (env.DB) await ensureMigrations(env.DB);
  const user = await env.DB.prepare('SELECT id,pw_hash,name FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (!user || !(await verifyPassword(password, user.pw_hash))) {
    return err('Email ou mot de passe incorrect', 401);
  }

  const pair = await issueTokenPair(user.id, email.toLowerCase(), user.name || email.split('@')[0], env);
  const loginHeaders = new Headers({ 'Content-Type': 'application/json' });
  loginHeaders.append('Set-Cookie', pair.accessCookie);
  loginHeaders.append('Set-Cookie', pair.refreshCookie);
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: loginHeaders });
}

// ── Google OAuth ─────────────────────────────────────────────
async function handleAuthLogin(req, env) {
  if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) return err('OAuth non configuré', 500);
  const origin = new URL(req.url).origin;
  const state  = crypto.randomUUID();
  const stJwt  = await signJWT({ state, exp: Math.floor(Date.now() / 1000) + 600 }, env.SESSION_SECRET);

  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id',     env.GOOGLE_CLIENT_ID);
  u.searchParams.set('redirect_uri',  `${origin}/auth/callback`);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope',         'openid email profile');
  u.searchParams.set('state',         state);

  return new Response(null, {
    status: 302,
    headers: {
      'Location':   u.toString(),
      'Set-Cookie': mkCookie('dk_oauth_state', stJwt, 600),
    },
  });
}

async function handleAuthCallback(req, env) {
  const url    = new URL(req.url);
  const code   = url.searchParams.get('code');
  const state  = url.searchParams.get('state');
  const origin = url.origin;

  if (!code) return Response.redirect(`${origin}/?auth_error=no_code`, 302);

  // Vérification state CSRF — obligatoire
  if (!state) return Response.redirect(`${origin}/?auth_error=state`, 302);
  const stTok = getCookie(req, 'dk_oauth_state');
  if (!stTok || !env.SESSION_SECRET) return Response.redirect(`${origin}/?auth_error=state`, 302);
  try {
    const p = await verifyJWT(stTok, env.SESSION_SECRET);
    if (p.state !== state) return Response.redirect(`${origin}/?auth_error=state`, 302);
  } catch(_) {
    return Response.redirect(`${origin}/?auth_error=state`, 302);
  }

  // Échange code → tokens
  const tRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri:  `${origin}/auth/callback`,
      grant_type:    'authorization_code',
    }),
  });
  if (!tRes.ok) {
    const te = await tRes.json().catch(() => ({}));
    console.error('[Auth] token exchange failed:', te);
    return Response.redirect(`${origin}/?auth_error=token`, 302);
  }
  const tData = await tRes.json();

  // Décode l'id_token Google (JWT non vérifié — on fait confiance à Google)
  const idP = JSON.parse(new TextDecoder().decode(
    _b64uDec(tData.id_token.split('.')[1])
  ));
  const userId = idP.sub;
  const email  = idP.email  || '';
  const name   = idP.name   || email;

  // Auto-claim des données existantes lors du premier login
  if (env.DB) {
    try {
      await ensureMigrations(env.DB);
      const hasOwn = await env.DB.prepare("SELECT COUNT(*) as n FROM transactions WHERE user_id = ?").bind(userId).first('n');
      if (!hasOwn) {
        const hasOther = await env.DB.prepare("SELECT COUNT(*) as n FROM transactions WHERE user_id != ''").first('n');
        if (!hasOther) {
          await env.DB.prepare("UPDATE transactions SET user_id = ? WHERE user_id = ''").bind(userId).run();
          await env.DB.prepare("INSERT OR IGNORE INTO user_settings (user_id,key,value) SELECT ?,key,value FROM settings").bind(userId).run();
          console.log('[Auth] données existantes attribuées à', email);
        }
      }
    } catch(e) { console.warn('[Auth] auto-claim:', e.message); }
  }

  // Upsert Google user dans users (pour révocation de session)
  if (env.DB) {
    try {
      await env.DB.prepare('INSERT OR IGNORE INTO users (id, email, pw_hash, name) VALUES (?,?,?,?)')
        .bind(userId, email, 'oauth:google', name).run();
    } catch(_) {}
  }

  // Émet access token 1h + refresh token rotatif 30j
  await ensureMigrations(env.DB);
  const pair = await issueTokenPair(userId, email, name, env);
  const headers = new Headers({ 'Location': `${origin}/` });
  headers.append('Set-Cookie', pair.accessCookie);
  headers.append('Set-Cookie', pair.refreshCookie);
  headers.append('Set-Cookie', mkCookie('dk_oauth_state', '', 0));
  return new Response(null, { status: 302, headers });
}

function handleAuthLogout(req) {
  const origin  = new URL(req.url).origin;
  const headers = new Headers({ 'Location': `${origin}/` });
  headers.append('Set-Cookie', mkCookie('dk_session', '', 0));
  return new Response(null, { status: 302, headers });
}

async function handleAuthMe(req, env) {
  const user = await getUser(req, env);
  if (!user) return json({ user: null });
  return json({ user: { sub: user.sub, email: user.email, name: user.name } });
}

// ── Normalise quote FMP ──────────────────────────────────────
function normalizeFmpQuote(q) {
  // Quand le marché est fermé FMP peut renvoyer price=0 ; on utilise previousClose comme fallback
  const price = q.price || q.previousClose || q.open || null;
  return {
    symbol:                     q.symbol,
    regularMarketPrice:         price,
    regularMarketChange:        q.change                                 || 0,
    regularMarketChangePercent: q.changePercentage ?? q.changesPercentage ?? 0,
    regularMarketPreviousClose: q.previousClose                          || null,
    regularMarketVolume:        q.volume                                 || null,
    longName:                   q.name                                   || null,
    shortName:                  q.name                                   || null,
    currency:                   q.currency                               || 'USD',
    trailingPE:                 q.pe                                     || null,
    marketCap:                  q.marketCap                              || null,
    fiftyTwoWeekHigh:           q.yearHigh                               || null,
    fiftyTwoWeekLow:            q.yearLow                                || null,
    marketState:                'REGULAR',
    lastDiv:                    q.lastDiv                                || null,
    dividendYield:              q.dividendYield                          || null,
  };
}


function normalizeProfile(t, p) {
  // FMP /stable/profile uses 'change'/'changePercentage' (singular)
  const chg       = p.change ?? p.changes ?? 0;
  const prevClose = +(p.price - chg).toFixed(4);
  const chgPct    = p.changePercentage ?? p.changesPercentage
    ?? (prevClose > 0 ? +(chg / prevClose * 100).toFixed(4) : 0);
  // FMP /stable/profile confirmed fields: lastDividend (annual), marketCap, averageVolume
  // No dividendYield, no pe, no mktCap, no volAvg, no lastDiv in free plan profile
  const annualDiv = p.lastDividend || null;
  return {
    symbol:                     t.toUpperCase(),
    regularMarketPrice:         p.price,
    regularMarketChange:        chg,
    regularMarketChangePercent: chgPct,
    regularMarketPreviousClose: prevClose > 0 ? prevClose : null,
    regularMarketVolume:        p.averageVolume  || null,
    longName:                   p.companyName    || null,
    shortName:                  p.companyName    || null,
    currency:                   p.currency       || 'USD',
    trailingPE:                 null,
    marketCap:                  p.marketCap      || null,
    fiftyTwoWeekHigh:           p.range ? +(p.range.split('-')[1] || 0) : null,
    fiftyTwoWeekLow:            p.range ? +(p.range.split('-')[0] || 0) : null,
    marketState:                'REGULAR',
    lastDiv:                    annualDiv,
    dividendYield:              annualDiv && p.price > 0 ? +(annualDiv / p.price).toFixed(6) : null,
    trailingAnnualDividendRate: annualDiv,
  };
}

// ── Twelve Data /quote — fallback prix de dernier recours si FMP échoue ──
// Pas de cache KV dédié : écrit directement dans le même cache p:SYMBOL que FMP.
async function fetchTwelveDataQuote(symbol, env) {
  if (!env.TWELVEDATA_KEY) return null;
  try {
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${env.TWELVEDATA_KEY}`;
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
    if (!r.ok) { console.warn('[TwelveData] quote HTTP', r.status, symbol); return null; }
    const d = await r.json();
    if (d.status === 'error' || d.code) { console.warn('[TwelveData] quote erreur', symbol, d.message || d.code); return null; }
    const price = parseFloat(d.close);
    if (!price || price <= 0) return null;
    return {
      symbol:                     symbol.toUpperCase(),
      regularMarketPrice:         price,
      regularMarketChange:        parseFloat(d.change) || 0,
      regularMarketChangePercent: parseFloat(d.percent_change) || 0,
      regularMarketPreviousClose: parseFloat(d.previous_close) || null,
      regularMarketVolume:        parseInt(d.volume, 10) || null,
      longName:                   d.name || null,
      shortName:                  d.name || null,
      currency:                   d.currency || 'USD',
      trailingPE:                 null, // jamais le P/E d'un fournisseur — voir fillFundaFallback
      marketCap:                  null,
      fiftyTwoWeekHigh:           d.fifty_two_week ? (parseFloat(d.fifty_two_week.high) || null) : null,
      fiftyTwoWeekLow:            d.fifty_two_week ? (parseFloat(d.fifty_two_week.low)  || null) : null,
      marketState:                'REGULAR',
      lastDiv:                    null,
      dividendYield:              null,
      trailingAnnualDividendRate: null,
    };
  } catch(e) { console.warn('[TwelveData] erreur quote', symbol, e.message); return null; }
}

async function isRateLimited(env, key, limit) {
  if (!env.PRICES_KV) return false;
  // Fail-open : si KV a un souci (quota d'écriture dépassé, erreur transitoire…),
  // on n'applique pas la limite plutôt que de faire planter tout le Worker —
  // un rate-limiter qui casse la fonctionnalité qu'il protège est pire que rien.
  try {
    const window = Math.floor(Date.now() / 60000);
    const kvKey  = `rl:${key}:${window}`;
    const cur    = parseInt(await env.PRICES_KV.get(kvKey) || '0', 10);
    if (cur >= limit) return true;
    await env.PRICES_KV.put(kvKey, String(cur + 1), { expirationTtl: 120 });
    return false;
  } catch(e) {
    console.warn('[isRateLimited] KV erreur, fail-open:', e.message);
    return false;
  }
}

// Rate limit par email sur fenêtre 15 min — protection brute force ciblée
async function isEmailRateLimited(env, email, limit) {
  if (!env.PRICES_KV) return false;
  const win = Math.floor(Date.now() / 900000); // 15-minute window
  const key = `rl:email:${email}:${win}`;
  const cur = parseInt(await env.PRICES_KV.get(key) || '0', 10);
  if (cur >= limit) return true;
  await env.PRICES_KV.put(key, String(cur + 1), { expirationTtl: 1800 });
  return false;
}

// ── Helpers fondamentaux FMP ─────────────────────────────────

/* Nombre d'années consécutives de maintien ou hausse du dividende annuel */
function computeStreak(divsArr) {
  if (!Array.isArray(divsArr) || divsArr.length < 2) return 0;
  const byYear = {};
  for (const d of divsArr) {
    const yr = (d.paymentDate || '').slice(0, 4);
    if (!yr || isNaN(+yr) || +yr < 1990) continue;
    const amt = d.dividend || d.adjDividend || 0;
    if (amt > 0) byYear[yr] = (byYear[yr] || 0) + amt;
  }
  const years = Object.keys(byYear).sort().reverse();
  let streak = 0;
  for (let i = 0; i < years.length - 1; i++) {
    // 2% tolerance pour éviter les faux cuts liés aux arrondis
    if (byYear[years[i]] >= byYear[years[i + 1]] * 0.98) streak++;
    else break;
  }
  return streak;
}

/* CAGR dividende sur 5 ans (annuel vs annuel 5 ans avant) */
function computeDivCAGR5y(divsArr) {
  if (!Array.isArray(divsArr) || divsArr.length < 4) return null;
  const byYear = {};
  for (const d of divsArr) {
    const yr = (d.paymentDate || '').slice(0, 4);
    if (!yr || isNaN(+yr) || +yr < 1990) continue;
    const amt = d.dividend || d.adjDividend || 0;
    if (amt > 0) byYear[yr] = (byYear[yr] || 0) + amt;
  }
  const curY = new Date().getFullYear();
  const now  = byYear[String(curY)] || byYear[String(curY - 1)];
  const old  = byYear[String(curY - 5)] || byYear[String(curY - 6)];
  if (!now || !old || old <= 0) return null;
  return +(Math.pow(now / old, 0.2) - 1).toFixed(4);
}

function extractPayMonths(divs) {
  if (!Array.isArray(divs) || divs.length === 0) return null;
  const cutoff = Date.now() - 2 * 365 * 86400000; // 2 ans
  const months = new Set();
  for (const d of divs) {
    if (!d.paymentDate) continue;
    const t = new Date(d.paymentDate).getTime();
    if (t < cutoff) break; // FMP renvoie du plus récent au plus ancien
    months.add(new Date(d.paymentDate).getMonth()); // 0-indexed
  }
  return months.size > 0 ? [...months].sort((a, b) => a - b) : null;
}

// Uniquement les 2 endpoints FMP gratuits et fiables (profile + dividends).
// Les 5 autres (income-statement, key-metrics-ttm, balance-sheet, cash-flow,
// earnings) retournent 402 pour la quasi-totalité des tickers en plan gratuit
// (confirmé en direct sur APD/ADP/UNM/MMM/ACN/HRL) — abandonnés pour éviter de
// gaspiller le quota FMP sur des appels qui échouent systématiquement.
// eps/pe_cur/payout_ratio/fcf_payout/debt_ebitda/interest_cov viennent donc
// toujours de fillFundaFallback (Finnhub en priorité, Alpha Vantage en secours).
function normalizeFunda(rawProfile, rawDivs) {
  const p = (Array.isArray(rawProfile) ? rawProfile[0] : rawProfile) || {};

  // FMP /stable/dividends returns { "historical": [...] } — normalize to flat array
  const divsArr = Array.isArray(rawDivs) ? rawDivs
                : Array.isArray(rawDivs?.historical) ? rawDivs.historical
                : [];

  // Compute annual dividend from the last 12 months of payments (sum of quarterly divs)
  let annual_div = null;
  if (divsArr.length > 0) {
    const cutoff = new Date(Date.now() - 400 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const recent = divsArr.filter(d => (d.paymentDate || '') >= cutoff && (d.dividend || d.adjDividend || 0) > 0);
    if (recent.length > 0) {
      annual_div = +recent.reduce((s, d) => s + (d.dividend || d.adjDividend || 0), 0).toFixed(4);
    }
  }
  // Fallback: lastDividend from profile is ALREADY annual (confirmed via debug)
  if (!annual_div && p.lastDividend && p.lastDividend > 0) {
    annual_div = +p.lastDividend.toFixed(4);
  }

  return {
    name:         p.companyName || null,
    sector:       p.sector      || null,
    beta:         p.beta        || null,
    market_cap:   p.marketCap   || null,
    annual_div,
    pe_cur:       null,
    payout_ratio: null,
    fcf_payout:   null,
    debt_ebitda:  null,
    interest_cov: null,
    pay_months:   extractPayMonths(divsArr),
    streak:       computeStreak(divsArr),
    div_cagr_5y:  computeDivCAGR5y(divsArr),
  };
}

// ── Prix FMP avec cache KV ───────────────────────────────────
// Utilise /stable/profile (plan free) — /stable/quote requiert plan payant (402)
async function priceProxy(req, env) {
  // Rate limit: 10 req/min per IP to protect FMP quota
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Real-IP') || 'unknown';
  if (await isRateLimited(env, `prices:${ip}`, 10)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429, headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }
  const symbols = new URL(req.url).searchParams.get('symbols');
  if (!symbols)     return err('missing symbols');
  if (!env.FMP_KEY) return err('FMP_KEY not configured', 500);

  const tickers = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const cached  = {};
  const missing = [];

  if (env.PRICES_KV) {
    await Promise.all(tickers.map(async t => {
      const val = await env.PRICES_KV.get(`p:${t}`, { type: 'json' });
      if (val && val.regularMarketPrice != null) cached[t] = val;
      else missing.push(t);
    }));
  } else {
    missing.push(...tickers);
  }

  // /stable/profile batch : 1 seul appel FMP pour tous les tickers manquants
  if (missing.length > 0) {
    try {
      const batchUrl = `https://financialmodelingprep.com/stable/profile?symbol=${missing.join(',')}&apikey=${env.FMP_KEY}`;
      const r = await fetch(batchUrl, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
      if (r.ok) {
        const d = await r.json();
        const profiles = Array.isArray(d) ? d : (d && d.price ? [d] : []);
        await Promise.all(profiles.map(async p => {
          const sym = (p.symbol || '').toUpperCase();
          if (!sym || !p.price) return;
          const n = normalizeProfile(sym, p);
          cached[sym] = n;
          if (env.PRICES_KV && n.regularMarketPrice != null)
            await env.PRICES_KV.put(`p:${sym}`, JSON.stringify(n), { expirationTtl: 86400 });
        }));
        // Retente en individuel les tickers non retournés par le batch
        const stillMissing = missing.filter(t => !cached[t] || cached[t].regularMarketPrice == null);
        await Promise.all(stillMissing.map(async t => {
          try {
            const r2 = await fetch(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(t)}&apikey=${env.FMP_KEY}`, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
            if (!r2.ok) return;
            const d2 = await r2.json();
            const p2 = Array.isArray(d2) ? d2[0] : d2;
            if (!p2 || !p2.price) return;
            const n2 = normalizeProfile(t, p2);
            cached[t] = n2;
            if (env.PRICES_KV && n2.regularMarketPrice != null)
              await env.PRICES_KV.put(`p:${t}`, JSON.stringify(n2), { expirationTtl: 86400 });
          } catch(e2) { console.warn(`[price] Profile individuel ${t}:`, e2.message); }
        }));
      } else {
        console.warn(`[price] Batch profile HTTP ${r.status}`);
      }
    } catch(e) { console.warn('[price] Batch profile:', e.message); }

    // Twelve Data en dernier recours si FMP n'a toujours pas de prix pour certains tickers
    const stillMissingAfterFmp = missing.filter(t => !cached[t] || cached[t].regularMarketPrice == null);
    if (stillMissingAfterFmp.length > 0 && env.TWELVEDATA_KEY) {
      await Promise.all(stillMissingAfterFmp.map(async t => {
        const td = await fetchTwelveDataQuote(t, env);
        if (td && td.regularMarketPrice != null) {
          cached[t] = td;
          if (env.PRICES_KV) await env.PRICES_KV.put(`p:${t}`, JSON.stringify(td), { expirationTtl: 86400 });
        }
      }));
    }
  }

  const fmpError = missing.filter(t => !cached[t] || cached[t].regularMarketPrice == null).length
    ? `no price: ${missing.filter(t => !cached[t]).join(',')}`
    : null;

  const results = tickers.map(t => cached[t]).filter(Boolean);
  if (!results.length) return err('FMP: aucun résultat', 502);
  return json({ quoteResponse: { result: results, error: null }, fmp_error: fmpError });
}

// ── Fondamentaux FMP avec cache KV 24h ───────────────────────
async function fmpProxy(req, env) {
  const symbol = new URL(req.url).searchParams.get('symbol');
  if (!symbol)      return err('missing symbol');
  if (!env.FMP_KEY) return err('FMP_KEY not configured', 500);

  const symbolUp = symbol.toUpperCase();
  const cacheKey = `funda9:${symbolUp}`;
  if (env.PRICES_KV) {
    try {
      const cached = await env.PRICES_KV.get(cacheKey, { type: 'json' });
      // Re-fetch si pe_cur manquant (AV peut maintenant le combler via KV cache)
      const incomplete = cached && cached.pe_cur == null;
      if (cached && !incomplete) return json(cached);
    } catch(e) {
      console.warn('[fmpProxy] lecture cache KV échouée, on refetch:', e.message);
    }
  }

  // À partir d'ici on va appeler des API externes (FMP/Finnhub/AV) — pas de limite
  // sur les cache hits ci-dessus (sinon un gros portefeuille casserait dès le 1er Sync).
  // 1) Limite par IP : protège contre un client qui spammerait des tickers jamais vus.
  const ip = req.headers.get('CF-Connecting-IP') || req.headers.get('X-Real-IP') || 'unknown';
  if (await isRateLimited(env, `funda:${ip}`, 30)) {
    return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
      status: 429, headers: { ...CORS, 'Content-Type': 'application/json', 'Retry-After': '60' },
    });
  }

  // 2) Coalescence best-effort : si un autre utilisateur est probablement déjà en train
  // de fetcher CE ticker (ex. 50 comptes qui se synchronisent au même instant), on attend
  // un court instant puis on retente le cache principal avant de dupliquer les appels.
  // KV n'offre pas de verrou atomique — c'est une réduction de bruit, pas une garantie.
  const lockKey = `fundalock:${symbolUp}`;
  if (env.PRICES_KV) {
    try {
      const already = await env.PRICES_KV.get(lockKey);
      if (already) {
        await new Promise(r => setTimeout(r, 400));
        const retryCache = await env.PRICES_KV.get(cacheKey, { type: 'json' });
        if (retryCache && retryCache.pe_cur != null) return json(retryCache);
      } else {
        await env.PRICES_KV.put(lockKey, '1', { expirationTtl: 10 });
      }
    } catch(e) {
      // Fail-open : un souci KV sur le verrou ne doit jamais faire planter la requête.
      console.warn('[fmpProxy] lock KV erreur, on continue sans coalescence:', e.message);
    }
  }

  const base = 'https://financialmodelingprep.com/stable';
  try {
    const safeJson = async r => {
      if (!r.ok) throw new Error(`FMP HTTP ${r.status}`);
      const text = await r.text();
      try { return JSON.parse(text); } catch(_) { throw new Error('FMP réponse non-JSON'); }
    };
    const tryJson = r => r.ok ? r.json() : null;
    // Seulement les 2 endpoints FMP gratuits fiables — voir normalizeFunda pour le détail
    const [profileRes, divsRes] = await Promise.allSettled([
      fetch(`${base}/profile?symbol=${symbol}&apikey=${env.FMP_KEY}`).then(safeJson),
      fetch(`${base}/dividends?symbol=${symbol}&apikey=${env.FMP_KEY}`).then(tryJson),
    ]);
    // Si le profil FMP échoue (429 quota épuisé, 402, timeout…), on continue quand même :
    // Finnhub/AV n'en dépendent pas pour eps/payout/beta, et le prix est déjà en cache
    // séparément via priceProxy (/api/prices). Avant, cet échec faisait tout capoter et
    // n'écrivait rien en cache — ticker bloqué à N/A jusqu'au prochain Sync.
    const rawProfile = profileRes.status === 'fulfilled' ? profileRes.value : {};
    const rawDivs    = divsRes.status    === 'fulfilled' ? divsRes.value    : null;
    if (profileRes.status === 'rejected') {
      console.warn(`[fmpProxy] profile FMP échoué pour ${symbol} (${profileRes.reason?.message}) — fallback Finnhub/AV + prix en cache`);
    }
    const result = normalizeFunda(rawProfile, rawDivs);
    // Complément Finnhub (principal) puis Alpha Vantage (secours) pour eps/payout/beta
    const _profileForPrice = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
    let price = _profileForPrice?.price;
    if (!price && env.PRICES_KV) {
      const cachedPrice = await env.PRICES_KV.get(`p:${symbol.toUpperCase()}`, { type: 'json' });
      price = cachedPrice?.regularMarketPrice || null;
    }
    await fillFundaFallback(result, symbol, env, price);
    // Cache 6h si toujours pas de métriques (quotas épuisés ou clés absentes), sinon TTL long
    const stillIncomplete = result.pe_cur == null && result.payout_ratio == null;
    const ttl = stillIncomplete ? 21600 : ttlFunda();
    if (env.PRICES_KV) await env.PRICES_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: ttl });
    return json(result);
  } catch(e) {
    console.error('[fmpProxy]', e.message);
    return err('Données fondamentales indisponibles', 502);
  }
}

async function searchProxy(req, env) {
  const q = new URL(req.url).searchParams.get('q') || '';
  if (!q || q.length < 2) return json({ results: [] });
  if (!env.FMP_KEY) return json({ results: [] });

  const ALLOWED_EXCHANGES = new Set([
    'NYSE','NASDAQ','AMEX','NYSE ARCA','NYSE MKT','BATS',
    'TSX','TSXV','LSE','EURONEXT','XETRA','BME','SIX',
    'ASX','HKG','JPX','KRX',
  ]);
  const _normalizeEx = ex => {
    if (!ex) return null;
    const u = ex.toUpperCase();
    if (u.includes('NASDAQ')) return 'NASDAQ';
    if (u.includes('NYSE'))   return 'NYSE';
    if (u.includes('AMEX'))   return 'AMEX';
    return ex;
  };

  const _parseResults = data =>
    (Array.isArray(data) ? data : [])
      .filter(r => {
        const ex = _normalizeEx(r.exchangeShortName || r.exchange || '');
        return !ex || ALLOWED_EXCHANGES.has(ex) || ex.length <= 6;
      })
      .slice(0, 8)
      .map(r => ({
        symbol:            r.symbol,
        name:              r.name || r.companyName || r.symbol,
        exchangeShortName: _normalizeEx(r.exchangeShortName || r.exchange || '') || 'NYSE',
      }));

  const headers = { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' };

  // Try stable endpoint first
  try {
    const url = `https://financialmodelingprep.com/stable/search-symbol?query=${encodeURIComponent(q)}&limit=10&apikey=${env.FMP_KEY}`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      const results = _parseResults(data);
      if (results.length) return json({ results });
    }
  } catch(_) {}

  // Fallback: FMP v3 search (free tier)
  try {
    const url = `https://financialmodelingprep.com/api/v3/search?query=${encodeURIComponent(q)}&limit=10&apikey=${env.FMP_KEY}`;
    const res = await fetch(url, { headers });
    if (res.ok) {
      const data = await res.json();
      const results = _parseResults(data);
      return json({ results });
    }
  } catch(_) {}

  return json({ results: [] });
}


// ── Push: GET /api/push/vapid-key ────────────────────────────
async function getPushVapidKey(env) {
  if (!env.PRICES_KV) return json({ error: 'KV indisponible' }, 503);
  try {
    const keys = await _getVapidKeys(env);
    return json({ publicKey: keys.publicKey });
  } catch(e) { return json({ error: e.message }, 500); }
}

// ── Push: POST /api/push/subscribe ───────────────────────────
async function postPushSubscribe(req, env, userId) {
  let body; try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { endpoint, keys } = body;
  if (!endpoint || !keys?.p256dh || !keys?.auth) return err('subscription invalide');
  if (typeof endpoint !== 'string' || endpoint.length > 512) return err('endpoint invalide');
  try {
    await env.DB.prepare(
      'INSERT OR REPLACE INTO push_subscriptions (user_id,endpoint,p256dh,auth) VALUES (?,?,?,?)'
    ).bind(userId, endpoint, keys.p256dh, keys.auth).run();
    return json({ ok: true });
  } catch(e) { return json({ error: e.message }, 500); }
}

// ── Push: POST /api/push/unsubscribe ─────────────────────────
async function postPushUnsubscribe(req, env, userId) {
  let body; try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { endpoint } = body;
  if (!endpoint) return err('endpoint requis');
  await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?')
    .bind(userId, endpoint).run().catch(() => {});
  return json({ ok: true });
}

async function benchmarkProxy(req, env) {
  const _bUrl = new URL(req.url);
  const _bSym = (_bUrl.searchParams.get('symbol') || 'SPY').toUpperCase().replace(/[^A-Z0-9^.]/g,'').slice(0,10);
  const ALLOWED_BENCH = new Set(['SPY','QQQ','GLD','EZU','URTH','IWDA']);
  const symbol = ALLOWED_BENCH.has(_bSym) ? _bSym : 'SPY';
  const CACHE_KEY = `benchmark:${symbol}`;
  const TTL = 82800; // 23h
  if (env.PRICES_KV) {
    const cached = await env.PRICES_KV.get(CACHE_KEY);
    if (cached) return new Response(cached, { headers: { ...CORS, 'Content-Type': 'application/json' } });
  }
  if (!env.FMP_KEY) return json({ entries: [] });
  try {
    // FMP historical EOD — pas de Yahoo Finance (Play Store TOS)
    const url = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(symbol)}&apikey=${env.FMP_KEY}`;
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
    if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
    const data = await res.json();
    const historical = Array.isArray(data) ? data : (data.historical || []);
    // FMP renvoie du plus récent au plus ancien — on inverse et on limite à 2 ans
    const entries = historical
      .filter(d => d.date && d.close != null)
      .map(d => ({ date: d.date, close: +d.close }))
      .reverse()
      .slice(-730);
    const body = JSON.stringify({ entries });
    if (env.PRICES_KV && entries.length > 10) await env.PRICES_KV.put(CACHE_KEY, body, { expirationTtl: TTL });
    return new Response(body, { headers: { ...CORS, 'Content-Type': 'application/json' } });
  } catch(e) {
    return json({ error: 'Benchmark indisponible', entries: [] }, 502);
  }
}

// ── Alpha Vantage OVERVIEW (P/E, payout, EPS, beta) ──────────
// Plan gratuit : 25 appels/jour — cachés 7 jours en KV (< 1 appel/ticker/semaine)
async function fetchAlphaVantageOverview(symbol, env) {
  const cacheKey = `av9:${symbol}`;
  // Toujours vérifier le cache KV d'abord (peut être pré-rempli par /api/debug/av-seed)
  if (env.PRICES_KV) {
    const cached = await env.PRICES_KV.get(cacheKey, { type: 'json' });
    if (cached) return cached;
  }
  if (!env.AV_KEY) return null;
  try {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${env.AV_KEY}`;
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
    if (!r.ok) { console.warn('[AV] HTTP', r.status, symbol); return null; }
    const d = await r.json();
    // AV renvoie {"Information":"..."} si rate-limited, {"Note":"..."} si quota dépassé
    if (!d.Symbol || d.Information || d.Note) {
      console.warn('[AV] no data', symbol, d.Information || d.Note || 'empty');
      return null;
    }
    const num = v => { const n = parseFloat(v); return isNaN(n) || n <= 0 ? null : n; };
    // PayoutRatio AV = décimal (0.559 = 55.9%), même format que notre payout_ratio
    // N.B. : pas de pe_cur ici — le P/E est toujours recalculé nous-mêmes (prix FMP / EPS)
    // dans fillFundaFallback, jamais depuis le PERatio fourni par Alpha Vantage.
    const parsed = {
      payout_ratio: num(d.PayoutRatio),
      beta:         num(d.Beta),
      market_cap:   num(d.MarketCapitalization),
      eps:          num(d.EPS),
      annual_div:   num(d.DividendPerShare),
    };
    if (env.PRICES_KV)
      await env.PRICES_KV.put(cacheKey, JSON.stringify(parsed), { expirationTtl: 7 * 24 * 3600 });
    console.log(`[AV] ${symbol} EPS=${parsed.eps} payout=${parsed.payout_ratio}`);
    return parsed;
  } catch(e) { console.warn('[AV] erreur', symbol, e.message); return null; }
}

// ── Finnhub /stock/metric?metric=all (EPS, payout, beta) ─────────────────
// Plan gratuit : 60 appels/minute (bien plus généreux que les 25/JOUR d'AV) —
// fallback PRINCIPAL avant AV. Cache 7 jours en KV (confirmé libre pour APD/ADP
// via /api/debug/finnhub, contrairement à FMP qui bloque ces mêmes champs).
// N.B. : ne renvoie PAS de pe_cur — le P/E est toujours recalculé nous-mêmes
// (prix FMP / EPS) dans fillFundaFallback, jamais depuis le P/E de Finnhub.
async function fetchFinnhubMetrics(symbol, env) {
  const cacheKey = `fh9:${symbol}`;
  if (env.PRICES_KV) {
    const cached = await env.PRICES_KV.get(cacheKey, { type: 'json' });
    if (cached) return cached;
  }
  if (!env.FINNHUB_KEY) return null;
  try {
    const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${env.FINNHUB_KEY}`;
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
    if (!r.ok) { console.warn('[Finnhub] HTTP', r.status, symbol); return null; }
    const d = await r.json();
    const m = d.metric;
    if (!m) { console.warn('[Finnhub] pas de metric', symbol); return null; }
    const num = v => { const n = parseFloat(v); return isNaN(n) || n <= 0 ? null : n; };
    // Finnhub renvoie payoutRatio en pourcentage (75.63) — converti en décimal (0.7563)
    // pour matcher le format utilisé partout ailleurs dans l'app (FMP/AV).
    const rawPayout = num(m.payoutRatioTTM ?? m.payoutRatioAnnual);
    const parsed = {
      eps:          num(m.epsBasicExclExtraItemsTTM ?? m.epsTTM ?? m.epsExclExtraItemsTTM),
      payout_ratio: rawPayout != null ? +(rawPayout / 100).toFixed(4) : null,
      beta:         num(m.beta),
      annual_div:   num(m.dividendPerShareTTM ?? m.dividendPerShareAnnual),
    };
    if (env.PRICES_KV)
      await env.PRICES_KV.put(cacheKey, JSON.stringify(parsed), { expirationTtl: 7 * 24 * 3600 });
    console.log(`[Finnhub] ${symbol} EPS=${parsed.eps} payout=${parsed.payout_ratio}`);
    return parsed;
  } catch(e) { console.warn('[Finnhub] erreur', symbol, e.message); return null; }
}

// ── Twelve Data /statistics (EPS, payout, beta) — secours FINAL (après Finnhub + AV) ──
// Cache 7 jours en KV. N.B. : pas de pe_cur ici non plus — même règle que les autres
// fallbacks, le P/E est toujours recalculé nous-mêmes (prix FMP / EPS).
async function fetchTwelveDataFundamentals(symbol, env) {
  const cacheKey = `td9:${symbol}`;
  if (env.PRICES_KV) {
    const cached = await env.PRICES_KV.get(cacheKey, { type: 'json' });
    if (cached) return cached;
  }
  if (!env.TWELVEDATA_KEY) return null;
  try {
    const url = `https://api.twelvedata.com/statistics?symbol=${encodeURIComponent(symbol)}&apikey=${env.TWELVEDATA_KEY}`;
    const r = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
    if (!r.ok) { console.warn('[TwelveData] statistics HTTP', r.status, symbol); return null; }
    const d = await r.json();
    if (d.status === 'error' || d.code) { console.warn('[TwelveData] statistics erreur', symbol, d.message || d.code); return null; }
    const s = d.statistics || {};
    const num = v => { const n = parseFloat(v); return isNaN(n) || n <= 0 ? null : n; };
    const eps = num(s.financials?.income_statement?.diluted_eps_ttm ?? s.financials?.income_statement?.basic_eps_ttm);
    // payout_ratio peut arriver en fraction (0.75) ou en pourcentage (75) selon les comptes/plans — normalisé si > 1
    const rawPayout = num(s.dividends_and_splits?.payout_ratio);
    const parsed = {
      eps,
      payout_ratio: rawPayout != null ? +((rawPayout > 1 ? rawPayout / 100 : rawPayout).toFixed(4)) : null,
      beta:         num(s.stock_statistics?.beta),
      annual_div:   num(s.dividends_and_splits?.forward_annual_dividend_rate),
    };
    if (env.PRICES_KV)
      await env.PRICES_KV.put(cacheKey, JSON.stringify(parsed), { expirationTtl: 7 * 24 * 3600 });
    console.log(`[TwelveData] ${symbol} EPS=${parsed.eps} payout=${parsed.payout_ratio}`);
    return parsed;
  } catch(e) { console.warn('[TwelveData] erreur statistics', symbol, e.message); return null; }
}

// ── Complète un résultat normalizeFunda incomplet (402 FMP plan gratuit) ──
// Ordre : Finnhub (60/min, principal) → Alpha Vantage (25/jour) → Twelve Data (secours final).
// Mute le `result` en place et pose un flag `_source` pour traçabilité/debug.
// `price` = prix courant FMP (/stable/profile, plan gratuit) — seule source de prix utilisée.
// Le P/E n'est JAMAIS pris tel quel chez un fournisseur : toujours recalculé ici
// (prix / EPS), pour rester indépendant des méthodologies (TTM/forward/dilué…)
// qui diffèrent entre FMP, Finnhub, Alpha Vantage et Twelve Data.
async function fillFundaFallback(result, symbol, env, price) {
  if (result.pe_cur != null) return;
  const fh = await fetchFinnhubMetrics(symbol, env);
  if (fh) {
    if (fh.eps != null && price > 0) result.pe_cur = +(price / fh.eps).toFixed(2);
    if (fh.payout_ratio != null) result.payout_ratio = fh.payout_ratio;
    if (fh.beta         != null && result.beta       == null) result.beta       = fh.beta;
    if (fh.annual_div   != null && result.annual_div == null) result.annual_div = fh.annual_div;
    result._finnhub_source = true;
  }
  if (result.pe_cur == null) {
    const av = await fetchAlphaVantageOverview(symbol, env);
    if (av) {
      if (av.eps != null && price > 0) result.pe_cur = +(price / av.eps).toFixed(2);
      if (av.payout_ratio != null) result.payout_ratio = av.payout_ratio;
      if (av.beta         != null && result.beta       == null) result.beta       = av.beta;
      if (av.market_cap   != null && result.market_cap == null) result.market_cap = av.market_cap;
      if (av.annual_div   != null && result.annual_div == null) result.annual_div = av.annual_div;
      result._av_source = true;
    }
  }
  // Twelve Data /statistics désactivé ici : confirmé via /api/debug/twelvedata que
  // cet endpoint renvoie 403 "available exclusively with pro or ultra or venture or
  // enterprise plans" sur le plan gratuit (contrairement à /quote, qui lui fonctionne
  // — voir fetchTwelveDataQuote dans priceProxy). fetchTwelveDataFundamentals() reste
  // disponible si le plan Twelve Data est upgradé un jour ; il suffit de redécommenter
  // l'appel ci-dessous.
  // if (result.pe_cur == null) {
  //   const td = await fetchTwelveDataFundamentals(symbol, env);
  //   if (td) {
  //     if (td.eps != null && price > 0) result.pe_cur = +(price / td.eps).toFixed(2);
  //     if (td.payout_ratio != null) result.payout_ratio = td.payout_ratio;
  //     if (td.beta         != null && result.beta       == null) result.beta       = td.beta;
  //     if (td.annual_div   != null && result.annual_div == null) result.annual_div = td.annual_div;
  //     result._twelvedata_source = true;
  //   }
  // }
}

// ── Cron: prix + fondamentaux automatiques à la clôture marché ─
const ttlFunda = () => 10368000 + Math.floor((Math.random() - 0.5) * 2592000);

async function handleScheduled(env) {
  if (!env.FMP_KEY || !env.PRICES_KV || !env.DB) return;
  const TTL_PRICE = 86400;
  const FMP_BASE  = 'https://financialmodelingprep.com/stable';
  const HEADERS   = { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' };

  const fmt = d => d.toISOString().split('T')[0];

  async function refreshFunda(symbol, reason) {
    try {
      const tryJson = r => r.ok ? r.json() : null;
      // Seulement les 2 endpoints FMP gratuits fiables — voir normalizeFunda pour le détail
      const [profileData, divsData] = await Promise.all([
        fetch(`${FMP_BASE}/profile?symbol=${symbol}&apikey=${env.FMP_KEY}`, { headers: HEADERS }).then(r => r.json()).catch(() => ({})),
        fetch(`${FMP_BASE}/dividends?symbol=${symbol}&apikey=${env.FMP_KEY}`, { headers: HEADERS }).then(tryJson).catch(() => null),
      ]);
      const normalized = normalizeFunda(profileData, divsData);
      // Complément Finnhub (principal) puis Alpha Vantage (secours) pour eps/payout/beta.
      // Si le profil FMP a échoué (429 quota, 402…), pas de prix dedans — on retombe sur
      // le prix déjà en cache via priceProxy (/api/prices) pour pouvoir quand même calculer pe_cur.
      const _profileForPrice = Array.isArray(profileData) ? profileData[0] : profileData;
      let price = _profileForPrice?.price;
      if (!price) {
        const cachedPrice = await env.PRICES_KV.get(`p:${symbol}`, { type: 'json' });
        price = cachedPrice?.regularMarketPrice || null;
      }
      await fillFundaFallback(normalized, symbol, env, price);
      const stillIncomplete = normalized.pe_cur == null && normalized.payout_ratio == null;
      const ttl = stillIncomplete ? 21600 : ttlFunda();
      await env.PRICES_KV.put(`funda9:${symbol}`, JSON.stringify(normalized), { expirationTtl: ttl });
      console.log(`[Cron] funda9:${symbol} mis à jour — ${reason}${stillIncomplete ? ' [incomplet]' : normalized._finnhub_source ? ' [Finnhub]' : normalized._av_source ? ' [AV]' : ''}`);
      return true;
    } catch(e) { console.warn(`[Cron] funda ${symbol}:`, e.message); return false; }
  }

  try {
    const { results } = await env.DB.prepare(
      "SELECT DISTINCT ticker FROM transactions WHERE type IN ('buy','sell')"
    ).all();
    const tickers = results.map(r => r.ticker).filter(Boolean);
    if (!tickers.length) { console.log('[Cron] Aucun ticker'); return; }
    const tickerSet = new Set(tickers.map(t => t.toUpperCase()));
    const pushNotifs = []; // {ticker, payload} pairs to send after price update

    // ── Prix via /stable/profile batch (1 seul appel FMP) ───────
    // /stable/quote est payant (402) — on utilise profile directement
    let toStore = [];
    try {
      const r = await fetch(`${FMP_BASE}/profile?symbol=${tickers.join(',')}&apikey=${env.FMP_KEY}`, { headers: HEADERS });
      if (r.ok) {
        const d = await r.json();
        const profiles = Array.isArray(d) ? d : (d && d.price ? [d] : []);
        toStore = profiles.map(p => p && p.price ? normalizeProfile((p.symbol || '').toUpperCase(), p) : null).filter(Boolean);
      } else {
        console.warn('[Cron] Batch profile HTTP', r.status);
      }
    } catch(e) { console.warn('[Cron] Batch profile:', e.message); }
    // Retente en individuel les tickers absents du batch
    const gotBatch = new Set(toStore.map(q => q.symbol));
    const stillMissing = tickers.filter(t => !gotBatch.has(t.toUpperCase()));
    if (stillMissing.length > 0) {
      const fallback = await Promise.all(stillMissing.map(async t => {
        try {
          const r = await fetch(`${FMP_BASE}/profile?symbol=${encodeURIComponent(t)}&apikey=${env.FMP_KEY}`, { headers: HEADERS });
          if (!r.ok) return null;
          const d = await r.json();
          const p = Array.isArray(d) ? d[0] : d;
          return (p && p.price) ? normalizeProfile(t, p) : null;
        } catch(e) { console.warn(`[Cron] Profile fallback ${t}:`, e.message); return null; }
      }));
      toStore.push(...fallback.filter(Boolean));
    }

    // ── Appel 2 : calendrier dividendes déclarés (30 jours) ──
    const today  = new Date();
    const future = new Date(today.getTime() + 30 * 86400000);
    let declaredChanges = new Set(); // tickers avec nouvelle déclaration
    try {
      const calRes = await fetch(
        `${FMP_BASE}/dividends-calendar?from=${fmt(today)}&to=${fmt(future)}&apikey=${env.FMP_KEY}`,
        { headers: HEADERS }
      );
      if (calRes.ok) {
        const calData = await calRes.json();
        if (Array.isArray(calData)) {
          await Promise.all(
            calData
              .filter(d => tickerSet.has(d.symbol?.toUpperCase()))
              .map(async d => {
                const sym     = d.symbol.toUpperCase();
                const declKey = `divdecl:${sym}`;
                const prev    = await env.PRICES_KV.get(declKey, { type: 'json' });
                const isNew   = !prev
                  || prev.declarationDate !== d.declarationDate
                  || prev.amount         !== d.dividend;
                if (isNew) {
                  await env.PRICES_KV.put(declKey, JSON.stringify({ amount: d.dividend, declarationDate: d.declarationDate }), { expirationTtl: ttlFunda() });
                  declaredChanges.add(sym);
                  if (d.paymentDate === fmt(today) && d.dividend > 0) {
                    pushNotifs.push({ ticker: sym, payload: { title: sym + ' — Dividende versé', body: sym + ' paie ' + d.dividend + '$/action', tag: 'div-pay-' + sym } });
                  }
                  console.log(`[Cron] Nouvelle déclaration dividende ${sym}: ${d.dividend} (déclaré ${d.declarationDate}, paiement ${d.paymentDate})`);
                }
              })
          );
        }
      }
    } catch(e) { console.warn('[Cron] calendrier dividendes:', e.message); }

    // ── Mise à jour prix + fondamentaux (lots de 5) ───────────
    // Max 3 refreshes funda par run de cron — évite d'épuiser le quota FMP gratuit
    // (~250 appels/jour) en cas de bump de clé ou de nombreux tickers sans cache.
    // Avec un TTL de ~120 jours, chaque ticker n'est rafraîchi que sporadiquement.
    const MAX_FUNDA_PER_CRON = 3;
    let divChanged = 0, declUpdated = 0, fundaInit = 0;
    const fundaCount = () => fundaInit + divChanged + declUpdated;
    for (let i = 0; i < toStore.length; i += 5) {
      await Promise.all(toStore.slice(i, i + 5).map(async q => {
        const [old, fundaRaw] = await Promise.all([
          env.PRICES_KV.get(`p:${q.symbol}`, { type: 'json' }),
          env.PRICES_KV.get(`funda9:${q.symbol}`),
        ]);

        const lastDivChg = old?.lastDiv != null && q.lastDiv != null && old.lastDiv !== q.lastDiv;
        const declChg    = declaredChanges.has(q.symbol);

        if (fundaCount() < MAX_FUNDA_PER_CRON) {
          if (!fundaRaw)      { if (await refreshFunda(q.symbol, 'init'))          fundaInit++;    }
          else if (lastDivChg){ if (await refreshFunda(q.symbol, `lastDiv ${old.lastDiv}→${q.lastDiv}`)) divChanged++; }
          else if (declChg)   { if (await refreshFunda(q.symbol, 'déclaration anticipée')) declUpdated++; }
        }

        if (lastDivChg && q.lastDiv > old.lastDiv) {
          const delta = (q.lastDiv - old.lastDiv).toFixed(4);
          pushNotifs.push({ ticker: q.symbol, payload: { title: q.symbol + ' — Hausse du dividende', body: 'Dividende ' + old.lastDiv + '$ → ' + q.lastDiv + '$ (+' + delta + '$)', tag: 'div-raise-' + q.symbol } });
        }
        if (old && old.regularMarketPrice && q.regularMarketPrice) {
          const chg = (q.regularMarketPrice - old.regularMarketPrice) / old.regularMarketPrice;
          if (chg < -0.05) pushNotifs.push({ ticker: q.symbol, payload: { title: q.symbol + ' — Chute ' + (chg*100).toFixed(1) + '%', body: q.symbol + ' -' + Math.abs((chg*100).toFixed(1)) + '% (' + q.regularMarketPrice.toFixed(2) + '$)', tag: 'drop-' + q.symbol } });
        }

        await env.PRICES_KV.put(`p:${q.symbol}`, JSON.stringify(q), { expirationTtl: TTL_PRICE });
      }));
    }

    console.log(`[Cron] ${toStore.length} prix · ${fundaInit} inits · ${divChanged} versements changés · ${declUpdated} déclarations anticipées`);

    // ── Snapshot NAV par utilisateur (1 ligne/jour, 0 crédit FMP) ─
    try {
      const priceMap = {};
      toStore.forEach(q => { if (q.regularMarketPrice) priceMap[q.symbol] = q.regularMarketPrice; });

      const today_date = fmt(new Date());
      const { results: positions } = await env.DB.prepare(
        `SELECT user_id, ticker,
           SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares
         FROM transactions WHERE type IN ('buy','sell')
         GROUP BY user_id, ticker
         HAVING net_shares > 0`
      ).all();

      const navByUser = {};
      for (const { user_id, ticker, net_shares } of positions) {
        const price = priceMap[ticker.toUpperCase()];
        if (price && net_shares > 0) {
          navByUser[user_id] = (navByUser[user_id] || 0) + net_shares * price;
        }
      }

      await Promise.all(Object.entries(navByUser).map(([uid, nav_usd]) =>
        env.DB.prepare(
          'INSERT OR REPLACE INTO portfolio_nav (user_id, date, nav_usd) VALUES (?,?,?)'
        ).bind(uid, today_date, Math.round(nav_usd * 100) / 100).run()
      ));
      console.log(`[Cron] NAV snapshot: ${Object.keys(navByUser).length} utilisateur(s) · ${today_date}`);
    } catch(e) { console.warn('[Cron] NAV snapshot:', e.message); }

    // ── Snapshot prix par ticker (historique de performance par position) ──
    try {
      const today_date2 = fmt(new Date());
      const priceStmts = toStore
        .filter(q => q.regularMarketPrice != null && q.regularMarketPrice > 0)
        .map(q => env.DB.prepare(
          'INSERT OR REPLACE INTO ticker_prices (date, ticker, price) VALUES (?,?,?)'
        ).bind(today_date2, q.symbol, q.regularMarketPrice));
      if (priceStmts.length) {
        await env.DB.batch(priceStmts);
        console.log(`[Cron] ticker_prices: ${priceStmts.length} snapshots (${today_date2})`);
      }
    } catch(e) { console.warn('[Cron] ticker_prices:', e.message); }

    // ── News : 1 seul appel FMP pour tous les tickers, stocké 24h ──
    try {
      const newsRes = await fetch(
        `${FMP_BASE}/stock-news?tickers=${tickers.join(',')}&limit=50&apikey=${env.FMP_KEY}`,
        { headers: HEADERS }
      );
      if (newsRes.ok) {
        const newsData = await newsRes.json();
        const articles = (Array.isArray(newsData) ? newsData : []).slice(0, 50).map(a => ({
          symbol:        (a.symbol        || '').toUpperCase(),
          title:          a.title         || '',
          text:          (a.text || a.content || '').slice(0, 400),
          publishedDate:  a.publishedDate || '',
          site:           a.site          || '',
          url:            a.url           || '',
        }));
        await env.PRICES_KV.put('news:all', JSON.stringify({ articles, cachedAt: Date.now() }), { expirationTtl: 86400 });
        console.log(`[Cron] news: ${articles.length} articles pour ${tickers.length} tickers`);
      } else {
        console.warn('[Cron] news HTTP', newsRes.status);
      }
    } catch(e) { console.warn('[Cron] news:', e.message); }


    // ── Envoi push notifications ─────────────────────────────
    if (pushNotifs.length > 0) {
      try {
        const vapidKeys = await _getVapidKeys(env);
        const { results: pSubs } = await env.DB.prepare('SELECT user_id, endpoint, p256dh, auth FROM push_subscriptions').all();
        if (pSubs.length > 0) {
          const { results: posRows } = await env.DB.prepare(
            "SELECT user_id, ticker, SUM(CASE WHEN type='buy' THEN shares ELSE -shares END) AS net_shares FROM transactions WHERE type IN ('buy','sell') GROUP BY user_id, ticker HAVING net_shares > 0"
          ).all();
          const holdsByUser = {};
          for (const p of posRows) { if (!holdsByUser[p.user_id]) holdsByUser[p.user_id] = new Set(); holdsByUser[p.user_id].add(p.ticker.toUpperCase()); }
          const subsByUser = {};
          for (const s of pSubs) { if (!subsByUser[s.user_id]) subsByUser[s.user_id] = []; subsByUser[s.user_id].push(s); }
          const gone = [];
          for (const notif of pushNotifs) {
            for (const [uid, userSubs] of Object.entries(subsByUser)) {
              if (notif.ticker && !holdsByUser[uid]?.has(notif.ticker)) continue;
              for (const sub of userSubs) {
                const res = await _sendWebPush({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, notif.payload, vapidKeys);
                if (res === 'gone') gone.push({ uid, endpoint: sub.endpoint });
              }
            }
          }
          for (const { uid, endpoint } of gone) await env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?').bind(uid, endpoint).run().catch(() => {});
          console.log('[Cron] Push: ' + pushNotifs.length + ' notif(s), ' + pSubs.length + ' abonné(s)');
        }
      } catch(e) { console.warn('[Cron] Push:', e.message); }
    }
  } catch(e) { console.warn('[Cron]', e.message); }
}

// ── D1: GET /api/sync ────────────────────────────────────────
async function getSync(env, userId) {
  const [txRes, stRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date ASC, created_at ASC').bind(userId).all(),
    env.DB.prepare('SELECT key, value FROM user_settings WHERE user_id = ?').bind(userId).all(),
  ]);
  let settings = Object.fromEntries(stRes.results.map(r => [r.key, r.value]));
  if (!Object.keys(settings).length) {
    try {
      const gs = await env.DB.prepare('SELECT key, value FROM settings').all();
      settings = Object.fromEntries(gs.results.map(r => [r.key, r.value]));
    } catch(_) {} // table legacy peut ne pas exister
  }
  return json({ transactions: txRes.results, settings });
}

// ── D1: GET /api/nav ─────────────────────────────────────────
async function getNav(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT date, nav_usd FROM portfolio_nav WHERE user_id = ? ORDER BY date ASC'
  ).bind(userId).all();
  return json({ nav: results });
}

// ── D1: POST /api/transaction ────────────────────────────────
async function postTransaction(req, env, userId) {
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { type, ticker, shares, price, amount, date, currency = 'USD' } = body;
  const VALID_TYPES = new Set(['buy', 'sell', 'dividend']);
  if (!type || !VALID_TYPES.has(type))   return err('type invalide (buy/sell/dividend)');
  if (!ticker || typeof ticker !== 'string') return err('ticker requis');
  if (ticker.length > 20 || !/^[A-Za-z0-9.\-^=]+$/.test(ticker)) return err('ticker invalide');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return err('date invalide (YYYY-MM-DD)');
  if (shares != null && (isNaN(shares) || +shares <= 0)) return err('shares invalide');
  if (price  != null && (isNaN(price)  || +price  <  0)) return err('prix invalide');

  const r = await env.DB
    .prepare('INSERT INTO transactions (type,ticker,shares,price,amount,date,currency,user_id) VALUES (?,?,?,?,?,?,?,?)')
    .bind(type, ticker.toUpperCase(), shares ?? null, price ?? null, amount ?? null, date, currency, userId)
    .run();
  return json({ id: r.meta.last_row_id, ok: true }, 201);
}

// ── D1: DELETE /api/transaction/:id ─────────────────────────
async function deleteTransaction(path, env, userId) {
  const id = parseInt(path.split('/').pop(), 10);
  if (!id || isNaN(id)) return err('invalid id');
  const r = await env.DB
    .prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?')
    .bind(id, userId).run();
  if (r.meta.changes === 0) return err('not found', 404);
  return json({ ok: true });
}

// ── D1: PUT /api/settings ────────────────────────────────────
async function putSettings(req, env, userId) {
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const ALLOWED_KEYS = new Set(['target','contrib','horizon','currency','pseudo','display_name','pfu','drip','fire_target']);
  const entries = Object.entries(body).filter(([k]) => ALLOWED_KEYS.has(k));
  if (!entries.length) return err('aucune clé valide');
  const stmts = entries.map(([key, value]) =>
    env.DB.prepare('INSERT OR REPLACE INTO user_settings (user_id,key,value) VALUES (?,?,?)').bind(userId, key, String(value).slice(0, 500))
  );
  await env.DB.batch(stmts);
  return json({ ok: true });
}

// ── R2: GET /api/backup ──────────────────────────────────────
async function getBackup(env, userId) {
  const syncRes = await getSync(env, userId);
  const data = await syncRes.json();
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const key  = `backup-${userId.slice(0, 8)}-${ts}.json`;
  const body = JSON.stringify(data, null, 2);
  if (env.BACKUPS) await env.BACKUPS.put(key, body, { httpMetadata: { contentType: 'application/json' } });
  return new Response(body, {
    headers: { ...CORS, 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${key}"` },
  });
}

// ── R2: POST /api/restore ────────────────────────────────────
async function postRestore(req, env, userId) {
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10);
  if (contentLength > 5_000_000) return err('Payload trop grand (max 5 Mo)', 413);
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { transactions = [], settings = {} } = body;
  if (!Array.isArray(transactions) || transactions.length > 10000) return err('Format invalide');
  const stmts = [
    env.DB.prepare('DELETE FROM transactions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(userId),
    ...transactions.map(tx =>
      env.DB.prepare(
        'INSERT INTO transactions (id,type,ticker,shares,price,amount,date,currency,created_at,user_id) VALUES (?,?,?,?,?,?,?,?,?,?)'
      ).bind(tx.id, tx.type, tx.ticker, tx.shares ?? null, tx.price ?? null, tx.amount ?? null,
             tx.date, tx.currency || 'USD', tx.created_at || Math.floor(Date.now() / 1000), userId)
    ),
    ...Object.entries(settings).map(([key, value]) =>
      env.DB.prepare('INSERT OR REPLACE INTO user_settings (user_id,key,value) VALUES (?,?,?)').bind(userId, key, String(value))
    ),
  ];
  await env.DB.batch(stmts);
  return json({ ok: true, restored: transactions.length });
}

// ── DELETE /api/account ─────────────────────────────────────
async function deleteAccount(env, userId) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM transactions WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_settings WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM portfolio_nav WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(userId),
  ]);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { ...CORS, 'Content-Type': 'application/json', 'Set-Cookie': 'session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' },
  });
}

// ── Debug fondamentaux : montre le cache KV + test live income/earnings ──
// GET /api/debug/funda?symbol=APD             → cache KV uniquement (inclut statut AV_KEY)
// GET /api/debug/funda?symbol=APD&live=1      → teste EN PLUS income-statement/earnings/balance/cash-flow
//                                                (diagnostic seulement — plus utilisés par le pipeline
//                                                réel depuis qu'on a confirmé leur 402 quasi systématique ;
//                                                utile pour vérifier si un ticker fait exception)
// GET /api/debug/funda?symbol=APD&avlive=1    → cache + test Alpha Vantage en direct (consomme 1 appel/jour du quota AV)
async function debugFunda(req, env) {
  if (!env.FMP_KEY) return err('FMP_KEY not configured', 500);
  const url    = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || 'JNJ').toUpperCase();
  const live   = url.searchParams.get('live') === '1';
  const avlive = url.searchParams.get('avlive') === '1';
  const out    = { symbol, kv_key: `funda9:${symbol}`, ts: new Date().toISOString() };

  // Statut de la clé secrète AV_KEY — jamais la valeur elle-même, juste présence/longueur.
  // Permet de vérifier si le secret ajouté via le dashboard Cloudflare est bien visible
  // par CE Worker (mauvais environnement, typo dans le nom, ou secret non propagé).
  out.av_key_set = !!env.AV_KEY;
  out.av_key_len = env.AV_KEY ? env.AV_KEY.length : 0;

  // Lecture cache KV
  if (env.PRICES_KV) {
    const cached = await env.PRICES_KV.get(`funda9:${symbol}`, { type: 'json' });
    out.kv_hit        = !!cached;
    out.kv_pe_cur     = cached?.pe_cur     ?? null;
    out.kv_payout     = cached?.payout_ratio ?? null;
    out.kv_fcf_payout = cached?.fcf_payout ?? null;
    out.kv_debt_ebitda= cached?.debt_ebitda ?? null;
    out.kv_interest   = cached?.interest_cov ?? null;
    out.kv_annual_div = cached?.annual_div ?? null;
    out.kv_streak     = cached?.streak     ?? null;
    out.kv_data       = cached;

    // Vérifier le cache Finnhub (fh9:SYMBOL) — fallback principal
    // (eps sert à calculer nous-mêmes le P/E = kv_pe_cur ; pas de pe_cur stocké ici)
    const fhCached = await env.PRICES_KV.get(`fh9:${symbol}`, { type: 'json' });
    out.fh9_hit     = !!fhCached;
    out.fh9_eps     = fhCached?.eps ?? null;
    out.fh9_payout  = fhCached?.payout_ratio ?? null;
    out.fh9_data    = fhCached;

    // Vérifier le cache AV (av9:SYMBOL) — pré-rempli par /api/debug/av-seed, fallback secondaire
    const avCached = await env.PRICES_KV.get(`av9:${symbol}`, { type: 'json' });
    out.av9_hit     = !!avCached;
    out.av9_eps     = avCached?.eps ?? null;
    out.av9_payout  = avCached?.payout_ratio ?? null;
    out.av9_data    = avCached;

    // Vérifier le cache Twelve Data (td9:SYMBOL) — fallback final
    const tdCached = await env.PRICES_KV.get(`td9:${symbol}`, { type: 'json' });
    out.td9_hit     = !!tdCached;
    out.td9_eps     = tdCached?.eps ?? null;
    out.td9_payout  = tdCached?.payout_ratio ?? null;
    out.td9_data    = tdCached;

    // Vérifier si funda9 serait traité comme incomplet → re-fetch déclenché
    out.funda9_incomplete = !!(cached && cached.pe_cur == null && cached.payout_ratio == null && cached.fcf_payout == null);

    // Aussi vérifier l'ancienne clé funda8 (données encore en cache ?)
    const oldCached = await env.PRICES_KV.get(`funda8:${symbol}`, { type: 'json' });
    out.funda8_hit    = !!oldCached;
    out.funda8_pe_cur = oldCached?.pe_cur ?? null;
  }

  // Test Alpha Vantage en direct (bypass le cache KV) — capture le statut HTTP et le
  // corps brut renvoyé par alphavantage.co pour voir exactement pourquoi PERatio manque
  // (clé invalide, quota "Note"/"Information" dépassé, symbole non supporté, etc.)
  if (avlive) {
    if (!env.AV_KEY) {
      out.av_live_error = 'AV_KEY not set on this Worker (env.AV_KEY is falsy)';
    } else {
      try {
        const avUrl = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${env.AV_KEY}`;
        const r = await fetch(avUrl, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
        out.av_live_status = r.status;
        const t = await r.text();
        // Alpha Vantage échoue parfois sa clé API en clair dans le message d'erreur
        // (ex: "We have detected your API key as XXXX...") — endpoint public, on la masque.
        const redact = s => env.AV_KEY ? s.split(env.AV_KEY).join('[REDACTED]') : s;
        out.av_live_raw = redact(t.slice(0, 800));
        try {
          const d = JSON.parse(t);
          out.av_live_has_symbol = !!d.Symbol;
          out.av_live_note       = redact(d.Information || d.Note || '') || null;
        } catch(_) { out.av_live_parse_error = true; }
      } catch(e) { out.av_live_error = e.message; }
    }
  }

  if (!live) return json(out);

  const base = 'https://financialmodelingprep.com/stable';
  const H    = { Accept: 'application/json' };

  // Test income-statement
  try {
    const r = await fetch(`${base}/income-statement?symbol=${symbol}&period=annual&limit=5&apikey=${env.FMP_KEY}`, { headers: H });
    out.inc_status = r.status;
    const t = await r.text();
    out.inc_raw = t.slice(0, 400);
    if (r.ok) {
      const d = JSON.parse(t);
      const arr = Array.isArray(d) ? d : (d ? [d] : []);
      out.inc_years = arr.length;
      out.inc_eps_y = arr.slice(0, 5).map(y => y?.epsDiluted ?? y?.eps ?? null);
      let posEps = null;
      for (const y of arr.slice(0, 5)) {
        const e = y?.epsDiluted || y?.eps || null;
        if (e && e > 0) { posEps = e; break; }
      }
      out.inc_eps_positive = posEps;
    }
  } catch(e) { out.inc_error = e.message; }

  // Test earnings (résultats trimestriels)
  try {
    const r = await fetch(`${base}/earnings?symbol=${symbol}&limit=8&apikey=${env.FMP_KEY}`, { headers: H });
    out.earn_status = r.status;
    const t = await r.text();
    out.earn_raw = t.slice(0, 600);
    if (r.ok) {
      const d = JSON.parse(t);
      const arr = Array.isArray(d) ? d : [];
      out.earn_count = arr.length;
      out.earn_keys  = arr.length > 0 ? Object.keys(arr[0]).slice(0, 20) : [];
      out.earn_q4    = arr.slice(0, 4).map(e => ({ date: e.date, actual: e.actualEarningResult, eps: e.eps }));
      const q4act = arr.filter(e => e.actualEarningResult != null && e.actualEarningResult !== '').slice(0, 4);
      if (q4act.length === 4) {
        const ttm = q4act.reduce((s, e) => s + (parseFloat(e.actualEarningResult) || 0), 0);
        out.earn_ttm_eps = +ttm.toFixed(4);
      }
    }
  } catch(e) { out.earn_error = e.message; }

  // Test balance-sheet
  try {
    const r = await fetch(`${base}/balance-sheet-statement?symbol=${symbol}&period=annual&limit=1&apikey=${env.FMP_KEY}`, { headers: H });
    out.bal_status = r.status;
    if (r.ok) {
      const d = await r.json();
      const b0 = Array.isArray(d) ? d[0] : d;
      out.bal_totalDebt = b0?.totalDebt ?? null;
      out.bal_shares    = b0?.commonStockSharesOutstanding ?? null;
    }
  } catch(e) { out.bal_error = e.message; }

  // Test cash-flow
  try {
    const r = await fetch(`${base}/cash-flow-statement?symbol=${symbol}&period=annual&limit=1&apikey=${env.FMP_KEY}`, { headers: H });
    out.cf_status = r.status;
    if (r.ok) {
      const d = await r.json();
      const c0 = Array.isArray(d) ? d[0] : d;
      out.cf_freeCashFlow  = c0?.freeCashFlow  ?? null;
      out.cf_dividendsPaid = c0?.dividendsPaid ?? null;
    }
  } catch(e) { out.cf_error = e.message; }

  return json(out);
}

// ── Debug AV seed : injecte les données mock Alpha Vantage dans KV ──
// GET /api/debug/av-seed            → seed tous les tickers
// GET /api/debug/av-seed?symbol=APD → seed un seul ticker
// Données mock AV OVERVIEW (juillet 2026) — utilisées pour tester sans consommer de quota AV
const AV_MOCK = {
  JNJ: { pe_cur:23.9,  payout_ratio:0.559, beta:0.53, market_cap:385000000000, eps:10.62, annual_div:4.96  },
  APD: { pe_cur:22.9,  payout_ratio:0.558, beta:0.75, market_cap:69927970463,  eps:13.05, annual_div:7.28  },
  ADP: { pe_cur:29.4,  payout_ratio:0.648, beta:0.77, market_cap:109000000000, eps:8.02,  annual_div:5.60  },
  UNM: { pe_cur:8.7,   payout_ratio:0.213, beta:0.99, market_cap:9800000000,   eps:10.53, annual_div:1.56  },
  MMM: { pe_cur:17.9,  payout_ratio:0.597, beta:0.84, market_cap:26000000000,  eps:8.93,  annual_div:2.80  },
  ACN: { pe_cur:27.8,  payout_ratio:0.398, beta:1.14, market_cap:164000000000, eps:4.72,  annual_div:5.28  },
  HRL: { pe_cur:21.6,  payout_ratio:0.702, beta:0.31, market_cap:8900000000,   eps:1.54,  annual_div:1.13  },
  O:   { pe_cur:42.1,  payout_ratio:0.742, beta:0.82, market_cap:51000000000,  eps:1.06,  annual_div:3.19  },
  T:   { pe_cur:18.3,  payout_ratio:0.401, beta:0.61, market_cap:127000000000, eps:0.97,  annual_div:1.11  },
  VZ:  { pe_cur:10.2,  payout_ratio:0.541, beta:0.38, market_cap:168000000000, eps:4.59,  annual_div:2.71  },
  PFE: { pe_cur:13.4,  payout_ratio:0.617, beta:0.61, market_cap:148000000000, eps:1.95,  annual_div:1.68  },
  KO:  { pe_cur:26.8,  payout_ratio:0.735, beta:0.57, market_cap:266000000000, eps:2.47,  annual_div:1.94  },
  PEP: { pe_cur:22.1,  payout_ratio:0.734, beta:0.52, market_cap:199000000000, eps:6.97,  annual_div:5.42  },
  MCD: { pe_cur:25.3,  payout_ratio:0.589, beta:0.73, market_cap:212000000000, eps:11.39, annual_div:7.08  },
  ABT: { pe_cur:33.1,  payout_ratio:0.533, beta:0.63, market_cap:191000000000, eps:3.32,  annual_div:2.20  },
  D:   { pe_cur:19.4,  payout_ratio:0.809, beta:0.41, market_cap:46000000000,  eps:2.85,  annual_div:2.67  },
  SO:  { pe_cur:20.7,  payout_ratio:0.741, beta:0.36, market_cap:88000000000,  eps:4.10,  annual_div:2.88  },
  NEE: { pe_cur:23.4,  payout_ratio:0.600, beta:0.52, market_cap:150000000000, eps:3.32,  annual_div:2.31  },
};
const AV_MOCK_TTL = 7 * 24 * 3600; // 7 jours (même TTL que le vrai cache AV)

// GET /api/debug/av-seed?action=clear            → supprime av9+funda9 mock pour tous les tickers connus
// GET /api/debug/av-seed?action=clear&symbol=APD  → supprime pour un seul ticker
async function debugAvSeed(req, env) {
  if (!env.PRICES_KV) return err('PRICES_KV not bound', 500);
  const url    = new URL(req.url);
  const only   = (url.searchParams.get('symbol') || '').toUpperCase() || null;
  const clear  = url.searchParams.get('action') === 'clear';
  const tickers = only ? [only] : Object.keys(AV_MOCK);

  if (clear) {
    const results = {};
    for (const t of tickers) {
      await env.PRICES_KV.delete(`av9:${t}`);
      await env.PRICES_KV.delete(`funda9:${t}`);
      results[t] = 'cleared';
    }
    return json({ cleared: results, count: tickers.length });
  }

  const results = {};
  for (const t of tickers) {
    const d = AV_MOCK[t];
    if (!d) { results[t] = 'unknown ticker'; continue; }
    await env.PRICES_KV.put(`av9:${t}`, JSON.stringify(d), { expirationTtl: AV_MOCK_TTL });
    results[t] = 'seeded';
  }
  return json({ seeded: results, count: tickers.length, ttl_days: 7 });
}

// ── Debug Finnhub : teste en direct /quote + /stock/metric?metric=all + /stock/profile2 ──
// GET /api/debug/finnhub?symbol=APD
// Nécessite le secret FINNHUB_KEY (wrangler secret put FINNHUB_KEY) — clé gratuite sur
// finnhub.io/register (60 appels/minute sur le plan gratuit, contre 25/JOUR pour AV).
// Endpoint volontairement "brut" (raw + toutes les clés) tant que la disponibilité réelle
// des champs EPS/P/E/payout sur le plan gratuit n'est pas confirmée pour ces tickers.
async function debugFinnhub(req, env) {
  const url    = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || 'JNJ').toUpperCase();
  const out    = { symbol, finnhub_key_set: !!env.FINNHUB_KEY, finnhub_key_len: env.FINNHUB_KEY ? env.FINNHUB_KEY.length : 0 };

  if (!env.FINNHUB_KEY) return json(out);

  const base = 'https://finnhub.io/api/v1';
  const H    = { Accept: 'application/json' };

  // /quote — prix courant (gratuit chez la plupart des fournisseurs)
  try {
    const r = await fetch(`${base}/quote?symbol=${symbol}&token=${env.FINNHUB_KEY}`, { headers: H });
    out.quote_status = r.status;
    const t = await r.text();
    out.quote_raw = t.slice(0, 400);
    if (r.ok) {
      const d = JSON.parse(t);
      out.quote_price  = d.c ?? null;   // current price
      out.quote_change = d.d ?? null;
      out.quote_pct    = d.dp ?? null;
    }
  } catch(e) { out.quote_error = e.message; }

  // /stock/metric?metric=all — P/E, EPS, payout, beta, etc. (le champ qu'on veut valider)
  try {
    const r = await fetch(`${base}/stock/metric?symbol=${symbol}&metric=all&token=${env.FINNHUB_KEY}`, { headers: H });
    out.metric_status = r.status;
    const t = await r.text();
    out.metric_raw = t.slice(0, 500);
    if (r.ok) {
      const d = JSON.parse(t);
      const m = d.metric || {};
      out.metric_keys_count = Object.keys(m).length;
      out.metric_pe_ttm         = m.peBasicExclExtraTTM ?? m.peExclExtraTTM ?? m.peInclExtraTTM ?? null;
      out.metric_eps_ttm        = m.epsBasicExclExtraItemsTTM ?? m.epsExclExtraItemsTTM ?? m.epsInclExtraItemsTTM ?? null;
      out.metric_payout_ratio   = m.payoutRatioTTM ?? m.payoutRatioAnnual ?? null;
      out.metric_dividend_yield = m.currentDividendYieldTTM ?? m.dividendYieldIndicatedAnnual ?? null;
      out.metric_beta           = m.beta ?? null;
      // Toutes les clés contenant "pe", "eps" ou "payout" — pour repérer le vrai nom si les guess ci-dessus ratent
      out.metric_matching_keys = Object.keys(m).filter(k => /pe|eps|payout/i.test(k));
    }
  } catch(e) { out.metric_error = e.message; }

  // /stock/profile2 — profil société (nom, secteur, market cap)
  try {
    const r = await fetch(`${base}/stock/profile2?symbol=${symbol}&token=${env.FINNHUB_KEY}`, { headers: H });
    out.profile_status = r.status;
    const t = await r.text();
    out.profile_raw = t.slice(0, 300);
    if (r.ok) {
      const d = JSON.parse(t);
      out.profile_name       = d.name ?? null;
      out.profile_sector     = d.finnhubIndustry ?? null;
      out.profile_market_cap = d.marketCapitalization ?? null;
    }
  } catch(e) { out.profile_error = e.message; }

  return json(out);
}

// ── Debug Twelve Data : teste en direct /quote (prix) + /statistics (fondamentaux) ──
// GET /api/debug/twelvedata?symbol=APD
// Nécessite le secret TWELVEDATA_KEY (wrangler secret put TWELVEDATA_KEY) — clé gratuite
// sur twelvedata.com. Endpoint volontairement "brut" tant que la disponibilité réelle
// des champs EPS/payout sur le plan gratuit n'est pas confirmée (voir debugFinnhub).
async function debugTwelveData(req, env) {
  const url    = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || 'JNJ').toUpperCase();
  const out    = { symbol, twelvedata_key_set: !!env.TWELVEDATA_KEY, twelvedata_key_len: env.TWELVEDATA_KEY ? env.TWELVEDATA_KEY.length : 0 };

  if (!env.TWELVEDATA_KEY) return json(out);

  const base = 'https://api.twelvedata.com';
  const H    = { Accept: 'application/json' };

  // /quote — prix, variation, 52 semaines
  try {
    const r = await fetch(`${base}/quote?symbol=${symbol}&apikey=${env.TWELVEDATA_KEY}`, { headers: H });
    out.quote_status = r.status;
    const t = await r.text();
    out.quote_raw = t.slice(0, 500);
    if (r.ok) {
      const d = JSON.parse(t);
      out.quote_is_error = d.status === 'error' || !!d.code;
      out.quote_price    = d.close ?? null;
      out.quote_name     = d.name  ?? null;
    }
  } catch(e) { out.quote_error = e.message; }

  // /statistics — EPS, payout, beta (souvent réservé aux plans payants ailleurs — à vérifier ici)
  try {
    const r = await fetch(`${base}/statistics?symbol=${symbol}&apikey=${env.TWELVEDATA_KEY}`, { headers: H });
    out.stats_status = r.status;
    const t = await r.text();
    out.stats_raw = t.slice(0, 800);
    if (r.ok) {
      const d = JSON.parse(t);
      out.stats_is_error = d.status === 'error' || !!d.code;
      const s = d.statistics || {};
      out.stats_top_keys           = Object.keys(s);
      out.stats_eps_diluted_ttm    = s.financials?.income_statement?.diluted_eps_ttm ?? null;
      out.stats_eps_basic_ttm      = s.financials?.income_statement?.basic_eps_ttm ?? null;
      out.stats_payout_ratio       = s.dividends_and_splits?.payout_ratio ?? null;
      out.stats_beta               = s.stock_statistics?.beta ?? null;
      out.stats_forward_annual_div = s.dividends_and_splits?.forward_annual_dividend_rate ?? null;
    }
  } catch(e) { out.stats_error = e.message; }

  return json(out);
}

// ── Debug prix (diagnostic mobile) ───────────────────────────
// Par défaut: vérifie KV uniquement (pas d'appel FMP — économise les crédits)
// Avec ?live=1 : teste aussi les endpoints FMP en direct
async function debugPrice(req, env) {
  const url    = new URL(req.url);
  const symbol = (url.searchParams.get('symbol') || 'JNJ').toUpperCase();
  const live   = url.searchParams.get('live') === '1';
  const out = { symbol, fmp_key_set: !!env.FMP_KEY, kv_bound: !!env.PRICES_KV, live_test: live };

  if (env.PRICES_KV) {
    try {
      const kv = await env.PRICES_KV.get(`p:${symbol}`, { type: 'json' });
      out.kv_cached      = kv ? { price: kv.regularMarketPrice, change: kv.regularMarketChange, name: kv.longName } : null;
      out.kv_has_price   = kv?.regularMarketPrice != null;
    } catch(e) { out.kv_error = e.message; }
  }

  out.prices_url = `https://${url.host}/api/prices?symbols=${symbol}`;
  out.hint = live ? 'Tests FMP en direct (consomme des crédits)' : 'Ajoutez &live=1 pour tester FMP en direct';

  if (live && env.FMP_KEY) {
    // Test 1: /stable/quote (endpoint principal, plan payant)
    try {
      const fmpUrl = `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${env.FMP_KEY}`;
      out.fmp_quote_url = fmpUrl.replace(env.FMP_KEY, '***');
      const res = await fetch(fmpUrl, { headers: { Accept: 'application/json' } });
      out.fmp_quote_status = res.status;
      const text = await res.text();
      out.fmp_quote_raw = text.slice(0, 200);
      if (res.ok) {
        const data = JSON.parse(text);
        if (Array.isArray(data) && data[0]) out.fmp_quote_price = data[0].price;
      }
    } catch(e) { out.fmp_quote_error = e.message; }

    // Test 2: /stable/profile (fallback gratuit FMP)
    try {
      const profUrl = `https://financialmodelingprep.com/stable/profile?symbol=${symbol}&apikey=${env.FMP_KEY}`;
      out.fmp_profile_url = profUrl.replace(env.FMP_KEY, '***');
      const pr = await fetch(profUrl, { headers: { Accept: 'application/json' } });
      out.fmp_profile_status = pr.status;
      const pt = await pr.text();
      out.fmp_profile_raw = pt.slice(0, 300);
      if (pr.ok) {
        const pd = JSON.parse(pt);
        const p0 = Array.isArray(pd) ? pd[0] : pd;
        out.fmp_profile_price         = p0?.price          ?? null;
        out.fmp_profile_changes       = p0?.changes         ?? null;
        out.fmp_profile_company       = p0?.companyName     ?? null;
        out.fmp_profile_dividendYield = p0?.dividendYield   ?? null;
        out.fmp_profile_lastDiv       = p0?.lastDiv         ?? null;
        out.fmp_profile_pe            = p0?.pe              ?? null;
        out.fmp_profile_sector        = p0?.sector          ?? null;
        // Log ALL keys so we can discover available fields
        out.fmp_profile_keys          = Object.keys(p0 || {});
      }
    } catch(e) { out.fmp_profile_error = e.message; }

    // Test 3: /stable/key-metrics-ttm (source actuelle du P/E)
    try {
      const kmUrl = `https://financialmodelingprep.com/stable/key-metrics-ttm?symbol=${symbol}&apikey=${env.FMP_KEY}`;
      const kmRes = await fetch(kmUrl, { headers: { Accept: 'application/json' } });
      out.fmp_metrics_status = kmRes.status;
      const kmText = await kmRes.text();
      out.fmp_metrics_raw = kmText.slice(0, 300);
      if (kmRes.ok) {
        const kmData = JSON.parse(kmText);
        const m0 = Array.isArray(kmData) ? kmData[0] : kmData;
        out.fmp_metrics_peRatioTTM    = m0?.peRatioTTM    ?? null;
        out.fmp_metrics_payoutRatioTTM = m0?.payoutRatioTTM ?? null;
        out.fmp_metrics_keys          = Object.keys(m0 || {}).slice(0, 20);
      }
    } catch(e) { out.fmp_metrics_error = e.message; }

    // Test 4: /stable/ratios-ttm (fallback PE via priceEarningsRatioTTM)
    try {
      const ratUrl = `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${symbol}&apikey=${env.FMP_KEY}`;
      const ratRes = await fetch(ratUrl, { headers: { Accept: 'application/json' } });
      out.fmp_ratios_status = ratRes.status;
      const ratText = await ratRes.text();
      out.fmp_ratios_raw = ratText.slice(0, 300);
      if (ratRes.ok) {
        const ratData = JSON.parse(ratText);
        const r0 = Array.isArray(ratData) ? ratData[0] : ratData;
        out.fmp_ratios_pe             = r0?.priceEarningsRatioTTM ?? r0?.peRatioTTM ?? null;
        out.fmp_ratios_payoutRatio    = r0?.dividendPayoutRatioTTM ?? null;
        out.fmp_ratios_keys           = Object.keys(r0 || {}).slice(0, 20);
      }
    } catch(e) { out.fmp_ratios_error = e.message; }

    // Test 5: v3 /api/v3/quote (ancien endpoint, souvent gratuit, inclut pe)
    try {
      const v3qUrl = `https://financialmodelingprep.com/api/v3/quote/${symbol}?apikey=${env.FMP_KEY}`;
      const v3qRes = await fetch(v3qUrl, { headers: { Accept: 'application/json' } });
      out.fmp_v3quote_status = v3qRes.status;
      const v3qText = await v3qRes.text();
      out.fmp_v3quote_raw = v3qText.slice(0, 300);
      if (v3qRes.ok) {
        const v3qData = JSON.parse(v3qText);
        const q0 = Array.isArray(v3qData) ? v3qData[0] : v3qData;
        out.fmp_v3quote_pe            = q0?.pe            ?? null;
        out.fmp_v3quote_eps           = q0?.eps           ?? null;
        out.fmp_v3quote_price         = q0?.price         ?? null;
        out.fmp_v3quote_keys          = Object.keys(q0 || {}).slice(0, 20);
      }
    } catch(e) { out.fmp_v3quote_error = e.message; }

    // Test 6: v3 /api/v3/profile (ancien profil, peut inclure pe)
    try {
      const v3pUrl = `https://financialmodelingprep.com/api/v3/profile/${symbol}?apikey=${env.FMP_KEY}`;
      const v3pRes = await fetch(v3pUrl, { headers: { Accept: 'application/json' } });
      out.fmp_v3profile_status = v3pRes.status;
      const v3pText = await v3pRes.text();
      out.fmp_v3profile_raw = v3pText.slice(0, 300);
      if (v3pRes.ok) {
        const v3pData = JSON.parse(v3pText);
        const p0 = Array.isArray(v3pData) ? v3pData[0] : v3pData;
        out.fmp_v3profile_pe          = p0?.pe            ?? null;
        out.fmp_v3profile_beta        = p0?.beta          ?? null;
        out.fmp_v3profile_mktCap      = p0?.mktCap        ?? null;
        out.fmp_v3profile_lastDiv     = p0?.lastDiv       ?? null;
        out.fmp_v3profile_keys        = Object.keys(p0 || {}).slice(0, 25);
      }
    } catch(e) { out.fmp_v3profile_error = e.message; }

    // Test 7: /stable/income-statement (EPS, payout, EBITDA, intérêts)
    try {
      const incUrl = `https://financialmodelingprep.com/stable/income-statement?symbol=${symbol}&period=annual&limit=5&apikey=${env.FMP_KEY}`;
      out.fmp_income_url = incUrl.replace(env.FMP_KEY, '***');
      const incRes = await fetch(incUrl, { headers: { Accept: 'application/json' } });
      out.fmp_income_status = incRes.status;
      const incText = await incRes.text();
      out.fmp_income_raw = incText.slice(0, 400);
      if (incRes.ok) {
        const incData = JSON.parse(incText);
        const incArr2 = Array.isArray(incData) ? incData : (incData ? [incData] : []);
        const i0 = incArr2[0] || {};
        // Cherche le premier EPS positif (identique à normalizeFunda)
        let firstPosEps = null;
        for (const yr of incArr2.slice(0, 5)) {
          const e = yr?.epsDiluted || yr?.eps || null;
          if (e && e > 0) { firstPosEps = e; break; }
        }
        out.fmp_income_years         = incArr2.length;
        out.fmp_income_eps_y0        = i0?.epsDiluted       ?? i0?.eps           ?? null;
        out.fmp_income_eps_positive  = firstPosEps;
        out.fmp_income_netIncome     = i0?.netIncome        ?? null;
        out.fmp_income_ebitda        = i0?.ebitda           ?? null;
        out.fmp_income_ebit          = i0?.operatingIncome  ?? null;
        out.fmp_income_interestExp   = i0?.interestExpense  ?? null;
        out.fmp_income_keys          = Object.keys(i0 || {}).slice(0, 30);
      }
    } catch(e) { out.fmp_income_error = e.message; }

    // Test 8: /stable/balance-sheet-statement (dette totale)
    try {
      const balUrl = `https://financialmodelingprep.com/stable/balance-sheet-statement?symbol=${symbol}&period=annual&limit=1&apikey=${env.FMP_KEY}`;
      out.fmp_balance_url = balUrl.replace(env.FMP_KEY, '***');
      const balRes = await fetch(balUrl, { headers: { Accept: 'application/json' } });
      out.fmp_balance_status = balRes.status;
      const balText = await balRes.text();
      out.fmp_balance_raw = balText.slice(0, 400);
      if (balRes.ok) {
        const balData = JSON.parse(balText);
        const b0 = Array.isArray(balData) ? balData[0] : balData;
        out.fmp_balance_totalDebt    = b0?.totalDebt       ?? null;
        out.fmp_balance_longTerm     = b0?.longTermDebt    ?? null;
        out.fmp_balance_shortTerm    = b0?.shortTermDebt   ?? null;
        out.fmp_balance_keys         = Object.keys(b0 || {}).slice(0, 30);
      }
    } catch(e) { out.fmp_balance_error = e.message; }

    // Test 9: /stable/cash-flow-statement (FCF, dividendes versés)
    try {
      const cfUrl = `https://financialmodelingprep.com/stable/cash-flow-statement?symbol=${symbol}&period=annual&limit=1&apikey=${env.FMP_KEY}`;
      out.fmp_cashflow_url = cfUrl.replace(env.FMP_KEY, '***');
      const cfRes = await fetch(cfUrl, { headers: { Accept: 'application/json' } });
      out.fmp_cashflow_status = cfRes.status;
      const cfText = await cfRes.text();
      out.fmp_cashflow_raw = cfText.slice(0, 400);
      if (cfRes.ok) {
        const cfData = JSON.parse(cfText);
        const c0 = Array.isArray(cfData) ? cfData[0] : cfData;
        out.fmp_cashflow_operatingCF   = c0?.operatingCashFlow  ?? null;
        out.fmp_cashflow_capex         = c0?.capitalExpenditure  ?? null;
        out.fmp_cashflow_freeCashFlow  = c0?.freeCashFlow        ?? null;
        out.fmp_cashflow_dividendsPaid = c0?.dividendsPaid       ?? null;
        out.fmp_cashflow_keys          = Object.keys(c0 || {}).slice(0, 30);
      }
    } catch(e) { out.fmp_cashflow_error = e.message; }

    // Test 10: /stable/earnings (résultats trimestriels — BPA TTM)
    try {
      const earnUrl = `https://financialmodelingprep.com/stable/earnings?symbol=${symbol}&limit=8&apikey=${env.FMP_KEY}`;
      out.fmp_earnings_url = earnUrl.replace(env.FMP_KEY, '***');
      const earnRes = await fetch(earnUrl, { headers: { Accept: 'application/json' } });
      out.fmp_earnings_status = earnRes.status;
      const earnText = await earnRes.text();
      out.fmp_earnings_raw = earnText.slice(0, 600);
      if (earnRes.ok) {
        const earnData = JSON.parse(earnText);
        const earnArr = Array.isArray(earnData) ? earnData : [];
        out.fmp_earnings_count = earnArr.length;
        out.fmp_earnings_keys  = earnArr.length > 0 ? Object.keys(earnArr[0]).slice(0, 20) : [];
        out.fmp_earnings_q4    = earnArr.slice(0, 4).map(e => ({ date: e.date, actual: e.actualEarningResult, eps: e.eps }));
        const q4act = earnArr.filter(e => e.actualEarningResult != null && e.actualEarningResult !== '').slice(0, 4);
        if (q4act.length === 4) {
          const ttm = q4act.reduce((s, e) => s + (parseFloat(e.actualEarningResult) || 0), 0);
          out.fmp_earnings_ttm_eps = +ttm.toFixed(4);
        }
      }
    } catch(e) { out.fmp_earnings_error = e.message; }
  }

  return json(out);
}

// ── Actualités : lecture KV uniquement (peuplé par le cron à 22h30) ──
// Zéro appel FMP côté utilisateur.
async function newsProxy(req, env) {
  const url = new URL(req.url);
  const tickers = (url.searchParams.get('tickers') || '')
    .split(',').map(t => t.trim().toUpperCase()).filter(Boolean);

  if (!env.PRICES_KV) return json({ articles: [] });

  const pool = await env.PRICES_KV.get('news:all', { type: 'json' });
  if (!pool) return json({ articles: [], pending: true });

  const articles = tickers.length
    ? pool.articles.filter(a => tickers.includes(a.symbol))
    : pool.articles;

  return json({ articles, cachedAt: pool.cachedAt });
}

// ── Historique prix par ticker (D1 + fallback FMP) ───────────
async function priceHistoryProxy(req, env) {
  const url = new URL(req.url);
  const tickers = (url.searchParams.get('tickers') || '')
    .split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 30);
  const days = Math.min(parseInt(url.searchParams.get('days') || '365', 10), 730);
  if (!tickers.length || !env.DB) return json({ prices: {} });

  const placeholders = tickers.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT date, ticker, price FROM ticker_prices
     WHERE ticker IN (${placeholders})
     AND date >= date('now', '-${days} days')
     ORDER BY date ASC`
  ).bind(...tickers).all();

  const prices = {};
  for (const row of results) {
    if (!prices[row.ticker]) prices[row.ticker] = [];
    prices[row.ticker].push({ date: row.date, price: row.price });
  }

  // FMP fallback for tickers with < 30 D1 data points (new users / first day)
  if (env.FMP_KEY && env.PRICES_KV) {
    const fromDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
    await Promise.all(tickers.map(async ticker => {
      if ((prices[ticker] || []).length >= 30) return;
      const kvKey = `hist:${ticker}`;
      const cached = await env.PRICES_KV.get(kvKey);
      if (cached) {
        try { prices[ticker] = JSON.parse(cached).filter(p => p.date >= fromDate); return; } catch (_) {}
      }
      try {
        const fmpUrl = `https://financialmodelingprep.com/stable/historical-price-eod/full?symbol=${encodeURIComponent(ticker)}&from=${fromDate}&apikey=${env.FMP_KEY}`;
        const r = await fetch(fmpUrl, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
        if (!r.ok) return;
        const data = await r.json();
        const hist = Array.isArray(data.historical) ? data.historical : (Array.isArray(data) ? data : []);
        // FMP returns newest-first; reverse to chronological
        const pts = hist.map(h => ({ date: h.date, price: h.close })).reverse();
        if (pts.length > 0) {
          await env.PRICES_KV.put(kvKey, JSON.stringify(pts), { expirationTtl: 86400 });
          prices[ticker] = pts.filter(p => p.date >= fromDate);
        }
      } catch (_) {}
    }));
  }

  return json({ prices });
}

// ── Router ───────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    const { method } = req;
    const url  = new URL(req.url);
    const path = url.pathname;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // Routes publiques (prix / fondamentaux / news)
    if (path === '/api/prices')          return priceProxy(req, env);
    if (path === '/api/funda')           return fmpProxy(req, env);
    if (path === '/api/search')          return searchProxy(req, env);
    if (path === '/api/benchmark')       return benchmarkProxy(req, env);
    if (path === '/api/push/vapid-key' && method === 'GET') return getPushVapidKey(env);
    if (path === '/api/news')            return newsProxy(req, env);
    if (path === '/api/prices/history')  return priceHistoryProxy(req, env);
    if (path === '/api/debug/price')     return debugPrice(req, env);
    if (path === '/api/debug/funda')     return debugFunda(req, env);
    if (path === '/api/debug/av-seed')   return debugAvSeed(req, env);
    if (path === '/api/debug/finnhub')   return debugFinnhub(req, env);
    if (path === '/api/debug/twelvedata') return debugTwelveData(req, env);

    // Routes auth
    if (path === '/auth/login')       return handleAuthLogin(req, env);
    if (path === '/auth/callback')    return handleAuthCallback(req, env);
    if (path === '/auth/logout')      return handleAuthLogout(req);
    if (path === '/auth/me')          return handleAuthMe(req, env);
    if (path === '/auth/register'  && method === 'POST') return handleAuthRegister(req, env);
    if (path === '/auth/login/email' && method === 'POST') return handleAuthLoginEmail(req, env);
    if (path === '/auth/refresh'   && method === 'POST') return handleAuthRefresh(req, env);

    // Routes protégées
    if (path.startsWith('/api/')) {
      if (env.DB) await ensureMigrations(env.DB);
      const user = await getUser(req, env);
      if (!user) return new Response('Unauthorized', { status: 401, headers: CORS });
      const uid = user.sub;

      if (path === '/api/sync'        && method === 'GET')  return getSync(env, uid);
      if (path === '/api/nav'         && method === 'GET')  return getNav(env, uid);
      if (path === '/api/transaction' && method === 'POST') return postTransaction(req, env, uid);
      if (path === '/api/settings'    && method === 'PUT')  return putSettings(req, env, uid);
      if (path === '/api/backup'      && method === 'GET')  return getBackup(env, uid);
      if (path === '/api/restore'     && method === 'POST') return postRestore(req, env, uid);
      if (path.startsWith('/api/transaction/') && method === 'DELETE')
        return deleteTransaction(path, env, uid);
      if (path === '/api/account' && method === 'DELETE')
        return deleteAccount(env, uid);
      if (path === '/api/push/subscribe'   && method === 'POST') return postPushSubscribe(req, env, uid);
      if (path === '/api/push/unsubscribe' && method === 'POST') return postPushUnsubscribe(req, env, uid);

      return err('route not found', 404);
    }

    // Frontend statique (Vite build)
    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(req);
      if (asset.status !== 404) {
        // index.html ne doit jamais être mis en cache → le navigateur charge toujours le dernier bundle
        if (path === '/' || path === '/index.html') {
          const h = new Headers(asset.headers);
          h.set('Cache-Control', 'no-store, no-cache, must-revalidate');
          h.set('Pragma', 'no-cache');
          _addSecurityHeaders(h);
          return new Response(asset.body, { status: asset.status, headers: h });
        }
        // Assets Vite avec hash de contenu → cache immuable 1 an (Brotli géré par Cloudflare)
        if (/\/assets\/[^/]+-[a-zA-Z0-9_-]{8,}\.(js|css|woff2?|ttf|svg|png|webp)$/.test(path)) {
          const h = new Headers(asset.headers);
          h.set('Cache-Control', 'public, max-age=31536000, immutable');
          return new Response(asset.body, { status: asset.status, headers: h });
        }
        return asset;
      }
      // SPA fallback: sert index.html pour toutes les routes frontend
      const fb = await env.ASSETS.fetch(new Request(`${url.origin}/index.html`, { headers: req.headers }));
      const h = new Headers(fb.headers);
      h.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      h.set('Pragma', 'no-cache');
      _addSecurityHeaders(h);
      return new Response(fb.body, { status: fb.status, headers: h });
    }

    return new Response('DividendKill API', { status: 200, headers: CORS });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
};
