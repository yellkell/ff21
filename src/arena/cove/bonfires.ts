/**
 * THE COVE's bonfires — the beach party FIRE FIGHT throws at sundown.
 *
 * Fires burn up both arms of the beach, on the two headlands (signal fires
 * on the cliff tops) and back in the hills, all OFF in the distance: the
 * nearest is ~45 m away, nothing burns inside the arena.
 *
 * Every fire in the scene shares one draw per layer, and none of it is a
 * real light (a Quest can't afford eight flickering point lights):
 *   logs      a charred teepee per fire, merged, Lambert
 *   flames    a camera-facing (about the vertical) quad each; the tongue is
 *             a teardrop torn by scrolling noise, white-hot → orange → red,
 *             additive
 *   glow      a wide soft halo so a fire 200 m off still reads as a fire
 *   pool      the light it throws on the sand: a flickering additive disc
 *             laid on the ground — the fake that sells it
 *   embers    sparks spiralling up out of every fire, looped in the shader
 *   smoke     a dark column leaning downwind into the dusk
 *
 * TIKI TORCHES ride the same layers: a FireSpot with `torch` set is a small
 * flame on top of a bamboo pole (y is the flame's base, `ground` the sand),
 * with a soft pool at the pole's foot, a few sparks and no smoke column.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  Mesh,
  MeshLambertMaterial,
  NormalBlending,
  Points,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  Uint32BufferAttribute,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../desert/paper.js';
import { outdoor } from './outdoor.js';

export interface FireSpot {
  x: number;
  y: number;
  z: number;
  /** Overall size (1 = a big beach bonfire, flames ~2.6 m). */
  size: number;
  /** A tiki torch: y is the flame (top of the pole), ground the sand. */
  torch?: boolean;
  ground?: number;
}

/** How tall a tiki torch's pole stands (m). */
export const TORCH_POLE = 1.9;

/** Wind the smoke leans with (xz, m/s-ish). Off the sea, a little to the left. */
const WIND = new Vector3(-0.35, 0, 0.9).normalize();

const NOISE = /* glsl */ `
float fHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float fNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(fHash(i), fHash(i + vec2(1.0, 0.0)), u.x), mix(fHash(i + vec2(0.0, 1.0)), fHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fFbm(vec2 p) { return fNoise(p) * 0.55 + fNoise(p * 2.1 + 3.7) * 0.3 + fNoise(p * 4.3 - 1.3) * 0.15; }
`;

/** One cylindrical billboard per fire: attributes carry the fire's centre,
 *  the corner, the quad size and a per-fire seed. */
function billboards(spots: FireSpot[], w: number, h: number, lift: number): BufferGeometry {
  const center: number[] = [];
  const corner: number[] = [];
  const size: number[] = [];
  const seed: number[] = [];
  const idx: number[] = [];
  spots.forEach((s, i) => {
    for (const [cx, cy] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]]) {
      center.push(s.x, s.y + lift * s.size, s.z);
      corner.push(cx, cy);
      size.push(w * s.size, h * s.size);
      seed.push(i * 7.31 + 0.37);
    }
    const b = i * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  // three needs a position attribute; the shader builds the real one
  g.setAttribute('position', new Float32BufferAttribute(center, 3));
  g.setAttribute('aCenter', new Float32BufferAttribute(center, 3));
  g.setAttribute('aCorner', new Float32BufferAttribute(corner, 2));
  g.setAttribute('aSize', new Float32BufferAttribute(size, 2));
  g.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  return g;
}

