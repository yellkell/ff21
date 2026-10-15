/**
 * THE CLOUD — one Firebase connection, shared by everything.
 *
 * FIRE FIGHT 2, RAVE RAID and the social club all used to reach for their own
 * Firebase project: FF2 talked to `arfi-b68f9` (which is also FIRE FIGHT 1's
 * live hosting, so FF2 could never deploy from CI without stamping on it),
 * RAVE RAID kept its world board in `raveraid-bc866`, and the pub's arcade
 * board was a single document wedged into FF2's project. Three identities for
 * one player, three sets of rules, and a board in one game that could not see
 * a name from another.
 *
 * This is the one connection now. It opens LAZILY — no Firebase code loads
 * until something actually asks for the cloud, so a player who boots straight
 * into a bot fight never pays for the bundle — and it FAILS SOFT: a headset
 * on a dead network, a captive portal, or a project with auth switched off
 * all resolve to `null`, and every caller is written to carry on without a
 * cloud rather than hang or throw.
 *
 * IDENTITY is anonymous auth. There is no sign-in screen and there never will
 * be one; `signInAnonymously()` mints a uid on first contact and the Firebase
 * SDK keeps it in IndexedDB, so a headset stays the same player across
 * sessions. That uid is the whole basis of the security rules — a document
 * named after you is one only you can write (see firestore.rules) — which is
 * what let the old `allow read, write: if true` go away.
 *
 * WHAT DOES NOT COME THROUGH HERE: poses at 10 Hz and voice. Those ride the
 * Render relay and peer-to-peer WebRTC, because Firestore bills per document
 * read and adds a couple of hundred milliseconds. Firestore is the spine —
 * who you are, what you have done, who is around, and the handshake that
 * introduces two headsets. It is not the wire.
 */

import type { FirebaseApp } from 'firebase/app';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';

/**
 * Set false to cut the cloud off entirely — boards go local-only, matchmaking
 * falls back to the WebSocket relay, and nothing here ever loads. Useful when
 * testing offline behaviour without unplugging anything.
 */
export const FIREBASE_ENABLED = true;

/**
 * The FIRE FIGHT 2 web app, in the project that owns ff2.web.app.
 *
 * (The project id reads `flappy-ff9f6` for historical reasons — it is where
 * the `ff2` hosting site was reserved, and a .web.app name is globally unique,
 * so prising it loose to rename the project would mean releasing `ff2` into
 * the pool where anyone could take it. The id is invisible to players;
 * ff2.web.app is the face. Treat this as THE FF2 PROJECT.)
 *
 * An API key here is a public identifier, not a secret. It names the project;
 * it does not grant anything. The security boundary is firestore.rules.
 */
export const firebaseConfig = {
  apiKey: 'AIzaSyD7jbazGQc4wiPBUzQSMwO6W7nMcMtaJzQ',
  authDomain: 'flappy-ff9f6.firebaseapp.com',
  projectId: 'flappy-ff9f6',
  storageBucket: 'flappy-ff9f6.firebasestorage.app',
  messagingSenderId: '777089145974',
  appId: '1:777089145974:web:560584da7691e495ab1357',
  measurementId: 'G-W1WGNJDTX6',
};

/** Nothing may hang for ever. A blocked network (a captive portal, a proxy
 *  that swallows the connection) does not fail — it simply never answers, and
 *  an unbounded await leaves a board reading "loading…" for the rest of the
 *  session. Every round trip gets a deadline. */
const TIMEOUT_MS = 8_000;

export type FirestoreMod = typeof import('firebase/firestore');

export interface Cloud {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
  /** The Firestore module itself — callers need `doc`, `query`, `where` and
   *  friends, and re-importing it in every module would defeat the lazy load
   *  this whole file exists to arrange. */
  fs: FirestoreMod;
  /** This headset's anonymous uid. Stable across sessions. */
  uid: string;
}

/**
 * Observable connection state, for anything that wants to show it. Bump
 * `dirty` is the same trick the menus use elsewhere: a counter that changes
 * when something changed, so a repaint can be cheap and unconditional.
 */
export const cloudState = {
  status: 'idle' as 'idle' | 'opening' | 'ready' | 'off',
  /** Why the cloud is off, when it is. Shown in the leaderboard's status line. */
  reason: '',
  uid: '',
  dirty: 0,
};

let live: Cloud | null = null;
let opening: Promise<Cloud | null> | null = null;
/** The current Firebase ID token — see where it is set for why this is kept
 *  reachable without an await. Empty until the cloud opens. */
let idToken = '';
/** Set when the project has no database, or auth is off, or the key is wrong.
 *  A failure of that kind is PERMANENT for the session — retrying every minute
 *  on a headset that will never reach it is just noise. A plain network blip
 *  does not land here; that failure is left retryable. */
let dead = '';

