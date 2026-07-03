# DECISIONS

## Market data provider
**Chosen:** FMP (Financial Modeling Prep)
**Endpoints:** `/stable/` only (free plan compatible)
**Rejected:** Yahoo Finance — Play Store TOS violation (PERMANENT ban)
**Rejected:** Alpha Vantage — slow, limited free tier
**Rejected:** Finnhub — considered early, FMP chosen instead

## Backend runtime
**Chosen:** Cloudflare Worker
**Reason:** Zero cold start, global edge, free KV + D1 on free plan
**Rejected:** Node.js server — cost, ops overhead

## Caching strategy
**Chosen:** Two-layer cache
1. Cloudflare KV (worker-side) — prices TTL ~5 min, funda TTL ~7 days
2. localStorage (client-side) — 24h TTL, keyed `astra_fmp_cache_v5`
**Reason:** Minimizes FMP API credit burn; free plan has limited daily calls

## KV key versioning
**Convention:** Bump suffix when stale data needs forced eviction
- `funda5:SYMBOL` — current (v5 after 4 forced migrations fixing null data)
- Client: `astra_fmp_cache_v5`
**When to bump:** Any time normalizeFunda logic changes AND old KV data has wrong shape

## FMP free plan limitations (confirmed via debug)
- No `dividendYield` in `/stable/profile` → compute as `lastDividend / price`
- No `pe` in `/stable/profile` → get from `/stable/key-metrics-ttm` (`peRatioTTM`)
- `lastDividend` = ANNUAL dividend (NOT quarterly — no ×4 needed)
- `/stable/dividends` returns `{ historical: [] }` object, NOT a flat array

## Annual dividend computation priority
1. Sum of last 12 months from `/stable/dividends` history (most accurate)
2. `p.lastDividend` from profile (fallback — less accurate for special dividends)
3. Nothing (null — UI shows 0)
**Never:** `lastDiv * 4` (wrong field + wrong calculation)

## Frontend architecture
**Chosen:** Vanilla JS (no framework)
**Reason:** SPA was already built this way; no migration cost; small bundle
**Rejected:** React/Vue — migration cost too high for no clear benefit

## Auth
**Chosen:** Google OAuth 2.0 + signed Bearer token
**Storage:** Token in localStorage, validated server-side
**Rejected:** Supabase Auth — extra dependency

## Portfolio persistence
**Chosen:** Cloudflare D1 (SQLite) as source of truth + localStorage sync
**Pattern:** Load from D1 on login, save to D1 on change, localStorage as offline cache

## Branch strategy
- `main` → production deploys (GitHub Actions on push)
- `claude/action-persistence-refresh-mbnd7l` → CI secondary branch
- All Claude work goes to `main` unless told otherwise

## Valuation method — yield reversion, not sector P/E (2026-07-03)
Reverse-engineered from a Simply Safe Dividends portfolio export: their
"Expected" fair value is pure dividend-yield reversion — fair price = where
the stock's dividend yield returns to its own 5-year average, NOT a sector
P/E norm. Sector-average P/E was judging quality compounders (ADP) overvalued
and low-P/E insurers (UNM) undervalued — both backwards.
- Server `fetchYieldReversion()`: 5y FMP historical prices (cached yr9:SYMBOL),
  median trailing-12mo yield, fair_value = annual_div / median_yield.
- Client valorisation `_computeVal`: price/fair_value bands <0.95 under,
  >1.20 over (asymmetric, matches SSD's lenient "may be undervalued").
- Validated 90% band agreement vs 21 real SSD holdings; all user-flagged
  tickers (ADP/HRL/UNM/ACN/APD) match SSD.
- Fallback to sector-P/E (quality-adjusted) only when fair_value unavailable
  (non-dividend payer or no price history).

## DSE score renormalization (2026-07-03)
fcf_payout/debt_ebitda/interest_cov come only from FMP paid statements (402
on free plan), so they're structurally always-missing now. Scoring them as
neutral 50 capped the max DSE at ~78 for everyone. Fixed: renormalize the
weighted average over only the factors actually available per stock. Finnhub
later recovered interest_cov (netInterestCoverageTTM /100) and debt_equity
(→ debt_ebitda approximation); FCF payout deliberately NOT derived from
Price/FCF (too price-sensitive, tanked scores).
