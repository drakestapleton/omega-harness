#!/bin/sh
# check.sh OMC [OMEGA_MCP]: the guide gate. Run in the repository root, beside examples/gate.sh OMC.
#
# With OMC (its sha256 must be PIN's omc-sha256) it builds tools/jflat.om, tools/guides.om and
# tools/rules.om, then requires:
#   data      data/reference.tsv is tools/jflat's flattening of the omega-mcp data/reference.json that
#             data/SOURCE names (OMEGA_MCP: default the Interplane git repository)
#   guides    `git ls-files | guides check` exits 0: every block matches its sources, nothing typed
#   rules     `rules lint rules/rules.txt` exits 0, and rendering is deterministic
# and that every check fails its negative control, on a scratch copy of the tracked files:
#   a stale block, a typed pin, a typed count, reference data for another pin, an unknown block,
#   a private path in the public rules, an unterminated rule, malformed JSON;
# and that the pin rule compares words against PIN's values: with a fixture PIN whose revision and
# sha256 start with 8 digits, 8-, 12- and 16-character, upper-case and full restatements are refused
# while dates, counts and near misses are not, and five mutants of that comparison are each caught.
# Prints one line per step and ends `CHECK PASS steps=N` (exit 0) or `CHECK FAIL ...` (exit 1);
# exit 2 on a usage, pin or build error. This file is invocation glue around the Omega programs.
set -u
[ "$#" -ge 1 ] || { sed -n '2,14s/^# \{0,1\}//p' "$0" >&2; exit 2; }
omc=$1
mcp=${2:-}
[ -f PIN ] && [ -d tools ] || { echo "CHECK FAIL run in the omega-harness root" >&2; exit 2; }
want=$(sed -n 's/^omc-sha256 //p' PIN)
got=$(sha256sum "$omc" 2>/dev/null | cut -d' ' -f1)
[ -n "$want" ] && [ "$got" = "$want" ] || { echo "CHECK FAIL omc sha256 ${got:-unreadable}, PIN wants $want" >&2; exit 2; }
unset GIT_DIR GIT_NAMESPACE GIT_WORK_TREE
export GIT_TERMINAL_PROMPT=0
tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT
for t in jflat guides rules; do
    "$omc" < "tools/$t.om" > "$tmp/$t" && chmod +x "$tmp/$t" || { echo "CHECK FAIL tools/$t.om does not compile" >&2; exit 2; }
done
pass=0 fail=0
ok() { echo "PASS $1"; pass=$((pass + 1)); }
no() { echo "FAIL $1"; fail=$((fail + 1)); }
# expect NAME RC: the last command's exit status $? must be RC
expect() { if [ "$3" = "$2" ]; then ok "$1 (exit $3)"; else no "$1: exit $3, expected $2"; fi; }

# data: reproduce data/reference.tsv from its recorded source
set -- $(cat data/SOURCE 2>/dev/null)
if [ "$#" -ge 6 ]; then
    if [ -z "$mcp" ]; then
        mcp=https://interplane.io/projects/omega-mcp/repo.git
    fi
    if git clone -q --bare "$mcp" "$tmp/mcp" 2>/dev/null && git --git-dir "$tmp/mcp" show "$3:$4" > "$tmp/ref.json" 2>/dev/null; then
        [ "$(sha256sum "$tmp/ref.json" | cut -d' ' -f1)" = "$6" ] && "$tmp/jflat" < "$tmp/ref.json" | cmp -s - data/reference.tsv
        expect "data: data/reference.tsv is jflat of omega-mcp $3 $4" 0 $?
    else
        no "data: cannot read omega-mcp $3 from $mcp"
    fi
else
    no "data: data/SOURCE must name the omega-mcp commit, file and sha256"
fi

# guides and rules on the tree as it is
git ls-files | "$tmp/guides" check > "$tmp/g.out"
expect "guides check: $(tail -n 2 "$tmp/g.out" | head -n 1)" 0 $?
[ "$fail" = 0 ] || sed 's/^/  /' "$tmp/g.out" | grep -v '^  guides:' | head -n 40
"$tmp/rules" lint rules/rules.txt > "$tmp/r.out"
expect "rules lint: $(cat "$tmp/r.out")" 0 $?
{ "$tmp/rules" render rules/rules.txt /dev/null claude x > "$tmp/r1" && "$tmp/rules" render rules/rules.txt /dev/null claude x > "$tmp/r2" && cmp -s "$tmp/r1" "$tmp/r2"; }
expect "rules render is deterministic" 0 $?

