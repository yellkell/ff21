# Packaging FIRE FIGHT as a Meta Quest PWA

The game ships to the Horizon Store as a **PWA wrapper APK**: a thin
store-installable shell that loads the hosted site, so gameplay updates keep
shipping by deploying to Firebase — no store resubmission per patch.

The web side is already in the repo: `public/manifest.webmanifest` + the
`public/icons/` set, linked from `index.html` and `pub.html`.

> **Tooling note:** Meta's old `ovr-platform-util create-pwa` flow is retired.
> The current official path is **Bubblewrap** (Google's PWA→APK packer) with
> Meta Quest support — Meta maintains a fork (github.com/meta-quest/bubblewrap)
> and upstream `@bubblewrap/cli` carries the `--metaquest` flag. It runs via
> `npx`, no separate download hunt.

## 1 · Deploy first (the packager reads the LIVE manifest)

```sh
npm run build && npx firebase deploy --only hosting
# check it in a browser:
#   https://arfi-b68f9.web.app/manifest.webmanifest
```

## 2 · Build the APK (on a machine with Node)

```sh
mkdir firefight-quest && cd firefight-quest
npx @bubblewrap/cli init \
  --manifest https://arfi-b68f9.web.app/manifest.webmanifest \
  --metaquest
npx @bubblewrap/cli build
```

Notes:
- First run offers to download its own JDK + Android SDK — say YES to both
  (no Android Studio needed).
- `init` asks a series of questions; the defaults come from our manifest.
  Application ID: use `com.yellkell.firefight` and never change it — it's the
  app's identity in the store.
- `build` creates a signing keystore and asks for two passwords — SAVE THEM
  (they sign every future update). Output: `app-release-signed.apk`.

## 2½ · MICROPHONE — the wrapper must declare it, or voice chat is dead

An Android app that never declared `RECORD_AUDIO` auto-denies `getUserMedia`
with **no prompt ever shown** — the site's promise just rejects, and everyone
in the store app falls silently onto the `recvonly` path: they hear browser
players, but nobody ever hears them.

> **The REAL pipeline lives in `Desktop/firefightpwakit/` — read its
> REBUILD.md, not this section's generic steps.** The store build comes from
> Meta's fork (`@meta-quest/bubblewrap-cli`, project in `meta-build/`); stock
> Bubblewrap output is hard-rejected by Meta's upload validation. In the
> fork, the mic switch is `"enableMicrophone": true` in `twa-manifest.json` —
> it generates the RECORD_AUDIO permission AND Meta's permission-delegation
> activity. No hand-editing of the manifest needed (except re-setting
> `allowBackup="false"` after every `update`, which REBUILD.md covers).

**History — why the store shipped WITHOUT the mic:** v5 ("nomic", 1.0.3)
deliberately stripped the mic machinery because it correlated with the
Meta Browser launch crash (MediaSessionImpl NPE — see
firefightpwakit/meta-support-escalation.md, 2026-07-29: 13/14 crashes with
mic delegation vs a mic-less sibling app at 4/4 clean). Since then the web
side eliminated every audible media element (music rides WebAudio,
src/audio/musicTrack.ts), which removes the media-session state changes
that NPE fired on. v6 (1.0.4, 2026-08-04) restores the mic on that basis —
**soak-test a sideloaded v6 across MANY launches (the crash historically
appeared only after an install accumulated browser-side origin state, not
on a fresh install) before promoting it on the store.**

## 3 · Trust the wrapper (assetlinks)

So the shell opens the site full-screen as YOUR app (no browser chrome), the
site must vouch for the APK's signing key:

```sh
npx @bubblewrap/cli fingerprint generateAssetLinks
```

Put the JSON it prints at `public/.well-known/assetlinks.json` in this repo,
rebuild, redeploy.

## 4 · Test on the headset

Meta Quest Developer Hub → Device manager (headset on USB, developer mode on)
→ drag `app-release-signed.apk` onto the device. It appears under
Library → Unknown Sources as FIRE FIGHT with the flame icon.

## 5 · Submit

MQDH → App distribution (or the web Developer Dashboard) → Create a new app →
Meta Horizon Store, Quest. Upload the APK to the **Alpha** channel first
(invite testers by email), then work through: store listing assets, IARC age
rating, privacy policy URL + Data Use Checkup (leaderboards, callsigns and
voice chat must be declared), and the social-app safety requirements
(block/report — the pub currently has mute + admin ban; user-facing report is
on the todo list).
