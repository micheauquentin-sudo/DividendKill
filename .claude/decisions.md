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
