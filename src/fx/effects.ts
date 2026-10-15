/**
 * Transient combat visuals: the fiery hit spark (white-hot flash, starburst,
 * shockwave ring, spark streaks, cooling ember chunks), the damage number
 * and the gesture clink.
 *
 * EVERYTHING HERE IS POOLED, AND NOTHING IS EVER DISPOSED. The first cut
 * spawned a handful of ECS entities per impact, each with its own fresh
 * material (lit MeshStandardMaterial shards, SpriteMaterials, popup
 * materials), and disposed them all ~0.8 s later. three.js destroys a
 * compiled shader program as soon as the last material using it is
 * disposed, so with a second or so between hits every landed punch
 * recompiled and relinked the shard shader mid-frame — a visible hitch on
 * the headset exactly when the game should feel best.
 *
 * Now an impact is a few writes into fixed pools:
 *  - three instanced billboard layers (glow, starburst, ring) — one draw each,
 *  - an instanced layer of velocity-stretched spark streaks,
 *  - an instanced layer of ember chunks that cool from white-hot to dark,
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
  DoubleSide,
  DynamicDrawUsage,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
  type Camera,
  type Scene,
  type Texture,
} from 'three';
import { glowTexture } from '../materials/glow.js';
import { emberBurst } from './fire.js';
import { FIREBALL, teamColor } from '../config.js';

const easeOut = (t: number): number => 1 - (1 - t) ** 3;

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
/** The white-hot heart of every spark, faintly warm. */
const WHITE_HOT = new Color(1, 0.96, 0.88);
const Z_AXIS = new Vector3(0, 0, 1);

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

