#!/bin/sh
# Self-test of run.sh and its scorer, no model needed: a stub session program (selftest/aien) leaves
# selftest/src/ID.om as main.om, and the six synthetic tasks in selftest/tasks must score as
# selftest/expect.tsv says (pass, wrong-output, pass on exit 3, compile-fail, no main.om, stdin echo).
# Then: a rerun adds no row (resume), a manifest change is refused, and a wrong compiler is refused.
# usage: OMEGA_HOME=... sh selftest.sh   (OMEGA_HOME as for run.sh: omc, gate, fixtures, context/)
# Exit 0 only when every check passes.
set -u
here=$(cd "$(dirname "$0")" && pwd)
home=${OMEGA_HOME:-$HOME/.local/share/aien-omega}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1: got '$2', want '$3'"; fail=1; fi; }

PATH="$here/selftest:$PATH" OMEGA_HOME="$home" sh "$here/run.sh" omega "$out/a" "$here/selftest/tasks" > "$out/a.log" 2>&1
check "run exit status" "$?" 0
while IFS="$(printf '\t')" read -r id want; do
	got=$(awk -F'\t' -v id="$id" '$1 == id { print $2 }' "$out/a/results.tsv")
	check "$id" "$got" "$want"
done < "$here/selftest/expect.tsv"
rows=$(($(wc -l < "$out/a/results.tsv") - 1))
check "rows" "$rows" "$(wc -l < "$here/selftest/expect.tsv")"

PATH="$here/selftest:$PATH" OMEGA_HOME="$home" sh "$here/run.sh" omega "$out/a" "$here/selftest/tasks" > /dev/null 2>&1
check "resume adds no row" "$(($(wc -l < "$out/a/results.tsv") - 1))" "$rows"

sed 's/^arm\tomega$/arm\tcontrol/' "$out/a/manifest.tsv" > "$out/m" && mv "$out/m" "$out/a/manifest.tsv"
PATH="$here/selftest:$PATH" OMEGA_HOME="$home" sh "$here/run.sh" omega "$out/a" "$here/selftest/tasks" > /dev/null 2>&1
check "changed manifest refused" "$?" 2

mkdir -p "$out/wrong"
cp -r "$home/context" "$out/wrong/context"
cp "$home/gate" "$out/wrong/gate"
cp "$home/omc" "$out/wrong/omc"
printf '\0' >> "$out/wrong/omc"
PATH="$here/selftest:$PATH" OMEGA_HOME="$out/wrong" sh "$here/run.sh" omega "$out/b" "$here/selftest/tasks" > "$out/b.log" 2>&1
check "wrong compiler refused" "$?" 2
check "wrong compiler wrote no results" "$([ -e "$out/b/results.tsv" ] && echo yes || echo no)" no

if [ "$fail" -eq 0 ]; then echo "SELFTEST PASS"; else echo "SELFTEST FAIL"; cat "$out/a.log"; fi
exit "$fail"
