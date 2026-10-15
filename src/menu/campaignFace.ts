/**
 * THE TITAN GAUNTLET (MENUS 3) — the campaign line-up, on the panel kit.
 *
 * Five cards left to right, in the order you fight them: a card is SEALED
 * until the one before it falls, and FELLED once it has. The cards are
 * ghost buttons the body paints, because their art is the thing — each
 * titan's own emblem (campaign/icons.ts), a padlock over the ones still
 * shut, a chevron on the path between them.
 *
 * Beneath the line-up, the three RUNS: the gauntlet against the clock,
 * HARDCORE with no healing between titans, and GOOPLIATH's own fight —
 * each with its best clocks read out beside it, each sealed until the run
 * before it is earned.
 *
 * Beside the runs, THE BELT RACK (campaign/belts.ts): every championship
 * belt, lit if it's yours, a ghost if not — the six title belts (a boss's,
 * the first time you defeat it) over the six run belts. Hover one and it
 * says what it is, or how to win it.
 *
 * Pressing a run opens THE LAUNCH CARD rather than firing: the run's name,
 * the four damage tiers, the belt the run is for, and START. While it is up it owns every click on the panel — the face
 * returns its buttons and nothing else, so there is no clicking through a
 * modal at a titan behind it.
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app } from './appState.js';
import { BOSSES } from '../campaign/bosses.js';
import { drawBossIcon } from '../campaign/icons.js';
import {
  campaignProgress,
  difficultyUnlocked,
  fmtRunTime,
  gauntletUnlocked,
  goopliathUnlocked,
  stageUnlocked,
} from '../campaign/campaignState.js';
import { DIFFICULTY, DIFFICULTY_ORDER } from '../config.js';
import { BELTS, beltFor, beltName, beltTip, heldBelts, titleBeltOf, type Belt } from '../campaign/belts.js';
import { drawBelt } from '../ui/beltArt.js';
import { myGauntletTiers } from '../net/leaderboard.js';

export const CAMP_W = 1280;
export const CAMP_H = 800;

const M = 64;
const INNER = CAMP_W - M * 2;
const CARD_GAP = 20;
const CARD_W = (INNER - CARD_GAP * 4) / 5;
const CARD_Y = 150;
const CARD_H = 330;
const RUN_Y = 520;
const RUN_H = 78;
const RUN_GAP = 12;
const RUN_W = 420;
const GOOP_GREEN = '#36e05a';
const ROMAN = ['I', 'II', 'III', 'IV', 'V'];

/** Which run the LAUNCH card is asking about (null = the line-up is live). */
export const campaignModal = { pending: null as 'gauntlet' | 'hardcore' | 'goopliath' | null };

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

