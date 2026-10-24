#!/usr/bin/env bash
# The quick look, then deploy: a few minutes, not the full check (ns CLAUDE.md 2g, 24 Oct 2026, the user: "so I don't
# have to wait ages to see results and work on the next bit?"). For most changes (2g.1); the full check
# (scripts/deploy-check.sh) is still there for what 2g.2 says needs it.
#   scripts/quick-ship.sh [--look-only] <web files…>      (paths under web/, as for deploy-check.sh)
# 1. keeps live's copy of each file as it is now (the version the change starts from) in
#    .checks/deploy/<time>-quick/before/, the way deploy-check.sh does;
# 2. scripts/quick-look.ts on the places the files touch, live and the new files side by side, in Blink: every Desk
#    file's panel (and Nova Desk's home, which hosts them all) at 1440×900 and 1366×400; Nova Phone's main screens
#    on an iPhone 15 upright and sideways when web/phone/ or web/shared/ is touched (2c.6);
# 3. QUICK LOOK OK: passed.json for exactly these files as they are now, then scripts/deploy-files.sh deploys them
#    (it still stops if anyone else changed one on live since step 1). --look-only: stops before deploying.
set -euo pipefail
cd "$(dirname "$0")/.."
VPS=root@185.185.126.195
look_only=0; files=()
for a in "$@"; do case $a in --look-only) look_only=1;; *) files+=("${a#web/}");; esac; done
[ ${#files[@]} -gt 0 ] || { sed -n '2,14p' "$0"; exit 2; }
S() { ssh -n -o BatchMode=yes "$VPS" "$@"; }
livepath() { case $1 in agent/chat.html) echo agent/index.html;; agent/assets/*) echo "agent/${1#agent/assets/}";; lossless/public/lossless/*) echo "lossless/${1#lossless/public/lossless/}";; *) echo "$1";; esac; }

run=".checks/deploy/$(date +%Y%m%d-%H%M%S)-quick"
mkdir -p "$run/before"
: > "$run/files.tsv"
desk=() phone=0
for f in "${files[@]}"; do
  [ -f "web/$f" ] || { echo "no such file: web/$f"; exit 2; }
  l=$(livepath "$f")
  mkdir -p "$run/before/$(dirname "$l")"
  if S "[ -e /srv/nova/app/public/$l ]"; then S "cat /srv/nova/app/public/$l" > "$run/before/$l"; old=$(sha256sum < "$run/before/$l" | cut -d' ' -f1); else old=-; fi
  printf '%s\t%s\t%s\t%s\n' "$f" "$l" "$(sha256sum < "web/$f" | cut -d' ' -f1)" "$old" >> "$run/files.tsv"
  dir=${f%%/*}
  case $dir in
    phone) phone=1;;
    shared) phone=1; desk+=(/agent/ /portal/ /calendar/ /quests/ /notes/);;
    agent) desk+=(/agent/);;
    *) desk+=("/$dir/");;
  esac
done
# (Nova Desk's home first: every panel opens inside it)
desk_list=$(printf '%s\n' /agent/ "${desk[@]}" | awk '!seen[$0]++' | paste -sd, -)
phone_list=""
[ $phone = 1 ] && phone_list="#today,#inbox,#agent,#calendar,#quests,#money,#notes,#more"
echo "quick look: Desk ${desk_list}${phone_list:+; Nova Phone $phone_list}"
start=$(date +%s)
if ! WEB_ROOT=web node_modules/.bin/tsx scripts/quick-look.ts "$run/out" "$desk_list" "$phone_list" 2>&1 | tee "$run/report.txt"; then
  echo "QUICK SHIP BLOCKED after $(( $(date +%s) - start )) s: something new is wrong (above). Nothing deployed."
  exit 1
fi
printf '{\n  "at": "%s",\n  "kind": "quick look",\n  "seconds": %s\n}\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(( $(date +%s) - start ))" > "$run/passed.json"
echo "quick look passed in $(( $(date +%s) - start )) s: $run"
[ $look_only = 1 ] && { echo "--look-only: nothing deployed. Deploy with: scripts/deploy-files.sh ${files[*]}"; exit 0; }
scripts/deploy-files.sh "${files[@]}"
