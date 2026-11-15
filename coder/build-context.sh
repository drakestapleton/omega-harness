#!/bin/sh
# Build the Omega-only context pack read by `aien --omega` (harness config, not product code).
# usage: OMEGA_MV=/path/to/omega-mv OMC=/path/to/omc sh coder/build-context.sh OUTDIR
# OMC must be the build named in the repository's PIN file (the one place the pin is written).
# Writes OUTDIR/OMEGA.md (system prompt: rules + language reference + compiled examples),
# OUTDIR/CONTROL.md (rules only, for the no-context eval arm), OUTDIR/errors.tsv (compiler error
# meanings and fixes from data/reference.tsv, read by the guard) and OUTDIR/PIN (read by the guard
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
# Error meanings: meaning and fix of each code from data/reference.tsv (the omega-mcp reference data that
# tools/check.sh ties to this pin), one "code<TAB>meaning. Fix: fix" line per code. Reference data for another
# pin, or no error rows, stops the build.
ref="$here/../data/reference.tsv"
[ "$(awk -F'\t' '$1 == "/pin/omc_sha256" { print $2 }' "$ref")" = "$pin_sha" ] || { echo "$ref is not for omc $pin_sha" >&2; exit 1; }
awk -F'\t' '
	$1 ~ /^\/errors\/[0-9]+\/(meaning|fix)$/ {
		split($1, p, "/"); v[p[3], p[4]] = $2; codes[p[3]] = 1
	}
	END { for (c in codes) print c "\t" v[c, "meaning"] ". Fix: " v[c, "fix"] }' "$ref" | sort -n > "$out/errors.tsv"
[ -s "$out/errors.tsv" ] || { echo "no /errors rows in $ref" >&2; exit 1; }
