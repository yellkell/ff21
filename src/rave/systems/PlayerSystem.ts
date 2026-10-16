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
 * the stick pulses, the palm ticks, and a jet of SPARKS leaves the tip
 * along the stick — a few thin tracers when the groove is young, a hotter,
 * denser jet as it deepens. No numbers, no panels: the sticks themselves are the
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
  BackSide,
  CapsuleGeometry,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
} from 'three';
import { CHOREO, GROOVE, hueToColor } from '../config.js';
import { TracerField } from '../materials/tracers.js';
import { createLiquid, HandMotion, type LiquidVisual } from '../materials/liquid.js';
import { danceHue } from '../game/profile.js';
import { match, me, showBeat } from '../game/state.js';
import { setGloveLit } from '../../avatar/boxer.js';
import { applyGear } from '../../avatar/gear.js';
import { HAND_FLAGS_UNKNOWN, packHandFlags, readHand, SprungHand, type HandInput } from '../../avatar/handDriver.js';
import { buildHand, HAND_ADDUCTION, handIndexTip, INDEX_TIP_LENGTH, setHandPose } from '../../avatar/hands.js';
import { muzzleSparks, myHandFlags } from '../club/fingerGun.js';
import { applyLook, myLook, paintState } from '../../avatar/paint.js';
import { applyAvatarSkin } from '../../avatar/skins.js';
import { customization, myAvatarSkin, myGear, myTone } from '../../menu/customization.js';
import { gripStick, GRIP_POSE } from '../game/stickGrip.js';

const _head = new Vector3();
const _hand = new Vector3();
const _lHand = new Vector3();
const _rHand = new Vector3();
const _sw = new Vector3();
// The burst frame: the cone's axis and the scatter disc around it.
const _bAxis = new Vector3();
const _tipAxis = new Vector3();
const _tube = new Vector3();
const _axis = new Vector3();
const _ws = new Vector3();
const _q = new Quaternion();
const _gripQ = new Quaternion();
const _rayQ = new Quaternion();
const UP = new Vector3(0, 1, 0);
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
/** The tube's centre, up the stick group's own axis (buildStick). */
const STICK_MID = 0.02;

/** One near-black casing material for both hands — never lit, never tinted. */
let _casingMat: MeshBasicMaterial | null = null;
function casingMat(): MeshBasicMaterial {
  if (!_casingMat) _casingMat = new MeshBasicMaterial({ color: 0x02010a, side: BackSide });
  return _casingMat;
}

/**
 * The groove's voice: SPARKS OFF THE TIP — hot tracers, not sparkles.
 *
 * A paid swap throws a short JET out of the end of the stick that paid:
 * along the stick's own axis, so it leaves the way your hand is pointing
 * it, leaning into the swing the harder the tip was moving. Each spark is a
 * streak along its own path (materials/tracers.ts), white-hot off the tip
 * and cooling into your seat colour as it falls, the way a struck tube or a
 * cutting wheel throws light — no lens-glint stars, no twinkle. A twin
 * field hangs mirrored under the deck plane, dimmed, so every jet still
 * lands in the polish. A deeper streak throws more of them, faster.
 */
const MAX_SPARKS = 160;
/** How much of the tip's velocity a jet carries away, and the ceiling on
 *  it (m/s) — enough to read the swing, never enough to shotgun. */
const SPARK_SWING = 0.5;
const SPARK_SWING_MAX = 2.2;
/** How far the swing may bend the jet off the stick's axis (0 = never,
 *  1 = all the way round to the swing). */
const SPARK_LEAN = 0.45;
/** The jet's cone, half-angle (radians): tight — a nozzle, not a fountain. */
const SPARK_SPREAD = 0.3;

class SparkPool {
  readonly root = new Group();
  private field: TracerField;
  private twin: Mesh;

  constructor() {
    this.field = new TracerField(MAX_SPARKS, {
      width: 0.0055,
      streak: 0.028,
      maxLen: 0.12,
      gravity: 5.5,
      drag: 1.1,
      floorY: 0.03,
      hot: 0.22,
    });
    this.root.name = 'groove-sparks'; // headless probes read the pool by name
    this.root.add(this.field.mesh);
    // The twin in the polish: the same instance buffers drawn through a
    // flip about y = 0, at the dimness the void mirrors its own towers.
    const twinMat = this.field.material.clone();
    twinMat.uniforms.uGain.value = 0.38;
    this.twin = new Mesh(this.field.mesh.geometry, twinMat);
    this.twin.frustumCulled = false;
    this.twin.renderOrder = this.field.mesh.renderOrder;
    const flip = new Group();
    flip.scale.y = -1;
    flip.add(this.twin);
    this.root.add(flip);
  }

