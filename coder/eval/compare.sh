#!/bin/sh
# Compare the two eval arms: refuse unless their manifests are equal in every line but arm and prompt_sha256
# (same model, seed, compiler, gate, fixtures, both prompt files, guard, error table, runner, tasks and session
# program), then
# print the raw per-task verdicts side by side, the totals and the ledger line.
# usage: sh compare.sh OMEGA_OUTDIR CONTROL_OUTDIR
# Exit 0 with the table; 1 when the arms are not comparable: different inputs, different or incomplete task
# sets (every task in the task directory must be scored), or a row with an unknown verdict or a session rc
# other than 0 or 124.
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
ids_o=$(tail -n +2 "$o/results.tsv" | cut -f1 | LC_ALL=C sort)
ids_c=$(tail -n +2 "$c/results.tsv" | cut -f1 | LC_ALL=C sort)
[ -n "$ids_o" ] && [ "$ids_o" = "$ids_c" ] || { echo "COMPARE FAIL the arms scored different task sets" >&2; exit 1; }
n=$(echo "$ids_o" | wc -l | tr -d ' ')
want=$(sed -n "s/^tasks_count$tab//p" "$o/manifest.tsv")
[ "$n" = "$want" ] || { echo "COMPARE FAIL $n tasks scored, the task directory holds $want: finish both arms first" >&2; exit 1; }
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
po=$(tail -n +2 "$o/results.tsv" | cut -f2 | grep -cx pass)
pc=$(tail -n +2 "$c/results.tsv" | cut -f2 | grep -cx pass)
model=$(sed -n "s/^model$tab//p" "$o/manifest.tsv")
seed=$(sed -n "s/^seed$tab//p" "$o/manifest.tsv")
omc=$(sed -n "s/^omc_sha256$tab//p" "$o/manifest.tsv" | cut -c1-8)
echo "TOTAL omega pass=$po/$n control pass=$pc/$n"
echo "LEDGER OmegaCoder eval: omega $po/$n pass, control $pc/$n pass; model $model seed $seed omc $omc; per-task results $o/results.tsv $c/results.tsv"
