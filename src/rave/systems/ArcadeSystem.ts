/**
 * ArcadeSystem — SUPER OCTAGON, the cabinet in the club's arcade room.
 *
 * A light-gun wave shooter on a CRT, ported whole from FIRE FIGHT's pub
 * cabinet (OCTA HUNT) and re-dressed in house neon: octagons drift across
 * the glass, you shoot them with the controller laser, streaks build a
 * multiplier, three get past you and the night's over.
 *
 *  - AIM: each hand's ray, raycast onto the screen plane; the hit UV is
 *    the crosshair (right hand wins when both are on the glass).
 *  - FIRE: trigger. The nearest octagon within its radius + a little
 *    forgiveness dies; a clean miss breaks the streak.
 *  - SCORE: kind points × streak multiplier (×1..×4, stepping every 4).
 *  - RAMP: speed climbs and the spawn interval tightens with score.
 *
 * The wall board rides both ledgers: local top-8 in this headset, and the
 * world board as pseudo-chart 'superoctagon' (same Firestore collection,
 * same fail-soft rules as the songs — offline it just shows the house
 * list). One player at a time, gated by standing at the cabinet; other
 * dancers see the attract screen (a spectator stream needs relay verbs the
 * wire doesn't carry yet — honest limitation, not an accident).
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Raycaster, Vector3 } from 'three';
import * as sfx from '../audio/sfx.js';
import {
  arcadeRefs,
  octagonBook,
  octagonGrade,
  OCTAGON_TRACK,
  recordOctagonRun,
} from '../club/arcade.js';
import { profileName } from '../game/profile.js';
import { match } from '../game/state.js';
import { course } from '../course/state.js';
import { refreshWorldBoard, scores, submitWorldScore, worldBoard } from '../net/scores.js';
import { inRoom } from '../net/session.js';
import { font } from '../ui/fonts.js';
import { UI } from '../ui/panel.js';

const W = 384;
const H = 300;
const HANDS = ['left', 'right'] as const;

/** Aim forgiveness (px) — arcade guns are generous or they're miserable. */
const FORGIVE = 5;
const START_LIVES = 3;
/** GAME OVER lingers this long, then the cabinet frees itself. */
const DEAD_HOLD = 3.6;
/** Stand-close gate: the cabinet is yours while you're at it. */
const REACH = 1.7;
/** Wander this far mid-game and you've walked away from the machine. */
const ABANDON = 2.6;

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

type Phase = 'attract' | 'playing' | 'dead';

export class ArcadeSystem extends createSystem({}) {
  private ray = new Raycaster();
  private phase: Phase = 'attract';
  private targets: Target[] = [];
  private score = 0;
  private combo = 0;
  private lives = START_LIVES;
  private spawnT = 0;
  private deadT = 0;
  private muzzle = 0;
  private clock = 0;
  private attractT = 0;
  private aim: Partial<Record<'left' | 'right', [number, number]>> = {};
  private cross: [number, number] | null = null;
  private lastBoardKey = '';
  private lastScoresDirty = -1;

  update(delta: number): void {
    const refs = arcadeRefs();
    if (!refs) return;
    const inClub =
      (match.screen === 'lobby' || match.screen === 'tour') &&
      inRoom() &&
      !course.active;
    if (!inClub) {
      // The club packed away mid-game (a set booked the floor): the run
      // ends quietly and the score still counts — you danced, it happened.
      if (this.phase === 'playing') this.finishRun(false);
      this.phase = 'attract';
      return;
    }

    this.clock += delta;
    this.readAim(refs.screen);

    const head = this.camera;
    head.getWorldPosition(_head);
    const near = _head.distanceTo(refs.cabinetPos) <= REACH + 1.0; // cabinetPos is at the floor

    if (this.phase === 'attract') {
      // Step up, aim at the glass, pull the trigger.
      if (near && this.cross) {
        for (const hand of HANDS) {
          if (this.aim[hand] && this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
            this.startRun();
            break;
          }
        }
      }
      this.attractT += delta;
      if (this.attractT >= 0.5) {
        this.attractT = 0;
        this.paintScreen();
      }
    } else if (this.phase === 'playing') {
      if (_head.distanceTo(refs.cabinetPos) > ABANDON) {
        // Walked away mid-wave — the run ends and posts what it earned.
        this.finishRun(true);
      } else {
        this.stepGame(delta);
        this.fire();
        this.paintScreen();
      }
    } else {
      // dead: hold the score card, then free the machine.
      this.deadT += delta;
      if (this.deadT >= DEAD_HOLD) {
        this.phase = 'attract';
        this.paintScreen();
      } else if (Math.floor(this.deadT * 8) !== Math.floor((this.deadT - delta) * 8)) {
        this.paintScreen(); // blink cadence
      }
    }

    this.paintBoardIfChanged();
  }

