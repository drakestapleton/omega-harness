#!/bin/sh
# Self-test of run.sh, compare.sh, refcheck.sh and the scorer, no model needed. A stub session program
# (selftest/aien) records what each session was given (system prompt file, readable context, case file,
# stop limit, task prompt) and leaves a program as main.om: selftest/src/ID.om, or selftest/src-control/ID.om
# in the control arm, so the arms differ. Checked:
# - every task scores as selftest/expect.tsv says, per arm, also when TASKDIR is a relative path, and the raw
#   columns omc_rc, gate_rc, stop_refusals and non_om_files are as selftest/expect-raw.tsv says, wall_s a number
#   (at least 1 for st2, where the stub sleeps a second);
# - each session got its arm's prompt file and readable context (the pack, or an empty directory), a case
#   file with case.sh's deadline, case.sh's stop limit, aien's arguments with case.sh's --max-time, and a task
#   prompt holding that task's spec, its standard input (or "empty") and the instruction; the manifest records
#   aien --version (the timeout around aien is covered by runner_sha256 only; the values themselves live in
#   case.sh and are hashed, the test checks they reach the session);
# - the scorer: the real gate's PASS and FAIL; a fake gate's deadline (timeout) and signal (crash) verdicts;
#   a gate with no verdict, a PASS line with a non-zero exit, an unreadable fixture, and an omc or gate that
#   cannot execute each stop the run with exit 3 and no row for that task;
# - a session that ends with rc 1 stops the run (exit 3, no row); rc 124 is scored; a session whose guard log
#   shows no finish, or a guard without the case file, stops the run (exit 3, no row);
# - an id with no task directory is refused before anything is written; resume matches ids exactly;
# - compare.sh prints exactly the expected per-task table, totals and LEDGER line, and refuses: swapped arms,
#   different or incomplete or empty task sets, scored ids that are not the task directory's, a row with an unknown verdict or session rc, a control run with
#   other rules text, and a difference in any one manifest key other than arm and prompt_sha256;
# - a rerun exits 0 and adds no row, and re-runs a task whose row is missing from a clean directory and guard
#   log; a rerun with any one input changed (model, seed, gate, gate fixtures, prompt, guard, error table,
#   run.sh, case.sh, tasks, session program) is refused with exit 2 and adds no row; rows without a manifest
#   are refused; the verdict words in run.sh are case.sh's VERDICTS;
# - a missing model, a missing seed, missing jq, a pack built for another pin and a wrong compiler are each
#   refused with exit 2 and nothing written (a different omc cannot reach the manifest: the pin check
#   refuses it first);
# - refcheck.sh passes good references and refuses a wrong reference, a reference whose sha256 is not the
#   manifest's, and a manifest whose expected_sha256, stdin_bytes, exit, spec or id differs for one task.
# usage: OMEGA_HOME=... sh selftest.sh   (OMEGA_HOME as for run.sh: omc, gate, fixtures, context/)
# Exit 0 only when every check passes.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/case.sh"
home=${OMEGA_HOME:-$HOME/.local/share/aien-omega}
out=$(mktemp -d)
trap 'rm -rf "$out"' EXIT
tab=$(printf '\t')
fail=0
check() { if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1: got '$2', want '$3'"; fail=1; fi; }
# run ARM OUTDIR HOME [MODEL [SEED [TASKS [RUNNER [STUBDIR [BASEPATH]]]]]]; output in OUTDIR.log
run() {
	PATH="${8:-$here/selftest}:${9:-$PATH}" OMEGA_HOME="$3" OMEGA_EVAL_MODEL="${4-selftest-stub}" OMEGA_EVAL_SEED="${5-none}" \
		sh "${7:-$here/run.sh}" "$1" "$2" "${6:-$here/selftest/tasks}" > "$2.log" 2>&1
}
rows() { if [ -f "$1/results.tsv" ]; then echo $(($(wc -l < "$1/results.tsv") - 1)); else echo none; fi; }
sha() { sha256sum "$1" | cut -d' ' -f1; }
field() { awk -F'\t' -v k="$2" '$1 == k { print $2 }' "$1"; }
col() { awk -F'\t' -v k="$2" -v c="$3" '$1 == k { print $c }' "$1"; }
setfield() { awk -F'\t' -v k="$2" -v v="$3" 'BEGIN { OFS = "\t" } $1 == k { $2 = v } { print }' "$1" > "$1.new" && mv "$1.new" "$1"; }
ntasks=$(wc -l < "$here/selftest/expect.tsv" | tr -d ' ')
verdicts() { # verdicts NAME OUTDIR COLUMN(2 omega, 3 control)
	while IFS="$tab" read -r id want_o want_c; do
		want=$want_o
		[ "$3" = 3 ] && want=$want_c
		check "$1: $id verdict" "$(field "$2/results.tsv" "$id")" "$want"
	done < "$here/selftest/expect.tsv"
	check "$1: rows" "$(rows "$2")" "$ntasks"
}

for arm in omega control; do
	run "$arm" "$out/$arm" "$home"
	check "$arm: run exit status" "$?" 0
	if [ "$arm" = omega ]; then c=2 p=OMEGA.md ctx=$home/context; else c=3 p=CONTROL.md ctx=$out/control/empty-context; fi
	verdicts "$arm" "$out/$arm" "$c"
	check "$arm: manifest prompt" "$(field "$out/$arm/manifest.tsv" prompt_sha256)" "$(sha "$home/context/$p")"
	for t in "$here/selftest/tasks"/*; do
		id=$(basename "$t")
		s="$out/$arm/$id/session.txt"
		check "$arm: $id session prompt file is $p" "$(sed -n 's/^prompt //p' "$s")" "$(sha "$home/context/$p")"
		check "$arm: $id session context" "$(sed -n 's/^context //p' "$s")" "$ctx"
		check "$arm: $id session case file" "$(sed -n 's/^cases //p' "$s")" yes
		check "$arm: $id session stop limit" "$(sed -n 's/^stop_limit //p' "$s")" "$SESSION_STOP_LIMIT"
		tp="$out/$arm/$id/session-prompt.txt"
		check "$arm: $id task prompt holds its spec" "$(grep -cxF "Task: $(cat "$t/spec.md")" "$tp")" 1
		if [ -s "$t/stdin" ]; then
			line="Standard input for the check (JSON string): $(jq -Rs . < "$t/stdin")"
		else
			line="Standard input for the check is empty."
		fi
		check "$arm: $id task prompt holds its input" "$(grep -cxF "$line" "$tp")" 1
		check "$arm: $id task prompt ends with the instruction" "$(tail -n 1 "$tp")" \
			"Write the program to main.om in the working directory, check it with omega_run, and finish only when it is correct."
		check "$arm: $id session arguments" "$(cat "$out/$arm/$id/session-args.txt")" "--omega -p --mode json --max-time $SESSION_MAX_TIME --no-session"
		check "$arm: $id case deadline" "$(head -n 1 "$out/$arm/$id/cases.txt")" "deadline $CASE_DEADLINE"
		w=$(col "$out/$arm/results.tsv" "$id" 6)
		check "$arm: $id wall seconds is a whole number" "$(case $w in ''|*[!0-9]*) echo "$w";; *) echo ok;; esac)" ok
	done
	while IFS="$tab" read -r a id orc grc ref non; do
		[ "$a" = "$arm" ] || continue
		check "$arm: $id raw columns omc_rc gate_rc stop_refusals non_om_files" \
			"$(awk -F'\t' -v k="$id" '$1 == k { print $3, $4, $7, $8 }' "$out/$arm/results.tsv")" "$orc $grc $ref $non"
	done < "$here/selftest/expect-raw.tsv"
	check "$arm: manifest aien_version" "$(field "$out/$arm/manifest.tsv" aien_version)" "selftest-stub 1"
	check "$arm: st2-wrong wall seconds at least 1 (the stub sleeps 1)" "$([ "$(col "$out/$arm/results.tsv" st2-wrong 6)" -ge 1 ] && echo yes)" yes
done
check "omega: readable context is not empty" "$([ "$(sed -n 's/^context_entries //p' "$out/omega/st1-pass/session.txt")" -gt 0 ] && echo yes)" yes
check "control: readable context is empty" "$(sed -n 's/^context_entries //p' "$out/control/st1-pass/session.txt")" 0

(cd "$here/selftest" && run omega "$out/rel" "$home" selftest-stub none tasks)
check "relative TASKDIR: run exit status" "$?" 0
verdicts "relative TASKDIR" "$out/rel" 2

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
cmpx() { sh "$here/compare.sh" "$out/omega" "$1" > /dev/null 2>&1; echo $?; }
cx() { rm -rf "$out/cx" && cp -r "$out/control" "$out/cx"; }
check "compare refuses swapped arms" "$(sh "$here/compare.sh" "$out/control" "$out/omega" > /dev/null 2>&1; echo $?)" 1
cx; grep -v "^st6-stdin$tab" "$out/control/results.tsv" > "$out/cx/results.tsv"
check "compare refuses different task sets" "$(cmpx "$out/cx")" 1
rm -rf "$out/ox" && cp -r "$out/omega" "$out/ox" && grep -v "^st6-stdin$tab" "$out/omega/results.tsv" > "$out/ox/results.tsv"
cx; grep -v "^st6-stdin$tab" "$out/control/results.tsv" > "$out/cx/results.tsv"
check "compare refuses an incomplete task set" "$(sh "$here/compare.sh" "$out/ox" "$out/cx" > /dev/null 2>&1; echo $?)" 1
head -n 1 "$out/omega/results.tsv" > "$out/ox/results.tsv"; head -n 1 "$out/control/results.tsv" > "$out/cx/results.tsv"
check "compare refuses empty task sets" "$(sh "$here/compare.sh" "$out/ox" "$out/cx" > /dev/null 2>&1; echo $?)" 1
rm -rf "$out/ox" && cp -r "$out/omega" "$out/ox"; cx
sed "s/^st6-stdin$tab/st9-other$tab/" "$out/omega/results.tsv" > "$out/ox/results.tsv"
sed "s/^st6-stdin$tab/st9-other$tab/" "$out/control/results.tsv" > "$out/cx/results.tsv"
check "compare refuses scored tasks that are not the task directory's (same count)" "$(sh "$here/compare.sh" "$out/ox" "$out/cx" > /dev/null 2>&1; echo $?)" 1
cx; awk -F'\t' 'BEGIN { OFS = "\t" } $1 == "st3-exit" { $5 = 1 } { print }' "$out/control/results.tsv" > "$out/cx/results.tsv"
check "compare refuses a row with session rc 1" "$(cmpx "$out/cx")" 1
cx; awk -F'\t' 'BEGIN { OFS = "\t" } $1 == "st3-exit" { $2 = "maybe" } { print }' "$out/control/results.tsv" > "$out/cx/results.tsv"
check "compare refuses a row with an unknown verdict" "$(cmpx "$out/cx")" 1
for k in $(cut -f1 "$out/control/manifest.tsv"); do
	[ "$k" = arm ] || [ "$k" = prompt_sha256 ] && continue
	cx; setfield "$out/cx/manifest.tsv" "$k" changed
	check "compare refuses a different $k" "$(cmpx "$out/cx")" 1
done
copyhome() { rm -rf "$out/h" && cp -r "$home" "$out/h"; }
copyhome; echo "You may write C if Omega is hard." >> "$out/h/context/CONTROL.md"
run control "$out/ctl2" "$out/h"
check "control run with other rules text: exit status" "$?" 0
check "compare refuses a control run with other rules text" "$(cmpx "$out/ctl2")" 1

# resume: unchanged inputs go on and fill in a missing row from a clean task directory; any one changed input
# is refused; rows without a manifest are never adopted
grep -v "^st3-exit$tab" "$out/omega/results.tsv" > "$out/m" && cp "$out/m" "$out/omega/results.tsv"
echo stale > "$out/omega/st3-exit/work/NOTES.md"; echo stale > "$out/omega/st3-exit/work/stale.om"
run omega "$out/omega" "$home"
check "resume exit status" "$?" 0
check "resume re-runs the task with no row" "$(field "$out/omega/results.tsv" st3-exit)" pass
check "re-run task starts from a clean directory" "$(ls "$out/omega/st3-exit/work")" main.om
check "re-run task starts with a fresh guard log" "$(col "$out/omega/results.tsv" st3-exit 7)" 2
rm -rf "$out/sub" && cp -r "$out/omega" "$out/sub" && grep -v "^st3-exit$tab" "$out/omega/results.tsv" > "$out/sub/results.tsv"
printf 'st3-exit-old\tpass\t0\t0\t0\t0\t0\t0\n' >> "$out/sub/results.tsv"
run omega "$out/sub" "$home"
check "resume matches task ids exactly (st3-exit-old does not stand for st3-exit)" "$(field "$out/sub/results.tsv" st3-exit)" pass
PATH="$here/selftest:$PATH" OMEGA_HOME="$home" OMEGA_EVAL_MODEL=m OMEGA_EVAL_SEED=none sh "$here/run.sh" omega "$out/bogus" "$here/selftest/tasks" st1-pass st9-bogus > "$out/bogus.log" 2>&1
check "an id with no task directory is refused" "$?" 2
check "an id with no task directory wrote nothing" "$([ -e "$out/bogus" ] && echo yes || echo no)" no
mkdir -p "$out/legacy" && printf 'id\tverdict\nst1-pass\twrong-output\n' > "$out/legacy/results.tsv"
run omega "$out/legacy" "$home"
check "rows without a manifest refused" "$?" 2
check "rows without a manifest: reason" "$(grep -c 'has rows but no manifest' "$out/legacy.log")" 1
check "rows without a manifest: no manifest written" "$([ -e "$out/legacy/manifest.tsv" ] && echo yes || echo no)" no
check "resume rows" "$(rows "$out/omega")" "$ntasks"
run omega "$out/omega" "$home"
check "second resume exit status" "$?" 0
check "second resume adds no row" "$(rows "$out/omega")" "$ntasks"
refused() { # refused NAME, after a run into $out/r with exit status $r
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
mktree() { rm -rf "$out/tree" && mkdir -p "$out/tree/coder/eval" && cp "$here/../../PIN" "$out/tree/PIN" && cp "$here/run.sh" "$here/case.sh" "$out/tree/coder/eval/"; }
fresh; mktree; echo '# x' >> "$out/tree/coder/eval/run.sh"
run omega "$out/r" "$home" selftest-stub none "" "$out/tree/coder/eval/run.sh"; r=$?; refused runner
fresh; mktree; echo '# x' >> "$out/tree/coder/eval/case.sh"
run omega "$out/r" "$home" selftest-stub none "" "$out/tree/coder/eval/run.sh"; r=$?; refused "case.sh"
fresh; rm -rf "$out/stub" && cp -r "$here/selftest" "$out/stub" && echo '# x' >> "$out/stub/aien"
run omega "$out/r" "$home" selftest-stub none "" "" "$out/stub"; r=$?; refused "session program"

# the verdict words run.sh can write are exactly case.sh's VERDICTS (compare.sh and refcheck.sh read case.sh)
check "run.sh verdicts are case.sh VERDICTS" "$(grep -o 'verdict=[a-z-][a-z-]*' "$here/run.sh" | sed 's/verdict=//' | LC_ALL=C sort -u | tr '\n' ' ')" \
	"$(echo $VERDICTS | tr ' ' '\n' | LC_ALL=C sort | tr '\n' ' ')"

# the scorer: verdicts the program earns, and machine failures that stop the run
fakegate() { # fakegate VERDICT-TEXT EXIT [FINAL-LINE]: a gate that answers every case with that verdict
	copyhome
	printf '#!/bin/sh\nid=$(sed -n 2p "$3" | cut -d" " -f1)\necho "VERDICT $id %s"\n%s\nexit %s\n' \
		"$1" "${3:+echo \"$3\"}" "$2" > "$out/h/gate"
	chmod +x "$out/h/gate"
}
fakegate "INVALID child deadline exceeded, sent SIGKILL; wait low byte=9" 3 "OM2GATE INVALID cases=1"
run omega "$out/g1" "$out/h"
check "gate deadline: run exit status" "$?" 0
check "gate deadline scores timeout" "$(field "$out/g1/results.tsv" st1-pass)" timeout
check "gate deadline: compile-fail stays compile-fail" "$(field "$out/g1/results.tsv" st4-badcompile)" compile-fail
fakegate "INVALID child signal; wait low byte=11" 3 "OM2GATE INVALID cases=1"
run omega "$out/g2" "$out/h"
check "gate signal scores crash" "$(field "$out/g2/results.tsv" st1-pass)" crash
copyhome; printf '#!/bin/sh\nexit 0\n' > "$out/h/gate"; chmod +x "$out/h/gate"
run omega "$out/g3" "$out/h"
check "gate with no verdict stops the run" "$?" 3
check "gate with no verdict wrote no row" "$(rows "$out/g3")" 0
fakegate "PASS run exit=0" 1 "OM2GATE FAIL cases=1"
run omega "$out/g4" "$out/h"
check "gate PASS line with exit 1 stops the run" "$?" 3
check "gate PASS line with exit 1 wrote no row" "$(rows "$out/g4")" 0
rm -rf "$out/t" && cp -r "$here/selftest/tasks" "$out/t" && rm "$out/t/st1-pass/expected.out" && mkdir "$out/t/st1-pass/expected.out"
run omega "$out/g5" "$home" selftest-stub none "$out/t"
check "unreadable fixture stops the run" "$?" 3
check "unreadable fixture: reason" "$(grep -c 'gate gave no verdict' "$out/g5.log")" 1
check "unreadable fixture wrote no row" "$(rows "$out/g5")" 0
copyhome; chmod -x "$out/h/omc"; run omega "$out/x1" "$out/h"
check "omc not executable stops the run" "$?" 3
check "omc not executable wrote no row" "$(rows "$out/x1")" 0
copyhome; chmod -x "$out/h/gate"; run omega "$out/x2" "$out/h"
check "gate not executable stops the run" "$?" 3
check "gate not executable wrote no row" "$(rows "$out/x2")" 0
for mode in nolog nocases; do
	rm -rf "$out/stub" && cp -r "$here/selftest" "$out/stub" && echo "$mode" > "$out/stub/mode"
	run omega "$out/m$mode" "$home" selftest-stub none "" "" "$out/stub"
	check "guard log $mode stops the run" "$?" 3
	check "guard log $mode wrote no row" "$(rows "$out/m$mode")" 0
done
for rc in 1 124; do
	rm -rf "$out/stub" && cp -r "$here/selftest" "$out/stub" && sed -i "s/^exit 0\$/exit $rc/" "$out/stub/aien"
	check "stub edited to exit $rc" "$(grep -c "^exit $rc\$" "$out/stub/aien")" 1
	run omega "$out/s$rc" "$home" selftest-stub none "" "" "$out/stub"
	echo $? > "$out/s$rc.rc"
done
check "session rc 1 stops the run" "$(cat "$out/s1.rc")" 3
check "session rc 1 wrote no row" "$(rows "$out/s1")" 0
check "session rc 124: run exit status" "$(cat "$out/s124.rc")" 0
check "session rc 124 is scored" "$(field "$out/s124/results.tsv" st1-pass)" pass
check "session rc 124 recorded" "$(col "$out/s124/results.tsv" st1-pass 5)" 124

# refusals before anything is written
run omega "$out/nomodel" "$home" ""
check "missing model refused" "$?" 2
check "missing model wrote nothing" "$([ -e "$out/nomodel" ] && echo yes || echo no)" no
run omega "$out/noseed" "$home" selftest-stub ""
check "missing seed refused" "$?" 2
check "missing seed wrote nothing" "$([ -e "$out/noseed" ] && echo yes || echo no)" no
mkdir -p "$out/nojq"
for d in $(echo "$PATH" | tr ':' ' '); do
	[ -d "$d" ] || continue
	for f in "$d"/*; do b=$(basename "$f"); [ "$b" = jq ] || [ -e "$out/nojq/$b" ] || ln -s "$f" "$out/nojq/$b"; done
done
run omega "$out/jqrun" "$home" selftest-stub none "" "" "" "$out/nojq"
check "missing jq refused" "$?" 2
check "missing jq: reason" "$(grep -c 'jq not on PATH' "$out/jqrun.log")" 1
check "missing jq wrote nothing" "$([ -e "$out/jqrun" ] && echo yes || echo no)" no

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

# refcheck.sh on three synthetic tasks whose references are selftest/src
mkdir -p "$out/rt" "$out/rr"
for id in st1-pass st3-exit st6-stdin; do cp -r "$here/selftest/tasks/$id" "$out/rt/"; cp "$here/selftest/src/$id.om" "$out/rr/"; done
mkman() { # mkman: tasks.json for $out/rt with the sha256 of each reference in $out/rr
	for id in st1-pass st3-exit st6-stdin; do
		jq -n --arg id "$id" --rawfile spec "$out/rt/$id/spec.md" --arg e "$(sha "$out/rt/$id/expected.out")" \
			--argjson n "$(wc -c < "$out/rt/$id/stdin")" --argjson x "$(cat "$out/rt/$id/expected.exit")" --arg r "$(sha "$out/rr/$id.om")" \
			'{id: $id, spec: ($spec | rtrimstr("\n")), stdin_bytes: $n, expected_sha256: $e, exit: $x, ref_sha256: $r}'
	done | jq -s . > "$out/rt.json"
}
refc() { OMEGA_HOME="$home" sh "$here/refcheck.sh" "$out/rt" "$out/rt.json" "$out/rr" > "$out/ref.log" 2>&1; echo $?; }
mkman
check "refcheck passes good references" "$(refc)" 0
check "refcheck PASS line" "$(grep -c '^REFCHECK PASS n=3 ' "$out/ref.log")" 1
cp "$here/selftest/src/st2-wrong.om" "$out/rr/st1-pass.om"; mkman
check "refcheck refuses a wrong reference" "$(refc)" 1
cp "$here/selftest/src/st1-pass.om" "$out/rr/st1-pass.om"
check "refcheck refuses a reference whose sha256 is not the manifest's" "$(refc)" 1
# each manifest field on its own (the gate still passes, so only the metadata check can refuse)
for edit in '.expected_sha256 = "0"' '.stdin_bytes = 99' '.exit = 9' '.spec = "other"' '.id = "st9-none"'; do
	mkman; jq "map(if .id == \"st3-exit\" then $edit else . end)" "$out/rt.json" > "$out/rt2.json" && mv "$out/rt2.json" "$out/rt.json"
	check "refcheck refuses a manifest with $edit for one task" "$(refc)" 1
done
mkman
check "refcheck passes again with the manifest restored" "$(refc)" 0

if [ "$fail" -eq 0 ]; then echo "SELFTEST PASS"; else echo "SELFTEST FAIL"; cat "$out/omega.log"; fi
exit "$fail"
