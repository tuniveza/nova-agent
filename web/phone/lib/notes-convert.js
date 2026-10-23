/* Notes — convert.js
   Getting writing in and out:
   - clean(): makes any HTML (pasted from Google Docs or a web page, or imported) safe and tidy,
     keeping only the formatting the editor understands
   - fromMarkdown() / toMarkdown(), toText()
   - exportDocument(): a styled, self-contained HTML document in the Novacane look. Google Docs,
     Word and browsers all read it, so it's what goes to Google Docs and into downloads.
   Every block that hasn't been given an alignment comes out centred, like in the editor.

   Nova Phone's copy of Nova Desk's Notes convert.js (web/notes/js/convert.js), so a note saved on the phone keeps
   exactly what Desk keeps (the same classes, quest ties, colours, fonts, sizes, alignment…). The one difference:
   Nova Phone's page rules (CSP) refuse style="…" written into HTML, so no HTML with style attributes is ever
   parsed or set here. Styles travel as data-style while HTML is parsed, are put on elements through the CSSOM
   (el.style, which the rules allow), and come back as style="…" only in the finished text that's saved.
   The output is byte for byte what Desk's clean() gives (checked by /tmp/claude-1000/notes tests). */
(function () {
  'use strict';
  const NN = (window.NovaNotes = window.NovaNotes || {});

  // ---------- STYLES WITHOUT style="…" ----------

  // A document to build in that's never shown
  let work = null;
  const W = () => work || (work = document.implementation.createHTMLDocument(''));
  // Every tag, with its attributes (quoted values may hold ">")
  const TAG = /<([a-zA-Z][^\s/>]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g;
  const ATTR = /(\s+)([^\s"'>/=]+)(\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  const rename = (from, to) => (html) => String(html ?? '').replace(TAG, (t, name, attrs, slash) => {
    if (!attrs || !new RegExp(`\\s${from}\\s*=`, 'i').test(attrs)) return t;
    return `<${name}${attrs.replace(ATTR, (a, sp, n, v) => (n.toLowerCase() === from ? `${sp}${to}${v || ''}` : a))}${slash ? ' /' : ''}>`;
  });
  // style="…" → data-style="…" (to parse), and back (in the finished text)
  const toData = rename('style', 'data-style');
  const fromData = rename('data-style', 'style');
  // Each data-style put on through the CSSOM
  function applyStyles(root) {
    for (const el of root.querySelectorAll('[data-style]')) {
      el.style.cssText = el.getAttribute('data-style');
      el.removeAttribute('data-style');
    }
    return root;
  }
  // Put HTML (with style="…") into an element on the page
  function setHTML(el, html) {
    el.innerHTML = toData(html);
    applyStyles(el);
  }
  // Any HTML as a document of its own (its styles on through the CSSOM when asked)
  function parse(html, styles = true) {
    const doc = new DOMParser().parseFromString(toData(String(html || '').replace(/<style[\s\S]*?<\/style>/gi, '')), 'text/html');
    if (styles) applyStyles(doc.body);
    return doc;
  }
  const textOf = (html) => parse(String(html || '').replace(/<\/(p|h[1-6]|li|td|th|blockquote|pre)>|<br\s*\/?>/gi, ' $&'), false).body.textContent.replace(/\s+/g, ' ').trim();

  // ---------- CLEANING ----------

  // Tags kept as they are (or renamed); anything else is unwrapped (its contents kept)
  const RENAME = {
    P: 'p', DIV: 'p', SECTION: 'p', ARTICLE: 'p', HEADER: 'p', FOOTER: 'p', MAIN: 'p', ASIDE: 'p', FIGURE: 'p', FIGCAPTION: 'p', DT: 'p', DD: 'p', ADDRESS: 'p', CENTER: 'p',
    H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h3', H5: 'h3', H6: 'h3',
    BLOCKQUOTE: 'blockquote', PRE: 'pre', UL: 'ul', OL: 'ol', LI: 'li', DL: 'ul',
    TABLE: 'table', THEAD: 'tbody', TBODY: 'tbody', TFOOT: 'tbody', TR: 'tr', TD: 'td', TH: 'th',
    HR: 'hr', BR: 'br', IMG: 'img', A: 'a',
    B: 'b', STRONG: 'b', I: 'i', EM: 'i', CITE: 'i', U: 'u', INS: 'u', S: 's', STRIKE: 's', DEL: 's',
    CODE: 'code', KBD: 'code', SAMP: 'code', TT: 'code', SUB: 'sub', SUP: 'sup',
    SPAN: 'span', FONT: 'span', MARK: 'span', SMALL: 'span', BIG: 'span', LABEL: 'span'
  };
  // Dropped with everything inside them
  const DROP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'TITLE', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'BUTTON', 'SELECT', 'TEXTAREA', 'FORM', 'COLGROUP', 'COL', 'XML', 'O:P']);
  const BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'pre', 'ul', 'ol', 'table', 'hr']);
  const TEXT_BLOCK = new Set(['p', 'h1', 'h2', 'h3', 'blockquote', 'pre']);
  const KEEP_CLASS = { p: ['title', 'subtitle'], ul: ['nn-check'], li: ['checked'], hr: ['page-break'], table: ['nn-table'] };

  const ALIGN = { left: 'left', start: 'left', center: 'center', right: 'right', end: 'right', justify: 'justify' };

  // Colour to #rrggbb, or '' for transparent / unreadable
  function hex(value) {
    const v = String(value || '').trim().toLowerCase();
    if (!v || v === 'transparent' || v === 'inherit' || v === 'initial' || v === 'currentcolor') return '';
    let m = v.match(/^#([0-9a-f]{3})$/);
    if (m) return '#' + m[1].split('').map((c) => c + c).join('');
    if (/^#[0-9a-f]{6}$/.test(v)) return v;
    m = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
    if (m) {
      if (m[4] !== undefined && parseFloat(m[4]) === 0) return '';
      return '#' + [m[1], m[2], m[3]].map((n) => Math.min(255, +n).toString(16).padStart(2, '0')).join('');
    }
    return '';
  }

  // A font size in pt (12px = 9pt), or 0
  function points(value) {
    const m = String(value || '').trim().match(/^([\d.]+)(pt|px|em|rem)?$/);
    if (!m) return 0;
    const n = parseFloat(m[1]);
    const pt = m[2] === 'px' || !m[2] ? n * 0.75 : m[2] === 'em' || m[2] === 'rem' ? n * 12 : n;
    return pt >= 6 && pt <= 96 ? Math.round(pt * 2) / 2 : 0;
  }

  // The styles worth keeping on an element, as a style string
  function keepStyles(el, tag, opts) {
    const s = el.style;
    const out = [];
    const block = TEXT_BLOCK.has(tag) || tag === 'li' || tag === 'td' || tag === 'th';
    if (block) {
      const a = ALIGN[(s.textAlign || el.getAttribute('align') || '').toLowerCase()];
      if (a) out.push(`text-align: ${a}`);
      const lh = parseFloat(s.lineHeight);
      if (lh && /^[\d.]+$/.test(s.lineHeight) && lh >= 1 && lh <= 3) out.push(`line-height: ${lh}`);
      const indent = parseFloat(s.marginLeft) || parseFloat(s.paddingLeft) || 0;
      if (tag === 'p' && indent >= 18) out.push(`margin-left: ${Math.min(216, Math.round(indent / 36) * 36)}px`);
    }
    if (tag === 'img') {
      const w = s.width || el.getAttribute('width');
      if (w && /%$/.test(w)) out.push(`width: ${Math.min(100, parseFloat(w))}%`);
      else if (parseFloat(w) > 0) out.push(`width: ${Math.round(parseFloat(w))}px`);
      return out.join('; ');
    }
    const color = hex(s.color || el.getAttribute('color'));
    // Pasted text is usually plain black or white: let the editor's own colour show instead
    if (color && !(opts.paste && /^#(000000|ffffff|0e101a|1f1f1f|202124|222222)$/.test(color))) out.push(`color: ${color}`);
    const bg = hex(s.backgroundColor);
    if (bg && bg !== '#ffffff') out.push(`background-color: ${bg}`);
    const fw = s.fontWeight;
    if (fw === 'bold' || parseInt(fw, 10) >= 600) out.push('font-weight: 700');
    if (s.fontStyle === 'italic') out.push('font-style: italic');
    const deco = `${s.textDecorationLine || ''} ${s.textDecoration || ''}`;
    if (/underline/.test(deco) && tag !== 'a') out.push('text-decoration: underline');
    else if (/line-through/.test(deco)) out.push('text-decoration: line-through');
    const family = (s.fontFamily || el.getAttribute('face') || '').split(',')[0].replace(/["']/g, '').trim();
    if (family && !(opts.paste && /^(arial|helvetica|sans-serif|serif|calibri|times new roman|-apple-system|system-ui|docs-calibri|roboto|segoe ui)$/i.test(family))) out.push(`font-family: '${family.replace(/[^\w\s-]/g, '')}'`);
    const size = points(s.fontSize);
    if (size && !(opts.paste && (size === 11 || size === 12))) out.push(`font-size: ${size}pt`);
    const va = s.verticalAlign;
    if (va === 'super' || va === 'sub') out.push(`vertical-align: ${va}`);
    return out.join('; ');
  }

  const safeUrl = (url, images) => {
    const u = String(url || '').trim();
    if (images) return /^(https?:|data:image\/(png|jpe?g|gif|webp|svg\+xml);)/i.test(u) ? u : '';
    return /^(https?:|mailto:|tel:|#)/i.test(u) ? u : /^www\./i.test(u) ? 'https://' + u : '';
  };

  // Copy one element's allowed attributes onto its clean twin
  function cleanElement(src, tag, opts) {
    const el = W().createElement(tag);
    const style = keepStyles(src, tag, opts);
    if (style) {
      // (Desk's own words for it, where Desk puts its style attribute; and on through the CSSOM, to be read)
      el.setAttribute('data-style', style);
      el.style.cssText = style;
    }
    const classes = (KEEP_CLASS[tag] || []).filter((c) => src.classList.contains(c));
    if (classes.length) el.className = classes.join(' ');
    if (tag === 'a') {
      const href = safeUrl(src.getAttribute('href'));
      if (!href) return null; // unwrap links that go nowhere safe
      el.setAttribute('href', href);
    }
    if (tag === 'img') {
      const url = safeUrl(src.getAttribute('src'), true);
      if (!url) return 'drop';
      el.setAttribute('src', url);
      const alt = src.getAttribute('alt');
      if (alt) el.setAttribute('alt', alt.slice(0, 300));
    }
    if ((tag === 'td' || tag === 'th') && +src.getAttribute('colspan') > 1) el.setAttribute('colspan', Math.min(20, +src.getAttribute('colspan')));
    if ((tag === 'td' || tag === 'th') && +src.getAttribute('rowspan') > 1) el.setAttribute('rowspan', Math.min(50, +src.getAttribute('rowspan')));
    if (tag === 'ol' && +src.getAttribute('start') > 1) el.setAttribute('start', +src.getAttribute('start'));
    // A quest heading's mode and its tie to Nova Quests (tasks.js): kept with the note
    if (tag === 'h2' || tag === 'h3') {
      const mode = /^(waiting|soon|working|nearly|longer|questions|done)$/;
      if (mode.test(src.getAttribute('data-task') || '')) el.setAttribute('data-task', src.getAttribute('data-task'));
      if (mode.test(src.getAttribute('data-qsync') || '')) el.setAttribute('data-qsync', src.getAttribute('data-qsync'));
      if (/^[\w-]{1,64}$/.test(src.getAttribute('data-qid') || '')) el.setAttribute('data-qid', src.getAttribute('data-qid'));
      if (/^[\w-]{1,32}$/.test(src.getAttribute('data-qkey') || '')) el.setAttribute('data-qkey', src.getAttribute('data-qkey'));
    }
    return el;
  }

  function copyChildren(src, out, opts) {
    for (const node of [...src.childNodes]) {
      if (node.nodeType === 3) {
        out.appendChild(W().createTextNode(node.data));
        continue;
      }
      if (node.nodeType !== 1) continue;
      const name = node.nodeName.toUpperCase();
      if (DROP.has(name)) continue;
      // Google Docs wraps a paste in <b style="font-weight:normal" id="docs-internal-guid-…">
      if (name === 'B' && /font-weight:\s*(normal|400)/i.test(node.getAttribute('style') || '')) {
        copyChildren(node, out, opts);
        continue;
      }
      // A checkbox from an HTML or Markdown task list marks the list item
      if (name === 'INPUT' && node.type === 'checkbox') {
        const li = out.closest ? out.closest('li') : null;
        if (li) {
          if (node.checked || node.hasAttribute('checked')) li.classList.add('checked');
          const list = li.parentElement;
          if (list && list.tagName === 'UL') list.classList.add('nn-check');
        }
        continue;
      }
      const tag = RENAME[name];
      if (!tag) {
        copyChildren(node, out, opts);
        continue;
      }
      let el = cleanElement(node, tag, opts);
      if (el === 'drop') continue;
      if (!el) {
        copyChildren(node, out, opts);
        continue;
      }
      // Pasted bold/italic that a style turned off isn't bold/italic
      if ((tag === 'b' && /font-weight:\s*(normal|[1-5]00)/i.test(node.getAttribute('style') || '')) || (tag === 'i' && /font-style:\s*normal/i.test(node.getAttribute('style') || ''))) {
        el = W().createElement('span');
      }
      if (tag === 'pre') {
        // keep line breaks of code as <br>
        el.textContent = '';
        const lines = node.textContent.replace(/\n$/, '').split('\n');
        lines.forEach((line, i) => {
          if (i) el.appendChild(W().createElement('br'));
          el.appendChild(W().createTextNode(line));
        });
      } else if (tag !== 'img' && tag !== 'br' && tag !== 'hr') {
        copyChildren(node, el, opts);
      }
      // Turn a style-only span into the matching tag where it's simpler
      if (tag === 'span' && /vertical-align: super/.test(el.getAttribute('style') || '')) {
        const sup = W().createElement('sup');
        sup.append(...el.childNodes);
        el = sup;
      }
      if (tag === 'span' && !el.getAttribute('style')) {
        out.append(...el.childNodes); // nothing worth keeping on it
        continue;
      }
      out.appendChild(el);
    }
  }

  // Make sure blocks hold only inline content, and the top level holds only blocks
  function fixStructure(root) {
    // Split text blocks that ended up with blocks inside them (e.g. <div><p>…</p></div> → <p><p>)
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      for (const el of [...root.querySelectorAll('p, h1, h2, h3, pre, blockquote')]) {
        const inner = [...el.children].find((c) => BLOCK.has(c.tagName.toLowerCase()));
        if (!inner) continue;
        changed = true;
        const parts = [];
        let run = el.cloneNode(false);
        for (const node of [...el.childNodes]) {
          if (node.nodeType === 1 && BLOCK.has(node.tagName.toLowerCase())) {
            if (run.childNodes.length) parts.push(run);
            // A nested block inherits the outer block's alignment if it has none
            if (!node.style.textAlign && el.style.textAlign && TEXT_BLOCK.has(node.tagName.toLowerCase())) node.style.textAlign = el.style.textAlign;
            parts.push(node);
            run = el.cloneNode(false);
          } else run.appendChild(node);
        }
        if (run.childNodes.length) parts.push(run);
        el.replaceWith(...parts);
      }
    }
    // Lists hold only list items; table rows only cells
    for (const list of root.querySelectorAll('ul, ol')) {
      for (const node of [...list.childNodes]) {
        if (node.nodeType === 1 && node.tagName === 'LI') continue;
        if (node.nodeType === 1 && (node.tagName === 'UL' || node.tagName === 'OL')) {
          const prev = node.previousElementSibling;
          if (prev && prev.tagName === 'LI') prev.appendChild(node);
          else {
            const li = W().createElement('li');
            node.replaceWith(li);
            li.appendChild(node);
          }
          continue;
        }
        if (node.nodeType === 3 && !node.data.trim()) {
          node.remove();
          continue;
        }
        const li = W().createElement('li');
        node.replaceWith(li);
        li.appendChild(node);
      }
    }
    for (const li of root.querySelectorAll('li')) {
      // <li><p>text</p></li> → <li>text</li>
      for (const p of [...li.children]) if (p.tagName === 'P' || /^H[1-3]$/.test(p.tagName)) {
        if (p.style.textAlign && !li.style.textAlign) li.style.textAlign = p.style.textAlign;
        p.replaceWith(...p.childNodes);
      }
    }
    for (const cell of root.querySelectorAll('td, th')) {
      const blocks = [...cell.children].filter((c) => c.tagName === 'P' || /^H[1-3]$/.test(c.tagName));
      blocks.forEach((p, i) => {
        if (p.style.textAlign && !cell.style.textAlign) cell.style.textAlign = p.style.textAlign;
        const frag = [...p.childNodes];
        if (i < blocks.length - 1) frag.push(W().createElement('br'));
        p.replaceWith(...frag);
      });
    }
    for (const table of root.querySelectorAll('table')) {
      table.classList.add('nn-table');
      // rows directly in the table go into a tbody
      const loose = [...table.children].filter((c) => c.tagName === 'TR');
      if (loose.length) {
        const body = W().createElement('tbody');
        loose.forEach((r) => body.appendChild(r));
        table.appendChild(body);
      }
      for (const cell of table.querySelectorAll('td, th')) if (!cell.childNodes.length) cell.appendChild(W().createElement('br'));
    }
    // Inline content at the top level goes into paragraphs
    let run = null;
    for (const node of [...root.childNodes]) {
      const isBlock = node.nodeType === 1 && BLOCK.has(node.tagName.toLowerCase());
      if (isBlock) {
        run = null;
        continue;
      }
      if (node.nodeType === 3 && !node.data.trim()) {
        if (!run) node.remove();
        else run.appendChild(node);
        continue;
      }
      if (node.nodeType === 1 && node.tagName === 'BR' && !run) {
        node.remove();
        continue;
      }
      if (!run) {
        run = W().createElement('p');
        node.replaceWith(run);
      }
      run.appendChild(node);
    }
    // Whitespace-only text between blocks, and trailing <br> in blocks that have text
    for (const el of root.querySelectorAll('p, h1, h2, h3, blockquote, li')) {
      if (!el.textContent.trim() && !el.querySelector('img, br')) el.appendChild(W().createElement('br'));
    }
    return root;
  }

  // Any HTML → clean editor HTML. opts.paste: tone down pasted styling.
  function clean(html, opts = {}) {
    const doc = parse(html);
    const root = W().createElement('div');
    copyChildren(doc.body, root, opts);
    fixStructure(root);
    // Text nodes made only of layout whitespace (from pretty-printed HTML) inside blocks
    const walker = W().createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const t of nodes) {
      if (t.parentElement && t.parentElement.closest('pre')) continue;
      t.data = t.data.replace(/[\t\n\r ]+/g, ' ');
    }
    // Desk's words for each element's styles: what cleaning gave it, unless tidying changed them since (then, as
    // in Desk, the browser's own words for them); then style="…" in the text
    const probe = W().createElement('span');
    for (const el of root.querySelectorAll('[style], [data-style]')) {
      const now = el.getAttribute('style');
      const given = el.getAttribute('data-style');
      if (given !== null) {
        probe.style.cssText = given;
        if ((probe.getAttribute('style') || '') !== (now || '')) {
          if (now !== null) el.setAttribute('data-style', now);
          else el.removeAttribute('data-style');
        }
      } else if (now !== null) el.setAttribute('data-style', now);
      el.removeAttribute('style');
    }
    return fromData(root.innerHTML);
  }

  // ---------- MARKDOWN ----------

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function inlineMd(text) {
    const codes = [];
    let s = esc(text).replace(/`([^`]+)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`);
    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, alt, src) => `<img alt="${alt}" src="${src}">`)
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, t, href) => `<a href="${href}">${t}</a>`)
      .replace(/(^|[\s(])(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '$1<a href="$2">$2</a>')
      .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
      .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<b>${a || b}</b>`)
      .replace(/(^|[^*\w])\*(?!\s)(.+?)(?<!\s)\*(?!\*)/g, '$1<i>$2</i>')
      .replace(/(^|[^\w])_(?!\s)(.+?)(?<!\s)_(?!\w)/g, '$1<i>$2</i>')
      .replace(/~~(.+?)~~/g, '<s>$1</s>')
      .replace(/&lt;u&gt;(.+?)&lt;\/u&gt;/g, '<u>$1</u>')
      .replace(/ {2,}$/g, '<br>');
    return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[+i]}</code>`);
  }

  // Does this plain text look like Markdown? (headings, lists, quotes, code, bold, links, tables)
  function looksLikeMarkdown(text) {
    const t = String(text || '');
    let score = 0;
    if (/^#{1,6}\s+\S/m.test(t)) score += 2;
    if (/^\s*([-*+]|\d+[.)])\s+\S/m.test(t)) score += 1;
    if (/^\s*[-*+]\s+\[[ xX]\]\s/m.test(t)) score += 2;
    if (/^>\s/m.test(t)) score += 1;
    if (/^```/m.test(t)) score += 2;
    if (/\*\*[^*\n]+\*\*|__[^_\n]+__/.test(t)) score += 1;
    if (/\[[^\]\n]+\]\([^)\s]+\)/.test(t)) score += 1;
    if (/^\|.+\|\s*$/m.test(t) && /^\|?\s*:?-{3,}/m.test(t)) score += 2;
    return score >= 2;
  }

  function fromMarkdown(md) {
    const lines = String(md || '').replace(/\r\n?/g, '\n').split('\n');
    // A single "# " at the very top is the note's Title, and "##" are its main headings
    // (that's how Notes writes Markdown, and how most Markdown documents are laid out)
    let fenced = false;
    const levelOnes = lines.filter((l) => {
      if (/^\s*(```|~~~)/.test(l)) fenced = !fenced;
      return !fenced && /^\s{0,3}#\s+\S/.test(l);
    }).length;
    const firstLine = lines.find((l) => l.trim());
    const titleMode = levelOnes === 1 && /^\s{0,3}#\s+\S/.test(firstLine || '');
    const out = [];
    let para = [];
    const flush = () => {
      if (para.length) {
        const text = para.join(' ');
        const sub = text.match(/^(\*|_)([^*_].*?)\1$/);
        if (sub && out.length === 1 && out[0].startsWith('<p class="title">')) out.push(`<p class="subtitle">${inlineMd(sub[2])}</p>`);
        else out.push(`<p>${para.map(inlineMd).join(' ')}</p>`);
      }
      para = [];
    };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Fenced code
      if (/^\s*(```|~~~)/.test(line)) {
        flush();
        const fence = line.trim().slice(0, 3);
        const code = [];
        while (++i < lines.length && !lines[i].trim().startsWith(fence)) code.push(esc(lines[i]));
        out.push(`<pre>${code.join('<br>') || '<br>'}</pre>`);
        continue;
      }
      if (!line.trim()) {
        flush();
        continue;
      }
      let m;
      if ((m = line.match(/^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/))) {
        flush();
        if (titleMode && m[1].length === 1) {
          out.push(`<p class="title">${inlineMd(m[2])}</p>`);
          continue;
        }
        let level = Math.max(1, Math.min(3, m[1].length - (titleMode ? 1 : 0)));
        // "### …QUEST…" (or TASK) is always a heading 3, so it's a quest in the side panel (tasks.js)
        if (m[1].length === 3 && /\b(quest|task)\b/i.test(m[2])) level = 3;
        out.push(`<h${level}>${inlineMd(m[2])}</h${level}>`);
        continue;
      }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
        flush();
        out.push('<hr>');
        continue;
      }
      if (/^\s{0,3}>/.test(line)) {
        flush();
        const quote = [];
        while (i < lines.length && /^\s{0,3}>/.test(lines[i])) quote.push(lines[i++].replace(/^\s{0,3}>\s?/, ''));
        i--;
        out.push(`<blockquote>${quote.map(inlineMd).join('<br>')}</blockquote>`);
        continue;
      }
      // Tables: a header row, then a |---|---| row
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
        flush();
        const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => inlineMd(c.trim()) || '<br>');
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) rows.push(cells(lines[i++]));
        i--;
        out.push(`<table class="nn-table"><tbody><tr>${head.map((c) => `<th>${c}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
        continue;
      }
      // Lists (nesting by indentation)
      if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
        flush();
        const items = [];
        while (i < lines.length && (/^\s*([-*+]|\d+[.)])\s+/.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
          const l = lines[i++];
          const lm = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
          if (lm) items.push({ depth: Math.floor(lm[1].replace(/\t/g, '    ').length / 2), ordered: /\d/.test(lm[2]), text: lm[3] });
          else items[items.length - 1].text += ' ' + l.trim();
        }
        i--;
        out.push(buildList(items));
        continue;
      }
      para.push(line.trim());
    }
    flush();
    return out.join('');
  }

  // Nested <ul>/<ol> from list items with depths
  function buildList(items) {
    let html = '';
    const stack = [];
    const open = (it) => {
      const check = /^\[( |x|X)\]\s+/.test(it.text);
      const tag = it.ordered ? 'ol' : 'ul';
      stack.push(tag);
      html += `<${tag}${check && !it.ordered ? ' class="nn-check"' : ''}>`;
    };
    const item = (it) => {
      const m = it.text.match(/^\[( |x|X)\]\s+(.*)$/);
      html += m ? `<li${m[1] !== ' ' ? ' class="checked"' : ''}>${inlineMd(m[2])}` : `<li>${inlineMd(it.text)}`;
    };
    let depth = -1;
    for (const it of items) {
      const d = Math.min(it.depth, depth + 1);
      if (d > depth) {
        open(it);
        depth = d;
      } else {
        html += '</li>';
        while (depth > d) {
          html += `</${stack.pop()}></li>`;
          depth--;
        }
      }
      item(it);
    }
    html += '</li>';
    while (stack.length) html += `</${stack.pop()}>` + (stack.length ? '</li>' : '');
    return html;
  }

  function inlineToMd(node) {
    let s = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        s += n.data.replace(/([*_`~\[\]\\])/g, '\\$1');
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      const inner = inlineToMd(n);
      const style = n.getAttribute('data-style') || '';
      if (tag === 'BR') s += '  \n';
      else if (tag === 'B' || tag === 'STRONG' || /font-weight:\s*(700|bold)/.test(style)) s += inner.trim() ? `**${inner}**` : inner;
      else if (tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(style)) s += inner.trim() ? `*${inner}*` : inner;
      else if (tag === 'S' || tag === 'STRIKE' || tag === 'DEL' || /line-through/.test(style)) s += `~~${inner}~~`;
      else if (tag === 'CODE') s += '`' + n.textContent + '`';
      else if (tag === 'A') s += `[${inner}](${n.getAttribute('href')})`;
      else if (tag === 'IMG') s += `![${n.getAttribute('alt') || ''}](${n.getAttribute('src')})`;
      else if (tag === 'U') s += `<u>${inner}</u>`;
      else s += inner;
    }
    return s;
  }

  function toMarkdown(html) {
    const root = W().createElement('div');
    root.innerHTML = toData(html);
    const out = [];
    const list = (el, depth) => {
      let n = Number(el.getAttribute('start')) || 1;
      const check = el.classList.contains('nn-check');
      for (const li of el.children) {
        const nested = [...li.children].filter((c) => c.tagName === 'UL' || c.tagName === 'OL');
        const copy = li.cloneNode(true);
        copy.querySelectorAll(':scope > ul, :scope > ol').forEach((c) => c.remove());
        const marker = el.tagName === 'OL' ? `${n++}.` : '-';
        const box = check ? (li.classList.contains('checked') ? '[x] ' : '[ ] ') : '';
        out.push(`${'  '.repeat(depth)}${marker} ${box}${inlineToMd(copy).trim()}`);
        nested.forEach((sub) => list(sub, depth + 1));
      }
    };
    // With a Title, it becomes the one "#" and the headings move down a level
    const titles = root.querySelectorAll(':scope > p.title').length;
    const shift = titles === 1 && root.firstElementChild && root.firstElementChild.classList.contains('title') ? 1 : 0;
    const hashes = (n) => '#'.repeat(Math.min(6, n + shift));
    for (const el of root.children) {
      const tag = el.tagName;
      if (el.classList.contains('title')) out.push(`# ${inlineToMd(el).trim()}`);
      else if (el.classList.contains('subtitle')) out.push(`*${inlineToMd(el).trim()}*`);
      else if (tag === 'H1') out.push(`${hashes(1)} ${inlineToMd(el).trim()}`);
      else if (tag === 'H2') out.push(`${hashes(2)} ${inlineToMd(el).trim()}`);
      else if (tag === 'H3') out.push(`${hashes(3)} ${inlineToMd(el).trim()}`);
      else if (tag === 'BLOCKQUOTE') out.push(inlineToMd(el).trim().split('\n').map((l) => `> ${l.trim()}`).join('\n'));
      else if (tag === 'PRE') out.push('```\n' + el.innerText.replace(/\n$/, '') + '\n```');
      else if (tag === 'HR') out.push('---');
      else if (tag === 'UL' || tag === 'OL') {
        list(el, 0);
      } else if (tag === 'TABLE') {
        const rows = [...el.querySelectorAll('tr')].map((tr) => [...tr.children].map((c) => inlineToMd(c).replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ').trim()));
        if (rows.length) {
          const cols = Math.max(...rows.map((r) => r.length));
          const pad = (r) => [...r, ...Array(cols - r.length).fill('')];
          out.push(`| ${pad(rows[0]).join(' | ')} |`, `|${' --- |'.repeat(cols)}`, ...rows.slice(1).map((r) => `| ${pad(r).join(' | ')} |`));
        }
      } else {
        const text = inlineToMd(el).trim();
        out.push(text);
      }
      out.push('');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  function toText(html) {
    const root = W().createElement('div');
    root.innerHTML = toData(html);
    const lines = [];
    const text = (el) => {
      const c = el.cloneNode(true);
      c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
      return c.textContent.replace(/[ \t]+/g, ' ').trim();
    };
    const list = (el, depth) => {
      let n = Number(el.getAttribute('start')) || 1;
      for (const li of el.children) {
        const copy = li.cloneNode(true);
        copy.querySelectorAll(':scope > ul, :scope > ol').forEach((c) => c.remove());
        const mark = el.classList.contains('nn-check') ? (li.classList.contains('checked') ? '☑' : '☐') : el.tagName === 'OL' ? `${n++}.` : '•';
        lines.push(`${'   '.repeat(depth)}${mark} ${text(copy)}`);
        li.querySelectorAll(':scope > ul, :scope > ol').forEach((sub) => list(sub, depth + 1));
      }
    };
    for (const el of root.children) {
      if (el.tagName === 'UL' || el.tagName === 'OL') list(el, 0);
      else if (el.tagName === 'HR') lines.push(el.classList.contains('page-break') ? '\f' : '* * *');
      else if (el.tagName === 'TABLE') for (const tr of el.querySelectorAll('tr')) lines.push([...tr.children].map(text).join('\t'));
      else lines.push(text(el));
      lines.push('');
    }
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  }

  // ---------- EXPORT ----------

  // Colour maths for the export palette
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
  const mix = (a, b, t) => toHex(rgb(a).map((v, i) => v + (rgb(b)[i] - v) * t));
  const lum = (h) => {
    const [r, g, b] = rgb(h).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  // Darken a colour until it reads well on white (contrast 4.5:1 or more)
  const readable = (h) => {
    let c = h;
    for (let i = 0; i < 12 && 1.05 / (lum(c) + 0.05) < 4.5; i++) c = mix(c, '#000000', 0.15);
    return c;
  };

  // The printed look for a theme: the theme's colours, deep enough to read on white paper
  function palette(theme) {
    const t = theme || THEMES[0];
    return {
      ink: mix('#241B2F', t.accent3, 0.25),
      title: readable(mix(t.accent3, '#000000', 0.25)),
      subtitle: readable(t.accent2),
      h1: readable(t.accent),
      h2: readable(t.accent2),
      h3: readable(mix(t.accent, t.accent2, 0.5)),
      rule: t.hi,
      link: readable(t.accent),
      quote: readable(mix(t.accent2, '#555555', 0.4)),
      wash: mix(t.soft, '#FFFFFF', 0.72),
      line: mix(t.lilac, '#FFFFFF', 0.45)
    };
  }

  // Styles each kind of block gets in the exported document (inline, so Google Docs keeps them)
  function blockStyle(el, p) {
    const tag = el.tagName;
    if (tag === 'P' && el.classList.contains('title')) return `font-family:'Archivo Black','Archivo',Arial,sans-serif;font-size:28pt;line-height:1.15;color:${p.title};margin:0 0 4pt`;
    if (tag === 'P' && el.classList.contains('subtitle')) return `font-family:'Saira',Arial,sans-serif;font-size:13pt;color:${p.subtitle};margin:0 0 16pt`;
    if (tag === 'H1') return `font-family:'Archivo Black','Archivo',Arial,sans-serif;font-size:17pt;font-weight:400;color:${p.h1};margin:20pt 0 8pt;padding-bottom:2pt;border-bottom:1pt solid ${p.rule}`;
    if (tag === 'H2') return `font-family:'Archivo',Arial,sans-serif;font-size:13pt;font-weight:700;color:${p.h2};margin:16pt 0 6pt`;
    if (tag === 'H3') return `font-family:'Saira',Arial,sans-serif;font-size:11pt;font-weight:700;color:${p.h3};margin:12pt 0 4pt;text-transform:uppercase;letter-spacing:1pt`;
    if (tag === 'BLOCKQUOTE') return `font-family:'Cormorant Garamond',Georgia,serif;font-size:15pt;font-style:italic;color:${p.quote};margin:12pt 0`;
    if (tag === 'PRE') return `font-family:'Source Code Pro','Courier New',monospace;font-size:10pt;color:${p.ink};background:${p.wash};padding:8pt 10pt;margin:8pt 0;white-space:pre-wrap`;
    return `font-family:'Saira',Arial,sans-serif;font-size:11pt;line-height:1.5;color:${p.ink};margin:0 0 8pt`;
  }

  // The editor's HTML → a complete, styled document. Everything is inline-styled.
  function exportDocument(html, { title = 'Notes', theme } = {}) {
    const p = palette(theme);
    const root = W().createElement('div');
    // (each element's own words kept as data-style, which is what's added to; its styles also put on through
    // the CSSOM, to read single ones from, and taken off again before the text is made)
    root.innerHTML = toData(html);
    for (const el of root.querySelectorAll('[data-style]')) el.style.cssText = el.getAttribute('data-style');
    const align = (el) => el.style.textAlign || 'center';
    const add = (el, css) => el.setAttribute('data-style', `${css};${el.getAttribute('data-style') || ''}`);

    for (const el of [...root.children]) {
      const tag = el.tagName;
      if (TEXT_BLOCK.has(tag.toLowerCase())) {
        const own = el.getAttribute('data-style') || '';
        const style = `${blockStyle(el, p)};text-align:${align(el)}${own ? ';' + own : ''}`;
        // Google Docs ignores centring on quotes, so a quote travels as a styled paragraph
        if (tag === 'BLOCKQUOTE') {
          const q = W().createElement('p');
          q.append(...el.childNodes);
          el.replaceWith(q);
          q.setAttribute('data-style', style);
          continue;
        }
        el.setAttribute('data-style', style);
      } else if (tag === 'HR') {
        if (el.classList.contains('page-break')) {
          const brk = W().createElement('p');
          brk.setAttribute('data-style', 'page-break-before:always;break-before:page;margin:0');
          el.replaceWith(brk);
        } else el.setAttribute('data-style', `border:0;border-top:1pt solid ${p.rule};margin:14pt 20%`);
      } else if (tag === 'UL' || tag === 'OL') {
        styleList(el, p, align);
      } else if (tag === 'TABLE') {
        el.setAttribute('data-style', `border-collapse:collapse;margin:10pt auto;width:100%`);
        el.setAttribute('cellpadding', '6');
        for (const cell of el.querySelectorAll('td, th')) {
          add(cell, `border:1pt solid ${p.line};padding:5pt 7pt;font-family:'Saira',Arial,sans-serif;font-size:10.5pt;color:${p.ink};vertical-align:top;text-align:${align(cell)}${cell.tagName === 'TH' ? `;background:${p.wash};font-weight:700` : ''}`);
        }
      }
    }
    for (const a of root.querySelectorAll('a')) add(a, `color:${p.link};text-decoration:underline`);
    for (const img of root.querySelectorAll('img')) {
      const w = img.style.width;
      img.setAttribute('data-style', `max-width:100%;height:auto${w ? `;width:${w}` : ''}`);
      if (w && /px$/.test(w)) img.setAttribute('width', parseInt(w, 10));
    }
    for (const c of root.querySelectorAll('code')) add(c, `font-family:'Source Code Pro','Courier New',monospace;background:${p.wash};padding:0 2pt`);
    root.querySelectorAll('[class]').forEach((el) => el.removeAttribute('class'));
    root.querySelectorAll('[style]').forEach((el) => el.removeAttribute('style'));

    const body = fromData(root.innerHTML);
    const doc = `<!DOCTYPE html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="generator" content="Notes · Novacane Studios">
<style>
  body { margin: 48pt auto; max-width: 640px; padding: 0 24px; font-family: 'Saira', Arial, sans-serif; color: ${p.ink}; background: #fff; }
  @import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@100..125,400..900&family=Archivo+Black&family=Saira:wght@300..700&family=Source+Code+Pro:wght@400;600&family=Cormorant+Garamond:ital,wght@1,500&display=swap');
</style>
</head>
<body>
${body}
</body>
</html>`;
    return { html: doc, body, palette: p };
  }

  // Lists: centred items need their bullets inside, and checklists become ☐ / ☑
  function styleList(list, p, align) {
    const check = list.classList.contains('nn-check');
    list.setAttribute('data-style', `margin:0 0 8pt;padding-left:0;list-style-position:inside${check ? ';list-style-type:none' : ''}`);
    for (const li of list.children) {
      li.setAttribute('data-style', `font-family:'Saira',Arial,sans-serif;font-size:11pt;line-height:1.5;color:${p.ink};text-align:${li.style.textAlign || list.style.textAlign || 'center'};margin:0 0 3pt${li.getAttribute('data-style') ? ';' + li.getAttribute('data-style') : ''}`);
      if (check) li.insertBefore(W().createTextNode(li.classList.contains('checked') ? '☑ ' : '☐ '), li.firstChild);
      for (const sub of li.querySelectorAll(':scope > ul, :scope > ol')) styleList(sub, p, align);
    }
  }

  // A document Word opens directly (and Google Drive converts) — HTML in Word's own wrapper
  function wordDocument(html, opts) {
    const { body, palette: p } = exportDocument(html, opts);
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${esc(opts.title || 'Notes')}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>@page { size: 21cm 29.7cm; margin: 2.2cm; } body { font-family: 'Saira', Arial, sans-serif; color: ${p.ink}; }</style>
</head><body>${body}</body></html>`;
  }

  // Notes' six colour themes (web/notes/js/themes.js), for the paper page and what's exported
  const THEMES = [
    { id: 'novacane', name: 'Novacane', tag: 'Magenta nebula', void: '#06040D', deep: '#100816', text: '#EBD3E7', accent: '#B01D68', accent2: '#7A1F86', accent3: '#25194D', hi: '#FF5FA8', soft: '#FFD1EA', gold: '#F2D9A0', lilac: '#C7A4FF' },
    { id: 'solar', name: 'Solar Flare', tag: 'Red-orange', void: '#0B0403', deep: '#160805', text: '#F7DDCF', accent: '#D9361E', accent2: '#F2701D', accent3: '#4A1408', hi: '#FF9548', soft: '#FFD8BE', gold: '#FFD27A', lilac: '#FFB38A' },
    { id: 'pulsar', name: 'Pulsar', tag: 'Cyan', void: '#020810', deep: '#06111C', text: '#D4EEF6', accent: '#0A7EA4', accent2: '#2563EB', accent3: '#0A2342', hi: '#3DEBFF', soft: '#C9F6FF', gold: '#F4F1C9', lilac: '#8FD3FF' },
    { id: 'aurora', name: 'Aurora', tag: 'Green & violet', void: '#03090A', deep: '#071312', text: '#D6F5EC', accent: '#0B8A6B', accent2: '#6D45E8', accent3: '#0E2A33', hi: '#5CFFC0', soft: '#D3FFEE', gold: '#F3E9A1', lilac: '#A99BFF' },
    { id: 'eclipse', name: 'Eclipse', tag: 'Gold corona', void: '#050404', deep: '#0D0B09', text: '#F1E6D2', accent: '#D9A441', accent2: '#B07A2A', accent3: '#221A10', hi: '#FFCF6E', soft: '#FFEFD0', gold: '#FFE3A3', lilac: '#FFE3A3' },
    { id: 'quasar', name: 'Quasar', tag: 'Ultraviolet', void: '#05030F', deep: '#0B0719', text: '#E2DDFB', accent: '#5B3DF5', accent2: '#B23AEE', accent3: '#141047', hi: '#A98BFF', soft: '#E4DAFF', gold: '#FFE1F4', lilac: '#C7B8FF' }
  ];
  NN.themes = { list: () => THEMES, get: (id) => THEMES.find((t) => t.id === id) || THEMES[0] };

  NN.convert = { clean, fromMarkdown, looksLikeMarkdown, toMarkdown, toText, exportDocument, wordDocument, palette, hex, esc, toData, fromData, applyStyles, setHTML, parse, textOf, keepStyles, KEEP_CLASS };
})();