  /** `heat` 0..1 — deeper groove throws more, faster, whiter sparks.
   *  `axis`: the stick's world axis out of the tip. `swing`: the tip's
   *  velocity; the jet leans into it and carries a share. */
  burst(at: Vector3, heat: number, colorHex: number, axis: Vector3, swing?: Vector3): void {
    if (swing) {
      _sw.copy(swing).multiplyScalar(SPARK_SWING);
      const l = _sw.length();
      if (l > SPARK_SWING_MAX) _sw.multiplyScalar(SPARK_SWING_MAX / l);
    } else {
      _sw.set(0, 0, 0);
    }
    _bAxis.copy(axis);
    if (_bAxis.lengthSq() < 1e-6) _bAxis.set(0, 1, 0);
    _bAxis.normalize();
    const swingLen = _sw.length();
    if (swingLen > 1e-3) {
      const w = Math.min(1, swingLen / 1.1) * SPARK_LEAN;
      _bAxis.multiplyScalar(1 - w).addScaledVector(_sw, w / swingLen);
      if (_bAxis.lengthSq() < 1e-6) _bAxis.copy(axis);
      _bAxis.normalize();
    }
    const count = Math.round(7 + heat * 17);
    const speed = 1.5 + heat * 1.4;
    // Seat colour, run hotter as the streak deepens.
    _c.setHex(colorHex).lerp(_white, heat * 0.35);
    this.field.spray(
      at.x, at.y, at.z,
      _bAxis.x, _bAxis.y, _bAxis.z,
      count, speed, SPARK_SPREAD,
      0.34 + heat * 0.16,
      _c.getHex(),
      _sw,
    );
  }

