#!/usr/bin/env bash
# The phone app on every phone engine (ns CLAUDE.md 2d), before any deploy:
#   WebKit (every iPhone browser) and Firefox (Gecko) in the Playwright container (this computer lacks WebKit's
#   libraries), Chromium (Blink: Chrome, Samsung, Edge on Android) here. Signed in; writes caught, nothing changes.
#   scripts/phone-engines.sh [live|local]      (local: this folder's web/phone and web/shared, under the live site)
# Exits 1 if any engine had a problem. Screenshots in .phone-check/.
set -uo pipefail
cd "$(dirname "$0")/.."
mode="${1:-local}"
version=$(node -e "console.log(require('playwright/package.json').version)")
image="mcr.microsoft.com/playwright:v${version}-noble"
here="$(pwd)"
bad=0
podman image exists "$image" || podman pull "$image" || { echo "Couldn't get $image"; exit 1; }
for engine in webkit firefox; do
  echo "=== $engine (container) ==="
  podman run --rm --ipc=host --userns=keep-id -e HOME=/tmp -v "$here:$here" -w "$here" "$image" npx tsx scripts/phone-check.ts "$engine" "$mode" "$here/.phone-check" || bad=1
done
echo "=== chromium ==="
npx tsx scripts/phone-check.ts chromium "$mode" "$here/.phone-check" || bad=1
[ "$bad" = 0 ] && echo "ALL ENGINES CLEAR" || echo "SOMETHING FAILED: don't deploy"
exit $bad
