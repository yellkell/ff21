/**
 * THE LADDER — the leaderboard, brought in off the back wall and onto the
 * TOWN wing as a tab (MENUS 2). Same data (net/leaderboard.ts), same
 * boards — BATTLE (1v1 · 2v2 · ffa), XP, ARCADE (aim · speedrun · raid ·
 * goop raid) — drawn in the panel kit's language: a sub-strip of small
 * chips, ten rows, the season clock, tap a name for the profile.
 *
 * THE PROFILE BLOCK lives here too — the service record (banner, name,
 * rank, XP bar, honours, achievements, note) shared by the ladder's
 * profile view and the pop-out profile card above the YOU wing.
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { fmtRunTime } from '../campaign/campaignState.js';
import { SEASON, seasonIndex } from '../config.js';
import {
  LEADERBOARD_VISIBLE_ROWS,
  SEASON_AWARDS,
  boardScroll,
  isRunTab,
  leaderboard,
  leaderboardRows,
  myProfileRow,
  runRows,
  RUN_VIEW_TIERS,
  type LbRow,
  type LeaderboardTab,
  type RunViewTier,
  type SeasonAward,
} from '../net/leaderboard.js';
import { paintBanner } from '../avatar/paint.js';
import { rankBadge, rankBadgeZoom } from './rankBadges.js';
import { tierForXp } from './progression.js';
import { profileHintActive } from './menu.js';

/* ── geometry (the TOWN wing's 832 × 1024 canvas) ─────────────────────── */

const W = 832;
const M = 48;
const INNER = W - M * 2; // 736
const SUB_Y = 132;
const SUB_H = 62;
const SUB2_Y = 208;
const SUB2_H = 54;
/** The run boards' third strip: NORMAL · HARD · BLAZING · HC ONLY. */
const VIEW_Y = 276;
const VIEW_H = 48;
const ROW_STEP = 56;
/** The run rows' columns: rank · HC (a hardcore run) · squad · clock. The
 *  tab already says the difficulty, so a row only marks hardcore. */
const HC_X = M + 64;
const HC_W = 42;
const NAMES_X = HC_X + HC_W + 14;
/** The BLAZING tab's tone, shared with the profile's achievement badges. */
const BLAZE = '#ff5a1f';

/** The top strip of boards. BATTLE fronts the three live-fight boards,
 *  ARCADE fronts AIM plus the run-time boards; each lights for any of its
 *  own sub-boards. */
const TOP: Array<[string, string, (t: LeaderboardTab) => boolean]> = [
  ['BATTLE', 'lb-battle', (t) => t === 'ranked' || t === 'duo' || t === 'ffa'],
  ['XP', 'lb-xp', (t) => t === 'xp'],
  ['ARCADE', 'lb-arcade', (t) => ARCADE_SUB_TABS.includes(t)],
];
const BATTLE_SUBS: Array<[LeaderboardTab, string, string]> = [
  ['ranked', '1V1', 'lb-ranked'],
  ['duo', '2V2', 'lb-duo'],
  ['ffa', 'FFA', 'lb-ffa'],
];
const ARCADE_SUBS: Array<[LeaderboardTab, string, string]> = [
  ['training', 'AIM', 'lb-training'],
  ['gauntlet', 'SPEEDRUN', 'lb-gauntlet'], // the campaign run, named as the profile badge and stats.html name it
  ['raid', 'RAID', 'lb-raid'],
  ['goopliath', 'GOOP RAID', 'lb-goopliath'],
];
const ARCADE_SUB_TABS: LeaderboardTab[] = ARCADE_SUBS.map(([id]) => id);

function activeSubs(): Array<[LeaderboardTab, string, string]> | null {
  const t = leaderboard.tab;
  if (t === 'ranked' || t === 'duo' || t === 'ffa') return BATTLE_SUBS;
  if (ARCADE_SUB_TABS.includes(t)) return ARCADE_SUBS;
  return null;
}

function rowY0(): number {
  if (isRunTab(leaderboard.tab)) return VIEW_Y + VIEW_H + 30;
  return activeSubs() ? SUB2_Y + SUB2_H + 30 : SUB_Y + SUB_H + 30;
}

