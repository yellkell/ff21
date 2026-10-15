/**
 * The light rig — THE CROWN of laser fans round the stage rim, and the
 * confetti cannons for the podium. (The mirror ball that used to hang over
 * the stage is gone: there is no ceiling in the void for it to hang from,
 * so it floated on a rod to nowhere — and the holo board took its airspace.)
 *
 * The crown is the stage's half of the light show (lightshow.ts); the wall
 * crest (spectrum/set.ts) is the other half, and both are conducted by the
 * same cue, so the boss's beams and the wall's sweep, chase, wave, meet in
 * the tent and gather onto the record together. Eight emitters face OUT
 * from the rim and climb steeply: they used to lie across the floor at
 * chest height and read as glowing poles; now they rise round the
 * GOOPLIATH like a cage of light and clear every dancer's head.
 *
 * Perf note: no fullscreen post — the "bloom" is additive ribbons and
 * sprites over the void's black, which reads shockingly disco on a Quest.
 * The whole crown is four draws: beams, lenses, pucks, hit glints.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Vector3,
} from 'three';
import { RING, hueToColor } from '../config.js';
import { glintTexture } from '../materials/glow.js';
import { arena } from './arena.js';
import { LaserBeams, LaserFlares } from './laserBeams.js';
import { CROWN_MIN_PITCH, aimBeam, cueAt, emitterRing, newAim, newCue, type Cue } from './lightshow.js';
import { PALETTES } from './spectrum/palettes.js';

// The GOOPLIATH stands ~4.3 m at raid scale and the holo board floats over
// him; the podium's confetti bursts from above the board and rains past it.
const CONFETTI_Y = 8.4;
const CROWN_N = 8;
const CROWN_BEAMS = 3;
const BEAM_LEN = 34;
const CONFETTI = 240;

/** Platform circumradius (widest OCTAGON_VERTICES corner ≈ 0.94 m) plus a
 *  hair — the circle a beam has to land inside to count as hitting a deck. */
const DECK_R = 0.98;

// Scratch space for the beam-vs-deck pass — no per-frame allocation.
const _o = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _col = new Color();
const _aim = newAim();
const _ownCue = newCue();

/**
 * Where a light ray first lands on the show's real surfaces — any dancer
 * deck (they rise with the ranks, which is exactly when beams used to
 * skewer them) or the stage top. Returns the ray distance, or Infinity for
 * a clean miss into the void. Stage lights that STOP where they land, and
 * leave a hot pool there, are most of what separates a light rig from
 * glowing geometry.
 */
function rayHitsFloor(o: Vector3, d: Vector3, maxT: number): number {
  const a = arena();
  if (!a) return Infinity;
  let best = Infinity;
  if (Math.abs(d.y) > 1e-4) {
    // The stage top.
    const s = a.stage.position;
    const tS = (s.y + a.stageTopY - o.y) / d.y;
    if (tS > 0.05 && tS < maxT) {
      const dx = o.x + d.x * tS - s.x;
      const dz = o.z + d.z * tS - s.z;
      if (dx * dx + dz * dz < RING.stageRadius * RING.stageRadius) best = tS;
    }
    // Every dancer deck, at its CURRENT lift.
    for (const p of a.platforms) {
      const c = p.root.position;
      const t = (c.y - o.y) / d.y;
      if (t <= 0.05 || t >= maxT || t >= best) continue;
      const dx = o.x + d.x * t - c.x;
      const dz = o.z + d.z * t - c.z;
      if (dx * dx + dz * dz < DECK_R * DECK_R) best = t;
    }
  }
  return best;
}

export interface ShowFeed {
  /** The light show's moment (SpectrumSet's) — omit and the crown keeps its own. */
  cue?: Cue;
  /** Where the gather pulls the beams (the record), stage frame. */
  focus?: Vector3;
  /** The record's bass, 0..1. */
  bass?: number;
  /** 0..1: a telegraph owns MY deck — the crown lifts clear as it dims. */
  clear?: number;
}

const DEFAULT_FOCUS = new Vector3(0, 52, -78);

export class DiscoRig {
  readonly root = new Group();

