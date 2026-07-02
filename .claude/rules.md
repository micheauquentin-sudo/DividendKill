# CLAUDE RULES

## Session start (non-negotiable)
1. Read project-state.md
2. Read architecture.md
3. Read roadmap.md
4. Resume current task — do NOT restart analysis from scratch

## Code rules
- **Yahoo Finance is FORBIDDEN** — Play Store TOS violation. FMP only.
- FMP: use `/stable/` endpoints exclusively (free plan)
- Never hardcode API keys — they live in Cloudflare secrets (`FMP_KEY`)
- Keep functions short and single-purpose
- No over-engineering — solve only what's asked
- No comments explaining WHAT the code does — only WHY if non-obvious

## FMP field names (confirmed via debug — do not change)
| Wrong (old)      | Correct              | Notes                        |
|------------------|----------------------|------------------------------|
| `lastDiv`        | `lastDividend`       | ANNUAL value, no ×4 needed   |
| `mktCap`         | `marketCap`          |                              |
| `dividendYield`  | *(doesn't exist)*    | Compute: lastDividend/price  |
| `pe`             | *(doesn't exist)*    | Use key-metrics-ttm instead  |
| `volAvg`         | `averageVolume`      |                              |

## Cache keys (bump when forcing fresh data)
- KV worker: `funda5:SYMBOL` (currently funda5)
- Client localStorage: `astra_fmp_cache_v5` (currently v5)
- Client prices: `astra_price_cache_v*`

## Git rules
- Push to `main` unless told otherwise
- Branch `claude/action-persistence-refresh-mbnd7l` is secondary / CI
- Never push Yahoo Finance code
- Update `.claude/` files after each major task, commit them too

## Token economy
- Read only modified files, not the whole repo
- Never repeat full function bodies in chat
- Be concise — one sentence per status update
