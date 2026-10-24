#!/usr/bin/env bash
# The before and after trees for a deploy check (ns CLAUDE.md 2e, 2f, 6), in live's own layout:
#   before = what live serves now (a copy of the live site's files: /srv/nova/app/public on the VPS)
#   after  = the same, with only the given files changed, from this folder's web/ (anyone else's unfinished work
#            in web/ stays out: every other file is live's)
#   scripts/deploy-trees.sh <run dir> <web files…>     (paths relative to web/, e.g. calendar/js/cal.js agent/chat.html)
# web/agent/chat.html is live's agent/index.html and web/agent/assets/X is live's agent/X. Files over 3 MB (media)
# aren't copied: they come from live for both trees alike (scripts/lib/serve.ts serves a tree's files and lets
# everything else through to live). Writes <run dir>/files.tsv: each file, its live path, and the sha256 of the
# new copy and of live's copy ("-": live doesn't have it), which scripts/deploy-files.sh checks before deploying.
set -euo pipefail
cd "$(dirname "$0")/.."
VPS=root@185.185.126.195
LIVE=/srv/nova/app/public
[ $# -ge 2 ] || { echo "usage: scripts/deploy-trees.sh <run dir> <web files…>"; exit 2; }
run=$1; shift
livepath() { case $1 in agent/chat.html) echo agent/index.html;; agent/assets/*) echo "agent/${1#agent/assets/}";; lossless/public/lossless/*) echo "lossless/${1#lossless/public/lossless/}";; *) echo "$1";; esac; }
for f in "$@"; do
  case $f in /*|*..*) echo "STOP: $f must be a path inside web/"; exit 2;; esac
  [ -f "web/$f" ] || { echo "STOP: web/$f isn't there"; exit 2; }
done

# live's files, kept in .checks/live-mirror: one rsync call, and only what changed since the last run is fetched
mirror=.checks/live-mirror
mkdir -p "$mirror" "$run"
dirs=(shared portal agent calendar notes board index quests fixer computer observatory console lossless invoicer phone)
filters=(); for d in "${dirs[@]}"; do filters+=(--include="/$d/***"); done
rsync -a --delete --max-size=3m "${filters[@]}" --exclude='*' "$VPS:$LIVE/" "$mirror/"

rm -rf "$run/before" "$run/after"
# (hard links, not copies: instant, and safe, since rsync replaces a changed file with a new one rather than writing
# into it, and the after tree's changed files are removed before their new copy goes in)
cp -al "$mirror" "$run/before"
cp -al "$run/before" "$run/after"
: > "$run/files.tsv"
for f in "$@"; do
  l=$(livepath "$f")
  mkdir -p "$run/after/$(dirname "$l")"
  rm -f "$run/after/$l"
  cp "web/$f" "$run/after/$l"
  new=$(sha256sum < "web/$f" | cut -d' ' -f1)
  old=-; [ -f "$run/before/$l" ] && old=$(sha256sum < "$run/before/$l" | cut -d' ' -f1)
  printf '%s\t%s\t%s\t%s\n' "$f" "$l" "$new" "$old" >> "$run/files.tsv"
  [ "$new" = "$old" ] && same=" (the same as live)" || same=""
  echo "after: $f → $l$same"
done
touch "$run/before/.live-layout" "$run/after/.live-layout"
# (scripts run against the trees are ES modules, like this project's)
printf '{ "private": true, "type": "module" }\n' > "$run/package.json"
echo "trees ready: $run/before $run/after ($(find "$run/before" -type f | wc -l) live files)"
