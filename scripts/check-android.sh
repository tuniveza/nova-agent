#!/usr/bin/env bash
# Android phones and tablets, in one go: starts a throwaway Nova Agent (its own data folder and
# port, sample missions, quests and files, the Fixer inert, not linked online), runs
# scripts/check-android.ts against it, then stops it. Exit 0 = nothing broken on any device.
#   scripts/check-android.sh                                    every device, text 100% and 130%
#   scripts/check-android.sh --devices s23,tab-p --shots /tmp/a --sheet   (anything else goes on to check-android.ts)
set -euo pipefail
cd "$(dirname "$0")/.."
data=$(mktemp -d)
port=${ANDROID_PORT:-$(node -e 'const s=require("net").createServer().listen(0,()=>{console.log(s.address().port);s.close()})')}
log="$data/server.log"
npx tsx -e "import('./scripts/check-android-seed.ts').then((m) => m.seedAndroid('$data'))"
FIXER_DRY=1 NOVA_DATA_DIR="$data/" VISUALIZER_PORT="$port" NOVA_LOCAL_UI=1 AGENT_NOVA_KEY= NOVA_ON_SERVER= \
  NOVA_WORKER_URL=https://worker.test npx tsx src/visualizer/server.ts >"$log" 2>&1 &
server=$!
trap 'kill $server 2>/dev/null || true; wait $server 2>/dev/null || true; rm -rf "$data"' EXIT
for _ in $(seq 1 60); do
  curl -s -o /dev/null -m 2 "http://localhost:$port/agent/" && break
  kill -0 $server 2>/dev/null || { echo "The throwaway Nova Agent didn't start:"; tail -20 "$log"; exit 2; }
  sleep 1
done
npx tsx scripts/check-android.ts "http://localhost:$port" "$@"
