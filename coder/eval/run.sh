#!/bin/sh
# Held-out eval for `aien --omega` (harness tooling, not product code).
# usage: sh run.sh ARM OUTDIR TASKDIR [TASK_ID...]
#   ARM     omega   - Omega context pack as the system prompt, pack readable
#           control - same model, tools, guard and check loop; rules-only prompt, no readable pack
#   TASKDIR holds TASK_ID/{spec.md,stdin,expected.out,expected.exit}; reference solutions live elsewhere
# Tasks run one after another (the live 35B takes serial requests only). Each task gets a fresh empty
# directory; the model must leave main.om there. Scoring is independent of the session: compile with
# the pinned omc, then run the om2 gate on the task's case line in a fresh scratch directory.
# Per task: OUTDIR/ID/{work/,cases.txt,transcript.jsonl,stderr,guard.log,score.log}; summary OUTDIR/results.tsv;
# inputs (compiler, gate, prompt, guard, tasks, session program) OUTDIR/manifest.tsv.
set -u
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
command -v aien > /dev/null || { echo "aien not on PATH" >&2; exit 2; }
model=${OMEGA_EVAL_MODEL:-}
seed=${OMEGA_EVAL_SEED:-}
[ -n "$model" ] || { echo "set OMEGA_EVAL_MODEL to the exact model id the aien profile serves" >&2; exit 2; }
[ -n "$seed" ] || { echo "set OMEGA_EVAL_SEED to the sampling seed the aien profile fixes, or none" >&2; exit 2; }
case $arm in
omega) prompt_file="$home/context/OMEGA.md"; context="$home/context" ;;
control) prompt_file="$home/context/CONTROL.md" ;;
*) echo "arm must be omega or control" >&2; exit 2 ;;
esac
mkdir -p "$out" "$out/empty-context"
out=$(cd "$out" && pwd)
[ "$arm" = control ] && context="$out/empty-context"
ids=${*:-$(ls "$tasks")}
# What this run was measured with. A resumed run must match the manifest it started with, and compare.sh
# refuses two arms whose manifests differ in anything but arm and prompt. The model and seed cannot be read
# from here (aien takes them from its own profile), so the operator states them: OMEGA_EVAL_MODEL (required,
# the exact model id the aien profile serves) and OMEGA_EVAL_SEED (the sampling seed the profile fixes, or
# "none" when it fixes none). The runner itself is hashed because it holds the prompt template and the limits.
h() { if [ -f "$1" ]; then sha256sum "$1" | cut -d' ' -f1; else echo absent; fi; }
hd() { if [ -d "$1" ]; then (cd "$1" && find . -type f | LC_ALL=C sort | xargs sha256sum) | sha256sum | cut -d' ' -f1; else echo absent; fi; }
manifest=$(printf 'arm\t%s\nmodel\t%s\nseed\t%s\nomc_sha256\t%s\ngate_sha256\t%s\nfixtures_sha256\t%s\nprompt_sha256\t%s\nguard_sha256\t%s\nerrors_sha256\t%s\nrunner_sha256\t%s\ntasks_sha256\t%s\naien\t%s\naien_version\t%s\n' \
	"$arm" "$model" "$seed" "$sha" "$(h "$home/gate")" "$(hd "$home/seed/qualification/om2/fixtures")" "$(h "$prompt_file")" \
	"$(h "$home/omega-guard.ts")" "$(h "$home/context/errors.tsv")" "$(h "$0")" "$(hd "$tasks")" \
	"$(h "$(command -v aien)")" "$(aien --version 2>&1 | head -n 1)")
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
	if cut -f1 "$out/results.tsv" | grep -qx "$id"; then continue; fi
	t="$tasks/$id"
	d="$out/$id"
	rm -rf "$d"
	mkdir -p "$d/work"
	printf 'deadline 10\n%s run %s/work/main.om file:%s/stdin file:%s/expected.out - %s\n' \
		"$id" "$d" "$t" "$t" "$(cat "$t/expected.exit")" > "$d/cases.txt"
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
		OMEGA_CASES="$d/cases.txt" OMEGA_STOP_LIMIT=5 OMEGA_LOG="$d/guard.log" \
		timeout 900 aien --omega -p --mode json --max-time 600 --no-session "$prompt" \
		> "$d/transcript.jsonl" 2> "$d/stderr")
	src=$?
	# 126/127: the session never started (not executable / not found). Scoring that as compile-fail would
	# count an infrastructure failure against the model; stop without writing a row so a rerun retries it.
	if [ "$src" -eq 126 ] || [ "$src" -eq 127 ]; then
		echo "$id: session did not start (rc $src), see $d/stderr; no row written" >&2
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
			rm -rf "$d/scratch"
			(cd "$home" && ./gate "$omc" "$sha" "$d/cases.txt" "$d/scratch") >> "$d/score.log" 2>&1
			grc=$?
			if [ "$grc" -eq 126 ] || [ "$grc" -eq 127 ]; then
				echo "$id: gate could not run (rc $grc), see $d/score.log; no row written" >&2
				exit 3
			fi
			if [ "$grc" -eq 0 ] && grep -q '^OM2GATE PASS ' "$d/score.log"; then verdict=pass; else verdict=wrong-output; fi
		fi
	fi
	refusals=$(grep -c 'stop refused' "$d/guard.log" 2>/dev/null || true)
	nonom=$(find "$d/work" -type f ! -name '*.om' ! -name NOTES.md | wc -l)
	printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$verdict" "$orc" "$grc" "$src" "$wall" "${refusals:-0}" "$nonom" >> "$out/results.tsv"
done
cat "$out/results.tsv"
