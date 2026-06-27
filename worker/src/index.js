/**
 * DividendKill — Cloudflare Worker API
 *
 * Routes (no auth):
 *   GET  /?symbols=JNJ,MMM        → proxy Twelve Data prices
 *   GET  /?fmp=all&symbol=JNJ     → proxy FMP fundamentals
 *
 * Routes (Bearer auth required):
 *   GET    /api/sync              → toutes les transactions + settings
 *   POST   /api/transaction       → ajouter une transaction
 *   DELETE /api/transaction/:id   → supprimer une transaction
 *   PUT    /api/settings          → mettre à jour les settings
 *   GET    /api/backup            → export JSON → R2 + téléchargement
 *   POST   /api/restore           → restaurer depuis un JSON de backup
 *
 * Env vars (secrets via `wrangler secret put`):
 *   PORTFOLIO_TOKEN  — Bearer token pour toutes les routes /api/*
 *   FMP_KEY          — clé API Financial Modeling Prep
 *   TD_KEY           — clé API Twelve Data (twelvedata.com)
 */

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

const err = (msg, status = 400) => json({ error: msg }, status);

// ── Auth ─────────────────────────────────────────────────────
function checkAuth(request, env) {
  if (!env.PORTFOLIO_TOKEN) return null; // pas de token configuré = dev local
  const auth = (request.headers.get('Authorization') || '').trim();
  if (auth !== `Bearer ${env.PORTFOLIO_TOKEN}`) {
    return new Response('Unauthorized', { status: 401, headers: CORS });
  }
  return null;
}

// ── Proxy: Twelve Data prices ─────────────────────────────────
async function priceProxy(request, env) {
  const url = new URL(request.url);
  const symbols = url.searchParams.get('symbols');
  if (!symbols) return err('missing symbols');
  if (!env.TD_KEY) return err('TD_KEY not configured', 500);

  const tdUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbols)}&apikey=${env.TD_KEY}&dp=4`;

  try {
    const res = await fetch(tdUrl);
    if (!res.ok) return err(`Twelve Data HTTP ${res.status}`, 502);
    const data = await res.json();

    // Twelve Data: objet plat pour 1 symbole, objet indexé par symbole pour plusieurs
    const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
    const results = symbolList.map(sym => {
      const q = symbolList.length === 1 ? data : data[sym];
      if (!q || q.status === 'error' || !q.close) return null;
      return {
        symbol:                        sym,
        regularMarketPrice:            parseFloat(q.close)           || null,
        regularMarketChange:           parseFloat(q.change)          || 0,
        regularMarketChangePercent:    parseFloat(q.percent_change)  || 0,
        regularMarketPreviousClose:    parseFloat(q.previous_close)  || null,
        regularMarketVolume:           parseInt(q.volume)            || null,
        longName:                      q.name  || null,
        shortName:                     q.name  || null,
        currency:                      q.currency || 'USD',
        fiftyTwoWeekHigh:              parseFloat(q.fifty_two_week?.high) || null,
        fiftyTwoWeekLow:               parseFloat(q.fifty_two_week?.low)  || null,
        marketState:                   q.is_market_open ? 'REGULAR' : 'CLOSED',
      };
    }).filter(Boolean);

    if (!results.length) return err('Twelve Data: aucun résultat', 502);
    return json({ quoteResponse: { result: results, error: null } });
  } catch(e) {
    return err(`Twelve Data error: ${e.message}`, 502);
  }
}

// ── Proxy: FMP fundamentals ──────────────────────────────────
async function fmpProxy(request, env) {
  const url = new URL(request.url);
  const symbol = url.searchParams.get('symbol');
  if (!symbol)       return err('missing symbol');
  if (!env.FMP_KEY)  return err('FMP_KEY not configured', 500);

  const base = `https://financialmodelingprep.com/api/v3`;
  const [profile, metrics] = await Promise.all([
    fetch(`${base}/profile/${symbol}?apikey=${env.FMP_KEY}`).then(r => r.json()),
    fetch(`${base}/key-metrics-ttm/${symbol}?apikey=${env.FMP_KEY}`).then(r => r.json()),
  ]);
  return json({ profile, metrics });
}