  private crown = emitterRing('crown', CROWN_N, RING.stageRadius * 0.9, RING.stageHeight + 0.08);
  private beams = new LaserBeams(CROWN_N * CROWN_BEAMS, { width: 0.032, fade: 22, hot: 0.8, haze: 0.35, segments: 6 });
  private lenses = new LaserFlares(CROWN_N, 0.55);
  /** Where beams land on a deck or the stage: one Points batch. */
  private glints!: Points;
  private glintPos = new Float32Array(CROWN_N * CROWN_BEAMS * 3);
  private glintCol = new Float32Array(CROWN_N * CROWN_BEAMS * 3);
  private confetti!: Points;
  private confettiPos!: Float32Array;
  private confettiVel!: Float32Array;
  private confettiAge = 999;
  /** The record's laser colours (SpectrumSet's sleeve). */
  private colors: Color[] = PALETTES.synthwave.lasers.map((h) => new Color(h));
  private peak = new Color(0xffffff);

  /** Dress the lasers in a record's colours. */
  setPalette(colors: number[] | null): void {
    const src = colors && colors.length ? colors : PALETTES.synthwave.lasers;
    if (src.length !== this.colors.length) this.colors = src.map((h) => new Color(h));
    else src.forEach((h, i) => this.colors[i].setHex(h));
  }

  constructor() {
    this.root.name = 'disco-rig';
    this.buildCrown();
    this.buildConfetti();
  }

