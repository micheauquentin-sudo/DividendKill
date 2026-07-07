import { Config } from './config.js';

export const FmpData = (() => {
  // v19 : réversion synthétique (fair_value estimée + fv_pe_med_5y) — force un refetch
  // pour les entrées déjà marquées _fv_tried sous l'ancienne logique (fair_value null).
  const CACHE_KEY = 'astra_fmp_cache_v19';
  const TTL       = 24 * 3600 * 1000; // 24 h
  const _cache    = {};

  // Doit rester synchronisé avec DSE2_VER dans worker/src/index.js. Sans ce numéro,
  // l'incomplete-check ne peut voir QUE si _dse2_ver est présent, pas s'il correspond à
  // la dernière version du moteur — un score déjà en cache avec une ancienne version
  // resterait "complet" pour le client (donc jamais re-demandé) jusqu'à expiration du
  // TTL de 24h, même après Sync/reload. Ça nous a fait perdre du temps à plusieurs
  // reprises (DSE2_VER 2→3) : on a dû bumper CACHE_KEY à chaque fois pour forcer un
  // nouveau fetch. En comparant la version exacte ici, un simple bump de ce nombre
  // suffit désormais, sans vider tout le cache local des autres tickers/champs.
  const EXPECTED_DSE2_VER = 4;

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
  // Centralise la définition de "réponse incomplète" — utilisée à la fois pour décider
  // si une entrée FRAÎCHEMENT reçue mérite d'être mise en cache, ET pour décider si une
  // entrée DÉJÀ en cache (mais encore dans le TTL) doit quand même être re-demandée.
  // Avant ce garde-fou, une entrée incomplète mise en cache une seule fois restait
  // "fraîche" (donc jamais re-fetchée) pendant tout le TTL de 24h, même après un Sync
  // manuel ou un rechargement complet de l'appli — seul un bump de CACHE_KEY la
  // débloquait. Désormais, tant qu'un champ manque, chaque Sync retente automatiquement.
  function _isIncomplete(d) {
    return !d || (
      d.pe_cur == null ||
      (d.annual_div > 0 && d.fair_value == null && !d._fv_tried) ||
      d._dse2_ver !== EXPECTED_DSE2_VER
    );
  }
  function _isFresh(ticker) {
    const c = _cache[ticker];
    if (!c || (Date.now() - c.ts >= TTL)) return false;
    return !_isIncomplete(c.data);
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
        if (!_isIncomplete(d)) _cache[t] = { data: d, ts: now };
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
    if (f.debt_equity  != null) set('debt_equity',   f.debt_equity);
    if (f.interest_cov != null) set('interest_cov',  f.interest_cov);
    // fv_estimated est réécrit (pas seulement posé) avec chaque fair_value : si la
    // réversion réelle devient un jour disponible, le flag "estimé" ne doit pas coller.
    if (f.fair_value   != null) { set('fair_value',  f.fair_value); a.fv_estimated = !!f.fv_estimated; }
    if (f.avg_yield_5y != null) set('avg_yield_5y',  f.avg_yield_5y);
    if (f.fv_pe_med_5y != null) set('fv_pe_med_5y',  f.fv_pe_med_5y);
    if (f.dse2         != null) set('dse2',          f.dse2);
    set('d', f.annual_div); // funda annual div (sum of last 12 months) always wins when non-null
    if (f.name && !a.name) set('name', f.name);

    a._fmp_api = true;
  }

  _load();
  return { prefetch, get, mergeIntoAssets };
})();
