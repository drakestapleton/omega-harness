# Ω Omega Harness CLI (`omega`)

Interactive terminal CLI for operating Omega Harness, built with TypeScript, Ink, and the official Google GenAI SDK (`@google/genai`).

It provides a Gemini-CLI-style interactive terminal experience branded with Drake's `Ω` symbol and wired directly into `omega-harness`:

- **Skills**: automatically discovers every skill in `../skills/*/SKILL.md` and lets the model load them on demand (`load_skill`) or lets you pin them with `/skill <name>` / `--skill <name>`.
- **Omega compiler integration**: `omc_compile`, `omc_run`, `/compile`, `/run`, and `--omega-only` mode (which restricts writes to `.om` and `NOTES.md`, auto-compiles every `.om` edit with local `omc`, and enriches compiler `error N` diagnostics from `../data/reference.tsv`).
- **Workspace tools**: `read_file`, `write_file`, `edit_file`, `list_dir`, `glob_files`, `grep_search`, `run_shell`, and `omega_pin`, with interactive `[Y]es / [A]lways / [N]o` approval prompts (plus `--auto-edit` and `--yolo` modes).
- **Context ergonomics**: `@path/to/file` inline file attachments, live `/` slash-command autocomplete, prompt history (`Up`/`Down`), streaming markdown rendering, token usage stats, and non-interactive `-p` headless mode with piped stdin.

## Build & Install

```sh
cd cli
npm install
npm run build
ln -sf "$PWD/dist/index.js" ~/.local/bin/omega
```

## Configure API Key

Set `GEMINI_API_KEY` in your environment, or store it in `~/.config/omega-harness/config.json` (mode `0600`):

```sh
omega config set apiKey <YOUR_GEMINI_API_KEY>
```

Or run `/auth <YOUR_GEMINI_API_KEY>` inside the interactive CLI.

## Usage

```sh
omega                          # Launch interactive Ω TUI
omega "inspect @main.om"       # Launch interactive TUI with initial prompt
omega --omega-only             # Enforce .om-only writes with auto-omc checks
omega -m gemini-2.5-flash      # Pick a specific Gemini model
omega -p "summarize @README.md" # Headless mode
omega --skills                 # List available Omega Harness skills
omega --pin                    # Check PIN vs local omc sha256
```

## Tests

```sh
cd cli
npm run build && npm test
```
