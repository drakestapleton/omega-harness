# AGENTS.md: omega-harness

Operating instructions for an agent working in this repository. Read this before editing a skill.

**Standing rules (Drake, 2026-11-11).** Interplane (https://interplane.io, serving the Radicle
repositories) is the only forge and the canonical source: never push to a GitHub remote, open or update
a GitHub PR or issue, publish with `gh`, or cite a GitHub branch as current state. New work is a new
Radicle repository or a landing on Radicle `main` with a receipt, finished only when interplane.io shows
it (URL and HTTP status). No hard caps on our own software: put a test that alarms instead.
`skills/omega-harness/SKILL.md` section 1 has both rules in full. Only Drake reverses them.

## What this repository is

Agent skills for working in Omega and the AIEN repositories: the checks that catch the mistakes agents
repeat, written as guidance an agent loads before acting. It is documentation and procedure, not a
compiler, a runtime, a gate, or evidence that any claim is true.

The skills live under `skills/<name>/SKILL.md` in the Agent Skills layout (frontmatter `name` and
`description`, then the body):

<!-- gen:skills -->
7 skills, each `skills/<name>/SKILL.md`; the use column is the skill's own frontmatter `description`:

| Skill | Use |
|---|---|
| `skills/aien-repositories/SKILL.md` | What AIEN builds and which repository owns a task: mission, doctrine, plan authority, task routing, evidence and status discipline, known source drift. Use before choosing an AIEN repository or making a cross-repository or status claim. |
| `skills/lean-verify/SKILL.md` | Machine-checked proofs with Lean 4 + Mathlib through the `lean` MCP server on the Spark. Use to prove a safety invariant (core disjointness, disk floor, lease exclusion, queue bounds, protocol/state-machine properties) about an explicit model, and to check that a proof has no sorry and no extra axioms. |
| `skills/omega-communication/SKILL.md` | Communicate Omega and AIEN work precisely: status and evidence labels, reports, PR text, agent handoffs, receipts, semantic needs, wire formats and corrections. Use when reporting, briefing agents, reviewing or publishing claims. |
| `skills/omega-encoding/SKILL.md` | Write .om that the seeded Omega compiler actually accepts: syntax, types, traps, bounds, register limits, host I/O, byte encoding, compiler errors, verified examples. Use before writing, reviewing or explaining any Omega program. |
| `skills/omega-harness/SKILL.md` | Operate in Omega and the AIEN repositories. Use for any Omega or .om task, compiler or migration work, AIEN architecture, repository routing, or project status claim. Covers source pins, .om-first implementation, compile and run evidence, safe effects, communication and stopping repeated errors. |
| `skills/wolfram-math/SKILL.md` | Mandatory mathematics through Wolfram. Use for any computation, derivation, identity, unit conversion, numeric constant, formula check or quantitative claim, and to set up or repair the Wolfram tools so an agent never computes by hand. |
| `skills/writing-omega/SKILL.md` | Portable guide to writing Omega (.om) programs that the seeded omc compiler accepts and runs correctly: program shape, types, words, traps, compiler errors 1..30, common mistakes with the exact refusal, and tested examples. Use before writing or reviewing any .om program on any machine. |
<!-- /gen:skills -->

`examples/` holds the tested programs: each `NAME.om` with `NAME.expect` (and `NAME.stdout` when it
prints), one per trap and error code plus the common mistakes; `skills/omega-encoding/examples/` holds
more. `examples/gate.sh OMC` checks the compiler hash against `PIN` and reruns every program in
`examples/` and `skills/*/examples/`; run it after any change to an example or a language rule.

<!-- gen:examples -->
`examples/gate.sh` reruns 132 programs: 127 in `examples/` and 5 in `skills/*/examples/`.
<!-- /gen:examples -->

`PIN` is the one place the compiler pin is written. `data/reference.tsv` is omega-mcp's reference data
for that pin; `tools/` holds the Omega programs that generate the guides' pin, word, error and trap
tables, example counts and skill lists (`guides.om`, `jflat.om`), the agents' instruction files from
`rules/rules.txt` (`rules.om`), the guide gate `check.sh`, the repin `regen.sh` and the installer
`install.sh`. `LICENSE` is Apache 2.0.

`coder/` is harness configuration for an Omega-only `omp` session: a TypeScript `omp` extension that
allows `.om` writes only and runs the pinned `omc` after each one, the builder of its context pack
(sections 2-11 of `omega-encoding` plus compiled examples), and a held-out eval. See `coder/README.md`.
When `omega-encoding` sections 2-11 change, rebuild the pack with `coder/build-context.sh`.

## Before you edit a skill

