/**
 * THE CROWD FIGURE — what a watcher looks like from the platforms.
 *
 * A fighter is THE BLANK: the lofted mannequin, painted, geared, solved by
 * IK against its platform. The terrace is not eight more of those — a
 * crowd reads as a crowd because it is simpler than the show it watches.
 * The house already has that figure: RAVE RAID's groupie, the slender neon
 * dancer that fills a 24-seat ring and stands about the club floor
 * (rave/game/avatars.ts). Same silhouette, same glowsticks, one neon each;
 * out at the rail in the dark, lit panels and a baton of light per fist are
 * exactly what carries a body across an arena.
 *
 * The wire brings a head. The hands are ours: at the sides while the
 * watcher is quiet, and up over the head as their HANDS-UP roar builds —
 * the one channel the audience has into the fighters' ears, made visible.
 */

import { Euler, Quaternion, Vector3 } from 'three';
import { buildDancer, type DancerPose } from '../../rave/game/avatars.js';

const _e = new Euler(0, 0, 0, 'YXZ');

/** Head to hand at rest (hanging at the sides), and at full roar (both
 *  fists over the head, a little inboard, the sticks pointing up). */
const HAND_REST_DROP = 0.55;
const HAND_UP_RISE = 0.28;
const SHOULDER = 0.22;

export interface CrowdFigure {
  root: import('three').Group;
  /** Place the figure under a head pose; `roar` 0..1 lifts the hands. */
  pose(head: Vector3, headQuat: Quaternion, roar: number, delta: number): void;
  dispose(): void;
}

export function buildCrowdFigure(seed = 0): CrowdFigure {
  // A neon each, spread around the wheel so a row at the rail is a row of
  // different lights rather than one colour repeated.
  const hue = ((seed * 0.618034) % 1 + 1) % 1;
  const rig = buildDancer(hue);
  // Far seats: the silhouette, the lit panels, the sticks and the halos —
  // the jewellery is millimetre work nobody sees from a platform.
  rig.setDetail(false);

  let lift = 0;
  // slump 0: standing — a watcher never melts (that is the ring's elimination).
  const p: DancerPose = { hx: 0, hy: 0, hz: 0, yaw: 0, pitch: 0, roll: 0, lx: 0, ly: 0, lz: 0, rx: 0, ry: 0, rz: 0, slump: 0 };
  return {
    root: rig.root,
    pose(head, headQuat, roar, delta) {
      _e.setFromQuaternion(headQuat, 'YXZ');
      const yaw = _e.y;
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      // Eased, so a flicker on the wire reads as a wave, not a twitch.
      const k = Math.min(1, Math.max(0, roar));
      lift += (k - lift) * Math.min(1, delta * 6);
      // Hands: shoulder-wide and a touch forward at rest; up they come in
      // toward the head's line, the way arms actually go over a head.
      const side = SHOULDER * (1 - lift * 0.35);
      const fwd = 0.12 * (1 - lift) + 0.05;
      const y = head.y - HAND_REST_DROP + (HAND_REST_DROP + HAND_UP_RISE) * lift;
      p.hx = head.x;
      p.hy = head.y;
      p.hz = head.z;
      p.yaw = yaw;
      p.pitch = _e.x;
      p.roll = _e.z;
      p.lx = head.x - rx * side + fx * fwd;
      p.ly = y;
      p.lz = head.z - rz * side + fz * fwd;
      p.rx = head.x + rx * side + fx * fwd;
      p.ry = y;
      p.rz = head.z + rz * side + fz * fwd;
      rig.pose(p);
    },
    dispose() {
      rig.root.removeFromParent();
      rig.dispose();
    },
  };
}
