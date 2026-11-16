---
name: nvidia-gb10
description: Load before touching the NVIDIA GPU in Drake's DGX Spark (the GB10 chip). Covers running or benchmarking a model on the Spark GPU, the shared model service, the chip lock and timing windows, NVIDIA driver debugging, writing kernels for the chip, and the mistakes already made there.
---

# NVIDIA GB10 (the Spark's GPU): how to work on it without repeating old mistakes

Researched 2026-11-14 (Spark clock 2026-11-15T01:54Z) from our own records, plus NVIDIA's documentation fetched
through Context7 the same day (section 12). Every line carries a source. Sources:
`RULES` = the agent instruction file installed on the Spark from this repository's `rules/rules.txt` plus the
machine's local overlay (generated, binding, newer than anything here);
`BOARD <time>` = a line of `HANDOFFS/BOARD.md` on the Spark; `Lnnn` = an entry of `ledger list all` on the Spark;
`cortex <id>` = `cortex_get <id>`; `TEAM-MEMORY:n` = line n of `HANDOFFS/TEAM-MEMORY.md`.
Machine-local places are named, not spelled out; the Spark's local configuration says where each one is:
`HANDOFFS` = the team's shared handoff folder (board, team memory, evidence); `BIN` = the operator's local tool
folder; `STATE` = the operator's local state folder; `DOCS` = the offline vendor manuals; `YARDSTICKS` = the
timing windows and receipts folder; `MODEL_PORT` = the local port of the shared model service.
The Spark's local overlay of RULES spells out the real folders and port that `HANDOFFS`, `BIN`, `STATE`, `DOCS` and
`MODEL_PORT` stand for; the header of
`spark-receipt` names `YARDSTICKS`. Substitute the real values from there before running a command below.
Numbers are quoted from those records with their dates. Nothing here was re-measured.
If a record and this file disagree, the record wins. Section 11 lists what the records themselves disagree on.

## 1. What the hardware is

- NVIDIA GB10 Grace Blackwell superchip: Blackwell GPU, compute capability SM 12.1 (`sm_121`, not datacenter
  Blackwell), with 10 Cortex-X925 + 10 Cortex-A725 cores. [Spark skill `spark-hardware-manual` section 1]
- PCI device 10de:2e12 at 000f:01:00.0. `nvidia-smi` names it "NVIDIA GB10", driver 580.173.02
  (open kernel modules). [GPUID.TXT below; `nvidia-smi --query-gpu=name,driver_version` read 2026-11-15T01:54Z]
- The chip's own identity registers say GB20B, not GB10B: BOOT_0 0x1bb000a1, BOOT_42 0x1bba1000 = architecture
  0x1B (GB200), implementation 0xB. Read on bare metal 2026-11-12T05:45Z.
  [`HANDOFFS/hive/finalize/spark-boot/result-20261112T054515Z/GPUID.TXT`; L1267; cortex ca5df793-54f4-4bdc-9d43-36e91c4750ba]
- Unified memory: one LPDDR5x pool for CPU and GPU, no separate GPU memory. `nvidia-smi` shows memory total as
  N/A; that is normal here. Linux MemTotal is 127598752 kB = 121.69 GiB (aien-calc, not stored). Marketing size
  is 128 GB. [`spark-hardware-manual` section 1; `/proc/meminfo` read 2026-11-15T01:54Z]
- Two dies. Memory controllers sit on the CPU die, so every GPU byte to or from DRAM crosses NVLink-C2C
  (345 GB/s per direction per `nvidia-smi c2c -s`). GPU L2 is 24 MiB. [TEAM-MEMORY:5; whitepaper `DOCS/gb10/`]
- Memory bandwidth: 273 GB/s is derived (8533 MT/s x 256 bit), aggregate for reads and writes. Measured GPU DRAM
  read ceiling 236.9 GB/s on 2026-10-25. [cortex omp-learn-ef4477f648e01652]