  private buildCrown(): void {
    this.root.add(this.beams.mesh);
    this.root.add(this.lenses.points);
    // Emitter pucks, one instanced draw: the beams grow out of real lamps.
    const pucks = new InstancedMesh(
      new CylinderGeometry(0.09, 0.12, 0.08, 8),
      new MeshStandardMaterial({ color: 0x171a20, metalness: 0.8, roughness: 0.35 }),
      CROWN_N,
    );
    const m = new Matrix4();
    for (const em of this.crown) pucks.setMatrixAt(em.i, m.makeTranslation(em.x, em.y - 0.05, em.z));
    this.root.add(pucks);
    // The hit glints: a hot spot that lives where a beam lands on a deck
    // (rank lifts put decks in the crown's way) and hides when it flies
    // clean into the void.
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.glintPos, 3));
    geo.setAttribute('color', new BufferAttribute(this.glintCol, 3));
    this.glints = new Points(
      geo,
      new PointsMaterial({
        size: 0.5,
        map: glintTexture(),
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.glints.frustumCulled = false;
    this.root.add(this.glints);
  }

  private buildConfetti(): void {
    this.confettiPos = new Float32Array(CONFETTI * 3);
    this.confettiVel = new Float32Array(CONFETTI * 3);
    const colors = new Float32Array(CONFETTI * 3);
    const c = new Color();
    for (let i = 0; i < CONFETTI; i++) {
      c.setHex(hueToColor((i / CONFETTI) * 1.0, 0.62));
      colors[i * 3] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;
      this.confettiPos[i * 3 + 1] = -50; // parked out of sight
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.confettiPos, 3));
    geo.setAttribute('color', new BufferAttribute(colors, 3));
    // Neon glints, not paper: an unmapped Points material renders literal
    // SQUARES, and squares raining onto the floor read as sprite litter.
    // The lens-glint texture + additive blending turns the same cloud into
    // a sparkler burst that belongs to the light show.
    this.confetti = new Points(
      geo,
      new PointsMaterial({
        size: 0.09,
        map: glintTexture(),
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.confetti.frustumCulled = false;
    this.root.add(this.confetti);
  }

  /** Fire the cannons (podium). Bursts from the stage centre, high. */
  popConfetti(): void {
    this.confettiAge = 0;
    for (let i = 0; i < CONFETTI; i++) {
      this.confettiPos[i * 3] = (Math.random() - 0.5) * 0.6;
      this.confettiPos[i * 3 + 1] = CONFETTI_Y;
      this.confettiPos[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * 2.0;
      this.confettiVel[i * 3] = Math.sin(a) * r;
      this.confettiVel[i * 3 + 1] = 0.6 + Math.random() * 1.6;
      this.confettiVel[i * 3 + 2] = Math.cos(a) * r;
    }
  }

  /**
   * Drive the rig. `beat` is the continuous show beat (negative pre-drop),
   * `act` the musical intensity 0..3, `energy` 0..1 (pre-ducked). `feed`
   * carries the light show from the set's world so the two rigs are one.
   */
  update(dt: number, beat: number, act: number, energy: number, feed: ShowFeed = {}): void {
    const cue = feed.cue ?? cueAt(_ownCue, beat, act);
    const focus = feed.focus ?? DEFAULT_FOCUS;
    const pump = Math.max(cue.kick, feed.bass ?? 0);
    const clear = feed.clear ?? 0;

    // ── THE CROWN ─────────────────────────────────────────────────────
    // Fresh world matrices (the root follows the sinking stage), then aim
    // every beam off the cue and clip it against the decks and the stage:
    // a beam that meets a deck STOPS there and leaves a hot spot.
    this.root.updateMatrixWorld(true);
    const rootPos = this.root.position;
    // While a telegraph owns my deck the crown stands up straight, out of
    // the way, as it dims.
    const lift = clear * 0.45;
    for (const em of this.crown) {
      _o.set(em.x, em.y, em.z);
      let lens = 0;
      for (let b = 0; b < CROWN_BEAMS; b++) {
        const i = em.i * CROWN_BEAMS + b;
        aimBeam(cue, em, b, CROWN_BEAMS, focus, _aim);
        _d.set(_aim.dx, _aim.dy, _aim.dz);
        if (lift > 0) {
          const h = Math.hypot(_d.x, _d.z);
          const p = Math.min(1.52, Math.max(CROWN_MIN_PITCH + lift, Math.atan2(_d.y, h)));
          const k = h > 1e-6 ? Math.cos(p) / h : 0;
          _d.set(_d.x * k, Math.sin(p), _d.z * k);
        }
        const c = this.colorFor(_aim.slot, cue.hit);
        const g = _aim.gain * (0.5 + 0.5 * pump);
        // The ray test runs in world space.
        _p.copy(_o).add(rootPos);
        const t = rayHitsFloor(_p, _d, BEAM_LEN);
        const len = t < Infinity ? t : BEAM_LEN;
        this.beams.set(i, _o, _d, len, c, g);
        if (t < Infinity && g * energy > 0.02) {
          this.glintPos[i * 3] = _o.x + _d.x * t;
          this.glintPos[i * 3 + 1] = _o.y + _d.y * t + 0.02;
          this.glintPos[i * 3 + 2] = _o.z + _d.z * t;
          const k = g * energy * (0.6 + pump * 0.4);
          this.glintCol[i * 3] = c.r * k;
          this.glintCol[i * 3 + 1] = c.g * k;
          this.glintCol[i * 3 + 2] = c.b * k;
        } else {
          this.glintPos[i * 3 + 1] = -50;
          this.glintCol.fill(0, i * 3, i * 3 + 3);
        }
        lens = Math.max(lens, g);
      }
      this.lenses.set(em.i, _o, _col, Math.min(1.6, lens) * energy);
    }
    this.beams.gain = energy * 0.75;
    this.beams.commit(dt);
    this.lenses.commit();
    (this.glints.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (this.glints.geometry.getAttribute('color') as BufferAttribute).needsUpdate = true;

    // Confetti physics.
    if (this.confettiAge < 6) {
      this.confettiAge += dt;
      const pos = this.confettiPos;
      const vel = this.confettiVel;
      for (let i = 0; i < CONFETTI; i++) {
        if (pos[i * 3 + 1] <= -40) continue; // already burnt out
        vel[i * 3 + 1] -= dt * 1.6; // light gravity — it flutters, not falls
        vel[i * 3] *= 1 - dt * 0.4;
        vel[i * 3 + 2] *= 1 - dt * 0.4;
        pos[i * 3] += vel[i * 3] * dt;
        const ny = pos[i * 3 + 1] + vel[i * 3 + 1] * dt;
        // A glint that reaches the floor winks out — the shower never
        // becomes litter lying on the glass.
        pos[i * 3 + 1] = ny <= 0.05 ? -50 : ny;
        pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      }
      (this.confetti.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
    }
  }

  /** The sleeve's colour for a slot, whitened by the phrase's hit. */
  private colorFor(slot: number, hit: number): Color {
    const n = this.colors.length;
    _col.copy(this.colors[((slot % n) + n) % n]);
    return hit > 0.01 ? _col.lerp(this.peak, hit * 0.55) : _col;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as MeshBasicMaterial | undefined;
      mat?.dispose?.();
    });
  }
}
