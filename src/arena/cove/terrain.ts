/**
 * THE COVE's land: foreshore, berm, dunes, the jungle hills behind and the
 * two headlands — one mesh, one Lambert draw.
 *
 * The grid is laid out in COAST coordinates: columns run along x, rows by
 * distance from the waterline (shape.ts coastDist), so rows are dense right
 * where the swash runs up the sand — wherever the curving shore happens to
 * be — and thin out over the hills and the deep seabed. Triangles that lie
 * wholly under deep water are dropped: the sea is opaque and shades its
 * own seabed (water.ts), so they could never be seen.
 *
 * The sand is Tidewater's (world/Terrain.js): its dry / damp coral-sand
 * palette, wind ripples across the trade wind (~10.5 cm, faded before they
 * alias), a darker wet band where the swash reaches, grain.
 */

import {
  BufferGeometry,
  Color,
  SRGBColorSpace,
  Float32BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  Uint32BufferAttribute,
} from 'three';
import { makeRng, valueNoise2D } from '../desert/paper.js';
import { outdoor } from './outdoor.js';
import { baseGroundY, CLEARING, coastDist, RUNUP, SEA_Y, shoreZ } from './shape.js';

const sat = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

const n1 = valueNoise2D(makeRng(0xc0e1), 64);
const n2 = valueNoise2D(makeRng(0xc0e2), 64);
const n3 = valueNoise2D(makeRng(0xc0e3), 64);
const fbm = (x: number, z: number, s: number): number =>
  n1(x / s, z / s) * 0.55 + n2((x / s) * 2.1 + 5.3, (z / s) * 2.1 - 1.7) * 0.3 + n3((x / s) * 4.7 - 2.2, (z / s) * 4.7 + 9.1) * 0.15;

/** How far inside the arena clearing (1 = the levelled floor, 0 = outside). */
export function clearingWeight(x: number, z: number): number {
  const dx = (x - CLEARING.x) / CLEARING.rx;
  const dz = (z - CLEARING.z) / CLEARING.rz;
  return 1 - smooth(0.85, 1.35, Math.sqrt(dx * dx + dz * dz));
}

/** Volcanic plugs on the ridge behind the bay (Tidewater's island has them
 *  on its summit massif): [x, z, radius, height]. */
const PLUGS: [number, number, number, number][] = [
  [-80, 380, 85, 95],
  [150, 350, 60, 70],
  [-250, 300, 55, 50],
  [40, 470, 70, 60],
];

/** Sharp-crested ridges: folded noise, squared, so crests are knife edges
 *  and the valleys between them broad. */
function ridged(x: number, z: number): number {
  const a = 1 - Math.abs(2 * fbm(x, z, 70) - 1);
  const b = 1 - Math.abs(2 * fbm(x + 91, z - 37, 29) - 1);
  return a * a * 0.7 + b * b * 0.3;
}

/** The hills' own relief above the beach profile (0 on the beach). */
function hillY(x: number, z: number, e: number): number {
  if (e <= 60) return 0;
  const k = smooth(60, 170, e);
  let h = k * ((e - 60) * (0.1 + 0.18 * fbm(x * 0.6, z * 0.6 + 40, 90)) + ridged(x, z) * 30 + (fbm(x, z, 35) - 0.5) * 10);
  for (const [px, pz, R, H] of PLUGS) {
    const t = 1 - Math.hypot(x - px, z - pz) / R;
    if (t > 0) h += H * Math.pow(t, 1.5) * (0.75 + 0.5 * fbm(x, z, 9));
  }
  return h;
}

/** How bare the hill is here (0 forest .. 1 rock): steep slopes, ridge
 *  crests and the plugs shed their soil. */
export function hillRock(x: number, z: number): number {
  const e = -coastDist(x, z);
  if (e <= 70) return 0;
  const d = 2.5;
  const sx = hillY(x + d, z, e) - hillY(x - d, z, e);
  const sz = hillY(x, z + d, e) - hillY(x, z - d, e);
  const slope = Math.hypot(sx, sz) / (2 * d);
  let plug = 0;
  for (const [px, pz, R] of PLUGS) plug = Math.max(plug, 1 - smooth(0.2, 0.55, Math.hypot(x - px, z - pz) / R));
  const crest = smooth(0.86, 0.97, ridged(x, z));
  return sat(Math.max(smooth(0.8, 1.3, slope), crest * 0.8, plug) * smooth(70, 110, e));
}

