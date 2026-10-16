/**
 * CourseSystem — THE STEP's door, and the crossing itself.
 *
 * The club is a teleport room: thumbstick, arc, octagon, you're there. THE
 * COURSE is the opposite proposition — no stick, no arc, no interface at
 * all. One platform under your feet is static relative to your real floor,
 * and the world does the walking; stepping from deck to deck is the entire
 * game. Two sets of physics can't share a room, so they don't: the door in
 * the west corner takes the whole world away and gives you the other one.
 *
 * The crossing, precisely:
 *
 *   off  → you're in the club; the plate in front of the frame lights as
 *          your head nears it, and entering the threshold starts the cross.
 *   in   → the black falls (PHASE.fadeOut). Nothing swaps in front of you.
 *   ride → under the black: the club packs away, the void comes up, the rig
 *          plants at the home pad, the clock starts at bar 0 — then the
 *          black lifts (PHASE.fadeIn) and you're standing on the pad.
 *   out  → the black falls again, on a closed lap or a held Ⓑ.
 *   back → the club returns and puts you down one step outside its own
 *          doorway, facing the hall. Where you started.
 *
 * While `course.active` every club system stands down (see ClubSystem,
 * ClubTeleportSystem, ClubSocialSystem, ClubPropsSystem, ClubBallSystem,
 * ClubMirrorSystem, ArcadeSystem) — including the teleport, which is the
 * whole point: out there the only way to move is to step.
 *
 * THE WAY OUT is the venue's own: right Ⓐ raises a card, the card has a
 * button on it. It is the same posture as leaving a set mid-song — leaving
 * is a decision on a button, never the button itself — and for the same
 * reason: out here your hands are empty and your thumb is resting on
 * nothing, so a bare button held for a second is a thing you find by
 * accident and never find on purpose. Nothing stops while the card is up;
 * ground goes on leaving, which on a circuit costs you a loop and not a
 * life. The card rides in your PLAY AREA rather than the world, because the
 * play area is the part of this place that holds still against your body.
 *
 * This system also owns the body read (head → play-area coordinates) and
 * the transport, because both have to be true before any other course
 * system looks at them.
 */

import { createSystem, InputComponent, VisibilityState } from '@iwsdk/core';
import {
  BackSide,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Raycaster,
  SphereGeometry,
  Vector3,
  type Intersection,
} from 'three';
import * as sfx from '../audio/sfx.js';
import { CLUB } from '../club/config.js';
import { stepRefs } from '../club/step.js';
import { COURSE_ORIGIN, MUSIC, PHASE, PLAY_AREA } from '../course/config.js';
import { conductor, COURSE_BAR_SEC } from '../course/conductor.js';
import { PLATFORMS, validateScore } from '../course/score.js';
import { course, G, resetRide } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { match } from '../game/state.js';
import { PointerRay } from '../ui/pointer.js';
import { Panel, UI } from '../ui/panel.js';
import { courseBars } from '../net/session.js';
import { clubFloorOpen } from '../club/doors.js';
import { updateVoiceListener } from '../club/voice.js';
import { teleportPlayer } from './ClubTeleportSystem.js';

const _head = new Vector3();
const _fwd = new Vector3();
const _origin = new Vector3();
const _dir = new Vector3();
const _quat = new Quaternion();
const _ear = new Vector3();
const _earQ = new Quaternion();

/** The lap lands, the bell rings, and THEN the black comes down. */
const LAP_HOLD = 1.7;

/** Dev window on the door — no thumbstick and no room off-device, so this
 *  is the only way to exercise the crossing headlessly. (`__gdr.course`.) */
