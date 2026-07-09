# BUGS

## Critical
*(none currently open)*

## Fixed (incident 2026-07-09 — épuisement quota FMP/Finnhub, tout le portefeuille dégradé)
- [x] **Régression auto-infligée (commit 4b1bf72, "fix transitoire" du 2026-07-08)** :
  en ne posant plus `_fv_ver` sur un échec transitoire de la réversion, j'ai créé un
  bug bien pire que celui que je corrigeais — `_fv_ver` gate TOUT le pipeline
  `fmpProxy` (profil FMP + Finnhub + réversion + score), pas seulement la réversion.
  Tant que l'historique de prix FMP échouait pour un ticker (quota), CHAQUE requête
  `/api/funda` re-déclenchait le pipeline complet au lieu d'attendre le TTL prévu
  (24h). Combiné aux retries déjà ajoutés sur cet appel, ça a épuisé le quota
  FMP+Finnhub en quelques Sync → P/E N/A, payout N/A, DSE effondré à 25 ("Danger"),
  fair_value N/A (même le fallback P/E sectoriel a cessé de produire une cible) —
  sur TOUT le portefeuille (ADP, UNM, ACN…), pas juste le ticker visé au départ.
  → Fix : revenu à `_fv_ver` TOUJOURS posé (succès/structurel/transitoire) ; le TTL
  "fvPending" (24h, déjà existant) est le mécanisme de retry voulu, pas l'absence
  de version. FV_VER 6→7.
- [x] **Bug préexistant du même type, jamais corrigé** (noté "Moyenne priorité" dans
  l'audit initial) : `cached.pe_cur == null` seul, sans aucun marqueur de version,
  forçait un refetch complet à chaque requête pour tout ticker sans P/E résoluble
  (Finnhub ET Twelve Data sans donnée) — sans jamais respecter le TTL de 6h déjà
  calculé pour ce cas. A amplifié l'incident ci-dessus. → Fix : nouveau marqueur
  `_fallback_ver` (FALLBACK_VER=1), posé systématiquement après `fillFundaFallback`
  (trouvé ou non), même mécanisme que `_fv_ver`/`_dse2_ver`.
- Client (`fmpData.js`) : `_isIncomplete` mis à jour en miroir (EXPECTED_FV_VER=7,
  EXPECTED_FALLBACK_VER=1), CACHE_KEY v20→v21 pour repartir d'un état propre.
- Leçon retenue : un champ de version qui gate un pipeline entier ne doit JAMAIS
  rester non posé sur un échec, même "pour retenter plus vite" — le TTL est le bon
  levier de cadence de retry, pas la présence/absence de la version.

## Fixed (audit 2026-07-07, branche claude/dividendkill-repo-audit-8kbypn)

## Fixed (audit 2026-07-07, branche claude/dividendkill-repo-audit-8kbypn)
- [x] **NaN sur les retenues fiscales** — les transactions dividende rechargées depuis
  D1 (storage.js) n'avaient pas de champ `tax_withheld` → `totalTaxPaid += undefined`
  = NaN dans calc.js, propagé au panneau Impôts. Fix : fallback `|| 0` + champ ajouté
  au mapping D1.
- [x] **Icône push cassée** — sw.js référençait `/icons/icon-192.png` alors que le
  fichier est servi à la racine (`/icon-192.png`).
- [x] **Injection possible dans les suggestions de recherche** — `r.symbol` (API FMP)
  inséré brut dans un attribut onclick + HTML dans `_fabDoSearch` ; nom d'actif non
  échappé dans `_fabOfflineSearch` ; `e.message` non échappé dans renderPanel.
- [x] **Worker** : paramètre `days` de /api/prices/history non borné (NaN/négatif
  interpolé dans le SQL) ; `amount` non validé dans validateTx.

## Medium
- **Skeleton/blank states during boot** — panels show empty while prices + funda load
  → No loading indicator; user sees zeros until both promises resolve
  → Fix: add skeleton UI or "Chargement…" state in renderPanel

- **P/E still 0** (status: deploy pending) — `normalizeFunda` was using `p.pe` which
  doesn't exist in FMP free plan; now reads `m.peRatioTTM` from key-metrics-ttm
  → Verify after funda5 KV cache populates (~first user visit post-deploy)

## Low
- **PAY_MONTHS map in calendar.js** — hardcoded for ~20 tickers; all others derive
  pay months from FMP dividend history. Map needs periodic updates.
  → Low priority since FMP history now works

- **Search shows only portfolio tickers when offline** — fallback to portfolio search
  only; "Saisie manuelle" option added but UX could be cleaner

## Fixed
- [x] `normalizeProfile` wrong field names: `lastDiv`, `mktCap`, `volAvg`, `dividendYield`, `pe`
      → All corrected to confirmed FMP field names (commit 9aa1348)
- [x] `normalizeFunda` `p.lastDiv * 4` — `lastDividend` is already ANNUAL
      → Fixed to `+p.lastDividend` (commit 9aa1348)
- [x] `normalizeFunda` `p.mktCap` → `p.marketCap` (commit 9aa1348)
- [x] KV stale null cache — bumped funda4→funda5, client v4→v5 (commit 9aa1348)
- [x] FMP dividends wrapped format `{ historical: [] }` — normalized to flat array
- [x] Calendar NaN for stocks without dividend data — `(a.d||0)` guard
- [x] Search can't add tickers not in portfolio — "Saisie manuelle" option + FMP v3 fallback
- [x] Panel not re-rendering after FmpData loads — added renderPanel in bootFmpPromise callback
- [x] Multiple stale KV cache rounds (funda→funda2→funda3→funda4→funda5)
- [x] Wrong git branch for commits (force-push early in session)
- [x] Duplicate API call on load
- [x] Deal cards regression after large refactor
- [x] News panel duplicate header

## Fixed (new)
- [x] **P/E N/A for ADP/UNM/MMM/ACN/HRL/APD** — root cause confirmed via `avlive=1`:
  `av_key_set:true` (secret correctly bound), AV returned `Note` = free-tier 25 req/day
  quota exhausted from same-day testing. Not a code bug — resets daily; normal Sync
  usage (7-day KV cache per ticker) won't hit this limit in practice.
  → Fixed a real bug found along the way: AV's rate-limit error echoes the API key in
  plaintext, and the public/unauthenticated `/api/debug/funda?avlive=1` endpoint was
  leaking it. Redacted (commit 7adbd06).

## Debug endpoint
`GET /api/debug/price?symbol=APD&live=1`
→ Shows raw FMP profile keys, `lastDividend`, `marketCap`, `averageVolume` values

`GET /api/debug/funda?symbol=APD` → `av_key_set`/`av_key_len` (is AV_KEY bound?) + KV state
`GET /api/debug/funda?symbol=APD&avlive=1` → live Alpha Vantage OVERVIEW call, raw status+body
→ Use this first when diagnosing any fundamentals issue
