# Console

Console is in Nova Agent's **Tools**. Type commands for the whole of Nova Agent instead of clicking. On the studio PC, admins can also open a real terminal there, or one on the VPSdime server.

## The Nova tab

Type a command and press Enter. **Tab** finishes a word, and **↑ ↓** go back through what you typed. Type **help** to see every command, or **help quests** for one.

| Type | What happens |
|---|---|
| `status` | How Nova Agent is doing: live or not, the online link, quests, and whether terminals can open here |
| `now` (or `plans`) | What's on now and what's next |
| `quests` | Your quests. Also: `quests add "Mix the EP" --minutes 45`, then `quests start`, `done`, `skip` or `snooze <id>`. The first 8 letters of an id are enough |
| `missions` | Your missions. Also: `missions new "Release the EP by December"` and `missions show <id>` |
| `calendar today` / `calendar week` | What's on the calendar. Also: `calendar add "Engineer in" 2026-10-20 14:00` |
| `notes` | Your shared notes. Also: `notes open <id>` and `notes new` |
| `board` | Your boards. Also: `board open` |
| `portal enquiries` | One of Portal's sections: enquiries, chats, clients, money, campaigns, outreach, social, approvals, tests, alerts |
| `approve campaign 12` | Approve something waiting (admins). It shows exactly what will go, then you type its number back to say yes. Anything else cancels. Also: `reject …`. Works for campaign, outreach, social, invoice, reminder and booking |
| `google` | Google's status. Also: `google sync contacts` (admins) |
| `fixer` | The Fixer (admins): `fixer check` and `fixer jobs` |
| `lossless` | Opens Lossless audio |
| `music on` / `off` / `next` / `seed` | The ambient music |
| `theme list` / `theme pulsar` / `theme own` | The look |
| `open <app>` | Opens an app or panel: portal, calendar, notes, board, index, lossless, visualizer, observatory, fixer, agent, quests, missions, manual |
| `agent "what's on today?"` | Asks Agent, and shows the answer here |
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

Online, through Nova Bot, they're always refused, and Nova Bot never passes them on. Only Nova commands work online.

### Setting up the VPS, once

1. Type `vps set <the VPS's address> <your user on it> [port]`. For example: `vps set 203.0.113.7 root`. This is saved on the PC in `data/console.json`. No password is ever saved.
2. Type `vps setup-key`. It asks for the VPS's password once, inside the terminal, and copies the PC's key there.
3. From then on, `vps` (or **+ VPS**) connects without a password.

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
