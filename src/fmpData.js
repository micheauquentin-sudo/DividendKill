import { Config } from './config.js';

export const FmpData = (() => {
  const CACHE_KEY = 'astra_fmp_cache';
  const TTL       = 24 * 3600 * 1000; // 24 h
  const _cache    = {};

  function _save() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(_cache)); } catch(e) {}
  }
  function _load() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const now = Date.now();
      for (const [t, d] of Object.entries(parsed)) {
        if (now - d.ts < TTL) _cache[t] = d;
      }
    } catch(e) {}
  }
  function _isFresh(ticker) {
    return _cache[ticker] && (Date.now() - _cache[ticker].ts < TTL);
  }

  async function _fetchOne(ticker) {
    const url = `${Config.YF_BASE}?fmp=all&symbol=${encodeURIComponent(ticker)}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`FMP worker HTTP ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  /* Précharge tous les tickers (appelé au boot et au sync).
     Retourne un tableau { ticker, data } */
  async function prefetch(tickers) {
    const toFetch = tickers.filter(t => !_isFresh(t));
    if (toFetch.length === 0) return tickers.map(t => ({ ticker: t, data: _cache[t]?.data }));

    const results = await Promise.allSettled(toFetch.map(t => _fetchOne(t)));
    const now = Date.now();
    toFetch.forEach((t, i) => {
      if (results[i].status === 'fulfilled') {
        _cache[t] = { data: results[i].value, ts: now };
      } else {
        console.warn('[FmpData] échec', t, results[i].reason?.message);
      }
    });
    _save();
    return tickers.map(t => ({ ticker: t, data: _cache[t]?.data || null }));
  }

  function get(ticker) {
    return _cache[ticker]?.data || null;
  }

  /* Applique les données FMP dans Data.assets[ticker] (ne pas écraser les valeurs manuelles
     définies par l'utilisateur, sauf si la valeur FMP est plus précise) */
  function mergeIntoAssets(ticker, assets) {
    const f = get(ticker);
    if (!f) return;
    if (!assets[ticker]) assets[ticker] = {};
    const a = assets[ticker];

    // N'écrase que si la valeur API est non-null et que la valeur actuelle vient d'une ancienne
    // API (null ou absente), pour ne pas écraser les saisies manuelles de l'utilisateur.
    const set = (field, val) => { if (val != null) a[field] = val; };

    set('sector',       f.sector);
    set('beta',         f.beta);
    set('market_cap',   f.market_cap);
    set('pe_cur',       f.pe_cur);
    set('payout_ratio', f.payout_ratio);
    set('fcf_payout',   f.fcf_payout);
    set('debt_ebitda',  f.debt_ebitda);
    set('interest_cov', f.interest_cov);
    set('div_cagr_5y',  f.div_cagr_5y);
    // streak : préfère la valeur FMP sauf si le FUNDAMENTALS statique est plus conservateur
    if (f.streak != null && f.streak > 0) set('streak', f.streak);
    // dividende annuel : FMP si absent ou zéro
    if (f.annual_div != null && (!a.d || a.d === 0)) set('d', f.annual_div);
    // nom si manquant
    if (f.name && !a.name) set('name', f.name);

    a._fmp_api = true;
  }

  _load();
  return { prefetch, get, mergeIntoAssets };
})();
