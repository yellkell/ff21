/**
 * THE COVE's coconut palms — ported from Tidewater's procedural palm
 * (github.com/dgreenheck/tidewater, world/vegetation/PlantGeometry.js +
 * GeoBuilder.js + the frond/bark shading in VegMaterials.js).
 *
 *   Copyright (c) 2026 DRG Software Solutions LLC — MIT License.
 *   Permission is hereby granted, free of charge, to any person obtaining a
 *   copy of this software and associated documentation files (the
 *   "Software"), to deal in the Software without restriction, including
 *   without limitation the rights to use, copy, modify, merge, publish,
 *   distribute, sublicense, and/or sell copies of the Software, and to permit
 *   persons to whom the Software is furnished to do so, subject to the
 *   following conditions: The above copyright notice and this permission
 *   notice shall be included in all copies or substantial portions of the
 *   Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
 *
 * What survives the port verbatim: the ringed trunk with its flared, lumpy
 * root boot; 18 fronds in 2/5 phyllotaxis that arch and droop with age; the
 * two hanging dead fronds; the coconut cluster; and the leaflets, which are
 * NOT geometry — each frond is a two-wing ribbon and ~95 leaflets a side
 * are cut out of it in the fragment shader, split and torn at random.
 *
 * What changed for a headset: Tidewater bends every trunk per frame in the
 * vertex shader (lean, banana curve, wind sway, LOD cross-fades). Here the
 * trunk's lean and curve are baked into the vertices once per palm, all the
 * near palms merge into ONE draw, the far ones are ONE instanced draw of the
 * low-detail crown, and only a leaflet flutter stays live.
 */

import {
  BufferGeometry,
  Color,
  DoubleSide,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshDepthMaterial,
  MeshLambertMaterial,
  Quaternion,
  RGBADepthPacking,
  Uint32BufferAttribute,
  Vector3,
  type Material,
} from 'three';
import { makeRng } from '../desert/paper.js';
import { outdoor } from './outdoor.js';

// ---------------------------------------------------------------- GeoBuilder

const PART = { STEM: 0, FROND: 1, COCONUT: 5 };

/** Accumulates vertices in Tidewater's plant layout: position, normal,
 *  uv (s, t), aVeg (u, s, flutter, phase), aMat (part, age, leaflet length, seed). */
class GeoBuilder {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  veg: number[] = [];
  mat: number[] = [];
  idx: number[] = [];
  get count(): number {
    return this.pos.length / 3;
  }
  vertex(p: Vector3, n: Vector3, u: number, v: number, veg: number[], mat: number[]): number {
    this.pos.push(p.x, p.y, p.z);
    this.nor.push(n.x, n.y, n.z);
    this.uv.push(u, v);
    this.veg.push(veg[0], veg[1], veg[2], veg[3]);
    this.mat.push(mat[0], mat[1], mat[2], mat[3]);
    return this.count - 1;
  }
  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }
  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }
}

const _up = new Vector3(0, 1, 0);
const _v0 = new Vector3();
const _v1 = new Vector3();
const _v2 = new Vector3();
const _v3 = new Vector3();

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

interface StemOpts {
  radial: number;
  rows: number[];
  radius: (u: number) => number;
  Hgeo: number;
  mat?: number[];
  cap?: boolean;
  lumps?: ((u: number, a: number) => number) | null;
}

/** Stem / trunk: a tube whose vertices carry the height fraction u (aVeg.x). */
function addStem(b: GeoBuilder, { radial, rows, radius, Hgeo, mat = [0, 0, 0, 0], cap = true, lumps = null }: StemOpts): void {
  const start = b.count;
  for (let j = 0; j < rows.length; j++) {
    const u = rows[j];
    const r = radius(u);
    const du = 0.01;
    const dr = (radius(u + du) - radius(u - du)) / (2 * du * Hgeo);
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const rl = lumps ? r * (1 + lumps(u, a)) : r;
      _v0.set(c * rl, u * Hgeo, s * rl);
      _v1.set(c, -dr, s).normalize();
      b.vertex(_v0, _v1, i / radial, u, [u, 0, 0, 0], mat);
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < radial; i++) {
      const a = start + j * (radial + 1) + i;
      const c = a + radial + 1;
      b.quad(a, c, c + 1, a + 1);
    }
  }
  if (cap) {
    const uTop = rows[rows.length - 1];
    const top = b.vertex(_v0.set(0, uTop * Hgeo, 0), _up, 0.5, uTop, [uTop + 0.015, 0, 0, 0], mat);
    const ring = start + (rows.length - 1) * (radial + 1);
    for (let i = 0; i < radial; i++) b.tri(ring + i, top, ring + i + 1);
  }
}

