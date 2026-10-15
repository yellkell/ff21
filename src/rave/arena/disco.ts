/**
 * The light rig — an absolute disco 🪩: the mirror ball over the stage, the
 * sweeping shafts it throws, four laser fans on the stage rim, and the
 * confetti cannons for the podium. Everything additive, everything cheap,
 * everything moving ON THE BEAT (DiscoSystem feeds the song clock in).
 *
 * Perf note: no fullscreen post — the "bloom" is additive sprites and
 * cones over the void's black, which reads shockingly disco on a Quest.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  Sprite,
  Vector3,
} from 'three';
import { LASER_HUES, PALETTE, RING, hueToColor } from '../config.js';
import { beamGradientTexture, glintTexture, glowSprite, glowTexture } from '../materials/glow.js';
import { arena } from './arena.js';

// The GOOPLIATH stands ~4.3 m at raid scale — the ball hangs clear above
// him, and the holo board slots between the two.
const BALL_Y = 7.2;
const SHAFTS = 6;
const FANS = 4;
const BEAMS_PER_FAN = 5;
const BEAM_LEN = 15;
const CONFETTI = 240;

/** Platform circumradius (widest OCTAGON_VERTICES corner ≈ 0.94 m) plus a
 *  hair — the circle a beam has to land inside to count as hitting a deck. */
const DECK_R = 0.98;

// Scratch space for the beam-vs-deck pass — no per-frame allocation.
const _o = new Vector3();
const _d = new Vector3();

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

export class DiscoRig {
  readonly root = new Group();

  private ball!: Group;
  private shaftMats: MeshBasicMaterial[] = [];
  private shafts: { cone: Mesh; mat: MeshBasicMaterial; pool: Mesh; poolMat: MeshBasicMaterial; len: number }[] = [];
  private fans: { pivot: Group; mat: MeshBasicMaterial; phase: number }[] = [];
  private beams: { mesh: Mesh; glint: Sprite; fan: number }[] = [];
  private confetti!: Points;
  private confettiPos!: Float32Array;
  private confettiVel!: Float32Array;
  private confettiAge = 999;
  private hueCursor = 0;
  /** The record's laser colours (SpectrumSet's sleeve); null = the hue wheel. */
  private palette: number[] | null = null;

  /** Dress the lasers in a record's colours (taken on the next bar). */
  setPalette(colors: number[] | null): void {
    this.palette = colors && colors.length ? colors : null;
  }
  private lastBar = -1;

  constructor() {
    this.root.name = 'disco-rig';
    this.buildBall();
    this.buildFans();
    this.buildConfetti();
  }