export const courseView: {
  enter?: () => void;
  leave?: () => void;
  /** Put the head at a play-area coordinate — the only way to take a step
   *  when there is no body in the room. */
  head?: (x: number, z: number, y?: number) => void;
  /** Where the route says to stand next, in play-area coordinates, or null
   *  while that ground isn't here yet. It is the INVITATION's own answer —
   *  the circle of light on the floor, read back as a number.
   *  (CourseWayfindSystem fills this in.) */
  nextStep?: () => { x: number; z: number } | null;
  /** What colour a platform's deck is actually painted right now, read
   *  back off the live instance buffer — the only way to check that a
   *  hazard is visible without a pair of eyes in the headset.
   *  (CoursePlatformSystem fills this in.) */
  deckTint?: (id: string) => { r: number; g: number; b: number } | null;
  /** Raise or lower THE WAY OUT card; returns whether it is up. */
  menu?: () => boolean;
  /** Press one of its buttons by id — no laser exists off-device. */
  press?: (id: string) => void;
  /** What is on the card right now. */
  buttons?: () => string[];
  state?: () => {
    phase: string;
    active: boolean;
    tracked: string;
    rig: { x: number; y: number; z: number };
    body: { x: number; y: number; z: number };
    laps: number;
    slips: number;
    handovers: number;
    bars: number;
    /** The ground you're standing on: is it travelling, and how many bars
     *  of dwell has it left? The rig may only ever change on a frame where
     *  `moving` is true — that is the no-sliding law, in one field. */
    ground: { moving: boolean; departIn: number };
    /** THE DOOR's live read: is the threshold armed, and where is the head
     *  relative to it? */
    door: { refs: boolean; inside: boolean; armed: boolean; dx: number; dz: number };
  };
} = {};

export class CourseSystem extends createSystem({}) {
  private shade!: Mesh<SphereGeometry, MeshBasicMaterial>;
  private t = 0; // seconds inside the current phase
  private lapsAtEntry = 0;
  private lapHold = -1;
  private squeezeHeld = 0;
  /** THE WAY OUT card, and the lasers that press it. */
  private menu!: Panel;
  private menuUp = false;
  /** Where the card sits in PLAY-AREA space, captured when it is raised so
   *  it holds still against your real room while the world rides past. */
  private menuAt = { x: 0, y: 1.28, z: -1.05, yaw: 0 };
  private pointers!: Record<'left' | 'right', PointerRay>;
  private ray = new Raycaster();
  private hits: Intersection[] = [];
  private hover: string | null = null;
  /** Last painted hover, or null when the card needs a fresh coat. */
  private menuKey: string | null = null;
  /** The threshold only fires on ENTRY: you have to be outside it first, or
   *  coming back out of the door would post you straight back through it. */
  private armed = false;
  private checkedRoom = false;
  /** The door's live read, for the dev window (no controller off-device,
   *  and no room either — this is the only way to see why it didn't fire). */
  private door = { refs: false, inside: false, armed: false, dx: 0, dz: 0 };

