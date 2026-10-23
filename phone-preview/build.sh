#!/usr/bin/env bash
# The phone preview (a claude.ai artifact): the phone app's own files as they are now, with sample data instead
# of the server. Builds into ./out (or the folder given); publish out/index.html with the rest as its files.
#   phone-preview/build.sh [out dir]
set -euo pipefail
cd "$(dirname "$0")"
out="${1:-out}"
rm -rf "$out" && mkdir -p "$out/lib"
web=../web
cp "$web"/phone/*.js "$web"/phone/*.css "$out"/
cp "$web"/phone/lib/*.js "$out"/lib/
cp "$web"/shared/themes.css "$web"/shared/themes.js "$out"/
cp sample-*.js preview-extra.js preview.css index.html "$out"/
# (each place's sample answers, sample-<place>.js, load straight after sample-data.js)
extra=$( (ls sample-*.js | grep -v '^sample-data.js$' || true) | sed 's|.*|<script src="&"></script>|' | tr '\n' ' ')
sed -i "s|<script src=\"sample-data.js\"></script>|<script src=\"sample-data.js\"></script>${extra}|" "$out/index.html"
# (the service worker isn't for the preview: its page can't have one)
sed -i 's|if ("serviceWorker" in navigator)|if (false \&\& "serviceWorker" in navigator)|' "$out/phone.js"
echo "built: $(ls "$out" | wc -l) files in $out"
