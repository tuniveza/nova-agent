# Nova Lossless Audio

Two devices, one room code, raw PCM audio over a WebRTC data channel. There's no media track, so Opus never touches the audio. Every frame that arrives is the same bytes the other mic produced.

```
mic → capture worklet → [16-byte header + PCM] → RTCDataChannel ──► other device
                                                                     │
speakers ◄── playback worklet (jitter buffer, reorder by seq) ◄──────┘

Signalling (SDP + ICE only): browser ⇄ WebSocket ⇄ LosslessRoom Durable Object ⇄ browser
```

## Files

| File | What it does |
|---|---|
| `src/worker.js` | Worker entry. Sends `/lossless/ws` to the Durable Object, answers `/lossless/ice` with STUN + TURN servers; everything else is static assets. |
| `src/room.js` | `LosslessRoom` Durable Object: holds up to 2 WebSockets per room and relays offer/answer/candidate. |
| `public/lossless/index.html` | The page: room code, Connect, Mic toggle, send format, meters, stats. |
| `public/lossless/app.js` | Peer logic: getUserMedia, RTCPeerConnection, data channel, signalling client, framing. |
| `public/lossless/capture-worklet.js` | Slices mic input into 10 ms Float32 frames. |
| `public/lossless/playback-worklet.js` | Jitter buffer + playout, in lossless or low-latency mode. |
| `test/playback.test.mjs` | The playback worklet's buffering, run in Node (`npm test`). |
| `wrangler.toml` | Assets, Durable Object binding, migration. |

## Deploy

```sh
cd ~/Projects/nova-lossless-audio
npm install
npx wrangler login        # once
npx wrangler deploy
```

Open `https://nova-lossless-audio.<your-subdomain>.workers.dev/lossless/`. It has to be HTTPS, because phones won't give a page the mic otherwise. Workers URLs are always HTTPS.

### Adding it to the existing Nova Worker instead

1. Copy `src/room.js` next to the Nova Worker's entry file and add `export { LosslessRoom } from "./room.js";`.
2. Add the `/lossless/ws` branch from `src/worker.js` to the Nova Worker's `fetch` handler. Skip the `/` redirect.
3. Serve `public/lossless/`:
   - If the Nova Worker already uses `[assets]`, copy the `lossless/` folder into its assets directory.
   - If it doesn't, add the `[assets]` block from `wrangler.toml`.
4. Add the `[[durable_objects.bindings]]` block, then add the `[[migrations]]` block **after** any existing migrations, keeping the tag unique.

Everything is under `/lossless/` and the page finds the WebSocket relative to its own URL, so it won't collide with existing routes.

## Two-device test (laptop + phone)

1. Both devices: **plug in headphones.** Echo cancellation is deliberately off so the PCM is untouched, so speakers will feed back into the mic.
2. Laptop: open the page and hit **Copy link**. The room code is in the URL (`…/lossless/#nova-ab12`). Send that link to the phone, or just type the same code on both.
3. Tap **Connect** on both and allow the mic. Order doesn't matter.
4. Status turns green ("Connected: streaming lossless PCM"). Talk; the **Them** meter should move on the other device.

What the stats mean:

