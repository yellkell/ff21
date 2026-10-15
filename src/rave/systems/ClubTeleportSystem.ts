/**
 * ClubTeleportSystem — FIRE FIGHT's club movement, carried over whole:
 * teleport-only, no sliding, no smooth turn.
 *
 *  - Push either thumbstick FORWARD and that controller starts aiming: a
 *    ballistic arc curves from it to the floor, ending in an OCTAGON marker
 *    (the dancer's platform footprint, naturally) with an arrow inside it.
 *  - Move the controller to move the landing spot; roll the thumbstick to
 *    spin the arrow — that's the way you'll be FACING when you arrive.
 *  - Let the stick spring back and you're there.
 *  - An isolated sideways flick (when not aiming) is a snap turn.
 *  - BACK on the stick is a short step backwards, on the spot — never an
 *    arc. (It was always meant to be, and never was: the arc opened on any
 *    vertical deflection past its engage point, which a stick on its way
 *    back passes through before it reaches the step's own threshold, and
 *    once the arc was open the flick was never consulted again. So back
 *    threw a ray behind you, and the step fired only on a push so hard it
 *    skipped a frame. Now only a forward push can open the arc.)
 *
 * Landing spots are restricted to the club's floor rectangles
 * (TELEPORT_AREAS — hall, bar aisle, terrace wings, still room, and the
 * standable furniture: the booth tables and THE BAR ITSELF); anywhere else
 * the marker burns hazard-red and release does nothing. The terrace rides
 * at +0.45 m and the counter at +1.09: areas carry their own floor height
 * and the rig lands at it. Arcs can't cut through walls or the stage face —
 * or over the bar counter, until you're standing at counter height, which
 * is how you get up on it and back down again.
 *
 * Active only while the club is the room (menu screens). The moment a set
 * books the floor, every club offset is DROPPED and the rig returns to
 * identity — the raid's law is "my platform IS the world origin", and the
 * origin is the same physical spot of your room it was before you went
 * social. Wandering the club never moves your platform: you walk back to
 * the same real-world centre you set up on, facing the same way.
 *
 * A headset RECENTRE (the reference space's `reset` event) is honoured
 * everywhere: in the club the rig folds the new origin in so you stay
 * exactly where you stood, and everywhere else the rig snaps to identity —
 * recentring always means "put me at my platform's centre, facing the
 * board", never a weird spot at a weird angle.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import {
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Shape,
  ShapeGeometry,
  Vector3,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { XROrigin } from '@iwsdk/xr-input';
import { OCTAGON_VERTICES, PALETTE } from '../config.js';
import { octagonSlab } from '../arena/octagon.js';
import * as sfx from '../audio/sfx.js';
import { DECOR, TELEPORT, TELEPORT_AREAS, crossesWall, floorYAt, type FloorArea } from '../club/config.js';
import { match } from '../game/state.js';
import { course } from '../course/state.js';
import { inRoom } from '../net/session.js';

const _origin = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _p = new Vector3();
const _v = new Vector3();
const _head = new Vector3();

/**
 * Move the rig so the player's head lands over (x, z) at floor height `y`,
 * facing `yaw` (three.js convention: yaw 0 looks down −z).
 */
export function teleportPlayer(player: XROrigin, x: number, z: number, yaw: number, y = 0): void {
  player.head.getWorldPosition(_head);
  player.head.getWorldQuaternion(_quat);
  _dir.set(0, 0, -1).applyQuaternion(_quat);
  const headYaw = Math.atan2(-_dir.x, -_dir.z);

  const dYaw = yaw - headYaw;
  player.rotation.y += dYaw;
  player.position.y = y;

  // Rotate the head's offset from the rig origin by the turn we just made,
  // then position the rig so the head ends up exactly on target.
  const offX = _head.x - player.position.x;
  const offZ = _head.z - player.position.z;
  const cos = Math.cos(dYaw);
  const sin = Math.sin(dYaw);
  player.position.x = x - (offX * cos + offZ * sin);
  player.position.z = z - (-offX * sin + offZ * cos);
}

/**
 * Snap-turn the rig by `deltaYaw` radians about the player's HEAD, so your
 * physical spot stays put and the world spins around you (rotating about
 * the rig origin would swing your head through an arc).
 */
export function snapTurn(player: XROrigin, deltaYaw: number): void {
  player.head.getWorldPosition(_head);
  const hx = _head.x;
  const hz = _head.z;
  player.rotation.y += deltaYaw;
  const offX = hx - player.position.x;
  const offZ = hz - player.position.z;
  const cos = Math.cos(deltaYaw);
  const sin = Math.sin(deltaYaw);
  player.position.x = hx - (offX * cos + offZ * sin);
  player.position.z = hz - (-offX * sin + offZ * cos);
}