  update(delta: number): void {
    this.field.step(delta);
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
  /** Your steel hands — the quick match's, see updateHands. */
  private hands: Partial<Record<'left' | 'right', Group>> = {};
  /** …and what drives their fingers off the hook: the sprung hand. */
  private sprung = { left: new SprungHand(), right: new SprungHand() };
  private reads: Record<'left' | 'right', HandInput> = {
    left: { trig: 0, sq: 0, trigTouch: true, thumbDown: true },
    right: { trig: 0, sq: 0, trigTouch: true, thumbDown: true },
  };

  init(): void {
    this.sticks = { left: this.buildStick(), right: this.buildStick() };
    this.scene.add(this.sparks.root);
    this.scene.add(muzzleSparks.root);
    grooveView.burst = (heat = 1) => {
      const s = this.sticks.right;
      s.pulse = 1; // the whole reward answer, not just the sparks
      s.liquid.slosh.energy = Math.max(s.liquid.slosh.energy, 0.9); // …liquid churn included
      if (s.attachedTo) {
        s.tip.getWorldPosition(_hand);
        this.tipAxis(s, _tipAxis);
      } else {
        _hand.set(0.25, 1.35, -0.4);
        _tipAxis.set(0.2, 0.85, -0.5);
      }
      // A parked rig has no real swing — play the burst off a canned
      // upswing so the tuning view shows the whole effect.
      _sw.copy(s.vel);
      if (_sw.lengthSq() < 0.01) _sw.set(0.3, 1.6, 0);
      this.sparks.burst(_hand, Math.min(1, Math.max(0, heat)), hueToColor(danceHue(match.mySeat, true), 0.6), _tipAxis, _sw);
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

  /** The stick's own axis in the world, out through its tip — the way
   *  the hand is pointing it, shake and all. */
  private tipAxis(s: Stick, out: Vector3): Vector3 {
    s.group.getWorldQuaternion(_q);
    return out.set(0, 1, 0).applyQuaternion(_q);
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
    casing.position.y = STICK_MID;
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
    stick.position.y = STICK_MID;
    stick.renderOrder = 2; // blends over the opaque liquid inside
    group.add(stick);
    // THE LIQUID — the glow itself, sloshing inside the tube. It takes the
    // old white filament's job: that hot core said "this is a light" by
    // being solid and central, and the liquid says it with a meniscus and
    // a surface sheen instead — brighter, and it MOVES. A shrunk interior
    // copy of the tube (the same capsule, walls running parallel) wearing
    // the world-space clipped-liquid shader.
    const liquid = createLiquid(new CapsuleGeometry(LIQUID_R, shaft, 3, 10));
    liquid.mesh.position.y = STICK_MID;
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
    tip.position.y = STICK_MID + STICK_LEN / 2 - 0.006;
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
    muzzleSparks.update(Math.min(delta, 0.05));
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

    // NO PLASTIC, EVER. The moulded controller models never draw: you
    // wear the quick match's steel hands instead — open on the club floor
    // and in the foyer, and closed round the glowsticks from the count-in
    // to the podium (updateHands, after the sticks are posed). Tracked
    // hands are your actual hands and stay, and the pointer's own ray and
    // cursor still draw, so every panel is as pokeable as ever.
    this.hideControllers();

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

    this.updateHands(delta, !clubFloor);
  }

  /**
   * Hide the moulded controller models — by UNPARENTING them, not by their
   * `visible` flag.
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
  private hideControllers(): void {
    const pads = this.input?.xr?.visualAdapters?.controller;
    if (!pads) return;
    for (const hand of ['left', 'right'] as const) pads[hand]?.visual?.model?.removeFromParent();
  }

  /**
   * THE STEEL HANDS — the quick match's articulated hands (avatar/hands.ts),
   * wearing your skin, gear and paint, worn wherever the controllers used
   * to show and then some:
   *
   *   OPEN     on the club floor, in the foyer, at the board: locked to each
   *            grip, aimed down the pointing ray like a fighter's fists (so
   *            a menu laser leaves from the knuckles), and SPRUNG — the
   *            arena's own hand (avatar/handDriver.ts): a squeeze rolls
   *            shut as a grab, and grip-without-trigger is a FINGER GUN,
   *            thumb up to cock, thumb down for the BANG. What they do is
   *            published (club/fingerGun.ts) for the floor's pose stream,
   *            so every room-mate sees the same grab and the same gun.
   *   HOLDING  from the count-in to the podium: closed round the glowstick
   *            (rave/game/stickGrip.ts). The stick leads — the hand is
   *            fitted to its pose after the shake has moved it, so the fist
   *            rattles with the stick it holds — and a rewarded swap
   *            blooms the hand along with the tube.
   *
   * A tracked hand is your real hand, so no steel one is drawn over it.
   * Named `rave-hand-*`, not `player-glove-*`: in the arena the fight's own
   * hands go by those names and its menu repaints them.
   */
  private updateHands(delta: number, holding: boolean): void {
    const dress = `${customization.version}|${paintState.version}`;
    const dt = Math.min(delta, 0.05);
    for (const [i, hand] of (['left', 'right'] as const).entries()) {
      // Unknown — never a gun on anyone's headset — until a steel hand is
      // out on a controller and has read it this frame.
      myHandFlags[i] = HAND_FLAGS_UNKNOWN;
      const grip = this.world.playerSpaceEntities?.gripSpaces?.[hand]?.object3D;
      if (!grip) continue;
      let glove = this.hands[hand];
      if (!glove) {
        glove = buildHand(hand === 'left' ? 1 : -1);
        glove.name = `rave-hand-${hand}`;
        this.hands[hand] = glove;
      }
      // Dressed when built, and again whenever the locker or the bay moves
      // — gear first, as fresh gear is a fresh paint surface.
      if (glove.userData.dress !== dress) {
        glove.userData.dress = dress;
        applyAvatarSkin(glove, myAvatarSkin());
        applyGear(glove, myGear(), myTone());
        applyLook(glove, myLook());
      }
      const show = !this.input.xr.isPrimary('hand', hand);
      glove.visible = show;
      if (!show) continue;

      const input = readHand(this.input.xr.gamepads[hand], this.reads[hand]);
      const { trig, sq } = input;
      const squeezing = trig > 0.5 || sq > 0.5;
      const stick = this.sticks[hand];
      const sprung = this.sprung[hand];

      if (holding && stick.attachedTo) {
        if (glove.parent !== stick.attachedTo) stick.attachedTo.add(glove);
        gripStick(glove, stick.group, i as 0 | 1, STICK_MID);
        setHandPose(glove, GRIP_POSE);
        setGloveLit(glove, squeezing || stick.pulse > 0.15, delta);
        // Off the stick, the hand comes back from rest, not mid-gesture.
        sprung.rest();
        continue;
      }

      if (glove.parent !== grip) grip.add(glove);
      glove.position.set(0, 0, 0);
      const bang = sprung.step(input, dt);
      setHandPose(glove, sprung.pose);
      myHandFlags[i] = packHandFlags(input.trigTouch, input.thumbDown, sprung.shots);
      setGloveLit(glove, squeezing, delta);
      // Knuckles down the pointing ray: cancel the grip's tilt, take the
      // ray's (PlayerGloveSystem does the same for a fight).
      const ray = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (ray) {
        grip.getWorldQuaternion(_gripQ);
        ray.getWorldQuaternion(_rayQ);
        glove.quaternion.copy(_gripQ).invert().multiply(_rayQ).multiply(HAND_ADDUCTION[i]);
        // The gun's kick lifts the muzzle, exactly as in a bout.
        if (Math.abs(sprung.kick) > 1e-4) {
          glove.quaternion.multiply(_q.setFromAxisAngle(UP, (hand === 'left' ? -1 : 1) * sprung.kick * 0.06));
        }
      }
      // BANG: sparks off the fingertip, a thump in the palm.
      if (bang) {
        const tip = handIndexTip(glove);
        if (tip) {
          glove.updateMatrixWorld(true);
          tip.localToWorld(_hand.set(0, 0, -INDEX_TIP_LENGTH - 0.004));
          tip.getWorldQuaternion(_q);
          muzzleSparks.shot(_hand, _tipAxis.set(0, 0, -1).applyQuaternion(_q));
        }
        this.buzz(hand, 0.55, 45);
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
      // Off the TIP — the hot end — out along the stick, carrying the
      // swing that earned it.
      stick.tip.getWorldPosition(_hand);
      this.tipAxis(stick, _tipAxis);
      this.sparks.burst(_hand, Math.min(this.streak, 50) / 50, hueToColor(this.stickHue, 0.6), _tipAxis, stick.vel);
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
