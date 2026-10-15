/**
 * THE TITAN GAUNTLET (MENUS 3) — the campaign, on the panel kit.
 *
 * THE CAREER (campaign/career.ts): seven cards left to right, FIRE FIGHT
 * FLUX's title run — AMATEUR, LOCAL, NATIONAL, INTERCONTINENTAL, the
 * DEFENSE against a supercharged VULTURE, WORLD, and the WORLD DEFENSE
 * against a supercharged GOLIATH. A card is SEALED until the one before it
 * is won, and DEFEATED (or DEFENDED) once it is. The cards are ghost buttons
 * the body paints, because their art is the thing — the titan's emblem
 * (campaign/icons.ts), the belt the bout is for, a padlock over the ones
 * still shut, a chevron on the path between them.
 *
 * Beneath the career, the three RUNS: the gauntlet against the clock,
 * HARDCORE with no healing between titans, and GOOPLIATH's own fight —
 * each sealed until the run before it is earned. Beside them, THE BELT RACK
 * button: your best belt and your count; press it and THE RACK takes the
 * panel — every championship belt (campaign/belts.ts), yours lit, the rest
 * as ghosts, each saying on hover what it is or how to win it.
 *
 * Pressing a run opens THE LAUNCH CARD rather than firing: the run's name,
 * the four damage tiers, the belt the run is for at that tier, and START.
 * While a card or the rack is up it owns every click on the panel — the face
 * returns its buttons and nothing else, so there is no clicking through it.
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
import { CAREER } from '../campaign/career.js';
import { DIFFICULTY, DIFFICULTY_ORDER } from '../config.js';
import { BELTS, beltFor, beltName, beltOf, beltTip, bestHeldBelt, heldBelts, type Belt } from '../campaign/belts.js';
import { drawBelt } from '../ui/beltArt.js';
import { myClearTiers } from '../net/leaderboard.js';

export const CAMP_W = 1280;
export const CAMP_H = 800;

const M = 64;
const INNER = CAMP_W - M * 2;
const BOUTS = CAREER.length;
const CARD_GAP = 14;
const CARD_W = (INNER - CARD_GAP * (BOUTS - 1)) / BOUTS;
const CARD_Y = 150;
const CARD_H = 340;
const RUN_Y = 520;
const RUN_H = 78;
const RUN_GAP = 12;
const RUN_W = 420;
const GOOP_GREEN = '#36e05a';
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

/** What's up over the career: a run's LAUNCH card, THE RACK, or nothing. */
export const campaignModal = { pending: null as 'gauntlet' | 'hardcore' | 'goopliath' | 'belts' | null };

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

/** A hovered thing's tooltip, kept on the panel. */
function tooltip(g: CanvasRenderingContext2D, text: string, cx: number, y: number, edge: string, ink: string): void {
  g.font = font(600, 20);
  const tw = g.measureText(text).width + 30;
  const tx = Math.max(M / 2, Math.min(CAMP_W - M / 2 - tw, cx - tw / 2));
  g.fillStyle = 'rgba(6,10,22,0.96)';
  g.beginPath();
  g.roundRect(tx, y, tw, 36, 8);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = edge;
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = ink;
  g.fillText(text, tx + tw / 2, y + 18);
}

/* ── THE CAREER ───────────────────────────────────────────────────────── */

const RACK_BTN = { x: M + RUN_W + 40, y: RUN_Y, w: CAMP_W - M - (M + RUN_W + 40), h: RUN_H * 2 - 6 };

