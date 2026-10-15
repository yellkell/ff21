/**
 * SPECTRUM — the set's world is the record itself.
 *
 *   THE WALL   a 360° equaliser rings the horizon (r 52 m, 168 columns of
 *              LED segments up to 30 m tall). It IS the track's spectrum,
 *              live off the music bus (audio/spectrum.ts): bass stands
 *              behind the boss — every client faces the stage, so everyone
 *              sees the bass towers across the floor — and the treble
 *              runs round to the wall at your back. Peak-hold caps hang
 *              and fall; a chase line runs the circle every bar.
 *   THE RECORD a colossal vinyl hangs in the sky over the far wall, turned
 *              square to you (so it reads as a true disc with its label
 *              dead centre, not a skewed ellipse), spinning, grooves lit
 *              by the band they'd carry, a sheen sweeping round as it
 *              spins. It MOVES on purpose — a slow pendulum sway across
 *              the sky every 16 bars, a breathing rise and fall, the lazy
 *              wobble of a warped pressing — but it never THROBS: no jump
 *              on the kick, no flashing playhead, and its light follows
 *              the music and the danger duck on a slow ease. It is the
 *              biggest thing in the sky; anything it does on the beat
 *              pulls the eye off the landings.
 *              The playhead IS the set's progress: the tone-arm laser
 *              starts at the outer groove on the first beat and reaches
 *              the label on the last — you can read how much set is left
 *              in the sky.
 *   THE GLASS  every kick sends a ring racing out across the floor from the
 *              edge of the ring, bent into the waveform of the moment.
 *   THE AIR    laser fans from the wall's crest cross over the ring; the
 *              horizon glows with the bass.
 *
 * Every song wears its own sleeve (palettes.ts) — wall gradient, grooves,
 * ripples, horizon, lasers — eased in as the record changes.
 *
 * Ring rules hold: nothing inside r 11.5 on the floor, nothing over the
 * decks below 25 m, and no sleeve ever speaks danger's colours. `energy`
 * arrives pre-ducked, so a telegraph on your deck dims the whole record.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Quaternion,
  RingGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { currentTrack } from '../../audio/music.js';
import { readBands } from '../../audio/spectrum.js';
import { setEndBeat } from '../../game/state.js';
import { paletteFor, type Palette } from './palettes.js';

const WALL_R = 52;
const WALL_N = 168;
const WALL_H = 30;
const SEG = 1.05;
const BANDS = 32;
const GROOVE_BANDS = 16;
const FLOOR_IN = 11.5;
const FLOOR_OUT = 72;
const KICKS = 6;
const RIPPLE_SPEED = 15;

const REC = {
  y: 52,
  z: -78,
  rIn: 8,
  rOut: 44,
  /** The pendulum: metres either side of centre, over this many beats. */
  sway: 11,
  swayBeats: 64,
  /** The breath: metres up and down, over this many beats. */
  rise: 3,
  riseBeats: 32,
  /** The warp: radians the face wobbles off square, over this many beats. */
  warp: 0.06,
  warpBeats: 16,
  /** How fast the record's light follows the music and the duck (1/s) —
   *  slow, so it swells instead of flickering. */
  ease: 1.2,
};
/** Who the record turns to face: the dancer's eye, at the world origin (the
 *  raid seats everyone there; the foyer and VOIDSTEP spawn there). */
const VIEWER = new Vector3(0, 1.6, 0);
const _viewer = new Vector3();
const FANS = [-1.05, -0.35, 0.35, 1.05];
const BEAMS_PER_FAN = 6;
const LASER_LEN = 140;

/* ── shared GLSL ──────────────────────────────────────────────────────── */
const RAMP = /* glsl */ `
  uniform vec3 uS0; uniform vec3 uS1; uniform vec3 uS2; uniform vec3 uS3;
  vec3 ramp(float t) {
    t = clamp(t, 0.0, 1.0) * 3.0;
    if (t < 1.0) return mix(uS0, uS1, t);
    if (t < 2.0) return mix(uS1, uS2, t - 1.0);
    return mix(uS2, uS3, t - 2.0);
  }`;