const VIEW_LABEL: Record<RunViewTier, string> = { normal: 'NORMAL', hard: 'HARD', blazing: 'BLAZING' };

/** "SEASON 2 · ENDS IN 41D 7H" — the ranked footer's countdown. */
function seasonLabel(): string {
  const idx = seasonIndex();
  const endMs = SEASON.epochUtc + idx * SEASON.lengthDays * 86_400_000;
  const left = Math.max(0, endMs - Date.now());
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  const clock = days > 0 ? `${days}D ${hours}H` : hours > 0 ? `${hours}H` : 'UNDER AN HOUR';
  return `SEASON ${idx} · ENDS IN ${clock}`;
}

/** A little procedural flame — the BLAZING mark (the profile's badges). */
export function drawFlame(g: CanvasRenderingContext2D, cx: number, baseY: number, h: number): void {
  const w = h * 0.62;
  const flame = (hh: number, ww: number, color: string): void => {
    g.beginPath();
    g.moveTo(cx, baseY);
    g.bezierCurveTo(cx - ww * 0.55, baseY - hh * 0.12, cx - ww * 0.42, baseY - hh * 0.55, cx - ww * 0.1, baseY - hh * 0.62);
    g.bezierCurveTo(cx - ww * 0.28, baseY - hh * 0.8, cx + ww * 0.02, baseY - hh * 0.9, cx + ww * 0.08, baseY - hh);
    g.bezierCurveTo(cx + ww * 0.42, baseY - hh * 0.68, cx + ww * 0.55, baseY - hh * 0.3, cx, baseY);
    g.closePath();
    g.fillStyle = color;
    g.fill();
  };
  flame(h, w, '#ff5a1f'); // the outer tongue
  flame(h * 0.55, w * 0.6, KIT.accent); // the hot core
}

/* ── the face ─────────────────────────────────────────────────────────── */

