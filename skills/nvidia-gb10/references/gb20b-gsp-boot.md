# GB20B Own-Driver (`aien-gpu`) GSP Boot & Verification Reference

Verified against NVIDIA `open-gpu-kernel-modules 580.173.02` and Spark Window 0 capture
`HANDOFFS/L332/window0-20261118T234217Z` (2026-11-18). All Stage B/C items below are `HOST_TESTED` / `QEMU`
verified as of 2026-11-19 (`hardware=NOT_RUN` until a reviewed Window 0 cold boot runs on the Spark).

## 1. GB10B vs. GB20B HAL Delta (`580.173.02`)

Do not port or test `GB10B` (`0x1A`) paths on the Spark die (`BOOT_0=0x1bb000a1`, `BOOT_42=0x1bba1000`):

| Area | Wrong (`GB10B`) | Required on Spark (`GB20B`) | `580.173.02` Source |
|---|---|---|---|
| Chip identity | `BOOT_42[29:20] == 0x1AB` (`arch=0x1A`) | `0x1BB` (`arch=0x1B`, `impl=0xB`) | `g_hal_archimpl.h:96`; `GPUID.TXT` |
| GSP-RM ELF signature | `.fwsignature_gb10y` | `.fwsignature_gb20y` (`4096 B`) inside `gsp_ga10x.bin` | `nv-firmware-chip-family-select.h:64-68` |
| GSP-RM bootloader | `GspRmBoot_GB10B` (`196,608 B`, `monCodeOff=0xb000`) | `GspRmBoot_GB20B` (`212,992 B`, `monCodeOff=0xf000`, `monDataSize=0xe600`) | `g_kernel_gsp_nvoc.c:792-794`; `UCODE_DESC_PROD` |
| GSP-FMC image | `GspRmFmcGfwProdSigned_GB10B` (`195,912 B`) | `GspRmFmcGfwProdSigned_GB20B` (`212,296 B`; hash `48 B`, pkey `384 B`, sig `384 B`) | `g_kernel_gsp_nvoc.c:928-930` |
| WPR metadata & CrashCat | No CrashCat sysmem queue | Shared `kgspPopulateWprMeta_GB10B` (`vga=pmu=nonWprHeap=0`, `gspFwHeapSize=133 MiB`) + `4096 B` CrashCat queue (union offsets `224`/`232`) | `g_kernel_gsp_nvoc.c:987-989,1859-1862`; `kernel_gsp_gh100.c:364-372` |
| FWSEC prerequisite | None | Poll `NV_PMC_SCRATCH_RESET_PLUS_2` (`0x5e0`) `== 0xFF` before touching SEC2 | `gb20b/dev_boot.h:26`; `kernel_sec2_gb20b.c:541-575` |
| COT packet | `version=1`, `frtsSysmemSize=fmc_size`, MCTP `0x00000001` | `version=2`, `size=860` (`868 B` wire = `217` dwords), `frtsSysmemSize=0`, MCTP `0xc0000000` (`SOM|EOM`) | `g_kernel_sec2_nvoc.c:483-485`; `kernel_sec2_gb20b.c:206-220,988-1000` |
| SEC2 send & reply | Poll `SEC2 MAILBOX0 != 0xc001cafe` | Send via `QUEUE_HEAD/TAIL` (`0x840c00/04`) + `EMEMC` (`0x840ac0`, `AINCW` bit 24); poll `NV_PSEC_MSGQ_HEAD/TAIL(0)` (`0x840c80/84`), read via `EMEMC` `AINCR` (bit 25), size `((tail-head) mod 2^32)+4` in `[4,1024]`, **write `TAIL=head` strictly before `HEAD=head`**, check single-packet `SOM|EOM`, NVDM `0x1510de7e` (masking bit 7 `IC`), `cmd=0x14`, `errorCode=0` | `gb20b/dev_sec_pri.h:26-60`; `kernel_sec2_gb20b.c:481-537`; `kernel_sec2.c:448-496` |
| Stage C doorbell token | `(runlist << 16) | chId` (bit 22 active-low) | `kfifoGenerateWorkSubmitTokenHal_GB202`: set bit 30 `RUNLIST_DOORBELL_ENABLE` (`| 0x40000000`, active-high); `runlist <= 127`, `chId <= 4095`. Classes: `0xcec0` (`BLACKWELL_COMPUTE_B`), `0xca6f` (`BLACKWELL_CHANNEL_GPFIFO_B`) | `g_kernel_fifo_nvoc.c:644-646`; `gb202/dev_vm.h:30-32`; `kernel_fifo_gb202.c:73-76` |
| PCIe FLR | `PDB_PROP_GPU_TRIGGER_PCIE_FLR=TRUE` | `NV_FALSE` — sysfs FLR on `000f:01:00.0` resets the whole SoC | `g_gpu_nvoc.c`; `BOARD 2026-11-18T23:17:45Z` |

