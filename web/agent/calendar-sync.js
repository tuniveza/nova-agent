/* Calendar inside Nova Agent.
   The calendar app saves in the browser (localStorage). This small script runs
   just before the app's store.js and makes it use Nova Agent's copy instead:
   - before the app loads, it fills the browser's copy from Nova Agent
   - whenever the app saves, the same data goes back to Nova Agent, saying which
     revision this page loaded, so changes made elsewhere meanwhile are merged
     in rather than overwritten (see src/calendar/page.ts)
   - a save that doesn't get through (Nova Agent restarting) is kept in the
     browser, shown in a banner, and tried again until it does, even after a reload
   - when Nova Agent changes the calendar (from the chat), the page refreshes */
(function () {
  'use strict';
  var KEY = 'nova-calendar/v1';
  var UNSAVED = 'nova-calendar/unsaved'; // { value, rev } not yet saved to Nova Agent
  var rev = null; // the revision this page has
  var getItem = Storage.prototype.getItem;
  var setItem = Storage.prototype.setItem;
  var removeItem = Storage.prototype.removeItem;

  function request(method, body, baseRev) {
    var req = new XMLHttpRequest();
    req.open(method, '/calendar-api/data', false); // before the app reads it
    if (body) {
      req.setRequestHeader('Content-Type', 'application/json');
      req.setRequestHeader('X-Nova-Visualizer', '1');
      if (baseRev !== null && baseRev !== undefined) req.setRequestHeader('X-Nova-Rev', String(baseRev));
    }
    req.send(body || null);
    return req;
  }

  // A change left unsaved last time goes first, then the calendar is loaded
  try {
    var left = JSON.parse(getItem.call(localStorage, UNSAVED) || 'null');
    if (left && left.value) {
      var put = request('PUT', left.value, left.rev);
      if (put.status === 200) removeItem.call(localStorage, UNSAVED);
    }
  } catch (e) {}
  // The first time this browser's Calendar joins Nova Agent's calendar (online, it used to keep its
  // own), what it had is kept aside once, never overwritten: localStorage 'nova-calendar/before-nova-agent'
  var JOINED = 'nova-calendar/joined';
  var BACKUP = 'nova-calendar/before-nova-agent';
  try {
    var had = getItem.call(localStorage, KEY);
    if (had && !getItem.call(localStorage, JOINED) && !getItem.call(localStorage, BACKUP)) setItem.call(localStorage, BACKUP, had);
  } catch (e) {}
  try {
    var get = request('GET');
    if (get.status === 200 && get.responseText) {
      setItem.call(localStorage, KEY, get.responseText);
      setItem.call(localStorage, JOINED, '1');
      rev = JSON.parse(get.responseText).rev;
    }
  } catch (e) {
    console.warn('[Nova Agent] could not load the calendar', e);
  }

  // A small banner for saves that haven't got through, and anything Nova Agent says back
  var banner = null;
  function say(text, kind) {
    if (!banner) {
      banner = document.createElement('div');
      banner.setAttribute('role', 'status');
      banner.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;max-width:min(560px,calc(100vw - 32px));padding:10px 14px;border-radius:10px;font:14px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35);';
      document.body.appendChild(banner);
    }
    banner.style.background = kind === 'error' ? '#5a1622' : '#22183d';
    banner.style.color = '#fff';
    banner.textContent = text;
    banner.hidden = !text;
  }
  var hideSoon;
  function sayFor(text, ms) {
    say(text);
    clearTimeout(hideSoon);
    hideSoon = setTimeout(function () { say(''); }, ms);
  }

  // One save at a time; the newest waiting value goes next
  var sending = false;
  var waiting = null;
  var retry;
  function send() {
    if (sending || waiting === null) return;
    var value = waiting;
    waiting = null;
    sending = true;
    setItem.call(localStorage, UNSAVED, JSON.stringify({ value: value, rev: rev }));
    fetch('/calendar-api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Nova-Visualizer': '1', 'X-Nova-Rev': String(rev) }, body: value })
      .then(function (r) { return r.json().then(function (res) { return { status: r.status, res: res }; }); })
      .then(function (out) {
        if (!out.res.ok) throw new Error(out.res.pcOffline ? 'the studio computer is off' : out.res.message || out.res.error || 'Nova Agent said no (' + out.status + ')');
        rev = out.res.rev;
        if (waiting === null) removeItem.call(localStorage, UNSAVED);
        if (out.res.messages && out.res.messages.length) sayFor(out.res.messages.join(' '), 9000);
        else if (banner && !banner.hidden && banner.dataset.unsaved) { banner.dataset.unsaved = ''; sayFor('Saved.', 2500); }
      })
      .catch(function (err) {
        // Not saved: keep it, say so, and try again
        if (waiting === null) waiting = value;
        say('Not saved to Nova Agent yet (' + (err && err.message ? err.message : 'no answer') + '). Trying again…', 'error');
        if (banner) banner.dataset.unsaved = '1';
        clearTimeout(retry);
        retry = setTimeout(send, 5000);
      })
      .then(function () {
        sending = false;
        send();
      });
  }

  Storage.prototype.setItem = function (key, value) {
    setItem.apply(this, arguments);
    if (this === window.localStorage && key === KEY) {
      waiting = value;
      send();
    }
  };

  // Refresh when Nova Agent changes something, unless an editor is open or a save is on its way
  var pending = false;
  function refresh() {
    var editing = Array.prototype.some.call(document.querySelectorAll('dialog'), function (d) { return d.open; });
    if (editing || sending || waiting !== null) { pending = true; return; }
    location.reload();
  }
  document.addEventListener('close', function () { if (pending) refresh(); }, true);
  setInterval(function () { if (pending) refresh(); }, 2000);
  try {
    new EventSource('/calendar-api/events').addEventListener('change', refresh);
  } catch (e) {}
  window.NOVA_AGENT_CALENDAR = true;
})();
