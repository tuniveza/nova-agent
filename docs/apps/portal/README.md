<p align="center"><img src="../../../web/portal/icon-192.png" width="96" alt="Portal"></p>

# Portal

> **A Nova Agent panel.** Its code is in `web/portal/` in Nova Agent's repo, and it opens inside Nova Agent at `/portal/`. Online, Nova Bot serves it at the same address, and it installs on a phone.

**The studio's staff app, one sign-in for the whole of Nova Agent, and a planet for everyone.** A panel of [Nova Agent](https://github.com/tuniveza/nova-agent), for Novacane Studios.

Portal is where the staff work: enquiries, website chats, bookings, quests, alerts, Ask NovaBot and push notifications to the staff phones. It's also where you sign in (once, for Portal, Index and the admin pages), and where every member of the team has a profile with a unique planet, drawn from their id.

Portal's old address, `/app/`, opens Portal (with the same tab: `/app/?view=alerts` is `/portal/?view=alerts`). Phones that added Portal to the Home Screen keep working and keep getting notifications; adding Portal to the Home Screen gives the new icon.

<p align="center"><img src="media/planets.jpg" width="860" alt="48 generated planets: ringed gas giants, ocean worlds, molten worlds, ice worlds and rocky worlds, each one different"></p>

## The tabs

Along the bottom on a phone, down the side on a desktop:

| Tab | |
|---|---|
| **Enquiries · Chats · Calendar · Quests · Alerts · NovaBot** | The work tabs. See [the work tabs](#the-work-tabs). |
| **You** | Your planet (it's the tab's icon), your profile, your Index, and for admins the crew and the admin pages. |

The address follows the tab, so a reload or a link lands in the same place: `/portal/?view=enquiries` (or `chats`, `calendar`, `quests`, `alerts`, `bot`), `/portal/?view=me`, `/portal/?view=crew`, `/portal/?id=<someone>`. With no `?view=`, Portal opens on the starting tab from Options; a Nova Agent notification (`#nova`) opens Alerts.

<table>
  <tr>
    <td width="33%" valign="top"><img src="media/studio-signin.jpg" alt="The sign-in screen, with a Sign in button" width="100%"><br><sub><b>Sign in</b> with Portal.</sub></td>
    <td width="33%" valign="top"><img src="media/studio-enquiries.jpg" alt="The Enquiries tab with two new enquiries and buttons to email, call, make a booking link, read the chat and mark done" width="100%"><br><sub><b>Enquiries</b>: email, call, send a booking link, read the chat, mark done.</sub></td>
    <td width="33%" valign="top"><img src="media/studio-calendar-week.jpg" alt="The smart calendar: this week's sessions, hours booked, session value, busiest day, next free hour and one clash, above a month of glowing days" width="100%"><br><sub><b>The smart calendar</b>: the week at a glance, and days that glow as they fill.</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="media/studio-calendar-day.jpg" alt="Thursday picked: 56% full, a clash warning, a tight changeover warning, and two free slots" width="100%"><br><sub><b>A day</b>: how full it is, a clash, a tight changeover, and free slots.</sub></td>
    <td width="33%" valign="top"><img src="media/studio-quests.jpg" alt="Quests: the quest in progress, a repeating pulse, and today's plan" width="100%"><br><sub><b>Quests</b> from Nova Agent: what's on now and today's plan.</sub></td>
    <td width="33%" valign="top"><img src="media/studio-missions.jpg" alt="Missions with progress rings, deadlines and an at-risk count" width="100%"><br><sub><b>Missions</b>: progress, deadlines and anything at risk.</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="media/studio-alerts.jpg" alt="A booking alert with a green panel: Real booking, confirmed in Acuity" width="100%"><br><sub><b>Alerts</b>: every booking is checked with Acuity itself.</sub></td>
    <td width="33%" valign="top"><img src="media/studio-suite.jpg" alt="The Nova Agent sheet listing the panels" width="100%"><br><sub><b>The Nova Agent sheet</b>: every app, one tap away.</sub></td>
    <td width="33%" valign="top"><img src="media/studio-links.jpg" alt="All links: live addresses with an up or down check for each" width="100%"><br><sub><b>🔒 All links</b>, each checked as you open it.</sub></td>
  </tr>
  <tr>
    <td width="33%" valign="top"><img src="media/studio-changelog.jpg" alt="What's changed, by day and app, with what, why and better because; then everything the suite can do" width="100%"><br><sub><b>What's changed</b> and <b>everything the suite can do</b>.</sub></td>
    <td width="33%" valign="top"><img src="media/studio-options.jpg" alt="Options: theme swatches, text alignment and size, how times show, animations and the starfield" width="100%"><br><sub><b>Options</b>: theme, text, motion, sound and the starting tab.</sub></td>
    <td width="33%" valign="top"><img src="media/studio-bot-staff.jpg" alt="NovaBot in bookings mode answering a staff member with a booking link and a reminder that the deposit books it" width="100%"><br><sub><b>Ask NovaBot</b> in staff mode: a booking link, deposit first.</sub></td>
  </tr>
</table>

<p align="center">
  <img src="media/gif-free-slot.gif" alt="Animated: picking Thursday in the calendar, tapping the free 14:00 to 16:00 slot, and NovaBot bookings opening with the request filled in, then answering with a booking link" width="900"><br>
  <sub>Tap a free slot, and NovaBot · bookings opens with the request already written.</sub>
</p>


## Signing in

- **Sign in once, everywhere:** email and password give you a secure session that Portal, Index and the admin pages all trust. Signing out (from any of them) ends it everywhere at once.
- **Setting up:** the very first admin is created with the `ADMIN_PASSWORD` secret, to prove it's you. After that, admins **invite** people with a link (valid for 7 days), and each person chooses their own password. Nobody else ever knows it.
- **On the studio PC**, signing in here signs Nova Agent in to Nova Bot as you.
- **Nova Club and other native apps** can sign in through the same API and get an app token instead of a cookie.

## You, and the crew

- **Your profile:** your planet, big and animated, with your name, role and "member since". You can re-roll your planet (or go back to your original), change your name, open your own Index, and sign out.
- **The crew (admins):** everyone as a planet, with their role, status and last sign-in. Invite people, change roles, switch accounts off (which signs them out at once), and send fresh invite links.
- **Roles:**
  - **Admins** see and manage everything, including customers' facts and approvals in Index.
  - **Staff** see the studio's memory and their own partition.
- **The badge, on every Nova Agent panel:** `<nova-portal-badge>` shows your planet, your name and your role in the top bar. Tap it for your planet up close and links to your profile and your Index.
- **The Manual, on every panel:** `<nova-manual>` sits beside the badge. It has a **Guide**, **How it's built**, the **History** and **What's new** for every panel, with search. Press **?** on any panel, or add `#nova-manual` to the address.

<table><tr>
<td width="50%"><img src="media/profile.jpg" alt="A profile: the animated planet, the name, an admin pill and Open my Index"></td>
<td width="50%"><img src="media/crew.jpg" alt="The crew: everyone as a planet badge with their role and status"></td>
</tr></table>

## The work tabs

| Tab | What it does |
|---|---|
| **Enquiries** | Every enquiry NovaBot took. Email, call, make a booking link with the customer's details filled in, read the chat it came from, mark it done. |
| **Chats** | What customers asked NovaBot on the website (kept for 90 days). |
| **Calendar** | Every booking in Acuity's diary, as a month you can swipe, with Calendar's cards and planned quests alongside. See [the smart calendar](#the-smart-calendar). |
| **Quests** | Nova Agent's plan, synced from the studio computer: the quest on now, repeating pulses, today, Missions with progress rings, and every quest. Taps (Start, Done, +15 min, Not now, Skip, Pause) go straight back to Nova Agent. |
| **Alerts** | Every notification that reached a phone, newest first, with colour-coded labels, exact times, Call/Email buttons and an auto-delete switch. |
| **NovaBot** | Two chats. **Ask Nova** answers questions about the studio's bookings, enquiries and alerts (Nova Bot's `src/studio-ask.js`). **NovaBot · bookings** is NovaBot with the booking tools, talking to you as staff: get a link for a client, find, move, cancel or change a booking. Every change shows a summary and waits for a yes. |

## The smart calendar

- **The week at a glance**: sessions, hours booked and how full, session value, the
  busiest day, the next free hour, and any clashes.
- **Glowing days**: each day glows brighter as it fills; a nearly full day says FULL.
- **A day in detail**: hours booked, a fill meter, ⚠ clashes, ⏱ tight changeovers (under
  15 minutes), and free slots of an hour or more within opening hours.
- **One tap from a booking link**: tapping a free slot opens NovaBot · bookings with the
  request written for you. "✦ Ask Nova" buttons ask about the week or the day.

## Features

- **Real-booking checks.** A booking alert asks Acuity about that booking as it comes into
  view: "✓ Real booking: confirmed in Acuity", with the deposit paid, or "Cancelled" or
  "Not found". Tests are labelled as tests, so nothing fake can pass for a booking.
- **Push notifications that work with the app closed** (Nova Bot's `src/push.js`, and `web/portal/sw.js`; phones that installed Portal from `/app/` keep `/app/sw.js`).
  New enquiries, bookings (with every detail from Acuity's private calendar feed), and
  alerts from Nova Agent, Quest and Mission. Android gets rich notifications
  with their own buzz; iPhones get the plain version, so nothing is ever lost.
- **Pings.** With Portal open, an alert rings out with a bright ping (a different one for
  each kind) and drops a banner from the top.
- **Staff voice.** Tap the mic and say what to do ("show alerts", "call Eric", "new
  enquiries", "ask NovaBot what the prices are"); Whisper on Workers AI writes it down.
  Hands-free mode listens while the app is open for anything that starts with "Nova".
- **Quests from Nova Agent** (`src/agent-nova.js`): Nova Agent sends its plan here every
  time it changes, and picks up taps within about a second.
- **Ambient music** (`web/shared/ambient.js`, moved from `web/portal/`): Novacane's quiet,
  never-ending soundtrack made live with the Web Audio API (no audio files), now with a soft
  electric-piano phrase now and then. Inside Nova Agent, Portal's music button works the one
  player in Nova Agent's main page, so the music carries on across panels.
- **Sound effects** (`web/shared/sfx.js`): Novacane's glass bells, warm under-tones and soft
  breaths of air for taps, tabs, switches, sends and deletes, all in the music's key, and a
  two-note chime when NovaBot answers.
- **Six themes**: Cosmic, Ember, Aurora, Ocean, Gold and Mono, shared with the admin pages.
- **Options** (`web/portal/options.js`): theme, text alignment and size, how times show on
  alerts, animations, the drifting starfield, sound effects, pings, music volume and the
  starting tab (any work tab, or You). Saved on the device.
- **The suite sheet** (`web/portal/suite.js`): tap the Portal brand to see every Nova app,
  🔒 **All links** (every live and testing address, each checked on the spot), **What's
  changed** (every change by day and app: what, why and what's better), **everything the
  suite can do**, and the theme picker.

<table>
  <tr>
    <td width="50%"><img src="media/gif-themes.gif" alt="Animated: tapping through the six themes in Options" width="100%"><br><sub>Switching themes in Options.</sub></td>
    <td width="50%"><img src="media/gif-suite.gif" alt="Animated: opening Nova Agent sheet, scrolling the apps, opening All links, What's changed and the feature list" width="100%"><br><sub>Browsing the suite sheet.</sub></td>
  </tr>
</table>

<p align="center">
  <img src="media/studio-themes.jpg" alt="The same calendar screen in the Cosmic, Ember, Aurora, Ocean, Gold and Mono themes" width="100%"><br>
  <sub>One screen, six themes.</sub>
</p>

<p align="center">
  <img src="media/studio-desktop.jpg" alt="Portal on a desktop: tabs in a side rail, and alerts in two columns, including a booking checked in Acuity and a Quest alert" width="100%"><br>
  <sub>On a desktop, the tabs become a side rail and lists go two-up.</sub>
</p>

<details>
<summary><b>Ask Nova</b> (questions about the studio's own diary)</summary>
<br>
<p align="center"><img src="media/studio-ask-nova.jpg" alt="Ask Nova giving a rundown of the week: sessions, hours, a clash, a tight changeover and free time" width="360"></p>
</details>

**Behind the scenes:** Acuity's API can't change a booking's session type, price or paid
status, so those changes are queued for [Nova Agent](https://github.com/tuniveza/nova-agent),
the browser helper on the studio computer, which does them in Acuity's admin pages and
reports back (`src/agent-nova.js`). Every day at 06:00 UK time the Worker checks it can
still reach Acuity's API and alerts staff phones if not (`src/health.js`).

## The planets

<p align="center"><img src="media/hero.jpg" width="420" alt="A ringed gas giant up close: bands, a storm, rings in front of and behind the sphere"></p>

`planet/` is a pure, deterministic generator: `generatePlanet(seed, theme, overrides?)` then `renderPlanetSVG(planet, { size, animate })`. The same seed and theme always give the same planet, so nothing is stored but the seed.

- **Kinds:** banded gas giants, cratered rocky worlds, ocean worlds with continents, molten worlds with glowing cracks, ice worlds, and ringed giants.
- **Details:** each has a palette drawn from the theme's ramps, an atmosphere glow, clouds or bands, and maybe rings (split properly in front of and behind the planet), up to three moons, an aurora or a storm.
- **A real sphere:** surface detail is projected onto it, with limb darkening, a terminator shadow and a specular highlight. Small badges simplify themselves, and the 512px hero animates.
- **Speed:** 1,000 planets generate and render in about half a second.
- **Themes hold all the art direction:** palettes, surfaces, glow, rings, moons, naming and the starfield. The Nova look lives in `planet/themes/nova.js`. When the studio's own lore is ready, it becomes a new theme file, with no change to the generator. A test proves it with a "lore" theme.
- **Porting:** `planet/README.md` documents the exact random number generator and draw order, so a Kotlin port (for Nova Club) draws identical planets.

## The API (on Nova Bot's worker)

| | |
|---|---|
| `POST /auth/login` | `{ email, password, client? }` → session cookie, or an app token with `client: "app"` |
| `POST /auth/logout` | ends this session everywhere |
| `GET /auth/me` · `GET /auth/status` | who's signed in · `{ setupNeeded, signedIn, staff }` |
| `POST /auth/setup` | the first admin (with the `ADMIN_PASSWORD` secret) |
| `GET /auth/invite?token=` · `POST /auth/invite/accept` | accepting an invite |
| `GET /staff` · `POST /staff` · `POST /staff/:id/invite` | the crew, inviting, a fresh link (admins) |
| `GET /staff/:id` · `PATCH /staff/:id` | a profile; changing name, planet, role or status |
| `GET /staff/:id/planet.svg` | the planet badge (`?size=`, `?animate=1`) |
| `GET /staff/:id/index` | that person's Index partition and the studio's shared facts |

- **Passwords:** PBKDF2-SHA256, salted, 100,000 rounds.
- **Sessions:** a random token in an httpOnly, Secure cookie. Only its hash is stored, and signing out deletes it.
- **Brute force:** sign-in, setup and invite attempts are rate limited.
- **Cross-site changes:** changes must come from the site itself.

The code is in [nova-bot](https://github.com/tuniveza/nova-bot) under `src/portal/`.

## Portal on your phone (its own app)

Portal can be its own app on a phone's home screen, separate from Nova Agent: its own icon and
name, opening straight into Portal, full screen, with its own notifications. On the phone open
**/portal/?app=1** (in Safari on an iPhone, Chrome on Android), sign in, then **Share → Add to
Home Screen** (iPhone) or **⋮ → Add to Home screen / Install app** (Android). Opened from that icon,
Portal stays Portal (even when it reloads); anywhere else (a normal browser tab) Portal opens inside
Nova Agent as before. Tapping a notification on a phone with the Portal app opens Portal, on the
right tab (`web/shared/inside.js` decides; Nova Bot lets Portal's pages through; `sw.js` routes taps).

