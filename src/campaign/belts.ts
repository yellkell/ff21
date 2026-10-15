/**
 * THE BELTS — championship belts for the campaign, ported from FIRE FIGHT
 * FLUX's title belts (fff game/career.ts) and grown into a full set. They
 * come three ways:
 *
 *  THE TITLE BELTS — one for each boss, the first time you defeat it (fff's
 *  title run: amateur, national, intercontinental, world):
 *
 *   rank  belt         won by                          plate     strap / metal
 *   1     SCRAPYARD    defeating CHROMEHOOK            octagon   denim / steel
 *   2     FOUNDRY      defeating PISTONKAISER          octagon   brown / brass
 *   3     TALON        defeating VULTURE               octagon   green / silver
 *   4     BULWARK      defeating JUGGERNAUT            crest     purple / silver
 *   5     CROWN        defeating GOLIATH, the king     crest     red / gold
 *   6     TIDE         defeating GOOPLIATH             sun       green / pearl
 *
 *  THE RUN BELTS — one per run per difficulty, Normal and up (Easy earns
 *  nothing, same as the boards):
 *
 *   7     IRONCLAD     the GAUNTLET on Normal          octagon   black / bronze
 *   8     BLOODIRON    HARDCORE on Normal              octagon   oxblood / gunmetal
 *   9     TITANSTEEL   the GAUNTLET on Hard            crest     navy / steel
 *   10    WARBRAND     HARDCORE on Hard                crest     crimson / black chrome
 *   11    SUNFORGED    the GAUNTLET on Blazing         sun       ivory / gold
 *   12    INFERNO      HARDCORE on Blazing             sun       black / red gold
 *
 * A Hardcore belt burns: flames behind its centre plate. The art is in
 * ui/beltArt.ts (the painting) and ui/beltModel.ts (the 3D one, held up over
 * the wreck when you win it — campaign/beltCeremony.ts).
 *
 * WHICH YOU HOLD: run belts are kept in the campaign save
 * (`campaignProgress.belts`); title belts are read off the save's own
 * defeat flags, so a boss beaten before belts existed still hands its belt
 * over. THE PROFILE shows your BEST belt (highest rank) and syncs its rank
 * as `beltBest`, so other players see it on your card.
 */

import type { Difficulty } from '../config.js';
import { campaignProgress, saveCampaignProgress } from './campaignState.js';

export type BeltMode = 'gauntlet' | 'hardcore';
export type BeltTier = 'normal' | 'hard' | 'blazing';
export type PlateShape = 'octagon' | 'crest' | 'sun';
export type BeltKind = 'titan' | 'goop' | 'run';

export interface Belt {
  id: string;
  kind: BeltKind;
  /** Run belts: which run and tier. */
  mode?: BeltMode;
  tier?: BeltTier;
  /** Title belts: whose (BOSSES index; 5 = GOOPLIATH). */
  boss?: number;
  /** 1 (SCRAPYARD) … 12 (INFERNO): the profile shows the highest you hold. */
  rank: number;
  /** "IRONCLAD" — said as "THE IRONCLAD BELT". */
  name: string;
  /** What winning it makes you, on the award card. */
  title: string;
  /** How it was won (the tooltip) … */
  feat: string;
  /** … and how to win it (the rack's tooltip on one you don't hold yet). */
  goal: string;
  /** The word on the centre plate's ribbon, and the plaque under it. */
  ribbon: string;
  plaque: string;
  /** The emblem in the centre plate (icons.ts index), and on the four side
   *  plates, left to right. */
  emblem: number;
  sides: [number, number, number, number];
  plate: PlateShape;
  /** Leather: the strap's face, its shadowed edge, the tooling, the thread. */
  strap: { face: string; edge: string; tool: string; thread: string };
  /** Metal ramp, highlight → mid → shadow. */
  metal: { hi: string; mid: string; lo: string };
  /** The enamel field inside the plates. */
  enamel: { face: string; deep: string };
  /** The centre stone and the glow round it. */
  gem: { core: string; glow: string };
  /** Hardcore belts burn: flames licking out behind the centre plate. */
  flames: boolean;
}

