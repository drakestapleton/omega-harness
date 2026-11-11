# Security policy

## Reporting a vulnerability

Report privately. Do not open a public issue, patch or discussion about it, on Radicle or anywhere
else.

Email drake@aienos.com with the subject `[omega-harness] security report`. GitHub security advisories
are not a route: the project's GitHub organization has been frozen since 2026-11-07, and Interplane
(Radicle) is its only forge since 2026-11-11.

Include the commit or release you tested, the component (path), steps to reproduce, and what an
attacker gains. If the report involves a secret, say where it was exposed and do not send the
secret itself. Encrypted mail is not required; do not post proof-of-concept payloads publicly.

## Response targets

This project has one maintainer; the targets below are best effort and stated honestly.

- Acknowledgement: within 3 working days.
- Triage and severity: within 7 days of acknowledgement.
- Fix or mitigation for confirmed issues: aim for 30 days for high and critical, 90 days
  otherwise, with a status update at least every 14 days until closed.
- Disclosure: coordinated. An advisory is published with credit (unless you ask otherwise)
  once the fix is on the default branch. Default embargo 90 days, negotiable.

## Scope

This repository is agent guidance (Markdown skills) plus two example `.om` programs. It has no
build, no service and no CI.

In scope:

- A skill under `skills/` that instructs an agent to do something unsafe: write a token or
  credential into a file, commit or log; weaken a gate; add a trust path; run an effect without
  confirming authority; or edit a historical receipt.
- A credential, private machine address, home path, SSH username or operator-only configuration
  committed anywhere in the repository (AGENTS.md forbids this).
- An example under `skills/omega-encoding/examples/` that, compiled with the pinned compiler,
  reads or writes outside its declared bounds or behaves differently from what the skill records.
- A copy-paste command in `README.md`, `AGENTS.md` or a skill that does something other than what
  the surrounding text says.

Out of scope:

- The Omega compiler and runtime themselves; report those privately to the omega-mv maintainer
  (Radicle `rad:z6do9WDBhuSnvopDkgFdFr1yWA62`, https://interplane.io/drakestapleton/omega-mv).
- Conversion between Omega and other languages; report that privately to the omega-bridge maintainer
  (https://interplane.io/drakestapleton/omega-bridge).
- The agent harnesses that load these skills (omp, Claude Code, Codex and others), the Wolfram
  hosted endpoint, and the host operating system.

## Supported versions

Only the default branch `main`; there is no release. Reports against older commits are welcome
but fixes land on the default branch only.

## Status

The repository is documentation and procedure, not a compiler, a runtime, a gate, or evidence
that any claim is true (AGENTS.md). There is no certification and no bug bounty. See
AUDIT_SCOPE.md for what to review and how to check the examples.
