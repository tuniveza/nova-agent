#!/usr/bin/env bash
# The phone preview (a claude.ai artifact): the phone app's own files as they are now, with sample data instead
# of the server. Builds into ./out; publish out/index.html with the rest as its files.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf out && mkdir -p out/lib
web=../web
cp "$web"/phone/{phone.css,tiles.js,phone.js,today.js,inbox.js,calendar.js,agent.js,quests.js,money.js,notes.js,clients.js,outreach.js,you.js,admin.js,memory.js,board.js,helpers.js,more.js} out/
cp "$web"/phone/lib/*.js out/lib/
cp "$web"/shared/themes.css "$web"/shared/themes.js out/
cp sample-data.js preview-extra.js preview.css index.html out/
# (the service worker isn't for the preview: its page can't have one)
sed -i 's|if ("serviceWorker" in navigator)|if (false \&\& "serviceWorker" in navigator)|' out/phone.js
echo "built: $(ls out | wc -l) files"