interface FrondOpts {
  origin: Vector3;
  azimuth: number;
  elevation: number;
  bend: number;
  twist?: number;
  length: number;
  segs?: number;
  cross?: number;
  leafLen: (s: number) => number;
  leafAngle: (s: number) => number;
  droop: (s: number) => number;
  curl?: number;
  part?: number;
  age?: number;
  seed?: number;
  phase?: number;
  flutter?: number;
  minWidth?: number;
  bendPow?: number;
  roll?: number;
}

/** Pinnate frond: two wings (leaflet rows) hanging off a curved rachis. */
function addFrond(b: GeoBuilder, o: FrondOpts): void {
  const {
    origin, azimuth, elevation, bend, twist = 0, length,
    segs = 8, cross = 2,
    leafLen, leafAngle, droop, curl = 0.2,
    part = PART.FROND, age = 0, seed = 0, phase = 0, flutter = 1, minWidth = 0.035,
    bendPow = 1.4, roll = 0,
  } = o;

  // rachis centre line
  const pts: Vector3[] = [];
  const p = origin.clone();
  for (let k = 0; k <= segs; k++) {
    pts.push(p.clone());
    const sm = (k + 0.5) / segs;
    const el = elevation - bend * Math.pow(sm, bendPow);
    const az = azimuth + twist * sm;
    _v0.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    p.addScaledVector(_v0, length / segs);
  }

  const azPerp = new Vector3(-Math.sin(azimuth), 0, Math.cos(azimuth));
  const T = new Vector3();
  const S = new Vector3();
  const Nup = new Vector3();
  const side = new Vector3();
  const ld = new Vector3();

  for (const sigma of [-1, 1]) {
    const grid: { q: Vector3; s: number; t: number; Ll: number; nup: Vector3 }[][] = [];
    for (let k = 0; k <= segs; k++) {
      const s = k / segs;
      T.subVectors(pts[Math.min(segs, k + 1)], pts[Math.max(0, k - 1)]).normalize();
      S.crossVectors(T, _up);
      if (S.lengthSq() < 0.04) S.copy(azPerp);
      S.normalize();
      Nup.crossVectors(S, T).normalize();
      const Ll = Math.max(leafLen(s), minWidth);
      const al = leafAngle(s);
      // the frond rolls about its rachis toward the tip: one wing hangs lower
      const be = droop(s) + sigma * roll * s * s;
      side.copy(S).multiplyScalar(sigma * Math.cos(be)).addScaledVector(Nup, -Math.sin(be));
      ld.copy(T).multiplyScalar(Math.cos(al)).addScaledVector(side, Math.sin(al)).normalize();
      const row = [];
      for (let j = 0; j <= cross; j++) {
        const t = j / cross;
        const q = pts[k].clone().addScaledVector(ld, Ll * t).addScaledVector(Nup, -Ll * curl * t * t);
        row.push({ q, s, t, Ll, nup: Nup.clone() });
      }
      grid.push(row);
    }

    // normals from the grid, oriented to the frond's upper side
    const idx: number[][] = [];
    for (let k = 0; k <= segs; k++) {
      const r: number[] = [];
      for (let j = 0; j <= cross; j++) {
        const g = grid[k][j];
        const ka = Math.max(0, k - 1);
        const kb = Math.min(segs, k + 1);
        const ja = Math.max(0, j - 1);
        const jb = Math.min(cross, j + 1);
        _v1.subVectors(grid[kb][j].q, grid[ka][j].q);
        _v2.subVectors(grid[k][jb].q, grid[k][ja].q);
        _v3.crossVectors(_v1, _v2);
        if (_v3.lengthSq() < 1e-12) _v3.copy(g.nup);
        _v3.normalize();
        if (_v3.dot(g.nup) < 0) _v3.negate();
        const fl = g.t * smooth(0.05, 0.3, g.s) * flutter;
        r.push(b.vertex(g.q, _v3, g.s, g.t, [1, g.s, fl, phase], [part, age, g.Ll, seed]));
      }
      idx.push(r);
    }
    for (let k = 0; k < segs; k++) {
      for (let j = 0; j < cross; j++) {
        const a = idx[k][j];
        const bb = idx[k + 1][j];
        const c = idx[k + 1][j + 1];
        const d = idx[k][j + 1];
        if (sigma > 0) b.quad(a, d, c, bb);
        else b.quad(a, bb, c, d);
      }
    }
  }
}

