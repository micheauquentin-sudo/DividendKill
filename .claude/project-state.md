# PROJECT STATE
<!-- last-commit: [2026-07-03 21:59] fix: dse2 never computed for tickers cached before the V2 scoring deploy -- src/fmpData.js worker/src/index.js -->
<!-- interrupted: [2026-07-03 22:00] context: Poussé (`cbd1ff4`). Peux-tu refaire un Sync puis revérifier `/api/debug/funda?symbol=UNM` ? Tu devrais maintenant voir ` -->
<!-- resume-from: files: src/fmpData.js, worker/src/index.js -->

## Current mission
Roadmap Phase 3/4 UX improvements, resumed after the dividend safety scoring
system was restructured into a server-side V2 engine (this session's focus).

---

## Last completed (this session)

- **Yield-reversion valuation** (Simply Safe Dividends method): `fair_value =
  annual_div / median(TTM yield over 5y, monthly)`. Primary valuation method
  in `valorisation.js` (`_computeVal`, `method:'yield'`); sector-P/E stays as
  fallback when `fair_value` is null.
- **UNM dividend-history dead end**: confirmed FMP `/stable/dividends` (402),
  Finnhub `/stock/dividend` (403 "paid plan"), and Twelve Data `/dividends`
  (403 "pro/ultra/venture/enterprise only") ALL gate real per-year dividend
  history behind paid tiers on this account. No free-tier source exists for
  it — this directly motivated the V2 scoring engine's reconstruction
  approach below, since real history genuinely isn't obtainable.
- **Alpha Vantage removed entirely**: 25 calls/day was too tight once a
  portfolio has more than a couple of Finnhub-uncovered tickers. Twelve Data
  widened as the fallback after Finnhub instead (fundamentals + dividends +
  now also time_series for price history).
- **Dividend Safety Score V2 — full restructure** (commit `b658ff0`), built
  with a background agent for the pure scoring module + own wiring:
  - New `worker/src/dividendScore.js` (`computeDividendSafetyV2`): pure,
    dependency-free module (no fetch/KV/env) implementing reconstruction +
    5 weighted sub-scores + risk penalties + confidence engine + French
    explanation bullets. Never throws — traced/tested against bare-minimum,
    fully-populated, and garbage inputs.
  - **Reconstruction engine**: when no real dividend history exists (the
    common case per above), estimates past dividends per year as
    `MIN(EPS_year × current_payout_ratio, FCF_per_share_year × current_payout_ratio)`
    when both known, whichever one when only one is known. Confidence score
    reflects this (lower when reconstructed vs real).
  - **5 sub-scores** (coverage 35% / balance 25% / stability 20% / growth
    10% / market 10%), each renormalized over whichever are actually
    available — mirrors the renormalization pattern already used in
    `src/dividendSafety.js`'s v1 `calculate()`.
  - New FMP fetchers (`fetchFmpRatiosTTM`, `fetchFmpKeyMetricsTTM`,
    `fetchFmpIncomeStatement5Y`, `fetchFmpCashFlow5Y`,
    `fetchFmpBalanceSheetLatest`) — these 5 endpoints were already confirmed
    402 for non-mega-cap tickers earlier in the session, but are retried
    here anyway (FMP's tiering can vary, and the engine tolerates them being
    empty); failures cached 3 days (not ~120d) to limit quota burn without
    permanently blocking a retry.
  - New `fetchTwelveDataTimeSeries` (`/time_series`, "Core Data" — expected
    free unlike `/statistics`/`/dividends`) feeds the market-stability
    sub-score (volatility/drawdown/trend).
  - Orchestrated in `buildDividendScoreV2()`, called from both `fmpProxy`
    and the cron's `refreshFunda`, result stored as `result.dse2` inside the
    existing `funda9:SYMBOL` cache entry (no new top-level cache key needed
    — individual source fetchers already cache themselves).
  - Frontend: `src/dividendSafety.js` gained `getDisplayDSE(stock)` —
    prefers `stock.dse2` (server V2) when present, falls back to the old
    client `calculate()` otherwise. All 4 call sites migrated
    (`valorisation.js`, `deal.js`, `rendement.js` cards, `ui.js`'s
    `showDSESheet` detail panel, which now also shows confidence %,
    per-category "données insuffisantes" when a sub-score is null, the 8
    raw metrics, a reconstruction warning banner, and the explanation
    bullets — old breakdown UI kept as the v1 fallback path).
  - `src/fmpData.js` `CACHE_KEY` bumped v15→v16 to roll `dse2` out
    immediately instead of waiting on the 24h client TTL.
  - Verified via: `node --check` on both new/modified worker files, a
    direct-import smoke test of `dividendScore.js` with 3 scenarios
    (bare-minimum/full-data/partial-data — none crash), `npm run build` for
    the frontend, and an `esbuild --bundle` dry-run of the whole worker
    entry (confirms the new ESM import resolves and bundles the way
    wrangler/Cloudflare will) — could NOT verify live against production
    (network policy blocks this sandbox from reaching the deployed Worker
    URL and FMP/Finnhub/Twelve Data directly).

---

## Current task
None in progress — awaiting confirmation from the user, once deployed, that:
1. `dse2` actually populates for real tickers (check `/api/debug/funda?symbol=X`
   → `kv_data.dse2`) and isn't silently erroring in `buildDividendScoreV2`'s
   try/catch (which would leave `dse2` absent and everything falling back to
   v1, which is silent/harmless but worth confirming isn't happening for ALL
   tickers).
2. Whether FMP's 5 financial-statement endpoints still 402 (expected) or
   surprisingly work now — check any single ticker's `dse2.reconstructed` /
   `dse2.breakdown` to see how many sub-scores came through.
3. The DSE detail sheet renders correctly for both a v2-scored ticker and a
   ticker that hasn't been re-synced yet (v1 fallback) — no live UI testing
   was possible this session (network-isolated sandbox).

---

## Known blockers / notes
- No free-tier source exists ANYWHERE for real historical dividend payments
  (FMP/Finnhub/Twelve Data all confirmed gated) — this is now permanently
  handled via reconstruction in dividendScore.js rather than treated as a bug
  to keep chasing with more providers.
- FMP's 5 financial-statement endpoints (ratios-ttm, key-metrics-ttm, income-
  statement, cash-flow-statement, balance-sheet-statement) are very likely
  still 402 for non-mega-cap tickers (confirmed earlier this session for the
  same underlying data via different endpoint names) — the V2 engine assumes
  this and degrades gracefully, but this means `dse2.breakdown.coverage` will
  often only have Finnhub's EPS (not FCF), `balance`/`growth`/`stability` may
  frequently be null, and confidence will often be low. This is expected
  behavior, not a bug — the explanation bullets should say so per ticker.
- `fcf_payout`/`debt_ebitda` (the OLD v1 fields) are still permanently null —
  irrelevant now for tickers with `dse2`, but v1 fallback still uses them.
- Pay months for some tickers still hardcoded in `calendar.js` PAY_MONTHS map.

---

## Resume instruction
When restarting:
1. Read `architecture.md` → understand FMP→Finnhub→TwelveData→KV→client
   pipeline AND the new dividendScore.js V2 scoring engine on top of it.
2. Read this file → pick up current task (awaiting live confirmation above).
3. Check git log for the latest commit to confirm deploy state.
4. Roadmap Phase 3/4 remaining items: mobile keyboard handling, faster boot
   prefetch, dark/light theme, PDF/CSV export, watchlist alerts.