export function campaignFace(): CampaignFace {
  if (campaignModal.pending === 'belts') return rackFace();
  if (campaignModal.pending) return launchFace(campaignModal.pending);

  const buttons: PanelButton[] = [];
  for (let i = 0; i < BOUTS; i++) {
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
    { id: 'campaign-belts', label: '', ghost: true, ...RACK_BTN },
    { id: 'campaign-close', label: 'CLOSE', x: CAMP_W - M - 240, y: CAMP_H - 116, w: 240, h: 84, small: true },
  );

  return {
    title: 'THE TITAN GAUNTLET',
    buttons,
    body: (g, hover) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const held = heldBelts(myClearTiers());
      for (let i = 0; i < BOUTS; i++) drawCard(g, i, held, hover);
      // The sealed sixth emblem, beside its plate: the gel, under the line-up.
      const iy = RUN_Y + (RUN_H + RUN_GAP) * 2 + RUN_H / 2;
      const beaten = campaignProgress.goopliathCleared;
      drawBossIcon(g, 5, M + RUN_W + 60, iy, 30, beaten ? KIT.accent : goop ? GOOP_GREEN : KIT.disabled);
      if (!goop) padlock(g, M + RUN_W + 60, iy, 0.7);
      drawRackButton(g, held, hover === 'campaign-belts');
      // A hovered card names its belt.
      const hc = hover?.startsWith('campaign-') ? Number(hover.slice('campaign-'.length)) : NaN;
      const bout = CAREER[hc];
      if (bout && stageUnlocked(hc)) {
        const belt = beltOf(bout.wins ?? bout.defends ?? '');
        if (belt) {
          const line = bout.defends
            ? `${bout.title} · ${held.has(belt.id) ? `YOUR ${belt.name} BELT ON THE LINE` : `FOR ${beltName(belt)}`}`
            : `${bout.title} · FOR ${beltName(belt)}`;
          tooltip(g, line, M + hc * (CARD_W + CARD_GAP) + CARD_W / 2, CARD_Y - 44, belt.strap, KIT.textHi);
        }
      }
    },
  };
}

/** One career card: numeral and title, emblem, titan, its belt, its state. */
function drawCard(g: CanvasRenderingContext2D, i: number, held: Set<string>, hover: string | null): void {
  const bout = CAREER[i];
  const open = stageUnlocked(i);
  const done = campaignProgress.cleared[i] === true;
  const boss = BOSSES[bout.boss];
  const belt = beltOf(bout.wins ?? bout.defends ?? '');
  const tint = bout.charged ? '#ff5a1f' : css(boss.accent);
  const x = M + i * (CARD_W + CARD_GAP);
  const cx = x + CARD_W / 2;
  const hot = hover === `campaign-${i}` && open;

  g.beginPath();
  g.roundRect(x, CARD_Y, CARD_W, CARD_H, 18);
  g.fillStyle = done ? KIT.accentFaint : open ? (hot ? KIT.plateHover : KIT.plate) : 'rgba(255,255,255,0.02)';
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = done ? KIT.accent : open ? (hot ? tint : KIT.line) : 'rgba(255,255,255,0.05)';
  g.stroke();

  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(700, 22);
  g.letterSpacing = '3px';
  g.fillStyle = open ? KIT.faint : KIT.disabled;
  g.fillText(ROMAN[i], cx, CARD_Y + 26);
  g.font = font(700, 16);
  g.letterSpacing = '2px';
  g.fillStyle = open ? (belt?.strap ?? KIT.dim) : KIT.disabled;
  g.fillText(bout.short, cx, CARD_Y + 52, CARD_W - 14);
  g.letterSpacing = '0px';

  // A supercharged titan gets a hot ring round its emblem.
  const ey = CARD_Y + 128;
  if (bout.charged && open) {
    g.save();
    g.shadowColor = tint;
    g.shadowBlur = 18;
    g.strokeStyle = tint;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, ey, 54, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }
  drawBossIcon(g, bout.boss, cx, ey, bout.charged ? 50 : 46, done ? KIT.accent : open ? tint : KIT.disabled);
  if (!open) padlock(g, cx, ey);

  g.font = font(700, 21);
  g.fillStyle = open ? KIT.textHi : KIT.disabled;
  g.fillText(open ? `${boss.name}${bout.charged ? '+' : ''}` : 'SEALED', cx, CARD_Y + 206, CARD_W - 16);
  if (bout.charged && open) {
    g.font = font(700, 13);
    g.letterSpacing = '2px';
    g.fillStyle = tint;
    g.fillText('SUPERCHARGED', cx, CARD_Y + 228, CARD_W - 16);
    g.letterSpacing = '0px';
  }

  // The belt it's for: lit once it's yours.
  if (belt) drawBelt(g, belt, cx, CARD_Y + 266, CARD_W - 18, { ghost: !held.has(belt.id) });

  g.font = font(600, 19);
  if (done) {
    g.fillStyle = KIT.accent;
    g.fillText(bout.defends ? 'DEFENDED ✓' : 'DEFEATED ✓', cx, CARD_Y + 314);
  } else if (open) {
    g.fillStyle = hot ? tint : KIT.dim;
    g.fillText(bout.defends ? 'DEFEND' : 'FIGHT', cx, CARD_Y + 314);
  } else {
    g.fillStyle = KIT.disabled;
    g.fillText('win the last', cx, CARD_Y + 314);
  }

  // The path between the cards: lit once the one behind it is won.
  if (i < BOUTS - 1) {
    const ax = x + CARD_W + CARD_GAP / 2;
    g.fillStyle = done ? KIT.accent : 'rgba(255,255,255,0.12)';
    g.beginPath();
    g.moveTo(ax - 5, ey - 9);
    g.lineTo(ax + 5, ey);
    g.lineTo(ax - 5, ey + 9);
    g.closePath();
    g.fill();
  }
}