const LINEUP: [number, number, number, number] = [0, 1, 2, 3];
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** A boss's title belt: its emblem on every plate, its numeral on the plaque. */
function titleBelt(
  boss: number,
  who: string,
  name: string,
  look: Pick<Belt, 'plate' | 'strap' | 'metal' | 'enamel' | 'gem'>,
): Belt {
  const goop = boss === 5;
  return {
    id: goop ? 'goopliath' : `titan-${boss}`,
    kind: goop ? 'goop' : 'titan',
    boss,
    rank: boss + 1,
    name,
    title: `${name} CHAMPION`,
    feat: `DEFEATED ${who}`,
    goal: `DEFEAT ${who} TO WIN IT`,
    ribbon: who,
    plaque: goop ? '★ VI ★' : `★ ${ROMAN[boss]} ★`,
    emblem: boss,
    sides: [boss, boss, boss, boss],
    flames: false,
    ...look,
  };
}

/** A run's belt: the line-up on its side plates, the king in the middle. */
function runBelt(
  mode: BeltMode,
  tier: BeltTier,
  rank: number,
  name: string,
  look: Pick<Belt, 'plate' | 'strap' | 'metal' | 'enamel' | 'gem'>,
): Belt {
  const word = tier.toUpperCase();
  const hc = mode === 'hardcore';
  return {
    id: `${mode}-${tier}`,
    kind: 'run',
    mode,
    tier,
    rank,
    name,
    title: hc ? 'HARDCORE CHAMPION' : 'GAUNTLET CHAMPION',
    feat: hc ? `SURVIVED HARDCORE ON ${word}` : `RAN THE GAUNTLET ON ${word}`,
    goal: hc ? `SURVIVE HARDCORE ON ${word} TO WIN IT` : `RUN THE GAUNTLET ON ${word} TO WIN IT`,
    ribbon: hc ? 'HARDCORE' : 'GAUNTLET',
    plaque: `★ ${word} ★`,
    emblem: 4,
    sides: LINEUP,
    flames: hc,
    ...look,
  };
}

