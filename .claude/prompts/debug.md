# DEBUG PROMPT

## Step 1 — Read constraints first
Read `.claude/decisions.md` → check FMP field names table before touching any data code.
Read `.claude/bugs.md` → is this bug already known?

## Step 2 — Use the debug endpoint
For any fundamentals issue (yield 0, P/E 0, div 0):
```
GET /api/debug/price?symbol=TICKER&live=1
```
Check: `fmp_profile_lastDividend`, `fmp_profile_keys`, `funda_cached`

For price issues:
Check: `regularMarketPrice`, `quote_from_kv`

## Step 3 — Minimal fix only
- Find the root cause in ONE file
- Apply the smallest possible change
- Do not refactor surrounding code
- Do not add error handling for impossible states

## Step 4 — Cache invalidation
If fixing a `normalizeFunda` or `normalizeProfile` bug:
- Bump KV key: `funda5:` → `funda6:` (3 occurrences in worker/src/index.js)
- Bump client cache: `astra_fmp_cache_v5` → `v6` in src/fmpData.js
- Both must be bumped together

## Step 5 — Update state
After fix:
- Update `.claude/bugs.md`: move from Critical/Medium to Fixed
- Update `.claude/project-state.md`: files touched, next actions
- Commit: `git add .claude/ <changed files> && git commit -m "fix: ..."`
- Push: `git push origin main`
