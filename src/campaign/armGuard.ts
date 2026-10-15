/**
 * THE CLEARANCE GUARD — the last word on a titan's arms every frame.
 *
 * The gesture language (gestures.ts) is written so no held pose puts one
 * arm through the other, and tools/gesture-check.mjs proves it. But a
 * pose is a destination: the joints ease toward it from wherever the last
 * move left them, the arm a strike owns snaps while its twin ambles, and a
 * cascade can hand a buried hammer straight into a crossing windup (THE
 * X). On the way, two fists can meet on the midline and read as one lump
 * of iron, or a rising forearm can pass through the other girder.
 *
 * So after the easing, this measures the two arms — each three solids in
 * the rig's own space: the upper girder, the forearm shaft, the fist — and,
 * if any pair would touch, moves both shoulders by just enough to keep air
 * between them: a sideways yaw when one fist is beside the other, a pitch
 * STAGGER (the bar already above goes up, the other down — the stagger
 * THE X and the scissor's jaws are built on) when two bars actually
 * cross. It moves the EASED state, not the target, so the arms hold at
 * contact distance until the pose itself carries them clear — no
 * fighting, no jitter — and it is a no-op on every pose the language
 * actually holds.
 */

import { Matrix4, Vector3, type Object3D } from 'three';

/** The joints the guard reads — bosses.ts's TitanArm satisfies this. */
export interface GuardArm {
  pivot: Object3D;
  elbow: Object3D;
  wrist: Object3D;
  fist: Object3D;
}

/** The guard's memory across frames: which way it last pushed sideways
 *  (0 = clear). One per rig. */
export interface GuardMemo {
  dir: number;
}

/** What the guard last did, for tools/gesture-check.mjs --trace. */
export const guardDebug = { last: '' };

/** Solid radii in scale-1 body units (bosses.ts: a 0.11 × 0.13 upper
 *  girder, a 0.095 × 0.11 forearm, and the piston's 0.3 drop-forge block is
 *  the fattest fist), plus a breath of air between them. */
const R_UPPER = 0.07;
const R_SHAFT = 0.07;
const R_FIST = 0.16;
const AIR = 0.02;
/** A girder's closest point this near the shoulder root doesn't count as
 *  the bar crossing something — that's the pauldron's business. */
const ROOT = 0.08;

/** The three solids per arm: the upper girder (pivot→elbow), the forearm
 *  shaft (elbow→wrist) and the fist (a sphere at the hand). */
type Solid = 0 | 1 | 2;
const RADIUS: readonly number[] = [R_UPPER, R_SHAFT, R_FIST];
const PAIRS: ReadonlyArray<readonly [Solid, Solid]> = [
  [0, 0], [0, 1], [0, 2],
  [1, 0], [1, 1], [1, 2],
  [2, 0], [2, 1], [2, 2],
];

const _m = new Matrix4();
/** Per arm, in the pivot's frame before the shoulder turns. */
const _localE: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _localW: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _localH: [Vector3, Vector3] = [new Vector3(), new Vector3()];
/** Per arm, rig-local: pivot, elbow, wrist, fist. */
const _P: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _E: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _W: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _H: [Vector3, Vector3] = [new Vector3(), new Vector3()];
const _d1 = new Vector3();
const _d2 = new Vector3();
const _r = new Vector3();
const _c1 = new Vector3();
const _c2 = new Vector3();
const _q = new Vector3();
const _st = { s: 0, t: 0 };

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Closest points of segments p1q1 / p2q2 (Ericson, RTCD 5.1.9; a point is
 *  a segment with q = p). Fills c1, c2 and the parameters; returns the
 *  distance. */
function closest(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3, c1: Vector3, c2: Vector3): number {
  _d1.subVectors(q1, p1);
  _d2.subVectors(q2, p2);
  _r.subVectors(p1, p2);
  const a = _d1.dot(_d1);
  const e = _d2.dot(_d2);
  const f = _d2.dot(_r);
  const EPS = 1e-9;
  let s = 0;
  let t = 0;
  if (a > EPS || e > EPS) {
    if (a <= EPS) {
      t = clamp01(f / e);
    } else {
      const c = _d1.dot(_r);
      if (e <= EPS) {
        s = clamp01(-c / a);
      } else {
        const b = _d1.dot(_d2);
        const denom = a * e - b * b;
        s = denom !== 0 ? clamp01((b * f - c * e) / denom) : 0;
        t = (b * s + f) / e;
        if (t < 0) {
          t = 0;
          s = clamp01(-c / a);
        } else if (t > 1) {
          t = 1;
          s = clamp01((b - c) / a);
        }
      }
    }
  }
  _st.s = s;
  _st.t = t;
  c1.copy(p1).addScaledVector(_d1, s);
  c2.copy(p2).addScaledVector(_d2, t);
  return c1.distanceTo(c2);
}

const start = (i: 0 | 1, k: Solid): Vector3 => (k === 0 ? _P[i] : k === 1 ? _E[i] : _H[i]);
const end = (i: 0 | 1, k: Solid): Vector3 => (k === 0 ? _E[i] : k === 1 ? _W[i] : _H[i]);
/** Is this solid, at this point along it, a BAR that can cross the other
 *  arm's bar? Girder and shaft are, except right at the shoulder root; a
 *  fist is a blob. */
const bar = (k: Solid, u: number): boolean => (k === 0 ? u > ROOT : k === 1);

/** A point along an arm's solid, in the pivot's frame AFTER its yaw but
 *  BEFORE its pitch — the frame a pitch swings it in. */
