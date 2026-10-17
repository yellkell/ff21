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

import { type BufferGeometry, type Mesh, type MeshStandardMaterial, type Object3D, type Texture, TextureLoader, Vector2 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { registerFrameChart, rebakeMesh } from './paint.js';

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

function loadTex(file: string): Promise<Texture> {
  return new TextureLoader().loadAsync(BASE + file).then((t) => {
    t.flipY = false; // glTF UVs: v runs down the image
    t.anisotropy = 4;
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
  meshes: Array<{ finish: Finish; geo: BufferGeometry }>;
  nrm: Texture;
  orm: Texture;
}

interface GearEntry {
  slot: string;
  tris: number;
  tex: number;
  finishes: Finish[];
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
        const kit: GearKit = { id, meshes: [], nrm, orm };
        gltf.scene.traverse((o) => {
          const m = o as Mesh;
          if (!m.isMesh) return;
          const finish = (['shell', 'trim', 'glow'] as const).find((f) => m.name.startsWith(f));
          if (!finish) return;
          m.updateWorldMatrix(true, false);
          const geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
          geo.computeBoundingSphere();
          (m.material as MeshStandardMaterial).dispose();
          kit.meshes.push({ finish, geo });
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
