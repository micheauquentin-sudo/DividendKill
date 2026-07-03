# ROADMAP

## Phase 1 — Core stability
- [x] Portfolio CRUD (D1 + Google sync)
- [x] Dividend calculations (yield, YOC, annual income)
- [x] Live price fetching (FMP /stable/profile via KV cache)
- [x] Dividend calendar (pay months, smoothing score)
- [x] Sector breakdown panel
- [x] Deal scanner (YOC-based alerts)
- [x] Tax panel (Flat Tax 30%)
- [x] CSV import (multiple brokers)
- [x] PWA + push notifications
- [x] Pull-to-refresh
- [x] Benchmark selector
- [x] **Fix fundamentals pipeline** — FMP 402 for most tickers on free plan,
      Alpha Vantage OVERVIEW added as fallback (`av9:SYMBOL` KV cache)
- [ ] Error handling cleanup (empty states, API failures)
- [x] P/E display verified working end-to-end (root cause: AV quota, not a bug)

## Phase 2 — Infrastructure
- [ ] Better auth (session token rotation)
- [ ] User isolation hardening (D1 row-level security)
- [ ] API key rotation strategy (FMP key in secrets)
- [ ] Rate limit tuning (current: 10 req/min per IP for prices)
- [ ] Cron job monitoring / alerting

## Phase 3 — UX
- [x] Skeleton loading states (first-boot only, cleared on first price tick)
- [ ] Better mobile keyboard handling in transaction form
- [ ] Faster boot (prefetch critical tickers first)
- [ ] Dark/light theme toggle
- [ ] Export PDF / CSV

## Phase 4 — Monetization
- [ ] Premium tier (watchlist alerts, advanced analytics)
- [ ] Watchlist with target price alerts
- [ ] Multi-portfolio support
- [x] Historical dividend tracking chart (real yearly totals, Dividendes panel)
- [x] Screener (filter by yield, sector, safety score — in Valorisation panel)
