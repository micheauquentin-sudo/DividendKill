import { Config } from './config.js';

export const FmpData = (() => {
  const CACHE_KEY = 'astra_fmp_cache_v9';
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
    const url = `/api/funda?symbol=${encodeURIComponent(ticker)}`;
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
        const d = results[i].value;
        // Ne pas mettre en cache localStorage si les métriques financières sont toutes nulles
        // (données incomplètes suite à 429/402) — prochain Sync re-fetche
        const incomplete = d && d.pe_cur == null && d.payout_ratio == null && d.fcf_payout == null;
        if (!incomplete) _cache[t] = { data: d, ts: now };
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

  /* Extrait les champs normalisés depuis l'ancien format brut { profile, metrics }
     (entrées KV créées avant la normalisation côté worker). */
  function _extractFromRaw(raw) {
    if (!raw.profile) return raw; // déjà normalisé
    const p = (Array.isArray(raw.profile) ? raw.profile[0] : raw.profile) || {};
    const m = (Array.isArray(raw.metrics) ? raw.metrics[0] : raw.metrics) || {};
    return {
      name:         p.companyName    || null,
      sector:       p.sector         || null,
      beta:         p.beta           || null,
      market_cap:   p.mktCap         || null,
      annual_div:   p.lastDiv        || null,
      pe_cur:       m.peRatioTTM     || null,
      payout_ratio: m.payoutRatioTTM || null,
      pay_months:   null,
    };
  }

  /* Applique les données FMP dans Data.assets[ticker]. */
  function mergeIntoAssets(ticker, assets) {
    const raw = get(ticker);
    if (!raw) return;
    if (!assets[ticker]) assets[ticker] = {};
    const a = assets[ticker];
    const f = _extractFromRaw(raw);

    const set = (field, val) => { if (val != null) a[field] = val; };

    const SECTOR_FR = {
      'Technology':'Tech','Healthcare':'Santé','Consumer Cyclical':'Conso.',
      'Consumer Defensive':'Conso.','Financial Services':'Finance',
      'Real Estate':'Immo.','Industrials':'Industrie','Basic Materials':'Mat.',
      'Communication Services':'Médias','Energy':'Énergie','Utilities':'Utilities',
    };
    set('sector', f.sector != null ? (SECTOR_FR[f.sector] || f.sector) : null);
    set('beta',         f.beta);
    set('market_cap',   f.market_cap);
    set('pe_cur',       f.pe_cur);
    set('payout_ratio', f.payout_ratio);
    set('pay_months',   f.pay_months);
    if (f.streak != null && f.streak > 0) set('streak', f.streak);
    if (f.div_cagr_5y  != null) set('div_cagr_5y',  f.div_cagr_5y);
    if (f.fcf_payout   != null) set('fcf_payout',    f.fcf_payout);
    if (f.debt_ebitda  != null) set('debt_ebitda',   f.debt_ebitda);
    if (f.interest_cov != null) set('interest_cov',  f.interest_cov);
    set('d', f.annual_div); // funda annual div (sum of last 12 months) always wins when non-null
    if (f.name && !a.name) set('name', f.name);

    a._fmp_api = true;
  }

  _load();
  return { prefetch, get, mergeIntoAssets };
})();
