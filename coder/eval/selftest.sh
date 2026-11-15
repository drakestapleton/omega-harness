#!/bin/sh
# Self-test of run.sh, compare.sh and the scorer, no model needed. A stub session program (selftest/aien)
# records what each session was given (prompt, readable context, case file) and leaves a program as
# main.om: selftest/src/ID.om, or selftest/src-control/ID.om in the control arm, so the arms differ.
# Checked:
# - every task scores as selftest/expect.tsv says, per arm (pass, wrong-output, pass on exit 3,
#   compile-fail, no main.om, stdin echo; st1 is answered wrongly in the control arm);
# - each session got its arm's prompt file, its arm's readable context (the pack, or an empty directory)
#   and a case file;
# - compare.sh prints exactly the expected per-task table, totals and LEDGER line, and refuses: swapped
#   arms, different task sets, and a difference in any one manifest key other than arm and prompt_sha256;
# - a rerun exits 0 and adds no row; a rerun with any one input changed (model, seed, gate, gate fixtures,
#   prompt, guard, error table, runner, tasks, session program) is refused with exit 2 and adds no row;
# - an omc or gate that cannot be executed stops the run with exit 3 and no row (not compile-fail);
# - a missing model, a missing seed, a pack built for another pin and a wrong compiler are each refused with
#   exit 2 and nothing written. (A different omc cannot reach the manifest: the pin check refuses it first.)
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
# run ARM OUTDIR HOME [MODEL [SEED [TASKS [RUNNER [STUBDIR]]]]]; output in OUTDIR.log
run() {
	PATH="${8:-$here/selftest}:$PATH" OMEGA_HOME="$3" OMEGA_EVAL_MODEL="${4-selftest-stub}" OMEGA_EVAL_SEED="${5-none}" \
		sh "${7:-$here/run.sh}" "$1" "$2" "${6:-$here/selftest/tasks}" > "$2.log" 2>&1
}
rows() { echo $(($(wc -l < "$1/results.tsv") - 1)); }
sha() { sha256sum "$1" | cut -d' ' -f1; }
field() { awk -F'\t' -v k="$2" '$1 == k { print $2 }' "$1"; }
setfield() { awk -F'\t' -v k="$2" -v v="$3" 'BEGIN { OFS = "\t" } $1 == k { $2 = v } { print }' "$1" > "$1.new" && mv "$1.new" "$1"; }
ntasks=$(wc -l < "$here/selftest/expect.tsv" | tr -d ' ')

for arm in omega control; do
	run "$arm" "$out/$arm" "$home"
	check "$arm: run exit status" "$?" 0
	while IFS="$tab" read -r id want_o want_c; do
		want=$want_o
		[ "$arm" = control ] && want=$want_c
		check "$arm: $id verdict" "$(field "$out/$arm/results.tsv" "$id")" "$want"
	done < "$here/selftest/expect.tsv"
	check "$arm: rows" "$(rows "$out/$arm")" "$ntasks"
	if [ "$arm" = omega ]; then p=OMEGA.md ctx=$home/context; else p=CONTROL.md ctx=$out/control/empty-context; fi
	check "$arm: manifest prompt" "$(field "$out/$arm/manifest.tsv" prompt_sha256)" "$(sha "$home/context/$p")"
	for s in "$out/$arm"/*/session.txt; do
		id=$(basename "$(dirname "$s")")
		check "$arm: $id session prompt is $p" "$(sed -n 's/^prompt //p' "$s")" "$(sha "$home/context/$p")"
		check "$arm: $id session context" "$(sed -n 's/^context //p' "$s")" "$ctx"
		check "$arm: $id session case file" "$(sed -n 's/^cases //p' "$s")" yes
	done
	check "$arm: sessions recorded" "$(ls "$out/$arm"/*/session.txt | wc -l | tr -d ' ')" "$ntasks"
done
check "omega: readable context is not empty" "$([ "$(sed -n 's/^context_entries //p' "$out/omega/st1-pass/session.txt")" -gt 0 ] && echo yes)" yes
check "control: readable context is empty" "$(sed -n 's/^context_entries //p' "$out/control/st1-pass/session.txt")" 0

