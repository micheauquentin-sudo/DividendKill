# DividendKill — Claude Memory System

## Boot protocol (MANDATORY — run on every session start)

1. Read `.claude/rules.md` — behavioral constraints
2. Read `.claude/project-state.md` — what's in progress RIGHT NOW
3. Read `.claude/architecture.md` — stack and data flow
4. Read `.claude/roadmap.md` — what's next
5. Read `.claude/bugs.md` — known issues
6. Do NOT re-analyse the whole codebase. Pick up the current task only.

## Slash prompts

| Command           | What it does                        |
|-------------------|-------------------------------------|
| `/resume`         | Load `.claude/prompts/resume.md`    |
| `/debug`          | Load `.claude/prompts/debug.md`     |
| `/refactor`       | Load `.claude/prompts/refactor.md`  |
| `/ship`           | Load `.claude/prompts/ship.md`      |

## State update rule

After every significant change:
- Update `.claude/project-state.md` (current task, files touched, next actions)
- Update `.claude/bugs.md` if a bug was found or fixed
- Update `.claude/decisions.md` if an architectural choice was made
- Commit with `git add .claude/ && git commit -m "chore: update claude memory"`
