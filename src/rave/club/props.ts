/**
 * CLUB PROPS — the drinks, and the physics tables they live by.
 *
 * The interaction feel is FIRE FIGHT's pub, carried over: a fat invisible
 * grab proxy so a slim coupe is never fiddly to catch, a forgiving
 * aim-cone range grab, a five-frame ring buffer turning real hand motion
 * into throw velocity, per-surface landing, and a settle that eases a
 * tilted glass upright instead of snapping it. No physics engine — five
 * cheap tricks that read as one expensive one.
 *
 * Geometry: the coupe is the booths' decorative glass, sized for a hand,
 * with a cocktail in it (a magenta fill that empties when you drink).
 */

import {
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector2,
} from 'three';
import { CLUB } from './config.js';

export const PROP_PHYS = {
  gravity: 9.8,
  /** Throw speed cap (m/s) — a coupe is not a fastball. */
  maxThrowSpeed: 14,
  /** Bounce energy kept off floors and walls. */
  restitution: 0.32,
  /** Grind while sliding on a surface (exponential per second). */
  slideFriction: 2.2,
  /** Below this speed a landing settles instead of bouncing. */
  settleSpeed: 0.6,
  /** Tumble picked up from a throw. */
  spinFromThrow: 1.5,
  spinMax: 11,
  /** Range grab: aim cone + reach (the "force grab" half of the feel). */
  grabMaxDist: 1.0,
  grabConeCos: Math.cos((30 * Math.PI) / 180),
  /** Flight is SUBSTEPPED: no single step moves the glass further than
   *  this. A capped throw covers 15 cm in a 90 Hz frame, and the surface
   *  test only samples where the step ENDS — so at one step per frame a
   *  hard throw sails straight through a table edge it should have hit. */
  maxStep: 0.03,
  maxSubsteps: 24,
  /** No single frame simulates more than this much flight. A dropped frame
   *  (or a headset coming back from sleep) hands the system a delta worth
   *  half a second, and without a ceiling that teleports a thrown glass a
   *  metre — through whatever was in the way, and past the substep cap,
   *  since the substep count is bounded too. A hitch makes a glass move in
   *  slow motion for one frame, which nobody notices; it must never make a
   *  glass move through things, which everybody does. */
  maxFrame: 0.05,
  /** Below this horizontal speed a skidding glass finally comes to rest.
   *  (Above it, `slideFriction` grinds it down — a glass that lands slow
   *  used to stop dead the instant it touched, which is the one thing a
   *  glass on a bar top never does.) */
  slideStop: 0.14,
  /** Tumble bleeds off in the air (exponential, per second). */
  spinDamp: 0.5,
  /** A bounce with sideways speed puts SPIN into the glass — the tumble a
   *  thrown coupe takes off a bar top — per m/s of horizontal speed. */
  spinFromBounce: 1.6,

  /* ── ROLLING ───────────────────────────────────────────────────────────
   * A coupe on its side ROLLS, and because its rim is wider than its foot
   * it rolls in an ARC round the foot, the way a dropped glass always
   * does. Below `rollUprightMax` (world-Y of the glass's up axis) a
   * grounded glass rolls rather than skids: it turns about the floor-axis
   * perpendicular to its travel at rim speed, its heading bends toward the
   * foot side, and it loses speed to rolling resistance rather than to a
   * skid's grind. */
  rollUprightMax: 0.55,
  /** Heading bend per metre travelled (1/m): (rimR − baseR) / rimR over the
   *  glass's own length, which is the geometry of a rolling cone. */
  rollCurvature: 1.9,
  rollFriction: 1.6,
  /** A grounded glass TIPS: past this (world-Y of its up axis) it is
   *  standing on its foot and rights itself; below it, it is on its rim
   *  edge and gravity takes it over onto its side. Rates in rad/s. */
  tipUprightMin: 0.75,
  tipRate: 6,
  /** While rolling, the glass's axis swings across its travel (a cylinder
   *  cannot roll along its own axis) at this rate. */
  rollAlignRate: 4,
  /** Skid friction by surface — a bar top is polished, a floor is not.
   *  (Looked up by the surface's height; see ClubPropsSystem.frictionAt.) */
  frictionBar: 1.5,
  frictionTable: 1.9,
  frictionFloor: 2.6,
  /** GLASS ON GLASS: TWO spheres per glass now — one round the bowl, one
   *  round the foot — so a coupe lying on its side has a length, and two
   *  glasses meeting stem-to-bowl or foot-to-foot actually meet instead of
   *  passing through each other everywhere but the bowls. Centre heights
   *  up the local axis, and the radii. */
  bodyY: 0.12,
  bodyR: 0.072,
  footY: 0.02,
  footR: 0.042,
  /** Energy kept when two glasses meet (they ring more than they stick). */
  glassRestitution: 0.45,
  /** How fast a settled glass eases upright (per second). Righting is what
   *  makes a tower buildable by hand: every glass you set down finishes
   *  level, so the next one meets a flat rim instead of a slope. */
  uprightEase: 6,

  /* ── THE STACK ────────────────────────────────────────────────────────
   * A coupe tower is the one thing an Art Deco club owes you, and the
   * first attempt at it failed for a specific reason worth keeping on the
   * record: glass rims were not surfaces, so nothing ever RESTED on
   * anything — a stacked pair was two free bodies leaning on a shove-apart
   * rule, which slid apart and rang the glass tap a dozen times doing it.
   *
   * The fix is not a physics engine and not sockets (a glass that CLICKS
   * into place is a Lego brick, and this is a bar). It is three plain
   * rules: a rim is a surface, a glass resting ON a glass is STUCK to it
   * (the static friction a solver would have given us), and glasses only
   * shove each other apart when they share a level. Where you set a glass
   * down is where it stays — free placement, no grid, no snap.
   */
  /** The rim ring a coupe presents as a shelf: height up its own axis, and
   *  the radius of the disc. (The profile's top ring — kept here as named
   *  numbers because the stack maths reads them every frame.) */
  rimY: 0.187,
  rimR: 0.066,
  /** The foot a glass stands on. */
  baseR: 0.042,
  /** How far a base centre may sit from a rim's axis and still be carried.
   *  rimR + baseR is "the foot overlaps the rim disc at all", which is
   *  exactly the reach a champagne tower needs: the upper glass in a
   *  pyramid bridges the gap between two below, ~0.066 from each axis and
   *  comfortably inside this. Generous on purpose — the fantasy is
   *  building the tower, not fighting for it. */
  stackReach: 0.108,
  /** A glass only carries another if it is standing reasonably upright —
   *  a coupe on its side is scenery, not a shelf. (World-Y of its up axis.) */
  stackUprightMin: 0.86,
  /** A glass is only a SHELF for one whose origin sits at least this far
   *  above its own. Two coupes side by side on a table are at the same
   *  height and neither carries the other; a stacked one clears this by
   *  the full rim height. Being a strict height ordering, it also makes
   *  mutual support (two glasses each floating on the other) impossible. */
  stackLevelEps: 0.05,
  /** Resting glasses shove each other apart only within this much height of
   *  one another — same level, same shelf. Without it, the nudge that keeps
   *  two glasses off one coaster would fire at every stacked pair (distance
   *  ~0 horizontally) and blow every tower apart on contact. */
  stackSameLevel: 0.03,
  /** A stack that loses its footing falls: if a resting glass ends up this
   *  far above the surface actually under it (someone lifted the glass it
   *  stood on), it goes back to flight and drops. */
  stackFallGap: 0.02,

  /* ── the tap, rationed ────────────────────────────────────────────────
   * Glass-on-glass is the sound of a bar, and it was also the sound of the
   * first stacking attempt failing: every micro-nudge between touching
   * glasses rang it. A tower has a dozen contacts, so the tap now has to
   * earn itself — real closing speed, and never twice in a breath from the
   * same glass. Setting one down deliberately stays silent-ish; knocking a
   * tower over still sounds like knocking a tower over. */
  tapMinSpeed: 0.35,
  tapCooldown: 0.12,
} as const;

