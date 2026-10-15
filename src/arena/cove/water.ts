/**
 * THE COVE's sea — Tidewater's water shading on a headset budget.
 *
 * Kept from Tidewater (github.com/dgreenheck/tidewater, ocean/WaterMaterial.js,
 * MIT): the optics. Exact dielectric Fresnel; a GGX sun glint whose
 * roughness grows with distance; Beer–Lambert absorption along the
 * REFRACTED ray down to the seabed with Tidewater's own absorption
 * (0.42, 0.075, 0.035 /m) and scattering (0.012, 0.018, 0.024 /m); the
 * analytic single-scatter in-scattering with Gordon's multiple-scattering
 * backscatter; foam lit as a bright diffuse scatterer; a thin swash sheet
 * that fades into the sand at its own leading edge.
 *
 * Replaced for Quest: the four-cascade FFT becomes a few directional
 * sines; the refraction pass + screen copy become the analytic seabed of
 * shape.ts (so the water shades the sand it lies on without ever seeing
 * it); the breaking-wave and swash simulations become one closed-form surf
 * model — a swell that slows, steepens and sharpens over the seabed
 * (shallow-water travel time, Green's-law shoaling), breaks on the outer
 * bar when it outgrows 0.78 × depth, rolls in as a foaming bore, and runs
 * up and drains back down the foreshore every period. One opaque draw, no
 * render targets, nothing transparent.
 */

import {
  BufferGeometry,
  Color,
  DataTexture,
  Float32BufferAttribute,
  LinearMipmapLinearFilter,
  LinearFilter,
  Mesh,
  NoColorSpace,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Uint32BufferAttribute,
  UnsignedByteType,
  Vector3,
  type Texture,
} from 'three';
import { makeRng } from '../desert/paper.js';
import { RUNUP, SHAPE_GLSL, SWELL_H0, SWELL_PERIOD } from './shape.js';
import { SKY_UV_GLSL } from './sky.js';

// ------------------------------------------------------------ detail texture

const TEX = 256;

/**
 * One tileable 256² texture, four jobs:
 *   RG  capillary / chop normal slopes (sum of periodic sines)
 *   B   caustic web (Worley F2 − F1: bright where two cells meet)
 *   A   foam (bubbly Worley blobs at two scales)
 * Built on the CPU once (~20 ms); everything tiles because every wave
 * vector and every cell point is on the 256-texel period.
 */
