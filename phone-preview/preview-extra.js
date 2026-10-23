// The phone preview: Money and Notes say they're being redesigned next (until their new screens land).
(() => {
  const N = window.NovaPhone;
  for (const [id, name, ic, what] of [["money", "Money", "money", "Invoices with their PDFs, payments, reminders, expenses and the tax year, all made for the phone."], ["notes", "Notes", "notes", "The studio's shared notes: read, write, format, pin, search."]]) {
    if (N.has(id)) continue;
    N.section({ id, name, draw(box) { box.innerHTML = N.empty({ icon: ic, title: `${name} is being redesigned next`, text: what }); } });
  }
})();
