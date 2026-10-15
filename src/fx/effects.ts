/**
 * Transient combat visuals: the fire hit (a white-hot flash, fire puffs that
 * cool into soot smoke, incandescent spark streaks), the damage number and
 * the gesture clink.
 *
 * THE HIT IS LIT LIKE THE VENUE, NOT LIKE A COMIC. The first look was a
 * cartoon "POW": an eleven-ray starburst, a perfect shockwave ring, flat
 * coloured discs and gem-shaped chunks, all pure additive glow with no
 * smoke, which read as a sticker against the photoreal arenas. Now a hit is
 * what a burst of fire does: a flash too short to have a shape, ragged
 * noise-textured flame that rolls out of the struck surface and cools from
 * white through the fire's colour into dark soot that hangs and breaks up,
 * and sparks that fly on gravity and drag, white-hot at the head and cooling
 * as they fall.
 *
 * EVERYTHING HERE IS POOLED, AND NOTHING IS EVER DISPOSED. The first cut
 * spawned a handful of ECS entities per impact, each with its own fresh
 * material, and disposed them all ~0.8 s later. three.js destroys a
 * compiled shader program as soon as the last material using it is
 * disposed, so with a second or so between hits every landed punch
 * recompiled and relinked a shader mid-frame — a visible hitch on the
 * headset exactly when the game should feel best.
 *
 * Now an impact is a few writes into fixed pools:
 *  - an instanced billboard layer of light (the flash and its halo),
 *  - an instanced layer of fire / smoke puffs (one premultiplied shader that
 *    is pure light while a puff burns and occludes once it is smoke),
 *  - an instanced layer of velocity-stretched spark streaks,
 *  - a small ring of damage-number quads.
 * The instanced meshes stay in the scene at all times (count 0 draws
 * nothing but keeps their programs compiled and current across arena /
 * club / fog changes), and every material opts out of fog so a scene swap
 * never forces a recompile either.
 */

import type { World } from '@iwsdk/core';
import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  CustomBlending,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OneFactor,
  OneMinusSrcAlphaFactor,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
  type Camera,
  type Material,
  type WebGLRenderer,
  type Scene,
  type Texture,
} from 'three';
import { emberBurst } from './fire.js';
import { FIREBALL, teamColor } from '../config.js';

const easeOut = (t: number): number => 1 - (1 - t) ** 3;
const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const _m = new Matrix4();
const _q = new Quaternion();
const _qz = new Quaternion();
const _s = new Vector3();
const _p = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();
const _camPos = new Vector3();
const _camQ = new Quaternion();
const _col = new Color();
const _hot = new Color();
/** The white-hot heart of every flash and spark, faintly warm. */
const WHITE_HOT = new Color(1, 0.94, 0.82);
const Z_AXIS = new Vector3(0, 0, 1);

/**
 * QUEST BUDGET. The headset is fill-bound: what an effect costs is the
 * pixels its quads cover, every one of them, transparent texels included,
 * twice (one per eye). So:
 *  - no billboard is ever drawn wider than MAX_SPAN × its distance (about
 *    half the view), and nothing faded to nothing is drawn at all;
 *  - the pools are small and a full puff pool drops new smoke rather than
 *    growing;
 *  - impacts landing close together (a titan's nova erupts twenty a second)
 *    share a budget: LOAD counts recent impacts and each new one gets less
 *    detail the busier it is, so a storm costs about what one big hit does.
 * `impact-preview.html?overdraw=1` (and `?storm=20`) measure it.
 */
const MAX_SPAN = 0.55;
/** Recent impacts, in hit-scale units; decays with LOAD_TAU seconds. */
let load = 0;
const LOAD_TAU = 0.4;

/* ── textures (drawn once) ───────────────────────────────────────────────── */

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void, h = size): Texture {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = h;
  draw(c.getContext('2d')!, size);
  const tex = new CanvasTexture(c);
  tex.minFilter = LinearFilter;
  return tex;
}

/** Light scattered round a point source: a gaussian, tight at the core and
 *  long in the tail, so a flash has no edge to read as a disc. */
