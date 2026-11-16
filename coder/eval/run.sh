#!/bin/sh
# Held-out eval for `aien --omega` (harness tooling, not product code).
# usage: sh run.sh ARM OUTDIR TASKDIR [TASK_ID...]
#   ARM     omega   - Omega context pack as the system prompt, pack readable
#           control - same model, tools, guard and check loop; rules-only prompt, no readable pack
#   TASKDIR holds TASK_ID/{spec.md,stdin,expected.out,expected.exit}; reference solutions live elsewhere
# Tasks run one after another (the live 35B takes serial requests only). Each task gets a fresh empty
# directory; the model must leave main.om there. Scoring is independent of the session: compile with
# the pinned omc, then score.sh runs the om2 gate with no expected output in the program's view, then compares
# the program's saved stdout with the expected output through the gate.
# Verdicts: pass, wrong-output, timeout, crash, compile-fail (coder/README.md says what each means and what
# stops the run with exit 3 instead).
# Per task: OUTDIR/ID/{work/,sandbox/,transcript.jsonl,stderr,guard.log,score.log}; summary OUTDIR/results.tsv;
# inputs (compiler, gate, prompt, guard, tasks, session program) OUTDIR/manifest.tsv.
set -u
. "$(dirname "$0")/case.sh"
arm=${1:?arm: omega or control}
out=${2:?outdir}
tasks=${3:?taskdir}
shift 3
home=${OMEGA_HOME:-$HOME/.local/share/aien-omega}
omc="$home/omc"
# The pin is read from the repository's PIN (the one place it is written); the installed pack must
# have been built for the same pin, or the guard and this scorer would disagree.
pin="$(cd "$(dirname "$0")/../.." && pwd)/PIN"
sha=$(sed -n 's/^omc-sha256 //p' "$pin")
[ -n "$sha" ] || { echo "no omc-sha256 line in $pin" >&2; exit 2; }
got=$(sha256sum "$omc" | cut -d' ' -f1)
[ "$got" = "$sha" ] || { echo "pinned omc mismatch: $omc sha256 $got, $pin says $sha" >&2; exit 2; }
cmp -s "$pin" "$home/context/PIN" || { echo "pack built for another pin: rebuild $home/context with build-context.sh" >&2; exit 2; }
# The session loads $home/omega-guard.ts (aien -e); it must be this repository's guard, or the session would run
# a check loop this runner does not describe.
guard="$(cd "$(dirname "$0")/.." && pwd)/omega-guard.ts"
cmp -s "$guard" "$home/omega-guard.ts" || { echo "$home/omega-guard.ts is not $guard: cp it there" >&2; exit 2; }
here=$(cd "$(dirname "$0")" && pwd)
# q: quote one word for sh -c (OMEGA_CHECK is a command line the guard runs)
q() { printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"; }
command -v aien > /dev/null || { echo "aien not on PATH" >&2; exit 2; }
command -v bwrap > /dev/null || { echo "bwrap not on PATH (the gate runs model-written programs inside it)" >&2; exit 2; }
command -v jq > /dev/null || { echo "jq not on PATH (it quotes each task's standard input into the prompt)" >&2; exit 2; }
# score.sh gives the gate absolute paths in its case lines, and the gate runs with cwd "$home".
[ -d "$tasks" ] || { echo "no task directory $tasks" >&2; exit 2; }
tasks=$(cd "$tasks" && pwd)
model=${OMEGA_EVAL_MODEL:-}
seed=${OMEGA_EVAL_SEED:-}
[ -n "$model" ] || { echo "set OMEGA_EVAL_MODEL to the exact model id the aien profile serves" >&2; exit 2; }
[ -n "$seed" ] || { echo "set OMEGA_EVAL_SEED to the sampling seed the aien profile fixes, or none" >&2; exit 2; }
case $arm in
omega) prompt_file="$home/context/OMEGA.md"; context="$home/context" ;;
control) prompt_file="$home/context/CONTROL.md" ;;
*) echo "arm must be omega or control" >&2; exit 2 ;;
esac
ids=${*:-$(ls "$tasks")}
for id in $ids; do
	[ -d "$tasks/$id" ] || { echo "no task $id in $tasks" >&2; exit 2; }