  private buildBall(): void {
    this.ball = new Group();
    this.ball.position.y = BALL_Y;

    // Faceted mirror ball. There is no env map to reflect, so the
    // facets are painted on: a bright checker texture over a flat-shaded
    // sphere reads as glitter from across the room (and never goes black).
    const facets = document.createElement('canvas');
    facets.width = facets.height = 128;
    const fg = facets.getContext('2d')!;
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const glint = Math.random();
        const l = glint > 0.86 ? 96 : 52 + Math.floor(glint * 28);
        fg.fillStyle = `hsl(${210 + glint * 40}, 18%, ${l}%)`;
        fg.fillRect(x * 8, y * 8, 7, 7);
      }
    }
    const ballTex = new CanvasTexture(facets);
    const ball = new Mesh(
      new SphereGeometry(0.55, 18, 12),
      new MeshBasicMaterial({ map: ballTex, color: PALETTE.mirror }),
    );
    this.ball.add(ball);
    const rod = new Mesh(
      new CylinderGeometry(0.02, 0.02, 2.2, 6),
      new MeshStandardMaterial({ color: 0x22262e, metalness: 0.8, roughness: 0.4 }),
    );
    rod.position.y = 1.55;
    this.ball.add(rod);
    this.ball.add(glowSprite(0xffffff, 1.7, 0.5));

    // The speckle sweep: additive cones hanging off the ball at odd angles —
    // as the ball turns they rake the room like mirror glints. Each cone
    // wears the beam gradient (bright at the ball, dissolving down its
    // length) so it reads as light through haze instead of a solid lamp
    // shade, and each carries a POOL — a soft splash of light it leaves on
    // whatever deck it is currently raking (see update).
    for (let i = 0; i < SHAFTS; i++) {
      const mat = new MeshBasicMaterial({
        color: 0xffffff,
        map: beamGradientTexture(true), // apex (the ball) is the bright end
        transparent: true,
        opacity: 0.14,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
      });
      // Long enough to actually rake the floor from the ball's height —
      // short cones read as stubby lampshades, not spotlight beams.
      const len = 12 + (i % 3) * 3;
      const geo = new ConeGeometry(0.5 + (i % 2) * 0.35, len, 10, 1, true);
      // Apex at the mesh origin, body hanging down — so clipping the cone
      // against a deck is just scale.y, pivoting at the ball.
      geo.translate(0, -len / 2, 0);
      const cone = new Mesh(geo, mat);
      const hanger = new Group();
      hanger.rotation.z = 0.5 + (i / SHAFTS) * 0.9;
      hanger.rotation.y = (i / SHAFTS) * Math.PI * 2;
      hanger.add(cone);
      this.ball.add(hanger);
      this.shaftMats.push(mat);

      const poolMat = new MeshBasicMaterial({
        map: glowTexture(),
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const pool = new Mesh(new PlaneGeometry(1, 1), poolMat);
      pool.rotation.x = -Math.PI / 2;
      pool.visible = false;
      this.root.add(pool);
      this.shafts.push({ cone, mat, pool, poolMat, len });
    }
    this.root.add(this.ball);
  }

  private buildFans(): void {
    // One shared beam: anchored at the emitter (so scale.y clips its far
    // end), tapering slightly as it travels, alpha ramping to nothing —
    // a laser through haze, not a fifteen-metre glowing rod.
    const beamGeo = new CylinderGeometry(0.05, 0.016, BEAM_LEN, 6, 1, true);
    beamGeo.translate(0, BEAM_LEN / 2, 0);

    for (let i = 0; i < FANS; i++) {
      const pivot = new Group();
      const around = (i / FANS) * Math.PI * 2 + Math.PI / FANS;
      pivot.position.set(
        Math.sin(around) * RING.stageRadius * 0.9,
        RING.stageHeight + 0.1,
        Math.cos(around) * RING.stageRadius * 0.9,
      );
      const mat = new MeshBasicMaterial({
        color: hueToColor(LASER_HUES[i % LASER_HUES.length], 0.6),
        map: beamGradientTexture(false), // bright at the emitter
        transparent: true,
        opacity: 0.65,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      for (let b = 0; b < BEAMS_PER_FAN; b++) {
        const beam = new Mesh(beamGeo, mat);
        beam.rotation.x = Math.PI / 2 - 0.22; // tipped up-and-out over the ring
        beam.rotation.y = (b - (BEAMS_PER_FAN - 1) / 2) * 0.14;
        pivot.add(beam);

        // The hit glint: a hot spot that lives where this beam lands on a
        // deck (rank lifts put decks in the fans' way constantly) and hides
        // when the beam flies clean into the void.
        const glint = glowSprite(0xffffff, 0.4, 0.9);
        glint.visible = false;
        this.root.add(glint);
        this.beams.push({ mesh: beam, glint, fan: i });
      }
      // Emitter puck + lens so the beams grow out of a hot lamp.
      const puck = new Mesh(
        new CylinderGeometry(0.09, 0.12, 0.08, 8),
        new MeshStandardMaterial({ color: 0x171a20, metalness: 0.8, roughness: 0.35 }),
      );
      pivot.add(puck);
      const lens = glowSprite(0xffffff, 0.26, 0.8);
      lens.position.y = 0.06;
      pivot.add(lens);
      this.root.add(pivot);
      this.fans.push({ pivot, mat, phase: (i / FANS) * Math.PI * 2 });
    }
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
      this.confettiPos[i * 3 + 1] = BALL_Y - 0.6;
      this.confettiPos[i * 3 + 2] = (Math.random() - 0.5) * 0.6;
      const a = Math.random() * Math.PI * 2;
      const r = 0.8 + Math.random() * 2.0;
      this.confettiVel[i * 3] = Math.sin(a) * r;
      this.confettiVel[i * 3 + 1] = 0.6 + Math.random() * 1.6;
      this.confettiVel[i * 3 + 2] = Math.cos(a) * r;
    }
  }

  /**
   * Drive the rig. `beat` is the continuous song beat (negative pre-drop),
   * `act` the musical intensity 0..3, `energy` 0..1 (0 in the lobby idle).
   */
  update(dt: number, beat: number, act: number, energy: number): void {
    const beatFrac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - beatFrac * 2.2); // hits on the kick, dies fast
    const slow = performance.now() / 1000;

    // The ball turns always (the club never fully sleeps), faster with energy.
    this.ball.rotation.y += dt * (0.25 + energy * 0.55);
    for (let i = 0; i < this.shaftMats.length; i++) {
      // The gradient texture spends the alpha budget — the flat number can
      // afford to run hotter than the old untextured cones did.
      this.shaftMats[i].opacity = 0.09 + energy * (0.09 + pulse * 0.16);
    }

    // Laser fans: sweep with the bars, snap hue per bar.
    const bar = Math.floor(beat / 4);
    if (bar !== this.lastBar && beat > 0) {
      this.lastBar = bar;
      this.hueCursor = (this.hueCursor + 1) % LASER_HUES.length;
      const pal = this.palette;
      for (let i = 0; i < this.fans.length; i++) {
        this.fans[i].mat.color.setHex(
          pal
            ? pal[(this.hueCursor + i) % pal.length]
            : hueToColor(LASER_HUES[(this.hueCursor + i) % LASER_HUES.length], 0.6),
        );
      }
    }
    for (const fan of this.fans) {
      const sweep = beat > -Infinity && energy > 0 ? Math.sin(beat * 0.7 + fan.phase) : Math.sin(slow * 0.3 + fan.phase);
      fan.pivot.rotation.y = sweep * (0.7 + act * 0.25);
      fan.pivot.rotation.x = Math.sin(beat * 0.35 + fan.phase * 2) * 0.12 * energy;
      fan.mat.opacity = energy > 0 ? 0.3 + pulse * 0.45 : 0.18;
    }

    // ── Light lands where it lands ────────────────────────────────────
    // Fresh world matrices for the sweeps set above, then clip every beam
    // and shaft against the decks and the stage. A beam that meets a deck
    // STOPS there and leaves a hot spot; a shaft that rakes one pools on
    // it. This is the pass that stops lasers stabbing through platforms
    // and turns the ball's cones into light that actually falls on things.
    this.root.updateMatrixWorld(true);
    const rootPos = this.root.position;

    for (const s of this.shafts) {
      const e = s.cone.matrixWorld.elements;
      _o.set(e[12], e[13], e[14]);
      _d.set(-e[4], -e[5], -e[6]).normalize(); // cones hang down local −Y
      const t = rayHitsFloor(_o, _d, s.len);
      if (t < Infinity) {
        s.cone.scale.y = t / s.len;
        const spread = 0.9 + 2.2 * (t / s.len);
        s.pool.position.set(
          _o.x + _d.x * t - rootPos.x,
          _o.y + _d.y * t - rootPos.y + 0.02,
          _o.z + _d.z * t - rootPos.z,
        );
        s.pool.scale.set(spread, spread, 1);
        s.poolMat.opacity = Math.min(0.5, s.mat.opacity * 2.6);
        s.pool.visible = s.poolMat.opacity > 0.02;
      } else {
        s.cone.scale.y = 1;
        s.pool.visible = false;
      }
    }

    for (const b of this.beams) {
      const fan = this.fans[b.fan];
      const e = b.mesh.matrixWorld.elements;
      _o.set(e[12], e[13], e[14]);
      _d.set(e[4], e[5], e[6]).normalize(); // beams grow along local +Y
      const t = rayHitsFloor(_o, _d, BEAM_LEN);
      if (t < Infinity) {
        b.mesh.scale.y = t / BEAM_LEN;
        b.glint.position.set(
          _o.x + _d.x * t - rootPos.x,
          _o.y + _d.y * t - rootPos.y + 0.02,
          _o.z + _d.z * t - rootPos.z,
        );
        b.glint.scale.setScalar(0.28 + pulse * 0.22);
        b.glint.material.color.copy(fan.mat.color);
        b.glint.material.opacity = fan.mat.opacity;
        b.glint.visible = true;
      } else {
        b.mesh.scale.y = 1;
        b.glint.visible = false;
      }
    }

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