/**
 * The coupe's silhouette as contact rings — the same profile the lathe is
 * built from, as {y, r} pairs.
 *
 * This is what keeps the drink OUT OF THE FLOOR. Resting on the root
 * origin is only correct while the glass is upright: tilt it and the bowl
 * and stem swing below the surface, because the origin sits at the base.
 * A surface of revolution makes the true answer cheap — under a rotation
 * whose tilt from vertical is θ, the lowest point of the ring (y, r) is
 * `y·cos θ − r·sin θ`, so the lowest point of the whole glass is the
 * smallest of those over the profile. Upright that picks the base (0);
 * on its side it picks the rim, and the coupe lies on its rim and foot
 * exactly as it should.
 */
export const COUPE_PROFILE: ReadonlyArray<{ y: number; r: number }> = [
  { y: 0, r: 0.001 },
  { y: 0.003, r: 0.042 },
  { y: 0.015, r: 0.006 },
  { y: 0.112, r: 0.006 },
  { y: 0.127, r: 0.03 },
  { y: 0.15, r: 0.063 },
  { y: 0.187, r: 0.066 },
];

/** How far the glass's lowest point sits below its origin at this tilt
 *  (`cosTilt` = the world-Y component of the glass's own up axis). */
export function coupeBottomOffset(cosTilt: number): number {
  const c = Math.max(-1, Math.min(1, cosTilt));
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  let lowest = Infinity;
  for (const p of COUPE_PROFILE) {
    const y = p.y * c - p.r * s;
    if (y < lowest) lowest = y;
  }
  return lowest;
}

