---
name: pi5-omega-edge
description: >-
  Operate, debug, benchmark, and upgrade the 100% pure seeded-Omega standalone
  web and edge stack on Raspberry Pi 5 (hub, 192.168.1.192): omega-edge.target,
  omega-sni, omega-edge-v3-pi, omega-http80, /mnt/omega-sd storage, acme.sh
  reloads, Forge anti-bot lane isolation, pure-OM-2 TLS 1.3 perf (Rung 0-3),
  and omega-tunnel LAN links. Use whenever touching Pi 5 websites, edge TLS,
  forged/playground/strand-hub on hub, or pure-OM-2 HTTP/TLS performance.
---

# Raspberry Pi 5 100% Pure-Omega Standalone Edge (`pi5-omega-edge`)

Zero C, zero `gcc`, zero `libc`, zero OpenSSL, zero `nginx`, zero Apache, and zero Spark runtime dependency for serving `www.aienos.com`, `aienos.com`, `interplane.io`, `hopbot.org`, and raw TLS passthrough for `hs.aienos.com` Headscale on `hub` (`192.168.1.192`, `4× ARM Cortex-A76 @ 2.4 GHz`, `7.7 GiB` RAM, Ubuntu `7.0.0-1023-raspi` `aarch64`).

## 1. Live Production Pi 5 Topology (`omega-edge.target`)

All **12 pure seeded-OM-2 systemd units** (`~26.8 MiB` total baseline RSS; `nginx.service` stopped & disabled; `headscale.service` `:4443` untouched) run under `omega-edge.target` (staging sources and unit templates live in `hub:~/work/pi-standalone/`):

| Role | Systemd Unit | Listen Addr | Notes |
|---|---|---|---|
| HTTP `:80` ACME + Redirect | `omega-http80` | `:80` | `O_NOFOLLOW` `/.well-known/acme-challenge/*` (`200`), allowlisted `301 -> https://`, `421` unknown Host |
| L4 TLS 1.3 SNI Router | `omega-sni` | `:443` | 4 `SO_REUSEPORT` workers, PROXY v1 to `:4446..4449`, raw TCP passthrough `hs.aienos.com -> 127.0.0.1:4443` |
| `www.aienos.com` Edge | `omega-edge-aienos` | `127.0.0.1:4446` | 4 workers, static `/var/www/aienos.com/current`, SSE proxy `/aien/` & `/now/`, `/agora/` |
| `aienos.com` Apex Edge | `omega-edge-apex` | `127.0.0.1:4447` | 2 workers, `301 -> https://www.aienos.com/` |
| `interplane.io` Edge | `omega-edge-interplane` | `127.0.0.1:4448` | 4 workers, static `/var/www/interplane.io`, in-process pure-OM-2 Git Dumb-HTTP, Forge anti-bot shield |
| `hopbot.org` Edge | `omega-edge-hopbot` | `127.0.0.1:4449` | 2 workers, static `/var/www/hopbot.org` |
| `/aien/` Chat + Arena | `omega-aien-chat` | `127.0.0.1:18110` | `aien-chat` (`68 KiB`), standalone grounded mode when Spark GPU router is offline |
| Agora Identity | `omega-agora` | `127.0.0.1:18132` | Pure-OM-2 `agora` (`190 KiB`), `/var/lib/aien-agora` |
| `/now/` Status SSE | `omega-now` | `127.0.0.1:4748` | Pure-OM-2 `omega-now` (`13 KiB`), replaces legacy Python `aien-floor` |
| Interplane Forge | `omega-forged` | `127.0.0.1:18480` | `forged-pi-prod` (`1.1 MiB`), backed by `/var/lib/interplane-forge` (`bind` from SD) |
| Online Compiler | `omega-playground` | `127.0.0.1:18490` | `om-playground-pi` (`50 KiB`) + pinned Pi `omc` + native `execpure` (Landlock ABI-3 + seccomp-BPF) |
| Strand Exchange | `omega-strand-hub` | `127.0.0.1:18491` | Pure-OM-2 `om-strand-hub` (`202 KiB`), `OLLMSP01` packs + `.spclip` in `/mnt/omega-sd/om-strand-hub` |