/** THE BELT RACK button: your best belt, and how many you hold. */
function drawRackButton(g: CanvasRenderingContext2D, held: Set<string>, hot: boolean): void {
  const b = RACK_BTN;
  g.beginPath();
  g.roundRect(b.x, b.y, b.w, b.h, 18);
  g.fillStyle = hot ? KIT.plateHover : KIT.plate;
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = hot ? KIT.lineHover : KIT.line;
  g.stroke();
  const best = bestHeldBelt(myClearTiers());
  const bw = 300;
  drawBelt(g, best ?? BELTS[0], b.x + 24 + bw / 2, b.y + b.h / 2, bw, { ghost: !best });
  const tx = b.x + 24 + bw + 24;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 28);
  g.letterSpacing = '3px';
  g.fillStyle = KIT.textHi;
  g.fillText('THE BELT RACK', tx, b.y + b.h / 2 - 26, b.x + b.w - tx - 16);
  g.letterSpacing = '0px';
  g.font = font(600, 21);
  g.fillStyle = KIT.accent;
  g.fillText(`${held.size} of ${BELTS.length} belts`, tx, b.y + b.h / 2 + 8);
  g.fillStyle = KIT.faint;
  g.font = font(500, 18);
  g.fillText(best ? `best: ${beltName(best)}` : 'win a title to hang your first', tx, b.y + b.h / 2 + 36, b.x + b.w - tx - 16);
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

/* ── THE RACK: every belt ─────────────────────────────────────────────── */

const RACK_ROWS: Array<{ label: string; ids: string[] }> = [
  { label: 'THE CAREER', ids: ['amateur', 'local', 'national', 'intercontinental', 'world', 'goopliath'] },
  { label: 'THE RUNS', ids: ['gauntlet-normal', 'hardcore-normal', 'gauntlet-hard', 'hardcore-hard', 'gauntlet-blazing', 'hardcore-blazing'] },
  { label: 'THE RAIDS', ids: ['raid-normal', 'raidhc-normal', 'raid-hard', 'raidhc-hard', 'raid-blazing', 'raidhc-blazing'] },
  { label: 'GOOPLIATH', ids: ['goopliath-hard', 'goopliath-blazing', 'goopraid-normal', 'goopraid-hard', 'goopraid-blazing'] },
];
const RACK_TOP = 168;
const RACK_STEP_Y = 136;
const RACK_STEP_X = INNER / 6;

function rackSlots(): Array<{ belt: Belt; x: number; y: number; w: number; h: number }> {
  return RACK_ROWS.flatMap((row, r) =>
    row.ids.map((id, i) => ({
      belt: beltOf(id)!,
      x: M + i * RACK_STEP_X + 4,
      y: RACK_TOP + r * RACK_STEP_Y + 26,
      w: RACK_STEP_X - 8,
      h: 96,
    })),
  );
}

