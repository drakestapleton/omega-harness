#!/bin/sh
# Compare the two eval arms: refuse unless their manifests are equal in every line but arm and prompt_sha256
# (same model, seed, compiler, gate, fixtures, both prompt files, guard, error table, runner, tasks and session
# program) and each arm's prompt_sha256 is its own prompt file's (omega_prompt_sha256, control_prompt_sha256), then
# print the raw per-task verdicts side by side, an AT_LIMIT line for each row bound by a session limit, the totals
# and the ledger line.
# usage: sh compare.sh OMEGA_OUTDIR CONTROL_OUTDIR
# Exit 0 with the table; 1 when the arms are not comparable: different inputs, an arm given the other arm's
# prompt, different or incomplete task sets (every task in the task directory must be scored), or a row with an
# unknown verdict or a session rc other than 0 or 124.
set -u
. "$(dirname "$0")/case.sh"
o=${1:?omega outdir}
c=${2:?control outdir}
tab=$(printf '\t')
for d in "$o" "$c"; do
	[ -s "$d/manifest.tsv" ] && [ -s "$d/results.tsv" ] || { echo "COMPARE FAIL $d has no manifest.tsv or results.tsv" >&2; exit 1; }
done
[ "$(sed -n "s/^arm$tab//p" "$o/manifest.tsv")" = omega ] && [ "$(sed -n "s/^arm$tab//p" "$c/manifest.tsv")" = control ] ||
	{ echo "COMPARE FAIL arms must be omega then control" >&2; exit 1; }
strip() { grep -v -e "^arm$tab" -e "^prompt_sha256$tab" "$1"; }
if [ "$(strip "$o/manifest.tsv")" != "$(strip "$c/manifest.tsv")" ]; then
	echo "COMPARE FAIL the arms were measured with different inputs:" >&2
	t=$(mktemp -d)
	strip "$o/manifest.tsv" > "$t/omega"; strip "$c/manifest.tsv" > "$t/control"
	diff "$t/omega" "$t/control" >&2; rm -rf "$t"
	exit 1
fi
for p in "$o:omega" "$c:control"; do
	d=${p%:*}
	a=${p##*:}
	[ "$(sed -n "s/^prompt_sha256$tab//p" "$d/manifest.tsv")" = "$(sed -n "s/^${a}_prompt_sha256$tab//p" "$d/manifest.tsv")" ] ||
		{ echo "COMPARE FAIL $d was not given the $a prompt" >&2; exit 1; }
done
ids_o=$(tail -n +2 "$o/results.tsv" | cut -f1 | LC_ALL=C sort)
ids_c=$(tail -n +2 "$c/results.tsv" | cut -f1 | LC_ALL=C sort)
[ -n "$ids_o" ] && [ "$ids_o" = "$ids_c" ] || { echo "COMPARE FAIL the arms scored different task sets" >&2; exit 1; }
n=$(echo "$ids_o" | wc -l | tr -d ' ')
want=$(sed -n "s/^tasks_count$tab//p" "$o/manifest.tsv")
[ "$n" = "$want" ] || { echo "COMPARE FAIL $n tasks scored, the task directory holds $want: finish both arms first" >&2; exit 1; }
[ "$(echo $ids_o)" = "$(sed -n "s/^task_ids$tab//p" "$o/manifest.tsv")" ] ||
	{ echo "COMPARE FAIL the scored tasks are not the tasks in the task directory" >&2; exit 1; }
for d in "$o" "$c"; do
	bad=$(tail -n +2 "$d/results.tsv" | awk -F'\t' -v vs="$VERDICTS" '
		BEGIN { n = split(vs, a, " "); for (i = 1; i <= n; i++) ok[a[i]] = 1 }
		!($2 in ok) || ($5 != "0" && $5 != "124") { print $1 }')
	[ -z "$bad" ] || { echo "COMPARE FAIL $d/results.tsv has rows with an unknown verdict or a session rc other than 0/124:" $bad >&2; exit 1; }
done
printf 'id\tomega\tcontrol\n'
for id in $ids_o; do
	printf '%s\t%s\t%s\n' "$id" "$(awk -F'\t' -v i="$id" '$1 == i { print $2 }' "$o/results.tsv")" \
		"$(awk -F'\t' -v i="$id" '$1 == i { print $2 }' "$c/results.tsv")"
done
# Rows bound by a session limit (case.sh): the session was stopped by the timeout (rc 124) or the guard let it
# finish only because it hit the stop limit (its log says "stop allowed after"). Listed so such a verdict is not
# read as a free answer.
atlimit() { # atlimit DIR: the AT_LIMIT lines of one arm
	a=$(sed -n "s/^arm$tab//p" "$1/manifest.tsv")
	for id in $ids_o; do
		rc=$(awk -F'\t' -v i="$id" '$1 == i { print $5 }' "$1/results.tsv")
		if [ "$rc" = 124 ]; then
			echo "AT_LIMIT $a $id session_rc=124 (timeout)"
		elif grep -q 'stop allowed after' "$1/$id/guard.log" 2> /dev/null; then
			echo "AT_LIMIT $a $id stop_limit (finish allowed after $SESSION_STOP_LIMIT refusals)"
		fi
	done
}
lo=$(atlimit "$o")
lc=$(atlimit "$c")
[ -z "$lo" ] || echo "$lo"
[ -z "$lc" ] || echo "$lc"
no=$(echo "$lo" | grep -c '^AT_LIMIT')
nc=$(echo "$lc" | grep -c '^AT_LIMIT')
po=$(tail -n +2 "$o/results.tsv" | cut -f2 | grep -cx pass)
pc=$(tail -n +2 "$c/results.tsv" | cut -f2 | grep -cx pass)
model=$(sed -n "s/^model$tab//p" "$o/manifest.tsv")
seed=$(sed -n "s/^seed$tab//p" "$o/manifest.tsv")
omc=$(sed -n "s/^omc_sha256$tab//p" "$o/manifest.tsv" | cut -c1-8)
echo "TOTAL omega pass=$po/$n control pass=$pc/$n"
echo "LEDGER OmegaCoder eval: omega $po/$n pass, control $pc/$n pass (pass with feedback from the scoring case: the guard ran the task check at each finish); at a session limit omega $no control $nc; model $model seed $seed omc $omc; per-task results $o/results.tsv $c/results.tsv"
