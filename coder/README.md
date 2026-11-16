# coder: an Omega-only coding session for omp

Harness configuration that makes an `omp` session write Omega and nothing else, with the pinned
seeded compiler in the loop. It is not product code and not part of the trusted Omega stack: the
extension is TypeScript because `omp` extensions are TypeScript, and the builders are small shell
scripts. "Only Omega" is enforced by the harness and the compiler, not by model weights.

| File | What it does |
|---|---|
| `omega-guard.ts` | `omp` extension (load with `-e`). Refuses every write or edit except `.om` files and `NOTES.md` inside the session directory; refuses reads outside the session directory and the context pack; compiles each written `.om` with the pinned `omc` (sha256 checked before every compile) and appends the result, with the error's meaning and fix (from the pack's `errors.tsv`) and the offending line, to the tool result; adds the `omega_run` tool (compile, then run in a `bwrap` sandbox that holds only the session directory, read-only, and the program, with no network and no `/proc`); refuses to let the session finish while a touched `.om` fails to compile, or, with `OMEGA_CHECK` set, until that command exits 0 with a `SCORE ID pass` line. |
| `omega-prompt-head.md` | Rules part of the system prompt (tools, check loop, `DONE <file>`). |
| `omega-observed.md` | Compiler facts observed with the pinned `omc` that the skill does not state. Each has a probe in `observed/` (expected compiler and program exit status in `observed/expect.tsv`) that `build-context.sh` runs; a fact that stops holding stops the build. |
| `build-context.sh` | Builds the context pack: `OMEGA.md` = rules + `skills/omega-encoding` sections 2-11 (citation links stripped) + observed facts + the examples it lists, each of which must compile with the pinned `omc`; `CONTROL.md` = rules only; `PIN` (a copy of the repository's `PIN`) and `errors.tsv` (meaning and fix of each error code, from `data/reference.tsv`, which must be for the same pin), both read by the guard. Refuses an `omc` that is not the one `PIN` names. |
| `eval/` | Held-out eval: the tasks in `tasks/ID/{spec.md,stdin,expected.out,expected.exit}`, manifest `tasks.json`, runner `run.sh`, scorer `score.sh` (with `cat.om` and the sandbox in `case.sh`), `refcheck.sh` (tasks and held-out references checked at the pin before a run), `compare.sh` (checks the two arms were measured alike, prints per-task verdicts and the ledger line) and `selftest.sh` (all of it checked with a stub session on synthetic tasks in `selftest/`, no model needed). |

The guard is TypeScript because `omp` extensions are TypeScript; the builders and the eval scripts are POSIX
shell glue around the pinned `omc` and the om2 gate, which do all the checking (harness tooling under the Python
boundary rule, not product code).

## Environment read by the guard

| Variable | Default | Meaning |
|---|---|---|
| `OMEGA_HOME` | `~/.local/share/aien-omega` | holds `omc`, the built `gate` and `seed/qualification/om2/fixtures` |
| `OMEGA_CONTEXT` | `$OMEGA_HOME/context` | the one directory outside the session the model may read |
| `OMEGA_CHECK` | unset | shell command run (cwd: the session directory) when the session tries to finish; the finish is allowed only on exit 0 with a `SCORE ID pass` line (`eval/run.sh` sets it to `score.sh` on the task) |
| `OMEGA_STOP_LIMIT` | `0` (no limit) | after this many refused finishes the finish is allowed and logged |
| `OMEGA_LOG` | unset | append-only log of every allowed/refused tool call, compile and finish |

No pin is typed in these files. The `omc` sha256 comes from the repository's `PIN` (the pin follower moves
it): `build-context.sh` refuses any other `omc` and copies `PIN` into the pack, the guard reads
`$OMEGA_HOME/context/PIN` and refuses every compile when `omc` differs, and `eval/run.sh` refuses to start
unless `omc` and the pack's `PIN` both match the repository's and `$OMEGA_HOME/omega-guard.ts` is this repository's
guard. `omega_run` runs the program with only the session directory in view (read-only), no network, no `/proc`
and the timeouts set in `omega-guard.ts`.

