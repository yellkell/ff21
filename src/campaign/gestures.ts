/**
 * THE GESTURE LANGUAGE — how a titan's BODY reads a move (DESIGN.md §4,
 * second pass: "bespoke gestures per shape"; third pass: the arms grew
 * ELBOWS, WRISTS and FINGERS, every shape uses them, and the CLASSIC kinds
 * joined the language with shapes of their own).
 *
 * The floor telegraph is the near tell; the titan's silhouette is the far
 * one. RAVE RAID's bosses sold every shape with a different gesture. Each
 * SHAPE has a windup, a follow-through, and a gaze, all pure functions of
 * the charge so every client animates the same pose from the same seed:
 *
 *   THE GRAMMAR
 *   point    a lane: ONE arm levels down the strip, straight, finger out
 *   x        THE X: two straight bars cross in front, one over the other,
 *            fists closed
 *   scissor  a rail: both arms flat out like wings, snapping across
 *   press    the gate: arms spread, then CLOSE toward the gap that lives
 *   ring     the donut: arms up in a wide V framing the rim, a hoop's
 *            width apart, then slam down wide
 *   teach    THE LESSON: the king POINTS at each taught quarter in turn —
 *            and shows an open PALM for a hold
 *   conduct  THE RECITAL: forearms up like a conductor, the baton hand
 *            flicking on every cue; a hold is a palm held out — STAY
 *   march    the wave: the piston drumline — arms pump on the beat
 *   blade    the duckdonut's cut: the classic sweep's wind-out
 *
 *   THE CLASSICS
 *   hammer   the slam: the fist is DRAWN — down and back, elbow cocked —
 *            then hoisted sky-high, trembling at the top before it falls
 *   scythe   the sweep: wound out wide and back, the forearm gathering
 *            for the whip, the off arm counterweighting across the chest
 *   cannon   the beam: one arm locked straight at you — the barrel — the
 *            other hand bracing its elbow; the whole arm shakes as it cooks
 *   launcher the volley: arms swung back and folded, the body rocked back
 *            on its heels for the pods' recoil; every shot jolts it
 *   coil     the nova: wound in TIGHT — fists at the shoulders, elbows
 *            folded shut, hunched and crouched, trembling — then thrown wide
 *   tilt     the seesaw: arms out flat like a balance beam that TIPS toward
 *            the half about to flood; the low hand slaps it down
 *   shove    the surge: both palms out at chest height, elbows drawn back,
 *            then driven straight — the flood pushed at you
 *
 * An arm's pose is four joints. The SHOULDER is a DELTA from the arm's
 * rest pivot (restX/restZ): `x` is the pivot's pitch (negative raises the
 * arm forward/up — the hammer hoists at −2.5), `z` its yaw about the body,
 * signed per arm by `out` (+1 swings that arm away from the body, −1
 * across it). The ELBOW (`elbow`), WRIST (`wrist`) and FINGERS (`curl`)
 * are ABSOLUTE: elbow 0 is a straight arm and ~2.2 a forearm folded right
 * up; wrist 0 is a hand in line with the forearm, positive bends it
 * forward (a flick, a chop), negative back (a palm held out); curl 0 is an
 * open hand, 1 a fist. ARM_REST is the neutral all of them ease home to.
 * CampaignSystem eases every joint toward the returned targets, so a pose
 * is a destination, never a keyframe — and a cascade whose next read
 * hasn't opened yet (fill 0) simply eases the arms home between steps.
 *
 * THE CLEARANCE LAW: no pose here — windup, follow-through, or the blend
 * between — puts a fist within a fist's width of the other arm or the
 * head. The elbow is a single hinge, so it can't fold a forearm sideways:
 * the shapes that cross (THE X, the scissor's jaws) cross as two straight
 * bars at staggered heights, and the shapes that used to meet overhead
 * (the ring, the coil) frame the rim wide or wind in tight instead.
 * tools/gesture-check.mjs measures every pose and every handover against
 * the rig's real thicknesses; armGuard.ts holds the line mid-flight.
 */

import type { GrammarKind } from './grammar.js';

export type GestureShape =
  | 'point'
  | 'x'
  | 'scissor'
  | 'press'
  | 'ring'
  | 'teach'
  | 'conduct'
  | 'march'
  | 'blade'
  | 'hammer'
  | 'scythe'
  | 'cannon'
  | 'launcher'
  | 'coil'
  | 'tilt'
  | 'shove';

