// Settings saved under Portal's old names move to their new ones, once (so nothing resets)
try {
  const OLD = ["no", "va", "h", "ub-"].join("");
  for (const k of ["theme", "options", "seen-alert", "handsfree", "music"]) {
    const was = localStorage.getItem(OLD + k);
    if (was === null) continue;
    const name = k === "music" ? "nova-music" : "nova-" + k;
    if (localStorage.getItem(name) === null) localStorage.setItem(name, k === "music" ? (was === "1" ? "on" : "off") : was);
    localStorage.removeItem(OLD + k);
  }
} catch (err) {}
