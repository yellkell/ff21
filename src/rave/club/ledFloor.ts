/**
 * THE DANCE FLOOR — a live LED tile floor under black glass.
 *
 * The round floor is tiled the way a round floor should be: a centre disc,
 * then concentric bands of radial tiles (layout.json floor.tiles), so the
 * light shows can think in rings and spokes — ripples, radial EQ bars,
 * spirals — like a record seen from above. The baked venue gives the glass
 * and the chrome rim (build_club.py); this one plane draws every tile, its
 * frame and its light in a single draw.
 *
 * It plays off the club's REAL music (audio/spectrum.ts taps the bus) and
 * changes show every phrase:
 *
 *   RIPPLE  rings of tiles run out from the centre on every kick
 *   EQ      the spectrum as radial bars, bass toward the DJ, mirrored
 *   SPIRAL  arms of light turning round the floor, kicking brighter
 *   SPARKLE tiles flash at random on the hats over a slow colour wash
 *
 * and wears the playing record's sleeve (arena/spectrum/palettes.ts), so
 * the club and the raid read as one house.
 */
import { AdditiveBlending, CircleGeometry, Color, Mesh, ShaderMaterial, type Group } from 'three';
import { readBands } from '../audio/spectrum.js';
import { paletteFor } from '../arena/spectrum/palettes.js';
import { CLUB } from './config.js';

const BANDS = 16;
const KICKS = 5;
const SHOWS = 4;

export interface LedFloor {
  update(dt: number, beat: number, trackId: string | null): void;
}

