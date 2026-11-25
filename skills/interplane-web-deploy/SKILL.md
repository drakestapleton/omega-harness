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
2. Build and verify on Spark with the pinned `omc` from `native/omc.sha256`:
   ```sh
   OMC="<path-to-pinned-omc>" sh scripts/build-native.sh target/site
   ./target/site build dist dist-hop
   ./target/site verify dist dist-hop
   sh scripts/tests/check-claims.sh --hop content/hop.release.txt dist dist-hop
   ```
3. Commit and push `main` to `spark:git/interplane.io.git`.
4. Export the committed tree on Spark (`git archive`), build & verify, sync to
   `hub:/var/www/interplane.io/` (`--exclude=.well-known`), and **run the Spark
   edge mirror** (without this, live `https://interplane.io` keeps serving the
   stale Spark copy):
   ```sh
   rsync -rt --delete --chmod=D755,F644 --exclude=.well-known dist/ hub:/var/www/interplane.io/
   ~/.local/lib/interplane-forge-ops/edge-mirror.sh
   ```

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
- Static: `/`, `/omega/`
- Forge: `/explore`, `/drakestapleton/omega-mv`, `/drakestapleton/interplane-forge`, `/search`
- Generated: `/galaxy/`, `/research/`

If `/drakestapleton/*` returns `404` and `/explore` shows `0 projects`, check
`grep -a "catalog refused" ~/forge-data/logs/forged.log` — `forged` fails closed
on any malformed line or duplicate project ID in `~/interplane-store-owner/catalog.tsv`.
