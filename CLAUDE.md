# DividendKill — Claude Memory System

## AUTOMATIC AGENT ROUTING (mandatory)

**Before starting any task**, invoke the `orchestrator` agent.
It will identify the correct specialist and route the work.
Never attempt architecture, backend, UI, bug fixes, reviews, security audits, or deploys directly — always go through the orchestrator first.

Available agents:
- `architect` — module structure, scalability, tech debt
- `backend` — Cloudflare Worker, FMP API, KV cache
- `frontend` — DOM, panels, calendar, UI rendering
- `debug` — root cause analysis, minimal patch
- `reviewer` — code quality, anti-patterns, performance
- `security` — API key leaks, XSS, injection, CORS
- `deploy` — wrangler, CI/CD, env vars, production

---

## Boot protocol (run on every session start)

1. Read `.claude/rules.md` — behavioral constraints
2. Read `.claude/project-state.md` — what's in progress RIGHT NOW
3. Read `.claude/architecture.md` — stack and data flow
4. Read `.claude/roadmap.md` — what's next
5. Read `.claude/bugs.md` — known issues
6. Do NOT re-analyse the whole codebase. Pick up the current task only.

---

## Slash prompts

| Command | What it does |
|---|---|
| `/resume` | Load `.claude/prompts/resume.md` |
| `/debug` | Load `.claude/prompts/debug.md` |
| `/refactor` | Load `.claude/prompts/refactor.md` |
| `/ship` | Load `.claude/prompts/ship.md` |

---

## State update rule

After every significant change:
- Update `.claude/project-state.md` (current task, files touched, next actions)
- Update `.claude/bugs.md` if a bug was found or fixed
- Update `.claude/decisions.md` if an architectural choice was made
- Commit with `git add .claude/ && git commit -m "chore: update claude memory"`
