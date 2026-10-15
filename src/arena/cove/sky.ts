/**
 * THE COVE's sky — Tidewater's look (a physically based atmosphere plus
 * sunlit cumulus) at a headset's price: it is raymarched ONCE, into an HDR
 * equirect, and from then on the dome and the sea's reflections only sample
 * a texture.
 *
 * Tidewater (github.com/dgreenheck/tidewater, MIT) runs a Hillaire 2020
 * atmosphere and volumetric clouds every frame. Here the same physics —
 * the Rayleigh / Mie / ozone coefficients are Tidewater's (sky/Atmosphere.js)
 * — runs single-scattered in a bake, strip by strip over a few frames
 * (`step()`), so even the Quest never stalls on it. A sky at infinity has
 * no parallax, so a baked one is indistinguishable in the headset; only the
 * clouds stop drifting, and they barely move at this altitude anyway.
 *
 * The texture covers the upper sky (elevation −10°…90°) at ~0.18°/texel;
 * below that the view always lands on sea or land.
 *
 * TWO layers are baked — the atmosphere, and the clouds as premultiplied
 * radiance + coverage — so the dome can let the clouds DRIFT: it slides
 * the cloud layer across a virtual deck 2 km up (quick overhead, barely
 * moving at the horizon, as real clouds do) and crossfades two offset
 * copies of it so the drift never runs out. The sea's reflections read the
 * layers where they were baked; blurred and rippled, nobody can tell.
 */

import {
  BackSide,
  Camera,
  ClampToEdgeWrapping,
  Color,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { SUN_DIR } from './shape.js';

const W = 2048;
const H = 512;
/** Strips per bake — one per frame. */
const STRIPS = 32;
/** Lowest elevation stored (radians). */
const EL0 = -10 * (Math.PI / 180);

/** Radiance → display scale shared by everything that reads the bake. */
export const SKY_EXPOSURE = 15.0;

/** GLSL: direction → uv in the sky bake (continuous-u variant for gradients). */
export const SKY_UV_GLSL = /* glsl */ `
vec2 coveSkyUV(vec3 dir) {
  float el = asin(clamp(dir.y, -1.0, 1.0));
  float u = atan(dir.x, -dir.z) * 0.15915494 + 0.5;
  float v = clamp((el - (${EL0.toFixed(6)})) / (1.5707963 - (${EL0.toFixed(6)})), 0.0, 1.0);
  return vec2(u, v);
}
// Sample without the seam at u = 0|1: gradients from a u that wraps elsewhere.
vec4 coveSample(sampler2D tex, vec3 dir) {
  vec2 uv = coveSkyUV(dir);
  vec2 uvAlt = vec2(fract(uv.x + 0.5), uv.y);
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  vec2 dxA = dFdx(uvAlt), dyA = dFdy(uvAlt);
  bool alt = abs(dx.x) + abs(dy.x) > abs(dxA.x) + abs(dyA.x);
  return textureGrad(tex, uv, alt ? dxA : dx, alt ? dyA : dy);
}
// The evening grade, then a soft shoulder. The grade is a warm filter on
// everything the sky gives — dome, clouds, the sea's reflections alike —
// so late-evening blue sinks to dusky lavender and every white goes orange.
// The shoulder: below 0.55 untouched, above it rolls toward 1, so a sunlit
// cloud keeps its modelling without a tone mapper (the headset has none).
vec3 coveTone(vec3 c) {
  c *= vec3(1.16, 0.84, 0.58);
  vec3 over = max(c - 0.55, 0.0);
  return min(c, 0.55) + 0.45 * (1.0 - exp(-over / 0.45));
}
// The two layers composited, no derivatives (the sea's reflections).
vec3 coveSkyLod(sampler2D atm, sampler2D cld, vec3 dir, float lod) {
  vec2 uv = coveSkyUV(dir);
  vec4 c = textureLod(cld, uv, lod);
  return coveTone(textureLod(atm, uv, lod).rgb * (1.0 - c.a) + c.rgb);
}
`;

const BAKE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform vec3 sunDir;
uniform float quality;
uniform float mode; // 0 bakes the atmosphere, 1 the cloud layer

const float PI = 3.14159265;
const float RG = 6360.0;   // planet radius (km)
const float RT = 6460.0;   // top of the atmosphere (km)
const vec3 RAY = vec3(5.802e-3, 13.558e-3, 33.1e-3);  // Tidewater's Rayleigh scattering (/km)
const float MIE_S = 3.996e-3;
const float MIE_E = 4.440e-3;
const vec3 OZONE = vec3(0.650e-3, 1.881e-3, 0.085e-3);
const float SUN_E = 1.0;

// ---- noise (hash-based: no textures to upload, the bake is a one-off)
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise2(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float vnoise3(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  vec3 u = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), u.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), u.x), u.y);
  float b = mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), u.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), u.x), u.y);
  return mix(a, b, u.z);
}

