# PROJECT STATE
<!-- last-commit: [2026-07-03 10:12] chore: session-stop snapshot [2026-07-03 10:12] -- .claude/project-state.md -->
<!-- interrupted: [2026-07-03 10:12] context: Poussé et déployé (~1-2 min). Teste : -->
<!-- resume-from: files: worker/src/index.js -->

## Current mission
Roadmap Phase 3/4 UX improvements, picked after the FMP/Alpha Vantage
fundamentals pipeline was confirmed fixed (P/E, payout, safety all display
correctly end-to-end via AV fallback for FMP-402'd tickers).

---

## Last completed (this session)
- **P/E N/A root cause**: confirmed via `/api/debug/funda?avlive=1` — AV_KEY is
  correctly bound, free-tier AV quota (25/day) was exhausted from testing.
  Not a bug; resets daily. Also fixed a real leak: AV's rate-limit error echoes
  the API key in plaintext, and the public debug endpoint relayed it — redacted.
- **Skeleton loading states** (roadmap Phase 3 + bugs.md medium item): added
  `_loadingSkeleton()` in `ui-shared.js` + `.dk-skel` shimmer class in
  `style.css`. `ui.js` shows it only on a true first-boot (positions exist but
  `MarketData.getCacheInfo().total === 0`), cleared on first price tick.
- **Screener** (roadmap Phase 4): added sector/yield-min/safety-min filter bar
  directly into the existing Valorisation panel (`src/panels/valorisation.js`)
  — reuses its card list rather than a new nav tab.
- **Dividend history chart** (roadmap Phase 4): new "📊 Historique" mode in
  `src/panels/dividendes.js` (`renderHistory`) — real yearly totals from
  `Data.transactions` (type `dividend`), bar chart + per-year top contributors.
- All 3 verified end-to-end with Playwright against the built app (mocked
  auth/API routes), not unit tests — screenshots confirmed correct rendering,
  filtering, and skeleton→real-data transition.
- **Finnhub added as primary fundamentals fallback**: confirmed live via
  `/api/debug/finnhub?symbol=APD` that Finnhub's free tier (60 req/min) returns
  P/E, EPS, payout, beta for tickers FMP 402s — no per-ticker blocking like FMP.
  `fillFundaFallback()` now tries Finnhub before Alpha Vantage (25/day, kept as
  backup only). Requires `FINNHUB_KEY` secret. KV cache key `fh9:SYMBOL`, 7d TTL.
- **P/E always self-computed**: removed every provider's own P/E field
  (FMP `peRatioTTM`, Finnhub `peXxxTTM`, AV `PERatio`) from the pipeline.
  `pe_cur` is now ALWAYS `price / eps` computed by us — providers only ever
  supply `eps`. Avoids inconsistent numbers from differing TTM/forward/diluted
  methodologies across sources.
- **Twelve Data added for price** (fallback after FMP, confirmed working free)
  **and attempted for fundamentals** — confirmed via `/api/debug/twelvedata`
  that `/statistics` 403s on the free plan ("pro/ultra/venture/enterprise
  only"). The fundamentals call is commented out in `fillFundaFallback`
  (dead weight otherwise); `fetchTwelveDataFundamentals()` stays in the code
  in case the plan is upgraded later. Price fallback (`fetchTwelveDataQuote`
  in `priceProxy`) is active. Requires `TWELVEDATA_KEY` secret.
- **Fundamentals pipeline slimmed down**: FMP's 5 always-402 endpoints
  (income-statement, key-metrics-ttm, balance-sheet, cash-flow, earnings)
  removed entirely — `normalizeFunda(rawProfile, rawDivs)` now takes 2 params
  instead of 7, and both `fmpProxy`/cron `refreshFunda` only fetch FMP
  `/profile` + `/dividends` (2 calls instead of 7 per ticker). Finnhub is now
  the de-facto primary source for eps/payout/beta in practice. fcf_payout/
  debt_ebitda/interest_cov are permanently null now (no source provides them
  on any free tier used here) — safe, `dividendSafety.js` already scores
  null fields as neutral (50/100), not zero.
- **Final fundamentals chain**: FMP profile+dividends (name/sector/beta/
  market_cap/annual_div/streak/pay_months/CAGR) → Finnhub (eps/payout/beta,
  primary) → Alpha Vantage (secondary, 25/day) → [Twelve Data disabled, 403].
  Price chain: FMP profile → Twelve Data quote.

---

## Current task
None in progress — awaiting next user request.

---

## Files touched (this session)
- `worker/src/index.js` — `/api/debug/av-seed` (+ `action=clear`), `av_key_set`/
  `av_key_len`, `?avlive=1` live AV test (key redacted from response),
  `/api/debug/finnhub`, `fetchFinnhubMetrics()`, `fillFundaFallback()`
- `worker/wrangler.toml` — documented `FINNHUB_KEY`/`AV_KEY` secrets
- `src/fmpData.js` — CACHE_KEY bumped v9→v11 (mock-data purge + tightened
  incomplete check to `pe_cur == null` only, matching server logic)
- `src/ui.js` — boot skeleton flag/dispatch, `_loadingSkeleton` import
- `src/ui-shared.js` — `_loadingSkeleton()` helper
- `src/style.css` — `.dk-skel` shimmer class
- `src/panels/valorisation.js` — screener filter bar + state
- `src/panels/dividendes.js` — `renderHistory()` + 3rd mode switcher button

---

## Known blockers / notes
- FMP free plan still 402s financial statements for all but a handful of
  popular tickers — Finnhub (primary) → Alpha Vantage (backup) cover the gap.
- **Important**: tickers whose `funda9:SYMBOL` KV entry already has a non-null
  `pe_cur` (e.g. from earlier AV-mock testing) are cached for ~120 days and
  won't automatically switch to Finnhub data. If a ticker still shows old/mock
  values, clear it: `/api/debug/av-seed?action=clear` (covers the 18 tickers
  used for mock testing) or delete `funda9:SYMBOL` for a specific ticker.
- Mock AV seed endpoint (`/api/debug/av-seed`) exists for testing without
  burning AV quota — remember to `?action=clear` before relying on live data.
- Pay months for some tickers still hardcoded in `calendar.js` PAY_MONTHS map.

---

## Resume instruction
When restarting:
1. Read `architecture.md` → understand the FMP→AV→KV→client pipeline
2. Read this file → pick up current task (none pending as of last session)
3. Check git log for the latest commit to confirm deploy state
4. Roadmap Phase 3/4 remaining items: mobile keyboard handling, faster boot
   prefetch, dark/light theme, PDF/CSV export, watchlist alerts
