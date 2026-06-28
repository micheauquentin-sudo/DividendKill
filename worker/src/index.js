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
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { email, password, name } = body;
  if (!email || !password) return err('Email et mot de passe requis');
  if (password.length < 8)  return err('Mot de passe trop court (8 caractères min.)');

  if (env.DB) await ensureMigrations(env.DB);
  const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (existing) return err('Cette adresse email est déjà utilisée', 409);

  const userId = crypto.randomUUID();
  const pwHash = await hashPassword(password);
  const displayName = (name || '').trim() || email.split('@')[0];
  await env.DB.prepare('INSERT INTO users (id,email,pw_hash,name) VALUES (?,?,?,?)').bind(userId, email.toLowerCase(), pwHash, displayName).run();

  const session = await signJWT({ sub: userId, email: email.toLowerCase(), name: displayName, exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 }, env.SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true }), {
    status: 201,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': mkCookie('dk_session', session, 30 * 24 * 3600) },
  });
}

// ── Auth: connexion email/mot de passe ───────────────────────
async function handleAuthLoginEmail(req, env) {
  if (!env.SESSION_SECRET) return err('Auth non configurée', 500);
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { email, password } = body;
  if (!email || !password) return err('Email et mot de passe requis');

  if (env.DB) await ensureMigrations(env.DB);
  const user = await env.DB.prepare('SELECT id,pw_hash,name FROM users WHERE email = ?').bind(email.toLowerCase()).first();
  if (!user || !(await verifyPassword(password, user.pw_hash))) {
    return err('Email ou mot de passe incorrect', 401);
  }

  const session = await signJWT({ sub: user.id, email: email.toLowerCase(), name: user.name || email.split('@')[0], exp: Math.floor(Date.now() / 1000) + 30 * 24 * 3600 }, env.SESSION_SECRET);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': mkCookie('dk_session', session, 30 * 24 * 3600) },
  });
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

  // Vérification state CSRF
  const stTok = getCookie(req, 'dk_oauth_state');
  if (stTok && env.SESSION_SECRET) {
    try {
      const p = await verifyJWT(stTok, env.SESSION_SECRET);
      if (p.state !== state) return Response.redirect(`${origin}/?auth_error=state`, 302);
    } catch(_) {
      return Response.redirect(`${origin}/?auth_error=state`, 302);
    }
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

  // Crée le cookie de session (30 jours)
  const session = await signJWT({
    sub:   userId,
    email,
    name,
    exp:   Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
  }, env.SESSION_SECRET);

  const headers = new Headers({ 'Location': `${origin}/` });
  headers.append('Set-Cookie', mkCookie('dk_session', session, 30 * 24 * 3600));
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
  return {
    symbol:                     q.symbol,
    regularMarketPrice:         q.price                                  || null,
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

// ── Prix FMP avec cache KV ───────────────────────────────────
async function priceProxy(req, env) {
  const symbols = new URL(req.url).searchParams.get('symbols');
  if (!symbols)     return err('missing symbols');
  if (!env.FMP_KEY) return err('FMP_KEY not configured', 500);

  const tickers = symbols.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const cached  = {};
  const missing = [];

  if (env.PRICES_KV) {
    await Promise.all(tickers.map(async t => {
      const val = await env.PRICES_KV.get(`p:${t}`, { type: 'json' });
      // Ignore KV entries with null price — force re-fetch from FMP
      if (val && val.regularMarketPrice != null) cached[t] = val;
      else missing.push(t);
    }));
  } else {
    missing.push(...tickers);
  }

  if (missing.length > 0) {
    try {
      const fmpUrl = `https://financialmodelingprep.com/stable/quote?symbol=${encodeURIComponent(missing.join(','))}&apikey=${env.FMP_KEY}`;
      const res = await fetch(fmpUrl, { headers: { Accept: 'application/json', 'User-Agent': 'DividendKill/1.0' } });
      if (!res.ok) {
        let e = `FMP HTTP ${res.status}`;
        try { const b = await res.json(); e = b?.['Error Message'] || b?.message || e; } catch(_) {}
        console.error('[price] FMP error:', e);
        if (!Object.keys(cached).length) return err(e, 502);
      } else {
        const data = await res.json();
        if (!Array.isArray(data)) {
          const msg = data?.['Error Message'] || data?.message || 'FMP: réponse inattendue';
          const isQ = msg.toLowerCase().includes('limit') || msg.toLowerCase().includes('upgrade');
          if (!Object.keys(cached).length) return err(isQ ? 'FMP_QUOTA' : msg, isQ ? 429 : 502);
        } else {
          await Promise.all(data.map(async q => {
            const n = normalizeFmpQuote(q);
            cached[q.symbol] = n;
            if (env.PRICES_KV) await env.PRICES_KV.put(`p:${q.symbol}`, JSON.stringify(n), { expirationTtl: 86400 });
          }));
        }
      }
    } catch(e) {
      if (!Object.keys(cached).length) return err(`FMP: ${e.message}`, 502);
    }
  }

  const results = tickers.map(t => cached[t]).filter(Boolean);
  if (!results.length) return err('FMP: aucun résultat', 502);
  return json({ quoteResponse: { result: results, error: null } });
}

// ── Fondamentaux FMP avec cache KV 24h ───────────────────────
async function fmpProxy(req, env) {
  const symbol = new URL(req.url).searchParams.get('symbol');
  if (!symbol)      return err('missing symbol');
  if (!env.FMP_KEY) return err('FMP_KEY not configured', 500);

  const cacheKey = `funda:${symbol.toUpperCase()}`;
  if (env.PRICES_KV) {
    const cached = await env.PRICES_KV.get(cacheKey, { type: 'json' });
    if (cached) return json(cached);
  }

  const base = 'https://financialmodelingprep.com/stable';
  try {
    const safeJson = async r => {
      if (!r.ok) throw new Error(`FMP HTTP ${r.status}`);
      const text = await r.text();
      try { return JSON.parse(text); } catch(_) { throw new Error('FMP réponse non-JSON'); }
    };
    const [profile, metrics] = await Promise.all([
      fetch(`${base}/profile?symbol=${symbol}&apikey=${env.FMP_KEY}`).then(safeJson),
      fetch(`${base}/key-metrics-ttm?symbol=${symbol}&apikey=${env.FMP_KEY}`).then(safeJson),
    ]);
    const result = { profile, metrics };
    if (env.PRICES_KV) await env.PRICES_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: ttlFunda() });
    return json(result);
  } catch(e) {
    return err(`FMP fondamentaux: ${e.message}`, 502);
  }
}