1. Read the skill you intend to change, and `skills/omega-harness/SKILL.md` section 6: which facts are
   generated (never edit inside a `<!-- gen:NAME -->` block; the pin lives only in `PIN`) and which
   skill absorbs a kind of prose change.
2. Check the claim against the source it cites, at the commit it names. A skill body is never its own
   authority. Follow any instruction file in the repository you are reading; `.crumb` files are
   history, not instructions (DRA-97).
3. Rewrite the prose in the same piece of work as the change that made it untrue, and delete rules the
   change made untrue instead of adding a contradicting rule. A dated observation names its compiler
   and date; a sentence that states the current pin, a current count or another repository's current
   head belongs in a generated block or nowhere.
4. If an example or expected output changed, rerun it against the pin and record what you
   observed. Never copy a predicted result into a guide.

## What these skills must not do

- Claim more than the evidence: a compile is not a run, a host run is not hardware qualification, a
  merged patch is not a deployment.
- Present a model explanation, a recalled memory or a stale skill as execution evidence.
- Invent Omega syntax or compiler limits. Check the keyword table and the compiler at the pin.
- Carry credentials, private machine addresses, home paths, SSH usernames or operator-only
  configuration. Keep those in ignored local configuration.
- Rewrite old evidence to make a new claim pass.
- Add a language, tool or vendor as part of the trusted stack. Conversion belongs to
  `aien-dev/omega-bridge`, which converts a declared subset and refuses the rest.

## Omega pins

`PIN` holds the pinned omega-mv commit and the sha256 of its `seed/out/omc`; nothing else in the
repository may type either (`tools/check.sh` fails the gate). To repin, edit `PIN` and run
`tools/regen.sh OMC [OMEGA_MCP]`: it takes omega-mcp's reference data for the new pin and regenerates
every block. Then rerun the examples with the new compiler, rewrite any prose the new compiler made
untrue, and record what you observed with its date. Older measurements stay as dated history.

Re-check, read only, in a fresh clone:

```sh
git clone rad://z6do9WDBhuSnvopDkgFdFr1yWA62 omega-src
git -C omega-src checkout "$(sed -n 's/^omega-mv //p' PIN)"
sha256sum omega-src/seed/out/omc   # must equal the omc-sha256 line of PIN
```

## Verifying a change here

The deliverables are Markdown, the example programs in `examples/` and `skills/*/examples/`, and the
generators in `tools/`. Two gates, both with the pinned omc on Linux AArch64:

- `examples/gate.sh OMC`: every example program.
- `tools/check.sh OMC`: every generated block matches its sources, no pin or derived count is typed
  outside a block, `rules/rules.txt` is well formed and holds nothing private, and each of these
  checks fails its own negative control.

Also:

- Every relative link and file path you add or move must resolve in the checkout.
- Frontmatter `name` must equal the directory name, and `description` must say when to use the skill.
- For an example program, run it on Linux AArch64 against the pinned compiler and record the compile
  status, run status and observed bytes, plus a negative control. The recipe is in `README.md` under
  "Check the examples yourself".
- Do not run the examples on a machine where another agent holds the GPU or the live model service.
  These examples are host programs and need neither.

## Reporting

Follow `skills/omega-communication/SKILL.md`. Separate proposed, implemented, exercised, verified,
merged and deployed. A patch's READY hand-off leads with the evidence: the commands, the observed
output, the negative control, and what was not run.

## Contributing

This repository lives on Radicle: `rad clone rad:z39gvwWsnkRZsAConQLjaKiNVLHfW` or `git clone
https://www.aienos.com/rad/z39gvwWsnkRZsAConQLjaKiNVLHfW.git`, shown at
https://interplane.io/drakestapleton/omega-harness. The `aien-dev` GitHub organization is frozen
(2026-11-07) and GitHub is not a route (2026-11-11): never push, open a PR or open an issue there, and
treat its links as historical citations. A change lands on Radicle `main` with a receipt (receipts, not
approvals, 2026-11-11): rerun `examples/gate.sh` and `tools/check.sh` with the pinned omc and a
wrong-compiler control in a fresh `rad clone` of the exact head, write the landing receipt (commands,
exit codes, pins, log sha256), land it with the hive landing tools, then confirm the head on the
interplane.io page. A non-MERGE review verdict on that head stops the landing. After the landing, the
landing tools' `land-hooks.sh` `harness` hook re-installs the skills and the instruction files from the
landed head (`tools/install.sh --omc auto --rev <head>`; see its header). To report something stale without
changing it, open a Radicle issue (`rad issue open`).

Keep the attribution in `README.md` and `LICENSE` intact. Contributions follow the shared AIEN agent
rules at https://www.aienos.com/agents/RULES.md.
