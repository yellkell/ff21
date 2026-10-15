/**
 * PlayerSystem — reads the tracked body, keeps the dodge state fresh, pays
 * you for dancing, and puts GLOWSTICKS in your hands.
 *
 * My platform IS the world origin (the ring is built around me), so the
 * head's world position is already platform-local — no transforms.
 *
 * Calibration: standing height snaps UP instantly (you can't fake tall) and
 * decays DOWN very slowly, so a whole set spent crouching never quietly
 * lowers the bar the sweeps are judged against.
 *
 * THE GROOVE (the COMBO on screen): dance like the groupies — one hand up,
 * one hand down, and SWAP on the beat. Each rhythmic swap pays a few
 * points, and the payout creeps upward the longer the motion stays
 * consistent (the streak). Swap off-rhythm or stop, and it lets go. It
 * never outweighs dodging; it's the trickle that makes standing still the
 * wrong idea. (The dodge chain is a separate thing — that one multiplies.)
 *
 * THE STICKS: every dancer on the ring carries glowsticks — now so do you,
 * riding your controllers in your seat's colour, each one cased in a thick
 * near-black outline so it never dissolves into the deck wearing that same
 * colour. They burn brighter as the combo climbs, and every REWARDED swap
 * answers from the hand that went up:
 * the stick pulses, the palm ticks, and a burst of SPARKS jumps off the tip
 * — a few faint motes when the groove is young, a hotter, denser fountain
 * as it deepens. No numbers, no panels: the sticks themselves are the
 * combo meter.
 *
 * AND THEY'RE WET: each of your sticks is a frosted tube of LIQUID glow —
 * SPLASH WARS' clipped-liquid trick (materials/liquid.ts) — whose surface
 * stays level in world space however you hold it, surges when you swing,
 * and pours end to end as your hands swap through the groove. Yours only:
 * the other figures' blades stay bare neon, because nobody can read a
 * meniscus across the ring and 46 more slosh sims would buy nothing.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Points,
  Quaternion,
} from 'three';
import { CHOREO, GROOVE, hueToColor } from '../config.js';
import { glintTexture, sizedPointsMaterial } from '../materials/glow.js';
import { createLiquid, HandMotion, type LiquidVisual } from '../materials/liquid.js';
import { danceHue } from '../game/profile.js';
import { match, me, showBeat } from '../game/state.js';

const _head = new Vector3();
const _hand = new Vector3();
const _lHand = new Vector3();
const _rHand = new Vector3();
const _sw = new Vector3();
// The burst frame: the cone's axis and the scatter disc around it.
const _bAxis = new Vector3();
const _bT1 = new Vector3();
const _bT2 = new Vector3();
const _tube = new Vector3();
const _axis = new Vector3();
const _ws = new Vector3();
const _q = new Quaternion();
const _c = new Color();
const _white = new Color(0xffffff);

/**
 * Which hand a pose names UP: 1 = left, −1 = right, 0 = neither (the
 * hysteresis dead band). The judge's whole eye, pure so
 * tools/groove-lean.mjs can read it straight from here.
 *
 * The old test was world-vertical only (Δy past GROOVE.split), which
 * unread every swap thrown mid-dodge: a dancer lunging off a beam tilts
 * the whole dance with the lunge, and the same-sized throw keeps too
 * little vertical to clear the bar. Now the SIZE of the throw is measured
 * between the hands themselves (`reach`, tilt-blind), and the vertical
 * only has to still say which end is up (GROOVE.splitLean) — so a groove
 * carried sideways through a dodge keeps paying, while a level T-pose
 * (reach without an up hand) and a close-in wobble (Δy without reach)
 * stay silent. Strictly wider than the old test: reach ≥ |Δy| always, so
 * every pose that used to register still does.
 */
export function grooveSideOf(dy: number, reach: number): 1 | -1 | 0 {
  if (reach < GROOVE.split || Math.abs(dy) < GROOVE.splitLean) return 0;
  return dy > 0 ? 1 : -1;
}

/** Dev window into the groove: `__gdr.sparkle(heat)` plays a whole rewarded
 *  swap off the right stick — flash, shake and sparks — so the answer can be
 *  tuned without dancing for it. */
export const grooveView: {
  burst?: (heat?: number) => void;
  /** Getting HIT breaks the hand rhythm — the judge calls this to cut the
   *  groove streak (and its tally) dead. */
  disrupt?: () => void;
  /** Dev (`__gdr.pads()`): what the controller models are doing — whether a
   *  visual exists at all, and whether it's hanging in the rig. `inRig` is
   *  the one that decides what draws; `visible` is IWSDK's to write and it
   *  rewrites it every frame. */
  controllers?: () => Array<{ hand: string; hasVisual: boolean; inRig: boolean; visible: boolean }>;
  /** Dev: the live controller visual adapters. The headset browsers ship a
   *  controller glTF and the emulator does not, so this is the only way to
   *  exercise the hide-during-a-song path anywhere but on-device. */
  padAdapters?: () => Record<'left' | 'right', { visual?: { model: Object3D } }> | null;
} = {};

