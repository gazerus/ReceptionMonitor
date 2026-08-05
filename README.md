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
3. **Daily.co room**: created — `https://kwikvid.daily.co/ManningSt`, set to
   **public** for now so the app can be tested without wiring up token
   minting. Set it back to private once `server/mint-token.php` is actually
   deployed and wired in, or accept the client-side allowlist gate as
   "good enough" for an internal single-purpose tool.
4. **Resolution/framerate**: defaulted to ambient **320×240 @ 3fps**, talk
   **640×480 @ 15fps**, per the spec's starting numbers. Tune after testing
   on actual office WiFi.

## Status

- **Viewer**: deployed and reachable at
  **https://gazerus.github.io/ReceptionMonitor/** (auto-redeploys on every
  push to `packages/viewer` or `packages/shared` via
  `.github/workflows/deploy-viewer.yml`). Confirmed working — email gate,
  connects to the room.
- **Reception app**: the native Android project is committed at
  `packages/reception/android/` (generated via `npx cap add android`, with
  the two Capacitor-doesn't-do-this-for-you patches already applied — see
  below). Not yet built onto a physical tablet.

## Building the reception app onto the tablet

The native Android project is already in the repo, patched and ready —
you shouldn't need to run `cap add android` yourself unless you want to
regenerate it from scratch.

1. Clone the repo and check out this branch, then from the repo root:
   ```
   npm install
   npm run build:shared
   npm run build -w packages/reception
   ```
2. Sync the freshly built web assets into the native project:
   ```
   cd packages/reception
   npx cap sync android
   ```
3. Open `packages/reception/android` in Android Studio (`npx cap open
   android` does this for you if the CLI can find your Android Studio
   install).
4. Plug in the tablet via USB with Developer Options + USB debugging
   enabled, select it as the run target, and press Run (▶). Android Studio
   handles signing/installing a debug build automatically.
5. On first launch the app requests camera + microphone permissions —
   accept both, or the feed will just stay black with no visible error.

Two Android-specific things were needed beyond stock Capacitor output,
already applied in the committed project:
- `AndroidManifest.xml` — added `CAMERA`, `RECORD_AUDIO`, and `WAKE_LOCK`
  permissions (Capacitor's manifest only ever includes `INTERNET` by
  default).
- `MainActivity.java` — added an explicit runtime permission request for
  camera/mic on launch. Capacitor's WebView only grants a page's
  `getUserMedia()` call if the underlying Android permission is *already*
  held — unlike a plugin such as `@capacitor/camera`, nothing prompts for
  it automatically when your JS just calls `getUserMedia` directly (which
  is what `daily-js` does under the hood), so without this the camera
  would silently never come on.

**Since the schedule defaults to 08:00–16:00 Mon–Fri**, the app will just
sit on "Outside monitoring hours" outside that window — to test
immediately regardless of time of day, temporarily widen
`packages/shared/src/config.default.json`'s `schedule.start`/`end` (or
point `VITE_CONFIG_URL` at a hosted config with wider hours), rebuild step
1, and narrow it back once you've confirmed it works.

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
