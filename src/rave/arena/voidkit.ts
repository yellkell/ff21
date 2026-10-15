/**
 * THE VOID KIT — the abstract space language the game's bookends share.
 *
 * Deep Beat-Saber-background inspiration, adapted to a radial arena: vast
 * darkness given shape by LIGHT ONLY. No walls, no materials pretending to
 * be matter — everything here is near-black gloss or pure emission.
 *
 * The fidelity comes from four things, in order of how much they buy:
 *
 *  1. THE MIRROR. A polished floor doubling every light is the single
 *     biggest signature of the scenes we're chasing. There is no render
 *     pass for it: `mirrorOf()` clones the scenery upside down under the
 *     floor and RE-SHARES its instance buffers, so the reflection animates
 *     for free — one extra draw per bank, no extra memory, no second
 *     camera (which stereo WebXR would charge double for anyway).
 *  2. DEPTH IN LAYERS. Near towers, mid towers, a far skyline, a horizon:
 *     four silhouette scales at four distances is what makes a black room
 *     read as a vast one. Parallax does the rest as you move your head.
 *  3. STRUCTURE, NOT STICKS. Towers carry pinstripes, panel gaps, porthole
 *     rows and a lit cap; the canopy is a real truss — concentric rings
 *     tied by radial spars with lit nodes at the joints. Detail at three
 *     scales (silhouette / panel / pinprick) is what "high poly" actually
 *     looks like from inside a headset.
 *  4. AIR. Light shafts, drifting dust and a horizon glow give the empty
 *     middle distance something to be, so the darkness has depth instead
 *     of just being far away.
 *
 * Perf discipline: everything repeated is an InstancedMesh, and every
 * animated glow is driven through per-instance COLOUR (MeshBasicMaterial
 * multiplies material.color by instanceColor), so a hundred towers pulsing
 * independently still cost one draw call. Measured: the set's whole world
 * is 48 draws and ~24k triangles across 1,521 instances, mirror included —
 * roughly half the draw calls of the twelve hand-built pylon Groups it
 * replaces, for an order of magnitude more scenery.
 *
 * Used by the SET (arena/environment.ts) and the FOYER (club/build.ts) —
 * the menu void and the game void are the same place at different sizes;
 * the club is the warm human room between them.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Plane,
  OctahedronGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';

/** The void's own darkness (fog + backdrop). */
export const VOID_BG = 0x040309;

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _e = new Euler();
const _s = new Vector3();
const _c = new Color();
const WHITE = new Color(0xffffff);

/** Deterministic little RNG so a scene is the same scene every night. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/* ── the glow bank: a hundred lights, one draw call ─────────────────────── */

/**
 * Instanced emissive pieces whose brightness and hue are per-instance and
 * animated every frame. MeshBasicMaterial multiplies its own `color` by
 * the instance colour, so the mirror can share this exact buffer while
 * wearing a dimmer material — that's the whole reflection trick.
 */
export class GlowBank {
  readonly mesh: InstancedMesh;
  readonly material: MeshBasicMaterial;

