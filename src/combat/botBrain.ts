/**
 * THE BOT BRAIN — which sparring partner a bot bout serves, and how sharp.
 *
 * Pure functions over BOT_LADDER (config.ts): the player's cumulative XP →
 * their Bronze→Overlord tier → a SKILL in 0..1 that walks the ladder's rows
 * continuously (tier index + progress through the tier, over the row count),
 * → one blended `BotBrain` the BotSystem drives every bot in the bout with.
 * Because the blend is by within-tier progress, a Bronze player at 95 XP is
 * already sparring something close to the SILVER row: the climb is a ramp,
 * not a staircase of cliffs.
 *
 * Also here: the MERCY ease (config.BOT_MERCY) that softens the lower ranks'
 * bot when the player is losing rounds, the dev override (`?bot=gold`,
 * `?botskill=0.62`, or `__ff2.bot.force`), and the live readout the bout
 * panel and the headless probe (tools/bot-check.mjs) read.
 */

import { BOT_LADDER, BOT_MERCY, PROGRESSION, type BotLadderRow } from '../config.js';
import { tierForXp } from '../menu/progression.js';

export type BotBrain = BotLadderRow & {
  /** The rank whose row the label came from ('BRONZE' … 'OVERLORD'). */
  grade: string;
  /** The skill this brain was blended at, 0..1. */
  skill: number;
};

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** A skill in 0..1 for a cumulative XP total: tier index + tier progress,
 *  over the row count. Bronze floor = 0; the top of Overlord = 1. */
export function skillForXp(xp: number): number {
  const tier = tierForXp(Math.max(0, xp));
  return clamp01((tier.index + tier.progress) / BOT_LADDER.length);
}

/** The brain at a skill: the two ladder rows either side of it, blended. */
export function brainForSkill(skill: number): BotBrain {
  const n = BOT_LADDER.length;
  const pos = clamp01(skill) * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const t = Math.min(1, pos - i);
  const a = BOT_LADDER[i];
  const b = BOT_LADDER[Math.min(n - 1, i + 1)];
  const out = { ...a } as Record<string, number | string>;
  for (const key of Object.keys(a) as Array<keyof BotLadderRow>) {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') out[key] = av + (bv - av) * t;
  }
  return { ...(out as unknown as BotLadderRow), grade: PROGRESSION.tiers[i]?.name ?? 'BRONZE', skill: clamp01(skill) };
}

/** The brain a player of this XP is served (no mercy, no override). */
export function brainForXp(xp: number): BotBrain {
  return brainForSkill(skillForXp(xp));
}

/**
 * The mercy ease for a bout in progress: how far below the earned skill the
 * bot drops while the player trails on rounds. Zero at DIAMOND and above.
 */
export function mercyFor(xp: number, roundsWon: number, roundsLost: number): number {
  if (tierForXp(Math.max(0, xp)).index >= BOT_MERCY.belowTier) return 0;
  return Math.min(BOT_MERCY.max, Math.max(0, (roundsLost - roundsWon) * BOT_MERCY.perRound));
}

/** The one-line grade the bout panel shows under BOT BOUT / ROUND BREAK. */
export function botGradeLine(brain: BotBrain): string {
  return `${brain.label.toLowerCase()} · ${brain.grade.toLowerCase()} grade`;
}

/**
 * The live readout: what the BotSystem resolved this frame. `null` brain
 * outside a bot bout. `override` is the dev-forced skill (null = none).
 */
export const botLive: { brain: BotBrain | null; base: number; mercy: number; override: number | null; throws: number } = {
  brain: null,
  base: 0,
  mercy: 0,
  override: readOverride(),
  /** Balls the bots have thrown this bout (the probe's proof of life). */
  throws: 0,
};

/** `?bot=<rank>` pins the bot to a rank's own row; `?botskill=<0..1>` pins
 *  a raw skill. Dev/probe only — a normal launch carries neither. */
function readOverride(): number | null {
  if (typeof location === 'undefined') return null;
  try {
    const q = new URLSearchParams(location.search);
    const rank = q.get('bot');
    if (rank) {
      const idx = PROGRESSION.tiers.findIndex((t) => t.name.toLowerCase() === rank.toLowerCase());
      if (idx >= 0) return idx / BOT_LADDER.length;
    }
    const raw = q.get('botskill');
    if (raw !== null && raw !== '' && Number.isFinite(Number(raw))) return clamp01(Number(raw));
  } catch {
    /* no URL to read — no override */
  }
  return null;
}

/** Dev/probe hook — the pure ladder plus the live bout's readout, on the
 *  __ff2 namespace the wrap installs (see tools/bot-check.mjs). */
export function installBotBrainDevHook(): void {
  const w = window as unknown as { __ff2?: Record<string, unknown> };
  (w.__ff2 ??= {}).bot = {
    rows: BOT_LADDER,
    tiers: PROGRESSION.tiers,
    skillForXp,
    brainForXp,
    brainForSkill,
    mercyFor,
    live: (): { brain: BotBrain | null; base: number; mercy: number; override: number | null; throws: number } => ({
      brain: botLive.brain ? { ...botLive.brain } : null,
      base: botLive.base,
      mercy: botLive.mercy,
      override: botLive.override,
      throws: botLive.throws,
    }),
    force: (skill: number | null): void => {
      botLive.override = skill === null ? null : clamp01(skill);
    },
  };
}
