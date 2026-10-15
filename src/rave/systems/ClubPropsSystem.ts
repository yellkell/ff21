/**
 * ClubPropsSystem — THE DUMBWAITER and the drinks it serves.
 *
 * No bartender in this house: a brass square set into the bar top RISES
 * with a coupe on it. Take the drink and the square sinks away, pauses,
 * and comes back up carrying another — the venue's quiet little theatre,
 * on a loop, for as long as the floor is open.
 *
 * The holding and throwing is FIRE FIGHT's pub feel, ported whole:
 *
 *  - RANGE GRAB: aim within a 30° cone at a glass inside a metre and
 *    squeeze (or trigger) — it snaps to your hand. The aimable glass
 *    glows so the affordance is never a mystery.
 *  - THROW: a five-frame ring buffer of real hand positions becomes the
 *    release velocity (capped — a coupe is not a fastball), with tumble
 *    seeded from the throw.
 *  - FLIGHT: gravity, wall reflections with per-wall heights (a lob
 *    clears the bar counter; a line drive rings off it), landings on any
 *    surface the venue knows — bar top, booth tables, terrace, stage,
 *    the floor — with bounce, SKID or settle split by speed, and a glass
 *    that eases upright rather than snapping. Substepped, so a hard throw
 *    meets the table edge it's aimed at instead of passing through it.
 *  - SEATED, NOT SUNK: contact is the glass's own lowest point, worked out
 *    from its profile and its tilt, so a coupe on its side lies on its rim
 *    and never puts its stem and bowl through the floor.
 *  - GLASS ON GLASS: they clack off each other and off the ones already
 *    standing about, and a struck glass is claimed off the relay so one
 *    client owns the motion it just picked up.
 *  - DRINK: bring it to your face and the cocktail's gone (the fill
 *    empties with a slurp). New glasses come full.
 *
 * And SHARED, the FIRE FIGHT server pattern (server/index.mjs, DRINKS):
 * the relay brokers ownership and owns the serve clock, so the whole room
 * watches ONE plate raise ONE glass:
 *
 *  - GRAB is optimistic — the hand takes the glass instantly and asks the
 *    relay; if somebody's claim landed first, the relay names the real
 *    holder and the glass leaves the loser's hand. Mid-FLIGHT glasses
 *    are fair game — a catch — exactly the FIRE FIGHT grant rule.
 *  - One owner simulates each moving glass and streams pose + fill at
 *    ~20 Hz; everyone else eases toward the stream (k = 1 − e^(−18Δ),
 *    snapping across big jumps). A settled throw posts its final pose;
 *    resting glasses are server-remembered and walk into late joiners'
 *    'props' snapshots. Dancers dealt onto the ring drop what they held.
 *  - An older relay with no drink words? The plate just stays down.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import * as sfx from '../audio/sfx.js';
import { CLUB, DECOR, floorYAt } from '../club/config.js';
import {
  buildCoupe,
  coupeBottomOffset,
  PROP_PHYS,
  PROP_SURFACES,
  PROP_WALLS,
  type CoupeRefs,
} from '../club/props.js';
import { match } from '../game/state.js';
import { course } from '../course/state.js';
import {
  net,
  onProp,
  sendPropGrab,
  sendPropPose,
  sendPropRelease,
  sendPropRest,
  type PropWire, inRoom as roomOpen, setPropPoolSize } from '../net/session.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

/** Glass pool size — MUST match the relay's PROP_COUNT (server/rave.mjs).
 *  Twelve: enough for a tower AND a round on the bar. */
const POOL = 12;
/** The dumbwaiter's square, set into the bar top mid-counter. The relay owns
 *  its clock; this side only plays the plate's travel (exp ease). */
const WAITER = {
  x: CLUB.bar.x + CLUB.bar.depth / 2,
  z: -3.2,
  top: CLUB.bar.top,
  size: 0.26,
  drop: 0.32,
  ease: 8,
};
/** Drink detection: glass near your face while held. */
const SIP_DIST = 0.28;
/** Owner pose stream cadence (s) — ~20 Hz, FIRE FIGHT's rate. */
const STREAM_S = 0.05;
/** Remote glasses ease toward the stream at this rate; snap beyond 2 m. */
const NET_EASE = 18;

/**
 * Every glass that's out, in WORLD space — republished each frame the floor
 * is live.
 *
 * This exists for THE MIRROR, which casts bodies only and so used to show
 * you a reflection miming an empty grip. It can't reach into this system's
 * private pool for the pose: a glass in your own hand is parented to a
 * controller, and a room-mate's is easing toward a streamed one. Both are
 * resolved to world here, once, where they're already known.
 *
 * A LIST, not a map by holder. Keying it by who was carrying it meant one
 * drink each — so a second glass, or one set down on the ledge while three
 * of you posed, simply wasn't in the reflection.
 */
export interface GlassView {
  id: number;
  pos: Vector3;
  quat: Quaternion;
  /** Still has a cocktail in it — drink it and the fill goes. */
  full: boolean;
  /** Member idx of whoever is carrying it, or null if it's standing free. */
  heldBy: number | null;
}
export const liveGlasses: GlassView[] = [];

type Mode = 'idle' | 'pedestal' | 'held' | 'flight' | 'rest';

interface Glass {
  id: number;
  refs: CoupeRefs;
  mode: Mode;
  /** Who simulates it while it moves: my idx, a room-mate's, or nobody. */
  owner: number | null;
  vel: Vector3;
  /** Skidding along a surface rather than falling through the air — still
   *  'flight' to the room (owner-simulated, streamed), just with its feet
   *  down and `slideFriction` grinding it to a stop. */
  grounded: boolean;
  /** Tumble axis+rate while flying. */
  spinAxis: Vector3;
  spin: number;
  hand: Hand | null;
  full: boolean;
  /** Ring buffer of recent world positions while held. */
  ring: { pos: Vector3; t: number }[];
  /** Age counter for recycling the oldest resting glass. */
  restedAt: number;
  /** Clock of this glass's last tap — the ration that keeps a settling
   *  tower from ringing a dozen times (PROP_PHYS.tapCooldown). */
  tappedAt: number;
  /** The owner's streamed pose (world), and when it last arrived. */
  netPos: Vector3;
  netQuat: Quaternion;
  netAt: number;
}

type WaiterPhase = 'down' | 'sinking' | 'rising' | 'up';

/** Dev window on the drinks: read the pool's state, and launch a glass on
 *  a known trajectory, so the physics can be exercised without a room-mate
 *  and a good arm. (`__gdr.props`.) */