## Running it

Build the pack, install the guard, then start `omp` in the project directory with no shell tool:

```sh
OMEGA_MV=/path/to/omega-mv OMC=$HOME/.local/share/aien-omega/omc sh coder/build-context.sh ~/.local/share/aien-omega/context
# rebuild the pack whenever PIN moves; run.sh refuses a pack built for another pin
cp coder/omega-guard.ts ~/.local/share/aien-omega/
omp --model PROVIDER/MODEL --tools read,edit,write,grep,glob,omega_run --no-skills --no-rules \
    --no-extensions --no-lsp --no-context-files -e ~/.local/share/aien-omega/omega-guard.ts \
    --system-prompt ~/.local/share/aien-omega/context/OMEGA.md
```

`--no-extensions` does not stop an extension named with `-e`. Use an isolated `omp` profile with
advisors off and no other providers so the session cannot fall back to another model.

## Eval

`sh coder/eval/run.sh omega|control OUTDIR coder/eval/tasks` runs every task in a fresh empty
directory, one after another. The `control` arm keeps the model, tools, guard and check loop and swaps
the system prompt for `CONTROL.md` with an empty readable context, so the only variable is the Omega
context. The session is not blind to the scoring case: `run.sh` sets `OMEGA_CHECK` to the scorer on the task,
so the guard runs it when the session tries to finish and shows it the verdict (up to `OMEGA_STOP_LIMIT`
times). Both arms get the same, so the comparison is like for like, but a pass rate here is "pass with feedback
from the scoring case", not a blind pass rate, and the `LEDGER` line says so. Scoring does not trust the session:
the runner compiles `main.om` with the pinned `omc` (non-zero exit or no file = compile-fail), then `score.sh`
runs the om2 gate in two stages, each in a fresh scratch directory inside `bwrap` with nothing in view but the
system directories, the gate, `omc`, the gate fixtures and that stage's inputs (copied in; no root, no `/proc`,
no network, own pid namespace), since the gate is not a sandbox and the program is model-written. Stage A runs
the program on a copy of its standard input with no expected output anywhere it can read, and decides compile,
exit status, stderr, deadline and signal; stage B runs the trusted `cat.om` on the program's saved stdout against
the task's expected output, so the byte comparison is still the gate's. Both PASS = pass, a different exit,
stderr or stdout = wrong-output, past the deadline = timeout, killed by a signal = crash.
What is not the model's answer stops the run with exit 3 and no row, so a rerun retries the task: a session
that ends with a code other than 0 or 124 (for example an unreachable model server), an `omc` or gate that
cannot execute, a scorer result with no verdict on the program (an unreadable fixture, scratch or exec
failure), and a session that ended normally while the guard log shows no finish (the guard was not loaded) or
shows a guard without the task check. A task id with no directory, and a task or fixture file name with white
space, are refused.
The session's only time limit is the wall-clock timeout around `aien` (rc 124, scored); `aien`'s own
`--max-time` is not used, since what it does at the limit is not known here. Session limits, the
case deadline, the case line, the sandbox and the verdict words are in `eval/case.sh`.

