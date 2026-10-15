/**
 * THE SET's environment — the void the raid happens in.
 *
 * Beat-Saber-background ambition bent around a radial arena: where their
 * runways march structures toward a vanishing point, our ring stands at
 * the centre of a world that recedes in every direction at once. Built in
 * four depth layers so it reads as vast rather than merely dark:
 *
 *   NEAR   r 17 · 18 towers ·  7–14 m — portholes, shafts, full detail
 *   MID    r 31 · 26 towers · 13–24 m — bigger silhouettes, no fine work
 *   FAR    r 50–88 · 58 slabs · 20–54 m — pure parallax skyline
 *   SKY    a low horizon band at r 92, with dust drifting through all of it
 *
 * Overhead: a four-ring TRUSS with radial spars and lit joints, and six
 * great ARCS springing over the whole floor. Underfoot: a black gloss disc
 * with a two-scale grid, 28 radial rays and five concentric rings — and
 * THE MIRROR, a flipped copy of both tower rings and the skyline sharing
 * their instance buffers, so every light in the room has a twin under it
 * for one extra draw per bank.
 *
 * Palette discipline holds: the void speaks the disco vocabulary
 * (magenta/cyan/violet off LASER_HUES, snapping per bar) and DUCKS with
 * the rig while a hazard owns your deck — `energy` arrives pre-ducked from
 * DiscoSystem, so danger dims the whole world rather than competing with
 * it. Everything lives OUTSIDE the platform ring; nothing here can ever be
 * mistaken for a telegraph.
 *
 * Always on while a set (or its podium) is up — the game is full VR and
 * this IS the set's world. DiscoSystem owns the lifecycle, the beat and
 * the fog handoff.
 */

import { Color, Group, type Mesh, type MeshBasicMaterial, type Points, type Scene, type WebGLRenderer } from 'three';
import { LASER_HUES, hueToColor } from '../config.js';
import { driveFacades, upgradeVoid } from './voidSculpt.js';
import { buildVoidSky, type VoidSky } from './voidSky.js';
import {
  buildArcs,
  buildCanopy,
  buildDust,
  buildFloorSheen,
  buildHorizon,
  buildShardField,
  buildSkyline,
  buildTowerRing,
  buildVoidFloor,
  mirrorOf,
  type Canopy,
  type GlowBank,
  type ShardField,
  type TowerRing,
  type VoidFloor,
} from './voidkit.js';

/** Where the scenery starts — comfortably outside the widest platform ring. */
const INNER = 11;

/** The far sky only ever wears the cool end of the wheel (magenta, cyan,
 *  violet) — a whole sky gone amber or green would read as a telegraph. */
const SKY_HUES = [0.9, 0.55, 0.75].map((h) => new Color(hueToColor(h, 0.5)));
/** The foyer's facades sit in its own cyan-violet. */
const FOYER_FACADE = new Color(hueToColor(0.62, 0.5));

export class SetEnvironment {
  readonly root = new Group();

  private near!: TowerRing;
  private mid!: TowerRing;
  private skyEdges!: GlowBank;
  private skyCount = 0;
  private canopy!: Canopy;
  private arcs!: GlowBank;
  private arcCount = 0;
  private shards!: ShardField;
  private floor!: VoidFloor;
  private sheen!: Mesh;
  private horizonNear!: MeshBasicMaterial;
  private horizonFar!: MeshBasicMaterial;
  private dust!: Points;
  private sky!: VoidSky;
  private skyHue = new Color(SKY_HUES[0]);
  private hueCursor = 0;
  private lastBar = -1;
  private clock = 0;

