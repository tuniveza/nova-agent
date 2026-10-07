// Nova Lossless Audio — Worker entry.
//
// Routes:
//   /lossless/            static page (served from public/ by Workers Static Assets)
//   /lossless/ws?room=X   WebSocket → LosslessRoom Durable Object (signalling only, no audio)
//
// To fold this into the existing Nova Worker, copy the /lossless/ws branch into
// its fetch handler, re-export LosslessRoom, and add the binding + migration
// from wrangler.toml.

export { LosslessRoom } from "./room.js";

const ROOM_RE = /^[a-z0-9-]{1,64}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/lossless/ws") {
      const room = (url.searchParams.get("room") || "").toLowerCase();
      if (!ROOM_RE.test(room)) {
        return new Response("Bad room code", { status: 400 });
      }
      const stub = env.LOSSLESS_ROOMS.get(env.LOSSLESS_ROOMS.idFromName(room));
      return stub.fetch(request);
    }

    // Standalone deploy only: send the bare domain to the demo page.
    if (url.pathname === "/") {
      return Response.redirect(new URL("/lossless/", url).toString(), 302);
    }

    return env.ASSETS.fetch(request);
  },
};