function lightTexture(): Texture {
  return canvasTex(128, (g, s) => {
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const dx = (x + 0.5) / s - 0.5;
        const dy = (y + 0.5) / s - 0.5;
        const r2 = (dx * dx + dy * dy) * 4; // 0 at the centre, 1 at the edge
        const core = Math.exp(-r2 * 18);
        const tail = Math.exp(-r2 * 4.5) * 0.28;
        const a = Math.max(0, core + tail - 0.011 * r2 * 4) * (r2 < 1 ? 1 : 0);
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
        img.data[i + 3] = Math.round(255 * Math.min(1, a));
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** Seeded value noise, so the puff texture is the same every boot. */
function valueNoise(seed: number): (x: number, y: number) => number {
  const N = 256;
  const tab = new Float32Array(N);
  let st = seed;
  for (let i = 0; i < N; i++) {
    st = (st * 1664525 + 1013904223) >>> 0;
    tab[i] = st / 4294967296;
  }
  const hash = (x: number, y: number): number => tab[(x * 73 + y * 151 + ((x * y) & 31)) & (N - 1)];
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);
    const a = hash(xi, yi);
    const b = hash(xi + 1, yi);
    const c = hash(xi, yi + 1);
    const d = hash(xi + 1, yi + 1);
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
}

/**
 * One billow of flame or smoke. R carries the billow's density (fbm noise),
 * A its soft, ragged outline. The puff shader erodes R with age, so a puff
 * breaks into wisps as it thins instead of fading as one even disc.
 */
function puffTexture(): Texture {
  return canvasTex(128, (g, s) => {
    const n = valueNoise(0x5eed);
    const fbm = (x: number, y: number): number => {
      let a = 0;
      let w = 0.5;
      let f = 1;
      for (let o = 0; o < 5; o++) {
        a += w * n(x * f, y * f);
        f *= 2.03;
        w *= 0.5;
      }
      return a / 0.97;
    };
    const img = g.createImageData(s, s);
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = (x + 0.5) / s - 0.5;
        const v = (y + 0.5) / s - 0.5;
        const r = Math.sqrt(u * u + v * v) * 2;
        const ang = Math.atan2(v, u);
        // A lumpy rim: the outline swells and pinches round the puff. It
        // reaches nearly to the quad's edge — every texel of the quad is
        // paid for in fill rate whether it shows or not.
        const rim = 0.84 + 0.13 * (fbm(Math.cos(ang) * 2.2 + 3, Math.sin(ang) * 2.2 + 3) - 0.5) * 2;
        const mask = smooth(rim, rim * 0.35, r);
        const dens = fbm(u * 7 + 11, v * 7 + 5);
        const i = (y * s + x) * 4;
        img.data[i] = Math.round(255 * Math.min(1, Math.max(0, (dens - 0.2) * 1.6)));
        img.data[i + 1] = img.data[i + 2] = 0;
        img.data[i + 3] = Math.round(255 * mask);
      }
    }
    g.putImageData(img, 0, 0);
  });
}

/** A spark streak along +X: a hot head at the right, a tail fading left. */
function streakTexture(): Texture {
  return canvasTex(
    64,
    (g) => {
      const w = 64;
      const h = 16;
      const img = g.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        const v = (y + 0.5) / h - 0.5;
        const across = Math.exp(-v * v * 60);
        for (let x = 0; x < w; x++) {
          const u = (x + 0.5) / w;
          const along = u ** 2.2 * Math.min(1, (1 - u) * 12);
          const a = Math.round(255 * across * along);
          const i = (y * w + x) * 4;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = a;
        }
      }
      g.putImageData(img, 0, 0);
    },
    16,
  );
}

function additive(map: Texture): MeshBasicMaterial {
  return new MeshBasicMaterial({
    map,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  });
}

/** An instanced mesh that is always in the scene and never culled; its
 *  instance colours exist from the start so the program never changes. */
function instanced(geo: PlaneGeometry, mat: Material, max: number): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

/* ── light: the flash and its halo ───────────────────────────────────────── */

const enum Anim {
  /** a white-hot instant: barely grows, gone in a few frames */
  Flash,
  /** the light the burst throws into the air round it, fading on a square */
  Bloom,
}

class BillboardLayer {
  readonly mesh: InstancedMesh;
  private n = 0;
  private steal = 0;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly anim: Uint8Array;

  constructor(tex: Texture, private readonly max: number, renderOrder = 0) {
    this.mesh = instanced(new PlaneGeometry(1, 1), additive(tex), max);
    this.mesh.renderOrder = renderOrder;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.anim = new Uint8Array(max);
  }

  spawn(p: Vector3, anim: Anim, size: number, life: number, c: Color, gain = 1): void {
    let i = this.n;
    if (i < this.max) this.n++;
    else i = this.steal = (this.steal + 1) % this.max; // full: recycle a slot
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.col[i * 3] = c.r * gain;
    this.col[i * 3 + 1] = c.g * gain;
    this.col[i * 3 + 2] = c.b * gain;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.anim[i] = anim;
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.col.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.size[i] = this.size[j];
    this.anim[i] = this.anim[j];
  }

