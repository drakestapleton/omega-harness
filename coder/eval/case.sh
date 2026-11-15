# case.sh: sourced by run.sh, refcheck.sh, compare.sh and selftest.sh. The one place the eval's gate case line,
# its deadline, the session limits and the verdict words are written, so they all agree.
CASE_DEADLINE=10
# Session limits, shared by both arms so the arms stay comparable (eval protocol, not a guard against our own
# bugs): the wall-clock timeout around aien (its end scores as session rc 124) and the guard's OMEGA_STOP_LIMIT.
# compare.sh marks every row that reached one (AT_LIMIT), so a result bound by a limit is not misread.
SESSION_TIMEOUT=900
SESSION_STOP_LIMIT=5
VERDICTS="pass wrong-output timeout crash compile-fail"
# sandboxed_gate HOME SANDBOX GATE-ARGS...: the om2 gate is not a sandbox (its header says so) and the programs
# it runs are model-written, so it runs inside bwrap as the guard runs it: read-only root, only SANDBOX writable
# (the gate's scratch goes inside it), no network, its own pid namespace, killed with its parent.
sandboxed_gate() {
	_gh=$1
	_gsb=$2
	shift 2
	bwrap --ro-bind / / --dev /dev --proc /proc --bind "$_gsb" "$_gsb" --unshare-net --unshare-pid --die-with-parent \
		--chdir "$_gh" -- ./gate "$@"
}
# caseline ID SRC TASK: the om2 gate line that runs SRC on TASK's stdin and expects its output and exit
caseline() {
	printf '%s run %s file:%s/stdin file:%s/expected.out - %s\n' "$1" "$2" "$3" "$3" "$(cat "$3/expected.exit")"
}