## 2. Window 0 Cold-Boot Procedure Rules

1. **Preconditions:** Operator approval specifically for a planned Spark restart (stopping a job is not restart
   approval), all artifacts + `SHA256SUMS` persisted outside `/tmp`, fresh-clone host + QEMU + mutation gates
   green, and independent exact-head review settled.
2. **One-boot isolation:** Wait for any active `spark-window` to finish, post `CLAIM`/`START` on `HANDOFFS/BOARD.md`,
   install a one-boot `nvidia` modprobe blacklist, and perform a clean reboot.
3. **After cold reboot:** Verify `NO_NVIDIA_LOADED`, `000f:01:00.0 UNBOUND`, and `sha256sum -c` on all staged
   artifacts. Re-track/reclaim the window on `HANDOFFS/BOARD.md` (reboot clears `spark-window` state). Write all
   `dmesg`, Stage A/B/C outputs, and binary dumps directly into `HANDOFFS/L332/`.
4. **Restore:** Remove the one-boot blacklist before the restore reboot (never rely on sysfs FLR), reboot back to
   stock `nvidia` + `nvidia-persistenced` + `aien-run-spark-sensors.service`, confirm `nvidia-smi` health, verify
   `spark-window status` is clear, and post `RELEASE` with the receipt path.

## 3. Driver ABI, Verification & Multi-Agent Traps (Caught in Reviews 2026-11-18/19)

- **Never hand-count wire or UAPI struct offsets:** Derive every C offset with `offsetof` + `_Static_assert`, verify
  every pure-`.om` client (`dev.om`, `orch-aien.om`, `bw_qmd.om` slot order `code`/`cb`/`scratch`) with a compiled
  layout gate, and cross-check two independent builders byte-for-byte on emitted `cot_packet.bin`, `wpr_meta.bin`,
  and `system_info.sent.bin`.
- **Preserve top-level UAPI compatibility:** Keep `AGPU_ABI_VERSION=1` intact for existing Compute ABI 1 clients
  and version the inner `AGPU_BOOT` block (`AGPU_BOOT_VERSION=2`) rather than breaking all callers.
- **Test the exact boundaries mutants hide in:**
  - Use nonzero queue indices (`reply_head != 0`) so `MSGQ_HEAD` vs `QHEAD0` mutations cannot survive.
  - Test off-by-one reply bounds (`rsp_bytes = 3, 4, 5, 19, 20, 1024, 1025`), `32`-bit wraparound, and `SOM=0`
    with corrupted header dwords.
  - Pre-fill output/state arrays with poison (`0xdeadbeefcafebabe`) so missing zero-initialization is caught.
  - Make binary-embedding controls (`ko-units`) flip a real bit inside a copy of `.ko` re-extracted by the real
    reader, not a synthetic stub.
- **Pin every gate input for true offline fresh clones:** Pin external oracle commits as a branch in the same
  repository (no reliance on sibling work folders or network fetches), and hash-pin every input to package scripts
  (including `system_info.txt` and NVIDIA source trees) before claiming "all inputs pinned".
- **Label single-source simulator limits explicitly:** When the C reference, MMIO simulator, and `.om` unit are
  written from one reading of the vendor driver, `PARITY-BOOT` proves `Omega == C`, not `C == hardware`. Record
  that explicitly in `docs/STATUS.md`.
- **Snapshot clean committed SHAs across agents:** Never snapshot or review another agent's dirty working tree;
  coordinate one writer per mutable branch on `HANDOFFS/BOARD.md` and run cross-checks against committed hashes.
