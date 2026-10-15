/**
 * BODY CLEARANCE — the MC's arms go AROUND him, never through him.
 *
 * His mimes are written as hand targets, and a target only says where a
 * fist should END UP: a sweep thrown across his chest at neck height, a
 * crossfire dragged over to the far rail, the gather hauled in to his
 * sternum, a trident slash cocked over the far shoulder — every one of them
 * put a straight line from the shoulder to the fist straight through his
 * cuirass or his helmet, and the underdamped hand springs (PoseMotion)
 * whip every strike a little further in. The rig has no idea it is a body;
 * the groupies get away with it at their size, a 3.4 m headliner does not.
 *
 * So, after the motion layer and before the frame is drawn, the RENDERED
 * pose runs through `clearBody`: the rig is solved, every arm segment
 * (and, while it is out, the trident's whole shaft) is sampled against his
 * body — an elliptical column for the armoured torso, a round one for the
 * helmet, both turned with his yaw — and any fist whose arm cuts in is
 * slid out around the FRONT of him until the whole chain clears (the
 * spear, rigid in both fists, takes the nearest way round). A swing
 * across the body becomes a swing in front of it, which is what a swing
 * across a body is. Only the drawn pose is touched: the springs keep their
 * own state, so the clearance never feeds back into the dynamics.
 *
 * Rig-local metres (the rig's own human scale — root scale is applied on
 * top), measured off the suit (tools/blender/mc_suit.py).
 */

import { Vector3 } from 'three';
import type { DancerPose, DancerRig } from './avatars.js';

/** The cuirass: 0.108 × 1.15 across, 0.108 × 0.88 deep, plus the chevrons
 *  and the platter's bezel standing proud of the plate. */
const CHEST_A = 0.125;
const CHEST_B = 0.105;
/** The cuirass rides a few centimetres over the shoulder line (the yoke
 *  dome); the fauld and the hip plates carry the column down to the hips. */
const CHEST_TOP = 0.03;
const HIP_SKIRT = 0.04;
/** The helmet — shell, cans and fins — and how far its crown stands above
 *  the head centre. Anything higher is clear air. */
const HEAD_R = 0.1;
const HEAD_TOP = 0.11;
/** Half-thicknesses of what is being kept out. The arm is slim on purpose:
 *  the shoulder joint sits on the cuirass's edge, and an arm resting
 *  against its own side is a body, not a collision. */
const ARM_R = 0.02;
const FIST_R = 0.055;
const SHAFT_R = 0.025;
/** Anything less than this far (× depth) behind his centre line is shoved
 *  out of his front; only what is really behind him goes out the back. */
const BIAS = 0.35;
/** A segment point near the shoulder needs the fist to move further than
 *  the point itself; past this lever the iteration finishes the job. */
const MAX_LEVER = 4;
const PASSES = 4;
/** Below this (metres) a push is noise. */
const EPS = 0.002;

/** Trident-space extents along the shaft (arena/trident.ts BOTTOM/TOP),
 *  sampled every 0.2 m. */
const SHAFT_SAMPLES = [-0.62, -0.42, -0.22, 0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.36];
/** Arm samples, as fractions along shoulder → elbow and elbow → fist. */
const UPPER_T = [0.35, 0.65, 1];
const FORE_T = [0.35, 0.7];

interface Frame {
  cx: number;
  cz: number;
  cos: number;
  sin: number;
  hipY: number;
  shY: number;
  headY: number;
}

const _push = new Vector3();
const _p = new Vector3();
const _best = new Vector3();
const _shaft = new Vector3();
const _move = [new Vector3(), new Vector3()];

/**
 * How far point `q` (rig-local, half-thickness `r`) must move to stand
 * clear of the body — written into `out`, zero when it already does.
 * Limbs go out of his FRONT (`radial` false); the rigid shaft goes out
 * along the nearest way round (`radial`), because his arms may already be
 * at full stretch and the only way left for the spear is to his side.
 */