done
mkdir -p "$out" "$out/empty-context"
out=$(cd "$out" && pwd)
[ "$arm" = control ] && context="$out/empty-context"
# What this run was measured with. A resumed run must match the manifest it started with, and compare.sh
# refuses two arms whose manifests differ in anything but arm and prompt. The model and seed cannot be read
# from here (aien takes them from its own profile), so the operator states them: OMEGA_EVAL_MODEL (required,
# the exact model id the aien profile serves) and OMEGA_EVAL_SEED (the sampling seed the profile fixes, or
# "none" when it fixes none). The runner itself is hashed because it holds the prompt template and the limits.
# File names with white space would split in hd(); refuse them rather than hash an error.
for dd in "$tasks" "$home/seed/qualification/om2/fixtures"; do
	[ -d "$dd" ] || continue
	if find "$dd" | grep -q "[ $(printf '\t')]" || [ "$(find "$dd" | wc -l)" != "$(find "$dd" -exec printf '.\n' \; | wc -l)" ]; then
		echo "a file name under $dd holds white space; rename it" >&2
		exit 2
	fi
done
h() { if [ -f "$1" ]; then sha256sum "$1" | cut -d' ' -f1; else echo absent; fi; }
hd() { if [ -d "$1" ]; then (cd "$1" && find . -type f | LC_ALL=C sort | xargs sha256sum) | sha256sum | cut -d' ' -f1; else echo absent; fi; }
# Both prompt files are recorded in every manifest (omega_prompt_sha256, control_prompt_sha256), so compare.sh
# can require the rules text to be the same in both arms; prompt_sha256 is the one this arm was given.
manifest=$(printf 'arm\t%s\nmodel\t%s\nseed\t%s\nomc_sha256\t%s\ngate_sha256\t%s\nfixtures_sha256\t%s\nprompt_sha256\t%s\nomega_prompt_sha256\t%s\ncontrol_prompt_sha256\t%s\nguard_sha256\t%s\nerrors_sha256\t%s\nrunner_sha256\t%s\ntasks_sha256\t%s\ntasks_count\t%s\ntask_ids\t%s\naien\t%s\naien_version\t%s\n' \
	"$arm" "$model" "$seed" "$sha" "$(h "$home/gate")" "$(hd "$home/seed/qualification/om2/fixtures")" "$(h "$prompt_file")" \
	"$(h "$home/context/OMEGA.md")" "$(h "$home/context/CONTROL.md")" \
	"$(h "$home/omega-guard.ts")" "$(h "$home/context/errors.tsv")" "$(cat "$0" "$here/case.sh" "$here/score.sh" "$here/cat.om" | sha256sum | cut -d' ' -f1)" "$(hd "$tasks")" "$(ls "$tasks" | wc -l | tr -d ' ')" "$(ls "$tasks" | LC_ALL=C sort | tr '\n' ' ' | sed 's/ $//')" \
	"$(h "$(command -v aien)")" "$(aien --version 2>&1 | head -n 1)")
# Rows with no manifest were scored with unknown inputs (an older runner wrote results.tsv alone): never adopt them.
if [ ! -f "$out/manifest.tsv" ] && [ -f "$out/results.tsv" ] && [ "$(wc -l < "$out/results.tsv")" -gt 1 ]; then
	echo "$out/results.tsv has rows but no manifest.tsv: scored with unknown inputs; use a new OUTDIR" >&2
	exit 2
fi
if [ -f "$out/manifest.tsv" ]; then
	[ "$manifest" = "$(cat "$out/manifest.tsv")" ] ||
		{ echo "resume with different inputs; diff $out/manifest.tsv against:" >&2; echo "$manifest" >&2; exit 2; }
else
	echo "$manifest" > "$out/manifest.tsv"
fi
# Resumable: a task already scored in results.tsv is skipped; an interrupted task left no row and is re-run.
[ -s "$out/results.tsv" ] ||
	printf 'id\tverdict\tomc_rc\tgate_rc\tsession_rc\twall_s\tstop_refusals\tnon_om_files\n' > "$out/results.tsv"
for id in $ids; do
	if cut -f1 "$out/results.tsv" | grep -qxF "$id"; then continue; fi
	t="$tasks/$id"
	d="$out/$id"
	rm -rf "$d"
	mkdir -p "$d/work"
	# The finish check: the same scorer, on its own scratch directory under the session's output directory
	# (outside the session directory, which is all the session's programs can read).
	check="sh $(q "$here/score.sh") $(q "$home") $(q "$d/work/main.om") $(q "$t") $(q "$id") $(q "$d/check")"
	if [ -s "$t/stdin" ]; then
		input="Standard input for the check (JSON string): $(jq -Rs . < "$t/stdin")"
	else
		input="Standard input for the check is empty."
	fi
	prompt="Task: $(cat "$t/spec.md")