export const propsView: {
  glasses?: () => Array<{
    id: number;
    mode: Mode;
    grounded: boolean;
    pos: [number, number, number];
    vel: [number, number, number];
    /** Tumble rate (rad/s) and who is simulating it. */
    spin: number;
    spinAxis: [number, number, number];
    owner: number | null;
    /** How far the glass's lowest point sits above the surface under it —
     *  0 is seated, negative means it is INSIDE the floor. Counts another
     *  glass's rim as a surface, so a stacked glass reads 0 too. */
    clearance: number;
    /** World-Y of the glass's own up axis: 1 standing, 0 flat on its side. */
    upright: number;
  }>;
  /** Throw glass `id` from `at` at `vel`. `spin` (rad/s about an axis square
   *  to the throw) tumbles it, which is the only way to land one anything
   *  other than upright now that nothing rights itself. */
  launch?: (id: number, at: [number, number, number], vel: [number, number, number], spin?: number) => void;
  /** Put glass `id` in a hand (or `null` to let go of whatever is in that
   *  hand) through the real grab/release path — there is no trigger to pull
   *  off-device, and holding one is half of what the props do. */
  hold?: (id: number | null, hand?: Hand) => void;
} = {};

export class ClubPropsSystem extends createSystem({}) {
  private group = new Group();
  private glasses: Glass[] = [];
  /** Hands propsView.hold() is pretending to squeeze. There is no trigger to
   *  pull off-device, and stepHands lets go the instant it reads one open,
   *  so a headless grab would last exactly one frame without this. Empty in
   *  real play. */
  private devGrip = new Set<Hand>();
  /** One reusable GlassView per pool slot — see publishLive(). */
  private views: GlassView[] = Array.from({ length: POOL }, (_, id) => ({
    id,
    pos: new Vector3(),
    quat: new Quaternion(),
    full: true,
    heldBy: null as number | null,
  }));
  private plate!: Mesh;
  private waiterPhase: WaiterPhase = 'down';
  private served: Glass | null = null;
  private highlight: Partial<Record<Hand, Glass | null>> = {};
  private clock = 0;
  private streamT = 0;
  private hadRoom = false;

