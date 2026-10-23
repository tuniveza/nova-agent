// The phone preview: made-up answers for You, the crew and signing in (you.js, signin.js). Nobody real.
// Open index.html?auth=out to start signed out (any email, password "wrong" fails), ?auth=setup for the very first
// set-up, #join/abc123 for an invite (#join/old for one that's expired).
(() => {
  const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();
  const mode = new URLSearchParams(location.search).get("auth") || "";
  const ss = { get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, v); } catch (e) {} } };
  let signedIn = !mode || ss.get("sample-in") === "1";
  let setupNeeded = mode === "setup";
  const people = [
    { id: "s1", display_name: "Jordan Lee", role: "admin", status: "active", email: "jordan@example.com", created_at: iso(300000), last_login_at: iso(5), planet_seed: "s1~3fa9c2d1", index_partition: "staff:s1" },
    { id: "s2", display_name: "Sam Okoro", role: "staff", status: "active", email: "sam@example.com", created_at: iso(200000), last_login_at: iso(600), planet_seed: "s2", index_partition: "staff:s2" },
    { id: "s3", display_name: "Alex Rivers", role: "staff", status: "invited", email: "alex@example.com", created_at: iso(3000), last_login_at: null, planet_seed: "s3", index_partition: "staff:s3" },
    { id: "s4", display_name: "Robin Marsh", role: "staff", status: "disabled", email: "robin@example.com", created_at: iso(400000), last_login_at: iso(90000), planet_seed: "s4", index_partition: "staff:s4" },
  ];
  const me = () => ({ ...people[0], planet: { name: "Velora", description: "Rose-gold world · violet rings · 2 moons" } });
  const invite = (id) => ({ ok: true, invite_url: `https://nova.example/portal/?invite=tok-${id}-${Math.random().toString(36).slice(2, 8)}`, invite_expires: new Date(Date.now() + 7 * 864e5).toISOString() });
  const out = (status, error) => ({ status, body: { error } });
  (window.NovaSampleExtra = window.NovaSampleExtra || []).push((u, method, body) => {
    const p = u.pathname;
    if (p === "/auth/status") return { setupNeeded, signedIn, staff: signedIn ? me() : null };
    if (p === "/auth/login" && method === "POST") {
      if (!body?.email || body.password === "wrong") return out(401, "That email and password don't match.");
      signedIn = true; ss.set("sample-in", "1");
      return { ok: true, staff: me() };
    }
    if (p === "/auth/setup" && method === "POST") {
      if (body?.studio_password === "wrong") return out(401, "That isn't the studio's current password.");
      signedIn = true; setupNeeded = false; ss.set("sample-in", "1");
      return { ok: true, staff: { ...me(), display_name: body.display_name || "Jordan Lee", email: body.email } };
    }
    if (p === "/auth/invite") return u.searchParams.get("token") === "old" ? out(404, "This invite link has expired or was already used. Ask for a new one.") : { email: "alex@example.com", display_name: "Alex Rivers", role: "staff" };
    if (p === "/auth/invite/accept" && method === "POST") { signedIn = true; ss.set("sample-in", "1"); return { ok: true, staff: { ...people[2], status: "active", display_name: body.display_name } }; }
    if (p === "/auth/logout") { signedIn = false; ss.set("sample-in", "0"); return { ok: true }; }
    if (!signedIn && (p.startsWith("/auth/") || p.startsWith("/staff") || p.startsWith("/app/api/"))) return out(401, "Not signed in");
    if (p === "/auth/me") return { staff: me(), via: "portal" };
    if (p === "/auth/password" && method === "POST") return body?.current === "wrong" ? out(401, "Your current password isn't right.") : { ok: true };
    if (p === "/auth/google-status") return { setUp: true, clientId: "1234-abc.apps.googleusercontent.com", account: "studio@example.com", admin: true };
    if (p === "/app/api/services") return { services: [
      { id: "email", name: "Email", tech: "The studio's own mail server", ready: true, detail: "Sends from hello@example.com.", last: iso(45), test: true },
      { id: "push", name: "Phone alerts", tech: "Web Push (Apple's and Google's notification services)", ready: true },
      { id: "ai", name: "Nova Agent's thinking", tech: "Claude", ready: true },
      { id: "card", name: "Card payments", tech: "Stripe", ready: "partly", detail: "Live key only: test bookings simulate payments." },
      { id: "pc", name: "The studio computer", tech: "Nova Agent on the PC", ready: "partly", detail: "Set up, but off right now." },
      { id: "turn", name: "Lossless calls", tech: "Cloudflare TURN", ready: false },
    ] };
    if (p === "/app/api/services/test-email" && method === "POST") return { ok: true, message: "Sent to jordan@example.com. Check your inbox." };
    if (p === "/staff" && method === "GET") return { staff: people };
    if (p === "/staff" && method === "POST") {
      if (!/@/.test(body?.email || "")) return out(400, "Enter a real email address.");
      if (people.some((x) => x.email === body.email)) return out(409, "Someone with that email is already here.");
      const id = `s${people.length + 1}`;
      const s = { id, display_name: body.display_name || body.email.split("@")[0], role: body.role, status: "invited", email: body.email, created_at: iso(0), last_login_at: null, planet_seed: id, index_partition: `staff:${id}` };
      people.push(s);
      return { ...invite(id), staff: s };
    }
    const m = p.match(/^\/staff\/([^/]+)(?:\/([a-z]+))?$/);
    if (m) {
      const s = people.find((x) => x.id === decodeURIComponent(m[1]));
      if (!s) return out(404, "No one with that id");
      if (!m[2] && method === "GET") return { staff: s };
      if (!m[2] && method === "PATCH") {
        if (body.email !== undefined && people.some((x) => x.email === body.email && x !== s)) return out(409, "Someone with that email is already here.");
        if (body.status === "disabled" && s.role === "admin" && people.filter((x) => x.role === "admin" && x.status === "active").length <= 1) return out(409, "There has to be at least one active admin.");
        if (body.planet_seed === "reroll") s.planet_seed = `${s.id}~${Math.random().toString(16).slice(2, 10)}`;
        else if (body.planet_seed === "reset") s.planet_seed = s.id;
        for (const k of ["email", "display_name", "role"]) if (body[k] !== undefined) s[k] = body[k];
        if (body.status !== undefined) s.status = body.status === "active" && !s.last_login_at ? "invited" : body.status;
        return { ok: true, staff: s };
      }
      if (m[2] === "invite") return s.last_login_at ? out(409, "They've already joined.") : invite(s.id);
      if (m[2] === "password") return { ok: true, staff: s };
      if (m[2] === "index") return { partition: s.index_partition, files: [
        { scope: "staff", owner_id: s.id, path: "profile", name: `About ${s.display_name.split(" ")[0]}`, description: "Who they are and how they like to work", updated_at: Date.now() - 4e6 },
        { scope: "staff", owner_id: s.id, path: "people/maya-rose", name: "Maya Rose", description: "An artist they produce", updated_at: Date.now() - 9e7 },
        { scope: "studio", owner_id: null, path: "topics/pricing", name: "Pricing", description: "What things cost", updated_at: Date.now() - 5e6 },
      ] };
    }
    return undefined;
  });
})();