export interface LadderFace {
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

/** The LADDER tab's body + buttons (the wrap adds the tab strip). */
export function ladderFace(): LadderFace {
  if (leaderboard.tab === 'profile') return profileView();
  const buttons: PanelButton[] = [];
  const topW = (INNER - 2 * 20) / 3;
  TOP.forEach(([label, id, isActive], i) => {
    buttons.push({ id, label, x: M + i * (topW + 20), y: SUB_Y, w: topW, h: SUB_H, small: true, selected: isActive(leaderboard.tab) });
  });
  const subs = activeSubs();
  if (subs) {
    const gap = 16;
    const sw = (INNER - (subs.length - 1) * gap) / subs.length;
    subs.forEach(([tab, label, id], i) => {
      buttons.push({ id, label, x: M + i * (sw + gap), y: SUB2_Y, w: sw, h: SUB2_H, small: true, px: 24, selected: leaderboard.tab === tab });
    });
  }
  const y0 = rowY0();
  const run = isRunTab(leaderboard.tab);
  if (run) {
    // THE VIEW STRIP: one difficulty's fastest clears — and HC ONLY, which
    // narrows it to hardcore runs. The tide has no hardcore, so GOOP RAID
    // drops the toggle.
    const hcOk = leaderboard.tab !== 'goopliath';
    const gap = 12;
    const hcW = 170;
    const span = INNER - (hcOk ? hcW + gap * 2 : 0);
    const vw = (span - (RUN_VIEW_TIERS.length - 1) * gap) / RUN_VIEW_TIERS.length;
    RUN_VIEW_TIERS.forEach((t, i) => {
      buttons.push({
        id: `lb-view-${t}`,
        label: VIEW_LABEL[t],
        x: M + i * (vw + gap),
        y: VIEW_Y,
        w: vw,
        h: VIEW_H,
        small: true,
        px: 20,
        selected: leaderboard.runView.tier === t,
        tone: t === 'blazing' ? BLAZE : t === 'hard' ? KIT.accent : undefined,
      });
    });
    if (hcOk) {
      buttons.push({ id: 'lb-view-hc', label: 'HC ONLY', x: W - M - hcW, y: VIEW_Y, w: hcW, h: VIEW_H, small: true, px: 20, selected: leaderboard.runView.hc, tone: KIT.danger });
    }
  } else {
    // Data rows are ghost buttons: hit-testable, painted by the body.
    const n = Math.min(LEADERBOARD_VISIBLE_ROWS, leaderboardRows().length - boardScroll());
    for (let i = 0; i < n; i++) {
      buttons.push({ id: `lb-row-${i}`, label: '', ghost: true, x: M, y: y0 - ROW_STEP / 2 + i * ROW_STEP, w: INNER, h: ROW_STEP });
    }
  }
  return {
    buttons,
    body: (g, hover) => {
      g.textBaseline = 'middle';
      if (run) drawRunRows(g, y0);
      else drawDataRows(g, y0, hover);
    },
  };
}

function drawDataRows(g: CanvasRenderingContext2D, y0: number, hover: string | null): void {
  const rows = leaderboardRows();
  const offset = boardScroll();
  rows.slice(offset, offset + LEADERBOARD_VISIBLE_ROWS).forEach((r, i) => {
    const y = y0 + i * ROW_STEP;
    const hot = hover === `lb-row-${i}`;
    if (hot || r.me) {
      g.fillStyle = r.me ? KIT.accentFaint : KIT.plateHover;
      g.beginPath();
      g.roundRect(M, y - ROW_STEP / 2 + 3, INNER, ROW_STEP - 6, 12);
      g.fill();
    }
    g.textAlign = 'left';
    g.font = font(600, 28);
    g.fillStyle = r.me ? KIT.accent : hot ? KIT.textHi : KIT.dim;
    g.fillText(`${offset + i + 1}.`, M + 14, y);
    const tier = tierForXp(r.xp).index;
    const badge = rankBadge(tier);
    if (badge) {
      const s = 36 * rankBadgeZoom(tier);
      g.drawImage(badge, M + 96 - s / 2, y - 2 - s / 2, s, s);
    }
    g.fillStyle = r.me ? KIT.accent : hot ? KIT.textHi : KIT.text;
    g.fillText(r.name, M + 130, y, INNER - 300);
    g.textAlign = 'right';
    g.font = font(700, 28);
    g.fillText(String(r.value), W - M - 16, y);
  });
  g.textAlign = 'center';
  g.font = font(500, 24);
  if (!rows.length) {
    g.fillStyle = KIT.faint;
    g.fillText(leaderboard.status || 'no entries yet', W / 2, y0 + 4 * ROW_STEP);
  } else if (leaderboard.tab === 'ranked') {
    g.fillStyle = KIT.accentDim;
    g.fillText(`${seasonLabel()} · tap a name for their profile`, W / 2, 948);
  } else {
    g.fillStyle = KIT.faint;
    g.fillText('tap a name to open their profile', W / 2, 948);
  }
}

/** A hardcore run's mark: a red HC plate ahead of the squad. */
function drawHcPlate(g: CanvasRenderingContext2D, y: number): void {
  const h = 34;
  g.fillStyle = KIT.danger;
  g.beginPath();
  g.roundRect(HC_X, y - h / 2, HC_W, h, 10);
  g.fill();
  g.textAlign = 'center';
  g.font = font(700, 16);
  g.letterSpacing = '1.5px';
  g.fillStyle = '#1a0406';
  g.fillText('HC', HC_X + HC_W / 2, y + 1);
  g.letterSpacing = '0px';
}

function drawRunRows(g: CanvasRenderingContext2D, y0: number): void {
  const rows = runRows();
  const offset = boardScroll();
  const view = leaderboard.runView;
  rows.slice(offset, offset + LEADERBOARD_VISIBLE_ROWS).forEach((r, i) => {
    const y = y0 + i * ROW_STEP;
    // Your row wears the accent; a hardcore run a faint red wash.
    const wash = r.me ? KIT.accentFaint : r.hardcore ? 'rgba(255,82,102,0.10)' : null;
    if (wash) {
      g.fillStyle = wash;
      g.beginPath();
      g.roundRect(M, y - ROW_STEP / 2 + 3, INNER, ROW_STEP - 6, 12);
      g.fill();
    }
    g.textAlign = 'left';
    g.font = font(600, 28);
    g.fillStyle = r.me ? KIT.accent : KIT.dim;
    g.fillText(`${offset + i + 1}.`, M + 10, y);
    if (r.hardcore) drawHcPlate(g, y);
    g.textAlign = 'right';
    g.font = font(700, 28);
    g.fillStyle = r.me ? KIT.accent : KIT.textHi;
    g.fillText(fmtRunTime(r.seconds), W - M - 16, y);
    g.textAlign = 'left';
    const names = r.names.join(' · ') || '—';
    g.font = font(600, r.names.length > 2 ? 20 : 24);
    g.fillStyle = r.me ? KIT.textHi : KIT.text;
    g.fillText(names, NAMES_X, y, W - M - 150 - NAMES_X);
  });
  g.textAlign = 'center';
  g.font = font(500, 22);
  const hcOk = leaderboard.tab !== 'goopliath';
  const scope = `${view.hc && hcOk ? 'hardcore ' : ''}${view.tier} `;
  const hcNote = hcOk ? ' · HC = no healing between bosses' : '';
  if (!rows.length) {
    g.fillStyle = KIT.faint;
    g.fillText(leaderboard.status || `no ${scope}clears yet — be the first`, W / 2, y0 + 4 * ROW_STEP);
  } else {
    g.fillStyle = KIT.faint;
    g.fillText(`fastest ${scope}clears${hcNote}`, W / 2, 948, INNER);
  }
}

/* ── the profile view inside the ladder ───────────────────────────────── */

function profileView(): LadderFace {
  const row = leaderboard.viewRow ?? myProfileRow();
  const own = row.me;
  const buttons: PanelButton[] = [];
  const by = 880;
  if (own) {
    buttons.push({ id: 'rename', label: 'RENAME', x: M, y: by, w: 220, h: 84, small: true });
    buttons.push({ id: 'edit-note', label: 'WRITE NOTE', x: M + 236, y: by, w: 264, h: 84, small: true });
    buttons.push({ id: 'profile-back', label: 'BACK', x: W - M - 220, y: by, w: 220, h: 84, small: true });
  } else {
    buttons.push({ id: 'profile-back', label: 'BACK', x: W / 2 - 150, y: by, w: 300, h: 84, small: true });
  }
  for (const s of profileSpots(row, M, 132, INNER)) {
    buttons.push({ id: s.id, label: '', ghost: true, x: s.x, y: s.y, w: s.w, h: s.h });
  }
  return {
    buttons,
    body: (g, hover) => {
      drawProfileBlock(g, row, M, 132, INNER, hover);
      if (own && profileHintActive()) {
        g.textAlign = 'center';
        g.font = font(600, 22);
        g.fillStyle = KIT.info;
        g.fillText('turn around to the keyboard to write your note', W / 2, 848);
      }
    },
  };
}

/* ── THE PROFILE BLOCK (shared with the pop-out card) ─────────────────── */

/** Season-trophy chip styling, best first (matches SEASON_AWARDS order). */
const AWARD_STYLE: Record<SeasonAward, { label: string; color: string }> = {
  first: { label: '1ST', color: '#d9a832' },
  second: { label: '2ND', color: '#c8d2dc' },
  third: { label: '3RD', color: '#c97a1e' },
  top10: { label: 'TOP 10', color: KIT.accent },
  top25: { label: 'TOP 25', color: KIT.dim },
};
const AWARD_TIP: Record<SeasonAward, string> = {
  first: 'WON A RANKED SEASON',
  second: 'FINISHED A RANKED SEASON 2ND',
  third: 'FINISHED A RANKED SEASON 3RD',
  top10: 'TOP 10 RANKED SEASON FINISH',
  top25: 'TOP 25 RANKED SEASON FINISH',
};

/** One honour / achievement chip: its rect (for the hover hit) + tooltip. */
export type ProfileSpot = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tip: string;
} & (
  | { kind: 'award'; award: SeasonAward; count: number }
  | { kind: 'clear'; glyph: 'star' | 'shield' | 'drop'; tier: number; hardcore: boolean; short: string; tierName: string }
);

