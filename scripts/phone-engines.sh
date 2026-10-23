#!/usr/bin/env bash
# The phone app on every phone engine (ns CLAUDE.md 2d), before any deploy:
#   WebKit (every iPhone browser) and Firefox (Gecko) in the Playwright container (this computer lacks WebKit's
#   libraries), Chromium (Blink: Chrome, Samsung, Edge on Android) here. Signed in; writes caught, nothing changes.
#   scripts/phone-engines.sh [live|local]      (local: this folder's web/phone and web/shared, under the live site)
# All three engines, and every phone profile in each, run at the same time (ns CLAUDE.md 2f): the same steps,
# waits and checks as one at a time, in their own windows, sharing one looks session (only one can exist).
# ONE_AT_A_TIME=1 runs them one after another instead (to rule out the machine being too busy, if timings look off).
# Exits 1 if any engine had a problem. Screenshots and each engine's log in .phone-check/.
set -uo pipefail
cd "$(dirname "$0")/.."
mode="${1:-local}"
version=$(node -e "console.log(require('playwright/package.json').version)")
image="mcr.microsoft.com/playwright:v${version}-noble"
here="$(pwd)"
out="$here/.phone-check"
mkdir -p "$out"
podman image exists "$image" || podman pull "$image" || { echo "Couldn't get $image"; exit 1; }

# One looks session for every engine, ended at the end however the run ends
looks() { node -e '
  const key = (require("fs").readFileSync(".env", "utf8").match(/^AGENT_NOVA_KEY=(.*)$/m) || [])[1]?.trim().replace(/^["\x27]|["\x27]$/g, "");
  fetch("https://nova.novacane.co.uk/nova-agent/looks-session", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ action: process.argv[1] }) })
    .then((r) => r.text()).then((t) => process.stdout.write(t));' "$1"; }
session="$out/looks.json"
looks start > "$session" && grep -q '"token"' "$session" || { echo "Couldn't start the looks session"; rm -f "$session"; exit 1; }
trap 'looks end >/dev/null; rm -f "$session"' EXIT

parallel=1; [ "${ONE_AT_A_TIME:-}" = 1 ] && parallel=0
run() {  # engine
  if [ "$1" = chromium ]; then
    LOOKS_FILE="$session" PHONE_CHECK_PARALLEL=$parallel npx tsx scripts/phone-check.ts chromium "$mode" "$out"
  else
    podman run --rm --ipc=host --userns=keep-id -e HOME=/tmp -e LOOKS_FILE="$session" -e PHONE_CHECK_PARALLEL=$parallel \
      -v "$here:$here" -w "$here" "$image" npx tsx scripts/phone-check.ts "$1" "$mode" "$out"
  fi > "$out/$1.log" 2>&1
}
bad=0
if [ "$parallel" = 1 ]; then
  declare -A pid
  for engine in webkit firefox chromium; do run "$engine" & pid[$engine]=$!; done
  for engine in webkit firefox chromium; do wait "${pid[$engine]}" || bad=1; done
else
  for engine in webkit firefox chromium; do run "$engine" || bad=1; done
fi
for engine in webkit firefox chromium; do echo "=== $engine ==="; grep -v "^npm notice" "$out/$engine.log"; done
[ "$bad" = 0 ] && echo "ALL ENGINES CLEAR" || echo "SOMETHING FAILED: don't deploy"
exit $bad