function addIcosphere(b: GeoBuilder, center: Vector3, radii: Vector3, mat: number[], veg: number[]): void {
  const g = new IcosahedronGeometry(1, 0);
  const p = g.attributes.position;
  const map = new Map<string, number>();
  const idx: number[] = [];
  for (let i = 0; i < p.count; i++) {
    _v0.fromBufferAttribute(p, i);
    const key = `${_v0.x.toFixed(3)},${_v0.y.toFixed(3)},${_v0.z.toFixed(3)}`;
    let v = map.get(key);
    if (v === undefined) {
      _v1.copy(_v0).multiply(radii).add(center);
      _v2.copy(_v0).divide(radii).normalize();
      v = b.vertex(_v1, _v2, 0.5, 0.5, veg, mat);
      map.set(key, v);
    }
    idx.push(v);
  }
  for (let i = 0; i < idx.length; i += 3) b.tri(idx[i], idx[i + 1], idx[i + 2]);
  g.dispose();
}

// ------------------------------------------------------------- coconut palm

const PALM_H = 10; // geometry trunk height (rescaled per palm)

const palmRadius = (u: number): number => {
  const y = u * PALM_H;
  let r = 0.155 + 0.045 * (1 - u) + 0.19 * Math.exp(-Math.max(y, 0) / 0.42);
  r *= 1 + 0.05 * Math.sin(y * 1.7) * (1 - u); // slight irregularity
  r += 0.07 * smooth(0.955, 0.99, u) - 0.1 * smooth(0.995, 1.02, u); // leaf-base boot
  return r;
};

// buttress roots: lumps around the flared base, fading out within ~0.6 m
const palmRootLumps = (u: number, a: number): number => {
  const y = Math.max(u * PALM_H, 0);
  const k = Math.exp(-y / 0.3);
  return k * (0.16 * Math.max(0, Math.sin(a * 5 + 0.7)) + 0.08 * Math.sin(a * 11 + 2.1));
};

interface FrondParams {
  a: number;
  dead: boolean;
  azimuth: number;
  elevation: number;
  bend: number;
  bendPow: number;
  twist: number;
  roll: number;
  length: number;
  attachY: number;
  seed: number;
  phase: number;
}

function palmFrondParams(rand: () => number, count: number): FrondParams[] {
  // 25–35 fronds 4.5–6 m long in a 2/5 spiral: young ones stand up, mature
  // ones arch out and droop toward the tip, the oldest hang down the trunk.
  const list: FrondParams[] = [];
  for (let i = 0; i < count; i++) {
    const a = count > 1 ? i / (count - 1) : 0.5; // 0 youngest .. 1 oldest
    const hanging = count > 10 && i >= count - 2;
    const len = (3.8 + 1.5 * smooth(0, 0.45, a)) * (0.88 + 0.24 * rand());
    list.push({
      a,
      dead: hanging,
      azimuth: i * 2.39996 + (rand() - 0.5) * 0.4,
      elevation: hanging ? -1.05 - (i - (count - 2)) * 0.25 : 1.0 - 1.25 * Math.pow(a, 0.8) + (rand() - 0.5) * 0.3,
      bend: hanging ? 0.35 : 0.55 + 1.15 * a + rand() * 0.4,
      bendPow: hanging ? 1.2 : 1.9 + rand() * 0.5,
      twist: (rand() - 0.5) * 0.45,
      roll: (rand() - 0.5) * (hanging ? 0.4 : 0.9),
      length: hanging ? len * 0.9 : len,
      attachY: 0.32 - 0.5 * a,
      seed: rand(),
      phase: rand(),
    });
  }
  return list;
}