const CHIP_H = 40;
/** An achievement badge's width: medallion + name + tier, three across a card. */
const CLEAR_W = 164;
const LABEL_W = 190; // the section label's column, left of the chips
const BLOCK = {
  banner: 136,
  lp: 176,
  bar: 204,
  toNext: 240,
  honours: 282,
  note: 412,
  height: 520,
};

/** The chip rects for `row`'s block drawn at (x, y, w) — the SAME list
 *  drives the drawing, the ghost buttons and the tooltip. */
export function profileSpots(row: LbRow, x: number, y: number, w: number): ProfileSpot[] {
  const spots: ProfileSpot[] = [];
  const x0 = x + LABEL_W;
  let ax = x0;
  let ay = y + BLOCK.honours;
  for (const key of SEASON_AWARDS) {
    const count = row.awards?.[key] ?? 0;
    if (!count) continue;
    const label = count > 1 ? `${AWARD_STYLE[key].label} ×${count}` : AWARD_STYLE[key].label;
    const cw = 30 + label.length * 13;
    if (ax + cw > x + w) {
      ax = x0;
      ay += CHIP_H + 8;
    }
    const times = count > 1 ? ` · ×${count}` : '';
    spots.push({ kind: 'award', id: `badge-${key}`, x: ax, y: ay, w: cw, h: CHIP_H, award: key, count, tip: AWARD_TIP[key] + times });
    ax += cw + 10;
  }
  // ACHIEVEMENTS used to be a 64px chip with a bare glyph and, on blazing,
  // a flame crammed in beside it — three anonymous shapes in a row that
  // nobody could read without hovering each one. Each is a proper badge
  // now: the medallion, the feat's NAME, and the tier it was done on, on
  // one chip wide enough to say so, wrapping to a second row if the card
  // is narrow.
  const clears: Array<['star' | 'shield' | 'drop', string, string, number, number]> = [
    ['star', 'SPEEDRUN', 'SPEEDRUN CLEARED', row.gauntletBest ?? 0, row.gauntletBestHc ?? 0],
    ['shield', 'RAID', 'TITAN RAID CLEARED', row.raidBest ?? 0, row.raidBestHc ?? 0],
    ['drop', 'GOOPLIATH', 'GOOPLIATH FELLED', row.goopBest ?? 0, 0],
  ];
  let bx = x0;
  let by = ay + CHIP_H + 14;
  for (const [glyph, short, what, tier, hcTier] of clears) {
    if (!tier) continue;
    const hardcore = hcTier >= tier;
    const tierName = tier >= 3 ? 'BLAZING' : tier === 2 ? 'HARD' : 'NORMAL';
    const cw = CLEAR_W;
    if (bx + cw > x + w) {
      bx = x0;
      by += CHIP_H + 12;
    }
    spots.push({ kind: 'clear', id: `badge-${glyph}`, x: bx, y: by, w: cw, h: CHIP_H + 4, glyph, tier, hardcore, short, tierName, tip: `${what} · ${tierName}${hardcore ? ' · HARDCORE' : ''}` });
    bx += cw + 8;
  }
  return spots;
}

