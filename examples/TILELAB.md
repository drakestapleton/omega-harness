# Reproduce the Omega TileLab checks

On Linux AArch64, use a fresh checkout. The first command sequence rebuilds the compiler from the seed, checks the compiler digest and runs the tile planner and streaming row-softmax cases.

```sh
git clone https://interplane.io/projects/omega-mv/repo.git omega-tilelab
cd omega-tilelab
git checkout --detach 3086ed3ca1061b2625a48d175cd5ac990e783655
sh seed/omega-from-seed.sh && sh seed/tilelab/gate.sh
```

The host gate compares 24 cases, rejects three deliberately incorrect softmax implementations and challenges two input checks. Inspect a GEMM plan with `build/seed/tilelab/tilelab 1 1024 1024 1024` and the row-softmax reduction with `build/seed/tilelab/tilelab 2 0`. The GEMM planner reports candidate tile shapes and resource estimates. It does not execute a GPU kernel. The algebra, traffic model, assumptions about operand reuse and independent reference values are in `seed/tilelab/WOLFRAM.md`. Reuse across GEMM rows differs from reading weights for a single row.

## Physical GB10 comparison

From a separate directory, obtain the measured CUDApp sources and receipts.

```sh
git clone https://interplane.io/projects/CUDApp/repo.git tilelab-cudapp
cd tilelab-cudapp
git checkout --detach 21d8de285f713adf09e0d6ba6db2b37139d0674e
cat evidence/TILELAB-20261028/README.md
```

Read `02-quiet-ab.json` in that evidence directory for the interleaved comparison against the CUDApp default. The shared-window smoke runs establish correctness only. The recorded planner configuration won on 8192 cubed and lost on 2048 by 8192 by 2048. Those are kernel measurements. End-to-end application speed remains unmeasured by that test.

For a new physical run, reserve an exclusive GB10 window. Without one, record NOT_RUN and leave resident jobs running. Use the build flags, binary and library hashes in the receipt README, and the shapes, configurations and rounds in the raw receipt. The physical test uses the C driver in `tests/gpu_tilelab_test.c` and `libomega_gpu.a`. Replacing this path requires an Omega driver that reproduces the oracle comparisons, refusals and chip mutant detections on hardware. The host test exercises the seeded Omega planner and algebra only.

With an exclusive window and a fresh CUDApp checkout, this runs the four recorded arms and writes a new receipt. A new build can produce different binary hashes. Retain them with the receipt.

```sh
make build/libomega_gpu.a &&
gcc -O2 -std=gnu11 -Wall -Isrc -ffp-contract=off tests/gpu_tilelab_test.c build/libomega_gpu.a -lpthread -lm -o build/tilelab-gb10 &&
sha256sum build/tilelab-gb10 build/libomega_gpu.a &&
build/tilelab-gb10 --shapes '1024,1024,1024;4096,4096,4096;2048,8192,2048;8192,8192,8192' --cfg plan:2,4,4,4,8 --cfg t64x64:1,2,4,4,8 --cfg t64x128:1,4,4,4,8 --rounds 25 --out build/tilelab-gb10.json
```

KernelFlow M1 and its tile extension landed in omega-mv at `e4f9f9c58` and `f0cc9d6a5`. The native TileLab gate above uses neither an Omegese C1 extension nor an external compiler. Its result certifies only the cases it runs.
