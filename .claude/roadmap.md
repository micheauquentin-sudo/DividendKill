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
- [ ] **Fix fundamentals pipeline** ← IN PROGRESS (funda5 deploy pending verify)
- [ ] Error handling cleanup (empty states, API failures)
- [ ] P/E display verified working end-to-end

## Phase 2 — Infrastructure
- [ ] Better auth (session token rotation)
- [ ] User isolation hardening (D1 row-level security)
- [ ] API key rotation strategy (FMP key in secrets)
- [ ] Rate limit tuning (current: 10 req/min per IP for prices)
- [ ] Cron job monitoring / alerting

## Phase 3 — UX
- [ ] Skeleton loading states (currently blank during boot)
- [ ] Better mobile keyboard handling in transaction form
- [ ] Faster boot (prefetch critical tickers first)
- [ ] Dark/light theme toggle
- [ ] Export PDF / CSV

## Phase 4 — Monetization
- [ ] Premium tier (watchlist alerts, advanced analytics)
- [ ] Watchlist with target price alerts
- [ ] Multi-portfolio support
- [ ] Historical dividend tracking chart
- [ ] Screener (filter by yield, sector, safety score)