function addPalmCrown(b: GeoBuilder, fronds: FrondParams[], segs: number, cross: number, leafScale = 1): void {
  for (const f of fronds) {
    const origin = new Vector3(Math.cos(f.azimuth) * 0.14, f.attachY, Math.sin(f.azimuth) * 0.14);
    const Lf = f.length;
    addFrond(b, {
      origin,
      azimuth: f.azimuth,
      elevation: f.elevation,
      bend: f.bend,
      bendPow: f.bendPow,
      twist: f.twist,
      roll: f.roll,
      length: Lf,
      segs,
      cross,
      // leaflets start after the bare petiole, longest a third of the way out
      leafLen: (s) => leafScale * 0.23 * Lf * (smooth(0.14, 0.3, s) * (1 - 0.68 * smooth(0.35, 1.0, s))),
      leafAngle: (s) => 1.1 - 0.5 * s,
      // the two rows hang from the rachis in a V, steeper toward the tip
      droop: (s) => (f.dead ? 1.3 : 0.88 + 0.35 * f.a) + 0.45 * s,
      curl: f.dead ? 0.15 : 0.45,
      part: PART.FROND,
      age: f.dead ? 1 : f.a * 0.55,
      seed: f.seed,
      phase: f.phase,
      flutter: f.dead ? 0.3 : 1,
      minWidth: 0.045,
    });
  }
}

/** Full-detail palm, in its own frame: trunk along +y to PALM_H, crown
 *  vertices relative to the crown centre (aMat.x ≥ 1). */
function buildPalmNear(seed: number): GeoBuilder {
  const rand = makeRng(seed);
  const b = new GeoBuilder();
  const rows = [-0.03, 0, 0.015, 0.04, 0.08, 0.14, 0.22, 0.32, 0.43, 0.54, 0.65, 0.76, 0.86, 0.94, 0.975, 0.992, 1.005];
  addStem(b, { radial: 10, rows, radius: palmRadius, Hgeo: PALM_H, lumps: palmRootLumps });
  for (let i = 0; i < 6; i++) {
    const az = i * 2.39996 + rand() * 0.5;
    const rr = 0.2 + rand() * 0.1;
    const c = new Vector3(Math.cos(az) * rr, -0.3 - rand() * 0.35, Math.sin(az) * rr);
    const s = 0.12 + rand() * 0.035;
    addIcosphere(b, c, new Vector3(s, s * 1.12, s), [PART.COCONUT, rand(), 0, i / 6], [1, 0, 0, 0]);
  }
  addPalmCrown(b, palmFrondParams(rand, 18), 8, 2);
  return b;
}

/** Low-detail palm (stem + 14-frond crown), for the hills. */
function buildPalmFar(seed: number): GeoBuilder {
  const rand = makeRng(seed);
  const b = new GeoBuilder();
  addStem(b, { radial: 5, rows: [-0.03, 0.03, 0.2, 0.6, 1.0], radius: palmRadius, Hgeo: PALM_H, cap: false });
  const fronds = palmFrondParams(rand, 18).filter((_f, i) => i !== 1 && i !== 5 && i !== 9 && i !== 13);
  addPalmCrown(b, fronds, 3, 1, 1.15);
  return b;
}

// ------------------------------------------------------------ placement

export interface PalmSpot {
  x: number;
  y: number;
  z: number;
  /** Trunk height (m). */
  H: number;
  /** Lean direction (radians about +y, 0 = +x) and amount (fraction of H). */
  leanAz: number;
  lean: number;
  /** 0..1 — how much of the lean is a "banana" curve (vertical at the top). */
  curve: number;
  yaw: number;
  seed: number;
}

const _q = new Quaternion();
const _lean = new Vector3();
const _T = new Vector3();

/** Rotate v so +y maps onto T (Tidewater's vegRotUpTo). */
function rotUpTo(v: Vector3, T: Vector3): Vector3 {
  _q.setFromUnitVectors(_up, T);
  return v.applyQuaternion(_q);
}

