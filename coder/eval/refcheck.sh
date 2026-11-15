#!/bin/sh
# Check the eval tasks and their held-out reference solutions at the pinned omc, before any run.
# usage: OMEGA_HOME=... sh refcheck.sh TASKDIR MANIFEST REFDIR
#   TASKDIR   ID/{spec.md,stdin,expected.out,expected.exit}
#   MANIFEST  tasks.json: [{id, spec, stdin_bytes, expected_sha256, exit, ref_sha256}, ...]
#   REFDIR    ID.om for every task (the references are not in this repository)
# Refuses unless the manifest ids are exactly the task directories, each task's files match the manifest,
# each reference's sha256 is the manifest's ref_sha256, and every reference passes its case line (the
# same line run.sh writes) through the om2 gate with the pinned omc. Prints REFCHECK PASS n=N (exit 0) or
# REFCHECK FAIL with the reasons (exit 1); exit 2 on a usage or pin error.
set -u
tasks=${1:?taskdir}
man=${2:?tasks.json}
refs=${3:?refdir}
home=${OMEGA_HOME:-$HOME/.local/share/aien-omega}
pin="$(cd "$(dirname "$0")/../.." && pwd)/PIN"
sha=$(sed -n 's/^omc-sha256 //p' "$pin")
[ -n "$sha" ] && [ "$(sha256sum "$home/omc" | cut -d' ' -f1)" = "$sha" ] || { echo "REFCHECK FAIL $home/omc is not the omc in $pin" >&2; exit 2; }
command -v jq > /dev/null || { echo "REFCHECK FAIL jq not on PATH" >&2; exit 2; }
for d in "$tasks" "$refs"; do [ -d "$d" ] || { echo "REFCHECK FAIL no directory $d" >&2; exit 2; }; done
tasks=$(cd "$tasks" && pwd)
refs=$(cd "$refs" && pwd)
fail=0
bad() { echo "REFCHECK FAIL $*"; fail=1; }
[ "$(jq -r '.[].id' "$man" | LC_ALL=C sort)" = "$(ls "$tasks" | LC_ALL=C sort)" ] || bad "manifest ids are not the task directories"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
echo 'deadline 10' > "$work/cases.txt"
n=0
for id in $(jq -r '.[].id' "$man"); do
	t="$tasks/$id"
	[ -d "$t" ] || continue
	n=$((n + 1))
	row=$(jq -c --arg id "$id" '.[] | select(.id == $id)' "$man")
	[ "$(sha256sum < "$t/expected.out" | cut -d' ' -f1)" = "$(echo "$row" | jq -r .expected_sha256)" ] || bad "$id expected.out differs from expected_sha256"
	[ "$(wc -c < "$t/stdin" | tr -d ' ')" = "$(echo "$row" | jq -r .stdin_bytes)" ] || bad "$id stdin size differs from stdin_bytes"
	[ "$(cat "$t/expected.exit")" = "$(echo "$row" | jq -r .exit)" ] || bad "$id expected.exit differs from exit"
	[ "$(cat "$t/spec.md")" = "$(echo "$row" | jq -r .spec)" ] || bad "$id spec.md differs from spec"
	if [ ! -f "$refs/$id.om" ]; then bad "$id no reference $refs/$id.om"; continue; fi
	[ "$(sha256sum < "$refs/$id.om" | cut -d' ' -f1)" = "$(echo "$row" | jq -r .ref_sha256)" ] || bad "$id reference sha256 differs from ref_sha256"
	printf '%s run %s/%s.om file:%s/stdin file:%s/expected.out - %s\n' "$id" "$refs" "$id" "$t" "$t" "$(cat "$t/expected.exit")" >> "$work/cases.txt"
done
(cd "$home" && ./gate "$home/omc" "$sha" "$work/cases.txt" "$work/scratch") > "$work/gate.log" 2>&1
grc=$?
grep '^VERDICT ' "$work/gate.log" | grep -v '^VERDICT [^ ]* PASS' | sed 's/^/REFCHECK FAIL gate: /'
[ "$grc" -eq 0 ] && grep -q "^OM2GATE PASS cases=$n " "$work/gate.log" || bad "gate rc $grc: $(grep '^OM2GATE ' "$work/gate.log")"
if [ "$fail" -eq 0 ]; then echo "REFCHECK PASS n=$n omc=$sha"; else exit 1; fi
