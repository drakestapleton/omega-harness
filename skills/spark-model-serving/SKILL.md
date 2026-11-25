---
name: spark-model-serving
description: >-
  Operate, debug, and extend the pure seeded-Omega multi-model serving stack on
  DGX Spark: omega-router (:18090), q36-serve & inkling2-serve (:18091), CPU
  ollm serve (:18098), Open WebUI (:3080), and MacBook SSH tunnel + q36-chat.
  Use when deploying, switching, or troubleshooting interactive LLM serving on Spark.
---

# Spark Pure-OM-2 Multi-Model Serving & Open WebUI Runbook

## 1. Verified Spark Local Port Map
Always run `ss -tln | grep 1809` before choosing a new port on Spark (do not assume 1809x or 300x ports are free):
- `127.0.0.1:3000` — Grafana (occupied)
- `127.0.0.1:3001` — Uptime Kuma (occupied; never bind Open WebUI here)
- `127.0.0.1:3080` — Open WebUI Docker container (`open-webui`, `WEBUI_AUTH=false`, volume `open-webui-data`)
- `127.0.0.1:18090` — `omega-router` (`~/.local/bin/omega-router`, pure OM-2 22 KB static ELF)
- `127.0.0.1:18091` — Active GPU backend managed by `omega-router` (`q36-serve` or `inkling2-serve`, 1 at a time, 20-min idle auto-unload)
- `127.0.0.1:18092` — `spark-mail-rs` (occupied; `18093/18095/18096/18097` also occupied)
- `127.0.0.1:18098` — Dedicated CPU `ollm serve` (`omega-llm-15.8m-om2`, zero GPU eviction)

## 2. Exposed Models & Binary Contracts
| Model ID | Backend Binary | Port | Device | Notes |
|---|---|---|---|---|
| `qwen3.6-35b-a3b-w4-mtp` | `~/.local/opt/q36/q36-serve --mtp4` | `:18091` | GB10 GPU | Default; Full-W4 + MTP4 (`PARITY=EXACT`), 62–100 tok/s single-stream, 128K ctx |
| `qwen3.6-35b-a3b-w4` | `~/.local/opt/q36/q36-serve` | `:18091` | GB10 GPU | Full-W4 steady `~68 tok/s`, 128K ctx |
| `qwen3.6-35b-a3b-fp8` | `~/.local/opt/q36/q36-serve --fp8` | `:18091` | GB10 GPU | Exact FP8 `~48 tok/s`, 128K ctx |
| `inkling-2-mini` | `~/.local/opt/inkling2/inkling2-serve <dir> 18091` | `:18091` | GB10 GPU | 19 GB NVFP4+MXFP8 48L looped core, live SSE, 32K ctx |
| `omega-llm-15.8m-om2` | `ollm serve 18098 ~/.local/opt/ollm/omega-llm-15.8m-om2.ck <bpe>` | `:18098` | Grace CPU | `21/159` champion; never evicts active GPU model |

### Neuralese Lab Routes (`omega-router` `:18090`)
- `GET /neuralese` — zero-framework multi-model lab UI (`~/.local/opt/omega-router/neuralese.html`)
- `GET /v1/neuralese/info` — model geometry + `LTP0` schema (defaults to CPU `:18098`; never cold-boots GPU)
- `POST /v1/neuralese/trace` — routes by `"model"` (default `omega-llm-15.8m-om2` CPU `:18098`; `qwen3.6-*` / `inkling-2-mini` → GPU `:18091`)
- `POST /v1/neuralese/verify-om2` — live `~/canon/omega-mv/seed/out/omc` compile check returning `{"compiled","exit_code","stderr"}`

## 3. Hard-Won Pitfalls & Mandatory Checks
1. **Never run `inkling2-serve --help` on Spark:** It ignores unknown flags and attempts to load the 19 GB checkpoint onto GB10. Inspect `om/gpu/inkling2/multistream/serve_live.om` instead.
2. **Stop running GPU servers before `install`:** Overwriting `~/.local/opt/q36/q36-serve` while running fails with `Text file busy`. Stop `omega-router`/backends and `sleep 3` so NVRM releases VRAM cleanly.
3. **Open WebUI persists `openai.api_base_urls` in SQLite:** Recreating the container with a new `OPENAI_API_BASE_URL` env var does **not** overwrite the cached URL in `/app/backend/data/webui.db` (`config` table has columns `key, value, updated_at`). Update `openai.api_base_urls` in SQLite and `docker restart open-webui`, then verify `GET /api/models` (with bearer token from `/api/v1/auths/signin`) lists all 5 models.
4. **`ollm serve` enforces model ID == checkpoint basename:** Symlink the checkpoint as `~/.local/opt/ollm/<model-id>.ck` so `POST /v1/chat/completions` with `"model": "<model-id>"` succeeds instead of returning `404`.
5. **Open WebUI JSON payload requirements:** Open WebUI sends `"content": [{"type":"text","text":"..."}]` and omits `max_tokens`. Every `.om` server must require `:` after keys (`skipWsColon`), unwrap array-of-parts `"text"`, encode full multi-turn `messages` history, stream SSE when `"stream": true`, and default `max_tokens` to `>= 4096` (`8192` for `q36-serve`).
6. **Single-stream vs `batch8` speed clarity:** `208–240 tok/s` is `batch8` / `SPEC_VERIFY (M=8)` aggregate throughput; single-stream interactive speed is `62–100 tok/s` (`--mtp4`) or `~68 tok/s` (`w4`). Do not enable `--w4b` or `--kv-int8` in interactive serving (BF16 GDN prefill drift produces `0 tok` or `!!!`).
7. **Never `pkill -x ollm` blindly on Spark:** `:18097` (`hop-omega-chat`) and `:18098` (`omega-router`) both run `ollm`. When restarting `:18098`, target only its PID: `P=$(pgrep -a ollm | awk '/serve 18098/ {print $1}'); [ -n "$P" ] && kill "$P"`.

## 4. MacBook Tunnel & Verification Commands
- Tunnel: `ssh -f -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 3080:127.0.0.1:3080 -L 18090:127.0.0.1:18090 -L 18091:127.0.0.1:18091 spark`
- Terminal client: `~/.local/bin/q36-chat` (supports `--model <id>`, `/models`, `/model <id|1-5>`, `/clear`, multi-turn history, live tok/s & Arboris telemetry).
- Health & model check: `curl -sf http://127.0.0.1:18090/health && curl -sf http://127.0.0.1:18090/v1/models`
- Always confirm `NVRM: Xid` delta == `0` after GPU hot-swap tests.
