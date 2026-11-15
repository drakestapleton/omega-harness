# case.sh: sourced by run.sh, refcheck.sh, compare.sh and selftest.sh. The one place the eval's gate case line,
# its deadline, the session limits and the verdict words are written, so they all agree.
CASE_DEADLINE=10
# Session limits: wall-clock timeout around aien, aien's own --max-time, and the guard's OMEGA_STOP_LIMIT.
SESSION_TIMEOUT=900
SESSION_MAX_TIME=600
SESSION_STOP_LIMIT=5
VERDICTS="pass wrong-output timeout crash compile-fail"
# caseline ID SRC TASK: the om2 gate line that runs SRC on TASK's stdin and expects its output and exit
caseline() {
	printf '%s run %s file:%s/stdin file:%s/expected.out - %s\n' "$1" "$2" "$3" "$3" "$(cat "$3/expected.exit")"
}
