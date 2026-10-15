/**
 * THE BELTS — championship belts, carried over from FIRE FIGHT FLUX's title
 * belts (fff game/career.ts) and grown into a full set. Neon, like fff's:
 * dark glass with every edge a lit tube (ui/beltArt.ts paints them,
 * ui/beltModel.ts builds the one held up when you win it). Each belt is
 * three neon colours — the STRAP, the PLATE metal, the STONE — and a centre
 * plate shape: an octagon (Normal), a crest (Hard) or a sunburst (Blazing).
 * Hardcore belts burn.
 *
 *  Each is called what it is — "THE AMATEUR BELT", "THE HARD GAUNTLET BELT":
 *
 *  THE CAREER (campaign/career.ts) — a title for each bout that wins one:
 *  AMATEUR (CHROMEHOOK, bout I), LOCAL (PISTONKAISER, II), NATIONAL
 *  (VULTURE, III), INTERCONTINENTAL (JUGGERNAUT, IV; defended in V), WORLD
 *  (GOLIATH, VI; defended in VII).
 *  GOOPLIATH: his belt the first time you defeat him (any tier), and one
 *  for his fight on Hard and on Blazing.
 *  THE RUNS AND RAIDS, one per tier (Normal · Hard · Blazing): the
 *  gauntlet, hardcore, the titan raid, the hardcore raid and the GOOPLIATH
 *  raid.
 *
 * Rank is prestige: the profile shows the highest belt you hold, and syncs
 * its rank as `beltBest` so everyone else sees it on your card. Belts are
 * kept forever.
 *
 * WHICH YOU HOLD: tier belts are kept in the campaign save
 * (`campaignProgress.belts`); career belts and the GOOPLIATH belt are read off the save's
 * own wins, so a bout won before belts existed still hands its belt over;
 * and the clear tiers the profile has always synced prove your best run and
 * raid belts.
 */

import type { Difficulty } from '../config.js';
import { campaignProgress, saveCampaignProgress } from './campaignState.js';
import { CAREER } from './career.js';

export type BeltTier = 'normal' | 'hard' | 'blazing';
export type PlateShape = 'octagon' | 'crest' | 'sun';
/** The runs and fights that pay one belt per tier. */
export type BeltFamily = 'gauntlet' | 'hardcore' | 'raid' | 'raidhc' | 'goopraid' | 'goopliath';
export type BeltKind = 'career' | 'goop' | 'tier';

export interface Belt {
  id: string;
  kind: BeltKind;
  family?: BeltFamily;
  tier?: BeltTier;
  /** 1 … 23: the profile shows the highest you hold. */
  rank: number;
  /** What it is: "HARD GAUNTLET" — said as "THE HARD GAUNTLET BELT". */
  name: string;
  /** What winning it makes you. */
  title: string;
  /** How it was won, when the name doesn't already say (the tooltip) … */
  feat: string;
  /** … and how to win it (the rack's tooltip on one you don't hold yet). */
  goal: string;
  /** The word on the centre plate's ribbon, and the plaque under it. */
  ribbon: string;
  plaque: string;
  /** The emblem in the centre plate (campaign/icons.ts index), and on the
   *  four side plates, left to right. */
  emblem: number;
  sides: [number, number, number, number];
  plate: PlateShape;
  /** Neon, #rrggbb: the strap's tubes, the plates' tubes, the stone. */
  strap: string;
  metal: string;
  gem: string;
  /** Hardcore belts burn: neon flames behind the centre plate. */
  flames: boolean;
}

// The neon palette (config.ts / fff), spelled out.
const CYAN = '#19f0ff';
const EMBER = '#ff7a1a';
const MAGENTA = '#ff2bd6';
const RED = '#ff2b4e';
const GOLD = '#ffc84a';
const SILVER = '#cfe6ff';
const LIME = '#7cff4a';
const VIOLET = '#b26bff';
const BLUE = '#4a6bff';
const GOO = '#36e05a';
const TEAL = '#2fe0d0';
const WHITE = '#ffffff';
const AMBER = '#ffb000';
const MOLTEN = '#ff9a3c';

const TITANS = ['CHROMEHOOK', 'PISTONKAISER', 'VULTURE', 'JUGGERNAUT', 'GOLIATH'];
const PLATE: Record<BeltTier, PlateShape> = { normal: 'octagon', hard: 'crest', blazing: 'sun' };
const TIER_METAL: Record<BeltTier, string> = { normal: SILVER, hard: GOLD, blazing: MOLTEN };