  constructor(scene: Scene, renderer: WebGLRenderer | null = null) {
    this.root.name = 'set-void';
    this.root.visible = false;

    // ── underfoot ────────────────────────────────────────────────────────
    this.floor = buildVoidFloor(46, INNER, hueToColor(LASER_HUES[1], 0.5), 1.4, 0.13);
    this.floor.group.position.y = -0.06;
    this.root.add(this.floor.group);
    this.sheen = buildFloorSheen(INNER, 46, hueToColor(LASER_HUES[0], 0.4));
    this.sheen.position.y = -0.05;
    this.root.add(this.sheen);

    // ── the reflectable world: two tower rings and the skyline ───────────
    // Kept in one group so the mirror is a single clone, and so nothing
    // near the dancers (canopy, arcs, shards) ever appears underfoot.
    const reflectable = new Group();
    reflectable.name = 'void-reflectable';

    this.near = buildTowerRing({
      count: 18,
      radius: 17,
      baseY: -0.06,
      minH: 7,
      maxH: 14,
      width: 1.15,
      shafts: true,
      portholes: true,
      seed: 0x51,
      scatter: 1.6,
    });
    reflectable.add(this.near.group);

    this.mid = buildTowerRing({
      count: 26,
      radius: 31,
      baseY: -0.06,
      minH: 13,
      maxH: 24,
      width: 1.9,
      shafts: true,
      seed: 0x9c,
      scatter: 4,
    });
    reflectable.add(this.mid.group);

    const sky = buildSkyline(58, 50, 88, 20, 54, 0x2f);
    reflectable.add(sky.group);
    this.skyEdges = sky.edges;
    this.skyCount = sky.count;

    this.root.add(reflectable);
    // The mirror: same buffers, dimmer materials, upside down.
    this.root.add(mirrorOf(reflectable, 0.4, -0.06));

    // ── overhead ─────────────────────────────────────────────────────────
    this.canopy = buildCanopy(4, 7.5, 2.6, 8.4, 1.5, 18);
    this.root.add(this.canopy.group);

    const arcs = buildArcs(6, 23, 0.24, 0x77);
    this.root.add(arcs.group);
    this.arcs = arcs.bank;
    this.arcCount = 6;

    // ── the air ──────────────────────────────────────────────────────────
    this.shards = buildShardField(26, 13, 26, 3, 15, 0xd4);
    this.root.add(this.shards.group);

    const dust = buildDust(1400, 8, 60, -1, 30, hueToColor(LASER_HUES[1], 0.4), 0x33);
    this.root.add(dust.points);
    this.dust = dust.points;

    const horizon = buildHorizon(92, 9, hueToColor(LASER_HUES[3], 0.5), 0.24);
    this.root.add(horizon.group);
    this.horizonNear = horizon.near;
    this.horizonFar = horizon.far;

    // ── beyond it all: the Cycles-rendered far void (voidSky.ts) ─────────
    this.sky = buildVoidSky(renderer);
    this.root.add(this.sky.mesh);

    scene.add(this.root);
    upgradeVoid(this.root); // the sculpted kit (voidSculpt.ts), swapped in when it lands
  }

  setActive(on: boolean): void {
    if (this.root.visible !== on) this.root.visible = on;
  }

  get active(): boolean {
    return this.root.visible;
  }

  /**
   * Drive the void. `beat` is the continuous song beat, `act` 0..3, and
   * `energy` 0..1 already carries the telegraph duck.
   */
  update(dt: number, beat: number, act: number, energy: number): void {
    if (!this.root.visible) return;
    this.clock += dt;
    const beatFrac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - beatFrac * 2.2);

    // Hue snaps per bar, marching around the wheel with the light rig.
    const bar = Math.floor(beat / 4);
    if (bar !== this.lastBar && beat > 0) {
      this.lastBar = bar;
      this.hueCursor = (this.hueCursor + 1) % LASER_HUES.length;
    }
    const hueAt = (n: number): number =>
      hueToColor(LASER_HUES[(this.hueCursor + n) % LASER_HUES.length], 0.55);

    // Towers breathe on the kick as a travelling wave, so the rings ROLL
    // around the arena instead of flashing as one — the near ring leads and
    // the mid ring answers a beat behind it.
    for (let i = 0; i < this.near.count; i++) {
      const wave = Math.sin(beat * Math.PI * 0.5 + (i / this.near.count) * Math.PI * 2);
      this.near.setGlow(i, hueAt(i), 0.42 + energy * (0.4 + pulse * 0.85 + Math.max(0, wave) * 0.4));
    }
    this.near.commit();
    for (let i = 0; i < this.mid.count; i++) {
      const wave = Math.sin(beat * Math.PI * 0.5 - 1.2 + (i / this.mid.count) * Math.PI * 2);
      this.mid.setGlow(i, hueAt(i * 2 + 1), 0.3 + energy * (0.3 + pulse * 0.5 + Math.max(0, wave) * 0.3));
    }
    this.mid.commit();