The runner cannot see which model `aien` serves or its sampling seed, so the operator states them in
`OMEGA_EVAL_MODEL` (required) and `OMEGA_EVAL_SEED` (required; `none` when the profile fixes no seed). It
writes `OUTDIR/manifest.tsv`: arm, model, seed, and the sha256 of the compiler, gate, gate fixtures, the prompt
this arm got and both prompt files (so the rules text must match across arms), guard, error table, the runner (`run.sh` with `case.sh`, `score.sh` and `cat.om`, which hold the prompt template, the session limits,
the case line and the verdict words), the task files
(name and digest of each) and their count, and the `aien` program, with `aien --version`. A resume into an `OUTDIR` whose
manifest differs is refused, and so is an `OUTDIR` with result rows but no manifest (rows scored with unknown
inputs, such as those an older runner wrote). `sh coder/eval/compare.sh OMEGA_OUTDIR CONTROL_OUTDIR` refuses two arms whose
manifests differ in anything but arm and the prompt that arm got, an arm whose prompt is not its own prompt
file, scored task ids that are not exactly the task directory's, or a row with an unknown verdict or a session
code other than 0 or 124, then prints the raw per-task verdicts side by side, an `AT_LIMIT` line for each row
stopped by the session timeout or let finish by the stop limit (its guard log says `stop allowed after`), the
totals and a `LEDGER` line with the number of such rows per arm. The guard is the same in both arms, so both get the compiler's error meaning and fix after each compile;
only the prompt and the readable context differ. (Before 2026-11-15 the guard gave a shorter typed meaning
table; no complete run exists from then to compare with.) A seed of `none` is recorded as such: that run
cannot be repeated exactly, and the `LEDGER` line says `seed none`.
`OMEGA_HOME=... sh coder/eval/selftest.sh` checks the runner, `compare.sh`, `refcheck.sh`, the scorer and the
guard's run sandbox with a stub session that records what each session was given (system prompt file, readable
context, task check, stop limit, task prompt) and answers differently per arm; it includes a program that
prints the expected output by its absolute path, which must not pass, and a copy of the scorer with a read-only
root, under which it must pass. Its header lists every case. Exit 0 = SELFTEST PASS (needs `node` for the
guard's sandbox).
The installed `aien` (`~/.local/bin/aien`, read 2026-11-16; not in this repository) passes `--system-prompt
"${OMEGA_PROMPT:-$OMEGA_HOME/context/OMEGA.md}"` to `omp` for `--omega`, so the runner's `OMEGA_PROMPT` is the
system prompt the session gets; its sha256 is in the manifest, so a changed `aien` shows there.

Running both arms (on the machine that has `aien` and its model; start new OUTDIRs whenever PIN moves, since
results from another pin are not comparable):

```sh
H=~/.local/share/aien-omega MV=/path/to/omega-mv     # MV at the commit PIN names, omc sha256 = PIN
mkdir -p $H/seed/qualification/om2 && cp $MV/seed/out/omc $H/omc
cp -r $MV/seed/qualification/om2/fixtures $H/seed/qualification/om2/
$H/omc < $MV/seed/qualification/om2/gate.om > $H/gate && chmod +x $H/gate
OMEGA_MV=$MV OMC=$H/omc sh coder/build-context.sh $H/context && cp coder/omega-guard.ts $H/
OMEGA_HOME=$H sh coder/eval/selftest.sh
OMEGA_HOME=$H sh coder/eval/refcheck.sh coder/eval/tasks coder/eval/tasks.json /path/to/references   # REFCHECK PASS first
export OMEGA_EVAL_MODEL=<exact model id> OMEGA_EVAL_SEED=<seed or none> P=$(sed -n 's/^omc-sha256 //p' PIN | cut -c1-8)
sh coder/eval/run.sh omega   ~/handoffs/OmegaCoder/eval-$P/omega   coder/eval/tasks
sh coder/eval/run.sh control ~/handoffs/OmegaCoder/eval-$P/control coder/eval/tasks
sh coder/eval/compare.sh ~/handoffs/OmegaCoder/eval-$P/omega ~/handoffs/OmegaCoder/eval-$P/control
```

The reference solutions are held out: they are not in this repository, the context pack or any
session directory; `tasks.json` records only their sha256. They were checked with the gate at omc `2c824805`
(omega-mv `f1b9ecb5d`, 2026-11-05): 27/27 PASS, with a negative control that failed as it should. They have not
been re-run at a later pin, since the references are not in this repository. Keep `coder/eval/` out of any
training corpus built from this repository, or the eval stops measuring anything.
