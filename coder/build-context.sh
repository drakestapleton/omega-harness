#!/bin/sh
# Build the Omega-only context pack read by `aien --omega` (harness config, not product code).
# usage: OMEGA_MV=/path/to/omega-mv OMC=/path/to/omc sh coder/build-context.sh OUTDIR
# OMC must be the build named in the repository's PIN file (the one place the pin is written).
# Writes OUTDIR/OMEGA.md (system prompt: rules + language reference + compiled examples),
# OUTDIR/CONTROL.md (rules only, for the no-context eval arm), OUTDIR/errors.tsv (compiler error
# meanings from skills/omega-encoding section 11, read by the guard) and OUTDIR/PIN (read by the guard
# and the eval runner). Every example must compile with OMC and every observed fact must still hold.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
skill="$here/../skills/omega-encoding"
mv=${OMEGA_MV:?set OMEGA_MV to an omega-mv checkout}
omc=${OMC:?set OMC to the omc named in PIN}
out=${1:?usage: build-context.sh OUTDIR}
pin_rev=$(sed -n 's/^omega-mv //p' "$here/../PIN")
pin_sha=$(sed -n 's/^omc-sha256 //p' "$here/../PIN")
[ -n "$pin_rev" ] && [ -n "$pin_sha" ] || { echo "PIN must hold 'omega-mv <commit>' and 'omc-sha256 <sha256>'" >&2; exit 1; }
got=$(sha256sum "$omc" | cut -d' ' -f1)
[ "$got" = "$pin_sha" ] || { echo "omc sha256 $got, PIN says $pin_sha (omega-mv $pin_rev)" >&2; exit 1; }
mkdir -p "$out"
tmp=$(mktemp)
trap 'rm -f "$tmp" "$tmp.elf" "$tmp.err" "$tmp.head"' EXIT

# Each fact in omega-observed.md has a probe in observed/; a fact the pinned omc no longer shows stops the build.
tab=$(printf '\t')
grep -v '^#' "$here/observed/expect.tsv" | while IFS="$tab" read -r f crc prc; do
	set +e
	"$omc" < "$here/observed/$f" > "$tmp.elf" 2> "$tmp.err"
	rc=$?
	got_prc=-
	if [ "$rc" -eq 0 ]; then chmod +x "$tmp.elf"; "$tmp.elf" < /dev/null > /dev/null; got_prc=$?; fi
	set -e
	[ "$rc" = "$crc" ] && [ "$got_prc" = "$prc" ] ||
		{ echo "observed fact no longer holds: $f omc rc $rc (want $crc), run rc $got_prc (want $prc)" >&2; exit 1; }
done

sed "s/@OMC_SHA256@/$pin_sha/g; s/@OMEGA_MV@/$(printf %.9s "$pin_rev")/g" "$here/omega-prompt-head.md" > "$tmp.head"
{
	cat "$tmp.head"
	printf '\n# Omega language reference\n\n'
	# Sections 2..11 of the omega-encoding skill; citation links are dropped to save tokens.
	awk '/^## 2\. /{on=1} /^## 11a\. /{on=0} on' "$skill/SKILL.md" |
		sed -E 's/ ?\((\[[^]]*\]\([^)]*\)(, ?)?)+\)//g; s/\[([^]]*)\]\([^)]*\)/\1/g'
	printf '\n## Observed with the pinned omc (%.8s)\n' "$pin_sha"
	cat "$here/omega-observed.md"
	printf '\n# Examples (each compiles with the pinned omc)\n'
	for f in "$skill/examples/fnv1a32.om" "$skill/examples/trap_narrow.om" \
		"$mv/seed/rung4/tests/echo.om" "$mv/seed/rung4/tests/fib.om" "$mv/seed/omc/tests/text.om" \
		"$mv/seed/omc/tests/loop/c1.om" "$mv/seed/omc/tests/loop/w1.om" "$mv/seed/omc/tests/float/structs.om"; do
		"$omc" < "$f" > "$tmp.elf" || { echo "example does not compile: $f" >&2; exit 1; }
		printf '\n## %s\n\n```\n' "$(basename "$f")"
		cat "$f"
		printf '```\n'
	done
} > "$tmp"
mv "$tmp" "$out/OMEGA.md"
cp "$tmp.head" "$out/CONTROL.md"
cp "$here/../PIN" "$out/PIN"
# Error meanings: the two-column table of section 11 (| code | meaning | code | meaning |), parenthetical
# detail dropped, one "code<TAB>meaning" line per code ("1, 2" gives two lines). An empty table stops the build.
awk '/^## 11\. /{on=1} /^## 11a\. /{on=0} on' "$skill/SKILL.md" | awk -F'|' '
	NF == 6 {
		for (i = 2; i <= 4; i += 2) {
			c = $i; m = $(i + 1)
			gsub(/^ +| +$/, "", c); gsub(/^ +| +$/, "", m)
			while (match(m, / ?\([^()]*\)/)) m = substr(m, 1, RSTART - 1) substr(m, RSTART + RLENGTH)
			n = split(c, cs, /, */)
			for (j = 1; j <= n; j++) if (cs[j] ~ /^[0-9]+$/) print cs[j] "\t" m
		}
	}' | sort -n > "$out/errors.tsv"
[ -s "$out/errors.tsv" ] || { echo "no error table found in $skill/SKILL.md section 11" >&2; exit 1; }
