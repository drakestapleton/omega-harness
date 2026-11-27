---
name: interplane-web-deploy
description: >-
  Build, verify, and deploy changes across all pages of interplane.io — both the
  static site (interplane.io repo + hub + Spark edge-mirror.sh) and the dynamic
  forge, galaxy, and research pages (interplane-forge repo on Spark). Use when
  editing interplane.io site-wide markup, Open Graph/Twitter cards, assets, or
  deploying forged, galaxy-live, or research pages.
---

# Deploying Changes Across All of `interplane.io`

`https://interplane.io` is served by two repositories. Any site-wide change
(head meta tags, social cards, global assets) must cover **both**:

1. **`interplane.io` (static site, 32 pages):** `/`, `/omega/*`, `/how-it-works/`,
   `/mission/`, `/papers/`, `/yard/`, etc.
2. **`interplane-forge` (dynamic + generated pages):**
   - `server/pages.om` (`fhead`) -> `/explore`, `/<owner>`, `/<owner>/<repo>`,
     `/blob`, `/tree`, `/commits`, `/search`, `/stars`, `/patches`, `/login`
   - `galaxy/page.om` (+ `galaxy/live.om`) -> `/galaxy/`
   - `research/build.om`, `research/route.om`, `research/agent.om` -> `/research/`
   - `chain/chain.om` -> proof/chain page

## Part 1: Static Site (`interplane.io`)

1. Edit `content/_layout.html`, `content/routes.txt` (register new `/public/*.png`
   routes), and `public/` assets.
2. Build and verify on Spark with the pinned `omc` from `native/omc.sha256`
   (note: `native/omc.sha256` has two lines — extract the pin with `head -n1 native/omc.sha256 | awk '{print $1}'`):
   ```sh
   OMC="<path-to-pinned-omc>" sh scripts/build-native.sh target/site
   ./target/site build dist dist-hop
   ./target/site verify dist dist-hop
   sh scripts/tests/check-claims.sh --hop content/hop.release.txt dist dist-hop
   ```
3. Commit and push `main` to `spark:git/interplane.io.git`.
4. Export the committed tree on Spark (`git archive`), build & verify, sync to
   `hub:/var/www/interplane.io/` (`--exclude=.well-known`, preferring `rsync -rc` checksum mode over `-rt` so edited pages with matching timestamps or sizes are never skipped), and **run the Spark
   edge mirror** (without this, live `https://interplane.io` keeps serving the
   stale Spark copy):
   ```sh
   rsync -rc --delete --chmod=D755,F644 --exclude=.well-known dist/ hub:/var/www/interplane.io/
   ~/.local/lib/interplane-forge-ops/edge-mirror.sh
   ```

### Static Verifier & Claims Gotchas (`interplane.io`)
- **Pinned download routes:** `native/site.om` enforces an exact route count and `.sha256` pin digest for `public/omega-downloads/` (currently 9 routes across 3 checksum files: Arm64 Linux, macOS Arm64, and x86-64 Linux). Adding a release requires updating `content/routes.txt`, `native/site.om` (`od*loadsums`, `od*loadpin`, route count, `omdlcopy`), and `content/omega/index.html` (`download` links).
- **Private-path & trademark checks:** The verifier refuses `.local` paths in page copy and any un-trademarked `Sovereign Intelligence` (use `Sovereign Intelligence&trade;` in visible text).
- **Claims gate (`scripts/tests/check-claims.sh`):** Rejects new universal words (`every`, `everything`, `everyone`, `everybody`, `nobody`, `never`, `always`, `all`, `none`) and any drift in `class="reg"` or `class="hf"` sentences against `docs/CLAIMS.md`.
- **Adding or flipping `class="reg"` status claims:** Keep `docs/CLAIMS.md` sorted alphabetically when adding or updating `reg check` or `reg build` rows (e.g., `/si-2/` badge flips), synchronize `content/llms.txt` with the same status/boundary statements, and verify zero non-ASCII bytes alongside `check-claims.sh`.
- **`scripts/tests/check-site.sh` invocation:** Run with **zero positional arguments** and explicit pinned `OMC` (`OMC="$OMC" sh scripts/tests/check-site.sh`). Do **not** pass `dist dist-hop` — `$1` is treated as an optional `CHAIN_BIN` executable (`check-site.sh:236`).
- **Control 94 button-token coupling:** `scripts/tests/check-site.sh:508` hardcodes `--btn-orange-bg:#2563eb` and `--btn-orange-press:#1e40af` in its contrast negative control. Changing primary button tokens in `public/style.css` without updating that test causes control 94 to fail.
- **Static `.no-list` strikethroughs:** Keep `.no-list li::after` static (`height: 3px; transform: scaleX(1); opacity: 1`) rather than animating from `scaleX(0)` with staggered `sibling-index()` delays.

