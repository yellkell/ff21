/**
 * SUPER OCTAGON — a light-gun wave shooter on a CRT, ported whole from
 * FIRE FIGHT's pub cabinet (OCTA HUNT) and re-dressed in house neon:
 * octagons drift across the glass, you shoot them with the controller
 * laser, streaks build a multiplier, three get past you and the night's
 * over.
 *
 *  - AIM: each hand's laser on the glass is a crosshair (right hand wins
 *    the drawn one when both are on it).
 *  - FIRE: trigger. The nearest octagon within its radius + a little
 *    forgiveness dies; a clean miss breaks the streak.
 *  - SCORE: kind points × streak multiplier (×1..×4, stepping every 4).
 *  - RAMP: speed climbs and the spawn interval tightens with score.
 */

import * as sfx from '../../audio/sfx.js';
import { font } from '../../ui/fonts.js';
import { ARCADE_TITLES, arcadeBook, SCREEN_H as H, SCREEN_W as W, type ArcadeCabinet } from '../arcade.js';
import { HANDS, type CabinetGame, type Phase, type Pointers } from './game.js';

/** Aim forgiveness (px) — arcade guns are generous or they're miserable. */
const FORGIVE = 5;
const START_LIVES = 3;

/** The octagons. Points follow FIRE FIGHT's tuning; the palette is ours. */
const KINDS = [
  { r: 19, speed: 66, points: 10, color: '#ff2ad5', spin: 0.9 }, // OCTA
  { r: 12, speed: 124, points: 25, color: '#4fb7ff', spin: 1.7 }, // PIP
  { r: 27, speed: 40, points: 5, color: '#ffd24a', spin: 0.5 }, // TANK
] as const;
const SPAWN_BAG = [0, 0, 0, 0, 1, 1, 2];

interface Target {
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  /** True once it has fully entered the glass — leaving after that costs. */
  entered: boolean;
}

export class OctagonGame implements CabinetGame {
  readonly id = 'octagon' as const;
  phase: Phase = 'attract';
  score = 0;
  private targets: Target[] = [];
  private combo = 0;
  private lives = START_LIVES;
  private spawnT = 0;
  private muzzle = 0;
  private cross: [number, number] | null = null;
  private readonly g: CanvasRenderingContext2D;

  constructor(readonly cab: ArcadeCabinet) {
    this.g = cab.screenCanvas.getContext('2d')!;
  }

  start(): void {
    this.targets = [];
    this.score = 0;
    this.combo = 0;
    this.lives = START_LIVES;
    this.spawnT = 0.4;
    this.muzzle = 0;
    sfx.uiClick();
  }

  ended(): void {
    sfx.huntOver();
  }

  step(delta: number, hands: Pointers): boolean {
    this.cross = hands.right.at ?? hands.left.at;
    if (this.move(delta)) return true;
    this.fire(hands);
    return false;
  }

  /** Advance the wave; true when the last life just went. */
  private move(delta: number): boolean {
    // Difficulty rides the score, exactly the pub cabinet's curve.
    const speedK = 1 + Math.min(1.1, this.score / 4000);
    const interval = Math.max(0.45, 1.35 - this.score / 1800);

    this.spawnT -= delta;
    if (this.spawnT <= 0) {
      this.spawnT = interval;
      this.spawn();
    }

    this.muzzle = Math.max(0, this.muzzle - delta);

    for (let i = this.targets.length - 1; i >= 0; i--) {
      const t = this.targets[i];
      t.x += t.vx * speedK * delta;
      t.y += t.vy * speedK * delta;
      t.rot += KINDS[t.kind].spin * delta;
      const r = KINDS[t.kind].r;
      const inside = t.x > -r && t.x < W + r && t.y > -r && t.y < H + r;
      if (!t.entered && t.x > r * 0.5 && t.x < W - r * 0.5 && t.y > r * 0.5 && t.y < H - r * 0.5) {
        t.entered = true;
      }
      if (!inside && t.entered) {
        // Fully through the glass — a life gone, the streak with it.
        this.targets.splice(i, 1);
        this.lives -= 1;
        this.combo = 0;
        sfx.huntEscape();
        if (this.lives <= 0) return true;
      } else if (!inside && (t.vx === 0 || t.x < -r * 3 || t.x > W + r * 3 || t.y < -r * 3 || t.y > H + r * 3)) {
        this.targets.splice(i, 1); // never made it on — cull quietly
      }
    }
    return false;
  }

  private spawn(): void {
    const kind = SPAWN_BAG[Math.floor(Math.random() * SPAWN_BAG.length)];
    const r = KINDS[kind].r;
    // Off a random edge, aimed at a random interior point.
    const edge = Math.floor(Math.random() * 4);
    const x = edge === 0 ? -r : edge === 1 ? W + r : Math.random() * W;
    const y = edge === 2 ? -r : edge === 3 ? H + r : Math.random() * H;
    const tx = W * (0.2 + Math.random() * 0.6);
    const ty = H * (0.2 + Math.random() * 0.6);
    const len = Math.hypot(tx - x, ty - y) || 1;
    const s = KINDS[kind].speed;
    this.targets.push({
      kind,
      x,
      y,
      vx: ((tx - x) / len) * s,
      vy: ((ty - y) / len) * s,
      rot: Math.random() * Math.PI,
      entered: false,
    });
  }

