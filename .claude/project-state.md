# PROJECT STATE
<!-- last-commit: [2026-07-03 23:16] fix: pull-to-refresh fires regardless of actual scroll position -- src/ui.js -->
<!-- interrupted: [2026-07-03 23:07] context: Auto-snapshot already captured it. Résumé : -->
<!-- resume-from: files: .claude/project-state.md, src/ui.js -->

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
DSE V2 confirmed working end-to-end live. Just shipped (`560fa8b`) a
significant accuracy upgrade found by inspecting Finnhub's full
`/stock/metric?metric=all` response (~130 fields, we only used ~6):
- `epsGrowth5Y`/`revenueGrowth5Y`/`dividendGrowthRate5Y` are precomputed
  growth rates Finnhub already exposes — now used as hints in
  `dividendScore.js`'s `computeGrowth`/`computeStability` whenever FMP's
  blocked 5-year statements can't produce their own CAGR (the common
  case). This should populate `growth` and part of `stability` for most
  tickers going forward, not just `coverage`+`market`.
- Found `fh9:SYMBOL` cache (7d TTL) had no version marker — entries
  cached before `interest_cov`/`debt_equity` were added to the parser
  silently lacked them (confirmed live on UNM), blocking `balance`
  entirely. Added `FH9_VER` gating (same pattern as `FV_VER`/`DSE2_VER`).
- Found the `netInterestCoverageTTM` `/100` conversion (based on one
  anecdotal APD reading of 709) was wrong — UNM's raw value (5.47) is
  already correctly scaled, dividing gave an absurd 0.05x. Removed the
  conversion entirely.
- `DSE2_VER` bumped to 3 to force recompute under the corrected/enriched
  inputs. Verified via direct `computeDividendSafetyV2` smoke test with
  hints (UNM: score 68→71, confidence 0.45→0.66, balance/stability/growth
  all populated instead of null) — NOT yet confirmed live in prod (no
  network access from this sandbox to verify).
- After deploy, UNM stayed at 68 client-side: found the client's
  incomplete-check only verified `_dse2_ver` was PRESENT, not that it
  matched the latest version — an already-cached v2 score looked
  "complete" and was never re-requested. Fixed (`ef67e7c`) by adding
  `EXPECTED_DSE2_VER` in `src/fmpData.js` (must be kept in sync with the
  worker's `DSE2_VER` from now on) and comparing exact equality —
  future engine bumps now self-heal on the next Sync without needing a
  `CACHE_KEY` wipe. Bumped `CACHE_KEY` v17→v18 as the one-time fix for
  entries already stuck under the old presence-only check.
- User's last-remaining-gap question ("stability still missing history
  data") led to one more real improvement (`7eb3078`): the pipeline
  already computes a genuine `streak` (years without a decrease) when
  FMP's `/stable/dividends` succeeds (mega-caps), but it was never fed
  into the V2 engine. A streak of N years is direct proof of 0 cuts —
  stronger evidence than the reconstructed history's own cut-detection.
  Wired through as `streakHint`, used in `computeStability` only when
  the reconstructed series can't produce its own cut count. `DSE2_VER`
  bumped to 4 (+ `EXPECTED_DSE2_VER` mirror) — this one should self-heal
  without a `CACHE_KEY` bump thanks to the exact-version-check above.

Also shipped (`c18ea99`, root cause confirmed but NOT yet verified live
whether it flips the label): ADP showed "Could be overvalued" via the
sector-P/E fallback (`fair_value` still null, same dividend-history
wall). Root cause: the fallback's quality adjustment scales sector P/E
by the DSE score, and a low-confidence dse2 score (driven by null
sub-scores, not real risk) was dragging an already-approximate P/E
estimate into a falsely confident "overvalued" call. Fix: only apply
the quality adjustment when dse2 confidence >= 0.6; below that, use the
neutral unadjusted sector P/E. Should partially self-resolve now too,
since confidence should be higher with the Finnhub growth hints above.
Awaiting user's next Sync + screenshot for both of these.

Two bugs found and fixed getting DSE V2 live, both worth remembering as
a pattern: (1) server cache-incomplete-check didn't know `dse2` existed,
so pre-existing `funda9` entries never retried it — fixed with
`DSE2_VER` versioning mirroring `FV_VER`. (2) client's `_isFresh()` only
checked TTL age, never content completeness of an already-cached entry
— an entry cached incomplete once stayed "fresh" for 24h regardless of
Sync clicks or reloads. Fixed by extracting `_isIncomplete(d)` and using
it in both the write path AND `_isFresh()`, so this self-heals for any
future field without needing a CACHE_KEY bump. Also caught (3): Twelve
Data time_series was pulling WEEKLY bars while dividendScore.js's
market-stability calc annualizes assuming daily bars (sqrt(252)) —
inflated volatility ~2.2x. Fixed by switching to daily bars.

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