/** A career title's belt. */
function careerBelt(id: string, name: string, rank: number, plate: PlateShape, strap: string, metal: string, gem: string): Belt {
  const bout = CAREER.find((b) => b.wins === id)!;
  const who = TITANS[bout.boss];
  return {
    id,
    kind: 'career',
    rank,
    name,
    title: `${name} CHAMPION`,
    feat: `WON FROM ${who}`,
    goal: `DEFEAT ${who} IN THE ${bout.title} TO WIN IT`,
    ribbon: name,
    plaque: 'CHAMPION',
    emblem: bout.boss,
    sides: [bout.boss, bout.boss, bout.boss, bout.boss],
    plate,
    strap,
    metal,
    gem,
    flames: false,
  };
}

const FAMILY: Record<BeltFamily, { label: string; ribbon: string; win: string; strap: string; gem: string; goop: boolean; flames: boolean }> = {
  gauntlet: { label: 'GAUNTLET', ribbon: 'GAUNTLET', win: 'RUN THE GAUNTLET', strap: CYAN, gem: WHITE, goop: false, flames: false },
  hardcore: { label: 'HARDCORE', ribbon: 'HARDCORE', win: 'SURVIVE HARDCORE', strap: RED, gem: AMBER, goop: false, flames: true },
  raid: { label: 'TITAN RAID', ribbon: 'TITAN RAID', win: 'BEAT THE TITAN RAID', strap: VIOLET, gem: CYAN, goop: false, flames: false },
  raidhc: { label: 'HARDCORE RAID', ribbon: 'HARDCORE RAID', win: 'BEAT THE HARDCORE RAID', strap: MAGENTA, gem: GOLD, goop: false, flames: true },
  goopraid: { label: 'GOOPLIATH RAID', ribbon: 'GOOP RAID', win: 'BEAT THE GOOPLIATH RAID', strap: GOO, gem: LIME, goop: true, flames: false },
  goopliath: { label: 'GOOPLIATH', ribbon: 'GOOPLIATH', win: 'DEFEAT GOOPLIATH', strap: TEAL, gem: GOO, goop: true, flames: false },
};

/** A run's, raid's or fight's belt for one tier. */
function tierBelt(family: BeltFamily, tier: BeltTier, rank: number): Belt {
  const f = FAMILY[family];
  const word = tier.toUpperCase();
  const goop = f.goop ? 5 : -1;
  return {
    id: `${family}-${tier}`,
    kind: 'tier',
    family,
    tier,
    rank,
    name: `${word} ${f.label}`,
    title: `${f.label} CHAMPION`,
    feat: '',
    goal: `${f.win} ON ${word} TO WIN IT`,
    ribbon: f.ribbon,
    plaque: word,
    emblem: f.goop ? 5 : 4,
    sides: f.goop ? [goop, goop, goop, goop] : [0, 1, 2, 3],
    plate: PLATE[tier],
    strap: f.strap,
    metal: TIER_METAL[tier],
    gem: f.gem,
    flames: f.flames,
  };
}

export const BELTS: readonly Belt[] = [
  careerBelt('amateur', 'AMATEUR', 1, 'octagon', CYAN, SILVER, WHITE),
  careerBelt('local', 'LOCAL', 2, 'octagon', LIME, SILVER, AMBER),
  careerBelt('national', 'NATIONAL', 3, 'crest', EMBER, GOLD, RED),
  careerBelt('intercontinental', 'INTERCONTINENTAL', 4, 'crest', MAGENTA, GOLD, CYAN),
  careerBelt('world', 'WORLD', 5, 'sun', BLUE, GOLD, RED),
  {
    id: 'goopliath',
    kind: 'goop',
    rank: 6,
    name: 'GOOPLIATH',
    title: 'GOOPLIATH CHAMPION',
    feat: '',
    goal: 'DEFEAT GOOPLIATH TO WIN IT',
    ribbon: 'GOOPLIATH',
    plaque: 'CHAMPION',
    emblem: 5,
    sides: [5, 5, 5, 5],
    plate: 'octagon',
    strap: GOO,
    metal: SILVER,
    gem: GOO,
    flames: false,
  },
  tierBelt('gauntlet', 'normal', 7),
  tierBelt('hardcore', 'normal', 8),
  tierBelt('raid', 'normal', 9),
  tierBelt('raidhc', 'normal', 10),
  tierBelt('goopraid', 'normal', 11),
  tierBelt('goopliath', 'hard', 12),
  tierBelt('gauntlet', 'hard', 13),
  tierBelt('hardcore', 'hard', 14),
  tierBelt('raid', 'hard', 15),
  tierBelt('raidhc', 'hard', 16),
  tierBelt('goopraid', 'hard', 17),
  tierBelt('goopliath', 'blazing', 18),
  tierBelt('gauntlet', 'blazing', 19),
  tierBelt('hardcore', 'blazing', 20),
  tierBelt('raid', 'blazing', 21),
  tierBelt('raidhc', 'blazing', 22),
  tierBelt('goopraid', 'blazing', 23),
];

