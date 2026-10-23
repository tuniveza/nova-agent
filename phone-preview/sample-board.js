// The phone preview's Board: made-up boards (the Welcome board and a release board, no real people), saved in
// memory, with the addresses Board uses: the boards, saving one, deleting one, how big a file may be, a link's
// preview, a picture or file put on a board, and the calendar's data for a calendar card.
(() => {
  "use strict";
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (mins) => new Date(Date.now() - mins * 60000).toISOString();
  const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const day = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return ymd(d); };
  const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
  let n = 0;
  const id = () => `c${(++n).toString(16).padStart(6, "0")}`;
  const card = (kind, x, y, w, h, z, more) => ({ id: id(), kind, x, y, w, h, z, turn: 0, pinned: false, created: iso(3000), updated: iso(3000), ...more });
  const hint = (x, y, text, z) => card("text", x, y, 250, 96, z, { text, hint: true });
  const boards = [
    { id: "welcome01", name: "Welcome", created: iso(5000), updated: iso(5000), welcome: true, view: { x: 0, y: 0, zoom: 0.8 }, cards: [
      card("text", -330, -470, 660, 120, 1, { text: "Welcome to Board ✦\nA table for everything: lay it out, move it around, pin what matters." }),
      card("file", -700, -300, 420, 290, 2, { asset: "/board/assets/welcome/nebula.mp4", fileType: "video/mp4", fileName: "A video", title: "A video plays right on the table" }),
      hint(-700, 4, "↖ drop your own videos, pictures and sounds", 3),
      card("image", -230, -300, 360, 250, 4, { asset: "/board/assets/welcome/nebula.webp", fileType: "image/webp", fileName: "A picture", title: "A picture" }),
      card("file", 180, -300, 300, 150, 5, { asset: "/board/assets/welcome/chime.mp3", fileType: "audio/mpeg", fileName: "A calm chime", title: "A sound" }),
      card("sticky", 180, -110, 260, 200, 7, { colour: "rose", text: "Drag me anywhere.\nGrab my corner to make me bigger." }),
      card("sticky", -230, -20, 280, 200, 9, { colour: "teal", text: "I'm pinned 📌\nTap my pin to let me move.", pinned: true }),
      card("question", 80, 120, 320, 230, 10, { text: "What's the next song we finish?", answer: "Write the answer, notes or next steps here." }),
      card("agent", 430, 120, 360, 260, 11, { title: "What should I work on first this week?", answer: "This is an example answer. **Ask Agent anything** on an Ask Agent card and its answer lands right here.\n\n- It shows lists\n- and [links](https://example.com)", asked: iso(1560) }),
      card("note", -700, 110, 300, 190, 12, { noteId: "n1", title: "An example note", text: "Notes come onto the table from the drawer, with when they were made and changed.", noteCreated: iso(1560), noteUpdated: iso(20) }),
      card("calendar", -380, 210, 440, 260, 13, { span: "week", start: monday() }),
      card("link", 820, -300, 300, 140, 14, { url: "https://example.com/", title: "Example Studios", text: "Links show their page's title and picture." }),
    ] },
    { id: "nightdrive", name: "Night Drive release", created: iso(9000), updated: iso(300), view: { x: 200, y: 120, zoom: 1 }, cards: [
      card("sticky", 40, 40, 220, 200, 1, { text: "Book the video shoot", colour: "amber", pinned: true }),
      card("sticky", 270, 50, 220, 200, 3, { text: "Teaser clips a week before each single", colour: "sky" }),
      card("question", 200, 160, 300, 230, 2, { text: "Which single goes first?", answer: "Night Drive, then Lowlands." }),
      card("link", 900, 40, 320, 140, 4, { url: "https://example.com/moodboard", title: "Moodboard", text: "Colours and type for the covers" }),
      card("text", 900, 600, 560, 420, 5, { text: "Launch show plan\nDoors 7pm, support at 8, Night Drive at 9. Merch table by the door; the photographer stays for the encore. Guest list closes the day before." }),
      card("calendar", 40, 700, 320, 300, 6, { span: "month", start: day(0).slice(0, 8) + "01" }),
      card("image", 1500, 40, 160, 120, 7, { fileId: "b-20261023-aaaaaaaaaaaa", fileType: "image/png", fileName: "cover-draft.png", title: "cover-draft.png" }),
    ] },
  ];
  const calendar = { notes: [
    { id: "e1", title: "Vocal session · Maya Rose", start: `${day(0)}T11:00`, end: `${day(0)}T14:00` },
    { id: "e2", title: "Weekly planning", start: `${monday()}T09:30`, end: `${monday()}T10:00`, repeat: { freq: "weekly", interval: 1 } },
    { id: "e3", title: "Mastering · Lowlands EP", start: `${day(1)}T13:00`, end: `${day(1)}T15:00` },
    { id: "e4", title: "Studio closed", start: `${day(4)}T00:00`, end: `${day(4)}T23:59`, allDay: true },
  ], days: [{ date: day(3), title: "Release day: Night Drive" }] };
  let fileN = 0;
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (p === "/board-api/boards" && method === "GET") return { ok: true, me: { id: "jordan", name: "Jordan", role: "admin" }, boards: JSON.parse(JSON.stringify(boards)) };
    const put = p.match(/^\/board-api\/boards\/([a-z0-9-]{6,40})$/);
    if (put && method === "PUT") {
      const b = { ...body.board, updated: new Date().toISOString() };
      if (b.welcome !== true) delete b.welcome;
      const i = boards.findIndex((x) => x.id === put[1]);
      if (i >= 0) boards[i] = b; else boards.push(b);
      return { ok: true, board: JSON.parse(JSON.stringify(b)) };
    }
    const rm = p.match(/^\/actions\/board\/(.+)\/remove$/);
    if (rm) { const i = boards.findIndex((x) => x.id === decodeURIComponent(rm[1])); if (i < 0) return { status: 404, body: { ok: false, message: "No such board." } }; boards.splice(i, 1); return { ok: true }; }
    if (p === "/board-api/limits") return { ok: true, maxBytes: 95 * 1024 * 1024, max: "95 MB", here: false };
    if (p === "/board-api/link") { const url = u.searchParams.get("url") || ""; let host = url; try { host = new URL(url).hostname; } catch (e) { /* (as typed) */ } return { ok: true, link: { url, title: `${host[0].toUpperCase()}${host.slice(1)}`, description: "A page's title and description show on its card (made up in the preview).", icon: "" } }; }
    if (p === "/actions/board-files" && method === "POST") return { ok: true, file: { id: `b-20261023-${String(++fileN).padStart(12, "0")}`, type: "" } };
    if (p === "/calendar-api/data") return JSON.parse(JSON.stringify(calendar));
    return undefined;
  });
})();