$input
Write the program to main.om in the working directory, check it with omega_run, and finish only when it is correct."
	start=$(date +%s)
	(cd "$d/work" && OMEGA_HOME="$home" OMEGA_PROMPT="$prompt_file" OMEGA_CONTEXT="$context" \
		OMEGA_CHECK="$check" OMEGA_STOP_LIMIT="$SESSION_STOP_LIMIT" OMEGA_LOG="$d/guard.log" \
		timeout "$SESSION_TIMEOUT" aien --omega -p --mode json --no-session "$prompt" \
		> "$d/transcript.jsonl" 2> "$d/stderr")
	src=$?
	# A session ends with 0, or 124 when timeout stops it. Anything else (126/127: it never started; another
	# code: aien failed, for example the model server was unreachable) is not the model's answer: stop without
	# a row, so the operator sees it at once and a rerun retries the task.
	if [ "$src" -ne 0 ] && [ "$src" -ne 124 ]; then
		echo "$id: session ended with rc $src (not 0 or 124), see $d/stderr; no row written" >&2
		exit 3
	fi
	# The guard logs a "stop ..." line at every finish. A session that ended normally (rc 0) with none means the
	# guard was not loaded or never saw the finish, and "no OMEGA_CHECK" means the task check did not reach it:
	# either way the session ran without the harness, so stop without a row.
	if [ "$src" -eq 0 ] && ! grep -q 'stop allowed\|stop refused' "$d/guard.log" 2> /dev/null; then
		echo "$id: guard.log shows no finish (the guard was not loaded?), see $d/guard.log; no row written" >&2
		exit 3
	fi
	if grep -q 'no OMEGA_CHECK' "$d/guard.log" 2> /dev/null; then
		echo "$id: the guard ran without the task check (OMEGA_CHECK), see $d/guard.log; no row written" >&2
		exit 3
	fi
	wall=$(($(date +%s) - start))
	orc=NA
	grc=NA
	if [ ! -f "$d/work/main.om" ]; then
		verdict=compile-fail
		echo "no main.om" > "$d/score.log"
	else
		"$omc" < "$d/work/main.om" > "$d/main.elf" 2> "$d/score.log"
		orc=$?
		# 126/127: omc could not be executed. That is the machine, not the model: stop without a row.
		if [ "$orc" -eq 126 ] || [ "$orc" -eq 127 ]; then
			echo "$id: omc could not run (rc $orc), see $d/score.log; no row written" >&2
			exit 3
		fi
		if [ "$orc" -ne 0 ]; then
			verdict=compile-fail
		else
			# score.sh: exit 0 pass, 1 another verdict on the program, 3 (or anything else) the machine's: stop
			# without a row.
			sh "$here/score.sh" "$home" "$d/work/main.om" "$t" "$id" "$d/sandbox" >> "$d/score.log" 2>&1
			scrc=$?
			s=$(grep "^SCORE $id " "$d/score.log" | tail -n 1)
			verdict=$(echo "$s" | cut -d' ' -f3)
			grc=$(echo "$s" | cut -d' ' -f4)
			if { [ "$scrc" -ne 0 ] && [ "$scrc" -ne 1 ]; } || [ -z "$verdict" ] || ! echo " $VERDICTS " | grep -qF " $verdict " ||
				{ [ "$verdict" = pass ] && [ "$scrc" -ne 0 ]; } || { [ "$verdict" != pass ] && [ "$scrc" -ne 1 ]; }; then
				echo "$id: the scorer gave no verdict on the program (rc $scrc), see $d/score.log; no row written" >&2
				exit 3
			fi
		fi
	fi
	refusals=$(grep -c 'stop refused' "$d/guard.log" 2>/dev/null || true)
	nonom=$(find "$d/work" -type f ! -name '*.om' ! -name NOTES.md | wc -l)
	printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$verdict" "$orc" "$grc" "$src" "$wall" "${refusals:-0}" "$nonom" >> "$out/results.tsv"
done
cat "$out/results.tsv"
