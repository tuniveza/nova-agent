/* Notes — tasks.js
   Every "heading 3" with the word TASK in it is a task. They're listed at the top of the side panel
   (above the outline): tap one to jump to it, type to find one, and set how it's going with its
   status (Waiting, Soon, Working on it, Taking longer than expected, Done). The status is kept in
   the note itself (on the heading), so it travels with it, shared notes included. Each task has
   a chat button that hands it (with what's written under it) to Agent, to talk it through. */
(() => {
  'use strict';
  const NN = (window.NN = window.NN || {});
  const STATUSES = [
    { id: 'waiting', label: 'Waiting' },
    { id: 'soon', label: 'Soon' },
    { id: 'working', label: 'Working on it' },
    { id: 'longer', label: 'Taking longer than expected' },
    { id: 'done', label: 'Done' },
  ];
  const nameOf = (id) => (STATUSES.find((s) => s.id === id) || STATUSES[0]).label;
  const isTask = (h) => /\btask\b/i.test(h.textContent || '');
  const sfx = (n, el) => window.NovaSfx && window.NovaSfx.play(n, undefined, el);
  let query = '';
  let box = null;

  function ensureBox() {
    if (box && box.isConnected) return box;
    const outline = document.getElementById('outline');
    if (!outline) return null;
    box = document.createElement('section');
    box.className = 'tasks';
    box.setAttribute('aria-label', 'Tasks');
    box.innerHTML = `
      <h2 class="lib-title tasks-h">Tasks <b class="tasks-count"></b></h2>
      <input class="tasks-find" type="search" placeholder="Find a task" aria-label="Find a task">
      <ol class="tasks-list"></ol>
      <p class="tasks-empty">Write a <b>heading 3</b> with the word <b>TASK</b> in it, and it shows up here.</p>`;
    outline.prepend(box);
    box.querySelector('.tasks-find').addEventListener('input', (e) => {
      query = e.target.value.trim().toLowerCase();
      if (NN.tasks._last) render(...NN.tasks._last);
    });
    return box;
  }

  // What's written under a task (until the next heading), for the chat
  function bodyOf(h) {
    const parts = [];
    for (let n = h.nextElementSibling; n && !/^(H1|H2|H3)$/.test(n.tagName) && !n.classList.contains('title'); n = n.nextElementSibling) {
      const t = (n.innerText || n.textContent || '').trim();
      if (t) parts.push(t);
    }
    return parts.join('\n').slice(0, 1500);
  }

  // Hand a task to Agent (Nova Agent's chat), ready to send
  function chatAbout(h, noteTitle) {
    const title = h.textContent.trim();
    const body = bodyOf(h);
    const text = `Let's talk about this task from my note "${noteTitle}": ${title}\nStatus: ${nameOf(h.getAttribute('data-task'))}${body ? `\n\nWhat the note says about it:\n${body}` : ''}`;
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

  function render(editor, noteTitle) {
    NN.tasks._last = [editor, noteTitle];
    const el = ensureBox();
    if (!el) return;
    const all = [...editor.el.querySelectorAll(':scope > h3')].filter(isTask);
    const shown = query ? all.filter((h) => h.textContent.toLowerCase().includes(query)) : all;
    const done = all.filter((h) => h.getAttribute('data-task') === 'done').length;
    el.querySelector('.tasks-count').textContent = all.length ? `${done}/${all.length}` : '';
    el.querySelector('.tasks-find').hidden = all.length < 3;
    el.querySelector('.tasks-empty').hidden = all.length > 0;
    const list = el.querySelector('.tasks-list');
    list.innerHTML = '';
    for (const h of shown) {
      if (!h.getAttribute('data-task')) h.setAttribute('data-task', 'waiting');
      const st = h.getAttribute('data-task');
      const li = document.createElement('li');
      li.className = `task st-${st}`;
      li.innerHTML = `
        <button type="button" class="task-go" title="Go to this task"></button>
        <div class="task-row">
          <button type="button" class="task-st" aria-haspopup="true" title="How it's going">${nameOf(st)}</button>
          <button type="button" class="task-chat" title="Talk about this task with Agent" aria-label="Talk about this task with Agent"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15h.5A2.5 2.5 0 0 1 5 12.5z"/></svg>Chat</button>
        </div>`;
      li.querySelector('.task-go').textContent = h.textContent.trim();
      li.querySelector('.task-go').addEventListener('click', () => {
        h.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        editor.caretTo(h, true);
        h.classList.add('task-flash');
        setTimeout(() => h.classList.remove('task-flash'), 1200);
      });
      li.querySelector('.task-st').addEventListener('click', (e) => pick(e.currentTarget, h, editor));
      li.querySelector('.task-chat').addEventListener('click', () => chatAbout(h, noteTitle()));
      list.appendChild(li);
    }
  }

  // The five statuses, to choose from
  let menu = null;
  function pick(btn, h, editor) {
    if (!menu) {
      menu = document.createElement('div');
      menu.className = 'task-menu';
      menu.setAttribute('role', 'menu');
      document.body.appendChild(menu);
      document.addEventListener('click', (e) => { if (menu && !menu.hidden && !menu.contains(e.target) && !e.target.closest('.task-st')) menu.hidden = true; }, true);
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && menu) menu.hidden = true; });
    }
    menu.innerHTML = STATUSES.map((s) => `<button type="button" role="menuitemradio" aria-checked="${h.getAttribute('data-task') === s.id}" data-st="${s.id}" class="st-${s.id}">${s.label}</button>`).join('');
    menu.hidden = false;
    const r = btn.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(innerWidth - 240, r.left))}px`;
    menu.style.top = `${Math.min(innerHeight - 220, r.bottom + 6)}px`;
    menu.onclick = (e) => {
      const b = e.target.closest('[data-st]');
      if (!b) return;
      h.setAttribute('data-task', b.dataset.st);
      menu.hidden = true;
      sfx(b.dataset.st === 'done' ? 'done' : 'tab', btn);
      editor.changed();
      render(...NN.tasks._last);
    };
  }

  NN.tasks = { render, statuses: STATUSES };
})();
