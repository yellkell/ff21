#!/usr/bin/env node
/**
 * THE GESTURE LANGUAGE, headless — do a titan's arms ever mush into each
 * other, or into its own head?
 *
 *   node tools/gesture-check.mjs [--verbose]
 *   node tools/gesture-check.mjs --probe <shape>[:side,fwd]
 *
 * Pure forward kinematics, no browser: rebuilds the arm chain exactly as
 * bosses.ts hangs it (shoulder pivot → upper girder → elbow → forearm →
 * wrist → hand, at scale 1 on the king's 0.62 yoke) and poses it with
 * gestures.ts's own numbers, then measures the clearances between the two
 * arms and between each arm and the head:
 *
 *   - every WINDUP shape, across its fill, the beat phases that make it
 *     tick or tremble, every focus it can be asked for, every chassis amp;
 *   - every FOLLOW-THROUGH, across its swing, from either arm;
 *   - the LIVE BLEND CampaignSystem makes of the two (a strike decaying
 *     under the next windup, the idle twin walking home);
 *   - every HANDOVER from one held shape to the next, simulated the way
 *     animateTitan actually plays it: the strike's follow-through decays
 *     over the 0.6 s swing while the next read's windup rises from fill 0
 *     over its window, and every joint eases toward that target at the
 *     chassis's own rate (26 for the owned arm's snap, 7 × snap under a
 *     windup, 4 on the walk home), sampled at 60 Hz.
 *
 * A failure is two solids overlapping (hands through hands, forearms
 * through forearms, a fist inside the head). The margins are the rig's
 * real thicknesses plus a little air. Exit 1 on any failure.
 */

import { Group, Vector3 } from 'three';
import { ARM_REST, grammarFollowThrough, grammarGesture, rigFold, rigPitch } from '../src/campaign/gestures.ts';
import { guardDebug, keepArmsApart } from '../src/campaign/armGuard.ts';

const verbose = process.argv.includes('--verbose');
// --trace "<label fragment>" — print a matching handover frame by frame.
const traceAt = process.argv.indexOf('--trace');
const trace = traceAt >= 0 ? process.argv[traceAt + 1] : null;

// ── The rig, as bosses.ts builds it (scale 1, the king's 0.62 yoke) ──────────
const S = 1;
const YOKE_W = 0.62 * S;
const SHOULDER_Y = 1.22 * S;
const HEAD_Y = 1.5 * S;
const HEAD_R = 0.2 * S; // drum/visor/lamps run a touch past the 0.16 skull
// Solid radii for the clearance tests.
const R_UPPER = 0.07 * S; // 0.11 × 0.13 girder
const R_FORE = 0.06 * S; // 0.095 × 0.11 forearm
const R_ELBOW = 0.09 * S; // the elbow barrel + lamps, 0.17 long
const R_HAND = 0.16 * S; // the piston's 0.3 drop-forge block is the fattest fist
const AIR = 0.02 * S;

function buildArm(i) {
  const side = i === 0 ? -1 : 1;
  const pivot = new Group();
  pivot.position.set(side * (YOKE_W / 2 + 0.15 * S), SHOULDER_Y + 0.04 * S, 0);
  const elbow = new Group();
  elbow.position.y = -0.5 * S;
  pivot.add(elbow);
  const wrist = new Group();
  wrist.position.y = -0.42 * S;
  elbow.add(wrist);
  const hand = new Group();
  hand.position.y = -0.1 * S;
  wrist.add(hand);
  return { pivot, elbow, wrist, hand, fist: hand, restX: 0.18, restZ: side * 0.14 };
}

const root = new Group();
const arms = [buildArm(0), buildArm(1)];
for (const a of arms) root.add(a.pivot);

function posed(delta) {
  const out = [];
  for (const i of [0, 1]) {
    const arm = arms[i];
    const d = delta[i];
    // Onto the rig exactly as animateTitan puts it (gestures.ts rigPitch /
    // rigFold: the language's reaches and folds turned toward the player).
    arm.pivot.rotation.x = rigPitch(arm.restX, d.x);
    arm.pivot.rotation.z = arm.restZ + d.z;
    arm.elbow.rotation.x = rigFold(d.elbow);
    arm.wrist.rotation.x = rigFold(d.wrist);
  }
  root.updateMatrixWorld(true);
  for (const arm of arms) {
    out.push({
      P: arm.pivot.getWorldPosition(new Vector3()),
      E: arm.elbow.getWorldPosition(new Vector3()),
      W: arm.wrist.getWorldPosition(new Vector3()),
      H: arm.hand.getWorldPosition(new Vector3()),
    });
  }
  return out;
}