/** Bake one palm into world space: Tidewater's plant deform (lean, banana
 *  curve, crown tilted half as much as the stem tip), done once on the CPU. */
function bakePalm(src: GeoBuilder, spot: PalmSpot, out: MergedPalms, geoH: number): void {
  const base = new Vector3(spot.x, spot.y, spot.z);
  const leanDir = new Vector3(Math.cos(spot.leanAz), 0, Math.sin(spot.leanAz));
  const c = spot.curve;
  const H = spot.H;
  const cy = Math.cos(spot.yaw);
  const sy = Math.sin(spot.yaw);
  // crown: follows the stem top, tilted half as much as the stem tip
  const Ttop = new Vector3().copy(_up).addScaledVector(leanDir, spot.lean * (1 - c)).normalize();
  const Ttilt = new Vector3().copy(_up).add(Ttop).normalize();
  const C = base.clone().add(new Vector3(0, H, 0)).addScaledVector(leanDir, spot.lean * H);
  const scale = H / geoH;
  const crownScale = Math.min(1.15, Math.max(0.8, Math.sqrt(scale)));
  const first = out.pos.length / 3;
  const P = new Vector3();
  const N = new Vector3();
  for (let i = 0; i < src.count; i++) {
    const part = src.mat[i * 4];
    // yaw the palm's own frame so no two crowns are alike
    const lx = src.pos[i * 3];
    const lz = src.pos[i * 3 + 2];
    P.set(lx * cy - lz * sy, src.pos[i * 3 + 1], lx * sy + lz * cy);
    const nx = src.nor[i * 3];
    const nz = src.nor[i * 3 + 2];
    N.set(nx * cy - nz * sy, src.nor[i * 3 + 1], nx * sy + nz * cy);
    if (part < 0.5) {
      const u = src.veg[i * 4];
      const fc = c > 0 ? u * (1 - u) * c + u : u; // mix(u, u·((1−u)+1), c)
      const df = 1 + c * (1 - 2 * u) ; // mix(1, (1−u)·2, c)
      _lean.copy(leanDir).multiplyScalar(spot.lean * fc * H);
      _T.copy(_up).addScaledVector(leanDir, spot.lean * df).normalize();
      const radial = new Vector3(P.x, 0, P.z);
      rotUpTo(radial, _T);
      P.set(base.x, base.y + u * H, base.z).add(_lean).add(radial);
      rotUpTo(N, _T);
    } else {
      P.multiplyScalar(crownScale);
      rotUpTo(P, Ttilt).add(C);
      rotUpTo(N, Ttilt);
    }
    out.pos.push(P.x, P.y, P.z);
    out.nor.push(N.x, N.y, N.z);
  }
  for (let i = 0; i < src.count; i++) {
    out.uv.push(src.uv[i * 2], src.uv[i * 2 + 1]);
    out.veg.push(src.veg[i * 4], src.veg[i * 4 + 1], src.veg[i * 4 + 2], src.veg[i * 4 + 3]);
    out.mat.push(src.mat[i * 4], src.mat[i * 4 + 1], src.mat[i * 4 + 2], src.mat[i * 4 + 3]);
    out.tree.push(spot.seed, H);
  }
  for (const k of src.idx) out.idx.push(first + k);
}

interface MergedPalms {
  pos: number[];
  nor: number[];
  uv: number[];
  veg: number[];
  mat: number[];
  tree: number[];
  idx: number[];
}

function toGeometry(m: { pos: number[]; nor: number[]; uv: number[]; veg: number[]; mat: number[]; idx: number[] }, tree?: number[]): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(m.pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(m.nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(m.uv, 2));
  g.setAttribute('aVeg', new Float32BufferAttribute(m.veg, 4));
  g.setAttribute('aMat', new Float32BufferAttribute(m.mat, 4));
  if (tree) g.setAttribute('aTree', new Float32BufferAttribute(tree, 2));
  g.setIndex(new Uint32BufferAttribute(m.idx, 1));
  g.computeBoundingSphere();
  return g;
}

// --------------------------------------------------------------- material

/** Linear colour of an sRGB hex, as GLSL (Tidewater's C()). */
function C(hex: number): string {
  const c = new Color(hex); // three converts sRGB hex → linear working space
  return `vec3(${c.r.toFixed(5)}, ${c.g.toFixed(5)}, ${c.b.toFixed(5)})`;
}

