// One place for settings: the gear on Nova Agent's top bar. Besides Nova Agent's own (sound,
// music, theme, bars), it opens the settings of the panel that's showing, when that panel has
// its own (Portal's options). A panel offers them by having one of:
//   window.PortalApp.openOptions()      Portal
//   window.NovaPanelSettings.open()     any other panel
// Desktop: a button at the top of the Panels window. Phone: a button in the gear's sheet (phone.js).
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);

  // The open panel's settings, if it has any: { name, open }
  function panel() {
    const viewer = $('viewer');
    const frame = $('viewer-frame');
    if (!viewer || viewer.hidden || !frame) return null;
    let w;
    try {
      w = frame.contentWindow;
      const fn =
        (w.PortalApp && typeof w.PortalApp.openOptions === 'function' && (() => w.PortalApp.openOptions())) ||
        (w.NovaPanelSettings && typeof w.NovaPanelSettings.open === 'function' && (() => w.NovaPanelSettings.open()));
      if (!fn) return null;
      return { name: ($('viewer-name') && $('viewer-name').textContent.trim()) || 'Panel', open: fn };
    } catch (err) {
      return null; // not this site's page
    }
  }
  window.NovaSettings = { panel };

  // Desktop: "<Panel> settings" at the top of the Panels window, when there are some
  const suite = $('suite');
  const top = suite && suite.querySelector('.suite-top');
  if (!top) return;
  const row = document.createElement('div');
  row.className = 'bar-mode';
  row.hidden = true;
  row.innerHTML = '<button type="button" class="chip" id="suite-panel-settings" data-sfx="open"></button>';
  const look = $('look-settings');
  top.insertBefore(row, look || null);
  const button = row.firstElementChild;
  function refresh() {
    const p = panel();
    row.hidden = !p;
    if (p) button.textContent = `${p.name} settings`;
  }
  new MutationObserver(() => suite.open && refresh()).observe(suite, { attributes: true, attributeFilter: ['open'] });
  button.addEventListener('click', () => {
    const p = panel();
    suite.close();
    if (p) p.open();
  });
})();