// ---- atmosphere
struct Medium { vec3 scatR; float scatM; vec3 ext; };
Medium medium(float hKm) {
  Medium m;
  float r = exp(-hKm / 8.0);
  float mi = exp(-hKm / 1.2);
  float oz = max(0.0, 1.0 - abs(hKm - 25.0) / 15.0);
  m.scatR = RAY * r;
  m.scatM = MIE_S * mi;
  m.ext = RAY * r + MIE_E * mi + OZONE * oz;
  return m;
}
vec2 raySphere(vec3 ro, vec3 rd, float R) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - R * R;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}
// Transmittance from p to the top of the atmosphere toward the sun.
vec3 sunTransmittance(vec3 p) {
  vec2 t = raySphere(p, sunDir, RT);
  if (raySphere(p, sunDir, RG).x > 0.0) return vec3(0.0);
  float L = t.y;
  const int N = 8;
  float ds = L / float(N);
  vec3 od = vec3(0.0);
  for (int i = 0; i < N; i++) {
    vec3 q = p + sunDir * ((float(i) + 0.5) * ds);
    od += medium(length(q) - RG).ext * ds;
  }
  return exp(-od);
}
float phaseR(float c) { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
float phaseHG(float c, float g) {
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
// Single-scattered sky radiance along rd from ro, up to tMax (km); returns
// (radiance, and the view transmittance in .w of the out param).
vec3 atmosphere(vec3 ro, vec3 rd, float tMax, out vec3 transOut) {
  vec2 ta = raySphere(ro, rd, RT);
  float t1 = min(ta.y, tMax);
  vec2 tg = raySphere(ro, rd, RG);
  if (tg.x > 0.0) t1 = min(t1, tg.x);
  const int N = 24;
  vec3 L = vec3(0.0);
  vec3 T = vec3(1.0);
  float c = dot(rd, sunDir);
  float pr = phaseR(c);
  float pm = phaseHG(c, 0.8);
  float tPrev = 0.0;
  for (int i = 0; i < N; i++) {
    // quadratic step distribution: dense near the eye where the air is thick
    float f = (float(i) + 0.5) / float(N);
    float t = t1 * f * f;
    float dt = t1 * ((float(i) + 1.0) * (float(i) + 1.0) - float(i) * float(i)) / float(N * N);
    vec3 p = ro + rd * t;
    Medium m = medium(length(p) - RG);
    vec3 Ts = sunTransmittance(p);
    vec3 S = (m.scatR * pr + m.scatM * pm) * Ts;
    // a cheap multiple-scattering floor (Tidewater uses Hillaire's LUT for this)
    S += (m.scatR + m.scatM) * 0.018;
    vec3 stepT = exp(-m.ext * dt);
    L += T * (S - S * stepT) / max(m.ext, vec3(1e-7));
    T *= stepT;
  }
  transOut = T;
  return L * SUN_E;
}

// ---- cumulus: fair-weather cells between 1.3 and ~2.7 km
const float CB = 1.35;
const float CT = 2.35; // fair-weather cumulus: wider than they are tall
// each octave rotated off the lattice, so value noise can't leave its
// grid's diamonds and points in the cloud outlines
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8);
float fbm2(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 4; i++) { s += a * vnoise2(p); p = ROT * p * 2.03 + 1.7; a *= 0.5; }
  return s / 0.9375;
}
float coverage(vec2 p) {
  // p in km: cells ~1 km across, clumped into fields with clear sky between
  float n = fbm2(p * 0.7);
  float field = vnoise2(ROT * p * 0.12 + 11.0);
  return smoothstep(0.62, 0.82, n + (field - 0.5) * 0.3);
}
float cloudDensity(vec3 p, float cov) {
  float h = (length(p) - RG - CB) / (CT - CB);
  if (h < 0.0 || h > 1.0) return 0.0;
  // A CUMULUS, not a mountain range. The clouds used to be their 2D
  // footprint extruded straight up — vertical walls, which a low sun lit
  // into fins and spikes. Now the cross-section SHRINKS as it climbs: the
  // higher a point, the more coverage it takes to still be cloud there. So
  // every cell is a dome — widest at its flat base, sloping in, rounding
  // over at a crown as high as its coverage is strong — and the billows
  // below make that dome a cauliflower.
  float need = h * h * 0.9;
  float d = smoothstep(need, need + 0.14, cov) * smoothstep(0.0, 0.07, h) * mix(0.6, 1.0, cov);
  if (d <= 0.0) return 0.0;
  float rel = h;
  // rotated off the lattice: value noise has grid planes, and level ones
  // line up with the cloud deck as ledges
  vec3 q = mat3(0.80, 0.36, -0.48, -0.60, 0.48, -0.64, 0.0, 0.80, 0.60) * p * 2.4;
  // big rounded billows: weight on the coarse octaves (fine ones carve spikes)
  float n = vnoise3(q * 0.55) * 0.6 + vnoise3(q * 1.3 + 3.1) * 0.3 + vnoise3(q * 3.1 - 1.7) * 0.1;
  // billows eat the crown and the shoulders, barely the flat base
  d = clamp((d - (1.0 - n) * mix(0.12, 0.4, rel)) * 3.0, 0.0, 1.0);
  return d * 32.0; // extinction (/km)
}
// The march is ADAPTIVE: long strides through clear air, and the moment a
// stride lands over a cloud's FOOTPRINT (its 2D coverage — much wider than
// its dense core, so no stride can hop a thin edge and leave a texel that
// missed the cloud its neighbour hit) it steps back and walks in fine steps
// (50 m near, growing with range) until it has been clear for a while. Fixed steps
// sampled a cloud's rounded top in slices a few hundred metres apart near
// the horizon — the clouds came out terraced, like stacked plates.
vec4 clouds(vec3 ro, vec3 rd, vec3 sunCol, vec3 ambTop, vec3 ambBot, out float dist) {
  dist = 0.0;
  if (rd.y < -0.02) return vec4(0.0);
  vec2 a = raySphere(ro, rd, RG + CB);
  vec2 b = raySphere(ro, rd, RG + CT);
  float t0 = max(a.y, 0.0);
  float t1 = min(b.y, 38.0);
  if (t1 <= t0) return vec4(0.0);
  float big = mix(0.5, 0.25, smoothstep(0.05, 0.5, rd.y)) / mix(0.7, 1.0, quality);
  // NO per-texel jitter: neighbouring texels starting their march at
  // different offsets alternate hit/miss along a cloud's edge, and the
  // texture filter blows that up into a halftone of dots. The fine steps
  // are short enough not to band without it.
  float jitter = 0.5;
  vec3 L = vec3(0.0);
  float T = 1.0;
  float c = dot(rd, sunDir);
  float phase = mix(phaseHG(c, 0.55), phaseHG(c, -0.25), 0.3) * 4.0 * PI;
  float wsum = 0.0;
  float t = t0 + jitter * big;
  bool fine = false;
  int empty = 0;
  for (int i = 0; i < 220; i++) {
    if (t > t1 || T < 0.02) break;
    float fineStep = 0.05 + t * 0.004;
    vec3 p = ro + rd * t;
    float cov = coverage(p.xz);
    if (cov > 0.001 && !fine) {
      // a stride landed over a cloud's footprint: back up and walk in
      fine = true;
      empty = 0;
      t = max(t0, t - big + fineStep * jitter);
      continue;
    }
    float s = fine && cov > 0.001 ? cloudDensity(p, cov) : 0.0;
    if (cov > 0.001) empty = 0;
    if (s > 0.0) {
      // light march toward the sun
      float od = 0.0;
      float ls = 0.06;
      vec3 q = p;
      for (int j = 0; j < 5; j++) {
        q += sunDir * ls;
        od += cloudDensity(q, coverage(q.xz)) * ls;
        ls *= 1.7;
      }
      float beer = exp(-od) + 0.25 * exp(-od * 0.25); // + a soft multiple-scatter tail
      float powder = 1.0 - exp(-s * 0.12);
      float hFrac = clamp((length(p) - RG - CB) / (CT - CB), 0.0, 1.0);
      vec3 amb = mix(ambBot, ambTop, hFrac);
      vec3 S = sunCol * beer * phase * mix(0.35, 1.0, powder) * 1.15 + amb * 0.85;
      float stepT = exp(-s * fineStep);
      L += T * (1.0 - stepT) * S;
      wsum += T * (1.0 - stepT) * t;
      T *= stepT;
    } else if (fine && cov <= 0.001 && ++empty > 6) {
      fine = false;
    }
    t += fine ? fineStep : big;
  }
  float alpha = 1.0 - T;
  dist = alpha > 0.0 ? wsum / alpha : 0.0;
  return vec4(L, alpha);
}