export interface CampaignFace {
  title: string;
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

/** The best clocks on a run's board, as a line you can read at a glance. */
function clocks(times: number[]): string {
  if (times.length === 0) return 'no clocks on the board yet';
  return times
    .slice(0, 3)
    .map((t, i) => `${i === 0 ? '★ ' : ''}${fmtRunTime(t)}`)
    .join('   ·   ');
}

/** The launch card: the run's name, the tiers, the belt at stake, START. */
const LAUNCH = { x: CAMP_W / 2 - 450, y: 150, w: 900, h: 480 };

/* ── THE BELT RACK ────────────────────────────────────────────────────── */

const RACK_X = M + RUN_W + 48;
const RACK_W = CAMP_W - M - RACK_X;
const RACK_STEP = RACK_W / 6;
const RACK_BELT_W = RACK_STEP - 10;
/** Row centres: the title belts, then the run belts; each under its label. */
const RACK_ROWS = [{ label: 'TITLE BELTS', y: 546 }, { label: 'RUN BELTS', y: 630 }];

/** Each belt's slot on the rack (the same list drives the drawing, the ghost
 *  buttons and the tooltip). */
function rackSlots(): Array<{ belt: Belt; x: number; y: number; w: number; h: number }> {
  const titles = BELTS.filter((b) => b.kind !== 'run');
  const runs = BELTS.filter((b) => b.kind === 'run');
  const h = RACK_BELT_W * 0.5;
  return [titles, runs].flatMap((row, r) =>
    row.map((belt, i) => ({ belt, x: RACK_X + i * RACK_STEP + 5, y: RACK_ROWS[r].y - h / 2, w: RACK_BELT_W, h })),
  );
}

function drawRack(g: CanvasRenderingContext2D, hover: string | null): void {
  const held = heldBelts(...myGauntletTiers());
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 16);
  g.letterSpacing = '3px';
  g.fillStyle = KIT.faint;
  const h = RACK_BELT_W * 0.5;
  for (const r of RACK_ROWS) g.fillText(r.label, RACK_X + 6, r.y - h / 2 - 10);
  g.letterSpacing = '0px';
  g.textAlign = 'right';
  g.fillText(`${held.size} / ${BELTS.length}`, RACK_X + RACK_W - 6, RACK_ROWS[0].y - h / 2 - 10);
  const slots = rackSlots();
  for (const s of slots) {
    const mine = held.has(s.belt.id);
    const hot = hover === `badge-belt-${s.belt.id}`;
    if (hot) {
      g.fillStyle = KIT.plateHover;
      g.beginPath();
      g.roundRect(s.x - 3, s.y - 3, s.w + 6, s.h + 6, 10);
      g.fill();
    }
    drawBelt(g, s.belt, s.x + s.w / 2, s.y + s.h / 2, s.w, { ghost: !mine });
  }
  // The hovered belt's tooltip, over everything.
  const hot = slots.find((s) => hover === `badge-belt-${s.belt.id}`);
  if (hot) {
    const tip = held.has(hot.belt.id) ? beltTip(hot.belt) : `${beltName(hot.belt)} · ${hot.belt.goal}`;
    g.font = font(600, 20);
    const tw = g.measureText(tip).width + 30;
    const tx = Math.max(M, Math.min(CAMP_W - M - tw, hot.x + hot.w / 2 - tw / 2));
    const ty = hot.y - 44;
    g.fillStyle = 'rgba(14,11,8,0.96)';
    g.beginPath();
    g.roundRect(tx, ty, tw, 36, 8);
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = hot.belt.metal.mid;
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = held.has(hot.belt.id) ? hot.belt.metal.hi : KIT.dim;
    g.fillText(tip, tx + tw / 2, ty + 18);
  }
}

export function campaignFace(): CampaignFace {
  if (campaignModal.pending) return launchFace(campaignModal.pending);

  const cleared = campaignProgress.cleared;
  const buttons: PanelButton[] = [];
  for (let i = 0; i < 5; i++) {
    buttons.push({
      id: `campaign-${i}`,
      label: '',
      ghost: true,
      x: M + i * (CARD_W + CARD_GAP),
      y: CARD_Y,
      w: CARD_W,
      h: CARD_H,
      disabled: !stageUnlocked(i),
    });
  }

  const gauntlet = gauntletUnlocked();
  const hardcore = campaignProgress.hardcoreUnlocked;
  const goop = goopliathUnlocked();
  buttons.push(
    {
      id: 'campaign-speedrun',
      label: gauntlet ? 'RUN THE GAUNTLET' : 'GAUNTLET SEALED',
      sub: gauntlet ? clocks(campaignProgress.runTimesGauntlet) : 'defeat all five titans to unlock',
      x: M, y: RUN_Y, w: RUN_W, h: RUN_H,
      small: true,
      disabled: !gauntlet,
    },
    {
      id: 'campaign-hardcore',
      label: hardcore ? 'HARDCORE' : 'HARDCORE SEALED',
      sub: hardcore ? clocks(campaignProgress.runTimesHardcore) : 'complete a gauntlet run to unlock',
      x: M, y: RUN_Y + RUN_H + RUN_GAP, w: RUN_W, h: RUN_H,
      small: true,
      tone: hardcore ? KIT.danger : undefined,
      disabled: !hardcore,
    },
    {
      id: 'campaign-goopliath',
      label: goop ? 'FIGHT GOOPLIATH' : 'SOMETHING STIRS',
      sub: goop
        ? campaignProgress.goopliathCleared
          ? 'defeated ✓ — fight it again'
          : 'it waits beneath the pit'
        : 'defeat all five titans',
      x: M, y: RUN_Y + (RUN_H + RUN_GAP) * 2, w: RUN_W, h: RUN_H,
      small: true,
      tone: goop ? GOOP_GREEN : undefined,
      disabled: !goop,
    },
    { id: 'campaign-close', label: 'CLOSE', x: CAMP_W - M - 240, y: CAMP_H - 116, w: 240, h: 84, small: true },
  );
  for (const s of rackSlots()) {
    buttons.push({ id: `badge-belt-${s.belt.id}`, label: '', ghost: true, x: s.x, y: s.y, w: s.w, h: s.h });
  }

  return {
    title: 'THE TITAN GAUNTLET',
    buttons,
    body: (g, hover) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      for (let i = 0; i < 5; i++) drawCard(g, i, cleared[i] === true, hover);
      // The sixth emblem, beside its plate: the gel, sealed under the five.
      const iy = RUN_Y + (RUN_H + RUN_GAP) * 2 + RUN_H / 2;
      const felled = campaignProgress.goopliathCleared;
      drawBossIcon(g, 5, M + RUN_W + 60, iy, 30, felled ? KIT.accent : goop ? GOOP_GREEN : KIT.disabled);
      if (!goop) padlock(g, M + RUN_W + 60, iy, 0.7);
      drawRack(g, hover);
    },
  };
}