  constructor(
    geo: BufferGeometry,
    count: number,
    opts: { additive?: boolean; opacity?: number } = {},
  ) {
    const additive = opts.additive ?? false;
    this.material = new MeshBasicMaterial({
      color: 0xffffff,
      transparent: additive || (opts.opacity ?? 1) < 1,
      opacity: opts.opacity ?? 1,
      blending: additive ? AdditiveBlending : undefined,
      depthWrite: !additive,
      side: DoubleSide, // the mirror renders these at scale.y = −1
      toneMapped: false,
    });
    this.mesh = new InstancedMesh(geo, this.material, count);
    this.mesh.frustumCulled = false;
    // Allocate the colour buffer up front so every instance is addressable.
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, WHITE);
  }

  /** Park instance `i`. Euler in radians, scale per axis. */
  place(i: number, pos: Vector3, rot: Euler, scale: Vector3): void {
    _q.setFromEuler(rot);
    this.mesh.setMatrixAt(i, _m.compose(pos, _q, scale));
  }

  /**
   * Light instance `i`. `k` is brightness: below 1 dims toward black, above
   * 1 pushes toward white (a Basic material can't exceed 1, and washing to
   * white is what a blown-out light does anyway).
   */
  tint(i: number, hex: number, k: number): void {
    _c.setHex(hex);
    if (k <= 1) _c.multiplyScalar(Math.max(0, k));
    else _c.lerp(WHITE, Math.min(1, (k - 1) * 0.6));
    this.mesh.setColorAt(i, _c);
  }

  /** Push this frame's placements/colours to the GPU. */
  commit(matrices = false): void {
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (matrices) this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Instanced near-black bodies — the substance the light sits on. */
export function darkBank(geo: BufferGeometry, count: number, color = 0x08070e): InstancedMesh {
  const mesh = new InstancedMesh(
    geo,
    new MeshStandardMaterial({ color, metalness: 0.82, roughness: 0.34, side: DoubleSide }),
    count,
  );
  mesh.frustumCulled = false;
  return mesh;
}

/* ── the mirror ─────────────────────────────────────────────────────────── */

/**
 * A reflection of `src`, flipped under the floor plane.
 *
 * The clone re-shares the originals' instance buffers, so anything the
 * scene animates upstairs animates downstairs for nothing. Its materials
 * ARE cloned (once), only so the reflection can be dimmed and tinted —
 * `material.color` multiplies the shared instance colour, so a grey there
 * is exactly a dimmer copy of whatever the real light is doing.
 */
export function mirrorOf(src: Object3D, dim = 0.42, floorY = 0): Object3D {
  const out = src.clone(true);
  out.scale.y = -1;
  out.position.y = floorY * 2 - src.position.y;

  // ONE plane for the whole reflection, kept pointed at the real floor.
  // The hook goes on every mirrored MESH rather than on `out`, because
  // onBeforeRender never fires for a Group and `out` usually is one — the
  // plane would then keep its build-time constant for ever, which is the
  // silent no-op this whole thing exists to avoid.
  const plane = new Plane(new Vector3(0, -1, 0), floorY);
  const _floor = new Vector3();
  const syncPlane = (): void => {
    const p = out.parent;
    if (!p) return;
    _floor.set(0, floorY, 0).applyMatrix4(p.matrixWorld);
    plane.constant = _floor.y;
  };

  const from: Object3D[] = [];
  const to: Object3D[] = [];
  src.traverse((o) => from.push(o));
  out.traverse((o) => to.push(o));

  for (let i = 0; i < to.length; i++) {
    const a = from[i] as InstancedMesh;
    const b = to[i] as InstancedMesh;
    if (!b) continue;
    // Re-share the buffers the clone duplicated: one source of truth, and
    // the reflection tracks every pulse without a line of update code.
    if (a.isInstancedMesh && b.isInstancedMesh) {
      b.instanceMatrix = a.instanceMatrix;
      if (a.instanceColor) b.instanceColor = a.instanceColor;
    }
    const mesh = b as unknown as Mesh;
    const mat = (mesh as Mesh).material as Material | Material[] | undefined;
    if (!mat) continue;
    const dimOne = (m: Material): Material => {
      const c = m.clone();
      const basic = c as MeshBasicMaterial;
      const std = c as MeshStandardMaterial;
      if (basic.color) basic.color.multiplyScalar(dim);
      if (std.emissive) std.emissive.multiplyScalar(dim);
      c.side = DoubleSide;
      // Pushed a hair back in depth: where a reflection shares a plane
      // with the thing it reflects (anything straddling the glass), the
      // real surface wins outright instead of z-fighting it (banks.ts
      // mirrorBank has the long version).
      c.polygonOffset = true;
      c.polygonOffsetFactor = 1;
      c.polygonOffsetUnits = 2;
      c.depthWrite = false;
      // Clipped to below the glass, for the same reason the circuit's banks
      // are (course/banks.ts mirrorBank): a flip is only honest above the
      // plane, so anything sitting ON the floor would otherwise fold its
      // underside back up through itself. The constant is the floor's WORLD
      // height, refreshed per frame — these planes are world-space and the
      // scenery they cut is not built at the world origin.
      c.clippingPlanes = [plane];
      return c;
    };
    mesh.material = Array.isArray(mat) ? mat.map(dimOne) : dimOne(mat);
    mesh.onBeforeRender = syncPlane;
    mesh.renderOrder = -1; // under the world, always
  }
  return out;
}

/* ── the floor: grid, rays, rings, and the polish over them ─────────────── */

let _gridTex: CanvasTexture | null = null;
function gridTexture(): CanvasTexture {
  if (_gridTex) return _gridTex;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  // A heavy cell line with a hairline quarter-grid inside it: two scales of
  // detail in one texture, which is what stops a grid reading as graph paper.
  g.strokeStyle = 'rgba(255,255,255,0.28)';
  g.lineWidth = 1;
  for (let i = 1; i < 4; i++) {
    const t = (i / 4) * 256;
    g.beginPath();
    g.moveTo(t, 0);
    g.lineTo(t, 256);
    g.moveTo(0, t);
    g.lineTo(256, t);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,1)';
  g.lineWidth = 2.5;
  g.strokeRect(1, 1, 254, 254);
  const tex = new CanvasTexture(c);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  _gridTex = tex;
  return tex;
}

/** A soft radial falloff, white core → nothing. Used for fades and dust. */
let _falloffTex: CanvasTexture | null = null;
function falloffTexture(inner = 0.0, outer = 1.0): CanvasTexture {
  if (_falloffTex && inner === 0 && outer === 1) return _falloffTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 64 * inner, 64, 64, 64 * outer);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.42)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  if (inner === 0 && outer === 1) _falloffTex = tex;
  return tex;
}

