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
| Whole-site builder & verifier (`om/site/`) | `om/site/omc` | `om/site/omc.sha256` (`3ad9f10f…`) | **<= 8-byte identifiers** (`error 13`). Always `rm -f build/<bin>` before `./build/build-tool` (`O_EXCL` exits `80`). Authoring rules: `<= 6` param slots (`view`/`edit *` = 2); `npar + nslot < 16` with shallow expressions (`error 12`); never pass a `global` array or two `part` slices of the same array to a user `fn` (`error 19`); never assign `= part` (`error 9`); place all `new` allocations at top level of `fn`, never inside blocks (`error 9`); avoid reserved keywords (`rem`, `sub`, `out`, `len`, `stat`, `le`, `lt`, `gt`, `ge`). |
| `/aien/` page + browser script (`om/allen-page/`) | `om/hive-page/omc` | `om/hive-page/omc.sha256` (`734f0a39…`) | OM-1, <= 8-byte names, `while` bound <= `999999`. Regenerate on Spark arm64 with `OMEGA_ACCEPT_CHANGE=1 sh om/allen-page/check.sh`, then rerun without override to confirm determinism. |
| Public chat gateway (`om/chat-gateway/aien_chat.om`) | Spark seeded `omc` | `~/canon/omega-mv/seed/out/omc` | Full `om2` (63-byte names, `fork`, `waitpid`, `socknew`, `waitio`). |

## 2. Dual-Verifier, CSP & CSS Guardrails

Every SiteHub release must pass **both** the Omega verifier (`build/verify --sources` + `build/verify dist`) and the independent Rust oracle (`site-builder verify dist`):

- **CSP unused-grant check:** When retiring any JS file from `om/site/route-assets.om`, also remove its grants from **both** `om/site/csp.om` and `crates/site-builder/src/components/csp.rs` (otherwise `site-builder verify dist` panics with `granted a policy addition, but no page loads it`).
- **Root vs. `/aien/` ID isolation:** `sv_noentr` / `oracle::check_root` forbid `id="allen"` and `id="site-door"` on `/`. Homepage drawers/widgets must use distinct IDs (`id="aien-drawer"`).
- **Homepage source & adding new routes:** `/` is rendered by `om/site/floor.om` (`sm_home true` in `machine.om`), **not** `om/site/door.om` (which holds legacy `#site-door`, forbidden on `/` by `sv_noentr`/`oracle::check_root`). Adding a new static route (e.g. `/si-2/`) requires updating **both** the Omega pipeline (`om/site/modules.txt`, `site.om`, `route-assets.om`, `pages.json`, `verify-data.om`, `verify-site.om` `vpages` count) **and** the Rust oracle (`crates/site-builder/src/seo.rs` `PAGES`, `main.rs` `GENERATED_PAGES`).
- **`/aien/` contracts (`verify-seo.om`, `oracle.rs`, `components/allen.rs`):**
  - Real DOM must carry `id="allen"`, `id="allen-form"`, `/classic/` links both inside and outside `<noscript>`, and `aien-reach-foot` with `https://x.com/drakestapleton` + `mailto:drake@aienos.com`.
  - Keep `public/js/allen.js` free of `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `localStorage`, `sessionStorage`, `document.cookie`, and external fetches (same-origin `/aien/api/chat` and `/aien/api/presence` only).
  - Keep copy in `om/allen-page/` and `allen.rs` free of em/en dashes and in first-person singular (`I`/`my`, not `we`/`our`). Note that `components::allen::tests::copy_stays_first_person_singular_and_dash_clean` tokenizes **all** ASCII-alphabetic words in `public/js/allen.js` (including JS identifiers and comments), and `om/allen-page/contract.om` uses `~N~` template expansion (never put literal `~` in `allen-js.om`).
  - Keep `om/site/verify-mutations.jsonl` (`O4-a`) in sync with `/aien/` required IDs.
  - **Crisp HiDPI `<canvas>` rendering:** Size 2D canvas backing stores to `Math.round(cssW * Math.min(window.devicePixelRatio || 1, 3))` via `ResizeObserver` + `resize` + `ctx.setTransform(backW / W, 0, 0, backH / H, 0, 0)` (gating `getBoundingClientRect()` behind a `needResize` flag to avoid per-frame layout thrash), and prefer opaque frame clears + crisp full-opacity orbs over translucent fade-clears (`rgba(..., 0.28)`) or low-alpha blur halos.
  - **Regenerating `om/allen-page/` from macOS:** Stage `om/allen-page/`, `public/js/allen.js`, and Spark's `om/hive-page/{omc,omc.sha256}` to a temp dir on Spark (`aarch64`), run `OMEGA_ACCEPT_CHANGE=1 sh om/allen-page/check.sh && sh om/allen-page/check.sh`, copy back `public/js/allen.js` + `om/allen-page/allen.js.sha256`, then verify with `node --check public/js/allen.js` and `cargo test --manifest-path crates/site-builder/Cargo.toml components::allen`.
- **Canonical palette tokens in `public/assets/allen.css`:** Use only `:root` tokens from `site-tokens.css` (`--bg-base`, `--bg-surface`, `--bg-card`, `--border-subtle`, `--border-strong`, `--text-primary`, `--text-secondary`, `--text-muted`, `--accent-blue`, `--btn-primary-bg`, `--btn-primary-ink`, `--strand-a/b/c`) — not homepage-only `fftokens` aliases (`--bg-secondary`, `--border`, `--accent-fill`). Never add `#` hex literals, `@import`, `url()`, or non-compositor transitions.
- **Audience wording ("users only, never customers"):** Drake has **users only, nothing for sale**. Never write `"customer"`, `"customers"`, `"pricing"`, or commercial SaaS framing in `aienos.com` / `interplane.io` copy or UX flows.
- **Microsecond spelling (`us` pronoun trap):** Never abbreviate microseconds as `"us"` in `aienos.com` copy — the first-person singular verifier flags `"us"` as a plural pronoun. Write `"microseconds"`.
- **`8-verify-omega` `V5` (`vforbid`) comparative wording:** Never use `"faster than"`, `"x faster"`, `"beats "`, `"beat the"`, `"llama.cpp"`, `"vllm"`, or `"ollama"` in `aienos.com` copy — report raw measured numbers and `"Nx ratio"` instead.
- **`9-verify-rust` (`machines::comparison_errors`) inline source rule:** Every sentence or table row stating a cross-system comparison must contain **both** an ISO date (`YYYY-MM-DD`) **and** an `https://interplane.io/drakestapleton/<repo>.git` URL inside that **exact same sentence** (no `. ` period breaking the metric from its date/URL).
  - **SVG `<text>` concatenation & prose triggers:** `site-builder verify` strips tags without inserting spaces between adjacent SVG `<text>` elements. Avoid `"vs."`, `"versus"`, `"parity"`, `"ahead of"`, `"double"`, `"half"`, `"twice"`, `"match"`, or `"equal"` anywhere in the same sentence or SVG block as a vendor/project token (`NVIDIA`, `CUDA`, `OpenAI`, `Claude`, `PyTorch`, `LLVM`, etc.) unless the required ISO date + forge URL appear in that same sentence.