/** Where the forest stands (0..1): up the hills behind the dunes, and over
 *  the headlands once they clear the cliffs — but not on bare rock. */
function jungleWeight(x: number, z: number, e: number, above: number): number {
  const hills = smooth(78, 108, e + (fbm(x, z, 17) - 0.5) * 34) * (1 - hillRock(x, z));
  const heads = Math.abs(x) > 120 ? smooth(5, 12, above) : 0;
  return Math.max(hills, heads);
}
/** Crown lumps (m): clumps of 8–15 m trees, emergents poking above. */
function canopyLumps(x: number, z: number): number {
  const a = fbm(x, z, 9);
  const b = n2(x / 4.3 + 11, z / 4.3 - 7);
  return 7 + (a - 0.5) * 9 + b * 3.5 + Math.max(0, n3(x / 21, z / 21) - 0.62) * 22;
}

/**
 * The real ground height: the analytic bay (what the water believes) plus
 * everything no wave ever reaches — dunes, the jungle hills, rugged
 * headlands, and the levelled clearing the pedestals stand on.
 */
export function groundY(x: number, z: number): number {
  let y = baseGroundY(x, z);
  const e = -coastDist(x, z); // inland distance
  const above = y - SEA_Y;
  // dunes behind the berm
  if (e > 38) y += (fbm(x, z, 22) - 0.45) * 1.4 * smooth(38, 60, e) * (1 - smooth(110, 170, e));
  // the hills: ridges and volcanic plugs climbing behind the bay
  y += hillY(x, z, e);
  // the jungle canopy: where the forest grows, the surface IS the crowns
  const jk = jungleWeight(x, z, e, y - SEA_Y);
  if (jk > 0) y += jk * canopyLumps(x, z);
  // rugged headland slopes (never in the bay's swash)
  if (above > 1.5 && Math.abs(x) > 120) y += (fbm(x, z, 14) - 0.5) * 6 * smooth(1.5, 8, above);
  // the arena floor: level, a pedestal's thickness below the deck line
  const w = clearingWeight(x, z);
  if (w > 0) y = y + (CLEARING.y - y) * w;
  return y;
}

/** Row distances from the waterline (m): dense through the swash, sparse beyond. */
function rowOffsets(): number[] {
  const rows: number[] = [];
  let e = -300;
  // deep water → the surf zone, geometric
  const sea: number[] = [];
  let step = 0.5;
  for (let v = -6; v > -300; v -= step, step *= 1.07) sea.push(v);
  rows.push(...sea.reverse());
  for (e = -6; e < 14; e += 0.5) rows.push(e);
  for (e = 14; e < 45; e += 1) rows.push(e);
  step = 1;
  for (e = 45; e < 1000; e += step, step *= 1.05) rows.push(e);
  return rows;
}

/** Column x positions: 1 m across the arena and bay mouth, widening out. */
function columnXs(): number[] {
  const right: number[] = [];
  let x = 0;
  let step = 1;
  while (x < 1000) {
    right.push(x);
    x += step;
    if (x > 40) step *= 1.045;
  }
  const left = right.slice(1).map((v) => -v).reverse();
  return [...left, ...right];
}

/** Sand palette (Tidewater's, sRGB → linear by Color). */
const SAND_DRY = new Color().setRGB(0.9, 0.84, 0.72, SRGBColorSpace);
const SAND_DAMP = new Color().setRGB(0.83, 0.75, 0.6, SRGBColorSpace);
const SAND_WARM = new Color().setRGB(0.84, 0.72, 0.55, SRGBColorSpace);
const DUNE_GRASS = new Color().setRGB(0.6, 0.6, 0.36, SRGBColorSpace);
const JUNGLE = new Color().setRGB(0.16, 0.25, 0.1, SRGBColorSpace);
const JUNGLE_2 = new Color().setRGB(0.27, 0.34, 0.13, SRGBColorSpace);
const ROCK = new Color().setRGB(0.5, 0.47, 0.43, SRGBColorSpace);
const ROCK_DARK = new Color().setRGB(0.3, 0.28, 0.26, SRGBColorSpace);
const BASALT = new Color().setRGB(0.2, 0.2, 0.21, SRGBColorSpace);
const BASALT_LIGHT = new Color().setRGB(0.36, 0.35, 0.34, SRGBColorSpace);