// THE CIRRUS VEIL, 8 km up: fibrous streaks combed out along the upper
// wind, in patches. It is the sunset's best trick — up there the sun has
// not yet set, so the veil stays lit pink and gold while the cumulus
// below have gone grey. No march: a thin sheet, lit once.
const float CI = 8.0;
vec4 cirrus(vec3 ro, vec3 rd, out float dist) {
  dist = 0.0;
  if (rd.y < 0.005) return vec4(0.0);
  dist = min(raySphere(ro, rd, RG + CI).y, 250.0);
  vec3 q = ro + rd * dist;
  vec2 w = normalize(vec2(0.94, -0.34));
  vec2 sq = mat2(w.x, -w.y, w.y, w.x) * q.xz;
  float warp = fbm2(q.xz * 0.06 + 5.0) * 2.2;
  float fib = fbm2(vec2(sq.x * 0.045, sq.y * 0.5) + warp);
  float fine = vnoise2(vec2(sq.x * 0.2, sq.y * 2.4) + warp * 1.7);
  float patchK = smoothstep(0.48, 0.76, fbm2(q.xz * 0.011 + 3.0));
  float a = smoothstep(0.52, 0.84, fib * 0.8 + fine * 0.2) * patchK * 0.42;
  return vec4(sunTransmittance(q), a);
}

