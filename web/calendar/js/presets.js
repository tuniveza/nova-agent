/* Nova Calendar — presets.js
   Day card presets (birthday, Halloween, Christmas…), the title aesthetics, and the line icons.
   A preset only fills in starting values: title, theme, aesthetic, repeat and an info template.
   Everything stays editable after you pick one. */
(function () {
  'use strict';
  const NT = (window.NT = window.NT || {});

  // 24×24 line icons, drawn with currentColor so they pick up whatever colour sits around them
  const ICONS = {
    sparkle: '<path d="M12 2.5l1.9 7.6 7.6 1.9-7.6 1.9-1.9 7.6-1.9-7.6L2.5 12l7.6-1.9z" fill="currentColor" stroke="none"/>',
    cake: '<path d="M4 21h16M5 21v-6.5A2.5 2.5 0 0 1 7.5 12h9a2.5 2.5 0 0 1 2.5 2.5V21"/><path d="M5 16.5c2.3 1.4 4.7 1.4 7 0s4.7-1.4 7 0M12 12V9.5"/><path d="M12 8.5c-1.2-.9-1.2-2.6 0-4.5 1.2 1.9 1.2 3.6 0 4.5z" fill="currentColor"/>',
    pumpkin: '<path d="M12 7c-4.8 0-8 2.8-8 6.5S7.2 20 12 20s8-2.8 8-6.5S16.8 7 12 7z"/><path d="M12 7c-1.8 1.6-2.6 3.8-2.6 6.5S10.2 18.4 12 20M12 7c1.8 1.6 2.6 3.8 2.6 6.5S13.8 18.4 12 20M12 7V4.5c1.2 0 2.2.6 2.6 1.6"/>',
    tree: '<path d="M12 2.5l3.2 5H13l4 5.5h-2.4L19 19H5l4.4-6H7l4-5.5H8.8z"/><path d="M12 19v2.5"/>',
    heart: '<path d="M12 20s-7.5-4.6-9-9.3A4.8 4.8 0 0 1 12 7.3a4.8 4.8 0 0 1 9 3.4C19.5 15.4 12 20 12 20z"/>',
    burst: '<circle cx="12" cy="12" r="2"/><path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4M5.3 5.3l2.8 2.8M15.9 15.9l2.8 2.8M5.3 18.7l2.8-2.8M15.9 8.1l2.8-2.8"/>',
    egg: '<path d="M12 3c-3.6 0-6.5 5.6-6.5 10.2a6.5 6.5 0 0 0 13 0C18.5 8.6 15.6 3 12 3z"/><path d="M6.2 12.2l2.3-1.4 2.3 1.4 2.4-1.4 2.3 1.4 2.3-1.4"/>',
    snowflake: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6M9.6 4.2 12 6.6l2.4-2.4M9.6 19.8 12 17.4l2.4 2.4"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    moon: '<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.3 6.3 0 0 0 10.1 10.1z"/>',
    planet: '<circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="10" ry="3.2" transform="rotate(-20 12 12)"/>',
    rocket: '<path d="M12 2.5c3 2.2 4.8 6.2 4.2 10.8L14.5 16h-5l-1.7-2.7C7.2 8.7 9 4.7 12 2.5z"/><circle cx="12" cy="9.5" r="1.6"/><path d="M9.5 16 7.5 20l3-1.2M14.5 16l2 4-3-1.2"/>',
    meteor: '<circle cx="7.5" cy="16.5" r="3.5"/><path d="M10 14 20.5 3.5M13.5 15.5 21 8M8.5 10.5 16 3"/>',
    vinyl: '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="3"/><path d="M12 5.5a6.5 6.5 0 0 1 6.5 6.5"/>',
    wave: '<path d="M2.5 12h2l2-5 3 10 3-14 3 13 2-7 1.5 3h2.5"/>',
    balance: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor"/>',
    rings: '<circle cx="9" cy="13.5" r="5.5"/><circle cx="15" cy="13.5" r="5.5"/><path d="M13 5l2-2 2 2-2 2z"/>',
    clover: '<circle cx="12" cy="7.5" r="3.3"/><circle cx="7.6" cy="13" r="3.3"/><circle cx="16.4" cy="13" r="3.3"/><path d="M12 13.5c0 3 1 5.5 3 8"/>',
    pancake: '<ellipse cx="12" cy="16" rx="9" ry="3.2"/><path d="M3 16v-2.4c0-1.8 4-3.2 9-3.2s9 1.4 9 3.2V16M12 10.4V7c1.8 0 3 .8 3 2"/>',
    star: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6l-5.4 2.9 1.2-6-4.5-4.2 6.1-.7z"/>',
    // A speaker with sound coming out, and the same speaker switched off (the sound effects button)
    sound: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.3 6.2a8.5 8.5 0 0 1 0 11.6"/>',
    muted: '<path d="M11 5 6.5 9H3.5v6h3l4.5 4z"/><path d="m16 9.5 5 5M21 9.5l-5 5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="M15 5l-7 7 7 7"/>',
    right: '<path d="M9 5l7 7-7 7"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    pin: '<path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
    upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.1" fill="currentColor"/><circle cx="15" cy="15" r="1.1" fill="currentColor"/><circle cx="15" cy="9" r="1.1" fill="currentColor"/><circle cx="9" cy="15" r="1.1" fill="currentColor"/>'
  };

  const icon = (name, cls = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.sparkle}</svg>`;

  // theme: 'app' means "follow whatever the app theme is"
  const PRESETS = [
    { id: 'custom', label: 'Custom', icon: 'sparkle', title: '', theme: 'app', aesthetic: 'nebula', group: 'Personal' },
    { id: 'birthday', label: 'Birthday', icon: 'cake', title: 'Birthday', theme: 'novacane', aesthetic: 'supernova', repeat: true, group: 'Personal',
      info: 'Whose orbit: \nGift ideas: \nPlans: ' },
    { id: 'anniversary', label: 'Anniversary', icon: 'rings', title: 'Anniversary', theme: 'eclipse', aesthetic: 'celestial', repeat: true, group: 'Personal' },
    { id: 'trip', label: 'Trip', icon: 'planet', title: 'Away Mission', theme: 'aurora', aesthetic: 'orbit', group: 'Personal',
      info: 'Destination: \nDeparts: \nPack: ' },
    { id: 'session', label: 'Studio Session', icon: 'wave', title: 'Studio Session', theme: 'novacane', aesthetic: 'constellation', group: 'Studio',
      info: 'Room: \nArtist: \nBring: ' },
    { id: 'release', label: 'Release Day', icon: 'vinyl', title: 'Release Day', theme: 'quasar', aesthetic: 'supernova', group: 'Studio' },
    { id: 'launch', label: 'Launch', icon: 'rocket', title: 'Launch Day', theme: 'pulsar', aesthetic: 'orbit', group: 'Studio' },
    { id: 'halloween', label: 'Halloween', icon: 'pumpkin', title: 'Halloween', theme: 'solar', aesthetic: 'eclipse', repeat: true, group: 'Seasonal' },
    { id: 'bonfire', label: 'Bonfire Night', icon: 'burst', title: 'Bonfire Night', theme: 'solar', aesthetic: 'supernova', repeat: true, group: 'Seasonal' },
    { id: 'christmas', label: 'Christmas', icon: 'tree', title: 'Christmas Day', theme: 'aurora', aesthetic: 'celestial', repeat: true, group: 'Seasonal' },
    { id: 'newyear', label: 'New Year', icon: 'burst', title: "New Year's Day", theme: 'quasar', aesthetic: 'supernova', repeat: true, group: 'Seasonal' },
    { id: 'valentines', label: "Valentine's", icon: 'heart', title: "Valentine's Day", theme: 'novacane', aesthetic: 'nebula', repeat: true, group: 'Seasonal' },
    { id: 'pancake', label: 'Pancake Day', icon: 'pancake', title: 'Pancake Day', theme: 'eclipse', aesthetic: 'nebula', group: 'Seasonal' },
    { id: 'stpatricks', label: "St Patrick's", icon: 'clover', title: "St Patrick's Day", theme: 'aurora', aesthetic: 'aurora', repeat: true, group: 'Seasonal' },
    { id: 'mothers', label: "Mother's Day", icon: 'heart', title: 'Mothering Sunday', theme: 'novacane', aesthetic: 'celestial', group: 'Seasonal' },
    { id: 'easter', label: 'Easter', icon: 'egg', title: 'Easter Sunday', theme: 'pulsar', aesthetic: 'celestial', group: 'Seasonal' },
    { id: 'fathers', label: "Father's Day", icon: 'star', title: "Father's Day", theme: 'pulsar', aesthetic: 'orbit', group: 'Seasonal' },
    { id: 'solstice', label: 'Solstice', icon: 'sun', title: 'Solstice', theme: 'solar', aesthetic: 'eclipse', group: 'Cosmic' },
    { id: 'equinox', label: 'Equinox', icon: 'balance', title: 'Equinox', theme: 'aurora', aesthetic: 'aurora', group: 'Cosmic' },
    { id: 'meteor', label: 'Meteor Shower', icon: 'meteor', title: 'Meteor Shower', theme: 'pulsar', aesthetic: 'constellation', group: 'Cosmic',
      info: 'Best viewing: after midnight, away from city light.\nLook towards: ' },
    { id: 'fullmoon', label: 'Full Moon', icon: 'moon', title: 'Full Moon', theme: 'quasar', aesthetic: 'celestial', group: 'Cosmic' },
    { id: 'winter', label: 'Snow Day', icon: 'snowflake', title: 'Snow Day', theme: 'pulsar', aesthetic: 'celestial', group: 'Seasonal' }
  ];

  // How a day card's title is set. The CSS for each lives under .aes-<id> in nova.css,
  // and the header artwork for each is painted by cosmos.js.
  const AESTHETICS = [
    { id: 'nebula', label: 'Nebula', hint: 'Shimmering gas-cloud gradient' },
    { id: 'supernova', label: 'Supernova', hint: 'Blazing glow' },
    { id: 'orbit', label: 'Orbit', hint: 'Ringed planet, wide tracking' },
    { id: 'constellation', label: 'Constellation', hint: 'Star-chart type' },
    { id: 'eclipse', label: 'Eclipse', hint: 'Corona gold on black' },
    { id: 'aurora', label: 'Aurora', hint: 'Rippling polar light' },
    { id: 'celestial', label: 'Celestial', hint: 'Moonlit italic serif' }
  ];

  const byId = Object.fromEntries(PRESETS.map((p) => [p.id, p]));
  const get = (id) => byId[id] || byId.custom;

  NT.presets = { list: () => PRESETS, get, aesthetics: () => AESTHETICS, icon };
})();
