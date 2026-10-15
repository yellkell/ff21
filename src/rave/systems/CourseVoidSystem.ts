/**
 * CourseVoidSystem — THE VOID, rehung around a circuit.
 *
 * Same environment kit the set and the foyer are built from
 * (arena/voidkit.ts), same recipe, same discipline — a ring of near towers
 * with their portholes and shafts, a bigger ring behind them, a parallax
 * skyline, a truss and six great arcs overhead, shards adrift, dust, a
 * horizon with no land under it, and THE MIRROR doubling every light in
 * black glass for one extra draw per bank. The only thing that changes is
 * what it is arranged around: not a ring of dancers, but a route you RIDE
 * through, which is what arcs are for.
 *
 *   NEAR   r 20 · 16 towers ·  7–14 m
 *   MID    r 34 · 24 towers · 13–24 m
 *   FAR    r 52–88 · 48 slabs · 20–54 m — pure parallax
 *   SKY    a low horizon band at r 92, dust drifting through all of it
 *
 * The palette is the club's disco wheel (LASER_HUES, snapping per bar) and
 * the world DUCKS while the ground under you counts itself out — the house
 * law that danger never competes with scenery, applied to the only danger
 * there is out here.
 */

import { createSystem } from '@iwsdk/core';
import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type Points,
} from 'three';
import { hueToColor, LASER_HUES, PALETTE } from '../config.js';
import {
  buildArcs,
  buildCanopy,
  buildDust,
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
} from '../arena/voidkit.js';
import { driveFacades, upgradeVoid } from '../arena/voidSculpt.js';
import { ENERGY } from '../course/config.js';
import { applyDim } from '../course/dimmer.js';
import { panelTexture, textPanel } from '../course/textures.js';
import { course, G } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { font } from '../ui/fonts.js';

/** The black glass the whole world doubles in. */
export const FLOOR_Y = -0.06;

/** Where the scenery starts — comfortably outside the circuit's widest reach. */
const INNER = 13;

/** The DANGER sign's height as a fraction of its width. */
const DANGER_ASPECT = 0.25;

/**
 * DANGER in lit red glass, chevrons leaning in from each end — the same sign
 * THE STEP hangs on the club side of the portal (club/build.ts), redrawn
 * without its steel backing because out here there is nothing to bolt it to.
 *
 * Two passes for the word and the strokes alike: a wide halo under a crisp
 * core. That is what makes a canvas read as a gas tube rather than as red
 * paint, and it is the one trick every neon in this building uses.
 */