  private fire(hands: Pointers): void {
    for (const hand of HANDS) {
      const { at, down } = hands[hand];
      if (!at || !down) continue;
      sfx.huntShot();
      this.muzzle = 0.06;
      // Kill the nearest octagon whose body is under the shot.
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < this.targets.length; i++) {
        const t = this.targets[i];
        const dd = (t.x - at[0]) ** 2 + (t.y - at[1]) ** 2;
        const reach = KINDS[t.kind].r + FORGIVE;
        if (dd <= reach * reach && dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
      if (best >= 0) {
        const t = this.targets.splice(best, 1)[0];
        this.combo += 1;
        const mult = Math.min(4, 1 + Math.floor((this.combo - 1) / 4));
        this.score += KINDS[t.kind].points * mult;
        sfx.huntHit();
      } else {
        this.combo = 0; // a clean miss breaks the streak
      }
    }
  }

  /* ── the CRT ──────────────────────────────────────────────────────────── */

  paint(clock: number): void {
    const g = this.g;

    // Shell: near-black glass, a faint grid, scanlines.
    g.fillStyle = '#08060e';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,42,213,0.07)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 0; x <= W; x += 32) {
      g.moveTo(x, 0);
      g.lineTo(x, H);
    }
    for (let y = 0; y <= H; y += 32) {
      g.moveTo(0, y);
      g.lineTo(W, y);
    }
    g.stroke();

    if (this.phase === 'attract') {
      const pulse = 0.7 + Math.sin(clock * 2.2) * 0.3;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = '#ffd9f6';
      g.shadowColor = '#ff2ad5';
      g.shadowBlur = 14;
      g.font = font(700, 38);
      g.fillText('SUPER', W / 2, 92);
      g.fillText('OCTAGON', W / 2, 136);
      g.shadowBlur = 0;
      g.font = font(600, 17);
      g.fillStyle = `rgba(233,236,244,${(0.35 + 0.35 * pulse).toFixed(2)})`;
      g.fillText('STEP UP · PULL THE TRIGGER', W / 2, 190);
      const top = arcadeBook('octagon')[0];
      g.font = font(600, 15);
      g.fillStyle = 'rgba(233,236,244,0.4)';
      g.fillText(top ? `HOUSE BEST ${top.s.toLocaleString('en-US')} · ${top.n}` : 'NO SCORES YET — BE FIRST', W / 2, 218);
      this.cab.screenTex.needsUpdate = true;
      return;
    }

    // Targets.
    for (const t of this.targets) {
      const k = KINDS[t.kind];
      this.octagon(t.x, t.y, k.r, t.rot, k.color);
    }

    // HUD strip.
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.font = font(700, 20);
    g.fillStyle = '#f2f3f7';
    g.fillText(this.score.toLocaleString('en-US'), 10, 16);
    const mult = Math.min(4, 1 + Math.floor(Math.max(0, this.combo - 1) / 4));
    if (mult > 1) {
      g.font = font(600, 15);
      g.fillStyle = '#ffb454';
      g.fillText(`×${mult}`, 10, 38);
    }
    g.textAlign = 'right';
    g.font = font(700, 18);
    g.fillStyle = '#ff5266';
    g.fillText('♥'.repeat(Math.max(0, this.lives)), W - 10, 16);

    // Crosshair + muzzle flash.
    if (this.cross) {
      const [cx, cy] = this.cross;
      g.strokeStyle = this.muzzle > 0 ? '#ffffff' : 'rgba(255,42,213,0.9)';
      g.lineWidth = this.muzzle > 0 ? 3 : 2;
      g.beginPath();
      g.arc(cx, cy, this.muzzle > 0 ? 10 : 7, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.moveTo(cx - 14, cy);
      g.lineTo(cx - 4, cy);
      g.moveTo(cx + 4, cy);
      g.lineTo(cx + 14, cy);
      g.moveTo(cx, cy - 14);
      g.lineTo(cx, cy - 4);
      g.moveTo(cx, cy + 4);
      g.lineTo(cx, cy + 14);
      g.stroke();
    }

    if (this.phase === 'dead') {
      g.fillStyle = 'rgba(6,4,10,0.72)';
      g.fillRect(0, 0, W, H);
      g.textAlign = 'center';
      g.font = font(700, 34);
      g.fillStyle = '#ff5266';
      g.fillText('GAME OVER', W / 2, 116);
      g.font = font(700, 24);
      g.fillStyle = '#f2f3f7';
      g.fillText(this.score.toLocaleString('en-US'), W / 2, 156);
      g.font = font(600, 15);
      g.fillStyle = 'rgba(233,236,244,0.6)';
      g.fillText(`GRADE ${ARCADE_TITLES.octagon.grade(this.score)}`, W / 2, 186);
    }

    this.cab.screenTex.needsUpdate = true;
  }

  private octagon(x: number, y: number, r: number, rot: number, color: string): void {
    const g = this.g;
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = rot + (i / 8) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.closePath();
    g.fillStyle = 'rgba(10,8,18,0.85)';
    g.fill();
    g.strokeStyle = color;
    g.lineWidth = 2.5;
    g.stroke();
    // The core pip.
    g.beginPath();
    g.arc(x, y, Math.max(2, r * 0.22), 0, Math.PI * 2);
    g.fillStyle = color;
    g.fill();
  }
}
