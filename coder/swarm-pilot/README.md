# AIEN coding swarm pilot

A local development pilot comparing configured OMP, Deep Agents/LangGraph and
OpenHands coding teams against the same model, source tasks and acceptance checks.
It is experimental tooling, outside AIEN's native runtime. Atlas, Cortex and
`spark-harness` retain their existing responsibilities.

## What runs

Each trial has one read-only conductor and at most three active workers. Workers
receive exclusive paths in separate repository snapshots and cannot delegate. These are exported workspaces,
not linked Git worktrees; in-worker Git/PR lifecycles are not part of this pilot.
`repo_command` executes offline Docker commands; only claimed paths are writable.
The controller independently inventories changed files before integrating them.
Command output is capped at 16000 bytes; excess output is refused before it can
be buffered unboundedly. Unconfirmed cleanup cancels further execution authority.
It does not trust the candidate's Git index, check claims or final prose.

SQLite transactions persist ownership, requests, token reservations, cancellation,
worker state, events and the canonical workspace version. Integration creates a
complete new version before switching the durable pointer. Retrying a completed
worker request does not apply it twice. A single-conductor lease and per-worker
locks prevent duplicate execution. An interrupted conductor can resume from its
existing run directory; unresolved model requests keep their budget reservation.
Cancelled and completed runs are terminal. Resume does not silently free unknown
usage or replay completed integrations.

SDK processes run in Linux bubblewrap with system libraries, their own installed
packages and only the adapter entrypoints. They cannot read the host home,
credential store, repository snapshots, judge files or reference solutions.
Their registered tools call the controller over an authenticated loopback endpoint.
OMP's existing `auth-gateway stdio` resolves provider credentials outside them.
No provider keys are copied into pilot configuration or agent environments.

The proxy fixes the model route and low reasoning effort, caps completions at
1,024 tokens and accounts for aggregate provider-reported usage. Each run has a
30,000-token and 1,200-second limit across conductor and workers, including final
acceptance. Before each request it reserves an input-token estimate plus a
2,048-token protocol allowance and the completion cap. With tiktoken installed,
the estimate uses `o200k_base`; otherwise it conservatively uses UTF-8 bytes.
Unknown usage retains its reservation. Usage outside its reservation fails closed.
This is conservative admission control, not a guarantee about undisclosed provider
internal tokenization. In-flight requests are stopped and reconciled before a
result is finalized; already-sent remote requests cannot be unsent.

## Reproduce

Use a Linux AArch64 development host with Docker, bubblewrap, Python 3.12 and
OMP 18.18.1 already authenticated. Keep workloads off the interactive Mac. Install
the candidate environments separately using the matching `.lock` requirements;
their dependency trees conflict when installed together. Run the controller with
the OpenHands environment's Python so tiktoken is available.

The trusted toolchain JSON contains these nonsecret fields:

- `model`: the shared gateway route, such as `openai-codex/gpt-5.6-sol`.
- `image`: Docker image pinned as `repository@sha256:...`.
- `compiler`: `path` and `sha256` of the seeded AArch64 `omc`.
- `environments`: absolute paths to the `deepagents` and `openhands` environments.
- `omp`: absolute path to the OMP executable.
- `omp_version` and `package_pins`: recorded environment identities.

Never include keys, tokens or personal data. Example commands:

```sh
python -m unittest discover -s coder/swarm-pilot -p 'test_*.py'
python coder/swarm-pilot/campaign.py /path/to/toolchain.json /path/to/repository /path/to/new-campaign
python coder/swarm-pilot/audit.py /path/to/campaign
```

The campaign first runs software tests, seven actual Docker boundary checks, and
negative-start/positive-reference controls for all six independent judges. It then
freezes source, judge, qualification, configuration and code identities before any
scored model request. It uses a deterministic shuffled trial order (seed 498) and
runs one trial at a time. Repeating the campaign command resumes existing results;
changing code/configuration refuses the resume. Preserve failed preflights and
runs. Never tune prompts or judges against a running campaign.

For a single task, `runner.py CONFIG SOURCE OUTPUT` uses a trusted config with
`id`, `task`, `repeat`, `arm`, `model`, `image`, `allowed_paths`, `prompt`,
`environments`, `omp`, optional pinned `compiler`, and qualification/source/judge
hashes. Without qualification evidence, a standalone run cannot qualify a harness
for adoption. `Session.cancel()` stops further admission; the active controller
reconciles active processes and cleans up containers bearing its session label.

## Evidence and selection

The six tasks are authored development tasks over foundation commit `f5aa51d`:
input validation, an ownership API addition, compiled Omega, independent edits,
atomic conflicting claims and ownership serialization/recovery. They are not an
unseen general benchmark. The repository already publishes their specifications;
the agent workspaces receive only frozen source, task instructions and a public
Omega syntax reference. Existing `coder/eval` held-out tasks are not consumed.

Two repetitions across three arms produce 36 trials. Every run retains a portable binary-capable `patch.diff` and a complete
independently hashed workspace, raw provider trace, SDK
logs, durable events, actual usage and an independent judge verdict. The parallel
case also requires multiple integrated workers. Judge scripts mount only after
agent execution ends, in a separate offline container. This is ordinary isolated
test evaluation, not certification against arbitrary malicious Python code.

`audit.py` reconciles all 36 configurations, model/image pins, qualifications,
judges, source identities, token records, workspace hashes and acceptance evidence.
`pilot.py select RESULTS.json` is a calculator over supplied rows; use the audit
before relying on its result. Missing/unbalanced/mixed evidence retains baseline.

A candidate qualifies only when every run retains passing lifecycle/budget gates
and it completes at least two more trials than baseline, or matches completion
with at least 20% lower measured cost per accepted result. Rank qualifying
candidates by accepted results, cost, then elapsed time. Unknown subscription
costs remain null and cannot establish savings. Failed-run durations are not
accepted-code speedups. Provider model IDs pin the requested route; immutable
hosted model weight revisions are not exposed by this interface.

Keep raw evidence private in the campaign directory (mode 0700). Publish only
reviewed aggregate results and hashes. LangSmith or Langfuse integration and
Atlas/Cortex execution-cell integration are separate follow-on decisions.

## Completed pilot

[The 8 November report](evidence/2026-11-08-report.md) records the audited outcomes
and the decision to retain OMP. The post-campaign output hardening is qualified
separately from the frozen trial implementation. For the real process-exit
control, run `sh coder/swarm-pilot/verify-recovery.sh /path/to/new-recovery-check`.
