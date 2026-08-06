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
  publishes ambient-quality video (front/selfie camera, no mic) when inside
  the window, leaves when outside it. Mic is acquired-but-muted at join so a
  talk request can unmute instantly with no renegotiation delay. Listens for
  `talk-request`/`talk-end` app messages, upgrading video via
  `updateInputSettings` and toggling the mic. Plays the viewer's incoming
  audio out loud, and shows the viewer's video full-screen during a talk
  session, dropping straight back to the ambient view the moment it ends
  (no frozen last-frame hold) with a small self-preview thumbnail always
  visible. Has an on-screen doorbell button ("Press for assistance") for
  when nobody's watching the viewer — signals any connected viewer via the
  same Daily message channel used for talk requests; deliberately no
  server-side push infrastructure behind it, so it only reaches you if the
  viewer page happens to be open (see "Explicitly out of scope" below —
  this was a conscious trade-off to keep the app self-contained). Also has
  a small PIN-protected settings button (bottom-left, code `45656`) for
  editing the schedule's start/end times directly on the tablet — stored in
  that device's local storage (`scheduleOverride.ts`), so it survives app
  restarts without needing a rebuild or a hosted config. Keeps the screen
  awake via `@capacitor-community/keep-awake`. The same settings panel has a
  **kiosk lock** toggle that pins the app to the screen via Android's
  built-in Screen Pinning (a tiny custom Capacitor plugin — `KioskPlugin.java`
  / `src/kiosk.ts` — calling `Activity.startLockTask()`), so the app can't be
  minimized, switched away from, or closed by an accidental tap. The
  preference is remembered on-device and re-armed automatically each launch.
- **Viewer**: fetches the same config, gates access with an email check
  against the allowlist, joins subscribe-only (no local mic/camera sent
  until Talk is pressed), renders the reception feed, has a tap-to-toggle
  Talk button that publishes mic + front camera and signals the tablet
  (with its own self-preview while active), and shows a banner + beep +
  screen flash when the doorbell is pressed while connected.
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

## Explicitly out of scope (per original spec — some since revisited)

- Auto-answer "phone call" style incoming-call UI
- Always-on microphone
- Raw/self-hosted WebRTC signaling server
- Push notifications that reach you with the viewer closed — considered for
  the doorbell, deliberately dropped to avoid needing a server-side
  component to build and maintain. The doorbell only alerts a viewer that's
  already open and connected. Revisit with a third-party push service
  (OneSignal etc.) or a serverless function if this changes.
- ~~Motion-triggered quality ramp-up~~ — being revisited: see the open
  "selectable operating mode" item below. The doorbell button is a
  deliberately different, simpler thing (an explicit visitor action, not
  automatic detection) and doesn't reverse this on its own.

## Still open / not yet built

- **Doorbell button redesign**: large circular tap target across the top
  third of the tablet screen, plus a general background/layout pass —
  deliberately deferred until everything else is finalized.

## Kiosk lock: what it does and doesn't protect against

The kiosk toggle uses Android's built-in **Screen Pinning**
(`Activity.startLockTask()`), not full Device Owner mode. That's a
deliberate trade-off:

- **No ADB or factory reset needed** — it's just an in-app toggle, backed by
  a small custom Capacitor plugin (`android/app/src/main/java/au/com/set/reception/KioskPlugin.java`).
  Android shows its own one-time confirmation dialog the first time it's
  enabled.
- **It can still be exited** without the app's PIN, via Android's own
  hold-Back-and-Recent-Apps gesture (exact combo varies by Android
  version/OEM) — that's how screen pinning is designed to work everywhere,
  and isn't something an app can override. This is enough to stop an
  accidental tap or a curious kid poking at the screen, but isn't real
  security against someone who knows that gesture.
- If a device policy has screen pinning turned off, `Kiosk.start()` will
  fail — the settings panel's "Open Android security settings" button jumps
  straight to the screen where it's re-enabled.
- Full Device Owner provisioning (`adb shell dpm set-device-owner`, on a
  freshly factory-reset tablet, from a PC) would close that gesture-based
  exit entirely, at the cost of a one-time manual ADB step. Worth revisiting
  if the gesture-based exit turns out to matter in practice.