/** The classic kinds' shapes (the grammar's come off their zones). */
export const CLASSIC_SHAPE: Record<string, GestureShape> = {
  slam: 'hammer',
  sweep: 'scythe',
  beam: 'cannon',
  volley: 'launcher',
  nova: 'coil',
  seesaw: 'tilt',
  surge: 'shove',
};

/** Where the next landing sits, in the TARGET's local frame, as two signs:
 *  `side` lateral (+x is the player's right — the titan's LEFT arm, arm 0),
 *  `fwd` depth (+z is the player's side of the deck, away from the titan).
 *  Zero means "no preference" (a centre lane, the donut, a full-width row).
 *  `hold` is THE RECITAL's blue cue: this step says STAY. The classics add
 *  `arm`, the striking arm CampaignSystem chose, and `both`, a multi-target
 *  windup that raises the pair. */
export interface GestureFocus {
  side: number;
  fwd: number;
  hold?: boolean;
  arm?: 0 | 1;
  both?: boolean;
}

export interface ArmDelta {
  x: number;
  z: number;
  elbow: number;
  wrist: number;
  curl: number;
}

export interface GesturePose {
  arms: [ArmDelta, ArmDelta];
  /** Root pitch toward the player (positive tips the face down/forward). */
  lean: number;
  /** Root lift in body units (the donut's up-on-the-toes). */
  rise: number;
  /** How hard the head turns from the player to the marked spot (0..1). */
  gaze: number;
}

/**
 * WHERE THE LANGUAGE MEETS THE RIG. Every pose in this file writes a REACH
 * toward the player as a negative shoulder-pitch delta and a FOLD (elbow,
 * wrist) as a positive value. But on the titan rigs a positive pitch swings
 * an arm toward the player (the rest pose hangs them at +0.18, a touch
 * forward), so read literally, the whole language played BEHIND the titan:
 * the X crossed its bars a metre past its own back, the point jabbed away
 * from you, the press clapped behind its head. These two map a pose onto
 * the rig the right way round, for animateTitan and tools/gesture-check
 * alike. (Every clearance is unchanged: the head and both shoulders sit on
 * the rig's z = 0 plane, so a front/back mirror moves no arm nearer
 * anything.)
 */
export function rigPitch(restX: number, dx: number): number {
  return restX - dx;
}
/** A pose's elbow or wrist value → the joint's rotation.x. */
export function rigFold(v: number): number {
  return v;
}

/** The joints at rest: a slightly bent elbow, a level wrist, a loose hand. */
export const ARM_REST = { elbow: 0.35, wrist: 0, curl: 0.3 } as const;

/** Which arm a lateral sign asks for: arm 0 strikes the player's +x side
 *  (CampaignSystem's own arm choice), arm 1 the −x. Centre → arm 0. */
export function armFor(side: number): 0 | 1 {
  return side < 0 ? 1 : 0;
}

/** The outward yaw sign per arm — how animateTitan's sweep already reads
 *  it (arm 0 winds out toward −z, arm 1 toward +z). */
