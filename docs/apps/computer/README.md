# Computer

The VPS at a glance, live: what its Claude sessions are showing right now, Claude Code's state and its jobs, how busy the VPS is, and how Nova is doing. It's for admins. **It only shows**: it never types into a session, restarts anything or changes a setting.

## What's new

- Computer joins Nova Agent's Tools: the VPS's screen (its Claude sessions, live and read-only), Claude Code, CPU, memory and disk with the last half hour as small graphs, every part running on the VPS, the status page, the latest updates, the Fixer and the last backup. Portal → Admin → Computer has a big **Open Computer** to it.

## What it shows

- **The VPS's screen**: each Claude session on the VPS has a chip along the top. **Nova-VPS (Remote Control)** is the one you drive from the Claude app on your phone; each job handed to the VPS has its own while it works. The box shows the session's last 60 lines, in its own colours, and keeps to the bottom as new lines come (scroll up to read back; it stays where you are).
- **Jobs on the VPS**: every job handed to the VPS, newest first: **Working**, **Done** or **Stopped**, how long it took, and what it was asked. Tap one to read its last words in the box.
- **Claude Code**: its version, whether it's signed in, whether Nova-VPS is connected, how many jobs are working and how many finished today, and what it's working on (the newest part of `HANDOFF.md`). On your phone: Claude app → Code → Nova-VPS.
- **The VPS**: CPU, memory, disk and how long since it last restarted, with CPU and memory over the last 30 minutes, and every part running on it (Nova Bot, Nova Agent, the web server, the mail sender) with a green, amber or red dot.
- **Nova**: the status page's parts with their dots, the last 5 updates to Nova Agent and Nova Bot (times in the UK's time), the Fixer (how many fixes wait for you, its last check and looks check, and **Open the Fixer**) and when the last nightly backup was.
- It's live every 4 seconds while it's on screen, and pauses while it isn't (another panel showing, or the tab hidden).
- One screen: the page never scrolls; the screen, the jobs and each card scroll inside themselves. On a phone the whole board scrolls inside its own box; on a phone held sideways the screen and the cards sit side by side.

## Inside Nova Agent

Computer is in the Panels window and on the bar, under Tools. It's for admins: sign in to Portal as an admin. It reads the VPS, so it only shows anything on the VPS's Nova Agent (https://nova.novacane.co.uk/agent/computer); on the studio PC it says so. The page is called Computer; inside it, the machine is "the VPS".

## How it works

- `src/computer.ts` gathers everything for `GET /computer-api/state` (admins only, like the Fixer: online, Nova Bot passes it on over the link for admins; both link lists allow just this one read-only address).
- The screen: `tmux list-windows` and `tmux capture-pane -p -e` for Nova Agent's own user (`nova-agent`). Nova Agent's service has a private `/tmp`, so tmux's folder is shared into it (`/etc/systemd/system/nova-agent.service.d/tmux.conf` and `/etc/tmpfiles.d/nova-agent-tmux.conf`, made by Nova Bot's `vps/agent-setup.sh`). Colours become HTML on the server (`ansiToHtml`: every character escaped, other escapes dropped).
- Jobs: `/srv/nova-agent/work/logs/<when>-<name>.log` and `.task` (from `work/bin/run-job.sh`); a job is done when its log ends with `=== DONE`.
- **No secrets leave**: every line from a session, a log, the handoff or an update passes `redact()`: the values of Nova Agent's own keys (read from its environment, never sent) and anything shaped like a key or token (`sk-…`, `Bearer …`, `NAME_KEY=…`, long random strings, JWTs) become •••.
- The VPS: `/proc/stat` and `/proc/meminfo` every 30 seconds (the last half hour kept in memory), `statfs` for the disk, `systemctl is-active` for the parts. Nova: the status page (`/status.json`), `git log` of the VPS's Nova Agent and Nova Bot, the Fixer's own state, and the last backup from the VPS's status service (`127.0.0.1:8788/status`, its token made from Nova Agent's key).

## Tests

`test/computer.spec.ts`: secrets never leave (key values, `sk-`, `Bearer`, `NAME_KEY=`, long random strings, while paths and short git hashes stay), colours become safe HTML (and markup never gets through), jobs (working or done, how long, their task and last words), the handoff's newest part, the whole state (with no secrets anywhere in it), the studio PC's message, and admins only (anyone else gets 403). Nova Bot's `test/agent-relay.spec.js`: the link passes on only `GET /computer-api/state`, for admins.
