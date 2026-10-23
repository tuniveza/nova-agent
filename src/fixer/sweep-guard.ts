// The sweep's browser looks without changing anything.
//
// The hourly sweep opens every panel signed in as the studio PC's person, in a fresh browser with
// nothing saved. Panels that find nothing saved start things: Notes once made a "Welcome to Notes"
// note on every sweep, shared with everyone (16 copies). So every request the sweep's browser makes
// to Nova Agent carries SWEEP_HEADER (sweep.ts adds it, to this server only), and Nova Agent's
// server turns away anything that would change something (any method but GET, HEAD and OPTIONS):
// shared notes, calendar saves, quests, Index, files, chats, Portal's and Nova Bot's
// addresses passed on. The panels treat the answer like the studio computer being briefly off:
// their changes stay in the sweep's own browser, which is thrown away.
//
// (Another website can't use this to stop someone's saves: a page can only add this header to its
// own requests, and the online link doesn't pass it on.)

export const SWEEP_HEADER = "x-nova-fixer-sweep";

const LOOKING = new Set(["GET", "HEAD", "OPTIONS"]);

// -> the answer for a write from the sweep, or null to carry on as usual
export function sweepWriteBlocked(req: Request): Response | null {
  if (req.headers.get(SWEEP_HEADER) !== "1" || LOOKING.has(req.method.toUpperCase())) return null;
  return Response.json(
    { error: "The Fixer's check only looks: it never changes anything", fixerSweep: true, pcOffline: true },
    { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "3600" } },
  );
}