export interface VoidFloor {
  group: Group;
  /** The grid's additive wash — breathe it with the bar. */
  gridMat: MeshBasicMaterial;
  /** Radial light rays, one instance each: a rolling wave on the beat. */
  rays: GlowBank;
  rayCount: number;
  /** Concentric ring lines. */
  rings: GlowBank;
  ringCount: number;
}

/**
 * The ground the void almost has: a black gloss disc, a two-scale grid
 * dissolving outward, a fan of radial light rays, and concentric rings —
 * the floor language of every scene worth stealing from. Rays and rings
 * start beyond `inner` so nothing ever crosses a dancer's deck.
 */
export function buildVoidFloor(
  radius: number,
  inner: number,
  color: number,
  cell = 1.4,
  opacity = 0.14,
): VoidFloor {
  const group = new Group();

  // BLACK GLASS, not a lid. An opaque disc here buries the entire mirror
  // under it — the floor has to be a dark pane the reflection reads
  // through, which is also exactly what a polished floor is.
  const disc = new Mesh(
    new CircleGeometry(radius, 72),
    new MeshStandardMaterial({
      color: 0x07060c,
      metalness: 0.92,
      roughness: 0.22,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    }),
  );
  disc.rotation.x = -Math.PI / 2;
  group.add(disc);

  const tex = gridTexture().clone();
  tex.needsUpdate = true;
  tex.repeat.set((radius * 2) / cell, (radius * 2) / cell);
  const gridMat = new MeshBasicMaterial({
    map: tex,
    alphaMap: falloffTexture(),
    color,
    transparent: true,
    opacity,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const grid = new Mesh(new CircleGeometry(radius, 72), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = 0.012;
  group.add(grid);

  // Radial rays — long thin quads fanning out past the ring.
  const rayCount = 28;
  const rays = new GlowBank(new CircleGeometry(0.5, 4), rayCount, { additive: true, opacity: 0.5 });
  const len = radius - inner;
  for (let i = 0; i < rayCount; i++) {
    const a = (i / rayCount) * Math.PI * 2;
    _p.set(Math.sin(a) * (inner + len / 2), 0.02, Math.cos(a) * (inner + len / 2));
    _e.set(-Math.PI / 2, 0, -a);
    _s.set(0.34, len, 1);
    rays.place(i, _p, _e, _s);
    rays.tint(i, color, 0.5);
  }
  rays.commit(true);
  group.add(rays.mesh);

  // Concentric ring lines, thickening outward.
  const ringR = [inner + 1.5, inner + 5, inner + 11, inner + 19, radius - 3];
  const ringCount = ringR.length;
  // Unit ring scaled per instance — keep the band thin so it stays a LINE
  // at r = 45 instead of a metre-wide stripe.
  const rings = new GlowBank(new RingGeometry(0.994, 1.0, 128), ringCount, { additive: true, opacity: 0.8 });
  ringR.forEach((r, i) => {
    _p.set(0, 0.03, 0);
    _e.set(-Math.PI / 2, 0, 0);
    _s.set(r, r, 1);
    rings.place(i, _p, _e, _s);
    rings.tint(i, color, 0.6);
  });
  rings.commit(true);
  group.add(rings.mesh);

  return { group, gridMat, rays, rayCount, rings, ringCount };
}

/** A wide, faint sheen over the reflection — the "polish" on the polish. */
export function buildFloorSheen(inner: number, outer: number, color: number): Mesh {
  const mat = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.05,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const mesh = new Mesh(new RingGeometry(inner, outer, 72), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.008;
  mesh.renderOrder = 1;
  return mesh;
}

/* ── towers: the skyline that breathes ──────────────────────────────────── */

export interface TowerRing {
  group: Group;
  count: number;
  /** Per-tower light: pinstripes, cap and shaft all take one call. */
  setGlow(i: number, hex: number, k: number): void;
  commit(): void;
}

export interface TowerOpts {
  count: number;
  radius: number;
  baseY?: number;
  minH: number;
  maxH: number;
  width?: number;
  /** Additive light shafts rising off the caps. */
  shafts?: boolean;
  /** Porthole rows down the shaft — near towers only; wasted far away. */
  portholes?: boolean;
  seed?: number;
  /** Radial jitter so a ring never reads as a fence. */
  scatter?: number;
}

/**
 * A ring of monolith towers, built as instanced banks: dark tapered bodies,
 * four full-height pinstripes each, a lit cap, an optional shaft of light
 * and an optional column of portholes. One draw call per element type for
 * the whole ring, per-tower colour and brightness.
 */
export function buildTowerRing(o: TowerOpts): TowerRing {
  const {
    count,
    radius,
    baseY = 0,
    minH,
    maxH,
    width = 1.1,
    shafts = false,
    portholes = false,
    seed = 5,
    scatter = 0,
  } = o;
  const group = new Group();
  const rnd = rng(seed);

  const STRIPES = 4;
  const PORTS = portholes ? 7 : 0;
  const bodies = darkBank(new CylinderGeometry(0.42, 0.5, 1, 6), count, 0x09080f);
  // A thin band near the base and the shoulder: panel lines, the cheapest
  // detail there is and the first thing missing from a plain box.
  const bands = darkBank(new CylinderGeometry(0.54, 0.54, 1, 6), count * 2, 0x131120);
  const stripes = new GlowBank(new CylinderGeometry(0.5, 0.5, 1, 3, 1, true), count * STRIPES, {
    additive: true,
    opacity: 0.85,
  });
  const caps = new GlowBank(new CylinderGeometry(0.36, 0.5, 1, 6), count);
  const ports = PORTS ? new GlowBank(new CircleGeometry(0.5, 8), count * PORTS, { additive: true, opacity: 0.9 }) : null;
  // A narrow shaft off each cap. Narrow is the whole point: a fat cone is
  // a fog bank, a thin one is a searchlight.
  const shaftBank = shafts
    ? new GlowBank(new CylinderGeometry(0.06, 0.3, 1, 7, 1, true), count, { additive: true, opacity: 0.09 })
    : null;

  const heights: number[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.PI / count;
    const r = radius + (scatter ? (rnd() - 0.5) * scatter : 0);
    const h = minH + rnd() * (maxH - minH);
    heights.push(h);
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    const face = a + Math.PI;

    _p.set(x, baseY + h / 2, z);
    _e.set(0, face, 0);
    _s.set(width, h, width);
    bodies.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s));

    // Panel bands: a wide collar low down, a narrow one at the shoulder.
    _p.set(x, baseY + h * 0.14, z);
    _s.set(width * 1.06, h * 0.045, width * 1.06);
    bands.setMatrixAt(i * 2, _m.compose(_p, _q.setFromEuler(_e), _s));
    _p.set(x, baseY + h * 0.82, z);
    _s.set(width * 1.04, h * 0.022, width * 1.04);
    bands.setMatrixAt(i * 2 + 1, _m.compose(_p, _q.setFromEuler(_e), _s));

    // Four pinstripes running the height, set just proud of the faces.
    for (let s = 0; s < STRIPES; s++) {
      const sa = face + (s / STRIPES) * Math.PI * 2 + Math.PI / STRIPES;
      const off = width * 0.47;
      _p.set(x + Math.sin(sa) * off, baseY + h * 0.5, z + Math.cos(sa) * off);
      _e.set(0, sa, 0);
      _s.set(width * 0.1, h * 0.9, width * 0.1);
      stripes.place(i * STRIPES + s, _p, _e, _s);
    }

    // The cap: a short lit frustum sitting on the shoulders.
    _p.set(x, baseY + h + width * 0.12, z);
    _e.set(0, face, 0);
    _s.set(width * 1.02, width * 0.26, width * 1.02);
    caps.place(i, _p, _e, _s);

    if (ports) {
      for (let pI = 0; pI < PORTS; pI++) {
        const t = (pI + 1) / (PORTS + 1);
        _p.set(x + Math.sin(face) * (width * 0.52), baseY + h * t, z + Math.cos(face) * (width * 0.52));
        _e.set(0, face, 0);
        _s.set(width * 0.16, width * 0.16, 1);
        ports.place(i * PORTS + pI, _p, _e, _s);
      }
    }

    if (shaftBank) {
      const sh = h * 1.1 + 8;
      _p.set(x, baseY + h + sh / 2, z);
      _e.set(0, face, 0);
      _s.set(width * 0.9, sh, width * 0.9);
      shaftBank.place(i, _p, _e, _s);
    }
  }

  bodies.instanceMatrix.needsUpdate = true;
  bands.instanceMatrix.needsUpdate = true;
  stripes.commit(true);
  caps.commit(true);
  ports?.commit(true);
  shaftBank?.commit(true);
  // Named so voidKit.ts can swap in the sculpted shapes (instances and colours untouched).
  bodies.name = 'void:tower-body';
  bands.name = 'void:tower-band';
  stripes.mesh.name = 'void:tower-stripe';
  caps.mesh.name = 'void:tower-cap';
  group.add(bodies, bands, stripes.mesh, caps.mesh);
  if (ports) group.add(ports.mesh);
  if (shaftBank) group.add(shaftBank.mesh);

  return {
    group,
    count,
    setGlow(i, hex, k) {
      for (let s = 0; s < STRIPES; s++) stripes.tint(i * STRIPES + s, hex, k * 0.85);
      caps.tint(i, hex, k * 1.15);
      if (ports) for (let pI = 0; pI < PORTS; pI++) ports.tint(i * PORTS + pI, hex, k * 0.9);
      shaftBank?.tint(i, hex, k * 0.8);
    },
    commit() {
      stripes.commit();
      caps.commit();
      ports?.commit();
      shaftBank?.commit();
    },
  };
}

/* ── the far skyline: silhouette depth for almost nothing ───────────────── */

/**
 * A scattered band of huge dark slabs way out past everything, each with a
 * single lit edge. Pure parallax: you never look at them, but the room is
 * twice as big because they're there.
 */
export function buildSkyline(
  count: number,
  rMin: number,
  rMax: number,
  hMin: number,
  hMax: number,
  seed = 11,
): { group: Group; edges: GlowBank; count: number } {
  const group = new Group();
  const rnd = rng(seed);
  const bodies = darkBank(new CylinderGeometry(0.5, 0.5, 1, 4), count, 0x060509);
  const edges = new GlowBank(new CylinderGeometry(0.5, 0.5, 1, 3, 1, true), count, {
    additive: true,
    opacity: 0.5,
  });
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.4;
    const r = rMin + rnd() * (rMax - rMin);
    const h = hMin + rnd() * (hMax - hMin);
    const w = 2.2 + rnd() * 5;
    const x = Math.sin(a) * r;
    const z = Math.cos(a) * r;
    _p.set(x, h / 2 - 2, z);
    _e.set(0, a + Math.PI / 4, 0);
    _s.set(w, h, w * 0.7);
    bodies.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s));
    _p.set(x + Math.sin(a + Math.PI) * w * 0.36, h / 2 - 2, z + Math.cos(a + Math.PI) * w * 0.36);
    _s.set(0.5, h * 0.96, 0.5);
    edges.place(i, _p, _e, _s);
    edges.tint(i, 0x3355aa, 0.5);
  }
  bodies.instanceMatrix.needsUpdate = true;
  edges.commit(true);
  bodies.name = 'void:sky-body';
  edges.mesh.name = 'void:sky-edge';
  group.add(bodies, edges.mesh);
  return { group, edges, count };
}