- 48 SMs, 1536 threads per SM, 65,536 registers per SM, 100 KiB shared memory per SM carvable (measured
  2026-10-25). A launch of 1024-thread CTAs fits one CTA per SM, so one wave is 48 CTAs.
  [cortex omp-learn-ef4477f648e01652; TEAM-MEMORY:16]
- SM clock: idle 208 MHz, 2548 MHz observed under a 35B load (2026-10-25); 2444 MHz seen under a sustained full-GPU load
  (2026-11-08). `nvidia-smi` gives memory clock and power limit as N/A. [same cortex id; BOARD 2026-11-08T23:37:31Z]
- Vendor documents are kept offline in `DOCS` (GB10 whitepaper and Hot Chips deck in `DOCS/gb10/`), searched
  with `doc-grep` / `doc-page`. The Blackwell Tuning Guide is datacenter-first: only its CC 12.x lines apply.
  Doc traps: "8 TB/s HBM3E" is GB300 and "126 MB L2" is GB200. [TEAM-MEMORY:18; cortex omp-learn-ef4477f648e01652]

## 2. Binding rules that govern GPU use (read RULES; this is only an index)

- "Shared model on MODEL_PORT: claim time on the board" (Drake, 2026-11-14). See section 4.
- "Play well together" (2026-10-24): look first, say on the board what you run and for how long, use an idle chip
  without asking anyone, step aside when asked, never kill or block a coworker's job. Never ask Drake for
  permission to use an idle shared resource.
- "Debugging a machine" (2026-10-03): read the manufacturer's documentation before experimenting. A hook
  (the harness hook `manual-guard.sh`) blocks chip and driver edits and launches until
  `docs-read REPO "SOURCE" "QUOTED LINE or DOCS SILENT on X"` is recorded (valid 8 h). Load the Spark skills
  `spark-hardware-manual` and `investigate` first.
- "Hardware first" (2026-10-24): reason from the chip, memory movement and measured bottlenecks; new code is Omega.
- "Build our own, close to the metal" (2026-10-16): outside tools are research or a comparison point, never the
  plan. Report speed against the hardware ceiling, not only the old baseline.
- "Mathematics goes through Wolfram and the calculator" and "No estimates without a receipt": every figure comes
  from `aien-calc eval` (cite `calc:<id>`) or Wolfram; otherwise write "not measured".
- "Harness lock": never swap which model serves on MODEL_PORT unless its four conditions hold (Drake's words from
  this session quoted on the board, replacement proven, undo written first, plain note to Drake).
- "Spark is for development, not serving" (Drake, 2026-11-14): never leave any model running when you are not
  using it; bring yours up and down with a trap; no model service enabled at boot.
  [`HANDOFFS/RULE-spark-no-idle-models.md`; BOARD 2026-11-14T13:36:01Z]
- Never kill, stop or restart another lane's job; coordinate a restart with that lane on the board (any agent
  may take the coordinator role). [RULES]

## 3. Before you touch the chip

1. Look: `spark-window status`, `nvidia-smi --query-compute-apps=pid,name,used_memory --format=csv`,
   `ps`, and the last 40 lines of `HANDOFFS/BOARD.md`. [RULES "Play well together"]
   `BOARD.md` is about 3 MB: always `tail` it or `grep ... | cut -c1-600`.
2. If a current CLAIM, START or RESERVED line names the chip or MODEL_PORT, wait or settle it on the board.
3. Post one board line before you start (what, how long, how to reach or pause you) and a RELEASE or DONE line
   after: `echo "$(date -u +%FT%H:%MZ) CLAIM <lane> to all: ..." >> HANDOFFS/BOARD.md`. [RULES "Team board"]
4. The chip lock is the file `/tmp/aien-gb10.lock` (flock). Take it through `spark-window`, not by hand, when
   timing. `spark-window locks gb10` shows holders and queue. [`BIN/spark-window` header]
