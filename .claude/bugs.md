# BUGS

## Critical
*(none currently open)*

## Medium
- **Skeleton/blank states during boot** — panels show empty while prices + funda load
  → No loading indicator; user sees zeros until both promises resolve
  → Fix: add skeleton UI or "Chargement…" state in renderPanel

- **P/E still 0** (status: deploy pending) — `normalizeFunda` was using `p.pe` which
  doesn't exist in FMP free plan; now reads `m.peRatioTTM` from key-metrics-ttm
  → Verify after funda5 KV cache populates (~first user visit post-deploy)

## Low
- **PAY_MONTHS map in calendar.js** — hardcoded for ~20 tickers; all others derive
  pay months from FMP dividend history. Map needs periodic updates.
  → Low priority since FMP history now works

- **Search shows only portfolio tickers when offline** — fallback to portfolio search
  only; "Saisie manuelle" option added but UX could be cleaner

## Fixed
- [x] `normalizeProfile` wrong field names: `lastDiv`, `mktCap`, `volAvg`, `dividendYield`, `pe`
      → All corrected to confirmed FMP field names (commit 9aa1348)
- [x] `normalizeFunda` `p.lastDiv * 4` — `lastDividend` is already ANNUAL
      → Fixed to `+p.lastDividend` (commit 9aa1348)
- [x] `normalizeFunda` `p.mktCap` → `p.marketCap` (commit 9aa1348)
- [x] KV stale null cache — bumped funda4→funda5, client v4→v5 (commit 9aa1348)
- [x] FMP dividends wrapped format `{ historical: [] }` — normalized to flat array
- [x] Calendar NaN for stocks without dividend data — `(a.d||0)` guard
- [x] Search can't add tickers not in portfolio — "Saisie manuelle" option + FMP v3 fallback
- [x] Panel not re-rendering after FmpData loads — added renderPanel in bootFmpPromise callback
- [x] Multiple stale KV cache rounds (funda→funda2→funda3→funda4→funda5)
- [x] Wrong git branch for commits (force-push early in session)
- [x] Duplicate API call on load
- [x] Deal cards regression after large refactor
- [x] News panel duplicate header

## Debug endpoint
`GET /api/debug/price?symbol=APD&live=1`
→ Shows raw FMP profile keys, `lastDividend`, `marketCap`, `averageVolume` values
→ Use this first when diagnosing any fundamentals issue
