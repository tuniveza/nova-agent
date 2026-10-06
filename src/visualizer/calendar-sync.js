/* Nova Calendar inside Nova Agent.
   The calendar app saves in the browser (localStorage). This small script runs
   just before the app's store.js and makes it use Nova Agent's copy instead:
   - before the app loads, it fills the browser's copy from Nova Agent
   - whenever the app saves, the same data goes back to Nova Agent
   - when Nova Agent changes the calendar (from the chat), the page refreshes */
(function () {
  'use strict';
  var KEY = 'nova-calendar/v1';
  try {
    var req = new XMLHttpRequest();
    req.open('GET', '/calendar-api/data', false); // before the app reads it
    req.send();
    if (req.status === 200 && req.responseText) localStorage.setItem(KEY, req.responseText);
  } catch (e) {
    console.warn('[Nova Agent] could not load the calendar', e);
  }

  var setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function (key, value) {
    setItem.apply(this, arguments);
    if (this === window.localStorage && key === KEY) {
      fetch('/calendar-api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Nova-Visualizer': '1' }, body: value }).catch(function () {});
    }
  };

  // Refresh when Nova Agent changes something, unless an editor is open
  var pending = false;
  function refresh() {
    var editing = Array.prototype.some.call(document.querySelectorAll('dialog'), function (d) { return d.open; });
    if (editing) { pending = true; return; }
    location.reload();
  }
  document.addEventListener('close', function () { if (pending) location.reload(); }, true);
  try {
    new EventSource('/calendar-api/events').addEventListener('change', refresh);
  } catch (e) {}
  window.NOVA_AGENT_CALENDAR = true;
})();