const PALM_PARS = /* glsl */ `
float palmHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float palmNoise(vec2 p) {
  vec2 i = floor(p), fr = fract(p);
  vec2 u = fr * fr * (3.0 - 2.0 * fr);
  return mix(mix(palmHash12(i), palmHash12(i + vec2(1.0, 0.0)), u.x),
             mix(palmHash12(i + vec2(0.0, 1.0)), palmHash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Tidewater's leaflet cut: ~95 narrow leaflets a side, bunched, split and torn.
bool palmMask(vec2 st, vec4 aMat, float seed) {
  float s = st.x, t = st.y;
  float fwS = fwidth(s);
  float part = aMat.x, age = aMat.y, Ll = aMat.z, fseed = aMat.w;
  if (part < 0.5 || part > 1.5) return true;
  float N = 95.0;
  float x = s * N + (palmNoise(vec2(s * 7.0, fseed * 23.0 + seed * 3.0)) - 0.5) * 2.2;
  float k = floor(x);
  float r1 = palmHash12(vec2(k, fseed * 91.7));
  float r2 = palmHash12(vec2(k * 1.37 + 3.1, fseed * 17.3 + seed * 5.0));
  float fx = fract(x) - 0.5 - (r1 - 0.5) * 0.35;
  float tEnd = mix(0.72, 1.0, r2) * (r1 < 0.06 ? 0.45 : 1.0);
  float tt = t / tEnd;
  float hw = pow(max(1.0 - tt, 0.0), 0.6) * 0.22 * (smoothstep(0.0, 0.1, tt) * 0.4 + 0.6);
  bool split = r2 > 0.9 && tt > mix(0.35, 0.7, r1) && abs(fx) < hw * 0.3;
  bool torn = palmNoise(vec2(k * 0.21 + seed * 17.0, fseed * 37.0)) > 0.83 - age * 0.2 && s > 0.3;
  // sub-pixel leaflets widen instead of aliasing (fronds turn solid far off)
  float hwE = max(hw, min(fwS * (N * 0.6), 0.5) * (tt < 1.0 ? 1.0 : 0.0));
  bool leaf = abs(fx) < hwE && tt < 1.0 && s > 0.06 && !split && !torn;
  bool rachis = t * Ll < 0.026;
  return leaf || rachis;
}
vec3 palmAlbedo(vec2 st, vec4 aMat, float seed, float H) {
  float s = st.x, t = st.y;
  float part = aMat.x, age = aMat.y, Ll = aMat.z, fseed = aMat.w;
  float iv = palmHash12(vec2(seed * 37.1, 1.7));
  if (part < 0.5) {
    // the trunk: ringed leaf scars on grey-brown bark weathering to silver
    float y = t * H;
    float a = s;
    float yn = t;
    float phase = y * mix(8.5, 11.0, iv) + pow(yn, 2.2) * H * 5.5 + palmNoise(vec2(y * 0.8, seed * 7.3)) * 3.2;
    float fr = fract(phase + (palmNoise(vec2(a * 38.0, floor(phase) * 2.3 + seed * 5.0)) - 0.5) * 0.22);
    float groove = smoothstep(0.1, 0.0, fr) + smoothstep(0.94, 1.0, fr);
    float blotch = palmNoise(vec2(a * 6.0, y * 0.4 + seed * 13.0));
    float plate = palmNoise(vec2(a * 24.0, y * 3.5 + seed * 17.0));
    vec3 bark = mix(${C(0x5e554a)}, ${C(0xa49a88)}, clamp(blotch * 0.55 + plate * 0.25 + (iv - 0.5) * 0.5 + yn * 0.15, 0.0, 1.0));
    float mott = palmNoise(vec2(a * 90.0, y * 80.0 + seed * 7.0)) * 0.6 + palmNoise(vec2(a * 35.0, y * 30.0 + seed * 3.0)) * 0.4;
    bark *= (mott * 0.45 + 0.78) * (plate * 0.25 + 0.88);
    bark *= mix(1.0, 0.68, groove);
    return bark;
  }
  if (part < 1.5) {
    float fr = palmHash12(vec2(fseed * 51.3, seed * 17.9));
    float a = clamp(age / 0.55, 0.0, 1.0);
    vec3 g = mix(${C(0x728c33)}, ${C(0x445f27)}, smoothstep(0.0, 0.35, a));
    g = mix(g, ${C(0x69702f)}, smoothstep(0.55, 1.0, a));
    g = mix(g, g * vec3(1.12, 1.02, 0.78), iv * 0.8);
    g = mix(g, g * vec3(0.86, 0.98, 1.08), (1.0 - iv) * 0.5);
    g *= mix(0.82, 1.1, fr);
    float kL = floor(s * 95.0);
    float perLeaf = palmHash12(vec2(kL, fseed * 13.1));
    vec3 c = g * mix(1.08, 0.86, smoothstep(0.2, 1.0, t)) * (perLeaf * 0.22 + 0.9);
    float tipK = smoothstep(0.72, 0.97, t) * step(0.55 - a * 0.35, palmHash12(vec2(kL * 1.7, fseed * 5.3 + seed)));
    c = mix(c, mix(${C(0x8c7a4a)}, ${C(0x6e5b39)}, perLeaf), tipK * 0.85);
    float hangK = smoothstep(0.8, 0.95, age);
    float state = palmHash12(vec2(fseed * 7.1, seed * 29.3));
    vec3 yellowing = mix(${C(0x8f8a3c)}, ${C(0xa08a45)}, perLeaf);
    vec3 deadC = mix(${C(0x7a6440)}, ${C(0x5c4a30)}, perLeaf);
    vec3 hangC = state > 0.62 ? deadC : (state > 0.35 ? yellowing : c * 0.9);
    c = mix(c, hangC, hangK);
    bool rachis = t * Ll < 0.026;
    vec3 rib = mix(mix(${C(0xb3a660)}, ${C(0x98894e)}, a), ${C(0x6f5a3a)}, hangK * step(0.62, state));
    return rachis ? rib : c;
  }
  // coconuts: green → yellow → brown
  return mix(mix(${C(0x68762a)}, ${C(0x9c8a34)}, smoothstep(0.3, 0.7, age)), ${C(0x5c4122)}, smoothstep(0.82, 0.95, age));
}
`;

