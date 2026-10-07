/* Nova Notes — themes.js
   Every colour theme in one place. A theme is a set of CSS custom properties, so it can be put on the
   whole page (the app theme). The star backdrop and the exported documents read
   the same values, so everything matches the theme.
   To add a theme: copy one block below, give it a new id, and change the hex codes. */
(function () {
  'use strict';
  const NN = (window.NN = window.NN || {});

  const THEMES = [
    {
      // The house look, taken from novacane.co.uk and the Nova Club app
      id: 'novacane', name: 'Novacane', tag: 'Magenta nebula',
      void: '#06040D', deep: '#100816', panel: '#1C1129', panel2: '#241640',
      text: '#EBD3E7', muted: '#B997B5',
      accent: '#B01D68', accent2: '#7A1F86', accent3: '#25194D',
      hi: '#FF5FA8', soft: '#FFD1EA', gold: '#F2D9A0', lilac: '#C7A4FF', onAccent: '#FFFFFF'
    },
    {
      // Red-orange: a star throwing off a flare
      id: 'solar', name: 'Solar Flare', tag: 'Red-orange',
      void: '#0B0403', deep: '#160805', panel: '#24100A', panel2: '#2F150C',
      text: '#F7DDCF', muted: '#C99C88',
      accent: '#D9361E', accent2: '#F2701D', accent3: '#4A1408',
      hi: '#FF9548', soft: '#FFD8BE', gold: '#FFD27A', lilac: '#FFB38A', onAccent: '#1A0603'
    },
    {
      // Cyan: the cold blue beam of a spinning neutron star
      id: 'pulsar', name: 'Pulsar', tag: 'Cyan',
      void: '#020810', deep: '#06111C', panel: '#0B1C2A', panel2: '#0F2537',
      text: '#D4EEF6', muted: '#8AB3C2',
      accent: '#0A7EA4', accent2: '#2563EB', accent3: '#0A2342',
      hi: '#3DEBFF', soft: '#C9F6FF', gold: '#F4F1C9', lilac: '#8FD3FF', onAccent: '#FFFFFF'
    },
    {
      // Green curtains with violet edges
      id: 'aurora', name: 'Aurora', tag: 'Green & violet',
      void: '#03090A', deep: '#071312', panel: '#0D1E1C', panel2: '#122826',
      text: '#D6F5EC', muted: '#8FBAAE',
      accent: '#0B8A6B', accent2: '#6D45E8', accent3: '#0E2A33',
      hi: '#5CFFC0', soft: '#D3FFEE', gold: '#F3E9A1', lilac: '#A99BFF', onAccent: '#FFFFFF'
    },
    {
      // Black sun, gold corona
      id: 'eclipse', name: 'Eclipse', tag: 'Gold corona',
      void: '#050404', deep: '#0D0B09', panel: '#17140F', panel2: '#201B14',
      text: '#F1E6D2', muted: '#B5A589',
      accent: '#D9A441', accent2: '#B07A2A', accent3: '#221A10',
      hi: '#FFCF6E', soft: '#FFEFD0', gold: '#FFE3A3', lilac: '#FFE3A3', onAccent: '#140F06'
    },
    {
      // Deep violet-blue, the light of a far-off galaxy core
      id: 'quasar', name: 'Quasar', tag: 'Ultraviolet',
      void: '#05030F', deep: '#0B0719', panel: '#151030', panel2: '#1C1640',
      text: '#E2DDFB', muted: '#A49CCB',
      accent: '#5B3DF5', accent2: '#B23AEE', accent3: '#141047',
      hi: '#A98BFF', soft: '#E4DAFF', gold: '#FFE1F4', lilac: '#C7B8FF', onAccent: '#FFFFFF'
    }
  ];

  // Which theme field fills which CSS custom property
  const VARS = {
    void: '--void', deep: '--deep', panel: '--panel', panel2: '--panel-2', text: '--text', muted: '--muted',
    accent: '--accent', accent2: '--accent-2', accent3: '--accent-3', hi: '--hi', soft: '--soft',
    gold: '--gold', lilac: '--lilac', onAccent: '--on-accent'
  };

  const byId = Object.fromEntries(THEMES.map((t) => [t.id, t]));
  const get = (id) => byId[id] || byId.novacane;

  // Inline style string, for a day card or a calendar cell that wears its own theme
  const style = (id) => {
    const t = get(id);
    return Object.entries(VARS).map(([k, v]) => `${v}:${t[k]}`).join(';');
  };

  // Put a theme on an element (the page root for the app theme)
  const apply = (el, id) => {
    const t = get(id);
    for (const [k, v] of Object.entries(VARS)) el.style.setProperty(v, t[k]);
    el.dataset.theme = t.id;
  };

  NN.themes = { list: () => THEMES, get, style, apply, palette: get };
})();
