/* Nova Notes — google.js
   Two ways into Google Docs:
   1. copyAndOpen(): no setup. Copies the note as formatted text and opens a new Google Doc
      (docs.new); press Ctrl+V there and the styling comes with it.
   2. saveToDrive(): one click, once set up. Signs in with Google (Google Identity Services, only
      the "files this app creates" permission) and uploads the note as HTML, which Drive turns into
      a real Google Doc. The note remembers that Doc, so the next save updates it in place.
      Needs an OAuth client ID (Google Cloud → APIs & Services → Credentials → Web application) with
      this page's address as an authorised JavaScript origin, and the page served over http(s). */
(function () {
  'use strict';
  const NN = (window.NN = window.NN || {});

  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const GIS = 'https://accounts.google.com/gsi/client';
  let token = null; // { value, expires }

  // ---------- 1. COPY AND OPEN ----------

  async function copyRich(html, text) {
    if (navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([html], { type: 'text/html' }),
            'text/plain': new Blob([text], { type: 'text/plain' })
          })
        ]);
        return true;
      } catch (err) {
        // Fall through to the older way
      }
    }
    // Older way: select a hidden copy of the content and copy it
    const box = document.createElement('div');
    box.contentEditable = 'true';
    box.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;white-space:normal';
    box.innerHTML = html;
    document.body.appendChild(box);
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    const saved = sel.rangeCount ? sel.getRangeAt(0) : null;
    sel.removeAllRanges();
    sel.addRange(range);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch (err) {
      ok = false;
    }
    sel.removeAllRanges();
    if (saved) sel.addRange(saved);
    box.remove();
    return ok;
  }

  // Copy first (the page must still have focus), then open the new Doc
  async function copyAndOpen(html, text) {
    const ok = await copyRich(html, text);
    const win = window.open('https://docs.new', '_blank', 'noopener');
    return { copied: ok, opened: Boolean(win) || true };
  }

  // ---------- 2. SAVE TO DRIVE ----------

  const onHttp = () => /^https?:$/.test(location.protocol);

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) {
        if (window.google && window.google.accounts) return resolve();
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Couldn't reach Google sign-in. Check the internet connection."));
      document.head.appendChild(s);
    });
  }

  async function getToken(clientId) {
    if (token && token.expires > Date.now() + 60000) return token.value;
    if (!onHttp()) throw new Error('Google sign-in needs the page opened from a web address (http:// or https://), not straight from a file. See the README.');
    if (!clientId) throw new Error('Add your Google OAuth client ID first.');
    await loadScript(GIS);
    return new Promise((resolve, reject) => {
      try {
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: SCOPE,
          callback: (res) => {
            if (res.error) return reject(new Error(res.error_description || res.error));
            token = { value: res.access_token, expires: Date.now() + (Number(res.expires_in) || 3600) * 1000 };
            resolve(token.value);
          },
          error_callback: (err) => reject(new Error(err && err.type === 'popup_closed' ? 'Google sign-in was closed before it finished.' : (err && err.message) || 'Google sign-in failed.'))
        });
        client.requestAccessToken({ prompt: '' });
      } catch (err) {
        reject(err);
      }
    });
  }

  async function upload(accessToken, { title, html, fileId }) {
    const boundary = 'nova-notes-' + Math.random().toString(36).slice(2);
    const meta = fileId ? { name: title } : { name: title, mimeType: 'application/vnd.google-apps.document' };
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${html}\r\n--${boundary}--`;
    const url = fileId
      ? `https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=id,webViewLink`
      : 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
    const res = await fetch(url, {
      method: fileId ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error((data.error && data.error.message) || `Google Drive answered ${res.status}.`);
      err.status = res.status;
      throw err;
    }
    return { id: data.id, url: data.webViewLink || `https://docs.google.com/document/d/${data.id}/edit` };
  }

  // Create the Google Doc, or update the one this note made before
  async function saveToDrive({ clientId, title, html, fileId }) {
    let access = await getToken(clientId);
    try {
      return { ...(await upload(access, { title, html, fileId })), updated: Boolean(fileId) };
    } catch (err) {
      if (err.status === 401) {
        token = null;
        access = await getToken(clientId);
        return { ...(await upload(access, { title, html, fileId })), updated: Boolean(fileId) };
      }
      // The old Doc was deleted (or isn't ours any more): make a new one
      if (fileId && (err.status === 404 || err.status === 403)) return { ...(await upload(access, { title, html })), updated: false };
      throw err;
    }
  }

  NN.google = { copyRich, copyAndOpen, saveToDrive, onHttp };
})();
