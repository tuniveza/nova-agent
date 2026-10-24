#!/usr/bin/env bash
# Deploy single web files (ns CLAUDE.md 6: the live site is mixed, other sessions deploy too), only after
# scripts/deploy-check.sh passed for exactly these files with exactly this content:
#   scripts/deploy-files.sh [--dry-run] <web files…>     (the same list as given to deploy-check.sh)
# 1. finds the deploy check that passed (.checks/deploy/<run>/passed.json) for this very list, every file's sha256
#    the same as now; refuses if there's none (check again: scripts/deploy-check.sh <files…>);
# 2. the version each change started from is that run's before tree (live as it was when checked): live's copy in
#    both /srv/nova/app/public and /srv/nova-files must still be that, or it stops (someone else deployed it since);
# --dry-run stops here. Otherwise:
# 3. backs each up (/root/nova-backups/desk-<time>/), installs it into both, checks the installed copy;
# 4. rebuilds nova-build.json (/root/nova-buildlist.mjs), restarts nova and says whether it's running.
# web/agent/chat.html is live's agent/index.html; web/agent/assets/X is live's agent/X.
set -euo pipefail
cd "$(dirname "$0")/.."
VPS=root@185.185.126.195
ROOTS=(/srv/nova/app/public /srv/nova-files)
dry=0; files=()
for a in "$@"; do case $a in --dry-run) dry=1;; *) files+=("${a#web/}");; esac; done
[ ${#files[@]} -gt 0 ] || { sed -n '2,12p' "$0"; exit 2; }
S() { ssh -n -o BatchMode=yes "$VPS" "$@"; }  # (-n: never eats the file list being read)
livepath() { case $1 in agent/chat.html) echo agent/index.html;; agent/assets/*) echo "agent/${1#agent/assets/}";; lossless/public/lossless/*) echo "lossless/${1#lossless/public/lossless/}";; *) echo "$1";; esac; }

# 1. the check that passed for exactly these files, as they are now
want=$(printf '%s\n' "${files[@]}" | sort -u)
run=""
for p in $(ls -1d .checks/deploy/*/passed.json 2>/dev/null | sort -r); do
  d=$(dirname "$p"); [ -L "$d" ] && continue  # (last-pass is only a pointer to a run)
  got=$(cut -f1 "$d/files.tsv" | sort -u)
  [ "$got" = "$want" ] || continue
  ok=1
  while IFS=$'\t' read -r f l new old; do
    [ "$(sha256sum < "web/$f" | cut -d' ' -f1)" = "$new" ] || { ok=0; break; }
  done < "$d/files.tsv"
  [ $ok = 1 ] && { run=$d; break; }
done
[ -n "$run" ] || { echo "STOP: no deploy check passed for exactly these files as they are now. Run: scripts/deploy-check.sh ${files[*]}"; exit 1; }
echo "deploy check passed: $run ($(sed -n 's/.*"at": "\(.*\)".*/\1/p' "$run/passed.json"))"

# 2. live still the version each change started from (the before tree)
while IFS=$'\t' read -r f l new old; do
  for root in "${ROOTS[@]}"; do
    if [ "$old" = - ]; then
      S "[ ! -e $root/$l ]" || { echo "STOP: $root/$l is on live now, but wasn't when checked"; exit 1; }
    else
      S "cat $root/$l" | cmp -s - "$run/before/$l" || { echo "STOP: live $root/$l differs from the version this change started from"; exit 1; }
    fi
  done
  echo "live matches the starting version: $l"
done < "$run/files.tsv"
[ $dry = 1 ] && { echo "dry run: nothing deployed"; exit 0; }

# 3. back up, install into both, check
stamp=$(date +%Y%m%d-%H%M%S); bak=/root/nova-backups/desk-$stamp
S "mkdir -p $bak"
while IFS=$'\t' read -r f l new old; do
  dir=$(dirname "$l")
  S "mkdir -p $bak/public/$dir $bak/files/$dir"
  [ "$old" = - ] || S "cp -p /srv/nova/app/public/$l $bak/public/$l && cp -p /srv/nova-files/$l $bak/files/$l"
  scp -q "web/$f" "$VPS:/tmp/deploy-one"
  # (owned like the copy it replaces; a new file like its folder)
  if [ "$old" = - ]; then refP=/srv/nova/app/public/$dir; refF=/srv/nova-files/$dir; else refP=$bak/public/$l; refF=$bak/files/$l; fi
  S "mkdir -p /srv/nova/app/public/$dir /srv/nova-files/$dir && install -m 644 /tmp/deploy-one /srv/nova/app/public/$l && install -m 644 /tmp/deploy-one /srv/nova-files/$l && chown --reference=$refP /srv/nova/app/public/$l && chown --reference=$refF /srv/nova-files/$l && rm /tmp/deploy-one"
  for root in "${ROOTS[@]}"; do S "cat $root/$l" | cmp -s - "web/$f" || { echo "MISMATCH after install: $root/$l (backup: $bak)"; exit 1; }; done
  echo "installed $l"
done < "$run/files.tsv"
# 4. nova-build.json, restart
S "cp -p /srv/nova/app/public/nova-build.json $bak/nova-build.json 2>/dev/null; node /root/nova-buildlist.mjs /srv/nova/app/public && cp /srv/nova/app/public/nova-build.json /srv/nova-files/nova-build.json && systemctl restart nova && sleep 4 && systemctl is-active nova"
echo "backup: $bak"