interface Stick {
  group: Group;
  mat: MeshBasicMaterial;
  /** The business end — the sparks' emitter. An invisible marker: the end
   *  that pays announces itself by PAYING (the burst), not by wearing a
   *  glow all night. */
  tip: Object3D;
  /** Tip velocity (world, m/s) — the swing a burst inherits. */
  vel: Vector3;
  lastTip: Vector3;
  /** lastTip holds a real sample (a fresh attach must not read as a
   *  lightspeed swing). */
  tracked: boolean;
  liquid: LiquidVisual;
  motion: HandMotion;
  pulse: number;
  attachedTo: Object3D | null;
  /** Last frame's on-show state, so un-bagging can reset the slosh. */
  shown: boolean;
  /** Eased slide up the stick's axis to clear a drawn controller. */
  push: number;
}

/** Stick dimensions, and how thick its black casing runs. */
// A fat rave baton, not a pencil: the bore was 26 mm and read thin in the
// hand; 32 mm gives the liquid visible body from arm's length and the
// casing a ring worth outlining. Everything downstream (casing, tube,
// liquid, slosh spans) derives from this one number.
const STICK_R = 0.016;
const STICK_LEN = 0.3;
const STICK_CASE = 0.007;
/** How full the tube runs. Deliberately short of the brim: the airspace is
 *  where the Alyx trick lives — a stick with no headroom has no surface to
 *  keep level, no meniscus to flash, nowhere for the pour to go. */
const STICK_FILL = 0.85;
/** The liquid's own radius — the tube's bore, inset by the wall it sits
 *  inside. The interior capsule's overall span is therefore
 *  `(STICK_LEN - 2·STICK_R) + 2·LIQUID_R`, which is what the surface
 *  plane's world height is measured against. */
const LIQUID_R = STICK_R - 0.0015;
/** Held like a stick: up and slightly forward off the grip. The shake
 *  wobbles around this, so it has to be a named rest pose rather than a
 *  number set once at build time. */
const STICK_TILT = -0.55;
/** How far the stick slides up its own axis to clear a controller that is
 *  being drawn in the same hand (metres). Outside a song the moulded grip
 *  is on screen and the two share the same few centimetres; this pushes the
 *  stick's near end out past the controller's nose instead of through it. */
const STICK_PAD_PUSH = 0.12;
/** The stick's rest axis in hand space — local +Y turned by STICK_TILT. */
const PUSH_Y = Math.cos(STICK_TILT);
const PUSH_Z = Math.sin(STICK_TILT);

/** One near-black casing material for both hands — never lit, never tinted. */
let _casingMat: MeshBasicMaterial | null = null;
function casingMat(): MeshBasicMaterial {
  if (!_casingMat) _casingMat = new MeshBasicMaterial({ color: 0x02010a, side: BackSide });
  return _casingMat;
}

/**
 * The groove's voice: NEON SPARKLES — lens glints, not dots and never
 * squares. One additive Points cloud, world-space, recycled, wearing the
 * shared glint texture (hot core, crossing streaks), with a TWIN cloud
 * mirrored under the deck plane: the polished slab you dance on gets the
 * reflection the void's floor already has, so every burst lands twice.
 * Sparks fade by darkening (additive black = gone) and DIE IN THE AIR —
 * a glint that settles on the floor is litter, and litter is retro.
 *
 * Two things sell SPARKLE over "particles", and neither costs a draw call:
 * a SIZE POPULATION — dust and grains around the odd HERO glint, via the
 * per-particle size attribute — and every glint twinkling at its own rate
 * AND its own depth (the dust scintillates hard, the heroes burn steady).
 * And a burst inherits THE SWING: the sparks leave with a share of the
 * tip's own velocity, so a hard upswing throws its light the way a struck
 * sparkler does instead of pouring the same canned fountain whatever the
 * arm actually did.
 */
const MAX_SPARKS = 192;
/** Below this height a spark twinkles out rather than landing. */
const SPARK_FLOOR = 0.12;
/** How much of the tip's velocity a burst carries away, and the ceiling
 *  on it (m/s) — enough to read the swing, never enough to shotgun. */
const SPARK_SWING = 0.55;
const SPARK_SWING_MAX = 2.2;

