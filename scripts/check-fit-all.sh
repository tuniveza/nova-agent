#!/usr/bin/env bash
# Everything fits on screen, in one go: starts a throwaway Nova Agent (its own data folder and port,
# the Fixer inert, not linked online), runs scripts/check-fit.mjs against it at phone, tablet and
# computer sizes with the Manual open too, then stops it. Exit 0 = nothing sticks out anywhere.
#   scripts/check-fit-all.sh                          every panel, 360×640, 768×1024 and 1440×900
#   scripts/check-fit-all.sh --only portal,calendar   (anything else goes on to check-fit.mjs)
#   FIT_SIZES=390x844,1280x800 scripts/check-fit-all.sh
# Used by the Fixer's checks too; it needs Playwright's Chromium (npx playwright install chromium).
set -euo pipefail
cd "$(dirname "$0")/.."
data=$(mktemp -d)
port=${FIT_PORT:-$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')}
log="$data/server.log"
FIXER_DRY=1 NOVA_DATA_DIR="$data/" VISUALIZER_PORT="$port" NOVA_LOCAL_UI=1 AGENT_NOVA_KEY= NOVA_ON_SERVER= \
  NOVA_WORKER_URL=https://worker.test npx tsx src/visualizer/server.ts >"$log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true; wait $server 2>/dev/null || true; rm -rf "$data"' EXIT
for _ in $(seq 1 60); do
  curl -s -o /dev/null -m 2 "http://localhost:$port/agent/" && break
  kill -0 $server 2>/dev/null || { echo "The throwaway Nova Agent didn't start:"; tail -20 "$log"; exit 2; }
  sleep 1
done
FIT_DATA_DIR="$data/" node scripts/check-fit.mjs "http://localhost:$port" --sizes "${FIT_SIZES:-360x640,768x1024,1440x900}" --manual "$@"
