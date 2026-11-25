---
name: spark-h2h-benchmark
description: >-
  Set up, run, verify, and package fair side-by-side LLM inference benchmarks
  comparing the pure seeded-Omega stack against external engines (e.g., TandemLLM)
  on DGX Spark GB10 using bench_h2h_llm, atlas-vault, spark-window, and SHA256SUMS
  artifact bundles.
---

# Spark Side-by-Side Head-to-Head LLM Benchmarking

## 1. Secrets & Competitor Engine Setup
1. Never store Hugging Face tokens on disk. Check `ssh spark 'atlas-vault list'`; if `HF_TOKEN` is missing, prompt the operator to run `ssh -t spark 'vault-add-secret HF_TOKEN'`, then wrap downloads with `atlas-vault run HF_TOKEN -- ...`.
2. Install external comparison engines in an isolated prefix with background services disabled (for TandemEngine: `--dir ~/tandem-bench/install --port 18290 --no-start --no-pair --no-corpus --yes`).
3. Disable response and persistent lookup caches (`RESPONSE_CACHE=off`, `CORPUS=''`), bypass any agent/conductor layer (`X-Tandem: raw`), and launch the comparison server in the foreground so the window wrapper owns its PID.

## 2. Window & Timing Discipline
1. Check `spark-window status`, `nvidia-smi`, and `tail -n 15 ~/handoffs/BOARD.md` (lowercase `handoffs`) before starting. Post `CLAIM` and `RELEASE` lines around each arm.
2. Run each arm sequentially inside its own exclusive `spark-window` (`--lease 20 --gb10 exclusive --quiet exclusive --wait`) and `spark-receipt` with a `pkill -P` + `kill -TERM` trap and `sleep 10` between arms for NVRM unified memory release.
3. For 100+ GB multi-shard `omega-engine` Full-APU checkpoints (`qwen3.8-flash-next`, 131 shards, ~243s load), allow `>= 420s` for `/health` readiness (180s times out mid-load). Note `q4PrefillSeq` currently caps prompts at `2048` tokens (`bound 2048`).

## 3. Fair Measurement & Coherence Verification
1. Drive every arm over `127.0.0.1` with `bench_h2h_llm run` (`benchmarks` repo: `--max-tokens 256 --warmup 1 --runs 3`, `temperature: 0.0`, `top_k: 1`, `enable_thinking: false`, per-run nonce line).
2. Compare pure decode tok/s using `(completion_tokens - 1) / decode_ms` (both Omega `timings.decode_ms` and TandemEngine `predicted_ms` exclude prefill's first token) alongside client E2E tok/s.
3. Always inspect `output_preview`, `runs_ok`, `arboris_hit_pct`, and `unique_4gram_ratio` (word + char 4-gram check) before accepting fast numbers. Verify new serving flags in `.om` `serve_cli.om` actually wire the intended decode graph rather than only parsing the flag.

## 4. Packaging & Repo Gates (`benchmarks`)
1. Place measured arm JSONs and `comparison.md` inside an immutable `artifacts/<bundle>/` directory with `SHA256SUMS` (`shasum -a 256 *.json *.md > SHA256SUMS`). Unbundled JSON files outside `records/` fail `bench_verify_records`.
2. Ensure empty or whitespace-only `output_preview` fields are stored as `null`, not `""` or `"\n\n"`, because `src/evidence.rs` rejects empty/whitespace strings as placeholders.
3. Update `docs/PERF_INDEX.md` via `cargo run --release --bin bench_index`, verify zero em/en dashes per `AGENTS.md`, run `tests/gates/run.sh`, and push to Interplane (`spark:git/benchmarks-mv.git`) before GitHub `origin`.