class SparkPool {
  readonly points: Points;
  // Primary sparks in [0, MAX); their mirror twins in [MAX, 2·MAX).
  private pos = new Float32Array(MAX_SPARKS * 6);
  private col = new Float32Array(MAX_SPARKS * 6);
  private size = new Float32Array(MAX_SPARKS * 2);
  private vel = new Float32Array(MAX_SPARKS * 3);
  private base = new Float32Array(MAX_SPARKS * 3);
  private age = new Float32Array(MAX_SPARKS);
  private life = new Float32Array(MAX_SPARKS);
  private twinkle = new Float32Array(MAX_SPARKS);
  private flickDepth = new Float32Array(MAX_SPARKS);
  private cursor = 0;
  private posAttr: BufferAttribute;
  private colAttr: BufferAttribute;
  private sizeAttr: BufferAttribute;
  /** Anything still alight? A pool with nothing burning skips its whole
   *  walk AND the buffer re-uploads — most of every set, the groove is
   *  between bursts. */
  private lit = false;

  constructor() {
    const geo = new BufferGeometry();
    this.pos.fill(0);
    for (let i = 0; i < MAX_SPARKS * 2; i++) this.pos[i * 3 + 1] = -999; // parked
    this.size.fill(1);
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.colAttr = new BufferAttribute(this.col, 3).setUsage(DynamicDrawUsage);
    this.sizeAttr = new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    geo.setAttribute('aSize', this.sizeAttr);
    this.points = new Points(
      geo,
      sizedPointsMaterial({
        size: 0.075,
        map: glintTexture(),
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.name = 'groove-sparks'; // headless probes read the pool by name
    this.points.frustumCulled = false;
    this.points.renderOrder = 29;
  }

  /** `heat` 0..1 — deeper groove throws more, faster, whiter sparkles.
   *  `swing` is the emitting tip's velocity; the burst carries a share. */
  burst(at: Vector3, heat: number, colorHex: number, swing?: Vector3): void {
    // Copy-first: callers may hand us the shared scratch vector itself.
    if (swing) {
      _sw.copy(swing).multiplyScalar(SPARK_SWING);
      const l = _sw.length();
      if (l > SPARK_SWING_MAX) _sw.multiplyScalar(SPARK_SWING_MAX / l);
    } else {
      _sw.set(0, 0, 0);
    }
    // THE BURST LEAVES ALONG THE FLING. The old cone was a fixed upward
    // fountain with the swing merely added on top, so a hard sideways
    // throw still read as the same fountain with a lean. Now the swing
    // owns the cone's AXIS: an idle burst still fountains (axis = up),
    // but the harder the tip was moving the further the whole cone tips
    // into its direction of travel — the way a struck sparkler throws its
    // light where the strike sent it. The scatter disc opens around that
    // axis, and the swing share still rides on top as carried momentum.
    const swingLen = _sw.length();
    _bAxis.set(0, 1, 0);
    if (swingLen > 1e-3) {
      const w = Math.min(1, swingLen / 1.1); // fully committed by ~1.1 m/s of carried swing
      _bAxis.multiplyScalar(1 - w).addScaledVector(_sw, w / swingLen);
      // A dead-vertical downward fling cancels to ~zero — fall back to up.
      if (_bAxis.lengthSq() < 1e-6) _bAxis.set(0, 1, 0);
      _bAxis.normalize();
    }
    _bT1.set(Math.abs(_bAxis.x) > 0.9 ? 0 : 1, 0, Math.abs(_bAxis.x) > 0.9 ? 1 : 0);
    _bT1.cross(_bAxis).normalize();
    _bT2.crossVectors(_bAxis, _bT1);

    const M3 = MAX_SPARKS * 3;
    const count = Math.round(6 + heat * 22);
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_SPARKS;
      const i3 = i * 3;
      this.pos[i3] = at.x;
      this.pos[i3 + 1] = at.y;
      this.pos[i3 + 2] = at.z;
      // Muzzle speed along the axis (the old fountain's vertical budget),
      // scatter across the disc, and the swing's share carried whole.
      const a = Math.random() * Math.PI * 2;
      const r = (0.25 + Math.random() * 0.45) * (0.7 + heat * 0.8);
      const along = (0.7 + Math.random() * 0.9) * (0.8 + heat * 0.9);
      const sx = _bT1.x * Math.cos(a) + _bT2.x * Math.sin(a);
      const sy = _bT1.y * Math.cos(a) + _bT2.y * Math.sin(a);
      const sz = _bT1.z * Math.cos(a) + _bT2.z * Math.sin(a);
      this.vel[i3] = _bAxis.x * along + sx * r + _sw.x;
      this.vel[i3 + 1] = _bAxis.y * along + sy * r + _sw.y;
      this.vel[i3 + 2] = _bAxis.z * along + sz * r + _sw.z;
      // THE POPULATION: mostly grains, some dust, and about one glint in
      // seven a HERO — the big catch the eye reads the burst by. Heroes
      // live a shade longer, burn steadier and run a touch whiter (the
      // lens caught the source); the dust twinkles hardest.
      const hero = Math.random() < 0.15;
      const size = hero ? 1.7 + Math.random() * 0.7 : 0.55 + Math.random() * 0.75;
      this.size[i] = size;
      this.size[i + MAX_SPARKS] = size * 0.92;
      this.flickDepth[i] = hero ? 0.14 + Math.random() * 0.1 : 0.26 + Math.random() * 0.22;
      // Seat colour, run hotter (toward white) as the streak deepens —
      // each sparkle jittered so the burst shimmers instead of banding.
      _c.setHex(colorHex).lerp(_white, Math.min(1, heat * 0.55 + Math.random() * 0.3 + (hero ? 0.15 : 0)));
      this.base[i3] = _c.r;
      this.base[i3 + 1] = _c.g;
      this.base[i3 + 2] = _c.b;
      // Born ALIGHT: colour lands with the position, so the glint shows on
      // the very frame of the swap instead of black-holing its first one.
      this.col[i3] = _c.r;
      this.col[i3 + 1] = _c.g;
      this.col[i3 + 2] = _c.b;
      this.col[i3 + M3] = _c.r * 0.38;
      this.col[i3 + 1 + M3] = _c.g * 0.38;
      this.col[i3 + 2 + M3] = _c.b * 0.38;
      this.pos[i3 + M3] = at.x;
      this.pos[i3 + 1 + M3] = -at.y;
      this.pos[i3 + 2 + M3] = at.z;
      this.age[i] = 0;
      this.life[i] = 0.35 + Math.random() * 0.35 + heat * 0.2 + (hero ? 0.15 : 0);
      // Each glint scintillates at its own rate — the difference between
      // "particles" and "sparkles" is that sparkles TWINKLE.
      this.twinkle[i] = 7 + Math.random() * 9;
    }
    this.lit = true;
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
  }

  update(delta: number): void {
    if (!this.lit) return;
    const M3 = MAX_SPARKS * 3;
    let burning = 0;
    for (let i = 0; i < MAX_SPARKS; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.age[i] += delta;
      const k = this.age[i] / this.life[i];
      const grounded = this.pos[i3 + 1] <= SPARK_FLOOR;
      if (k >= 1 || grounded) {
        this.life[i] = 0;
        this.pos[i3 + 1] = -999;
        this.pos[i3 + 1 + M3] = -999;
        this.col[i3] = this.col[i3 + 1] = this.col[i3 + 2] = 0;
        this.col[i3 + M3] = this.col[i3 + 1 + M3] = this.col[i3 + 2 + M3] = 0;
        continue;
      }
      burning++;
      this.vel[i3 + 1] -= 2.4 * delta; // light gravity — a fountain, not confetti
      const drag = Math.max(0, 1 - 1.4 * delta);
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * delta;
      this.pos[i3 + 1] += this.vel[i3 + 1] * delta;
      this.pos[i3 + 2] += this.vel[i3 + 2] * delta;
      const depth = this.flickDepth[i];
      const flicker = 1 - depth + depth * Math.sin(this.age[i] * this.twinkle[i] + i * 1.7);
      const fade = (1 - k) * (1 - k) * flicker;
      this.col[i3] = this.base[i3] * fade;
      this.col[i3 + 1] = this.base[i3 + 1] * fade;
      this.col[i3 + 2] = this.base[i3 + 2] * fade;
      // The twin in the polish: same glint, upside down, dimmed the way
      // the void mirrors its own towers.
      this.pos[i3 + M3] = this.pos[i3];
      this.pos[i3 + 1 + M3] = -this.pos[i3 + 1];
      this.pos[i3 + 2 + M3] = this.pos[i3 + 2];
      this.col[i3 + M3] = this.col[i3] * 0.38;
      this.col[i3 + 1 + M3] = this.col[i3 + 1] * 0.38;
      this.col[i3 + 2 + M3] = this.col[i3 + 2] * 0.38;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    if (burning === 0) this.lit = false;
  }
}

export class PlayerSystem extends createSystem({}) {
  /** Which hand is currently "up": 1 = left, −1 = right, 0 = undecided. */
  private grooveSide = 0;
  /** Last physical flip (streak-hold detection). */
  private lastFlipBeat = -Infinity;
  /** Last PAID flip — the pay-rate cap gate. */
  private lastRewardBeat = -Infinity;
  private streak = 0;

  private sticks!: Record<'left' | 'right', Stick>;
  private sparks = new SparkPool();
  private stickHue = -1;
  /** Your seat colour, held so the flash has something to fall back to. */
  private stickColor = new Color(0xffffff);
  /** Free-running seconds — the shake's oscillator. */
  private clock = 0;
  /** Where each controller model hangs when it's on show, so a song can
   *  lift it out of the rig and put it back afterwards. */
  private padHome = new WeakMap<Object3D, Object3D>();

  init(): void {
    this.sticks = { left: this.buildStick(), right: this.buildStick() };
    this.scene.add(this.sparks.points);
    grooveView.burst = (heat = 1) => {
      const s = this.sticks.right;
      s.pulse = 1; // the whole reward answer, not just the sparks
      s.liquid.slosh.energy = Math.max(s.liquid.slosh.energy, 0.9); // …liquid churn included
      if (s.attachedTo) s.tip.getWorldPosition(_hand);
      else _hand.set(0.25, 1.35, -0.4);
      // A parked rig has no real swing — play the burst off a canned
      // upswing so the tuning view shows the whole effect.
      _sw.copy(s.vel);
      if (_sw.lengthSq() < 0.01) _sw.set(0.3, 1.6, 0);
      this.sparks.burst(_hand, Math.min(1, Math.max(0, heat)), hueToColor(danceHue(match.mySeat, true), 0.6), _sw);
    };
    grooveView.controllers = () =>
      (['left', 'right'] as const).map((hand) => {
        const model = this.input?.xr?.visualAdapters?.controller?.[hand]?.visual?.model;
        return {
          hand,
          hasVisual: !!model,
          inRig: !!model?.parent,
          visible: model?.visible ?? false,
        };
      });
    grooveView.padAdapters = () =>
      (this.input?.xr?.visualAdapters?.controller as
        | Record<'left' | 'right', { visual?: { model: Object3D } }>
        | undefined) ?? null;
    grooveView.disrupt = () => {
      // A hit knocks the rhythm out of your hands: streak, tally and the
      // metronome pose all reset — the groove restarts from the first swap.
      this.streak = 0;
      this.grooveSide = 0;
      match.grooveStreak = 0;
      match.grooveScore = 0;
    };
  }

  private buildStick(): Stick {
    const group = new Group();
    // Capsule profiles throughout: a glowstick is a sealed tube with
    // ROUNDED ends, and the old sharp-lipped cylinders read as cut pipe
    // the moment a cap faced you. The capsule's mid-section is the length
    // minus its two end domes, so every overall span stays what it was.
    const shaft = STICK_LEN - STICK_R * 2;

    // THE CASING. Your sticks and your deck wear the same seat colour —
    // hueToColor(seatHue, 0.6), the identical value — so a bare neon rod
    // held over your own rim vanishes into it. The fix is the fix the HUD
    // already uses for text: a thick near-black outline, so the colour
    // reads as a lit object ON the deck instead of a patch OF it.
    //
    // It's an inverted hull: a slightly fatter capsule drawn BACK faces
    // only, so its far wall sits behind the core and rings it in black
    // from every angle, with no second render pass.
    const casing = new Mesh(new CapsuleGeometry(STICK_R + STICK_CASE, shaft, 3, 10), casingMat());
    casing.position.y = 0.02;
    group.add(casing);

    // THE TUBE. Was a solid neon rod; now it's the FROSTED SHELL over the
    // liquid — translucent (depthWrite off, blended after the opaque glow
    // inside, exactly SPLASH WARS' tank-over-juice sort order), still in
    // your seat colour so the empty headroom reads as tinted plastic
    // against the casing's black rather than a hole in the stick.
    const mat = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
    });
    const stick = new Mesh(new CapsuleGeometry(STICK_R, shaft, 3, 10), mat);
    stick.position.y = 0.02;
    stick.renderOrder = 2; // blends over the opaque liquid inside
    group.add(stick);
    // THE LIQUID — the glow itself, sloshing inside the tube. It takes the
    // old white filament's job: that hot core said "this is a light" by
    // being solid and central, and the liquid says it with a meniscus and
    // a surface sheen instead — brighter, and it MOVES. A shrunk interior
    // copy of the tube (the same capsule, walls running parallel) wearing
    // the world-space clipped-liquid shader.
    const liquid = createLiquid(new CapsuleGeometry(LIQUID_R, shaft, 3, 10));
    liquid.mesh.position.y = 0.02;
    group.add(liquid.mesh);

    // AND NOTHING ELSE ON THE BODY. No halo sprite, no tip glow, no grip
    // cap — three things this stick used to wear, all retired on the same
    // grounds:
    //
    //  THE OUTLINE IS THE READ. The casing is an inverted hull, so the
    //    black ring you see is its FAR wall — behind any camera-facing
    //    sprite parked on the axis. An additive glow drawn in the
    //    transparent pass therefore always brightens over the outline
    //    (no renderOrder can put the far wall back on top), and a cased
    //    object whose case keeps washing out reads as a smudge, not a
    //    stick. The bloom now comes from what's inside the case: the
    //    liquid's foam line, its gloss, and the sparks.
    //
    //  A GLOWSTICK HAS NO HANDEDNESS. Both ends are the same rounded
    //    dome — no cap to say "hold me here", no hot end wearing a badge.
    //    The paying end still announces itself, but by PAYING: the spark
    //    burst leaves from the tip marker below on the frame a swap lands,
    //    which is a better badge than a lamp that's on all night.
    const tip = new Object3D();
    tip.position.y = 0.02 + STICK_LEN / 2 - 0.006;
    group.add(tip);
    group.name = 'live-glowstick';
    group.rotation.x = STICK_TILT;
    group.position.set(0, 0.01, -0.02);
    return {
      group,
      mat,
      tip,
      vel: new Vector3(),
      lastTip: new Vector3(),
      tracked: false,
      liquid,
      motion: new HandMotion(),
      pulse: 0,
      attachedTo: null,
      shown: false,
      push: 0,
    };
  }

  update(delta: number): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (headObj) {
      headObj.getWorldPosition(_head);
      match.headX = _head.x;
      match.headY = _head.y;
      match.headZ = _head.z;

      // Standing height: fast attack, glacial release.
      if (_head.y > match.standingHeight) {
        match.standingHeight = _head.y;
      } else {
        match.standingHeight = Math.max(1.1, match.standingHeight - delta * 0.015);
      }
      match.ducked = _head.y < match.standingHeight * CHOREO.duckFrac;
    }

    this.updateSticks(delta);
    this.sparks.update(delta);
    this.groove();
  }

