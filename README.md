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
  mint-token.php       Optional server-side access control upgrade (see below)
  subscribe.php        Stores a viewer's Web Push subscription for the doorbell
  notify-doorbell.php  Sends the Web Push notification when the doorbell is pressed
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
  publishes ambient-quality video (front/selfie camera, no mic) when inside
  the window, leaves when outside it. Mic is acquired-but-muted at join so a
  talk request can unmute instantly with no renegotiation delay. Listens for
  `talk-request`/`talk-end` app messages, upgrading video via
  `updateInputSettings` and toggling the mic. Plays the viewer's incoming
  audio out loud, and shows the viewer's video full-screen during a talk
  session (holding 30s after it ends) with a small self-preview thumbnail
  always visible. Has an on-screen doorbell button for when nobody's
  watching the viewer. Keeps the screen awake via
  `@capacitor-community/keep-awake`.
- **Viewer**: fetches the same config, gates access with an email check
  against the allowlist, joins subscribe-only (no local mic/camera sent
  until Talk is pressed), renders the reception feed, and has a hold-to-talk
  button that publishes mic + front camera and signals the tablet. Can
  subscribe to Web Push notifications so the doorbell reaches your phone
  even with the tab closed.
- **Access control**: allowlist is a plain array of emails in the shared
  config — starts with just Garry, and adding Sonja/Richie/Shane later is a
  one-line JSON edit, no code change.

Both `reception` and `viewer` typecheck and build cleanly (`npm run
typecheck` / `npm run build` from the repo root).

**Keep `@daily-co/daily-js` current.** Daily enforces minimum client
versions server-side — an EOL SDK version silently blocks camera/mic access
with no error anywhere, which cost a long debugging session here (see git
history). If a live room mysteriously stops working, check Logcat/console
for a "no longer supported" message before assuming anything else broke.

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

**Fastest path**: with the tablet plugged in via USB (Developer Options +
USB debugging on), run `scripts/rebuild-reception.ps1` from the repo root.
It pulls, rebuilds, and deploys straight to the device via `cap run
android` — no Android Studio UI required. Falls back cleanly to the
manual steps below if that command can't find/build for a device.

Manual steps, or if the script doesn't work on your machine:

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

One Android-specific thing was needed beyond stock Capacitor output,
already applied in the committed project: `AndroidManifest.xml` adds
`CAMERA`, `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS`, and `WAKE_LOCK`
permissions (Capacitor's manifest only ever includes `INTERNET` by
default). Capacitor's `BridgeWebChromeClient` already handles requesting
these at runtime and granting them to the WebView when the page calls
`getUserMedia()` — no custom `MainActivity` code needed. Daily requests
camera+mic together in one grant, and `MODIFY_AUDIO_SETTINGS` being
missing silently denies the *whole* request, camera included, even though
Camera/Mic show "Allowed" in Settings (it's not a user-toggleable
permission, so there's nothing to see there) — worth knowing if this ever
needs debugging again.

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

## Doorbell: setup

The reception app's "Press for assistance" button needs three things set
up on the actual hosting before it does anything (right now `config.json`'s
`push.*` fields are all placeholders):

1. Generate a VAPID key pair (one-time, needs Node which you already have):
   ```
   npx web-push generate-vapid-keys
   ```
   Put the public key in the hosted `config.json`'s `push.vapidPublicKey`,
   and both keys in `server/secrets.php` (`VAPID_PUBLIC_KEY` /
   `VAPID_PRIVATE_KEY` — copy from `secrets.example.php` if you haven't
   already for the token-minting stub).
2. Pick a random string for `push.notifySecret` in `config.json`, and put
   the *same* string in `secrets.php` as `DOORBELL_SHARED_SECRET` — this
   stops the notify endpoint being a fully open URL anyone could hit.
3. Upload `server/subscribe.php` and `server/notify-doorbell.php` to the
   hosting alongside `mint-token.php`, then run `composer install` in that
   directory (needs the `minishlink/web-push` package declared in
   `server/composer.json`) so `vendor/autoload.php` exists.
4. Point `config.json`'s `push.subscribeUrl` / `push.notifyUrl` at those
   two uploaded files' real URLs.

Once that's done: open the viewer, click "Enable doorbell notifications"
once (grants the browser permission + registers the subscription), then
pressing the tablet's doorbell button should trigger a push notification
even with the viewer tab closed. `server/push-subscriptions.json` is where
subscriptions get stored — it's created automatically on first subscribe,
gitignored, never needs to be touched by hand.

## Explicitly out of scope (per original spec — some since revisited)

- Auto-answer "phone call" style incoming-call UI
- Always-on microphone
- Raw/self-hosted WebRTC signaling server
- ~~Motion-triggered quality ramp-up~~ — being revisited: see the open
  "selectable operating mode" item below. The doorbell button is a
  deliberately different, simpler thing (an explicit visitor action, not
  automatic detection) and doesn't reverse this on its own.

## Still open / not yet built

- **Selectable operating mode** (constant / motion-wake / doorbell-only):
  needs design decisions first — wake-hold duration, motion sensitivity,
  whether motion detection runs locally before ever joining Daily (to avoid
  burning room-minutes while idle).
- **Remote camera-switch control** on the viewer (flip the tablet's
  front/back camera remotely).
- **Kiosk-lock** so the reception app can't be minimized without a PIN —
  needs the app set as Android Device Owner (one-time ADB provisioning,
  ideally on a freshly factory-reset tablet).
