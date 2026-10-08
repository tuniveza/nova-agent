/* Phones: the toolbar is one row you swipe sideways. Its right edge fades while there's more
   to see, and stops fading once you've reached the end. */
(() => {
  'use strict';
  const bar = document.querySelector('.toolbar');
  if (!bar) return;
  const update = () => bar.classList.toggle('at-end', bar.scrollLeft + bar.clientWidth >= bar.scrollWidth - 4);
  bar.addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update, { passive: true });
  update();
})();
