#!/bin/sh
# check.sh OMC [OMEGA_MCP]: the guide gate. Run in the repository root, beside examples/gate.sh OMC.
#
# With OMC (its sha256 must be PIN's omc-sha256) it builds tools/jflat.om, tools/guides.om and
# tools/rules.om, then requires:
#   data      data/reference.tsv is tools/jflat's flattening of the omega-mcp data/reference.json that
#             data/SOURCE names (OMEGA_MCP: default its local Radicle storage, else the HTTPS mirror)
#   guides    `git ls-files | guides check` exits 0: every block matches its sources, nothing typed
#   rules     `rules lint rules/rules.txt` exits 0, and rendering is deterministic
# and that every check fails its negative control, on a scratch copy of the tracked files:
#   a stale block, a typed pin, a typed count, reference data for another pin, an unknown block,
#   a private path in the public rules, an unterminated rule, malformed JSON.
# Prints one line per step and ends `CHECK PASS steps=N` (exit 0) or `CHECK FAIL ...` (exit 1);
# exit 2 on a usage, pin or build error. This file is invocation glue around the Omega programs.
set -u
[ "$#" -ge 1 ] || { sed -n '2,14s/^# \{0,1\}//p' "$0" >&2; exit 2; }
omc=$1
mcp=${2:-}
RID=z3e8UBQVfwEcESJrcTWEbyMAHWFBZ
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
        mcp=${RAD_HOME:-$HOME/.radicle}/storage/$RID
        [ -d "$mcp" ] || mcp=https://www.aienos.com/rad/$RID.git
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

cp rules/rules.txt "$tmp/open.txt" && printf 'rule open\ndate 2026-11-11\nfor all\norder 1\n| text\n' >> "$tmp/open.txt"
"$tmp/rules" lint "$tmp/open.txt" > /dev/null
expect "control: a rule without end is refused" 1 $?

printf '{"a":[1,}' | "$tmp/jflat" > /dev/null 2>&1
expect "control: malformed JSON is refused" 2 $?

total=$((pass + fail))
if [ "$fail" = 0 ]; then echo "CHECK PASS steps=$total"; exit 0; fi
echo "CHECK FAIL steps=$total pass=$pass fail=$fail"
exit 1
