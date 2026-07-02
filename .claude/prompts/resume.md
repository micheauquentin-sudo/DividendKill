# RESUME PROMPT

Read in this exact order — stop reading once you have enough context to act:

1. `.claude/project-state.md` → what's the current task and next 3 actions?
2. `.claude/architecture.md` → remind yourself of the FMP pipeline and KV key schema
3. `.claude/bugs.md` → any critical bugs open?
4. `.claude/decisions.md` → if the task involves data or API: check constraints first

Then:
- Read ONLY the files listed in "Files touched" from project-state.md
- Resume the current task from "Next actions" step 1
- Do NOT re-analyse the whole codebase
- Do NOT repeat what was already done

If project-state.md says "Done" on the current task:
- Read `.claude/roadmap.md`
- Pick the next unchecked item in the current phase
- Update project-state.md with the new mission before starting