  /* ── the sticks ───────────────────────────────────────────────────────── */

  private updateSticks(delta: number): void {
    // Your colour: the one you picked, else your seat's (it can change per
    // match online).
    this.clock += delta;
    const hue = danceHue(match.mySeat, true);
    if (hue !== this.stickHue) {
      this.stickHue = hue;
      this.stickColor.setHex(hueToColor(hue, 0.6));
    }

    // The sticks are RING kit, and ONLY ring kit. On the club floor, in
    // the foyer, at the board — anywhere that isn't a set — your hands are
    // hands: drinks to hold, panels to poke, an arcade to shoot. They used
    // to hide only on a joined club floor, which left them in your fists
    // in the foyer and through the seconds a relay took to answer; now
    // they come out of the bag for the count-in, the record and the
    // podium, and go straight back.
    const clubFloor = !(match.screen === 'countdown' || match.screen === 'raid' || match.screen === 'podium');

    // ONCE THE RECORD DROPS, THE PLASTIC GOES. Through a set you are a
    // dancer holding two glowsticks, not somebody wearing two controllers:
    // the moulded grips are hidden for the whole song and handed back at
    // the podium. Only the controller MODEL goes — tracked hands are your
    // actual hands and stay, and the pointer's own ray and cursor still
    // draw, so the pause card is as pokeable as ever.
    this.showControllers(!(match.screen === 'countdown' || match.screen === 'raid'));

    // Whose models are actually on screen this frame — the sticks shift out
    // of their way below.
    const pads = this.input?.xr?.visualAdapters?.controller;

    for (const hand of ['left', 'right'] as const) {
      const s = this.sticks[hand];
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D ?? null;
      if (obj !== s.attachedTo) {
        s.group.removeFromParent();
        s.attachedTo = obj;
        if (obj) obj.add(s.group);
        // A re-parent is a teleport, not a swing — and the liquid can't
        // tell the difference either, so both the spark's swing history
        // and the pour's motion history start fresh rather than reading
        // the jump as a whipcrack.
        s.tracked = false;
        s.motion.reset();
        s.liquid.slosh.reset();
      }
      const show = !clubFloor;
      if (show && !s.shown) {
        // Out of the bag: prime the pour level, don't slosh the journey.
        s.motion.reset();
        s.liquid.slosh.reset();
      }
      s.shown = show;
      s.group.visible = show;

      // MAKE ROOM FOR THE PLASTIC. Outside a song the moulded controller is
      // drawn in this same hand, and the stick's near end runs straight
      // through it. Slide the stick up its own axis so it starts past the
      // controller's nose — eased, because the model appears and vanishes
      // at the edges of a song and a snap there would read as a glitch.
      const padDrawn = !!pads?.[hand]?.visual?.model?.parent;
      const wantPush = padDrawn ? STICK_PAD_PUSH : 0;
      s.push += (wantPush - s.push) * Math.min(1, delta * 8);
      s.group.position.set(0, PUSH_Y * s.push, PUSH_Z * s.push);

      // THE SWING: the tip's velocity, sampled per frame, so a rewarded
      // swap can throw its sparks the way the stick was actually moving.
      // A frame that jumps too far (rig park, headset waking) reads as
      // zero rather than as a lightspeed flick.
      if (s.attachedTo && s.group.visible && delta > 0) {
        s.tip.getWorldPosition(_hand);
        if (s.tracked) {
          _sw.copy(_hand).sub(s.lastTip);
          if (_sw.lengthSq() < 0.36) s.vel.copy(_sw).divideScalar(delta);
          else s.vel.set(0, 0, 0);
        }
        s.lastTip.copy(_hand);
        s.tracked = true;
      } else {
        s.tracked = false;
        s.vel.set(0, 0, 0);
      }

      // Brighter the deeper the groove; the pulse pops it on a rewarded swap.
      // The tube's ceiling is frosted-shell territory now — brightness lives
      // in the liquid, and a shell opaque enough to glow on its own would
      // paint over the very thing it's there to show.
      const grooveGlow = Math.min(this.streak, 50) / 50;
      s.mat.opacity = 0.32 + grooveGlow * 0.22;
      const scale = 1 + s.pulse * 0.5;
      s.group.scale.set(scale, 1 + s.pulse * 0.25, scale);

      // THE KICK. A rewarded swap already threw sparks and ticked the palm;
      // now the STICK answers too, so the reward reads in the thing you're
      // actually looking at. Two parts, both riding the same pulse:
      //
      //  FLASH — the neon runs hot toward white and falls back to your
      //    seat colour, the way a tube does when it's struck.
      //  SHAKE — a short rattle about the grip, squared off the pulse so it
      //    bites on the beat and is gone before the next one. This is the
      //    seen half of the haptic tick: the buzz you feel, on the object.
      //
      // Deliberately small: the sticks are read in peripheral vision all
      // set long, and a stick that whips about is a stick you stop trusting
      // to tell you where your hands are.
      const flash = s.pulse * s.pulse;
      s.mat.color.copy(this.stickColor).lerp(_white, flash * 0.55);
      s.group.rotation.x = STICK_TILT + Math.sin(this.clock * 47) * 0.075 * flash;
      s.group.rotation.z = Math.sin(this.clock * 61 + 1.7) * 0.095 * flash;

      // THE POUR. Drive the liquid off the tube's world pose AFTER the
      // shake has posed the group, so the surface plane belongs to the
      // frame that's drawn. The fill never moves; the SURFACE does — level
      // in world space through every tilt of the dance, which is the whole
      // trick. Projecting the bore onto world up (its two end domes give
      // 2·LIQUID_R end-on, the straight shaft between them foreshortens by
      // |axis·up|) keeps the volume honest when the stick lies flat.
      if (show && s.attachedTo) {
        s.liquid.mesh.getWorldPosition(_tube);
        s.motion.update(_tube, delta);
        s.liquid.mesh.getWorldQuaternion(_q);
        _axis.set(0, 1, 0).applyQuaternion(_q);
        s.liquid.mesh.getWorldScale(_ws);
        const stickScale = Math.max(_ws.x, _ws.y, _ws.z);
        const worldHeight =
          (LIQUID_R * 2 + (STICK_LEN - STICK_R * 2) * Math.abs(_axis.y)) * stickScale;
        // The full interior length rides along too — the liquid's tilt
        // clamp needs the tube's horizontal footprint (see liquid.ts).
        const interiorLen = (LIQUID_R * 2 + (STICK_LEN - STICK_R * 2)) * stickScale;
        s.liquid.update(this.clock, delta, STICK_FILL, _tube, worldHeight, _axis, interiorLen, s.motion.accel);
        s.liquid.setColor(this.stickColor, flash, grooveGlow);
        // The surface re-projection rebuilds stereo depth from the clip
        // planes (liquid.ts) — hand it the real ones, not guesses.
        const cam = this.camera as { near?: number; far?: number } | undefined;
        if (cam?.near !== undefined && cam.far !== undefined) {
          s.liquid.material.uniforms.uNear.value = cam.near;
          s.liquid.material.uniforms.uFar.value = cam.far;
        }
      }

      // Decay LAST, and never by more than a frame's worth. Draining the
      // pulse before drawing with it meant the frame a swap landed on
      // rendered the stick already half-way home — and a single long frame
      // (a hitch, a headset waking up) drank the whole kick before it was
      // ever seen. Set on one frame, shown on that frame.
      s.pulse = Math.max(0, s.pulse - Math.min(delta, 0.05) * 4);
    }
  }

