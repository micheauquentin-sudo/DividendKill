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

## Medium (new)
- **P/E still N/A for ADP/UNM/MMM/ACN/HRL/APD after AV_KEY secret added** (status: diagnostics added, awaiting live test)
  → Code path (fetchAlphaVantageOverview, fmpProxy, cron refreshFunda) is correct; KV confirmed clean (no stale data)
  → Root cause is one of: AV_KEY not actually bound to the deployed Worker (wrong dashboard env/typo), AV 25/day quota exhausted from earlier testing, or AV OVERVIEW returning Note/Information (rate limit) for these symbols
  → Added diagnostics in `debugFunda` (worker/src/index.js ~1394-1457): `av_key_set`/`av_key_len` always returned; new `?avlive=1` param does a live AV OVERVIEW call and returns raw HTTP status + body (bypasses KV cache, costs 1 AV quota call)
  → Next: hit `/api/debug/funda?symbol=APD&avlive=1` to get definitive answer

## Debug endpoint
`GET /api/debug/price?symbol=APD&live=1`
→ Shows raw FMP profile keys, `lastDividend`, `marketCap`, `averageVolume` values

`GET /api/debug/funda?symbol=APD` → `av_key_set`/`av_key_len` (is AV_KEY bound?) + KV state
`GET /api/debug/funda?symbol=APD&avlive=1` → live Alpha Vantage OVERVIEW call, raw status+body
→ Use this first when diagnosing any fundamentals issue
