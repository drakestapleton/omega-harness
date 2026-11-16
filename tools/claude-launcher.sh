#!/bin/bash
# Maintained existing Claude launcher. Coordination is a role, not a named-chat key.
# Agent lifecycle authorization and preservation of active work are in the generated rules.
REAL=$(ls -1d "$HOME"/.local/share/claude/versions/* 2>/dev/null | sort -V | tail -1)
[ -x "$REAL" ] || { echo "claude guard: no claude binary under ~/.local/share/claude/versions" >&2; exit 127; }
exec "$REAL" "$@"
