/**
 * THE LED WALL behind the DJ — a VJ rig on the GPU.
 *
 * The baked venue ships the wall's face as a LIVE mesh ('live-ledwall', UVs
 * 0..1, 12.8 m wide); this paints it at full frame rate, off the club's real
 * music (audio/spectrum.ts) and in the playing record's sleeve
 * (arena/spectrum/palettes.ts) — the same colours as the dance floor, so
 * the room plays as one. A new scene every phrase, crossfaded:
 *
 *   HALO    the spectrum as a ring of radial bars round a core that kicks —
 *           the raid's record, seen face on
 *   TUNNEL  rounded-square rings rushing out of the wall, each lit by the
 *           band it carries
 *   RIDGES  sixteen lines of spectrum history stacked into a mountain range,
 *           each hiding the ones behind it
 *   TITLE   the record's name, filled by a sweeping gradient, over faint bars
 *
 * And it IS an LED wall: everything lands on a 768 × 280 grid of round
 * emitters (a 16.7 mm pitch) on a black face, in 500 mm cabinets with
 * hairline seams — visible on the stage, smoothed to its average from the
 * floor so the dot grid never shimmers.
 */
import {
  CanvasTexture,
  Color,
  DataTexture,
  LinearFilter,
  RedFormat,
  SRGBColorSpace,
  ShaderMaterial,
  UnsignedByteType,
  type Mesh,
} from 'three';
import { readBands } from '../audio/spectrum.js';
import { paletteFor } from '../arena/spectrum/palettes.js';

const RES_X = 768;
const RES_Y = 280;
/** LEDs per 500 mm cabinet across a 12.8 m face. */
const CAB = RES_X / 25.6;
const BANDS = 32;
const HIST = 16;
const SCENES = 4;

let mat: ShaderMaterial | null = null;
const bands = new Float32Array(BANDS);
const hist = new Uint8Array(BANDS * HIST);
let histTex: DataTexture | null = null;
let sinceRow = 0;
let track: string | null | undefined;
const titleCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
let titleTex: CanvasTexture | null = null;
const target = [new Color(), new Color(), new Color(), new Color(), new Color()];
let first = true;

