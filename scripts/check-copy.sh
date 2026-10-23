#!/usr/bin/env bash
# Check a frozen copy of the committed code (ns CLAUDE.md 2f): the three-engine phone check runs on the copy, so
# work can carry on here meanwhile without changing what's being checked.
#   scripts/check-copy.sh [live|local]      (commit first: the copy is HEAD)
set -uo pipefail
cd "$(dirname "$0")/.."
here="$(pwd)"; copy="${TMPDIR:-/tmp}/na-check-copy"
git worktree remove --force "$copy" 2>/dev/null; rm -rf "$copy"
git worktree add -q --detach "$copy" HEAD || exit 1
ln -s "$here/node_modules" "$copy/node_modules"; ln -s "$here/.env" "$copy/.env"
echo "Checking $(git -C "$copy" log --oneline -1)"
"$copy/scripts/phone-engines.sh" "${1:-local}"; status=$?
mkdir -p "$here/.phone-check"; cp -r "$copy/.phone-check/." "$here/.phone-check/" 2>/dev/null
git worktree remove --force "$copy"
exit $status