function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), TIMEOUT_MS)),
  ]);
}

/**
 * Is this an automated browser rather than a person in a headset?
 *
 * The check tools (tools/*.mjs) boot the REAL app against the REAL project,
 * because that is the point of them — they are meant to exercise the thing
 * that ships. What was not intended is that they also WRITE to it: every run
 * filed a presence record and a player profile into the live database, and
 * twenty stale presence documents turned up in the console before anyone had
 * played a single session.
 *
 * `navigator.webdriver` is set by Playwright, Selenium and every other
 * automation harness, and by nothing else — a Quest browser never sets it. So
 * a probe gets no cloud, plays local-only, and leaves the database alone.
 *
 * `?cloud=1` opts back in, for the day something genuinely needs to test the
 * cloud path headlessly (against the emulator, ideally).
 */
function isProbe(): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.webdriver) return false;
    return new URLSearchParams(location.search).get('cloud') !== '1';
  } catch {
    return false;
  }
}

/** Failures worth giving up on for good, rather than retrying all session. */
function isPermanent(code: string): boolean {
  return (
    code.includes('configuration-not-found') || // anonymous sign-in isn't enabled
    code.includes('operation-not-allowed') || //   …same thing, older SDKs
    code.includes('api-key-not-valid') ||
    code.includes('admin-restricted-operation')
  );
}

/**
 * Open the cloud, or hand back what is already open. Safe to call from
 * anywhere, as often as you like — the work happens once and everyone after
 * that awaits the same promise.
 *
 * Resolves to `null` when there is no cloud to be had. That is a normal
 * outcome, not an error: play carries on local-only.
 */
export function cloud(): Promise<Cloud | null> {
  if (!FIREBASE_ENABLED) return Promise.resolve(null);
  if (isProbe()) return Promise.resolve(null);
  if (live) return Promise.resolve(live);
  if (dead) return Promise.resolve(null);
  if (opening) return opening;

  cloudState.status = 'opening';
  cloudState.dirty++;

  opening = (async () => {
    try {
      const [appMod, authMod, fs] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
      ]);

      // Something else may have initialised the app already (or will, right
      // after us) — share the instance rather than double-initialising, which
      // Firebase treats as an error when the configs differ.
      const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(firebaseConfig);
      const auth = authMod.getAuth(app);

      // The SDK restores a previous anonymous session from IndexedDB, so this
      // usually returns the SAME uid the headset had last time rather than
      // minting a new player on every boot.
      const cred = auth.currentUser ?? (await withTimeout(authMod.signInAnonymously(auth), 'sign-in')).user;

      live = { app, auth, db: fs.getFirestore(app), fs, uid: cred.uid };

      // Cache the ID TOKEN, and keep it current. Almost everything goes through
      // the SDK, which handles tokens itself — but the mesh's page-hide
      // tombstone cannot: it is a `keepalive` fetch straight at the Firestore
      // REST API, fired while the page is being torn down, precisely because
      // the SDK's own write does not survive that moment. An unauthenticated
      // REST write is a DENIED write now, so that one call needs a token it
      // can reach synchronously.
      authMod.onIdTokenChanged(auth, (user) => {
        void user?.getIdToken().then((t) => {
          idToken = t;
        });
      });
      idToken = await cred.getIdToken().catch(() => '');

      cloudState.status = 'ready';
      cloudState.uid = cred.uid;
      cloudState.reason = '';
      cloudState.dirty++;
      return live;
    } catch (err) {
      const code = String((err as { code?: string })?.code ?? err ?? 'unavailable');
      if (isPermanent(code)) dead = code;
      cloudState.status = 'off';
      cloudState.reason = code;
      cloudState.dirty++;
      return null;
    } finally {
      opening = null;
    }
  })();

  return opening;
}

/**
 * This headset's uid, or '' before the cloud has opened. Synchronous, for the
 * many places that want to ask "is this row mine?" while painting a frame and
 * cannot await anything.
 */
export function cloudUid(): string {
  return cloudState.uid;
}

/**
 * The current Firebase ID token, or '' if there isn't one. Synchronous by
 * necessity: its one caller is a page-teardown `keepalive` fetch that has no
 * moment left in which to await anything. Use the SDK everywhere else — it
 * refreshes and retries on its own.
 */
export function currentIdToken(): string {
  return idToken;
}

/** True once the cloud is open and usable. */
export function cloudReady(): boolean {
  return cloudState.status === 'ready';
}

/**
 * A human-readable line for the leaderboard's status area. The raw Firebase
 * error codes mean nothing to a player in a headset.
 */
export function cloudNote(): string {
  switch (cloudState.status) {
    case 'ready':
      return '';
    case 'opening':
      return 'connecting…';
    case 'off':
      return isPermanent(cloudState.reason) ? 'boards unavailable' : 'offline — local play only';
    default:
      return '';
  }
}