export const BELTS: readonly Belt[] = [
  titleBelt(0, 'CHROMEHOOK', 'SCRAPYARD', {
    plate: 'octagon',
    strap: { face: '#1f3550', edge: '#0a1422', tool: '#3e5f86', thread: '#e8eef5' },
    metal: { hi: '#ffffff', mid: '#a9b4c2', lo: '#3c4552' },
    enamel: { face: '#0f2c4a', deep: '#04101e' },
    gem: { core: '#4fb7ff', glow: '#a8dcff' },
  }),
  titleBelt(1, 'PISTONKAISER', 'FOUNDRY', {
    plate: 'octagon',
    strap: { face: '#4a2a14', edge: '#1e0f06', tool: '#7a4a26', thread: '#ffcf6a' },
    metal: { hi: '#fff0b8', mid: '#d8a83a', lo: '#6a4410' },
    enamel: { face: '#2a1a0c', deep: '#0c0603' },
    gem: { core: '#ffb000', glow: '#ffd76a' },
  }),
  titleBelt(2, 'VULTURE', 'TALON', {
    plate: 'octagon',
    strap: { face: '#16301a', edge: '#06120a', tool: '#2f5a34', thread: '#c9ffb0' },
    metal: { hi: '#f4fff0', mid: '#a8b8aa', lo: '#3a463c' },
    enamel: { face: '#0e2a12', deep: '#030c05' },
    gem: { core: '#7cff4a', glow: '#c4ff9a' },
  }),
  titleBelt(3, 'JUGGERNAUT', 'BULWARK', {
    plate: 'crest',
    strap: { face: '#2c1846', edge: '#10071c', tool: '#4e2f78', thread: '#e2c8ff' },
    metal: { hi: '#ffffff', mid: '#b9b4c8', lo: '#46405a' },
    enamel: { face: '#25104a', deep: '#0a0418' },
    gem: { core: '#b26bff', glow: '#dcb8ff' },
  }),
  titleBelt(4, 'GOLIATH', 'CROWN', {
    plate: 'crest',
    strap: { face: '#5c0c10', edge: '#220305', tool: '#8a2228', thread: '#ffd76a' },
    metal: { hi: '#fff3c0', mid: '#e8b438', lo: '#6e4408' },
    enamel: { face: '#3a0508', deep: '#120102' },
    gem: { core: '#e8352a', glow: '#ff8a7a' },
  }),
  titleBelt(5, 'GOOPLIATH', 'TIDE', {
    plate: 'sun',
    strap: { face: '#0e3a1e', edge: '#03140a', tool: '#1f6a38', thread: '#9affb8' },
    metal: { hi: '#ffffff', mid: '#cfe8dc', lo: '#4e6a5e' },
    enamel: { face: '#0b4a24', deep: '#021a0b' },
    gem: { core: '#36e05a', glow: '#a8ffbc' },
  }),
  runBelt('gauntlet', 'normal', 7, 'IRONCLAD', {
    plate: 'octagon',
    strap: { face: '#2a211b', edge: '#120d0a', tool: '#5a4334', thread: '#d9b07a' },
    metal: { hi: '#ffe0b0', mid: '#c98a4e', lo: '#5a3418' },
    enamel: { face: '#1d3b3a', deep: '#081816' },
    gem: { core: '#ffb000', glow: '#ffcf5a' },
  }),
  runBelt('hardcore', 'normal', 8, 'BLOODIRON', {
    plate: 'octagon',
    strap: { face: '#4a0d12', edge: '#1e0407', tool: '#7a2028', thread: '#c8ccd2' },
    metal: { hi: '#eef1f5', mid: '#7c838d', lo: '#24282e' },
    enamel: { face: '#1a1a1e', deep: '#060608' },
    gem: { core: '#ff1f3d', glow: '#ff6a7a' },
  }),
  runBelt('gauntlet', 'hard', 9, 'TITANSTEEL', {
    plate: 'crest',
    strap: { face: '#13244a', edge: '#060d1e', tool: '#2c4a86', thread: '#e6edf7' },
    metal: { hi: '#ffffff', mid: '#b6c0ce', lo: '#4a5464' },
    enamel: { face: '#0e2a5c', deep: '#030b1e' },
    gem: { core: '#2f6bff', glow: '#8fb4ff' },
  }),
  runBelt('hardcore', 'hard', 10, 'WARBRAND', {
    plate: 'crest',
    strap: { face: '#7a0f18', edge: '#2e0408', tool: '#a8303a', thread: '#1a1a1a' },
    metal: { hi: '#c4cad4', mid: '#3c414a', lo: '#0c0e12' },
    enamel: { face: '#5a0a0e', deep: '#1a0204' },
    gem: { core: '#ff3b1e', glow: '#ff8a5a' },
  }),
  runBelt('gauntlet', 'blazing', 11, 'SUNFORGED', {
    plate: 'sun',
    strap: { face: '#e9e1cf', edge: '#9c9078', tool: '#c9b98f', thread: '#c9962a' },
    metal: { hi: '#fff6c8', mid: '#f0bf3c', lo: '#7a4a08' },
    enamel: { face: '#f6f0e0', deep: '#bfae86' },
    gem: { core: '#e6fbff', glow: '#ffffff' },
  }),
  runBelt('hardcore', 'blazing', 12, 'INFERNO', {
    plate: 'sun',
    strap: { face: '#141012', edge: '#000000', tool: '#6a1a10', thread: '#ff7a2a' },
    metal: { hi: '#ffd8b0', mid: '#e0743e', lo: '#5e180a' },
    enamel: { face: '#2a0604', deep: '#0a0101' },
    gem: { core: '#ff5a1f', glow: '#ffb05a' },
  }),
];

export const beltOf = (id: string): Belt | undefined => BELTS.find((b) => b.id === id);
export const beltOfRank = (rank: number): Belt | undefined => BELTS.find((b) => b.rank === rank);

