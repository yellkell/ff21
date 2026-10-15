/**
 * TRACERS — sparks as hot metal, not glitter.
 *
 * The lens-glint sparkle (glow.ts glintTexture) is a STAR: a hot core with
 * crossing streaks, the shape a camera gives a point of light. On a strike
 * landing and on a stick paying out it read as fairy dust, which is the one
 * thing a laser rig and a neon tube are not. What a real hit throws is what
 * a cutting disc throws: chips of metal hot enough to glow, too fast for the
 * eye to see as dots. You see their PATHS. So a tracer is a short streak
 * along its own velocity, white-hot at the head and gone by the tail, that
 * cools through its colour into the dark as it flies, falls on real gravity
 * and skids once off the deck before it dies. No twinkle, no star, no halo:
 * a straight line of light that is always pointing where it's going.
 *
 * One draw per field: an instanced camera-facing ribbon (the quad is
 * expanded in view space across the streak, so it has width from every
 * angle and stays a line edge-on), additive, depth-tested, writing no depth.
 * Positions are in the field's own space, so a field parked under a deck
 * root rides the deck.
 */

import {
  AdditiveBlending,
  BufferAttribute,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
} from 'three';

const VERT = /* glsl */ `
  attribute vec3 aHead;
  attribute vec3 aTail;
  attribute vec4 aColor;   // rgb, w = width (m)
  varying vec3 vCol;
  varying vec2 vC;
  void main() {
    vec4 h = modelViewMatrix * vec4(aHead, 1.0);
    vec4 t = modelViewMatrix * vec4(aTail, 1.0);
    vec3 d = t.xyz - h.xyz;
    float len = length(d);
    vec3 dn = len > 1e-6 ? d / len : vec3(0.0, 1.0, 0.0);
    float w = aColor.w;
    // Along the streak (x: 0 head, 1 tail), rounded past both ends by half
    // the width so a slow tracer is a short capsule, not a square.
    vec3 p = mix(h.xyz, t.xyz, position.x) + dn * w * (position.x * 2.0 - 1.0) * 0.5;
    // Across it: perpendicular to the streak AND the eye ray.
    vec3 s = cross(dn, normalize(p));
    float sl = length(s);
    s = sl > 1e-5 ? s / sl : vec3(1.0, 0.0, 0.0);
    p += s * position.y * w * 0.5;
    vCol = aColor.rgb;
    vC = position.xy;
    gl_Position = projectionMatrix * vec4(p, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform float uGain;
  varying vec3 vCol;
  varying vec2 vC;
  void main() {
    float across = 1.0 - vC.y * vC.y;
    float core = across * across * across * across;
    float along = 1.0 - vC.x;
    along *= along;
    // The colour across the ribbon, a white core down its middle at the head.
    vec3 c = vCol * across * along + vec3(core * along * along) * max(vCol.r, max(vCol.g, vCol.b)) * 0.6;
    gl_FragColor = vec4(c * uGain, 1.0);
    #include <colorspace_fragment>
  }
`;

/** The quad every tracer is drawn with: x along (0 head → 1 tail), y across. */
function ribbon(): InstancedBufferGeometry {
  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array([0, -1, 0, 1, -1, 0, 1, 1, 0, 0, 1, 0]), 3));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

export interface TracerOpts {
  /** Ribbon width (metres). */
  width?: number;
  /** How many seconds of flight the streak shows behind its head. */
  streak?: number;
  /** The longest a streak is ever drawn (metres). */
  maxLen?: number;
  /** Downward acceleration (m/s²) and horizontal drag (1/s). */
  gravity?: number;
  drag?: number;
  /** The floor it skids off (field space); a second touch kills it. */
  floorY?: number;
  /** Fraction of the tracer's life spent white-hot before it shows its colour. */
  hot?: number;
  /** Overall brightness. */
  gain?: number;
}

const _c = new Color();
const _white = new Color(0xffffff);