void main() {
  float u = vUv.x;
  float el = ${EL0.toFixed(6)} + vUv.y * (1.5707963 - (${EL0.toFixed(6)}));
  float az = (u - 0.5) * 6.2831853;
  vec3 rd = vec3(sin(az) * cos(el), sin(el), -cos(az) * cos(el));
  vec3 ro = vec3(0.0, RG + 0.003, 0.0);
  // the ground under the horizon: keep rays level so the bake stays sky
  vec3 rdA = normalize(vec3(rd.x, max(rd.y, 0.0015), rd.z));
  vec3 T;
  if (mode < 0.5) {
    gl_FragColor = vec4(atmosphere(ro, rdA, 1e9, T) * ${SKY_EXPOSURE.toFixed(3)}, 1.0);
    return;
  }

  vec3 cloudBase = ro + vec3(0.0, CB, 0.0);
  vec3 sunCol = sunTransmittance(cloudBase) * SUN_E;
  vec3 dummy;
  vec3 zen = atmosphere(ro, vec3(0.0, 1.0, 0.0), 1e9, dummy);
  vec3 hor = atmosphere(ro, normalize(vec3(-sunDir.x, 0.05, -sunDir.z)), 1e9, dummy);
  vec3 ambTop = zen * 1.0 + hor * 0.35;
  vec3 sunHor = atmosphere(ro, normalize(vec3(sunDir.x, 0.04, sunDir.z)), 1e9, dummy);
  // lit from below by the sea and the afterglow on the sunward horizon
  vec3 ambBot = hor * 0.22 + sunHor * 0.07 + vec3(0.006, 0.007, 0.008);
  float cd;
  vec4 cl = clouds(ro, rdA, sunCol, ambTop, ambBot, cd);
  vec4 outC = vec4(0.0);
  if (cl.a > 0.0) {
    // aerial perspective: far clouds sink into the haze
    vec3 Tc;
    vec3 front = atmosphere(ro, rdA, cd, Tc);
    float fade = exp(-cd / 30.0);
    vec3 col = cl.rgb * Tc + front;
    float a = cl.a * mix(0.35, 1.0, fade);
    // premultiplied: sky = atmosphere * (1 - a) + rgb
    outC = vec4(col * a * ${SKY_EXPOSURE.toFixed(3)}, a);
  }
  // the veil above them, seen through whatever cumulus is in front
  float ciD;
  vec4 ci = cirrus(ro, rdA, ciD);
  if (ci.a > 0.0) {
    float cc = dot(rdA, sunDir);
    vec3 Tci;
    vec3 front = atmosphere(ro, rdA, ciD, Tci);
    // ice crystals: a strong forward glow toward the sun, a little everywhere
    vec3 lit = ci.rgb * SUN_E * (0.18 + 3.0 * phaseHG(cc, 0.7)) + ambTop * 0.35;
    float a = ci.a * smoothstep(0.005, 0.06, rdA.y);
    vec3 col = (lit * Tci + front * 0.5) * a * ${SKY_EXPOSURE.toFixed(3)};
    outC.rgb += (1.0 - outC.a) * col;
    outC.a += (1.0 - outC.a) * a;
  }
  gl_FragColor = outC;
}
`;

export interface SkyBake {
  /** The clear sky (display-linear radiance, before the shoulder). */
  atmosphere: Texture;
  /** The clouds: premultiplied radiance in rgb, coverage in a. */
  clouds: Texture;
  /** Bake one strip; true once the whole sky is done. */
  step(renderer: WebGLRenderer): boolean;
  done: boolean;
  /** The sky at the horizon, for fog / the fallback clear (display colour). */
  horizon: Color;
  dispose(): void;
}

/** Make the baker. Nothing renders until `step()` — call it once a frame. */
export function createSkyBake(quality = 1): SkyBake {
  const target = (): WebGLRenderTarget =>
    new WebGLRenderTarget(W, H, {
      type: HalfFloatType,
      format: RGBAFormat,
      depthBuffer: false,
      // three regenerates the chain after each strip: 2k×512 half-float, trivial
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      wrapT: ClampToEdgeWrapping,
    });
  const atm = target();
  const cld = target();
  const mat = new ShaderMaterial({
    uniforms: { sunDir: { value: SUN_DIR.clone() }, quality: { value: quality }, mode: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
    `,
    fragmentShader: BAKE_FRAG,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), mat);
  quad.frustumCulled = false;
  const scene = new Scene();
  scene.add(quad);
  const cam = new Camera();
  // the clear sky is cheap: half as many strips; the clouds get the rest
  const ATM_STRIPS = STRIPS / 2;
  let strip = 0;

  const bake: SkyBake = {
    atmosphere: atm.texture,
    clouds: cld.texture,
    done: false,
    // The horizon haze in the sea-facing half, as a display colour — matches
    // what the dome shows there closely enough for the fog to melt into it.
    horizon: new Color(0.74, 0.82, 0.9),
    step(renderer) {
      if (bake.done) return true;
      const prevTarget = renderer.getRenderTarget();
      const prevXr = renderer.xr.enabled;
      const prevScissorTest = renderer.getScissorTest();
      const prevAutoClear = renderer.autoClear;
      // In an XR frame three swaps any camera for the headset's — render the
      // bake with XR off so the quad fills OUR target, then put it all back.
      renderer.xr.enabled = false;
      renderer.autoClear = false;
      const clouds = strip >= ATM_STRIPS;
      const t = clouds ? cld : atm;
      const n = clouds ? STRIPS : ATM_STRIPS;
      const i = clouds ? strip - ATM_STRIPS : strip;
      mat.uniforms.mode.value = clouds ? 1 : 0;
      renderer.setRenderTarget(t);
      const rows = H / n;
      t.scissor.set(0, i * rows, W, rows);
      t.scissorTest = true;
      renderer.render(scene, cam);
      t.scissorTest = false;
      strip++;
      if (strip >= ATM_STRIPS + STRIPS) {
        bake.done = true;
        mat.dispose();
        quad.geometry.dispose();
      }
      renderer.setRenderTarget(prevTarget);
      renderer.setScissorTest(prevScissorTest);
      renderer.autoClear = prevAutoClear;
      renderer.xr.enabled = prevXr;
      return bake.done;
    },
    dispose() {
      atm.dispose();
      cld.dispose();
    },
  };
  return bake;
}

