# Ω Omega Harness CLI (`omega`)

Interactive terminal CLI for operating **Inkling-2-Mini** through Omega Harness, with a Gemini-CLI-style Ink TUI branded with Drake's `Ω` symbol (and optional Gemini SDK fallback).

## Key Features

- **Hooked to Inkling-2-Mini by default** (`http://127.0.0.1:8080`, model `inkling-2-mini`):
  - Auto-detects Omega's pure seeded-Omega **`inkling2-serve`** (`GET /health` with `slots_active` / `slots_max`), formats prompts cleanly for `serve_live.om`, and automatically retries `503 server_busy` when all 8 static KV slots are occupied.
  - Also supports full OpenAI-compatible Inkling servers with SSE streaming, native `tool_calls`, and Inkling `<|content_thinking|>` / `<|content_invoke_tool_json|>` token parsing.
  - Optional Gemini SDK (`@google/genai`) backend available via `--provider gemini` or `/provider gemini`.
- **Omega Harness skills**: automatically discovers every skill in `../skills/*/SKILL.md` (`load_skill`, `/skills`, `/skill <name>`).
- **Omega compiler integration**: `omc_compile`, `omc_run`, `/compile`, `/run`, and `--omega-only` mode (`.om` / `NOTES.md` writes only, automatic `omc` compilation, error enrichment from `../data/reference.tsv`).
- **Workspace tools & Gemini-CLI ergonomics**: `read_file`, `write_file`, `edit_file`, `list_dir`, `glob_files`, `grep_search`, `run_shell`, `omega_pin`, `@path` inline file attachments, live `/` slash-command autocomplete, prompt history, and headless `-p` mode.

## Build & Install

```sh
cd cli
npm install
npm run build
ln -sf "$PWD/dist/index.js" ~/.local/bin/omega
```

## Connecting to Inkling-2-Mini on Spark

Start `inkling2-serve` on Spark inside an authorized GPU window and forward port `8080` to your Mac:

```sh
ssh -N -L 8080:127.0.0.1:8080 spark
omega --status
omega
```

Or point to any other host/port:

```sh
omega -e http://127.0.0.1:18091
# or persist it:
omega config set endpoint http://127.0.0.1:18091
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
