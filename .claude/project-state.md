# PROJECT STATE
<!-- last-commit: [2026-07-03 08:48] feat: use Finnhub as primary fundamentals fallback, Alpha Vantage as backup -- worker/src/index.js worker/wrangler.toml -->
<!-- interrupted: [2026-07-03 08:38] context: Poussé et déployé (~1-2 min). Prochaine étape : -->
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

---

## Current task
None in progress — awaiting next user request.

---

## Files touched (this session)
- `worker/src/index.js` — `/api/debug/av-seed` (+ `action=clear`), `av_key_set`/
  `av_key_len`, `?avlive=1` live AV test (key redacted from response)
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
  popular tickers — Alpha Vantage OVERVIEW is the permanent fallback
  (`av9:SYMBOL` KV cache, 7-day TTL, 25 calls/day quota).
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
