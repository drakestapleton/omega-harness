---
name: omega-macos-macho
description: >-
  Cross-compile pure Omega (.om) programs to native Apple Silicon macOS ARM64 Mach-O
  binaries using Omega NG (@ng a64 macho, target macos, libfn/libptr/libcall, AppKit/Foundation,
  and ad-hoc codesign). Use when building macOS workers, CLIs, or native AppKit HUDs in pure .om.
---

# Pure Omega on macOS ARM64 (`@ng a64 macho`)

## 1. Build Pipeline (Spark AArch64 → MacBook ARM64)
1. **Build `ng` once on Spark** from `seed/ng/ng.units` (note: `seed/ng/src/ir.om` already begins with `om2` — do not prepend a second `om2`):
   ```sh
   : > /tmp/ng.om
   while read -r _ p; do cat ~/canon/omega-mv/"$p" >> /tmp/ng.om; done < ~/canon/omega-mv/seed/ng/ng.units
   ~/canon/omega-mv/seed/out/omc < /tmp/ng.om > bin/ng && chmod +x bin/ng
   ```
2. **3-stage Mach-O cross-compile on Spark**:
   ```sh
   { printf '@ng front-ir\n'; cat prog.om; } | ./bin/ng > /tmp/prog.ir
   { printf '@ng opt\n'; cat /tmp/prog.ir; } | ./bin/ng > /tmp/prog.opt.ir
   { printf '@ng a64 macho\n'; cat /tmp/prog.opt.ir; } | ./bin/ng > bin/prog
   ```
3. **Copy to MacBook and ad-hoc sign** (required on arm64 macOS):
   ```sh
   scp spark:~/.../bin/prog bin/prog
   chmod +x bin/prog && codesign --force --sign - bin/prog
   file bin/prog   # expects: Mach-O 64-bit executable arm64
   ```

## 2. `target macos` Rules & Pitfalls
- **Header**: Start with `target macos` on line 1 and `om2` on line 2.
- **`dlopen` / `dlsym` via `libfn`**:
  - `libfn 0` = `dlopen(path, RTLD_NOW=2)`
  - `libfn 1` = `dlsym(RTLD_DEFAULT=18446744073709551614, name)`
  - Pass a 128-byte register buffer `rg` (`x0..x7` at offsets `0..56`, `d0..d3` floats at offsets `64..95` via `bitcast ulong f64val`).
- **`libcall` returns `long`**: Always cast `ulong libcall ...` when returning or storing into a `ulong` (omitting the cast triggers `error 7`).
- **No Linux `x18` entry stack (`argcnt`/`argread`)**: Use `dlsym("getenv")` (e.g. `FLEET_MAC_CHECK=1`) for headless check modes and configuration instead of `argcnt`/`argread`.
- **No `\r` in `text "..."` literals** (`error 22`): Only `\n \t \\ \"` are valid escapes. Emit HTTP CRLFs explicitly with `uchar 13` and `uchar 10`.
- **Darwin `sockaddr_in` layout (16 bytes)**: byte 0 = `sin_len` (`16`), byte 1 = `AF_INET` (`2`), bytes 2..3 = big-endian port, bytes 4..7 = IPv4 octets.
- **Statement vs value**: Functions called as bare statements must return `void`; keep live locals well under 16 registers (`error 12`).

## 3. Verification
Include a headless `getenv` check mode (e.g., `MY_CHECK=1 ./bin/prog`) that verifies `dlopen` of `AppKit`/`Foundation`, `objc_getClass` resolution, guardrails, and `popen`, printing a clear `PASS` line and exiting `0`.