function areaAt(x: number, z: number): FloorArea | null {
  for (const a of TELEPORT_AREAS) {
    if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) return a;
  }
  return null;
}

/** Dev window on the moves that resolve without an arc — no thumbstick
 *  exists off-device, so this is the only way to exercise them headlessly.
 *  (`__gdr.move`.) */
export const teleportView: {
  stepBack?: () => void;
  snapTurn?: (dir: -1 | 1) => void;
} = {};

export class ClubTeleportSystem extends createSystem({}) {
  private aimingHand: 'left' | 'right' | null = null;
  private arc!: Line2;
  private arcGeo!: LineGeometry;
  private arcMat!: LineMaterial;
  private arcBuf = new Array<number>(TELEPORT.arcPoints * 3).fill(0);
  private marker!: Group;
  private markerMat!: MeshBasicMaterial;
  private arrowMat!: MeshBasicMaterial;
  private landing = new Vector3();
  private landingArea: FloorArea | null = null;
  private landingYaw = 0;
  private valid = false;
  /** Snap turn fires once per flick: armed again after the stick recentres. */
  private snapArmed = true;
  private wasClub = false;
  /** The reference space we're watching for `reset` (headset recentre). */
  private refSpace: XRReferenceSpace | null = null;
  /** A recentre happened; fold it in on the next tick (see onRecenter). */
  private recentered = false;
  private recenterPose = { x: 0, z: 0, yaw: 0, y: 0 };

  /**
   * A headset recentre fires `reset` BETWEEN frames, before any pose uses
   * the moved origin — so the head still holds where the player stands in
   * the world RIGHT NOW. Bank that pose; the next update re-plants on it.
   */
  private onRecenter = (): void => {
    this.player.head.getWorldPosition(_head);
    this.player.head.getWorldQuaternion(_quat);
    _dir.set(0, 0, -1).applyQuaternion(_quat);
    this.recenterPose.x = _head.x;
    this.recenterPose.z = _head.z;
    this.recenterPose.yaw = Math.atan2(-_dir.x, -_dir.z);
    this.recenterPose.y = this.player.position.y;
    this.recentered = true;
  };

