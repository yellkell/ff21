/**
 * THE BLANK ON THE RING — Rave Raid's dancers wear FIRE FIGHT's body
 * (DESIGN §5.4 · §7: "its dancers wear your mannequin + paint").
 *
 * Same contract as game/avatars.ts (`DancerRig`: a head position, two
 * hand targets, a slump), so every system that drives a figure — the
 * groupies and remote humans on the ring, the MC on the stage (a giant of
 * the dancers' own kind, now a giant BLANK), the room-mates on the club
 * floor, your own reflection in the pier glass — swaps in without knowing.
 * The couture figure stays in avatars.ts for reference; nothing builds it.
 *
 * What changes: the body is `avatar/boxer.ts`'s rig — the one-piece lofted
 * blank, the free-floating head, the gauntlets — solved by the same IK the
 * arena uses for a rival (`solveTorso`), dressed by the same gear and
 * paint bakes (`applyGear`, `applyLook`) so YOUR figure here is the body
 * everyone sees in the arena. The seat's neon lives where the blank keeps
 * its accent — the gauntlets' glow — and in the GLOWSTICKS: a baton of
 * light rising out of each fist, white-hot core, hue in the halo.
 */

import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  type Sprite,
  TorusGeometry,
  Vector3,
} from 'three';
import { buildBoxer, setAvatarAccent, solveTorso } from '../../avatar/boxer.js';
import { HAND_ADDUCTION, HAND_REST_CURL, setHandCurl, setHandGrip } from '../../avatar/hands.js';
import { toneSkinId, type BlankTone } from '../../avatar/mannequin.js';
import { applyGear } from '../../avatar/gear.js';
import { applyLook, type Look } from '../../avatar/paint.js';
import { glowSprite } from '../materials/glow.js';
import { hueToColor } from '../config.js';
import { ACCENT_REST, type DancerAccent, type DancerPose, type DancerRig } from './avatars.js';

export { ACCENT_REST, accentHex, type DancerAccent, type DancerPose, type DancerRig } from './avatars.js';

/** How a figure is dressed. Bots and strangers come bare; YOUR rig (the
 *  mirror) wears your tone, gear and paint. */
export interface BlankDress {
  tone?: BlankTone;
  gear?: readonly string[];
  look?: Look;
  /** The glowsticks — a baton of light out of each fist. On by default
   *  (the ring, the course); the club floor and its mirror turn them off. */
  sticks?: boolean;
}

/* Figure proportions the solver needs (the blank's are in avatar/boxer's
 * BODY_IK; these are the dancer-space offsets the RR pose grammar uses). */
const SHOULDER_W = 0.2; // half-width, for the forearm line the sticks ride
const SHOULDER_DROP = 0.17;
const PITCH_MAX = 1.15;
const ROLL_MAX = 0.6;
const CROWN_RISE = 0.24;
const STICK_HOT = 0.72;

const UP = new Vector3(0, 1, 0);
const _head = new Vector3();
const _headQ = new Quaternion();
const _handQ = new Quaternion();
const _euler = new Euler(0, 0, 0, 'YXZ');
const _chest = new Vector3();
const _pelvis = new Vector3();
const _right = new Vector3();
const _fwd = new Vector3();
const _yawQ = new Quaternion();
const _hint = new Vector3();
const _shoulder = new Vector3();
const _tintC = new Color();
const _whiteC = new Color(0xffffff);

let stickGeo: CapsuleGeometry | null = null;
function stick(): CapsuleGeometry {
  if (!stickGeo) {
    stickGeo = new CapsuleGeometry(0.0125, 0.24, 4, 12);
    stickGeo.translate(0, 0.24 / 2 + 0.0125 + 0.03, 0);
  }
  return stickGeo;
}