  init(): void {
    this.group.name = 'club-props';
    this.group.visible = false;
    this.scene.add(this.group);
    setPropPoolSize(POOL); // the room of one serves from the same pool

    // The collar: a dark square frame in the counter, reading as the hatch.
    const collar = new Mesh(
      new BoxGeometry(WAITER.size + 0.06, 0.012, WAITER.size + 0.06),
      new MeshStandardMaterial({ color: 0x14121a, roughness: 0.6, metalness: 0.3 }),
    );
    collar.position.set(WAITER.x, WAITER.top + 0.006, WAITER.z);
    this.group.add(collar);

    // The plate itself — champagne brass, like everything that moves here.
    this.plate = new Mesh(
      new BoxGeometry(WAITER.size, 0.024, WAITER.size),
      new MeshStandardMaterial({ color: DECOR.brass, roughness: 0.35, metalness: 0.75 }),
    );
    this.plate.position.set(WAITER.x, WAITER.top - WAITER.drop, WAITER.z);
    this.group.add(this.plate);

    for (let i = 0; i < POOL; i++) {
      const refs = buildCoupe();
      refs.root.visible = false;
      this.group.add(refs.root);
      this.glasses.push({
        id: i,
        refs,
        mode: 'idle',
        owner: null,
        vel: new Vector3(),
        grounded: false,
        spinAxis: new Vector3(0, 1, 0),
        spin: 0,
        hand: null,
        full: true,
        ring: [],
        restedAt: 0,
        tappedAt: -Infinity,
        netPos: new Vector3(),
        netQuat: new Quaternion(),
        netAt: 0,
      });
    }

    // The wire mutates the glasses directly — even while we're away on the
    // ring (the group hides, but the state stays true to the room).
    onProp((msg) => this.onWire(msg));

    propsView.glasses = () =>
      this.glasses.map((g) => {
        // WORLD, not local: a held glass is parented to a controller, where
        // its local position is the palm offset and tells you nothing.
        const p = g.refs.root.getWorldPosition(_p);
        const drop = this.bottomOffset(g);
        // Read the up axis into a LOCAL before anything else runs: the
        // clearance below asks supportAt(), which sets the shared `_up`
        // from every resting glass it looks at — so an `upright` taken
        // from `_up` after it reported the last neighbour's, not this
        // glass's, and every coupe read as standing once any one rested.
        _up.set(0, 1, 0).applyQuaternion(g.refs.root.quaternion);
        const upright = _up.y;
        return {
          id: g.id,
          mode: g.mode,
          grounded: g.grounded,
          pos: [p.x, p.y, p.z] as [number, number, number],
          vel: [g.vel.x, g.vel.y, g.vel.z] as [number, number, number],
          spin: g.spin,
          spinAxis: [g.spinAxis.x, g.spinAxis.y, g.spinAxis.z] as [number, number, number],
          owner: g.owner,
          clearance: p.y + drop - this.supportAt(p.x, p.z, g, p.y),
          /** World-Y of the glass's own up axis: 1 standing, 0 on its side. */
          upright,
        };
      });
    propsView.launch = (id, at, vel, spin = 0) => {
      const glass = this.glasses[id];
      if (!glass) return;
      this.disown(glass);
      glass.refs.root.visible = true;
      glass.refs.root.position.set(at[0], at[1], at[2]);
      glass.refs.root.quaternion.identity();
      glass.vel.set(vel[0], vel[1], vel[2]);
      glass.spin = spin;
      if (spin) {
        // The same axis a real throw seeds: up × velocity, so it tumbles
        // end over end along its flight rather than spinning like a top.
        glass.spinAxis.set(0, 1, 0).cross(glass.vel);
        if (glass.spinAxis.lengthSq() < 1e-6) glass.spinAxis.set(1, 0, 0);
        glass.spinAxis.normalize();
      }
      glass.grounded = false;
      glass.mode = 'flight';
      glass.owner = net.myIdx;
      this.toGroup(glass);
    };
    propsView.hold = (id, hand = 'right') => {
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!rayObj) return;
      if (id === null) {
        this.devGrip.delete(hand);
        for (const g of this.glasses) if (g.hand === hand && g.mode === 'held') this.release(g);
        return;
      }
      const glass = this.glasses[id];
      if (!glass) return;
      this.disown(glass);
      glass.refs.root.visible = true;
      this.devGrip.add(hand);
      this.grab(glass, hand, rayObj);
    };
  }

  update(delta: number): void {
    const inRoom = roomOpen() || net.phase === 'live';
    if (!inRoom) {
      if (this.hadRoom) {
        this.hadRoom = false;
        this.packAway();
      }
      return;
    }
    this.hadRoom = true;
    // Not while the west door has you: a pint left standing on the bar
    // does not follow you out onto a moving platform.
    const onFloor = (match.screen === 'lobby' || match.screen === 'tour') && !course.active;
    if (this.group.visible !== onFloor) this.group.visible = onFloor;

    this.clock += delta;
    this.stepWaiter(delta);

    if (onFloor) {
      this.stepHands(delta);
      this.streamOwned(delta);
    } else {
      this.shelveHeld();
    }

    for (const glass of this.glasses) {
      const mine = glass.owner === net.myIdx;
      if ((glass.mode === 'held' || glass.mode === 'flight') && !mine) {
        this.easeToStream(glass, delta);
      } else if (glass.mode === 'flight' && mine) {
        this.stepFlight(glass, delta);
      } else if (glass.mode === 'rest') {
        this.stepRest(glass, delta);
      }
    }

    this.publishLive();
  }

  /**
   * Every glass that's out, resolved to world space for the mirror. Rebuilt
   * in place — the records are allocated once per pool slot and re-filled,
   * so a per-frame publish costs no garbage.
   */
  private publishLive(): void {
    liveGlasses.length = 0;
    for (const glass of this.glasses) {
      if (glass.mode === 'idle') continue;
      const rec = this.views[glass.id];
      glass.refs.root.getWorldPosition(rec.pos);
      glass.refs.root.getWorldQuaternion(rec.quat);
      rec.full = glass.full;
      rec.heldBy = glass.mode === 'held' ? glass.owner : null;
      liveGlasses.push(rec);
    }
  }

  /** We left the room entirely: everything goes home, the plate parks. */
  private packAway(): void {
    for (const g of this.glasses) {
      g.mode = 'idle';
      g.owner = null;
      g.grounded = false;
      g.hand = null;
      g.netAt = 0;
      g.refs.root.visible = false;
      this.toGroup(g);
    }
    this.served = null;
    this.waiterPhase = 'down';
    this.plate.position.y = WAITER.top - WAITER.drop;
    this.highlight = {};
    this.group.visible = false;
    liveGlasses.length = 0;
  }

  /** Dealt onto the ring mid-drink: nothing rides the controllers into the
   *  set. Unhand locally; the relay's drop ('prop-rest') places the glass. */
  private shelveHeld(): void {
    for (const glass of this.glasses) {
      if (glass.owner !== net.myIdx) continue;
      if (glass.mode !== 'held' && glass.mode !== 'flight') continue;
      glass.mode = 'rest';
      glass.owner = null;
      glass.hand = null;
      glass.grounded = false;
      glass.restedAt = this.clock;
      this.toGroup(glass);
    }
  }

  /* ── the dumbwaiter (event-driven: 'serve' raises, a grab sinks) ──────── */

  private stepWaiter(delta: number): void {
    const topY = WAITER.top + 0.012;
    const downY = WAITER.top - WAITER.drop;
    const up = this.waiterPhase === 'rising' || this.waiterPhase === 'up';
    const target = up ? topY : downY;
    const y = this.plate.position.y;
    const next = y + (target - y) * (1 - Math.exp(-WAITER.ease * delta));
    this.plate.position.y = next;
    if (this.waiterPhase === 'rising' && Math.abs(target - next) < 0.004) {
      this.waiterPhase = 'up';
      if (this.group.visible) sfx.glassTap(false);
    } else if (this.waiterPhase === 'sinking' && Math.abs(target - next) < 0.004) {
      this.waiterPhase = 'down';
    }

    // The served glass rides the plate.
    if (this.served && this.served.mode === 'pedestal') {
      this.served.refs.root.position.set(WAITER.x, this.plate.position.y + 0.012, WAITER.z);
    }
  }

  /* ── hands: highlight, grab, hold, drink, release ─────────────────────── */

  private stepHands(_delta: number): void {
    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!gp || !rayObj) continue;

      const held =
        this.glasses.find(
          (g) => g.mode === 'held' && g.hand === hand && g.owner === net.myIdx,
        ) ?? null;

      if (held) {
        // Sample the hand's motion for the throw, and watch for the sip.
        held.refs.root.getWorldPosition(_p);
        held.ring.push({ pos: _p.clone(), t: this.clock });
        if (held.ring.length > 5) held.ring.shift();

        if (held.full) {
          this.camera.getWorldPosition(_head);
          if (_p.distanceTo(_head) < SIP_DIST) {
            held.full = false; // the stream carries the empty to the room
            held.refs.fill.visible = false;
            sfx.slurp();
          }
        }

        const holding =
          this.devGrip.has(hand) ||
          gp.getButtonPressed(InputComponent.Squeeze) ||
          gp.getButtonPressed(InputComponent.Trigger);
        if (!holding) this.release(held);
        continue;
      }

      // Nothing in this hand: find the aimable glass (cone + reach).
      const target = this.findRangeTarget(rayObj);
      const prev = this.highlight[hand] ?? null;
      if (prev !== target) {
        if (prev) this.setGlow(prev, false);
        if (target) this.setGlow(target, true);
        this.highlight[hand] = target;
      }
      if (
        target &&
        (gp.getButtonDown(InputComponent.Squeeze) || gp.getButtonDown(InputComponent.Trigger))
      ) {
        this.grab(target, hand, rayObj);
      }
    }
  }

  private findRangeTarget(rayObj: import('three').Object3D): Glass | null {
    rayObj.getWorldPosition(_o);
    rayObj.getWorldDirection(_d).negate().normalize();
    let best: Glass | null = null;
    let bestScore = -Infinity;
    for (const g of this.glasses) {
      // Resting, on the pedestal, or mid-air (anyone's throw — a catch).
      // Never out of someone's closed hand.
      if (g.mode !== 'rest' && g.mode !== 'pedestal' && g.mode !== 'flight') continue;
      g.refs.root.getWorldPosition(_p);
      _p.y += 0.11; // aim at the bowl, not the foot
      _v.copy(_p).sub(_o);
      const dist = _v.length();
      if (dist > PROP_PHYS.grabMaxDist || dist < 0.02) continue;
      const aim = _v.normalize().dot(_d);
      if (aim < PROP_PHYS.grabConeCos) continue;
      const score = aim - dist * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = g;
      }
    }
    return best;
  }

  private setGlow(glass: Glass, on: boolean): void {
    const mat = glass.refs.glass.material as MeshStandardMaterial;
    mat.emissive.setHex(on ? 0xfff2dc : 0x000000);
    mat.emissiveIntensity = on ? 0.45 : 0;
  }

  /** Take it on spec — the relay's grant (or correction) follows. */
  private grab(glass: Glass, hand: Hand, rayObj: import('three').Object3D): void {
    glass.mode = 'held';
    glass.owner = net.myIdx;
    glass.grounded = false;
    glass.hand = hand;
    glass.ring.length = 0;
    this.setGlow(glass, false);
    this.highlight[hand] = null;
    rayObj.attach(glass.refs.root);
    // Settle it into the palm: just below the grip, upright.
    glass.refs.root.position.set(0, -0.03, -0.06);
    glass.refs.root.quaternion.identity();
    sfx.glassTap(false);
    sendPropGrab(glass.id);
  }

  private release(glass: Glass): void {
    glass.hand = null;
    this.toGroup(glass);

    // The throw: displacement across the ring buffer over its time span.
    const ring = glass.ring;
    if (ring.length >= 2) {
      const first = ring[0];
      const last = ring[ring.length - 1];
      const dt = Math.max(last.t - first.t, 1 / 90);
      glass.vel.copy(last.pos).sub(first.pos).divideScalar(dt);
      if (glass.vel.length() > PROP_PHYS.maxThrowSpeed) glass.vel.setLength(PROP_PHYS.maxThrowSpeed);
    } else {
      glass.vel.set(0, 0, 0);
    }
    const speed = glass.vel.length();
    if (speed > 2) sfx.throwWhoosh();
    // Tumble seeded from the throw: axis = up × velocity.
    glass.spinAxis.set(0, 1, 0).cross(glass.vel);
    if (glass.spinAxis.lengthSq() < 1e-6) glass.spinAxis.set(1, 0, 0);
    glass.spinAxis.normalize();
    glass.spin = Math.min(PROP_PHYS.spinMax, speed * PROP_PHYS.spinFromThrow);
    glass.grounded = false; // thrown, not skidding
    glass.mode = 'flight'; // still mine to simulate — and now catchable
    sendPropRelease(glass.id);
  }

  /* ── flight, landing, rest ────────────────────────────────────────────── */

  /** How hard a surface grinds a skidding glass, by what the surface is —
   *  read off its height: the bar's polished top, a table, the floor. */
  private frictionAt(surfaceY: number): number {
    if (Math.abs(surfaceY - CLUB.bar.top) < 0.02) return PROP_PHYS.frictionBar;
    if (surfaceY > 0.3) return PROP_PHYS.frictionTable;
    return PROP_PHYS.frictionFloor;
  }

  /** The ARCHITECTURE under a point: floor, table, ledge. Knows nothing
   *  about glasses — supportAt() layers those on top. */
  private restingYAt(x: number, z: number): number {
    let y = floorYAt(x, z);
    for (const s of PROP_SURFACES) {
      if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && s.y > y) y = s.y;
    }
    return y;
  }

  /**
   * THE SURFACE UNDER A GLASS — the room's, or another glass's RIM.
   *
   * This is the whole stacking feature in one function. A resting coupe
   * that is standing upright presents its rim as a disc you may put a foot
   * on; anything whose base centre overlaps that disc (stackReach) is
   * carried at rim height. The upper glass of a pyramid overlaps two rims
   * at once and is carried by whichever is highest — which, on a level
   * pair, is both.
   *
   * `originY` is the asking glass's own origin: a shelf has to sit
   * meaningfully BELOW it (stackLevelEps), which is what stops two glasses
   * side by side from each claiming to hold the other up, and makes cycles
   * impossible rather than merely unlikely.
   *
   * Pure and deterministic — same positions, same answer on every client.
   */
  private supportAt(x: number, z: number, exclude: Glass | null, originY: number): number {
    let y = this.restingYAt(x, z);
    for (const other of this.glasses) {
      if (other === exclude || other.mode !== 'rest') continue;
      const oRoot = other.refs.root;
      if (oRoot.position.y > originY - PROP_PHYS.stackLevelEps) continue; // not below me
      _up.set(0, 1, 0).applyQuaternion(oRoot.quaternion);
      if (_up.y < PROP_PHYS.stackUprightMin) continue; // lying down: scenery, not a shelf
      const rimY = oRoot.position.y + PROP_PHYS.rimY;
      if (rimY <= y) continue; // something better already carries this spot
      if (Math.hypot(x - oRoot.position.x, z - oRoot.position.z) > PROP_PHYS.stackReach) continue;
      y = rimY;
    }
    return y;
  }

  /**
   * Is `glass` STANDING ON `shelf` — its foot on that glass's rim?
   *
   * The precise question, because the cheap proxy for it (are they at
   * similar heights?) is wrong in both directions: two glasses thrown at
   * each other arrive a hand's width apart in height and are absolutely
   * colliding, while a tall stack's levels are far apart and absolutely
   * are not. Ask about the contact itself — upright shelf, foot inside
   * the rim disc, base sitting at rim height — and both cases answer
   * correctly.
   */
  private isStandingOn(glass: Glass, shelf: Glass): boolean {
    const a = glass.refs.root;
    const b = shelf.refs.root;
    _up.set(0, 1, 0).applyQuaternion(b.quaternion);
    if (_up.y < PROP_PHYS.stackUprightMin) return false;
    if (Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > PROP_PHYS.stackReach) return false;
    const footY = a.position.y + this.bottomOffset(glass);
    return Math.abs(footY - (b.position.y + PROP_PHYS.rimY)) < PROP_PHYS.stackSameLevel;
  }

  /** Are these two in a stack — either one standing on the other? Neither
   *  may shove the other: the shelf holds it up, it does not push it off. */
  private stacked(a: Glass, b: Glass): boolean {
    return this.isStandingOn(a, b) || this.isStandingOn(b, a);
  }

  /** Ring the glass — but only for a real knock, and never twice in a
   *  breath from the same glass (see PROP_PHYS.tapMinSpeed/tapCooldown). */
  private tap(glass: Glass, speed: number, hard: boolean): void {
    if (speed < PROP_PHYS.tapMinSpeed) return;
    if (this.clock - glass.tappedAt < PROP_PHYS.tapCooldown) return;
    glass.tappedAt = this.clock;
    sfx.glassTap(hard);
  }

  /** How far this glass's lowest point sits below its origin right now. */
  private bottomOffset(glass: Glass): number {
    _up.set(0, 1, 0).applyQuaternion(glass.refs.root.quaternion);
    return coupeBottomOffset(_up.y);
  }

  /**
   * Flight, SUBSTEPPED. A capped throw crosses 15 cm in a 90 Hz frame while
   * the landing test only samples where the step ends, so one step per frame
   * let hard throws pass clean through the edge of the bar. Cap how far any
   * one step may travel and the glass meets the things it flies into.
   */
  private stepFlight(glass: Glass, delta: number): void {
    const frame = Math.min(delta, PROP_PHYS.maxFrame);
    const reach = glass.vel.length() * frame;
    const steps = Math.max(1, Math.min(PROP_PHYS.maxSubsteps, Math.ceil(reach / PROP_PHYS.maxStep)));
    const dt = frame / steps;
    for (let i = 0; i < steps && glass.mode === 'flight'; i++) this.integrate(glass, dt);
  }

  private integrate(glass: Glass, delta: number): void {
    const root = glass.refs.root;
    _prev.copy(root.position);
    _up.set(0, 1, 0).applyQuaternion(root.quaternion);
    // A grounded glass is SLIDING or ROLLING, not falling: it keeps its
    // footing and loses speed to the surface instead of to gravity.
    if (glass.grounded) {
      // THE TIP. Gravity's torque, cheaply: landed on its foot it rights;
      // landed on its rim edge it goes over onto its side — a skidding
      // glass used to keep whatever tilt it hit the floor with.
      if (_up.y < 0.999 && _up.y > -0.999) {
        const standing = _up.y > PROP_PHYS.tipUprightMin;
        if (standing) _axis.set(0, 1, 0);
        else _axis.set(_up.x, 0, _up.z).normalize();
        _wq.setFromUnitVectors(_up, _axis);
        _q.identity().slerp(_wq, Math.min(1, PROP_PHYS.tipRate * delta));
        root.quaternion.premultiply(_q);
        _up.set(0, 1, 0).applyQuaternion(root.quaternion);
      }
      const horiz = Math.hypot(glass.vel.x, glass.vel.z);
      const lying = _up.y < PROP_PHYS.rollUprightMax;
      if (lying && horiz > PROP_PHYS.slideStop) {
        // ROLLING. The heading bends toward the foot (the narrow end of the
        // cone), the glass turns about the floor-axis across its travel at
        // rim speed, and rolling resistance is gentler than a skid's grind.
        _axis.set(_up.x, 0, _up.z); // which way the rim points, on the floor
        _dir.set(glass.vel.x / horiz, 0, glass.vel.z / horiz);
        // Sign: is the foot to the left or right of the travel?
        const side = Math.sign(_dir.x * _axis.z - _dir.z * _axis.x) || 1;
        const turn = side * PROP_PHYS.rollCurvature * horiz * delta;
        const c = Math.cos(turn);
        const sn = Math.sin(turn);
        const vx = glass.vel.x * c - glass.vel.z * sn;
        const vz = glass.vel.x * sn + glass.vel.z * c;
        glass.vel.x = vx;
        glass.vel.z = vz;
        // Roll about the axis perpendicular to travel, lying in the floor
        // — and swing the glass's own axis onto that line as it goes: a
        // cylinder cannot roll along its axis, so one that landed skewed
        // squares up across its travel within a turn or two.
        _axis.set(0, 1, 0).cross(_dir).normalize();
        const along = _axis.dot(_up);
        if (Math.abs(along) < 0.995) {
          if (along < 0) _axis.negate();
          _wq.setFromUnitVectors(_up, _axis);
          _q.identity().slerp(_wq, Math.min(1, PROP_PHYS.rollAlignRate * delta));
          root.quaternion.premultiply(_q);
          if (along < 0) _axis.negate();
        }
        _q.setFromAxisAngle(_axis, (horiz / PROP_PHYS.rimR) * delta);
        root.quaternion.premultiply(_q);
        glass.spin = 0; // the roll IS the spin now
        const roll = Math.exp(-PROP_PHYS.rollFriction * delta);
        glass.vel.x *= roll;
        glass.vel.z *= roll;
      } else {
        const grind = Math.exp(-this.frictionAt(root.position.y - this.bottomOffset(glass)) * delta);
        glass.vel.x *= grind;
        glass.vel.z *= grind;
      }
      glass.vel.y = 0;
    } else {
      glass.vel.y -= PROP_PHYS.gravity * delta;
    }
    root.position.addScaledVector(glass.vel, delta);

    // Tumble, bleeding off in the air.
    if (glass.spin > 0.01) {
      _q.setFromAxisAngle(glass.spinAxis, glass.spin * delta);
      root.quaternion.premultiply(_q);
      glass.spin *= Math.exp(-PROP_PHYS.spinDamp * delta);
    }

    // Walls: axis-aligned segments with heights — reflect the crossing
    // component, damp, and ring the glass. It is the BOWL that meets the
    // wall (a sphere of bodyR round it), not the origin at the foot: a
    // glass used to sink its bowl a bowl's width into the plaster before
    // the maths noticed, and ring off the wall late.
    _up.set(0, 1, 0).applyQuaternion(root.quaternion);
    _c1.copy(root.position).addScaledVector(_up, PROP_PHYS.bodyY); // the bowl, now
    const R = PROP_PHYS.bodyR;
    for (const w of PROP_WALLS) {
      if (_c1.y - R > w.h) continue;
      if (w.ax === w.bx) {
        // Vertical (constant-x) wall.
        const z0 = Math.min(w.az, w.bz);
        const z1 = Math.max(w.az, w.bz);
        if (_c1.z < z0 || _c1.z > z1) continue;
        const side = Math.sign(_prev.x + (_c1.x - root.position.x) - w.ax) || 1;
        const pen = R - side * (_c1.x - w.ax);
        if (pen > 0) {
          root.position.x += side * pen;
          _c1.x += side * pen;
          if (side * glass.vel.x < 0) {
            glass.vel.x *= -PROP_PHYS.restitution;
            glass.vel.z *= 0.8;
            sfx.glassTap(Math.abs(glass.vel.x) > 0.8);
          }
        }
      } else {
        const x0 = Math.min(w.ax, w.bx);
        const x1 = Math.max(w.ax, w.bx);
        if (_c1.x < x0 || _c1.x > x1) continue;
        const side = Math.sign(_prev.z + (_c1.z - root.position.z) - w.az) || 1;
        const pen = R - side * (_c1.z - w.az);
        if (pen > 0) {
          root.position.z += side * pen;
          _c1.z += side * pen;
          if (side * glass.vel.z < 0) {
            glass.vel.z *= -PROP_PHYS.restitution;
            glass.vel.x *= 0.8;
            sfx.glassTap(Math.abs(glass.vel.z) > 0.8);
          }
        }
      }
    }

    // Glass on glass, before the ground has its say.
    this.collideGlasses(glass);

    // The ground (or whatever surface is under it). The contact height is
    // the glass's OWN lowest point, not its origin: the origin sits at the
    // base, so a tilted coupe would bury its stem and bowl in the floor.
    // The surface under it — the room's, or another glass's rim, which is
    // what lets a thrown coupe land ON a tower instead of through it.
    const surfaceY = this.supportAt(root.position.x, root.position.z, glass, root.position.y);
    const restY = surfaceY - this.bottomOffset(glass);
    // A grounded glass is allowed a little computed LIFT: tipping and
    // rolling move its lowest point by millimetres every substep, and
    // treating each of those as "the floor went away" had a rolling coupe
    // un-grounding, dropping two centimetres and landing again every other
    // frame. Only a real drop (a table edge, the terrace lip) lets it go.
    const slack = glass.grounded ? 0.045 : 0;
    if (root.position.y <= restY + slack && (glass.grounded || _prev.y >= restY - 0.02)) {
      root.position.y = restY;
      const vy = Math.abs(glass.vel.y);
      const horiz = Math.hypot(glass.vel.x, glass.vel.z);
      if (!glass.grounded && (glass.vel.length() >= PROP_PHYS.settleSpeed && vy >= 0.5)) {
        // Fast enough to come back up: bounce — and a bounce with sideways
        // speed puts TUMBLE in, about the floor-axis across the travel,
        // the way a glass skipped off a bar top turns over in the air.
        glass.vel.y = vy * PROP_PHYS.restitution;
        glass.vel.x *= 0.7;
        glass.vel.z *= 0.7;
        if (horiz > 0.2) {
          _axis.set(0, 1, 0).cross(_dir.set(glass.vel.x, 0, glass.vel.z).normalize());
          if (_axis.lengthSq() > 1e-6) {
            glass.spinAxis.copy(_axis.normalize());
            glass.spin = Math.min(PROP_PHYS.spinMax, glass.spin * 0.4 + horiz * PROP_PHYS.spinFromBounce);
          }
        } else {
          glass.spin *= 0.6;
        }
        this.tap(glass, vy, vy > 1.2);
      } else if (horiz > PROP_PHYS.slideStop) {
        // Too slow to bounce but still travelling: SKID. This is what
        // `slideFriction` was always for — a glass that lands on a bar top
        // carries across it and slows, rather than stopping where it hit.
        if (!glass.grounded) {
          glass.grounded = true;
          glass.vel.y = 0;
          glass.spin *= 0.4;
          this.tap(glass, vy, vy > 1.2);
        }
      } else {
        this.settle(glass, Math.max(vy, horiz));
      }
    } else if (glass.grounded) {
      // The floor went out from under a skidding glass — off a table edge,
      // or over the lip of the terrace. Let it fall.
      glass.grounded = false;
    } else if (root.position.y < -2) {
      // Fell out of the world somehow — back to the pool.
      glass.mode = 'idle';
      glass.owner = null;
      glass.refs.root.visible = false;
      sendPropRest(glass.id, null, null);
    }
  }

  /** Done moving: park it, free it, and tell the room where it ended up.
   *  `impact` is how hard it arrived — a glass placed on a tower touches
   *  down at nearly nothing and settles SILENTLY, which is the difference
   *  between building a stack and setting off a wind chime. */
  private settle(glass: Glass, impact = 0): void {
    const root = glass.refs.root;
    glass.mode = 'rest';
    glass.owner = null;
    glass.grounded = false;
    glass.restedAt = this.clock;
    glass.vel.set(0, 0, 0);
    glass.spin = 0;
    this.tap(glass, impact, false);
    // The pose sticks room-wide — and frees the glass for anyone.
    sendPropRest(
      glass.id,
      [root.position.x, root.position.y, root.position.z],
      [root.quaternion.x, root.quaternion.y, root.quaternion.z, root.quaternion.w],
    );
  }

  /**
   * GLASS ON GLASS. Each glass I simulate is bounced off every other one —
   * a sphere round each bowl, an equal-mass exchange along the line between
   * them, and a shove apart so they never share space.
   *
   * The struck glass answers too, but only if it's free to: hit something
   * resting on a table and I CLAIM it (grab, then release, which is the
   * relay's word for "flying and catchable") so one client owns the new
   * motion and streams it. A glass in somebody's hand doesn't budge — their
   * hand outranks my throw — and a glass someone else is already flying is
   * left to its own owner, who is bouncing it off mine from their side.
   */
  private collideGlasses(glass: Glass): void {
    const root = glass.refs.root;
    // TWO SPHERES a glass: the bowl and the foot. Test all four pairings
    // and answer the deepest, so a coupe on its side has a length and two
    // glasses meeting foot-to-bowl actually meet.
    const mine: Array<[Vector3, number]> = [
      [_c1.set(0, PROP_PHYS.bodyY, 0).applyQuaternion(root.quaternion).add(root.position), PROP_PHYS.bodyR],
      [_c3.set(0, PROP_PHYS.footY, 0).applyQuaternion(root.quaternion).add(root.position), PROP_PHYS.footR],
    ];
    for (const other of this.glasses) {
      if (other === glass || other.mode === 'idle' || other.mode === 'pedestal') continue;
      const oRoot = other.refs.root;
      const theirs: Array<[Vector3, number]> = [
        [_c2.set(0, PROP_PHYS.bodyY, 0).applyQuaternion(oRoot.quaternion).add(oRoot.position), PROP_PHYS.bodyR],
        [_c4.set(0, PROP_PHYS.footY, 0).applyQuaternion(oRoot.quaternion).add(oRoot.position), PROP_PHYS.footR],
      ];
      let minGap = 0;
      let d = Infinity;
      let deepest = -Infinity;
      for (const [ca, ra] of mine) {
        for (const [cb, rb] of theirs) {
          const dist = ca.distanceTo(cb);
          const pen = ra + rb - dist;
          if (pen > deepest) {
            deepest = pen;
            d = dist;
            minGap = ra + rb;
            _v.copy(ca).sub(cb);
          }
        }
      }
      if (d >= minGap || d < 1e-5) continue;
      // STACKED, not colliding: a glass standing on this one's rim shares
      // its axis, so the bowls overlap by design. Shoving there is exactly
      // the force that used to take towers apart — the shelf holds it up,
      // it does not push it off. (Everything else still collides, whatever
      // heights the two happen to be passing through.)
      if (this.stacked(glass, other)) continue;
      _v.divideScalar(d); // contact normal, pointing at me

      // Closing speed along the normal (the other's velocity counts only
      // when it actually has one — a resting glass contributes nothing).
      const moving = other.mode === 'flight';
      const rel = glass.vel.dot(_v) - (moving ? other.vel.dot(_v) : 0);
      const claimable = other.mode === 'rest';
      const shares = moving || claimable; // can the other take an impulse?

      // Separate first: no two glasses ever occupy the same space.
      const push = (minGap - d) * (shares ? 0.5 : 1);
      root.position.addScaledVector(_v, push);
      if (rel < 0) {
        // Equal masses: swap the normal component, keeping `restitution`.
        const j = (shares ? 0.5 : 1) * (1 + PROP_PHYS.glassRestitution) * -rel;
        glass.vel.addScaledVector(_v, j);
        if (shares) {
          if (claimable) this.claimStruck(other);
          if (other.owner === net.myIdx) {
            other.refs.root.position.addScaledVector(_v, -push);
            other.vel.addScaledVector(_v, -j);
            other.spin = Math.min(PROP_PHYS.spinMax, other.spin + Math.abs(j) * PROP_PHYS.spinFromThrow);
          }
        }
        glass.grounded = false; // a knock lifts it back into the air
        this.tap(glass, Math.abs(rel), Math.abs(rel) > 0.8);
      }
    }
  }

  /** A resting glass just got hit: take it over so somebody simulates the
   *  motion, and let the room know it's live again. */
  private claimStruck(other: Glass): void {
    sendPropGrab(other.id);
    sendPropRelease(other.id);
    other.mode = 'flight';
    other.owner = net.myIdx;
    other.grounded = true; // it was sitting on something; let it skid
    other.hand = null;
    other.vel.set(0, 0, 0);
    other.spinAxis.set(0, 1, 0);
    this.toGroup(other);
  }

  private stepRest(glass: Glass, delta: number): void {
    const root = glass.refs.root;
    // Ease upright — never snap. (Leaving a glass lying where it fell was
    // tried and taken back out: see PROP_PHYS.uprightEase.)
    const k = Math.min(1, PROP_PHYS.uprightEase * delta);
    _q.identity();
    root.quaternion.slerp(_q, k);
    // Keep glasses from sharing a coaster: gently push apart resting pairs —
    // but ONLY ones on the same level, and never off the shelf they stand
    // on. Every client runs this for every resting glass, so it has to stay
    // a pure, identical nudge; shoving a glass into thin air here would
    // have each client separately decide it was falling.
    //
    // THE STATIC FRICTION. A glass standing on another glass's rim is not
    // nudged at all — that is the whole trick. A solver would hold a rim on
    // a rim with friction; we have no solver, so a stacked glass simply
    // does not slide: where you set it down is where it stays until
    // something moves it. The level test is what tells the two cases apart.
    const surfaceY = this.supportAt(root.position.x, root.position.z, glass, root.position.y);
    for (const other of this.glasses) {
      if (other === glass || other.mode !== 'rest') continue;
      const oRoot = other.refs.root;
      // Never nudge a stacked pair apart, and never nudge across shelves —
      // two glasses on different levels are not sharing a coaster.
      if (this.stacked(glass, other)) continue;
      if (Math.abs(root.position.y - oRoot.position.y) > PROP_PHYS.stackSameLevel) continue;
      _v.copy(root.position).sub(oRoot.position);
      _v.y = 0;
      const d = _v.length();
      if (d > 0.001 && d < 0.09) {
        _v.setLength((0.09 - d) * 0.5);
        const toX = root.position.x + _v.x;
        const toZ = root.position.z + _v.z;
        // Only step somewhere still carried — a nudge must never walk a
        // glass off its own shelf (or off the rim it is standing on).
        if (this.supportAt(toX, toZ, glass, root.position.y) >= surfaceY - 0.001) {
          root.position.x = toX;
          root.position.z = toZ;
        }
      }
    }
    // Stay SEATED through all of that. Righting itself changes which part
    // of the glass is lowest — a coupe on its side rests on its rim, a
    // whole bowl-radius higher than one standing on its foot — so the
    // height has to follow the tilt as it comes up, or the glass rights
    // itself straight down through the table.
    const seatY =
      this.supportAt(root.position.x, root.position.z, glass, root.position.y) - this.bottomOffset(glass);
    // THE SHELF WENT AWAY. Lift the glass a tower was standing on and the
    // one above is suddenly resting on nothing — so it falls, and the tower
    // comes down the way a tower should. (Claiming it is the same idiom a
    // struck glass uses; the relay hands the grab to exactly one client.)
    if (root.position.y > seatY + PROP_PHYS.stackFallGap) {
      this.claimStruck(glass);
      glass.grounded = false;
      return;
    }
    root.position.y = seatY;
  }

  /* ── the wire: the room's glasses, kept true ──────────────────────────── */

  /** Remote-owned glasses ease toward the owner's stream. */
  private easeToStream(glass: Glass, delta: number): void {
    if (glass.netAt <= 0) return; // no pose yet — hold still until one lands
    const root = glass.refs.root;
    const k = 1 - Math.exp(-NET_EASE * delta);
    if (root.position.distanceToSquared(glass.netPos) > 4) root.position.copy(glass.netPos);
    else root.position.lerp(glass.netPos, k);
    root.quaternion.slerp(glass.netQuat, k);
  }

  /** Ship poses of everything I simulate, ~20 Hz. */
  private streamOwned(delta: number): void {
    this.streamT += delta;
    if (this.streamT < STREAM_S) return;
    this.streamT = 0;
    for (const glass of this.glasses) {
      if (glass.owner !== net.myIdx) continue;
      if (glass.mode !== 'held' && glass.mode !== 'flight') continue;
      glass.refs.root.getWorldPosition(_p);
      glass.refs.root.getWorldQuaternion(_wq);
      sendPropPose(glass.id, [_p.x, _p.y, _p.z, _wq.x, _wq.y, _wq.z, _wq.w, glass.full ? 1 : 0]);
    }
  }

  private onWire(msg: PropWire): void {
    if (msg.t === 'props') {
      for (const p of msg.props) this.applyWireState(p);
      return;
    }
    const glass = this.glasses[msg.id];
    if (!glass) return;
    switch (msg.t) {
      case 'serve':
        this.applyServe(glass);
        break;
      case 'prop-grab':
        this.applyGrabbed(glass, msg.idx);
        break;
      case 'prop-release':
        // Their throw: catchable, and still theirs to fly.
        if (msg.idx !== net.myIdx) {
          glass.owner = msg.idx;
          glass.mode = 'flight';
        }
        break;
      case 'prop':
        this.applyStream(glass, msg.idx, msg.d);
        break;
      case 'prop-rest':
        this.applyRest(glass, msg);
        break;
    }
  }

  /** A fresh coupe rises — wherever this glass was, it's the pedestal's. */
  private applyServe(glass: Glass): void {
    // The sub-RTT race: the server picked a glass MY optimistic grab was
    // already holding. Don't rip it from the hand — my in-flight claim
    // lands right behind this serve, and its grant sinks the plate again.
    if (glass.owner === net.myIdx && glass.mode === 'held') {
      this.served = glass;
      this.waiterPhase = 'rising';
      return;
    }
    this.disown(glass);
    glass.mode = 'pedestal';
    glass.full = true;
    glass.refs.fill.visible = true;
    glass.refs.root.visible = true;
    glass.refs.root.quaternion.identity();
    glass.refs.root.position.set(WAITER.x, this.plate.position.y + 0.012, WAITER.z);
    glass.vel.set(0, 0, 0);
    glass.spin = 0;
    glass.netAt = 0;
    this.served = glass;
    this.waiterPhase = 'rising';
    if (this.group.visible) sfx.dumbwaiter(true);
  }

  /** The relay's word on who holds a glass — grant, echo, or correction. */
  private applyGrabbed(glass: Glass, idx: number): void {
    // Whoever took the plate's drink, the plate reacts the same way.
    if (glass === this.served) {
      this.served = null;
      this.waiterPhase = 'sinking';
      if (this.group.visible) sfx.dumbwaiter(false);
    }
    if (idx === net.myIdx) return; // my own grant — it's already in hand
    // Someone else's hand (their claim landed first, or plain theirs).
    this.disown(glass);
    glass.owner = idx;
    glass.mode = 'held';
    glass.refs.root.visible = true;
    glass.netAt = 0; // hold this pose until their stream lands
  }

  /** The owner's ~20 Hz pose+fill line. */
  private applyStream(glass: Glass, idx: number, d: number[]): void {
    if (idx === net.myIdx || !Array.isArray(d) || d.length < 8) return;
    for (let i = 0; i < 8; i++) if (!Number.isFinite(d[i])) return; // no NaN poses
    glass.owner = idx;
    if (glass.mode !== 'held' && glass.mode !== 'flight') glass.mode = 'held';
    this.toGroup(glass);
    glass.refs.root.visible = true;
    glass.netPos.set(d[0], d[1], d[2]);
    glass.netQuat.set(d[3], d[4], d[5], d[6]);
    glass.netAt = this.clock;
    const full = d[7] > 0.5;
    if (full !== glass.full) {
      glass.full = full;
      glass.refs.fill.visible = full;
    }
  }

  /** A settled (or dropped, or lost) glass: the pose sticks, ownership ends. */
  private applyRest(glass: Glass, msg: { idle?: boolean; pos?: number[]; quat?: number[] }): void {
    this.disown(glass);
    if (msg.idle || !Array.isArray(msg.pos) || msg.pos.length < 3 || msg.pos.some((n) => !Number.isFinite(n))) {
      glass.mode = 'idle';
      glass.refs.root.visible = false;
      glass.netAt = 0;
      return;
    }
    glass.mode = 'rest';
    glass.refs.root.visible = true;
    // Recompute the shelf height locally: a drop streamed at chest height
    // still lands on whatever surface is under it, same on every client.
    glass.refs.root.position.set(msg.pos[0], this.restingYAt(msg.pos[0], msg.pos[2]), msg.pos[2]);
    if (Array.isArray(msg.quat) && msg.quat.length >= 4 && msg.quat.every((n) => Number.isFinite(n))) {
      glass.refs.root.quaternion.set(msg.quat[0], msg.quat[1], msg.quat[2], msg.quat[3]);
    } else {
      glass.refs.root.quaternion.identity();
    }
    glass.vel.set(0, 0, 0);
    glass.spin = 0;
    glass.restedAt = this.clock;
    glass.netAt = 0;
  }

  /** A late joiner's snapshot line — one glass, as the room knows it. */
  private applyWireState(p: {
    id: number;
    holder: number | null;
    mode: string;
    pos: number[] | null;
    quat: number[] | null;
    full: boolean;
  }): void {
    const glass = this.glasses[p.id];
    if (!glass) return;
    glass.full = p.full !== false;
    glass.refs.fill.visible = glass.full;
    glass.hand = null;
    glass.vel.set(0, 0, 0);
    glass.spin = 0;
    if (p.mode === 'pedestal') {
      glass.mode = 'pedestal';
      glass.owner = null;
      this.toGroup(glass);
      glass.refs.root.visible = true;
      glass.refs.root.quaternion.identity();
      this.served = glass;
      // Walked in mid-serve: the plate is simply up — no theatre to replay.
      this.waiterPhase = 'up';
      this.plate.position.y = WAITER.top + 0.012;
      glass.refs.root.position.set(WAITER.x, this.plate.position.y + 0.012, WAITER.z);
    } else if ((p.mode === 'held' || p.mode === 'flight') && p.holder !== null && p.holder !== net.myIdx) {
      glass.mode = p.mode;
      glass.owner = p.holder;
      this.toGroup(glass);
      if (p.pos && p.pos.length >= 3) {
        glass.refs.root.position.set(p.pos[0], p.pos[1], p.pos[2]);
        glass.netPos.set(p.pos[0], p.pos[1], p.pos[2]);
        if (p.quat && p.quat.length >= 4) {
          glass.refs.root.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
          glass.netQuat.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
        }
        glass.netAt = this.clock;
        glass.refs.root.visible = true;
      } else {
        // No pose yet — it appears with the owner's first stream packet.
        glass.netAt = 0;
        glass.refs.root.visible = false;
      }
    } else if (p.mode === 'rest' && p.pos && p.pos.length >= 3) {
      glass.mode = 'rest';
      glass.owner = null;
      this.toGroup(glass);
      glass.refs.root.position.set(p.pos[0], this.restingYAt(p.pos[0], p.pos[2]), p.pos[2]);
      if (p.quat && p.quat.length >= 4) {
        glass.refs.root.quaternion.set(p.quat[0], p.quat[1], p.quat[2], p.quat[3]);
      } else {
        glass.refs.root.quaternion.identity();
      }
      glass.restedAt = this.clock;
      glass.refs.root.visible = true;
    } else {
      glass.mode = 'idle';
      glass.owner = null;
      this.toGroup(glass);
      glass.refs.root.visible = false;
      glass.netAt = 0;
    }
  }

  /* ── little helpers ───────────────────────────────────────────────────── */

  /** Out of any hand of mine, glow off, back under the props group. */
  private disown(glass: Glass): void {
    glass.hand = null;
    glass.grounded = false;
    this.setGlow(glass, false);
    for (const hand of HANDS) {
      if (this.highlight[hand] === glass) this.highlight[hand] = null;
    }
    this.toGroup(glass);
  }

  /** Parent under the props group (identity), keeping the world pose. */
  private toGroup(glass: Glass): void {
    if (glass.refs.root.parent !== this.group) this.group.attach(glass.refs.root);
  }
}

const _o = new Vector3();
const _d = new Vector3();
const _p = new Vector3();
const _v = new Vector3();
const _prev = new Vector3();
const _head = new Vector3();
const _up = new Vector3();
const _c1 = new Vector3();
const _c2 = new Vector3();
const _c3 = new Vector3();
const _c4 = new Vector3();
const _axis = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();
const _wq = new Quaternion();
