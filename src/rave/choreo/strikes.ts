/**
 * Landing FX — the goo actually ARRIVING on a platform.
 *
 * The sweep, nova and flood are ported from FIRE FIGHT's latest strike kit
 * (the blade you can WATCH travel, the expanding shock ring, the settling
 * tide) — that readability contract survived a lot of playtesting and we
 * take it as-is. One deliberate departure, kept because ours reads better
 * for this game: the BEAM stays a straight lane wall down the deck, never
 * aimed.
 *
 * Palette discipline (see config.ts): danger speaks hazard amber→red and
 * goo green ONLY — never the disco's magenta/cyan — so a strike can't be
 * mistaken for a laser even mid-lightshow.
 *
 * Everything is seat-local (spawned under a platform's root group), cheap,
 * and dead within a second — with up to 24 platforms detonating at once,
 * every strike self-disposes.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Points,
  PointsMaterial,
  RingGeometry,
  type Object3D,
} from 'three';
import { CHOREO, DECAL_Y, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH, PALETTE } from '../config.js';
import { glintTexture, glowSprite } from '../materials/glow.js';

interface Strike {
  group: Group;
  age: number;
  life: number;
  tick: (k: number, group: Group) => void;
  /** Real-time step for particle physics (k alone can't integrate). */
  step?: (dt: number) => void;
}

const GOO = PALETTE.goopGreen;
const WARN = PALETTE.amber;
const HOT = PALETTE.whiteHot;

function basic(color: number, opacity = 0.85): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** A tiny per-strike spark pool: N additive points with gravity, emitted in
 *  puffs along the strike (the fire-fight ember trick, in goo colours). */
class Sparks {
  readonly points: Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private cursor = 0;