# negative controls on a scratch copy of the tracked files
copy() {
    rm -rf "$tmp/c" && mkdir -p "$tmp/c" &&
        git ls-files | while IFS= read -r f; do mkdir -p "$tmp/c/$(dirname "$f")" && cp -p "$f" "$tmp/c/$f"; done
    git ls-files > "$tmp/c.list"
}
gcheck() { (cd "$tmp/c" && "$tmp/guides" check < "$tmp/c.list" > "$tmp/c.out" 2>&1); }
blockfile=$(grep -l '^<!-- gen:pin -->$' $(git ls-files '*.md') | head -n 1)
short=$(printf '%s' "$want" | cut -c1-8)

copy && awk '{ print } /^<!-- gen:pin -->$/ && !d { print "| stale | row |"; d = 1 }' "$blockfile" > "$tmp/c/$blockfile.x" && mv "$tmp/c/$blockfile.x" "$tmp/c/$blockfile"
gcheck; r=$?; grep -q 'block is stale' "$tmp/c.out" || r=99
expect "control: a stale block in $blockfile is refused" 1 $r

copy && printf '\nThe compiler is omc `%s`.\n' "$short" >> "$tmp/c/README.md"
gcheck; r=$?; grep -q "restates PIN outside a generated block: $short" "$tmp/c.out" || r=99
expect "control: a typed pin is refused" 1 $r

# the pin rule on a fixture PIN whose revision and sha256 start with 8 digits (values built from short
# pieces, so this file names no 7-character word of them); data/reference.tsv's first two lines follow it
d8=$((2718 * 10000 + 2818))
s8=$((3141 * 10000 + 5926))
drev=$d8$(printf %s 0a1b 2c3d 4e5f 6a7b 8c9d 0e1f 2a3b 4c5d)
dsha=$s8$(printf %s 5e6f 7a8b 9c0d 1e2f 3a4b 5c6d 7e8f 9a0b 1c2d 3e4f 5a6b 7c8d 9e0f 1a2b)
r12=$(echo "$drev" | cut -c1-12)
fyes="$d8 $s8 $r12 $(echo "$dsha" | cut -c1-16) $drev $dsha $(echo "$r12" | tr a-f A-F)"
fno="$((2026 * 10000 + 1111)) $((1000 * 10000)) $((d8 + 1)) $((s8 + 1))"
copy && printf 'omega-mv %s\nomc-sha256 %s\n' "$drev" "$dsha" > "$tmp/c/PIN" &&
    { printf '/pin/omega_mv\t%s\n/pin/omc_sha256\t%s\n' "$drev" "$dsha"; sed 1,2d data/reference.tsv; } > "$tmp/c/data/reference.tsv" &&
    { printf '\n## Pin fixture\n\n'; for w in $fyes $fno; do printf 'The word `%s` is here.\n' "$w"; done; } >> "$tmp/c/README.md"