- **Path**: `direct (LAN)` or `direct (via NAT)` means peer-to-peer. `relayed (TURN)` only appears once TURN is configured.
- **Sending / Receiving**: about 1,540 kbps for 32-bit float, about 780 kbps for 16-bit.
- **Their format**: should say `32-bit float, 48.0 kHz, mono`. If it says *resampling … (not bit-exact)*, the two devices ended up at different sample rates (see below).
- **Lost / late**: frames that didn't make their playback slot. Ideally 0 / 0 on decent Wi-Fi.
- **Underruns / drift drops**: the buffer ran dry, or the buffer grew too deep and the oldest frame was dropped (each device's clock runs at a slightly different speed).

### Testing locally first

`npm run dev`, then open `http://localhost:8787/lossless/` in two browser tabs. Use the same room and headphones. The phone can't use plain `http://<laptop-ip>`, because that isn't a secure context. Deploy, or run `npx wrangler dev --ip 0.0.0.0 --local-protocol https` and accept the self-signed certificate on the phone.

## Using it with Logic Pro (or any DAW) via BlackHole

The page can send from and play to any audio device, including the free BlackHole virtual audio drivers, so a DAW can record the incoming stream and send its own mix out. The same steps are on the page under "Using this with Logic Pro".

1. On the Mac, use **Chrome or Edge**. Safari can't choose an output device.
2. Install **BlackHole 2ch** and **BlackHole 16ch** from [existential.audio](https://existential.audio/blackhole/). You need one per direction; with only one, the incoming audio loops straight back to the sender. The page warns you if input and output are the same device.
3. In **Audio MIDI Setup**, set both BlackHole devices to **48,000 Hz**, and run the Logic project at 48 kHz. If they don't match, the browser resamples (the page warns about this too).
4. In Audio MIDI Setup, create a **Multi-Output Device** with your headphones and BlackHole 16ch.
5. On the page, set **Input: BlackHole 16ch**, **Output: BlackHole 2ch** and **Channels: Stereo**.
6. In Logic, go to **Settings → Audio → Devices**. Set **Input Device: BlackHole 2ch** and **Output Device: Multi-Output Device**.
7. To record the other person, use a stereo audio track on input 1–2. To send to them, use Logic's main output.
8. Turn off input monitoring on the track you record them on. Otherwise their audio goes out of Logic's main output and back to them as an echo.

Device, channel and format choices are remembered in that browser, so a studio setup only has to be picked once. If a saved device disappears, the page falls back to the default.

## Design notes

- **Wire format.** Each message is a 20-byte header (version, format, channel count, sequence number, sample rate, sample-counter timestamp, samples per channel), followed by planar PCM (all of the left channel, then all of the right). Frames are 10 ms (480 samples per channel at 48 kHz). That's about 1.5 Mbps for mono and 3 Mbps for stereo as 32-bit float, half that as 16-bit. Each side picks its own channel count; mono is played on both output channels.
- **Lossless means every frame, bit-exact.** The data channel is reliable but unordered (`DC_OPTIONS = { ordered: false }`): every packet is delivered, retransmitted if it has to be, and one slow packet doesn't hold up the ones behind it. Each frame is byte-for-byte what was sent (SCTP checksums and DTLS encryption guarantee that).
  - **Lossless mode** (the default) plays every frame. If the next one isn't here yet, playback pauses and waits, then carries on from exactly where it stopped, and the buffer target grows, so the delay settles at whatever the connection needs (it starts around 60 ms plus the network delay). **Catch up** drops the built-up audio to bring the delay back down. The sender only drops audio if about 40 s of it is stuck waiting to go out, which means the connection plainly can't carry the stream: the status says so and suggests 16-bit or mono.
  - **Low-latency mode** is the old behaviour: a frame that isn't there when it's due is replaced with silence and counted as lost, so the delay stays short.
  - Mode is per device: it decides how that device plays what it receives, and how hard it tries to send everything.
- **32-bit float vs 16-bit.** Float32 is exactly what the browser's audio engine produced. 16-bit halves the bandwidth and is still far beyond what a phone mic resolves, but it is a quantisation step, so it's not bit-exact against the float capture. Each side picks its own send format; the receiver reads it from the header.
- **Sample rate.** Both sides ask for a 48 kHz AudioContext, so no resampling happens in our code. If a browser refuses (older Firefox with a 44.1 kHz mic), it falls back to the native rate, and the receiver linearly resamples and the stats say so.
- **iOS.** The AudioContext is created and resumed inside the Connect tap. `navigator.audioSession` is set to `play-and-record` on Safari 16.4+. If iOS suspends audio (backgrounding, a phone call), a "Tap to resume audio" button appears.
- **Signalling.** The Durable Object uses the WebSocket Hibernation API. Clients send `ping` every 15 s, and the runtime answers with `pong` without waking the object. A third device gets "room is full".
- **Staying connected.** Once the call is up, audio doesn't depend on the room server. If either device's link to it drops (Wi-Fi blip, phone sleeping, or a redeploy, which resets every room), the call keeps going and the socket reconnects in the background with backoff. Each page load sends a client id, so a reconnecting device replaces its own old socket instead of being refused as a third device. If the audio link itself drops, the device that made the original offer re-offers automatically. On phones, the page asks for a screen wake lock while connected so the screen doesn't lock and pause the audio.

## Anywhere in the world: TURN

STUN gets through most home routers, but not symmetric NAT, which is common on mobile carriers (cellular data) and corporate or campus Wi-Fi. For those, the call goes through Cloudflare's TURN relay instead. It's still WebRTC and still the same lossless data channel, just routed via Cloudflare's nearest location. It also offers TURN over TLS on port 443, which gets through almost any firewall (not inside mainland China).

**Set it up once:**

1. In the Cloudflare dashboard, go to **Realtime → TURN Server** and create a TURN key. Note its **Key ID** and **API token**.
2. Store them as Worker secrets. They never reach the browser:
   ```sh
   npx wrangler secret put TURN_KEY_ID
   npx wrangler secret put TURN_KEY_API_TOKEN
   ```
3. Deploy: `npm run deploy`.

Each call then fetches `/lossless/ice`, which asks Cloudflare for short-lived credentials (6 hours, refreshed during longer calls). Without the secrets it answers with STUN only, and the page says the relay isn't set up when a connection fails.

**Cost:** Cloudflare Realtime TURN is $0.05 per GB sent from the relay to the devices, after a free 1,000 GB a month. A relayed call in mono 32-bit float is roughly 1.4 GB an hour (both directions together); stereo roughly 2.8 GB. Direct connections don't use the relay and cost nothing.

**Testing the relay from one network:** open the page with `?relay` before the `#` on one device, e.g. `https://…/lossless/?relay#my-room`. That forces the relay, so **Path** should read `relayed (TURN)`.

**Changing networks mid-call** (Wi-Fi to mobile data, say): the device that made the offer restarts ICE on the same connection, so the call keeps going without being set up again. If no new route turns up within about 15 seconds, it reconnects from scratch.

## Stretch goals

- FLAC encode/decode (e.g. a WASM libFLAC in the worklets): roughly 40–50% less bandwidth, still lossless.
- More than 2 peers: raise `MAX_PEERS`, then keep one `RTCPeerConnection` per remote peer (full mesh), keyed by the `from` id the Durable Object already stamps on relayed messages.
- Record received PCM to WAV: tee the frames in `onRemoteData` into an array and write a WAV header on stop.
