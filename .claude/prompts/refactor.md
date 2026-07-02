# REFACTOR PROMPT

## Constraints (read before touching anything)
- Yahoo Finance: NEVER
- FMP fields: see `.claude/decisions.md` — do not rename confirmed field mappings
- KV key schema: do not change without bumping the version suffix

## Scope
Refactor ONLY the files named in the task. Do not:
- Touch unrelated panels
- Change the public API of any module
- Add new abstractions unless explicitly asked
- Move files to new locations without updating all imports

## Checklist before committing
- [ ] `grep -r "yahoo"` → should return 0 results
- [ ] `grep -r "lastDiv[^i]"` → should return 0 results (use `lastDividend`)
- [ ] `grep -r "mktCap"` → should return 0 results (use `marketCap`)
- [ ] `npm test` passes
- [ ] Panels still render (open app in browser or run e2e)

## After refactor
- Update `.claude/project-state.md`
- Commit `.claude/` + changed files together