/** The per-palm seed and trunk height: a vertex attribute on the merged
 *  near palms, derived from the instance matrix on the instanced far ones. */
const TREE_VERTEX = /* glsl */ `
#ifdef USE_INSTANCING
  vTree = vec2(fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453),
               ${PALM_H.toFixed(1)} * length(instanceMatrix[1].xyz));
#else
  vTree = aTree;
#endif
  vST = uv;
  vMat = aMat;
`;

function patchVertex(shader: { vertexShader: string; uniforms: Record<string, { value: unknown }> }, flutter: boolean): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
attribute vec4 aVeg;
attribute vec4 aMat;
#ifndef USE_INSTANCING
attribute vec2 aTree;
#endif
uniform float uTime;
varying vec2 vST;
varying vec4 vMat;
varying vec2 vTree;`,
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
${TREE_VERTEX}
${
  flutter
    ? `  // leaflet flutter + a slow bounce of the frond tips (Tidewater's, with a steady trade wind)
  float ph = aVeg.w;
  float fl = aVeg.z * (sin(uTime * (ph * 5.0 + 11.0) + ph * 60.0 + aVeg.y * 9.0) * 0.035 + 0.004);
  float bounce = sin(uTime * (ph + 1.4) + ph * 41.0 + vTree.x * 6.0) * aVeg.y * aVeg.y * 0.06;
  transformed += objectNormal * fl + vec3(0.0, bounce, 0.0) * step(0.5, aMat.x);`
    : ''
}`,
    );
  shader.uniforms.uTime = palmTime;
}

const palmTime = { value: 0 };

/** Lambert palms: Tidewater's leaflet cut + albedo, three's lights and
 *  shadows, and the backlit-leaf glow (translucency) for when you turn to
 *  face the sun through the crowns. */
