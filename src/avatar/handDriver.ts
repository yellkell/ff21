/**
 * THE SPRUNG HAND — what a steel hand does with a controller, as one piece
 * every hand in the game can run: yours in a bout (PlayerGloveSystem), yours
 * on the club floor (rave/systems/PlayerSystem.ts), and every room-mate's
 * on the floor and in the glass (rave/game/blankDancer.ts), driven from the
 * reads their headset streams. So a grab or a finger gun YOU make is the
 * same grab and the same gun on every other headset.
 *
 * THE FINGERS ARE SPRUNG, not set: each one chases its target on its own
 * spring, the pinky quickest, so a grab rolls shut little finger first and
 * lands with a hair of overshoot — a squeeze reads as a GRAB, not a switch.
 *
 *   FINGER GUN  grip held, index finger OFF the trigger (Quest's capacitive
 *               touch), and the index points straight down the ray. Lift
 *               your thumb off the face buttons and it stands up like a
 *               hammer; bring it down and the gun goes BANG: the hammer
 *               falls and the hand kicks. Pure show.
 *   REST        a finger resting on the trigger rests curled round it; a
 *               thumb lifted off the buttons lifts on the hand too.
 *   OPEN        `open` (0..1) splays the hand wide — the arena's
 *               ready-to-catch as a ball homes in.
 */

import { InputComponent } from '@iwsdk/core';
import type { HandPose } from './hands.js';

/** What a hand is told each frame — a controller's reads, live or wired. */
export interface HandInput {
  /** Trigger and grip, 0 open … 1 closed. */
  trig: number;
  sq: number;
  /** A finger on the trigger (or unknown — a pad that can't sense touch). */
  trigTouch: boolean;
  /** The thumb on the face buttons (or unknown). */
  thumbDown: boolean;
  /** Ready to catch: 0 none … 1 flung wide open. */
  open?: number;
  /** A wired hand's BANG, decided upstream (the shot count moved). Left
   *  undefined, the hand fires itself the moment a cocked hammer falls. */
  fire?: boolean;
}

/** Spring stiffness per finger (index first) — the pinky closes first. */
const FINGER_K = [210, 240, 265, 290];
/** Under-damped a touch: a grab lands with a little overshoot. */
const DAMPING = 0.62;
const THUMB_K = 230;

/** One sprung value. */
interface Spring {
  x: number;
  v: number;
}

