/**
 * GIFTS — one-off iron-dollar payouts the house hands out, claimed by the
 * headset the way season honours are (net/leaderboard.ts): the client
 * checks it qualifies, banks the coins, and marks the gift taken on its
 * profile (`players/{uid}.gifts.<id>`) so a second headset on the same
 * account, or a cleared browser, never takes it twice.
 *
 * THE NAME GIFT (config.ts RENAME_GIFT): from the stroke of its hour, an
 * account wearing a name of its own — not the IRON-XXXX callsign every
 * headset starts with — and which chose it BEFORE the hour, is paid once.
 * A headset already in the game when the hour strikes is paid on the
 * stroke; one that boots later is paid at boot.
 */

import { RENAME_GIFT } from '../config.js';
import { addCoins } from '../menu/wallet.js';
import { cloud } from './firebase.js';
import { myName, profileReady } from './leaderboard.js';
import { walletMerged } from './walletSync.js';

/** The callsign a headset is born with (net/leaderboard.ts initLeaderboard). */
const DEFAULT_NAME = /^IRON-[0-9A-F]{4}$/i;

const takenKey = (id: string): string => `ff-gift-${id}`;

let busy = false;

function takenHere(id: string): boolean {
  try {
    return localStorage.getItem(takenKey(id)) !== null;
  } catch {
    return false;
  }
}

/** When the local name was typed (0 = before the stamp existed — an old rename). */
function localNameAt(): number {
  try {
    return parseInt(localStorage.getItem('ff-player-name-at') ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

async function profileSettled(): Promise<void> {
  while (!profileReady()) await new Promise((r) => setTimeout(r, 500));
}

async function tryRenameGift(): Promise<void> {
  const g = RENAME_GIFT;
  if (busy || Date.now() < g.at || takenHere(g.id)) return;
  busy = true;
  try {
    // The name is only real once the profile has loaded (a rename filed for
    // the account lands then), and coins granted before the wallet merge
    // could be argued away by a fresh browser adopting the cloud's copy.
    await profileSettled();
    await walletMerged();
    const name = myName();
    if (!name || DEFAULT_NAME.test(name)) return;
    const h = await cloud();
    if (!h) return; // no account to mark it taken on — try again next boot
    const ref = h.fs.doc(h.db, 'players', h.uid);
    const snap = await h.fs.getDoc(ref);
    const d = (snap.exists() ? snap.data() : {}) as Record<string, unknown>;
    const gifts = (d.gifts ?? {}) as Record<string, unknown>;
    if (gifts[g.id]) {
      localStorage.setItem(takenKey(g.id), String(gifts[g.id]));
      return;
    }
    // Named BEFORE the hour: the local stamp, or a rename filed for the
    // account (its adoption re-stamps the local clock, so read the filing).
    const renameAt = (d.renameAt as number) ?? 0;
    const namedAt = renameAt && d.renameTo === name ? Math.min(renameAt, localNameAt() || renameAt) : localNameAt();
    if (namedAt >= g.at) return;
    // Mark it taken FIRST: a failed write leaves the coins unpaid (retried
    // next boot), never paid twice.
    const now = Date.now();
    await h.fs.setDoc(ref, { name, at: now, gifts: { [g.id]: now } }, { merge: true });
    try {
      localStorage.setItem(takenKey(g.id), String(now));
    } catch {
      /* the profile's mark still guards it */
    }
    addCoins(g.coins);
    console.log(`[gifts] ${g.id}: +${g.coins} iron-dollars for ${name}`);
  } catch {
    /* cloud unreachable — the next boot (or return to the tab) tries again */
  } finally {
    busy = false;
  }
}

/** Check for gifts now, on the stroke of a pending one, and on return to the tab. */
export function initGifts(): void {
  void tryRenameGift();
  const wait = RENAME_GIFT.at - Date.now();
  // A headset in the game at the hour is paid on the stroke (a day out or
  // more, the next boot does it).
  if (wait > 0 && wait < 86_400_000) setTimeout(() => void tryRenameGift(), wait + 1000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void tryRenameGift();
  });
}