/** A thin shockwave annulus: soft inner and outer edges, hot rim. */
function ringTexture(): Texture {
  return canvasTex(128, (g, s) => {
    const m = s / 2;
    const grad = g.createRadialGradient(m, m, 0, m, m, m);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.62, 'rgba(255,255,255,0)');
    grad.addColorStop(0.8, 'rgba(255,255,255,0.55)');
    grad.addColorStop(0.87, 'rgba(255,255,255,1)');
    grad.addColorStop(0.93, 'rgba(255,255,255,0.4)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });
}

/** The hit spark: uneven needle rays round a hot core — the comic-book
 *  "POW" star, drawn additive so it reads as light, not a sticker. */
function starTexture(): Texture {
  return canvasTex(256, (g, s) => {
    const m = s / 2;
    g.globalCompositeOperation = 'lighter';
    const rays = 11;
    for (let i = 0; i < rays; i++) {
      const a = (i / rays) * Math.PI * 2 + (i % 2 ? 0.12 : -0.05);
      const len = m * (i % 3 === 0 ? 0.98 : i % 2 ? 0.62 : 0.8);
      const half = m * (i % 3 === 0 ? 0.075 : 0.055);
      g.save();
      g.translate(m, m);
      g.rotate(a);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.7)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, -half);
      g.lineTo(len, 0);
      g.lineTo(0, half);
      g.closePath();
      g.fill();
      g.restore();
    }
    const core = g.createRadialGradient(m, m, 0, m, m, m * 0.34);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core;
    g.fillRect(0, 0, s, s);
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
        const across = Math.exp(-v * v * 38);
        for (let x = 0; x < w; x++) {
          const u = (x + 0.5) / w;
          const along = u ** 1.6 * Math.min(1, (1 - u) * 9);
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
function instanced(geo: PlaneGeometry | IcosahedronGeometry, mat: MeshBasicMaterial, max: number): InstancedMesh {
  const mesh = new InstancedMesh(geo, mat, max);
  mesh.instanceMatrix.setUsage(DynamicDrawUsage);
  mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(max * 3), 3);
  mesh.instanceColor.setUsage(DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  return mesh;
}

/* ── billboards: flash / bloom / starburst / ring ────────────────────────── */

const enum Anim {
  /** grow ~2.8× and fade linearly — the impact pop */
  Flash,
  /** swell gently, fade on a square — the coloured halo */
  Bloom,
  /** snap open, then die fast — the starburst */
  Star,
  /** race outward, thin and fade — the shockwave */
  Ring,
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
  private readonly rot: Float32Array;
  private readonly spin: Float32Array;
  private readonly anim: Uint8Array;

  constructor(tex: Texture, private readonly max: number, renderOrder = 0) {
    this.mesh = instanced(new PlaneGeometry(1, 1), additive(tex), max);
    this.mesh.renderOrder = renderOrder;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.anim = new Uint8Array(max);
  }

  spawn(p: Vector3, anim: Anim, size: number, life: number, c: Color, gain = 1, rot = 0, spin = 0): void {
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
    this.rot[i] = rot;
    this.spin[i] = spin;
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
    this.rot[i] = this.rot[j];
    this.spin[i] = this.spin[j];
    this.anim[i] = this.anim[j];
  }

  update(dt: number, camQ: Quaternion): void {
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
      switch (this.anim[i] as Anim) {
        case Anim.Flash:
          scale = 1 + t * 1.8;
          fade = 1 - t;
          break;
        case Anim.Bloom:
          scale = 1 + 0.7 * easeOut(t);
          fade = (1 - t) * (1 - t);
          break;
        case Anim.Star:
          scale = 0.55 + 0.75 * easeOut(Math.min(1, t * 2.2));
          fade = (1 - t) ** 1.6;
          break;
        default: // Ring
          scale = 0.2 + 2.8 * easeOut(t);
          fade = (1 - t) ** 1.5;
          break;
      }
      const s = this.size[i] * scale;
      _qz.setFromAxisAngle(Z_AXIS, this.rot[i] + this.spin[i] * age);
      _q.copy(camQ).multiply(_qz);
      _p.fromArray(this.pos, i * 3);
      _m.compose(_p, _q, _s.set(s, s, s));
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

/* ── spark streaks: stretched along their own velocity ───────────────────── */

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

  constructor(private readonly max: number) {
    this.mesh = instanced(new PlaneGeometry(1, 1), additive(streakTexture()), max);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.width = new Float32Array(max);
  }

  spawn(p: Vector3, vx: number, vy: number, vz: number, c: Color, life: number, width: number): void {
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
  }

  update(dt: number, camPos: Vector3): void {
    if (this.n === 0 && this.mesh.count === 0) return;
    const colors = this.mesh.instanceColor!;
    const drag = Math.max(0, 1 - 5.5 * dt); // sparks bleed speed fast
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
      this.vel[k + 1] -= 7 * dt;
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
      const len = Math.min(0.32, 0.025 + speed * 0.05);
      const w = this.width[i] * (1 - 0.5 * t);
      _m.makeBasis(_x.multiplyScalar(len), _y.multiplyScalar(w), _z);
      // Head at the spark, tail trailing behind it.
      _m.setPosition(_p.addScaledVector(_x, -0.5));
      this.mesh.setMatrixAt(i, _m);
      const fade = (1 - t) ** 1.3;
      colors.setXYZ(i, this.col[k] * fade, this.col[k + 1] * fade, this.col[k + 2] * fade);
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

/* ── ember chunks: tumbling, cooling from white-hot to a dull glow ───────── */

class ChunkLayer {
  readonly mesh: InstancedMesh;
  private n = 0;
  private steal = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly axis: Float32Array;
  private readonly col: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size: Float32Array;
  private readonly spin: Float32Array;

  constructor(private readonly max: number) {
    // Unlit and opaque: a chunk is its own light, and it needs no sorting.
    this.mesh = instanced(new IcosahedronGeometry(0.025, 0), new MeshBasicMaterial({ fog: false }), max);
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.axis = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.size = new Float32Array(max);
    this.spin = new Float32Array(max);
  }

  spawn(p: Vector3, vx: number, vy: number, vz: number, c: Color, life: number, size: number, spin: number): void {
    let i = this.n;
    if (i < this.max) this.n++;
    else i = this.steal = (this.steal + 1) % this.max;
    const k = i * 3;
    this.pos[k] = p.x;
    this.pos[k + 1] = p.y;
    this.pos[k + 2] = p.z;
    this.vel[k] = vx;
    this.vel[k + 1] = vy;
    this.vel[k + 2] = vz;
    _x.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.axis[k] = _x.x;
    this.axis[k + 1] = _x.y;
    this.axis[k + 2] = _x.z;
    this.col[k] = c.r;
    this.col[k + 1] = c.g;
    this.col[k + 2] = c.b;
    this.age[i] = 0;
    this.life[i] = life;
    this.size[i] = size;
    this.spin[i] = spin;
  }

  private kill(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.axis.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.col.copyWithin(i * 3, j * 3, j * 3 + 3);
    this.age[i] = this.age[j];
    this.life[i] = this.life[j];
    this.size[i] = this.size[j];
    this.spin[i] = this.spin[j];
  }

  update(dt: number): void {
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
      this.vel[k + 1] -= 4.5 * dt;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      _p.fromArray(this.pos, k);
      _q.setFromAxisAngle(_x.fromArray(this.axis, k), this.spin[i] * age);
      const s = this.size[i] * (1 - t * t);
      _m.compose(_p, _q, _s.set(s, s, s));
      this.mesh.setMatrixAt(i, _m);
      // Cooling: white-hot for the first instant, the fire's own colour
      // through the flight, a dull coal as it dies.
      const heat = Math.max(0, 1 - t * 4);
      const cool = 1 - 0.75 * t;
      colors.setXYZ(
        i,
        (this.col[k] + (1 - this.col[k]) * heat) * cool,
        (this.col[k + 1] + (1 - this.col[k + 1]) * heat) * cool,
        (this.col[k + 2] + (1 - this.col[k + 2]) * heat) * cool,
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
  live: boolean;
}

/** The damage-number style: red for every hit — a heavy one just reads bigger. */
const DMG_FILL = '#ff1605';
const DMG_GLOW = 'rgba(255,30,10,1)';

/* ── the module's pools ──────────────────────────────────────────────────── */

let glow: BillboardLayer | undefined;
let stars: BillboardLayer | undefined;
let rings: BillboardLayer | undefined;
let streaks: StreakLayer | undefined;
let chunks: ChunkLayer | undefined;
const popups: Popup[] = [];
let popupCursor = 0;
/** Labels still to rasterise ahead of their first use, one per frame. */
const prewarm: [string, string, string][] = [];

/** Build the pools and hang them in the scene. Call once at boot. */
export function initImpactFx(scene: Scene): void {
  if (glow) return;
  glow = new BillboardLayer(glowTexture(), 96);
  stars = new BillboardLayer(starTexture(), 48);
  rings = new BillboardLayer(ringTexture(), 48);
  streaks = new StreakLayer(256);
  chunks = new ChunkLayer(128);
  scene.add(glow.mesh, stars.mesh, rings.mesh, streaks.mesh, chunks.mesh);

  // The popups are separate quads (each wears its own number); all share
  // one program. A permanent zero-size KEEPER holds that program compiled so
  // the first number of a bout doesn't pay for it.
  const first = popupTexture(String(FIREBALL.damage), DMG_FILL, DMG_GLOW);
  const popupMat = (): MeshBasicMaterial =>
    new MeshBasicMaterial({ map: first, transparent: true, depthTest: false, depthWrite: false, fog: false });
  for (let i = 0; i < POPUP_POOL; i++) {
    const mat = popupMat();
    const mesh = new Mesh(POPUP_GEO, mat);
    mesh.renderOrder = 60;
    mesh.visible = false;
    mesh.frustumCulled = false;
    scene.add(mesh);
    popups.push({ mesh, mat, age: 0, life: 1, base: 1, y0: 0, drift: 0, live: false });
  }
  const keeper = new Mesh(POPUP_GEO, popupMat());
  keeper.scale.setScalar(1e-6);
  keeper.frustumCulled = false;
  keeper.renderOrder = 60;
  scene.add(keeper);

  // Rasterise the numbers a bout actually throws before the first one lands.
  const big = FIREBALL.headDamage;
  for (const d of [FIREBALL.damage, Math.round(FIREBALL.damage / 3), Math.round(FIREBALL.damage / 3) + big - FIREBALL.damage, 10, 15, big, 30]) {
    prewarm.push([String(d), DMG_FILL, DMG_GLOW]);
  }
  prewarm.push(['X', '#ff2a2a', 'rgba(255,40,30,1)'], ['GG', '#ffffff', 'rgba(255,255,255,0.95)']);
}

/** Advance every live effect. Call once per frame (FXSystem does). */
export function updateImpactFx(dt: number, camera: Camera): void {
  if (!glow) return;
  const job = prewarm.pop();
  if (job) popupTexture(job[0], job[1], job[2]);

  camera.getWorldQuaternion(_camQ);
  camera.getWorldPosition(_camPos);
  glow.update(dt, _camQ);
  stars!.update(dt, _camQ);
  rings!.update(dt, _camQ);
  streaks!.update(dt, _camPos);
  chunks!.update(dt);

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
    pop.mat.opacity = t < 0.06 ? t / 0.06 : t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
  }
}

/** Drop every live effect (crossing between unrelated experiences). */
export function clearImpactFx(): void {
  glow?.clear();
  stars?.clear();
  rings?.clear();
  streaks?.clear();
  chunks?.clear();
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
  if (popups.length === 0) return;
  const pop = popups[popupCursor];
  popupCursor = (popupCursor + 1) % popups.length;
  pop.mat.map = popupTexture(text, fill, glowCss);
  pop.mat.opacity = 0;
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
 *  red — a heavy one (a headshot) just punches in bigger. */
export function spawnDamagePopup(world: World, pos: Vector3, dmg: number): void {
  const d = Math.round(dmg);
  const big = d >= FIREBALL.headDamage;
  const scale = Math.min(1.5, 0.85 + d / 60) * (big ? 1.15 : 1);
  spawnPopup(world, pos, String(d), DMG_FILL, DMG_GLOW, scale);
}

/**
 * A crisp metallic spark for social hand gestures (clap / fist bump): a quick
 * bright pop, a snappy warm ring, a tiny glint and a short spray of sparks —
 * it reads like two iron gauntlets clinking, not a soft white puff.
 */
export function spawnGestureCue(_world: World, pos: Vector3, scale = 0.28): void {
  if (!glow) return;
  glow.spawn(pos, Anim.Flash, scale, 0.1, _col.set(0xfff1d0));
  rings!.spawn(pos, Anim.Ring, scale * 0.9, 0.26, _col.set(0xffe19a), 0.85);
  stars!.spawn(pos, Anim.Star, scale * 0.8, 0.09, _col.set(0xffffff), 0.9, Math.random() * Math.PI);
  emberBurst(pos, Math.max(5, Math.round(scale * 28)), false);
}

/**
 * A fiery burst where a ball lands, is parried, or burns out. `scale` grows
 * the whole event — body hits on the player use ~1.7 so taking a hit FEELS
 * like taking a hit. `dir` (optional) is the way the ball was travelling:
 * the sparks then splash back off the struck surface instead of every way.
 */
export function spawnFireImpact(_world: World, pos: Vector3, team: number, scale = 1, dir?: Vector3): void {
  if (!glow) return;
  const tint = _col.set(teamColor(team));
  const white = WHITE_HOT;
  const s = scale;

  // The pop: a white-hot core over a halo in the fire's colour.
  glow.spawn(pos, Anim.Flash, 0.36 * s, 0.12, white, 1.15);
  glow.spawn(pos, Anim.Bloom, 0.7 * s, 0.26, tint, 0.95);
  // The starburst — a white spark crossed over a bigger coloured one.
  stars!.spawn(pos, Anim.Star, 0.5 * s, 0.12, white, 1, Math.random() * Math.PI, 3);
  stars!.spawn(pos, Anim.Star, 0.78 * s, 0.17, tint, 1.2, Math.random() * Math.PI, -2);
  // The shockwave.
  rings!.spawn(pos, Anim.Ring, 0.36 * s, 0.3, _hot.copy(tint).lerp(white, 0.55), 0.9);

  // Spark streaks.
  let bx = 0;
  let by = 0;
  let bz = 0;
  if (dir && dir.lengthSq() > 1e-6) {
    const l = dir.length();
    bx = -dir.x / l;
    by = -dir.y / l;
    bz = -dir.z / l;
  }
  const count = Math.round(14 * s);
  for (let i = 0; i < count; i++) {
    _x.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    _x.x += bx * 0.85;
    _x.y += by * 0.85 + 0.15;
    _x.z += bz * 0.85;
    _x.normalize();
    const speed = 2.6 + Math.random() * 3.6;
    _hot.copy(tint).lerp(white, Math.random() * 0.65).multiplyScalar(2.1);
    streaks!.spawn(pos, _x.x * speed, _x.y * speed, _x.z * speed, _hot, 0.16 + Math.random() * 0.22, 0.014 + Math.random() * 0.012);
  }

  // The spark spray from the shared ember pool — the lingering drift.
  emberBurst(pos, Math.round(12 * s), team === 1);

  // Glowing chunks that pop and tumble out, cooling as they go.
  for (let i = 0; i < Math.round(6 * s); i++) {
    _x.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    const speed = 1.4 + Math.random() * 1.8;
    chunks!.spawn(
      pos,
      _x.x * speed + bx * 0.6,
      _x.y * speed + 0.6,
      _x.z * speed + bz * 0.6,
      tint,
      0.5 + Math.random() * 0.35,
      0.55 + Math.random() * 0.65,
      (Math.random() - 0.5) * 24,
    );
  }
}