  /**
   * Show or hide the moulded controller models — by UNPARENTING them, not
   * by their `visible` flag.
   *
   * The flag is not ours to hold. IWSDK's input manager assigns
   * `visual.model.visible = isPrimary` every single frame, so setting it
   * false here only wins on frames we happen to run last — which is to say
   * it doesn't win, and the controllers stayed on screen through the song.
   * Lifting the model out of the scene graph settles it: the input manager
   * can go on setting `visible` on a detached object all it likes, and
   * nothing draws.
   *
   * Re-checked every frame because a controller that reconnects (or a
   * headset waking) rebuilds its visual and re-adds it to the rig.
   */
  private showControllers(show: boolean): void {
    const pads = this.input?.xr?.visualAdapters?.controller;
    if (!pads) return;
    for (const hand of ['left', 'right'] as const) {
      const model = pads[hand]?.visual?.model;
      if (!model) continue;
      if (show) {
        if (!model.parent) (this.padHome.get(model) ?? this.player).add(model);
      } else if (model.parent) {
        this.padHome.set(model, model.parent);
        model.removeFromParent();
      }
    }
  }

  /* ── the groove ───────────────────────────────────────────────────────── */

  private handAt(hand: 'left' | 'right', out: Vector3): boolean {
    const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
    if (!obj) return false;
    obj.getWorldPosition(out);
    return true;
  }