/** THE CROWN — champagne brass, hovering, turning. */
function buildCrown(): Group {
  const c = new Group();
  c.name = 'crown';
  const brass = new MeshStandardMaterial({
    color: 0xd9a832,
    emissive: 0x6b4a10,
    emissiveIntensity: 0.85,
    metalness: 0.9,
    roughness: 0.28,
  });
  const hot = new MeshBasicMaterial({ color: 0xffe9a8 });
  const R = 0.062;
  const band = new Mesh(new TorusGeometry(R, 0.0065, 8, 32), brass);
  band.rotation.x = Math.PI / 2;
  c.add(band);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const tall = i % 2 === 0;
    const point = new Mesh(new CylinderGeometry(0.0014, 0.0074, 1, 4), brass);
    point.scale.set(1, tall ? 0.06 : 0.034, 1);
    point.position.set(Math.sin(a) * R, 0.002 + (tall ? 0.03 : 0.017), Math.cos(a) * R);
    c.add(point);
    if (tall) {
      const tip = new Mesh(new SphereGeometry(1, 8, 8), hot);
      tip.scale.setScalar(0.0045);
      tip.position.set(Math.sin(a) * R, 0.064, Math.cos(a) * R);
      c.add(tip);
    }
  }
  c.add(glowSprite(0xffd24a, 0.26, 0.38));
  return c;
}

/**
 * Build a dancer wearing the blank. `hue` is the seat's (or the player's
 * picked) colour: it tints the gauntlets' glow and the glowsticks.
 */
