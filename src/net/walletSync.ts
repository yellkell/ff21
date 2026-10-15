/**
 * THE CLOUD WALLET — the headset's coins and locker, mirrored to
 * `players/{uid}` so they survive a cleared browser and follow a recovered
 * account onto a new headset (net/bank.ts RECOVER).
 *
 * The headset's copy stays the one the game plays on: it is synchronous,
 * it works offline, and the pub's coin physics read it every frame. This
 * module only does two things around it:
 *
 *   AT BOOT it reads the profile, merges (net/walletMerge.ts — inventory a
 *   union, coins to the last writer, a fresh browser adopting the cloud),
 *   hydrates the local copy if the cloud had more to say, and pushes if
 *   the local copy did.
 *
 *   AFTER EVERY CHANGE the player makes (a bout banked, a pad bought, a
 *   coin dropped in the pub) it pushes the whole wallet, debounced, so a
 *   burst of pub coin-flicking is one write.
 *
 * It rides the profile document the leaderboard already owns, with
 * `merge: true`, so it never touches a field that isn't its own — and the
 * rules (firestore.rules) cap the lists and the numbers the way they cap
 * everything else there. No cloud, no problem: the wallet plays local.
 */

import { adoptOwned, onOwnedChange, ownedIds } from '../menu/customization.js';
import { coins, hydrateWallet, onWalletChange, walletIsFresh } from '../menu/wallet.js';
import { cloud } from './firebase.js';
import { myName } from './leaderboard.js';
import { mergeWallet, type WalletShape } from './walletMerge.js';

/** Set by a RECOVERY (net/bank.ts) just before the page restarts as the
 *  recovered account: this boot's merge adds what the stranger earned to
 *  the account's own balance instead of arguing over clocks. */
const ADOPT_KEY = 'ff-wallet-adopt';

const PUSH_DEBOUNCE_MS = 1500;

export const walletSync = {
  status: 'idle' as 'idle' | 'syncing' | 'synced' | 'off',
};

let pushTimer: ReturnType<typeof setTimeout> | null = null;
let merged = false;
let settle: () => void = () => {};
/** Resolves once the boot merge has decided the balance (or there is no
 *  cloud) — a coin grant made before then could be argued away by a fresh
 *  browser adopting the cloud's copy (net/gifts.ts waits on it). */
const mergedOnce = new Promise<void>((resolve) => (settle = resolve));

export function walletMerged(): Promise<void> {
  return mergedOnce;
}

function localShape(): WalletShape {
  const o = ownedIds();
  return { coins: coins.balance, at: coins.at, platforms: o.platforms, gear: o.gear, avatars: o.avatars };
}

function cloudShape(d: Record<string, unknown>): WalletShape | null {
  if (typeof d.coins !== 'number' && !Array.isArray(d.ownedPlatforms)) return null;
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 64) : []);
  return {
    coins: typeof d.coins === 'number' ? d.coins : 0,
    at: typeof d.walletAt === 'number' ? d.walletAt : 0,
    platforms: ids(d.ownedPlatforms),
    gear: ids(d.ownedGear),
    avatars: ids(d.ownedAvatars),
  };
}

async function push(): Promise<void> {
  pushTimer = null;
  const h = await cloud();
  if (!h) return;
  const w = localShape();
  try {
    await h.fs.setDoc(
      h.fs.doc(h.db, 'players', h.uid),
      {
        name: myName(),
        at: Date.now(),
        coins: w.coins,
        walletAt: w.at,
        ownedPlatforms: w.platforms,
        ownedGear: w.gear,
        ownedAvatars: w.avatars,
      },
      { merge: true },
    );
    walletSync.status = 'synced';
  } catch {
    walletSync.status = 'off'; // the next change tries again
  }
}

function schedulePush(): void {
  if (!merged) return; // the boot merge decides what the first push says
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => void push(), PUSH_DEBOUNCE_MS);
}

/** Start the mirror: merge with the cloud once it opens, then follow changes. */
export function initWalletSync(): void {
  onWalletChange(schedulePush);
  onOwnedChange(schedulePush);
  void (async () => {
    walletSync.status = 'syncing';
    const h = await cloud();
    if (!h) {
      walletSync.status = 'off';
      merged = true;
      settle();
      return;
    }
    let adopting = false;
    try {
      adopting = localStorage.getItem(ADOPT_KEY) === '1';
      if (adopting) localStorage.removeItem(ADOPT_KEY);
    } catch {
      /* no storage — nothing to adopt */
    }
    let remote: WalletShape | null = null;
    try {
      const snap = await h.fs.getDoc(h.fs.doc(h.db, 'players', h.uid));
      if (snap.exists()) remote = cloudShape(snap.data() as Record<string, unknown>);
    } catch {
      walletSync.status = 'off';
      merged = true;
      settle();
      return;
    }
    const m = mergeWallet(localShape(), remote, walletIsFresh(), adopting);
    merged = true;
    if (m.hydrate) {
      adoptOwned({ platforms: m.platforms, gear: m.gear, avatars: m.avatars });
      hydrateWallet(m.coins, m.at);
    }
    settle();
    if (m.push) void push();
    else walletSync.status = 'synced';
  })();
}

/** Flag the next boot as a recovery (net/bank.ts, just before the restart). */
export function markWalletAdopt(): void {
  try {
    localStorage.setItem(ADOPT_KEY, '1');
  } catch {
    /* the merge then treats the balance by clock — still safe */
  }
}