// ── Geometry ────────────────────────────────────────────────────────────────
function segSegDist(p1, q1, p2, q2) {
  // Ericson, Real-Time Collision Detection 5.1.9.
  const d1 = q1.clone().sub(p1);
  const d2 = q2.clone().sub(p2);
  const r = p1.clone().sub(p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s;
  let t;
  const EPS = 1e-9;
  if (a <= EPS && e <= EPS) return p1.distanceTo(p2);
  if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom !== 0 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = p1.clone().addScaledVector(d1, s);
  const c2 = p2.clone().addScaledVector(d2, t);
  return c1.distanceTo(c2);
}
function pointSegDist(p, a, b) {
  const ab = b.clone().sub(a);
  const t = Math.min(1, Math.max(0, p.clone().sub(a).dot(ab) / Math.max(ab.dot(ab), 1e-9)));
  return p.distanceTo(a.clone().addScaledVector(ab, t));
}

const HEAD = new Vector3(0, HEAD_Y, 0);

/** Every clearance test: [name, measured, required]. */
function clearances(j) {
  const [a, b] = j;
  const tests = [];
  tests.push(['hand↔hand', a.H.distanceTo(b.H), 2 * R_HAND + AIR]);
  tests.push(['fore↔fore', segSegDist(a.E, a.W, b.E, b.W), 2 * R_FORE + AIR]);
  tests.push(['upper↔upper', segSegDist(a.P, a.E, b.P, b.E), 2 * R_UPPER + AIR]);
  tests.push(['elbow↔elbow', a.E.distanceTo(b.E), 2 * R_ELBOW + AIR]);
  tests.push(['hand0↔fore1', pointSegDist(a.H, b.E, b.W), R_HAND + R_FORE + AIR]);
  tests.push(['hand1↔fore0', pointSegDist(b.H, a.E, a.W), R_HAND + R_FORE + AIR]);
  tests.push(['hand0↔upper1', pointSegDist(a.H, b.P, b.E), R_HAND + R_UPPER + AIR]);
  tests.push(['hand1↔upper0', pointSegDist(b.H, a.P, a.E), R_HAND + R_UPPER + AIR]);
  tests.push(['hand0↔elbow1', a.H.distanceTo(b.E), R_HAND + R_ELBOW + AIR]);
  tests.push(['hand1↔elbow0', b.H.distanceTo(a.E), R_HAND + R_ELBOW + AIR]);
  tests.push(['fore0↔upper1', segSegDist(a.E, a.W, b.P, b.E), R_FORE + R_UPPER + AIR]);
  tests.push(['fore1↔upper0', segSegDist(b.E, b.W, a.P, a.E), R_FORE + R_UPPER + AIR]);
  tests.push(['hand0↔head', a.H.distanceTo(HEAD), R_HAND + HEAD_R + AIR]);
  tests.push(['hand1↔head', b.H.distanceTo(HEAD), R_HAND + HEAD_R + AIR]);
  tests.push(['fore0↔head', pointSegDist(HEAD, a.E, a.W), R_FORE + HEAD_R + AIR]);
  tests.push(['fore1↔head', pointSegDist(HEAD, b.E, b.W), R_FORE + HEAD_R + AIR]);
  return tests;
}

// ── The cases ───────────────────────────────────────────────────────────────
const SHAPES = [
  'point', 'x', 'scissor', 'press', 'ring', 'teach', 'conduct', 'march', 'blade',
  'hammer', 'scythe', 'cannon', 'launcher', 'coil', 'tilt', 'shove',
];
const FOCI = [
  { side: 0, fwd: 0 },
  { side: 1, fwd: 0 },
  { side: -1, fwd: 0 },
  { side: 0, fwd: 1 },
  { side: 0, fwd: -1 },
  { side: 1, fwd: 1, hold: true },
  { side: -1, fwd: -1, hold: true },
  { side: 0, fwd: 0, arm: 0 },
  { side: 0, fwd: 0, arm: 1 },
  { side: 0, fwd: 0, arm: 0, both: true },
];
/** The chassis temperaments (gestures.ts gestureTemper): [amp, snap]. */
const CHASSIS = [
  [0.92, 1.7], // piston
  [1.18, 0.85], // king
  [0.95, 0.75], // fortress
  [1.1, 1.25], // vulture
];
const AMPS = CHASSIS.map(([amp]) => amp);
const FILLS = [0.3, 0.55, 0.8, 1];
const PHASES = [0, 0.13, 0.25, 0.4, 0.5, 0.62, 0.75, 0.9, 1.3, 1.7];

const rest = () => ({ x: 0, z: 0, elbow: ARM_REST.elbow, wrist: ARM_REST.wrist, curl: ARM_REST.curl });
const lerpArm = (a, b, t) => ({
  x: a.x + (b.x - a.x) * t,
  z: a.z + (b.z - a.z) * t,
  elbow: a.elbow + (b.elbow - a.elbow) * t,
  wrist: a.wrist + (b.wrist - a.wrist) * t,
  curl: 0,
});
const owns = (f) =>
  Math.abs(f.x) > 1e-6 ||
  Math.abs(f.z) > 1e-6 ||
  Math.abs(f.elbow - ARM_REST.elbow) > 1e-6 ||
  Math.abs(f.wrist - ARM_REST.wrist) > 1e-6 ||
  Math.abs(f.curl - ARM_REST.curl) > 1e-6;
const focusKey = (f) =>
  `s${f.side}f${f.fwd}${f.hold ? 'H' : ''}${f.arm !== undefined ? `a${f.arm}` : ''}${f.both ? 'B' : ''}`;

// --probe <shape>[:side,fwd] — print one shape's joints and clearances.
const probeArg = process.argv.find((a) => a.startsWith('--probe'));
if (probeArg) {
  const spec = probeArg.includes('=') ? probeArg.split('=')[1] : process.argv[process.argv.indexOf(probeArg) + 1];
  const [shape, side = '0', fwd = '0'] = spec.split(/[:,]/);
  const focus = { side: Number(side), fwd: Number(fwd), arm: 0 };
  const f3 = (v) => `(${v.x.toFixed(2)}, ${v.y.toFixed(2)}, ${v.z.toFixed(2)})`;
  const show = (label, delta) => {
    const j = posed(delta);
    console.log(`\n== ${label}`);
    for (const [i, a] of j.entries()) {
      const d = delta[i];
      console.log(
        `  arm${i}  E ${f3(a.E)}  W ${f3(a.W)}  H ${f3(a.H)}   x ${d.x.toFixed(2)} z ${d.z.toFixed(2)} elbow ${d.elbow.toFixed(2)} wrist ${d.wrist.toFixed(2)}`,
      );
    }
    const bad = clearances(j).filter(([, d, need]) => d < need);
    console.log(bad.length ? `  FAIL ${bad.map(([n, d, need]) => `${n} ${d.toFixed(3)}<${need.toFixed(2)}`).join(', ')}` : '  ok');
  };
  for (const amp of [0.92, 1.18]) {
    for (const fill of [0.5, 0.8, 1]) show(`${shape} windup fill ${fill} amp ${amp}`, grammarGesture(shape, fill, focus, 0.25, amp).arms);
  }
  for (const k of [0.5, 1]) for (const arm of [0, 1]) show(`${shape} follow k ${k} arm ${arm}`, grammarFollowThrough(shape, k, arm, focus));
  process.exit(0);
}

const failures = new Map(); // label → worst [test, measured, required]
let cases = 0;
/** `slack` forgives a shortfall inside the AIR margin: a handover frame the
 *  guard is holding sits a hair inside its own air, solids still apart. */
function check(label, delta, slack = 0) {
  cases++;
  const j = posed(delta);
  for (const [name, d, need] of clearances(j)) {
    if (d + slack < need) {
      const prev = failures.get(label);
      const short = need - d;
      if (!prev || short > prev.short) failures.set(label, { name, d, need, short });
    }
  }
}

// 1. Windups.
for (const shape of SHAPES) {
  for (const focus of FOCI) {
    for (const amp of AMPS) {
      for (const fill of FILLS) {
        for (const ph of PHASES) {
          const pose = grammarGesture(shape, fill, focus, ph, amp);
          check(`windup ${shape} ${focusKey(focus)} amp${amp} fill${fill} ph${ph}`, pose.arms);
        }
      }
    }
  }
}

// 2. Follow-throughs, and the live blend under a windup.
for (const shape of SHAPES) {
  for (const focus of FOCI) {
    for (const arm of [0, 1]) {
      for (const k of [0.35, 0.7, 1]) {
        const ft = grammarFollowThrough(shape, k, arm, focus);
        check(`follow ${shape} ${focusKey(focus)} arm${arm} k${k}`, ft);
        // The blend: the same shape's full windup under its own strike —
        // owned arms mix toward the strike, the others walk home.
        for (const amp of AMPS) {
          const w = grammarGesture(shape, 1, focus, 0.25, amp).arms;
          const blend = [0, 1].map((i) => (owns(ft[i]) ? lerpArm(w[i], ft[i], k) : lerpArm(rest(), w[i], k)));
          check(`blend ${shape} ${focusKey(focus)} arm${arm} k${k} amp${amp}`, blend);
        }
      }
    }
  }
}

// 3. Handovers: shape A's strike into shape B's read, played as animateTitan
//    plays it. The held states that differ in silhouette, per shape.
const HOLD_FOCI = {
  point: [{ side: 0, fwd: 0 }, { side: 1, fwd: 0 }],
  x: [{ side: 0, fwd: 0 }],
  scissor: [{ side: 0, fwd: 1 }, { side: 0, fwd: -1 }],
  press: [{ side: 0, fwd: 0 }, { side: 1, fwd: 0 }, { side: 0, fwd: 1 }, { side: 0, fwd: -1 }],
  ring: [{ side: 0, fwd: 0 }],
  teach: [{ side: 1, fwd: 1 }, { side: -1, fwd: -1 }, { side: 1, fwd: 1, hold: true }],
  conduct: [{ side: 0, fwd: 0 }, { side: 0, fwd: 0, hold: true }],
  march: [{ side: 0, fwd: 0 }],
  blade: [{ side: 1, fwd: 0 }, { side: -1, fwd: 0 }],
  hammer: [{ side: 0, fwd: 0, arm: 0 }, { side: 0, fwd: 0, arm: 1 }, { side: 0, fwd: 0, arm: 0, both: true }],
  scythe: [{ side: 0, fwd: 0, arm: 0 }, { side: 0, fwd: 0, arm: 1 }, { side: 0, fwd: 0, arm: 0, both: true }],
  cannon: [{ side: 0, fwd: 0, arm: 0 }, { side: 0, fwd: 0, arm: 1 }],
  launcher: [{ side: 0, fwd: 0 }],
  coil: [{ side: 0, fwd: 0 }],
  tilt: [{ side: 1, fwd: 0 }, { side: -1, fwd: 0 }],
  shove: [{ side: 0, fwd: 0 }],
};
const SWING = 0.6;
const DT = 1 / 60;
const WINDOWS = [0.35, 0.9];
let guardHits = 0;
let handoverSteps = 0;
for (const [amp, snap] of CHASSIS) {
  const holds = [];
  for (const shape of SHAPES) for (const focus of HOLD_FOCI[shape]) holds.push({ shape, focus, key: `${shape}/${focusKey(focus)}` });
  // No next read at all: the idle arms walk home from the last windup.
  const targets = [...holds, { shape: null, focus: null, key: 'rest' }];
  for (const from of holds) {
    // Which arms the strike owns decides which follow-throughs exist.
    const strikeArms = [0, 1].filter((arm) => grammarFollowThrough(from.shape, 1, arm, from.focus).some(owns));
    for (const arm of strikeArms.length ? strikeArms : [0]) {
      for (const to of targets) {
        for (const win of WINDOWS) {
          // The joints start settled on A's full windup.
          const state = grammarGesture(from.shape, 1, from.focus, 0.25, amp).arms.map((a) => ({ ...a }));
          const lastWind = state.map((a) => ({ ...a }));
          const memo = { dir: 0 };
          const label = `handover ${from.key} (arm${arm}) → ${to.key} win${win} amp${amp}`;
          for (let t = 0; t <= SWING + win + 0.3; t += DT) {
            const swing = Math.max(0, SWING - t);
            const swingK = swing > 0 ? swing / SWING : 0;
            const fill = Math.min(1, t / win);
            const pose = to.shape ? grammarGesture(to.shape, fill, to.focus, t / 0.5, amp).arms : null;
            const ft = swingK > 0 ? grammarFollowThrough(from.shape, swingK, arm, from.focus) : null;
            for (const i of [0, 1]) {
              const owned = !!ft && owns(ft[i]);
              let target;
              if (pose) target = owned ? lerpArm(pose[i], ft[i], swingK) : pose[i];
              else if (owned) target = ft[i];
              else target = lerpArm(rest(), lastWind[i], swingK);
              const rate = swing > 0.45 && owned ? 26 : pose || swingK > 0 ? 7 : 4;
              const ease = Math.min(1, DT * rate * snap);
              const s = state[i];
              s.x += (target.x - s.x) * ease;
              s.z += (target.z - s.z) * ease;
              s.elbow += (target.elbow - s.elbow) * ease;
              s.wrist += (target.wrist - s.wrist) * ease;
            }
            // The clearance guard runs on the eased state, as animateTitan
            // runs it — and what it pushes, stays pushed.
            handoverSteps++;
            posed(state);
            const pushed = keepArmsApart(arms, S, memo);
            if (pushed > 0) {
              guardHits++;
              for (const i of [0, 1]) {
                state[i].x = arms[i].restX - arms[i].pivot.rotation.x;
                state[i].z = arms[i].pivot.rotation.z - arms[i].restZ;
              }
            }
            if (trace && label.includes(trace)) {
              const j = posed(state);
              const hh = j[0].H.distanceTo(j[1].H);
              const ff = segSegDist(j[0].E, j[0].W, j[1].E, j[1].W);
              console.log(
                `  t${t.toFixed(2)} hand↔hand ${hh.toFixed(3)} fore↔fore ${ff.toFixed(3)} push ${pushed.toFixed(3)}  H0 (${j[0].H.x.toFixed(2)}, ${j[0].H.y.toFixed(2)}, ${j[0].H.z.toFixed(2)})  H1 (${j[1].H.x.toFixed(2)}, ${j[1].H.y.toFixed(2)}, ${j[1].H.z.toFixed(2)})  z0 ${state[0].z.toFixed(2)} z1 ${state[1].z.toFixed(2)} x0 ${state[0].x.toFixed(2)} x1 ${state[1].x.toFixed(2)}  ${guardDebug.last}`,
              );
            }
            check(`${label} t${t.toFixed(2)}`, state, AIR);
          }
        }
      }
    }
  }
}

// ── Report ──────────────────────────────────────────────────────────────────
const groups = new Map();
for (const [label, f] of failures) {
  const kind = label.split(' ')[0];
  let key;
  if (kind === 'handover') {
    const m = label.match(/^handover (\S+) \(arm\d\) → (\S+)/);
    key = `handover ${m[1].split('/')[0]} → ${m[2].split('/')[0]}`;
  } else {
    key = `${kind} ${label.split(' ')[1]}`;
  }
  const e = groups.get(key) ?? { count: 0, worst: null, label: '' };
  e.count++;
  if (!e.worst || f.short > e.worst.short) {
    e.worst = f;
    e.label = label;
  }
  groups.set(key, e);
}
console.log(
  `gesture-check: ${cases} poses, ${failures.size} with an overlap; the guard stepped in on ${guardHits} of ${handoverSteps} handover frames\n`,
);
const rows = [...groups.entries()].sort((a, b) => b[1].worst.short - a[1].worst.short);
for (const [key, e] of rows) {
  console.log(
    `  ${key.padEnd(30)} ${String(e.count).padStart(5)} poses   worst ${e.worst.name.padEnd(13)} ${e.worst.d.toFixed(3)} < ${e.worst.need.toFixed(3)}  (${e.label})`,
  );
}
if (verbose) {
  console.log('');
  for (const [label, f] of [...failures.entries()].sort((a, b) => b[1].short - a[1].short)) {
    console.log(`  ${f.name.padEnd(13)} ${f.d.toFixed(3)} < ${f.need.toFixed(3)}  ${label}`);
  }
}
process.exit(failures.size > 0 ? 1 : 0);
