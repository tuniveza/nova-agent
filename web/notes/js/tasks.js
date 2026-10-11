/* Notes — tasks.js: Quests in a note.
   Every heading (2 or 3) with the word QUEST in it is a quest (TASK still counts, for older notes).
   They're listed at the top of the side panel (above the outline): tap one to jump to it, type to
   find one, set how it's going (its mode: Waiting, Soon, Working On It, Nearly Finished, Taking
   longer than expected, Questions, Done), hand it to Agent, or take it off Quests. "+ New quest"
   adds one at the end of the note.

   Each one is also a quest in Nova Quests (Nova Agent's quest system: the front page, Portal, the
   planner), made automatically the moment it appears in a note, and kept in step both ways:
     the heading's text   → the quest's title
     its mode             ↔ the quest's mode (changed here, or on the front page or in Portal)
   What ties them is kept on the heading (it travels with the note, shared notes included):
     data-task   the mode                  data-qid    the quest's id in Nova Quests
     data-qkey   this heading's own key     data-qsync  the mode both agreed on last time
   Nova Quests lives on the studio PC: with it off, a new quest waits ("On its way") and goes as
   soon as it's back. Taking a quest off keeps the heading's text (just without QUEST). */
(() => {
  'use strict';
  const NN = (window.NN = window.NN || {});
  const M = () => window.NovaQuestModes;
  const MODE_IDS = ['waiting', 'soon', 'working', 'nearly', 'longer', 'questions', 'done'];
  const validMode = (id) => (MODE_IDS.includes(id) ? id : 'waiting');
  const nameOf = (id) => (M() ? M().name(id) : id);
  const QUEST_WORD = /\b(quest|task)\b/i;
  const isQuest = (h) => QUEST_WORD.test(h.textContent || '');
  const sfx = (n, el) => window.NovaSfx && window.NovaSfx.play(n, undefined, el);
  const newKey = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  let query = '';
  let box = null;

  function ensureBox() {
    if (box && box.isConnected) return box;
    const outline = document.getElementById('outline');
    if (!outline) return null;
    box = document.createElement('section');
    box.className = 'tasks';
    box.setAttribute('aria-label', 'Quests');
    box.innerHTML = `
      <h2 class="lib-title tasks-h">Quests <b class="tasks-count"></b></h2>
      <div class="tasks-tools">
        <button type="button" class="tasks-new" data-sfx="open">+ New quest</button>
        <input class="tasks-find" type="search" placeholder="Find a quest" aria-label="Find a quest">
      </div>
      <ol class="tasks-list"></ol>
      <p class="tasks-empty">Write a heading with the word <b>QUEST</b> in it (or press <b>+ New quest</b>). It becomes a quest in Nova Agent too.</p>
      <p class="tasks-sync" role="status" hidden></p>`;
    outline.prepend(box);
    box.querySelector('.tasks-find').addEventListener('input', (e) => {
      query = e.target.value.trim().toLowerCase();
      if (NN.tasks._last) render(...NN.tasks._last);
    });
    box.querySelector('.tasks-new').addEventListener('click', () => NN.tasks._last && addQuest(NN.tasks._last[0]));
    return box;
  }

  const questHeadings = (editor) => [...editor.el.querySelectorAll(':scope > h2, :scope > h3')].filter(isQuest);

  // What's written under a quest (until the next heading), for Agent and Nova Quests' notes
  function bodyOf(h) {
    const parts = [];
    for (let n = h.nextElementSibling; n && !/^(H1|H2|H3)$/.test(n.tagName) && !n.classList.contains('title'); n = n.nextElementSibling) {
      const t = (n.innerText || n.textContent || '').trim();
      if (t) parts.push(t);
    }
    return parts.join('\n').slice(0, 1500);
  }

  // Hand a quest to Agent, ready to send
  function chatAbout(h, noteTitle) {
    const title = h.textContent.trim();
    const body = bodyOf(h);
    const text = `Let's talk about this quest from my note "${noteTitle}": ${title}\nMode: ${nameOf(h.getAttribute('data-task'))}${body ? `\n\nWhat the note says about it:\n${body}` : ''}`;
    try {
      const top = window.top.document;
      const input = top.getElementById('input');
      if (input) {
        const back = top.getElementById('viewer-close');
        if (back && !top.getElementById('viewer').hidden) back.click();
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        setTimeout(() => input.focus(), 120);
        return;
      }
    } catch (err) {}
    // Notes on its own (no Nova Agent around it): copy it, to paste into Agent
    if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
  }

  // "+ New quest": a heading at the end of the note, ready to name
  function addQuest(editor) {
    const h = document.createElement('h3');
    h.textContent = 'QUEST: ';
    h.setAttribute('data-task', 'waiting');
    editor.el.appendChild(h);
    h.scrollIntoView({ block: 'center' });
    editor.caretTo(h, true);
    sfx('open', h);
    editor.changed();
  }

  // Take it off Quests: the text stays, without the word QUEST (or TASK); it leaves Nova Quests
  async function unQuest(h, editor) {
    const id = h.getAttribute('data-qid');
    // The word goes (with a colon or dash after it); any formatting around the rest stays
    for (const node of [...h.childNodes]) if (node.nodeType === 3) node.textContent = node.textContent.replace(/\s*\b(quest|task)\b\s*[:\-–—]?\s*/gi, ' ');
    h.normalize();
    const first = h.firstChild;
    if (first && first.nodeType === 3) first.textContent = first.textContent.replace(/^\s+/, '');
    if (!h.textContent.trim()) h.textContent = 'Untitled';
    for (const a of ['data-task', 'data-qid', 'data-qkey', 'data-qsync']) h.removeAttribute(a);
    sfx('off', h);
    editor.changed();
    if (id) await api('POST', `/actions/quests/${encodeURIComponent(id)}`, { action: 'remove' }).catch(() => {});
  }

  function render(editor, noteTitle, noteId) {
    NN.tasks._last = [editor, noteTitle, noteId];
    const el = ensureBox();
    if (!el) return;
    const all = questHeadings(editor);
    tint(editor, all);
    const shown = query ? all.filter((h) => h.textContent.toLowerCase().includes(query)) : all;
    const done = all.filter((h) => h.getAttribute('data-task') === 'done').length;
    el.querySelector('.tasks-count').textContent = all.length ? `${done}/${all.length}` : '';
    el.querySelector('.tasks-find').hidden = all.length < 3;
    el.querySelector('.tasks-empty').hidden = all.length > 0;
    const list = el.querySelector('.tasks-list');
    list.innerHTML = '';
    for (const h of shown) {
      if (!MODE_IDS.includes(h.getAttribute('data-task'))) h.setAttribute('data-task', 'waiting');
      if (!h.getAttribute('data-qkey')) h.setAttribute('data-qkey', newKey());
      const mode = h.getAttribute('data-task');
      const li = document.createElement('li');
      li.className = `task qm-${mode}`;
      const linked = h.getAttribute('data-qid');
      li.innerHTML = `
        <button type="button" class="task-go" title="Go to this quest"></button>
        <div class="task-row">
          <button type="button" class="task-st qm-chip qm-${mode}" aria-haspopup="menu" title="How it's going (tap to change)">${nameOf(mode)}</button>
          <button type="button" class="task-chat" title="Talk about this quest with Nova Agent" aria-label="Talk about this quest with Nova Agent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h.5A2.5 2.5 0 0 1 5 12.5z"/></svg>Agent</button>
          <button type="button" class="task-phones" title="Which phones get its reminders" aria-label="Which phones get its reminders"${linked ? '' : ' hidden'}>📱</button>
          <button type="button" class="task-off" title="Take it off Quests (the text stays in the note)" aria-label="Take it off Quests">✕</button>
        </div>
        <small class="task-link">${linked ? '✦ In Quests' : '◌ On its way to Quests'}</small>`;
      li.querySelector('.task-go').textContent = h.textContent.trim() || 'Untitled quest';
      li.querySelector('.task-go').addEventListener('click', () => {
        h.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        editor.caretTo(h, true);
        h.classList.add('task-flash');
        setTimeout(() => h.classList.remove('task-flash'), 1200);
      });
      li.querySelector('.task-st').addEventListener('click', (e) => pick(e.currentTarget, h, editor));
      li.querySelector('.task-chat').addEventListener('click', () => chatAbout(h, noteTitle()));
      li.querySelector('.task-off').addEventListener('click', () => unQuest(h, editor));
      li.querySelector('.task-phones').addEventListener('click', (e) => choosePhones(e.currentTarget, h));
      list.appendChild(li);
    }
    soon(editor);
  }

  // Each quest wears its mode's colour: the heading, and everything written under it (to the next
  // heading). Drawn with data-qtint, which the editor leaves out when it saves (editor.js html()).
  function tint(editor, headings) {
    for (const n of editor.el.querySelectorAll('[data-qtint]')) n.removeAttribute('data-qtint');
    for (const n of editor.el.querySelectorAll('[data-qtint-end]')) n.removeAttribute('data-qtint-end');
    for (const h of headings) {
      const mode = validMode(h.getAttribute('data-task'));
      let last = null;
      for (let n = h.nextElementSibling; n && !/^(H1|H2|H3)$/.test(n.tagName) && !n.classList.contains('title'); n = n.nextElementSibling) {
        n.setAttribute('data-qtint', mode);
        last = n;
      }
      if (last) last.setAttribute('data-qtint-end', '');
      h.toggleAttribute('data-qopen', Boolean(last));
    }
  }

  // The modes, to choose from (the shared menu: the same as the front page's and Portal's)
  async function pick(btn, h, editor) {
    const current = h.getAttribute('data-task');
    let mode = null;
    if (M()) mode = await M().pick(btn, current);
    else {
      const i = MODE_IDS.indexOf(current);
      mode = MODE_IDS[(i + 1) % MODE_IDS.length];
    }
    if (!mode || mode === current) return;
    h.setAttribute('data-task', mode);
    sfx(mode === 'done' ? 'done' : 'tab', btn);
    editor.changed();
    render(...NN.tasks._last);
    soon(editor, 200);
  }

  // Which phones get its reminders (kept in Nova Quests: the owner's unless some are picked)
  async function choosePhones(btn, h) {
    const id = h.getAttribute('data-qid');
    if (!id || !M() || !M().pickPhones) return;
    let chosen = [];
    try {
      const st = await api('GET', '/quests/state?who=notes');
      chosen = ((st.quests || []).find((q) => q.id === id) || {}).phones || [];
    } catch (err) {}
    const phones = await M().pickPhones(btn, chosen);
    if (!phones) return;
    try {
      await api('POST', `/actions/quests/${encodeURIComponent(id)}`, { changes: { phones } });
      sfx('done', btn);
    } catch (err) {
      say('Quests can’t be reached just now, so the phones weren’t changed. Try again in a moment.');
    }
  }

  // ---- Keeping Nova Quests in step ----
  async function api(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-Nova-Visualizer': '1', Accept: 'application/json' } : { Accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) throw new Error(data.message || data.error || `Error ${res.status}`);
    return data;
  }
  let timer = null;
  let busy = false;
  function soon(editor, wait = 1500) {
    clearTimeout(timer);
    timer = setTimeout(() => sync(editor), wait);
  }
  function say(text) {
    const p = box && box.querySelector('.tasks-sync');
    if (!p) return;
    p.textContent = text || '';
    p.hidden = !text;
  }
  async function sync(editor) {
    if (busy || !NN.tasks._last || NN.tasks._last[0] !== editor) return;
    const headings = questHeadings(editor);
    if (!headings.length) return say('');
    busy = true;
    let changed = false;
    try {
      const state = await api('GET', '/quests/state?who=notes');
      const quests = Array.isArray(state.quests) ? state.quests : [];
      const byId = new Map(quests.map((q) => [q.id, q]));
      const [, noteTitle, noteId] = NN.tasks._last;
      const title = (noteTitle && noteTitle()) || 'a note';
      const nid = (noteId && noteId()) || 'note';
      for (const h of headings) {
        const key = h.getAttribute('data-qkey') || (h.setAttribute('data-qkey', newKey()), h.getAttribute('data-qkey'));
        const link = `note:${nid}|${key}`;
        const text = h.textContent.trim().slice(0, 140) || 'Untitled quest';
        const mode = validMode(h.getAttribute('data-task'));
        // Already there (made by another copy of this note, or before its id was saved here)?
        let q = byId.get(h.getAttribute('data-qid')) || quests.find((x) => x.link === link);
        if (!q) {
          q = (await api('POST', '/actions/quests', { title: text, notes: bodyOf(h), from: `Notes · ${title}`.slice(0, 80), link, mode: ['done', 'working', 'nearly', 'longer'].includes(mode) ? 'waiting' : mode })).result;
          if (q && mode !== q.mode) q = (await api('POST', `/actions/quests/${encodeURIComponent(q.id)}`, { action: 'mode', mode })).result || q;
          if (q) {
            h.setAttribute('data-qid', q.id);
            h.setAttribute('data-qsync', q.mode || mode);
            changed = true;
          }
          continue;
        }
        if (h.getAttribute('data-qid') !== q.id) (h.setAttribute('data-qid', q.id), (changed = true));
        // The title follows the heading
        if (q.title !== text) await api('POST', `/actions/quests/${encodeURIComponent(q.id)}`, { changes: { title: text } });
        // The mode: whichever side changed since they last agreed wins
        const agreed = h.getAttribute('data-qsync');
        if (q.mode !== mode) {
          if (agreed && q.mode !== agreed && mode === agreed) {
            h.setAttribute('data-task', validMode(q.mode)); // changed on the front page or in Portal
          } else {
            await api('POST', `/actions/quests/${encodeURIComponent(q.id)}`, { action: 'mode', mode }); // changed here
          }
          changed = true;
        }
        if (h.getAttribute('data-qsync') !== validMode(h.getAttribute('data-task'))) (h.setAttribute('data-qsync', validMode(h.getAttribute('data-task'))), (changed = true));
      }
      say('');
    } catch (err) {
      say('Quests can’t be reached just now (the studio PC may be off). New quests go as soon as it’s back.');
    } finally {
      busy = false;
    }
    if (changed) {
      editor.changed();
      render(...NN.tasks._last);
    }
  }
  // Again now and then, and on coming back to Notes (changes made on the front page or in Portal)
  setInterval(() => document.visibilityState === 'visible' && NN.tasks._last && sync(NN.tasks._last[0]), 20000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && NN.tasks._last && soon(NN.tasks._last[0], 300));

  NN.tasks = { render, modes: MODE_IDS };
})();
