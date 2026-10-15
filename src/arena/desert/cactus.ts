/**
 * Cacti, rebuilt for DESERT 2.1. The papercraft capsules are gone: a
 * saguaro is a RIBBED column — thirteen ribs, each a rounded crest with a
 * shaded trough beside it — that swells out of the ground, tapers a hair
 * and rounds off at the crown, with arms that are the same ribbed tube
 * bent out of the trunk and up (the classic arms-up silhouette). Every
 * rib carries its AREOLES (textures.ts cactusSkin: the pale woolly dots
 * with their fans of spines, one tile per rib, one areole per tile) so
 * the plant reads as a cactus from across the arena and from a metre.
 * The barrel is the same lathe, fat and low, with twenty-one deep ribs, a
 * woolly crown and a ring of flowers. The prickly pear keeps its stacked
 * flattened pads, in the hide.
 *
 * One function makes every one of them: `ribbedTube` lofts a star-section
 * ring along a spline, so a trunk, an arm and a barrel differ only in the
 * curve and the radius profile handed in.
 */

import {
  BufferGeometry,
  CatmullRomCurve3,
  Float32BufferAttribute,
  type Group as GroupT,
  Group,
  Mesh,
  SphereGeometry,
  Vector3,
} from 'three';
import { CONFIG } from './config.js';
import { makePaper, makeRng } from './paper.js';
import { desertHeight } from './terrain.js';
import { cactusMat } from './textures.js';
import { freeSpot } from './occupancy.js';
import { collapseStatic } from '../merge.js';
import type { Swayer } from './index.js';

const P = CONFIG.palette;
const RIBS = 13;
/** Areole spacing up a rib, metres. */
const AREOLE_M = 0.11;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** The rib profile: 1 on a crest, 1 − depth in the trough, rounded. */
function ribbed(theta: number, ribs: number, depth: number): number {
  const trough = 0.5 - 0.5 * Math.cos(theta * ribs);
  return 1 - depth * Math.pow(trough, 0.75);
}

/**
 * A ribbed tube along a spline: rings of `ribs × 4` vertices at `segs`
 * stations (Frenet frames, so the rings follow the bend), each ring's
 * radius `radius(t)` scaled by the rib profile, closed with a centre fan
 * at both ends. UVs: u = one skin tile per rib with the crest at the
 * tile's centre, v = length along the rib in areoles. Vertex colour: the
 * crests pale, the troughs dark, and `tint(t)` along the length.
 */
function ribbedTube(
  pts: Vector3[],
  radius: (t: number) => number,
  ribs: number,
  depth: number,
  segs: number,
  tint: (t: number) => [number, number, number],
): BufferGeometry {
  const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const frames = curve.computeFrenetFrames(segs, false);
  const sides = ribs * 4;
  const length = curve.getLength();
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    const R = Math.max(0.002, radius(t));
    const n = frames.normals[i];
    const b = frames.binormals[i];
    const [tr, tg, tb] = tint(t);
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * Math.PI * 2;
      const rr = R * ribbed(th, ribs, depth);
      const cx = Math.cos(th) * rr;
      const cy = Math.sin(th) * rr;
      pos.push(p.x + n.x * cx + b.x * cy, p.y + n.y * cx + b.y * cy, p.z + n.z * cx + b.z * cy);
      uv.push((th * ribs) / (Math.PI * 2) + 0.5, (t * length) / AREOLE_M);
      const crest = 0.5 + 0.5 * Math.cos(th * ribs);
      const shade = 0.7 + crest * 0.3;
      col.push(tr * shade, tg * shade, tb * shade);
    }
  }
  // Winding: a Frenet ring runs N → B, and T × dp/dθ points INTO the
  // tube, so the quads are wound the other way round to face out.
  const ring = sides + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j;
      const c = a + ring;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  // The ends: a centre vertex fanned to each end ring.
  const [r0, g0, b0] = tint(0);
  const root = pos.length / 3;
  curve.getPointAt(0, p);
  pos.push(p.x, p.y, p.z);
  uv.push(0.5, 0);
  col.push(r0 * 0.85, g0 * 0.85, b0 * 0.85);
  for (let j = 0; j < sides; j++) idx.push(root, j + 1, j);
  const [r1, g1, b1] = tint(1);
  const tip = pos.length / 3;
  curve.getPointAt(1, p);
  pos.push(p.x, p.y, p.z);
  uv.push(0.5, length / AREOLE_M);
  col.push(r1, g1, b1);
  const last = segs * ring;
  for (let j = 0; j < sides; j++) idx.push(tip, last + j, last + j + 1);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** A rounded end: 1 until `from`, then a quarter circle down to nothing. */
