<div align="center">

<img src="../../../web/notes/assets/icon.svg" width="96" alt="The Notes icon: a glowing N with an orbit, among the stars">

# Notes

> **A Nova Agent panel.** Its code is in `web/notes/` in Nova Agent's repo, and it opens inside Nova Agent at `/notes/`. Online, Nova Bot serves it at the same address.


**A note editor that writes from the centre of the universe outwards.**

Google Docs–style writing in the Novacane cosmic look: centred by default, six colour themes, soft cosmic sounds, import from Word, HTML, Markdown and text, and send it all to Google Docs.

![Static web app](https://img.shields.io/badge/web%20app-no%20build%20step-B01D68?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/vanilla-JavaScript-7A1F86?style=flat-square)
![Google Docs](https://img.shields.io/badge/exports%20to-Google%20Docs-25194D?style=flat-square)
![Part of Nova Agent](https://img.shields.io/badge/part%20of-nova--suite-FF5FA8?style=flat-square)

<img src="media/hero.jpg" width="900" alt="Notes with the built-in welcome note open: notes list on the left, the glowing centred page in the middle, the outline on the right">

### ✦ [Open Notes](https://novacane-worker.novacane-studio.workers.dev/notes/) ✦

<sub>Works in any modern browser · install it as an app · works offline · also built into Nova Agent</sub>

</div>

---

## What's new

| | |
|---|---|
| 👥 **Shared and Local notes** | **Shared** notes are the whole team's: everyone signed in with Portal sees and edits them, on every device, and changes show up for the others within seconds. **Local** notes stay only on this device. Tap **Local / Shared** by "Saved" to move a note between the two (with Undo), and use **All · Shared · Local** above the list to pick what you see. New notes start Shared when you're signed in (Local when you're signed out or looking at Local). If two people change a shared note at the same time, both versions are kept ("… (conflicted copy)"). |
| 🔔 **Sound effects** | Soft cosmic sounds on every action. Switch them off or on in **View → Sound effects**. |
| 🔒 **All Nova Agent links** | **Help → 🔒 All Nova Agent links** opens the password-protected page with every Nova Agent address, live and testing. |
| ✦ **Inside Nova Agent** | Nova Agent serves its own copy at `/notes/`, so privacy-minded browsers don't block it there. Notes written there are kept on the studio computer. |

## See it in action

<p align="center"><img src="media/demo.gif" width="800" alt="Typing a new note: # and a space makes a heading, - makes a bulleted list, [] makes a checklist and > makes a quote, all centred on the page, then ticking a checklist item"></p>

<p align="center"><sub>Type <code>#</code>, <code>-</code>, <code>[]</code> or <code>&gt;</code> and a space at the start of a line. Everything lines up in the middle.</sub></p>

## What it does

**Writes like Google Docs**
- **Menus and a toolbar** you already know: File, Edit, View, Insert, Format, Tools and Help, with undo, redo, print, zoom, styles, fonts, sizes, colours and highlights.
- **Paragraph styles:** Title, Subtitle, Heading 1–3, Normal text, Quote and Code.
- **Lists:** bulleted, numbered and **checklists** you tick with a click; indent and outdent.
- **Tables** (pick a size, then add or remove rows and columns), **pictures** (upload, paste or drop, then resize and align), **links**, horizontal lines and **page breaks**.
- **Find and replace** (match case, whole words), **word count**, a live **outline** of your headings, and **undo that remembers everything**, including the tools the browser forgets.
- **Shortcuts as you type:** `#` heading, `-` list, `1.` numbered list, `[]` checklist, `>` quote and `---` for a line. Every Google Docs keyboard shortcut you'd expect is there too (press <kbd>Ctrl</kbd>+<kbd>/</kbd>).

**Centred by default.** Everything you write (headings, paragraphs, lists and tables) sits in the middle of the page until you choose otherwise. Exports keep it that way.

**In and out**
- **Import** Word (`.docx`), web pages (`.html`), Markdown (`.md`) and text (`.txt`): use *File → Import* or drop files onto the window. Text pasted from Google Docs or the web is cleaned up as it lands.
- **Export** to Google Docs, Word (`.doc`), a web page, Markdown, plain text or PDF (print), or a `.json` backup of one note or all of them.
- **Google Docs**, two ways:
  1. **Copy & paste (no set-up):** copies the note with its styling and opens a new Google Doc; press <kbd>Ctrl</kbd>+<kbd>V</kbd>.
  2. **Save to Google Drive (one click once set up):** signs in with Google, creates a real Google Doc, and updates that same Doc each time you save the note again.

**Looks and sounds the part**
- **Six themes** from Nova Agent: Novacane (magenta), Solar Flare (red-orange), Pulsar (cyan), Aurora (green and violet), Eclipse (gold) and Quasar (ultraviolet).
- **Two page styles:** *Cosmic* (a glowing glass page among twinkling stars) and *Paper* (white, exactly how the note exports and prints).
- **Sound effects:** gentle bells and sparkles as you work (see below).
- **Focus mode,** a pageless view, zoom, and a layout that works on phones and tablets.

**Private by default.** Notes are saved in your browser (IndexedDB) as you type. Nothing leaves it unless you export it or send it to Google Docs.

## Screenshots

| | |
|---|---|
| <img src="media/checklists.jpg" alt="The welcome note's checklist, with the first item ticked, and a centred quote"> | <img src="media/paper.jpg" alt="A fictional note on the Paper page style, matching the Google Docs export"> |
| **Checklists, lists and quotes**, all centred | **Paper page:** what Google Docs, Word and print will show |
| <img src="media/menus.jpg" alt="The Format menu open on Paragraph styles, with Heading 1 ticked"> | <img src="media/google-docs.jpg" alt="The Send to Google Docs dialog: copy and paste, or save straight to Google Drive"> |
| **Google Docs–style menus** with shortcuts | **Send to Google Docs:** copy and paste, or save straight to Drive |
| <img src="media/sound.jpg" alt="The View menu open, with Sound effects ticked at the bottom"> | <img src="media/help-links.jpg" alt="The Help menu open on 🔒 All Nova Agent links"> |
| **View → Sound effects**, ticked while sounds are on | **Help → 🔒 All Nova Agent links** |

<details>
<summary><b>Every colour theme, and a phone</b></summary>

| | |
|---|---|
| <img src="media/theme-aurora.jpg" alt="Aurora theme"> | <img src="media/theme-solar.jpg" alt="Solar Flare theme"> |
| Aurora | Solar Flare |
| <img src="media/theme-pulsar.jpg" alt="Pulsar theme"> | <img src="media/theme-eclipse.jpg" alt="Eclipse theme"> |
| Pulsar | Eclipse |
| <img src="media/theme-quasar.jpg" alt="Quasar theme"> | <img src="media/phone.jpg" width="260" alt="Notes on a phone, showing the welcome note"> |
| Quasar | On a phone |

</details>

<sub>Every screenshot uses a fresh browser with the built-in welcome note and a couple of made-up notes.</sub>

## Sound effects

Every press makes a soft cosmic sound: a tap, a menu opening, a dialog closing, an export sending, a note deleting. They're made live in the browser with the Web Audio API (there are no sound files), tuned to one pentatonic scale so they sound like one family, and kept quiet.

- **On or off:** *View → Sound effects*. It's ticked while they're on, and plays a little chime when you switch.
- **Remembered** on each device.
- **Shared:** the same `js/sfx.js` makes the sounds in Calendar and Observatory too.

## Inside Nova Agent

[Nova Agent](https://github.com/tuniveza/nova-agent), the studio computer's helper, serves its own copy of Notes at **`/notes/`** (for example `http://localhost:4545/notes/`) whenever it's running.

| | On the web | Inside Nova Agent |
|---|---|---|
| Address | novacane-worker.novacane-studio.workers.dev/notes/ | `/notes/` on Nova Agent |
| Where Local notes are kept | In that browser | On the studio computer, separate from the web app's |
| Shared notes | The team's, kept by Nova Bot | The same team notes |
| Privacy-minded browsers | May limit what a website saves | Fine: it's part of Nova Agent |

## How it works

```mermaid
flowchart LR
  subgraph Browser
    E[editor.js<br/>contenteditable page,<br/>own undo history] --> A[app.js<br/>menus, toolbar,<br/>library, dialogs]
    A --> S[(store.js<br/>IndexedDB)]
    A --> C[convert.js<br/>clean · Markdown ·<br/>styled export]
    X[sfx.js<br/>Web Audio sounds] -.-> A
  end
  F[.docx · .html · .md · .txt] -- import --> C
  C -- copy + docs.new --> G[Google Docs]
  C -- google.js<br/>Drive API, HTML → Doc --> G
  C -- download --> D[.doc · .html · .md · .txt · PDF]
```

- **`editor.js`**: the writing surface. It handles commands and paragraph styles, lists and checklists, tables, pictures, find and replace, and Markdown-style shortcuts. Undo works from snapshots of the page and selection, so every change can be undone.
- **`convert.js`**: cleans pasted and imported HTML down to what the editor understands, converts Markdown both ways, and builds the **styled export**: every block is inline-styled in the current theme's colours, made deep enough to read on white, so Google Docs and Word keep the look and the centring.
- **`google.js`**: the clipboard route (rich HTML plus plain text) and the Drive route (Google Identity Services token → multipart upload that Drive converts to a Google Doc, then `PATCH` to update it).
- **`store.js`**: notes in IndexedDB (falling back to localStorage), settings, backup and restore.
- **`sfx.js`**: Nova Agent's sound effects. One listener works out what kind of thing was pressed and plays the matching sound; an element can choose its own with `data-sfx`.
- **`themes.js`** and **`backdrop.js`**: Nova Agent's colour themes and the star field, shared with [Calendar](https://github.com/tuniveza/nova-calendar).

## Keyboard shortcuts

| | |
|---|---|
| Bold / italic / underline | <kbd>Ctrl</kbd> <kbd>B</kbd> / <kbd>I</kbd> / <kbd>U</kbd> |
| Strikethrough | <kbd>Alt</kbd> <kbd>Shift</kbd> <kbd>5</kbd> |
| Normal text / Heading 1–3 | <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>0</kbd>–<kbd>3</kbd> |
| Left / centre / right / justify | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>L</kbd> / <kbd>E</kbd> / <kbd>R</kbd> / <kbd>J</kbd> |
| Numbered / bulleted / checklist | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>7</kbd> / <kbd>8</kbd> / <kbd>9</kbd> |
| Link | <kbd>Ctrl</kbd> <kbd>K</kbd> |
| Find and replace | <kbd>Ctrl</kbd> <kbd>H</kbd> |
| Word count | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>C</kbd> |
| Page break | <kbd>Ctrl</kbd> <kbd>Enter</kbd> |
| New note · Import · Print | <kbd>Ctrl</kbd> <kbd>Alt</kbd> <kbd>N</kbd> · <kbd>Ctrl</kbd> <kbd>O</kbd> · <kbd>Ctrl</kbd> <kbd>P</kbd> |
| Focus mode | <kbd>Ctrl</kbd> <kbd>Shift</kbd> <kbd>F</kbd> |
| Every shortcut | <kbd>Ctrl</kbd> <kbd>/</kbd> |

## Tasks, and pasting Markdown

- **Paste Markdown** (from a chat, a code editor or a .md file) and it becomes real formatting:
  headings, lists, checklists, quotes, code, bold, links and tables.
- **Tasks:** any **heading 3** with the word **TASK** in it shows up in the **Tasks** list at the top
  of the side panel (a Markdown `### TASK …` line becomes one). Tap a task to jump to it; with
  three or more, type to find one. Set how it's going: **Waiting**, **Soon**, **Working on it**,
  **Taking longer than expected** or **Done**; the status shows beside the heading in the note and
  is saved with it (shared notes too). **Chat** hands the task, with what's written under it, to
  Agent to talk it through.
- The outline shows every heading in full (long ones wrap); nothing is cut off.