  private groove(): void {
    const d = me();
    const live = match.playing && match.screen === 'raid' && d?.alive;
    if (!live) {
      this.grooveSide = 0;
      this.streak = 0;
      match.grooveStreak = 0;
      match.grooveScore = 0;
      return;
    }

    if (!this.handAt('left', _lHand) || !this.handAt('right', _rHand)) return;

    // One up, one down — with hysteresis so a wobble at the crossover
    // doesn't machine-gun fake swaps.
    const side = grooveSideOf(_lHand.y - _rHand.y, _lHand.distanceTo(_rHand));
    // The groove is "dance like the groupies", and the groupies dance to
    // the RECORD — so its windows count the record's beats (showBeat). On
    // a doubled chart the raw clock would demand a swap every 0.8 s to
    // hold the streak of a 95 BPM strut, twice the dance the song asks.
    const gb = showBeat();
    if (side === 0 || side === this.grooveSide) {
      // Held too long without a swap → the groove lets go, tally and all.
      if (this.streak > 0 && gb - this.lastFlipBeat > GROOVE.maxBeats) {
        this.streak = 0;
        match.grooveStreak = 0;
        match.grooveScore = 0;
      }
      return;
    }

    // A physical flip. Every flip keeps the hold-timer alive, but PAY is
    // rate-capped to the music: at most one rewarded swap per ~beat since
    // the last PAID one. Spamming faster than the BPM is silently absorbed —
    // no reward, no reset — so light-speed flailing earns exactly what
    // dancing on the beat earns, and no more.
    const first = this.grooveSide === 0;
    this.grooveSide = side;
    this.lastFlipBeat = gb;
    if (first) {
      this.lastRewardBeat = gb; // the opening pose sets the metronome
      return;
    }

    const paidGap = gb - this.lastRewardBeat;
    if (paidGap < GROOVE.minBeats) return; // faster than the music — absorbed

    this.lastRewardBeat = gb;
    this.streak = Math.min(GROOVE.streakCap, this.streak + 1);
    // The counter runs to 999; the payout curve flattens at payCap.
    const award = Math.round(GROOVE.base + Math.min(this.streak, GROOVE.payCap) * GROOVE.perStreak);
    d.score += award;
    match.grooveStreak = this.streak;
    match.grooveScore += award;

    // The answer from the hand that went up: the stick pops, sparks jump
    // off its tip — more and hotter the deeper the streak — and the palm
    // gets a short TICK. Felt and seen, never read.
    const hand = side === 1 ? 'left' : 'right';
    const stick = this.sticks[hand];
    stick.pulse = 1;
    // …and the liquid answers with them: the same kick, seen as a surge of
    // surface shimmer. (The swap's own hand acceleration sloshes it anyway;
    // this just guarantees the churn lands ON the reward, every time.)
    stick.liquid.slosh.energy = Math.max(stick.liquid.slosh.energy, 0.9);
    if (stick.attachedTo) {
      // Off the TIP — the hot end — carrying the swing that earned it.
      stick.tip.getWorldPosition(_hand);
      this.sparks.burst(_hand, Math.min(this.streak, 50) / 50, hueToColor(this.stickHue, 0.6), stick.vel);
    }
    this.buzz(hand, 0.28 + Math.min(this.streak, 50) * 0.004, 40);

    // No milestone pop-ups: the pips, the ×meter and the stick pulses ARE
    // the groove feedback — the flair channel stays clear for dodges, hits
    // and the fights that matter.
  }

  /** A short haptic tick on one controller. The IWSDK gamepad wrapper is a
   *  pure state tracker, so this talks to the raw WebXR input source; on
   *  hardware without an actuator it's a silent no-op. */
  private buzz(hand: 'left' | 'right', intensity: number, ms: number): void {
    const session = (this.world as { session?: XRSession | null }).session;
    if (!session?.inputSources) return;
    for (const src of session.inputSources) {
      if (src.handedness !== hand) continue;
      const actuator = (
        src.gamepad as { hapticActuators?: readonly { pulse?: (i: number, ms: number) => void }[] } | undefined
      )?.hapticActuators?.[0];
      try {
        actuator?.pulse?.(Math.min(1, intensity), ms);
      } catch {
        /* some browsers throw on unsupported pulse — fine, it's garnish */
      }
    }
  }
}