const stopUniforms = () => ({
  uS0: { value: new Color() },
  uS1: { value: new Color() },
  uS2: { value: new Color() },
  uS3: { value: new Color() },
});

/* ── the wall ─────────────────────────────────────────────────────────── */
function wallMaterial(mirror: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...stopUniforms(),
      uPeak: { value: new Color() },
      uGain: { value: 1 },
      uChase: { value: 0 },
      uMirror: { value: mirror ? 1 : 0 },
    },
    vertexShader: /* glsl */ `
      attribute float aLevel;
      attribute float aPeak;
      attribute float aAngle;
      varying float vY;
      varying float vLevel;
      varying float vPeak;
      varying float vAngle;
      varying float vFront;
      varying float vX;
      void main() {
        // The column's body only stands as tall as its peak cap: open sky above.
        vec3 pos = position;
        pos.y *= min(1.0, aPeak + 0.06);
        vY = pos.y;
        vX = pos.x;
        vLevel = aLevel;
        vPeak = aPeak;
        vAngle = aAngle;
        vFront = step(0.5, normal.z);
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${RAMP}
      uniform vec3 uPeak;
      uniform float uGain;
      uniform float uChase;
      uniform float uMirror;
      varying float vY;
      varying float vLevel;
      varying float vPeak;
      varying float vAngle;
      varying float vFront;
      varying float vX;
      void main() {
        float y = vY * ${WALL_H.toFixed(1)};
        float f = fract(y / ${SEG.toFixed(2)});
        float cell = smoothstep(0.18, 0.26, f) * smoothstep(0.98, 0.92, f) * smoothstep(0.5, 0.42, abs(vX));
        float lvl = vLevel * ${WALL_H.toFixed(1)};
        float lit = step(y, lvl);
        float lead = smoothstep(lvl - ${(SEG * 1.5).toFixed(2)}, lvl, y) * lit;
        vec3 col = ramp(y / ${WALL_H.toFixed(1)} * 1.1);
        // The chase: a bright line running the circle once a bar.
        float d = abs(mod(vAngle - uChase + 3.14159265, 6.2831853) - 3.14159265);
        float chase = exp(-d * d * 220.0);
        vec3 c = col * cell * (lit * (0.75 + 1.1 * lead + chase * 1.2) + (1.0 - lit) * (0.012 + chase * 0.2));
        float pk = vPeak * ${WALL_H.toFixed(1)} + ${(SEG * 0.6).toFixed(2)};
        float cap = (1.0 - smoothstep(0.0, ${(SEG * 0.16).toFixed(3)}, abs(y - pk))) * smoothstep(0.5, 0.42, abs(vX));
        c += uPeak * cap * 1.6;
        c *= mix(0.32, 1.0, vFront) * uGain;
        // The reflection: dimmer, and gone a few metres down into the glass.
        c *= mix(1.0, 0.42 * exp(-y * 0.075), uMirror);
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    side: mirror ? DoubleSide : 0,
  });
}

/* ── the record ───────────────────────────────────────────────────────── */
function vinylMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...stopUniforms(),
      uAccent: { value: new Color() },
      uRot: { value: 0 },
      uPlay: { value: REC.rOut },
      uGain: { value: 1 },
      uBands: { value: new Float32Array(GROOVE_BANDS) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${RAMP}
      uniform vec3 uAccent;
      uniform float uRot;
      uniform float uPlay;
      uniform float uGain;
      uniform float uBands[${GROOVE_BANDS}];
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float th = atan(vP.y, vP.x);
        float t = (r - ${REC.rIn.toFixed(1)}) / ${(REC.rOut - REC.rIn).toFixed(1)};
        // Grooves: fine lit lines, fading to their average where they'd crawl.
        float g = r * 1.1;
        float d = abs(fract(g) - 0.5);
        float groove = smoothstep(0.36, 0.46, d);
        groove = mix(groove, 0.2, smoothstep(0.25, 0.6, fwidth(g)));
        int bi = int(clamp((1.0 - t) * ${GROOVE_BANDS.toFixed(1)}, 0.0, ${(GROOVE_BANDS - 1).toFixed(1)}));
        float band = uBands[bi];
        // Light on vinyl: one bright sheen through the spindle, turning with the record.
        float sheen = pow(abs(cos(th - uRot)), 18.0);
        float played = r > uPlay ? 0.45 : 1.0;
        vec3 col = ramp(1.0 - t);
        vec3 c = col * groove * (0.16 + band * 0.9 + sheen * 0.9) * played;
        // The playhead: a lit ring where the needle is.
        float head = exp(-abs(r - uPlay) * 1.4) * 1.4;
        c += uAccent * head;
        // The lead-out and lead-in edges.
        c += col * (exp(-abs(r - ${REC.rOut.toFixed(1)}) * 2.0) + exp(-abs(r - ${REC.rIn.toFixed(1)}) * 2.0)) * 0.8;
        gl_FragColor = vec4(c * uGain, 1.0);
        #include <colorspace_fragment>
      }`,
    side: DoubleSide,
  });
}