### Storage Layout (`/dev/sda2` + `/mnt/omega-sd`)
- **Root (`/dev/sda2`, `28 GiB`):** Keep `>= 25%` free (`>= 7.1 GiB`). Safely reclaim space when needed by pruning old `/var/www/aienos.com/releases/*` snapshots (strictly keeping `current`, `previous-release`, and the 3 newest) plus `sudo journalctl --vacuum-size=100M`. Never delete `~/spark-backup` or `headscale`/`vault` data unprompted.
- **MicroSD (`/dev/mmcblk0p1`, label `OMEGA_SD`, `117 GiB`, UUID `7201fe5b-1120-4a16-8c38-5e53bc0be503`):** Mounted persistently at `/mnt/omega-sd` (`defaults,noatime,nofail 0 2`) in `/etc/fstab` with **persistent bind mounts** (`none bind,nofail 0 0` — **never symlinks** under `O_NOFOLLOW` docroots!):
  - `/mnt/omega-sd/interplane-git` -> `/var/www/interplane-git` (138 bare git repos; run `git update-server-info` on new/updated bare repos for pure-OM-2 Git Dumb-HTTP)
  - `/mnt/omega-sd/interplane-forge` -> `/var/lib/interplane-forge` (`interplane-store-owner` + `forge-data`)
  - `/mnt/omega-sd/om-strand-hub` (direct path in `omega-strand-hub.service`)

### TLS Cert Renewals & Instant Rollback
- All 4 ECDSA P-256 certs live in `/etc/nginx/certs/<domain>/{fullchain.pem,key.pem}` and renew locally on Pi 5 via root cron `acme.sh` DNS-01 (`dns_gandi_livedns`) with `Le_ReloadCmd=/usr/local/sbin/acme-reload-omega.sh`.
- **1-command emergency rollback:**
  ```sh
  ssh hub "sudo systemctl stop omega-edge.target && sudo systemctl disable omega-edge.target && sudo systemctl enable --now nginx.service"
  ```

## 2. ARMv8.2 Pi 5 Portability & Process Gotchas

- **No `FEAT_DIT` on Cortex-A76 (`ARMv8.2-A`):** DGX Spark binaries (`ARMv9.2-A`) executing unconditional `MRS/MSR DIT` trap **`SIGILL` (exit 132)** on Pi 5. Guard with startup `/proc/cpuinfo` `Features` detection (`ts_detect_dit`: enable `dit 1` only when supported; retain constant-time `_core` crypto + key `scrub` everywhere).
- **15-character Linux `comm` truncation:** `pkill -x omega-edge-v3-opt` fails silently because `/proc/<pid>/comm` truncates names to 15 chars (`omega-edge-v3-o`). Never use `pkill -f` over SSH either; control via `systemctl` or saved master `$PID` (paired with a `getppid` watchdog inside workers so workers exit within `<= 250 ms` of master exit).
- **UFW port `80/tcp`:** Ensure `ufw` allows `80/tcp` from `Anywhere` (not only `192.168.1.0/24`) alongside `443/tcp` so HTTP→HTTPS redirects and ACME checks work externally.
- **Standalone offline notes:** `galaxy-live` and `research-agent` pause live Spark GPU telemetry while Spark boots bare-metal AienOS; static pages continue serving HTTP `200` on Pi 5, and `omega-aien-chat` serves grounded standalone chat + flying-balls SSE cleanly.

## 3. Edge Security & Live-Fire Anti-Bot Guardrails

