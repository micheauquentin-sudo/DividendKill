# ARCHITECTURE

## Stack
| Layer     | Tech                              |
|-----------|-----------------------------------|
| Frontend  | Vanilla JS + Vite (no framework)  |
| Backend   | Cloudflare Worker (`worker/src/index.js`) |
| DB        | Cloudflare D1 (SQLite) — user portfolios |
| Cache     | Cloudflare KV (`PRICES_KV`)       |
| Storage   | Cloudflare R2 (`BACKUPS`)         |
| Market data | FMP (Financial Modeling Prep) — `/stable/` endpoints ONLY |
| Auth      | Google OAuth 2.0 + Bearer token   |
| CI/CD     | GitHub Actions → Cloudflare Worker deploy |
| Hosting   | Cloudflare Pages (static) + Worker (API) |

## Worker URL
`https://divkiller.michooo-45.workers.dev`

## Folder structure
```
DividendKill/
├── src/                   # Frontend (Vite SPA)
│   ├── ui.js              # Main UI orchestrator — boot, panels, FAB
│   ├── data.js            # In-memory store (raw[], meta{}, assets{})
│   ├── fmpData.js         # FMP client cache (localStorage v5)
│   ├── marketData.js      # Price polling via /api/prices
│   ├── calc.js            # Portfolio calculations (eu, getMV, toE…)
│   ├── dividendSafety.js  # Safety score algorithm
│   ├── dividendTiers.js   # Yield badge tiers
│   ├── storage.js         # IndexedDB persistence (loadFundamentals/saveFundamentals)
│   ├── brokerImport.js    # CSV import parsers
│   └── panels/            # One file per panel
│       ├── rendement.js   # Portfolio table
│       ├── calendar.js    # Dividend calendar
│       ├── dividendes.js  # Income panel
│       ├── deal.js        # Deal scanner
│       ├── valorisation.js# Valuation panel
│       ├── secteurs.js    # Sector breakdown
│       ├── impots.js      # Tax panel
│       └── import.js      # Import panel
├── worker/
│   └── src/index.js       # Cloudflare Worker — ALL API logic
└── .github/workflows/     # CI/CD
    └── deploy-worker.yml
```

## KV key schema
| Key pattern          | Content                          | TTL        |
|----------------------|----------------------------------|------------|
| `p:SYMBOL`           | Normalized price quote (JSON)    | ~5 min     |
| `funda5:SYMBOL`      | Normalized fundamentals (JSON)   | ~7 days    |
| `rl:*`               | Rate limit counters              | 2 min      |
| `rl:email:*`         | Email-based rate limit           | 30 min     |

## API endpoints (Worker)
| Route                   | Purpose                              |
|-------------------------|--------------------------------------|
| `GET /api/prices`       | Batch price fetch → KV cache         |
| `GET /api/funda`        | Per-ticker fundamentals → KV cache   |
| `GET /api/search`       | Ticker search (FMP /stable/search)   |
| `GET /api/debug/price`  | Debug raw FMP profile data           |
| `POST /api/portfolio`   | Save portfolio to D1                 |
| `GET /api/portfolio`    | Load portfolio from D1               |

## FMP fundamentals pipeline
```
Client boot
  └─► FmpData.prefetch(tickers)
        └─► GET /api/funda?symbol=X        (per ticker)
              └─► KV funda5:X hit?
                    ├─ YES → return cached JSON
                    └─ NO  → fetch FMP /stable/profile
                                    + /stable/key-metrics-ttm
                                    + /stable/dividends
                           → normalizeFunda()
                           → KV.put(funda5:X)
                           → return normalized JSON
  └─► FmpData.mergeIntoAssets(ticker, assets)
        └─► sets: sector, beta, market_cap, pe_cur,
                  payout_ratio, pay_months, d (annual_div),
                  name, streak
```

## Price pipeline
```
Client boot
  └─► MarketData.refreshAll(tickers, callback)
        └─► GET /api/prices?symbols=A,B,C  (batch)
              └─► per symbol: KV p:SYMBOL hit?
                    ├─ YES → return cached
                    └─ NO  → fetch FMP /stable/profile
                           → normalizeProfile()
                           → KV.put(p:SYMBOL, TTL=5min)
  └─► callback(ticker, quote)
        └─► updates Data.meta[ticker].price, .d (if quote.annual_div), etc.
```

## Client data model
```js
// data.js
raw[]        // array of positions: { ticker, qty, avg, price, mv, pnl, ... }
meta{}       // per-ticker live data: { price, d, div_yield, pe, market_cap, ... }
assets{}     // per-ticker fundamentals from FmpData: { sector, beta, d, pay_months, ... }
```

## Cron job
- Schedule: Mon-Fri 22:30 UTC
- Action: refresh `funda5:SYMBOL` for all tickers in D1 portfolios
