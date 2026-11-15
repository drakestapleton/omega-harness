#!/bin/sh
# regen.sh OMC [OMEGA_MCP]: after PIN changes, regenerate everything derived from it.
#
# Builds tools/jflat.om and tools/guides.om with OMC (its sha256 must be PIN's omc-sha256), finds the
# newest omega-mcp commit whose data/reference.json is the reference data for PIN (guides pinof decides),
# writes it flattened to data/reference.tsv with its provenance in data/SOURCE, then rewrites every
# generated block (`git ls-files | guides gen`). OMEGA_MCP is a clone URL or git directory of omega-mcp:
# default the Interplane git repository. Run in the repository root.
# This file is invocation glue; the decisions are made by the Omega programs it builds.
# Exit 0 regenerated, 1 guides gen reported findings, 2 usage, pin or I/O error.
set -u
[ "$#" -ge 1 ] || { sed -n '2,10s/^# \{0,1\}//p' "$0" >&2; exit 2; }
omc=$1
mcp=${2:-}
forge=https://interplane.io/projects/omega-mcp/repo.git
if [ -z "$mcp" ]; then
    mcp=$forge
fi
[ -f PIN ] && [ -d tools ] || { echo "regen: run in the omega-harness root" >&2; exit 2; }
want=$(sed -n 's/^omc-sha256 //p' PIN)
got=$(sha256sum "$omc" 2>/dev/null | cut -d' ' -f1)
[ -n "$want" ] && [ "$got" = "$want" ] || { echo "regen: omc sha256 ${got:-unreadable}, PIN wants $want" >&2; exit 2; }
unset GIT_DIR GIT_NAMESPACE GIT_WORK_TREE
export GIT_TERMINAL_PROMPT=0
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
mkdir -p build
for t in jflat guides; do
    "$omc" < "tools/$t.om" > "build/$t" && chmod +x "build/$t" || { echo "regen: tools/$t.om does not compile" >&2; exit 2; }
done
git clone -q --bare "$mcp" "$tmp/mcp" || { echo "regen: cannot clone $mcp" >&2; exit 2; }
found=
for c in $(git --git-dir "$tmp/mcp" log --format=%H main -- data/reference.json); do
    git --git-dir "$tmp/mcp" show "$c:data/reference.json" > "$tmp/ref.json" || continue
    build/jflat < "$tmp/ref.json" > "$tmp/ref.tsv" || continue
    if build/guides pinof < "$tmp/ref.tsv"; then found=$c; break; fi
done
[ -n "$found" ] || { echo "regen: no omega-mcp commit holds reference data for PIN; generate it there first (omega-mcp tools/gen-reference.py)" >&2; exit 2; }
mkdir -p data
cp "$tmp/ref.tsv" data/reference.tsv
printf 'omega-mcp %s %s data/reference.json sha256 %s\n' "$forge" "$found" "$(sha256sum "$tmp/ref.json" | cut -d' ' -f1)" > data/SOURCE
echo "regen: data/reference.tsv from omega-mcp $found"
git ls-files | build/guides gen
