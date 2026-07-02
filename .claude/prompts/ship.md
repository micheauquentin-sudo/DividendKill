# SHIP PROMPT

## Pre-flight checklist

### Security
- [ ] No API keys in source code (FMP_KEY, PORTFOLIO_TOKEN must be in Cloudflare secrets)
- [ ] No Yahoo Finance URLs or imports
- [ ] Rate limiting active on `/api/prices` and `/api/funda`
- [ ] Auth token validated server-side before any D1 write

### Data correctness
- [ ] `normalizeProfile` uses confirmed FMP field names (see decisions.md)
- [ ] `normalizeFunda` uses confirmed FMP field names
- [ ] KV cache key is current (`funda5:` in worker, `v5` in client)
- [ ] `annual_div` computed from dividend history first, profile fallback second

### Build
```bash
npm run build         # Vite frontend
npm test              # Unit tests
```
- [ ] Build succeeds with no errors
- [ ] Tests pass

### Deployment
CI/CD deploys automatically on `git push origin main`
- [ ] Check GitHub Actions run: `.github/workflows/deploy-worker.yml`
- [ ] After deploy (~2 min): verify `https://divkiller.michooo-45.workers.dev`

### Smoke test (manual)
1. Open app → import a portfolio
2. Wait 5 sec → check YIELD, P/E, DIV./AN show non-zero values
3. Check calendar panel → bars should show correct months
4. Use transaction form → search for a ticker NOT in portfolio → should find it

### After ship
- Update `.claude/roadmap.md` → mark completed items
- Update `.claude/project-state.md` → set new mission
- Commit `.claude/` changes