function buildDetailTexture(): DataTexture {
  const rng = makeRng(0x71de);
  const data = new Uint8Array(TEX * TEX * 4);
  // capillary sines: integer wave vectors → exact tiling
  const waves: { kx: number; ky: number; a: number; ph: number }[] = [];
  for (let i = 0; i < 28; i++) {
    const f = 2 + Math.floor(rng() * rng() * 22);
    const ang = rng() * Math.PI * 2;
    const kx = Math.round(Math.cos(ang) * f);
    const ky = Math.round(Math.sin(ang) * f);
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, a: 1 / (Math.hypot(kx, ky) ** 1.1), ph: rng() * Math.PI * 2 });
  }
  // worley cells (tiling): n×n jittered points
  const cells = (n: number, seed: number): Float32Array => {
    const r = makeRng(seed);
    const pts = new Float32Array(n * n * 2);
    for (let i = 0; i < n * n; i++) {
      pts[i * 2] = ((i % n) + 0.15 + 0.7 * r()) / n;
      pts[i * 2 + 1] = (Math.floor(i / n) + 0.15 + 0.7 * r()) / n;
    }
    return pts;
  };
  const worley = (pts: Float32Array, n: number, u: number, v: number): [number, number] => {
    const cx = Math.floor(u * n);
    const cy = Math.floor(v * n);
    let f1 = 9;
    let f2 = 9;
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const ix = (((cx + ox) % n) + n) % n;
        const iy = (((cy + oy) % n) + n) % n;
        // the neighbour's point, unwrapped into this tile's frame
        const px = pts[(iy * n + ix) * 2] + (cx + ox - ix) / n;
        const py = pts[(iy * n + ix) * 2 + 1] + (cy + oy - iy) / n;
        const d = Math.hypot(u - px, v - py) * n;
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    return [f1, f2];
  };
  const cA = cells(10, 0x51c);
  const fA = cells(18, 0xf0a);
  const fB = cells(40, 0xb0b);
  let maxS = 0;
  const slopes = new Float32Array(TEX * TEX * 2);
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      let sx = 0;
      let sy = 0;
      const u = x / TEX;
      const v = y / TEX;
      for (const w of waves) {
        const c = Math.cos(2 * Math.PI * (w.kx * u + w.ky * v) + w.ph) * w.a;
        sx += c * w.kx;
        sy += c * w.ky;
      }
      slopes[(y * TEX + x) * 2] = sx;
      slopes[(y * TEX + x) * 2 + 1] = sy;
      maxS = Math.max(maxS, Math.abs(sx), Math.abs(sy));
    }
  }
  for (let y = 0; y < TEX; y++) {
    for (let x = 0; x < TEX; x++) {
      const i = y * TEX + x;
      const u = (x + 0.5) / TEX;
      const v = (y + 0.5) / TEX;
      const [c1, c2] = worley(cA, 10, u, v);
      const caustic = Math.pow(1 - Math.min(1, (c2 - c1) / 0.28), 3);
      const [a1] = worley(fA, 18, u, v);
      const [b1] = worley(fB, 40, u, v);
      const foam = Math.min(1, Math.max(0, 1.15 - a1 * 0.9) * 0.65 + Math.max(0, 1 - b1) * 0.45);
      data[i * 4] = Math.round((slopes[i * 2] / maxS) * 127 + 128);
      data[i * 4 + 1] = Math.round((slopes[i * 2 + 1] / maxS) * 127 + 128);
      data[i * 4 + 2] = Math.round(caustic * 255);
      data[i * 4 + 3] = Math.round(foam * 255);
    }
  }
  const tex = new DataTexture(data, TEX, TEX, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.magFilter = LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.colorSpace = NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// -------------------------------------------------------------- the mesh

/**
 * A polar grid about the origin: rings spaced geometrically from just in
 * front of the berm out to 9 km, fanned over the sea half of the world
 * (±115° about −z; behind you is all land). Dense where the surf is,
 * sparse where only the horizon is.
 */
function buildGrid(): BufferGeometry {
  const R0 = 12;
  const R1 = 9000;
  const rings = 170;
  const segs = 300;
  const A = (115 * Math.PI) / 180;
  const pos: number[] = [];
  for (let j = 0; j < rings; j++) {
    const r = R0 * Math.pow(R1 / R0, j / (rings - 1));
    for (let i = 0; i <= segs; i++) {
      const a = -A + (2 * A * i) / segs;
      pos.push(Math.sin(a) * r, 0, -Math.cos(a) * r);
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      const b = a + segs + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  // displacement happens in the shader; never cull the sea
  g.boundingSphere = null;
  return g;
}

// ---------------------------------------------------------------- shaders

const OMEGA = (2 * Math.PI) / SWELL_PERIOD;

/** The surf model: height of the sea surface above SEA_Y at xz (+ foam
 *  and breaking) — shared by the vertex shader (height, normals) and the
 *  fragment shader (foam line at the swash front). */
const SURF_GLSL = /* glsl */ `
uniform float uTime;
#define OMEGA ${OMEGA.toFixed(6)}
#define H0 ${SWELL_H0.toFixed(3)}
#define RUNUP ${RUNUP.toFixed(3)}

// travel time (s) from coast distance d to the waterline for a shallow-water
// wave over the seabed profile (∫ dd / sqrt(g·h)): exact for the 0.05 slope,
// then the 0.06 slope, then deep water at ~12 m/s.
float coveTau(float d) {
  d = max(d, 0.0);
  float t = 2.857 * sqrt(min(d, 70.0));
  if (d > 70.0) t += 10.64 * (sqrt(3.5 + 0.06 * min(d - 70.0, 190.0)) - 1.8708);
  if (d > 260.0) t += (d - 260.0) / 12.0;
  return t;
}
// along-shore phase: crests arrive slightly obliquely and bend with the bar
float coveAlong(float x) {
  return 0.011 * x + 1.3 * sin(x * 0.0085 + 0.7) + 0.5 * sin(x * 0.031);
}

struct Surf { float y; float foam; float br; float swash; };

// Sea surface at xz: y (absolute), whitewater foam 0..1, breaking 0..1,
// and how much of the height is the swash sheet (for the edge foam).
Surf coveSurf(vec2 xz, float camDist) {
  Surf s;
  float d = coveCoastDist(xz);
  float ground = coveGroundY(xz, d);
  float h = max(SEA_Y - ground, 0.0);           // still-water depth
  float theta = OMEGA * (uTime + coveTau(d)) + coveAlong(xz.x);
  // sets: every few waves a bigger one
  float setK = 0.78 + 0.22 * sin(theta / 6.3 + xz.x * 0.004);
  // shoaling (Green's law) until the wave outgrows the water: breaks at 0.78·h
  float Hs = H0 * setK * pow(12.0 / max(h, 0.35), 0.25);
  float Hb = 0.78 * h + 0.05;
  float br = smoothstep(0.85, 1.1, Hs / Hb);
  float H = mix(Hs, 0.52 * h + 0.06, br);       // a broken wave is a bore ~half the depth
  // crest shape: long troughs, peaked crests, the face steepening as it shoals
  float shoal = clamp(1.6 / max(h, 0.4), 0.0, 1.0);
  float skew = 0.85 * shoal;
  float th = theta - skew * sin(theta);
  float p = mix(1.3, 5.0, shoal);
  float w = pow(0.5 + 0.5 * cos(th), p);
  float wave = H * (w - 0.5 / sqrt(p));
  // whitewater: the rolling front of a breaking crest + lace fading behind it
  float cyc = fract(theta / 6.2831853);          // 0 as a crest passes
  float front = smoothstep(0.9, 0.995, cyc) + smoothstep(0.05, 0.0, cyc);
  float lace = exp(-cyc * 6.0);
  float foam = br * clamp(front * 0.95 + lace * 0.6 * w + lace * 0.2, 0.0, 1.0);
  // offshore chop: small wind waves, calm in the swash, faded with distance
  float chopK = smoothstep(2.0, 25.0, d) * (1.0 - smoothstep(700.0, 2500.0, camDist));
  float chop = 0.07 * sin(dot(xz, vec2(0.29, 0.41)) - uTime * 1.9)
             + 0.05 * sin(dot(xz, vec2(-0.47, 0.21)) - uTime * 2.3 + 1.7)
             + 0.035 * sin(dot(xz, vec2(0.62, -0.55)) - uTime * 2.9 + 4.1)
             + 0.025 * sin(dot(xz, vec2(-0.9, -0.77)) - uTime * 3.6 + 0.3);
  float sea = SEA_Y + 0.06 + wave * (1.0 - smoothstep(1500.0, 4000.0, camDist)) + chop * chopK;
  // the swash: each bore runs up the foreshore, then drains back
  float c0 = fract((OMEGA * uTime + coveAlong(xz.x)) / 6.2831853);
  float up = c0 < 0.24 ? sin(c0 / 0.24 * 1.5707963) : 1.0 - smoothstep(0.24, 0.96, c0);
  float swashY = SEA_Y + 0.08 + RUNUP * setK * up;
  float k = 1.0 - smoothstep(0.0, 9.0, d);
  s.y = mix(sea, max(sea, swashY), k);
  s.foam = foam * (1.0 - k * 0.5);
  s.br = max(br, k * 0.6);
  s.swash = k * up;
  return s;
}
`;

const VERT = /* glsl */ `
${SHAPE_GLSL}
${SURF_GLSL}
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFoam;
varying float vBreak;
#include <fog_pars_vertex>
void main() {
  vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
  float camDist = length(p.xz - cameraPosition.xz);
  // finite-difference normal over the same surf model (grid spacing grows
  // with range, so the stencil does too)
  float e = clamp(camDist * 0.012, 0.25, 12.0);
  Surf s = coveSurf(p.xz, camDist);
  float hx = coveSurf(p.xz + vec2(e, 0.0), camDist).y;
  float hz = coveSurf(p.xz + vec2(0.0, e), camDist).y;
  p.y = s.y;
  // the Earth drops away under the horizon
  p.y -= camDist * camDist / 12.74e6;
  vNormalW = normalize(vec3(s.y - hx, e, s.y - hz));
  vWorld = p;
  vFoam = s.foam;
  vBreak = s.br;
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
${SHAPE_GLSL}
${SKY_UV_GLSL}
uniform float uTime;
uniform sampler2D atmTex;
uniform sampler2D cloudTex;
uniform sampler2D detailTex;
uniform vec3 sunDir;
uniform vec3 sunE;     // sun irradiance (same units as the scene's lights)
uniform vec3 skyE;     // sky irradiance on a flat surface
varying vec3 vWorld;
varying vec3 vNormalW;
varying float vFoam;
varying float vBreak;
#include <common>
#include <fog_pars_fragment>

const float IOR = 1.333;
const vec3 SIG_A = vec3(0.42, 0.075, 0.035);   // Tidewater's absorption (/m)
const vec3 SIG_S = vec3(0.012, 0.018, 0.024);  // Tidewater's scattering (/m)

float fresnelDielectric(float cosI, float eta) {
  float c = clamp(cosI, 0.0, 1.0);
  float g2 = eta * eta - 1.0 + c * c;
  if (g2 < 0.0) return 1.0;
  float g = sqrt(g2);
  float a = (g - c) / (g + c);
  float b = (c * (g + c) - 1.0) / (c * (g - c) + 1.0);
  return 0.5 * a * a * (b * b + 1.0);
}
float phaseHG(float c, float g) {
  float g2 = g * g;
  return ((1.0 - g2) / (4.0 * PI)) / pow(max(1.0 + g2 - c * 2.0 * g, 1e-4), 1.5);
}
float dGGX(float NdH, float a2) {
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  return a2 / (PI * d * d);
}
float vSmith(float NdL, float NdV, float a2) {
  float gv = NdL * sqrt(NdV * NdV * (1.0 - a2) + a2);
  float gl = NdV * sqrt(NdL * NdL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-5);
}

void main() {
  vec3 P = vWorld;
  vec3 toCam = cameraPosition - P;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  vec3 L = sunDir;
  float d = coveCoastDist(P.xz);
  float ground = coveGroundY(P.xz, d);
  float thick = P.y - ground;                    // water column here (m)

  // ---- normal: the swell's + two drifting capillary layers (fading out with
  // range so they never alias into sparkle-noise)
  vec2 uvA = P.xz / 7.5 + vec2(0.018, 0.011) * uTime;
  vec2 uvB = P.xz / 2.7 + vec2(-0.027, 0.036) * uTime;
  vec4 tA = texture(detailTex, uvA);
  vec4 tB = texture(detailTex, uvB);
  float detK = (1.0 - smoothstep(25.0, 220.0, dist)) * smoothstep(0.0, 0.25, thick);
  vec2 slope = ((tA.xy - 0.5) * 0.22 + (tB.xy - 0.5) * 0.12) * detK;
  vec3 N = normalize(vNormalW + vec3(slope.x, 0.0, slope.y));
  // facets turned away from the eye bend to grazing instead of flipping
  N = normalize(N + V * max(-dot(N, V) + 0.03, 0.0));
  float NdV = max(dot(N, V), 1e-4);
  float F = fresnelDielectric(NdV, IOR);

  // ---- reflection: the baked sky. Unresolved slopes tilt the average
  // reflection toward the darker, higher sky (Cox–Munk, as Tidewater).
  vec3 Rraw = reflect(-V, N);
  float rough = 0.05 + smoothstep(40.0, 900.0, dist) * 0.1;
  float Rup = max(Rraw.y, 0.004) + rough * 1.3 * (1.0 - max(Rraw.y, 0.0));
  vec3 R = normalize(vec3(Rraw.x, Rup, Rraw.z));
  vec3 refl = coveSkyLod(atmTex, cloudTex, R, rough * 20.0);
  refl = mix(refl * 0.35, refl, smoothstep(-0.12, 0.08, Rraw.y));

  // ---- sun glint (GGX)
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0);
  float a2 = rough * rough + vFoam * 0.2;
  float spec = dGGX(max(dot(N, H), 0.0), a2) * vSmith(NdL, NdV, a2) * fresnelDielectric(max(dot(V, H), 0.0), IOR) * NdL;
  vec3 sunSpec = sunE * min(spec, 60.0);

  // ---- the water column: trace the refracted ray to the analytic seabed
  vec3 Tr = refract(-V, N, 1.0 / IOR);
  vec3 Tv = normalize(vec3(Tr.x, min(Tr.y, -0.08), Tr.z));
  float tDown = max(-Tv.y, 0.04);
  float L0 = max(thick, 0.0) / tDown;
  float Lt = L0;
  if (L0 < 60.0) {
    vec2 q = P.xz + Tv.xz * L0 * 0.7;
    Lt = max(P.y - coveGroundY(q, coveCoastDist(q)), 0.0) / tDown;
  }
  float pathLen = min(Lt, 120.0);
  vec2 bedXZ = P.xz + Tv.xz * pathLen;
  float bedDepth = max(pathLen * tDown, 0.0);

  // surf-zone water is milky: bubbles and stirred sand scatter (Tidewater's surfMedium)
  float aer = clamp(vBreak * 0.7 + vFoam * 0.8, 0.0, 1.0);
  vec3 sigA = SIG_A + vec3(0.05, 0.035, 0.02) * aer;
  vec3 sigS = SIG_S + aer * vec3(0.9, 0.95, 0.9);
  vec3 sigT = sigA + sigS;

  // seabed: pale coral sand, a touch darker with depth, sun caustics dancing on it
  vec3 sand = mix(vec3(0.66, 0.56, 0.38), vec3(0.47, 0.44, 0.33), smoothstep(1.0, 9.0, bedDepth));
  vec2 cuv = bedXZ / 3.4;
  float caus = min(texture(detailTex, cuv + vec2(0.043, 0.021) * uTime).b,
                   texture(detailTex, cuv * 1.31 + vec2(-0.031, 0.047) * uTime + 0.37).b);
  caus *= (1.0 - smoothstep(0.5, 7.0, bedDepth)) * smoothstep(0.02, 0.35, bedDepth) * (1.0 - smoothstep(30.0, 90.0, dist));
  vec3 Ls = -refract(-L, vec3(0.0, 1.0, 0.0), 1.0 / IOR);
  float muS = max(Ls.y, 0.1);
  vec3 sunIn = sunE * (1.0 - fresnelDielectric(max(L.y, 0.02), IOR));
  vec3 bedE = sunIn * muS * exp(-sigT * bedDepth / muS) * (0.75 + 2.2 * caus) + skyE * exp(-sigT * bedDepth * 1.3);
  vec3 bedRad = sand * bedE * RECIPROCAL_PI;

  // in-scattered light along the view ray (single scatter + ambient, analytic)
  float muV = max(-Tv.y, 0.15);
  vec3 Tview = exp(-sigT * pathLen);
  vec3 kSun = sigT * (1.0 + muV / muS);
  vec3 kAmb = sigT * (1.0 + muV / 0.75);
  float phase = phaseHG(dot(Tv, Ls), 0.86) * 0.7 + 0.3 / (4.0 * PI);
  vec3 bb = sigS * mix(0.035, 0.06, clamp(aer * 2.0, 0.0, 1.0));
  vec3 albedoMS = bb * (0.33 * 4.0) / (sigA + bb);
  vec3 inSun = sunIn * (sigS * phase + albedoMS * sigT * RECIPROCAL_PI) * (1.0 - exp(-kSun * pathLen)) / kSun;
  vec3 inAmb = skyE * RECIPROCAL_PI * (sigS * 0.25 + albedoMS * sigT) * (1.0 - exp(-kAmb * pathLen)) / kAmb;
  vec3 transmitted = bedRad * Tview + inSun + inAmb;

  // ---- foam: whitewater texture thresholded by how much foam there is
  float fTex = texture(detailTex, P.xz / 5.5 + vec2(0.0, 0.03) * uTime).a * 0.65
             + texture(detailTex, P.xz / 1.9 - vec2(0.02, 0.0) * uTime).a * 0.35;
  float foamAmt = clamp(vFoam, 0.0, 1.0);
  // the bead of foam riding the swash front: the last few cm of the sheet
  float edge = smoothstep(0.0, 0.012, thick) * smoothstep(0.05, 0.015, thick) * smoothstep(9.0, 0.0, d);
  foamAmt = max(foamAmt * (0.55 + 0.45 * texture(detailTex, P.xz / 23.0 + 0.3).a), edge * 0.8);
  // whitewater is a lace of bubbles, not a painted stripe
  float foam = smoothstep(1.0 - foamAmt * 0.9, 1.0 - foamAmt * 0.9 + 0.18, fTex) * smoothstep(0.0, 0.1, foamAmt);
  foam *= 1.0 - smoothstep(600.0, 2500.0, dist) * 0.7;
  vec3 foamCol = (sunE * (NdL * 0.75 + 0.06) + skyE * 1.15) * RECIPROCAL_PI * 0.85;

  vec3 water = mix(transmitted, refl, F) + sunSpec;
  vec3 col = mix(water, foamCol + sunSpec * 0.05, clamp(foam, 0.0, 1.0));

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export interface Sea {
  mesh: Mesh;
  detail: Texture;
  update(time: number): void;
}

export function buildSea(atm: Texture, clouds: Texture, sunDir: Vector3, sunE: Color, skyE: Color): Sea {
  const detail = buildDetailTexture();
  const mat = new ShaderMaterial({
    uniforms: UniformsUtils.merge([
      UniformsLib.fog,
      {
        uTime: { value: 0 },
        sunDir: { value: sunDir.clone() },
        sunE: { value: new Vector3(sunE.r, sunE.g, sunE.b) },
        skyE: { value: new Vector3(skyE.r, skyE.g, skyE.b) },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    fog: true,
  });
  // textures stay out of the merge (UniformsUtils clones values)
  mat.uniforms.atmTex = { value: atm };
  mat.uniforms.cloudTex = { value: clouds };
  mat.uniforms.detailTex = { value: detail };
  const mesh = new Mesh(buildGrid(), mat);
  mesh.name = 'cove-sea';
  mesh.frustumCulled = false;
  mesh.renderOrder = 1; // after the land, so hidden seabed never shades
  return {
    mesh,
    detail,
    update(time) {
      mat.uniforms.uTime.value = time;
    },
  };
}