- **Run `site-builder verify` on Spark (Linux ext4), never on macOS APFS:** Copying a built Linux `dist/` onto case-insensitive macOS APFS causes `agents.md` (mirror of `/agents/`) to overwrite `AGENTS.md` and fail verification. Always run both `build/verify` and `site-builder verify` on Spark; for local MacBook visual preview, `rsync` only specific preview paths (`blog/`, `assets/`, `js/`, `og*.png`).
- **Clean temporary worktree when local checkout has WIP:** Always inspect `git status --short` first; if `~/workspace/aienos.com` has unrelated uncommitted edits from another session, apply, commit, and push from a clean detached worktree (`git worktree add --detach /tmp/aienos-deploy spark/main`) and remove it after live HTTP 200 verification. When pushing a detached worktree via Spark's staging ref, use the full refspec `git push spark +HEAD:refs/heads/tmp/land-main` (short `HEAD:tmp/land-main` is rejected on detached `HEAD`), and always `git fetch spark && git rebase spark/main` immediately before atomic `update-ref` with `$OLD`.
- **Homepage `fftokens` `:where(...)` section-class trap:** `om/site/floor.om` defines homepage CSS tokens inside an explicit `:where(...)` list of `.home-*` classes. Any homepage `<section class="home-*">` omitted from that selector (such as `.home-noneed` or `.home-download`) gets undefined CSS variables (e.g., `var(--danger)` silently resolving to `rgba(0,0,0,0)` on `.home-nolist li::after`). Whenever adding or editing a homepage section, add its class to `fftokens` and verify computed styles in headless Chrome.
- **`legacy-assets.om` `--bg-base` override:** `om/site/legacy-assets.om` (`public/assets/style.css`) redeclares `--bg-base: var(--turing-night)` (`#08090c`), which overrides `site-tokens.css` `--bg-base` unless `--turing-night` in `om/site/css.om` (`sspal`) is kept aligned.
- **Bi-directional WebAssembly CSP parity:** When adding or removing WebAssembly instantiation in any `/js/*.js` script, update **both** `om/site/csp.om` and `crates/site-builder/src/components/csp.rs` (`WASM_SCRIPTS`) in the same commit (`9-verify-rust` enforces `COMPILES_WASM` bi-directionally).
- **`/evidence/` uppercase `PASS` & GitHub-href auto-projection:** `sv_hubnost` and Rust `hubs.rs` (`StatusSource::Absent`) forbid uppercase `PASS` on `/evidence/` (write lowercase `"passed"`). The site compiler also auto-projects any `href="https://github.com/drakestapleton/<repo>"` onto `https://interplane.io/drakestapleton/<repo>` (which returns `404` on git-only repos until `ipl`-signed); link `.git` or a live `/omega/edge/` page instead and cite `github.com/...` in `<code>` text.
- **Zero passive external embeds & metadata drift:** Never ship passive `<iframe src="https://www.youtube.com/...">` embeds (replace with zero-JS external link cards) or stale third-party pixel strings in `om/site/site-names.om` (`SS0074`/`SS0081` → `data/index.json` + `humans.txt`).
- **Pure-OM-2 `/progress/` collector (`om/site/progress.manifest` → `build/progress-collect`):** Refresh `public/data/project-progress.json` directly on Spark with the pure seeded OM-2 collector (`om/site/pcol-{state,git,main}.om` — never Rust/Python/GCC): compile with `rm -f build/progress-collect && ./build/build-tool om/site/progress.manifest build/progress-collect`, run `./build/progress-collect /tmp/orig-progress.json "$HOME/interplane-store-owner/catalog.tsv" "$HOME/git" public/data/project-progress.json`, verify `IDEM_EQ` self-ingestion idempotency, exclude standalone `"aien"`/`"aienix"` (prevents `names.rs` `"aien" should be "Aien"` panic on `/progress/`), and omit `url` on archived or non-200 Forge repos (`127.0.0.1:18480`).
- **`verify-omc.sh` dumb-HTTP safety (`4-digests` hang guard):** Never use `git fetch --filter=blob:none https://interplane.io/...` inside `om/site/verify-omc.sh` (`omega-edge-v3-pi` serves dumb HTTP Git; promisor retries spawn recursive `git-remote-http` storms on TLS reset). Always resolve live `refs/heads/main` with `git ls-remote "$REPO" refs/heads/main`, then fetch verified commits from `$HOME/git/omega-mv.git` when present (else plain non-filtered `git fetch`).