pinfix() { # pinfix GUIDES: the fixture words GUIDES judges wrongly (each of fyes refused, none of fno)
    (cd "$tmp/c" && "$1" check < "$tmp/c.list" > "$tmp/f.out" 2>&1)
    for w in $fyes; do grep -q "restates PIN outside a generated block: $w\$" "$tmp/f.out" || printf '%s ' "$w"; done
    for w in $fno; do grep -q "restates PIN outside a generated block: $w\$" "$tmp/f.out" && printf '%s ' "$w"; done
}
bad=$(pinfix "$tmp/guides"); [ -z "$bad" ]
expect "control: fixture pin with an all-digit start: 8-, 12-, 16-character, upper-case and full restatements refused, dates, counts and near misses not${bad:+ (wrong: $bad)}" 0 $?
gmut() { # gmut NAME SED-ARGS...: tools/guides.om edited by sed must judge a fixture word wrongly
    m=$1; shift
    sed "$@" tools/guides.om > "$tmp/$m.om"
    if cmp -s tools/guides.om "$tmp/$m.om"; then no "control: mutant $m: the edit did not apply"; return; fi
    if ! "$omc" < "$tmp/$m.om" > "$tmp/$m" 2> "$tmp/$m.err" || [ -s "$tmp/$m.err" ]; then no "control: mutant $m does not compile: $(head -c 200 "$tmp/$m.err")"; return; fi
    chmod +x "$tmp/$m"
    bad=$(pinfix "$tmp/$m"); [ -n "$bad" ]
    expect "control: mutant $m of the pin rule is caught${bad:+ by $bad}" 0 $?
}
gmut m-letter -e 's/^if pinpre s t$/if and ishexw s t pinpre s t/'
gmut m-floor -e 's/^if ge sub t s 7$/if ge sub t s 9/'
gmut m-revfirst -e 's/^for i ulong n bound 40$/for i ulong 1 bound 40/'
gmut m-shafirst -e 's/^for j ulong n bound 64$/for j ulong 1 bound 64/'
gmut m-nofold -e '/^fn fold c uchar to uchar$/,/^end$/s/^ret add c 32$/ret c/'

n=$(git ls-files 'examples/*.om' | wc -l | tr -d ' ')
copy && printf '\nThe gate runs %s examples.\n' "$n" >> "$tmp/c/README.md"
gcheck; r=$?; grep -q "typed count outside a generated block: $n examples" "$tmp/c.out" || r=99
expect "control: a typed count is refused" 1 $r

copy && printf '\nOn 2026-11-11 the gate ran %s examples with omc `%s`.\n' "$n" "$short" >> "$tmp/c/README.md"
gcheck
expect "control: a dated observation naming the pin and a count is allowed" 0 $?

copy && printf '<!-- gen:nosuch -->\n<!-- /gen:nosuch -->\n' >> "$tmp/c/README.md"
gcheck; r=$?; grep -q 'unknown block' "$tmp/c.out" || r=99
expect "control: an unknown block is refused" 1 $r

copy && sed '1s/^omega-mv \(.......\)./omega-mv \10/' PIN > "$tmp/c/PIN"
cmp -s PIN "$tmp/c/PIN" && sed -i '1s/^omega-mv \(.......\)./omega-mv \11/' "$tmp/c/PIN"
gcheck
expect "control: reference data for another pin is refused" 2 $?

cp rules/rules.txt "$tmp/priv.txt" && printf 'rule leak\ndate 2026-11-11\nfor all\norder 1\n| read ~/secret/notes.md\nend\n' >> "$tmp/priv.txt"
"$tmp/rules" lint "$tmp/priv.txt" > /dev/null
expect "control: a home path in the public rules is refused" 1 $?

# Tracker addresses and private issue identifiers belong only in the machine overlay.
for marker in 'https://linear.app/private-workspace/issue/example' 'DRA-EXAMPLE'; do
    cp rules/rules.txt "$tmp/tracker.txt" && printf 'rule tracker-leak\ndate 2026-11-16\nfor all\norder 1\n| read %s\nend\n' "$marker" >> "$tmp/tracker.txt"
    "$tmp/rules" lint "$tmp/tracker.txt" > /dev/null
    expect "control: a private tracker reference in public rules is refused" 1 $?
    printf 'rule private-tracker\ndate 2026-11-16\nfor all\norder 1\n| read %s\nend\n' "$marker" > "$tmp/tracker-overlay.txt"
    "$tmp/rules" lint rules/rules.txt "$tmp/tracker-overlay.txt" > /dev/null
    expect "control: a private tracker reference in the overlay is allowed" 0 $?
done

cp rules/rules.txt "$tmp/open.txt" && printf 'rule open\ndate 2026-11-11\nfor all\norder 1\n| text\n' >> "$tmp/open.txt"
"$tmp/rules" lint "$tmp/open.txt" > /dev/null
expect "control: a rule without end is refused" 1 $?

printf '{"a":[1,}' | "$tmp/jflat" > /dev/null 2>&1
expect "control: malformed JSON is refused" 2 $?

total=$((pass + fail))
if [ "$fail" = 0 ]; then echo "CHECK PASS steps=$total"; exit 0; fi
echo "CHECK FAIL steps=$total pass=$pass fail=$fail"
exit 1
