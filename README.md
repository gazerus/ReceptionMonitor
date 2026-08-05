# Reception Ambient Video

For: SET (Gladstone, QLD) — reception area monitoring
Owner: Garry Douglass

Always-on, low-res, video-only ambient stream from the reception tablet to
Garry's phone/browser, with a push-to-talk escalation. No incoming-call UI,
no default audio. See the original build spec for full context; this README
covers what's implemented and what's still open.

## Layout

```
packages/
  shared/     Config types + runtime config loader (schedule, allowlist, room, video quality)
  reception/  Capacitor + React + TS tablet app — joins the room on schedule, publishes
              ambient video, listens for talk requests
  viewer/     Plain Vite + React + TS web page — Garry's side, subscribe-only + Talk button
server/
  mint-token.php   Optional server-side access control upgrade (see below)
```

Uses [Daily.co](https://daily.co) as the WebRTC SDK (signaling + TURN handled
for you — no persistent server to run, which fits UpTime's shared cPanel
hosting). Talk-request signaling between viewer and tablet rides Daily's
`sendAppMessage`, so no separate backend is needed for that either.

## Key design choice: config is fetched at runtime, not baked into the build

`packages/shared/src/configLoader.ts` fetches a single JSON config (room URL,
schedule window, allowlist, video quality) from a URL at runtime, with a
local cache and a bundled default as fallback if the tablet is briefly
offline. **Point `VITE_CONFIG_URL` at a small JSON file hosted on the
existing cPanel site**, and editing that file — changing hours, adding
Sonja/Richie/Shane to the allowlist, tuning resolution — takes effect without
rebuilding or redeploying either app. See `packages/shared/src/config.default.json`
for the shape.

## What's implemented

- **Reception app**: polls the schedule every 30s; joins the Daily room and
  publishes ambient-quality video (no mic) when inside the window, leaves
  when outside it. Mic is acquired-but-muted at join (`startAudioOff: true`)
  so a talk request can unmute instantly with no renegotiation delay.
  Listens for `talk-request`/`talk-end` app messages, upgrading video via
  `setBandwidth({ trackConstraints })` (Daily's equivalent of raw WebRTC's
  `applyConstraints`) and toggling the mic. Includes a safety-net timeout so
  a lost `talk-end` message can't leave the mic on indefinitely. Keeps the
  screen awake via `@capacitor-community/keep-awake`.
- **Viewer**: fetches the same config, gates access with an email check
  against the allowlist, joins subscribe-only (no local mic/camera sent),
  renders the reception feed, and has a hold-to-talk button that publishes
  the mic and signals the tablet.
- **Access control**: allowlist is a plain array of emails in the shared
  config — starts with just Garry, and adding Sonja/Richie/Shane later is a
  one-line JSON edit, no code change.

Both `reception` and `viewer` typecheck and build cleanly (`npm run
typecheck` / `npm run build` from the repo root).

## Open decisions — defaults assumed here, confirm and adjust

The spec flagged these as open; nobody's confirmed them yet, so the
following were picked as reasonable starting points. All are one-line edits
to the hosted config JSON, not rebuilds:

1. **Schedule**: defaulted to **08:00–16:00, Mon–Fri**
   (`config.default.json`). Confirm actual hours/days.
2. **Screen behavior**: defaulted to **keep screen on** during ambient mode
   (`wakeLock.ts`), on the reasoning that it's the safer choice against
   Android OEM background restrictions suspending the camera. Needs
   real-device power-draw testing to confirm it's acceptable; if not, that
   file is the only thing to change.
3. **Daily.co account**: not yet created — nothing here has been tested
   against a live room. `room.roomUrl` in the config is a placeholder.
4. **Resolution/framerate**: defaulted to ambient **320×240 @ 3fps**, talk
   **640×480 @ 15fps**, per the spec's starting numbers. Tune after testing
   on actual office WiFi.

## Before first real test

1. Create the Daily.co account + a room, get an API key.
2. Host a `config.json` (based on `config.default.json`) somewhere reachable
   over HTTPS — the existing UpTime cPanel site works fine for this static
   file — and set `VITE_CONFIG_URL` for both apps' builds to point at it.
3. `cd packages/reception && npx cap add android` to generate the native
   Android project (not generated here — needs the Android SDK/Studio), then
   build and test on the actual tablet for power draw and background
   behavior.
4. Deploy `packages/viewer/dist` as a static page Garry can open from his
   phone/desktop browser.

## Optional hardening: server-side access control

The viewer's allowlist check runs in the browser — fine to keep casual
visitors out, but not real security since anyone can inspect the JS. If
that turns out to matter, `server/mint-token.php` is a stateless PHP
endpoint (works on the same shared cPanel hosting — no persistent process
needed) that checks the allowlist server-side and mints a scoped Daily
meeting token, which Daily actually enforces. It's not wired into the
viewer app yet — copy `server/secrets.example.php` to `secrets.php` (never
commit real secrets) and wire `call.join({ url, token })` in
`packages/viewer/src/daily.ts` once you want it.

## Explicitly out of scope (per spec)

- Auto-answer "phone call" style incoming-call UI
- Motion-triggered quality ramp-up
- Always-on microphone
- Raw/self-hosted WebRTC signaling server
