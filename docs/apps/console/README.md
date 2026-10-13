# Console

Console is in Nova Agent's **Tools**. Type commands for the whole of Nova Agent instead of clicking. On the studio PC, admins can also open a real terminal there, or one on the VPSdime server.

## The Nova tab

Type a command and press Enter, or tap one in the row of commands above (Today, Now, Quests, Calendar, Notes, Boards, Enquiries, Clients, Money, Social, Approvals, Google, Computer, Search…, Ask Agent…, Help, Clear). **Tab** finishes a word, and **↑ ↓** go back through what you typed. Type **help** for every command in groups (Start here, Plans, Apps, Studio, Tools, Server, Admin, Console), each with what it does and an example, or **help quests** for one. A typo gets a "Did you mean …?", and some other words work too (`inbox`, `tasks`, `cal`, `server`, `find`, `terminal`, `ssh`…).

Everything is centred and easy to read: Console sits in a centred column, with bigger text, headings in the theme's colours, lined-up tables, and help with the command in pink and its example in green. On a phone, help stacks each command over what it does.

| Type | What happens |
|---|---|
| `today` | Your day at a glance: now and next, quests, the calendar, new or open enquiries |
| `status` | How Nova Agent is doing: live or not, the online link, quests, and whether terminals can open here |
| `search <words>` | Looks through quests, the calendar, boards, notes, Index and enquiries at once |
| `whoami` / `version` | Who's signed in; which version of Nova Agent this is |
| `now` (or `plans`) | What's on now and what's next |
| `quests` | Your quests. Also: `quests add "Mix the EP" --minutes 45`, then `quests start`, `done`, `skip` or `snooze <id>`. The first 8 letters of an id are enough |
| `missions` | Your missions. Also: `missions new "Release the EP by December"` and `missions show <id>` |
| `calendar today` / `calendar week` | What's on the calendar. Also: `calendar add "Engineer in" 2026-10-20 14:00` |
| `notes` | Your shared notes. Also: `notes open <id>` and `notes new` |
| `board` | Your boards. Also: `board open` |
| `enquiries`, `chats`, `clients`, `money`, `campaigns`, `outreach`, `social`, `approvals`, `alerts`, `tests` | One of Portal's sections (the same as `portal enquiries` and so on) |
| `approve campaign 12` | Approve something waiting (admins). It shows exactly what will go, then you type its number back to say yes. Anything else cancels. Also: `reject …`. Works for campaign, outreach, social, invoice, reminder and booking |
| `google` | Google's status. Also: `google sync contacts` (admins) |
| `fixer` | The Fixer (admins): `fixer check` and `fixer jobs` |
| `lossless` | Opens Lossless audio |
| `music on` / `off` / `next` / `seed` | The ambient music |
| `theme list` / `theme pulsar` / `theme own` | The look |
| `open <app>` | Opens an app or panel: portal, calendar, notes, board, index, lossless, visualizer, observatory, fixer, agent, quests, missions, manual |
| `agent "what's on today?"` (or `ask`) | Asks Agent, and shows the answer here |
| `computer` (or `desk`) | Nova Bot on Cloudflare and on the VPS side by side, and which one is live: versions, the PC link, VPS memory, disk, services, last data copy and backup, the timed jobs (admins) |
| `deploy status` | What's live where: Cloudflare's version, the VPS's, the studio computer |
| `backup` | Backs up the VPS's database now (admins; asks you to type yes first) |
| `admin crew` | Everyone on the crew (admins). Also: `admin invite` and `admin pages` |
| `index search <words>` | Searches what Nova knows |
| `logs` | The studio computer's recent log (admins) |
| `shell` | A terminal on the studio computer (admins, on that computer only) |
| `vps` | The VPSdime server (admins, on the studio computer only): `vps set <address> <user> [port]`, `vps setup-key`, `vps show` |

Every command does exactly what you could do with the mouse as yourself, and nothing more. Nothing is sent, posted, booked or approved without a person typing the item's number back. Agent can't use Console.

## Terminals: the studio PC and the VPS

**+ Shell** opens a terminal on the studio computer. **+ VPS** opens one on the VPSdime server, using ssh with the computer's own key (`~/.ssh/id_ed25519`). Each opens in its own tab. Copy, paste, scrolling back and resizing all work. If the page reloads, its terminals are still there.

Terminals only open when all of these are true:

- Console is opened on the studio computer itself (at `localhost`).
- You're an admin.
- The request comes from Console's own page.

Online, through Nova Bot, they're always refused, and Nova Bot never passes them on. Only Nova commands work online. Instead, Console online shows an **Open Console on this computer** button: on the studio computer it opens `http://localhost:4545/console/?here=1`, Console on its own page on the computer itself, where **+ Shell** and **+ VPS** work. (Nova Agent's pages normally move to Nova Agent online; this one address stays on the computer, for the terminals.)

### The VPS

The VPS is already set: the studio's VPSdime server, `root@185.185.126.195` (port 22), and the studio PC's key is already on it, so **+ VPS** connects straight away. To use another server: `vps set <address> <user> [port]` (saved on the PC in `data/console.json`; no password is ever saved), then `vps setup-key` once (it asks for that server's password inside the terminal and copies the PC's key there).

## On a phone

A row of extra keys sits under the terminal: Tab, Ctrl, Esc, the arrows, `|`, `~` and `/`. Tap **Ctrl**, then a letter, for Ctrl+letter. **A−** and **A+** change the text size. Your choice is remembered on this device.

## How it's built

- `web/console/`: the page. It uses xterm.js 6 (copied into `web/console/vendor/`, nothing from the internet) with the theme's colours.
  - `js/commands.js`: the command language.
  - `js/console.js`: the tabs, the typing line and the terminals.
- `src/console.ts`: the PC side. Terminals run through node-pty, and their output comes back as server-sent events. Each terminal has a random token. One that nobody watches closes after 15 minutes. Nova Agent's own secret settings are left out of the terminal's environment.
- `src/relay.ts` and Nova Bot's `src/agent-relay.js` only pass on `GET /console-api/state` (everyone) and `/console-api/logs` (admins).
- node-pty has a native part. After `npm install`, build it once with `npm install-scripts approve node-pty && npm rebuild node-pty`, or `cd node_modules/node-pty && npx node-gyp rebuild`. Without it, Nova commands still work and terminals say what's missing.
- Checks:
  - `test/console.spec.ts`
  - `node scripts/check-console.mjs http://localhost:4545`, a click-through
  - `node scripts/check-fit.mjs … --only console`