const OUT: readonly [number, number] = [-1, 1];

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smooth = (t: number): number => {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function restArm(): ArmDelta {
  return { x: 0, z: 0, elbow: ARM_REST.elbow, wrist: ARM_REST.wrist, curl: ARM_REST.curl };
}

/**
 * Map a grammar move's next pending zone onto its gesture shape. The kind
 * matters too: a lane inside the WAVE is one step of the march, not a
 * pointed strip, and a lane with a yaw is one arm of THE X. A quad is the
 * LESSON's teach; CampaignSystem swaps in the conductor once the recital
 * itself is under way (the body must not point at the answer then).
 */
export function gestureShapeOf(
  kind: GrammarKind | string,
  zone: { kind: string; yaw?: number },
): GestureShape | null {
  switch (zone.kind) {
    case 'lane':
      if (kind === 'wave') return 'march';
      return zone.yaw ? 'x' : 'point';
    case 'rail':
      return kind === 'wave' ? 'march' : 'scissor';
    case 'gate':
      return 'press';
    case 'ring':
      return 'ring';
    case 'quad':
      return 'teach';
    case 'sweep':
      return 'blade';
    default:
      return null;
  }
}

/** The lateral/depth signs a zone asks the body to lean toward. */
export function gestureFocusOf(zone: {
  kind: string;
  x?: number;
  z?: number;
  at?: number;
  axis?: number;
  corner?: number;
  from?: number;
  hold?: boolean;
}): GestureFocus {
  switch (zone.kind) {
    case 'lane':
      return { side: Math.abs(zone.x ?? 0) < 0.12 ? 0 : Math.sign(zone.x ?? 0), fwd: 0 };
    case 'rail':
      return { side: 0, fwd: zone.from ?? Math.sign(zone.z ?? 0) };
    case 'gate':
      return zone.axis === 1
        ? { side: 0, fwd: Math.sign(zone.at ?? 0) }
        : { side: Math.sign(zone.at ?? 0), fwd: 0 };
    case 'quad':
      return { side: (zone.corner ?? 0) & 1 ? 1 : -1, fwd: (zone.corner ?? 0) & 2 ? 1 : -1, hold: zone.hold === true };
    default:
      return { side: 0, fwd: 0 };
  }
}

/** Per-chassis temperament: how big the gesture swings and how hard it
 *  snaps. The press is all servo; the king is all reach. */
export function gestureTemper(style: string): { amp: number; snap: number } {
  switch (style) {
    case 'piston':
      return { amp: 0.92, snap: 1.7 };
    case 'vulture':
      return { amp: 1.1, snap: 1.25 };
    case 'king':
      return { amp: 1.18, snap: 0.85 };
    case 'fortress':
      return { amp: 0.95, snap: 0.75 };
    default:
      return { amp: 1, snap: 1 };
  }
}

/** Ease a joint from rest to a target by the read's fill. */
function joints(a: ArmDelta, e: number, elbow: number, wrist: number, curl: number): void {
  a.elbow = lerp(ARM_REST.elbow, elbow, e);
  a.wrist = lerp(ARM_REST.wrist, wrist, e);
  a.curl = lerp(ARM_REST.curl, curl, e);
}

/** The classics' striking arm(s): the chosen arm, or both on a multi-target
 *  windup. */
function leads(focus: GestureFocus): [boolean, boolean] {
  const lead = focus.arm ?? armFor(focus.side);
  return [focus.both === true || lead === 0, focus.both === true || lead === 1];
}

/**
 * The WINDUP pose for a shape at charge `fill` (0..1 across the read).
 * `beatPhase` is the titan's pulse in beats (time / beat) for the shapes
 * that step in time (the march, the conductor) or tremble (the hammer at
 * the top, the cannon as it cooks); `focus` steers the pointing shapes.
 */
export function grammarGesture(
  shape: GestureShape,
  fill: number,
  focus: GestureFocus,
  beatPhase: number,
  amp = 1,
): GesturePose {
  const e = smooth(fill);
  const arms: [ArmDelta, ArmDelta] = [restArm(), restArm()];
  let lean = 0;
  let rise = 0;
  let gaze = 0;

  switch (shape) {
    case 'point': {
      // ONE arm levels down the strip — dead straight, the hand flat and
      // one finger out along it — the other tucks back, fist closed; a
      // centre lane points both.
      const lead = armFor(focus.side);
      for (const i of [0, 1] as const) {
        const pointing = focus.side === 0 || i === lead;
        if (pointing) {
          // A centre lane points BOTH — nearly parallel, a fist's width
          // apart, not converging into one another down the strip.
          arms[i].x = -1.55 * e;
          arms[i].z = -OUT[i] * (focus.side === 0 ? 0.18 : 0.35) * e;
          joints(arms[i], e, 0.05, 0.15, 0.1);
        } else {
          arms[i].x = 0.3 * e;
          arms[i].z = OUT[i] * 0.15 * e;
          joints(arms[i], e, 0.95, 0.1, 0.9);
        }
      }
      lean = 0.06 * e;
      gaze = 1;
      break;
    }
    case 'x': {
      // Both arms thrown STRAIGHT forward and ACROSS each other, fists
      // closed — the lattice made of iron before it's made of light. One
      // bar rides OVER the other: arm 0 high, arm 1 low, so the two cross
      // in front of the face with air between them instead of fusing on
      // the midline (a hinged elbow can't fold a forearm sideways, so the
      // X is two straight bars, not two folded ones).
      // The arms LIFT first, a little apart, to their staggered heights,
      // then swing in across each other — so an arm arriving late never
      // rises through the bar already in place.
      // (Pitches as the front reads them: through rigPitch the rest pose's
      // forward hang adds itself on, so these sit 0.35 under the old
      // behind-the-back values — the same bar heights, the high one still
      // clear of the visor.)
      const lift = smooth(fill / 0.55);
      const cross = smooth((fill - 0.4) / 0.6);
      for (const i of [0, 1] as const) {
        arms[i].x = (i === 0 ? -1.6 : -1.0) * lift;
        arms[i].z = OUT[i] * 0.2 * lift - OUT[i] * 1.0 * cross;
        joints(arms[i], lift, 0.15, 0.3, 1);
      }
      lean = -0.04 * e;
      break;
    }
    case 'scissor': {
      // Wings: both arms flat out to the sides for most of the read, dead
      // straight, hands open like blades — then the last third snaps the
      // forearms forward across the body — the jaws. The rail's own side
      // leads a touch higher.
      const close = smooth((fill - 0.66) / 0.34);
      for (const i of [0, 1] as const) {
        // The rail's own wing rides higher — until the jaws close, when the
        // stagger below owns the heights.
        const lead = ((i === 0 ? 1 : -1) === focus.fwd ? 0.25 : 0) * (1 - close);
        // Higher than the press's level spread — wings, not a shelf. The
        // jaws close as two straight bars, one OVER the other (arm 0 high,
        // arm 1 low), crossing in front of the face with air between them.
        // Closing, both bars drop 0.35 so the jaws meet at the old heights
        // now they meet IN FRONT (see the X, and rigPitch).
        arms[i].x = -(1.95 + lead) * e + ((i === 0 ? 0.0 : 0.6) + 0.35) * close;
        arms[i].z = OUT[i] * 1.3 * e - OUT[i] * 2.1 * close;
        joints(arms[i], e, lerp(0.08, 0.15, close), lerp(-0.25, 0.35, close), 0.15);
      }
      lean = 0.03 * e;
      gaze = 0.4;
      break;
    }
    case 'press': {
      // The gate: arms spread wide and level, then CLOSE toward the gap —
      // everything the hands sweep through burns; the band between them
      // lives. Open palms turned in, elbows folding as the hands come
      // together. A row gate presses forward/back instead of sideways.
      const spread = smooth(fill / 0.55);
      const close = smooth((fill - 0.55) / 0.45);
      for (const i of [0, 1] as const) {
        if (focus.fwd !== 0) {
          arms[i].x = -1.3 * spread + (focus.fwd > 0 ? -0.5 : 0.9) * close;
          arms[i].z = OUT[i] * 0.9 * spread - OUT[i] * 0.7 * close;
        } else {
          // The hands come in from both sides and STOP either side of the
          // gap — shifted toward its side so the body points at the answer.
          arms[i].x = -1.35 * spread - 0.1 * close;
          arms[i].z = OUT[i] * 1.25 * spread - OUT[i] * 1.0 * close + focus.side * 0.45 * close;
        }
        joints(arms[i], e, lerp(0.45, 0.95, close), 0.45, 0.05);
      }
      lean = (focus.fwd > 0 ? 0.08 : focus.fwd < 0 ? -0.05 : 0.04) * e;
      gaze = 0.7;
      break;
    }
    case 'ring': {
      // The donut: both arms up and OUT in a wide V, forearms folded in
      // over the crown, wrists cocked back — the hands FRAME the rim, a
      // hoop's width apart, never touching — the body goes up on its toes —
      // the rim is what comes down when they part.
      for (const i of [0, 1] as const) {
        arms[i].x = -2.1 * e;
        arms[i].z = OUT[i] * 0.45 * e;
        joints(arms[i], e, 1.0, -0.35, 0.6);
      }
      rise = 0.08 * e;
      lean = -0.05 * e;
      break;
    }
    case 'teach': {
      // THE LESSON: the king POINTS at the taught quarter — one arm level,
      // straight, one finger out, swung to the quarter's side, dipped for a
      // quarter near his feet, raised for one at the player's end — and his
      // head follows it. A HOLD step shows an open PALM instead: the same
      // arm, the wrist bent back, every finger spread — STAY.
      const lead = armFor(focus.side);
      const hold = focus.hold === true;
      for (const i of [0, 1] as const) {
        if (i === lead) {
          arms[i].x = (focus.fwd > 0 ? -1.4 : -0.95) * e;
          arms[i].z = (focus.fwd > 0 ? 0.6 : 0.45) * e * OUT[i];
          if (hold) joints(arms[i], e, 0.25, -1.0, 0);
          else joints(arms[i], e, 0.1, 0.2, 0.12);
        } else {
          // The off arm swings back and out — the teacher's stance, one
          // arm forward and one behind, nothing like the drumline's pump.
          arms[i].x = 0.6 * e;
          arms[i].z = OUT[i] * 0.5 * e;
          joints(arms[i], e, 0.85, 0.05, 0.9);
        }
      }
      lean = 0.05 * e;
      gaze = 1;
      break;
    }
    case 'conduct': {
      // THE RECITAL: the conductor. Both upper arms forward at chest
      // height, forearms folded UP, the baton hand's wrist beating time —
      // a small tick on every beat, the big flick coming on the cue
      // (grammarFollowThrough). Nothing here points at a quarter: the
      // answer lives in your ear now. A HOLD cue pushes the off hand
      // forward, wrist back, fingers spread — the palm that says STAY.
      const hold = focus.hold === true;
      const tick = Math.max(0, Math.sin((beatPhase % 1) * Math.PI * 2)) * 0.35;
      for (const i of [0, 1] as const) {
        arms[i].x = -1.15 * e;
        arms[i].z = OUT[i] * 0.3 * e;
        if (i === 0) {
          // The baton hand: fist closed, wrist ticking.
          joints(arms[i], e, 1.45, 0.2 + tick, 0.95);
        } else if (hold) {
          arms[i].x = -1.5 * e;
          arms[i].z = -OUT[i] * 0.15 * e;
          joints(arms[i], e, 0.35, -1.05, 0);
        } else {
          joints(arms[i], e, 1.3, 0.05, 0.5);
        }
      }
      lean = 0.03 * e;
      rise = 0.02 * e;
      gaze = 0;
      break;
    }
    case 'march': {
      // The drumline: arms pump in alternation on the beat — the forearm
      // folds as the arm rises and drives out as it falls — the whole
      // machine bobbing with them — the wave is a march before it's a fire.
      const ph = beatPhase % 2;
      const upA = smooth(Math.sin(ph * Math.PI) * 0.5 + 0.5);
      const pump = 0.35 + 0.65 * e;
      arms[0].x = (-1.6 * upA + 0.5 * (1 - upA)) * pump;
      arms[1].x = (-1.6 * (1 - upA) + 0.5 * upA) * pump;
      arms[0].z = OUT[0] * 0.2 * pump;
      arms[1].z = OUT[1] * 0.2 * pump;
      joints(arms[0], pump, lerp(0.4, 1.25, upA), 0.2, 1);
      joints(arms[1], pump, lerp(0.4, 1.25, 1 - upA), 0.2, 1);
      rise = Math.abs(Math.sin(ph * Math.PI)) * 0.03 * pump;
      lean = 0.05 * e;
      break;
    }
    case 'blade': {
      // The classic sweep's wind-out, on the arm the cut comes from: cocked
      // at the elbow, fist closed, ready to whip straight.
      const lead = armFor(focus.side);
      arms[lead].z = OUT[lead] * 1.7 * e;
      arms[lead].x = -0.4 * e;
      joints(arms[lead], e, 0.7, -0.2, 1);
      break;
    }

    /* ── the classics ─────────────────────────────────────────────────── */

    case 'hammer': {
      // THE SLAM. Two beats: the fist is DRAWN — the arm swings down and
      // back, the elbow cocking, the wrist breaking back — then HOISTED
      // sky-high, the forearm opening as it climbs, and at the top the
      // whole arm TREMBLES with the weight of what's coming. The off arm
      // braces low, fist shut; a multi-target slam hoists both.
      const draw = smooth(fill / 0.42);
      const hoist = smooth((fill - 0.42) / 0.58);
      const tremble = Math.max(0, (fill - 0.85) / 0.15) * Math.sin(beatPhase * 47) * 0.05;
      const [l0, l1] = leads(focus);
      for (const i of [0, 1] as const) {
        if (i === 0 ? l0 : l1) {
          arms[i].x = 0.55 * draw - 3.05 * hoist + tremble;
          arms[i].z = OUT[i] * 0.3 * draw - OUT[i] * 0.2 * hoist;
          arms[i].elbow = lerp(ARM_REST.elbow, 1.35, draw) - 0.6 * hoist;
          arms[i].wrist = lerp(ARM_REST.wrist, -0.55, draw) + 0.1 * hoist;
          arms[i].curl = lerp(ARM_REST.curl, 1, draw);
        } else {
          arms[i].x = -0.5 * e;
          arms[i].z = OUT[i] * 0.35 * e;
          joints(arms[i], e, 1.0, 0.1, 1);
        }
      }
      lean = 0.06 * hoist - 0.03 * draw;
      rise = 0.03 * hoist;
      gaze = 0.5;
      break;
    }
    case 'scythe': {
      // THE SWEEP. The cutting arm winds OUT wide and BACK, the forearm
      // gathering in behind it for the whip and then opening as the blade
      // is drawn, the fist locked; the off arm swings ACROSS the chest as a
      // counterweight and the body leans back off the swing. A squad sweep
      // winds both.
      const gather = smooth(fill / 0.6);
      const drawn = smooth((fill - 0.6) / 0.4);
      const [l0, l1] = leads(focus);
      for (const i of [0, 1] as const) {
        if (i === 0 ? l0 : l1) {
          arms[i].z = OUT[i] * (1.7 * gather + 0.25 * drawn);
          arms[i].x = -0.4 * gather - 0.3 * drawn;
          arms[i].elbow = lerp(ARM_REST.elbow, 1.0, gather) - 0.55 * drawn;
          arms[i].wrist = -0.35 * gather;
          arms[i].curl = lerp(ARM_REST.curl, 1, gather);
        } else {
          // The off arm swings BACK and out off the cut as the
          // counterweight — clear of the lane the blade whips through.
          arms[i].x = 0.5 * e;
          arms[i].z = OUT[i] * 0.4 * e;
          joints(arms[i], e, 0.9, 0.2, 1);
        }
      }
      lean = -0.04 * e;
      gaze = 0.4;
      break;
    }
    case 'cannon': {
      // THE BEAM. The firing arm locks STRAIGHT at you, fist shut — the
      // barrel — and the off hand comes across to brace its elbow; as the
      // shot cooks the whole arm shakes harder, and the eye follows the
      // barrel down the strip. The body leans into the recoil to come.
      const shake = smooth((fill - 0.55) / 0.45) * Math.sin(beatPhase * 61) * 0.04;
      const lead = focus.arm ?? 0;
      for (const i of [0, 1] as const) {
        if (i === lead) {
          arms[i].x = -1.55 * e + shake;
          arms[i].z = -OUT[i] * 0.15 * e;
          joints(arms[i], e, 0.02, 0.25, 1);
          arms[i].wrist += shake * 2;
        } else {
          arms[i].x = -1.2 * e;
          arms[i].z = -OUT[i] * 0.85 * e;
          joints(arms[i], e, 1.35, 0.3, 0.45);
        }
      }
      lean = 0.07 * e;
      gaze = 0.9;
      break;
    }
    case 'launcher': {
      // THE VOLLEY. The shoulder pods do the firing: the arms swing DOWN
      // and BACK, forearms folded tight, fists shut, and the body rocks
      // back on its heels to take the recoil — braced, not throwing. Every
      // shot's follow-through jolts it (grammarFollowThrough).
      for (const i of [0, 1] as const) {
        arms[i].x = 0.55 * e;
        arms[i].z = OUT[i] * 0.45 * e;
        joints(arms[i], e, 1.25, 0.2, 1);
      }
      lean = -0.08 * e;
      rise = 0.02 * e;
      gaze = 0.3;
      break;
    }
    case 'coil': {
      // THE NOVA. Wound like a spring: both arms drawn in TIGHT to the
      // body, elbows folded right up so the fists sit at the shoulders,
      // the machine hunched over them and crouched, the whole coil
      // trembling in time — before everything is thrown wide at once.
      const spin = Math.sin(beatPhase * Math.PI * 2) * e;
      for (const i of [0, 1] as const) {
        arms[i].x = -0.55 * e + 0.05 * spin;
        arms[i].z = OUT[i] * 0.1 * e;
        joints(arms[i], e, 2.25 + 0.1 * spin, 0.35, 1);
      }
      rise = -0.06 * e;
      lean = 0.07 * e;
      break;
    }
    case 'tilt': {
      // THE SEESAW. Both arms out FLAT to the sides like a balance beam,
      // straight, fingers spread — and the beam TIPS: the arm over the half
      // about to flood sinks, the other rises, the body leaning with it.
      // Read the tilt and you've read the flood.
      const low = armFor(focus.side);
      const tip = smooth((fill - 0.35) / 0.65);
      for (const i of [0, 1] as const) {
        const sink = i === low ? 1 : -1;
        arms[i].x = -1.5 * e + sink * 0.6 * tip;
        arms[i].z = OUT[i] * 1.35 * e;
        joints(arms[i], e, 0.08, sink * 0.25 * tip, 0);
      }
      lean = 0.04 * e;
      gaze = 0.5;
      break;
    }
    case 'shove': {
      // THE SURGE. Both palms come up and OUT at chest height, wrists
      // bent right back, the elbows drawn in behind them — then, in the
      // last stretch, the forearms start to drive: the flood is about to
      // be pushed at you.
      const drive = smooth((fill - 0.7) / 0.3);
      for (const i of [0, 1] as const) {
        arms[i].x = -1.0 * e - 0.25 * drive;
        arms[i].z = OUT[i] * 0.25 * e;
        joints(arms[i], e, lerp(1.25, 0.7, drive), -0.8, 0);
      }
      lean = 0.05 * e + 0.03 * drive;
      gaze = 0.6;
      break;
    }
  }

  for (const a of arms) {
    a.x *= amp;
    a.z *= amp;
  }
  return { arms, lean: lean * amp, rise, gaze };
}

/**
 * The FOLLOW-THROUGH after a landing fires — `k` runs 1 (the strike) → 0
 * (home) over the swing window. The gesture's promise is kept here: the
 * point JABS, the jaws CROSS, the press CLAPS, the ring SLAMS DOWN wide,
 * the teacher FLICKS, the conductor's baton comes DOWN (or the palm
 * PUSHES, on a hold), the drum PUMPS; the hammer is BURIED in the deck,
 * the scythe swings THROUGH, the cannon KICKS, the launcher JOLTS, the
 * coil is THROWN wide, the tilt's low hand SLAPS, the shove DRIVES. The
 * shoulder values are deltas to blend; the elbow/wrist/curl are the
 * absolute joint targets at the strike.
 */
export function grammarFollowThrough(shape: GestureShape, k: number, arm: 0 | 1, focus: GestureFocus): [ArmDelta, ArmDelta] {
  const arms: [ArmDelta, ArmDelta] = [restArm(), restArm()];
  const strike = (a: ArmDelta, elbow: number, wrist: number, curl: number): void => {
    a.elbow = lerp(ARM_REST.elbow, elbow, k);
    a.wrist = lerp(ARM_REST.wrist, wrist, k);
    a.curl = lerp(ARM_REST.curl, curl, k);
  };
  switch (shape) {
    case 'point': {
      const lead = focus.side === 0 ? arm : armFor(focus.side);
      arms[lead].x = -1.9 * k;
      arms[lead].z = -OUT[lead] * 0.3 * k;
      strike(arms[lead], 0, 0.5, 0.2); // the jab: arm locked, hand chopping down the strip
      break;
    }
    case 'x':
    case 'scissor':
      // The jaws CROSS — two straight bars, one over the other, the
      // windup's own stagger, so they pass with air between them.
      for (const i of [0, 1] as const) {
        arms[i].x = (i === 0 ? -1.85 : -1.2) * k;
        arms[i].z = -OUT[i] * 0.9 * k;
        strike(arms[i], 0.1, 0.4, 1);
      }
      break;
    case 'press':
      for (const i of [0, 1] as const) {
        arms[i].x = -1.3 * k;
        arms[i].z = -OUT[i] * 0.42 * k + focus.side * 0.3 * k;
        strike(arms[i], 1.0, 0.5, 0.1); // the clap — stopped a fist's width short
      }
      break;
    case 'ring':
      for (const i of [0, 1] as const) {
        arms[i].x = 0.9 * k;
        arms[i].z = OUT[i] * 1.4 * k;
        strike(arms[i], 0.1, 0.6, 0.7); // slammed down wide, arms thrown straight
      }
      break;
    case 'teach': {
      const lead = armFor(focus.side);
      arms[lead].x = -0.6 * k;
      arms[lead].z = OUT[lead] * 0.3 * k;
      strike(arms[lead], 0.2, focus.hold ? -0.9 : 0.7, focus.hold ? 0 : 0.2);
      break;
    }
    case 'conduct': {
      if (focus.hold) {
        // The palm PUSHES at you: stay.
        arms[1].x = -1.7 * k;
        arms[1].z = -OUT[1] * 0.2 * k;
        strike(arms[1], 0.15, -1.1, 0);
        arms[0].x = -1.15 * k;
        strike(arms[0], 1.45, 0.2, 0.95);
      } else {
        // The baton comes DOWN — the cue.
        arms[0].x = -0.8 * k;
        arms[0].z = OUT[0] * 0.3 * k;
        strike(arms[0], 0.6, 1.1, 0.95);
        arms[1].x = -1.15 * k;
        strike(arms[1], 1.3, 0.05, 0.5);
      }
      break;
    }
    case 'march':
      arms[arm].x = 0.9 * k;
      strike(arms[arm], 0.15, 0.3, 1); // driven straight down
      break;
    case 'blade':
      // Swung hard across the body (the classic sweep's own follow-through),
      // the arm whipping straight.
      // Swung through at chest height, in FRONT of the body, so the fist
      // clears the other arm's girder instead of passing through it.
      arms[arm].z = -OUT[arm] * 1.2 * k;
      arms[arm].x = -0.9 * k;
      strike(arms[arm], 0.05, 0.3, 1);
      break;

    /* ── the classics ─────────────────────────────────────────────────── */

    case 'hammer':
      // Buried in the deck: the arm driven straight down and through, the
      // wrist snapping over on the impact.
      arms[arm].x = 1.3 * k;
      arms[arm].z = -OUT[arm] * 0.14 * k;
      strike(arms[arm], 0.05, 0.65, 1);
      break;
    case 'scythe':
      // Swung THROUGH: across the body, the arm whipping straight.
      // Swung through at chest height, in FRONT of the body, so the fist
      // clears the other arm's girder instead of passing through it.
      arms[arm].z = -OUT[arm] * 1.2 * k;
      arms[arm].x = -0.9 * k;
      strike(arms[arm], 0.05, 0.3, 1);
      break;
    case 'cannon':
      // The recoil: the barrel kicks UP, the elbow giving a little.
      arms[arm].x = -2.0 * k;
      arms[arm].z = -OUT[arm] * 0.1 * k;
      strike(arms[arm], 0.35, -0.3, 1);
      break;
    case 'launcher':
      // A shot's jolt: both arms thrown back, the machine rocked.
      for (const i of [0, 1] as const) {
        arms[i].x = 0.95 * k;
        arms[i].z = OUT[i] * 0.5 * k;
        strike(arms[i], 1.35, 0.3, 1);
      }
      break;
    case 'coil':
      // THROWN wide: the coil released, both arms flung straight out and down.
      for (const i of [0, 1] as const) {
        arms[i].x = 0.9 * k;
        arms[i].z = OUT[i] * 1.4 * k;
        strike(arms[i], 0.1, 0.6, 0.7);
      }
      break;
    case 'tilt': {
      // The low hand SLAPS the flooding half down.
      const low = armFor(focus.side);
      arms[low].x = 0.55 * k;
      arms[low].z = OUT[low] * 1.35 * k;
      strike(arms[low], 0.05, 0.75, 0);
      const high = low === 0 ? 1 : 0;
      arms[high].x = -2.0 * k;
      arms[high].z = OUT[high] * 1.35 * k;
      strike(arms[high], 0.08, -0.2, 0);
      break;
    }
    case 'shove':
      // DRIVEN: both arms straight, palms out — the flood pushed at you.
      for (const i of [0, 1] as const) {
        arms[i].x = -1.45 * k;
        arms[i].z = OUT[i] * 0.2 * k;
        strike(arms[i], 0.05, -0.6, 0);
      }
      break;
  }
  return arms;
}
