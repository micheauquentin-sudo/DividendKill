# DECISIONS

## Market data provider
**Chosen:** FMP (Financial Modeling Prep)
**Endpoints:** `/stable/` only (free plan compatible)
**Rejected:** Yahoo Finance — Play Store TOS violation (PERMANENT ban)
**Rejected:** Alpha Vantage — slow, limited free tier
**Rejected:** Finnhub — considered early, FMP chosen instead

## Backend runtime
**Chosen:** Cloudflare Worker
**Reason:** Zero cold start, global edge, free KV + D1 on free plan
**Rejected:** Node.js server — cost, ops overhead

## Caching strategy
**Chosen:** Two-layer cache
1. Cloudflare KV (worker-side) — prices TTL ~5 min, funda TTL ~7 days
2. localStorage (client-side) — 24h TTL, keyed `astra_fmp_cache_v5`
**Reason:** Minimizes FMP API credit burn; free plan has limited daily calls

## KV key versioning
**Convention:** Bump suffix when stale data needs forced eviction
- `funda5:SYMBOL` — current (v5 after 4 forced migrations fixing null data)
- Client: `astra_fmp_cache_v5`
**When to bump:** Any time normalizeFunda logic changes AND old KV data has wrong shape

## FMP free plan limitations (confirmed via debug)
- No `dividendYield` in `/stable/profile` → compute as `lastDividend / price`
- No `pe` in `/stable/profile` → get from `/stable/key-metrics-ttm` (`peRatioTTM`)
- `lastDividend` = ANNUAL dividend (NOT quarterly — no ×4 needed)
- `/stable/dividends` returns `{ historical: [] }` object, NOT a flat array

## Annual dividend computation priority
1. Sum of last 12 months from `/stable/dividends` history (most accurate)
2. `p.lastDividend` from profile (fallback — less accurate for special dividends)
3. Nothing (null — UI shows 0)
**Never:** `lastDiv * 4` (wrong field + wrong calculation)

## Frontend architecture
**Chosen:** Vanilla JS (no framework)
**Reason:** SPA was already built this way; no migration cost; small bundle
**Rejected:** React/Vue — migration cost too high for no clear benefit

## Auth
**Chosen:** Google OAuth 2.0 + signed Bearer token
**Storage:** Token in localStorage, validated server-side
**Rejected:** Supabase Auth — extra dependency

## Portfolio persistence
**Chosen:** Cloudflare D1 (SQLite) as source of truth + localStorage sync
**Pattern:** Load from D1 on login, save to D1 on change, localStorage as offline cache

## Branch strategy
- `main` → production deploys (GitHub Actions on push)
- `claude/action-persistence-refresh-mbnd7l` → CI secondary branch
- All Claude work goes to `main` unless told otherwise

## Valuation method — yield reversion, not sector P/E (2026-07-03)
Reverse-engineered from a Simply Safe Dividends portfolio export: their
"Expected" fair value is pure dividend-yield reversion — fair price = where
the stock's dividend yield returns to its own 5-year average, NOT a sector
P/E norm. Sector-average P/E was judging quality compounders (ADP) overvalued
and low-P/E insurers (UNM) undervalued — both backwards.
- Server `fetchYieldReversion()`: 5y FMP historical prices (cached yr9:SYMBOL),
  median trailing-12mo yield, fair_value = annual_div / median_yield.
