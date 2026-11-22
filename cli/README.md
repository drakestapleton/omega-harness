# Ω Omega Harness CLI (`omega`)

Interactive terminal CLI for operating **Inkling-2-Mini** through Omega Harness, with a Gemini-CLI-style Ink TUI branded with Drake's `Ω` symbol (and optional Gemini SDK fallback).

## Key Features

- **Hooked to Inkling-2-Mini by default** (`http://127.0.0.1:8080`, model `inkling-2-mini`):
  - Auto-detects Omega's pure seeded-Omega **`inkling2-serve`** (`GET /health` with `slots_active` / `slots_max`), formats prompts cleanly for `serve_live.om`, and automatically retries `503 server_busy` when all 8 static KV slots are occupied.
  - Also supports full OpenAI-compatible Inkling servers with SSE streaming, native `tool_calls`, and Inkling `<|content_thinking|>` / `<|content_invoke_tool_json|>` token parsing.
  - Optional Gemini SDK (`@google/genai`) backend available via `--provider gemini` or `/provider gemini`.
- **Omega Harness skills**: automatically discovers every skill in `../skills/*/SKILL.md` (`load_skill`, `/skills`, `/skill <name>`).
- **Omega compiler integration**: `omc_compile`, `omc_run`, `/compile`, `/run`, and `--omega-only` mode (`.om` / `NOTES.md` writes only, automatic `omc` compilation, error enrichment from `../data/reference.tsv`).
- **27 modern agent tools** (`omega --tools` / `/tools`):
  - **File & Code**: `read_file`, `write_file`, `edit_file`, `delete_file`, `list_dir`, `glob_files`, `grep_search`
  - **Execution & Git**: `run_shell`, `git_status`, `git_diff`, `git_log`, `git_commit`
  - **Web**: `web_fetch`, `web_search`
  - **Planning & Memory**: `todo_write`, `todo_read` (`/tasks`), `memory_save`, `memory_read` (`/memory`)
  - **Autonomous Inkling Subagents**: `spawn_subagent`, `spawn_parallel_subagents`, `list_subagents` (`/agents`), `message_subagent` — spins up isolated Inkling-2-Mini subagents using the same model across `inkling2-serve`'s `N=8` static KV slots
  - **Omega Harness Native**: `list_skills`, `load_skill`, `omc_compile`, `omc_run`, `omega_pin`

## Build & Install

```sh
sh cli/install.sh
```

Or package a self-contained release bundle (`.tar.gz` + `.sha256` + `MANIFEST.txt`):

```sh
sh cli/package.sh
```

## One-Command Stack Lifecycle (Inkling-2-Mini + Arboris + SM121 Speedups)

```sh
omega start          # Boot Inkling-2-Mini + Arboris on Spark, open :8080 tunnel, launch Ω TUI
omega up             # Boot Spark server + tunnel only (auto-builds if missing)
omega up --rebuild   # Recompile pure-Omega inkling2-serve on Spark and restart
omega --status       # Check health, N=8 KV slots & live Arboris top-8/top-16 hit rates
omega down           # Stop Spark server cleanly + close tunnel (keeps Spark GPU idle)
```

## Usage

```sh
omega                                # Launch interactive Ω TUI connected to Inkling-2-Mini
omega --status                       # Probe Inkling server health & active KV slots
omega --omega-only                   # .om-only guard + auto-omc compile checks
omega -p "What is 2 + 2?"            # Headless mode (supports piped stdin)
omega --provider gemini              # Switch to Google GenAI SDK backend
omega --skills                       # List available Omega Harness skills
omega --pin                          # Check PIN vs local omc sha256
```

## Tests

```sh
cd cli
npm run build && npm test
```
