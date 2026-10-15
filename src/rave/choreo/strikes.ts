/**
 * Landing FX — the attack actually ARRIVING on a platform.
 *
 * The sweep, nova and flood are ported from FIRE FIGHT's strike kit (the
 * blade you can WATCH travel, the expanding shock ring, the settling tide)
 * — that readability contract survived a lot of playtesting and we take it
 * as-is. One deliberate departure, kept because ours reads better for this
 * game: the BEAM stays a straight lane wall down the deck, never aimed.
 *
 * THE DANGER KIT (telegraphs.ts): a strike wears the same heat ramp as the
 * mark that warned of it — it ignites WHITE-HOT and burns out to danger
 * red — and the floor mark itself flashes underneath it (the telegraph's
 * afterburn), so warning and hit are one object. What this module adds is
 * the VOLUME: sheets of light, never solid boxes. Every wall is brightest
 * at its business edge (the deck for a beam, the lip for the sweep's
 * curtain) and fades away from it like haze in a laser, with scanlines
 * racing off the edge and neon tubes up its sides — the lasers' and the
 * deck rims' own vocabulary, in danger's colours, so a strike can never be
 * mistaken for the light show and never looks like it came from another
 * game.
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
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  Color,
  Matrix4,
  type Object3D,
  type Sprite,
  type SpriteMaterial,
} from 'three';
import { CHOREO, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH, OCTAGON_VERTICES, TRIDENT } from '../config.js';
import { glintTexture, glowSprite } from '../materials/glow.js';
import { HEAT, HEAT_GLSL, OCT_GLSL } from './telegraphs.js';

interface Strike {
  group: Group;
  age: number;
  life: number;
  tick: (k: number, group: Group) => void;
  /** Real-time step for particle physics (k alone can't integrate). */
  step?: (dt: number) => void;
}

const EMBER = HEAT.amber;

/** The deck's corner radius: past it a ring of light is all void. */
const DECK_CORNER_R = Math.max(...OCTAGON_VERTICES.map(([x, z]) => Math.hypot(x, z)));

/**
 * A sheet of light. `vY` runs 0 at the business edge to 1 at the far edge
 * (uBase/uH in object space); the caps of a box carry nothing (a wall is
 * its faces, not a lid). uCore marks a white-hot core sheet, which holds
 * its heat longer than the halo around it.
 */
const WALL_VERT = /* glsl */ `
  uniform float uBase, uH;
  uniform mat4 uPlace;
  varying vec2 vUv;
  varying vec2 vDeck;
  varying float vY;
  varying float vCap;
  void main(){
    vUv = uv;
    vDeck = (uPlace * vec4(position, 1.0)).xz;
    vY = (position.y - uBase) / uH;
    vCap = abs(normal.y);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WALL_FRAG = /* glsl */ `
  ${HEAT_GLSL}
  ${OCT_GLSL}
  uniform float uK, uTime, uGain, uCore, uRise, uEdges, uTintAmt;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying vec2 vDeck;
  varying float vY;
  varying float vCap;
  void main(){
    if (vCap > 0.5) discard;
    // Light lives over the deck and nowhere else: a wall that would run
    // past the chamfers (or a ring still outside them) never pokes out
    // through the rim into the void.
    float deck = octMask(vDeck);
    if (deck <= 0.0) discard;
    // Ignites white-hot, burns out to danger red; a core stays hot longer.
    vec3 col = mix(HOT, DANGER, smoothstep(0.0, mix(0.5, 1.3, uCore), uK));
    // A tinted sheet (THE TRIDENT's bolt) wears the weapon's colour.
    col = mix(col, uTint, uTintAmt);
    float fall = exp(-vY * uRise);
    // Scanlines racing off the business edge — the hit is still moving.
    float scan = 0.7 + 0.3 * sin(vY * 34.0 - uTime * 22.0);
    // Neon tubes up the sides; the foot where the wall meets its edge.
    float edge = min(vUv.x, 1.0 - vUv.x);
    float tube = (1.0 - smoothstep(0.0, 0.04, edge)) * uEdges;
    float foot = 1.0 - smoothstep(0.0, 0.05, vY);
    float a = fall * (0.4 * scan + 0.7 * tube) + foot * 0.9;
    float env = 1.0 - uK;
    gl_FragColor = vec4(col * a * env * env * uGain * deck, 1.0);
  }