function rackFace(): CampaignFace {
  const slots = rackSlots();
  const buttons: PanelButton[] = slots.map((s) => ({ id: `badge-belt-${s.belt.id}`, label: '', ghost: true, x: s.x, y: s.y, w: s.w, h: s.h }));
  buttons.push({ id: 'campaign-belts-back', label: 'BACK', x: CAMP_W - M - 240, y: CAMP_H - 108, w: 240, h: 80, small: true });
  return {
    title: 'THE BELT RACK',
    buttons,
    body: (g, hover) => {
      const held = heldBelts(myClearTiers());
      g.textBaseline = 'middle';
      g.textAlign = 'right';
      g.font = font(700, 22);
      g.fillStyle = KIT.accent;
      g.fillText(`${held.size} / ${BELTS.length}`, CAMP_W - M, 78);
      RACK_ROWS.forEach((row, r) => {
        g.textAlign = 'left';
        g.font = font(700, 17);
        g.letterSpacing = '3px';
        g.fillStyle = KIT.faint;
        g.fillText(row.label, M + 6, RACK_TOP + r * RACK_STEP_Y + 10);
        g.letterSpacing = '0px';
      });
      for (const s of slots) {
        const hot = hover === `badge-belt-${s.belt.id}`;
        if (hot) {
          g.fillStyle = KIT.plateHover;
          g.beginPath();
          g.roundRect(s.x, s.y, s.w, s.h, 12);
          g.fill();
        }
        drawBelt(g, s.belt, s.x + s.w / 2, s.y + s.h / 2, s.w - 6, { ghost: !held.has(s.belt.id) });
      }
      g.textAlign = 'left';
      g.font = font(500, 19);
      g.fillStyle = KIT.faint;
      g.fillText('belts are yours for good · your profile shows your best', M + 6, CAMP_H - 68);
      const hot = slots.find((s) => hover === `badge-belt-${s.belt.id}`);
      if (hot) {
        const mine = held.has(hot.belt.id);
        const tip = mine ? beltTip(hot.belt, true) : `${beltName(hot.belt)} · ${hot.belt.goal}`;
        tooltip(g, tip, hot.x + hot.w / 2, hot.y - 30, hot.belt.strap, mine ? KIT.textHi : KIT.dim);
      }
    },
  };
}

/* ── THE LAUNCH CARD: pick the damage, then go ────────────────────────── */

/** The launch card: the run's name, the tiers, the belt at stake, START. */
const LAUNCH = { x: CAMP_W / 2 - 450, y: 150, w: 900, h: 480 };

/** What the fight is FOR, under the tiers: its belt at the picked tier
 *  (fff's "FOR THE NATIONAL BELT"), and whether it's already yours. */
function drawStake(g: CanvasRenderingContext2D, kind: 'gauntlet' | 'hardcore' | 'goopliath'): void {
  const held = heldBelts(myClearTiers());
  let belt = beltFor(kind, app.difficulty);
  // GOOPLIATH pays tier belts on Hard and Blazing; below that, his own
  // belt until you hold it.
  if (!belt && kind === 'goopliath' && !held.has('goopliath')) belt = beltOf('goopliath') ?? null;
  const cy = LAUNCH.y + 292;
  g.textBaseline = 'middle';
  if (!belt) {
    g.textAlign = 'center';
    g.font = font(600, 22);
    g.fillStyle = KIT.faint;
    g.fillText(
      kind === 'goopliath' ? 'NO BELT ON THIS TIER — HARD AND BLAZING EACH WIN ONE' : 'EASY EARNS NO BELT — NORMAL AND UP EACH WIN ONE',
      CAMP_W / 2,
      cy,
      LAUNCH.w - 80,
    );
    return;
  }
  const mine = held.has(belt.id);
  const bw = 270;
  drawBelt(g, belt, LAUNCH.x + 56 + bw / 2, cy, bw);
  const tx = LAUNCH.x + 56 + bw + 32;
  const tw = LAUNCH.x + LAUNCH.w - 48 - tx;
  g.textAlign = 'left';
  g.font = font(700, 30);
  g.letterSpacing = '2px';
  g.fillStyle = belt.strap;
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
