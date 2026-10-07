<p align="center"><img src="../../../web/crew/icon-192.png" width="96" alt="Crew"></p>

# Crew

> **A Nova Agent panel.** Its code is in `web/crew/` in Nova Agent's repo, and it opens inside Nova Agent at `/crew/`. Online, Nova Bot serves it at the same address.


**One sign-in for the whole Nova Agent, and a planet for everyone.** A panel of [Nova Agent](https://github.com/tuniveza/nova-agent), for Novacane Studios.

Sign in once and you're signed in to Studio, Nova Index and the admin pages. Every member of the team gets a unique planet, drawn from their id: their badge and their identity across the suite. Each planet is the face of that person's own partition of [Nova Index](https://github.com/tuniveza/nova-index), the suite's shared memory.

<p align="center"><img src="media/planets.jpg" width="860" alt="48 generated planets: ringed gas giants, ocean worlds, molten worlds, ice worlds and rocky worlds, each one different"></p>

## What it does

- **Sign in once, everywhere:** email and password give you a secure session that Studio, Nova Index and the admin pages all trust. Signing out (from any of them) ends it everywhere at once.
- **Setting up:** the first admin is created with the studio's current shared password, to prove it's you. After that, admins **invite** people with a link (valid for 7 days), and each person chooses their own password. Nobody else ever knows it.
- **Your profile:** your planet, big and animated, with your name, role and "member since". You can re-roll your planet (or go back to your original), change your name, and open your own Nova Index.
- **The crew (admins):** everyone as a planet badge, with their role, status and last sign-in. Invite people, change roles, switch accounts off (which signs them out at once), and send fresh invite links.
- **Roles:**
  - **Admins** see and manage everything, including customers' facts and approvals in Nova Index.
  - **Staff** see the studio's memory and their own partition.
- **Nova Club and other native apps** can sign in through the same API and get an app token instead of a cookie.
- **The badge, on every Nova app:** `<nova-portal-badge>` shows your planet (turning, with a halo in its colour blended with the app's theme), your name and your role in the top bar of Studio, Nova Index, the admin pages, Nova Agent, Nova Notes, Nova Calendar and Nova Observatory. Tap it for your planet up close, its name, and links to your profile and your Nova Index.
- **The Nova Manual, on every Nova app:** `<nova-manual>` sits beside the badge (or floats in the corner where there's no top bar yet, like a sign-in screen). It opens a panel for every app in the suite: a **Guide** to using it, **How it's built**, its **History** as a timeline, and **What's new** (the last week's changes and what's being worked on but not saved yet), with search across all of it. It opens on the app you're in; press **?** on any Nova app, or add `#nova-manual` to the address.
  - **On Nova Bot's worker** it uses your Portal sign-in.
  - **In Nova Agent and the apps it serves** it shows who Nova Agent works for, found by itself: the studio's first admin, or whoever pressed **Connect as me** on it.
  - **On Nova Notes' and Nova Calendar's own sites** you **Connect** it once in Crew, which gives that site a read-only token: your name, role and planet, nothing else.

<table><tr>
<td width="50%"><img src="media/profile.jpg" alt="A profile: the animated planet, the name, an admin pill and Open my Nova Index"></td>
<td width="50%"><img src="media/crew.jpg" alt="The crew: everyone as a planet badge with their role and status"></td>
</tr></table>

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
| `POST /auth/setup` | the first admin (with the studio's current password) |
| `GET /auth/invite?token=` · `POST /auth/invite/accept` | accepting an invite |
| `GET /staff` · `POST /staff` · `POST /staff/:id/invite` | the crew, inviting, a fresh link (admins) |
| `GET /staff/:id` · `PATCH /staff/:id` | a profile; changing name, planet, role or status |
| `GET /staff/:id/planet.svg` | the planet badge (`?size=`, `?animate=1`) |
| `GET /staff/:id/index` | that person's Nova Index partition and the studio's shared facts |
| `POST /auth/connect` | `{ return_to }` → a read-only badge token for another Nova Agent site |

- **Passwords:** PBKDF2-SHA256, salted, 100,000 rounds.
- **Sessions:** a random token in an httpOnly, Secure cookie. Only its hash is stored, and signing out deletes it.
- **Brute force:** sign-in, setup and invite attempts are rate limited.
- **Cross-site changes:** changes must come from the site itself.

The code is in [nova-bot](https://github.com/tuniveza/nova-bot) under `src/portal/`.

