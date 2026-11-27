---
name: spark-baremetal-efi
description: >-
  Build, verify, debug, and safely USB-stage the pure seeded-Omega bare-metal
  Aienux UEFI image (SPARK.EFI) and its MacBook controller (omega-link /
  spark-ctl) for Drake's DGX Spark (GB10 SoC). Covers verified GB10 MMIO/ACPI
  IORT/USB/HDA hardware addresses, HDMI panic hold, Spark CPU build & 12/12
  QEMU gates, safe AIENOSRECOV USB staging, and bare-metal OM-2/silicon traps.
  Use whenever editing aienux/spark/*, aienux/usb/*, aienux/audio/*,
  aienux/disk/nvme_sovereign.om, seed/build/sparkefi.om, or omega-link spark-ctl.
---

# DGX Spark Bare-Metal Aienux (`SPARK.EFI`) Runbook

100% pure seeded OM-2 (`seed/out/omc`, zero C/libc/Python) bare-metal UEFI stack targeting Drake's DGX Spark (GB10: 10× Cortex-X925 + 10× Cortex-A725, GB20B SM121 GPU, 128 GB unified LPDDR5X).

## 1. Verified Live DGX Spark GB10 Bare-Metal Hardware Map

Read-only verified against Drake's physical Spark (`192.168.1.108`, Ubuntu `7.0.0-1019-nvidia`):

- **Interrupts & Timers:** GICD `0x06800000`, GICR `0x06880000..0x06d7ffff` (GICv4 256 KiB stride), UART 16550 (`MTKI0511:00`) `0x16a00000`, SBSA-GWDT (`GTDT`) Control `0x1c041000` / Refresh `0x1c042000` (GSI 729).
- **SMMUv3 & PMCGs:** SMMU-A `0x13800000` (PMCG `0x13802000`, owns NVMe/RTL8127/xHCI), SMMU-B `0x13000000` (PMCG `0x13002000`, owns GB20B/HDA `CCA=0`), SMMU-C `0x14900000`.
- **PCIe Endpoints (16 MCFG segs):**
  - `0004:01:00.0` (`144d:a810`) Samsung 3.7 TiB NVMe (`BAR0=0x62100000`)
  - `0007:01:00.0` (`10ec:8127`) Realtek RTL8127 10GbE (`BAR2=0x6e900000`, `192.168.1.108/24`)
  - `0009:01:00.0` (`14c3:7925`) MediaTek MT7925 Wi-Fi 7
  - `000f:01:00.0` (`10de:2e12`) NVIDIA GB20B Blackwell GPU (`BAR0=0x24000000`, `64 MiB`)
- **6× xHCI 1.20 (`SMMUv3-A`, `HCSPARAMS2=0x24200004` → 36 Scratchpad Buffers):**
  - `USB0` (`NVDA8000:00`, `0x1db60000`): CyberPower `CP1500PFCLCDa` UPS (`0764:0601`)
  - `USB1` (`NVDA8000:01`, `0x1db90000`): Genesys `05e3:0610` 4-port HS Hub → Port 1 SanDisk `0781:5575` (`AIENOSRECOV`), Port 2 HP Wired 320K Keyboard (`04f2:3f41`, Low-Speed)
  - `USB2` (`NVDA8000:02`, `0x1dde0000`): YubiKey 4/5 (`1050:0407`)
  - `USB3` `0x1de10000`, `USB4` `0x1d860000`, `USB5` `0x1d870000` (IMC BT/Wi-Fi `13d3:3630`)
- **HDMI Audio (`NVDA2014:00` / `\_SB_.HDA0`, `SMMUv3-B` `CCA=0`):** MMIO `0x36078000..0x3607ffff`, Codec `Nvidia SoC 33 HDMI/DP` (`0x10de0033`), AFG `0x01`, Converter `0x08`, Pin Complexes `0x04..0x07`.
- **TPM 2.0 & GOP:** Nuvoton `NTC0702:00` CRB `0x933c0000` (`ctrl_area_pa=0x933c0040`, start method 15); UEFI GOP `BOOTFB` `0x300000000..0x30086ffff` (inside `SPK_RMR2`).

## 2. Authoritative Build, Verification & Safe USB Staging

### Build & 12/12 Gate on Spark CPU (Zero GPU/ESP Touch)
MacBook `omc-macos` runs fast host unit tests (`{ printf 'target a64macos\nom2\n'; cat ...; } | ~/.local/bin/omc`), while authoritative `SPARK.EFI` (`PLAT=gb10`) and full `run_phase3_gate.sh` (`12/12` + 20-core QEMU + SMMUv3 + RAMFB) run on Spark CPU:

```sh
# CRITICAL: leading slashes on --exclude! NEVER `--exclude build` (deletes seed/build/).
rsync -az --delete --exclude '/build' --exclude '/.git' /tmp/omv-bm-spark/ spark:/tmp/omv-bm-check/
ssh spark 'cd /tmp/omv-bm-check && \
  OMC=$HOME/canon/omega-mv/seed/out/omc \
  HOST_OMC=$HOME/canon/omega-mv/seed/out/omc \
  EFI_OMC=$HOME/canon/omega-mv/seed/out/omc \
  sh aienux/spark/build_spark_efi.sh build/spark/SPARK.EFI && \
  sh aienux/spark/run_phase3_gate.sh'
```

Always copy `build/spark/SPARK.EFI` back locally, verify `shasum -a 256`, and remove `spark:/tmp/omv-bm-check`.

### Safe Staging onto External `AIENOSRECOV` USB (Never Touch Spark `/boot/efi` or NVRAM)
macOS 26.x `storagekitd` refuses non-root mounting of GPT `EFI` partitions. Keep `AIENOSRECOV` (`PARTUUID=f227357c-1e80-4fd0-a55e-2efbef1dd25c`) plugged into Spark and stage strictly via PARTUUID with explicit `TRAN=usb` + `LABEL=AIENOSRECOV` assertions:

```sh
scp /tmp/omv-bm-spark/build/spark/SPARK.EFI spark:/tmp/SPARK.EFI.new
ssh spark 'set -eu
DEV=/dev/disk/by-partuuid/f227357c-1e80-4fd0-a55e-2efbef1dd25c
REAL=$(readlink -f "$DEV")
PARENT=$(lsblk -no PKNAME "$REAL")
[ "$(lsblk -no TRAN "/dev/$PARENT")" = "usb" ]
[ "$(lsblk -no LABEL "$REAL")" = "AIENOSRECOV" ]
sudo mkdir -p /tmp/usb_recov
sudo mount "$REAL" /tmp/usb_recov
sudo mkdir -p /tmp/usb_recov/EFI/BOOT
sudo cp /tmp/SPARK.EFI.new /tmp/usb_recov/EFI/BOOT/BOOTAA64.EFI
sync
sudo cmp -s /tmp/SPARK.EFI.new /tmp/usb_recov/EFI/BOOT/BOOTAA64.EFI
sha256sum /tmp/usb_recov/EFI/BOOT/BOOTAA64.EFI
sudo umount /tmp/usb_recov
rm -f /tmp/SPARK.EFI.new'
```

## 3. Bare-Metal Silicon & OM-2 Traps Already Solved (Do Not Regress)

1. **Physical HDMI Panic/Fail Hold (`SPK_PLAT_QEMU == 0`):** Never call `arm64_psci_reset` immediately on `spk_fail` or post-EBS `panichk` when `fb_active != 0` (causes an unreadable `< 1 ms` flash-then-reboot loop). Switch HDMI to yellow-on-crimson and halt in `WFE` (`arm64_post_ebs_set uart_base PSCI_CONDUIT_NONE`); keep fast PSCI reset only in QEMU (`SPK_PLAT_QEMU == 1`).
2. **Dynamic ACPI IORT + Disjoint SMMUv3 Spans:** Resolve Named Component Stream IDs & `CCA` via `iort_named_route` (never hardcode SIDs) and give every xHCI controller its own disjoint DMA slice (`cdma = xh_dma + c * XH_DMA_PER_CTRL`) — passing the same span twice fails with `SMMU_EOVERLAP`. Never call `smmu_map_span_wb` on `CCA=0` streams (`HDA0`).
3. **Post-MMU MMIO Mapping:** Once `mmu_state[4] == 1`, always map organ MMIO via `mmio_map_device` (executes `DSB ISH + TLBI VMALLE1IS`) and gate every organ on its boolean return; never call raw `mmu_map_id` and discard the result.
4. **`NVDA8000` xHCI Requirements:**
   - Parse `HCSPARAMS2` and populate `DCBAA[0]` with `MaxScratchpadBufs` (`36`) SMMU-mapped 4 KiB pages (fail closed if exceeding capacity); leaving `DCBAA[0] == 0` triggers immediate SMMUv3 `F_TRANSLATION` + `USBSTS.HSE = 1`.
   - Maintain a §4.9.2.1 race-free Producer Interrupt-IN ring (14 primed TRBs + 1 stop sentinel, flipping Link TRB cycle bit only when `enq` reaches slot 15).
   - Walk 1-level USB 2.0 Hubs (`bDeviceClass == 9`, setting `Route String`, `ParentHubSlotID`, `ParentPortNumber`, releasing non-HID child slots via `Disable Slot`) so HP Keyboard behind Genesys Hub enumerates cleanly.
   - Issue initial EP0 `GET_REPORT(Feature)` (`0x08/0x0b/0x13`) for CyberPower UPS on AC power, and dispatch async Interrupt-IN `XFER_EVT` inside command/EP0 wait loops.
5. **Intel HDA (`NVDA2014:00`):** Perform §3.3.21 `CORBRPRST` (`0x8000` → poll `1` → `0` → poll `0`), bounded `STATESTS != 0` settle wait (`>= 521 us`), emit the 13 `0x10de0033` HDMI routing verbs (`AFG 0x01`, `Conv 0x08`, `Pins 0x04..0x07`), and fill the entire cyclic BDL ring (`4096` frames) phase-continuously.
6. **OM-2 Bare-Metal Runtime & Compiler Traps:**
   - **Never use `while true bound N` for MMIO polls:** on real `CNTVCT_EL0` wall clocks, iteration `N+1` triggers **OM-2 Trap 4 (exit 104 / bare-metal panic)**! Always write counted loops (`while lt it N bound N`) with `cpurelax` and test against a frozen mock clock.
   - **Never cast a negative `long` directly to `ulong`:** triggers **OM-2 Trap 5 (exit 105)** (e.g., `-1` sensor values or negative Q15 audio samples). Always branch `if lt val 0` first.
   - Always include `om2` on line 2 when compiling host tests with `0x...` hex literals (omitting it causes `error 6`); avoid reserved words (`sub`, `ne`, `u16` → `error 16`); keep functions under the 16-register local budget (`error 12`); never pass `global` arrays as `fn` arguments (`error 19`).
   - Validate all packed reflex/CLI fields **atomically before mutating state**, and require explicit `--sec` on `spark-ctl watchdog` (never default omitted `--sec` to `0`/disarm).
7. **Unbrickable NVMe `OMVOL01` Fence:** Size deny tables for all 128 legal GPT partitions (`>= 136` entries) with fail-closed overflow (`NVS_FENCE_SEALED_RO`) and unsigned wrap guards on `plo`/`phi`/`dst_pa`.
