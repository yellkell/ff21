/**
 * CourseRidersSystem — VOIDSTEP, with company.
 *
 * The course was a room for one. You crossed through the club's west door
 * into a place where the only other thing was the floor, rode a lap, and came
 * back to a room full of people who hadn't seen any of it. Everything needed
 * to fix that was already sitting there:
 *
 *  - THE CIRCUIT IS AUTHORED, not generated (course/score.ts). Every client
 *    builds the identical 14 platforms at identical coordinates, so nobody
 *    has to be told what the world looks like.
 *  - THE RELAY ALREADY FANS POSES OUT. The club streams head and hands at
 *    10 Hz and the raid streams them on the ring; a third place streaming the
 *    same twelve numbers is one more verb, not a new subsystem.
 *
 * So two things had to be built, and only two.
 *
 * THE CLOCK. A platform must be in the same place at the same moment on every
 * headset, or a rider reads as standing beside their deck rather than on it.
 * The course is a PLACE rather than a set, though — people walk on and off it
 * whenever they like — so there is no 'start' to synchronise on the way the
 * ball's countdown does. Instead the circuit has been turning since the room
 * opened: the relay says how long that has been, and crossing in joins the lap
 * already in progress (net/session.ts `courseBars`, conductor.start).
 *
 * THE FRAME. This is the part that looks like it should be hard and isn't.
 * Out here each rider's play area is pinned to whichever platform owns them,
 * so two people genuinely stand in two different moving frames — which sounds
 * like a pose has to name its frame before anyone can place it. It doesn't.
 * Describe a head in COURSE space instead of in its own floor's space and the
 * moving frames cancel: the sender converts once on the way out, the receiver
 * reads it straight. Nothing has to know which deck anyone is on.
 *
 * What is deliberately NOT here: collision, and any rule about sharing a tile.
 * Two riders can stand in the same square and pass through each other. The
 * alternative is a course that can push you, and ground that moves you is the
 * one thing this place has always refused (see CourseFrameSystem) — being
 * shoved off a deck by someone else's netcode would be exactly the betrayal
 * the whole locomotion scheme exists to avoid.
 */