/* ── the glass ────────────────────────────────────────────────────────── */
function rippleMaterial(floorIn: number): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: {
      ...stopUniforms(),
      uAccent: { value: new Color() },
      uKicks: { value: new Float32Array(KICKS).fill(99) },
      uBands: { value: new Float32Array(GROOVE_BANDS) },
      uGain: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main() {
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${RAMP}
      uniform vec3 uAccent;
      uniform float uKicks[${KICKS}];
      uniform float uBands[${GROOVE_BANDS}];
      uniform float uGain;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float th = atan(vP.x, -vP.y);              // 0 toward the far side (the bass)
        int bi = int(clamp(abs(th) / 3.14159265 * ${GROOVE_BANDS.toFixed(1)}, 0.0, ${(GROOVE_BANDS - 1).toFixed(1)}));
        float wob = uBands[bi] * 1.6 * sin(th * 9.0 + r * 0.15);
        float ring = 0.0;
        for (int i = 0; i < ${KICKS}; i++) {
          float age = uKicks[i];
          float rr = ${floorIn.toFixed(2)} + age * ${RIPPLE_SPEED.toFixed(1)};
          float w = 0.18 + age * 0.35;
          float x = (r - rr - wob * min(1.0, age * 2.0)) / w;
          ring += exp(-x * x) * exp(-age * 1.1);
        }
        // A faint polar grid: spokes every 7.5°, circles every 6 m.
        float sp = abs(fract(th / 6.2831853 * 48.0) - 0.5);
        float spoke = 1.0 - smoothstep(0.0, fwidth(th / 6.2831853 * 48.0) * 1.5, 0.5 - sp);
        float cr = abs(fract(r / 6.0) - 0.5);
        float circ = 1.0 - smoothstep(0.0, fwidth(r / 6.0) * 1.5, 0.5 - cr);
        float grid = max(spoke, circ) * 0.07;
        float fade = smoothstep(${floorIn.toFixed(2)}, ${(floorIn + 2).toFixed(2)}, r) * (1.0 - smoothstep(${(FLOOR_OUT - 18).toFixed(1)}, ${FLOOR_OUT.toFixed(1)}, r));
        vec3 col = mix(ramp(0.35 + r / ${FLOOR_OUT.toFixed(1)} * 0.5), uAccent, 0.25);
        gl_FragColor = vec4(col * (ring * 1.3 + grid) * fade * uGain, 1.0);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
  });
}

