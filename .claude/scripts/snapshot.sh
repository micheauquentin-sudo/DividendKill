#!/bin/bash
# snapshot.sh — Capture current project state into project-state.md
# Run manually: bash .claude/scripts/snapshot.sh
# Or call from a git hook.

set -e
ROOT="$(git rev-parse --show-toplevel)"
STATE="$ROOT/.claude/project-state.md"

echo "📸 Snapshot: $(date '+%Y-%m-%d %H:%M')"
echo ""
echo "Last 5 commits:"
git log --oneline -5
echo ""
echo "Modified files (uncommitted):"
git status --short | head -20
echo ""
echo "Current branch: $(git branch --show-current)"
echo ""
echo "State file: $STATE"
echo "Update it now with your current task, next actions, and files touched."
echo ""
echo "Then commit: git add .claude/ && git commit -m 'chore: update claude memory'"