function drawClearGlyph(g: CanvasRenderingContext2D, kind: 'star' | 'shield' | 'drop', cx: number, cy: number, r: number, color: string): void {
  g.fillStyle = color;
  g.beginPath();
  if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? r : r * 0.44;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
  } else if (kind === 'shield') {
    g.moveTo(cx, cy - r);
    g.lineTo(cx + r * 0.85, cy - r * 0.6);
    g.lineTo(cx + r * 0.85, cy + r * 0.15);
    g.quadraticCurveTo(cx + r * 0.7, cy + r * 0.75, cx, cy + r);
    g.quadraticCurveTo(cx - r * 0.7, cy + r * 0.75, cx - r * 0.85, cy + r * 0.15);
    g.lineTo(cx - r * 0.85, cy - r * 0.6);
  } else {
    g.moveTo(cx, cy - r);
    g.quadraticCurveTo(cx + r * 0.9, cy + r * 0.05, cx + r * 0.62, cy + r * 0.5);
    g.arc(cx, cy + r * 0.28, r * 0.7, -0.35, Math.PI + 0.35);
    g.quadraticCurveTo(cx - r * 0.9, cy + r * 0.05, cx, cy - r);
  }
  g.closePath();
  g.fill();
}

function chip(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string): void {
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.beginPath();
  g.roundRect(x, y, w, h, 10);
  g.fill();
  g.lineWidth = 2;
  g.strokeStyle = color;
  g.stroke();
}