# compare.sh: the whole table, totals and ledger line, then its refusals
sh "$here/compare.sh" "$out/omega" "$out/control" > "$out/cmp.log" 2>&1
check "compare accepts the two arms" "$?" 0
{
	printf 'id\tomega\tcontrol\n'
	LC_ALL=C sort "$here/selftest/expect.tsv"
	po=$(cut -f2 "$here/selftest/expect.tsv" | grep -cx pass)
	pc=$(cut -f3 "$here/selftest/expect.tsv" | grep -cx pass)
	echo "TOTAL omega pass=$po/$ntasks control pass=$pc/$ntasks"
	echo "LEDGER OmegaCoder eval: omega $po/$ntasks pass, control $pc/$ntasks pass; model selftest-stub seed none omc $(sed -n 's/^omc-sha256 //p' "$home/context/PIN" | cut -c1-8); per-task results $out/omega/results.tsv $out/control/results.tsv"
} > "$out/cmp.want"
check "compare output (table, totals, ledger)" "$(cat "$out/cmp.log")" "$(cat "$out/cmp.want")"
sh "$here/compare.sh" "$out/control" "$out/omega" > /dev/null 2>&1
check "compare refuses swapped arms" "$?" 1
rm -rf "$out/cx" && cp -r "$out/control" "$out/cx" && grep -v "^st6-stdin$tab" "$out/control/results.tsv" > "$out/cx/results.tsv"
sh "$here/compare.sh" "$out/omega" "$out/cx" > /dev/null 2>&1
check "compare refuses different task sets" "$?" 1
for k in $(cut -f1 "$out/control/manifest.tsv"); do
	[ "$k" = arm ] || [ "$k" = prompt_sha256 ] && continue
	rm -rf "$out/cx" && cp -r "$out/control" "$out/cx" && setfield "$out/cx/manifest.tsv" "$k" changed
	sh "$here/compare.sh" "$out/omega" "$out/cx" > /dev/null 2>&1
	check "compare refuses a different $k" "$?" 1
done

# resume: unchanged inputs go on; any one changed input is refused
run omega "$out/omega" "$home"
check "resume exit status" "$?" 0
check "resume adds no row" "$(rows "$out/omega")" "$ntasks"
copyhome() { rm -rf "$out/h" && cp -r "$home" "$out/h"; }
refused() { # refused NAME, after a run into $out/r
	check "resume with changed $1 refused" "$r" 2
	check "resume with changed $1: reason" "$(grep -c 'resume with different inputs' "$out/r.log")" 1
	check "resume with changed $1 added no row" "$(rows "$out/r")" "$ntasks"
}
fresh() { rm -rf "$out/r" && cp -r "$out/omega" "$out/r"; }
fresh; run omega "$out/r" "$home" other-model; r=$?; refused model
fresh; run omega "$out/r" "$home" selftest-stub 7; r=$?; refused seed
fresh; copyhome; printf x >> "$out/h/gate"; run omega "$out/r" "$out/h"; r=$?; refused gate
fresh; copyhome; echo x > "$out/h/seed/qualification/om2/fixtures/selftest-extra"; run omega "$out/r" "$out/h"; r=$?; refused fixtures
fresh; copyhome; echo x >> "$out/h/context/OMEGA.md"; run omega "$out/r" "$out/h"; r=$?; refused prompt
fresh; copyhome; echo '// x' >> "$out/h/omega-guard.ts"; run omega "$out/r" "$out/h"; r=$?; refused guard
fresh; copyhome; echo '99	x' >> "$out/h/context/errors.tsv"; run omega "$out/r" "$out/h"; r=$?; refused errors
fresh; rm -rf "$out/t" && cp -r "$here/selftest/tasks" "$out/t" && echo x >> "$out/t/st1-pass/spec.md"
run omega "$out/r" "$home" selftest-stub none "$out/t"; r=$?; refused tasks
fresh; mkdir -p "$out/tree/coder/eval" && cp "$here/../../PIN" "$out/tree/PIN" && { cat "$here/run.sh"; echo '# x'; } > "$out/tree/coder/eval/run.sh"
run omega "$out/r" "$home" selftest-stub none "" "$out/tree/coder/eval/run.sh"; r=$?; refused runner
fresh; rm -rf "$out/stub" && cp -r "$here/selftest" "$out/stub" && echo '# x' >> "$out/stub/aien"
run omega "$out/r" "$home" selftest-stub none "" "" "$out/stub"; r=$?; refused "session program"

# a compiler or gate that cannot be executed is the machine's failure: exit 3, no row
copyhome; chmod -x "$out/h/omc"; run omega "$out/x1" "$out/h"
check "omc not executable stops the run" "$?" 3
check "omc not executable wrote no row" "$(rows "$out/x1")" 0
copyhome; chmod -x "$out/h/gate"; run omega "$out/x2" "$out/h"
check "gate not executable stops the run" "$?" 3
check "gate not executable wrote no row" "$(rows "$out/x2")" 0

# refusals before anything is written
run omega "$out/nomodel" "$home" ""
check "missing model refused" "$?" 2
check "missing model wrote nothing" "$([ -e "$out/nomodel" ] && echo yes || echo no)" no
run omega "$out/noseed" "$home" selftest-stub ""
check "missing seed refused" "$?" 2
check "missing seed wrote nothing" "$([ -e "$out/noseed" ] && echo yes || echo no)" no

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
