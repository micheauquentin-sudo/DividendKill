import { Config } from './config.js';

export const MarketData = (() => {

  const _cache = {};
  let _refreshTimer = null;
  let _onUpdateCb   = null;
  let _status       = 'idle';
  const CACHE_KEY   = 'astra_market_cache_yf';

  function _saveCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(_cache)); } catch(e) {}
  }
  function _loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const now = Date.now();
      for (const [t, d] of Object.entries(parsed)) {
        if (now - d.ts < 24 * 3600 * 1000) _cache[t] = d;
      }
    } catch(e) {}
  }
  function _isFresh(ticker) {
    const c = _cache[ticker];
    return c && (Date.now() - c.ts < Config.MARKET_CACHE_TTL);
  }

  /* ── Fetch batch Yahoo Finance ── */
  async function _fetchOneBatch(batchTickers) {
    const symbols = batchTickers.join(',');
    const url = `${Config.YF_BASE}?symbols=${encodeURIComponent(symbols)}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (res.status === 429) throw new Error('QUOTA');
    if (!res.ok) {
      let detail = `Worker HTTP ${res.status}`;
      try { const b = await res.json(); if (b?.error) detail = `Worker: ${b.error}`; } catch(_) {}
      throw new Error(detail);
    }
    const json = await res.json();
    if (json.error === 'FMP_QUOTA') throw new Error('QUOTA');
    if (json.error) throw new Error(`Worker: ${json.error}`);
    const results = json?.quoteResponse?.result;
    if (!results || results.length === 0) throw new Error('Worker: aucun résultat');
    const valid = results.filter(Boolean);
    const nullPrices = valid.filter(q => !q.regularMarketPrice).map(q => q.symbol);
    if (nullPrices.length) console.warn('[MarketData] prix null reçus du worker:', nullPrices);
    return valid;
  }

  async function _fetchYahooQuotes(tickers) {
    // FMP accepte tous les symboles en une seule requête = 1 crédit peu importe le nombre
    const res = await _fetchOneBatch(tickers);
    if (res.length === 0) throw new Error('Aucun résultat reçu du worker');
    return res;
  }

  function _normalize(q) {
    return {
      price:      q.regularMarketPrice           || null,
      change:     q.regularMarketChange          || 0,
      changePct:  q.regularMarketChangePercent   || 0,
      prevClose:  q.regularMarketPreviousClose   || null,
      volume:     q.regularMarketVolume          || null,
      pe_cur:     q.trailingPE                  || null,
      pe_fwd:     q.forwardPE                   || null,
      div_yield:  q.dividendYield               || null,
      annual_div: q.trailingAnnualDividendRate  || (q.dividendYield > 0 && q.regularMarketPrice > 0 ? +(q.dividendYield * q.regularMarketPrice).toFixed(4) : null),
      ex_date:    q.exDividendDate              || null,
      marketState: q.marketState               || 'REGULAR',
      name:       q.longName || q.shortName     || null,
      beta:       q.beta                        || null,
      market_cap: q.marketCap                   || null,
      fifty2_high: q.fiftyTwoWeekHigh           || null,
      fifty2_low:  q.fiftyTwoWeekLow            || null,
    };
  }

  async function getQuote(ticker) {
    if (_isFresh(ticker) && _cache[ticker]?.quote) return _cache[ticker].quote;
    const results = await _fetchYahooQuotes([ticker]);
    const q = results.find(r => r.symbol === ticker);
    if (!q) throw new Error(`Yahoo: pas de quote pour ${ticker}`);
    const quote = _normalize(q);
    _cache[ticker] = { ..._cache[ticker], quote, ts: Date.now() };
    _saveCache();
    return quote;
  }

  async function getDividendData(ticker) {
    const q = await getQuote(ticker);
    return { annual_div: q.annual_div, yield: q.div_yield, ex_date: q.ex_date, pay_date: null, div_cagr_5y: null };
  }

  async function getFundamentals(ticker) {
    const q = await getQuote(ticker);
    return { pe_cur: q.pe_cur, pe_5y: q.pe_fwd, payout_ratio: null, fcf_yield: null,
             debt_equity: null, beta: null, market_cap: null, sector: null,
             dividend_per_share: q.annual_div, ex_div_date: q.ex_date };
  }

  async function refreshAll(tickers, onUpdate) {
    if (!tickers || tickers.length === 0) {
      _setNavStatus('ok', '');
      return { success: 0, errors: 0 };
    }
    _status = 'loading';
    _onUpdateCb = onUpdate || null;
    _setNavStatus('loading', 'Actualisation prix...');

    // Callbacks immédiats pour les tickers en cache frais
    tickers.filter(t => _isFresh(t) && _cache[t]?.quote)
           .forEach(t => { if (_onUpdateCb) _onUpdateCb(t, _cache[t].quote); });

    const toFetch = tickers.filter(t => !_isFresh(t));
    let success = tickers.length - toFetch.length;
    let errors  = 0;

    if (toFetch.length > 0) {
      try {
        const results = await _fetchYahooQuotes(toFetch);
        const now = Date.now();
        results.forEach(q => {
          const quote = _normalize(q);
          _cache[q.symbol] = { ..._cache[q.symbol], quote, ts: now };
          if (_onUpdateCb) _onUpdateCb(q.symbol, quote);
          success++;
        });
        _saveCache();
        errors = toFetch.filter(t => !results.find(r => r.symbol === t)).length;
      } catch(e) {
        if (e.message === 'QUOTA') {
          _setNavStatus('quota', '');
          _scheduleRefresh(tickers, onUpdate);
          return { success, errors: toFetch.length };
        }
        console.warn('[MarketData] batch error:', e.message);
        errors = toFetch.length;
      }
    }

    _status = tickers.length > 0 && errors === tickers.length ? 'error' : 'ok';
    _setNavStatus(_status === 'error' ? 'err' : 'ok', '');
    _scheduleRefresh(tickers, onUpdate);
    return { success, errors };
  }

  /* ── Prix courant depuis cache (sync, pour compatibilité avec Data.currentPrices) ── */
  function getCachedPrice(ticker) {
    return _cache[ticker]?.quote?.price || null;
  }

  function getCachedChange(ticker) {
    return _cache[ticker]?.quote?.change || null;
  }

  /* ── Helpers internes ── */
  function _scheduleRefresh(tickers, onUpdate) {
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => refreshAll(tickers, onUpdate), Config.MARKET_CACHE_TTL);
  }

  function _setNavStatus(type, msg) {
    const dot = document.getElementById('statusDot');
    const txt = document.getElementById('statusTxt');
    if (dot) dot.className = 'status-dot' + (type === 'loading' ? ' load' : (type === 'err' || type === 'quota') ? ' err' : '');
    if (txt) {
      if (type === 'loading') txt.textContent = 'Prix...';
      else if (type === 'quota') txt.textContent = 'Quota FMP';
      else if (type === 'err')   txt.textContent = 'Prix ERR';
      else txt.textContent = 'Prix OK';
    }
  }

  function getStatus() { return _status; }

  function getCacheInfo() {
    const tickers = Object.keys(_cache);
    const fresh   = tickers.filter(t => _isFresh(t)).length;
    return { total: tickers.length, fresh, stale: tickers.length - fresh };
  }

  /* ── Init : charge cache persisté ── */
  _loadCache();

  function clearCache() {
    for (const k in _cache) delete _cache[k];
    try { localStorage.removeItem(CACHE_KEY); } catch(e) {}
  }

  return {
    getQuote,
    getDividendData,
    getFundamentals,
    refreshAll,
    clearCache,
    getCachedPrice,
    getCachedChange,
    getStatus,
    getCacheInfo,
  };

})();