## 3. Pure-OM-2 Public Chat Gateway (`allen-chat.service` / `omega-aien-chat.service`)

- **Live routing (Pi 5 standalone pure-OM-2):** Public `https://www.aienos.com` is served directly from Pi 5 `omega-edge.target` (`omega-edge-aienos :4446` → Pi-local `omega-aien-chat.service` on `127.0.0.1:18110`; Pi `nginx` is disabled so `/aien/` and the pure-OM-2 flying-balls arena run with zero Spark dependency when Spark boots bare-metal AienOS; see `pi5-omega-edge` skill). When updating `om/chat-gateway/aien_chat.om`, atomically install the static ELF to **Pi 5 `/usr/local/bin/aien-chat`** (`sudo systemctl restart omega-aien-chat.service`) and to Spark `/opt/allen-chat/aien-chat` when Spark is on Linux.
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

1. **Pre-deploy local visual gate (for layout, theme, or animation changes):** Run `~/workspace/omega-harness/scripts/sandbox-visual-gate.sh <dist-dir>` and inspect desktop (`1280px`/`1106px`) and mobile (`390px`) renders before publishing live. Never replace `/` with an experimental canvas or theme without Drake's explicit visual approval; experimental worlds belong on standalone routes (e.g. `/acropolis/`).
2. Commit locally on `main` and push to Interplane (`git push spark main`). Verify `origin/main` matches `HEAD` and `https://interplane.io/drakestapleton/aienos.com` returns HTTP `200`.
   *(Note: `github` remote `drakestapleton/aienos.com` currently rejects pushes due to GitHub Push Protection on legacy test fixtures in `crates/hive-feed/src/privacy.rs`; Interplane is the canonical source.)*
