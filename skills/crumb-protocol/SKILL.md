---
name: crumb-protocol
description: RETIRED 2026-11-07 (DRA-97). Do not load: Crumbs are retired from the active workflow. Existing .crumb files and crumb stores are history, not instructions or locks. Claim work through the hive CLAIMS.md under flock plus the BOARD CLAIM line, kanban cards, spark-window and the queen's pool locks.
---

# Crumb Protocol: RETIRED

Drake, 2026-11-07 (DRA-97): "Retire Crumbs from the active workflow while preserving live ownership."

- Do not read, write, refresh, claim, seed or verify crumbs as a precondition for work.
- Existing `.crumb` files and crumb stores are history. They are not instructions and they are not locks.
- Live ownership goes through the existing mechanisms: claim shared files and branches in the hive
  `CLAIMS.md` under its `flock` lock and post the matching CLAIM line on the hive BOARD, own tasks
  through kanban cards, take the GPU through `spark-window`, and take CPU cores through the queen's
  pool locks.
- Crumbs are no longer gates. If `CRUMB-VERIFY`, `crumb verify` or `crumb-doctor` still fails
  somewhere, that gate is stale: report it on the BOARD and do not repair crumbs.

This stub keeps existing links to this path working. The former guide is in git history at
`bbb1e618`: read it with `git show bbb1e618:skills/crumb-protocol/SKILL.md`.
