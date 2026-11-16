#!/bin/sh
# Score one model-written program on one task (harness tooling, not product code).
# usage: sh score.sh HOME SRC TASK ID [WORK]
#   HOME  OMEGA_HOME (omc, the built gate, seed/qualification/om2/fixtures); omc must be the one PIN names
#   SRC   the program (main.om); TASK holds stdin, expected.out, expected.exit; WORK a scratch directory
#         (default: a temporary one, removed at exit)
# The program is model-written and the om2 gate runs it with the gate's own permissions, so whatever the program
# can open it can print. Stage A runs it through the gate with nothing of the task in view but copies of the
# program and its stdin (narrow_gate in case.sh): no expected output anywhere it can read. The gate decides
# compile, exit status, stderr, deadline and signal there. Stage B is trusted: the gate runs cat.om with the
# program's saved stdout as input and the task's expected output as the expected stdout, so the byte comparison
# is still the gate's.
# Prints the deciding VERDICT line(s), then "SCORE ID VERDICT GATE_RC" (VERDICT one of pass, wrong-output,
# timeout, crash, compile-fail; GATE_RC 0 or 1). Stage A's line is printed with its stdout word replaced by
# "stdout=(compared in stage B)", since stage A has no expected stdout. Exit 0 = pass, 1 = any other verdict on
# the program, 3 = no verdict on the program (omc mismatch, an unreadable file, a gate that did not run or gave
# no single verdict): that is the machine's, not the model's.
set -u
here=$(cd "$(dirname "$0")" && pwd)
. "$here/case.sh"
home=${1:?home}
home=$(cd "$home" && pwd) || { echo "SCORE-ERROR ${4:-} no home directory $1" >&2; exit 3; }
src=${2:?src}
t=${3:?task}
id=${4:?id}
work=${5:-}
machine() { echo "SCORE-ERROR $id $*" >&2; exit 3; }
sha=$(sed -n 's/^omc-sha256 //p' "$here/../../PIN")
[ -n "$sha" ] && [ "$(sha256sum < "$home/omc" | cut -d' ' -f1)" = "$sha" ] || machine "$home/omc is not the omc PIN names"
if [ -z "$work" ]; then
	work=$(mktemp -d)
	trap 'rm -rf "$work"' EXIT
fi
rm -rf "$work/a" "$work/b" "$work/c" "$work/a.log" "$work/b.log" "$work/c.log"
mkdir -p "$work/a/in" "$work/a/run" "$work/b/in" "$work/b/run" || machine "cannot make $work"
work=$(cd "$work" && pwd)
if [ ! -f "$src" ]; then
	echo "no $src"
	echo "SCORE $id compile-fail NA"
	exit 1