function pushOut(f: Frame, q: Vector3, r: number, out: Vector3, radial = false): Vector3 {
  out.set(0, 0, 0);
  if (q.y < f.hipY - HIP_SKIRT || q.y > f.headY + HEAD_TOP) return out;
  const head = q.y > f.shY + CHEST_TOP;
  const A = (head ? HEAD_R : CHEST_A) + r;
  const B = (head ? HEAD_R : CHEST_B) + r;
  // Into the body's frame: u across (his right), w forward (his front).
  const dx = q.x - f.cx;
  const dz = q.z - f.cz;
  const u = dx * f.cos - dz * f.sin;
  const w = -dx * f.sin - dz * f.cos;
  const e = Math.hypot(u / A, w / B);
  if (e >= 1) return out;
  let pu = 0;
  let pw: number;
  if (radial && e > 0.05) {
    pu = u / e - u;
    pw = w / e - w;
  } else {
    // Straight out of his FRONT (or his back, for what is really behind
    // him) — never sideways: a sideways shove on an arm crossing his chest
    // only drags its fist further across, where it can never come clear.
    const face = B * Math.sqrt(1 - (u / A) ** 2);
    pw = (w > -BIAS * B ? face : -face) - w;
  }
  // Back out to rig-local: right = (cos, 0, −sin), forward = (−sin, 0, −cos).
  out.set(pu * f.cos - pw * f.sin, 0, -pu * f.sin - pw * f.cos);
  return out;
}

/** The deepest push along one segment, scaled up by the lever back to the
 *  fist, folded into `acc` if it beats what is already there. */
function sampleSegment(
  f: Frame,
  a: Vector3,
  b: Vector3,
  ts: number[],
  shoulder: Vector3,
  reach: number,
  acc: Vector3,
): void {
  for (const t of ts) {
    _p.copy(a).lerp(b, t);
    pushOut(f, _p, ARM_R, _push);
    const d = _push.length();
    if (d < EPS) continue;
    const lever = Math.min(MAX_LEVER, reach / Math.max(1e-3, _p.distanceTo(shoulder)));
    if (d * lever > acc.length()) acc.copy(_push).multiplyScalar(lever);
  }
}

/**
 * Solve `p` on `rig` with every arm (and `shaft`, the trident's aim while
 * it is out in his right fist) clear of his body. `out` receives the
 * cleared pose and is what the rig is left posed with.
 */
export function clearBody(rig: DancerRig, p: DancerPose, out: DancerPose, shaft: Vector3 | null): void {
  Object.assign(out, p);
  const m = rig.mount;
  if (!m) {
    rig.pose(out);
    return;
  }
  for (let pass = 0; ; pass++) {
    rig.pose(out);
    if (pass === PASSES) return;
    const f: Frame = {
      cx: m.head.position.x,
      cz: m.head.position.z,
      cos: Math.cos(out.yaw),
      sin: Math.sin(out.yaw),
      hipY: m.pelvis.position.y,
      shY: m.upperL.position.y,
      headY: m.head.position.y,
    };
    let moved = false;
    for (let i = 0; i < 2; i++) {
      const left = i === 0;
      const sh = (left ? m.upperL : m.upperR).position;
      const el = (left ? m.foreL : m.foreR).position;
      const fist = (left ? m.handL : m.handR).position;
      // The lever runs to the TARGET, not the solved fist: a target past
      // arm's reach is clamped by the solve, and only turns the arm by
      // what it moves over its own distance from the shoulder.
      _p.set(left ? out.lx : out.rx, left ? out.ly : out.ry, left ? out.lz : out.rz);
      const reach = Math.max(1e-3, _p.distanceTo(sh));
      _best.set(0, 0, 0);
      sampleSegment(f, sh, el, UPPER_T, sh, reach, _best);
      sampleSegment(f, el, fist, FORE_T, sh, reach, _best);
      pushOut(f, fist, FIST_R, _push);
      if (_push.length() > _best.length()) _best.copy(_push);
      _move[i].copy(_best);
    }
    if (shaft) {
      // The weapon is rigid in the right fist and the left is choked down
      // it: whatever clears the shaft moves both hands together.
      _best.set(0, 0, 0);
      for (const s of SHAFT_SAMPLES) {
        _shaft.copy(m.handR.position).addScaledVector(shaft, s);
        pushOut(f, _shaft, SHAFT_R, _push, true);
        if (_push.length() > _best.length()) _best.copy(_push);
      }
      if (_best.lengthSq() > 0) {
        for (const v of _move) if (_best.length() > v.length()) v.copy(_best);
      }
    }
    if (_move[0].length() >= EPS) {
      out.lx += _move[0].x;
      out.lz += _move[0].z;
      moved = true;
    }
    if (_move[1].length() >= EPS) {
      out.rx += _move[1].x;
      out.rz += _move[1].z;
      moved = true;
    }
    if (!moved) return;
  }
}
