/* Nova Notes — editor.js
   The writing surface: a contenteditable page with Google Docs-style tools.
   - Text is centred unless a block is given its own alignment (the CSS default is centre; an
     alignment chosen in the toolbar is stored on the block).
   - Its own undo history (snapshots of the page and the selection), so every tool can be undone,
     including the ones the browser doesn't track.
   - Paragraph styles (Title, Subtitle, Heading 1–3, Normal, Quote, Code), lists, checklists, links,
     pictures, tables, find and replace, and Markdown-style shortcuts as you type (# , - , 1. , [] ). */
(function () {
  'use strict';
  const NN = (window.NN = window.NN || {});

  const BLOCK_SEL = 'p, h1, h2, h3, blockquote, pre, li, td, th';
  const TOP_BLOCK = new Set(['P', 'H1', 'H2', 'H3', 'BLOCKQUOTE', 'PRE']);
  const STYLES = {
    normal: { tag: 'p', cls: '' },
    title: { tag: 'p', cls: 'title' },
    subtitle: { tag: 'p', cls: 'subtitle' },
    h1: { tag: 'h1', cls: '' },
    h2: { tag: 'h2', cls: '' },
    h3: { tag: 'h3', cls: '' },
    quote: { tag: 'blockquote', cls: '' },
    code: { tag: 'pre', cls: '' }
  };
  const MARKER = 'rgb(1, 2, 3)'; // a colour no one picks, used to find freshly styled text

  class Editor {
    constructor(el, hooks = {}) {
      this.el = el;
      this.hooks = hooks;
      this.undoStack = [];
      this.redoStack = [];
      this.lastPush = 0;
      this.savedRange = null;
      this.selImg = null;
      this.find = { query: '', ranges: [], index: -1 };
      el.contentEditable = 'true';
      el.spellcheck = true;
      el.setAttribute('role', 'textbox');
      el.setAttribute('aria-multiline', 'true');
      try {
        document.execCommand('defaultParagraphSeparator', false, 'p');
      } catch (err) {
        // Older browsers: Enter makes <div>s, which normalise() turns into <p>s
      }
      this.bind();
    }

    // ---------- LOADING / SAVING ----------

    load(html) {
      this.el.innerHTML = NN.convert.clean(html || '');
      this.normalise();
      this.undoStack = [this.snapshot()];
      this.redoStack = [];
      this.clearFind();
      this.deselectImage();
      this.emit();
    }

    html() {
      const copy = this.el.cloneNode(true);
      copy.querySelectorAll('.nn-selected').forEach((n) => n.classList.remove('nn-selected'));
      copy.querySelectorAll('[class=""]').forEach((n) => n.removeAttribute('class'));
      return copy.innerHTML;
    }

    isEmpty() {
      return !this.el.textContent.trim() && !this.el.querySelector('img, table, hr');
    }

    // Keep the page tidy: only blocks at the top, never completely empty
    normalise() {
      const el = this.el;
      let run = null;
      for (const node of [...el.childNodes]) {
        if (node.nodeType === 1 && node.tagName === 'DIV') {
          const p = document.createElement('p');
          if (node.getAttribute('style')) p.setAttribute('style', node.getAttribute('style'));
          p.append(...node.childNodes);
          node.replaceWith(p);
          run = null;
          continue;
        }
        const isBlock = node.nodeType === 1 && (TOP_BLOCK.has(node.tagName) || ['UL', 'OL', 'TABLE', 'HR'].includes(node.tagName));
        if (isBlock) {
          run = null;
          continue;
        }
        if (node.nodeType === 3 && !node.data.trim() && !run) {
          node.remove();
          continue;
        }
        if (!run) {
          run = document.createElement('p');
          node.replaceWith(run);
        }
        run.appendChild(node);
      }
      if (!el.firstChild) el.innerHTML = '<p><br></p>';
      // A table or rule at the very end needs a line after it to keep typing
      const last = el.lastElementChild;
      if (last && (last.tagName === 'TABLE' || last.tagName === 'HR')) el.insertAdjacentHTML('beforeend', '<p><br></p>');
      el.classList.toggle('is-empty', this.isEmpty() && el.children.length === 1 && el.firstElementChild.tagName === 'P' && !el.firstElementChild.className);
    }

    // ---------- SELECTION ----------

    range() {
      const sel = window.getSelection();
      if (!sel.rangeCount) return null;
      const r = sel.getRangeAt(0);
      return this.el.contains(r.commonAncestorContainer) ? r : null;
    }

    // Remember the selection when focus goes to a toolbar box, and put it back before acting
    remember() {
      const r = this.range();
      if (r) this.savedRange = r.cloneRange();
    }
    restore() {
      if (this.range()) return;
      this.el.focus({ preventScroll: true });
      if (this.savedRange && this.el.contains(this.savedRange.commonAncestorContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(this.savedRange);
      }
    }
    focus() {
      this.restore();
    }

    pathOf(node, offset) {
      const path = [];
      let n = node;
      while (n && n !== this.el) {
        path.unshift([...n.parentNode.childNodes].indexOf(n));
        n = n.parentNode;
      }
      return n === this.el ? { path, offset } : null;
    }
    nodeAt(p) {
      let n = this.el;
      for (const i of p.path) {
        if (!n.childNodes[i]) return null;
        n = n.childNodes[i];
      }
      return n;
    }
    saveSel() {
      const r = this.range();
      if (!r) return null;
      return { a: this.pathOf(r.startContainer, r.startOffset), b: this.pathOf(r.endContainer, r.endOffset) };
    }
    loadSel(s) {
      if (!s || !s.a || !s.b) return;
      const a = this.nodeAt(s.a);
      const b = this.nodeAt(s.b);
      if (!a || !b) return;
      const r = document.createRange();
      try {
        r.setStart(a, Math.min(s.a.offset, a.nodeType === 3 ? a.length : a.childNodes.length));
        r.setEnd(b, Math.min(s.b.offset, b.nodeType === 3 ? b.length : b.childNodes.length));
      } catch (err) {
        return;
      }
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    caretTo(node, atEnd = false) {
      const r = document.createRange();
      r.selectNodeContents(node);
      r.collapse(!atEnd);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }

    // The blocks the selection touches (innermost: li, td, p…)
    blocks() {
      const r = this.range() || this.savedRange;
      if (!r) return [];
      const start = this.blockOf(r.startContainer);
      const end = this.blockOf(r.endContainer);
      if (!start) return [];
      if (start === end || !end) return [start];
      const all = [...this.el.querySelectorAll(BLOCK_SEL)].filter((b) => !b.querySelector(BLOCK_SEL) || b.tagName === 'LI');
      const i = all.indexOf(start);
      const j = all.indexOf(end);
      return i >= 0 && j >= i ? all.slice(i, j + 1) : [start];
    }
    blockOf(node) {
      let n = node && node.nodeType === 3 ? node.parentElement : node;
      if (n === this.el) {
        // caret between blocks: use the nearest child
        const r = this.range();
        n = r && this.el.childNodes[Math.min(r.startOffset, this.el.childNodes.length - 1)];
        if (n && n.nodeType === 3) n = n.parentElement;
      }
      const b = n && n.closest ? n.closest(BLOCK_SEL) : null;
      return b && this.el.contains(b) ? b : null;
    }
    topBlockOf(node) {
      let n = node && node.nodeType === 3 ? node.parentElement : node;
      while (n && n.parentElement !== this.el) n = n.parentElement;
      return n && n.parentElement === this.el ? n : null;
    }

    // ---------- HISTORY ----------

    snapshot() {
      return { html: this.el.innerHTML, sel: this.saveSel() };
    }
    // Record the page after a change. Typing bursts are grouped; a space or a tool ends a group.
    record(kind = 'edit') {
      const snap = this.snapshot();
      const top = this.undoStack[this.undoStack.length - 1];
      if (top && top.html === snap.html) {
        top.sel = snap.sel;
        return;
      }
      const now = Date.now();
      if (kind === 'typing' && this.lastKind === 'typing' && now - this.lastPush < 1200 && this.undoStack.length > 1) {
        this.undoStack[this.undoStack.length - 1] = snap;
      } else {
        this.undoStack.push(snap);
        if (this.undoStack.length > 300) this.undoStack.shift();
      }
      this.lastPush = now;
      this.lastKind = kind;
      this.redoStack = [];
    }
    undo() {
      if (this.undoStack.length < 2) return;
      this.redoStack.push(this.undoStack.pop());
      this.apply(this.undoStack[this.undoStack.length - 1]);
    }
    redo() {
      const s = this.redoStack.pop();
      if (!s) return;
      this.undoStack.push(s);
      this.apply(s);
    }
    apply(s) {
      this.el.innerHTML = s.html;
      this.el.focus({ preventScroll: true });
      this.loadSel(s.sel);
      this.lastKind = 'undo';
      this.deselectImage();
      this.normalise();
      this.emit(true);
    }
    canUndo() {
      return this.undoStack.length > 1;
    }
    canRedo() {
      return this.redoStack.length > 0;
    }

    // After any change: tidy, record, tell the app
    changed(kind = 'edit') {
      this.normalise();
      this.record(kind);
      this.refreshFind();
      this.emit(true);
    }
    emit(contentChanged = false) {
      if (contentChanged && this.hooks.onChange) this.hooks.onChange();
      if (this.hooks.onState) {
        cancelAnimationFrame(this.stateFrame);
        this.stateFrame = requestAnimationFrame(() => this.hooks.onState(this.state()));
      }
    }

    // ---------- STATE FOR THE TOOLBAR ----------

    state() {
      const r = this.range() || this.savedRange;
      const q = (c) => {
        try {
          return document.queryCommandState(c);
        } catch (err) {
          return false;
        }
      };
      const block = r ? this.blockOf(r.startContainer) : null;
      const node = r ? (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer) : null;
      const cs = node && this.el.contains(node) ? getComputedStyle(node) : null;
      const top = r ? this.topBlockOf(r.startContainer) : null;
      let style = 'normal';
      if (top) {
        if (top.tagName === 'P' && top.classList.contains('title')) style = 'title';
        else if (top.tagName === 'P' && top.classList.contains('subtitle')) style = 'subtitle';
        else if (/^H[1-3]$/.test(top.tagName)) style = top.tagName.toLowerCase();
        else if (top.tagName === 'BLOCKQUOTE') style = 'quote';
        else if (top.tagName === 'PRE') style = 'code';
      }
      const listEl = block && block.closest('ul, ol');
      const align = block ? (block.style.textAlign || (block.closest('[style*="text-align"]') && this.el.contains(block.closest('[style*="text-align"]')) ? block.closest('[style*="text-align"]').style.textAlign : '') || 'center') : 'center';
      return {
        bold: q('bold'),
        italic: q('italic'),
        underline: q('underline'),
        strike: q('strikeThrough'),
        sub: q('subscript'),
        sup: q('superscript'),
        style,
        align,
        list: listEl ? (listEl.classList.contains('nn-check') ? 'check' : listEl.tagName.toLowerCase()) : '',
        font: cs ? cs.fontFamily.split(',')[0].replace(/["']/g, '').trim() : '',
        size: cs ? Math.round(parseFloat(cs.fontSize) * 0.75 * 2) / 2 : 0,
        color: cs ? NN.convert.hex(cs.color) : '',
        link: node ? node.closest('a') : null,
        cell: node ? node.closest('td, th') : null,
        image: this.selImg,
        canUndo: this.canUndo(),
        canRedo: this.canRedo(),
        lineHeight: block ? block.style.lineHeight || '' : ''
      };
    }

    // ---------- COMMANDS ----------

    exec(cmd, value) {
      this.restore();
      const css = (on) => {
        try {
          document.execCommand('styleWithCSS', false, on);
        } catch (err) {
          // ignore
        }
      };
      switch (cmd) {
        case 'bold':
        case 'italic':
        case 'underline':
        case 'strikeThrough':
        case 'subscript':
        case 'superscript':
          css(false);
          document.execCommand(cmd);
          break;
        case 'color':
          this.styleText('color', value);
          break;
        case 'highlight':
          this.styleText('background-color', value);
          break;
        case 'font':
          this.styleText('font-family', value ? `'${value}'` : '');
          break;
        case 'size':
          this.styleText('font-size', value ? `${value}pt` : '');
          break;
        case 'style':
          this.setStyle(value);
          break;
        case 'align':
          if (this.selImg) {
            const holder = this.selImg.closest(BLOCK_SEL);
            if (holder) holder.style.textAlign = value;
          } else this.blocks().forEach((b) => (b.style.textAlign = value));
          break;
        case 'lineHeight':
          this.blocks().forEach((b) => (b.style.lineHeight = value || ''));
          break;
        case 'list':
          this.toggleList(value);
          break;
        case 'indent':
        case 'outdent':
          this.indent(cmd === 'indent');
          break;
        case 'clear':
          css(false);
          document.execCommand('removeFormat');
          this.stripStyles();
          break;
        case 'link':
          this.makeLink(value.url, value.text);
          break;
        case 'unlink':
          this.removeLink();
          break;
        case 'hr':
          this.insertBlocks([Object.assign(document.createElement('hr'), {})]);
          break;
        case 'pageBreak': {
          const hr = document.createElement('hr');
          hr.className = 'page-break';
          this.insertBlocks([hr]);
          break;
        }
        case 'image':
          this.insertImage(value.src, value.alt);
          break;
        case 'table':
          this.insertTable(value.rows, value.cols);
          break;
        case 'text':
          document.execCommand('insertText', false, value);
          break;
        case 'selectAll': {
          const r = document.createRange();
          r.selectNodeContents(this.el);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(r);
          return;
        }
        default:
          return;
      }
      this.changed();
    }

    // Colour, highlight, font or size on the selected text. The browser marks the text with a
    // placeholder colour first; every marked piece then gets the real style.
    styleText(prop, value) {
      const r = this.range();
      if (!r) return;
      if (r.collapsed) {
        // Nothing selected: style the word around the caret, as Google Docs does
        const sel = window.getSelection();
        if (sel.modify) {
          sel.modify('move', 'backward', 'word');
          sel.modify('extend', 'forward', 'word');
        }
        if (window.getSelection().isCollapsed) return;
      }
      try {
        document.execCommand('styleWithCSS', false, true);
      } catch (err) {
        // ignore
      }
      document.execCommand('foreColor', false, MARKER);
      const marked = [...this.el.querySelectorAll('[style*="color"]')].filter((n) => n.style.color === MARKER);
      // Fonts too: the browser's <font color> form when CSS styling isn't supported
      this.el.querySelectorAll('font[color="#010203"]').forEach((f) => {
        const s = document.createElement('span');
        s.style.color = MARKER;
        s.append(...f.childNodes);
        f.replaceWith(s);
        marked.push(s);
      });
      for (const node of marked) {
        // The real colour comes back unless we're changing colour
        node.style.removeProperty('color');
        // Clear the same style inside, so the new one shows
        node.querySelectorAll('*').forEach((inner) => inner.style && inner.style.removeProperty(prop));
        if (prop === 'color' && value) node.style.color = value;
        else if (prop !== 'color' && value) node.style.setProperty(prop, value);
        if (prop === 'color' && !value) {
          // "Default": also remove colour set further up, inside this block
          let up = node.parentElement;
          while (up && up !== this.el && !up.matches(BLOCK_SEL)) {
            if (up.style.color && up.tagName === 'SPAN') up.style.removeProperty('color');
            up = up.parentElement;
          }
        }
        if (!node.getAttribute('style')) node.removeAttribute('style');
      }
      // Reselect the styled text so the next tool works on it too
      const kept = marked.filter((n) => n.isConnected);
      if (kept.length) {
        const sel = window.getSelection();
        const range = document.createRange();
        range.setStartBefore(kept[0]);
        range.setEndAfter(kept[kept.length - 1]);
        sel.removeAllRanges();
        sel.addRange(range);
      }
      // Unwrap spans left with no style
      this.el.querySelectorAll('span:not([style]), span[style=""]').forEach((s) => s.replaceWith(...s.childNodes));
    }

    // Remove the styles "clear formatting" should clear, on spans inside the selection
    stripStyles() {
      const r = this.range();
      if (!r) return;
      for (const span of this.el.querySelectorAll('span, font')) {
        if (r.intersectsNode(span)) span.replaceWith(...span.childNodes);
      }
    }

    // Paragraph styles (Title, Heading 1…)
    setStyle(name) {
      const spec = STYLES[name] || STYLES.normal;
      const before = this.saveSel();
      const r = this.range();
      if (!r) return;
      const tops = new Set();
      for (const b of this.blocks()) {
        const top = this.topBlockOf(b);
        if (top && TOP_BLOCK.has(top.tagName)) tops.add(top);
      }
      for (const top of tops) {
        const el = document.createElement(spec.tag);
        if (spec.cls) el.className = spec.cls;
        for (const prop of ['text-align', 'line-height', 'margin-left']) {
          const v = top.style.getPropertyValue(prop);
          if (v) el.style.setProperty(prop, v);
        }
        el.append(...top.childNodes);
        top.replaceWith(el);
      }
      this.loadSel(before);
    }

    toggleList(kind) {
      const r = this.range();
      if (!r) return;
      const block = this.blockOf(r.startContainer);
      const list = block && block.closest('ul, ol');
      try {
        document.execCommand('styleWithCSS', false, false);
      } catch (err) {
        // ignore
      }
      if (kind === 'check') {
        if (list && list.tagName === 'UL' && list.classList.contains('nn-check')) {
          document.execCommand('insertUnorderedList');
        } else if (list && list.tagName === 'UL') {
          list.classList.add('nn-check');
        } else {
          document.execCommand('insertUnorderedList');
          this.keepListApart(true);
        }
      } else if (kind === 'ul') {
        if (list && list.tagName === 'UL' && list.classList.contains('nn-check')) list.classList.remove('nn-check');
        else {
          const creating = !list;
          document.execCommand('insertUnorderedList');
          if (creating) this.keepListApart(false);
        }
      } else {
        document.execCommand('insertOrderedList');
      }
      // The browser sometimes leaves list items inside paragraphs; lift them out
      for (const p of this.el.querySelectorAll(':scope > p > ul, :scope > p > ol')) {
        const host = p.parentElement;
        host.replaceWith(...host.childNodes);
      }
    }

    // A new list right after another one gets joined to it by the browser. If the two are
    // different kinds (a checklist and a bulleted list), split the new items back out.
    keepListApart(check) {
      const r = this.range();
      if (!r) return;
      const caret = { node: r.startContainer, offset: r.startOffset };
      const items = this.blocks().filter((b) => b.tagName === 'LI');
      if (!items.length) return;
      const list = items[0].parentElement;
      if (list.tagName !== 'UL') return;
      const mine = items.filter((li) => li.parentElement === list);
      const others = [...list.children].filter((li) => !mine.includes(li));
      if (!others.length) {
        list.classList.toggle('nn-check', check);
        return;
      }
      if (list.classList.contains('nn-check') === check) return;
      const fresh = document.createElement('ul');
      if (check) fresh.className = 'nn-check';
      const after = mine[mine.length - 1].nextElementSibling;
      if (after) {
        const tail = list.cloneNode(false);
        for (let n = after; n; ) {
          const next = n.nextElementSibling;
          tail.appendChild(n);
          n = next;
        }
        list.after(tail);
      }
      mine.forEach((li) => fresh.appendChild(li));
      list.after(fresh);
      if (!list.children.length) list.remove();
      try {
        const back = document.createRange();
        back.setStart(caret.node, Math.min(caret.offset, caret.node.nodeType === 3 ? caret.node.length : caret.node.childNodes.length));
        back.collapse(true);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(back);
      } catch (err) {
        this.caretTo(mine[0], true);
      }
    }

    indent(more) {
      const r = this.range();
      if (!r) return;
      const block = this.blockOf(r.startContainer);
      if (block && block.closest('li')) {
        document.execCommand(more ? 'indent' : 'outdent');
        return;
      }
      for (const b of this.blocks()) {
        if (b.tagName === 'TD' || b.tagName === 'TH') continue;
        const now = parseFloat(b.style.marginLeft) || 0;
        const next = Math.max(0, Math.min(216, now + (more ? 36 : -36)));
        b.style.marginLeft = next ? `${next}px` : '';
      }
    }

    makeLink(url, text) {
      let href = String(url || '').trim();
      if (!href) return;
      if (!/^(https?:|mailto:|tel:|#)/i.test(href)) href = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(href) ? `mailto:${href}` : `https://${href}`;
      const r = this.range();
      if (!r) return;
      const existing = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer).closest('a');
      if (existing && this.el.contains(existing)) {
        existing.setAttribute('href', href);
        if (text && text !== existing.textContent) existing.textContent = text;
        return;
      }
      if (r.collapsed || text) {
        const a = document.createElement('a');
        a.href = href;
        a.textContent = text || href;
        r.deleteContents();
        r.insertNode(a);
        const after = document.createRange();
        after.setStartAfter(a);
        after.collapse(true);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(after);
      } else {
        document.execCommand('createLink', false, href);
      }
    }
    removeLink() {
      const r = this.range();
      if (!r) return;
      const a = (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer).closest('a');
      if (a && this.el.contains(a)) a.replaceWith(...a.childNodes);
      else document.execCommand('unlink');
    }

    // Put whole blocks (a rule, a table) after the block with the caret
    insertBlocks(nodes) {
      const r = this.range();
      const top = r ? this.topBlockOf(r.startContainer) : this.el.lastElementChild;
      const anchor = top || this.el.lastElementChild;
      let after = anchor;
      // An empty paragraph is replaced rather than left behind
      const replace = anchor && anchor.tagName === 'P' && !anchor.textContent.trim() && !anchor.querySelector('img');
      for (const n of nodes) {
        after.after(n);
        after = n;
      }
      let next = after.nextElementSibling;
      if (!next || !TOP_BLOCK.has(next.tagName)) {
        next = document.createElement('p');
        next.innerHTML = '<br>';
        after.after(next);
      }
      if (replace && anchor !== next) anchor.remove();
      return next;
    }

    insertImage(src, alt = '') {
      this.restore();
      const r = this.range();
      const img = document.createElement('img');
      img.src = src;
      if (alt) img.alt = alt;
      const top = r ? this.topBlockOf(r.startContainer) : null;
      if (top && top.tagName === 'P' && !top.textContent.trim() && !top.querySelector('img')) {
        top.innerHTML = '';
        top.appendChild(img);
        const p = document.createElement('p');
        p.innerHTML = '<br>';
        top.after(p);
        this.caretTo(p);
      } else if (r) {
        r.deleteContents();
        r.insertNode(img);
        const after = document.createRange();
        after.setStartAfter(img);
        after.collapse(true);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(after);
      } else {
        const p = document.createElement('p');
        p.appendChild(img);
        this.el.appendChild(p);
      }
    }

    insertTable(rows, cols) {
      rows = Math.max(1, Math.min(20, rows | 0));
      cols = Math.max(1, Math.min(10, cols | 0));
      const table = document.createElement('table');
      table.className = 'nn-table';
      const body = document.createElement('tbody');
      for (let i = 0; i < rows; i++) {
        const tr = document.createElement('tr');
        for (let j = 0; j < cols; j++) {
          const td = document.createElement('td');
          td.innerHTML = '<br>';
          tr.appendChild(td);
        }
        body.appendChild(tr);
      }
      table.appendChild(body);
      this.insertBlocks([table]);
      this.caretTo(table.querySelector('td'));
    }

    // ---------- TABLES ----------

    cell() {
      const r = this.range() || this.savedRange;
      const n = r && (r.startContainer.nodeType === 3 ? r.startContainer.parentElement : r.startContainer);
      const c = n && n.closest && n.closest('td, th');
      return c && this.el.contains(c) ? c : null;
    }
    tableOp(op) {
      const cell = this.cell();
      if (!cell) return;
      const row = cell.parentElement;
      const table = cell.closest('table');
      const col = [...row.children].indexOf(cell);
      const blankCell = (tag = 'td') => {
        const c = document.createElement(tag);
        c.innerHTML = '<br>';
        return c;
      };
      if (op === 'rowAbove' || op === 'rowBelow') {
        const tr = document.createElement('tr');
        [...row.children].forEach(() => tr.appendChild(blankCell()));
        row[op === 'rowAbove' ? 'before' : 'after'](tr);
        this.caretTo(tr.children[Math.min(col, tr.children.length - 1)]);
      } else if (op === 'colLeft' || op === 'colRight') {
        for (const tr of table.querySelectorAll('tr')) {
          const ref = tr.children[Math.min(col, tr.children.length - 1)];
          const c = blankCell(ref && ref.tagName === 'TH' ? 'th' : 'td');
          if (ref) ref[op === 'colLeft' ? 'before' : 'after'](c);
          else tr.appendChild(c);
        }
      } else if (op === 'delRow') {
        const next = row.nextElementSibling || row.previousElementSibling;
        row.remove();
        if (!table.querySelector('tr')) {
          const p = table.nextElementSibling;
          table.remove();
          if (p) this.caretTo(p);
        } else if (next) this.caretTo(next.children[Math.min(col, next.children.length - 1)]);
      } else if (op === 'delCol') {
        for (const tr of [...table.querySelectorAll('tr')]) if (tr.children[col]) tr.children[col].remove();
        if (!table.querySelector('td, th')) {
          const p = table.nextElementSibling;
          table.remove();
          if (p) this.caretTo(p);
        } else {
          const first = row.children[Math.max(0, col - 1)];
          if (first) this.caretTo(first);
        }
      } else if (op === 'header') {
        // Toggle the first row as a header row
        const first = table.querySelector('tr');
        const toTh = [...first.children].some((c) => c.tagName === 'TD');
        for (const c of [...first.children]) {
          const n = document.createElement(toTh ? 'th' : 'td');
          if (c.getAttribute('style')) n.setAttribute('style', c.getAttribute('style'));
          n.append(...c.childNodes);
          c.replaceWith(n);
        }
      } else if (op === 'delTable') {
        const p = table.nextElementSibling;
        table.remove();
        if (p) this.caretTo(p);
      }
      this.changed();
    }

    // ---------- PICTURES ----------

    selectImage(img) {
      this.deselectImage();
      this.selImg = img;
      img.classList.add('nn-selected');
      const r = document.createRange();
      r.selectNode(img);
      window.getSelection().removeAllRanges();
      window.getSelection().addRange(r);
      if (this.hooks.onImage) this.hooks.onImage(img);
      this.emit();
    }
    deselectImage() {
      if (this.selImg) this.selImg.classList.remove('nn-selected');
      const had = this.selImg;
      this.selImg = null;
      if (had && this.hooks.onImage) this.hooks.onImage(null);
    }
    imageOp(op, value) {
      const img = this.selImg;
      if (!img) return;
      if (op === 'width') img.style.width = value ? `${value}%` : '';
      else if (op === 'alt') value ? img.setAttribute('alt', value) : img.removeAttribute('alt');
      else if (op === 'align') {
        const holder = img.closest(BLOCK_SEL);
        if (holder) holder.style.textAlign = value;
      } else if (op === 'remove') {
        const holder = img.closest('p');
        img.remove();
        this.deselectImage();
        if (holder && !holder.textContent.trim() && !holder.querySelector('img')) holder.innerHTML = '<br>';
      }
      this.changed();
      if (this.selImg && this.hooks.onImage) this.hooks.onImage(this.selImg);
    }

    // ---------- FIND AND REPLACE ----------

    // Text nodes grouped by block, so a match can run across bold/italic pieces
    textMap() {
      const groups = new Map();
      const walker = document.createTreeWalker(this.el, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const t = walker.currentNode;
        const b = t.parentElement.closest(BLOCK_SEL) || this.el;
        if (!groups.has(b)) groups.set(b, []);
        groups.get(b).push(t);
      }
      return [...groups.values()];
    }
    search(query, { matchCase = false, wholeWord = false } = {}) {
      this.find.query = query;
      this.find.opts = { matchCase, wholeWord };
      this.find.ranges = [];
      if (!query) return this.paintFind();
      const pattern = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(wholeWord ? `\\b${pattern}\\b` : pattern, matchCase ? 'g' : 'gi');
      for (const nodes of this.textMap()) {
        const text = nodes.map((n) => n.data).join('');
        let m;
        re.lastIndex = 0;
        while ((m = re.exec(text))) {
          if (!m[0].length) {
            re.lastIndex++;
            continue;
          }
          const range = document.createRange();
          const at = (pos) => {
            let p = pos;
            for (const n of nodes) {
              if (p <= n.length) return [n, p];
              p -= n.length;
            }
            const last = nodes[nodes.length - 1];
            return [last, last.length];
          };
          const [sn, so] = at(m.index);
          const [en, eo] = at(m.index + m[0].length);
          range.setStart(sn, so);
          range.setEnd(en, eo);
          this.find.ranges.push(range);
        }
      }
      if (this.find.index >= this.find.ranges.length) this.find.index = this.find.ranges.length ? 0 : -1;
      if (this.find.index < 0 && this.find.ranges.length) this.find.index = 0;
      this.paintFind();
      return this.find.ranges.length;
    }
    refreshFind() {
      if (this.find.query) this.search(this.find.query, this.find.opts);
    }
    paintFind() {
      const has = typeof CSS !== 'undefined' && CSS.highlights && typeof Highlight === 'function';
      if (has) {
        CSS.highlights.set('nn-find', new Highlight(...this.find.ranges));
        const cur = this.find.ranges[this.find.index];
        CSS.highlights.set('nn-find-current', cur ? new Highlight(cur) : new Highlight());
      }
      return this.find.ranges.length;
    }
    findStep(dir) {
      const n = this.find.ranges.length;
      if (!n) return { index: -1, total: 0 };
      this.find.index = (this.find.index + dir + n) % n;
      this.paintFind();
      const r = this.find.ranges[this.find.index];
      const rect = r.getBoundingClientRect();
      if (this.hooks.onReveal) this.hooks.onReveal(rect);
      // Without highlight support, select the match instead
      if (!(typeof CSS !== 'undefined' && CSS.highlights)) {
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(r);
      }
      return { index: this.find.index, total: n };
    }
    replaceCurrent(text) {
      const r = this.find.ranges[this.find.index];
      if (!r) return;
      r.deleteContents();
      if (text) r.insertNode(document.createTextNode(text));
      this.el.normalize();
      this.changed();
      this.refreshFind();
    }
    replaceAll(text) {
      const count = this.find.ranges.length;
      for (const r of [...this.find.ranges].reverse()) {
        r.deleteContents();
        if (text) r.insertNode(document.createTextNode(text));
      }
      this.el.normalize();
      this.changed();
      this.refreshFind();
      return count;
    }
    clearFind() {
      this.find = { query: '', ranges: [], index: -1 };
      if (typeof CSS !== 'undefined' && CSS.highlights) {
        CSS.highlights.delete('nn-find');
        CSS.highlights.delete('nn-find-current');
      }
    }

    // ---------- OUTLINE AND COUNTS ----------

    outline() {
      return [...this.el.querySelectorAll(':scope > p.title, :scope > h1, :scope > h2, :scope > h3')]
        .filter((h) => h.textContent.trim())
        .map((h) => ({ el: h, level: h.classList.contains('title') ? 0 : Number(h.tagName[1]), text: h.textContent.trim() }));
    }
    stats() {
      const r = this.range();
      const selected = r && !r.collapsed ? r.toString() : '';
      const count = (text) => {
        const words = (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
        return { words, chars: text.replace(/\n/g, '').length, charsNoSpaces: text.replace(/\s/g, '').length };
      };
      const text = this.el.innerText || '';
      const all = count(text);
      return {
        ...all,
        selected: selected ? count(selected) : null,
        pages: Math.max(1, Math.ceil(all.words / 450)),
        paragraphs: [...this.el.querySelectorAll(BLOCK_SEL)].filter((b) => b.textContent.trim()).length,
        minutes: Math.max(1, Math.round(all.words / 230))
      };
    }

    // ---------- EVENTS ----------

    bind() {
      const el = this.el;

      el.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'historyUndo') {
          e.preventDefault();
          this.undo();
        } else if (e.inputType === 'historyRedo') {
          e.preventDefault();
          this.redo();
        }
      });

      el.addEventListener('input', (e) => {
        if (e.inputType === 'insertParagraph') this.afterEnter();
        const typing = e.inputType === 'insertText' && e.data && !/\s/.test(e.data);
        this.changed(typing ? 'typing' : 'edit');
      });

      el.addEventListener('keydown', (e) => this.onKey(e));

      el.addEventListener('paste', (e) => this.onPaste(e));
      el.addEventListener('drop', (e) => this.onDrop(e));

      el.addEventListener('click', (e) => {
        const img = e.target.closest('img');
        if (img && el.contains(img)) {
          this.selectImage(img);
          return;
        }
        this.deselectImage();
        // Ticking a checklist item: a click on its box (just before the text)
        const li = e.target.closest('ul.nn-check > li');
        if (li && el.contains(li)) {
          // The box sits just before the first letter: find where that letter is
          const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
          let text = null;
          while (walker.nextNode()) {
            if (walker.currentNode.parentElement.closest('ul, ol') !== li.parentElement) break;
            if (walker.currentNode.data.trim()) {
              text = walker.currentNode;
              break;
            }
          }
          const em = parseFloat(getComputedStyle(li).fontSize) || 16;
          let rect = null;
          if (text) {
            const r = document.createRange();
            r.setStart(text, Math.max(0, text.data.search(/\S/)));
            r.collapse(true);
            rect = r.getClientRects()[0] || null;
          }
          if (!rect) {
            // An empty item: its box is the only thing on the line
            const lr = li.getBoundingClientRect();
            rect = { left: lr.left + lr.width / 2 + em * 0.8, top: lr.top, bottom: lr.top + em * 1.7 };
          }
          if (e.clientX >= rect.left - em * 2 && e.clientX < rect.left - 1 && e.clientY >= rect.top - 6 && e.clientY <= rect.bottom + 6) {
            li.classList.toggle('checked');
            this.changed();
          }
        }
        const a = e.target.closest('a');
        if (a && el.contains(a) && this.hooks.onLink) this.hooks.onLink(a);
      });

      document.addEventListener('selectionchange', () => {
        if (this.range()) {
          this.remember();
          this.emit();
        }
      });
    }

    // After Enter: a new line after a heading, title or subtitle is normal text, and a new
    // checklist item starts unticked
    afterEnter() {
      const r = this.range();
      if (!r) return;
      const block = this.blockOf(r.startContainer);
      if (!block) return;
      if (block.tagName === 'LI') {
        if (!block.textContent.trim()) block.classList.remove('checked');
        return;
      }
      const prev = block.previousElementSibling;
      const empty = !block.textContent.trim();
      if (empty && prev && (prev.classList.contains('title') || prev.classList.contains('subtitle') || /^H[1-3]$/.test(prev.tagName)) && (block.tagName === prev.tagName || block.className)) {
        const p = document.createElement('p');
        if (block.style.textAlign) p.style.textAlign = block.style.textAlign;
        p.innerHTML = '<br>';
        block.replaceWith(p);
        this.caretTo(p);
      }
    }

    onKey(e) {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      // Undo / redo
      if (mod && !e.altKey && k === 'z') {
        e.preventDefault();
        e.shiftKey ? this.redo() : this.undo();
        return;
      }
      if (mod && !e.altKey && k === 'y') {
        e.preventDefault();
        this.redo();
        return;
      }
      // Formatting shortcuts
      const run = (cmd, value) => {
        e.preventDefault();
        this.exec(cmd, value);
      };
      if (mod && !e.altKey && !e.shiftKey) {
        if (k === 'b') return run('bold');
        if (k === 'i') return run('italic');
        if (k === 'u') return run('underline');
        if (k === '.') return run('superscript');
        if (k === ',') return run('subscript');
        if (k === '\\') return run('clear');
        if (k === ']') return run('indent');
        if (k === '[') return run('outdent');
      }
      if (mod && e.shiftKey && !e.altKey) {
        if (k === 'x' || e.code === 'KeyX') return run('strikeThrough');
        if (e.code === 'Digit7') return run('list', 'ol');
        if (e.code === 'Digit8') return run('list', 'ul');
        if (e.code === 'Digit9') return run('list', 'check');
        if (k === 'l') return run('align', 'left');
        if (k === 'e') return run('align', 'center');
        if (k === 'r') return run('align', 'right');
        if (k === 'j') return run('align', 'justify');
      }
      if (e.altKey && e.shiftKey && !mod && e.code === 'Digit5') return run('strikeThrough');
      if (mod && e.altKey && /^Digit[0-3]$/.test(e.code)) {
        return run('style', ['normal', 'h1', 'h2', 'h3'][Number(e.code.slice(-1))]);
      }

      // A picture is selected: Delete/Backspace removes it
      if (this.selImg && (e.key === 'Backspace' || e.key === 'Delete')) {
        e.preventDefault();
        this.imageOp('remove');
        return;
      }

      if (e.key === 'Tab') {
        const cell = this.cell();
        if (cell) {
          e.preventDefault();
          const cells = [...cell.closest('table').querySelectorAll('td, th')];
          let i = cells.indexOf(cell) + (e.shiftKey ? -1 : 1);
          if (i >= cells.length) {
            this.tableOp('rowBelow');
            return;
          }
          i = Math.max(0, i);
          this.caretTo(cells[i], true);
          return;
        }
        e.preventDefault();
        const block = this.blockOf(this.range() && this.range().startContainer);
        if (block && block.closest('li')) this.exec(e.shiftKey ? 'outdent' : 'indent');
        else if (!e.shiftKey) this.exec('text', '  ');
        return;
      }

      // Markdown-style shortcuts at the start of a line: "# ", "- ", "1. ", "[] ", "> "
      if (e.key === ' ' && !mod && !e.altKey) {
        const r = this.range();
        if (r && r.collapsed) {
          const block = this.blockOf(r.startContainer);
          if (block && block.tagName === 'P' && !block.className && block.parentElement === this.el) {
            const pre = document.createRange();
            pre.setStart(block, 0);
            pre.setEnd(r.startContainer, r.startOffset);
            const typed = pre.toString();
            const map = { '#': ['style', 'h1'], '##': ['style', 'h2'], '###': ['style', 'h3'], '-': ['list', 'ul'], '*': ['list', 'ul'], '1.': ['list', 'ol'], '[]': ['list', 'check'], '[ ]': ['list', 'check'], '>': ['style', 'quote'] };
            const hit = map[typed];
            if (hit) {
              e.preventDefault();
              const sel = window.getSelection();
              sel.removeAllRanges();
              sel.addRange(pre);
              document.execCommand('delete');
              if (!block.textContent) block.innerHTML = '<br>';
              this.caretTo(block);
              this.exec(hit[0], hit[1]);
              return;
            }
          }
        }
      }
      // "---" then Enter makes a line across the page
      if (e.key === 'Enter' && !e.shiftKey && !mod) {
        const r = this.range();
        const block = r && this.blockOf(r.startContainer);
        if (block && block.tagName === 'P' && block.parentElement === this.el && block.textContent.trim() === '---') {
          e.preventDefault();
          const hr = document.createElement('hr');
          block.replaceWith(hr);
          let next = hr.nextElementSibling;
          if (!next || next.tagName !== 'P') {
            next = document.createElement('p');
            next.innerHTML = '<br>';
            hr.after(next);
          }
          this.caretTo(next);
          this.changed();
        }
      }
    }

    insertClean(html) {
      if (!html) return;
      document.execCommand('insertHTML', false, html);
      // Lists or headings pasted into a paragraph come back out to the top level
      for (const p of [...this.el.querySelectorAll(':scope > p')]) {
        const inner = [...p.children].find((c) => /^(UL|OL|TABLE|H[1-3]|BLOCKQUOTE|PRE|P)$/.test(c.tagName));
        if (inner) {
          const tmp = document.createElement('div');
          tmp.innerHTML = NN.convert.clean(p.outerHTML);
          p.replaceWith(...tmp.childNodes);
        }
      }
    }

    onPaste(e) {
      const dt = e.clipboardData;
      if (!dt) return;
      const files = [...dt.files].filter((f) => f.type.startsWith('image/'));
      if (files.length) {
        e.preventDefault();
        files.forEach((f) => this.hooks.onImageFile && this.hooks.onImageFile(f));
        return;
      }
      const html = dt.getData('text/html');
      const text = dt.getData('text/plain');
      e.preventDefault();
      this.restore();
      if (html) {
        this.insertClean(NN.convert.clean(html, { paste: true }));
      } else if (text) {
        if (!/\n/.test(text)) document.execCommand('insertText', false, text);
        else {
          const paras = text.replace(/\r\n?/g, '\n').split(/\n{2,}/).map((p) => `<p>${NN.convert.esc(p).replace(/\n/g, '<br>')}</p>`);
          this.insertClean(paras.join(''));
        }
      }
      this.changed();
    }

    onDrop(e) {
      const dt = e.dataTransfer;
      if (!dt) return;
      const files = [...dt.files];
      if (files.length) {
        e.preventDefault();
        e.stopPropagation();
        this.placeCaretAt(e.clientX, e.clientY);
        for (const f of files) {
          if (f.type.startsWith('image/')) this.hooks.onImageFile && this.hooks.onImageFile(f);
          else this.hooks.onFile && this.hooks.onFile(f);
        }
        return;
      }
      const html = dt.getData('text/html');
      if (html) {
        e.preventDefault();
        this.placeCaretAt(e.clientX, e.clientY);
        this.insertClean(NN.convert.clean(html, { paste: true }));
        this.changed();
      }
    }
    placeCaretAt(x, y) {
      let r = null;
      if (document.caretRangeFromPoint) r = document.caretRangeFromPoint(x, y);
      else if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(x, y);
        if (pos) {
          r = document.createRange();
          r.setStart(pos.offsetNode, pos.offset);
        }
      }
      if (r && this.el.contains(r.startContainer)) {
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
      } else this.restore();
    }
  }

  NN.Editor = Editor;
  NN.STYLES = STYLES;
})();
