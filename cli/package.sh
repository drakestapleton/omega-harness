#!/bin/sh
# Build a self-contained, reproducible release tarball of Ω Omega Harness CLI + manifest.
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DIR"
OUT_DIR=${1:-"$DIR/release"}
VER=$(node -p "require('./package.json').version")
HARNESS_SHA=$(git -C "$DIR/.." rev-parse HEAD 2>/dev/null || echo "unknown")
OMEGA_MV_SHA=$(git -C "$DIR/../../omega-mv" rev-parse HEAD 2>/dev/null || echo "unknown")
NAME="omega-harness-cli-${VER}"
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

npm run build
npm test

mkdir -p "$STAGE/$NAME" "$OUT_DIR"
cp -R dist package.json package-lock.json README.md install.sh "$STAGE/$NAME/"
chmod +x "$STAGE/$NAME/install.sh" "$STAGE/$NAME/dist/index.js"

cat > "$STAGE/$NAME/MANIFEST.txt" <<EOF
package: omega-harness-cli
version: ${VER}
omega-harness-commit: ${HARNESS_SHA}
omega-mv-commit: ${OMEGA_MV_SHA}
stack:
  - Inkling-2-Mini pure seeded-Omega zero-CUDA GB10 server (inkling2-serve)
  - GPU bf16_gemv_k64_fast (replaces 28.3M CPU MACs/tok)
  - GPU Split-K Flash-Decode + fused attn_gate
  - Fused ikDBatchMsgGate + one-time gbsetup
  - Bulk mapread/mapwrite for 200k argmax, KV append, residual adds
  - Live Arboris online co-activation tracker (all 24 transitions incl. L17->L6)
  - Live /health Arboris telemetry + omega start/up/down/rebuild lifecycle
EOF

TARBALL="$OUT_DIR/${NAME}.tar.gz"
tar -czf "$TARBALL" -C "$STAGE" "$NAME"
shasum -a 256 "$TARBALL" > "${TARBALL}.sha256"
echo "Ω Packaged: $TARBALL"
cat "${TARBALL}.sha256"