export function buildLedFloor(root: Group): LedFloor {
  const F = CLUB.floor;
  const T = F.tiles;
  const mat = new ShaderMaterial({
    uniforms: {
      uS0: { value: new Color() },
      uS1: { value: new Color() },
      uS2: { value: new Color() },
      uS3: { value: new Color() },
      uAccent: { value: new Color() },
      uBands: { value: new Float32Array(BANDS) },
      uKicks: { value: new Float32Array(KICKS).fill(99) },
      uBeat: { value: 0 },
      uShow: { value: 0 },
      uNext: { value: 1 },
      uMix: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uS0; uniform vec3 uS1; uniform vec3 uS2; uniform vec3 uS3;
      uniform vec3 uAccent;
      uniform float uBands[${BANDS}];
      uniform float uKicks[${KICKS}];
      uniform float uBeat;
      uniform float uShow;
      uniform float uNext;
      uniform float uMix;
      varying vec2 vP;
      const float R0 = ${T.r0.toFixed(3)};
      const float EDGE = ${T.edge.toFixed(3)};
      const float RINGS = ${T.rings.toFixed(1)};
      const float TILE = ${T.tile.toFixed(3)};
      const float TAU = 6.2831853;

      vec3 ramp(float t) {
        t = clamp(t, 0.0, 1.0) * 3.0;
        if (t < 1.0) return mix(uS0, uS1, t);
        if (t < 2.0) return mix(uS1, uS2, t - 1.0);
        return mix(uS2, uS3, t - 2.0);
      }
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

      // One show's brightness for a tile (ring ri 0 = centre disc, sector si of n).
      float show(float s, float ri, float si, float n, float a) {
        float rn = ri / RINGS;
        if (s < 0.5) {                                   // RIPPLE
          float v = 0.0;
          for (int i = 0; i < ${KICKS}; i++) {
            float front = uKicks[i] * 11.0;               // rings per second
            v += exp(-pow((ri - front) / 0.7, 2.0)) * exp(-uKicks[i] * 1.6);
          }
          return v;
        }
        if (s < 1.5) {                                   // EQ: radial bars, bass toward the DJ (north)
          float u = abs(a) / 3.14159265;
          int bi = int(clamp(u * ${BANDS.toFixed(1)}, 0.0, ${(BANDS - 1).toFixed(1)}));
          return step(ri, uBands[bi] * (RINGS + 1.0) - 0.5);
        }
        if (s < 2.5) {                                   // SPIRAL
          float arms = 3.0;
          float f = fract((si + 0.5) / n * arms + ri * 0.09 - uBeat * 0.125);
          float kick = exp(-fract(uBeat) * 5.0);
          return smoothstep(0.55, 0.95, f) * (0.6 + kick * 0.6);
        }
        float h = hash(vec2(ri * 61.0 + si, floor(uBeat * 2.0)));  // SPARKLE
        float wash = 0.25 + 0.2 * sin(uBeat * 0.4 + rn * 4.0 + si / n * TAU);
        return max(step(0.86, h) * (1.0 - fract(uBeat * 2.0)), wash * 0.6);
      }

      void main() {
        float r = length(vP);
        float a = atan(vP.x, vP.y);                       // 0 toward the DJ (north, local +y)
        // Which tile: the centre disc, or ring ri's sector si of n.
        float band = (EDGE - R0) / RINGS;
        float ri = r < R0 ? 0.0 : min(RINGS, floor((r - R0) / band) + 1.0);
        float rIn = ri < 0.5 ? 0.0 : R0 + (ri - 1.0) * band;
        float rOut = ri < 0.5 ? R0 : rIn + band;
        float rMid = (rIn + rOut) * 0.5;
        float n = ri < 0.5 ? 1.0 : 4.0 * floor(TAU * rMid / TILE / 4.0 + 0.5);
        // Alternate rings sit half a tile round, like brickwork — no seams running the floor.
        float ang = mod(a + TAU + mod(ri, 2.0) * 0.5 / n * TAU, TAU);
        float si = floor(ang / TAU * n);
        // Distance to the tile's frame, in metres.
        float dr = min(r - rIn, rOut - r);
        float ds = ri < 0.5 ? 9.0 : min(ang - si / n * TAU, (si + 1.0) / n * TAU - ang) * r;
        float d = ri < 0.5 ? rOut - r : min(dr, ds);
        float tileMask = smoothstep(0.009, 0.022, d);
        // Diffuser: brightest mid-tile, softer to the frame.
        float diff = 0.72 + 0.28 * smoothstep(0.02, 0.16, d);
        float v = mix(show(uShow, ri, si, n, a), show(uNext, ri, si, n, a), uMix);
        float idle = 0.03;
        vec3 col = ramp(0.15 + ri / RINGS * 0.8 + v * 0.15);
        vec3 c = col * (idle + v * 1.25) * tileMask * diff;
        // A whisper of chrome down the middle of each frame.
        c += vec3(0.07, 0.07, 0.08) * (1.0 - smoothstep(0.0, 0.006, d)) ;
        c *= 1.0 - smoothstep(EDGE - 0.02, EDGE + 0.01, r);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const disc = new Mesh(new CircleGeometry(T.edge + 0.02, 128), mat);
  disc.name = 'live-led-floor';
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(F.x, 0.014, F.z);
  root.add(disc);

  const u = mat.uniforms;
  const bands = new Float32Array(BANDS);
  const kicks = u.uKicks.value as Float32Array;
  const target = [new Color(), new Color(), new Color(), new Color(), new Color()];
  const live = [u.uS0.value, u.uS1.value, u.uS2.value, u.uS3.value, u.uAccent.value] as Color[];
  let track: string | null | undefined;
  let lastBeat = -Infinity;
  let first = true;

  return {
    update(dt, beat, trackId) {
      if (trackId !== track) {
        track = trackId;
        const p = paletteFor(trackId);
        p.stops.forEach((h, i) => target[i].setHex(h));
        target[4].setHex(p.accent);
      }
      const k = first ? 1 : 1 - Math.exp(-dt * 1.5);
      first = false;
      for (let i = 0; i < 5; i++) live[i].lerp(target[i], k);

      readBands(bands, beat);
      (u.uBands.value as Float32Array).set(bands);
      if (Math.floor(beat) !== Math.floor(lastBeat) && beat > lastBeat) {
        kicks.copyWithin(1, 0);
        kicks[0] = 0;
      }
      lastBeat = beat;
      for (let i = 0; i < KICKS; i++) kicks[i] += dt;
      u.uBeat.value = beat;
      // A new show every phrase (8 bars), crossfaded over its last beat.
      const phrase = Math.floor(beat / 32);
      u.uShow.value = ((phrase % SHOWS) + SHOWS) % SHOWS;
      u.uNext.value = (((phrase + 1) % SHOWS) + SHOWS) % SHOWS;
      u.uMix.value = Math.max(0, (beat % 32) - 31);
    },
  };
}
