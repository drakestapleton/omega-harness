#!/bin/sh
# Self-test of run.sh, compare.sh and the scorer, no model needed: a stub session program (selftest/aien)
# leaves selftest/src/ID.om as main.om, and the six synthetic tasks in selftest/tasks must score as
# selftest/expect.tsv says (pass, wrong-output, pass on exit 3, compile-fail, no main.om, stdin echo) in
# both arms. Then: a rerun exits 0 and adds no row (resume); compare.sh accepts the two arms and refuses
# arms measured with another model; a changed manifest, a missing model, a pack built for another pin
# and a wrong compiler are each refused with exit 2 and no results written.
# usage: OMEGA_HOME=... sh selftest.sh   (OMEGA_HOME as for run.sh: omc, gate, fixtures, context/)
# Exit 0 only when every check passes.
set -u
here=$(cd "$(dirname "$0")" && pwd)
home=${OMEGA_HOME:-$HOME/.local/share/aien-omega}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
tab=$(printf '\t')
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1: got '$2', want '$3'"; fail=1; fi; }
run() { # run ARM OUTDIR HOME [MODEL]
	PATH="$here/selftest:$PATH" OMEGA_HOME="$3" OMEGA_EVAL_MODEL="${4-selftest-stub}" OMEGA_EVAL_SEED=none \
		sh "$here/run.sh" "$1" "$2" "$here/selftest/tasks" > "$2.log" 2>&1
}
rows() { echo $(($(wc -l < "$1/results.tsv") - 1)); }

for arm in omega control; do
	run "$arm" "$out/$arm" "$home"
	check "$arm: run exit status" "$?" 0
	while IFS="$tab" read -r id want; do
		check "$arm: $id" "$(awk -F'\t' -v id="$id" '$1 == id { print $2 }' "$out/$arm/results.tsv")" "$want"
	done < "$here/selftest/expect.tsv"
	check "$arm: rows" "$(rows "$out/$arm")" "$(wc -l < "$here/selftest/expect.tsv" | tr -d ' ')"
	want=OMEGA
	[ "$arm" = control ] && want=CONTROL
	check "$arm: prompt file" "$(sed -n "s/^prompt_sha256$tab//p" "$out/$arm/manifest.tsv")" \
		"$(sha256sum "$home/context/$want.md" | cut -d' ' -f1)"
done
check "control: empty readable context" "$(ls -A "$out/control/empty-context" | wc -l | tr -d ' ')" 0

run omega "$out/omega" "$home"
check "resume exit status" "$?" 0
check "resume adds no row" "$(rows "$out/omega")" 6

sh "$here/compare.sh" "$out/omega" "$out/control" > "$out/cmp.log" 2>&1
check "compare accepts the two arms" "$?" 0
check "compare totals" "$(grep '^TOTAL ' "$out/cmp.log")" "TOTAL omega pass=3/6 control pass=3/6"
run control "$out/control2" "$home" other-model
sh "$here/compare.sh" "$out/omega" "$out/control2" > /dev/null 2>&1
check "compare refuses arms with another model" "$?" 1

cp "$out/omega/manifest.tsv" "$out/m"
sed "s/^model${tab}selftest-stub\$/model${tab}changed/" "$out/m" > "$out/omega/manifest.tsv"
check "manifest edited for the next case" "$(grep -c "^model${tab}changed\$" "$out/omega/manifest.tsv")" 1
run omega "$out/omega" "$home"
check "changed manifest refused" "$?" 2
check "changed manifest added no row" "$(rows "$out/omega")" 6

run omega "$out/nomodel" "$home" ""
check "missing model refused" "$?" 2
check "missing model wrote nothing" "$([ -e "$out/nomodel" ] && echo yes || echo no)" no

mkdir -p "$out/pin"
cp -r "$home/context" "$out/pin/context"
cp "$home/gate" "$home/omc" "$out/pin/"
sed 's/^omc-sha256 .*/omc-sha256 0000000000000000000000000000000000000000000000000000000000000000/' "$home/context/PIN" > "$out/pin/context/PIN"
run omega "$out/pinrun" "$out/pin"
check "pack built for another pin refused" "$?" 2
check "pack built for another pin: reason" "$(grep -c 'pack built for another pin' "$out/pinrun.log")" 1
check "pack built for another pin wrote nothing" "$([ -e "$out/pinrun" ] && echo yes || echo no)" no

mkdir -p "$out/wrong"
cp -r "$home/context" "$out/wrong/context"
cp "$home/gate" "$home/omc" "$out/wrong/"
printf '\0' >> "$out/wrong/omc"
run omega "$out/wrongrun" "$out/wrong"
check "wrong compiler refused" "$?" 2
check "wrong compiler: reason" "$(grep -c 'pinned omc mismatch' "$out/wrongrun.log")" 1
check "wrong compiler wrote nothing" "$([ -e "$out/wrongrun" ] && echo yes || echo no)" no

if [ "$fail" -eq 0 ]; then echo "SELFTEST PASS"; else echo "SELFTEST FAIL"; cat "$out/omega.log"; fi
exit "$fail"