export class TracerField {
  readonly mesh: Mesh;
  readonly material: ShaderMaterial;
  private n: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private base: Float32Array;
  private age: Float32Array;
  private life: Float32Array;
  private width: Float32Array;
  private bounced: Uint8Array;
  private head: InstancedBufferAttribute;
  private tail: InstancedBufferAttribute;
  private color: InstancedBufferAttribute;
  private cursor = 0;
  private lit = false;
  private o: Required<TracerOpts>;

  constructor(n: number, opts: TracerOpts = {}) {
    this.n = n;
    this.o = {
      width: opts.width ?? 0.006,
      streak: opts.streak ?? 0.032,
      maxLen: opts.maxLen ?? 0.16,
      gravity: opts.gravity ?? 6.5,
      drag: opts.drag ?? 1.2,
      floorY: opts.floorY ?? 0.02,
      hot: opts.hot ?? 0.18,
      gain: opts.gain ?? 1,
    };
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.base = new Float32Array(n * 3);
    this.age = new Float32Array(n);
    this.life = new Float32Array(n);
    this.width = new Float32Array(n);
    this.bounced = new Uint8Array(n);
    const geo = ribbon();
    this.head = new InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    this.tail = new InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(DynamicDrawUsage);
    this.color = new InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(DynamicDrawUsage);
    geo.setAttribute('aHead', this.head);
    geo.setAttribute('aTail', this.tail);
    geo.setAttribute('aColor', this.color);
    geo.instanceCount = n;
    this.material = new ShaderMaterial({
      uniforms: { uGain: { value: this.o.gain } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 23;
  }

  /** Throw one tracer from (x,y,z) at (vx,vy,vz) m/s. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, colorHex: number, widthMul = 1): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    _c.setHex(colorHex);
    this.base[i3] = _c.r;
    this.base[i3 + 1] = _c.g;
    this.base[i3 + 2] = _c.b;
    this.age[i] = 0;
    this.life[i] = life;
    this.width[i] = this.o.width * widthMul;
    this.bounced[i] = 0;
    this.lit = true;
    this.write(i);
    // Born alight: it shows on the frame it was thrown.
    this.head.needsUpdate = true;
    this.tail.needsUpdate = true;
    this.color.needsUpdate = true;
  }

  /**
   * A spray: `count` tracers from (x,y,z) inside a cone of half-angle
   * `spread` (radians) about the axis (ax,ay,az — need not be unit), at
   * `speed` m/s give or take `jitter` of it, plus a carried velocity.
   */
  spray(
    x: number, y: number, z: number,
    ax: number, ay: number, az: number,
    count: number, speed: number, spread: number,
    life: number, colorHex: number,
    carry?: { x: number; y: number; z: number },
    jitter = 0.45,
  ): void {
    let l = Math.hypot(ax, ay, az);
    if (l < 1e-6) {
      ax = 0; ay = 1; az = 0; l = 1;
    }
    ax /= l; ay /= l; az /= l;
    // A frame round the axis.
    let tx = Math.abs(ax) > 0.9 ? 0 : 1;
    let ty = 0;
    let tz = Math.abs(ax) > 0.9 ? 1 : 0;
    // t1 = normalize(t × axis), t2 = axis × t1
    let t1x = ty * az - tz * ay;
    let t1y = tz * ax - tx * az;
    let t1z = tx * ay - ty * ax;
    const tl = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= tl; t1y /= tl; t1z /= tl;
    const t2x = ay * t1z - az * t1y;
    const t2y = az * t1x - ax * t1z;
    const t2z = ax * t1y - ay * t1x;
    tx = ty = tz = 0;
    for (let n = 0; n < count; n++) {
      const a = Math.random() * Math.PI * 2;
      // Square-root fill: an even cone, not one bunched on its axis.
      const off = Math.sqrt(Math.random()) * Math.tan(spread);
      const dx = ax + (t1x * Math.cos(a) + t2x * Math.sin(a)) * off;
      const dy = ay + (t1y * Math.cos(a) + t2y * Math.sin(a)) * off;
      const dz = az + (t1z * Math.cos(a) + t2z * Math.sin(a)) * off;
      const dl = Math.hypot(dx, dy, dz);
      const v = speed * (1 - jitter + Math.random() * jitter * 2) / dl;
      this.emit(
        x, y, z,
        dx * v + (carry?.x ?? 0), dy * v + (carry?.y ?? 0), dz * v + (carry?.z ?? 0),
        life * (0.7 + Math.random() * 0.6),
        colorHex,
        0.7 + Math.random() * 0.6,
      );
    }
  }

  /** Head, tail and colour of tracer i, from its state. */
  private write(i: number): void {
    const i3 = i * 3;
    const i4 = i * 4;
    const hd = this.head.array as Float32Array;
    const tl = this.tail.array as Float32Array;
    const cl = this.color.array as Float32Array;
    if (this.life[i] <= 0) {
      cl[i4] = cl[i4 + 1] = cl[i4 + 2] = cl[i4 + 3] = 0;
      hd[i3] = tl[i3] = this.pos[i3];
      hd[i3 + 1] = tl[i3 + 1] = -99;
      hd[i3 + 2] = tl[i3 + 2] = this.pos[i3 + 2];
      return;
    }
    const vx = this.vel[i3];
    const vy = this.vel[i3 + 1];
    const vz = this.vel[i3 + 2];
    const sp = Math.hypot(vx, vy, vz);
    let s = this.o.streak;
    if (sp * s > this.o.maxLen) s = this.o.maxLen / sp;
    hd[i3] = this.pos[i3];
    hd[i3 + 1] = this.pos[i3 + 1];
    hd[i3 + 2] = this.pos[i3 + 2];
    tl[i3] = this.pos[i3] - vx * s;
    tl[i3 + 1] = this.pos[i3 + 1] - vy * s;
    tl[i3 + 2] = this.pos[i3 + 2] - vz * s;
    // White-hot out of the hit, cooling into its colour, then into the dark.
    const k = this.age[i] / this.life[i];
    const hot = this.o.hot;
    const cool = Math.min(1, k / Math.max(1e-3, hot));
    const fade = Math.pow(1 - k, 1.6);
    _c.setRGB(this.base[i3], this.base[i3 + 1], this.base[i3 + 2]);
    _c.lerp(_white, (1 - cool) * 0.85);
    cl[i4] = _c.r * fade;
    cl[i4 + 1] = _c.g * fade;
    cl[i4 + 2] = _c.b * fade;
    cl[i4 + 3] = this.width[i];
  }

  step(dt: number): void {
    if (!this.lit) return;
    const g = this.o.gravity;
    const drag = Math.max(0, 1 - this.o.drag * dt);
    const floor = this.o.floorY;
    let burning = 0;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      const i3 = i * 3;
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        this.life[i] = 0;
        this.write(i);
        continue;
      }
      burning++;
      this.vel[i3 + 1] -= g * dt;
      this.vel[i3] *= drag;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.pos[i3 + 1] < floor && this.vel[i3 + 1] < 0) {
        // One skid off the deck, flatter and slower; the second touch is
        // the end of it — nothing lies about on the floor.
        if (this.bounced[i]) {
          this.life[i] = 0;
          this.write(i);
          continue;
        }
        this.bounced[i] = 1;
        this.pos[i3 + 1] = floor;
        this.vel[i3 + 1] *= -0.28;
        this.vel[i3] *= 0.6;
        this.vel[i3 + 2] *= 0.6;
        // A skidding chip has spent most of its heat.
        this.age[i] = Math.max(this.age[i], this.life[i] * 0.55);
      }
      this.write(i);
    }
    this.head.needsUpdate = true;
    this.tail.needsUpdate = true;
    this.color.needsUpdate = true;
    if (burning === 0) this.lit = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