  constructor(private n: number, color: number) {
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -99; // parked
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({
        color,
        size: 0.055,
        map: glintTexture(),
        transparent: true,
        opacity: 0.95,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, count: number, speed = 1.4): void {
    for (let c = 0; c < count; c++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.n;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * speed;
      this.vel[i * 3] = Math.sin(a) * r * 0.6;
      this.vel[i * 3 + 1] = 0.6 + Math.random() * speed;
      this.vel[i * 3 + 2] = Math.cos(a) * r * 0.6;
      this.life[i] = 0.4 + Math.random() * 0.25;
    }
  }

  step(dt: number): void {
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -99;
        continue;
      }
      this.vel[i * 3 + 1] -= dt * 5.2;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      const ny = this.pos[i * 3 + 1] + this.vel[i * 3 + 1] * dt;
      // An ember that reaches the deck winks out — nothing ever lies on
      // the floor as litter.
      if (ny <= 0.04) {
        this.life[i] = 0;
        this.pos[i * 3 + 1] = -99;
        continue;
      }
      this.pos[i * 3 + 1] = ny;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    (this.points.geometry.getAttribute('position') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}

export class StrikeFx {
  private live: Strike[] = [];

  private spawn(parent: Object3D, life: number, tick: Strike['tick'], build: (g: Group) => void, step?: Strike['step']): void {
    const group = new Group();
    build(group);
    parent.add(group);
    this.live.push({ group, age: 0, life, tick, step });
  }

  /** The swing — a hanging goo CURTAIN travels the deck: all its mass is
   *  ABOVE the limbo line, its bottom edge is a white-hot lip, and it never
   *  touches the floor — so up close it reads "danger overhead, air below",
   *  not "the deck is about to be cut in half". Sparks shed off the lip.
   *  `fromSide` = which local-x side the swing enters from. */
  sweep(parent: Object3D, fromSide: 1 | -1): void {
    const span = OCTAGON_HALF_WIDTH + 0.7;
    const curtainH = 0.8;
    const sparks = new Sparks(26, GOO);
    let emberClock = 0;
    this.spawn(
      parent,
      0.42,
      (k, g) => {
        const travel = Math.min(1, k / 0.81); // done travelling at age 0.34
        const bx = fromSide * span * (1 - 2 * travel);
        const curtain = g.children[0] as Mesh;
        curtain.position.x = bx;
        (curtain.material as MeshBasicMaterial).opacity = 0.75 * (1 - k * k * k);
        const lip = g.children[1] as Mesh;
        lip.position.x = bx;
        (lip.material as MeshBasicMaterial).opacity = 0.95 * (1 - k * k);
        // Sparks shed off the lip.
        const age = k * 0.42;
        if (age > emberClock) {
          emberClock = age + 0.045;
          const zr = (Math.random() * 2 - 1) * OCTAGON_HALF_DEPTH;
          sparks.emit(bx, CHOREO.sweepY + 0.04, zr, 4, 1.2);
        }
      },
      (g) => {
        const depth = OCTAGON_HALF_DEPTH * 2 + 0.7;
        const curtain = new Mesh(new BoxGeometry(0.12, curtainH, depth), basic(GOO, 0.75));
        curtain.position.set(fromSide * span, CHOREO.sweepY + curtainH / 2, 0);
        g.add(curtain);
        const lip = new Mesh(new BoxGeometry(0.2, 0.045, depth), basic(HOT, 0.95));
        lip.position.set(fromSide * span, CHOREO.sweepY + 0.02, 0);
        g.add(lip);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** OURS, kept: a straight wall of light down the lane — never aimed,
   *  exactly where the strip said. Recoloured out of the disco's magenta
   *  into the hazard palette, with a white-hot core so it reads as danger
   *  and not as one more laser. */
  beam(parent: Object3D, x: number, yaw = 0, halfW = CHOREO.beamHalfWidth): void {
    // A yawed beam (THE X's arm) runs the deck diagonal; its offset `x` is
    // perpendicular to its own run.
    const len = yaw
      ? Math.hypot(OCTAGON_HALF_WIDTH * 2, OCTAGON_HALF_DEPTH * 2) + 0.7
      : OCTAGON_HALF_DEPTH * 2 + 0.9;
    const px = Math.cos(yaw) * x;
    const pz = -Math.sin(yaw) * x;
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const wall = g.children[0] as Mesh;
        (wall.material as MeshBasicMaterial).opacity = 0.7 * (1 - k);
        wall.scale.x = 1 - k * 0.55;
        const core = g.children[1] as Mesh;
        (core.material as MeshBasicMaterial).opacity = 0.95 * (1 - k * k);
        core.scale.x = 1 - k * 0.4;
      },
      (g) => {
        const wall = new Mesh(new BoxGeometry(halfW * 2, 2.4, len), basic(WARN, 0.7));
        wall.position.set(px, 1.2, pz);
        wall.rotation.y = yaw;
        g.add(wall);
        const core = new Mesh(new BoxGeometry(halfW * 0.7, 2.4, len), basic(HOT, 0.95));
        core.position.set(px, 1.2, pz);
        core.rotation.y = yaw;
        g.add(core);
      },
    );
  }

  // (THE ROUTINE's landing is no longer a strike here: the DOWN-style
  // blockfall in choreo/blockfall.ts carries the whole descent AND the
  // crush — see ChoreoSystem.resolve.)

  /** THE DONUT closes: the rim goes up as a wall of light and RUSHES IN,
   *  stopping dead on the doorpost circle — the opposite motion to the
   *  nova's shock ring, so the two can never be confused at a glance even
   *  though both are round. The middle is left conspicuously untouched:
   *  that's the ground that lived. */
  donut(parent: Object3D, innerR: number): void {
    const outer = CHOREO.donutRadius;
    const sparks = new Sparks(54, WARN);
    let landed = false;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const close = Math.min(1, k / 0.7);
        const wall = g.children[0] as Mesh;
        // The wall races in from the deck edge and parks on the safe rim.
        const r = outer - close * (outer - innerR);
        wall.scale.set(r, 1, r);
        (wall.material as MeshBasicMaterial).opacity = 0.85 * (1 - k * k);
        const floor = g.children[1] as Mesh;
        (floor.material as MeshBasicMaterial).opacity = 0.7 * (1 - k);
        const rim = g.children[2] as Mesh;
        (rim.material as MeshBasicMaterial).opacity = 0.95 * (1 - k);
        rim.scale.setScalar(1 + k * 0.06);
        if (!landed && close >= 1) {
          landed = true;
          // Embers thrown UP off the doorpost circle as the wall piles into
          // it — the safe disc gets a crown, not a covering.
          for (let i = 0; i < 16; i++) {
            const a = (i / 16) * Math.PI * 2;
            sparks.emit(Math.sin(a) * innerR, 0.14, Math.cos(a) * innerR, 3, 1.5);
          }
        }
      },
      (g) => {
        const wall = new Mesh(new CylinderGeometry(1, 1, 0.6, 40, 1, true), basic(WARN, 0.85));
        wall.position.y = 0.3;
        wall.scale.set(outer, 1, outer);
        g.add(wall);
        // The doomed annulus flashing on the deck — a hole where you stood.
        const floor = new Mesh(new RingGeometry(innerR, outer, 44), basic(WARN, 0.7));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = DECAL_Y + 0.01;
        g.add(floor);
        // The doorpost circle, white-hot: exactly where the telegraph drew it.
        const rim = new Mesh(new RingGeometry(innerR - 0.03, innerR + 0.03, 44), basic(HOT, 0.95));
        rim.rotation.x = -Math.PI / 2;
        rim.position.y = DECAL_Y + 0.02;
        g.add(rim);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** THE CROSSFIRE fires: a wall of light rakes ACROSS the deck, exactly on
   *  the strip — with the emitter that fed it flaring on its rail, so the
   *  eye can see where the shot came from even after the beam is gone. */
  rail(parent: Object3D, z: number, halfD: number, from: 1 | -1): void {
    const span = OCTAGON_HALF_WIDTH * 2 + 0.9;
    const sparks = new Sparks(24, WARN);
    let fired = false;
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const wall = g.children[0] as Mesh;
        (wall.material as MeshBasicMaterial).opacity = 0.7 * (1 - k);
        wall.scale.z = 1 - k * 0.55;
        const core = g.children[1] as Mesh;
        (core.material as MeshBasicMaterial).opacity = 0.95 * (1 - k * k);
        core.scale.z = 1 - k * 0.4;
        // The muzzle flare dies faster than the beam it threw.
        const flare = g.children[2] as Mesh;
        flare.scale.setScalar(Math.max(0.001, 1.35 - k * 1.6));
        if (!fired) {
          fired = true;
          // Embers thrown off the wire where it crosses the deck.
          for (let i = -2; i <= 2; i++) {
            sparks.emit((i / 2) * OCTAGON_HALF_WIDTH * 0.8, 0.12, z, 4, 1.2);
          }
        }
      },
      (g) => {
        const wall = new Mesh(new BoxGeometry(span, 2.4, halfD * 2), basic(WARN, 0.7));
        wall.position.set(0, 1.2, z);
        g.add(wall);
        const core = new Mesh(new BoxGeometry(span, 2.4, halfD * 0.7), basic(HOT, 0.95));
        core.position.set(0, 1.2, z);
        g.add(core);
        const flare = glowSprite(HOT, 0.5, 0.9);
        flare.position.set(from * (OCTAGON_HALF_WIDTH + 0.3), 1.1, z);
        g.add(flare);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

    /** The gate slams shut: both danger fields flash as walls of light and
   *  the doorposts of the safe column burn white-hot — the gap is exactly
   *  where the telegraph promised. */
  gate(parent: Object3D, at: number, half: number, axis: 0 | 1 = 0): void {
    // axis 0: doorway column at local x. axis 1: the horizontal cousin —
    // the clear band runs across the deck at local z, so the danger walls
    // stand before and behind it instead of either side.
    const edge = (axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) + 0.25;
    const span = axis ? OCTAGON_HALF_WIDTH * 2 + 0.6 : OCTAGON_HALF_DEPTH * 2 + 0.6;
    const loW = Math.max(0.05, at - half + edge);
    const hiW = Math.max(0.05, edge - (at + half));
    const place = (m: Mesh, along: number): void => {
      if (axis) m.position.set(0, m.position.y, along);
      else m.position.set(along, m.position.y, 0);
    };
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const fade = 1 - k;
        (g.children[0] as Mesh & { material: MeshBasicMaterial }).material.opacity = 0.6 * fade;
        (g.children[1] as Mesh & { material: MeshBasicMaterial }).material.opacity = 0.6 * fade;
        (g.children[2] as Mesh & { material: MeshBasicMaterial }).material.opacity = 0.95 * (1 - k * k);
        (g.children[3] as Mesh & { material: MeshBasicMaterial }).material.opacity = 0.95 * (1 - k * k);
      },
      (g) => {
        const box = (w: number): BoxGeometry =>
          axis ? new BoxGeometry(span, 2.2, w) : new BoxGeometry(w, 2.2, span);
        const wallLo = new Mesh(box(loW), basic(WARN, 0.6));
        wallLo.position.y = 1.1;
        place(wallLo, at - half - loW / 2);
        g.add(wallLo);
        const wallHi = new Mesh(box(hiW), basic(WARN, 0.6));
        wallHi.position.y = 1.1;
        place(wallHi, at + half + hiW / 2);
        g.add(wallHi);
        for (const side of [-1, 1] as const) {
          const post = new Mesh(
            axis ? new BoxGeometry(span, 2.3, 0.045) : new BoxGeometry(0.045, 2.3, span),
            basic(HOT, 0.95),
          );
          post.position.y = 1.15;
          place(post, at + side * half);
          g.add(post);
        }
      },
    );
  }

  /** PORTED: the nova lands as an expanding SHOCK RING — an open tube wall
   *  racing out from the centre — over the floor flash that spares the
   *  wedge, with sparks erupting along the front everywhere but the safe
   *  ground. */
  nova(parent: Object3D, bearing: number, halfAngle: number): void {
    const sparks = new Sparks(90, WARN);
    let burstClock = 0;
    let crowned = false;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const grow = Math.min(1, k / 0.84);
        const tube = g.children[0] as Mesh;
        const r = 0.15 + grow * CHOREO.novaRadius;
        tube.scale.set(r, 1, r);
        (tube.material as MeshBasicMaterial).opacity = 0.9 * (1 - k * k);
        const wave = g.children[1] as Mesh;
        wave.scale.setScalar(0.3 + grow * 1.5);
        (wave.material as MeshBasicMaterial).opacity = 0.7 * (1 - k);
        // Fire along the expanding front — everywhere but the wedge. Each
        // pie in the chain is singular, so it gets to be the whole show:
        // twice the emitters of the old gauntlet discs, on a faster clock.
        const age = k * 0.5;
        if (age > burstClock) {
          burstClock = age + 0.04;
          for (let i = 0; i < 6; i++) {
            const a = Math.random() * Math.PI * 2 - Math.PI;
            const d = Math.abs(((a - bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (d <= halfAngle) continue; // the safe ground stays safe
            sparks.emit(Math.sin(a) * r * 0.9, 0.1, Math.cos(a) * r * 0.9, 3, 1.1);
          }
        }
        // THE CROWN: the instant the front reaches the deck edge, embers
        // erupt all around the full rim at once — the pie goes off like a
        // powder keg. Still sparing the wedge, still nothing at centre.
        if (!crowned && grow >= 1) {
          crowned = true;
          for (let i = 0; i < 14; i++) {
            const a = (i / 14) * Math.PI * 2 - Math.PI;
            const d = Math.abs(((a - bearing + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
            if (d <= halfAngle) continue;
            sparks.emit(Math.sin(a) * CHOREO.novaRadius, 0.12, Math.cos(a) * CHOREO.novaRadius, 2, 1.6);
          }
        }
      },
      (g) => {
        const tube = new Mesh(new CylinderGeometry(1, 1, 0.5, 32, 1, true), basic(WARN, 0.9));
        tube.position.y = 0.25;
        tube.scale.set(0.15, 1, 0.15);
        g.add(tube);
        // The floor flash that SPARES the wedge (ring arc, gap on the bearing).
        const arc = Math.PI * 2 - halfAngle * 2;
        const wave = new Mesh(new RingGeometry(0.5, CHOREO.novaRadius, 40, 1, 0, arc), basic(WARN, 0.7));
        wave.rotation.x = -Math.PI / 2;
        wave.rotation.z = bearing - Math.PI / 2 + halfAngle;
        wave.position.y = DECAL_Y + 0.01;
        g.add(wave);
        // (No centre burst — the danger is the RING racing outward; a blob
        // of light in the middle read as an explosion where nobody was.)
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** PORTED: the tide lands and SETTLES — a slab of goo light floods the
   *  doomed half and sinks into the deck, shedding sparks as it drains. */
  halfFlood(parent: Object3D, side: 1 | -1, axis: 0 | 1): void {
    const halfW = (axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) + 0.35;
    const other = axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH;
    const depth = other * 2 + 0.3;
    const sparks = new Sparks(22, GOO);
    let burstClock = 0;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const slab = g.children[0] as Mesh;
        slab.scale.y = 1 - 0.7 * Math.min(1, k / 0.84); // the wave settles in
        (slab.material as MeshBasicMaterial).opacity = 0.55 * (1 - k * k);
        const age = k * 0.5;
        if (age > burstClock) {
          burstClock = age + 0.09;
          const sx = side * (0.1 + Math.random() * (halfW - 0.3));
          const sz = (Math.random() * 2 - 1) * other;
          if (axis) sparks.emit(sz, 0.12, sx, 4, 1.0);
          else sparks.emit(sx, 0.12, sz, 4, 1.0);
        }
      },
      (g) => {
        const slab = new Mesh(new BoxGeometry(halfW, 0.5, depth), basic(GOO, 0.55));
        if (axis) {
          slab.rotation.y = Math.PI / 2;
          slab.position.set(0, 0.25, (side * halfW) / 2);
        } else {
          slab.position.set((side * halfW) / 2, 0.25, 0);
        }
        g.add(slab);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  update(dt: number): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const s = this.live[i];
      s.age += dt;
      const k = Math.min(1, s.age / s.life);
      s.tick(k, s.group);
      s.step?.(dt);
      if (k >= 1) {
        s.group.removeFromParent();
        s.group.traverse((o) => {
          const m = o as Mesh;
          m.geometry?.dispose?.();
          (m.material as MeshBasicMaterial)?.dispose?.();
        });
        this.live.splice(i, 1);
      }
    }
  }
}