    // The skyline barely moves — a slow swell, so the far edge of the world
    // feels alive without ever pulling the eye off the floor.
    const far = 0.28 + energy * 0.18 + Math.sin(this.clock * 0.5) * 0.05;
    for (let i = 0; i < this.skyCount; i++) this.skyEdges.tint(i, hueAt(3), far);
    this.skyEdges.commit();

    // The canopy turns and its joints take the kick; the acts spin it up.
    this.canopy.spin(dt, 0.12 * (1 + act * 0.55));
    this.canopy.setGlow(hueAt(1), 0.5 + energy * (0.35 + pulse * 0.6));
    this.canopy.commit();

    for (let i = 0; i < this.arcCount; i++) {
      const wave = Math.sin(beat * Math.PI * 0.25 + (i / this.arcCount) * Math.PI * 2);
      this.arcs.tint(i, hueAt(i + 2), 0.3 + energy * (0.25 + Math.max(0, wave) * 0.5));
    }
    this.arcs.commit();

    // The floor: rays chase around the ring on the beat, the concentric
    // lines swell outward from the middle a bar at a time.
    for (let i = 0; i < this.floor.rayCount; i++) {
      const chase = Math.sin(beat * Math.PI - (i / this.floor.rayCount) * Math.PI * 4);
      this.floor.rays.tint(i, hueAt(2), 0.18 + energy * (0.2 + Math.max(0, chase) * 0.7));
    }
    this.floor.rays.commit();
    for (let i = 0; i < this.floor.ringCount; i++) {
      const swell = Math.max(0, Math.sin(beat * Math.PI * 0.5 - i * 0.7));
      this.floor.rings.tint(i, hueAt(i), 0.25 + energy * (0.25 + swell * 0.65));
    }
    this.floor.rings.commit();
    this.floor.gridMat.opacity = 0.08 + energy * (0.06 + pulse * 0.05);

    // Shards tumble; dust turns the whole room a hair each second so the
    // middle distance is never static.
    this.shards.drift(this.clock, dt);
    this.shards.setGlow(hueAt(4), 0.3 + energy * (0.25 + pulse * 0.4));
    this.shards.commit();
    this.dust.rotation.y += dt * 0.008;

    this.horizonNear.opacity = 0.16 + energy * 0.12;
    this.horizonFar.opacity = 0.08 + energy * 0.06;

    // The far sky eases toward the bar's hue (a snap across the whole sky
    // would be a flash bang in a headset) and swells gently on the kick.
    this.skyHue.lerp(SKY_HUES[this.hueCursor % SKY_HUES.length], 1 - Math.exp(-dt * 2.5));
    this.sky.set(this.skyHue, 0.42 + energy * (0.3 + pulse * 0.25));
    driveFacades(this.skyHue, 0.45 + energy * (0.4 + pulse * 0.35), this.clock);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}

/**
 * THE FOYER's void — the same world, seen from a platform floating in it.
 *
 * The menu place is a piece of the set's own space, so it speaks the same
 * language at a more intimate scale: a lit plain seven metres below you
 * with its own mirror, towers rising off it past the deck's edge, a small
 * truss and a few arches overhead, dust and a horizon beyond. It idles on
 * the lobby loop's beat rather than a set's, and nothing here ever ducks —
 * no hazard owns anything in a menu.
 *
 * Built as one object the club's foyer parents; ClubSystem drives it.
 */
export class FoyerEnvironment {
  readonly root = new Group();

  private near: TowerRing;
  private mid: TowerRing;
  private skyEdges: GlowBank;
  private skyCount: number;
  private canopy: Canopy;
  private shards: ShardField;
  private floor: VoidFloor;
  private horizonNear: MeshBasicMaterial;
  private horizonFar: MeshBasicMaterial;
  private dust: Points;
  private clock = 0;

