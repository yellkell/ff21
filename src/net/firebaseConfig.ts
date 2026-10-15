/**
 * Kept as the old import path — the config itself moved to `net/firebase.ts`,
 * which now owns the connection, the anonymous sign-in and the uid as well as
 * the keys.
 *
 * WHAT CHANGED. FF2 used to talk to `arfi-b68f9`, a project inherited from the
 * ARFI/curveball era that is ALSO FIRE FIGHT 1's live hosting — which is why
 * .github/workflows/firebase-deploy.yml was parked on manual dispatch with a
 * note saying an automatic deploy from this repo would overwrite the live FF1
 * site. FF2 now has its own home, the project behind ff2.web.app, shared with
 * RAVE RAID and the social club instead of each reaching for a project of its
 * own. See net/firebase.ts for the full story.
 *
 * New code should import from './firebase.js' directly.
 */

export { FIREBASE_ENABLED, firebaseConfig } from './firebase.js';
