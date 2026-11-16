# case.sh: sourced by run.sh, refcheck.sh, compare.sh and selftest.sh. The one place the eval's gate case line,
# its deadline, the session limits and the verdict words are written, so they all agree.
CASE_DEADLINE=10
# Session limits, shared by both arms so the arms stay comparable (eval protocol, not a guard against our own
# bugs): the wall-clock timeout around aien (its end scores as session rc 124) and the guard's OMEGA_STOP_LIMIT.
# compare.sh marks every row that reached one (AT_LIMIT), so a result bound by a limit is not misread.
SESSION_TIMEOUT=900
SESSION_STOP_LIMIT=5
VERDICTS="pass wrong-output timeout crash compile-fail"
# narrow_gate HOME RO RW GATE-ARGS...: the om2 gate is not a sandbox (its header says so) and the programs it
# runs are model-written: whatever such a program can open it can copy to its stdout. So the gate runs inside
# bwrap with nothing mounted but the system directories, the gate, the pinned omc and the gate fixtures (under
# HOME, the gate's working directory), RO read-only and RW writable (its scratch goes inside RW): no task
# directory, output directory, context pack or home directory, no /proc, no network, its own pid namespace,
# killed with its parent. score.sh never puts a task's expected output in RO while a model-written program runs.
narrow_gate() {
	_gh=$1
	_gro=$2
	_grw=$3
	shift 3
	bwrap --ro-bind /usr /usr --ro-bind-try /bin /bin --ro-bind-try /lib /lib --ro-bind-try /lib64 /lib64 \
		--dev /dev --tmpfs /tmp --ro-bind "$_gh/gate" "$_gh/gate" --ro-bind "$_gh/omc" "$_gh/omc" \
		--ro-bind "$_gh/seed/qualification/om2/fixtures" "$_gh/seed/qualification/om2/fixtures" \
		--ro-bind "$_gro" "$_gro" --bind "$_grw" "$_grw" \
		--unshare-net --unshare-pid --unshare-ipc --die-with-parent --chdir "$_gh" -- ./gate "$@"
}
# caseline ID SRC TASK: the om2 gate line that runs SRC on TASK's stdin and expects its output and exit (refcheck.sh
# runs the held-out references, which are not model-written, on these lines)
caseline() {
	printf '%s run %s file:%s/stdin file:%s/expected.out - %s\n' "$1" "$2" "$3" "$3" "$(cat "$3/expected.exit")"
}
