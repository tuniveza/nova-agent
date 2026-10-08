// Shown inside Nova Agent (its viewer, or any other frame): <html class="embed">, so a panel can
// fit the space it's given (a slimmer header, scrolling inside). Load it in the <head>, before
// the page is drawn. Add ?embed=1 to the address to see it on its own. Calendar has its own copy.
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