1. **Component-wise `O_NOFOLLOW` root containment:** Leaf-only `O_NOFOLLOW` fails on intermediate directory symlinks (e.g., `/symdir/hostname` leaks). Always open docroot with `O_RDONLY|O_DIRECTORY|O_CLOEXEC`, then walk every intermediate path component with `O_NOFOLLOW` + `fstat(S_IFDIR)` + `fchdir` and open the final leaf with `O_NOFOLLOW`, mapping every `-ELOOP` (`-40`) to `403`. Use bind mounts (not symlinks) for `/var/www/interplane-git`.
2. **Trap-4 (`exit 104`) input bounds:** Guard every untrusted URI segment count, segment length, header count, and header length loop with explicit checks that return HTTP `400` or `403` cleanly instead of tripping Omega array/loop traps.
3. **Pre-fork Forge bot & 40-hex lane isolation:** Never bypass rate-limiting in async proxy mode on `forged` routes! Live internet crawlers targeting `/(blob|tree|raw|commits?)/<40-hex>`, `/blame/`, and `.patch` saturate `forged`'s `listen(64)` queue and trigger `fork()` OOM storms (`MemoryMax=96M`) if admitted unconstrained:
   - Detect heavy Forge paths + crawler UAs (`bot`, `crawl`, `spider`, `slurp`, `googleother`, `bytespider`, `claudebot`, `gptbot`, `meta-external`, `semrush`, `ahrefs`, `yandex`, `baidu`, etc.) inside `omega-edge-v3-pi` **before** `fork()` and **before** connecting to `127.0.0.1:18480`.
   - Cap the bot/40-hex lane to max `1` global in-flight slot (yielding to human requests) and reject excess immediately in-worker with `HTTP/1.1 429 Too Many Requests` + `Retry-After: 10`, while preserving an isolated human Forge lane (`10 r/s` per IP, burst `20`).

## 4. Pure-OM-2 High-Concurrency TLS 1.3 Perf (`Rung 0 → Rung 3`)

- **Core concurrency architecture (`Rung 1`):** `4× SO_REUSEPORT` `pollfds` workers (`cpuset`-pinned, auto `prlimit` `RLIMIT_NOFILE=65536`, `getppid` watchdog), true HTTP/1.1 Keep-Alive + pipelining, coalesced 1-send Server Flight, `16,384 B` in-place TLS records, and `O_NOFOLLOW`+`S_IFREG`-gated hot static slab cache.
- **Compiler/silicon micro-optimizations (`Rung 3`):**
  - Pin the hottest 9 global buffers first (`X18..X26` hardware registers — zero `MOVZ/MOVK` reloads).
  - Use `layout Blk4K`/`Rec0` (`4096 B`) for single-instruction 64-bit `LDR X` / `STR X` without bounds-check branches, fused directly with ChaCha20 (`14` regs) + Poly1305 (`g_sc_slab64` pre-formatted HTTP `200` + body).
  - Use `send(..., MSG_MORE=32768)` per `4 KiB` chunk inside each TLS record and flush (`flags=0`) at record end so client decrypt overlaps server encrypt (`EAGAIN`/`g_c_tx` spill safe).
  - Eliminate handshake hotspots (`4.41 ms → 1.33 ms` server CPU on Pi 5): precomputed `26×16` P-256 `G` comb + Comba Solinas (`1,736 → 288 µs`), precomputed `32×8` Twisted Edwards `X25519(sk, 9)` Niels table (`921 → 163 µs`), global cached `SHA-256/512` `K`-tables, and in-place TLS flight encryption (closing cold `C=1` within `+360 µs` of OpenSSL ARMv8 ASM while beating Pi 5 `nginx` on `KA C=1/32/64/256/512` and `Cold C=64`).
  - Note: Neither `omc` (`28fca13d...`) nor `@ng a64` currently exposes user-facing `UMULH`, `SHA256H`, or `AESE/AESMC/PMULL` intrinsics; exposing those in `@ng a64` closes the remaining cold-HS / AEAD CPU gap.

## 5. Pure-OM-2 Physical LAN Tunnel (`omega-tunnel` `OMTN01`)

When DGX Spark runs Linux alongside Pi 5, replace Tailscale (`100.64.*`) and SSH reverse tunnels with `omega-tunnel` (`~/work/omega-tunnel/`, `135.6 KiB` static ELF, `228–320 kB` RAM) directly over physical Ethernet LAN (`192.168.1.192` ↔ `192.168.1.108:19430`, `~0.64 ms` RTT, `~391 Mbps` peak): mutual Ed25519 auth + ephemeral X25519 + monotonic-nonce `AEAD_CHACHA20_POLY1305` + `memfd`+`flock` anti-replay + strict peer & port allowlists.