  /* ── the run ──────────────────────────────────────────────────────────── */

  private startRun(): void {
    this.phase = 'playing';
    this.targets = [];
    this.score = 0;
    this.combo = 0;
    this.lives = START_LIVES;
    this.spawnT = 0.4;
    sfx.uiClick();
  }

  private finishRun(over: boolean): void {
    const score = this.score;
    if (score > 0) {
      recordOctagonRun(score, profileName());
      void submitWorldScore(OCTAGON_TRACK, 0, score, octagonGrade(score), profileName());
      refreshWorldBoard(OCTAGON_TRACK, 0);
      this.lastBoardKey = ''; // repaint the wall
    }
    if (over) {
      this.phase = 'dead';
      this.deadT = 0;
      sfx.huntOver();
      this.paintScreen();
    }
  }

  private stepGame(delta: number): void {
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
        if (this.lives <= 0) {
          this.finishRun(true);
          return;
        }
      } else if (!inside && (t.vx === 0 || (t.x < -r * 3 || t.x > W + r * 3 || t.y < -r * 3 || t.y > H + r * 3))) {
        this.targets.splice(i, 1); // never made it on — cull quietly
      }
    }
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

  /* ── aim + fire (the pub cabinet's exact mechanism) ───────────────────── */

  private readAim(screen: import('three').Mesh): void {
    this.aim = {};
    let cross: [number, number] | null = null;
    for (const hand of HANDS) {
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!rayObj) continue;
      rayObj.getWorldPosition(_o);
      rayObj.getWorldDirection(_d).negate();
      this.ray.set(_o, _d);
      this.ray.far = 6;
      const hit = this.ray.intersectObject(screen, false)[0];
      if (!hit || !hit.uv) continue;
      const sx = hit.uv.x * W;
      const sy = (1 - hit.uv.y) * H;
      this.aim[hand] = [sx, sy];
      // Right hand wins the crosshair if both are on the glass.
      if (!cross || hand === 'right') cross = [sx, sy];
    }
    this.cross = cross;
  }

  private fire(): void {
    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      const at = this.aim[hand];
      if (!at || !gp?.getButtonDown(InputComponent.Trigger)) continue;
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

  private paintScreen(): void {
    const refs = arcadeRefs();
    if (!refs) return;
    const g = refs.screenCanvas.getContext('2d')!;

    // Shell: near-black glass, a faint grid, scanlines.
    g.fillStyle = '#08060e';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(255,42,213,0.07)';
    g.lineWidth = 1;
    for (let x = 0; x <= W; x += 32) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, H);
      g.stroke();
    }
    for (let y = 0; y <= H; y += 32) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(W, y);
      g.stroke();
    }

    if (this.phase === 'attract') {
      const pulse = 0.7 + Math.sin(this.clock * 2.2) * 0.3;
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
      const top = octagonBook()[0];
      g.font = font(600, 15);
      g.fillStyle = 'rgba(233,236,244,0.4)';
      g.fillText(top ? `HOUSE BEST ${top.s.toLocaleString('en-US')} · ${top.n}` : 'NO SCORES YET — BE FIRST', W / 2, 218);
      refs.screenTex.needsUpdate = true;
      return;
    }

    // Targets.
    for (const t of this.targets) {
      const k = KINDS[t.kind];
      this.octagon(g, t.x, t.y, k.r, t.rot, k.color);
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
      g.fillText(`GRADE ${octagonGrade(this.score)}`, W / 2, 186);
    }

    refs.screenTex.needsUpdate = true;
  }

  private octagon(g: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, color: string): void {
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

  /* ── the wall board ───────────────────────────────────────────────────── */

  private paintBoardIfChanged(): void {
    const refs = arcadeRefs();
    if (!refs) return;
    if (scores.dirty !== this.lastScoresDirty) {
      this.lastScoresDirty = scores.dirty;
      this.lastBoardKey = '';
    }
    const world = worldBoard(OCTAGON_TRACK, 0);
    const local = octagonBook();
    const rows =
      world.state === 'ready' && world.rows.length
        ? world.rows.map((r) => ({ s: r.score, n: r.name, me: r.isMe }))
        : local.map((r) => ({ s: r.s, n: r.n, me: false }));
    const source = world.state === 'ready' && world.rows.length ? 'worldwide' : 'this headset';
    const key = `${source}|${rows.map((r) => `${r.n}:${r.s}${r.me ? '*' : ''}`).join(',')}`;
    if (key === this.lastBoardKey) return;
    this.lastBoardKey = key;

    const g = refs.boardCanvas.getContext('2d')!;
    const BW = refs.boardCanvas.width;
    const BH = refs.boardCanvas.height;
    g.clearRect(0, 0, BW, BH);
    g.fillStyle = 'rgba(13,10,18,0.92)';
    g.beginPath();
    g.roundRect(4, 4, BW - 8, BH - 8, 18);
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = 'rgba(255,42,213,0.45)';
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd9f6';
    g.shadowColor = '#ff2ad5';
    g.shadowBlur = 10;
    g.font = font(700, 44);
    g.fillText('SUPER OCTAGON', BW / 2, 58, BW - 48);
    g.shadowBlur = 0;
    g.font = font(600, 20);
    g.letterSpacing = '3px';
    g.fillStyle = 'rgba(233,236,244,0.5)';
    g.fillText('HIGH SCORES', BW / 2, 102);
    g.letterSpacing = '0px';
    g.fillStyle = UI.lineFaint;
    g.fillRect(36, 126, BW - 72, 2);

    if (!rows.length) {
      g.font = font(500, 24);
      g.fillStyle = 'rgba(233,236,244,0.55)';
      g.fillText('no scores yet', BW / 2, 200);
      g.font = font(500, 19);
      g.fillStyle = 'rgba(233,236,244,0.35)';
      g.fillText('the first name up is yours', BW / 2, 236);
    } else {
      rows.slice(0, 8).forEach((row, i) => {
        const y = 170 + i * 62;
        if (row.me) {
          g.fillStyle = 'rgba(255,42,213,0.12)';
          g.beginPath();
          g.roundRect(24, y - 24, BW - 48, 50, 10);
          g.fill();
        }
        g.textAlign = 'right';
        g.font = font(600, 22);
        g.fillStyle = 'rgba(233,236,244,0.4)';
        g.fillText(String(i + 1), 58, y);
        g.textAlign = 'left';
        g.font = font(600, 26);
        g.fillStyle = row.me ? '#ffffff' : '#f2f3f7';
        g.fillText(row.n || 'RAVER', 78, y, 250);
        g.textAlign = 'right';
        g.font = font(700, 28);
        g.fillStyle = row.me ? '#ffffff' : '#f2f3f7';
        g.fillText(row.s.toLocaleString('en-US'), BW - 40, y);
      });
    }

    g.textAlign = 'left';
    g.font = font(500, 17);
    g.fillStyle = 'rgba(233,236,244,0.35)';
    g.fillText(`solo runs · ${source}`, 36, BH - 34);

    refs.boardTex.needsUpdate = true;
  }
}

const _head = new Vector3();
const _o = new Vector3();
const _d = new Vector3();