function prePitch(a: GuardArm, i: 0 | 1, k: Solid, u: number, out: Vector3): Vector3 {
  if (k === 0) out.copy(_localE[i]).multiplyScalar(u);
  else if (k === 1) out.copy(_localE[i]).lerp(_localW[i], u);
  else out.copy(_localH[i]);
  const th = a.pivot.rotation.z;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const x = out.x * c - out.y * s;
  const y = out.x * s + out.y * c;
  out.x = x;
  out.y = y;
  return out;
}

/**
 * Keep the two arms from overlapping, by moving both shoulders apart in
 * the rig's frame. Call after the joints have been eased for the frame,
 * before rendering. `scale` is the titan's body scale (bosses.ts
 * def.scale); `memo` (one per rig) keeps the sideways push steady while a
 * contact lasts. Returns how far apart they were pushed (0 when nothing
 * touched).
 */
export function keepArmsApart(arms: readonly [GuardArm, GuardArm], scale: number, memo?: GuardMemo): number {
  // Up to three passes: each clears the worst-overlapping pair, and a fist
  // pressed against a shaft can hide a fist-on-fist contact behind it.
  let total = 0;
  for (let pass = 0; pass < 3; pass++) {
    const pushed = guardPass(arms, scale, memo);
    if (pushed <= 0) {
      if (pass === 0) {
        if (memo) memo.dir = 0;
        guardDebug.last = '';
      }
      break;
    }
    total += pushed;
  }
  return total;
}

function guardPass(arms: readonly [GuardArm, GuardArm], scale: number, memo?: GuardMemo): number {
  for (const i of [0, 1] as const) {
    const a = arms[i];
    a.pivot.updateMatrix();
    a.elbow.updateMatrix();
    a.wrist.updateMatrix();
    _P[i].copy(a.pivot.position);
    _localE[i].copy(a.elbow.position);
    _localW[i].copy(a.wrist.position).applyMatrix4(a.elbow.matrix);
    _m.copy(a.elbow.matrix).multiply(a.wrist.matrix);
    _localH[i].copy(a.fist.position).applyMatrix4(_m);
    _E[i].copy(_localE[i]).applyMatrix4(a.pivot.matrix);
    _W[i].copy(_localW[i]).applyMatrix4(a.pivot.matrix);
    _H[i].copy(_localH[i]).applyMatrix4(a.pivot.matrix);
  }

  // The worst-overlapping pair of solids decides the move.
  let short = 0;
  let kA: Solid = 2;
  let kB: Solid = 2;
  let uA = 0;
  let uB = 0;
  let above: 0 | 1 = 0;
  for (const [ka, kb] of PAIRS) {
    const d = closest(start(0, ka), end(0, ka), start(1, kb), end(1, kb), _c1, _c2);
    const need = (RADIUS[ka] + RADIUS[kb] + AIR) * scale;
    if (need - d > short) {
      short = need - d;
      kA = ka;
      kB = kb;
      uA = _st.s;
      uB = _st.t;
      above = _c1.y >= _c2.y ? 0 : 1;
    }
  }
  if (short <= 0) return 0;
  const push = short / 2;
  guardDebug.last = `${kA}@${uA.toFixed(2)} vs ${kB}@${uB.toFixed(2)} above${above} short${short.toFixed(3)}`;

  // Two BARS crossing: no sideways shove separates them — STAGGER them, the
  // one already above up and the other down, by pitching each shoulder. A
  // pitch swings a point in the pivot's YZ plane; its lift per radian at
  // the crossing sizes the move. Fists are blobs, not bars — they take the
  // sideways route below, and so does a hanging arm, whose pitch barely
  // lifts it.
  if (bar(kA, uA) && bar(kB, uB)) {
    let lift0 = 0;
    let lift1 = 0;
    for (const i of [0, 1] as const) {
      const a = arms[i];
      prePitch(a, i, i === 0 ? kA : kB, i === 0 ? uA : uB, _q);
      const th = a.pivot.rotation.x;
      const liftPerRad = -_q.y * Math.sin(th) - _q.z * Math.cos(th);
      if (i === 0) lift0 = liftPerRad;
      else lift1 = liftPerRad;
    }
    if (Math.abs(lift0) >= 0.15 * scale && Math.abs(lift1) >= 0.15 * scale) {
      arms[0].pivot.rotation.x += ((above === 0 ? 1 : -1) * push) / lift0;
      arms[1].pivot.rotation.x += ((above === 1 ? 1 : -1) * push) / lift1;
      guardDebug.last += ' stagger';
      return short;
    }
  }

  // Push the two arms apart SIDEWAYS. A shoulder yaw moves the hand toward
  // +x on either arm (the arm hangs below its pivot, so rotating about z
  // swings it across) by roughly the fist's drop per radian. The side each
  // arm is pushed to is the side its fist is already on — read from the
  // fists' own lateral order, not the contact's closest points (those hop
  // between shaft and fist as an arm rises past the other, and a flipping
  // sign would drag the pair back through each other) — and remembered
  // while the contact lasts, so a rising arm is HELD beside the other fist
  // until it has cleared it, then crosses. Crossed fists cross further
  // apart.
  const dx = _H[0].x - _H[1].x;
  let dir = memo?.dir ?? 0;
  if (dir === 0 || Math.abs(dx) > 0.05 * scale) dir = dx >= 0 ? 1 : -1;
  if (memo) memo.dir = dir;
  for (const i of [0, 1] as const) {
    const a = arms[i];
    const p = _localH[i];
    const th = a.pivot.rotation.z;
    const perRad = Math.max(-p.y * Math.cos(th) - p.x * Math.sin(th), 0.2 * scale);
    a.pivot.rotation.z += ((i === 0 ? dir : -dir) * push) / perRad;
  }
  guardDebug.last += ' yaw';
  return short;
}