import { createSystem } from '@iwsdk/core';
import { DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { hueToColor } from '../config.js';
import { CLUB_NET } from '../club/config.js';
import { socialBlocked } from '../club/social.js';
import { unpackLook } from '../../avatar/paint.js';
import { cleanGear } from '../../avatar/gear.js';
import { buildDancer, type BlankDress, type DancerPose, type DancerRig } from '../game/blankDancer.js';
import { PoseMotion, type MotionTuning } from '../game/poseMotion.js';
import { coursePoses } from '../net/poses.js';
import { memberHue, net, sendCoursePose } from '../net/session.js';
import { course } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { nameTagTexture } from './ClubSocialSystem.js';

/** Riders track the wire critically damped — the same spring the club floor
 *  uses, and for the same reason: continuity, not bounce. */
const RIDER_MOTION: MotionTuning = { headRate: CLUB_NET.smoothing, handHz: 3.4, zeta: 1 };

/**
 * A pose older than this and its rider is gone: they stepped back through the
 * door, dropped off the network, or their headset went to sleep. There is no
 * "I have left the course" message and there should not be one — a place you
 * can be teleported out of by a curtain is a place where the only honest
 * signal is whether somebody is still talking.
 */
const STALE_MS = 1600;

const _v = new Vector3();
const _o = new Vector3();
const _q = new Quaternion();
const _cam = new Vector3();

interface Rider {
  idx: number;
  name: string;
  hue: number;
  rig: DancerRig;
  tag: Mesh;
  tagMat: MeshBasicMaterial;
  pose: DancerPose;
  tgt: DancerPose;
  motion: PoseMotion;
  /** False until their first pose lands — no gliding in from the origin. */
  live: boolean;
}

export class CourseRidersSystem extends createSystem({}) {
  private crowd!: Group;
  private riders = new Map<number, Rider>();
  private sendT = 0;
  private lastRosterKey = '';

  init(): void {
    this.crowd = new Group();
    this.crowd.name = 'course-riders';
    // Under the course root, so a rider's pose is course-local and the whole
    // crowd goes away with the place when the door closes.
    courseRoot().add(this.crowd);
  }

  update(delta: number): void {
    if (!course.active) {
      if (this.riders.size) this.clear();
      this.sendT = 0;
      return;
    }

    this.syncRoster();
    this.stream(delta);
    this.drive(delta);
  }

  /* ── my pose, going out ───────────────────────────────────────────────── */

  private stream(delta: number): void {
    this.sendT -= delta;
    if (this.sendT > 0) return;
    this.sendT = 1 / CLUB_NET.poseRateHz;

    // THE CAMERA, not the player entity's head: out here CourseSystem reads
    // the body off the camera (it is what the dev hook moves, and what the
    // play-area maths is written against), and a pose streamed from a
    // different object than the one the course thinks you are standing at
    // puts your figure somewhere you are not.
    const root = courseRoot();
    this.camera.getWorldPosition(_v);
    this.camera.getWorldQuaternion(_q);
    // Course-local, so the number means the same thing on every headset
    // however the root is parked (it sits 300 m under the club).
    root.worldToLocal(_v);
    const e = eulerOf(_q);
    const d: number[] = [_v.x, _v.y, _v.z, e.yaw];
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (obj) {
        obj.getWorldPosition(_o);
        root.worldToLocal(_o);
        d.push(_o.x, _o.y, _o.z);
      } else {
        // No controller (a headless probe, or a hand-tracking gap): hang the
        // hands off the head so the figure still reads as a body.
        d.push(_v.x + (hand === 'left' ? -0.25 : 0.25), Math.max(0.6, _v.y - 0.6), _v.z - 0.1);
      }
    }
    d.push(e.pitch, e.roll);
    sendCoursePose(d);
  }

  /* ── everyone else, coming in ─────────────────────────────────────────── */

  /** Spawn and despawn figures as the room's roster changes. */
  private syncRoster(): void {
    const key = net.members.map((m) => `${m.idx}:${m.name}:${memberHue(m).toFixed(3)}`).join('|');
    if (key === this.lastRosterKey) return;
    this.lastRosterKey = key;

    const want = new Map<number, { name: string; hue: number; body: BlankDress }>();
    for (const m of net.members) {
      if (m.idx === net.myIdx) continue;
      want.set(m.idx, {
        name: m.name,
        hue: memberHue(m),
        body: { tone: m.tn === 'onyx' ? 'onyx' : 'white', gear: cleanGear(m.gr ?? ''), look: unpackLook(m.lk ?? '') },
      });
    }

    // Gone, renamed or recoloured — name and hue are baked into the rig and
    // the tag's texture, so either change means a new figure.
    for (const [idx, r] of [...this.riders]) {
      const w = want.get(idx);
      if (!w || w.name !== r.name || Math.abs(w.hue - r.hue) > 1e-4) this.drop(idx);
    }

    for (const [idx, { name, hue, body }] of want) {
      if (this.riders.has(idx)) continue;
      const rig = buildDancer(hue, body);
      rig.root.visible = false;
      this.crowd.add(rig.root);
      const tagMat = new MeshBasicMaterial({
        map: nameTagTexture(name, `#${hueToColor(hue, 0.62).toString(16).padStart(6, '0')}`),
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
      });
      const tag = new Mesh(new PlaneGeometry(0.72, 0.18), tagMat);
      tag.renderOrder = 24;
      tag.visible = false;
      this.crowd.add(tag);
      const pose: DancerPose = {
        hx: 0, hy: 1.6, hz: 0, yaw: 0, pitch: 0, roll: 0,
        lx: -0.3, ly: 1.0, lz: 0, rx: 0.3, ry: 1.0, rz: 0,
        slump: 0,
      };
      this.riders.set(idx, { idx, name, hue, rig, tag, tagMat, pose, tgt: { ...pose }, motion: new PoseMotion(), live: false });
    }
  }

  /** Move every figure onto its latest sample. */
  private drive(delta: number): void {
    const now = performance.now();
    this.camera.getWorldPosition(_cam);
    courseRoot().worldToLocal(_cam);

    for (const r of this.riders.values()) {
      const wire = coursePoses.get(r.idx);
      const fresh = !!wire && now - wire.t < STALE_MS;
      // BLOCKED is local and absolute: a blocked rider is not out here at all
      // — no figure, no tag — exactly as they are not on the club floor.
      const hidden = socialBlocked(r.name);

      if (fresh && wire) {
        const first = !r.live;
        r.live = true;
        r.tgt.hx = wire.hx;
        r.tgt.hy = wire.hy;
        r.tgt.hz = wire.hz;
        r.tgt.yaw = wire.hyaw;
        r.tgt.pitch = wire.hpitch;
        r.tgt.roll = wire.hroll;
        r.tgt.lx = wire.lx;
        r.tgt.ly = wire.ly;
        r.tgt.lz = wire.lz;
        r.tgt.rx = wire.rx;
        r.tgt.ry = wire.ry;
        r.tgt.rz = wire.rz;
        // The first sample SNAPS. Easing into it would walk the figure in
        // from the pad across the whole course, through the void.
        if (first) r.motion.snap(r.pose, r.tgt);
        else r.motion.step(r.pose, r.tgt, delta, RIDER_MOTION);
      } else {
        r.live = false;
      }

      const show = r.live && !hidden;
      r.rig.root.visible = show;
      r.tag.visible = show;
      if (!show) continue;

      r.rig.setDetail((r.pose.hx - _cam.x) ** 2 + (r.pose.hz - _cam.z) ** 2 <= 12 * 12);
      r.rig.pose(r.pose);
      r.tag.position.set(r.pose.hx, r.pose.hy + 0.38, r.pose.hz);
      r.tag.rotation.y = Math.atan2(_cam.x - r.pose.hx, _cam.z - r.pose.hz);
    }
  }

  private drop(idx: number): void {
    const r = this.riders.get(idx);
    if (!r) return;
    r.rig.dispose();
    r.tag.removeFromParent();
    r.tagMat.map?.dispose();
    r.tagMat.dispose();
    this.riders.delete(idx);
  }

  private clear(): void {
    for (const idx of [...this.riders.keys()]) this.drop(idx);
    this.lastRosterKey = '';
  }
}

/** Yaw, pitch and roll out of a quaternion, in the order a neck works in. */
function eulerOf(q: Quaternion): { yaw: number; pitch: number; roll: number } {
  // Matches ClubSocialSystem.pumpClubPose: YXZ — swivel, then nod, then tilt.
  const { x, y, z, w } = q;
  const sinp = 2 * (w * x - y * z);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);
  const yaw = Math.atan2(2 * (w * y + x * z), 1 - 2 * (x * x + y * y));
  const roll = Math.atan2(2 * (w * z + x * y), 1 - 2 * (x * x + z * z));
  return { yaw, pitch, roll };
}
