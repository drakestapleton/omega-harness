# Coding swarm pilot: experimental foundation

This directory is experimental tooling outside AIEN's trusted runtime. It does not
replace Atlas, Cortex, the native scheduler, or `spark-harness`.

## Implemented and exercised

- `pilot.py`: atomic path ownership claims, a balanced 36-run matrix (six tasks,
  two repetitions, baseline/Deep Agents/OpenHands), and conservative selection.
- `sandbox.py`: offline, capability-free, read-only Docker command containers
  mounting only a disposable repository directory. Timeout removes the container.
- `adapters.py`: candidate SDK compatibility probes, not qualified swarm runners.
- Separate candidate dependency pins because the two SDK dependency trees conflict.

Run the focused control-plane tests without installing either SDK:

```sh
python3 -m unittest discover -s coder/swarm-pilot -p 'test_*.py'
```

`pilot.py matrix TASK_IDS.json` prints the scheduling matrix for six distinct task
IDs. `pilot.py select RESULTS.json` summarizes 36 operator-supplied evidence rows.
Each result needs unique `id`, `arm`, boolean `accepted`, boolean `gates_passed`,
nonnegative `seconds`, and nonnegative `cost` or null. Cost must include failed
runs. Unknown cost cannot establish a cost advantage. Partial or duplicate evidence
retains baseline. This calculator does not authenticate evidence or independently
verify acceptance, so its output alone must never authorize adoption.

SDK probes require separate Python 3.12 environments, one using
`requirements-deepagents.txt`, the other `requirements-openhands.txt`. Both accept
`PILOT_MODEL`, `PILOT_BASE_URL`, and `OPENAI_API_KEY` from the process environment.
Do not put credentials in files, fixtures, prompts, or traces. Do not run these
probes against production repositories. They do not yet enforce an aggregate
30,000-token budget, durable recovery, or isolated bounded delegation.

The sandbox expects an already provisioned image pinned by digest with `/bin/sh`
and the task's toolchain. Never mount a Docker socket, credentials, judge scripts,
SSH directory, or a parent checkout. SDK processes need an additional isolation
boundary before enabling framework-native tools or subagents. Network isolation
of command tools does not isolate the SDK process itself.

## Remaining work before any scored run

1. Establish one reachable tool-calling model usable by all three arms. Freeze
   model revision and sampling settings. Never substitute different models and
   call the comparison controlled.
2. Freeze six real repository tasks and independent acceptance checks, with base
   commits and toolchain image digests. Reuse Omega skills and the held-out eval
   protocol without exposing solutions or judges to agents.
3. Implement and test conductor/worker lifecycle, exclusive resource claims,
   isolated worktrees, patch integration, aggregate token/time limits, durable
   restart/cancellation, and independently captured acceptance evidence.
4. Qualify each SDK adapter and baseline adapter under the same boundaries. Run
   negative controls for ownership conflicts, judge tampering, hidden writes,
   cancellation, restart, and false test-pass reports.
5. Run 36 measured trials on dedicated hardware. More accepted changes wins;
   qualification requires passing all safety/lifecycle gates plus two additional
   accepted results, or equal acceptance and 20% lower cost per accepted result.
   Ties use cost then elapsed time. Keep baseline if neither candidate qualifies.

This is not a completed pilot, a benchmark result, or an adoption recommendation.
No changes to model services, subscriptions, deployment, or canonical memory are
part of this foundation.