/** Draw `row`'s service record into the rect at (x, y, w): the painting
 *  behind the name, rank + XP, honours and achievements (with the hovered
 *  chip's tooltip), the note. Fixed height (`profileBlockHeight`). */
export function drawProfileBlock(g: CanvasRenderingContext2D, row: LbRow, x: number, y: number, w: number, hover: string | null): void {
  const tier = tierForXp(row.xp);
  const cx = x + w / 2;
  g.textBaseline = 'middle';

  // THE PAINTING, behind the name (docs/paint.md P4) — a dark scrim keeps
  // the name legible over hot paint; an unpainted fighter gets quiet glass.
  const banner = paintBanner(row.look, row.tone, 400, 108);
  g.save();
  g.beginPath();
  g.roundRect(x, y, w, BLOCK.banner, 16);
  g.clip();
  if (banner) {
    g.globalAlpha = 0.65;
    g.drawImage(banner, x, y, w, BLOCK.banner);
    g.globalAlpha = 1;
    g.fillStyle = 'rgba(10,8,6,0.5)';
  } else {
    g.fillStyle = KIT.well;
  }
  g.fillRect(x, y, w, BLOCK.banner);
  g.restore();
  g.beginPath();
  g.roundRect(x, y, w, BLOCK.banner, 16);
  g.lineWidth = 2;
  g.strokeStyle = KIT.line;
  g.stroke();

  // WHO
  g.textAlign = 'center';
  g.font = font(700, 48);
  g.letterSpacing = '2px';
  g.fillStyle = KIT.textHi;
  g.fillText(row.name, cx, y + 52, w - 40);
  g.letterSpacing = '0px';
  g.font = font(600, 26);
  g.fillStyle = KIT.accent;
  g.fillText(tier.name, cx, y + 100);
  const badge = rankBadge(tier.index);
  if (badge) {
    const s = 40 * rankBadgeZoom(tier.index);
    const bx = cx - g.measureText(tier.name).width / 2 - 30;
    g.drawImage(badge, bx - s / 2, y + 100 - s / 2, s, s);
  }
  g.font = font(600, 24);
  g.fillStyle = KIT.dim;
  g.fillText(`${row.score} LP    ·    ${row.xp} XP`, cx, y + BLOCK.lp);

  // HOW FAR — the XP bar toward the next rank.
  g.fillStyle = KIT.well;
  g.beginPath();
  g.roundRect(x + 20, y + BLOCK.bar, w - 40, 14, 7);
  g.fill();
  if (tier.progress > 0.01) {
    g.fillStyle = KIT.accent;
    g.beginPath();
    g.roundRect(x + 20, y + BLOCK.bar, (w - 40) * Math.min(1, tier.progress), 14, 7);
    g.fill();
  }
  g.font = font(600, 20);
  g.fillStyle = KIT.faint;
  g.fillText(tier.next === null ? 'MAX RANK' : `${tier.next - row.xp} XP TO ${tierForXp(tier.next).name}`, cx, y + BLOCK.toNext);

  // WHAT THEY'VE DONE — HONOURS chips, ACHIEVEMENTS glyphs.
  const spots = profileSpots(row, x, y, w);
  const awards = spots.filter((s) => s.kind === 'award');
  const clears = spots.filter((s) => s.kind === 'clear');
  const honoursBottom = awards.reduce((m, s) => Math.max(m, s.y), y + BLOCK.honours);
  const clearsY = clears[0]?.y ?? honoursBottom + CHIP_H + 14;
  const label = (text: string, cy: number): void => {
    g.textAlign = 'left';
    g.font = font(700, 20);
    g.letterSpacing = '2px';
    g.fillStyle = KIT.faint;
    g.fillText(text, x + 8, cy);
    g.letterSpacing = '0px';
  };
  label('HONOURS', y + BLOCK.honours + CHIP_H / 2);
  label('ACHIEVEMENTS', clearsY + CHIP_H / 2);
  const none = (cy: number): void => {
    g.textAlign = 'left';
    g.font = font(500, 22);
    g.fillStyle = KIT.disabled;
    g.fillText('none yet', x + LABEL_W, cy);
  };
  if (!awards.length) none(y + BLOCK.honours + CHIP_H / 2);
  if (!clears.length) none(clearsY + CHIP_H / 2);
  for (const s of spots) {
    if (s.kind === 'award') {
      const st = AWARD_STYLE[s.award];
      chip(g, s.x, s.y, s.w, s.h, st.color);
      g.textAlign = 'center';
      g.font = font(700, 20);
      g.fillStyle = st.color;
      g.fillText(s.count > 1 ? `${st.label} ×${s.count}` : st.label, s.x + s.w / 2, s.y + s.h / 2);
    } else {
      const color = s.hardcore ? KIT.danger : s.tier >= 3 ? BLAZE : s.tier === 2 ? KIT.accent : KIT.dim;
      chip(g, s.x, s.y, s.w, s.h, color);
      // The medallion: a dark disc with the glyph in it, so three different
      // shapes read as three badges of one kind rather than three loose marks.
      const mx = s.x + 24;
      const my = s.y + s.h / 2;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath();
      g.arc(mx, my, 16, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = color;
      g.stroke();
      drawClearGlyph(g, s.glyph, mx, my, 10, color);
      // The name, and the tier under it.
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.font = font(700, 17);
      g.letterSpacing = '1.5px';
      g.fillStyle = KIT.text;
      g.fillText(s.short, s.x + 48, my - 9, s.w - 56);
      g.font = font(600, 14);
      g.letterSpacing = '2px';
      g.fillStyle = color;
      g.fillText(s.hardcore ? `${s.tierName} · HC` : s.tierName, s.x + 48, my + 10, s.w - 56);
      g.letterSpacing = '0px';
      if (s.tier >= 3) drawFlame(g, s.x + s.w - 30, s.y + 9, 16);
    }
  }

  // The note — clipped, two lines at most.
  g.fillStyle = KIT.well;
  g.beginPath();
  g.roundRect(x, y + BLOCK.note, w, 92, 14);
  g.fill();
  g.save();
  g.beginPath();
  g.rect(x + 12, y + BLOCK.note + 6, w - 24, 80);
  g.clip();
  g.textAlign = 'center';
  g.font = font(500, 24);
  g.fillStyle = row.note ? KIT.text : KIT.disabled;
  drawNote(g, row.note || (row.me ? 'no note yet' : 'no note'), cx, y + BLOCK.note + 32, w - 48, 30);
  g.restore();

  // The hovered chip's tooltip, over everything.
  const hot = hover?.startsWith('badge-') ? spots.find((s) => s.id === hover) : undefined;
  if (hot) {
    g.font = font(600, 20);
    const tw = g.measureText(hot.tip).width + 30;
    const tx = Math.max(x, Math.min(x + w - tw, hot.x + hot.w / 2 - tw / 2));
    const ty = hot.y - 46;
    g.fillStyle = 'rgba(14,11,8,0.96)';
    g.beginPath();
    g.roundRect(tx, ty, tw, 36, 8);
    g.fill();
    g.lineWidth = 1.5;
    g.strokeStyle = KIT.accent;
    g.stroke();
    g.textAlign = 'center';
    g.fillStyle = KIT.accent;
    g.fillText(hot.tip, tx + tw / 2, ty + 18);
  }
}

/** The block's height at any width. */
export const profileBlockHeight = BLOCK.height;

/** A profile note in at most two centred lines, ellipsised if it overflows. */
function drawNote(g: CanvasRenderingContext2D, text: string, cx: number, y: number, maxW: number, lineH: number): void {
  const words = text.split(' ');
  const lines = [''];
  for (const w of words) {
    const i = lines.length - 1;
    const test = lines[i] ? `${lines[i]} ${w}` : w;
    if (g.measureText(test).width > maxW && lines[i]) {
      if (lines.length === 2) {
        let s = `${lines[1]}…`;
        while (s.length > 1 && g.measureText(s).width > maxW) s = `${s.slice(0, -2)}…`;
        lines[1] = s;
        break;
      }
      lines.push(w);
    } else {
      lines[i] = test;
    }
  }
  lines.slice(0, 2).forEach((l, i) => g.fillText(l, cx, y + i * lineH));
}
