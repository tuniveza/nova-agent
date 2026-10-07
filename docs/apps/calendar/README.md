<div align="center">

<img src="../../../web/calendar/assets/icon.svg" width="96" alt="The Nova Calendar icon: a glowing crescent-moon C with three stars">

# Nova Calendar

> **A Nova Agent panel.** Its code is in `web/calendar/` in Nova Agent's repo, and it opens inside Nova Agent at `/calendar/`. Online, Nova Bot serves it at the same address.


**A cosmic calendar of note cards and day cards, under a sky that follows the real moon.**


<img src="media/day-card.jpg" alt="Nova Calendar: October 2026 with the Moonlight Mixtape release day card open, showing its supernova artwork and a note card with its own generated picture" width="900">

### ✦ [Open Nova Calendar](https://nova-calendar.novacane-studio.workers.dev) ✦

<sub>Works in any modern browser · install it as an app · works offline · built into Nova Agent</sub>

</div>

---

Nova Calendar is Nova Agent's calendar, in Novacane Studios' style. You plan days with
**note cards** and **day cards**: every note paints its own small piece of the cosmos, and every
day sits under the real moon. It's a single folder of HTML, CSS and JavaScript with no build
step, no server and no install.

> **Formerly Nova Task.** Renamed to Nova Calendar in October 2026. Anything saved by the old
> version in the same browser is picked up automatically.

## What's new

| | |
|---|---|
| 🔔 **Sound button** | Soft cosmic sound effects on every press. The **Sound** button in the top bar switches them off and on. |
| 🔒 **Links button** | Opens the password-protected page with every Nova Agent address, live and testing. |
| 🪟 **Fit to the window** | Inside Nova Agent, or with `?embed=1`, the whole month and the chosen day fit the space with no scrolling. |
| ✦ **Built into Nova Agent** | Nova Agent serves it at `/calendar/` and it saves to Nova Agent, so the chat and the calendar always agree. |

<p align="center"><img src="media/top-bar.jpg" width="900" alt="The top bar: the six theme swatches, then the 🔒 Links, Sound, Note card and Day card buttons, with the month and Today on the right"></p>

## See it in action

<p align="center"><img src="media/demo.gif" width="800" alt="Adding a note card: choosing 22 October, pressing Note card, typing a title and a note while the picture paints itself, then saving it into the day"></p>

<p align="center"><sub>Pick a day, press <b>Note card</b>, write, save. The picture paints itself from your words.</sub></p>

## What it does

**Note cards**
- A title, the note itself, an author, and a start and finish time. A note can run over several days.
- Saving one stamps it with a log time.
- Each gets its own **generated space picture**, painted from its words while you write. Press
  **Regenerate** to roll a new one and keep it, pick a style (planet, galaxy, star nursery, binary
  stars, comet, black hole, constellation, eclipse, supernova or crescent moon), or **Save image**
  as a 1920×1080 PNG.

**Day cards**
- A title, an aesthetic, a theme, information about the day, a location and tags. Note cards on
  that date appear inside it.
- **Presets** fill in sensible starting values: Birthday, Anniversary, Trip, Studio Session,
  Release Day, Launch, Halloween, Bonfire Night, Christmas, New Year, Valentine's, Pancake Day,
  St Patrick's, Mothering Sunday, Easter, Father's Day, Solstice, Equinox, Meteor Shower, Full
  Moon and Snow Day.
- **Aesthetics** change how the day's name is set and the artwork behind it: Nebula, Supernova,
  Orbit, Constellation, Eclipse, Aurora and Celestial.
- A day card can **repeat every year**, which suits birthdays. It then counts the "orbits round
  the sun" since the first year.

**The real sky**
- Moon phases worked out with Meeus' algorithms, accurate to minutes. Full moons carry their
  traditional names.
- Solstices, equinoxes and the peaks of the major meteor showers.
- UK seasonal days, including Easter-based dates, Mothering Sunday and Bonfire Night. Tap one to
  turn it into a day card.

**Looks and sounds the part**
- **Six themes:** Novacane (magenta), Solar Flare (red-orange), Pulsar (cyan), Aurora (green and
  violet), Eclipse (gold) and Quasar (ultraviolet). A day card can have its own theme.