function drawTitle(title: string, kana: string): void {
  if (!titleCanvas || !titleTex) return;
  const g = titleCanvas.getContext('2d')!;
  const W = titleCanvas.width;
  const H = titleCanvas.height;
  g.clearRect(0, 0, W, H);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(H * 0.5)}px Bahnschrift, 'Arial Black', sans-serif`;
  g.fillText(title, W / 2, H * 0.42, W * 0.9);
  g.font = `600 ${Math.round(H * 0.13)}px 'Yu Gothic', 'Meiryo', sans-serif`;
  g.fillText(kana, W / 2, H * 0.82, W * 0.8);
  titleTex.needsUpdate = true;
}

/** Paint the LED wall's live mesh once the venue has delivered it. */
export function adoptLedWall(mesh: Mesh): void {
  histTex = new DataTexture(hist, BANDS, HIST, RedFormat, UnsignedByteType);
  histTex.magFilter = LinearFilter;
  histTex.minFilter = LinearFilter;
  histTex.needsUpdate = true;
  if (titleCanvas) {
    titleCanvas.width = 1024;
    titleCanvas.height = 256;
    titleTex = new CanvasTexture(titleCanvas);
    titleTex.colorSpace = SRGBColorSpace;
  }
  mat = new ShaderMaterial({
    uniforms: {
      uS0: { value: new Color() },
      uS1: { value: new Color() },
      uS2: { value: new Color() },
      uS3: { value: new Color() },
      uAccent: { value: new Color() },
      uBands: { value: bands },
      uHist: { value: histTex },
      uTitle: { value: titleTex },
      uBeat: { value: 0 },
      uScene: { value: 0 },
      uNext: { value: 1 },
      uMix: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = vec2(uv.x, 1.0 - uv.y);                      // glTF UVs run top-down
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uS0; uniform vec3 uS1; uniform vec3 uS2; uniform vec3 uS3;
      uniform vec3 uAccent;
      uniform float uBands[${BANDS}];
      uniform sampler2D uHist;
      uniform sampler2D uTitle;
      uniform float uBeat;
      uniform float uScene;
      uniform float uNext;
      uniform float uMix;
      varying vec2 vUv;
      const vec2 RES = vec2(${RES_X.toFixed(1)}, ${RES_Y.toFixed(1)});
      const float ASPECT = ${(RES_X / RES_Y).toFixed(4)};
      const float PI = 3.14159265;

      vec3 ramp(float t) {
        t = clamp(t, 0.0, 1.0) * 3.0;
        if (t < 1.0) return mix(uS0, uS1, t);
        if (t < 2.0) return mix(uS1, uS2, t - 1.0);
        return mix(uS2, uS3, t - 2.0);
      }
      float band(float u) {                  // 0 = bass .. 1 = treble, interpolated
        float b = clamp(u, 0.0, 1.0) * ${(BANDS - 1).toFixed(1)};
        int i = int(floor(b));
        int j = min(i + 1, ${BANDS - 1});
        return mix(uBands[i], uBands[j], fract(b));
      }
      float kick() { return exp(-fract(uBeat) * 5.0); }

      // p: centred, height-normalised (y -0.5..0.5, x -ASPECT/2..ASPECT/2)
      vec3 halo(vec2 p) {
        float r = length(p);
        float a = atan(p.x, p.y);                          // 0 at the top, mirrored left/right
        float u = abs(a) / PI;
        float bars = 72.0;
        float slot = fract(abs(a) / PI * bars * 0.5);
        float lev = band(1.0 - u);
        float r0 = 0.105 + kick() * 0.01;
        float len = 0.02 + lev * 0.16;
        float bar = step(r0, r) * step(r, r0 + len) * smoothstep(0.08, 0.2, slot) * smoothstep(0.92, 0.8, slot);
        vec3 c = ramp((r - r0) / 0.18) * bar * 1.3;
        c += uAccent * exp(-abs(r - r0 + 0.008) * 220.0) * (0.8 + kick());      // the core ring
        c += ramp(0.1) * exp(-r * 6.0) * 0.18 * (0.5 + kick());               // the bloom inside
        float rays = pow(abs(sin(a * 9.0 + uBeat * 0.2)), 12.0) * smoothstep(r0 + 0.26, r0, r) * step(r0, r);
        c += ramp(0.3) * rays * 0.12;                                          // god-rays behind the bars
        // The wings: the same spectrum as mirrored columns running out to both edges.
        float ax = abs(p.x);
        if (ax > 0.33) {
          float wu = (ax - 0.33) / (ASPECT * 0.5 - 0.33);
          float col = fract(ax * 30.0);
          float wl = band(wu * 0.9);
          float hgt = 0.015 + wl * 0.2 * (1.0 - wu * 0.45);
          float wb = step(abs(p.y), hgt) * smoothstep(0.12, 0.25, col) * smoothstep(0.88, 0.75, col);
          float seg = smoothstep(0.15, 0.35, fract(abs(p.y) * 90.0));
          c += ramp(abs(p.y) / 0.2) * wb * seg * (1.0 - wu * 0.3);
        }
        return c;
      }
      vec3 tunnel(vec2 p) {
        vec3 c = vec3(0.0);
        float rot = uBeat * 0.03;
        p = mat2(cos(rot), -sin(rot), sin(rot), cos(rot)) * p;
        for (int i = 0; i < 12; i++) {
          float z = fract(float(i) / 12.0 + uBeat * 0.0625);        // 0 far .. 1 near
          float s = 0.02 + z * z * 0.5;
          vec2 q = abs(p) - vec2(s * ${(RES_X / RES_Y * 0.88).toFixed(3)}, s) + 0.06 * s;
          float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 0.06 * s;   // rounded rectangle
          float w = 0.0025 + z * 0.012;
          float lev = band(float(i) / 12.0);
          c += ramp(z) * smoothstep(w, 0.0, abs(d)) * (0.3 + lev * 1.2) * smoothstep(0.0, 0.15, z);
        }
        c += ramp(0.0) * exp(-length(p) * 5.0) * (0.25 + kick() * 0.25);       // light at the end of it
        return c;
      }
      vec3 ridges(vec2 uv) {
        // Rows of history: 0 = now (front, low on the wall) .. HIST-1 (back, high).
        vec3 c = vec3(0.0);
        float x = uv.x;
        float u = abs(x - 0.5) * 2.0;                           // bass in the middle, mirrored
        float occl = 0.0;
        for (int i = 0; i < ${HIST}; i++) {
          float fi = float(i);
          float base = 0.2 + fi * 0.032;
          float h = texture2D(uHist, vec2(u * ${((BANDS - 1) / BANDS).toFixed(4)} + ${(0.5 / BANDS).toFixed(4)}, (fi + 0.5) / ${HIST.toFixed(1)})).r;
          float env = smoothstep(1.0, 0.35, u);                  // the range rises in the middle
          float y = base + h * 0.15 * env;
          float vis = 1.0 - occl;
          float line = smoothstep(0.006, 0.0, abs(uv.y - y)) * vis;
          vec3 rc = ramp(1.0 - fi / ${HIST.toFixed(1)});
          c += rc * line * (1.25 - fi * 0.05);
          c += rc * step(uv.y, y) * vis * 0.045 * (1.0 - fi / ${HIST.toFixed(1)});   // the range's face
          occl = max(occl, step(uv.y, y));                       // anything below this line is hidden behind it
        }
        return c;
      }
      vec3 title(vec2 uv) {
        vec2 t = vec2((uv.x - 0.5) * 1.25 + 0.5, (uv.y - 0.47) * 2.2 + 0.5);
        float m = (t.x > 0.0 && t.x < 1.0 && t.y > 0.0 && t.y < 1.0) ? texture2D(uTitle, vec2(t.x, t.y)).a : 0.0;
        float sweep = fract(uv.x * 0.6 - uBeat * 0.125);
        vec3 c = ramp(sweep) * m * (1.0 + kick() * 0.4);
        // faint bars under it
        float bx = floor(uv.x * 48.0) / 48.0;
        float lev = band(abs(bx - 0.5) * 2.0);
        float bar = step(uv.y, 0.18 + lev * 0.4) * smoothstep(0.1, 0.3, fract(uv.x * 48.0)) * smoothstep(0.9, 0.7, fract(uv.x * 48.0));
        c += ramp(uv.y * 2.0) * bar * 0.18 * (1.0 - m);
        return c;
      }
      vec3 scene(float s, vec2 uv, vec2 p) {
        if (s < 0.5) return halo(p);
        if (s < 1.5) return tunnel(p);
        if (s < 2.5) return ridges(uv);
        return title(uv);
      }

      void main() {
        // Every scene lands on the LED grid: content sampled at each emitter's centre.
        vec2 g = vUv * RES;
        vec2 cell = (floor(g) + 0.5) / RES;
        // From the floor the booth hides the wall below ~1.6 m and the proscenium cuts it
        // above ~4.2 m (uv 0.18 .. 0.74): every scene composes round the middle of that band.
        vec2 p = vec2((cell.x - 0.5) * ASPECT, cell.y - 0.46);
        vec3 c = mix(scene(uScene, cell, p), scene(uNext, cell, p), uMix);
        c += ramp(0.0) * (0.025 + kick() * 0.03) * smoothstep(0.75, 0.15, cell.y);   // a low glow under every scene
        // The emitters: round dots on a black face, in 500 mm cabinets.
        vec2 f = fract(g) - 0.5;
        float dotm = smoothstep(0.46, 0.3, length(f)) * 1.9;
        vec2 cab = abs(fract(g / ${CAB.toFixed(3)}) - 0.5) * ${CAB.toFixed(3)};
        float seam = smoothstep(0.0, 0.25, min(${(CAB / 2).toFixed(3)} - cab.x, ${(CAB / 2).toFixed(3)} - cab.y));
        // From the floor the grid is finer than a pixel: show its average.
        vec2 w = fwidth(g);
        float far = smoothstep(0.35, 0.9, max(w.x, w.y));
        float led = mix(dotm * mix(0.55, 1.0, seam), 1.0, far);
        vec3 face = vec3(0.010, 0.010, 0.013) * (1.0 - far * 0.5);
        gl_FragColor = vec4(face + min(c, vec3(1.6)) * led, 1.0);
        #include <colorspace_fragment>
      }`,
    fog: false,
  });
  mesh.material = mat;
}

