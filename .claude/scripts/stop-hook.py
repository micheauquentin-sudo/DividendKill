#!/usr/bin/env python3
"""
Project stop hook — DividendKill
Runs before the global git-check stop hook.

1. Reads the session transcript to extract what was in progress.
2. Injects an <!-- interrupted --> snapshot into project-state.md.
3. Auto-commits project-state.md only (code files stay dirty so the global
   stop hook can prompt Claude to commit them too).
4. Pushes project-state.md so the memory survives container shutdown.
5. Always exits 0 — never blocks the stop (global hook handles that).
"""

import json
import os
import subprocess
import sys
from datetime import datetime


# ── Helpers ─────────────────────────────────────────────────────────────────

def allow():
    sys.exit(0)


def read_transcript(path):
    entries = []
    try:
        with open(path, encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    except OSError:
        pass
    return entries


def extract_context(entries, project_root):
    """
    Scan the last 40 transcript entries for:
    - files touched via Read / Edit / Write / Bash tool calls
    - last meaningful text Claude produced (what it was doing)
    Returns (set_of_relative_paths, last_task_sentence)
    """
    files = set()
    last_text = ""

    for entry in entries[-40:]:
        if entry.get('type') != 'assistant' or entry.get('isSidechain'):
            continue
        content = (entry.get('message') or {}).get('content') or []
        if not isinstance(content, list):
            continue

        for block in content:
            if not isinstance(block, dict):
                continue

            btype = block.get('type')

            # Capture last assistant text (truncated to first sentence)
            if btype == 'text':
                text = (block.get('text') or '').strip()
                if len(text) > 15:
                    # Keep only first sentence / 120 chars
                    sentence = text.split('\n')[0][:120]
                    last_text = sentence

            # Capture file paths from tool inputs
            if btype == 'tool_use':
                inp = block.get('input') or {}
                for key in ('file_path', 'path', 'filePath'):
                    raw = inp.get(key, '')
                    if raw and isinstance(raw, str):
                        # Make relative to project root
                        rel = raw.replace(project_root.rstrip('/') + '/', '')
                        if rel and not rel.startswith('/'):
                            files.add(rel)

    return files, last_text


def update_project_state(state_file, files, last_text, ts):
    """Inject two <!-- interrupted --> comment lines into project-state.md."""
    try:
        with open(state_file, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except OSError:
        return

    # Remove previous interrupted annotations
    lines = [l for l in lines
             if not l.startswith('<!-- interrupted')
             and not l.startswith('<!-- resume-from')]

    files_str = ', '.join(sorted(files)[:6]) if files else '(unknown)'
    text_str  = last_text or '(see transcript)'

    tag_ctx    = f'<!-- interrupted: [{ts}] context: {text_str} -->\n'
    tag_files  = f'<!-- resume-from: files: {files_str} -->\n'

    # Insert after line 0 (the # heading) or after the last-commit comment
    insert_at = 1
    for i, l in enumerate(lines[:4]):
        if l.startswith('<!-- last-commit:'):
            insert_at = i + 1
            break

    lines.insert(insert_at, tag_files)
    lines.insert(insert_at, tag_ctx)

    try:
        with open(state_file, 'w', encoding='utf-8') as f:
            f.writelines(lines)
    except OSError:
        pass


def git(root, *args, **kwargs):
    return subprocess.run(
        ['git', '-C', root] + list(args),
        capture_output=True, text=True, **kwargs
    )


def commit_state(root, ts):
    """Commit project-state.md only, with --no-verify to skip the post-commit hook."""
    state_rel = '.claude/project-state.md'
    # Check if it actually changed
    diff = git(root, 'diff', '--quiet', state_rel)
    if diff.returncode == 0:
        return  # no change, nothing to commit

    git(root, 'add', state_rel)
    git(root, 'commit', '--no-verify', '-q',
        '-m', f'chore: session-stop snapshot [{ts}]')

    # Push — best-effort (no retry; the global hook will catch unpushed commits)
    git(root, 'push', '-q', 'origin', 'main')


# ── Main ────────────────────────────────────────────────────────────────────

def run():
    raw = sys.stdin.read()
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except json.JSONDecodeError:
        allow()

    # Recursion guard (stop_hook_active = True when a stop hook already fired)
    if payload.get('stop_hook_active'):
        allow()

    # Only activate inside DividendKill
    cwd = payload.get('cwd') or os.getcwd()
    if 'DividendKill' not in cwd:
        allow()

    # Normalise root to the git top-level
    result = subprocess.run(
        ['git', '-C', cwd, 'rev-parse', '--show-toplevel'],
        capture_output=True, text=True
    )
    root = result.stdout.strip() if result.returncode == 0 else cwd

    state_file = os.path.join(root, '.claude', 'project-state.md')
    if not os.path.exists(state_file):
        allow()

    ts = datetime.now().strftime('%Y-%m-%d %H:%M')

    # Extract context from transcript
    transcript_path = payload.get('transcript_path') or ''
    entries = read_transcript(transcript_path)
    files, last_text = extract_context(entries, root)

    # Update and commit project-state.md
    update_project_state(state_file, files, last_text, ts)
    commit_state(root, ts)


def main():
    try:
        run()
    except Exception:
        pass  # never block the stop on any error
    allow()


if __name__ == '__main__':
    main()