5. Check memory before any load (section 5).
6. CPU-side work during someone's timing window: run under the queen pool locks
   (`HANDOFFS/hive/queen/pool-*.lock`, flock), `taskset`, `nice 10`, and post pid/pgid so the timing lane can
   SIGSTOP and SIGCONT you. [cortex omp-learn-0bcfaab846d0e636]

`spark-window` usage (from its header, read 2026-11-14; do not paraphrase from memory, run `sed -n 1,60p` on it):
- `spark-window open NAME [--ledger ID] [--lease MIN] [--gb10 exclusive|shared|none] [--quiet exclusive|none] [--wait]`
- `spark-window run CMD...` sets `SPARK_WINDOW`, `SPARK_WINDOW_DIR` and, if it holds the chip, `AIEN_GB10_LOCK_HELD=1`.
- `spark-window close [ID]`, `status`, `id`, `locks [gb10|quiet]`.
- One window at a time. Exclusive windows are for timing receipts only and last at most 20 min; an overrun gets
  NO VERDICT. `--quiet none` is for value checks and must never produce a number reported as a speed.
- `open` waits for a quiet machine (gives up after 2700 s by default: load at most 10, at most 3 quiet-lock
  jobs), then waits for the chip lock with no timeout. [cortex omp-learn-923b7b170bf8244f, read from source 2026-10-30]
- `STATE/aien-coordinator/CHIP-RESERVED` is a courtesy note that spark-window prints; it is not a gate.
  [RULES; TEAM-MEMORY:11]

Automatic actors you will meet:
- `chip-watchdog` (`BIN/chip-watchdog`, seen running on 2026-11-15): every 5 s it checks the
  exclusive holder of `/tmp/aien-gb10.lock`. If that process tree used no CPU and 0 % GPU for 45 s
  (`CHIP_WATCHDOG_WINDOW`), it sends SIGTERM then SIGKILL and posts a board line. Holding the lock through an
  idle baseline gets you killed (BOARD 2026-11-14T15:20:25Z and 15:22:10Z). A client that holds the lock for a
  detached container is killed at about 45 s while the container keeps running.
  [script source; cortex omp-learn-b2a3151da06520eb]
- TracePause (a loop run from another session, seen 2026-11-15): SIGSTOPs other lanes' CPU jobs during a timing window and
  SIGCONTs them after. A stopped job shows rc 147. Check the board for an open PAUSE line before starting jobs.
  [BOARD 2026-11-15T00:05:26Z, 00:06:50Z; TEAM-MEMORY:27]

## 4. The shared model on port MODEL_PORT

- What it is (2026-11-14): `aien-serve-http --engine omega`, model `qwen3.6-35b-a3b-fp8` (the "35B"), started by the
  systemd user unit `motor-revival.service` (L1015). The unit checks the sha256 of the binary and then of the
  weights before it starts the server; read its working directory, environment and command line from
  `systemctl --user cat motor-revival.service` (read 2026-11-15), not from a copy. On 2026-11-15 the unit pinned
  the server to two X925 cores inside `quiet-measure`'s set (section 6): check its `CPUAffinity` before timing
  beside a running server.
- The unit is disabled and normally inactive since 2026-11-14. [`HANDOFFS/RULE-spark-no-idle-models.md`; `is-enabled` = disabled]
- Check: `nvidia-smi --query-compute-apps=pid,name,used_memory --format=csv`, `spark-window locks gb10`, and
  `curl -s localhost:MODEL_PORT/health` (reported fields: status, model, engine, concurrency, in_flight).
  [BOARD 2026-11-14T10:04:23Z; cortex omp-learn-a9344da0159c83f9]
- Start (after a board CLAIM): `systemctl --user start motor-revival.service`. Stop: `systemctl --user stop
  motor-revival.service`; wrap both in a script with a trap so the model goes down on every exit path.
  [BOARD 2026-11-13T20:26:56Z, 2026-11-14T13:40:52Z]
- The rule (Drake, 2026-11-14): the model may be shut down and left DOWN; nobody has to put it back. Do not stop
  it under a lane with a current claim. Post a quiet-time or test claim, then a RELEASE line. [RULES]
