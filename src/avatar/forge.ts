/**
 * THE FORGE, in the game (docs/forge.md): the Blender-built FRAMES — the
 * blank's body shapes — loaded, cached and dressed onto every body.
 *
 * A FRAME is a body shape picked for preference (the locker's BODY board),
 * worn on the wire as a sixth gear slot, `frame` (avatar/gear.ts). Every
 * frame shares the hitbox (BODY_IK never changes) and the UNWRAP: one grid,
 * u round by angle as the old loft laid it, v the anatomical row — so a
 * look's body paint lands on the same place whichever frame wears it.
 *
 * The body is built at once as the old procedural loft (mannequin.ts) and
 * swapped onto its frame's geometry the moment the frame's kit lands:
 * the GLB's one grid mesh, its baked normal map and its AO/roughness map.
 * Kits are loaded on first use and shared — every body on that frame draws
 * from one geometry and one texture pair. The frame's RING CHART (from
 * frames.json) goes to THE PAINT, which measures marks in metres along
 * the surface (avatar/paint.ts), and to the gear fit (avatar/gear.ts).
 */

import { type BufferGeometry, ImageBitmapLoader, Mesh, MeshStandardMaterial, type Object3D, Texture, Vector2 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { registerFrameChart, rebakeMesh } from './paint.js';
import type { FlopSpec } from './flop.js';

const BASE = 'forge/';

export interface FrameDef {
  id: string;
  name: string;
  blurb: string;
}

/** The frames, in the order the locker shows them. STANDARD is THE BLANK
 *  as it always stood — and the EMPTY frame slot, so a reader from before
 *  the Forge, which knows no frames, still sees everyone right. */
export const FRAMES: readonly FrameDef[] = [
  { id: 'standard', name: 'STANDARD', blurb: 'the blank as it always stood' },
  { id: 'lean', name: 'LEAN', blurb: 'narrow shoulders, a long waist' },
  { id: 'heavy', name: 'HEAVY', blurb: 'broad and deep through the chest' },
  { id: 'curved', name: 'CURVED', blurb: 'a defined waist, fuller hips' },
];
export const DEFAULT_FRAME = 'standard';
export const frameDef = (id: string): FrameDef | undefined => FRAMES.find((f) => f.id === id);

/** One chart row: s (the anatomical row, = the UV's v), y, half-width,
 *  half-depth, z-centre. Rows run top (s = 1) → tip (s = 0). */
export type ChartRow = [number, number, number, number, number];

interface FrameKit {
  geo: BufferGeometry;
  nrm: Texture;
  orm: Texture;
}

let charts: Record<string, ChartRow[]> | null = null;
const manifest: Promise<Record<string, ChartRow[]> | null> = fetch(`${BASE}frames/frames.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((j: Record<string, { chart: ChartRow[] }> | null) => {
    if (!j) return null;
    charts = {};
    for (const [id, f] of Object.entries(j)) {
      charts[id] = f.chart;
      registerFrameChart(id, f.chart);
    }
    return charts;
  })
  .catch(() => null);

/** A frame's chart, once frames.json is in (null before, or for an unknown id). */
export function frameChart(id: string): ChartRow[] | null {
  return charts?.[id] ?? null;
}

/** The frame's ring at height y (hip-local), interpolated: [half-width,
 *  half-depth, z-centre]. Null until the manifest lands. */
export function frameRing(id: string, y: number): [number, number, number] | null {
  const rows = frameChart(id);
  if (!rows) return null;
  for (let i = 0; i + 1 < rows.length; i++) {
    const a = rows[i];
    const b = rows[i + 1];
    if (y <= a[1] && y >= b[1]) {
      const t = (a[1] - y) / (a[1] - b[1] || 1);
      return [a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t, a[4] + (b[4] - a[4]) * t];
    }
  }
  const end = y > rows[0][1] ? rows[0] : rows[rows.length - 1];
  return [end[2], end[3], end[4]];
}

/** Resolves once the frames' charts are known (or failed to load). */
export function framesReady(): Promise<unknown> {
  return manifest;
}

const kits = new Map<string, FrameKit>();
const loading = new Map<string, Promise<FrameKit | null>>();

/** A Forge map, decoded OFF the main thread (an ImageBitmap): an <img>
 *  texture is decoded on the frame it is first drawn, so a head's first
 *  wear stalled on decoding its two 1024² maps. Taken exactly as stored —
 *  no colour conversion, no premultiply: these are normals and ORM. */
function loadTex(file: string): Promise<Texture> {
  const loader = new ImageBitmapLoader().setOptions({ imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  return loader.loadAsync(BASE + file).then((bitmap) => {
    const t = new Texture(bitmap);
    t.flipY = false; // glTF UVs: v runs down the image (and a bitmap can't flip)
    t.anisotropy = 4;
    t.needsUpdate = true;
    return t;
  });
}

function loadFrame(id: string): Promise<FrameKit | null> {
  let p = loading.get(id);
  if (p) return p;
  p = Promise.all([
    new GLTFLoader().loadAsync(`${BASE}frames/${id}.glb`),
    loadTex(`frames/${id}_nrm.webp`),
    loadTex(`frames/${id}_orm.webp`),
    manifest,
  ])
    .then(([gltf, nrm, orm]) => {
      let geo: BufferGeometry | null = null;
      gltf.scene.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh && !geo) {
          geo = m.geometry;
          (m.material as MeshStandardMaterial).dispose();
        }
      });
      if (!geo) return null;
      (geo as BufferGeometry).computeBoundingSphere();
      const kit = { geo, nrm, orm };
      kits.set(id, kit);
      return kit;
    })
    .catch((err) => {
      console.warn(`[forge] frame ${id} failed to load; keeping the loft`, err);
      return null;
    });
  loading.set(id, p);
  return p;
}

/** Glancing normals only: the frame's map adds relief to the base tone,
 *  never a texture of its own. (−y: glTF's derivative-tangent convention,
 *  as three's GLTFLoader sets it for a map without stored tangents.) */
const NORMAL_SCALE = new Vector2(1, -1);

function wear(mesh: Mesh, id: string, kit: FrameKit): void {
  mesh.geometry = kit.geo;
  const mat = mesh.material as MeshStandardMaterial;
  mat.normalMap = kit.nrm;
  mat.normalScale.copy(NORMAL_SCALE);
  mat.aoMap = kit.orm;
  mat.aoMapIntensity = 1;
  mat.roughnessMap = kit.orm;
  mat.needsUpdate = true;
  mesh.userData.paintFrame = id;
  mesh.userData.frameWorn = id;
  // The chart changed under the paint: bake the look again on this frame.
  rebakeMesh(mesh);
}

/**
 * Put every body surface under `root` (a rig's body group, or any subtree
 * holding one) on frame `id`. Immediate when the frame's kit is in; else
 * the kit is fetched and the bodies still wanting this frame take it when
 * it lands (a later call for another frame wins).
 */
export function dressFrame(root: Object3D, id: string): void {
  const want = frameDef(id) ? id : DEFAULT_FRAME;
  const bodies: Mesh[] = [];
  root.traverse((o) => {
    if (o.userData?.paintPart === 'body' && (o as Mesh).isMesh) bodies.push(o as Mesh);
  });
  if (!bodies.length) return;
  const kit = kits.get(want);
  for (const m of bodies) {
    m.userData.frameWant = want;
    if (kit && m.userData.frameWorn !== want) wear(m, want, kit);
  }
  if (kit) return;
  void loadFrame(want).then((k) => {
    if (!k) return;
    for (const m of bodies) if (m.userData.frameWant === want && m.userData.frameWorn !== want) wear(m, want, k);
  });
}

/** The frame a subtree's body is wearing (or about to), for probes. */
export function frameOf(root: Object3D): string {
  let id = '';
  root.traverse((o) => {
    if (!id && o.userData?.paintPart === 'body') id = (o.userData.frameWant as string) ?? '';
  });
  return id || DEFAULT_FRAME;
}

/** Warm a frame's kit before anyone wears it (the locker's tiles). */
export function preloadFrame(id: string): void {
  if (frameDef(id)) void loadFrame(id);
}

/* ── GEAR ─────────────────────────────────────────────────────────────── */
//
// A Forge piece (tools/blender/forge/gear.py) is a GLB of up to three
// meshes named by FINISH — shell (the paint surface), trim, glow — sharing
// one UV atlas, and a normal + ORM pair over that atlas. Pieces load on
// first wear and are shared: every fighter in the room wearing CREST draws
// from one geometry and one texture pair.

export type Finish = 'shell' | 'trim' | 'glow';

export interface GearKit {
  id: string;
  /** `flop` names the floppy part a mesh belongs to (avatar/flop.ts). */
  meshes: Array<{ finish: Finish; geo: BufferGeometry; flop?: string }>;
  flops: Record<string, FlopSpec>;
  nrm: Texture;
  orm: Texture;
}

interface GearEntry {
  slot: string;
  tris: number;
  tex: number;
  finishes: Finish[];
  flops?: Record<string, FlopSpec>;
}

let gearList: Record<string, GearEntry> | null = null;
const gearManifest: Promise<Record<string, GearEntry> | null> = fetch(`${BASE}gear/gear.json`)
  .then((r) => (r.ok ? r.json() : null))
  .then((j: Record<string, GearEntry> | null) => {
    gearList = j ?? {};
    return gearList;
  })
  .catch(() => {
    gearList = {};
    return gearList;
  });

const gearKits = new Map<string, GearKit>();
const gearLoading = new Map<string, Promise<GearKit | null>>();
const gearFailed = new Set<string>();

/**
 * Where a piece stands with the Forge: 'ready' (its kit is in), 'loading'
 * (the manifest or the kit is on its way — build nothing yet), or 'none'
 * (not forged, or it failed: the procedural shape stands in).
 */
export function forgeGearState(id: string): 'ready' | 'loading' | 'none' {
  if (gearKits.has(id)) return 'ready';
  if (gearFailed.has(id)) return 'none';
  if (!gearList) return 'loading';
  return gearList[id] ? 'loading' : 'none';
}

export function forgeGearKit(id: string): GearKit | null {
  return gearKits.get(id) ?? null;
}

/** Fetch a piece's kit (once); resolves null if it isn't forged or fails. */
export function loadForgeGear(id: string): Promise<GearKit | null> {
  let p = gearLoading.get(id);
  if (p) return p;
  p = gearManifest.then((list) => {
    if (!list?.[id]) return null;
    return Promise.all([new GLTFLoader().loadAsync(`${BASE}gear/${id}.glb`), loadTex(`gear/${id}_nrm.webp`), loadTex(`gear/${id}_orm.webp`)])
      .then(([gltf, nrm, orm]) => {
        const flops = list[id].flops ?? {};
        const kit: GearKit = { id, meshes: [], flops, nrm, orm };
        gltf.scene.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          // "shell", or "shell@ear_l" for a floppy part (three may suffix a
          // node name to keep it unique; the finish and flop are what count).
          const name = (m.name || m.parent?.name || '').replace(/_\d+$/, '');
          const finish = (['shell', 'trim', 'glow'] as const).find((f) => name.startsWith(f));
          if (!finish) return;
          const at = name.indexOf('@');
          const flop = at >= 0 && flops[name.slice(at + 1)] ? name.slice(at + 1) : undefined;
          m.updateWorldMatrix(true, false);
          const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
          geo.computeBoundingSphere();
          if (flop && geo.boundingSphere) geo.boundingSphere.radius += flops[flop].len * (flops[flop].swing ?? 0.6);
          (m.material as MeshStandardMaterial).dispose();
          kit.meshes.push({ finish, geo, flop });
        });
        gearKits.set(id, kit);
        return kit;
      })
      .catch((err) => {
        console.warn(`[forge] gear ${id} failed to load; the old shape stands in`, err);
        gearFailed.add(id);
        return null;
      });
  });
  gearLoading.set(id, p);
  return p;
}

/** Dress a finish's material with the kit's maps. The shell keeps its
 *  tone's own roughness (the map is relative); trim and glow take theirs
 *  from the bake. */
export function fitGearMaps(mat: MeshStandardMaterial, finish: Finish, kit: GearKit): void {
  mat.normalMap = kit.nrm;
  mat.normalScale.copy(NORMAL_SCALE);
  mat.aoMap = kit.orm;
  mat.aoMapIntensity = 1;
  mat.roughnessMap = kit.orm;
  if (finish === 'trim') {
    mat.metalnessMap = kit.orm;
    mat.roughness = 1;
    mat.metalness = 1;
  }
  mat.needsUpdate = true;
}

/** A forged HEAD's cranium (its manifest `fit`): how the bare skull maps
 *  onto it, so headgear rides that head's dome (avatar/gear.ts). Null for
 *  a head that isn't forged, or before its kit has landed. */
export function forgeFaceFit(id: string): { s: [number, number, number]; y: number; z: number } | null {
  if (!gearKits.has(id)) return null;
  const f = (gearList?.[id] as { fit?: { s: [number, number, number]; y: number; z: number } } | undefined)?.fit;
  return f ?? null;
}

/* ── THE HEAD ─────────────────────────────────────────────────────────── */
//
// THE BLANK's own face (tools/blender/forge/head.py): the skull's shell is
// a grid over the very same sphere unwrap on the very same ellipsoid, so
// head paint lands where it always did; on it a visor band from ear to
// ear, two lit eye slits, machined ear pods and a mouth vent. The skull is
// built as the old sphere and swapped onto the head kit when it lands.
// The visor, pods and vent ride the skull as children (trim, and the eyes
// lit in the wearer's accent), so a worn head that hides the skull hides
// them too.

interface HeadKit {
  shell: BufferGeometry;
  trim: BufferGeometry | null;
  glow: BufferGeometry | null;
  nrm: Texture;
  orm: Texture;
}

let headKit: HeadKit | null = null;
let headLoading: Promise<HeadKit | null> | null = null;

function loadHead(): Promise<HeadKit | null> {
  headLoading ??= Promise.all([
    new GLTFLoader().loadAsync(`${BASE}head/head.glb`),
    loadTex('head/head_nrm.webp'),
    loadTex('head/head_orm.webp'),
  ])
    .then(([gltf, nrm, orm]) => {
      const geo: Record<string, BufferGeometry> = {};
      gltf.scene.traverse((o) => {
        const m = o as Mesh;
        if (!m.isMesh) return;
        m.updateWorldMatrix(true, false);
        const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
        g.computeBoundingSphere();
        (m.material as MeshStandardMaterial).dispose();
        const finish = (['shell', 'trim', 'glow'] as const).find((f) => m.name.startsWith(f));
        if (finish) geo[finish] = g;
      });
      if (!geo.shell) return null;
      headKit = { shell: geo.shell, trim: geo.trim ?? null, glow: geo.glow ?? null, nrm, orm };
      return headKit;
    })
    .catch((err) => {
      console.warn('[forge] head failed to load; keeping the bare skull', err);
      return null;
    });
  return headLoading;
}

/** The accent a rig piece (or any ancestor) was last lit in. */
function accentAbove(o: Object3D): number | null {
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (typeof p.userData.accentColor === 'number') return p.userData.accentColor as number;
  }
  return null;
}

function wearHead(skull: Mesh, kit: HeadKit): void {
  if (skull.userData.headWorn) return;
  skull.userData.headWorn = true;
  // The kit is authored in the head group's own space (ellipsoid, seat and
  // all), where the sphere stand-in carried its shape on its transform.
  skull.geometry = kit.shell;
  skull.scale.set(1, 1, 1);
  skull.position.set(0, 0, 0);
  const mat = skull.material as MeshStandardMaterial;
  mat.normalMap = kit.nrm;
  mat.normalScale.copy(NORMAL_SCALE);
  mat.aoMap = kit.orm;
  mat.roughnessMap = kit.orm;
  mat.needsUpdate = true;
  const tone = (skull.userData.paintTone as string) ?? 'white';
  if (kit.trim) {
    const trim = new MeshStandardMaterial(
      tone === 'onyx' ? { color: 0x0b0c0f, roughness: 0.12, metalness: 0.4 } : { color: 0x101216, roughness: 0.14, metalness: 0.35 },
    );
    const m = new Mesh(kit.trim, trim);
    m.name = 'head-trim';
    m.userData.forged = true;
    skull.add(m);
  }
  if (kit.glow) {
    const accent = accentAbove(skull) ?? 0xff7a18;
    const glow = new MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 1.4, roughness: 0.35, metalness: 0 });
    glow.userData.accent = 'glow'; // setAvatarAccent lights it with the rig
    const m = new Mesh(kit.glow, glow);
    m.name = 'head-glow';
    m.userData.forged = true;
    skull.add(m);
  }
  rebakeMesh(skull);
}

/** Put every bare skull under `root` on THE BLANK's forged face. */
export function dressHead(root: Object3D): void {
  const skulls: Mesh[] = [];
  root.traverse((o) => {
    if (o.userData?.paintPart === 'head' && (o as Mesh).isMesh) skulls.push(o as Mesh);
  });
  if (!skulls.length) return;
  if (headKit) {
    for (const s of skulls) wearHead(s, headKit);
    return;
  }
  void loadHead().then((k) => {
    if (k) for (const s of skulls) wearHead(s, k);
  });
}

/**
 * A body or shoulder piece FITTED to a frame: every vertex moved by that
 * frame's ring over STANDARD's ring at the vertex's own height — across by
 * the half-width ratio, fore-aft by the half-depth ratio about the ring's
 * centre — so a belt follows CURVED's waist AND its hips, where one scale
 * at one anchor height sank its lower edge into the hips. Normals take the
 * inverse scale. Heights past the shoulder line and below the tip use the
 * ring there. Cached per piece and frame; shared like the kit.
 */
const fitted = new Map<string, GearKit>();
export function fitGearKit(kit: GearKit, frame: string): GearKit {
  if (frame === DEFAULT_FRAME || !frameChart(frame) || !frameChart(DEFAULT_FRAME)) return kit;
  const key = `${kit.id}|${frame}`;
  const hit = fitted.get(key);
  if (hit) return hit;
  const ratio = new Map<number, [number, number, number, number]>();
  const at = (y: number): [number, number, number, number] => {
    const yy = Math.round(Math.max(-0.2, Math.min(0.4, y)) * 400) / 400; // 2.5 mm steps
    let r = ratio.get(yy);
    if (!r) {
      const s = frameRing(DEFAULT_FRAME, yy)!;
      const f = frameRing(frame, yy)!;
      r = [f[0] / s[0], f[1] / s[1], s[2], f[2]];
      ratio.set(yy, r);
    }
    return r;
  };
  const meshes = kit.meshes.map(({ finish, geo, flop }) => {
    const g = geo.clone();
    const pos = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    for (let i = 0; i < pos.count; i++) {
      const [rw, rd, sz, fz] = at(pos.getY(i));
      pos.setX(i, pos.getX(i) * rw);
      pos.setZ(i, fz + (pos.getZ(i) - sz) * rd);
      if (nrm) {
        const nx = nrm.getX(i) / rw;
        const ny = nrm.getY(i);
        const nz = nrm.getZ(i) / rd;
        const l = Math.hypot(nx, ny, nz) || 1;
        nrm.setXYZ(i, nx / l, ny / l, nz / l);
      }
    }
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    if (flop && g.boundingSphere) g.boundingSphere.radius += kit.flops[flop].len * (kit.flops[flop].swing ?? 0.6);
    return { finish, geo: g, flop };
  });
  // The flops' pivots and directions ride the same fit.
  const flops: Record<string, FlopSpec> = {};
  for (const [name, f] of Object.entries(kit.flops)) {
    const [rw, rd, sz, fz] = at(f.pivot[1]);
    const dir: [number, number, number] = [f.dir[0] * rw, f.dir[1], f.dir[2] * rd];
    const l = Math.hypot(...dir) || 1;
    flops[name] = { ...f, pivot: [f.pivot[0] * rw, f.pivot[1], fz + (f.pivot[2] - sz) * rd], dir: [dir[0] / l, dir[1] / l, dir[2] / l] };
  }
  const out: GearKit = { ...kit, meshes, flops };
  fitted.set(key, out);
  return out;
}
