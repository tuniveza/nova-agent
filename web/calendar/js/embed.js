// Shown inside another app (Nova Agent's viewer or its Calendar tab): fit the calendar to
// the space it's given, so nothing needs scrolling. Loaded in the <head>, before the page
// is drawn. Add ?embed=1 to the address to see it on its own.
(() => {
  "use strict";
  let inside = false;
  try {
    inside = window.self !== window.top;
  } catch (err) {
    inside = true;
  }
  if (inside || /[?&]embed=1\b/.test(location.search)) document.documentElement.classList.add("embed");
})();