- While it runs it uses about 56 GiB of the shared pool (56089 MiB, nvidia-smi 2026-11-15T01:54Z) and, as started
  by the unit, holds `/tmp/aien-gb10.lock` exclusively for its whole life. Any other chip job then waits or
  reports NOT_RUN (L1072). [`spark-window status` 2026-11-15T01:54Z]
- Do not wrap a request to the server in `flock /tmp/aien-gb10.lock`: the server takes that lock itself and
  answers 503. Send when `flock -n /tmp/aien-gb10.lock true` succeeds and retry only on 503. Its default is
  top_k 20; send top_k 0 for greedy work. [cortex d4e0f1ee-96de-4c63-be17-aca1d032c712, 2026-10-20, 27B build]
- A second large model never fits beside it: on 2026-10-25T02:47Z a second 35B load passed its MemAvailable check
  and the kernel OOM killer took the live server. [cortex omp-learn-17961307b17bbeac]
- For A/B timing of serving builds use a private port, not MODEL_PORT, so other clients do not contaminate the arms.
  Test-server ports have owners (TEAM-MEMORY:2). [cortex omp-learn-a9344da0159c83f9]
- The server refuses requests that carry tools ("tool calling is not supported"). [L1150]
- If you must kill a server by hand, select the pid by `--port`, not by a pgrep pattern (a pattern once matched
  the caller's own shell). [cortex omp-learn-465866d88240ca4b]

## 5. Memory: one pool, and MemAvailable lies

- GPU allocations come out of host RAM. A device upload plus host buffers next to a resident server triggered the
  OOM killer on 2026-10-18 (it killed the live server). Guard used since: refuse unless MemAvailable is at least
  the upload size + 12 GiB. [cortex 0d7da592-3ac5-41f7-b8d4-5559a1044163]
- MemAvailable counts mmapped model file pages as reclaimable while they are in use. Admission should use
  MemAvailable minus Mapped. [cortex omp-learn-17961307b17bbeac; `BIN/q36-extra` header v4]
- Wait for memory first, then take the chip lock, then check memory again; if short, drop the lock and loop.
  Never wait for memory while holding the lock. [cortex 19998b69-4c84-4c7d-ad44-0b0d771249e9]
- Leave about 10 s (or a readiness check) between one chip process exiting and the next starting: RM frees memory
  late and the next process dies with NV_ERR_NO_MEMORY. [cortex 9eb3320d-52bb-4e2d-b331-7b3a7b0e520b]

## 6. Measuring speed correctly

- Value checks (tokens, logits, cosines) may share the chip. Only timing needs it alone, for as short as the
  measurement needs. [RULES "Play well together"; spark-window header, L405 policy]
- A speed number counts only from an exclusive window on a quiet machine:
  `spark-window open NAME --wait`, then `spark-window run spark-receipt NAME -- CMD`, then `spark-window close`.
  `quiet-measure CMD...` pins CMD to the X925 cores (5-9,15-19) under the quiet lock.
  [headers of `spark-window`, `spark-receipt`, `quiet-measure`]
- What invalidates a number: the window overran its lease (NO VERDICT); it ran with `--quiet none`; builds ran
  beside it (label it "shared machine"); other clients hit the same server; the model on MODEL_PORT was generating.
  A contaminated baseline was discarded on 2026-10-24 when untouched kernels moved 3.86 to 4.02 ms.
  [spark-window header; cortex 9eb3320d-52bb-4e2d-b331-7b3a7b0e520b]
- Budget a sweep against the lease deadline (mtime of `$SPARK_WINDOW_DIR/held` + lease), not your own start time;
  wrap each run in `timeout`; log skipped cells NOT_RUN. [cortex omp-learn-923b7b170bf8244f]
- `GraphStats.chip_ns` is host-clock time from submit to marker seen (50 us poll after a 2000 us spin), not GPU
  time. Use per-launch device stamps for a true split. [cortex omp-learn-f5a39ecbf8ef75f3, 2026-10-31]
- An instrument's off-switch control must also reject stale data from an earlier run (stamps once came back
  "valid" with stamping off). [cortex ec9876e5-643e-4558-9aa5-8b0b0589664f]
