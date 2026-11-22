#!/bin/sh
# One-command installer for Ω Omega Harness CLI (Inkling-2-Mini + Arboris + SM121 speedups)
set -eu
DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$DIR"
echo "Ω Installing Omega Harness CLI from $DIR..."
npm install --no-audit --no-fund
npm run build
npm test
mkdir -p "$HOME/.local/bin"
ln -sf "$DIR/dist/index.js" "$HOME/.local/bin/omega"
echo ""
echo "Ω Installed: $HOME/.local/bin/omega"
echo "  Quick start:"
echo "    omega start     # boot Inkling-2-Mini + Arboris on Spark, tunnel :8080, and launch TUI"
echo "    omega up        # boot Spark server + tunnel only"
echo "    omega --status  # check health, KV slots & live Arboris hit rates"
echo "    omega down      # stop Spark server + close tunnel cleanly"