function spring(s: Spring, target: number, k: number, dt: number): void {
  const c = 2 * DAMPING * Math.sqrt(k);
  // Semi-implicit Euler, sub-stepped: stable at a 72 Hz frame with k ~300.
  const n = dt > 1 / 90 ? 2 : 1;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (k * (target - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
}

export class SprungHand {
  private readonly curl: Spring[] = [];
  private readonly spread: Spring = { x: 0, v: 0 };
  private readonly thumb: Spring = { x: 0, v: 0 };
  private readonly thumbUp: Spring = { x: 0, v: 0 };
  private readonly recoil: Spring = { x: 0, v: 0 };
  /** The gun's hammer was up last frame (a thumb coming down fires it). */
  private cocked = false;
  /** The pose to hand setHandPose — refreshed by every step(). */
  readonly pose: HandPose & { curl: [number, number, number, number] } = {
    curl: [0, 0, 0, 0],
    spread: 0,
    thumb: 0,
    thumbUp: 0,
  };
  /** BANGs fired so far — what the wire counts (packHandFlags). */
  shots = 0;

  constructor() {
    this.rest();
  }

  /** Back to the half-relaxed rest, still (a hand that just appeared). */
  rest(): void {
    const at = [0.25, 0.3, 0.3, 0.3];
    for (let i = 0; i < 4; i++) this.curl[i] = { x: at[i], v: 0 };
    this.spread.x = 0.2;
    this.thumb.x = 0.45;
    this.thumbUp.x = 0;
    this.spread.v = this.thumb.v = this.thumbUp.v = 0;
    this.recoil.x = this.recoil.v = 0;
    this.cocked = false;
    this.writePose();
  }

  /** The gun's recoil (radians-ish), sprung back to 0 — the caller turns
   *  the hand by it, as only it knows which way is up. */
  get kick(): number {
    return this.recoil.x;
  }

  /** The catch: snap shut, little finger first. */
  snapShut(): void {
    for (let i = 0; i < 4; i++) this.curl[i].v += 9 + i * 0.8;
    this.thumb.v += 6;
    this.spread.v -= 6;
  }

  /** Advance the hand by `dt` seconds. True on the frame it goes BANG. */
  step(input: HandInput, dt: number): boolean {
    const { trig, sq, trigTouch, thumbDown } = input;
    const gun = sq > 0.55 && !trigTouch;
    const fist = Math.max(trig, sq);
    const others = Math.max(sq, trig * 0.45);
    // The index: on the trigger it rests round it; off it, it's free.
    let index = Math.max(trig, sq * 0.6);
    if (trigTouch && trig < 0.1) index = Math.max(index, 0.32);
    if (!trigTouch) index = Math.min(index, sq * 0.15);
    const curlT = [index, others, Math.min(1, others * 1.04), Math.min(1, others * 1.08)];
    let spreadT = 0.25 * (1 - fist);
    let thumbT = 0.35 + fist * 0.55;
    let thumbUpT = thumbDown ? 0 : 0.35 * (1 - fist);

    const open = input.open ?? 0;
    if (gun) {
      curlT[0] = 0;
      thumbUpT = thumbDown ? 0 : 1;
      thumbT = thumbDown ? 0.55 : 0;
      spreadT = 0;
    } else if (open > 0 && fist < 0.5) {
      for (let i = 0; i < 4; i++) curlT[i] += (-0.12 - curlT[i]) * open;
      spreadT += (1 - spreadT) * open;
      thumbT += (0.05 - thumbT) * open;
      thumbUpT += (0.3 - thumbUpT) * open;
    }

    // BANG: a cocked hammer comes down — or, wired, the count moved.
    const bang = input.fire ?? (this.cocked && gun && thumbDown);
    if (bang) {
      this.recoil.v += 9;
      this.thumbUp.v -= 14;
      this.shots++;
    }
    // Cocked only while the thumb is UP and the hammer stands: one fall,
    // one BANG. (Cocked on the hammer's height alone, a thumb held down
    // re-fired every frame the hammer took to drop — three shots a tap.)
    this.cocked = gun && !thumbDown && this.thumbUp.x > 0.7;

    for (let i = 0; i < 4; i++) spring(this.curl[i], curlT[i], FINGER_K[i], dt);
    spring(this.spread, spreadT, 160, dt);
    spring(this.thumb, thumbT, THUMB_K, dt);
    spring(this.thumbUp, thumbUpT, THUMB_K, dt);
    spring(this.recoil, 0, 180, dt);
    this.writePose();
    return bang;
  }

  private writePose(): void {
    for (let i = 0; i < 4; i++) this.pose.curl[i] = Math.max(-0.2, Math.min(1.12, this.curl[i].x));
    this.pose.spread = Math.max(0, this.spread.x);
    this.pose.thumb = Math.max(0, Math.min(1.1, this.thumb.x));
    this.pose.thumbUp = Math.max(0, Math.min(1.05, this.thumbUp.x));
  }
}

/* ── the wire ────────────────────────────────────────────────────────────── */

/**
 * A hand's touch and its shots, packed into one small integer for the
 * club's pose frame (beside the two analogue reads):
 *
 *   bit 0       a finger on the trigger
 *   bit 1       the thumb on the face buttons
 *   bits 2..7   BANGs fired, mod 64 — a COUNT, not a flag, so a shot is
 *               never lost between two 12 Hz frames: any change fires once.
 */
export function packHandFlags(trigTouch: boolean, thumbDown: boolean, shots: number): number {
  return ((shots & 63) << 2) | (thumbDown ? 2 : 0) | (trigTouch ? 1 : 0);
}

/** Unknown touch: finger on the trigger, thumb down — never a gun. What a
 *  hand with no controller, or a frame from before the guns, reads as. */
export const HAND_FLAGS_UNKNOWN = 3;

export function unpackHandFlags(n: number): { trigTouch: boolean; thumbDown: boolean; shots: number } {
  const v = Number.isFinite(n) ? Math.max(0, Math.round(n)) : HAND_FLAGS_UNKNOWN;
  return { trigTouch: (v & 1) !== 0, thumbDown: (v & 2) !== 0, shots: (v >> 2) & 63 };
}

/* ── reading a controller ────────────────────────────────────────────────── */

/** The thumb's touch points: any of them touched = thumb down on the controller. */
const THUMB_PADS = [
  InputComponent.Thumbstick,
  InputComponent.A_Button,
  InputComponent.B_Button,
  InputComponent.X_Button,
  InputComponent.Y_Button,
  InputComponent.Thumbrest,
] as const;

/** The slice of IWSDK's gamepad a hand reads. */
interface PadLike {
  getButtonValue(id: InputComponent): number;
  getButtonTouched(id: InputComponent): boolean;
}

/**
 * Read a controller into `out`. Touch sensing is Quest's capacitive trigger
 * and face buttons; a pad that can't sense touch reads as touched, so a
 * plain controller never sprouts a finger gun by accident.
 */
export function readHand(gp: PadLike | undefined, out: HandInput): HandInput {
  const trig = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
  out.trig = trig;
  out.sq = gp?.getButtonValue(InputComponent.Squeeze) ?? 0;
  out.trigTouch = !gp || trig > 0.02 || (gp.getButtonTouched(InputComponent.Trigger) ?? true);
  let thumbDown = !gp;
  for (const pad of THUMB_PADS) if (gp?.getButtonTouched(pad)) thumbDown = true;
  out.thumbDown = thumbDown;
  return out;
}