/** Landing surfaces the teleport floor doesn't know: places you can't
 *  stand but a glass can rest. (Everything standable — booth tables, the
 *  terrace, the still table — already answers through floorYAt.) */
export const PROP_SURFACES: Array<{ minX: number; maxX: number; minZ: number; maxZ: number; y: number }> = [
  // The bar counter top.
  { minX: CLUB.bar.x, maxX: CLUB.bar.x + CLUB.bar.depth, minZ: CLUB.bar.z0, maxZ: CLUB.bar.z1, y: CLUB.bar.top },
  // The stage (a square heart of the crescent — close enough for a glass).
  { minX: -2.6, maxX: 2.6, minZ: CLUB.stage.z - 0.2, maxZ: CLUB.stage.z + 2.6, y: CLUB.stage.h },
  // THE DJ CONSOLE's top. Listed after the stage but it wins anyway: the
  // surface lookup takes the HIGHEST match under the glass, and the desk
  // stands on the stage.
  {
    minX: -CLUB.stage.desk.halfW,
    maxX: CLUB.stage.desk.halfW,
    minZ: CLUB.stage.desk.z - CLUB.stage.desk.halfD,
    maxZ: CLUB.stage.desk.z + CLUB.stage.desk.halfD,
    y: CLUB.stage.desk.top,
  },
];

/** Walls a flying glass reflects off — 2D segments with a HEIGHT, so a
 *  lob clears the bar counter but a line drive rings off it. Axis-aligned
 *  like WALL_SEGMENTS; the heights are why it's a separate table. */
export const PROP_WALLS: Array<{ ax: number; az: number; bx: number; bz: number; h: number }> = [
  // Hall shell.
  { ax: -CLUB.halfW, az: CLUB.minZ, bx: CLUB.halfW, bz: CLUB.minZ, h: 6 },
  { ax: -CLUB.halfW, az: CLUB.maxZ, bx: CLUB.halfW, bz: CLUB.maxZ, h: 6 },
  { ax: -CLUB.halfW, az: CLUB.minZ, bx: -CLUB.halfW, bz: CLUB.maxZ, h: 6 },
  { ax: CLUB.halfW, az: CLUB.minZ, bx: CLUB.halfW, bz: CLUB.maxZ, h: 6 },
  // The corner rooms' inner walls (door gaps stay open).
  ...[CLUB.quiet, CLUB.arcade, CLUB.step].flatMap((r) => {
    const inner = r.minX < 0 ? r.maxX : r.minX;
    const z = r.doorWall === 'north' ? r.minZ : r.maxZ;
    return [
      { ax: inner, az: r.minZ, bx: inner, bz: r.maxZ, h: CLUB.roomCeilH },
      { ax: r.minX, az: z, bx: r.doorX0, bz: z, h: CLUB.roomCeilH },
      { ax: r.doorX1, az: z, bx: r.maxX, bz: z, h: CLUB.roomCeilH },
    ];
  }),
  // The karaoke pods' dividers.
  ...[CLUB.pods.minZ, ...CLUB.pods.dividers, CLUB.pods.maxZ].map((z) => ({ ax: CLUB.pods.minX, az: z, bx: CLUB.pods.frontX, bz: z, h: 2.4 })),
  // The LED wall behind the stage.
  { ax: -CLUB.stage.ledWall.halfW, az: CLUB.stage.ledWall.z, bx: CLUB.stage.ledWall.halfW, bz: CLUB.stage.ledWall.z, h: CLUB.stage.ledWall.top },
  // The bar counter's front line — knee-to-top height only.
  { ax: CLUB.bar.x, az: CLUB.bar.z0 - 0.4, bx: CLUB.bar.x, bz: CLUB.bar.z1, h: CLUB.bar.top },
  // The stage face.
  {
    ax: -CLUB.stage.r - 0.4,
    az: CLUB.stage.z + CLUB.stage.r + 0.35,
    bx: CLUB.stage.r + 0.4,
    bz: CLUB.stage.z + CLUB.stage.r + 0.35,
    h: CLUB.stage.h,
  },
  // THE DJ CONSOLE — four sides of oak and brass to ring off. Height is the
  // desk top, so a lob clears it onto the surface and anything flatter
  // clatters off the fascia, which is exactly what a drink thrown at a
  // working booth should do.
  { ax: -CLUB.stage.desk.halfW, az: CLUB.stage.desk.z - CLUB.stage.desk.halfD, bx: CLUB.stage.desk.halfW, bz: CLUB.stage.desk.z - CLUB.stage.desk.halfD, h: CLUB.stage.desk.top },
  { ax: -CLUB.stage.desk.halfW, az: CLUB.stage.desk.z + CLUB.stage.desk.halfD, bx: CLUB.stage.desk.halfW, bz: CLUB.stage.desk.z + CLUB.stage.desk.halfD, h: CLUB.stage.desk.top },
  { ax: -CLUB.stage.desk.halfW, az: CLUB.stage.desk.z - CLUB.stage.desk.halfD, bx: -CLUB.stage.desk.halfW, bz: CLUB.stage.desk.z + CLUB.stage.desk.halfD, h: CLUB.stage.desk.top },
  { ax: CLUB.stage.desk.halfW, az: CLUB.stage.desk.z - CLUB.stage.desk.halfD, bx: CLUB.stage.desk.halfW, bz: CLUB.stage.desk.z + CLUB.stage.desk.halfD, h: CLUB.stage.desk.top },
];