/**
 * The visible dome: the baked sky plus the sun itself, drawn analytically
 * (a half-degree disc is three texels in the bake — it needs its own math).
 */
/** The dome's clock (the cloud drift); set from the cove's update. */
export const skyTime = { value: 0 };

/** Cloud drift: wind across the deck (km/s), the deck's height (km), and the
 *  crossfade period (s). The two copies sit wind × T/2 apart: at 1.2 m/s
 *  and 60 s that is ~1° overhead — invisible — where 2 m/s over 150 s
 *  doubled every cloud edge. */
const WIND_X = 0.0012;
const WIND_Z = 0.0003;
const DECK = 2.0;
const DRIFT_T = 60;

export function makeSkyDome(bake: SkyBake): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      atmTex: { value: bake.atmosphere },
      cloudTex: { value: bake.clouds },
      uTime: skyTime,
      sunDir: { value: SUN_DIR.clone() },
      sunTint: { value: new Color(1.0, 0.32, 0.07) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = p.xyww; // pinned to the far plane
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D atmTex;
      uniform sampler2D cloudTex;
      uniform float uTime;
      uniform vec3 sunDir;
      uniform vec3 sunTint;
      varying vec3 vDir;
      ${SKY_UV_GLSL}
      void main() {
        vec3 d = normalize(vDir);
        vec3 atm = coveSample(atmTex, d).rgb;
        // the clouds drift: slide them across a deck DECK km up, two copies a
        // half-period apart, each fading out as its offset wraps
        vec2 deck = d.xz / max(d.y, 0.02);
        float ph = uTime / ${DRIFT_T.toFixed(1)};
        float f0 = fract(ph);
        float f1 = fract(ph + 0.5);
        vec2 wind = vec2(${WIND_X}, ${WIND_Z}) * ${DRIFT_T.toFixed(1)} / ${DECK.toFixed(2)};
        vec2 p0 = deck - wind * (f0 - 0.5);
        vec2 p1 = deck - wind * (f1 - 0.5);
        vec4 c0 = coveSample(cloudTex, normalize(vec3(p0.x, 1.0, p0.y)));
        vec4 c1 = coveSample(cloudTex, normalize(vec3(p1.x, 1.0, p1.y)));
        float w0 = 1.0 - abs(2.0 * f0 - 1.0);
        vec4 moving = c0 * w0 + c1 * (1.0 - w0);
        // below the deck's reach (the horizon band) the layer stays put
        vec4 cl = mix(coveSample(cloudTex, d), moving, smoothstep(0.02, 0.08, d.y));
        vec3 c = coveTone(atm * (1.0 - cl.a) + cl.rgb);
        // the sun: a limb-darkened disc and a tight glow round it
        float cs = dot(d, sunDir);
        // a setting sun: swollen, red through the thick air, its glow wide
        float disc = smoothstep(0.99992, 0.99995, cs);
        c += mix(sunTint, vec3(1.0, 0.85, 0.6), 0.35) * disc * 6.0;
        c += sunTint * (pow(max(cs, 0.0), 600.0) * 0.9 + pow(max(cs, 0.0), 40.0) * 0.12);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const dome = new Mesh(new SphereGeometry(900, 48, 24), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  dome.name = 'cove-sky';
  return dome;
}

