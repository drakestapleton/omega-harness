# case.sh: sourced by run.sh, refcheck.sh and compare.sh. The one place the eval's gate case line, its
# deadline and the verdict words are written, so the scorer, the reference check and the comparison agree.
CASE_DEADLINE=10
VERDICTS="pass wrong-output timeout crash compile-fail"
# caseline ID SRC TASK: the om2 gate line that runs SRC on TASK's stdin and expects its output and exit
caseline() {
	printf '%s run %s file:%s/stdin file:%s/expected.out - %s\n' "$1" "$2" "$3" "$3" "$(cat "$3/expected.exit")"
}