/* ── the canopy: a truss, not a hoop ────────────────────────────────────── */

export interface Canopy {
  group: Group;
  /** Rings turn; call every frame with the beat's spin. */
  spin(dt: number, rate: number): void;
  setGlow(hex: number, k: number): void;
  commit(): void;
}

/**
 * Concentric hex rings tied together by radial spars with lit nodes at the
 * joints — the overhead structure reads as built rather than drawn. Each
 * ring counter-rotates on its own axis inside a shared group.
 */
export function buildCanopy(
  ringCount: number,
  r0: number,
  rStep: number,
  y0: number,
  yStep: number,
  spars: number,
): Canopy {
  const group = new Group();
  const wheels: Group[] = [];
  const nodes = new GlowBank(new OctahedronGeometry(0.5, 0), ringCount * spars, { additive: false });
  // Thin lit tubes running the ring alongside the structural torus — the
  // canopy's own light. (An earlier pass hung wide additive volumes under
  // each ring; at arena scale they filled the sky with flat colour and
  // killed every bit of contrast in the room. Light the STRUCTURE.)
  const tubes = new GlowBank(new TorusGeometry(1, 0.012, 3, 48), ringCount, { additive: true, opacity: 0.8 });
  let n = 0;

  for (let i = 0; i < ringCount; i++) {
    const wheel = new Group();
    const r = r0 + i * rStep;
    wheel.position.y = y0 + i * yStep;
    // The ring itself: a low-side torus reads as machined, not jewellery.
    const ring = new Mesh(
      new TorusGeometry(r, 0.11 + i * 0.02, 4, 6),
      new MeshStandardMaterial({ color: 0x0a0911, metalness: 0.7, roughness: 0.4, side: DoubleSide }),
    );
    ring.rotation.x = Math.PI / 2;
    wheel.add(ring);
    // Radial spars tying it to the next ring in — the truss.
    const sparMesh = darkBank(new CylinderGeometry(0.5, 0.5, 1, 4), spars, 0x0b0a12);
    for (let s = 0; s < spars; s++) {
      const a = (s / spars) * Math.PI * 2;
      const inner = Math.max(0.6, r - rStep);
      const mid = (r + inner) / 2;
      _p.set(Math.sin(a) * mid, 0, Math.cos(a) * mid);
      _e.set(0, -a, Math.PI / 2);
      _s.set(0.13, r - inner, 0.13);
      sparMesh.setMatrixAt(s, _m.compose(_p, _q.setFromEuler(_e), _s));
    }
    sparMesh.instanceMatrix.needsUpdate = true;
    sparMesh.name = 'void:spar';
    wheel.add(sparMesh);
    group.add(wheel);
    wheels.push(wheel);

    // Lit nodes ride the world, not the wheel — they mark the structure's
    // joints without the cost of parenting a bank per ring.
    for (let s = 0; s < spars; s++) {
      const a = (s / spars) * Math.PI * 2 + i * 0.3;
      _p.set(Math.sin(a) * r, y0 + i * yStep, Math.cos(a) * r);
      _e.set(0, a, 0);
      _s.setScalar(0.3);
      nodes.place(n, _p, _e, _s);
      nodes.tint(n, 0xffffff, 0.7);
      n++;
    }

    _p.set(0, y0 + i * yStep, 0);
    _e.set(-Math.PI / 2, 0, 0);
    _s.set(r * 1.02, r * 1.02, r * 1.02);
    tubes.place(i, _p, _e, _s);
    tubes.tint(i, 0xffffff, 0.6);
  }
  nodes.commit(true);
  tubes.commit(true);
  nodes.mesh.name = 'void:node';
  group.add(nodes.mesh, tubes.mesh);

  return {
    group,
    spin(dt, rate) {
      wheels.forEach((w, i) => {
        w.rotation.y += (i % 2 ? -1 : 1) * rate * (0.6 + i * 0.25) * dt;
      });
    },
    setGlow(hex, k) {
      for (let i = 0; i < nodes.mesh.count; i++) nodes.tint(i, hex, k);
      for (let i = 0; i < tubes.mesh.count; i++) tubes.tint(i, hex, k * 0.8);
    },
    commit() {
      nodes.commit();
      tubes.commit();
    },
  };
}