- The engine flushes GPU L2 at launch end, so a GPU-cached "control" read after completion proves nothing.
  [TEAM-MEMORY:15]
- Compute bytes-per-token floors with a stated bandwidth and say which: 273 GB/s nominal or 236.9 GB/s measured.
  Before tuning a grid constant: waves = ceil(CTAs / 48). About 22 us per launch is fixed cost, so fewer
  launches beat better grids. [TEAM-MEMORY:9, 16, 24; cortex omp-learn-ef4477f648e01652]
- Head-to-head runs: freeze the protocol before any timed number, check correctness first, report prompt
  processing and generation separately, record driver, clocks, power state and load per session, and disclose
  which arms load NVIDIA user-space libraries. Model: `HANDOFFS/H2H9B/PROTOCOL.md` (v3, 2026-10-27).
- Drake on comparisons (2026-11-13): if ours does not beat theirs, assign a root cause and corrective action,
  fix, retest. [cortex omp-learn-3d51cac320c021a3]
- Receipts: `spark-receipt` writes `YARDSTICKS/receipts/<date>-<NAME>.json` (energy, GPU W, load, MemAvailable,
  lock holders, NVRM error delta, exit code, git head). Wall energy under about 20 J is noise.

## 7. Known traps (symptom; cause; fix; source)

1. Host-polled completion marker arrives about 1.06 s late or never (`marker2_wait word=0x0`); the marker memory
   was GPU-cacheable system memory, which NVIDIA's `nvos.h` says is not coherent with CPU mappings; allocate
   poll and marker memory with `nvrm_alloc_gpu_uncached`. [cortex d03a999a-1d55-4875-83d1-ba277daae049, a4f2b40e-5327-410c-8763-d38cac94202b]
2. GPU re-executes old commands or never reports the next job; CPU-rewritten, GPU-read memory (GPFIFO/USERD,
   pushbuffers, pools) was GPU-cacheable; make it GPU-uncached, or use NVIDIA's flush and invalidate sequence.
   Regression test: physics `nvrm/submission_visibility_gates.c`. [cortex d116ecf9-6d98-439e-880b-8a721d77cf46]
3. Decode slow (GEMV 153 of 273 GB/s) after "uncache everything"; chip-only intermediates were uncached, so every
   read went to DRAM; keep host-touched regions uncached and chip-only intermediates cached (153 to about
   207 GB/s, 2026-10-19). Caching weights gave no gain. [cortex 015433e3-f08c-43f6-a666-adf4fd1ca630]
4. Resident GPU program unreliable; fix was four rules: scoreboard every control word, uncached poll memory,
   regcount >= used + 2 (top 2 registers reserved), MEMBAR.SC.SYS before the tail store.
   [cortex 1d867912-a365-4af3-948d-74055e7bfef1]
5. `NV_ERR_TIMEOUT ... STOP_CHANNEL` jams (158 on 2026-09-28); our own tests were killed mid-run and the resident
   seat kept spinning; never kill, force-stop or `timeout` a chip test with a resident seat, run it detached,
   one GPU test at a time. [cortex d601e9b6-c4e7-4076-b2f9-9c6af933c604]
6. New GPU client fails at channel create with status 81 (0x51 NV_ERR_NO_MEMORY) while tens of GB are free; the
   driver wants one contiguous block and `/proc/buddyinfo` shows 0 free order-9 blocks; read MemFree and
   buddyinfo, not MemAvailable. What cleared it on 2026-11-12, run with root privileges: `sync`, then
   `sysctl vm.drop_caches=2`, then `sysctl vm.compact_memory=1` (see section 11 before using).
   [cortex 13b21036-23ea-497f-956a-9b12f476ead4, 45a41b22-bf26-4013-848f-1c2fb21156a9]