// ── D1: GET /api/sync ────────────────────────────────────────
async function getSync(env) {
  const [txRes, settRes] = await Promise.all([
    env.DB.prepare('SELECT * FROM transactions ORDER BY date ASC, created_at ASC').all(),
    env.DB.prepare('SELECT key, value FROM settings').all(),
  ]);
  const settings = Object.fromEntries(settRes.results.map(r => [r.key, r.value]));
  return json({ transactions: txRes.results, settings });
}

// ── D1: POST /api/transaction ────────────────────────────────
async function postTransaction(request, env) {
  let body;
  try { body = await request.json(); } catch { return err('invalid JSON'); }

  const { type, ticker, shares, price, amount, date, currency = 'USD' } = body;
  if (!type)   return err('type required');
  if (!ticker) return err('ticker required');
  if (!date)   return err('date required');

  const result = await env.DB
    .prepare('INSERT INTO transactions (type,ticker,shares,price,amount,date,currency) VALUES (?,?,?,?,?,?,?)')
    .bind(type, ticker.toUpperCase(), shares ?? null, price ?? null, amount ?? null, date, currency)
    .run();

  return json({ id: result.meta.last_row_id, ok: true }, 201);
}

// ── D1: DELETE /api/transaction/:id ─────────────────────────
async function deleteTransaction(path, env) {
  const id = parseInt(path.split('/').pop(), 10);
  if (!id || isNaN(id)) return err('invalid id');
  const result = await env.DB.prepare('DELETE FROM transactions WHERE id = ?').bind(id).run();
  if (result.meta.changes === 0) return err('not found', 404);
  return json({ ok: true });
}

// ── D1: PUT /api/settings ────────────────────────────────────
async function putSettings(request, env) {
  let body;
  try { body = await request.json(); } catch { return err('invalid JSON'); }

  const stmts = Object.entries(body).map(([key, value]) =>
    env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind(key, String(value))
  );
  if (!stmts.length) return err('empty body');
  await env.DB.batch(stmts);
  return json({ ok: true });
}

// ── R2: GET /api/backup ──────────────────────────────────────
async function getBackup(env) {
  const syncRes = await getSync(env);
  const data = await syncRes.json();
  const ts   = new Date().toISOString().replace(/[:.]/g, '-');
  const key  = `backup-${ts}.json`;
  const body = JSON.stringify(data, null, 2);

  if (env.BACKUPS) {
    await env.BACKUPS.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  return new Response(body, {
    headers: {
      ...CORS,
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${key}"`,
    },
  });
}

// ── R2: POST /api/restore ────────────────────────────────────
async function postRestore(request, env) {
  let body;
  try { body = await request.json(); } catch { return err('invalid JSON'); }

  const { transactions = [], settings = {} } = body;

  const stmts = [
    env.DB.prepare('DELETE FROM transactions'),
    env.DB.prepare('DELETE FROM settings'),
    ...transactions.map(tx =>
      env.DB
        .prepare('INSERT INTO transactions (id,type,ticker,shares,price,amount,date,currency,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(tx.id, tx.type, tx.ticker, tx.shares ?? null, tx.price ?? null, tx.amount ?? null, tx.date, tx.currency || 'USD', tx.created_at || Math.floor(Date.now() / 1000))
    ),
    ...Object.entries(settings).map(([key, value]) =>
      env.DB.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').bind(key, String(value))
    ),
  ];

  await env.DB.batch(stmts);
  return json({ ok: true, restored: transactions.length });
}

// ── Router ───────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const { method } = request;
    const url  = new URL(request.url);
    const path = url.pathname;

    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS });
    }

    // Legacy proxy routes — no auth, backward-compatible
    if (url.searchParams.has('symbols')) return priceProxy(request, env);
    if (url.searchParams.has('fmp'))     return fmpProxy(request, env);

    // API routes — auth required
    if (path.startsWith('/api/')) {
      const authErr = checkAuth(request, env);
      if (authErr) return authErr;

      if (path === '/api/sync'        && method === 'GET')    return getSync(env);
      if (path === '/api/transaction' && method === 'POST')   return postTransaction(request, env);
      if (path === '/api/settings'    && method === 'PUT')    return putSettings(request, env);
      if (path === '/api/backup'      && method === 'GET')    return getBackup(env);
      if (path === '/api/restore'     && method === 'POST')   return postRestore(request, env);

      if (path.startsWith('/api/transaction/') && method === 'DELETE')
        return deleteTransaction(path, env);

      return err('route not found', 404);
    }

    return new Response('DividendKill API', { status: 200, headers: CORS });
  },
};
