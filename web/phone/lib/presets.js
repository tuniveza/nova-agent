// (Nova Phone's own copy of calendar/js/presets.js, 23 Oct 2026: the same day card kinds and title styles as the computer version's, kept here so the phone app stands on its own; its line icons are left out, as Nova Phone says what things are in words. Change both together.)
/* Calendar — presets.js
   Day card presets (birthday, Halloween, Christmas…), the title aesthetics, and the line icons.
   A preset only fills in starting values: title, theme, aesthetic, repeat and an info template.
   Everything stays editable after you pick one. */
(function () {
  'use strict';
  const NT = (window.NT = window.NT || {});

  // (the line icons are left out on the phone: it says what things are in words)
  const icon = () => "";
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
