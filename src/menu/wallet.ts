/**
 * The player's coin wallet — the iron-dollar currency (the riveted "$").
 *
 * It's a single non-negative integer kept in localStorage under 'ff-coins',
 * stamped with the clock of its last change ('ff-coins-at'). Both entry
 * points share it: the arena (index.html) and the pub (pub.html) are
 * same-origin, so they read and write the very same wallet. Each page loads
 * the balance fresh on boot (navigating between them is a full reload), so
 * there's no live cross-tab sync to worry about.
 *
 * THE CLOUD COPY (net/walletSync.ts): every change here is also pushed to
 * the player's profile document, and at boot the two are merged — so a
 * fresh headset, or a browser that lost its storage, gets the wallet back
 * from the profile. This module stays free of Firebase on purpose (the pub
 * and the rave import it too): it only announces changes through
 * `onWalletChange`, and takes a merged balance back through `hydrateWallet`.
 *
 * Coins are EARNED at the same moments as XP (net/leaderboard.ts calls
 * addCoins), BOUGHT through THE BANK (net/bank.ts claims land here), SPENT
 * in the store (menu), and traded by hand in the pub (pull one off your
 * wrist to drop it; catch one onto your wrist to bank it).
 *
 * UI panels read `coins.balance` and can watch `coins.version`, which bumps on
 * every change, to know when to redraw.
 */

const KEY = 'ff-coins';
const AT_KEY = 'ff-coins-at';

function load(): number {
  try {
    const n = parseInt(localStorage.getItem(KEY) ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function loadAt(): number {
  try {
    const n = parseInt(localStorage.getItem(AT_KEY) ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Has this browser ever held a wallet? A fresh one adopts the cloud's. */
export function walletIsFresh(): boolean {
  try {
    return localStorage.getItem(KEY) === null;
  } catch {
    return false;
  }
}

export const coins = {
  balance: load(),
  /** When the balance last changed (a client clock — for the merge, not for trust). */
  at: loadAt(),
  /** Bumped on every change so canvas panels can cheaply notice and redraw. */
  version: 1,
};

type Listener = () => void;
const listeners: Listener[] = [];

/** Be told after every change the player makes (net/walletSync.ts pushes
 *  it to the cloud). Not called for a hydrate — that came FROM the cloud. */
export function onWalletChange(cb: Listener): void {
  listeners.push(cb);
}

function persist(announce = true): void {
  try {
    localStorage.setItem(KEY, String(coins.balance));
    localStorage.setItem(AT_KEY, String(coins.at));
  } catch {
    /* storage unavailable — the balance stays for this session at least */
  }
  coins.version += 1;
  if (announce) for (const cb of listeners) cb();
}

/** Award coins (earned alongside XP, or banked from a caught pub coin). */
export function addCoins(amount: number): void {
  const n = Math.floor(amount);
  if (n <= 0) return;
  coins.balance += n;
  coins.at = Date.now();
  persist();
}

/**
 * Try to spend `amount`. Returns true and debits the wallet if you can afford
 * it; returns false and changes nothing if you can't (the caller can play a
 * deny sound). Spending one coin to a pub-floor drop goes through here too.
 */
export function spendCoins(amount: number): boolean {
  const n = Math.floor(amount);
  if (n <= 0) return true;
  if (coins.balance < n) return false;
  coins.balance -= n;
  coins.at = Date.now();
  persist();
  return true;
}

/** Whether the wallet can cover `amount` right now. */
export function canAfford(amount: number): boolean {
  return coins.balance >= Math.floor(amount);
}

/** Take a merged balance from the cloud (net/walletSync.ts). Persists it
 *  locally and repaints, but does not announce — nothing to push back. */
export function hydrateWallet(balance: number, at: number): void {
  const n = Math.max(0, Math.floor(balance));
  if (n === coins.balance && at === coins.at) return;
  coins.balance = n;
  coins.at = at;
  persist(false);
}
