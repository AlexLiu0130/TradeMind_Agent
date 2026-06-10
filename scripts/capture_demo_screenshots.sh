#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/docs/demo/screenshots"
BASE_URL="${TRADEMIND_DEMO_URL:-http://localhost:3000}"
WAIT_SECONDS="${TRADEMIND_DEMO_WAIT_SECONDS:-3}"

mkdir -p "$OUT_DIR"

capture_page() {
  local path="$1"
  local name="$2"
  open "$BASE_URL$path"
  sleep "$WAIT_SECONDS"
  screencapture -x "$OUT_DIR/$name.png"
  echo "Captured $OUT_DIR/$name.png"
}

echo "Capturing TradeMind demo screenshots from $BASE_URL"
echo "Requires macOS Screen Recording permission for the terminal running this script."
capture_page "/" "01-portfolio"
capture_page "/wheel" "02-wheel"
capture_page "/intel" "03-intel"
capture_page "/showcase" "04-showcase"
echo "Screenshots saved in $OUT_DIR"