7. A gate inside the judge sat 83 minutes in `flock -x`; it re-opened the lock its own parent held; use physics
   `tests/gb10_lock.sh` (walks ancestors), honour `AIEN_GB10_LOCK_HELD=1`; to unstick, kill only the waiting
   flock, never the holder. [cortex f92b85a0-7c59-4ad6-b12f-14b9af1401f2]
8. Server answers 503 "GPU lock held" forever while sweeps run; its non-blocking poll never wins against queued
   flock(1) waiters; queued blocking acquire fixed the 27B door (2026-10-19). [cortex 53b7935d-e09a-404e-872b-bf92950945c1]
9. Builds stall for 25 min behind a measurement; `quiet-measure flock /tmp/aien-gb10.lock CMD` took the quiet
   lock first then queued for the chip; lock order is chip first, then quiet. The fix was recorded as not yet
   installed. [cortex 7c23b9f3-1cf9-4ebe-a1ad-07da3d83c94c]
10. Kernel refuses or misbehaves above 32 KiB shared memory; QMD word 36 was a constant; it is now written per
    launch, code cap 65536 bytes. Treat any such constant as unproven until a chip gate has run above it.
    [cortex e10e9c85-a431-4f9b-81cc-8089b1c247ac, omp-learn-6ef9994f2b45d5ef]
11. Hand-written cubin rejected by `cuModuleLoadData` (error 200) on sm_121; it lacks the `.nv.capmerc` and
    `.nv.merc.*` sections. [cortex omp-learn-73e93cda4e7f6b89, 2026-10-23]
12. A "native" harness secretly linked libcuda (M16, failed audit); prove independence with `ldd`, `nm -u` and
    `/proc/PID/maps`. [cortex 77d59ce6-40d7-4991-8e6a-f72cd34f2340]
13. Outputs left unwritten after completion was signalled (about 1 in 2,800 launches, marked UNVERIFIED in the
    record); a 200 ms host delay cut 781/6000 to 2/6000; full cause unresolved. [cortex a667cbb7-dd17-44f5-a7ce-085d3d3ab9f7]
14. Power: on 2026-11-08 a sustained full-GPU load hit an 85 W hard stop 3 times in 5 min (peak 87 W); notes from that workload's authors say
    some Sparks power off at sustained 88 to 92 W. Changing clocks (`nvidia-smi -lgc`) is Drake's call; the
    standing brief was stock clocks and power limits only. [BOARD 2026-11-08T23:37:31Z, 2026-11-09T01:46:45Z]
15. NVRM "Out of memory" retry lines without an Xid can appear in the kernel log on a run that still finishes
    rc 0 with correct numbers. [BOARD 2026-11-14T19:33:26Z]
16. A long job launched over ssh hangs; use `nohup setsid ... </dev/null >log 2>&1 &`.
    [cortex omp-learn-0bcfaab846d0e636]

## 8. What we do not use

- No CUDA toolkit in our path: no CUDA C++, nvcc, cuBLAS/cuDNN, CUDA runtime (Drake, 2026-09-23).
  [operator memory note `decision-leave-max.md`, `founding-principle-metal-first.md`]
- No new C/CUDA tools; new code is Omega (2026-10-24). [TEAM-MEMORY:4; RULES]
- No MAX for new model paths (2026-09-23). No Python as a structural part; Python is allowed for outside tools,
  references and measuring instruments (2026-10-29). [`decision-leave-max.md`; RULES "Python boundary"]
- Still used, and say so: NVIDIA's open kernel modules 580.173.02 (nvidia, nvidia-uvm) and NVIDIA's signed GSP
  firmware. "No CUDA" does not mean "no driver". Never claim "no NVIDIA code at all".
  [cortex omp-learn-6ef9994f2b45d5ef, omp-learn-b654f9a92d110794; operator memory note `sovereignty-no-outside-deps.md`]
