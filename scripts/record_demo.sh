#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$ROOT/docs/demo"
OUT_FILE="${1:-$OUT_DIR/trademind-demo.mp4}"
BASE_URL="${TRADEMIND_DEMO_URL:-http://localhost:3000}"
SECONDS_PER_PAGE="${TRADEMIND_DEMO_SECONDS_PER_PAGE:-8}"
FPS="${TRADEMIND_DEMO_FPS:-24}"
PAGES=("/" "/wheel" "/intel" "/showcase")
DURATION="${TRADEMIND_DEMO_DURATION:-$((SECONDS_PER_PAGE * ${#PAGES[@]} + 3))}"

mkdir -p "$OUT_DIR"

echo "Recording TradeMind demo to: $OUT_FILE"
echo "Make sure the dashboard dev server is running: cd dashboard && npm run dev"
echo "The script records screen 0 and opens demo pages in the default browser."
echo "Requires macOS Screen Recording permission for the terminal running this script."

ffmpeg -y \
  -f avfoundation \
  -framerate "$FPS" \
  -t "$DURATION" \
  -i "0:none" \
  -pix_fmt yuv420p \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  "$OUT_FILE" &

FFMPEG_PID=$!
trap 'kill "$FFMPEG_PID" 2>/dev/null || true' EXIT

sleep 2
for path in "${PAGES[@]}"; do
  open "$BASE_URL$path"
  sleep "$SECONDS_PER_PAGE"
done

wait "$FFMPEG_PID" 2>/dev/null || true
trap - EXIT

echo "Demo saved: $OUT_FILE"