### Upstream Freshness & Zero-JS Animation Guardrails
- **Pre-deploy visual gate & calm motion:** Before deploying visual, layout, or theme changes to `/`, run `~/workspace/omega-harness/scripts/sandbox-visual-gate.sh dist` and visually inspect desktop (`1280px`/`1106px`) and mobile (`390px`) renders. Keep experimental 3D canvases on standalone routes (e.g. `/acropolis/`), never replacing the `/` hero without Drake's explicit visual approval, and keep background animations slow, low-contrast, and subtle.
- **Fetch upstream repos before writing showcase copy:** Always run `git fetch --all --tags` and inspect `main` and `github/main` (e.g., in `omega-helix` and `omega-mv`) before writing feature/installer copy, and verify any new GitHub receipt URLs return HTTP 200.
- **Kinetic CSS animations on `interplane.io`:** `native/site.om` refuses SMIL `<animate*>` tags inside `<svg>`, inline `style=` / `<style>` blocks, and any raw hex/`rgb()`/`hsl()` color in `public/style.css` outside line 1 (`:root{...}`). Put all `@keyframes` and SVG motion in `public/style.css` using `:root` tokens only, wrap flying/sweeping elements in `overflow: hidden` (`overflow-x: clip`), gate motion with `@media(prefers-reduced-motion:no-preference)`, and run `check-render.sh` (`1280 390 360`) to verify zero horizontal overflow.
- **Kinetic CSS animations on `aienos.com`:** Inside `om/site/floor.om` (`ffcss`), use only CSS tokens from `fftokens` / `om/site/css.om` (zero raw hex/`rgb`/`rgba`/`hsl` colors), keep strict first-person singular voice (`I`/`me`/`my`), and never add `github.com` or `github.io` links.
- **Git-only vs. forge-HTML links:** Before linking `https://interplane.io/drakestapleton/<repo>` in an `<a href>`, confirm HTTP 200 on Spark `http://127.0.0.1:18480/drakestapleton/<repo>` (`Host: interplane.io`). Newly mirrored git-only repos serve `git clone .../drakestapleton/<repo>.git` (`200`) while their HTML page stays `404` until owner-signed via `ipl`.
- **Pinned `omc` fallback & clean worktree on Spark:** If `~/canon/omega-mv/seed/out/omc` has moved past `interplane.io/native/omc.sha256`, check Spark's cache (`~/.cache/interplane/omc-<sha256>`, e.g., `omc-85b84c6de85083e4d9d2368015c1ddcab3d863aada922be0e63d774dddf23134`) and pass `OMEGA_GIT=/nonexistent` to `scripts/tests/check-site.sh` if `~/git/omega-mv.git` `main` has advanced. Always check `git status --short` on `~/workspace/interplane.io` first; if unrelated WIP exists, deploy from a clean temporary worktree (`git worktree add --detach /tmp/interplane-deploy spark/main`) and remove it after verification.

## Part 2b: `aienos.com` Static Site (SiteHub)
Deploy committed `main` on Spark:
```sh
ssh spark "flock ~/handoffs/site-front/publish.lock ~/work/sitehub/deploy.sh <commit-sha>"
```
Confirm `RESULT PASS` and `PUBLISH OK release=...` (all 9 gates including Omega verifier and Rust oracle). A trailing `SI-FRONT FAIL` on the retired Radicle `/si` repo leaves `/si` untouched after atomic site publication succeeds.

## Part 2: Dynamic Forge, Galaxy, and Research (`interplane-forge`)

1. Work from a clean clone of `spark:~/git/interplane-forge.git` (`main`) so
   local WIP branches are untouched.
2. Edit templates (`server/pages.om`, `galaxy/page.om`, `research/build.om`,
   `research/route.om`, `research/agent.om`, `chain/chain.om`), commit, and push
   `main` to `~/git/interplane-forge.git`.
3. Per `infra/DEPLOY.md`, always build the live `forged` binary from a clean
   committed `git archive` (never a dirty working tree) using the pinned `omc`
   in `run.sh`:
   ```sh
   DEST="$HOME/.local/lib/interplane-forge/store-$SHORT"
   # Copy unchanged helpers (infra/, out/forged-listen, out/forged-seccomp.bpf, out/public-read)
   # from the previous store-* directory, then build out/forged:
   FORGE_STORE="$HOME/interplane-store-owner" \
   FORGE_CLONE_BASE="https://interplane.io/" \
   FORGED_OUT="$DEST/out/forged" \
     ./run.sh build
   ```
4. Back up `~/.config/systemd/user/interplane-forged.service.d/build.conf`,
   update `FORGED_DIR=$DEST` (keep `FORGED_PUBLIC_GIT=on`), and restart:
   ```sh
   systemctl --user daemon-reload
   systemctl --user restart interplane-forged.service
   sleep 9   # forged-service.sh takes ~7-8s to start forged
   ```
5. Rebuild and atomically replace `galaxy-live` (`cat galaxy/page.om galaxy/live.om | $OMC`),
   run `sh galaxy/tests/run.sh`, restart `galaxy-live`, and republish research:
   ```sh
   sh research/publish.sh "$HOME/forge-data/research"
   ```

## Part 3: Mandatory Live Verification

Check **both** `127.0.0.1:18480` on Spark and live `https://interplane.io` across
all route families:
- Static: `/`, `/public/style.css`, `/omega/`, `/public/copy.js` (HTTP 200, plus `Content-Security-Policy` carrying `script-src 'self'` on static pages while `forged` keeps `script-src 'none'`). Always check **both** live `index.html` and live `public/style.css` (e.g. `:root` `--paper` and edited rules) after `hub` `rsync` + `edge-mirror.sh`, since a stalled or partial `hub` transfer can leave updated HTML paired with stale CSS.
- Forge: `/explore`, `/drakestapleton/omega-mv`, `/drakestapleton/interplane-forge`, `/search`
- Generated: `/galaxy/`, `/research/`

If `/drakestapleton/*` returns `404` and `/explore` shows `0 projects`, check
`grep -a "catalog refused" ~/forge-data/logs/forged.log` — `forged` fails closed
on any malformed line or duplicate project ID in `~/interplane-store-owner/catalog.tsv`.

### Mandatory Live 404 Link Audit
After deploying page or data changes, verify zero `404` links on all modified pages:
- Unescape HTML entities (`html.unescape`) before splitting `#fragments` so `&#35;` anchors are not truncated into false `404`s.
- Check `/drakestapleton/*` forge links against Spark `http://127.0.0.1:18480` (with `Host: interplane.io`) rather than hammering public HTTPS, which triggers nginx `429` rate limits.
