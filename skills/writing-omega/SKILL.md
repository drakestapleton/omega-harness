---
name: writing-omega
description: Portable guide to writing Omega (.om) programs that the seeded omc compiler accepts and runs correctly: program shape, types, words, traps, compiler errors 1..30, common mistakes with the exact refusal, and tested examples. Use before writing or reviewing any .om program on any machine.
---

# Writing Omega programs

This guide is for any agent or person writing `.om` on any machine. It needs only a clone of
omega-mv (`git clone https://interplane.io/projects/omega-mv/repo.git`; browse it at
https://interplane.io/drakestapleton/omega-mv) and of this repository. The worked
examples are rerun by [`examples/gate.sh`](../../examples/gate.sh), which accepts only the pinned
compiler below. For compiler internals, register rules, wire formats and the reasons behind each rule,
read [`skills/omega-encoding/SKILL.md`](../omega-encoding/SKILL.md).

<!-- gen:pin -->
| Pin (`PIN`) | Value |
|---|---|
| omega-mv commit | `6c562dd1f7ab01fd9a2638e74a7330ec4c941ad8` |
| `seed/out/omc` sha256 | `34d611ca0415eab1728d3234911d90e74af17ba9ab0c581d559f48274d7ca6d3` |
| reference data | `data/reference.tsv`: omega-mcp's `data/reference.json` for this pin, with 201 keyword-table entries (80 host words), 30 compiler error codes, 14 traps and 13 topics |
<!-- /gen:pin -->

The pin is written once, in this repository's `PIN` file. The table above, the word, trap and error
tables and the example counts are generated from `PIN`, its reference data and this repository
(`omega-harness` section 6); do not edit them by hand. The language reference is
`docs/one_layer/OMEGESE.md` in omega-mv and it is normative. Rules that no example in `examples/`
exercises were recorded at omega-mv `f4df8239` (omc `3ad9f10f…`, 2026-11-05) or later and carry the date
they were checked; the examples are rerun at the pin. Where this guide and OMEGESE disagree, the compiler
at the pin decides; this guide records the known disagreements. `execenv` needs the pinned compiler
(the older `3ad9f10f…` refuses it); its contract is `seed/host/execenv/README.md` in omega-mv. Host:
Linux AArch64 only; omc writes a static AArch64 Linux ELF.

The omega MCP server your agent runs may not be on the pinned compiler. Before trusting an MCP result,
run a trivial `compile` and compare its `compiler_sha256` with the `omc-sha256` line of `PIN`; when they
differ, that server's compiler sets the limits, not this guide. New first-party code is compiled with the
pinned omc of the repository that owns it (Drake's pure-Omega directive, 2026-11-07).

Two older compilers that omega MCP servers have run, observed on 2026-11-11: with omc `2c824805…`
(omega-mv `e5b32567`) a 9-byte name is error 13 (8 bytes is the limit), `for ... bound` is error 5,
`bound 1000000` is error 8 (999999 compiles), and in an `om2` unit `out` is a reserved word
(`out = ulong 1` is error 16). The two accept different loop bounds:

| Program | omc `2c824805` (e5b32567) | omc `3ad9f10f` (f4df8239) |
|---|---|---|
| `while C bound 999999` | compiles | compiles |
| `while C bound 1000000`, `2000000`, `9223372036854775807` | error 8 | compiles |
| `while C bound 0` | error 8 | error 8 |
| `for i ulong 3 bound 10` (any `for ... bound`) | error 5 | compiles |
| `while` with no bound, 1000001 passes | trap 4 (exit 104) | trap 4 (exit 104) |

Same on both: a global array of 16777216 elements compiles and 16777217 is error 23; a `for` count of
another type needs a cast (`for i ulong e` with `e = int 4` is error 7, `for i ulong ulong e` runs).
At `e5b32567`, write `while C bound N` with N at most 999999 and no `for ... bound`.

## 1. Compile and run

```sh
git clone https://interplane.io/projects/omega-mv/repo.git omega-mv && cd omega-mv
git checkout "$(sed -n 's/^omega-mv //p' path/to/omega-harness/PIN)"
sha256sum seed/out/omc      # must equal the omc-sha256 line of PIN; any other omc is refused by the gate
sh seed/omega-from-seed.sh  # optional: rebuild omc from the 408-byte loader
seed/out/omc < prog.om > prog; echo "compile $?"
chmod +x prog && ./prog; echo "exit $?"
```

- omc reads the unit on stdin and writes the executable on stdout. Exit 0 means accepted. Any other
  exit is the error number, and stderr has the line `omc: line N: error K`. That is the default
  form; section 11 has the additions (an `omc-use` record after some error 14 refusals, a `check`
  report whose failed write exits 2 with no line, and the longer lines under `OMC_DIAGNOSTICS=2`).
- **Never run the output of a refused compile**: stdout may still hold bytes.
- A unit with `fn main` is program mode (an executable). A unit without it is function mode (raw
  machine words for a host to call); never execute function-mode output directly.
- Check behavior, not compile success: compare stdout bytes and the exit status with what you
  expected, and run one deliberately wrong variant to see the check fail.
- To check a whole set the way this repository does:
  `examples/gate.sh path/to/seed/out/omc` prints `PASS name` or `FAIL name: reason` per program and
  ends `GATE PASS examples=N ...` or `GATE FAIL ...` (exit 1); a different compiler hash exits 2.

## 2. Program shape

```
note hello: the smallest complete program
text msg "hello, world\n"
fn main to int
k = write 1 msg 0 len msg
if ne k long len msg
ret 1
end
ret 0
end
```

([`examples/hello.om`](../../examples/hello.om)). The rules it shows:

- **One statement per line.** No semicolons, no braces. Blocks (`fn`, `if`, `else`, `while`, `for`,
  `struct`) close with `end`. Indentation is optional.
- **Prefix words only.** Every operation is a word followed by its values: `add x 1`,
  `mul add a b c`, `lt i n`. Each word has a fixed number of values. Parentheses may group a value
  and add nothing: `(add a b)`.
- **Comments are `note` lines.** `//` and `#` are refused (error 16).
- **`fn NAME p1 T1 p2 T2 ... to R`**, result `R` a type or `void`. Parameters fill **6 slots**: an
  OM-2 unsized `view T *` / `edit T *` takes 2 (pointer and count), every other parameter 1 (a
  scalar, a sized array, a struct). Two unsized views plus three scalars is error 9
  ([`examples/om2_param_slots.om`](../../examples/om2_param_slots.om),
  `mistake_om2_param_slots.om`). `fn main to int` takes no parameters and its `ret` value is the exit
  status (0..255).
- **Assignment is `name = value`.** The first assignment creates the name with the value's type. The
  `=` is optional, which is a trap: `return x` is accepted as "assign x to a new name `return`".
- A function may call a function defined later in the unit, and program-mode functions may recurse.
- Top-level lines are `note`, `fn`, `text`, `global`, `const`, `struct`, and in OM-2 units
  `layout`, `abstract`, `holds` and `export fn`. `struct` and `layout` lines come before the first
  `fn`: a `struct` after it is error 9, a `layout` after it is error 29. A `const` is visible only
  after its line.

Every declaration and statement form at the pin (OMEGESE sections 9 to 12 are the full rules):

| Form | Where | Notes |
|---|---|---|
| `note ANY TEXT` | any line | a comment line |
| `om2`, `om2 debug`, `om2 release`, `om2 diag`, `om2 diag debug`, `om2 diag release` | first line that is not blank or `note` | opts the unit into OM-2 (section 9); `release` erases contract checks, `diag` adds a machine-readable stderr record |
| `om2 fmt` | the first line, at byte 0 | prints the canonical text of the rest of the input instead of compiling it |
| `text NAME "bytes"` | top level | a read-only `uchar` array |
| `global NAME T N` | top level, program mode | zero-filled array, never an argument |
| `const NAME T LITERAL` | top level | an integer or float value, visible after its line |
| `struct S f1 T1 f2 T2 ... end` | top level, before the first `fn` | one line; a field `f T N` is an array of 1..64 |
| `layout NAME SIZE`, `field F T [COUNT] at OFF little`/`big` lines, `end` | OM-2, top level, before the first `fn` | an external byte layout of SIZE 1..4096 bytes |
| `abstract NAME T [ops W ...]`, `holds NAME dup32` | OM-2, top level, before the first `fn` | T `uint` or `ulong`; W from `rotr rotl and or xor` |
| `fn NAME p1 T1 ... to R` ... `end` | top level | `inline` after R in OM-2; `export fn` marks an OM-2 function-mode entry |
| parameter `p T` | `fn` line | a scalar |
| parameter `a view T N` / `a edit T N` | `fn` line | a sized array, read-only or writable |
| parameter `a view T *` / `a edit T *` | `fn` line, OM-2 | an array of any length |
| parameter `s edit T N fresh` | `fn` line, OM-2 | scratch: every element written before it is read |
| parameter `p view S` / `p edit S` | `fn` line | a struct, or an OM-2 layout |
| parameter `o out T N` | `fn` line, OM-2 | written by the unit; the calling host copies it out after status 0 |
| `name = value` | function body | the first assignment creates the name |
| `put A i v`, `put p f v` | function body | store into an array element or a field |
| `f v1 v2 ...` | function body | a call to a `void` function |
| `if C` ... `else` ... `end` | function body | `else` is optional; no `else if` |
| `while C bound N` ... `end` | function body | N 1..9223372036854775807 (IR mode 1..1000000); at `e5b32567` N 1..999999 |
| `for i T K` ... `end` | function body | `unroll` after K in OM-2, K 1..64 |
| `break`, `continue` | inside a loop | |
| `ret`, `ret v` | function body | `ret v` in a function with a result |
| `exit N`, `trap N` | function body | exit status N; trap N 1..14 exits 100+N |
| `requires C`, `ensures C` | OM-2, the first lines of a function | `result` names the returned value |
| `invariant C` | OM-2, the first line of a loop body | |

## 3. Types and values

| Type | Meaning |
|---|---|
| `bool` | `true` / `false`, the result of comparisons |
| `uchar`, `ushort`, `uint`, `ulong` | unsigned 8, 16, 32, 64 bit (also spelled `u8 u16 u32 u64`) |
| `byte`, `short`, `int`, `long` | signed 8, 16, 32, 64 bit (also spelled `i8 i16 i32 i64`); `byte` is **signed**, and `char` is not a type (error 3) |
| `f32`, `f64` | IEEE binary32, binary64 |
| `void` | no result (function result only) |

- **No implicit conversion.** Both values of an operation have one type (error 7). Convert with the
  type word: `long x`, `uint b`, `f64 n`.
- **A bare number takes its type from context**: the other value of its operation, the parameter it
  is passed to, the result type at `ret`. With no context it is error 11: write `x = uint 5`, never
  `x = 5` for a new name.
- Integer literals are decimal with an optional leading `-`. A literal that does not fit its type
  is error 8. No character literals: write `uchar 65`, not `'A'` (error 3).
- Float literals need digits on both sides of the dot: `2.0f64`, `1.0e30f64`, `0.5f32`. The suffix is
  optional where context gives the type.
- **Hex only in OM-2** (section 9): lowercase `0x` and lowercase digits, value must fit
  (`int 0xffffffff` is error 8; write `int -1`).
- `sizeof T`, `sizeof S` and `offsetof S f` are compile-time `ulong` constants.

## 4. Words

<!-- gen:words -->
The keyword table at the pin has 201 entries; the 80 host words are in the host-word table. The rest, by kind:

| Kind | Words |
|---|---|
| device | `devctl fd request A off n`, `mapnew fd offset bytes access mode`, `mapdrop handle`, `mapread handle offset A off n`, `mapwrite handle offset A off n`, `devcall fd request H hoff 32 P poff n`, `uvmctl fd command A off n`, `mapaddr handle`, `mapget handle offset width`, `mapset handle offset width value`, `maphold address bytes`, `vfioctl fd request A off n`, `vfiomap fd A off 32`, `vfiomapw fd A off 32`, `eventfd initial`, `vfioirq fd request A off n`, `mapbind handle fd offset access`, `cpufence`, `cpurelax`, `kfdres n`, `kfdmap fd offset n`, `kfdctl fd request H off n [SUFFIX]` |
| type | `bool VALUE  (conversion) \| NAME bool  (parameter) \| to bool  (result)`, `uchar VALUE  (conversion) \| NAME uchar  (parameter) \| to uchar  (result)`, `u8 VALUE  (conversion) \| NAME u8  (parameter) \| to u8  (result)`, `ushort VALUE  (conversion) \| NAME ushort  (parameter) \| to ushort  (result)`, `u16 VALUE  (conversion) \| NAME u16  (parameter) \| to u16  (result)`, `uint VALUE  (conversion) \| NAME uint  (parameter) \| to uint  (result)`, `u32 VALUE  (conversion) \| NAME u32  (parameter) \| to u32  (result)`, `ulong VALUE  (conversion) \| NAME ulong  (parameter) \| to ulong  (result)`, `u64 VALUE  (conversion) \| NAME u64  (parameter) \| to u64  (result)`, `byte VALUE  (conversion) \| NAME byte  (parameter) \| to byte  (result)`, `i8 VALUE  (conversion) \| NAME i8  (parameter) \| to i8  (result)`, `short VALUE  (conversion) \| NAME short  (parameter) \| to short  (result)`, `i16 VALUE  (conversion) \| NAME i16  (parameter) \| to i16  (result)`, `int VALUE  (conversion) \| NAME int  (parameter) \| to int  (result)`, `i32 VALUE  (conversion) \| NAME i32  (parameter) \| to i32  (result)`, `long VALUE  (conversion) \| NAME long  (parameter) \| to long  (result)`, `i64 VALUE  (conversion) \| NAME i64  (parameter) \| to i64  (result)`, `qty VALUE  (conversion) \| NAME qty  (parameter) \| to qty  (result)` |
| operator | `add A B`, `sub A B`, `mul A B`, `div A B`, `rem A B`, `and A B`, `or A B`, `xor A B`, `shl A B`, `shr A B`, `eq A B`, `ne A B`, `lt A B`, `le A B`, `gt A B`, `ge A B`, `neg A`, `not A` |
| data | `get A i \| get P field [i]`, `len A`, `read fd A off n`, `write fd A off n`, `true`, `false`, `NAME view T N \| NAME view T *  (parameter) \| view A  (argument)`, `NAME edit T N \| NAME edit T *  (parameter) \| edit A  (argument)` |
| structure | `fn NAME (PARAM TYPE)* to TYPE\|void [inline]`, `fn ... to TYPE\|void`, `end`, `if COND / [else] / end`, `else`, `while COND [bound N] / end`, `while COND bound N \| for NAME TYPE COUNT bound N`, `for NAME TYPE COUNT [bound N] / end`, `ret [VALUE]`, `NAME = VALUE`, `( VALUE )`, `( VALUE )`, `fn ... to void` |
| statement | `global NAME T N \| global NAME T *`, `r = enlarge NAME n`, `text NAME "bytes"`, `put A i v \| put P field [i] v`, `free  (refused)`, `own  (refused)`, `exit v`, `note ...`, `NAME = new T N v \| NAME = new STRUCT v1 .. vn`, `break`, `trap N`, `continue`, `const NAME TYPE LITERAL` |
| struct | `struct Name field type [len] ... end`, `sizeof T \| sizeof STRUCT`, `offsetof STRUCT field` |
| float | `f32 VALUE \| 1.5f32`, `f64 VALUE \| 1.5f64`, `bitcast T VALUE`, `fsqrt X`, `fabs X`, `fmin A B`, `fmax A B`, `fma A B C` |
| OM-2 | `rotr X N`, `rotl X N`, `for i T K unroll`, `fn NAME ... to T inline`, `NAME edit T N fresh`, `abstract NAME T [ops W ...]`, `seal NAME v`, `open v`, `holds NAME dup32`, `abstract NAME T ops W ...`, `layout NAME SIZE / field ... / end`, `field F T [COUNT] at OFF little\|big`, `field F T at OFF ...`, `field ... at OFF little`, `field ... at OFF big`, `part A o k`, `NAME out T N`, `export fn NAME ...` |
<!-- /gen:words -->

Bit words `rotr rotl` and hex literals are OM-2 only (section 9); the host words are in section 10.

- `fma a b c` rounds once; all three values have the same f32 or f64 type, else error 7. It is in the
  keyword table at the pin; the older omc `3ad9f10f…` (omega-mv `f4df8239`) refuses it with error 3,
  while `cfd96b48…`, `6d1b1cf5…` and `564c5835…` compile it.

- `and`, `or`, `xor` on integers of any width are bitwise, not logical: `and ulong 12 ulong 10` is 8
  ([`examples/int_bits_and.om`](../../examples/int_bits_and.om)). Compare first when you want a bool.
- `and` / `or` on bools evaluate **both** sides; there is no short circuit
  ([`examples/mistake_short_circuit.om`](../../examples/mistake_short_circuit.om) traps 3 on the
  index the C reader would expect to be skipped). Test the index in an outer `if`.
- Comparisons follow the type: on `ulong`, `lt x y` with x = 2^64-1 and y = 1 is false.
- `div` and `rem` on signed values round toward zero; `rem` takes the dividend's sign;
  `shr` on a signed value keeps the sign.
- A function with a result is a value, not a statement: write `v = f 1`, never a bare `f 1`
  (error 7). A `void` function is called as a statement.
- A call is the name then its values with no brackets or commas: `ret f 1 2`.

## 5. Traps: what stops a running program

A trap ends the process with exit status 100 + N. Output already written stays written.

<!-- gen:traps -->
| Trap | Name | Cause | Exit status | Examples in `examples/` |
|---|---|---|---|---|
| 1 | OVERFLOW | Signed add/sub/mul/neg/div/shl produced a value outside the type. | 101 | `trap1_divmin`, `trap1_overflow` |
| 2 | DIV0 | div or rem with a divisor of 0. | 102 | `trap2_div0` |
| 3 | BOUNDS | A run-time index is not below the length, or a host/read/write slice is outside its array. | 103 | `trap3_bounds` |
| 4 | LOOP_BOUND | A while or for ran past its bound N; with no bound a while, and a for whose count is not a number, stop at 1000000 passes. | 104 | `trap4_for_bound`, `trap4_loop` |
| 5 | CAST | A conversion `T v` got a value outside T. | 105 | `trap5_conv` |
| 6 | OOM | A call or local array would go below the fixed 8 MiB stack (deep recursion). | 106 | `trap6_stack` |
| 7 | SHIFT | A shift or rotate amount is outside 0..width-1. | 107 | `trap7_shift` |
| 8 | RUNTIME | A runtime invariant (double release, bad handle) failed; checked native code raises it only through `trap 8`. | 108 | none |
| 9 | REQUIRES | A requires clause was false on entry. | 109 | none |
| 10 | ENSURES | An ensures, invariant or holds check was false. | 110 | none |
| 11 | ARENA_FULL | An OSC arena allocation exceeded the arena's capacity; native program mode raises it only through `trap 11`. | 111 | none |
| 12 | STALE | A handle whose generation no longer matches its slot; native program mode raises it only through `trap 12`. | 112 | none |
| 13 | POOL_FULL | An OSC pool allocation found no free slot; native program mode raises it only through `trap 13`. | 113 | none |
| 14 | RETIRED | An OSC pool allocation found only retired slots; native program mode raises it only through `trap 14`. | 114 | none |
<!-- /gen:traps -->

- A failing OM-2 contract check traps 9 (`requires`, `contract_requires.om` exits 109) or 10
  (`ensures` or `invariant`, `contract_ensures.om` exits 110). `trap N` with N 1..14 exits 100+N
  (`trap_code.om`: `trap 14`, exit 114). The stack is 8 MiB.

- Unsigned arithmetic wraps modulo 2^width and never traps
  ([`examples/unsigned_wrap.om`](../../examples/unsigned_wrap.om)).
- Signed minimum `rem` -1 is 0 and does not trap; signed minimum `div` -1 traps 1 (overflow)
  ([`examples/trap1_divmin.om`](../../examples/trap1_divmin.om)).
- Integer conversions are checked: `uchar x` with x = 300 traps 5. Keep the low bits on purpose with
  a mask: `uchar and x 255`.
- Float to integer truncates toward zero and saturates at the type's limits; NaN gives 0; it never
  traps ([`examples/float_to_int.om`](../../examples/float_to_int.om)). No float operation traps:
  1/0 is infinity, 0/0 is NaN, and NaN compares false except with `ne`.
- `exit N` ends the process with status N directly, without the trap convention.

## 6. Loops and bounds

- `while COND bound N` runs the body at most N times, N 1..9223372036854775807 (error 8 outside;
  IR mode 1..1000000). Without `bound` the limit is 1000000. One more pass traps 4. Older compilers
  differ (top of this guide). Choose N from
  an argument you can write down in a `note`, for example "every pass consumes at least one byte of
  a 65536-byte input".
- `for i T K` runs i from 0 to K-1. A number K is unguarded. Any other K (a name or value) with no
  `bound` traps 4 (exit 104) after 1000000 passes, as a `while` with no bound. `for i T K bound N`
  takes the same N as `while`, caps every count and traps 4 when K exceeds N (`for_bound.om`,
  `trap4_for_bound.om`).
- `break` and `continue` work in both loops. There is no `else if`: nest an `if` inside `else`.
- A bound is a trap, not a clamp. When the pass count follows outside input (a request, a file, a
  database row), check the length before the loop or exit early below N; one long input otherwise
  stops the process with trap 4 (`mistake_bound_input.om` exits 104, `bound_input_guard.om` exits 0).
- An outer `for` starts another batch only after its inner `while` exits. For batches of three, reset `q = uint 0` on each outer pass, use `while and gt n 0 lt q 3 bound 3`, and increment `q` for each item consumed. With five items, omitting the counter traps on the first batch (exit 104).
- No loop runs forever and recursion is bounded by the stack.

## 7. Arrays, texts, globals, structs

- **Local array:** `a = new T N v`, N elements each v, only in a function's outermost block (error 9
  inside a block). N is a literal or an integer `const`; a variable N is error 16. There is no heap
  and no `free` (error 9).
- Declare each global before the first function that uses it. In a concatenated build, place its declaring unit first. Using a later global produces error 3.
- **Global array:** `global NAME T N` at top level, zero-filled, program mode only. **A global is
  never an argument** (error 19); a function uses it by naming it.
- **Text:** `text NAME "bytes"` is a read-only `uchar` array. Escapes are only `\n \t \\ \"`
  (error 22 for others).
- **Array parameters** state type and exact length: `a view uchar 64` (read-only) or
  `a edit uchar 64` (writable). Another length is error 7. In OM-2, `a view T *` / `a edit T *` take
  any length. Writing to a view or text is error 20.
- `get A i` / `put A i v`: a literal index outside the array is error 21; every other index is checked
  at run time (trap 3). There are no pointers and no address arithmetic.
- **Structs:** `struct Pair a uint b long end`, before the first `fn`. Every field is an 8-byte cell,
  so a struct is never a wire or file layout. `p = new Pair 5 -12`, pass as `p edit Pair` or
  `p view Pair` ([`examples/structs.om`](../../examples/structs.om)).
- **Bytes on the wire:** build them with shifts and masks into a `uchar` array
  ([`examples/wire_le.om`](../../examples/wire_le.om)); OM-2 also has `layout`.

## 8. Names and limits

- Variable, parameter, global, text, const, struct and field names: at most 63 bytes (error 13; since omc
  `564c5835`, omega-mv main `12bdb787`). IR-mode names, `abstract`/`layout` names and layout fields stay at 8.
  Function names: at most 63, but see section 13 for names that start with an 8-letter keyword.
  Rechecked 2026-11-11 with omc `f4fa7951…` (omega-mv main `b2ad967e`, Linux AArch64): a 63-byte variable
  compiles and runs (exit 0) and a 64-byte one is `omc: line 2: error 13`; a 63-byte function compiles and
  returns 7 and a 64-byte one is `omc: line 1: error 13`; an IR-mode local or parameter, an `abstract` name,
  a `layout` name and a layout field each compile at 8 bytes and are error 13 at 9.
- A new name may not repeat a visible name, a function or a struct (error 10). A name first assigned
  inside a block ends at that block's `end`; assign it before the block to keep it.
- Reserved words cannot be names, including `len read write text new free view edit global note
  exit const bound` and every host word (`stat`, `link`, `send`, `random`, `fork`, ...). `len` as a
  name is error 16, `free` is error 9.
- 16 registers per function hold parameters, live names, loop counters and the temporaries of the
  current statement. The 17th is error 12 (`examples/err12_registers.om`). The fix is structural:
  move part of the work into a helper function that takes a few scalars and returns one value, end
  the life of names you no longer need by computing them inside a block, and split a long nested
  expression into several assignments of one or two words each.
- Size limits: an array up to 16777216 elements, 4 MiB of local arrays per function, 1 GiB of
  globals (error 23).
- Capacity (error 14): the tables that grow with the unit (input, output, names, functions, call
  sites, trap sites, blocks) have no fixed capacity of their own; they live in one arena. The fixed
  tables OMEGESE 9.6 lists remain, each error 14 past its number (observed at `2ee0a70d`: an `ir`
  unit of 32 functions compiles and one of 33 is error 14; the same 33 functions without `ir`
  compile). At
  omega-mv `3537baad` that arena was 16777216 8-byte words (128 MiB); since the run-time pools
  (observed at `2ee0a70d`) it has no size of its own and grows while the host gives it memory. A unit
  is error 14 when the host refuses that growth or the caller's ceiling `OMC_MEMORY_MAX` is reached,
  followed on stderr by an `omc-use` record that says what held the arena. Values
  nest at most 32768 deep, and AArch64 output stops at 134217728 bytes, the reach of B and BL
  (OMEGESE 9.6 at omega-mv `3537baad`, 2026-11-11). Checked 2026-11-11 with omc `c52e986e…`: 10000
  `text` lines, 20000 calls in one `main` and, in an `om2` unit, 7000 calls passing an unsized
  `view uchar *` each compile and run (exit 0); omc `f4fa7951…` refuses the same three units with
  error 14 (`omc: line 8193`, `8196` and `5962`). `export fn` (32) and the per-construct limits of
  section 9 remain.
- The fixed capacities of the previous pin, omc `f4fa7951…` (omega-mv `b2ad967e`), bisected
  2026-11-11 and kept as history: an 8192-entry name table shared by `text` records and globals
  (`omc: line 8193: error 14`), an 8192-entry trap-site list per function (each call takes one
  entry), and a 262144-byte emitted-code budget per `om2` function (6552 calls passing one unsized
  view compiled, 6553 did not). A server or toolchain still on that omc keeps those limits: split long
  call lists or generated `main` bodies across helper functions there.

ng is a separate compiler: its 2026-11-11 no-caps arena change (omega-mv `229f77bc`) removes its old fixed table capacities; it does not change omc's language or this guide's pin. For ng's shared-arena costs, stack-derived nesting bound, reader verdicts and complete gate set, see `omega-harness` section 3, "ng arena and no-caps gate".

## 9. OM-2 units

A unit whose first line that is not blank or `note` is exactly `om2` is an OM-2 unit. OM-1 code keeps
its meaning inside it. OM-2 adds:

- lowercase hex literals; `rotr x n`, `rotl x n` on unsigned types (trap 7 for an amount outside
  0..width-1);
- unsized parameters `a view T *` / `a edit T *` with `len a` the run-time count;
- `part A off n`, only as an argument to an unsized parameter: the n elements of A from off,
  checked at run time (trap 3). A part of a global is error 19; as a value of its own it is error 9;
  to a sized parameter it is error 7;
- `for i T K unroll`, `fn ... inline`, `layout` (external byte layouts), `fresh` scratch arrays
  (error 27), `abstract` types with `seal` / `open` (error 28), `export fn` (at most 32, error 14);
- executable contracts: `requires` and `ensures` lines at the start of a function, `invariant` as the
  first line of a loop body. A failing `requires` traps 9 (exit 109), a failing `ensures` or
  `invariant` traps 10 (exit 110). A clause may not call a function, use floats or host words
  (error 30). The first line `om2 release` erases the checks
  ([`examples/contract_release.om`](../../examples/contract_release.om)).

Examples: [`om2_tour.om`](../../examples/om2_tour.om), [`om2_views.om`](../../examples/om2_views.om),
[`om2_hex_rotr.om`](../../examples/om2_hex_rotr.om), [`contracts_ok.om`](../../examples/contracts_ok.om).

## 10. Host I/O

- Every host word returns a `long`: a count, or minus the Linux errno. `read` may return fewer bytes
  than asked, 0 at end of input, or a negative error; `write` may write fewer. Loop until done and
  handle `k < 0` and `k == 0` separately
  ([`examples/stdin_count.om`](../../examples/stdin_count.om)).
- Descriptors, flags and modes are `int`; offsets, counts and capacities `ulong`; buffers `uchar`
  arrays. Slices are checked before the kernel call (trap 3).
- `main` takes no parameters: read arguments with `argcnt` and `argread`
  ([`examples/echo_args.om`](../../examples/echo_args.om)) and the environment with `envcnt` and
  `envread` ([`examples/env_read.om`](../../examples/env_read.om)). Short capacity returns -105.
- Host words carry the process's own permissions; they are not a sandbox.

OMEGESE section 10 has each contract.
`A` and `B` are `uchar` arrays, `off`, `n` and `capacity` are `ulong`, and descriptors, flags, modes
and ids are `int`. A path is the slice `A off n`; a packed list is a `u16` count, then `u16`-length
records. A reserved word used as a name inside `fn main` is error 16. An unreserved name in the same
program compiles.

<!-- gen:hostwords -->
The keyword table at the pin has 80 host words, each shown with its values:

| Kind | Words |
|---|---|
| host-file | `fopen A off n flags mode`, `fclose fd`, `fsync fd`, `fdsync fd`, `memfd A off n flags`, `fchmod fd mode`, `chmod A off n mode`, `faccess A off n mode`, `syncfs fd`, `flock fd op`, `umask mask`, `fseek fd offset whence`, `ftrunc fd length`, `truncate A off n length`, `unlink A off n`, `fstat fd A off n`, `stat A off n B off capacity`, `lstat A off n B off capacity`, `pread fd A off n pos`, `pwrite fd A off n pos` |
| host-dir | `chown A off n uid gid`, `fchdir fd`, `makedir A off n mode`, `rmdir A off n`, `cwd A off capacity`, `chdir A off n`, `readlnk PATH off n OUT off capacity`, `getdnts fd A off n`, `renames A off n flags`, `link A off n`, `symlnk A off n` |
| host-process | `getuid`, `geteuid`, `getgid`, `getegid`, `getppid`, `setsid`, `getpgid pid`, `getsid pid`, `setpgid pid pgid`, `fork`, `getpid`, `killpid pid signal`, `waitpid pid A off n options`, `pipefds A off n flags`, `dupfd fd target flags`, `execprog A off n`, `argcnt`, `argread index A off capacity`, `envcnt`, `envread index A off capacity`, `execenv A off n B off m`, `prlimit pid res A off n`, `cpuset pid A off n`, `cpuget pid A off n`, `cpunow`, `setprio which who priority`, `getprio which who`, `execpure A off n` |
| host-net | `shutdown fd how`, `socknew domain kind protocol`, `bind fd A off n`, `connect fd A off n`, `listen fd backlog`, `accept fd flags`, `sockname fd A off n`, `sockopt fd level option A off n`, `recv fd A off n flags`, `send fd A off n flags`, `waitio fd events interval`, `peercred fd A off capacity`, `pollfds A off n interval`, `sendmsg fd A off n flags`, `peername fd A off n` |
| host-time | `monons`, `realns`, `sleepns interval`, `random A off n flags` |
| host-cpu | `dit v`, `scrub n` |
<!-- /gen:hostwords -->

`execenv` is in compilers from omega-mv#1074 on (omc `cfd96b48…` and later); a call is error 3 at
omega-mv `f4df8239` (omc `3ad9f10f…`), where `execenv` is not reserved: inside `fn main`,
`execenv = int 1` compiles there and is error 16 on `cfd96b48…`, `0f2de851…`, `6d1b1cf5…`,
`564c5835…` and at the pin.

## 11. Compiler errors

Exit status = error number. Under the default diagnostics (no `OMC_DIAGNOSTICS` in the environment)
the message is the stderr line `omc: line N: error K`, where N
is the line being read (0 when no line was read). Observed 2026-11-13 at omega-mv `2ee0a70d`: an error 14 is
followed by an `omc-use` record when the arena was refused, and also on the nesting refusal when the
unit's first line is `usage`; a failed write of the `check` report ends with exit 2 and no stderr
line under the default diagnostics, and with `OMC_DIAGNOSTICS=2` it prints
`omc: line N: error 2:` followed by the meaning and an `omc-diag 2` line. One refusal per code is in `examples/errNN_*.om`
with its exact stderr line in the matching `.expect`, except 24, which needs a generated program.

<!-- gen:errors -->
| Code | Meaning | Fix | Example in `examples/` |
|---|---|---|---|
| 1 | stdin read failed | Give omc a readable source file on stdin. | `err01_input` |
| 2 | stdout write failed | Write omc's stdout to a regular file with space. | `err02_output` |
| 3 | unknown name or field | Declare the name first, or fix its spelling. | `err03_unknown_name` |
| 4 | line ends early | Supply the missing operand (see the word's form). | `err04_line_ends` |
| 5 | extra words | Remove the extra words or split the line. | `err05_extra_words` |
| 6 | malformed number | Write a plain decimal (or OM-2 lowercase 0x hex) number. | `err06_bad_number` |
| 7 | type mismatch | Convert explicitly with a type word, e.g. `add int a int b`. | `err07_type_mismatch` |
| 8 | out of range | Use a value inside the type's range or a wider type. | `err08_out_of_range` |
| 9 | word not allowed here | Move the statement to a valid position or use the documented alternative. | `err09_disallowed` |
| 10 | duplicate name | Choose a new name. | `err10_duplicate` |
| 11 | ambiguous bare number | Prefix it with a type word, e.g. `x = int 5`. | `err11_ambiguous` |
| 12 | register pool exhausted | Split the function or reuse names so fewer values are live. | `err12_registers` |
| 13 | name too long | Shorten the name: at most 63 characters, 8 for abstract, layout and layout-field names and in IR mode. | `err13_long_name` |
| 14 | capacity exceeded | Bring the construct under the bound OMEGESE 9.6 names, split the unit, or give the compiler more memory. A unit whose first line is `usage` compiles as usual and prints its `omc-use` record (what each arena group holds) instead of the binary. | `err14_capacity` |
| 15 | missing end | Add the missing `end`. | `err15_missing_end` |
| 16 | syntax error or unknown word | Check the word's spelling and form with lookup. | `err16_syntax` |
| 17 | line after a path end | Delete the unreachable line or move it before the path end. | `err17_after_path` |
| 18 | missing ret | Add a ret on every path (or make the function void). | `err18_missing_ret` |
| 19 | global passed or same array twice | Copy the global into a local array (new) or pass distinct arrays. | `err19_global_arg` |
| 20 | write to a read-only array | Write into a local, global or edit array instead. | `err20_pread_text`, `err20_readonly` |
| 21 | constant index out of range | Use an index below the length. | `err21_const_index` |
| 22 | bad text literal | Use only \n \t \\ \" escapes and close the quote. | `err22_text_escape` |
| 23 | size capacity | Use a smaller array. | `err23_size` |
| 24 | branch displacement out of range | Split very large functions or programs; this is reached only by programs with about 1 MiB of code between a conditional branch and its target. | none |
| 25 | not available on this target | Use the default AArch64 target for that construct, or write it with words the target supports. | `err25_target` |
| 26 | bad memory ceiling | Unset OMC_MEMORY_MAX, or set it to the ceiling in decimal bytes (0 or empty: none). | none |
| 27 | fresh element read before write (OM-2 init) | Write every element before reading it (put with a number index). | `err27_fresh` |
| 28 | abstract constructor violation (OM-2 ctor) | Seal only inside the function named NAME followed by mk. | `err28_seal` |
| 29 | layout violation (OM-2 layout) | Put every layout above the first fn, keep SIZE and COUNT in 1..4096 (leave COUNT out for one element), and keep every field inside SIZE and apart from the others. | `err29_layout` |
| 30 | contract syntax (OM-2) | Put contracts first in the function or loop body and use only pure integer/bool operations. | `err30_contract` |
<!-- /gen:errors -->

- 1 and 2: `err01_input` gives omc a directory on stdin; `err02_output` sends stdout to `/dev/full`.
- 25: `target x86linux` and `target x86efi` units with `fn main` compile. Under `target x86efi`
  (omega-mv#1015) a bare unit (no `fn main`), a Linux host word or an `efi` OP literal outside 0..13
  is error 25 (0..14 with omega-mv#1022); a non-literal OP is error 16, and `efi` under
  `target x86linux` is error 3. See `omega-encoding`.
  `target a64efi` (an AArch64 program a firmware starts with no operating system) refuses the same
  things with error 25, and a run-time pool too. It has no Linux words at all, `read` and `write`
  included. Its details, `efirt.om` and the five firmware words are in `omega-encoding`.
- 29 also covers a `layout` line after the first `fn`, a SIZE or field COUNT outside 1..4096 (a
  written 0 included), a field that starts or ends past SIZE, and two fields sharing a byte; a SIZE,
  COUNT or OFF written as 2^64 or more is error 8 instead (`mistake_om2_layout_late`,
  `mistake_om2_layout_zero_count`).
- 26 is a malformed `OMC_MEMORY_MAX` in the compiler's environment, and 24 needs a generated
  program (both below).

How the emitted set was established: in `seed/omc/omc.om`, `fn fail` writes the stderr line and
exits with the code (`exit int code`). The other exits are
`exit int 0` and `exit 0`, and one `exit int 2` in `fn mflush` (a failed write of buffered output,
which under the default diagnostics prints no stderr line; present at `91c83438` too); every other refusal goes through `fail`. At omega-mv `91c83438` its callers
passed the literals 1..25 and 27..30, or forwarded a literal 3, 4, 6, 8, 13 or 16 through `lenval`,
`nfail` and `unkfail`, and no caller passed 26. Observed 2026-11-13 at `2ee0a70d`: `fail 1` to `fail 30` all
occur (26 five times, for a malformed `OMC_MEMORY_MAX`, which the registry
`seed/omc/error-codes.reg` lists as io). Code 25 comes from the target checks (`fail 25` in `fn emit` and six other
sites). A trap inside omc itself would exit
100 + N, which is not an error code.

Error 24 needs more than 1 MiB of code inside one loop. This program, with 270000 copies of the
line `x = add x 1` (4 bytes of code each), was refused with `omc: line 270006: error 24`, the line
of the loop's `end`; with 140000 copies it compiled:

```sh
{ printf 'fn main to int\nx = ulong 0\nc = true\nwhile c bound 1\n'
  yes 'x = add x 1' | head -n 270000
  printf 'c = false\nend\nret int and x 1\nend\n'; } > e24.om
seed/out/omc < e24.om > e24; echo "compile $?"   # compile 24
```

## 12. Common mistakes

Each row is a program in `examples/` with its observed refusal.

| Mistake | Write instead | Refusal | Example |
|---|---|---|---|
| `y = x + 1` | `y = add x 1` | error 5 | `mistake_infix.om` |
| `f(1, 2)` | `f 1 2` | error 6 | `mistake_c_call.om` |
| `if x > 0` | `if gt x 0` | error 7 | `mistake_compare_operator.om` |
| `'A'` | `uchar 65` | error 3 | `mistake_char_literal.om` |
| `// comment` | `note comment` | error 16 | `mistake_slash_comment.om` |
| `x = 1;` | `x = uint 1` | error 6 | `mistake_semicolon.om` |
| `return x` | `ret x` | error 18 (silent assignment) | `mistake_return.om` |
| `else if c` | `else`, then a nested `if c` | error 5 | `mistake_else_if.om` |
| `fn main argc int to int` | `argcnt`, `argread` | error 9 | `mistake_main_args.om` |
| `while c bound 9223372036854775808` (or `bound 0`; at `e5b32567` also `bound 1000000`) | a bound 1..9223372036854775807 (1..999999 at `e5b32567`) | error 8 | `mistake_bound_range.om` |
| `ir` unit with `while c bound 1000001` | an IR bound 1..1000000 | error 8 | `mistake_ir_bound.om` |
| a scan `while lt q e bound 70` where `e` comes from outside input (111 letters) | a length check before the loop, or an early exit below the bound (`if gt q 64` / `ret 0`) | trap 4, exit 104 (a run, not a compile refusal) | `mistake_bound_input.om`, `bound_input_guard.om` |
| `a = new uchar n 0` | a literal or `const` length | error 16 | `mistake_new_var_len.om` |
| `free a` | nothing: no heap | error 9 | `mistake_free.om` |
| `len = ...` | another name | error 16 | `mistake_reserved_name.om` |
| `neg = ...` or `text neg "a"` | another name: `neg` is the negation word | error 16 | `mistake_neg_name.om` |
| `fresh = ...` in an `om2` unit (also `out`, `seal`, `open`) | another name; these four are reserved only in OM-2 mode, so a small test without `om2` compiles and hides it. `view` and `edit` are error 16 in both modes. `layout` is not error 16 at all: plain mode compiles it, and in OM-2 mode a line that starts with `layout` is read as a layout declaration, which inside a function sits after the first `fn` and so is error 29 | error 16 | `mistake_om2_word_name.om`, `mistake_om2_word_out.om`, `mistake_om2_word_seal.om`, `mistake_om2_word_open.om`, `mistake_word_view.om`, `mistake_word_edit.om`, `mistake_om2_word_layout.om`, `om2_word_plain.om`, `layout_word_plain.om` |
| `layout NAME SIZE` block written below `main` or another `fn` | move the block above the first `fn` (a `struct` there is error 9 instead) | error 29 on the `layout` line | `mistake_om2_layout_late.om` |
| `field tag uchar 0 at 0 little` (COUNT 0) | leave COUNT out for one element, or give 1..4096 | error 29 on the `field` line | `mistake_om2_layout_zero_count.om` |
| a bare call `f 1` with a result | `v = f 1` | error 7 | `mistake_value_stmt.om` |
| a 7th parameter | a struct or an array | error 9 | `mistake_seven_params.om` |
| 2 `view T *` plus 3 scalars (7 slots) | a sized view, a struct, or fewer scalars | error 9 | `mistake_om2_param_slots.om` |
| `emit buf` with `buf` a global | name the global inside the function | error 19 | `err19_global_arg.om` |
| `a view uchar 8` given a 16-element array | the exact length, or OM-2 `view uchar *` | error 7 | `mistake_param_length.om` |
| `trap 15` | `trap 1` .. `trap 14` | error 8 | `mistake_trap_range.om` |
| `struct` after a `fn` | every `struct` before the first `fn` | error 9 | `mistake_struct_after_fn.om` |
| `rotr` or hex without `om2` | an `om2` first line | error 3 | `mistake_om1_rotr.om` |
| `0X10` or `0xFF` | `0x10`, `0xff` | error 6 | `mistake_om2_upper_hex.om` |
| `int 0xffffffff` | `int -1` | error 8 | `mistake_om2_int_hex.om` |
| `part` of a global | `part` of a local | error 19 | `mistake_om2_part_global.om` |
| `part` to a sized parameter | an unsized `view T *` parameter | error 7 | `mistake_om2_part_sized.om` |
| `s = part a 0 2` | `part` only as an argument | error 9 | `mistake_om2_part_statement.om` |
| `if and lt i n eq get a i 0` (C short circuit) | an outer `if lt i n` | trap 3, exit 103 | `mistake_short_circuit.om` |

## 13. Known compiler defects at the pin

- **`bitcast` across signedness below 64 bits:** rechecked 2026-11-11 with omc `f4fa7951…` and again
  with omc `c52e986e…` (exit 7 both times, from one program testing all three): `uint 4294967295` to `int` compares
  equal to -1 and adding 2 returns 1, and `int -1` to `uint` compares equal to 4294967295. Those
  two cases were wrong at omc `2c824805` (not equal; adding 2 trapped 1). `ushort`/`short`,
  `uchar`/`byte` and `f32` to `int` were not retested on 2026-10-29. Do not assume they are fixed.
  Decode signed values arithmetically when you have not measured the pair
  ([`examples/wire_le.om`](../../examples/wire_le.om)).
- **Empty text through `view uchar *`** (omega-mv issue #775): reproduced on 2026-11-04 with omc
  `2c824805`: `om2`, `text e ""`, `fn n a view uchar * to ulong` / `ret len a`, `ret int n e` exits
  28 (60 with one more 32-byte text). Pass `part e 0 0`
  ([`examples/empty_text_part.om`](../../examples/empty_text_part.om)).
- **`and`/`or` are eager:** `if and gt n 0 eq get a sub n 1 13` traps 3 when `n` is 0. Guard an
  index with a nested `if`.
- **Function names:** a name of 9..63 bytes is not a keyword by its first 8 bytes. `continue_x`
  compiles and returns 7 ([`examples/defect_keyword_prefix.om`](../../examples/defect_keyword_prefix.om)).
  An exact keyword (`fn continue`) is still error 16. At omc `2c824805`, `continue_x` was error 16.
- OMEGESE 9.9 lists `+ - * /` for floats; the compiler refuses them. Write `add sub mul div`.

## 14. Example index

All in [`examples/`](../../examples/); each `NAME.om` has `NAME.expect` (compile status, exit status
or stderr line) and, when it prints, `NAME.stdout` with the exact bytes. Wolfram checks of the
arithmetic expectations are in [`examples/WOLFRAM.md`](../../examples/WOLFRAM.md).

- Start here: `hello`, `exit_status`, `print_decimal`, `functions`, `loops`, `arrays`, `text`.
- Arithmetic: `int_arith`, `int_bits_and`, `unsigned_wrap`, `checked_conv`, `float_arith`,
  `float_to_int`, `consts`.
- Data: `globals`, `structs`, `wire_le`.
- I/O: `stdin_count`, `echo_args`, `env_read`, `tmp_files`.
- Traps: `trap1_overflow` .. `trap7_shift`, `trap_code`.
- OM-2 and contracts: `om2_tour`, `om2_views`, `om2_hex_rotr`, `om2_part_trap`, `om2_param_slots`,
  `om2_word_plain`, `layout_word_plain`, `contracts_ok`, `contract_requires`, `contract_ensures`,
  `contract_invariant`, `contract_release`.
- Regression guards: `empty_text_part`, `defect_keyword_prefix`, `bound_input_guard`.
- Refusals: `err01_input` .. `err30_contract`, `mistake_*`.