export const beltOf = (id: string): Belt | undefined => BELTS.find((b) => b.id === id);
export const beltOfRank = (rank: number): Belt | undefined => BELTS.find((b) => b.rank === rank);

/** The belt a family pays at this difficulty — null when it pays none. */
export function beltFor(family: BeltFamily, difficulty: Difficulty): Belt | null {
  if (difficulty === 'easy') return null;
  return beltOf(`${family}-${difficulty}`) ?? null;
}

/** "THE HARD GAUNTLET BELT". */
export const beltName = (b: Belt): string => `THE ${b.name} BELT`;

/** Title defenses won with a career belt. */
export const defensesOf = (b: Belt): number => campaignProgress.defenses[b.id] ?? 0;

/** The full hover line: what it is, and how it was won. */
export function beltTip(b: Belt, mine = false): string {
  const def = mine ? defensesOf(b) : 0;
  return [beltName(b), b.feat, def ? `DEFENDED ×${def}` : ''].filter(Boolean).join(' · ');
}

/* ── which belts a player holds ───────────────────────────────────────── */

/** The clear tiers a profile row has always synced (0 none … 3 blazing). */
export interface ClearTiers {
  gauntletBest?: number;
  gauntletBestHc?: number;
  raidBest?: number;
  raidBestHc?: number;
  beltBest?: number;
}

const TIER_OF: Array<BeltTier | null> = [null, 'normal', 'hard', 'blazing'];
const tierOf = (n: number | undefined): BeltTier | null => TIER_OF[Math.max(0, Math.min(3, (n ?? 0) | 0))];

/**
 * The best belt one pair of clear tiers proves. The plain tier is raised by
 * every clear (hardcore included), the hardcore tier by hardcore clears
 * alone — so a plain tier above the hardcore one can only have come from a
 * plain clear, and the hardcore belt beats the plain belt of its own tier.
 */
function bestOfPair(plain: BeltFamily, hard: BeltFamily, best = 0, bestHc = 0): Belt | null {
  const hc = tierOf(bestHc);
  if (hc && bestHc >= best) return beltOf(`${hard}-${hc}`) ?? null;
  const t = tierOf(best);
  return t ? (beltOf(`${plain}-${t}`) ?? null) : null;
}

/** The belts a profile row PROVES: its synced best, and its best run and
 *  raid belts read off the clear tiers. */
function provenBy(row: ClearTiers): Belt[] {
  return [
    beltOfRank(row.beltBest ?? 0),
    bestOfPair('gauntlet', 'hardcore', row.gauntletBest, row.gauntletBestHc),
    bestOfPair('raid', 'raidhc', row.raidBest, row.raidBestHc),
  ].filter((b): b is Belt => !!b);
}

const highest = (belts: Iterable<Belt>): Belt | null => {
  let best: Belt | null = null;
  for (const b of belts) if (!best || b.rank > best.rank) best = b;
  return best;
};

/** Anyone's best belt, from their profile row. */
export const bestBeltOfRow = (row: ClearTiers): Belt | null => highest(provenBy(row));

/** Every belt YOU hold: the save's tier belts, a career belt for each title
 *  bout your save has won, GOOPLIATH's, and what your profile's tiers prove. */
export function heldBelts(row: ClearTiers = {}): Set<string> {
  const held = new Set<string>();
  for (const id of campaignProgress.belts) if (beltOf(id)) held.add(id);
  CAREER.forEach((bout, i) => {
    if (bout.wins && campaignProgress.cleared[i]) held.add(bout.wins);
  });
  if (campaignProgress.goopliathCleared) held.add('goopliath');
  for (const b of provenBy(row)) held.add(b.id);
  return held;
}

/** Your best belt: the highest-ranked one you hold. */
export function bestHeldBelt(row: ClearTiers = {}): Belt | null {
  return highest([...heldBelts(row)].map((id) => beltOf(id)!));
}

/** Bank a tier belt. Null when the fight pays none; `fresh` when it's new. */
export function awardTierBelt(family: BeltFamily, difficulty: Difficulty): { belt: Belt; fresh: boolean } | null {
  const belt = beltFor(family, difficulty);
  if (!belt) return null;
  const fresh = !campaignProgress.belts.includes(belt.id);
  if (fresh) {
    campaignProgress.belts.push(belt.id);
    saveCampaignProgress();
  }
  return { belt, fresh };
}

/** A title defense won: counted on its belt. Returns the new count. */
export function bankDefense(beltId: string): number {
  const n = (campaignProgress.defenses[beltId] ?? 0) + 1;
  campaignProgress.defenses[beltId] = n;
  saveCampaignProgress();
  return n;
}