3. Publish via SiteHub on Spark:
   ```sh
   ssh spark "flock ~/handoffs/site-front/publish.lock ~/work/sitehub/deploy.sh <40-char-sha>"
   ```
   Confirm `RESULT PASS` across gates `1-ledger`..`9-verify-rust` **and** `PUBLISH OK release=...` on both `hub` and `spark` (SiteHub can pass `RESULT PASS` and then hang during SSH transfer to `hub` — never treat `RESULT PASS` alone as live). A trailing `SI-FRONT FAIL` on the retired Radicle repo leaves `/si` untouched after atomic publication succeeds.
   - Always pass the **exact verified `<40-char-sha>`** to `deploy.sh` rather than relying on floating `main`, so concurrent unverified commits on `spark:git/aienos.com.git` do not block publishing a verified release.
4. Verify live HTTPS HTML, CSS/computed styles on modified sections, and `/aien/` chat end-to-end from the MacBook:
   ```sh
   curl -fsS https://www.aienos.com/aien/api/presence
   curl -fsS -N -H "Origin: https://www.aienos.com" -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"WTF is AienOS?"}]}' \
     https://www.aienos.com/aien/api/chat | head -n 12
   ```
   - For `<canvas>` or animation edits, verify live HTTPS with a `deviceScaleFactor: 2` headless Chrome CDP screenshot (asserting `canvas.width > rect.width`) and visually inspect the captured PNG with `read_file`.

## 5. Blog Articles, Mobile Visual Checks & Search Indexing

- **11-point sync checklist for new `/blog/<slug>/` articles:**
  1. Author `om/site/blog-<slug>.om` (identifiers `<= 8` bytes, site tokens only, zero em/en dashes, singular/impersonal voice) and reuse `br_css` from `om/site/blog-rented.om` via `om/site/route-assets.om` (add per-table `--c2`/`--c3`/`--c4` CSS variables to `brc2` instead of duplicating CSS).
  2. Wire `om/site/modules.txt`, `om/site/site.om` (`st_page_body`), `om/site/route-assets.om`, and `om/site/pages.json` (`kind: "Article"`, `area: "Learn"`).
  3. Add a `.blog-card` entry to `pq0008` in `om/site/people.om` including `<a class="box-link source-link" href="https://interplane.io/drakestapleton/aienos.com/blob/main/om/site/blog-<slug>.om">Source on Interplane</a>`.
  4. Keep exact ordering parity between `om/site/verify-data.om` (`vpages`) and `crates/site-builder/src/seo.rs` (`PAGES`), and keep `om/site/verify-site.om` (`vv5f`, `vv13`, `vgen` + matching `0` in `vgenf`) in lockstep with `crates/site-builder/src/main.rs` (`GENERATED_PAGES`).
  5. Add a `< 1 MB` `1200×630` card to `scripts/og-cards.py`, run `python3 scripts/og-cards.py`, and `git checkout --` any untouched pre-existing `public/og*.png` files so only new cards change.
- **Responsive tables & macOS Chrome `390px` visual checks:**
  - In `@container (width < 600px)` stacked table rules, always include `caption` alongside `table, thead, tbody, tr, th, td { display: block; width: 100%; }` so `<caption>` does not collapse into a 1-character vertical column on phones.
  - macOS headless Chrome clamps `--window-size=390,...` to ~`500px`; use Chrome DevTools Protocol (`Emulation.setDeviceMetricsOverride({ width: 390, height: 1100, deviceScaleFactor: 2, mobile: true })` + `Page.captureScreenshot`) and assert `document.documentElement.scrollWidth <= window.innerWidth`.
- **Post-publish search indexing (`IndexNow` + Google Search Console):**
  - After verifying live `HTTP 200` on `www.aienos.com`, push updated URLs via IndexNow (hosted key `61088fe61cf5283afad8253cec1087ab` at `https://www.aienos.com/61088fe61cf5283afad8253cec1087ab.txt`) and confirm `HTTP 200`/`202`:
    ```sh
    curl -i -sS -X POST https://api.indexnow.org/indexnow \
      -H 'Content-Type: application/json; charset=utf-8' \
      -d '{"host":"www.aienos.com","key":"61088fe61cf5283afad8253cec1087ab","keyLocation":"https://www.aienos.com/61088fe61cf5283afad8253cec1087ab.txt","urlList":["https://www.aienos.com/blog/","https://www.aienos.com/sitemap.xml"]}'
    ```
  - Google deprecated unauthenticated `/ping?sitemap=` in 2023. `aienos.com` is already DNS-verified (`google-site-verification=kFW2NtW13XSwTusAhTdgK26cfv7QLN-dkO5zkH_qq3g`) with `Sitemap: https://www.aienos.com/sitemap.xml` in `robots.txt`; submitting in Google Search Console (`https://search.google.com/search-console`) requires an authenticated Google session (pause for user sign-in if `accounts.google.com` blocks automated navigation).