export function buildTerrain(): Mesh {
  const xs = columnXs();
  const es = rowOffsets();
  const nx = xs.length;
  const ne = es.length;
  const pos = new Float32Array(nx * ne * 3);
  const col = new Float32Array(nx * ne * 3);
  const sand = new Float32Array(nx * ne);
  const hill = new Float32Array(nx * ne * 2); // (hill weight, forced rock)
  const tmp = new Color();
  const deep = new Uint8Array(nx * ne);
  for (let i = 0; i < nx; i++) {
    const x = xs[i];
    const zc = shoreZ(x);
    const s = shoreZ(x + 0.5) - shoreZ(x - 0.5);
    const stretch = Math.sqrt(1 + s * s);
    for (let j = 0; j < ne; j++) {
      const e = es[j];
      const z = zc + e * stretch;
      const y = groundY(x, z);
      const k = j * nx + i;
      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      deep[k] = y < SEA_Y - 3.5 ? 1 : 0;
      // ---- colour: sand → dune grass → jungle; rock on cliffs & headlands
      const above = y - SEA_Y;
      const mott = fbm(x, z, 6);
      tmp.copy(SAND_DAMP).lerp(SAND_DRY, sat(smooth(0.3, 0.72, mott + smooth(0.8, 3.0, above) * 0.2)));
      tmp.lerp(SAND_WARM, smooth(0.55, 0.8, fbm(x + 17, z - 9, 11)) * 0.45);
      let sandW = 1;
      const grass = smooth(46, 70, e + (fbm(x, z, 9) - 0.5) * 22);
      if (grass > 0) {
        tmp.lerp(DUNE_GRASS, grass * 0.85);
        sandW -= grass;
      }
      const jungle = jungleWeight(x, z, e, baseGroundY(x, z) - SEA_Y);
      if (jungle > 0) {
        const lump = canopyLumps(x, z);
        const lit = sat((lump - 3) / 12);
        const leaf = JUNGLE.clone().lerp(JUNGLE_2, fbm(x + 40, z, 8)).multiplyScalar(0.55 + 0.7 * lit);
        tmp.lerp(leaf, Math.min(1, jungle * 1.4));
        sandW -= jungle;
      }
      const bare = hillRock(x, z);
      if (bare > 0) {
        const strata = 0.8 + 0.35 * n2(x / 7, y / 2.3);
        const basalt = BASALT.clone().lerp(BASALT_LIGHT, fbm(x, z, 5)).multiplyScalar(strata);
        basalt.lerp(JUNGLE, 0.35 * (1 - bare) + 0.15 * n3(x / 3, z / 3));
        tmp.lerp(basalt, bare);
        sandW -= bare;
      }
      const rocky = Math.abs(x) > 130 ? smooth(-1, 2, above) * (1 - smooth(6, 16, above)) : 0;
      if (rocky > 0) {
        tmp.lerp(ROCK.clone().lerp(ROCK_DARK, sat(1 - above / 2)), rocky * 0.9);
        sandW -= rocky;
      }
      col[k * 3] = tmp.r;
      col[k * 3 + 1] = tmp.g;
      col[k * 3 + 2] = tmp.b;
      sand[k] = sat(sandW);
      hill[k * 2] = Math.max(
        smooth(62, 96, e + (fbm(x - 13, z, 21) - 0.5) * 26),
        Math.abs(x) > 120 ? smooth(4, 9, above) : 0,
      );
      hill[k * 2 + 1] = hillRock(x, z) > 0 ? smooth(0.2, 0.9, hillRock(x, z)) : 0;
    }
  }
  // cliff faces: steep ground turns to rock whatever it was
  for (let j = 1; j < ne - 1; j++) {
    for (let i = 1; i < nx - 1; i++) {
      const k = j * nx + i;
      const dy = Math.abs(pos[(k + 1) * 3 + 1] - pos[(k - 1) * 3 + 1]) + Math.abs(pos[(k + nx) * 3 + 1] - pos[(k - nx) * 3 + 1]);
      const dh = Math.abs(pos[(k + 1) * 3] - pos[(k - 1) * 3]) + Math.abs(pos[(k + nx) * 3 + 2] - pos[(k - nx) * 3 + 2]);
      const steep = smooth(0.55, 1.0, dy / Math.max(dh, 1e-3));
      if (steep > 0) {
        tmp.setRGB(col[k * 3], col[k * 3 + 1], col[k * 3 + 2]).lerp(ROCK, steep * 0.8);
        col[k * 3] = tmp.r;
        col[k * 3 + 1] = tmp.g;
        col[k * 3 + 2] = tmp.b;
        sand[k] *= 1 - steep;
      }
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < ne - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const c = a + nx;
      const d = c + 1;
      if (deep[a] && deep[b] && deep[c] && deep[d]) continue;
      // rows run inland (+z-ish) — this winding faces up
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setAttribute('aSand', new Float32BufferAttribute(sand, 1));
  g.setAttribute('aHill', new Float32BufferAttribute(hill, 2));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();

  const mat = new MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aSand;
attribute vec2 aHill;
varying float vSand;
varying vec2 vHill;
varying vec3 vWN;
varying vec3 vWP;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vSand = aSand;
  vHill = aHill;
  vWN = normalize(mat3(modelMatrix) * objectNormal);
  vWP = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying float vSand;
varying vec2 vHill;
varying vec3 vWN;
varying vec3 vWP;
float sHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float sNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(sHash(i), sHash(i + vec2(1.0, 0.0)), u.x), mix(sHash(i + vec2(0.0, 1.0)), sHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// wind-ripple phase (crests across the trade wind, bent by a smooth warp —
// Tidewater's note: never divide the coordinate by a varying wavelength)
float ripplePhase(vec2 xz) {
  vec2 wd = normalize(vec2(0.35, -0.94));
  float warp = sNoise(xz * 0.21) * 24.0 + sNoise(xz * 0.9 + 3.1) * 5.0;
  return dot(xz, wd) * (6.2832 / 0.105) + warp;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float above = vWP.y - (${SEA_Y.toFixed(3)});
  float camD = length(cameraPosition - vWP);
  // grain and fine mottling, faded with range
  float nearK = 1.0 - smoothstep(6.0, 40.0, camD);
  float grain = sHash(floor(vWP.xz * 90.0)) * 0.6 + sNoise(vWP.xz * 14.0) * 0.4;
  diffuseColor.rgb *= mix(1.0, (grain - 0.45) * 0.22 + 0.98, nearK * vSand);
  diffuseColor.rgb *= mix(1.0, (sNoise(vWP.xz * 0.9) - 0.5) * 0.12 + 1.0, vSand);
  // wind ripples on the dry sand: finer sand on the crests reads paler
  float ph = ripplePhase(vWP.xz);
  float fadeR = 1.0 - smoothstep(0.6, 2.2, fwidth(ph));
  float rip = pow(sin(ph) * 0.5 + 0.5, 1.6);
  float windK = fadeR * smoothstep(1.35, 1.9, above) * vSand;
  diffuseColor.rgb *= (rip - 0.5) * 0.12 * windK + 1.0;
  // the wet band: everything the swash reaches, darker and more saturated,
  // with a damp fringe drying out above the last run-up
  float wetTop = ${(0.08 + RUNUP * 1.05).toFixed(3)} + (sNoise(vWP.xz * 0.35) - 0.5) * 0.06;
  float wet = (1.0 - smoothstep(wetTop - 0.04, wetTop + 0.02, above)) * vSand;
  float damp = (1.0 - smoothstep(wetTop, wetTop + 0.35, above)) * vSand * 0.35;
  vec3 wetAlbedo = diffuseColor.rgb * 0.58;
  wetAlbedo = mix(vec3(dot(wetAlbedo, vec3(0.299, 0.587, 0.114))), wetAlbedo, 1.15) * vec3(0.97, 0.98, 1.0);
  diffuseColor.rgb = mix(diffuseColor.rgb, wetAlbedo, max(wet, damp));
  // ---- THE HILLS: jungle canopy where the ground is gentle, basalt where
  // it's steep — chosen and textured per pixel, so the facets of a coarse
  // mesh far off never show as flat colour
  float hillK = vHill.x;
  float rockK = 0.0;
  float crownH = 0.0;
  if (hillK > 0.001) {
    vec3 Nw = normalize(vWN);
    float slope = 1.0 - Nw.y;
    vec2 xz = vWP.xz;
    // canopy: crowns at three scales — dark gaps, lit tops, emergents
    float c1 = sNoise(xz * 0.11 + 3.0);
    float c2 = sNoise(xz * 0.37 - 7.0);
    float c3 = sNoise(xz * 1.3 + 11.0);
    crownH = c1 * 0.45 + c2 * 0.4 + c3 * 0.15;
    vec3 veg = mix(vec3(0.018, 0.04, 0.014), vec3(0.075, 0.13, 0.03), smoothstep(0.28, 0.72, crownH));
    veg = mix(veg, vec3(0.15, 0.19, 0.045), smoothstep(0.7, 0.88, c2) * smoothstep(0.4, 0.7, c1) * 0.7);
    veg = mix(veg, vec3(0.05, 0.1, 0.06), smoothstep(0.6, 0.85, c1) * 0.35); // bluer, older stands
    veg *= 0.72 + 0.5 * smoothstep(0.25, 0.8, c3);
    // stands of different forest across a hillside: lighter, yellower
    // patches and dark, cool hollows
    float macroV = sNoise(xz * 0.018 + 4.0);
    veg *= 0.75 + 0.5 * macroV;
    veg = mix(veg, veg * vec3(1.3, 1.2, 0.75), smoothstep(0.62, 0.85, sNoise(xz * 0.045 - 9.0)) * 0.6);
    // basalt: warped horizontal strata, joints, lichen, moss on the ledges
    float warp = sNoise(xz * 0.035) * 7.0 + sNoise(xz * 0.21) * 1.6;
    float bands = sin((vWP.y + warp) * 1.7) * 0.5 + 0.5;
    float grainR = sNoise(xz * 1.1 + vWP.y * 0.7);
    float joint = smoothstep(0.06, 0.0, abs(sNoise(vec2(dot(xz, vec2(0.6, 0.8)) * 0.45, vWP.y * 0.06)) - 0.5));
    vec3 rock = mix(vec3(0.028, 0.029, 0.032), vec3(0.11, 0.105, 0.1), bands * 0.55 + grainR * 0.45);
    rock = mix(rock, vec3(0.2, 0.19, 0.17), smoothstep(0.78, 0.92, sNoise(xz * 2.3 + vWP.y)) * 0.5); // lichen
    rock *= 1.0 - joint * 0.65;
    float ledge = smoothstep(0.55, 0.25, slope) * smoothstep(0.5, 0.75, sNoise(xz * 0.5 + vWP.y * 0.25));
    rock = mix(rock, vec3(0.035, 0.06, 0.02), ledge * 0.75);
    rockK = smoothstep(0.3, 0.52, slope + (sNoise(xz * 0.13) - 0.5) * 0.3);
    rockK = max(rockK, vHill.y);
    vec3 hillC = mix(veg, rock, rockK);
    diffuseColor.rgb = mix(diffuseColor.rgb, hillC, hillK);
  }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
  {
    // ripple relief: the slope of the ripple profile, tilted into view space
    float dph = 0.105 / 6.2832;
    float slopeR = cos(ph) * 0.5 * 1.6 * pow(max(sin(ph) * 0.5 + 0.5, 1e-3), 0.6) * 0.18 * windK;
    vec2 g = normalize(vec2(0.35, -0.94)) * slopeR;
    normal = normalize(normal - (viewMatrix * vec4(g.x, 0.0, g.y, 0.0)).xyz);
  }
  if (hillK > 0.001) {
    // canopy bumps: the crown field's slope, strongest where it's forest
    vec2 xz = vWP.xz;
    float e = 0.6;
    float hx = sNoise((xz + vec2(e, 0.0)) * 0.37 - 7.0) - sNoise((xz - vec2(e, 0.0)) * 0.37 - 7.0);
    float hz = sNoise((xz + vec2(0.0, e)) * 0.37 - 7.0) - sNoise((xz - vec2(0.0, e)) * 0.37 - 7.0);
    vec3 bump = vec3(hx, 0.0, hz) * 1.6 * (1.0 - rockK) * hillK;
    // rock: stepped strata tilt the face up and down the fall line
    float st = cos((vWP.y + sNoise(xz * 0.035) * 7.0) * 1.7);
    bump.y += st * 0.35 * rockK * hillK;
    normal = normalize(normal - (viewMatrix * vec4(bump, 0.0)).xyz);
  }`,
      );
  };
  mat.customProgramCacheKey = () => 'cove-sand';
  const mesh = new Mesh(g, outdoor(mat));
  mesh.name = 'cove-land';
  mesh.receiveShadow = true;
  mesh.renderOrder = 0;
  return mesh;
}
