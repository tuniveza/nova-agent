// The file cards' safety net, kept apart from the page so it can be tested (test/filelinks.spec.ts).
// When a reply's file card can't be drawn, chat.html shows a plain link in its place:
//   fileOf(act, list): the file, from the action's own details or by the name in
//     "Wrote release-plan.md" in Nova Agent's list of files (null when it isn't there)
//   needsList(act): whether the list of files is needed to find it
//   linkFor(file): the link: "⤓ Download <name>" straight to the file, or "▤ Open your files"
// Loaded before the page's own script: window.NovaFileLinks
(function (root) {
  'use strict';
  const hasCard = (act) => Boolean(act && act.file && act.file.url);
  const needsList = (act) => !hasCard(act);
  // "Wrote release-plan.md" → "release-plan.md"
  const nameIn = (act) => String((act && act.text) || '').replace(/^(Wrote|Updated|Exported)\s+/i, '').trim();
  function fileOf(act, list) {
    if (hasCard(act)) return act.file;
    const name = nameIn(act);
    return (Array.isArray(list) ? list : []).find((x) => x && (x.name === name || x.title === name)) || null;
  }
  function linkFor(file) {
    if (file) return { href: `${file.url}?download`, download: file.name, text: `⤓ Download ${file.name}`, files: false };
    return { href: '#', download: null, text: '▤ Open your files', files: true };
  }
  root.NovaFileLinks = { fileOf, needsList, nameIn, linkFor };
})(globalThis);