const dome = (t: number, from: number): number => (t <= from ? 1 : Math.sqrt(Math.max(0, 1 - ((t - from) / (1 - from)) ** 2)));

/** A little squashed bloom for a growth tip. */
function makeBloom(r: number): Mesh {
  const bloom = new Mesh(new SphereGeometry(r, 12, 9), makePaper(P.flower, 0.9));
  bloom.scale.y = 0.7;
  return bloom;
}

/** The green: yellower and paler toward the growing tip, browner and
 *  duller at the old base. */
const saguaroTint = (t: number): [number, number, number] => [0.88 + t * 0.16, 0.96 + t * 0.06, 0.84 - t * 0.08];

/** The classic tall armed saguaro: ribbed trunk, domed crown, raised arms. */
function makeSaguaro(rng: () => number): Group {
  const g = new Group();
  g.name = 'saguaro';
  const mat = cactusMat(rng() < 0.5 ? P.cactus : P.cactusDark, { repeat: [1, 1] });
  mat.vertexColors = true;
  const H = 2.6 + rng() * 2.2;
  const R = 0.24 + rng() * 0.07;
  const lean = (rng() - 0.5) * 0.14;
  const trunk = [new Vector3(0, -0.15, 0), new Vector3(lean * 0.3, H * 0.5, 0), new Vector3(lean, H, 0)];
  const trunkR = (t: number): number => R * (0.82 + 0.18 * clamp01(t / 0.12)) * (1 - 0.1 * t) * dome(t, 0.9);
  g.add(new Mesh(ribbedTube(trunk, trunkR, RIBS, 0.22, Math.max(16, Math.round(H / 0.12)), saguaroTint), mat));

  const arms = rng() < 0.2 ? 3 : (rng() * 3) | 0;
  for (let i = 0; i < arms; i++) {
    const at = H * (0.36 + rng() * 0.32);
    const len = 0.7 + rng() * 0.9;
    const reach = 0.36 + rng() * 0.12;
    const r = R * (0.62 + rng() * 0.1);
    // Rooted INSIDE the trunk, out past its ribs, then up: the elbow is
    // the spline's own bend, and the join is hidden in the trunk.
    const pts = [
      new Vector3(0, at, 0),
      new Vector3(reach * 0.55, at + 0.08, 0),
      new Vector3(reach, at + 0.32, 0),
      new Vector3(reach, at + 0.32 + len * 0.5, 0),
      new Vector3(reach, at + 0.32 + len, 0),
    ];
    const armR = (t: number): number => r * (0.8 + 0.2 * clamp01(t / 0.15)) * dome(t, 0.88);
    const arm = new Mesh(ribbedTube(pts, armR, RIBS, 0.22, 28, saguaroTint), mat);
    arm.rotation.y = rng() * Math.PI * 2; // any bearing round the trunk
    g.add(arm);
  }

  // The odd saguaro flowers at its crown in spring.
  if (rng() < 0.45) {
    for (let k = 0; k < 3; k++) {
      const bloom = makeBloom(0.06);
      const a = rng() * Math.PI * 2;
      bloom.position.set(lean + Math.cos(a) * R * 0.5, H - 0.02, Math.sin(a) * R * 0.5);
      g.add(bloom);
    }
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** A squat barrel cactus: fat, deeply ribbed, a woolly crown, flowers. */
function makeBarrel(rng: () => number): Group {
  const g = new Group();
  g.name = 'barrel';
  const mat = cactusMat(P.cactus, { repeat: [1, 1] });
  mat.vertexColors = true;
  const H = 0.55 + rng() * 0.5;
  const R = 0.3 + rng() * 0.12;
  const pts = [new Vector3(0, -0.08, 0), new Vector3(0, H * 0.5, 0), new Vector3(0, H, 0)];
  const radius = (t: number): number => R * Math.pow(Math.sin(Math.PI * (0.05 + t * 0.9)), 0.55);
  g.add(new Mesh(ribbedTube(pts, radius, 21, 0.3, 22, (t) => [0.9 + t * 0.1, 1, 0.85]), mat));
  const wool = new Mesh(new SphereGeometry(R * 0.42, 12, 8), makePaper('#d9c98e', 0.95));
  wool.scale.y = 0.35;
  wool.position.y = H * 0.97;
  g.add(wool);
  const flowers = 3 + ((rng() * 3) | 0);
  for (let k = 0; k < flowers; k++) {
    const a = (k / flowers) * Math.PI * 2 + rng() * 0.4;
    const bloom = makeBloom(0.055);
    bloom.position.set(Math.cos(a) * R * 0.5, H * 0.99, Math.sin(a) * R * 0.5);
    g.add(bloom);
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** Stacked prickly-pear pads (flattened spheres), some tipped with blooms. */
function makePricklyPear(rng: () => number): Group {
  const g = new Group();
  const mat = cactusMat(P.cactusDark, { repeat: [5, 3], bumpScale: 0.015 });
  const pads = 2 + ((rng() * 3) | 0);
  let px = 0;
  let py = 0.35;
  for (let i = 0; i < pads; i++) {
    const rad = 0.35 + rng() * 0.12;
    const pad = new Mesh(new SphereGeometry(rad, 18, 12), mat);
    pad.scale.set(1, 1.25, 0.32);
    pad.rotation.y = rng() * Math.PI;
    pad.rotation.z = (rng() - 0.5) * 0.6;
    pad.position.set(px, py, 0);
    g.add(pad);
    // A bloom riding the top edge of an upper pad.
    if (i >= pads - 2 && rng() < 0.5) {
      const bloom = makeBloom(0.07);
      bloom.position.set(px + (rng() - 0.5) * 0.2, py + rad * 1.2, 0);
      g.add(bloom);
    }
    px += (rng() - 0.5) * 0.4;
    py += 0.4 + rng() * 0.2;
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/**
 * Scatter cacti across the desert, clear of the platforms. Returns the saguaro
 * sway handles — tall cacti get a barely-there lean so the scene isn't frozen,
 * while the squat barrels and pears stay put.
 */
export function buildCacti(parent: GroupT): Swayer[] {
  const rng = makeRng(CONFIG.terrain.seed * 5 + 2);
  const half = CONFIG.terrain.size / 2 - 8;
  const clear = CONFIG.cacti.clearRadius;
  const swayers: Swayer[] = [];
  // Barrels and prickly-pears never move, so they all merge together into a few
  // meshes for the whole field; saguaros sway, so each collapses on its own.
  const statics = new Group();

  // Clear of the platforms, and of every boulder pile and mesa foot the
  // rocks claimed before us (occupancy.ts).
  const place = (g: Group, into: GroupT, r: number): void => {
    const [x, z] = freeSpot(() => {
      let px = 0;
      let pz = 0;
      do {
        px = (rng() * 2 - 1) * half;
        pz = (rng() * 2 - 1) * half;
      } while (Math.hypot(px, pz) < clear);
      return [px, pz];
    }, r);
    g.position.set(x, desertHeight(x, z), z);
    g.rotateY(rng() * Math.PI * 2);
    into.add(g);
  };

  for (let i = 0; i < CONFIG.cacti.saguaro; i++) {
    const s = makeSaguaro(rng);
    collapseStatic(s); // trunk + arms + crown → one mesh (+bloom); still sways as a unit
    place(s, parent, 1.2);
    swayers.push({ obj: s, phase: rng() * Math.PI * 2, amp: 0.012 + rng() * 0.012, speed: 0.4 + rng() * 0.3 });
  }
  for (let i = 0; i < CONFIG.cacti.barrel; i++) place(makeBarrel(rng), statics, 0.6);
  for (let i = 0; i < CONFIG.cacti.pricklyPear; i++) place(makePricklyPear(rng), statics, 0.8);
  collapseStatic(statics);
  parent.add(statics);
  return swayers;
}