/** The belt a run at this difficulty is for — null on Easy. */
export function beltFor(mode: BeltMode, difficulty: Difficulty): Belt | null {
  if (difficulty === 'easy') return null;
  return beltOf(`${mode}-${difficulty}`) ?? null;
}

/** A boss's title belt (BOSSES index 0–4; 5 = GOOPLIATH). */
export function titleBeltOf(boss: number): Belt | null {
  return beltOf(boss === 5 ? 'goopliath' : `titan-${boss}`) ?? null;
}

/** "THE TITANSTEEL BELT". */
export const beltName = (b: Belt): string => `THE ${b.name} BELT`;

/** The full hover line: what it is, and how it was won. */
export const beltTip = (b: Belt): string => `${beltName(b)} · ${b.feat}`;

/** Clear tier (0 none · 1 normal · 2 hard · 3 blazing) → difficulty. */
const TIER_OF: Array<BeltTier | null> = [null, 'normal', 'hard', 'blazing'];

/**
 * A player's best RUN belt from the two clear tiers their profile has synced
 * since before belts (gauntletBest / gauntletBestHc). `gauntletBest` is
 * raised by every run (hardcore included), `gauntletBestHc` by hardcore runs
 * alone — so a gauntlet tier above the hardcore one can only have come from
 * a plain gauntlet run, and a hardcore belt beats the gauntlet belt of its
 * own tier.
 */
export function bestRunBeltFromTiers(gauntletBest: number, gauntletBestHc: number): Belt | null {
  const g = TIER_OF[Math.max(0, Math.min(3, gauntletBest | 0))];
  const hc = TIER_OF[Math.max(0, Math.min(3, gauntletBestHc | 0))];
  if (hc && gauntletBestHc >= gauntletBest) return beltOf(`hardcore-${hc}`) ?? null;
  if (g) return beltOf(`gauntlet-${g}`) ?? null;
  return null;
}

/** The best belt a profile row proves: its synced belt rank, or (a row from
 *  before belts) its run tiers. */
export function bestBeltOfRow(row: { beltBest?: number; gauntletBest?: number; gauntletBestHc?: number }): Belt | null {
  const synced = beltOfRank(row.beltBest ?? 0) ?? null;
  const fromTiers = bestRunBeltFromTiers(row.gauntletBest ?? 0, row.gauntletBestHc ?? 0);
  if (synced && fromTiers) return synced.rank >= fromTiers.rank ? synced : fromTiers;
  return synced ?? fromTiers;
}

/** Every belt YOU hold: the save's run belts, a title belt for every boss
 *  your save says you've defeated, and the best run belt your profile tiers
 *  prove (a run banked before belts existed still earns its belt). */
export function heldBelts(gauntletBest = 0, gauntletBestHc = 0): Set<string> {
  const held = new Set<string>();
  for (const id of campaignProgress.belts) if (beltOf(id)) held.add(id);
  campaignProgress.cleared.forEach((c, i) => {
    if (c && i < 5) held.add(`titan-${i}`);
  });
  if (campaignProgress.goopliathCleared) held.add('goopliath');
  const best = bestRunBeltFromTiers(gauntletBest, gauntletBestHc);
  if (best) held.add(best.id);
  return held;
}

/** Your best belt: the highest-ranked one you hold. */
export function bestHeldBelt(gauntletBest = 0, gauntletBestHc = 0): Belt | null {
  let best: Belt | null = null;
  for (const id of heldBelts(gauntletBest, gauntletBestHc)) {
    const b = beltOf(id);
    if (b && (!best || b.rank > best.rank)) best = b;
  }
  return best;
}

/** A finished run: bank its belt. Null on Easy; `fresh` when it's new. */
export function awardRunBelt(mode: BeltMode, difficulty: Difficulty): { belt: Belt; fresh: boolean } | null {
  const belt = beltFor(mode, difficulty);
  if (!belt) return null;
  const fresh = !campaignProgress.belts.includes(belt.id);
  if (fresh) {
    campaignProgress.belts.push(belt.id);
    saveCampaignProgress();
  }
  return { belt, fresh };
}
