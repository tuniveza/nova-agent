/* Calendar — presets.js
   Day card presets (birthday, Halloween, Christmas…), the title aesthetics, and the line icons.
   A preset only fills in starting values: title, theme, aesthetic, repeat and an info template.
   Everything stays editable after you pick one. */
(function () {
  'use strict';
  const NT = (window.NT = window.NT || {});

  // 24×24 line icons, one family: 2px strokes (set in the CSS), round ends and joins, drawn with
  // currentColor so they pick up whatever colour sits around them. Each says what it's for at a glance.
  const ICONS = {
    // What a note card is about (shown as a symbol when its day is too small for words)
    card: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/><path d="M7 13h6M7 17h4"/>',
    quest: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>',
    booking: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M16 2.5v4M8 2.5v4M3 10h18"/><path d="m9 15.5 2 2 4-4"/>',
    mic: '<rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M19 10.5v1a7 7 0 0 1-14 0v-1"/><path d="M12 18.5V22M8.5 22h7"/>',
    note: '<path d="M9 18V5.5l12-2.5v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    cap: '<path d="M21.4 10.9a1 1 0 0 0 0-1.8L12.8 5.2a2 2 0 0 0-1.6 0L2.6 9.1a1 1 0 0 0 0 1.8l8.6 3.9a2 2 0 0 0 1.6 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
    headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
    people: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
    dumbbell: '<rect x="2.5" y="9" width="3" height="6" rx="1"/><rect x="5.5" y="6.5" width="3" height="11" rx="1"/><rect x="15.5" y="6.5" width="3" height="11" rx="1"/><rect x="18.5" y="9" width="3" height="6" rx="1"/><path d="M8.5 12h7"/>',
    plate: '<path d="M3 2.5v6.5a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V2.5M7 2.5v19"/><path d="M21 15V2.5a5 5 0 0 0-5 5V13a2 2 0 0 0 2 2h3zm0 0v6.5"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    film: '<path d="m16 13 5.2 3.5a.5.5 0 0 0 .8-.4V7.9a.5.5 0 0 0-.8-.4L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
    book: '<path d="M2 4h6a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z"/><path d="M22 4h-6a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h7z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="m22 7-9 5.7a2 2 0 0 1-2 0L2 7"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
    user: '<circle cx="12" cy="8" r="4.5"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    sparkle: '<path d="M9.9 15.5a2 2 0 0 0-1.4-1.4l-6.1-1.6a.5.5 0 0 1 0-1l6.1-1.6a2 2 0 0 0 1.4-1.4l1.6-6.1a.5.5 0 0 1 1 0l1.6 6.1a2 2 0 0 0 1.4 1.4l6.1 1.6a.5.5 0 0 1 0 1l-6.1 1.6a2 2 0 0 0-1.4 1.4l-1.6 6.1a.5.5 0 0 1-1 0z"/>',
    // Day cards: birthdays, holidays, the sky
    cake: '<path d="M20 21v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8"/><path d="M4 16s.5-1 2-1 2.5 2 4 2 2.5-2 4-2 2.5 2 4 2 2-1 2-1M2 21h20M7 8v3M12 8v3M17 8v3M7 4h.01M12 4h.01M17 4h.01"/>',
    pumpkin: '<path d="M12 7c-2.5-1.3-6-.8-7.6 1.6-1.7 2.6-1.4 7.5 1.2 9.9 2 1.8 4.4 1.5 6.4 1.5s4.4.3 6.4-1.5c2.6-2.4 2.9-7.3 1.2-9.9C18 6.2 14.5 5.7 12 7z"/><path d="M12 7c-1.6 2.7-1.6 10.3 0 13M12 7c1.6 2.7 1.6 10.3 0 13M12 7V4.5c0-.8.7-1.5 2-1.5"/>',
    tree: '<path d="m17 14 3 3.3a1 1 0 0 1-.7 1.7H4.7a1 1 0 0 1-.7-1.7L7 14h-.3a1 1 0 0 1-.7-1.7L9 9h-.2A1 1 0 0 1 8 7.3L12 3l4 4.3a1 1 0 0 1-.8 1.7H15l3 3.3a1 1 0 0 1-.7 1.7z"/><path d="M12 22v-3"/>',
    heart: '<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7z"/>',
    flower: '<circle cx="12" cy="12" r="2.5"/><path d="M12 9.5C10 6 10.5 3 12 3s2 3 0 6.5M14.5 12C18 10 21 10.5 21 12s-3 2-6.5 0M12 14.5c2 3.5 1.5 6.5 0 6.5s-2-3 0-6.5M9.5 12C6 14 3 13.5 3 12s3-2 6.5 0"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.4-.5-2-1-3-1.1-2.1-.2-4.1 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.2.4-2.3 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    party: '<path d="M5.8 11.3 2 22l10.7-3.8"/><path d="M11 13c1.9 1.9 2.8 4.2 2 5-.8.8-3.1-.1-5-2-1.9-1.9-2.8-4.2-2-5 .8-.8 3.1.1 5 2z"/><path d="m22 2-2.2.8a2.9 2.9 0 0 0-2 3.1c.1.9-.6 1.6-1.5 1.6h-.4c-.9 0-1.6.6-1.8 1.4L14 10M22 13l-.8-.3c-.9-.3-1.8.2-2 1.1-.1.7-.7 1.2-1.4 1.2H17M11 2l.3.8c.3.9-.2 1.8-1.1 2-.7.1-1.2.7-1.2 1.4V7M4 3h.01M22 8h.01M15 2h.01M22 20h.01"/>',
    burst: '<path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/><circle cx="12" cy="12" r="2"/>',
    ghost: '<path d="M9 10h.01M15 10h.01"/><path d="M12 2a8 8 0 0 0-8 8v12l3-3 2.5 2.5L12 19l2.5 2.5L17 19l3 3V10a8 8 0 0 0-8-8z"/>',
    egg: '<path d="M12 22c6.2 0 7.9-5.6 7.5-10C19.1 7.7 15.5 2 12 2S4.9 7.7 4.5 12C4.1 16.4 5.8 22 12 22z"/><path d="m5.5 13.5 2.2-1.5 2.1 1.5 2.2-1.5 2.1 1.5 2.2-1.5 2.2 1.5"/>',
    snowflake: '<path d="M12 2v20M4.9 7l14.2 10M4.9 17 19.1 7"/><path d="m9.5 3.5 2.5 2 2.5-2M9.5 20.5l2.5-2 2.5 2M3.5 10.2l3.1-.6-.9-3M20.5 13.8l-3.1.6.9 3M3.5 13.8l3.1.6-.9 3M20.5 10.2l-3.1-.6.9-3"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M6.3 17.7l-1.4 1.4M19.1 4.9l-1.4 1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z"/>',
    planet: '<circle cx="12" cy="12" r="5.5"/><path d="M7.3 15.7C4 18 2.4 20 3.1 20.9c1.3 1.6 7.5-1.4 12.6-6.5S22.6 4.4 21 3.1c-.9-.7-2.9.9-5.2 4.2"/>',
    luggage: '<rect x="4" y="6" width="16" height="14" rx="2.5"/><path d="M8.5 6V4a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2M9 10v6M15 10v6"/><path d="M8 20v1.5M16 20v1.5"/>',
    rocket: '<path d="M4.5 16.5c-1.5 1.3-2 5-2 5s3.7-.5 5-2c.7-.8.7-2.1-.1-2.9a2.2 2.2 0 0 0-2.9-.1z"/><path d="m12 15-3-3a22 22 0 0 1 2-4A12.9 12.9 0 0 1 22 2c0 2.7-.8 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.6-3 2-4c1.6-1.1 5 0 5 0M12 15v5s3-.6 4-2c1.1-1.6 0-5 0-5"/>',
    meteor: '<circle cx="8" cy="16" r="4"/><path d="M11 13 20 4M14 16.5l6-6M7.5 10l6-6"/>',
    vinyl: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="2"/><path d="M6 12a6 6 0 0 1 1.8-4.2M18 12a6 6 0 0 1-1.8 4.2"/>',
    wave: '<path d="M2 10v4M6 6v12M10 3v18M14 8v8M18 5v14M22 10v4"/>',
    balance: '<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/>',
    rings: '<circle cx="9" cy="14.5" r="5.5"/><circle cx="15" cy="14.5" r="5.5"/><path d="m12 2.5 2 2.25L12 7l-2-2.25z"/>',
    clover: '<path d="M16.2 7.8 2 22"/><path d="M4 12a2.8 2.8 0 1 1 3.8-4.2A2.8 2.8 0 1 1 12 4a2.8 2.8 0 1 1 4.2 3.8A2.8 2.8 0 1 1 20 12a2.8 2.8 0 1 1-3.8 4.2A2.8 2.8 0 1 1 12 20a2.8 2.8 0 1 1-4.2-3.8A2.8 2.8 0 1 1 4 12"/><path d="m7.8 7.8 8.4 8.4"/>',
    pancake: '<ellipse cx="12" cy="9" rx="8.5" ry="3"/><path d="M3.5 9v3c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3V9M3.5 12v3c0 1.7 3.8 3 8.5 3s8.5-1.3 8.5-3v-3"/>',
    star: '<path d="M11.5 2.3a.5.5 0 0 1 1 0l2.3 4.7a2.1 2.1 0 0 0 1.6 1.2l5.2.7a.5.5 0 0 1 .3.9l-3.8 3.7a2.1 2.1 0 0 0-.6 1.9l.9 5.1a.5.5 0 0 1-.8.6l-4.6-2.4a2.1 2.1 0 0 0-2 0L6.4 21a.5.5 0 0 1-.8-.6l.9-5.1a2.1 2.1 0 0 0-.6-1.9L2.2 9.8a.5.5 0 0 1 .3-.9l5.1-.7a2.1 2.1 0 0 0 1.6-1.2z"/>',
    // Controls
    sound: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="M16 9a5 5 0 0 1 0 6M19.4 18.4a9 9 0 0 0 0-12.8"/>',
    muted: '<path d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6A1.4 1.4 0 0 1 5.4 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"/><path d="m16 9 6 6M22 9l-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    pin: '<path d="M20 10c0 5-5.5 10.2-7.4 11.8a1 1 0 0 1-1.2 0C9.5 20.2 4 15 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    dice: '<path d="m21.6 3.6-1.2-1.2a1.2 1.2 0 0 0-1.7 0L2.4 18.6a1.2 1.2 0 0 0 0 1.7l1.3 1.3a1.2 1.2 0 0 0 1.7 0L21.6 5.4a1.2 1.2 0 0 0 0-1.8M14 7l3 3M5 6v4M19 14v4M10 2v2M7 8H3M21 16h-4M11 3H9"/>'
  };

  // An icon: decorative next to words (the default), or with a name (label) when it stands alone,
  // so screen readers say it and a pointer shows it as a tooltip
  const icon = (name, cls = '', label = '') =>
    `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${label ? `role="img" aria-label="${String(label).replace(/[&<>"]/g, '')}"><title>${String(label).replace(/[&<>"]/g, '')}</title>` : 'aria-hidden="true">'}${ICONS[name] || ICONS.card}</svg>`;

  // theme: 'app' means "follow whatever the app theme is"
  const PRESETS = [
    { id: 'custom', label: 'Custom', icon: 'sparkle', title: '', theme: 'app', aesthetic: 'nebula', group: 'Personal' },
    { id: 'birthday', label: 'Birthday', icon: 'cake', title: 'Birthday', theme: 'novacane', aesthetic: 'supernova', repeat: true, group: 'Personal',
      info: 'Whose orbit: \nGift ideas: \nPlans: ' },
    { id: 'anniversary', label: 'Anniversary', icon: 'rings', title: 'Anniversary', theme: 'eclipse', aesthetic: 'celestial', repeat: true, group: 'Personal' },
    { id: 'trip', label: 'Trip', icon: 'luggage', title: 'Away Mission', theme: 'aurora', aesthetic: 'orbit', group: 'Personal',
      info: 'Destination: \nDeparts: \nPack: ' },
    { id: 'session', label: 'Studio Session', icon: 'wave', title: 'Studio Session', theme: 'novacane', aesthetic: 'constellation', group: 'Studio',
      info: 'Room: \nArtist: \nBring: ' },
    { id: 'release', label: 'Release Day', icon: 'vinyl', title: 'Release Day', theme: 'quasar', aesthetic: 'supernova', group: 'Studio' },
    { id: 'launch', label: 'Launch', icon: 'rocket', title: 'Launch Day', theme: 'pulsar', aesthetic: 'orbit', group: 'Studio' },
    { id: 'halloween', label: 'Halloween', icon: 'ghost', title: 'Halloween', theme: 'solar', aesthetic: 'eclipse', repeat: true, group: 'Seasonal' },
    { id: 'bonfire', label: 'Bonfire Night', icon: 'flame', title: 'Bonfire Night', theme: 'solar', aesthetic: 'supernova', repeat: true, group: 'Seasonal' },
    { id: 'christmas', label: 'Christmas', icon: 'tree', title: 'Christmas Day', theme: 'aurora', aesthetic: 'celestial', repeat: true, group: 'Seasonal' },
    { id: 'newyear', label: 'New Year', icon: 'party', title: "New Year's Day", theme: 'quasar', aesthetic: 'supernova', repeat: true, group: 'Seasonal' },
    { id: 'valentines', label: "Valentine's", icon: 'heart', title: "Valentine's Day", theme: 'novacane', aesthetic: 'nebula', repeat: true, group: 'Seasonal' },
    { id: 'pancake', label: 'Pancake Day', icon: 'pancake', title: 'Pancake Day', theme: 'eclipse', aesthetic: 'nebula', group: 'Seasonal' },
    { id: 'stpatricks', label: "St Patrick's", icon: 'clover', title: "St Patrick's Day", theme: 'aurora', aesthetic: 'aurora', repeat: true, group: 'Seasonal' },
    { id: 'mothers', label: "Mother's Day", icon: 'flower', title: 'Mothering Sunday', theme: 'novacane', aesthetic: 'celestial', group: 'Seasonal' },
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