function dangerTexture(): CanvasTexture {
  const W = 1024;
  const H = Math.round(W * DANGER_ASPECT);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, W, H);

  const red = '#ff2233';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // The word has to FIT between the chevrons. Sized off the canvas height
  // and then measured, because a tracked-out 'DANGER' at the club sign's
  // proportions runs straight under the strokes on a wider board and comes
  // out reading '⟪ANGE⟫'.
  g.font = font(700, Math.round(H * 0.5));
  g.letterSpacing = '14px';
  g.shadowColor = red;
  g.shadowBlur = H * 0.5;
  g.fillStyle = red;
  g.fillText('DANGER', W / 2, H / 2 + 1);
  g.shadowBlur = H * 0.16;
  g.fillStyle = '#ffd9d9';
  g.fillText('DANGER', W / 2, H / 2 + 1);
  g.shadowBlur = 0;
  g.letterSpacing = '0px';

  g.strokeStyle = red;
  g.lineWidth = Math.max(2, H * 0.07);
  g.lineCap = 'round';
  g.shadowColor = red;
  g.shadowBlur = H * 0.3;
  for (let i = 0; i < 3; i++) {
    for (const side of [-1, 1] as const) {
      const x = W / 2 + side * (W * 0.36 + i * H * 0.22);
      g.beginPath();
      g.moveTo(x - side * H * 0.14, H * 0.24);
      g.lineTo(x + side * H * 0.06, H / 2);
      g.lineTo(x - side * H * 0.14, H * 0.76);
      g.stroke();
    }
  }
  g.shadowBlur = 0;

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class CourseVoidSystem extends createSystem({}) {
  private near!: TowerRing;
  private mid!: TowerRing;
  private skyEdges!: GlowBank;
  private skyCount = 0;
  private canopy!: Canopy;
  private danger!: Mesh;
  private dangerMat!: MeshBasicMaterial;
  private arcs!: GlowBank;
  private arcCount = 0;
  private shards!: ShardField;
  private floor!: VoidFloor;
  private horizonNear!: MeshBasicMaterial;
  private horizonFar!: MeshBasicMaterial;
  private dust!: Points;
  private card!: Mesh;
  private cardMat!: MeshBasicMaterial;
  private hueCursor = 0;
  private lastBar = -1;
  private facadeHue = new Color();
  private clock = 0;
  private warning: Mesh | undefined;

  init(): void {
    const root = courseRoot();

    // ── underfoot ────────────────────────────────────────────────────────
    this.floor = buildVoidFloor(46, INNER, hueToColor(LASER_HUES[1], 0.5), 1.4, 0.13);
    this.floor.group.position.y = FLOOR_Y;
    root.add(this.floor.group);

    // ── the reflectable world: silhouettes and their light ───────────────
    // One group, so the mirror is a single clone.
    const reflectable = new Group();
    reflectable.name = 'course-reflectable';

    this.near = buildTowerRing({
      count: 16,
      radius: 20,
      baseY: FLOOR_Y,
      minH: 7,
      maxH: 14,
      width: 1.15,
      seed: 0x51,
      scatter: 1.8,
    });
    reflectable.add(this.near.group);

    this.mid = buildTowerRing({
      count: 24,
      radius: 34,
      baseY: FLOOR_Y,
      minH: 13,
      maxH: 24,
      width: 1.9,
      seed: 0x9c,
      scatter: 4,
    });
    reflectable.add(this.mid.group);

    const sky = buildSkyline(48, 52, 88, 20, 54, 0x2f);
    reflectable.add(sky.group);
    this.skyEdges = sky.edges;
    this.skyCount = sky.count;

    root.add(reflectable);
    root.add(mirrorOf(reflectable, 0.4, FLOOR_Y));

    // ── overhead ─────────────────────────────────────────────────────────
    // The truss sits clear above the skywalk's headroom (a 3.8 m deck plus a
    // standing body), so the ride threads UNDER the structure.
    this.canopy = buildCanopy(2, 9.2, 3.4, 12.5, 1.8, 16);
    root.add(this.canopy.group);

    const arcs = buildArcs(6, 26, 0.26, 0x77);
    root.add(arcs.group);
    this.arcs = arcs.bank;
    this.arcCount = 6;

    // ── the air ──────────────────────────────────────────────────────────
    this.shards = buildShardField(22, 14, 26, 4, 16, 0xd4);
    root.add(this.shards.group);

    const dust = buildDust(1200, 10, 60, -1, 30, hueToColor(LASER_HUES[1], 0.4), 0x33);
    root.add(dust.points);
    this.dust = dust.points;

    const horizon = buildHorizon(92, 9, hueToColor(LASER_HUES[3], 0.5), 0.24);
    root.add(horizon.group);
    upgradeVoid(root); // the sculpted kit (arena/voidSculpt.ts)
    this.horizonNear = horizon.near;
    this.horizonFar = horizon.far;

    // THE ROOM CHECK — the only words in the whole place, dead ahead of the
    // home pad because that is the way you arrive facing.
    //
    // Everything else out here is learned by doing and is therefore not
    // written down: the floor's colours are the instruction, the invitation
    // is a circle of light on the ground, and stepping is a thing a body
    // already knows how to do. This one cannot be learned by doing — a body
    // that finds a real wall halfway through a step has been failed by the
    // experience rather than by the room — so it is said once, in as few
    // words as it can be said in, and then it goes.
    //
    // It goes for good on your first step. There was a second card here
    // that took over at that point and explained the route; it was four
    // lines of a manual for a game with no controls, in a place whose whole
    // argument is that it doesn't need one.
    //
    // The one thing it does still say is WHICH WAY. The circuit is a loop
    // with a direction — home, east, up, north, west, home (course/score.ts)
    // — and the first leg out of the pad runs to (2.60, 0, −1.20) while you
    // arrive facing −z, which puts it on your right. Nothing else in the
    // view says so until the invitation lights up on the floor a beat
    // later, and that is a circle on the ground you have to be looking down
    // to find. A body that turns the wrong way off the pad has been failed
    // by the room in the same way the space check exists to prevent, so it
    // is said in the same place, once, and it leaves with the card.
    const room = panelTexture({
      title: 'CLEAR 1.8 × 1.8 m',
      lines: ['STAND IN THE MIDDLE AND RECENTRE'],
      way: 'right',
      width: 2.5,
      accent: PALETTE.cyan,
      color: '#dcf1ff',
    });
    // Single-sided: it faces the pad, and mirror writing seen from the air
    // is worse than a card that simply isn't there from behind.
    this.cardMat = new MeshBasicMaterial({
      map: room.tex,
      transparent: true,
      depthWrite: false,
    });
    this.card = new Mesh(new PlaneGeometry(2.5, 2.5 * room.aspect), this.cardMat);
    this.card.position.set(0, 1.6, -2.5);
    // OVER THE AIR. The void's glow layers (shafts, horizon, dust) are
    // transparent and carry render orders of their own, so a card left at
    // zero got sorted among them and had haze blended over its lower half
    // — which is exactly where the words sit, and why the bottom line read
    // as grey while the title stayed sharp. The only writing in the place
    // draws last.
    this.card.renderOrder = 24;
    root.add(this.card);

    // DANGER, hung over the room check.
    //
    // THE STEP wears one of these on the club side of the portal, and the
    // reasoning carries through the door: a doorway with moving ground
    // behind it has earned a warning, and a warning is allowed to be a
    // word. What the card below it says is a room instruction — clear the
    // space, stand in it, recentre. What this says is why that instruction
    // is not advice. They belong together, so they arrive and leave together.
    //
    // No backing plate and no drop rods, unlike the club's: there is no
    // ceiling out here to hang anything from, and the void kit's whole law
    // is that darkness is given shape by LIGHT ONLY. So it is lit gas in
    // mid-air — the one red thing in a place of cyan and magenta, which is
    // exactly the job DECOR.danger does indoors.
    const cardH = 2.5 * room.aspect;
    const signW = 1.9;
    const signH = signW * DANGER_ASPECT;
    this.dangerMat = new MeshBasicMaterial({
      map: dangerTexture(),
      transparent: true,
      depthWrite: false,
      toneMapped: false, // lit gas reads through the tone curve, like every neon here
    });
    this.danger = new Mesh(new PlaneGeometry(signW, signH), this.dangerMat);
    this.danger.renderOrder = 24;
    this.danger.position.set(0, 1.6 + cardH / 2 + 0.18 + signH / 2, -2.5);
    root.add(this.danger);
  }

  update(dt: number): void {
    if (!course.active) return;
    this.clock += dt;

    if (course.roomWarn && !this.warning) this.raiseRoomWarning();

    // The notice goes on your first step — by then you demonstrably have the
    // floor — and comes back for the next crossing, because that is a fresh
    // start and the room may be a different room.
    const want = G.handovers === 0 ? 1 : 0;
    this.cardMat.opacity += (want - this.cardMat.opacity) * Math.min(1, dt * 3);
    this.card.visible = this.cardMat.opacity > 0.01;
    // The warning is part of the same notice, so it goes when the notice
    // goes. A DANGER left hanging over nothing after the card beneath it has
    // faded would be a sign about the void in general, which is scenery — and
    // scenery that says DANGER is how a warning stops meaning anything.
    this.dangerMat.opacity = this.cardMat.opacity;
    this.danger.visible = this.card.visible;

    // Energy: the world ducks while the ground you own is counting itself
    // out — and harder still for the beat after a missed step, so the whole
    // void goes with the thud. Danger never competes with scenery.
    const target = G.slipFlash > 0
      ? ENERGY.slipped
      : G.groundLeaving
        ? ENERGY.ducked
        : Math.min(1, ENERGY.base + G.flow * ENERGY.flowBonus);
    G.energy += (target - G.energy) * Math.min(1, dt * ENERGY.ease);
    applyDim(G.energy);

    const beat = G.transport.bars * 4;
    const energy = G.energy;
    const beatFrac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - beatFrac * 2.2);

    // Hue snaps per bar, marching around the wheel with the light rig.
    const bar = Math.floor(G.transport.bars);
    if (bar !== this.lastBar && beat > 0) {
      this.lastBar = bar;
      this.hueCursor = (this.hueCursor + 1) % LASER_HUES.length;
    }
    const hueAt = (n: number): number =>
      hueToColor(LASER_HUES[(this.hueCursor + n) % LASER_HUES.length], 0.55);

    // Towers breathe on the kick as a travelling wave, so the rings ROLL
    // around the arena instead of flashing as one.
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
    driveFacades(this.facadeHue.setHex(hueAt(2)), 0.45 + energy * (0.35 + pulse * 0.3), this.clock);

    // The canopy turns and its joints take the kick; laps spin it up.
    this.canopy.spin(dt, 0.12 * (1 + Math.min(course.laps, 3) * 0.4));
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
  }

  /** The play-area courtesy: say so, plainly, before the first ride. */
  private raiseRoomWarning(): void {
    const { w, d } = course.roomWarn!;
    this.warning = textPanel({
      title: 'ROOM CHECK',
      lines: [
        `this play area reads ${w.toFixed(1)} × ${d.toFixed(1)} m`,
        'steps may land past your boundary',
      ],
      width: 1.7,
      color: '#ffd6a0',
      accent: 0xffb000,
    });
    // Beside the room check, not behind you: a warning you have to turn
    // round to find is a warning nobody reads.
    this.warning.position.set(2.1, 1.35, -2.1);
    this.warning.rotation.y = -Math.PI / 6;
    courseRoot().add(this.warning);
  }
}