fi
cp "$src" "$work/a/in/main.om" && cp "$t/stdin" "$work/a/in/stdin" || machine "cannot copy $src or $t/stdin"
ex=$(cat "$t/expected.exit") || machine "no $t/expected.exit"
# Stage A: stdout "-" here only means the gate's stdout word is replaced below; stderr "-" requires it empty.
{
	echo "deadline $CASE_DEADLINE"
	printf '%s run %s file:%s - - %s\n' "$id" "$work/a/in/main.om" "$work/a/in/stdin" "$ex"
} > "$work/a/in/cases.txt"
narrow_gate "$home" "$work/a/in" "$work/a/run" "$home/omc" "$sha" "$work/a/in/cases.txt" "$work/a/run/s" > "$work/a.log" 2>&1
arc=$?
[ "$(grep -c "^VERDICT $id " "$work/a.log")" = 1 ] || machine "stage A rc $arc gave no single verdict, see $work/a.log"
v=$(grep "^VERDICT $id " "$work/a.log")
echo "$v" | sed 's/ stdout=match / stdout=(compared in stage B) /; s/ stdout differs at byte [0-9]* / stdout=(compared in stage B) /'
case $v in
"VERDICT $id INVALID child deadline exceeded"*) echo "SCORE $id timeout 1"; exit 1 ;;
"VERDICT $id INVALID child signal"*) echo "SCORE $id crash 1"; exit 1 ;;
"VERDICT $id FAIL compile exit="*) echo "SCORE $id compile-fail 1"; exit 1 ;;
"VERDICT $id PASS run exit="* | "VERDICT $id FAIL run exit="*) ;;
"VERDICT $id INVALID exec or redirect failed (child exit 127)"*)
	# The gate cannot tell a program that exits 127 from a failed exec or redirect. Run the trusted cat.om the
	# same way: if the gate gives it a run verdict, exec and redirect work here and 127 was the program's.
	[ "$ex" != 127 ] || machine "stage A exit 127 is both the expected exit and the gate's exec failure, see $work/a.log"
	mkdir -p "$work/c/in" "$work/c/run" && cp "$here/cat.om" "$work/c/in/cat.om" && cp "$t/stdin" "$work/c/in/stdin" ||
		machine "cannot copy the exec control's inputs"
	{
		echo "deadline $CASE_DEADLINE"
		printf '%s run %s file:%s - - 0\n' "$id" "$work/c/in/cat.om" "$work/c/in/stdin"
	} > "$work/c/in/cases.txt"
	narrow_gate "$home" "$work/c/in" "$work/c/run" "$home/omc" "$sha" "$work/c/in/cases.txt" "$work/c/run/s" > "$work/c.log" 2>&1
	grep -q "^VERDICT $id [A-Z]* run exit=0 " "$work/c.log" || machine "stage A exec failed and so did the trusted control, see $work/a.log $work/c.log"
	echo "SCORE $id wrong-output 1"
	exit 1
	;;
*) machine "stage A verdict not on the program, see $work/a.log" ;;
esac
rx=$(echo "$v" | sed -n 's/^.* run exit=\([0-9][0-9]*\) expected=\([0-9][0-9]*\) .*$/\1 \2/p')
[ -n "$rx" ] || machine "stage A verdict without exit and expected, see $work/a.log"
set -- $rx
case $v in
*" stderr=match") serr=match ;;
*" stderr differs at byte "*) serr=differs ;;
*) machine "stage A verdict without a stderr word, see $work/a.log" ;;
esac
if [ "$1" != "$2" ] || [ "$serr" != match ]; then
	echo "SCORE $id wrong-output 1"
	exit 1
fi
# Stage B: the gate names the program's stdout <line>.out in its scratch; the case is on line 2.
[ -f "$work/a/run/s/2.out" ] || machine "stage A left no $work/a/run/s/2.out"
cp "$work/a/run/s/2.out" "$work/b/in/got" && cp "$t/expected.out" "$work/b/in/expected.out" && cp "$here/cat.om" "$work/b/in/cat.om" ||
	machine "cannot copy stage B inputs"
{
	echo "deadline $CASE_DEADLINE"
	printf '%s run %s file:%s file:%s - 0\n' "$id" "$work/b/in/cat.om" "$work/b/in/got" "$work/b/in/expected.out"
} > "$work/b/in/cases.txt"
narrow_gate "$home" "$work/b/in" "$work/b/run" "$home/omc" "$sha" "$work/b/in/cases.txt" "$work/b/run/s" > "$work/b.log" 2>&1
brc=$?
[ "$(grep -c "^VERDICT $id " "$work/b.log")" = 1 ] || machine "stage B rc $brc gave no single verdict, see $work/b.log"
w=$(grep "^VERDICT $id " "$work/b.log")
echo "$w"
case $w in
"VERDICT $id PASS run exit=0 expected=0 stdout=match stderr=match")
	[ "$brc" -eq 0 ] && grep -q '^OM2GATE PASS ' "$work/b.log" || machine "stage B PASS with rc $brc, see $work/b.log"
	echo "SCORE $id pass 0"
	exit 0
	;;
"VERDICT $id FAIL run exit=0 expected=0 stdout differs at byte "*" stderr=match")
	echo "SCORE $id wrong-output 1"
	exit 1
	;;
*) machine "stage B verdict not a comparison, see $work/b.log" ;;
esac