`;

interface WallOpts {
  /** Object-space y of the business edge, and the height it fades over. */
  base: number;
  h: number;
  core?: boolean;
  /** How fast it fades away from the edge (bigger = tighter). */
  rise?: number;
  gain?: number;
  /** Neon tubes on the uv sides (off for a closed ring — its seam isn't an edge). */
  edges?: boolean;
  /** Wear this colour instead of the heat ramp (0..1 of it). */
  tint?: number;
  tintAmt?: number;
}

function wallMat(o: WallOpts): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      uBase: { value: o.base },
      uH: { value: o.h },
      uK: { value: 0 },
      uTime: { value: 0 },
      uGain: { value: o.gain ?? 1 },
      uCore: { value: o.core ? 1 : 0 },
      uRise: { value: o.rise ?? 2.2 },
      uEdges: { value: o.edges === false ? 0 : 1 },
      uTint: { value: new Color(o.tint ?? HEAT.hot) },
      uTintAmt: { value: o.tintAmt ?? 0 },
      // The mesh's transform in deck space (StrikeFx.update keeps it live).
      uPlace: { value: new Matrix4() },
    },
    vertexShader: WALL_VERT,
    fragmentShader: WALL_FRAG,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
}

/** A centred box of light, its business edge on its floor. */
function wall(w: number, h: number, d: number, o: Partial<WallOpts> = {}): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), wallMat({ base: -h / 2, h, ...o }));
  m.renderOrder = 21;
  return m;
}

/** A single core sheet (a plane, so it never double-blends with itself). */
function sheet(len: number, h: number, o: Partial<WallOpts> = {}): Mesh {
  const m = new Mesh(new PlaneGeometry(len, h), wallMat({ base: -h / 2, h, core: true, rise: 1.6, ...o }));
  m.renderOrder = 22;
  return m;
}

/** Burn a strike element: k is its own 0..1 clock. */
function burn(m: Object3D, k: number): void {
  const mat = (m as Mesh).material as ShaderMaterial;
  mat.uniforms.uK.value = Math.min(1, k);
}

/** A tiny per-strike spark pool: N additive points with gravity, emitted in
 *  puffs along the strike (the fire-fight ember trick). */
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

/** Hand every wall its CURRENT transform in deck space (the strike group
 *  sits on the platform root; its walls move and scale as they burn), so
 *  the octagon clip follows them. */
function place(s: { group: Group; walls: Mesh[] }): void {
  s.group.updateMatrix();
  for (const m of s.walls) {
    m.updateMatrix();
    const u = (m.material as ShaderMaterial).uniforms.uPlace.value as Matrix4;
    u.multiplyMatrices(s.group.matrix, m.matrix);
  }
}

export class StrikeFx {
  private live: (Strike & { walls: Mesh[] })[] = [];

  private spawn(parent: Object3D, life: number, tick: Strike['tick'], build: (g: Group) => void, step?: Strike['step']): void {
    const group = new Group();
    build(group);
    parent.add(group);
    const walls: Mesh[] = [];
    group.traverse((o) => {
      if ((o as Mesh).material instanceof ShaderMaterial) walls.push(o as Mesh);
    });
    const strike = { group, age: 0, life, tick, step, walls };
    this.live.push(strike);
    tick(0, group);
    place(strike);
  }

  /** The swing — a hanging CURTAIN of light travels the deck: all its mass
   *  is ABOVE the limbo line, fading upward off a white-hot lip, and it
   *  never touches the floor — so up close it reads "danger overhead, air
   *  below", not "the deck is about to be cut in half". Embers shed off the
   *  lip. `fromSide` = which local-x side the swing enters from. */
  sweep(parent: Object3D, fromSide: 1 | -1): void {
    // Enters at the rim: the deck clip would hide any travel over the void.
    const span = OCTAGON_HALF_WIDTH + 0.07;
    const curtainH = 0.9;
    const sparks = new Sparks(26, EMBER);
    let emberClock = 0;
    this.spawn(
      parent,
      0.42,
      (k, g) => {
        const travel = Math.min(1, k / 0.81); // done travelling at age 0.34
        const bx = fromSide * span * (1 - 2 * travel);
        const [curtain, lip] = g.children;
        curtain.position.x = bx;
        burn(curtain, k * k);
        lip.position.x = bx;
        burn(lip, k);
        // Embers shed off the lip.
        const age = k * 0.42;
        if (age > emberClock) {
          emberClock = age + 0.045;
          const zr = (Math.random() * 2 - 1) * OCTAGON_HALF_DEPTH;
          sparks.emit(bx, CHOREO.sweepY + 0.04, zr, 4, 1.2);
        }
      },
      (g) => {
        const depth = OCTAGON_HALF_DEPTH * 2 + 0.2;
        const curtain = wall(0.14, curtainH, depth, { rise: 3 });
        curtain.position.set(fromSide * span, CHOREO.sweepY + curtainH / 2, 0);
        g.add(curtain);
        const lip = sheet(depth, 0.06, { rise: 0.5 });
        lip.rotation.y = Math.PI / 2;
        lip.position.set(fromSide * span, CHOREO.sweepY + 0.03, 0);
        g.add(lip);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** OURS, kept: a straight wall of light down the lane — never aimed,
   *  exactly where the strip said: a heat-haze volume with a white-hot core
   *  sheet down its middle, the pair collapsing inward as it burns out. */
  beam(parent: Object3D, x: number, yaw = 0, halfW = CHOREO.beamHalfWidth): void {
    // A yawed beam (THE X's arm) runs the deck diagonal; its offset `x` is
    // perpendicular to its own run.
    const len = yaw
      ? Math.hypot(OCTAGON_HALF_WIDTH * 2, OCTAGON_HALF_DEPTH * 2) - 0.2
      : OCTAGON_HALF_DEPTH * 2;
    const px = Math.cos(yaw) * x;
    const pz = -Math.sin(yaw) * x;
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const [body, core] = g.children;
        burn(body, k);
        body.scale.x = 1 - k * 0.55;
        burn(core, k);
        core.scale.y = 1 - k * 0.3;
      },
      (g) => {
        const body = wall(halfW * 2, 2.4, len);
        body.position.set(px, 1.2, pz);
        body.rotation.y = yaw;
        g.add(body);
        const core = sheet(len, 2.4);
        core.position.set(px, 1.2, pz);
        core.rotation.y = yaw + Math.PI / 2;
        g.add(core);
      },
    );
  }

  /** THE TRIDENT's blow: on every doomed quarter a bolt in the weapon's
   *  own colour drives into the deck — the thing you read in his hand,
   *  arriving — and the quarter erupts in a slab of heat over the floor's
   *  afterburn, throwing embers. The bolt is gone in a blink; the heat is
   *  what lingers, like every other strike. */
  trident(parent: Object3D, hit: number, form: number): void {
    const tint = TRIDENT.forms[form]?.color ?? HEAT.hot;
    const qw = OCTAGON_HALF_WIDTH;
    const qd = OCTAGON_HALF_DEPTH;
    const quarters: [number, number][] = [];
    for (let c = 0; c < 4; c++) {
      if ((hit >> c) & 1) quarters.push([((c & 1 ? 1 : -1) * qw) / 2, ((c & 2 ? 1 : -1) * qd) / 2]);
    }
    const sparks = new Sparks(48, EMBER);
    let burst = false;
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        g.children.forEach((m, i) => {
          if (m === sparks.points) return;
          if (i % 2 === 0) {
            // The bolt: a blink of the weapon's colour.
            burn(m, Math.min(1, k * 2.4));
          } else {
            burn(m, k);
            m.scale.y = 1 - 0.5 * k;
            m.position.y = 0.4 * m.scale.y;
          }
        });
        if (!burst) {
          burst = true;
          for (const [x, z] of quarters) sparks.emit(x, 0.1, z, 10, 1.5);
        }
      },
      (g) => {
        for (const [x, z] of quarters) {
          const bolt = wall(0.07, 5, 0.07, { core: true, rise: 0.5, gain: 1.4, tint, tintAmt: 0.75 });
          bolt.position.set(x, 2.5, z);
          g.add(bolt);
          const slab = wall(qw * 0.88, 0.8, qd * 0.88, { rise: 2.4, gain: 0.85 });
          slab.position.set(x, 0.4, z);
          g.add(slab);
        }
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** THE DONUT closes: the rim goes up as a ring of light and RUSHES IN,
   *  stopping dead on the doorpost circle — the opposite motion to the
   *  nova's shock ring, so the two can never be confused at a glance even
   *  though both are round. The middle is left conspicuously untouched:
   *  that's the ground that lived (the floor's afterburn spares it too). */
  donut(parent: Object3D, innerR: number): void {
    // Starts at the deck's corners, not out in the void: the wall closes IN
    // from the rim instead of sweeping through it.
    const outer = DECK_CORNER_R;
    const sparks = new Sparks(54, EMBER);
    let landed = false;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const close = Math.min(1, k / 0.7);
        const ring = g.children[0];
        // The wall races in from the deck edge and parks on the safe rim.
        const r = outer - close * (outer - innerR);
        ring.scale.set(r, 1, r);
        // The ring holds its heat while it travels — the motion is the read.
        burn(ring, k * k);
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
        const h = 0.9;
        const ring = new Mesh(
          new CylinderGeometry(1, 1, h, 48, 1, true),
          wallMat({ base: -h / 2, h, rise: 2.6, gain: 1.6, edges: false }),
        );
        ring.renderOrder = 21;
        ring.position.y = h / 2;
        g.add(ring);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** THE CROSSFIRE fires: a wall of light rakes ACROSS the deck, exactly on
   *  the strip — with the emitter that fed it flaring on its rail, so the
   *  eye can see where the shot came from even after the beam is gone. */
  rail(parent: Object3D, z: number, halfD: number, from: 1 | -1): void {
    const span = OCTAGON_HALF_WIDTH * 2;
    const sparks = new Sparks(24, EMBER);
    let fired = false;
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const [body, core, flare] = g.children;
        burn(body, k);
        body.scale.z = 1 - k * 0.55;
        burn(core, k);
        core.scale.y = 1 - k * 0.3;
        // The muzzle flare dies faster than the beam it threw.
        flare.scale.setScalar(Math.max(0.001, 0.6 * (1.35 - k * 1.6)));
        ((flare as Sprite).material as SpriteMaterial).color.setHex(k < 0.25 ? HEAT.hot : HEAT.danger);
        if (!fired) {
          fired = true;
          // Embers thrown off the wire where it crosses the deck.
          for (let i = -2; i <= 2; i++) {
            sparks.emit((i / 2) * OCTAGON_HALF_WIDTH * 0.8, 0.12, z, 4, 1.2);
          }
        }
      },
      (g) => {
        const body = wall(span, 2.4, halfD * 2);
        body.position.set(0, 1.2, z);
        g.add(body);
        const core = sheet(span, 2.4);
        core.position.set(0, 1.2, z);
        g.add(core);
        const flare = glowSprite(HEAT.hot, 0.5, 0.9);
        flare.position.set(from * (OCTAGON_HALF_WIDTH + 0.1), 0.5, z);
        g.add(flare);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** The gate slams shut: both danger fields go up as walls of light and
   *  the doorposts of the safe column burn white-hot — the gap is exactly
   *  where the telegraph promised. */
  gate(parent: Object3D, at: number, half: number, axis: 0 | 1 = 0): void {
    // axis 0: doorway column at local x. axis 1: the horizontal cousin —
    // the clear band runs across the deck at local z, so the danger walls
    // stand before and behind it instead of either side.
    const edge = axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH;
    const span = axis ? OCTAGON_HALF_WIDTH * 2 : OCTAGON_HALF_DEPTH * 2;
    const loW = Math.max(0.05, at - half + edge);
    const hiW = Math.max(0.05, edge - (at + half));
    const place = (m: Object3D, along: number): void => {
      if (axis) m.position.set(0, m.position.y, along);
      else m.position.set(along, m.position.y, 0);
    };
    this.spawn(
      parent,
      0.45,
      (k, g) => {
        const [lo, hi, postA, postB] = g.children;
        burn(lo, k);
        burn(hi, k);
        burn(postA, k);
        burn(postB, k);
      },
      (g) => {
        const field = (w: number): Mesh =>
          axis ? wall(span, 2.2, w, { gain: 0.8 }) : wall(w, 2.2, span, { gain: 0.8 });
        const lo = field(loW);
        lo.position.y = 1.1;
        place(lo, at - half - loW / 2);
        g.add(lo);
        const hi = field(hiW);
        hi.position.y = 1.1;
        place(hi, at + half + hiW / 2);
        g.add(hi);
        for (const side of [-1, 1] as const) {
          const post = sheet(span, 2.3, { gain: 1.2 });
          if (!axis) post.rotation.y = Math.PI / 2;
          post.position.y = 1.15;
          place(post, at + side * half);
          g.add(post);
        }
      },
    );
  }

  /** PORTED: the nova lands as an expanding SHOCK RING — an open ring of
   *  light racing out from the centre over the floor's afterburn (which
   *  spares the wedge), with sparks erupting along the front everywhere
   *  but the safe ground. */
  nova(parent: Object3D, bearing: number, halfAngle: number): void {
    const sparks = new Sparks(90, EMBER);
    let burstClock = 0;
    let crowned = false;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const grow = Math.min(1, k / 0.84);
        const ring = g.children[0];
        // Out to the deck's corners and no further — it never passes out
        // through the rim (the crown goes off as it arrives there).
        const r = 0.15 + grow * (DECK_CORNER_R - 0.15);
        ring.scale.set(r, 1, r);
        burn(ring, k * k);
        // Fire along the expanding front — everywhere but the wedge.
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
            sparks.emit(Math.sin(a) * CHOREO.novaRadius * 0.8, 0.12, Math.cos(a) * CHOREO.novaRadius * 0.8, 2, 1.6);
          }
        }
      },
      (g) => {
        // The ring is open across the safe wedge: the shock never sweeps
        // the ground the telegraph promised.
        const h = 0.6;
        const arc = Math.PI * 2 - halfAngle * 2;
        const ring = new Mesh(
          new CylinderGeometry(1, 1, h, 40, 1, true, bearing + halfAngle, arc),
          wallMat({ base: -h / 2, h, rise: 2.8, gain: 1.6 }),
        );
        ring.renderOrder = 21;
        ring.position.y = h / 2;
        g.add(ring);
        g.add(sparks.points);
      },
      (dt) => sparks.step(dt),
    );
  }

  /** PORTED: the tide lands and SETTLES — a slab of light floods the doomed
   *  half and sinks into the deck, shedding sparks as it drains. */
  halfFlood(parent: Object3D, side: 1 | -1, axis: 0 | 1): void {
    const halfW = axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH;
    const other = axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH;
    const depth = other * 2;
    const sparks = new Sparks(22, EMBER);
    let burstClock = 0;
    this.spawn(
      parent,
      0.5,
      (k, g) => {
        const slab = g.children[0];
        slab.scale.y = 1 - 0.7 * Math.min(1, k / 0.84); // the wave settles in
        slab.position.y = 0.35 * slab.scale.y;
        burn(slab, k);
        const age = k * 0.5;
        if (age > burstClock) {
          burstClock = age + 0.09;
          const sx = side * (0.1 + Math.random() * (halfW - 0.2));
          const sz = (Math.random() * 2 - 1) * other * 0.8;
          if (axis) sparks.emit(sz, 0.12, sx, 4, 1.0);
          else sparks.emit(sx, 0.12, sz, 4, 1.0);
        }
      },
      (g) => {
        const slab = wall(halfW, 0.7, depth, { rise: 2.6, gain: 0.9 });
        if (axis) {
          slab.rotation.y = Math.PI / 2;
          slab.position.set(0, 0.35, (side * halfW) / 2);
        } else {
          slab.position.set((side * halfW) / 2, 0.35, 0);
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
      for (const m of s.walls) (m.material as ShaderMaterial).uniforms.uTime.value = s.age;
      const k = Math.min(1, s.age / s.life);
      s.tick(k, s.group);
      place(s);
      s.step?.(dt);
      if (k >= 1) {
        s.group.removeFromParent();
        s.group.traverse((o) => {
          const m = o as Mesh;
          m.geometry?.dispose?.();
          (m.material as ShaderMaterial)?.dispose?.();
        });
        this.live.splice(i, 1);
      }
    }
  }
}