export function updateLedWall(dt: number, beat: number, trackId: string | null, trackTitle: string | null): void {
  if (!mat || !histTex) return;
  const u = mat.uniforms;
  if (trackId !== track) {
    track = trackId;
    const p = paletteFor(trackId);
    p.stops.forEach((h, i) => target[i].setHex(h));
    target[4].setHex(p.accent);
    drawTitle((trackTitle ?? 'NEON DISTRICT').toUpperCase(), 'ネオン・ディストリクト · アリーナ II');
  }
  const k = first ? 1 : 1 - Math.exp(-dt * 1.5);
  first = false;
  [u.uS0, u.uS1, u.uS2, u.uS3, u.uAccent].forEach((x, i) => (x.value as Color).lerp(target[i], k));

  readBands(bands, beat);
  // The ridges' history: a new front row 15 times a second, the rest pushed back.
  sinceRow += dt;
  if (sinceRow >= 1 / 15) {
    sinceRow = 0;
    hist.copyWithin(BANDS, 0, BANDS * (HIST - 1));
    for (let b = 0; b < BANDS; b++) hist[b] = Math.round(Math.min(1, bands[b]) * 255);
    histTex.needsUpdate = true;
  }
  u.uBeat.value = beat;
  const phrase = Math.floor(beat / 32);
  u.uScene.value = ((phrase % SCENES) + SCENES) % SCENES;
  u.uNext.value = (((phrase + 1) % SCENES) + SCENES) % SCENES;
  u.uMix.value = Math.max(0, (((beat % 32) + 32) % 32) - 31);
}