  init(): void {
    const root = courseRoot();
    root.position.set(COURSE_ORIGIN.x, COURSE_ORIGIN.y, COURSE_ORIGIN.z);
    this.scene.add(root);
    // A circuit that doesn't tile is a bug in the score, and it should say
    // so on the way up rather than halfway round.
    validateScore();

    // THE CURTAIN — head-locked, a sphere rather than a plane so it covers
    // the field however you turn, and `transparent` at full opacity so it
    // draws after everything it is meant to be hiding (the intro's shade,
    // same reasoning).
    this.shade = new Mesh(
      new SphereGeometry(6, 20, 14),
      new MeshBasicMaterial({
        color: 0x000000,
        side: BackSide,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.shade.renderOrder = 9_000;
    this.shade.name = 'live-course-shade';
    this.shade.visible = false;
    this.scene.add(this.shade);

    // THE WAY OUT — the raid's pause card, resized for two buttons.
    this.menu = new Panel(0.56, 0.36, 560, 360);
    this.menu.setShown(false, true);
    root.add(this.menu.group);
    this.pointers = {
      left: new PointerRay(this.scene),
      right: new PointerRay(this.scene),
    };

    courseView.enter = () => this.begin();
    courseView.leave = () => {
      this.end(true);
      course.phase = 'off';
      course.fade = 0;
      this.t = 0;
    };
    courseView.head = (x, z, y = 1.7) => this.camera.position.set(x, y, z);
    courseView.menu = () => {
      this.setMenu(!this.menuUp);
      return this.menuUp;
    };
    courseView.press = (id) => this.pressed(id);
    courseView.buttons = () => (this.menuUp ? this.menu.buttonIds() : []);
    courseView.state = () => ({
      phase: course.phase,
      active: course.active,
      tracked: PLATFORMS[G.tracked]?.id ?? '?',
      rig: { ...G.rig },
      body: { x: G.body.x, y: G.body.y, z: G.body.z },
      laps: course.laps,
      slips: G.slips,
      handovers: G.handovers,
      bars: G.transport.bars,
      /** How lit THE GATE is (0 out, 1 home). */
      homeward: G.wayfind.homeward,
      ground: {
        moving: G.platforms[G.tracked]?.moving ?? false,
        departIn: G.platforms[G.tracked]?.departIn ?? Infinity,
      },
      door: { ...this.door },
    });
  }

  update(delta: number): void {
    const dt = Math.min(delta, 0.1);
    const menuRoom = match.screen === 'lobby' || match.screen === 'tour';
    const inClub = menuRoom && clubFloorOpen();

    // The floor got booked (or you left the room) while you were out there.
    // No fade and no doorway: the raid's law is "my platform IS the world
    // origin", so the rig goes back to identity exactly as it does when a
    // set takes the club — putting you down by a door in a hall that is
    // being packed away would move your platform for the night.
    if (!inClub && course.phase !== 'off') {
      this.end(false);
      course.phase = 'off';
      course.fade = 0;
      this.t = 0;
      this.armed = false;
    }

    if (course.active) this.readBody(dt);
    this.stepPhase(dt, inClub);

    // The transport only runs while the ride does — the clock and the floor
    // can never disagree about when a platform leaves, so it must not tick
    // through a black screen or a night at the bar. Nor through a system
    // menu: the runtime blurs the session and the ride would carry on
    // leaving without you, behind somebody else's panel.
    const blurred = this.visibilityState.value === VisibilityState.VisibleBlurred;
    conductor.playing = course.active && !blurred;
    if (course.active && !blurred) {
      // The ear goes where the head goes. The club drives the audio listener
      // while you are IN the club and stops the moment you cross, which would
      // leave it parked in a hall 300 m above — and every positional sound out
      // here (the countdown, the chime, the thud) is well outside a panner's
      // max distance from there. Silence, from a bug that looks like a mixer
      // problem.
      this.camera.getWorldPosition(_ear);
      this.camera.getWorldQuaternion(_earQ);
      updateVoiceListener(_ear, _earQ);
      conductor.advance(dt, courseBars(COURSE_BAR_SEC));
      G.transport.bars = conductor.bars;
      G.transport.barPhase = conductor.barPhase;
      G.transport.beat = Math.floor(conductor.barPhase * MUSIC.beatsPerBar);
    }

    this.shade.visible = course.fade > 0.002;
    if (this.shade.visible) {
      this.camera.getWorldPosition(_head);
      this.shade.position.copy(_head);
      this.shade.material.opacity = course.fade;
    }
  }

  /* ── the body ─────────────────────────────────────────────────────────
   * The head and nothing else decides standing and stepping. The camera
   * under `world.player` reports play-area coordinates in XR and out of it,
   * so one read serves both — and while the course owns the rig, the rig IS
   * the play-area origin. */
  private readBody(dt: number): void {
    const cam = this.camera;
    G.body.x = cam.position.x;
    G.body.y = cam.position.y;
    G.body.z = cam.position.z;

    // The ghost overlay — the one deliberate button out here, and the set
    // is finishable without ever finding it. Hold a squeeze, or tap G.
    const pad = this.input.xr.gamepads.left ?? this.input.xr.gamepads.right;
    if (pad?.getButtonPressed(InputComponent.Squeeze)) {
      this.squeezeHeld += dt;
      if (this.squeezeHeld > 1) {
        this.squeezeHeld = -0.6; // a release-ish gap before it can re-toggle
        G.ghosts = !G.ghosts;
      }
    } else {
      this.squeezeHeld = Math.max(0, this.squeezeHeld - dt * 4);
    }
    if (this.input.keyboard.getKeyDown('KeyG')) G.ghosts = !G.ghosts;
  }

  /* ── the crossing ─────────────────────────────────────────────────────── */

  private stepPhase(dt: number, inClub: boolean): void {
    this.t += dt;
    switch (course.phase) {
      case 'off':
        this.t = 0;
        this.watchDoor(inClub);
        break;
      case 'in':
        course.fade = Math.min(1, this.t / PHASE.fadeOut);
        if (course.fade >= 1) {
          this.begin();
          course.phase = 'riding';
          this.t = 0;
        }
        break;
      case 'riding':
        course.fade = Math.max(0, 1 - this.t / PHASE.fadeIn);
        this.watchRide(dt);
        break;
      case 'out':
        course.fade = Math.min(1, this.t / PHASE.fadeOut);
        if (course.fade >= 1) {
          this.end(true);
          course.phase = 'back';
          this.t = 0;
        }
        break;
      case 'back':
        course.fade = Math.max(0, 1 - this.t / PHASE.fadeIn);
        if (course.fade <= 0) course.phase = 'off';
        break;
    }
  }

  /** In the club: light the threshold, and take anyone who steps into it. */
  private watchDoor(inClub: boolean): void {
    const refs = stepRefs();
    this.door.refs = Boolean(refs);
    if (!refs) return;
    const S = CLUB.step;
    if (!inClub) {
      this.armed = false;
      refs.plateMat.opacity = 0.22;
      refs.shimmerMat.opacity = 0.16;
      return;
    }
    this.camera.getWorldPosition(_head);
    const dx = Math.abs(_head.x - S.portalX);
    // positive = in front of the glass, whichever way the frame opens
    const dz = (S.portalZ - _head.z) * S.facing;
    const inside = dx <= S.portalW / 2 && dz >= -0.1 && dz <= S.reach;
    this.door.dx = dx;
    this.door.dz = dz;
    this.door.inside = inside;
    this.door.armed = this.armed;

    // The plate and the pane wake as you close on them: a door you can see
    // is open before you're standing in it.
    const near = Math.max(0, 1 - Math.max(0, dz - S.reach) / 1.9) * (dx < S.portalW / 2 + 0.9 ? 1 : 0.25);
    refs.plateMat.opacity = 0.18 + near * 0.5;
    refs.shimmerMat.opacity = 0.12 + near * 0.3;

    if (!inside) {
      this.armed = true;
      return;
    }
    if (!this.armed) return;
    this.armed = false;
    course.phase = 'in';
    this.t = 0;
    sfx.ensureAudio(); // the crossing's kit needs a live context on the other side
  }

  /** Out on the circuit: watch for the lap closing, and for a held Ⓑ. */
  private watchRide(dt: number): void {
    if (this.lapHold >= 0) {
      this.lapHold += dt;
      if (this.lapHold >= LAP_HOLD) {
        course.phase = 'out';
        this.t = 0;
      }
      return;
    }
    // The circuit closed — it always ends where it started, so the door
    // is exactly where you left it. Let the bell finish, then go.
    if (course.laps > this.lapsAtEntry) {
      this.lapHold = 0;
      return;
    }
    // …or ask for the way out. Right Ⓐ raises the card; the card decides.
    if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      sfx.uiClick();
      this.setMenu(!this.menuUp);
    }
    this.stepMenu(dt);
  }

  /* ── THE WAY OUT ──────────────────────────────────────────────────────── */

  private setMenu(on: boolean, snap = false): void {
    if (on === this.menuUp && !snap) return;
    this.menuUp = on;
    // A crossing snaps it away rather than easing: the panel's own tick
    // stops running the moment the black falls, so a fade left half-played
    // would still be half-played the next time the door opens.
    this.menu.setShown(on, snap);
    this.menuKey = null; // a card just raised has never been painted
    if (!on) {
      this.hover = null;
      this.pointers.left.hide();
      this.pointers.right.hide();
      return;
    }
    // Plant it where you're looking, in PLAY-AREA space: the card is a thing
    // in your room, so it rides with your room rather than being left
    // behind by the first platform that moves.
    this.camera.getWorldQuaternion(_quat);
    _fwd.set(0, 0, -1).applyQuaternion(_quat);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    this.menuAt.x = G.body.x + _fwd.x * 0.9;
    this.menuAt.z = G.body.z + _fwd.z * 0.9;
    this.menuAt.y = Math.max(1.0, G.body.y - 0.3);
    this.menuAt.yaw = Math.atan2(-_fwd.x, -_fwd.z);
  }

  private stepMenu(dt: number): void {
    this.menu.tick(dt, 0.5 * Math.max(0, 1 - (G.transport.barPhase * 4) % 1));
    if (!this.menuUp) return;

    // The card lives in the play area: rig + the offset it was planted at.
    this.menu.group.position.set(
      G.rig.x + this.menuAt.x,
      G.rig.y + this.menuAt.y,
      G.rig.z + this.menuAt.z,
    );
    this.menu.group.rotation.set(-0.18, this.menuAt.yaw, 0);

    let hover: string | null = null;
    let clicked: string | null = null;
    for (const hand of ['left', 'right'] as const) {
      const hit = this.aim(hand, dt);
      const id = hit?.uv ? this.menu.buttonAt(hit.uv.x, hit.uv.y) : null;
      if (!id) continue;
      hover = id;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        clicked = id;
        this.pointers[hand].click();
      }
    }
    if (hover !== this.hover) {
      this.hover = hover;
      if (hover) sfx.uiHover();
    }

    const key = this.hover ?? '';
    if (key !== this.menuKey) {
      this.menuKey = key;
      this.menu.paint(
        '',
        () => {},
        [
          { id: 'ride', label: 'KEEP RIDING', primary: true, x: 24, y: 24, w: 512, h: 148 },
          {
            id: 'quit',
            label: 'LEAVE THE COURSE',
            tone: UI.danger,
            x: 24,
            y: 196,
            w: 512,
            h: 140,
            small: true,
          },
        ],
        this.hover,
      );
    }
    if (clicked) {
      sfx.uiClick();
      this.menu.press(clicked);
      this.pressed(clicked);
    }
  }

  private pressed(id: string): void {
    if (id === 'ride') {
      this.setMenu(false);
    } else if (id === 'quit') {
      this.setMenu(false);
      course.phase = 'out';
      this.t = 0;
    }
  }

  private aim(hand: 'left' | 'right', dt: number): Intersection | undefined {
    const p = this.pointers[hand];
    const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
    if (!rayObj) {
      p.hide();
      return undefined;
    }
    rayObj.getWorldPosition(_origin);
    rayObj.getWorldDirection(_dir).negate();
    this.ray.set(_origin, _dir);
    this.hits.length = 0;
    const hit = this.ray.intersectObjects([this.menu.mesh], false, this.hits)[0];
    const over = Boolean(hit?.uv && this.menu.buttonAt(hit.uv.x, hit.uv.y));
    p.update(dt, _origin, hit ? hit.point : null, over);
    return hit;
  }

  /** Under the black: the club goes, the void comes up, the ride resets. */
  private begin(): void {
    const S = CLUB.step;
    this.setMenu(false, true);
    course.exit.x = S.portalX;
    course.exit.z = S.portalZ - (S.reach + 0.5) * S.facing;
    course.exit.yaw = S.facing > 0 ? 0 : Math.PI; // out of the doorway, back to the glass
    course.active = true;
    course.visited = true;
    courseRoot().visible = true;
    this.lapsAtEntry = course.laps;
    this.lapHold = -1;
    resetRide();
    // Yaw never changes out here, and the play area maps to the world the
    // way it does in a set: your real floor's centre is the pad's centre.
    this.player.rotation.set(0, 0, 0);
    this.player.position.set(COURSE_ORIGIN.x, COURSE_ORIGIN.y, COURSE_ORIGIN.z);
    // Start on the ROOM's bar when there is a room: the circuit has been
    // turning since the club opened, and crossing in joins it mid-lap rather
    // than restarting it under everyone already out there.
    conductor.start(courseBars(COURSE_BAR_SEC) ?? 0);
    this.checkRoom();
  }

  /**
   * Under the black again: the hall returns, and so do you.
   *
   * `toDoor` is the ordinary way home — you come out of THE STEP's frame
   * standing one pace clear of it, facing the hall. Without it the rig just
   * drops to identity, which is what the club itself does whenever it stops
   * being the room you're in.
   */
  private end(toDoor: boolean): void {
    if (!course.active) return;
    this.setMenu(false, true);
    course.active = false;
    courseRoot().visible = false;
    conductor.stop();
    this.player.rotation.set(0, 0, 0);
    this.player.position.set(0, 0, 0);
    if (toDoor) teleportPlayer(this.player, course.exit.x, course.exit.z, course.exit.yaw, 0);
    this.armed = false;
  }

  /**
   * bounded-floor as VALIDATION, never adaptation (research/01 §4, /03 §8.4).
   * The circuit is authored against a fixed 2 × 2 m minimum; what neither
   * exemplar ships is the courtesy of SAYING SO, so we read the real room
   * once and put it on a panel before the first platform moves.
   */
  private checkRoom(): void {
    const session = this.world.session;
    if (!session || this.checkedRoom) return;
    this.checkedRoom = true;
    session
      .requestReferenceSpace('bounded-floor')
      .then((space) => {
        const bounds = (space as XRBoundedReferenceSpace).boundsGeometry;
        if (!bounds || bounds.length < 3) return;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (const p of bounds) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
          minZ = Math.min(minZ, p.z);
          maxZ = Math.max(maxZ, p.z);
        }
        const w = maxX - minX;
        const d = maxZ - minZ;
        if (w < PLAY_AREA.requiredWidth || d < PLAY_AREA.requiredDepth) {
          course.roomWarn = { w, d };
        }
      })
      .catch(() => {
        // No bounded-floor on this runtime: nothing to validate against.
      });
  }
}
