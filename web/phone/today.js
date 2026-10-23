// Nova Phone: Today. The day at a glance: a greeting, the three numbers that matter (new enquiries,
// today's cards, money overdue), today's calendar, the newest enquiries and alerts, money to see to, and
// what's on in Quests. Each part leads to its own screen. A part that can't load leaves itself out.
(() => {
  "use strict";
  const N = window.NovaPhone;
  const { esc, icon, row, list, empty, api, money, ago, today } = N;
  const quiet = (p) => p.then((v) => v, (e) => { if (e.signIn) throw e; return null; });
  const hello = () => { const h = new Date().getHours(); return h < 5 ? "Good night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

  N.section({
    id: "today",
    name: "Today",
    tile: "portal",
    async draw(box, path, ui) {
      ui.title("Today");
      const [cal, enq, alerts, cash, me] = await Promise.all([
        quiet(N.cal ? N.cal.load().then(() => true) : Promise.resolve(null)),
        quiet(api("/app/api/enquiries?box=new")),
        quiet(api("/app/api/notifications")),
        quiet(api("/app/api/money?status=open")),
        quiet(api("/auth/me")),
      ]);
      const name = me?.staff?.display_name ? `, ${me.staff.display_name.split(" ")[0]}` : "";
      const day = cal && N.cal ? N.cal.day(today()) : [];
      const newOnes = enq?.enquiries || [];
      const notes = alerts?.notifications || [];
      const over = cash?.summary?.overdue || {};
      N.badge("inbox", newOnes.length);
      const parts = [];
      parts.push(`<h2 class="lead">${hello()}${esc(name)}</h2><p class="sub">${esc(new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" }))}</p>`);
      parts.push(`<div class="sums">
        <a class="sum" href="#inbox"><b>${enq ? newOnes.length : "–"}</b><span>New enquir${newOnes.length === 1 ? "y" : "ies"}</span></a>
        <a class="sum" href="#calendar"><b>${cal ? day.length : "–"}</b><span>On today</span></a>
        <a class="sum${over.count ? " bad" : ""}" href="#money"><b>${cash ? (over.count ? money(over.pence) : "£0") : "–"}</b><span>Overdue</span></a>
      </div>`);
      // Portal's parts, one tap each (as on Nova Desk's Portal)
      parts.push(`<div class="chips portal-parts">${[["inbox", "Inbox", newOnes.length], ["inbox/approvals", "Approvals"], ["clients", "Clients"], ["outreach", "Campaigns"], ["outreach/social", "Social"], ["outreach/funnel", "Funnel"], ["inbox/alerts", "Alerts", notes.length], ["you", "You"]].map(([to, name, n]) => `<a class="chip" href="#${to}">${name}${n ? ` <span class="n">${n}</span>` : ""}</a>`).join("")}</div>`);
      if (cal) {
        parts.push(`<h3 class="h">Today's calendar</h3>${day.length ? list(day.map(N.cal.row)) : empty({ icon: "calendar", title: "Nothing on today", action: `<a class="btn" href="#calendar/new/${today()}">${icon("plus")} Add a note card</a>` })}`);
      }
      if (enq) {
        parts.push(`<h3 class="h">New enquiries</h3>${newOnes.length ? list([...newOnes.slice(0, 3).map(N.inbox.enquiryRow), ...(newOnes.length > 3 ? [row({ href: "#inbox", icon: "inbox", title: `All ${newOnes.length} new enquiries` })] : [])]) : empty({ icon: "inbox", title: "No new enquiries" })}`);
      }
      if (alerts && notes.length) {
        parts.push(`<h3 class="h">Alerts</h3>${list([...notes.slice(0, 3).map(N.inbox.alertRow), row({ href: "#inbox/alerts", icon: "bell", title: notes.length > 3 ? `All ${notes.length} alerts` : "Alerts" })])}`);
      }
      if (cash) {
        const s = cash.summary || {};
        const owed = s.owed || {};
        parts.push(`<h3 class="h">Money</h3>${list([row({ href: "#money", icon: "money", title: over.count ? `${over.count} invoice${over.count > 1 ? "s" : ""} overdue` : s.waitingApproval ? `${s.waitingApproval} waiting for approval` : "Nothing overdue", text: [owed.count ? `${money(owed.pence)} owed on ${owed.count} invoice${owed.count > 1 ? "s" : ""}` : "", s.month ? `${money(s.month.inPence)} in this month` : ""].filter(Boolean).join(" · ") || "Invoices and payments" })])}`);
      }
      if (N.quests) {
        const now = await quiet(N.quests.now());
        if (now && now.length) parts.push(`<h3 class="h">Quests on now</h3>${list(now.slice(0, 3).map(N.quests.row))}`);
      }
      box.innerHTML = parts.join("");
    },
  });
})();
