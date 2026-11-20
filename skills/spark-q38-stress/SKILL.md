---
name: spark-q38-stress
description: Replay the physical Spark GB10 Qwen four-layer, eight-stream stress test and paged-attention suite, then compare throughput, latency and correctness with a named earlier run.
---

# Repeat the Spark Q38 stress suite

For requests such as “repeat last night’s GPU stress test,” locate the prior Q38 receipt by its `REPORT.md`, `Q38_STRESS_BENCH` verdict and two window IDs. The November 19, 2026 receipt directory is named `omega-spark-stress-c9fe0f228`. Its `remote-path` identifies the original Spark directory. Read the report, `provenance.txt`, `build.sha256`, `run.sh` and `paged/run.sh`.

## Choose the build

For a repeat on the same code, verify the clean source commit and physics pin, then verify every executable, archive and benchmark-source hash against the prior manifest. Its first five paths are relative to the source checkout and the remaining two to the benchmark directory. For a change under test, use a clean checkout of the requested revision, check out the physics revision in its `physics.lock`, and build the three in-tree test binaries and `build/libomega_gpu.a`. Compile the archived `q38_stress_bench.c` with the same flags and the new archive. Check the final link inputs before attributing results to a change in a sibling repository.

Create a fresh receipt directory. Record the revision, dependency and binary hashes, compiler, driver, benchmark source, commands and baseline receipt. Keep the earlier receipt intact. Reuse the archived scripts after checking their paths and revision assertions against the selected build.

## Run nine checks on silicon

Follow the [GB10 operating procedure](../nvidia-gb10/SKILL.md) for authorization, device ownership and window acquisition. Use exclusive chip and quiet-machine windows for these timings. Record one-second utilization, clocks, temperature and power, each command’s exit code and wall time, and each window’s open and close records. Close the window on failure as well as success.

Execute the following rows sequentially from the tested checkout. Write every JSON result to the fresh receipt directory using an absolute output path.

| Window | Command | Evidence |
|---|---|---|
| 1 | `build/gpu_q38_graph_test` | Graph checks and failure count |
| 1 | `build/gpu_q38_stroke_exact_test` | Exact output and detected mutants |
| 1 | Archived or rebuilt `q38_stress_bench` | Batch sweep, eight-stream token parity, sustained 64-step run |
| 1 | `build/gpu_attention_test --hd 64 --out "$out/attention-64.json"` | Physical attention battery |
| 1 | Repeat with `--hd 128` and a separate receipt | Physical attention battery |
| 2 | `build/gpu_attention_test --timing --out "$out/timing.json"` | Context-2048 timing and violations |
| 2 | `build/gpu_attention_test --sweep --out "$out/sweep.json"` | Supported and unsupported configurations |
| 2 | `build/gpu_attention_test --split-timing --hd 64 --out "$out/split-64.json"` | Context-1268 split timing |
| 2 | Repeat with `--hd 128` and a separate receipt | Context-1268 split timing |

Preserve the ten-second gaps after the graph and exact-output runs. Check the actual counters and each mode’s verdict. The attention JSON uses `failed` and a mode-specific `verdict`. An exit code alone cannot establish a match with the prior run. Record a partial run if a window closes early or a row fails.

## Compare the receipts

When repeating the November 19 C-to-OM comparison, use the original C baseline (799adb6d8) and first OM-2 run (eb8918dcf) as separate columns beside the candidate commit. Cite the receipt or supplied capture for each historical column. Identify the candidate actually linked into the test. Lead with the graph and exact-output counts, bit-identical logit checks, detected mutant, four-head/two-layer stroke timing and both eight-stream token comparisons.

Show seven-repetition batched BF16 medians for N=2, 4, 6 and 8, then the sustained 64×8 exact-head mean and aggregate tokens/s. Calculate latency speedup as baseline divided by candidate. Use the `PTIMER [N=8 bat plain_bf16]` block for the per-kernel table. Include lm_head time and launches, attention, argmax, GDN, mix, o_proj, gate_up and four-layer trunk total. Keep PTIMER microseconds distinct from wall-clock milliseconds. Describe speedups as measured ratios and identify kernel changes as causes only when separately verified.

Report sustained token steps. Compare aggregate tokens/s, mean and p95 GPU step time, and the two eight-stream batch medians side by side. For attention, compare the two battery counts, timing violations and median, sweep coverage, and split medians at both dimensions. Report differences in binaries, machine conditions or window verdicts that affect interpretation. Preserve raw logs, JSON and telemetry beside the report.

The historical workload uses seeded weights, three GDN layers, one attention layer and the full output head. Its Qwen graph uses head dimension 256. The separate paged-attention batteries exercise dimensions 64 and 128. Report measurements at the workload and dimension actually tested.
