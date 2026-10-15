/**
 * THE MERGE — how a headset's wallet and the cloud's copy become one. Pure,
 * so tools/bank-check.mjs can run it in a page without a world.
 *
 * The rules:
 *   - INVENTORY is a union. Owning is a one-way door, so nothing bought
 *     on either side is ever lost.
 *   - COINS go to whichever side changed LAST. Every change stamps a
 *     clock into both copies together, so on one headset they agree and
 *     nothing moves; a headset whose cloud write failed (offline) carries
 *     the newer stamp and wins, then pushes; a second headset that played
 *     later wins on the first, which is what "last writer" is for.
 *   - A FRESH browser (never held a wallet) adopts the cloud outright.
 *   - An ADOPTING headset — one that has just RECOVERED an account — takes
 *     the cloud's balance and ADDS whatever it had earned as a stranger,
 *     because those coins were earned, and takes the union of the rest.
 */

export interface WalletShape {
  coins: number;
  /** A client clock: when the coins last changed. 0 = never. */
  at: number;
  platforms: string[];
  gear: string[];
  avatars: string[];
}

export interface Merged extends WalletShape {
  /** The local copy must be updated to this. */
  hydrate: boolean;
  /** The cloud copy must be updated to this. */
  push: boolean;
}

const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])].sort();
const sameList = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export function mergeWallet(local: WalletShape, cloud: WalletShape | null, fresh: boolean, adopting = false): Merged {
  const platforms = union(local.platforms, cloud?.platforms ?? []);
  const gear = union(local.gear, cloud?.gear ?? []);
  const avatars = union(local.avatars, cloud?.avatars ?? []);
  let coins = local.coins;
  let at = local.at;
  if (cloud) {
    if (adopting) {
      coins = Math.max(0, Math.floor(cloud.coins)) + Math.max(0, Math.floor(local.coins));
      at = Date.now();
    } else if (fresh || cloud.at > local.at) {
      coins = Math.max(0, Math.floor(cloud.coins));
      at = cloud.at;
    }
  }
  const hydrate =
    coins !== local.coins ||
    at !== local.at ||
    !sameList(platforms, [...local.platforms].sort()) ||
    !sameList(gear, [...local.gear].sort()) ||
    !sameList(avatars, [...local.avatars].sort());
  const push =
    !cloud ||
    adopting ||
    coins !== cloud.coins ||
    at !== cloud.at ||
    !sameList(platforms, [...cloud.platforms].sort()) ||
    !sameList(gear, [...cloud.gear].sort()) ||
    !sameList(avatars, [...cloud.avatars].sort());
  return { coins, at, platforms, gear, avatars, hydrate, push };
}
