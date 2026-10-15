/**
 * ARCADE campaign state — two things live here:
 *
 *  1. The LIVE bout bus: CampaignSystem writes it, FireballSystem reads the
 *     aim-assist point (a titan's sweet spot moves — head when the core is
 *     shuttered, the vented core when it's open — and it sits far higher than
 *     a human boxer's chest).
 *
 *  2. The persisted PROGRESS: which titans have been felled (stages unlock
 *     left to right), the gauntlet-run leaderboards (best fight-time clocks,
 *     gauntlet + hardcore), and whether hardcore has been earned. One
 *     localStorage blob ('ff-campaign'), separate from the lifetime stats.
 */

import { Vector3 } from 'three';
import { ARENA_GAP, CAMPAIGN, type Difficulty } from '../config.js';
import type { PeerMessage } from '../net/protocol.js';
import { BOUT_OF_TITAN } from './career.js';

export const campaign = {
  /** World point player throws are aim-assisted toward during a titan bout. */
  aimPoint: new Vector3(0, 1.25, -ARENA_GAP),
  /** True while the titan's core is vented open (the punish window). */
  coreOpen: false,
};

/** RAID wire traffic (ratk / rdmg / rst), routed here by MeshSystem so
 *  CampaignSystem can drain it without owning the mesh plumbing. */
export const raidInbox: Array<{ seat: number; msg: PeerMessage }> = [];

/** Gauntlet-run clock formatting: m:ss.t — shared by the HUD and the boards. */
export function fmtRunTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const tenths = Math.floor((s * 10) % 10);
  return `${m}:${ss}.${tenths}`;
}

// --- persisted progress -------------------------------------------------------

export interface CampaignProgress {
  /** One flag per CAREER bout (campaign/career.ts): true once it's won. */
  cleared: boolean[];
  /** 2 = `cleared` is indexed by career bout (seven); older saves held one
   *  flag per titan (five) and are remapped on load. */
  careerVersion: number;
  /** Title defenses won, per belt id. */
  defenses: Record<string, number>;
  /** The career's prize has been paid. */
  careerPrized: boolean;
  /** Best GAUNTLET RUN times (seconds of fight time), ascending, capped. */
  runTimesGauntlet: number[];
  /** Best HARDCORE run times — no healing between titans. */
  runTimesHardcore: number[];
  /** Set by finishing your first gauntlet run: hardcore opens. */
  hardcoreUnlocked: boolean;
  /** True once a RAID has been fully beaten (GOLIATH's second life included). */
  raidCleared: boolean;
  /** True once GOOPLIATH has been felled solo (the campaign's sealed entry). */
  goopliathCleared: boolean;
  /** True once a GOOPLIATH raid (the lobby breaker) has been beaten. */
  raidGoopliathCleared: boolean;
  /** HARD difficulty unlocks by clearing any run on Normal-or-higher. */
  hardUnlocked: boolean;
  /** BLAZING unlocks by clearing any run on Hard-or-higher. */
  blazingUnlocked: boolean;
  /** Championship belts won (campaign/belts.ts ids): one per run per tier. */
  belts: string[];
}

const KEY = 'ff-campaign';

function fresh(): CampaignProgress {
  return {
    cleared: new Array(CAMPAIGN.stages).fill(false),
    careerVersion: 2,
    defenses: {},
    careerPrized: false,
    runTimesGauntlet: [],
    runTimesHardcore: [],
    hardcoreUnlocked: false,
    raidCleared: false,
    goopliathCleared: false,
    raidGoopliathCleared: false,
    hardUnlocked: false,
    blazingUnlocked: false,
    belts: [],
  };
}

function load(): CampaignProgress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = { ...fresh(), ...JSON.parse(raw) } as CampaignProgress;
      if (p.careerVersion !== 2) {
        // A five-titan save: each titan's flag moves to the bout that first
        // beats it; the two defenses start unwon.
        const old = p.cleared.slice(0, 5);
        p.cleared = new Array(CAMPAIGN.stages).fill(false);
        old.forEach((c, titan) => (p.cleared[BOUT_OF_TITAN[titan]] = c === true));
        p.careerVersion = 2;
      }
      if (!p.defenses || typeof p.defenses !== 'object') p.defenses = {};
      // Older saves (or a future stage-count bump) may carry a short array.
      while (p.cleared.length < CAMPAIGN.stages) p.cleared.push(false);
      if (!Array.isArray(p.belts)) p.belts = [];
      return p;
    }
  } catch {
    /* fresh gauntlet */
  }
  return fresh();
}

export const campaignProgress: CampaignProgress = load();

export function saveCampaignProgress(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(campaignProgress));
  } catch {
    /* storage unavailable — progress stays in-memory */
  }
}

/** An arcade stage is open once every stage before it has been cleared. */
export function stageUnlocked(stage: number): boolean {
  if (stage <= 0) return true;
  return campaignProgress.cleared[stage - 1] === true;
}

/** The gauntlet run opens once every titan has been defeated at least once
 *  (the defenses aren't needed — they're rematches, not new titans). */
export function gauntletUnlocked(): boolean {
  return BOUT_OF_TITAN.every((i) => campaignProgress.cleared[i] === true);
}

/** GOOPLIATH's campaign entry unseals with the gauntlet: fell all five
 *  titans and something worse stirs beneath the line-up. */
export function goopliathUnlocked(): boolean {
  return gauntletUnlocked();
}

/** Whether a difficulty tier can be picked. Easy and Normal are always open;
 *  Hard needs a Normal-or-higher run cleared, Blazing needs a Hard one. */
export function difficultyUnlocked(diff: Difficulty): boolean {
  if (diff === 'easy' || diff === 'normal') return true;
  if (diff === 'hard') return campaignProgress.hardUnlocked;
  return campaignProgress.blazingUnlocked;
}

/** Bank a run/raid clear: clearing on Normal opens Hard, clearing on Hard
 *  opens Blazing. Returns the tier newly unlocked (for a card), or null. */
export function bankDifficultyClear(diff: Difficulty): Difficulty | null {
  if (diff === 'normal' && !campaignProgress.hardUnlocked) {
    campaignProgress.hardUnlocked = true;
    saveCampaignProgress();
    return 'hard';
  }
  if (diff === 'hard' && !campaignProgress.blazingUnlocked) {
    campaignProgress.blazingUnlocked = true;
    saveCampaignProgress();
    return 'blazing';
  }
  return null;
}

/**
 * Bank a finished run's clock on its board (ascending, top-N kept). Returns
 * true when it's the new best.
 */
export function recordRunTime(hardcore: boolean, seconds: number): boolean {
  const board = hardcore ? campaignProgress.runTimesHardcore : campaignProgress.runTimesGauntlet;
  board.push(seconds);
  board.sort((a, b) => a - b);
  board.splice(CAMPAIGN.leaderboardSize);
  saveCampaignProgress();
  return board[0] === seconds;
}
