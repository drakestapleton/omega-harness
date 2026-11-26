---
name: aienos-web-deploy
description: >-
  Build, verify, and deploy changes to www.aienos.com (pure-Omega SiteHub static
  pipeline, /aien/ chat UI, homepage Ask Aien drawer, and the pure-OM-2
  allen-chat.service gateway on DGX Spark). Use when editing aienos.com pages,
  om/site/*.om, om/allen-page/*.om, om/chat-gateway/aien_chat.om, or publishing
  releases via SiteHub.
---

# Building, Verifying, and Deploying `www.aienos.com`

## 1. Three-Compiler Map & Limits

`aienos.com` uses three distinct pinned Omega compilers — never mix their rules:

| Subsystem | Compiler | Pin / Path | Key Limits |
|---|---|---|---|
| Whole-site builder & verifier (`om/site/`) | `om/site/omc` | `om/site/omc.sha256` (`3ad9f10f…`) | **<= 8-byte identifiers** (`error 13` above 8 chars). `build/build-tool` exits `80` if output binary already exists — always `rm -f build/site build/verify` first. |
| `/aien/` page + browser script (`om/allen-page/`) | `om/hive-page/omc` | `om/hive-page/omc.sha256` (`734f0a39…`) | OM-1, <= 8-byte names, `while` bound <= `999999`. Regenerate on Spark arm64 with `OMEGA_ACCEPT_CHANGE=1 sh om/allen-page/check.sh`, then rerun without override to confirm determinism. |
| Public chat gateway (`om/chat-gateway/aien_chat.om`) | Spark seeded `omc` | `~/canon/omega-mv/seed/out/omc` | Full `om2` (63-byte names, `fork`, `waitpid`, `socknew`, `waitio`). |

## 2. Dual-Verifier, CSP & CSS Guardrails

Every SiteHub release must pass **both** the Omega verifier (`build/verify --sources` + `build/verify dist`) and the independent Rust oracle (`site-builder verify dist`):

- **CSP unused-grant check:** When retiring any JS file from `om/site/route-assets.om`, also remove its grants from **both** `om/site/csp.om` and `crates/site-builder/src/components/csp.rs` (otherwise `site-builder verify dist` panics with `granted a policy addition, but no page loads it`).
- **Root vs. `/aien/` ID isolation:** `sv_noentr` / `oracle::check_root` forbid `id="allen"` and `id="site-door"` on `/`. Homepage drawers/widgets must use distinct IDs (`id="aien-drawer"`).
- **`/aien/` contracts (`verify-seo.om`, `oracle.rs`, `components/allen.rs`):**
  - Real DOM must carry `id="allen"`, `id="allen-form"`, `/classic/` links both inside and outside `<noscript>`, and `aien-reach-foot` with `https://x.com/drakestapleton` + `mailto:drake@aienos.com`.
  - Keep `public/js/allen.js` free of `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `localStorage`, `sessionStorage`, `document.cookie`, and external fetches (same-origin `/aien/api/chat` and `/aien/api/presence` only).
  - Keep copy in `om/allen-page/` and `allen.rs` free of em/en dashes and in first-person singular (`I`/`my`, not `we`/`our`).
  - Keep `om/site/verify-mutations.jsonl` (`O4-a`) in sync with `/aien/` required IDs.
- **Canonical palette tokens in `public/assets/allen.css`:** Use only `:root` tokens from `site-tokens.css` (`--bg-base`, `--bg-surface`, `--bg-card`, `--border-subtle`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-blue`, `--btn-primary-bg`, `--btn-primary-ink`, `--strand-a/b/c`) — not homepage-only `fftokens` aliases (`--bg-secondary`, `--border`, `--accent-fill`). Never add `#` hex literals, `@import`, `url()`, or non-compositor transitions.

## 3. Pure-OM-2 Public Chat Gateway (`allen-chat.service`)

- **Nginx routing (already live on Pi hub & Spark):** Both hosts rewrite `/aien/api/*` -> `/allen/api/*` -> `http://allen_chat_gateway` (`100.64.0.2:18110`) with `proxy_buffering off`, `gzip off`, rate limits, and `Origin` checks. No nginx edits are needed for gateway updates.
- **Pure-OM-2 HTTP gotchas:**
  - Bodyless `GET` requests end right at `\r\n\r\n` (`hdrEnd == total`), so `findHdrEnd` must return `0` on miss and callers check `gt h 0` (never `lt h total`).
  - Always send `\r\n` line endings on upstream HTTP probes (`GET /health`) and responses for strict proxy/server compatibility.
  - Keep per-function live variables well below 16 registers (`error 12`); split SSE parsers/pumps into small helpers.
- **Atomic deploy on Spark (from committed git source):**
  ```sh
  git -C ~/work/sitehub/aienos.com fetch -q origin
  git -C ~/work/sitehub/aienos.com show <sha>:om/chat-gateway/aien_chat.om > /tmp/aien_chat.om
  ~/canon/omega-mv/seed/out/omc < /tmp/aien_chat.om > /tmp/aien-chat.new
  sudo install -m 0755 /tmp/aien-chat.new /opt/allen-chat/aien-chat.tmp
  sudo mv -f /opt/allen-chat/aien-chat.tmp /opt/allen-chat/aien-chat
  sudo systemctl restart allen-chat.service
  systemctl is-active allen-chat.service && curl -fsS http://100.64.0.2:18110/aien/api/presence
  ```

## 4. SiteHub Publish & Live HTTPS Verification

1. Commit locally on `main` and push to Interplane (`git push spark main`). Verify `origin/main` matches `HEAD` and `https://interplane.io/drakestapleton/aienos.com` returns HTTP `200`.
   *(Note: `github` remote `drakestapleton/aienos.com` currently rejects pushes due to GitHub Push Protection on legacy test fixtures in `crates/hive-feed/src/privacy.rs`; Interplane is the canonical source.)*
2. Publish via SiteHub on Spark:
   ```sh
   ssh spark "flock ~/handoffs/site-front/publish.lock ~/work/sitehub/deploy.sh <40-char-sha>"
   ```
   Confirm `RESULT PASS` across gates `1-ledger`..`9-verify-rust` and `PUBLISH OK release=...` on both `hub` and `spark`. A trailing `SI-FRONT FAIL` on the retired Radicle repo leaves `/si` untouched after atomic publication succeeds.
3. Verify live HTTPS end-to-end from the MacBook:
   ```sh
   curl -fsS https://www.aienos.com/aien/api/presence
   curl -fsS -N -H "Origin: https://www.aienos.com" -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"WTF is AienOS?"}]}' \
     https://www.aienos.com/aien/api/chat | head -n 12
   ```