async function searchProxy(req, env) {
  const q = new URL(req.url).searchParams.get('q') || '';
  if (!q || q.length < 2) return json({ results: [] });
  if (!env.FMP_KEY) return json({ error: 'FMP_KEY not configured' }, 500);
  try {
    const url = `https://financialmodelingprep.com/stable/search?query=${encodeURIComponent(q)}&limit=10&apikey=${env.FMP_KEY}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`FMP HTTP ${res.status}`);
    const data = await res.json();
    const results = (Array.isArray(data) ? data : [])
      .filter(r => r.exchangeShortName && ['NYSE','NASDAQ','AMEX','TSX','LSE','EURONEXT','XETRA'].includes(r.exchangeShortName))
      .slice(0, 8);
    return json({ results });
  } catch(e) {
    return json({ error: e.message }, 502);
  }
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
      const [profile, metrics] = await Promise.all([
        fetch(`${FMP_BASE}/profile?symbol=${symbol}&apikey=${env.FMP_KEY}`, { headers: HEADERS }).then(r => r.json()),
        fetch(`${FMP_BASE}/key-metrics-ttm?symbol=${symbol}&apikey=${env.FMP_KEY}`, { headers: HEADERS }).then(r => r.json()),
      ]);
      await env.PRICES_KV.put(`funda:${symbol}`, JSON.stringify({ profile, metrics }), { expirationTtl: ttlFunda() });
      console.log(`[Cron] funda:${symbol} mis à jour — ${reason}`);
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

    // ── Appel 1 : prix de tous les tickers (batch) ───────────
    const priceRes = await fetch(
      `${FMP_BASE}/quote?symbol=${encodeURIComponent(tickers.join(','))}&apikey=${env.FMP_KEY}`,
      { headers: HEADERS }
    );
    if (!priceRes.ok) { console.warn('[Cron] FMP prix HTTP', priceRes.status); return; }
    const priceData = await priceRes.json();
    if (!Array.isArray(priceData)) { console.warn('[Cron] Réponse prix inattendue'); return; }
    const toStore = priceData.map(normalizeFmpQuote).filter(q => q.regularMarketPrice != null);

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
                  console.log(`[Cron] Nouvelle déclaration dividende ${sym}: ${d.dividend} (déclaré ${d.declarationDate}, paiement ${d.paymentDate})`);
                }
              })
          );
        }
      }
    } catch(e) { console.warn('[Cron] calendrier dividendes:', e.message); }

    // ── Mise à jour prix + fondamentaux (lots de 5) ───────────
    let divChanged = 0, declUpdated = 0, fundaInit = 0;
    for (let i = 0; i < toStore.length; i += 5) {
      await Promise.all(toStore.slice(i, i + 5).map(async q => {
        const [old, fundaRaw] = await Promise.all([
          env.PRICES_KV.get(`p:${q.symbol}`, { type: 'json' }),
          env.PRICES_KV.get(`funda:${q.symbol}`),
        ]);

        const lastDivChg = old?.lastDiv != null && q.lastDiv != null && old.lastDiv !== q.lastDiv;
        const declChg    = declaredChanges.has(q.symbol);

        if (!fundaRaw)      { if (await refreshFunda(q.symbol, 'init'))          fundaInit++;    }
        else if (lastDivChg){ if (await refreshFunda(q.symbol, `lastDiv ${old.lastDiv}→${q.lastDiv}`)) divChanged++; }
        else if (declChg)   { if (await refreshFunda(q.symbol, 'déclaration anticipée')) declUpdated++; }

        await env.PRICES_KV.put(`p:${q.symbol}`, JSON.stringify(q), { expirationTtl: TTL_PRICE });
      }));
    }

    console.log(`[Cron] ${toStore.length} prix · ${fundaInit} inits · ${divChanged} versements changés · ${declUpdated} déclarations anticipées`);
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
    const gs = await env.DB.prepare('SELECT key, value FROM settings').all();
    settings = Object.fromEntries(gs.results.map(r => [r.key, r.value]));
  }
  return json({ transactions: txRes.results, settings });
}

// ── D1: POST /api/transaction ────────────────────────────────
async function postTransaction(req, env, userId) {
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { type, ticker, shares, price, amount, date, currency = 'USD' } = body;
  if (!type)   return err('type required');
  if (!ticker) return err('ticker required');
  if (!date)   return err('date required');

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
  const stmts = Object.entries(body).map(([key, value]) =>
    env.DB.prepare('INSERT OR REPLACE INTO user_settings (user_id,key,value) VALUES (?,?,?)').bind(userId, key, String(value))
  );
  if (!stmts.length) return err('empty body');
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
  let body;
  try { body = await req.json(); } catch { return err('invalid JSON'); }
  const { transactions = [], settings = {} } = body;
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

// ── Debug prix (diagnostic mobile) ───────────────────────────
async function debugPrice(req, env) {
  const symbol = (new URL(req.url).searchParams.get('symbol') || 'JNJ').toUpperCase();
  const out = { symbol, fmp_key_set: !!env.FMP_KEY, kv_bound: !!env.PRICES_KV };

  if (env.PRICES_KV) {
    try {
      const kv = await env.PRICES_KV.get(`p:${symbol}`, { type: 'json' });
      out.kv_cached = kv;
    } catch(e) { out.kv_error = e.message; }
  }

  out.price_test_url = `https://${new URL(req.url).host}/?symbols=${symbol}`;

  if (env.FMP_KEY) {
    const fmpUrl = `https://financialmodelingprep.com/stable/quote?symbol=${symbol}&apikey=${env.FMP_KEY}`;
    out.fmp_url = fmpUrl.replace(env.FMP_KEY, '***');
    try {
      const res = await fetch(fmpUrl, { headers: { Accept: 'application/json' } });
      out.fmp_status = res.status;
      const text = await res.text();
      out.fmp_raw_first200 = text.slice(0, 200);
      try {
        const data = JSON.parse(text);
        out.fmp_is_array = Array.isArray(data);
        out.fmp_count = Array.isArray(data) ? data.length : null;
        if (Array.isArray(data) && data.length > 0) {
          out.fmp_first = data[0];
          out.normalized = normalizeFmpQuote(data[0]);
        }
      } catch(e) { out.fmp_parse_error = e.message; }
    } catch(e) { out.fmp_fetch_error = e.message; }
  }

  return json(out);
}

// ── Router ───────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    const { method } = req;
    const url  = new URL(req.url);
    const path = url.pathname;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    // Routes publiques (prix / fondamentaux)
    if (path === '/api/prices')      return priceProxy(req, env);
    if (path === '/api/funda')       return fmpProxy(req, env);
    if (path === '/api/search')      return searchProxy(req, env);
    if (path === '/api/debug/price') return debugPrice(req, env);

    // Routes auth
    if (path === '/auth/login')       return handleAuthLogin(req, env);
    if (path === '/auth/callback')    return handleAuthCallback(req, env);
    if (path === '/auth/logout')      return handleAuthLogout(req);
    if (path === '/auth/me')          return handleAuthMe(req, env);
    if (path === '/auth/register'  && method === 'POST') return handleAuthRegister(req, env);
    if (path === '/auth/login/email' && method === 'POST') return handleAuthLoginEmail(req, env);

    // Routes protégées
    if (path.startsWith('/api/')) {
      if (env.DB) await ensureMigrations(env.DB);
      const user = await getUser(req, env);
      if (!user) return new Response('Unauthorized', { status: 401, headers: CORS });
      const uid = user.sub;

      if (path === '/api/sync'        && method === 'GET')  return getSync(env, uid);
      if (path === '/api/transaction' && method === 'POST') return postTransaction(req, env, uid);
      if (path === '/api/settings'    && method === 'PUT')  return putSettings(req, env, uid);
      if (path === '/api/backup'      && method === 'GET')  return getBackup(env, uid);
      if (path === '/api/restore'     && method === 'POST') return postRestore(req, env, uid);
      if (path.startsWith('/api/transaction/') && method === 'DELETE')
        return deleteTransaction(path, env, uid);

      return err('route not found', 404);
    }

    // Frontend statique (Vite build)
    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(req);
      if (asset.status !== 404) return asset;
      // SPA fallback: sert index.html pour toutes les routes frontend
      return env.ASSETS.fetch(new Request(`${url.origin}/index.html`, { headers: req.headers }));
    }

    return new Response('DividendKill API', { status: 200, headers: CORS });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
};
