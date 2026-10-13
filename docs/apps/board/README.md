# Board

A table to lay things out on. Bring notes, a stretch of the calendar, Agent's answers, question cards, sticky notes, pictures, files and links onto it, and move them around with the mouse (or a finger), like papers on a real table. Pin the ones that should stay put.

## What's new

- Board joins Nova Agent's Apps: a table for notes (with their times), the calendar (a day, week, month or year), Agent's questions and answers, question cards, sticky notes, text, links, pictures and files, moved around with the mouse and pinned in place.

## What it does

- **The table.** Drag empty table to move around. The wheel (or a pinch) zooms in and out where the pointer is; Shift and the wheel moves sideways. The buttons at the top zoom too: **−**, **100%** (back to the middle), **+** and **Show every card**. With the table selected, the arrow keys move around, **+** and **−** zoom and **0** goes back to 100%.
- **Cards.** Drag a card to move it, its bottom-right corner to make it bigger or smaller. A card you touch comes to the front. Each lies at a slight angle, like paper (straight if your device asks for less motion).
- **Pin.** The pin at the top of a card keeps it where it is: it can't be dragged or resized until you unpin it. A pinned card shows a little pin head.
- **Remove and put back.** The **×** on a card removes it, with **Undo** for a few seconds; removed cards wait in the bin (top right) for a week, with **Put back**.
- **Boards.** Keep as many boards as you like (up to 50): pick one at the top left, rename it, make a new one, or delete one (press delete twice).

## Adding things

- **Add** (top): a **Question card** (a question and room for the answer), **Ask Agent**, a **Sticky note** (six colours), **Text**, a **Link**, a **Picture or file**, or the calendar: **a day**, **a week**, **a month** or **a year**.
- **Notes, calendar & Agent** (top): a drawer with
  - **Notes**: your notes (the shared ones and this device's), newest first, with a search box. A note card shows its title, the start of what it says, and when it was made and last changed. Double-click it (or press its open button) to open it in Notes.
  - **Calendar**: today, tomorrow, this week, next week, this month, next month and this year. A calendar card lists what's on, day by day (a year card counts each month), with arrows to go back and forward.
  - **Agent**: what you've asked Agent before, with the answers.
  Drag one onto the table, or press it to put it in the middle.
- **Ask Agent** cards: type a question and press **Ask** (or Enter). The answer appears on the card (and in your Agent conversation). **Ask something else** clears it for a new question.
- **From outside Nova Agent**: drop a picture, a file, a link or some text from the desktop or another browser tab onto the table, or paste one (Ctrl+V) with nothing else selected. Links show their page's title, a line about it and its little icon. Pictures (JPEG, PNG, WebP, GIF), PDFs, text files, audio (MP3, WAV, M4A) and MP4 videos can go on a board, up to 25 MB each.

## The keyboard

With a card selected: the arrow keys move it (Shift for bigger steps), **P** pins or unpins it, **Delete** removes it and **Enter** goes into its text. Tab moves from card to card.

## Where it's kept

Each person's own boards, on the studio computer (`data/boards/<person>.json`), saved a moment after every change. Pictures and files are kept beside them (`data/board-files/`), under names Nova Agent makes up. Your browser keeps a copy too, so a board opens straight away; with the studio computer off, changes wait in the browser and save when it's back. Online, Board reaches the studio computer through Nova Bot, for signed-in staff only. An admin can look at everyone's boards (`/board-api/boards?who=everyone`); changing a board is for its owner.

## How it works

- `web/board/`: the page (`index.html`), its look (`css/board.css`, in the theme's colours) and the table (`js/board.js`).
- `src/board.ts`: each person's boards, every card checked and trimmed before it's saved.
- `src/board-files.ts`: pictures and files, behind a `BoardFileStore` so a store on the studio's VPS can take over later.
- `src/board-link.ts`: a link's title and icon, only from public web pages (addresses on this computer or the studio's network are refused, each redirect checked again).
- `src/board-routes.ts`: the addresses (`/board-api/…`, `/actions/board…`, `/board-files/…`), relayed online (`src/relay.ts` here, `src/agent-relay.js` in Nova Bot).

## Tests

`test/board.spec.ts`: each person's own boards, an admin looking at everyone's, a stale page told about a newer save, saving only from Nova Agent's pages, what a card may hold, pictures and files (type checks, made-up names), links only to public pages, and the relay's list. `node scripts/check-fit.mjs --only board` checks it fits from phones to 4K.
