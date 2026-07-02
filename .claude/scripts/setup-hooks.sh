#!/bin/bash
# setup-hooks.sh — Install git hooks from .claude/hooks/ into .git/hooks/
# Run once per machine: bash .claude/scripts/setup-hooks.sh

set -e
ROOT="$(git rev-parse --show-toplevel)"
HOOKS_SRC="$ROOT/.claude/hooks"
HOOKS_DST="$ROOT/.git/hooks"

echo "Installing Claude git hooks..."

for hook in "$HOOKS_SRC"/*; do
  name=$(basename "$hook")
  dst="$HOOKS_DST/$name"
  cp "$hook" "$dst"
  chmod +x "$dst"
  echo "  ✓ $name"
done

echo "Done. Hooks installed in .git/hooks/"
echo ""
echo "Active hooks:"
ls -la "$HOOKS_DST/" | grep -v '^total' | grep -v '\.sample'
