// Everything to do with invoices happens in the Invoicer (19 Oct 2026, the user: "put it into the
// Invoicer"). Anywhere else in Nova with an invoice button calls NovaInvoicer.open({ … }): inside Nova
// Agent the Invoicer opens in its place, set up for that (web/invoicer/app.js, fromAddress); opened on
// its own, Nova Agent opens with the Invoicer showing.
//   NovaInvoicer.open({ new: true, name, email })        a new invoice, ready to fill in
//   NovaInvoicer.open({ invoice: 12, do: "pay" })        that invoice: pay | history | share | edit | pdf | email | send | remove
//   NovaInvoicer.open({ reminder: 4 })                   a reminder's invoice, its history open
//   NovaInvoicer.open({ filter: "overdue" })             the list, narrowed (q: words to search for)
//   NovaInvoicer.open({ settings: true })                the invoice settings
(function () {
  "use strict";
  if (window.NovaInvoicer) return;
  function address(what) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(what || {})) if (v !== undefined && v !== null && v !== "" && v !== false) q.set(k, v === true ? "1" : String(v));
    const s = q.toString();
    return "/invoicer/" + (s ? "?" + s : "");
  }
  function open(what) {
    const to = address(what);
    for (const w of [window, window.parent, window.top]) {
      try {
        if (w && w.NovaAgent && w.NovaAgent.open && w.NovaAgent.open(to)) return true;
      } catch (e) {
        /* (another site's frame) */
      }
    }
    location.href = "/agent/?open=" + encodeURIComponent(to);
    return true;
  }
  window.NovaInvoicer = { open, address };
})();