const BILLBOARD_VERT = /* glsl */ `
attribute vec3 aCenter;
attribute vec2 aCorner;
attribute vec2 aSize;
attribute float aSeed;
uniform float uTime;
uniform vec3 uWind;
uniform float uLean;
varying vec2 vUv;
varying float vSeed;
varying float vDist;
#include <fog_pars_vertex>
void main() {
  vec3 toCam = cameraPosition - aCenter;
  toCam.y = 0.0;
  vec3 fwd = normalize(toCam + vec3(1e-4, 0.0, 0.0));
  vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  // a column leans downwind the higher it climbs
  vec3 p = aCenter + right * aCorner.x * aSize.x + vec3(0.0, aCorner.y * aSize.y, 0.0)
         + uWind * (aCorner.y * aCorner.y * aSize.y * uLean);
  vUv = aCorner + vec2(0.5, 0.0);
  vSeed = aSeed;
  vDist = length(cameraPosition - aCenter);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

function flameMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWind: { value: WIND }, uLean: { value: 0.12 } },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vDist;
      ${NOISE}
      void main() {
        vec2 uv = vUv;
        float t = uTime * 1.6 + vSeed * 11.0;
        // tongues: noise rising through the flame, stronger toward the top
        float n = fFbm(vec2(uv.x * 3.2 + vSeed, uv.y * 2.4 - t * 1.9));
        float n2 = fNoise(vec2(uv.x * 7.0 - vSeed, uv.y * 5.0 - t * 3.1));
        float x = (uv.x - 0.5) * 2.0 + (n - 0.5) * 0.9 * uv.y;
        // teardrop: wide at the base, licking to a point
        float width = mix(0.95, 0.05, pow(uv.y, 0.8));
        float body = 1.0 - smoothstep(width * 0.55, width, abs(x));
        float heat = body * (1.0 - smoothstep(0.35, 1.0, uv.y + (n2 - 0.5) * 0.45 + (n - 0.5) * 0.4));
        heat *= smoothstep(0.0, 0.08, uv.y);
        if (heat < 0.02) discard;
        // white-hot core → yellow → orange → deep red at the ragged tips
        vec3 c = mix(vec3(0.9, 0.12, 0.02), vec3(1.0, 0.45, 0.05), smoothstep(0.1, 0.45, heat));
        c = mix(c, vec3(1.0, 0.82, 0.35), smoothstep(0.45, 0.8, heat));
        c = mix(c, vec3(1.0, 0.97, 0.85), smoothstep(0.8, 1.0, heat));
        // far fires can't resolve tongues — keep them bright and solid
        float far = smoothstep(60.0, 220.0, vDist);
        gl_FragColor = vec4(c * mix(heat * 2.2, 1.6, far * 0.5), 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

function glowMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWind: { value: WIND }, uLean: { value: 0 } },
    vertexShader: BILLBOARD_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vDist;
      void main() {
        vec2 d = (vUv - vec2(0.5, 0.42)) * vec2(1.0, 1.25);
        float r = length(d) * 2.0;
        float flick = 0.85 + 0.15 * sin(uTime * 9.0 + vSeed * 5.0) * sin(uTime * 5.3 + vSeed);
        float g = exp(-r * r * 4.5) * 0.55 + exp(-r * 9.0) * 0.35;
        // a distant fire is mostly its glow: let it carry further off
        g *= flick * mix(0.55, 1.1, smoothstep(40.0, 250.0, vDist));
        gl_FragColor = vec4(vec3(1.0, 0.42, 0.1) * g, 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

function smokeMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: UniformsFog({ uTime: { value: 0 }, uWind: { value: WIND }, uLean: { value: 0.35 } }),
    vertexShader: BILLBOARD_VERT,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      varying float vDist;
      ${NOISE}
      #include <fog_pars_fragment>
      void main() {
        vec2 uv = vUv;
        float n = fFbm(vec2(uv.x * 2.2 + vSeed, uv.y * 3.0 - uTime * 0.22 - vSeed));
        float spread = mix(0.12, 0.5, uv.y);
        float body = 1.0 - smoothstep(spread * 0.3, spread, abs(uv.x - 0.5 + (n - 0.5) * 0.35 * uv.y));
        float a = body * smoothstep(0.0, 0.12, uv.y) * (1.0 - smoothstep(0.5, 1.0, uv.y)) * smoothstep(0.2, 0.65, n);
        a *= 0.75;
        if (a < 0.01) discard;
        // lit warm from the fire underneath, grey-violet as it climbs into the dusk
        vec3 c = mix(vec3(0.5, 0.2, 0.07), vec3(0.09, 0.08, 0.1), smoothstep(0.0, 0.3, uv.y));
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: NormalBlending,
    fog: true,
  });
}

/** Fog-aware uniforms (ShaderMaterial with fog: true needs fogColor etc.). */
function UniformsFog(u: Record<string, { value: unknown }>): Record<string, { value: unknown }> {
  return {
    ...u,
    fogColor: { value: new Color() },
    fogNear: { value: 1 },
    fogFar: { value: 2000 },
    fogDensity: { value: 0 },
  };
}

/** The light each fire throws on the sand: a flat disc, additive, flickering. */
function pools(spots: FireSpot[]): Mesh {
  const pos: number[] = [];
  const uv: number[] = [];
  const seed: number[] = [];
  const idx: number[] = [];
  spots.forEach((s, i) => {
    const r = s.torch ? 3.4 : 9 * s.size;
    const b = i * 4;
    for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      pos.push(s.x + cx * r, (s.ground ?? s.y) + 0.06, s.z + cz * r);
      uv.push(cx, cz);
      seed.push(i * 7.31 + 0.37);
    }
    idx.push(b, b + 2, b + 1, b, b + 3, b + 2);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('aSeed', new Float32BufferAttribute(seed, 1));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        vUv = uv;
        vSeed = aSeed;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vSeed;
      void main() {
        float r = length(vUv);
        float flick = 0.8 + 0.2 * sin(uTime * 11.0 + vSeed * 3.0) * sin(uTime * 6.7 + vSeed * 9.0);
        float g = (exp(-r * r * 9.0) * 0.5 + exp(-r * 4.0) * 0.18) * flick;
        gl_FragColor = vec4(vec3(1.0, 0.38, 0.09) * g, 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const m = new Mesh(g, mat);
  m.name = 'cove-fire-pools';
  m.frustumCulled = false;
  return m;
}

/** Sparks: EMBERS per fire, each on its own looping climb (all in-shader). */
const EMBERS = 48;
function embers(spots: FireSpot[]): Points {
  const center: number[] = [];
  const rnd: number[] = [];
  const rng = makeRng(0xe3b3);
  for (const s of spots) {
    for (let i = 0; i < (s.torch ? 10 : EMBERS); i++) {
      center.push(s.x, s.y + 0.4 * s.size, s.z);
      rnd.push(rng(), rng(), rng(), s.size);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(center, 3));
  g.setAttribute('aRnd', new Float32BufferAttribute(rnd, 4));
  const mat = new ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uWind: { value: WIND } },
    vertexShader: /* glsl */ `
      attribute vec4 aRnd;
      uniform float uTime;
      uniform vec3 uWind;
      varying float vLife;
      void main() {
        float life = fract(uTime * (0.22 + aRnd.x * 0.25) + aRnd.y);
        float sz = aRnd.w;
        float h = life * (5.0 + aRnd.z * 7.0) * sz;
        float a = aRnd.y * 40.0 + uTime * (1.0 + aRnd.x) ;
        float r = (0.3 + life * 1.4) * sz * (0.5 + aRnd.z);
        vec3 p = position + vec3(cos(a) * r, h, sin(a) * r) + uWind * life * life * 3.5 * sz;
        vLife = life;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(90.0 * sz / -mv.z, 1.0, 5.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vLife;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        if (d > 0.5) discard;
        float k = (1.0 - vLife) * (1.0 - vLife);
        gl_FragColor = vec4(mix(vec3(1.0, 0.25, 0.04), vec3(1.0, 0.75, 0.3), k) * k * 2.0, 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const p = new Points(g, mat);
  p.name = 'cove-embers';
  p.frustumCulled = false;
  return p;
}

/** A charred log teepee per fire, merged into one mesh. */
function logs(spots: FireSpot[]): Mesh {
  const rng = makeRng(0x1065);
  const parts: BufferGeometry[] = [];
  const q = new Quaternion();
  for (const s of spots) {
    if (s.torch) continue;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const len = (1.5 + rng() * 0.5) * s.size;
      const g = new CylinderGeometry(0.07 * s.size, 0.1 * s.size, len, 6);
      const az = (i / n) * Math.PI * 2 + rng() * 0.3;
      // lean every log in toward the fire's heart
      const tilt = 0.5 + rng() * 0.2;
      const axis = new Vector3(Math.sin(az), 0, -Math.cos(az));
      // rotating +y about (sin, 0, −cos) swings it toward the foot — negate
      // so the top leans back in over the fire
      q.setFromAxisAngle(axis, -tilt);
      g.translate(0, len / 2, 0);
      g.applyQuaternion(q);
      const foot = new Vector3(Math.cos(az), 0, Math.sin(az)).multiplyScalar(0.75 * s.size);
      g.translate(s.x + foot.x, s.y - 0.05, s.z + foot.z);
      parts.push(g.toNonIndexed());
      g.dispose();
    }
  }
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const mat = new MeshLambertMaterial({ color: new Color().setRGB(0.12, 0.08, 0.06, SRGBColorSpace), emissive: new Color(0.22, 0.05, 0.0) });
  const m = new Mesh(g, outdoor(mat));
  m.name = 'cove-fire-logs';
  return m;
}

/** Bamboo poles with a woven cup at the top, one mesh for every torch. */
function poles(spots: FireSpot[]): Mesh | null {
  const parts: BufferGeometry[] = [];
  const rng = makeRng(0x70c4);
  for (const s of spots) {
    if (!s.torch) continue;
    const ground = s.ground ?? s.y - TORCH_POLE;
    const h = s.y - ground;
    const pole = new CylinderGeometry(0.03, 0.04, h + 0.3, 6).toNonIndexed();
    pole.translate(0, (h + 0.3) / 2 - 0.3, 0);
    const lean = new Quaternion().setFromAxisAngle(new Vector3(rng() - 0.5, 0, rng() - 0.5).normalize(), rng() * 0.06);
    pole.applyQuaternion(lean);
    pole.translate(s.x, ground, s.z);
    const cup = new CylinderGeometry(0.09, 0.06, 0.2, 8).toNonIndexed();
    cup.translate(0, h - 0.06, 0);
    cup.applyQuaternion(lean);
    cup.translate(s.x, ground, s.z);
    parts.push(pole, cup);
  }
  if (!parts.length) return null;
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const mat = new MeshLambertMaterial({ color: new Color().setRGB(0.36, 0.27, 0.16, SRGBColorSpace) });
  const m = new Mesh(g, outdoor(mat));
  m.name = 'cove-torch-poles';
  return m;
}

export interface Bonfires {
  meshes: (Mesh | Points)[];
  update(time: number): void;
}

export function buildBonfires(spots: FireSpot[]): Bonfires {
  const flameMat = flameMaterial();
  const glowMat = glowMaterial();
  const smokeMat = smokeMaterial();
  const flames = new Mesh(billboards(spots, 1.7, 3.0, 0.1), flameMat);
  flames.name = 'cove-flames';
  const glow = new Mesh(billboards(spots, 9, 8, -1.4), glowMat);
  glow.name = 'cove-fire-glow';
  const smoke = new Mesh(billboards(spots.filter((f) => !f.torch), 6, 26, 1.6), smokeMat);
  smoke.name = 'cove-smoke';
  const pool = pools(spots);
  const sparks = embers(spots);
  for (const m of [flames, glow, smoke]) m.frustumCulled = false;
  // draw order among the see-through layers: pools, smoke, glow, flames, sparks
  pool.renderOrder = 2;
  smoke.renderOrder = 3;
  glow.renderOrder = 4;
  flames.renderOrder = 5;
  sparks.renderOrder = 6;
  const mats = [flameMat, glowMat, smokeMat, pool.material as ShaderMaterial, sparks.material as ShaderMaterial];
  return {
    meshes: [logs(spots), ...[poles(spots)].filter((m): m is Mesh => m !== null), pool, smoke, glow, flames, sparks],
    update(time) {
      for (const m of mats) m.uniforms.uTime.value = time;
    },
  };
}