- Client valorisation `_computeVal`: price/fair_value bands <0.95 under,
  >1.20 over (asymmetric, matches SSD's lenient "may be undervalued").
- Validated 90% band agreement vs 21 real SSD holdings; all user-flagged
  tickers (ADP/HRL/UNM/ACN/APD) match SSD.
- Fallback to sector-P/E (quality-adjusted) only when fair_value unavailable
  (non-dividend payer or no price history).

## DSE score renormalization (2026-07-03)
fcf_payout/debt_ebitda/interest_cov come only from FMP paid statements (402
on free plan), so they're structurally always-missing now. Scoring them as
neutral 50 capped the max DSE at ~78 for everyone. Fixed: renormalize the
weighted average over only the factors actually available per stock. Finnhub
later recovered interest_cov (netInterestCoverageTTM /100) and debt_equity
(→ debt_ebitda approximation); FCF payout deliberately NOT derived from
Price/FCF (too price-sensitive, tanked scores).

## Audit sécurité & durcissement (2026-07-04)
Audit OWASP complet du Worker + SPA. 11/12 constats corrigés et déployés
(commits 1a89f7e, 357a2c5, c34ec5e). Fondamentaux déjà sains (SQL paramétré,
cookies HttpOnly/Secure/SameSite=Lax, JWT vérifié).
Corrigés :
- C-1 logout révoque le refresh token (cookie + DB) ; C-2 deleteAccount purge
  refresh_tokens + push_subscriptions et efface les bons cookies (dk_session/
  dk_refresh, pas "session="). Cron purge les refresh tokens expirés. Logout
  client vide le cache localStorage astra_*/dk_*.
- H-1 validateTx() partagé appliqué au /api/restore (ne bindait rien avant),
  plus de tx.id client, settings restreints à l'allowlist. H-2 /api/debug/*
  derrière auth (consommaient le quota FMP + fuite métadonnées clés).
- M-1 _esc() sur les noms d'entreprise (données FMP) en innerHTML.
- M-3 PBKDF2 100k→600k avec ré-hash progressif au login (format iter:salt:hash,
  rétro-compatible). M-4 CORS ACAO '*' → APP_ORIGIN. Rate-limit auth fail-closed.
  L-3 fetchRetry (backoff, timeout) sur le chemin prix. L-1 hypothèse OAuth
  documentée.
RESTE : M-2 (retrait unsafe-inline de la CSP) — refactor de fond touchant chaque
onclick inline, reporté à une passe dédiée avec vérif live. IMPORTANT : les flux
auth (login/logout/suppression compte) ont été modifiés — vérifiés en isolation
(round-trip PBKDF2) mais PAS en live contre la prod (sandbox sans accès réseau) ;
à re-tester après déploiement. Détail complet dans l'artifact audit.

## 2026-07-07 — Taux EUR/USD dynamique + purge du code mort (audit)
Branche claude/dividendkill-repo-audit-8kbypn.
- **EUR/USD n'est plus codé en dur** (Config.EURUSD = 1.1611 dérivait depuis des
  mois). Nouveau `GET /api/fx` dans le worker : Twelve Data /exchange_rate
  (endpoint "Core Data", gratuit comme /time_series), cache KV `fx:EURUSD` 24h,
  entrée conservée 7j pour servir une valeur périmée si l'API échoue. Client :
  Config.EURUSD initialisé depuis localStorage `dk_fx_eurusd` (dernier taux
  connu), rafraîchi au boot via /api/fx (lecture dynamique par toE()/eu(), un
  simple `Config.EURUSD = rate` + recompute suffit). Bornes de vraisemblance
  [0.5, 2] des deux côtés. 1.1611 reste le filet ultime (premier boot hors ligne).
- **Code mort supprimé** : index.html racine (5108 lignes, ancienne app
  monolithique — Vite builde depuis src/, le worker sert dist/), wrangler.jsonc
  racine (config fantôme en conflit avec worker/wrangler.toml utilisé par le CI),
  worker/migrate-localstorage.js (script one-shot terminé), bloc Data.PERF
  (série NAV factice) + constantes EURUSD/NAV_EUR/PERF inutilisées de ui.js et
  NAV_EUR/PFU/YF_BASE de config.js. Calc.eu() simplifié en () => Config.EURUSD.
- Vérifié : 40 tests unitaires + 10 e2e Playwright verts, build OK (bundle
  index 97.7→96.3 kB).

## 2026-07-07 — Suite de tests worker (audit, suite)
tests/worker.test.js (51 tests) : le worker n'avait AUCUNE couverture alors que
c'est le code le plus sensible (auth + argent). Couvre : validateTx (types,
ticker XSS, dates, bornes shares/price/amount), hashPassword/verifyPassword
(round-trip, format legacy salt:hash, needsRehash sur itérations inférieures —
hashes de référence générés via node:crypto pbkdf2Sync), signJWT/verifyJWT
(expiration, signature altérée, payload forgé, mauvais secret),
computeStreak/computeDivCAGR5y/extractPayMonths (tolérance 2%, années
partielles), normalizeFunda/normalizeProfile (formats FMP confirmés),
isRateLimited (fail-open vs fail-closed, KV en erreur), et dividendScore.js
(bandes de score, entrée vide/garbage sans crash, profil sain → Safe+confiance
haute, pénalités payout intenable, streakHint). Pour rendre ça testable :
exports nommés ajoutés en fin de worker/src/index.js (sans effet runtime —
Workers n'utilise que l'export default ; vérifié par esbuild --bundle).
Total suite : 91 tests verts.