/* ── arcs: the cathedral over the floor ─────────────────────────────────── */

/** Great half-rings springing over the arena, each turned a little off the
 *  last — the structure you notice when you look up mid-set. */
export function buildArcs(count: number, radius: number, tube: number, seed = 3): { group: Group; bank: GlowBank } {
  const group = new Group();
  const rnd = rng(seed);
  // The geometry is a UNIT torus scaled to `radius` per instance, so the
  // tube has to be pre-divided or the arch comes out metres thick.
  const t = tube / radius;
  const dark = darkBank(new TorusGeometry(1, t, 4, 26, Math.PI), count, 0x0a0911);
  const bank = new GlowBank(new TorusGeometry(1, t * 0.5, 3, 26, Math.PI), count, {
    additive: true,
    opacity: 0.7,
  });
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI + rnd() * 0.12;
    _p.set(0, 0, 0);
    _e.set(0, a, 0);
    _s.set(radius, radius, radius);
    dark.setMatrixAt(i, _m.compose(_p, _q.setFromEuler(_e), _s));
    bank.place(i, _p, _e, _s);
    bank.tint(i, 0xffffff, 0.5);
  }
  dark.instanceMatrix.needsUpdate = true;
  bank.commit(true);
  dark.name = 'void:arc-dark';
  bank.mesh.name = 'void:arc-glow';
  group.add(dark, bank.mesh);
  return { group, bank };
}