function makePalmMaterial(sunDir: Vector3, sunColor: Color): MeshLambertMaterial {
  const mat = new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide });
  mat.onBeforeCompile = (shader) => {
    patchVertex(shader, true);
    shader.uniforms.sunDirW = { value: sunDir };
    shader.uniforms.sunCol = { value: sunColor };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 sunDirW;
uniform vec3 sunCol;
varying vec2 vST;
varying vec4 vMat;
varying vec2 vTree;
${PALM_PARS}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
  if (!palmMask(vST, vMat, vTree.x)) discard;
  diffuseColor.rgb = palmAlbedo(vST, vMat, vTree.x, vTree.y);`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// leaf translucency: sun through the frond when it's lit from behind
  if (vMat.x > 0.5 && vMat.x < 1.5) {
    vec3 Lv = normalize((viewMatrix * vec4(sunDirW, 0.0)).xyz);
    vec3 Vv = normalize(vViewPosition);
    float back = clamp(dot(-normal, Lv), 0.0, 1.0);
    float fwd = pow(clamp(dot(-Vv, Lv), 0.0, 1.0), 3.0) * 0.7 + 0.3;
    outgoingLight += diffuseColor.rgb * vec3(1.25, 1.45, 0.55) * sunCol * back * fwd * 0.22;
  }
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'cove-palm';
  return outdoor(mat);
}

/** Shadow caster with the same leaflet cut, so the sand gets frond shadows
 *  with daylight between the leaflets rather than solid paddles. */
function makePalmDepth(): MeshDepthMaterial {
  const mat = new MeshDepthMaterial({ depthPacking: RGBADepthPacking, side: DoubleSide });
  mat.onBeforeCompile = (shader) => {
    patchVertex(shader, false);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vST;
varying vec4 vMat;
varying vec2 vTree;
${PALM_PARS}`,
      )
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (!palmMask(vST, vMat, vTree.x)) discard;`);
  };
  mat.customProgramCacheKey = () => 'cove-palm-depth';
  return mat;
}

export interface Palms {
  near: Mesh;
  far: InstancedMesh;
  update(time: number): void;
  materials: Material[];
}

/**
 * Build the palms. `near` spots get the full-detail palm (baked, merged,
 * shadow-casting); `far` spots the low-detail crown, instanced.
 */
export function buildPalms(nearSpots: PalmSpot[], farSpots: PalmSpot[], sunDir: Vector3, sunColor: Color): Palms {
  const variants = [11, 23, 37, 53].map((s) => buildPalmNear(s));
  const merged: MergedPalms = { pos: [], nor: [], uv: [], veg: [], mat: [], tree: [], idx: [] };
  nearSpots.forEach((spot, i) => bakePalm(variants[i % variants.length], spot, merged, PALM_H));
  const nearGeo = toGeometry(merged, merged.tree);
  const mat = makePalmMaterial(sunDir, sunColor);
  const near = new Mesh(nearGeo, mat);
  near.name = 'cove-palms';
  near.castShadow = true;
  near.receiveShadow = true;
  near.customDepthMaterial = makePalmDepth();

  const farSrc = buildPalmFar(71);
  // crown vertices are crown-relative: lift them to the top of the trunk
  for (let i = 0; i < farSrc.count; i++) if (farSrc.mat[i * 4] > 0.5) farSrc.pos[i * 3 + 1] += PALM_H;
  const farGeo = toGeometry(farSrc);
  const far = new InstancedMesh(farGeo, mat, farSpots.length);
  far.name = 'cove-palms-far';
  const m = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const axis = new Vector3();
  farSpots.forEach((spot, i) => {
    axis.set(Math.sin(spot.leanAz), 0, -Math.cos(spot.leanAz)); // tilt toward leanAz
    q.setFromAxisAngle(axis, spot.lean * 0.9).multiply(new Quaternion().setFromAxisAngle(_up, spot.yaw));
    const k = spot.H / PALM_H;
    s.set(k, k, k);
    p.set(spot.x, spot.y, spot.z);
    m.compose(p, q, s);
    far.setMatrixAt(i, m);
  });
  far.instanceMatrix.needsUpdate = true;
  far.computeBoundingSphere();

  return {
    near,
    far,
    materials: [mat, near.customDepthMaterial],
    update(time) {
      palmTime.value = time;
    },
  };
}
