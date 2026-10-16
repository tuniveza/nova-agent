/* Notes — cover.js
   While a dialog is open over Notes (the Welcome guide, Shortcuts, About…), the page behind it is
   marked as covered (aria-hidden), so nothing reads the menus under the dark backdrop as if they
   were on show alongside the dialog. Lifted again as soon as the last dialog closes. */
(function () {
  function coverBehind(shell, doc) {
    const sync = () => {
      if (doc.querySelector('dialog[open]')) shell.setAttribute('aria-hidden', 'true');
      else shell.removeAttribute('aria-hidden');
    };
    const watch = new MutationObserver(sync);
    for (const d of doc.querySelectorAll('dialog')) watch.observe(d, { attributes: true, attributeFilter: ['open'] });
    sync();
    return sync;
  }
  window.NotesCover = { coverBehind };
  const shell = typeof document !== 'undefined' && document.getElementById('shell');
  if (shell) coverBehind(shell, document);
})();