export interface CoupeRefs {
  root: Group;
  /** The cocktail — hidden once drunk. */
  fill: Mesh;
  /** Emissive-lifted while this glass is the aim target. */
  glass: Mesh;
  /** Radius of the invisible grab proxy. */
  proxyR: number;
}

/** A hand-sized coupe with a magenta cocktail and a fat grab proxy. */
export function buildCoupe(): CoupeRefs {
  const root = new Group();
  // A lathe is a surface of revolution, so a profile that stops SHORT of the
  // axis leaves a hole down the middle. Both of these used to start at 1 mm
  // — enough to open a 2 mm pipe straight through the drink, which read as a
  // black dot dead centre of every glass in the club (the glass writes no
  // depth, so what showed through the hole was the dark room behind it).
  // Touching the axis closes the pole; three caps the normals there itself.
  const pts: Vector2[] = [
    new Vector2(0, 0),
    new Vector2(0.042, 0.003),
    new Vector2(0.006, 0.015),
    new Vector2(0.006, 0.112),
    new Vector2(0.03, 0.127),
    new Vector2(0.063, 0.15),
    new Vector2(0.066, 0.187),
  ];
  const glassMat = new MeshStandardMaterial({
    color: 0xd8e0e8,
    transparent: true,
    opacity: 0.34,
    roughness: 0.12,
    metalness: 0.1,
    depthWrite: false, // the room never occludes the drink inside
  });
  const glass = new Mesh(new LatheGeometry(pts, 14), glassMat);
  root.add(glass);

  const fill = new Mesh(
    new LatheGeometry(
      // Closed at both poles for the same reason — the cocktail's surface is
      // a DISC, not a washer.
      [new Vector2(0, 0.132), new Vector2(0.052, 0.145), new Vector2(0.058, 0.168), new Vector2(0, 0.169)],
      12,
    ),
    new MeshStandardMaterial({
      color: 0xff2ad5,
      emissive: 0xff2ad5,
      emissiveIntensity: 0.35,
      transparent: true,
      opacity: 0.85,
      roughness: 0.3,
    }),
  );
  root.add(fill);

  // The fix that makes slim props grabbable: a fat invisible proxy.
  const proxyR = 0.085;
  const proxy = new Mesh(new SphereGeometry(proxyR, 8, 6), new MeshStandardMaterial({ visible: false }));
  proxy.position.y = 0.11;
  root.add(proxy);

  return { root, fill, glass, proxyR };
}