  init(): void {
    teleportView.stepBack = () => this.stepBack();
    teleportView.snapTurn = (dir) => snapTurn(this.player, dir > 0 ? -TELEPORT.snapAngle : TELEPORT.snapAngle);
    // Arc line — a fat world-unit ribbon in club brass (hazard-red when the
    // landing is refused), LineBasicMaterial ignores width so Line2 it is.
    this.arcGeo = new LineGeometry();
    this.arcGeo.setPositions(this.arcBuf);
    this.arcMat = new LineMaterial({
      color: DECOR.brass,
      linewidth: 0.014,
      worldUnits: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this.arc = new Line2(this.arcGeo, this.arcMat);
    this.arc.frustumCulled = false;
    this.arc.visible = false;
    this.scene.add(this.arc);

    // Octagon landing marker — the dancer's platform silhouette, ghosted.
    this.markerMat = new MeshBasicMaterial({
      color: DECOR.brass,
      transparent: true,
      opacity: 0.4,
      depthWrite: false,
    });
    const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, 0.012), this.markerMat);
    this.marker = new Group();
    this.marker.scale.setScalar(0.42); // a compact puck, not a full platform
    this.marker.add(slab);

    // The facing arrow inside it (points −z at yaw 0, like the camera).
    const shape = new Shape();
    shape.moveTo(0, 0.34);
    shape.lineTo(0.16, 0.06);
    shape.lineTo(0.06, 0.06);
    shape.lineTo(0.06, -0.26);
    shape.lineTo(-0.06, -0.26);
    shape.lineTo(-0.06, 0.06);
    shape.lineTo(-0.16, 0.06);
    shape.closePath();
    this.arrowMat = new MeshBasicMaterial({
      color: DECOR.brass,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    const arrow = new Mesh(new ShapeGeometry(shape), this.arrowMat);
    arrow.rotation.x = -Math.PI / 2;
    arrow.position.y = 0.03;
    this.marker.add(arrow);
    this.marker.visible = false;
    this.scene.add(this.marker);
  }

  update(): void {
    this.watchRecenter();

    // Movement belongs to the SOCIAL place only: the club floor, which is
    // open while a room is (hosting/joined) on a menu screen. The foyer is
    // a front desk, and the raid is your real feet.
    // …and NOT while the west door has you. Out on the course the rig
    // belongs to whatever platform you're standing on, and an arc would be
    // an answer to a question that experience refuses to ask.
    const menuRoom = match.screen === 'lobby' || match.screen === 'tour';
    const inClub =
      menuRoom && inRoom() && !course.active;

    // A recentre moved the reference-space origin under our feet. In the
    // club, re-plant the rig on the banked pose so you stay exactly where
    // you stood (the recentre redefines your NEUTRAL, not your spot).
    // Anywhere else the rig belongs at identity anyway — snap it there, so
    // recentring lands you dead-centre on your platform facing the board.
    if (this.recentered) {
      this.recentered = false;
      if (inClub) {
        const p = this.recenterPose;
        teleportPlayer(this.player, p.x, p.z, p.yaw, p.y);
      } else {
        this.player.position.set(0, 0, 0);
        this.player.rotation.set(0, 0, 0);
      }
    }

    // Leaving the floor — a set booked it, or you left the room: drop every
    // club offset and return the rig to identity. The raid's law is "my
    // platform IS the world origin", and identity puts that origin back on
    // the SAME physical spot (and facing) it held before the social hang —
    // your platform never moves house because you visited the bar.
    if (!inClub) {
      if (this.wasClub) {
        this.wasClub = false;
        this.hide();
        this.player.position.set(0, 0, 0);
        this.player.rotation.set(0, 0, 0);
      }
      return;
    }
    this.wasClub = true;

    // Not mid-aim? A sideways flick is a snap turn and a BACKWARD flick is a
    // step back; only forward opens the teleport arc. (Sideways WHILE aiming
    // steers the landing's facing instead — see traceArc.)
    if (!this.aimingHand && this.tryFlick()) return;

    let axes: { x: number; y: number } | null = null;
    if (this.aimingHand) {
      const a = this.input.xr.gamepads[this.aimingHand]?.getAxesValues(InputComponent.Thumbstick);
      axes = a ?? null;
    } else {
      for (const hand of ['left', 'right'] as const) {
        const a = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
        // FORWARD opens the arc (−y is forward on a thumbstick); back is the
        // step's, and sideways the snap turn's — neither ever throws a ray.
        if (a && a.y <= -TELEPORT.engage && Math.abs(a.y) >= Math.abs(a.x)) {
          this.aimingHand = hand;
          axes = a;
          break;
        }
      }
    }

    if (!this.aimingHand || !axes) {
      this.hide();
      return;
    }

    const mag = Math.hypot(axes.x, axes.y);
    if (mag < TELEPORT.release) {
      // Stick sprung back — go (if the marker was on valid floor).
      if (this.valid) {
        teleportPlayer(this.player, this.landing.x, this.landing.z, this.landingYaw, this.landingArea?.y ?? 0);
        sfx.uiClick();
      }
      this.hide();
      return;
    }

    this.traceArc(axes);
  }

  private traceArc(axes: { x: number; y: number }): void {
    const ray = this.player.raySpaces[this.aimingHand!];
    ray.getWorldPosition(_origin);
    ray.getWorldQuaternion(_quat);
    _dir.set(0, 0, -1).applyQuaternion(_quat);

    // Ballistic arc from the controller. The club has two floor heights, so
    // the arc lands where it meets the AREA under it — probing the terrace
    // height first, then ground level.
    _p.copy(_origin);
    _v.copy(_dir).multiplyScalar(TELEPORT.launchSpeed);
    const buf = this.arcBuf;
    const put = (i: number): void => {
      buf[i * 3] = _p.x;
      buf[i * 3 + 1] = _p.y;
      buf[i * 3 + 2] = _p.z;
    };
    let landed = false;
    this.landingArea = null;
    for (let i = 0; i < TELEPORT.arcPoints; i++) {
      put(i);
      if (landed) continue;
      _v.y -= TELEPORT.gravity * TELEPORT.arcStep;
      _p.addScaledVector(_v, TELEPORT.arcStep);
      // Falling through a floor level that has an area under this (x,z)?
      const area = _v.y < 0 || _p.y <= 0 ? areaAt(_p.x, _p.z) : null;
      const floorY = area ? area.y : 0;
      if (_p.y <= floorY) {
        _p.y = floorY;
        landed = true;
        this.landing.copy(_p);
        this.landingArea = area;
        for (let j = i + 1; j < TELEPORT.arcPoints; j++) {
          buf[j * 3] = _p.x;
          buf[j * 3 + 1] = _p.y;
          buf[j * 3 + 2] = _p.z;
        }
        break;
      }
    }
    if (!landed) this.landing.copy(_p);
    this.arcGeo.setPositions(buf);

    // Valid only on real floor, with no wall between you and it. The hop is
    // judged at the higher of the two ends: stepping UP onto the counter and
    // stepping back DOWN off it are both hops made at counter height.
    this.player.head.getWorldPosition(_head);
    const hopY = Math.max(floorYAt(_head.x, _head.z), this.landingArea?.y ?? 0);
    this.valid =
      landed &&
      this.landingArea !== null &&
      !crossesWall(_head.x, _head.z, this.landing.x, this.landing.z, hopY);

    // Facing: thumbstick angle relative to where the controller points.
    const ctrlYaw = Math.atan2(-_dir.x, -_dir.z);
    const stickAngle = Math.atan2(axes.x, -axes.y); // 0 = pushed forward
    this.landingYaw = ctrlYaw - stickAngle;

    const colour = this.valid ? DECOR.brass : PALETTE.danger;
    this.markerMat.color.set(colour);
    this.arrowMat.color.set(colour);
    this.arcMat.color.set(colour);
    this.marker.position.set(this.landing.x, this.landing.y + 0.012, this.landing.z);
    this.marker.rotation.y = this.landingYaw;
    this.marker.visible = true;
    this.arc.visible = true;
  }

  /**
   * The two flicks that resolve on the spot rather than opening an arc: a
   * left/right push yaws the rig by snapAngle, a BACKWARD push shuffles you
   * half a metre away from what you're looking at.
   *
   * One action per flick — the stick has to spring back below snapReset to
   * re-arm — so holding it doesn't spin you or walk you across the room, and
   * a diagonal can't fire both.
   */
  private tryFlick(): boolean {
    let sx = 0;
    let sy = 0;
    let mag = 0;
    for (const hand of ['left', 'right'] as const) {
      const a = this.input.xr.gamepads[hand]?.getAxesValues(InputComponent.Thumbstick);
      if (!a) continue;
      const m = Math.hypot(a.x, a.y);
      if (m > mag) {
        mag = m;
        sx = a.x;
        sy = a.y;
      }
    }
    if (mag < TELEPORT.snapReset) {
      this.snapArmed = true;
      return false;
    }
    if (!this.snapArmed) return false;
    // A clear sideways flick past the threshold — turn the way it's pushed
    // (stick right yaws you right: a NEGATIVE rotation about +y).
    if (Math.abs(sx) >= TELEPORT.snapEngage && Math.abs(sx) > Math.abs(sy)) {
      this.snapArmed = false;
      snapTurn(this.player, sx > 0 ? -TELEPORT.snapAngle : TELEPORT.snapAngle);
      sfx.uiClick();
      return true;
    }
    // …and a clear BACKWARD one steps back. (Forward is −y on a thumbstick,
    // so back is positive.) It engages where the arc would — the same push
    // that opens a ray forwards steps you backwards — and consumes the
    // flick either way it lands: a push that finds a wall behind you must
    // not fall through to anything else.
    if (sy >= TELEPORT.engage && sy > Math.abs(sx)) {
      this.snapArmed = false;
      this.stepBack();
      return true;
    }
    return false;
  }

  /**
   * Half a metre backwards, away from where the HEAD is looking — the body
   * can be facing anywhere, but "back" means back from what you can see.
   *
   * Judged the way the arc's landing is judged — real floor under it, no wall
   * crossed on the way — plus one rule the arc doesn't need: it must stay on
   * YOUR level. Half a step back from the counter would otherwise put you up
   * ON the counter, because that surface is standable and it is exactly 0.5 m
   * behind you when you're leaning on it. A shuffle that lifts you a metre in
   * the air is not a shuffle. Climbing is what the arc is for.
   *
   * Shorter steps are tried in turn so backing up against something stops you
   * short instead of refusing outright.
   */
  private stepBack(): void {
    this.player.head.getWorldPosition(_head);
    this.player.head.getWorldQuaternion(_quat);
    _dir.set(0, 0, -1).applyQuaternion(_quat);
    const flat = Math.hypot(_dir.x, _dir.z);
    if (flat < 1e-4) return; // staring at your boots or the ceiling
    const bx = -_dir.x / flat;
    const bz = -_dir.z / flat;
    const fromY = floorYAt(_head.x, _head.z);
    for (const step of TELEPORT.stepBack) {
      const x = _head.x + bx * step;
      const z = _head.z + bz * step;
      const area = areaAt(x, z);
      if (!area) continue;
      if (Math.abs(area.y - fromY) > 0.05) continue; // your level, or nothing
      if (crossesWall(_head.x, _head.z, x, z, Math.max(fromY, area.y))) continue;
      teleportPlayer(this.player, x, z, Math.atan2(-_dir.x, -_dir.z), area.y);
      sfx.uiClick();
      return;
    }
  }

  /**
   * Keep a `reset` listener on the session's live reference space (it only
   * exists once a session is up, and each new session mints a new one).
   */
  private watchRecenter(): void {
    const space = this.renderer.xr.getReferenceSpace();
    if (space === this.refSpace) return;
    this.refSpace?.removeEventListener('reset', this.onRecenter);
    this.refSpace = space;
    space?.addEventListener('reset', this.onRecenter);
  }

  private hide(): void {
    this.aimingHand = null;
    this.valid = false;
    this.arc.visible = false;
    this.marker.visible = false;
  }
}