export function buildDancer(hue: number, dress: BlankDress = {}): DancerRig {
  const root = new Group();
  root.name = 'blank-dancer';
  // The figure sits in its own group under the root so a MELT can squash
  // it toward the deck without touching the root's transform (the MC
  // scales his root to giant size; the club parents rigs wherever it likes).
  const figure = new Group();
  root.add(figure);

  const tone: BlankTone = dress.tone ?? 'white';
  const color = hueToColor(hue, 0.6);
  const rig = buildBoxer(0, toneSkinId(tone));
  figure.add(...rig.all);
  setAvatarAccent(root, color);
  if (dress.gear || dress.look) {
    for (const part of rig.all) {
      if (dress.gear) applyGear(part, dress.gear, tone);
      if (dress.look) applyLook(part, dress.look);
    }
  }

  // Every accent-tagged material the blank carries is drivable: the
  // gauntlets' glow at full, the chassis' dampened emissive at half.
  const accents: DancerAccent[] = [];
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const std = mat as MeshStandardMaterial;
      const mode = std.userData?.accent;
      if (mode === 'glow') accents.push({ mat: std, gain: 1, neon: true, hot: 0.25 });
      else if (mode === 'emissive') accents.push({ mat: std, gain: 0.45, neon: false, hot: 0 });
    }
  });

  // THE GLOWSTICKS: a baton of light out of each fist — white-hot core, the
  // hue in the halo. The blank's gauntlet keeps its knuckles down −z; the
  // stick stands up its local +y, so a fist reads as gripping it.
  const stickMat = new MeshBasicMaterial({ color: _tintC.setHex(color).lerp(_whiteC, STICK_HOT).getHex() });
  const halos: Sprite[] = [];
  if (dress.sticks !== false) {
    accents.push({ mat: stickMat, gain: 1, neon: true, hot: STICK_HOT });
    for (const glove of rig.gloves) {
      const baton = new Mesh(stick(), stickMat);
      baton.position.set(0, 0.01, -0.02);
      glove.add(baton);
      const halo = glowSprite(color, 0.32, 0.55);
      halo.position.set(0, 0.17, -0.02);
      glove.add(halo);
      halos.push(halo);
    }
  }

  let crown: Group | null = null;

  const clamp = (v: number, lim: number): number => Math.max(-lim, Math.min(lim, v || 0));

  const pose = (p: DancerPose): void => {
    const melt = p.slump;
    // MELT: the whole figure squashes toward the deck and the head hangs.
    figure.scale.y = 1 - melt * 0.72;
    _head.set(p.hx, p.hy, p.hz);
    _euler.set(clamp(p.pitch, PITCH_MAX) * (1 - melt) - melt * 0.9, p.yaw, clamp(p.roll, ROLL_MAX) * (1 - melt) + melt * 0.35);
    _headQ.setFromEuler(_euler);
    // The arena's own solve: the one-piece body planted under the head,
    // leaned along the spine, ducking with it — but SEATED under the head
    // rather than pinned at the arena's fixed hip height. The arena pins
    // hips at 0.95 m because its hitboxes live there; a figure with no
    // hitboxes has no reason to, and a tall dancer's head was floating a
    // hand's width clear of the neck. And a third-person set-back, so the
    // head sits over the shoulders instead of jutting ahead of them the
    // way it must for the wearer looking down.
    solveTorso(rig, _head, _headQ, p.hx, p.hz, _chest, _pelvis, 0.06, true);

    // The body's own axes at this yaw (yaw 0 faces −Z, toward the stage).
    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    _right.set(cos, 0, -sin);
    _fwd.set(-sin, 0, -cos);
    _yawQ.setFromAxisAngle(UP, p.yaw);
    const shY = p.hy - SHOULDER_DROP;
    for (const side of [-1, 1] as const) {
      const glove = rig.gloves[side < 0 ? 0 : 1];
      const hx = side < 0 ? p.lx : p.rx;
      const hy = (side < 0 ? p.ly : p.ry) * (1 - melt * 0.6);
      const hz = side < 0 ? p.lz : p.rz;
      glove.position.set(hx, hy, hz);
      // THE STICK IS A POINTER: it rides the forearm's line with an upward
      // bias and a slight outward flare, and the fist turns with the yaw.
      _shoulder.set(p.hx + _right.x * SHOULDER_W * side, shY, p.hz + _right.z * SHOULDER_W * side);
      _hint.set(hx - _shoulder.x, hy - _shoulder.y, hz - _shoulder.z);
      if (_hint.lengthSq() < 1e-6) _hint.set(0, -1, 0);
      _hint.normalize();
      _hint.set(_hint.x + _right.x * side * 0.18, _hint.y + 0.8, _hint.z + _right.z * side * 0.18).normalize();
      glove.quaternion.setFromUnitVectors(UP, _hint).multiply(_yawQ);
      // THE HANDS' TURN, when the pose carries it: the controller's own
      // world quaternion, worn exactly as the arena wears it — so a palm
      // up is a palm up. The pointer guess above is only for frames that
      // never learned which way the hand faced (the ring's).
      const qw = side < 0 ? p.lqw : p.rqw;
      if (qw !== undefined && qw !== 0) {
        _handQ.set(
          (side < 0 ? p.lqx : p.rqx) ?? 0,
          (side < 0 ? p.lqy : p.rqy) ?? 0,
          (side < 0 ? p.lqz : p.rqz) ?? 0,
          qw,
        );
        glove.quaternion.copy(_handQ.multiply(HAND_ADDUCTION[side < 0 ? 0 : 1]));
      }
      // THE FINGERS, when the pose carries the grip: the same curl your
      // own hand makes of the same squeeze (setHandGrip), so a fist made
      // on the floor is a fist in the glass and on every other headset.
      // A pose that never learned it (the ring's, the MC's) leaves the
      // hand in the blank's half-relaxed rest — set every frame, because
      // the same rig can go from a floor pose to a ring pose.
      const trig = side < 0 ? p.lt : p.rt;
      const grip = side < 0 ? p.lg : p.rg;
      if (trig !== undefined || grip !== undefined) setHandGrip(glove, trig ?? 0, grip ?? 0);
      else setHandCurl(glove, ...HAND_REST_CURL);
    }
    if (crown) {
      crown.position.set(p.hx, p.hy + CROWN_RISE, p.hz);
      crown.rotation.y = (performance.now() * 0.0006) % (Math.PI * 2);
    }
  };

  // Park in a neutral stance so a rig never renders unsolved.
  pose({ hx: 0, hy: 1.52, hz: 0, yaw: 0, pitch: 0, roll: 0, lx: -0.3, ly: 1.0, lz: -0.1, rx: 0.3, ry: 1.0, rz: -0.1, slump: 0 });

  let detailed = true;
  return {
    root,
    accents,
    baseColor: color,
    pose,
    setCrown(on: boolean) {
      if (on && !crown) {
        crown = buildCrown();
        crown.visible = false;
        crown.position.set(0, -10, 0);
        figure.add(crown);
      }
      if (crown) crown.visible = on;
    },
    setDetail(near: boolean) {
      if (near === detailed) return;
      detailed = near;
      for (const h of halos) h.visible = near;
    },
    dispose() {
      root.removeFromParent();
      stickMat.dispose();
    },
  };
}

/** The rest-state intensity the systems drive accents to — re-exported so
 *  a caller that only imports this module has it. */
export const BLANK_ACCENT_REST = ACCENT_REST;