- **Sound effects** on every press, with a **Sound** button to switch them off (see below).
- **Keyboard:** <kbd>N</kbd> new note card, <kbd>D</kbd> day card, <kbd>T</kbd> today, arrow
  keys move between days, <kbd>PgUp</kbd>/<kbd>PgDn</kbd> change month.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="media/month.jpg" alt="October 2026 with today selected: a Studio Session day card and a note card with a star-nursery picture" width="100%"><br><sub><b>The month</b>, under the real moon.</sub></td>
    <td width="50%"><img src="media/halloween.jpg" alt="Halloween selected: an eclipse day card in Solar Flare colours with a black-hole note card" width="100%"><br><sub><b>Halloween</b>, with its own theme.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="media/note-card-editor.jpg" alt="Editing the Launch party set list note card, with its supernova picture, art style, Regenerate and Save image" width="100%"><br><sub><b>A note card</b> and the picture it painted.</sub></td>
    <td width="50%"><img src="media/day-card-editor.jpg" alt="A new day card from the Trip preset: a ringed-planet preview, the presets, title, date and aesthetics" width="100%"><br><sub><b>A day card</b> from the Trip preset.</sub></td>
  </tr>
</table>

<details>
<summary><b>More themes</b></summary>

| | | |
|---|---|---|
| <img src="media/theme-aurora.jpg" alt="Aurora theme"> | <img src="media/theme-solar-flare.jpg" alt="Solar Flare theme"> | <img src="media/theme-pulsar.jpg" alt="Pulsar theme, with Nova's Birthday day card keeping its own Novacane theme"> |
| Aurora | Solar Flare | Pulsar (the birthday card keeps its own theme) |

</details>

<sub>Every screenshot uses made-up note cards and day cards.</sub>

## Fit to the window

When Nova Calendar is shown inside another page (Nova Agent's Calendar tab and viewer), or opened
with **`?embed=1`** on the end of its address, it fits the space it's given:

- a slim top bar, and month rows that share the height, so the **whole month** is always in view;
- the **chosen day** beside the month on wide screens, or below it on narrow ones, scrolling on its own;
- the legend, backup buttons, footer, theme swatches, Sound, Links and Install step aside to save room.

| About 900 × 600 | About 430 × 600 |
|---|---|
| <img src="media/embed-wide.jpg" alt="Fit-to-window mode at about 900 by 600: the whole month on the left and 16 October's day card on the right, with no page scrolling" width="560"> | <img src="media/embed-narrow.jpg" alt="Fit-to-window mode at about 430 by 600: the whole month above and the chosen day below" width="260"> |

## Sound effects

Every press makes a soft cosmic sound: a tap, a dialog opening, a card saving, a card deleting.
They're made live with the Web Audio API (no sound files), tuned to one pentatonic scale and
kept quiet. The **Sound** button in the top bar switches them off and on, plays a little chime
when it does, and is remembered on each device. The same `js/sfx.js` makes the sounds in Nova
Notes and Nova Observatory.

## Inside Nova Agent

Nova Agent
serves it at **`/calendar/`**. There it saves to Nova Agent (`data/calendar.json`) instead of
only the browser, so note cards and day cards made by Nova Agent's chat appear on the calendar,
and the page refreshes when Nova Agent changes something. It opens in fit-to-window mode in
Nova Agent's Calendar tab.

## How it works

```mermaid
flowchart LR
    UI[index.html + js/app.js<br/>calendar, day panel, editors] --> STORE[js/store.js<br/>localStorage · JSON backup]
    UI --> SKY[js/sky.js<br/>moon phases, seasons, Easter, meteors]
    UI --> COS[js/cosmos.js<br/>seeded generative space art]
    UI --> THEMES[js/themes.js + js/presets.js]
    BG[js/backdrop.js<br/>star canvas] -.-> UI
    SFX[js/sfx.js<br/>sound effects] -.-> UI
    EMB[js/embed.js<br/>fit to the window] -.-> UI
```

- **Seeded art:** each note's picture comes from a seed (hashed from its words while you type,
  then kept), so the same note always paints the same picture.
- **No dependencies:** plain browser JavaScript and Canvas. The fonts load from Google Fonts;
  without a connection the page falls back to system fonts.

## Your data

On the web, everything is saved in this browser's `localStorage` under the key
`nova-calendar/v1` (anything saved before the rename, under `nova-task/v1`, is picked up
automatically); nothing is sent anywhere. Inside Nova Agent, it's saved to Nova Agent on the
studio computer instead.

Use **Export** to download a JSON backup and **Import** to merge one back in. Items with the same
id are replaced by the imported copy. Exported backups (`nova-calendar-backup-*.json`) are
ignored by git, so your own notes don't end up in the repo.