  /** `plain` is where the ground below the platform sits. */
  constructor(plain = -7) {
    this.root.name = 'foyer-void';

    this.floor = buildVoidFloor(46, 7, hueToColor(0.55, 0.5), 2.2, 0.1);
    this.floor.group.position.y = plain;
    this.root.add(this.floor.group);

    // The towers stand ON the plain, so the platform reads as floating
    // ABOVE a world rather than parked in an empty box.
    const reflectable = new Group();
    this.near = buildTowerRing({
      count: 10,
      radius: 13,
      baseY: plain,
      minH: 6.5,
      maxH: 13,
      width: 1,
      shafts: true,
      portholes: true,
      seed: 0x1f,
      scatter: 1.4,
    });
    reflectable.add(this.near.group);
    this.mid = buildTowerRing({
      count: 16,
      radius: 26,
      baseY: plain,
      minH: 12,
      maxH: 22,
      width: 1.7,
      shafts: true,
      seed: 0x77,
      scatter: 3.5,
    });
    reflectable.add(this.mid.group);
    const sky = buildSkyline(30, 40, 70, 16, 44, 0x5b);
    sky.group.position.y = plain;
    reflectable.add(sky.group);
    this.skyEdges = sky.edges;
    this.skyCount = sky.count;
    this.root.add(reflectable);
    this.root.add(mirrorOf(reflectable, 0.38, plain));

    // A small truss and a few arches over the deck.
    this.canopy = buildCanopy(2, 5.2, 2.2, 6.4, 1.4, 14);
    this.root.add(this.canopy.group);
    // NO ARCS over the menu. Four hoops used to spring across this deck at
    // 8.5 m, which put a leg down either side of exactly where you stand
    // to read the board. Hollowing them (dropping the dark structural tube
    // that was punching black holes in the sky) stopped them eating the
    // scenery, but the legs were still there, still in the way, and an
    // arch is architecture for a room you WALK through — this is a place
    // you stand still in and read. The canopy overhead carries the
    // structure on its own. The SET keeps its six: out there the arcs
    // spring over a floor you dodge across, which is what they are for.

    this.shards = buildShardField(16, 8, 18, plain + 3, 8, 0x1f);
    this.root.add(this.shards.group);
    const dust = buildDust(900, 5, 40, plain, 20, hueToColor(0.75, 0.4), 0x8a);
    this.root.add(dust.points);
    upgradeVoid(this.root);
    this.dust = dust.points;

    const horizon = buildHorizon(64, 7, hueToColor(0.9, 0.5), 0.22);
    horizon.group.position.y = plain;
    this.root.add(horizon.group);
    this.horizonNear = horizon.near;
    this.horizonFar = horizon.far;
  }

  /** Idle on the lobby loop. `pulse` crests on the kick. */
  update(dt: number, clock: number, pulse: number): void {
    this.clock += dt;
    const hue = (n: number): number => hueToColor((0.55 + n * 0.08) % 1, 0.55);
    driveFacades(FOYER_FACADE, 0.4 + pulse * 0.2, this.clock);

    for (let i = 0; i < this.near.count; i++) {
      const wave = Math.sin(clock * 0.6 + i * 1.3);
      this.near.setGlow(i, hue(i), 0.6 + Math.max(0, wave) * 0.35 + pulse * 0.2);
    }
    this.near.commit();
    for (let i = 0; i < this.mid.count; i++) {
      const wave = Math.sin(clock * 0.45 - 0.8 + i * 0.9);
      this.mid.setGlow(i, hue(i * 2 + 1), 0.4 + Math.max(0, wave) * 0.25 + pulse * 0.12);
    }
    this.mid.commit();
    for (let i = 0; i < this.skyCount; i++) this.skyEdges.tint(i, hue(3), 0.3 + Math.sin(clock * 0.4) * 0.05);
    this.skyEdges.commit();

    this.canopy.spin(dt, 0.09);
    this.canopy.setGlow(hue(1), 0.6 + pulse * 0.3);
    this.canopy.commit();
    for (let i = 0; i < this.floor.rayCount; i++) {
      const chase = Math.sin(clock * 1.1 - (i / this.floor.rayCount) * Math.PI * 4);
      this.floor.rays.tint(i, hue(2), 0.16 + Math.max(0, chase) * 0.4);
    }
    this.floor.rays.commit();
    for (let i = 0; i < this.floor.ringCount; i++) {
      this.floor.rings.tint(i, hue(i), 0.3 + Math.max(0, Math.sin(clock * 0.7 - i * 0.6)) * 0.4);
    }
    this.floor.rings.commit();
    this.floor.gridMat.opacity = 0.07 + pulse * 0.03;

    this.shards.drift(this.clock, dt);
    this.shards.setGlow(hue(4), 0.35 + pulse * 0.2);
    this.shards.commit();
    this.dust.rotation.y += dt * 0.01;

    this.horizonNear.opacity = 0.18 + pulse * 0.04;
    this.horizonFar.opacity = 0.09;
  }
}