/* ── dust: the air itself ───────────────────────────────────────────────── */

/**
 * A slow motes field filling the middle distance. Thousands of points for
 * one draw call, and the cheapest depth cue in the whole kit — an empty
 * black gap reads as a wall until something drifts in it.
 */
export function buildDust(
  count: number,
  rMin: number,
  rMax: number,
  yMin: number,
  yMax: number,
  color: number,
  seed = 21,
): { points: Points; mat: PointsMaterial } {
  const rnd = rng(seed);
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rMin + Math.sqrt(rnd()) * (rMax - rMin);
    pos[i * 3] = Math.sin(a) * r;
    pos[i * 3 + 1] = yMin + rnd() * (yMax - yMin);
    pos[i * 3 + 2] = Math.cos(a) * r;
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  const mat = new PointsMaterial({
    color,
    size: 0.12,
    map: falloffTexture(),
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    toneMapped: false,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  return { points, mat };
}

/* ── the horizon: a dawn with no land under it ──────────────────────────── */

let _horizonTex: CanvasTexture | null = null;
function horizonTexture(): CanvasTexture {
  if (_horizonTex) return _horizonTex;
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 512, 0, 0);
  // A hot line at the base, a fast falloff, then a long cool tail — the
  // profile of a sky, not a fade.
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.04, 'rgba(255,255,255,0.5)');
  grad.addColorStop(0.14, 'rgba(255,255,255,0.2)');
  grad.addColorStop(0.42, 'rgba(255,255,255,0.06)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 512);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  _horizonTex = tex;
  return tex;
}

/**
 * Two nested glow bands faced inward, low and wide: a hot line where the
 * ground would end and a slightly taller, cooler one behind it.
 *
 * Discipline learned the hard way: the sky in these scenes is BLACK. A
 * tall additive cylinder subtends most of your view and turns the whole
 * room into flat colour — the horizon has to be a LINE with a short
 * gradient over it, never a wall. Keep `height` a small fraction of
 * `radius` and the opacity low.
 */
export function buildHorizon(
  radius: number,
  height: number,
  color: number,
  opacity = 0.22,
): { group: Group; near: MeshBasicMaterial; far: MeshBasicMaterial } {
  const group = new Group();
  const mk = (r: number, h: number, op: number, y: number): { mesh: Mesh; mat: MeshBasicMaterial } => {
    const mat = new MeshBasicMaterial({
      map: horizonTexture(),
      color,
      transparent: true,
      opacity: op,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    const mesh = new Mesh(new CylinderGeometry(r, r, h, 64, 1, true), mat);
    mesh.position.y = h / 2 + y;
    mesh.renderOrder = -2; // behind everything; it is the backdrop
    return { mesh, mat };
  };
  const near = mk(radius * 0.78, height, opacity, -0.6);
  const far = mk(radius, height * 1.7, opacity * 0.5, -1.2);
  group.add(far.mesh, near.mesh);
  return { group, near: near.mat, far: far.mat };
}

/* ── shards: the drifting debris of the void ────────────────────────────── */

export interface ShardField {
  group: Group;
  count: number;
  /** Tumble + bob; call every frame. */
  drift(clock: number, dt: number): void;
  setGlow(hex: number, k: number): void;
  commit(): void;
}

/**
 * OCTAGONS adrift in the middle distance — the game's own sigil floating
 * through its abstract spaces (they used to be octahedra, which read as
 * squares in silhouette). Dark slabs inside a bright ghost — instanced, so
 * a cloud costs what one used to.
 *
 * SLABS, not plates, and that is the whole fix for a shard cloud that used
 * to FLICKER. Zero-thickness plates failed twice over: a flat plate
 * tumbling through world-up goes edge-on twice a turn and vanishes into
 * nothing, and the halo — the same plate at 1.18× in the SAME plane — was
 * exactly coplanar with the body, so the two z-fought across every pixel
 * they shared. Give the octagon a little depth and the halo becomes a
 * shell standing off it on all six sides: nothing coplanar left to fight
 * over, and no viewing angle that makes a shard disappear.
 */
export function buildShardField(
  count: number,
  rMin: number,
  rMax: number,
  yMin: number,
  yMax: number,
  seed = 7,
): ShardField {
  const group = new Group();
  const rnd = rng(seed);
  // An 8-sided cylinder IS an octagonal prism: octagon faces, a rim of
  // eight narrow flanks. Unit-sized, scaled per instance (x/z span the
  // octagon, y is the slab's thickness).
  const bodies = darkBank(new CylinderGeometry(0.5, 0.5, 1, 8), count, 0x0c0b14);
  const halos = new GlowBank(new CylinderGeometry(0.5, 0.5, 1, 8), count, { additive: true, opacity: 0.3 });
  const base: { x: number; y: number; z: number; s: Vector3; spin: number; bob: number; phase: number; rot: Euler }[] =
    [];
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2;
    const r = rMin + rnd() * (rMax - rMin);
    const y = yMin + rnd() * (yMax - yMin);
    // Octagon slabs: near-regular, sized with real spread, tilted so the
    // cloud never lines up. Thin enough to still read as a plate edge-on.
    const plate = 0.9 + rnd() * 1.8;
    base.push({
      x: Math.sin(a) * r,
      y,
      z: Math.cos(a) * r,
      s: new Vector3(plate * (0.9 + rnd() * 0.2), plate * 0.06, plate),
      spin: (rnd() - 0.5) * 0.5,
      bob: 0.25 + rnd() * 0.7,
      phase: rnd() * Math.PI * 2,
      rot: new Euler(rnd() * Math.PI, rnd() * Math.PI, rnd() * Math.PI),
    });
    halos.tint(i, 0xffffff, 0.4);
  }
  halos.commit();
  bodies.name = 'void:shard';
  halos.mesh.name = 'void:shard-halo';
  group.add(bodies, halos.mesh);

  return {
    group,
    count,
    drift(clock) {
      for (let i = 0; i < count; i++) {
        const b = base[i];
        _p.set(b.x, b.y + Math.sin(clock * 0.4 + b.phase) * b.bob, b.z);
        _e.set(b.rot.x, b.rot.y + clock * b.spin, b.rot.z);
        _q.setFromEuler(_e);
        bodies.setMatrixAt(i, _m.compose(_p, _q, b.s));
        // The ghost stands clear of the slab on every axis — including the
        // thin one, where a 1.1× of near-nothing would still have left the
        // two faces sharing a plane.
        _s.set(b.s.x * 1.18, b.s.y + 0.05, b.s.z * 1.18);
        halos.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      }
      bodies.instanceMatrix.needsUpdate = true;
      halos.mesh.instanceMatrix.needsUpdate = true;
    },
    setGlow(hex, k) {
      for (let i = 0; i < count; i++) halos.tint(i, hex, k);
    },
    commit() {
      halos.commit();
    },
  };
}