  update(dt: number, camQ: Quaternion, camPos: Vector3): void {
    if (this.n === 0 && this.mesh.count === 0) return;
    const colors = this.mesh.instanceColor!;
    let i = 0;
    while (i < this.n) {
      const age = this.age[i] + dt;
      const life = this.life[i];
      if (age >= life) {
        this.kill(i);
        continue; // the last slot moved into i — look at it next
      }
      this.age[i] = age;
      const t = age / life;
      let scale: number;
      let fade: number;
      if ((this.anim[i] as Anim) === Anim.Flash) {
        scale = 1 + 0.35 * easeOut(t);
        fade = (1 - t) ** 2;
      } else {
        scale = 1 + 0.4 * easeOut(t);
        fade = (1 - t) * (1 - t);
      }
      _p.fromArray(this.pos, i * 3);
      // Never wider than about half the view: a flash at your face is
      // already all you can see, and the rest would be fill for nothing.
      const s = Math.min(this.size[i] * scale, MAX_SPAN * _p.distanceTo(camPos));
      _m.compose(_p, camQ, _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
      // Additive: dimming the colour IS the fade.
      colors.setXYZ(i, this.col[i * 3] * fade, this.col[i * 3 + 1] * fade, this.col[i * 3 + 2] * fade);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }
}

/* ── puffs: flame that rolls out and cools into smoke ────────────────────── */

/**
 * Premultiplied "over": rgb is added as light, alpha darkens what is behind.
 * A burning puff writes colour with alpha 0 (pure light, like the additive
 * layers); as it cools its colour drains and its alpha rises, so the same
 * billow turns into soot that occludes the arena behind it.
 */
const PUFF_VERT = /* glsl */ `
  attribute vec3 aSmoke; // x: occlusion, y: soot grey, z: erosion
  varying vec2 vUv;
  varying vec3 vEmit;
  varying vec3 vSmoke;
  void main(){
    vUv = uv; vEmit = instanceColor; vSmoke = aSmoke;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;
const PUFF_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  varying vec2 vUv;
  varying vec3 vEmit;
  varying vec3 vSmoke;
  void main(){
    vec4 t = texture2D(uMap, vUv);
    float d = t.a * smoothstep(vSmoke.z, vSmoke.z + 0.35, t.r);
    float a = vSmoke.x * d;
    gl_FragColor = vec4(vEmit * d + vec3(vSmoke.y) * a, a);
    #include <colorspace_fragment>
  }
`;

const enum Puff {
  /** burns white → the fire's colour → dark, leaving a little soot */
  Fire,
  /** soot: lit warm for an instant by the flash, then hangs, rises, thins */
  Smoke,
}

class PuffLayer {
  readonly mesh: InstancedMesh;
  private n = 0;
  private readonly smokeAttr: InstancedBufferAttribute;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly kind: Uint8Array;

  constructor(private readonly max: number, renderOrder = 0) {
    const mat = new ShaderMaterial({
      uniforms: { uMap: { value: puffTexture() } },
      vertexShader: PUFF_VERT,
      fragmentShader: PUFF_FRAG,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    this.mesh = instanced(new PlaneGeometry(1, 1), mat, max);
    this.mesh.renderOrder = renderOrder;
    this.smokeAttr = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
    this.smokeAttr.setUsage(DynamicDrawUsage);
    this.mesh.geometry.setAttribute('aSmoke', this.smokeAttr);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.kind = new Uint8Array(max);
  }

  /** A full pool drops the new puff: stealing a live one would pop it out
   *  of the air, and a full pool is already all the smoke a frame can pay
   *  for. */
  spawn(p: Vector3, vx: number, vy: number, vz: number, kind: Puff, c: Color, size: number, life: number): void {
    if (this.n >= this.max) return;
    const i = this.n++;
    const k = i * 3;
    this.pos[k] = p.x;
    this.pos[k + 1] = p.y;
    this.pos[k + 2] = p.z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    this.col[k] = c.r;
    this.col[k + 1] = c.g;
    this.col[k + 2] = c.b;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.rot[i] = Math.random() * Math.PI * 2;
    this.spin[i] = (Math.random() - 0.5) * (kind === Puff.Fire ? 3 : 0.8);
    this.kind[i] = kind;
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.col.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.size[i] = this.size[j];
    this.rot[i] = this.rot[j];
    this.spin[i] = this.spin[j];
    this.kind[i] = this.kind[j];
  }

  update(dt: number, camQ: Quaternion, camPos: Vector3): void {
    if (this.n === 0 && this.mesh.count === 0) return;
    const colors = this.mesh.instanceColor!;
    const smoke = this.smokeAttr;
    let i = 0;
    while (i < this.n) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this.kill(i);
        continue;
      }
      this.age[i] = age;
      const t = age / this.life[i];
      const k = i * 3;
      const fire = (this.kind[i] as Puff) === Puff.Fire;
      // Gas: the push from the hit bleeds off fast, then heat lifts it.
      const drag = Math.max(0, 1 - (fire ? 6 : 2.4) * dt);
      this.vel[k] *= drag;
      this.vel[k + 1] = this.vel[k + 1] * drag + (fire ? 0.9 : 0.35) * dt;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;

      let grow: number;
      let er: number;
      let eg: number;
      let eb: number;
      let occl: number;
      let erode: number;
      const r = this.col[k];
      const g = this.col[k + 1];
      const b = this.col[k + 2];
      if (fire) {
        grow = 1 + 1.1 * easeOut(t);
        // White-hot for the first frames, the fire's own colour after, and
        // the colour drains (blue and green first, as real flame reddens).
        const hot = Math.max(0, 1 - t * 5);
        const burn = 1 - smooth(0.15, 0.7, t);
        const redden = 1 - 0.55 * smooth(0.1, 0.5, t);
        er = (r + (WHITE_HOT.r - r) * hot) * burn;
        eg = (g + (WHITE_HOT.g - g) * hot) * burn * redden;
        eb = (b + (WHITE_HOT.b - b) * hot) * burn * redden;
        occl = 0.3 * smooth(0.3, 0.6, t) * (1 - smooth(0.6, 1, t));
        erode = 0.22 + 0.65 * t;
      } else {
        grow = 1 + 1.3 * easeOut(t);
        const lit = Math.max(0, 1 - t * 6) * 0.3; // the flash on its underside
        er = r * lit;
        eg = g * lit;
        eb = b * lit;
        occl = 0.42 * smooth(0, 0.12, t) * (1 - t) ** 1.4;
        erode = 0.05 + 0.65 * t;
      }
      // A hit on your own head bursts a hand's width from your eyes: soot
      // that close would blind you for a second, so it thins out near the
      // eye and the fight stays readable through it. The flame eases off as
      // it reaches the lens and is gone before it would cover the view —
      // the light layer's flash and the damage vignette carry that moment,
      // and a stack of full-screen puffs is the one thing Quest's fill rate
      // can't afford.
      _p.fromArray(this.pos, k);
      const dist = _p.distanceTo(camPos);
      const s = Math.min(this.size[i] * grow, MAX_SPAN * dist);
      const gap = dist - s * 0.5;
      const near = smooth(0.25, 0.9, gap);
      const glow = fire ? smooth(0.02, 0.3, gap) : near;
      occl *= near;
      er *= glow;
      eg *= glow;
      eb *= glow;
      _qz.setFromAxisAngle(Z_AXIS, this.rot[i] + this.spin[i] * age);
      _q.copy(camQ).multiply(_qz);
      // Nothing worth seeing: zero size, so it costs no fill rate in stereo.
      const z = occl > 0.01 || er + eg + eb > 0.01 ? s : 0;
      _m.compose(_p, _q, _s.set(z, z, z));
      this.mesh.setMatrixAt(i, _m);
      colors.setXYZ(i, er, eg, eb);
      smoke.setXYZ(i, occl, fire ? 0.02 : 0.03, erode);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
    smoke.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }
}

/* ── spark streaks: stretched along their own velocity, cooling ──────────── */

class StreakLayer {
  readonly mesh: InstancedMesh;
  private n = 0;
  private steal = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly col: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly width: Float32Array;
  private readonly drag: Float32Array;

  constructor(private readonly max: number, renderOrder = 0) {
    this.mesh = instanced(new PlaneGeometry(1, 1), additive(streakTexture()), max);
    this.mesh.renderOrder = renderOrder;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.width = new Float32Array(max);
    this.drag = new Float32Array(max);
  }

  /** `c` is the colour the spark cools to; it is born white-hot. `drag` is
   *  per second — a fleck of slag bleeds speed fast, a hot bead carries. */
  spawn(p: Vector3, vx: number, vy: number, vz: number, c: Color, life: number, width: number, drag: number): void {
    let i = this.n;
    if (i < this.max) this.n++;
    else i = this.steal = (this.steal + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = c.r;
    this.col[i * 3 + 1] = c.g;
    this.col[i * 3 + 2] = c.b;
    this.age[i] = 0;
    this.life[i] = life;
    this.width[i] = width;
    this.drag[i] = drag;
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.col.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.width[i] = this.width[j];
    this.drag[i] = this.drag[j];
  }

  update(dt: number, camPos: Vector3): void {
    if (this.n === 0 && this.mesh.count === 0) return;
    const colors = this.mesh.instanceColor!;
    let i = 0;
    while (i < this.n) {
      const age = this.age[i] + dt;
      if (age >= this.life[i]) {
        this.kill(i);
        continue;
      }
      this.age[i] = age;
      const t = age / this.life[i];
      const k = i * 3;
      const drag = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[k + 1] -= 9.8 * dt;
      this.vel[k] *= drag;
      this.vel[k + 1] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;

      _p.fromArray(this.pos, k);
      _x.fromArray(this.vel, k);
      const speed = _x.length();
      if (speed > 1e-4) _x.multiplyScalar(1 / speed);
      else _x.set(0, 1, 0);
      // The streak lies along its velocity and turns its face to the eye.
      _z.subVectors(camPos, _p);
      _y.crossVectors(_z, _x);
      if (_y.lengthSq() < 1e-8) _y.set(0, 0, 1).cross(_x);
      _y.normalize();
      _z.crossVectors(_x, _y);
      // Motion blur: about the distance the spark covers in a frame and a
      // half, so a slow one shrinks to a bead instead of a dash.
      const len = Math.min(0.2, 0.008 + speed * 0.022);
      const w = this.width[i] * (1 - 0.4 * t);
      _m.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(w), _z);
      // Head at the spark, tail trailing behind it.
      _m.setPosition(_p.addScaledVector(_x, -0.5));
      this.mesh.setMatrixAt(i, _m);
      // Incandescent cooling: white, then the fire's colour, then dim.
      const hot = 1 - smooth(0.05, 0.45, t);
      const fade = (1 - t) ** 1.2 * 1.6;
      colors.setXYZ(
        i,
        (this.col[k] + (WHITE_HOT.r - this.col[k]) * hot) * fade,
        (this.col[k + 1] + (WHITE_HOT.g - this.col[k + 1]) * hot) * fade,
        (this.col[k + 2] + (WHITE_HOT.b - this.col[k + 2]) * hot) * fade,
      );
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    colors.needsUpdate = true;
  }

  clear(): void {
    this.n = 0;
    this.mesh.count = 0;
  }
}

/* ── popups: the damage number, the X, the GG ────────────────────────────── */

const POPUP_GEO = new PlaneGeometry(0.26, 0.13);
const POPUP_POOL = 16;

/** Popup text rendered once per distinct label/style, then reused. */
const popupTextures = new Map<string, CanvasTexture>();

function popupTexture(text: string, fill: string, glow: string): CanvasTexture {
  const key = `${text}|${fill}|${glow}`;
  let tex = popupTextures.get(key);
  if (tex) return tex;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `900 96px 'Arial Black', system-ui, sans-serif`;
  ctx.lineWidth = 14;
  ctx.strokeStyle = 'rgba(10,11,14,0.95)';
  ctx.strokeText(text, 128, 68);
  ctx.fillStyle = fill;
  ctx.shadowColor = glow;
  ctx.shadowBlur = 22;
  ctx.fillText(text, 128, 68);
  tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  popupTextures.set(key, tex);
  warm(tex);
  return tex;
}

/** Pop-art red: the flat, printed red of a comic panel. */
const POP_RED = '#e3101b';
/** The halftone's darker ink, printed over the red. */
const POP_DOT = '#8e0010';
const POP_INK = '#0b0a0d';
/** The off-white of the page round the lettering. */
const POP_PAPER = '#fff6e0';

/**
 * The damage number as a pop-art panel lettering: flat red printed with
 * Ben-Day dots that swell toward the bottom, a heavy black keyline inside a
 * paper border and a hard offset shadow, set on a slight italic lean.
 *
 * 256x128, the same as every other popup: at the distance a number flies,
 * Quest 3 spends ~150 px on it, so more texels would only cost memory and
 * upload time. Mipmapped so the dots don't shimmer. The dot sheet is drawn
 * once and stamped over each new number in one call, so rasterising a
 * number we didn't prewarm is a handful of text draws, not hundreds of dots.
 */
const DMG_W = 256;
const DMG_H = 128;
let dotSheet: HTMLCanvasElement | undefined;
let dmgFace: CanvasRenderingContext2D | undefined;

function halftone(): HTMLCanvasElement {
  if (dotSheet) return dotSheet;
  dotSheet = document.createElement('canvas');
  dotSheet.width = DMG_W;
  dotSheet.height = DMG_H;
  const g = dotSheet.getContext('2d')!;
  g.fillStyle = POP_DOT;
  const step = 6.5;
  for (let row = 0, y = 0; y < DMG_H + step; row++, y += step * 0.866) {
    const r = 0.5 + 2.3 * Math.min(1, Math.max(0, (y - DMG_H * 0.28) / (DMG_H * 0.6)));
    for (let x = row % 2 ? step / 2 : 0; x < DMG_W + step; x += step) {
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  // A printed highlight: a white glint across the top-left.
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath();
  g.ellipse(DMG_W * 0.36, DMG_H * 0.3, 35, 4.5, -0.25, 0, Math.PI * 2);
  g.fill();
  return dotSheet;
}

function damageTexture(text: string): CanvasTexture {
  const key = `dmg|${text}`;
  let tex = popupTextures.get(key);
  if (tex) return tex;
  const set = (g: CanvasRenderingContext2D): void => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `italic 900 94px 'Arial Black', 'Helvetica Neue', system-ui, sans-serif`;
    g.lineJoin = 'round';
    g.miterLimit = 2;
    g.setTransform(1, 0, -0.14, 1, 9, 0); // the lean
  };
  const cx = DMG_W / 2;
  const cy = DMG_H / 2 + 6;

  // The face: flat red with the halftone sheet printed over it, clipped to
  // the letters by stamping the sheet source-atop.
  if (!dmgFace) {
    const c = document.createElement('canvas');
    c.width = DMG_W;
    c.height = DMG_H;
    dmgFace = c.getContext('2d')!;
  }
  const f = dmgFace;
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-over';
  f.clearRect(0, 0, DMG_W, DMG_H);
  set(f);
  f.fillStyle = POP_RED;
  f.fillText(text, cx, cy);
  f.setTransform(1, 0, 0, 1, 0, 0);
  f.globalCompositeOperation = 'source-atop';
  f.drawImage(halftone(), 0, 0);

  const canvas = document.createElement('canvas');
  canvas.width = DMG_W;
  canvas.height = DMG_H;
  const g = canvas.getContext('2d')!;
  set(g);
  // The hard drop shadow: solid ink, offset down-right, no blur.
  g.strokeStyle = POP_INK;
  g.lineWidth = 20;
  g.strokeText(text, cx + 6, cy + 6);
  // The paper border, so the lettering separates from a dark venue.
  g.strokeStyle = POP_PAPER;
  g.lineWidth = 20;
  g.strokeText(text, cx, cy);
  // The keyline.
  g.strokeStyle = POP_INK;
  g.lineWidth = 11;
  g.strokeText(text, cx, cy);
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.drawImage(f.canvas, 0, 0);

  tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace; // the printed red, not a washed-out pink
  popupTextures.set(key, tex);
  warm(tex);
  return tex;
}

interface Popup {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  age: number;
  life: number;
  base: number;
  y0: number;
  drift: number;
  /** A lean in the view plane — the damage number lands a little askew. */
  tilt: number;
  live: boolean;
}

/** The default popup style (the X, the GG pass their own colours). */
const DMG_FILL = '#ff1605';
const DMG_GLOW = 'rgba(255,30,10,1)';

/* ── the module's pools ──────────────────────────────────────────────────── */

let glow: BillboardLayer | undefined;
let puffs: PuffLayer | undefined;
let streaks: StreakLayer | undefined;
const popups: Popup[] = [];
let popupCursor = 0;
/** Set by initImpactFx: lets a texture go up to the GPU when it is made,
 *  during the quiet frames of the prewarm, instead of on the frame of the
 *  hit that first shows it. */
let gpu: WebGLRenderer | undefined;
function warm(tex: Texture): void {
  try {
    gpu?.initTexture(tex);
  } catch {
    /* it uploads on first use instead */
  }
}
/** Labels still to rasterise ahead of their first use, one per frame. */
const prewarm: (() => void)[] = [];

/** Build the pools and hang them in the scene. Call once at boot. Pass the
 *  renderer so every texture is on the GPU before the first hit needs it. */
export function initImpactFx(scene: Scene, renderer?: WebGLRenderer): void {
  if (glow) return;
  gpu = renderer;
  // Smoke first, so the flash and the sparks shine through it.
  puffs = new PuffLayer(64);
  glow = new BillboardLayer(lightTexture(), 32, 1);
  streaks = new StreakLayer(256, 1);
  scene.add(puffs.mesh, glow.mesh, streaks.mesh);
  // The puff texture rides a shader uniform, where the boot-time texture
  // warm (which reads material.map and friends) never looks.
  for (const layer of [puffs.mesh, glow.mesh, streaks.mesh]) {
    const m = layer.material as ShaderMaterial & MeshBasicMaterial;
    warm(m.uniforms?.uMap?.value ?? m.map);
  }

  // The popups are separate quads (each wears its own number); all share
  // one program. A permanent zero-size KEEPER holds that program compiled so
  // the first number of a bout doesn't pay for it.
  const first = damageTexture(String(FIREBALL.damage));
  const popupMat = (): MeshBasicMaterial =>
    new MeshBasicMaterial({ map: first, transparent: true, depthTest: false, depthWrite: false, fog: false });
  for (let i = 0; i < POPUP_POOL; i++) {
    const mat = popupMat();
    const mesh = new Mesh(POPUP_GEO, mat);
    mesh.renderOrder = 60;
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    popups.push({ mesh, mat, age: 0, life: 1, base: 1, y0: 0, drift: 0, tilt: 0, live: false });
  }
  const keeper = new Mesh(POPUP_GEO, popupMat());
  keeper.scale.setScalar(1e-6);
  keeper.frustumCulled = false;
  keeper.renderOrder = 60;
  scene.add(keeper);

  // Rasterise the numbers a bout actually throws before the first one lands.
  const big = FIREBALL.headDamage;
  for (const d of [FIREBALL.damage, Math.round(FIREBALL.damage / 3), Math.round(FIREBALL.damage / 3) + big - FIREBALL.damage, 10, 15, big, 30]) {
    prewarm.push(() => damageTexture(String(d)));
  }
  prewarm.push(
    () => popupTexture('X', '#ff2a2a', 'rgba(255,40,30,1)'),
    () => popupTexture('GG', '#ffffff', 'rgba(255,255,255,0.95)'),
  );
}

/** Advance every live effect. Call once per frame (FXSystem does). */
export function updateImpactFx(dt: number, camera: Camera): void {
  if (!glow) return;
  prewarm.pop()?.();

  camera.getWorldQuaternion(_camQ);
  camera.getWorldPosition(_camPos);
  load *= Math.exp(-dt / LOAD_TAU);
  puffs!.update(dt, _camQ, _camPos);
  glow.update(dt, _camQ, _camPos);
  streaks!.update(dt, _camPos);

  for (const pop of popups) {
    if (!pop.live) continue;
    pop.age += dt;
    const t = pop.age / pop.life;
    if (t >= 1) {
      pop.live = false;
      pop.mesh.visible = false;
      continue;
    }
    // PUNCH in (overshoot, settle), then rise on an ease and fade late.
    const punch = t < 0.08 ? 0.5 + 0.8 * easeOut(t / 0.08) : t < 0.22 ? 1.3 - 0.3 * easeOut((t - 0.08) / 0.14) : 1 + 0.12 * (t - 0.22);
    pop.mesh.scale.setScalar(pop.base * punch);
    pop.mesh.position.y = pop.y0 + 0.3 * easeOut(t);
    pop.mesh.position.x += pop.drift * dt;
    pop.mesh.quaternion.copy(_camQ);
    if (pop.tilt !== 0) pop.mesh.quaternion.multiply(_qz.setFromAxisAngle(Z_AXIS, pop.tilt));
    pop.mat.opacity = t < 0.06 ? t / 0.06 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
  }
}

/** Drop every live effect (crossing between unrelated experiences). */
export function clearImpactFx(): void {
  load = 0;
  puffs?.clear();
  glow?.clear();
  streaks?.clear();
  for (const pop of popups) {
    pop.live = false;
    pop.mesh.visible = false;
  }
}

/** A billboard popup that punches in at the impact, rises and fades.
 *  `scale` grows the whole label — damage numbers ride near 1, a
 *  celebratory GG rides bigger. */
export function spawnPopup(
  _world: World,
  pos: Vector3,
  text: string,
  fill = DMG_FILL,
  glowCss = DMG_GLOW,
  scale = 1,
): void {
  launchPopup(pos, popupTexture(text, fill, glowCss), scale, 0);
}

function launchPopup(pos: Vector3, map: CanvasTexture, scale: number, tilt: number): void {
  if (popups.length === 0) return;
  const pop = popups[popupCursor];
  popupCursor = (popupCursor + 1) % popups.length;
  pop.mat.map = map;
  pop.mat.opacity = 0;
  pop.tilt = tilt;
  pop.mesh.position.copy(pos);
  pop.y0 = pos.y + 0.1;
  pop.mesh.position.y = pop.y0;
  pop.mesh.scale.setScalar(0.001);
  pop.drift = (Math.random() - 0.5) * 0.12; // stacked numbers fan apart
  pop.age = 0;
  pop.life = 1;
  pop.base = scale;
  pop.live = true;
  pop.mesh.visible = true;
}

/** The damage number: a whole number (a split ball's 20/3 reads "7"), always
 *  pop-art red — a heavy one (a headshot) just punches in bigger. Each lands
 *  a few degrees askew, like lettering slapped on a comic panel. */
export function spawnDamagePopup(_world: World, pos: Vector3, dmg: number): void {
  const d = Math.round(dmg);
  const big = d >= FIREBALL.headDamage;
  const scale = Math.min(1.5, 0.85 + d / 60) * (big ? 1.15 : 1);
  launchPopup(pos, damageTexture(String(d)), scale, (Math.random() - 0.5) * 0.28);
}

/**
 * A crisp metallic spark for social hand gestures (clap / fist bump): a
 * flash too quick to have a shape and a short spray of fast, bright flecks
 * that bleed their speed at once — two iron gauntlets clinking, not a puff.
 */
export function spawnGestureCue(_world: World, pos: Vector3, scale = 0.28): void {
  if (!glow) return;
  glow.spawn(pos, Anim.Flash, scale * 0.55, 0.06, WHITE_HOT, 1.1);
  glow.spawn(pos, Anim.Bloom, scale * 1.2, 0.14, _col.set(0xffd9a0), 0.35);
  const tint = _col.set(0xffb060);
  const count = Math.max(6, Math.round(scale * 34));
  for (let i = 0; i < count; i++) {
    _x.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const speed = 2.5 + Math.random() * 3.5;
    streaks!.spawn(pos, _x.x * speed, _x.y * speed + 0.6, _x.z * speed, tint, 0.12 + Math.random() * 0.18, 0.006 + Math.random() * 0.004, 4);
  }
}

/**
 * A fire burst where a ball lands, is parried, or burns out. `scale` grows
 * the whole event — body hits on the player use ~1.7 so taking a hit FEELS
 * like taking a hit. `dir` (optional) is the way the ball was travelling:
 * the flame and sparks then splash back off the struck surface instead of
 * every way.
 */
export function spawnFireImpact(_world: World, pos: Vector3, team: number, scale = 1, dir?: Vector3): void {
  if (!glow) return;
  const tint = _col.set(teamColor(team));
  const s = scale;
  // Detail: 1 for a lone hit, falling as impacts pile up (see QUEST BUDGET).
  load += s;
  const lod = Math.min(1, 2.2 / load);

  // Which way the burst splashes: back off the struck surface.
  let bx = 0;
  let by = 0;
  let bz = 0;
  if (dir && dir.lengthSq() > 1e-6) {
    const l = dir.length();
    bx = -dir.x / l;
    by = -dir.y / l;
    bz = -dir.z / l;
  }

  // The light: a white-hot instant, and the glow it throws into the air.
  glow.spawn(pos, Anim.Flash, 0.3 * s, 0.07, WHITE_HOT, 1.1);
  glow.spawn(pos, Anim.Bloom, 0.65 * s, 0.18, tint, 0.5);

  // The flame: ragged billows that roll out of the hit, cool and redden.
  // Each starts a little proud of the surface so it doesn't slice the body.
  const flames = Math.max(1, Math.round(4 * s * lod));
  for (let i = 0; i < flames; i++) {
    _x.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const out = 0.5 + Math.random() * 1.1;
    _p.copy(pos).add(_y.set(bx, by, bz).multiplyScalar(0.03 * s)).addScaledVector(_x, 0.025 * s);
    _hot.copy(tint).multiplyScalar(1.25);
    puffs!.spawn(
      _p,
      (bx * out + _x.x * 0.9) * s,
      (by * out + _x.y * 0.9 + 0.2) * s,
      (bz * out + _x.z * 0.9) * s,
      Puff.Fire,
      _hot,
      (0.09 + Math.random() * 0.06) * s,
      0.24 + Math.random() * 0.16,
    );
  }
  // The soot it leaves: a few dark billows that hang, rise and thin out.
  const smokes = Math.round(Math.min(2.6, 2 * s) * lod);
  for (let i = 0; i < smokes; i++) {
    _x.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    _p.copy(pos).add(_y.set(bx, by, bz).multiplyScalar(0.05 * s)).addScaledVector(_x, 0.03 * s);
    puffs!.spawn(
      _p,
      (bx * 0.35 + _x.x * 0.25) * s,
      (by * 0.35 + _x.y * 0.25 + 0.15) * s,
      (bz * 0.35 + _x.z * 0.25) * s,
      Puff.Smoke,
      tint,
      (0.11 + Math.random() * 0.06) * s,
      0.7 + Math.random() * 0.4,
    );
  }

  // Sparks: many fine, fast flecks that die quick, a few heavier beads that
  // arc out and fall. The fire's colour is what they cool to.
  const count = Math.round(20 * s * Math.sqrt(lod));
  for (let i = 0; i < count; i++) {
    _x.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    _x.x += bx * 0.9;
    _x.y += by * 0.9 + 0.25;
    _x.z += bz * 0.9;
    _x.normalize();
    const bead = i % 4 === 0;
    const speed = bead ? 1.8 + Math.random() * 2 : 3 + Math.random() * 5;
    streaks!.spawn(
      pos,
      _x.x * speed,
      _x.y * speed,
      _x.z * speed,
      tint,
      bead ? 0.45 + Math.random() * 0.4 : 0.12 + Math.random() * 0.2,
      bead ? 0.011 + Math.random() * 0.004 : 0.006 + Math.random() * 0.004,
      bead ? 0.8 : 3.5,
    );
  }

  // A few embers from the shared pool drift up off the hit.
  emberBurst(pos, Math.round(4 * s * lod), team === 1);
}