/** One titan card: numeral, emblem, name, and what it says about itself. */
function drawCard(g: CanvasRenderingContext2D, i: number, done: boolean, hover: string | null): void {
  const open = stageUnlocked(i);
  const boss = BOSSES[i];
  const tint = css(boss.accent);
  const x = M + i * (CARD_W + CARD_GAP);
  const hot = hover === `campaign-${i}` && open;

  g.beginPath();
  g.roundRect(x, CARD_Y, CARD_W, CARD_H, 20);
  g.fillStyle = done ? KIT.accentFaint : open ? (hot ? KIT.plateHover : KIT.plate) : 'rgba(255,255,255,0.02)';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = done ? KIT.accent : open ? (hot ? tint : KIT.line) : 'rgba(255,255,255,0.05)';
  g.stroke();

  const cx = x + CARD_W / 2;
  g.font = font(700, 26);
  g.letterSpacing = '3px';
  g.fillStyle = open ? KIT.faint : KIT.disabled;
  g.fillText(ROMAN[i], cx, CARD_Y + 40);
  g.letterSpacing = '0px';

  drawBossIcon(g, i, cx, CARD_Y + 150, 58, done ? KIT.accent : open ? tint : KIT.disabled);
  if (!open) padlock(g, cx, CARD_Y + 150);

  g.font = font(700, 26);
  g.fillStyle = open ? KIT.textHi : KIT.disabled;
  g.fillText(open ? boss.name : 'SEALED', cx, CARD_Y + 250, CARD_W - 24);

  g.font = font(600, 22);
  if (done) {
    g.fillStyle = KIT.accent;
    g.fillText('DEFEATED ✓', cx, CARD_Y + 292);
  } else if (open) {
    g.fillStyle = hot ? tint : KIT.dim;
    g.fillText('FIGHT', cx, CARD_Y + 292);
  } else {
    g.fillStyle = KIT.disabled;
    g.fillText('defeat the last', cx, CARD_Y + 292);
  }

  // The path between the cards: lit once the one behind it has fallen.
  if (i < 4) {
    const ax = x + CARD_W + CARD_GAP / 2;
    const ay = CARD_Y + 150;
    g.fillStyle = done ? KIT.accent : 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.moveTo(ax - 6, ay - 11);
    g.lineTo(ax + 7, ay);
    g.lineTo(ax - 6, ay + 11);
    g.closePath();
    g.fill();
  }
}

