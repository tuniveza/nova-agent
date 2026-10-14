// Settings → Addresses: every web address in the suite (from /shared/addresses.js), each with a
// plain line, Copy and Open. Admins also see the ones other services use. portal.js calls
// PortalAddresses.render(isAdmin) when Settings opens.
(function () {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  function render(admin) {
    const box = document.getElementById("addresses-list");
    if (!box || !window.NovaAddresses) return;
    box.innerHTML = window.NovaAddresses.list(!!admin)
      .map(
        (g) => `<section class="addr-group">
          <h4 class="addr-group-title">${esc(g.title)}${g.admin ? ' <span class="pill admin">Admins</span>' : ""}</h4>
          ${g.note ? `<p class="hint">${esc(g.note)}</p>` : ""}
          <ul class="addr-list">${g.items
            .map((i) => {
              const text = i.code || i.url;
              return `<li class="addr">
                <div class="addr-words"><strong>${esc(i.name)}</strong><span class="hint">${esc(i.what)}</span></div>
                ${i.code ? `<pre class="addr-code">${esc(i.code)}</pre>` : `<code class="addr-url">${esc(i.url)}</code>`}
                <div class="addr-actions">
                  <button class="btn small ghost addr-copy" type="button" data-copy="${esc(text)}" aria-label="Copy ${esc(i.name)}">Copy</button>
                  ${i.code ? "" : `<a class="btn small ghost" href="${esc(i.url)}" target="_blank" rel="noopener" aria-label="Open ${esc(i.name)}">Open</a>`}
                </div>
              </li>`;
            })
            .join("")}</ul>
        </section>`,
      )
      .join("");
    // From "All addresses" in Apps and links: straight to this card
    if (location.hash === "#addresses-card") requestAnimationFrame(() => document.getElementById("addresses-card")?.scrollIntoView({ block: "start" }));
  }

  document.addEventListener("click", (e) => {
    const b = e.target.closest && e.target.closest(".addr-copy");
    if (!b || !navigator.clipboard) return;
    navigator.clipboard.writeText(b.dataset.copy).then(
      () => {
        b.textContent = "Copied";
        setTimeout(() => (b.textContent = "Copy"), 1400);
      },
      () => {},
    );
  });

  window.PortalAddresses = { render };
})();
