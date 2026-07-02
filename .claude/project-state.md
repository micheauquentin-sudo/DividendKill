# PROJECT STATE
<!-- last-commit: [2026-07-02 20:18] feat: Alpha Vantage OVERVIEW comme source de P/E + payout (fallback FMP 402) -- worker/src/index.js -->
<!-- interrupted: [2026-07-02 20:18] context: Poussé. **Il te faut une clé Alpha Vantage gratuite** : -->
<!-- resume-from: files: worker/src/index.js -->

## Current mission
Fix FMP fundamentals pipeline so dividend yield, P/E, annual div, and safety scores
display correctly for all portfolio stocks.

---

## Last completed
- Fixed `normalizeProfile`: wrong FMP field names (`lastDiv`→`lastDividend`, `mktCap`→`marketCap`, `volAvg`→`averageVolume`, removed non-existent `dividendYield`/`pe`)
- Fixed `normalizeFunda`: removed `dividendYield` fallback, fixed `lastDiv*4`→`+lastDividend` (already annual)
- Bumped KV key `funda4:`→`funda5:` and client cache `v4`→`v5` to purge stale null data
- Fixed `normalizeFunda`: `dividends` wrapped format `{ historical: [] }` handled correctly
- Fixed calendar NaN: `(a.d||0)` guard in calendar.js line 22
- Fixed search: `_fabOfflineSearch` shows typed ticker as "Saisie manuelle" when not in portfolio
- Added FMP search v3 fallback in `searchProxy`

---

## Current task
Verify that dividends/P/E now display correctly after the funda5 deploy

Status:
[ ] Not started
[x] In progress (waiting for CI deploy ~2 min after last push)
[ ] Testing
[ ] Done

Current file:
worker/src/index.js (normalizeProfile + normalizeFunda)

---

## Next actions
1. User opens app → confirm YIELD, P/E, DIV./AN show real values (not 0)
2. If still 0: check `/api/debug/price?symbol=APD&live=1` for `fmp_profile_lastDividend` value
3. If confirmed working: mark this mission done, pick up roadmap Phase 2

---

## Files touched (this mission)
- `worker/src/index.js` — normalizeProfile, normalizeFunda, KV key funda4→funda5
- `src/fmpData.js` — CACHE_KEY v4→v5
- `src/panels/calendar.js` — NaN guard line 22
- `src/ui.js` — re-render after FmpData load, bootFmpPromise callback

---

## Known blockers
- FMP free plan has no `dividendYield` or `pe` in `/stable/profile` — both must be derived
- P/E comes from `/stable/key-metrics-ttm` (`peRatioTTM` field) — already wired
- Pay months for some tickers hardcoded in `calendar.js` PAY_MONTHS map (fallback)

---

## Resume instruction
When restarting:
1. Read architecture.md → understand the FMP→KV→client pipeline
2. Read this file → pick up current task
3. Check git log for last commit message to know where code stands
4. Do NOT re-analyse fmpData.js or ui.js unless a new bug is reported