function padlock(g: CanvasRenderingContext2D, cx: number, cy: number, s = 1): void {
  // A disc of the panel's own dark behind it, so the lock reads ON the
  // emblem rather than dissolving into it.
  g.fillStyle = 'rgba(10,8,6,0.82)';
  g.beginPath();
  g.arc(cx, cy + 4 * s, 26 * s, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = KIT.dim;
  g.lineWidth = 5 * s;
  g.beginPath();
  g.arc(cx, cy - 9 * s, 11 * s, Math.PI, 0);
  g.stroke();
  g.fillStyle = KIT.dim;
  g.beginPath();
  g.roundRect(cx - 15 * s, cy - 3 * s, 30 * s, 22 * s, 4 * s);
  g.fill();
}

/* ── THE LAUNCH CARD: pick the damage, then go ────────────────────────── */

/** What the run is FOR, under the tiers: its belt (fff's "FOR THE NATIONAL
 *  BELT"), and whether it's already yours. GOOPLIATH's fight is for his
 *  title belt at any tier; a run's belt changes with the tier, and Easy
 *  earns none. */
function drawStake(g: CanvasRenderingContext2D, kind: 'gauntlet' | 'hardcore' | 'goopliath'): void {
  const belt = kind === 'goopliath' ? titleBeltOf(5) : beltFor(kind, app.difficulty);
  const cy = LAUNCH.y + 292;
  g.textBaseline = 'middle';
  if (!belt) {
    g.textAlign = 'center';
    g.font = font(600, 24);
    g.fillStyle = KIT.faint;
    g.fillText('EASY EARNS NO BELT — NORMAL AND UP EACH WIN ONE', CAMP_W / 2, cy);
    return;
  }
  const mine = heldBelts(...myGauntletTiers()).has(belt.id);
  const bw = 270;
  drawBelt(g, belt, LAUNCH.x + 56 + bw / 2, cy, bw);
  const tx = LAUNCH.x + 56 + bw + 32;
  const tw = LAUNCH.x + LAUNCH.w - 48 - tx;
  g.textAlign = 'left';
  g.font = font(700, 30);
  g.letterSpacing = '2px';
  g.fillStyle = belt.metal.hi;
  g.fillText(mine ? `${beltName(belt)} · YOURS` : `FOR ${beltName(belt)}`, tx, cy - 18, tw);
  g.letterSpacing = '0px';
  g.font = font(600, 21);
  g.fillStyle = KIT.dim;
  g.fillText(mine ? 'win it again — it stays on your rack' : belt.title, tx, cy + 20, tw);
}

function launchFace(kind: 'gauntlet' | 'hardcore' | 'goopliath'): CampaignFace {
  const accent = kind === 'hardcore' ? KIT.danger : kind === 'goopliath' ? GOOP_GREEN : KIT.accent;
  const title = kind === 'hardcore' ? 'HARDCORE RUN' : kind === 'goopliath' ? 'FIGHT GOOPLIATH' : 'RUN THE GAUNTLET';
  const chipW = 186;
  const gap = 16;
  const chipsW = DIFFICULTY_ORDER.length * (chipW + gap) - gap;
  const chipX = CAMP_W / 2 - chipsW / 2;
  const buttons: PanelButton[] = DIFFICULTY_ORDER.map((tier, i) => ({
    id: `diff-${tier}`,
    label: DIFFICULTY[tier].label,
    sub: DIFFICULTY[tier].blurb,
    x: chipX + i * (chipW + gap),
    y: LAUNCH.y + 112,
    w: chipW,
    h: 110,
    small: true,
    selected: app.difficulty === tier,
    disabled: !difficultyUnlocked(tier),
    tone: app.difficulty === tier ? css(DIFFICULTY[tier].accent) : undefined,
  }));
  buttons.push(
    { id: 'campaign-launch-cancel', label: 'CANCEL', x: LAUNCH.x + 48, y: LAUNCH.y + LAUNCH.h - 108, w: 220, h: 76, small: true },
    {
      id: 'campaign-launch-start',
      label: 'START',
      x: LAUNCH.x + LAUNCH.w - 48 - 280,
      y: LAUNCH.y + LAUNCH.h - 108,
      w: 280,
      h: 76,
      primary: true,
    },
  );

  return {
    title: 'THE TITAN GAUNTLET',
    buttons,
    body: (g) => {
      // The line-up is still behind: dim it, then stand the card on top.
      g.fillStyle = 'rgba(4,3,2,0.72)';
      g.fillRect(0, 0, CAMP_W, CAMP_H);
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 40;
      g.fillStyle = 'rgba(14,11,8,0.98)';
      g.beginPath();
      g.roundRect(LAUNCH.x, LAUNCH.y, LAUNCH.w, LAUNCH.h, 26);
      g.fill();
      g.restore();
      g.lineWidth = 2;
      g.strokeStyle = accent;
      g.stroke();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(700, 40);
      g.letterSpacing = '3px';
      g.fillStyle = accent;
      g.fillText(title, CAMP_W / 2, LAUNCH.y + 62);
      g.letterSpacing = '0px';
      drawStake(g, kind);
    },
  };
}
