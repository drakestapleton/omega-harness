#!/usr/bin/env bash
# Mandatory pre-deploy sandbox verification gate for aienos.com & interplane.io.
# Serves a built static site directory on loopback, verifies HTTP 200, zero cookies,
# zero third-party script/origin references, and prints the sandbox URL required for
# browser visual regression inspection BEFORE any live production push.
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "Usage: $0 <built-dist-dir> [port]" >&2
  exit 2
fi

DIST_DIR="$1"
PORT="${2:-18820}"

if [ ! -f "$DIST_DIR/index.html" ]; then
  echo "FAIL: $DIST_DIR/index.html not found" >&2
  exit 1
fi

# 1. Static asset & zero-tracking policy check
if grep -rniE 'google-analytics|googletagmanager|posthog|sentry\.io|mixpanel|segment\.com|doubleclick|facebook\.net' "$DIST_DIR" >/dev/null 2>&1; then
  echo "FAIL: third-party tracker reference found in $DIST_DIR" >&2
  exit 1
fi

# 2. Launch isolated loopback preview server
python3 -m http.server "$PORT" --bind 127.0.0.1 -d "$DIST_DIR" >/tmp/sandbox-visual-gate-"$PORT".log 2>&1 &
SRV_PID=$!
trap 'kill "$SRV_PID" 2>/dev/null || true' EXIT
sleep 1

# 3. Verify HTTP 200 and zero Set-Cookie headers
HEADERS=$(curl -sS -D - -o /dev/null "http://127.0.0.1:$PORT/")
echo "$HEADERS" | head -n 1 | grep -q '200' || { echo "FAIL: homepage did not return HTTP 200" >&2; exit 1; }
if echo "$HEADERS" | grep -qi '^set-cookie:'; then
  echo "FAIL: unexpected Set-Cookie header in sandbox response" >&2
  exit 1
fi

echo "PASS: sandbox static & header gates clean at http://127.0.0.1:$PORT/"
echo "REQUIRED NEXT STEP: Visually inspect http://127.0.0.1:$PORT/ (desktop 1280px + 1106px + mobile 390px) for zero seizure/flicker, zero overlap, zero overflow, and crisp contrast before deploying live."
