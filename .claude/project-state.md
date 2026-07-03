# PROJECT STATE
<!-- last-commit: [2026-07-03 14:34] chore: session-stop snapshot [2026-07-03 14:34] -- .claude/project-state.md -->
<!-- interrupted: [2026-07-03 14:34] context: Reprenons où j'en étais : j'ai confirmé que les 3 fournisseurs gratuits (FMP, Finnhub, Twelve Data) bloquent tous l'hist -->
<!-- resume-from: files: .claude/project-state.md -->

## Current mission
Roadmap Phase 3/4 UX improvements, resumed after the fundamentals/valuation
pipeline was hardened against real-world API instability (this session's focus).

---

## Last completed (this session)

- **Yield-reversion valuation** (Simply Safe Dividends method): `fair_value =
  annual_div / median(TTM yield over 5y, monthly)`. Replaces flat sector-P/E
  comparison as the primary valuation method in `valorisation.js` (`_computeVal`,
  `method:'yield'`); sector-P/E stays as fallback when `fair_value` is null.
- **DSE score renormalization** (`src/dividendSafety.js`): only averages over
  factors that actually have data, instead of scoring permanently-null fields
  (fcf_payout/debt_ebitda/interest_cov) as neutral-50 forever, which had capped
  every score around ~78/100.
- **UNM investigation (root-caused via code reading, prod URL not reachable
  from this sandbox — network policy blocks it)**: fair_value stayed null
  because FMP's `/stable/dividends` 402s for non-mega-cap tickers, and the
  fetch used `tryJson` (resolves to `null` on failure) instead of throwing, so
  no fallback ever kicked in. Then found the CLIENT never even re-asked the
  server once `pe_cur` was cached (its 24h localStorage check ignored
  `fair_value`) — that was the real "nothing changes after Sync" blocker.
- **Alpha Vantage removed entirely** (commit `d0edd33`): its 25 calls/day quota
  was the reason UNM's dividend-history fallback kept failing — too tight once
  a portfolio has more than a couple of Finnhub-uncovered tickers. Removed
  `fetchAlphaVantageOverview`, `fetchAlphaVantageDividends`, `AV_KEY`, the
  `/api/debug/av-seed` mock endpoint, all `av9`/`avdiv9` KV keys.
- **Twelve Data widened as the fallback after Finnhub** (was mostly disabled):
  `fetchTwelveDataFundamentals` re-enabled in `fillFundaFallback` (previously
  commented out after an earlier 403 on `/statistics` — retried since it's the
  only remaining fallback, fails fast and harmlessly if still gated). New
  `fetchTwelveDataDividends()` (`/dividends` endpoint) as the dividend-history
  fallback for `fetchYieldReversion`, replacing Alpha Vantage's role.
- **Final fundamentals chain**: FMP profile+dividends (name/sector/beta/
  market_cap/annual_div/streak/pay_months/CAGR) → Finnhub (eps/payout/beta/
  interest_cov/debt_equity, primary, 60 req/min) → Twelve Data (secondary).
  Dividend-history chain (for yield reversion): FMP → Finnhub `/stock/dividend`
  (confirmed 403 on this account's plan, kept in case it changes) → Twelve
  Data `/dividends`. Price chain: FMP profile → Twelve Data quote.
- **Cache resilience fixes**:
  - `FV_VER` constant (now 4) stamped as `_fv_ver` alongside `_fv_tried` —
    forces exactly one retry when the fallback chain gains a new source,
    instead of a stuck `fair_value:null` blocking retries for the full
    ~120-day funda TTL.
  - Tickers with a known dividend but still no `fair_value` now get a 24h KV
    TTL instead of ~120 days, since that's usually a same-day quota miss, not
    permanent unavailability — self-heals the next day without a code change.
  - `src/fmpData.js` client cache: incomplete-check now also considers
    `fair_value`/`_fv_tried` (was `pe_cur`-only, which is why Sync silently
    no-op'd on tickers whose EPS/payout Finnhub already covered). `CACHE_KEY`
    bumped v11→v15 total across this session's fixes.
- **Debug tooling**: `/api/debug/funda` now reports `kv_fv_tried`, `kv_fv_ver`,
  `fhdiv9_hit/count`, `tddiv9_hit/count`, `yr9_hit/data`; live-test params
  renamed `tdlive`/`tddivlive` (was `avlive`/`avdivlive`).

---

## Current task
None in progress — awaiting confirmation that UNM (and ADP/HRL/APD/ACN) show
the yield-reversion label after a Sync post-deploy, and that Twelve Data's
`/statistics` and `/dividends` endpoints actually work on this account's free
plan (both were re-enabled optimistically; `/statistics` was previously
confirmed 403 — worth checking `/api/debug/funda?symbol=X&tdlive=1` and
`&tddivlive=1` to see current real status).

---

## Known blockers / notes
- FMP free plan still 402s `/stable/dividends` for all but a handful of
  popular tickers, and always 402s the 5 financial-statement endpoints
  (income-statement, key-metrics-ttm, balance-sheet, cash-flow, earnings).
- Finnhub's `/stock/dividend` confirmed 403 ("You don't have access to this
  resource") on this account — paid-plan gated. `/stock/metric?metric=all`
  (EPS/payout/beta/debt/interest) works fine on the free tier.
- Twelve Data's `/statistics` was confirmed 403 earlier this session
  ("pro/ultra/venture/enterprise only") but is re-enabled in the fallback
  chain since Alpha Vantage's removal leaves it as the only remaining
  secondary source — needs a fresh live check to confirm current status.
- `fcf_payout`/`debt_ebitda` are permanently null (no free-tier source
  anywhere) — `dividendSafety.js` renormalizes over available factors only,
  doesn't just score them neutral-50.
- Pay months for some tickers still hardcoded in `calendar.js` PAY_MONTHS map.

---

## Resume instruction
When restarting:
1. Read `architecture.md` → understand the FMP→Finnhub→TwelveData→KV→client
   pipeline (Alpha Vantage is gone, don't reintroduce it).
2. Read this file → pick up current task.
3. Check git log for the latest commit to confirm deploy state.
4. Roadmap Phase 3/4 remaining items: mobile keyboard handling, faster boot
   prefetch, dark/light theme, PDF/CSV export, watchlist alerts.