- Own kernel driver work (L332 and related) is not qualified on hardware as of the 2026-10-30 record.
  [cortex omp-learn-8e437914757898e2]
- NVIDIA user-space CUDA appears only as the comparison arm in head-to-heads. [`HANDOFFS/H2H9B/PROTOCOL.md`]

## 9. Where evidence goes

- Windows: `YARDSTICKS/windows/<id>/open.json`, `close.json`. Receipts: `YARDSTICKS/receipts/`.
- Numbers: `aien-calc eval "<expr>"` (cite `calc:<id>`); `aien-calc export` copies a receipt next to evidence.
- Facts others need: one BOARD line; lasting facts one line in `HANDOFFS/TEAM-MEMORY.md`; progress in the ledger
  (`ledger note ID "TEXT"`, `ledger done ID "EVIDENCE"`).
- Lessons: Cortex `aien-lessons` (Symptom / Root cause / Fix / Verified). Hardware investigations follow the
  `investigate` skill. [RULES]

## 10. What needs Drake

- Swapping the model that serves on MODEL_PORT, or changing a harness. [RULES "Harness lock"]
- Changing GPU clocks or power limits. [BOARD 2026-11-09T00:28:25Z]
- Unbinding the GPU from nvidia.ko, a VFIO bind, or any device write outside the driver (stops every GPU user;
  recorded as needing Drake's go). Rebooting the Spark or booting it natively. The signed boot chain is never
  written. [cortex omp-learn-b654f9a92d110794, omp-learn-8e437914757898e2; operator memory note `aienos-native-boot-status.md`]
- Re-enabling any model service at boot. [`HANDOFFS/RULE-spark-no-idle-models.md`]
- Not Drake: using an idle chip, stopping the idle shared model under a board claim. [RULES]

## 11. Where the records disagree or are unconfirmed

- Chip name: registers decode to GB20B; older notes and NVIDIA's UVM comments say GB10B. That UVM's GB10B
  sticky-L2 quirk does not apply here is INFERRED, not measured (L1267). The cache traps in section 7 were
  measured on this chip either way.
- Which lock the MODEL_PORT server holds: chip-watchdog's header says the live server uses its own lock, and older
  start recipes set `AIEN_SERVE_GPU_LOCK=/tmp/aien-serve-MODEL_PORT.lock`; the motor-revival unit does not set it, and
  on 2026-11-15T01:54Z the server held `/tmp/aien-gb10.lock` exclusively. Whether the watchdog would kill an
  idle server holding that lock was not confirmed.
- Is the 35B retired? `q36-extra` says the 35B was retired by Drake on 2026-11-06 and MODEL_PORT is reserved for the
  own Omega LLM; the board shows the 35B started on MODEL_PORT by motor-revival through 2026-11-15.
- How the model is started may change: a lane is moving user units from systemd to `aien-supervise`
  (BOARD 2026-11-15T01:52Z). Check the board before trusting the `systemctl` commands in section 4.
- `drop_caches`: the coordinator allowed only `=1`, "never 2 or 3" (BOARD 2026-11-10T13:20:13Z); two days later
  only `=2` cleared the fragmentation (BOARD 2026-11-12T03:30:05Z). No later ruling found. Post on the board first.
- Bandwidth ceiling: TEAM-MEMORY:9 computes ceilings at 273 GB/s; the 2026-10-25 measurement says use 236.9.
- Max SM clock: one research brief quotes 3003 MHz from nvidia-smi (cortex bf03fc8c-0ece-40ab-baeb-c3caeaecc234);
  observed under load were 2548 and 2444 MHz.
- Shared memory per SM: 100 KiB carvable (measured), "99 KB" in L293, code cap 65536 bytes.
- Server memory while serving: about 47 GB resident (2026-10-25), 56089 MiB by nvidia-smi (2026-11-15), about
  62 GB RSS for the earlier 30B (2026-10-31). Different builds and context sizes; measure, do not assume.
- Not found in the records searched: a written list of everything that invalidates a timing; a documented power
  limit for this unit; a tool named `motor-revival` (it is a unit name and a ledger owner, not a command);
  any `LESSON-*.md` about the GPU (the only one is the harness wipe).

## 12. NVIDIA's own documentation (fetch it, never recall it)

Do not answer a vendor question from memory. Fetch the current page through Context7 (MCP server `context7`;
without the tools: `curl -G https://context7.com/api/v1/<id> --data-urlencode type=txt --data-urlencode topic=...`)
and quote the source URL. Library ids checked 2026-11-14:
- `/websites/nvidia_dgx_dgx-spark` (docs.nvidia.com/dgx/dgx-spark: user guide, known issues, updates, recovery)
- `/nvidia/open-gpu-kernel-modules` (the driver source we run; ioctl, UVM and error notes)
- `/websites/build_nvidia_spark` (NVIDIA's Spark playbooks; all CUDA-stack, comparison arm only)
The offline copies in `DOCS` (section 1) and the docs-read hook (section 2) still apply on the Spark.

What those pages say that matters here (fetched 2026-11-14, each from the URL named):
- Memory reporting on this unified-memory machine is a documented known issue. NVIDIA publishes a C routine that
  estimates allocatable memory from `/proc/meminfo`: MemAvailable plus free swap, adjusted for hugetlbfs pages,
  which cannot be swapped. [docs.nvidia.com/dgx/dgx-spark/known-issues.html] This Spark has no swap (0 B, read
  2026-11-14), and our own records add that mapped model pages must be subtracted (section 5).
- NVIDIA's documented workaround for memory-reporting problems is `sudo sh -c 'sync; echo 3 > /proc/sys/vm/drop_caches'`
  and then restarting the application. [same page] This is a third position beside the two in section 11
  ("=1 only" and "=2 worked"). It drops caches for every lane on the machine: post on the board first.
- Update path: `sudo apt update && sudo apt dist-upgrade`, `sudo fwupdmgr refresh`, `sudo fwupdmgr upgrade`,
  reboot. [docs.nvidia.com/dgx/dgx-spark/os-and-component-update.html] An update can change the driver
  (580.173.02 on 2026-11-15) and firmware under every measurement, and it reboots the machine: needs Drake.
- Firmware setup for Secure Boot changes is reached with `sudo systemctl reboot --firmware-setup`.
  [docs.nvidia.com/dgx/dgx-spark/dgx-spark.pdf] Secure Boot state is tied to the native-boot work: needs Drake.
- Device nodes: `ls /dev/nvidia*` is NVIDIA's first check when the GPU is not reachable. [same PDF]
- NVIDIA's container examples for this machine use CUDA 13 images (`nvcr.io/nvidia/cuda:13.0.1-devel-ubuntu24.04`).
  [docs.nvidia.com/dgx/dgx-spark/ngc.html] For us that is the comparison arm only (section 8).
- Driver recovery in the open-module notes is unload and reload: `rmmod nvidia_uvm nvidia_drm nvidia`, then
  `modprobe nvidia`, `modprobe nvidia_uvm`. [github.com/nvidia/open-gpu-kernel-modules, _autodocs/errors.md]
  That stops every GPU user on the Spark: Drake's go, a board line first, and never under a resident seat (trap 5).
- The user-space control interface named there: `NV_ESC_CARD_INFO`, `NV_ESC_REGISTER_FD`, `NV_ESC_ALLOC_OS_EVENT`,
  `NV_ESC_CHECK_VERSION_STR`, `NV_ESC_IOCTL_XFER_CMD`, `NV_ESC_EXPORT_TO_DMABUF_FD`, `NV_ESC_WAIT_OPEN_COMPLETE`
  on `/dev/nvidia0`. [same repo, _autodocs/QUICK_REFERENCE.md] The `_autodocs` pages are generated summaries;
  for anything our driver code depends on, read the header in the pinned source instead.