/* ── the sky ──────────────────────────────────────────────────────────── */
function skyMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uHorizon: { value: new Color() }, uGain: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uHorizon;
      uniform float uGain;
      varying vec3 vDir;
      void main() {
        float el = normalize(vDir).y;
        float up = max(el, 0.0);
        float glow = exp(-up * 9.0) * 0.8 + exp(-up * 2.5) * 0.18;
        float down = exp(max(-el, 0.0) * -16.0) * 0.35;       // its reflection in the glass
        gl_FragColor = vec4(uHorizon * (el >= 0.0 ? glow : down) * uGain, 1.0);
        #include <colorspace_fragment>
      }`,
    side: BackSide,
    depthWrite: false,
  });
}

/* ── the label ────────────────────────────────────────────────────────── */
function drawLabel(canvas: HTMLCanvasElement, title: string, p: Palette): void {
  const g = canvas.getContext('2d')!;
  const S = canvas.width;
  const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
  g.clearRect(0, 0, S, S);
  const bg = g.createRadialGradient(S / 2, S / 2, S * 0.05, S / 2, S / 2, S / 2);
  bg.addColorStop(0, hex(p.stops[2]));
  bg.addColorStop(0.55, hex(p.stops[1]));
  bg.addColorStop(1, hex(p.stops[0]));
  g.fillStyle = bg;
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = S * 0.006;
  for (const r of [0.47, 0.3]) {
    g.beginPath();
    g.arc(S / 2, S / 2, S * r, 0, Math.PI * 2);
    g.stroke();
  }
  g.fillStyle = '#ffffff';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `900 ${Math.round(S * 0.11)}px Bahnschrift, 'Arial Black', sans-serif`;
  g.fillText(title, S / 2, S * 0.38, S * 0.8);
  g.font = `600 ${Math.round(S * 0.045)}px Bahnschrift, sans-serif`;
  g.fillText(`${p.name} · SIDE A · 33⅓`, S / 2, S * 0.64);
  // Ring text round the rim.
  const ring = 'NEON DISTRICT RECORDS · ARENA II · ';
  g.font = `700 ${Math.round(S * 0.034)}px Bahnschrift, sans-serif`;
  for (let i = 0; i < ring.length * 2; i++) {
    const a = (i / (ring.length * 2)) * Math.PI * 2;
    g.save();
    g.translate(S / 2 + Math.sin(a) * S * 0.42, S / 2 - Math.cos(a) * S * 0.42);
    g.rotate(a);
    g.fillText(ring[i % ring.length], 0, 0);
    g.restore();
  }
  // The spindle hole.
  g.fillStyle = '#000';
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.025, 0, Math.PI * 2);
  g.fill();
}

/* ════════════════════════════════════════════════════════════════════════ */

export class SpectrumSet {
  readonly root = new Group();
  /** The sleeve being worn (the light rig reads its lasers). */
  palette: Palette = paletteFor(null);

  private wall: InstancedMesh;
  private wallMats: ShaderMaterial[];
  private level: InstancedBufferAttribute;
  private peak: InstancedBufferAttribute;
  private peakHold = new Float32Array(WALL_N);
  private colBand = new Float32Array(WALL_N);
  private colGain = new Float32Array(WALL_N);
  private bands = new Float32Array(BANDS);
  private grooves = new Float32Array(GROOVE_BANDS);
  /** The record's slow copies (see REC.ease). */
  private recBands = new Float32Array(GROOVE_BANDS);
  private recGain = 0.7;

  private disc: Mesh;
  private vinyl: ShaderMaterial;
  private label: Mesh;
  private labelCanvas = document.createElement('canvas');
  private labelTex: CanvasTexture;
  private arm: Mesh;
  private armMat: MeshBasicMaterial;
  private flare: Mesh;

  private ripple: ShaderMaterial;
  private kicks = new Float32Array(KICKS).fill(99);
  private lastBeat = -Infinity;

  private sky: ShaderMaterial;
  private lasers: InstancedMesh;
  private laserMat: MeshBasicMaterial;
  private emitters: Vector3[] = [];

  private trackId: string | null = null;
  private target = { s: [new Color(), new Color(), new Color(), new Color()], peak: new Color(), accent: new Color(), horizon: new Color() };
  private live = { s: [new Color(), new Color(), new Color(), new Color()], peak: new Color(), accent: new Color(), horizon: new Color() };
  private laserCols: Color[] = [];
  /** The record's turn so far (radians). */
  private spin = 0;

  /** `parent` takes the set's root. `floorIn`: where the glass starts (outside whatever stands in the middle). */
  constructor(parent: Object3D, { floorIn = FLOOR_IN }: { floorIn?: number } = {}) {
    this.root.name = 'set-spectrum';
    this.root.visible = false;

    // ── the wall (and its reflection, sharing every buffer) ──────────────
    const col = new BoxGeometry(1.45, 1, 0.7);
    col.translate(0, 0.5, 0);
    this.level = new InstancedBufferAttribute(new Float32Array(WALL_N), 1);
    this.peak = new InstancedBufferAttribute(new Float32Array(WALL_N), 1);
    const angle = new InstancedBufferAttribute(new Float32Array(WALL_N), 1);
    col.setAttribute('aLevel', this.level);
    col.setAttribute('aPeak', this.peak);
    col.setAttribute('aAngle', angle);
    this.wallMats = [wallMaterial(false), wallMaterial(true)];
    this.wall = new InstancedMesh(col, this.wallMats[0], WALL_N);
    const m = new Matrix4();
    const q = new Quaternion();
    const up = new Vector3(0, 1, 0);
    for (let k = 0; k < WALL_N; k++) {
      const th = (k / WALL_N) * Math.PI * 2;
      q.setFromAxisAngle(up, -th);
      m.compose(new Vector3(Math.sin(th) * WALL_R, 0, -Math.cos(th) * WALL_R), q, new Vector3(1, WALL_H, 1));
      this.wall.setMatrixAt(k, m);
      angle.setX(k, th);
      // Bass across the floor from you, treble round at your back — mirrored
      // left/right, so the wall reads as one designed shape.
      const u = Math.abs(((th + Math.PI) % (Math.PI * 2)) - Math.PI) / Math.PI;
      this.colBand[k] = u * (BANDS - 1);
      this.colGain[k] = 0.82 + 0.18 * Math.abs(Math.sin(k * 12.9898));
    }
    this.wall.frustumCulled = false;
    this.root.add(this.wall);
    const reflection = new InstancedMesh(col, this.wallMats[1], WALL_N);
    reflection.instanceMatrix = this.wall.instanceMatrix;
    reflection.frustumCulled = false;
    const mirror = new Group();
    mirror.scale.y = -1;
    mirror.position.y = -0.12;
    mirror.add(reflection);
    this.root.add(mirror);

    // ── the record ───────────────────────────────────────────────────────
    this.vinyl = vinylMaterial();
    this.disc = new Mesh(new RingGeometry(REC.rIn, REC.rOut, 256, 1), this.vinyl);
    this.disc.position.set(0, REC.y, REC.z);
    this.disc.frustumCulled = false;
    this.root.add(this.disc);
    this.labelCanvas.width = this.labelCanvas.height = 512;
    this.labelTex = new CanvasTexture(this.labelCanvas);
    this.labelTex.colorSpace = SRGBColorSpace;
    this.label = new Mesh(
      new CircleGeometry(REC.rIn, 96),
      new MeshBasicMaterial({ map: this.labelTex, side: DoubleSide, fog: false }),
    );
    this.disc.add(this.label);
    this.label.position.z = 0.05;

    // The tone arm: a laser from the wall's crest to the needle.
    this.armMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
    const armGeo = new CylinderGeometry(0.16, 0.16, 1, 8, 1, true);
    armGeo.translate(0, 0.5, 0);
    this.arm = new Mesh(armGeo, this.armMat);
    this.arm.frustumCulled = false;
    this.root.add(this.arm);
    this.flare = new Mesh(new SphereGeometry(1.1, 16, 12), this.armMat);
    this.root.add(this.flare);

    // ── the glass ────────────────────────────────────────────────────────
    this.ripple = rippleMaterial(floorIn);
    const glass = new Mesh(new RingGeometry(floorIn, FLOOR_OUT, 192, 8), this.ripple);
    glass.rotation.x = -Math.PI / 2;
    glass.position.y = -0.04;
    glass.frustumCulled = false;
    this.root.add(glass);

    // ── the sky ──────────────────────────────────────────────────────────
    this.sky = skyMaterial();
    const dome = new Mesh(new SphereGeometry(135, 48, 24), this.sky);
    dome.renderOrder = -1;
    dome.frustumCulled = false;
    this.root.add(dome);

    // ── laser fans off the wall's crest ──────────────────────────────────
    const beam = new CylinderGeometry(0.07, 0.07, 1, 5, 1, true);
    beam.translate(0, 0.5, 0);
    this.laserMat = new MeshBasicMaterial({ transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
    this.lasers = new InstancedMesh(beam, this.laserMat, FANS.length * BEAMS_PER_FAN);
    this.lasers.frustumCulled = false;
    for (const th of FANS) this.emitters.push(new Vector3(Math.sin(th) * (WALL_R - 1), 31, -Math.cos(th) * (WALL_R - 1)));
    for (let i = 0; i < FANS.length * BEAMS_PER_FAN; i++) this.lasers.setColorAt(i, new Color());
    this.root.add(this.lasers);

    this.setPalette(paletteFor(null), null, true);
    parent.add(this.root);
  }

  setActive(on: boolean): void {
    if (this.root.visible !== on) this.root.visible = on;
  }

  get active(): boolean {
    return this.root.visible;
  }

  setPalette(p: Palette, title: string | null, snap = false): void {
    this.palette = p;
    p.stops.forEach((h, i) => this.target.s[i].setHex(h));
    this.target.peak.setHex(p.peak);
    this.target.accent.setHex(p.accent);
    this.target.horizon.setHex(p.horizon);
    this.laserCols = p.lasers.map((h) => new Color(h));
    drawLabel(this.labelCanvas, title ?? 'SPECTRUM', p);
    this.labelTex.needsUpdate = true;
    if (snap) this.ease(1);
  }

  /** Ease every live colour toward the sleeve (k = 1 snaps). */
  private ease(k: number): void {
    for (let i = 0; i < 4; i++) this.live.s[i].lerp(this.target.s[i], k);
    this.live.peak.lerp(this.target.peak, k);
    this.live.accent.lerp(this.target.accent, k);
    this.live.horizon.lerp(this.target.horizon, k);
    const stops = (u: Record<string, { value: unknown }>): void => {
      for (let i = 0; i < 4; i++) (u[`uS${i}`].value as Color).copy(this.live.s[i]);
    };
    for (const w of this.wallMats) {
      stops(w.uniforms);
      (w.uniforms.uPeak.value as Color).copy(this.live.peak);
    }
    stops(this.vinyl.uniforms);
    (this.vinyl.uniforms.uAccent.value as Color).copy(this.live.accent);
    stops(this.ripple.uniforms);
    (this.ripple.uniforms.uAccent.value as Color).copy(this.live.accent);
    (this.sky.uniforms.uHorizon.value as Color).copy(this.live.horizon);
    this.armMat.color.copy(this.live.accent);
  }

  /**
   * `beat` is the continuous song beat, `act` 0..3, `energy` 0..1 (pre-ducked).
   * Outside a set (the foyer, VOIDSTEP) the caller names the record
   * (`trackId`/`title` — its sleeve and label), how far through it the
   * needle is (`progress` 0..1), and `live` when its music is on the bus
   * but isn't a record (the course's kit).
   */
  update(
    dt: number,
    beat: number,
    act: number,
    energy: number,
    opts: { trackId?: string | null; title?: string | null; progress?: number; live?: boolean } = {},
  ): void {
    if (!this.root.visible) return;

    const track = currentTrack();
    const id = opts.trackId !== undefined ? opts.trackId : (track?.id ?? null);
    if (id && id !== this.trackId) {
      this.trackId = id;
      this.setPalette(paletteFor(id), opts.title !== undefined ? opts.title : (track?.title ?? id.toUpperCase()));
    }
    this.ease(1 - Math.exp(-dt * 1.6));

    const fb = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - fb * 2.2);
    const gain = 0.35 + energy * 0.65;

    // ── the wall ────────────────────────────────────────────────────────
    readBands(this.bands, beat, opts.live);
    const lv = this.level.array as Float32Array;
    const pk = this.peak.array as Float32Array;
    const fall = dt * (1.3 + act * 0.2);
    for (let k = 0; k < WALL_N; k++) {
      const b = this.colBand[k];
      const i0 = Math.floor(b);
      const i1 = Math.min(BANDS - 1, i0 + 1);
      const v = (this.bands[i0] + (this.bands[i1] - this.bands[i0]) * (b - i0)) * this.colGain[k] * (0.45 + energy * 0.55);
      lv[k] = v > lv[k] ? lv[k] + (v - lv[k]) * Math.min(1, dt * 30) : Math.max(v, lv[k] - fall);
      if (lv[k] >= pk[k]) {
        pk[k] = lv[k];
        this.peakHold[k] = 0.45;
      } else if ((this.peakHold[k] -= dt) < 0) pk[k] = Math.max(lv[k], pk[k] - dt * 0.3);
    }
    this.level.needsUpdate = true;
    this.peak.needsUpdate = true;
    // The chase runs the circle once a bar, turning direction every phrase.
    const dir = Math.floor(beat / 32) % 2 === 0 ? 1 : -1;
    const chase = (((beat / 4) % 1) + 1) % 1;
    for (const w of this.wallMats) {
      w.uniforms.uGain.value = gain * (1 + pulse * 0.15);
      w.uniforms.uChase.value = dir * chase * Math.PI * 2;
    }

    // ── the record ──────────────────────────────────────────────────────
    for (let i = 0; i < GROOVE_BANDS; i++) this.grooves[i] = this.bands[Math.floor((i / GROOVE_BANDS) * BANDS)];
    // The record's own copies of the bands and the gain, eased slowly: the
    // floor ripples can twitch with the spectrum, the sky must not.
    const k = 1 - Math.exp(-dt * REC.ease);
    for (let i = 0; i < GROOVE_BANDS; i++) this.recBands[i] += (this.grooves[i] - this.recBands[i]) * k;
    this.recGain += (gain - this.recGain) * k;
    const end = setEndBeat();
    const prog = opts.progress ?? (beat > 0 && end > 0 ? Math.min(1, beat / end) : 0);
    const play = REC.rOut - 1.5 - prog * (REC.rOut - REC.rIn - 3);
    const u = this.vinyl.uniforms;
    // A visible turn — about one revolution every 15 s, quicker as the acts
    // climb — slow enough that a disc this size never pulls at your balance.
    // Accumulated, so an act change speeds the platter up instead of
    // snapping the label round.
    this.spin += dt * (0.42 + act * 0.06);
    u.uRot.value = this.spin;
    u.uPlay.value = play;
    u.uGain.value = this.recGain;
    (u.uBands.value as Float32Array).set(this.recBands);
    this.label.rotation.z = u.uRot.value as number;
    // The drift: sway and breath, then turn square to the dancer and
    // wobble off it like a warped pressing on the platter.
    const tau = Math.PI * 2;
    this.disc.position.set(
      Math.sin((beat / REC.swayBeats) * tau) * REC.sway,
      REC.y + Math.sin((beat / REC.riseBeats) * tau) * REC.rise,
      REC.z,
    );
    this.root.updateMatrixWorld();
    this.disc.lookAt(_viewer.copy(VIEWER));
    const wob = (beat / REC.warpBeats) * tau;
    this.disc.rotateX(Math.sin(wob) * REC.warp);
    this.disc.rotateY(Math.cos(wob) * REC.warp);
    // The needle: a fixed point on the record's frame at the playhead.
    this.disc.updateMatrix();
    const needle = new Vector3(Math.cos(-2.3) * play, Math.sin(-2.3) * play, 0).applyMatrix4(this.disc.matrix);
    const from = new Vector3(Math.sin(-0.62) * (WALL_R - 1), 34, -Math.cos(-0.62) * (WALL_R - 1));
    const span = needle.clone().sub(from);
    this.arm.position.copy(from);
    this.arm.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), span.clone().normalize());
    this.arm.scale.set(1, span.length(), 1);
    this.flare.position.copy(needle);
    this.armMat.opacity = 0.35 + this.recGain * 0.5;

    // ── the glass: a ring away on every kick ────────────────────────────
    if (Math.floor(beat) !== Math.floor(this.lastBeat) && beat > this.lastBeat) {
      this.kicks.copyWithin(1, 0);
      this.kicks[0] = 0;
    }
    this.lastBeat = beat;
    for (let i = 0; i < KICKS; i++) this.kicks[i] += dt;
    (this.ripple.uniforms.uKicks.value as Float32Array).set(this.kicks);
    (this.ripple.uniforms.uBands.value as Float32Array).set(this.grooves);
    this.ripple.uniforms.uGain.value = gain;

    // ── the sky: the horizon breathes with the bass ─────────────────────
    const bass = (this.bands[0] + this.bands[1] + this.bands[2]) / 3;
    this.sky.uniforms.uGain.value = gain * (0.55 + bass * 0.7);

    // ── lasers: fans sweep with the bars; the acts open more of them ────
    const shown = 2 + Math.min(2, act);
    const o = new Object3D();
    const c = new Color();
    for (let f = 0; f < FANS.length; f++) {
      const on = f === 1 || f === 2 || (f === 0 && shown > 2) || (f === 3 && shown > 3);
      const e = this.emitters[f];
      const toward = Math.atan2(-e.x, -e.z);
      const sweep = Math.sin(beat * (Math.PI / 4) + f * 1.3) * 0.32;
      const lift = 0.06 + 0.12 * (0.5 + 0.5 * Math.sin(beat * (Math.PI / 8) + f));
      for (let b = 0; b < BEAMS_PER_FAN; b++) {
        const i = f * BEAMS_PER_FAN + b;
        const yaw = toward + sweep + (b / (BEAMS_PER_FAN - 1) - 0.5) * 0.9;
        const d = new Vector3(Math.sin(yaw) * Math.cos(lift), Math.sin(lift), Math.cos(yaw) * Math.cos(lift));
        o.position.copy(e);
        o.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), d);
        o.scale.set(1, on ? LASER_LEN : 0.0001, 1);
        o.updateMatrix();
        this.lasers.setMatrixAt(i, o.matrix);
        // The count-in runs on negative beats: wrap the index into range.
        const n = this.laserCols.length;
        c.copy(this.laserCols[(((f + b + Math.floor(beat / 4)) % n) + n) % n]);
        this.lasers.setColorAt(i, c);
      }
    }
    this.lasers.instanceMatrix.needsUpdate = true;
    if (this.lasers.instanceColor) this.lasers.instanceColor.needsUpdate = true;
    this.laserMat.opacity = energy * (0.35 + pulse * 0.4);
  }

  dispose(): void {
    this.root.removeFromParent();
  }
}
