/**
 * THE GEAR ATLAS — every piece of gear gets a paint canvas of its own that
 * means something (avatar/paint.ts, docs/paint.md §4).
 *
 * Gear is built from plain primitives — boxes, cones, cylinders, spheres,
 * tubes — and every one of them maps the WHOLE texture onto itself. With
 * one canvas per slot that meant a mark on one crest plate landed on all
 * eleven (and on every face of each), a stripe on the left pauldron
 * painted the right one too, and the chestplate, which had no UVs at
 * all, could not be painted. So when a piece is built:
 *
 *  1. THE ISLANDS. Each paintable mesh is split into islands — one per
 *     face of a box, the side and each cap of a cylinder or cone, the
 *     whole of anything else (spheres, tori, tubes, lofts) — and every
 *     island gets a cell of its own on the slot's canvas, sized by its
 *     real surface area so the ink density is even across the piece.
 *     Its UVs are remapped into its cell, with a gutter round it.
 *  2. THE MAP. Every texel of the canvas records where on the piece it
 *     is: the surface point (in the piece's own frame), its normal, and
 *     how many metres one texel spans there.
 *
 * With the map, a mark is a DECAL: placed at the texel the ray hit, it
 * paints every texel whose surface point lies within its outline in the
 * plane of the surface there — true to size, across neighbouring plates,
 * never onto faces turned away. (avatar/paint.ts does the painting.)
 *
 * Everything here is deterministic from the geometry, so every headset
 * lays the same atlas for the same piece and a (u, v) on the wire lands
 * on the same spot everywhere.
 */

import { BufferAttribute, Matrix3, Matrix4, Mesh, Vector3, type BufferGeometry, type Group, type MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface GearMap {
  /** Identity of the piece this map was laid for (the bake memoizes on it). */
  key: string;
  W: number;
  H: number;
  /** Surface point per texel (x, y, z; the piece's frame, metres). */
  pos: Float32Array;
  /** Surface normal per texel. */
  nrm: Float32Array;
  /** Metres one texel spans there; 0 = no surface on this texel. */
  ts: Float32Array;
  /** Every island's cell (inner rect, uv units, v up): where a mark made
   *  before the atlas — stamped on every island in its own UVs — goes. */
  rects: Array<[number, number, number, number]>;
}

interface Island {
  mesh: Mesh;
  verts: number[];
  tris: number[];
  area: number;
  u0: number;
  v0: number;
  u1: number;
  v1: number;
  /** Assigned cell (uv units, v up). */
  x: number;
  y: number;
  s: number;
}

const GUTTER_PX = 2;
const maps = new Map<string, GearMap>();

const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();

/** A mesh with no UVs (the chestplate's slab) gets a planar pair off the
 *  two longest sides of its bounding box — anything, as long as it is
 *  there; the map, not the UVs, is what the paint measures by. */
function ensureUv(geo: BufferGeometry): void {
  if (geo.getAttribute('uv')) return;
  geo.computeBoundingBox();
  const bb = geo.boundingBox!;
  const size = [bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z];
  const axes = [0, 1, 2].sort((i, j) => size[j] - size[i]);
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const min = [bb.min.x, bb.min.y, bb.min.z];
  for (let i = 0; i < pos.count; i++) {
    const p = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    uv[i * 2] = (p[axes[0]] - min[axes[0]]) / (size[axes[0]] || 1);
    uv[i * 2 + 1] = (p[axes[1]] - min[axes[1]]) / (size[axes[1]] || 1);
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
}

/**
 * FACING SPLIT, for a mesh flagged `userData.atlasSplit` — an extruded
 * blade or plate. three's ExtrudeGeometry gives its front and back faces
 * the SAME UVs (and walls on opposite sides of an outline often overlap
 * too), so one texel would have to be two places at once and a mark on
 * one face would never show. So: every triangle gets its own vertices,
 * is binned by which way it faces (±x, ±y, ±z), and is mapped flat onto
 * the plane across that axis; each bin becomes its own island.
 */
function splitByFacing(mesh: Mesh): Island[] {
  if (mesh.geometry.getIndex()) mesh.geometry = mesh.geometry.toNonIndexed();
  const geo = mesh.geometry;
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const bins = new Map<number, number[]>();
  for (let t = 0; t + 2 < pos.count; t += 3) {
    _a.fromBufferAttribute(pos, t);
    _b.fromBufferAttribute(pos, t + 1).sub(_a);
    _c.fromBufferAttribute(pos, t + 2).sub(_a);
    const n = _b.cross(_c);
    const ax = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)];
    const axis = ax[0] >= ax[1] && ax[0] >= ax[2] ? 0 : ax[1] >= ax[2] ? 1 : 2;
    const bin = axis * 2 + ((axis === 0 ? n.x : axis === 1 ? n.y : n.z) >= 0 ? 0 : 1);
    const [i, j] = axis === 0 ? [2, 1] : axis === 1 ? [0, 2] : [0, 1];
    for (let k = 0; k < 3; k++) {
      const vi = t + k;
      const p = [pos.getX(vi), pos.getY(vi), pos.getZ(vi)];
      uv[vi * 2] = p[i];
      uv[vi * 2 + 1] = p[j];
    }
    if (!bins.has(bin)) bins.set(bin, []);
    bins.get(bin)!.push(t, t + 1, t + 2);
  }
  geo.setAttribute('uv', new BufferAttribute(uv, 2));
  geo.clearGroups();
  const out: Island[] = [];
  for (const tris of bins.values()) out.push(islandFrom(mesh, tris, tris));
  return out;
}

/** An island's area and UV bounds, from its triangles' vertex indices. */
function islandFrom(mesh: Mesh, tris: number[], verts: number[]): Island {
  const pos = mesh.geometry.getAttribute('position');
  const uv = mesh.geometry.getAttribute('uv');
  let area = 0;
  for (let t = 0; t + 2 < tris.length; t += 3) {
    _a.fromBufferAttribute(pos, tris[t]).applyMatrix4(mesh.matrixWorld);
    _b.fromBufferAttribute(pos, tris[t + 1]).applyMatrix4(mesh.matrixWorld);
    _c.fromBufferAttribute(pos, tris[t + 2]).applyMatrix4(mesh.matrixWorld);
    area += _b.sub(_a).cross(_c.sub(_a)).length() / 2;
  }
  let u0 = Infinity;
  let v0 = Infinity;
  let u1 = -Infinity;
  let v1 = -Infinity;
  for (const vi of verts) {
    u0 = Math.min(u0, uv.getX(vi));
    u1 = Math.max(u1, uv.getX(vi));
    v0 = Math.min(v0, uv.getY(vi));
    v1 = Math.max(v1, uv.getY(vi));
  }
  return { mesh, verts, tris, area: Math.max(area, 1e-7), u0, v0, u1, v1, x: 0, y: 0, s: 0 };
}

/** Split a mesh into islands: one per index group (a box's faces, a
 *  cylinder's side and caps), or the whole mesh when it has none — or, for
 *  an extrusion, by facing (splitByFacing). */
function islandsOf(mesh: Mesh): Island[] {
  if (mesh.userData.atlasSplit) return splitByFacing(mesh);
  const geo = mesh.geometry;
  ensureUv(geo);
  const pos = geo.getAttribute('position');
  const index = geo.getIndex();
  const triCount = index ? index.count : pos.count;
  const ranges = geo.groups.length ? geo.groups.map((g) => [g.start, Math.min(triCount, g.start + g.count)]) : [[0, triCount]];
  const owner = new Int32Array(pos.count).fill(-1);
  const out: Island[] = [];
  for (const [start, end] of ranges) {
    const tris: number[] = [];
    const verts: number[] = [];
    for (let k = start; k < end; k++) {
      const vi = index ? index.getX(k) : k;
      tris.push(vi);
      if (owner[vi] === -1) {
        owner[vi] = out.length;
        verts.push(vi);
      }
    }
    if (tris.length < 3) continue;
    out.push(islandFrom(mesh, tris, verts));
  }
  return out;
}

/** Shelf-pack square cells of side k·√area into the unit square; true if
 *  they all fit (and the cells are written). */
function pack(islands: Island[], k: number, gutter: number): boolean {
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const is of islands) {
    const s = k * Math.sqrt(is.area) + gutter * 2;
    if (s > 1) return false;
    if (x + s > 1) {
      x = 0;
      y += shelf;
      shelf = 0;
    }
    if (y + s > 1) return false;
    is.x = x;
    is.y = y;
    is.s = s;
    x += s;
    shelf = Math.max(shelf, s);
  }
  return true;
}

/**
 * Lay the atlas for a freshly built piece (its meshes are remapped in
 * place) and return its map, `size` texels square. `key` names the piece
 * (id, side, tone-independent) so the map is built once per session.
 * The piece must be in its final pose relative to `root` (its own group).
 */
export function atlasGear(root: Group, meshes: Mesh[], key: string, size: number): GearMap {
  root.updateMatrixWorld(true);
  const islands = meshes.flatMap(islandsOf).sort((a, b) => b.area - a.area);
  const gutter = GUTTER_PX / size;
  // The biggest cells that still fit: bisect the scale.
  let lo = 0;
  let hi = 64;
  for (let i = 0; i < 28; i++) {
    const mid = (lo + hi) / 2;
    if (pack(islands, mid, gutter)) lo = mid;
    else hi = mid;
  }
  pack(islands, lo, gutter);
  // Remap every island's UVs into its cell (inside the gutter).
  const rects: GearMap['rects'] = [];
  for (const is of islands) {
    const uv = is.mesh.geometry.getAttribute('uv') as BufferAttribute;
    const inner = is.s - gutter * 2;
    const du = is.u1 - is.u0 || 1;
    const dv = is.v1 - is.v0 || 1;
    for (const vi of is.verts) {
      uv.setXY(vi, is.x + gutter + ((uv.getX(vi) - is.u0) / du) * inner, is.y + gutter + ((uv.getY(vi) - is.v0) / dv) * inner);
    }
    uv.needsUpdate = true;
    rects.push([is.x + gutter, is.y + gutter, inner, inner]);
  }
  const cached = maps.get(key);
  if (cached && cached.W === size) return cached;
  const map = rasterMap(islands, key, size, size);
  map.rects = rects;
  maps.set(key, map);
  return map;
}

/** Rasterize every island's triangles in UV space: each texel keeps its
 *  surface point, normal and texel size; then the gutters are filled from
 *  their neighbours so filtering at a cell's edge never reads nothing. */
function rasterMap(islands: Island[], key: string, W: number, H: number): GearMap {
  const pos = new Float32Array(W * H * 3);
  const nrm = new Float32Array(W * H * 3);
  const ts = new Float32Array(W * H);
  const P = [new Vector3(), new Vector3(), new Vector3()];
  const N = [new Vector3(), new Vector3(), new Vector3()];
  const nm = new Matrix3();
  for (const is of islands) {
    const geo = is.mesh.geometry;
    const pa = geo.getAttribute('position');
    const ua = geo.getAttribute('uv');
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const na = geo.getAttribute('normal');
    nm.getNormalMatrix(is.mesh.matrixWorld);
    for (let t = 0; t + 2 < is.tris.length; t += 3) {
      const tx: number[] = [];
      const ty: number[] = [];
      for (let k = 0; k < 3; k++) {
        const vi = is.tris[t + k];
        P[k].fromBufferAttribute(pa, vi).applyMatrix4(is.mesh.matrixWorld);
        N[k].fromBufferAttribute(na, vi).applyMatrix3(nm).normalize();
        tx.push(ua.getX(vi) * W);
        ty.push((1 - ua.getY(vi)) * H);
      }
      const area2 = (tx[1] - tx[0]) * (ty[2] - ty[0]) - (tx[2] - tx[0]) * (ty[1] - ty[0]);
      if (Math.abs(area2) < 1e-6) continue;
      const worldArea = _a.copy(P[1]).sub(P[0]).cross(_b.copy(P[2]).sub(P[0])).length() / 2;
      const texel = Math.sqrt(worldArea / (Math.abs(area2) / 2));
      const x0 = Math.max(0, Math.floor(Math.min(...tx)));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(...tx)));
      const y0 = Math.max(0, Math.floor(Math.min(...ty)));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(...ty)));
      for (let j = y0; j <= y1; j++) {
        for (let i = x0; i <= x1; i++) {
          const px = i + 0.5;
          const py = j + 0.5;
          const w0 = ((tx[1] - px) * (ty[2] - py) - (tx[2] - px) * (ty[1] - py)) / area2;
          const w1 = ((tx[2] - px) * (ty[0] - py) - (tx[0] - px) * (ty[2] - py)) / area2;
          const w2 = 1 - w0 - w1;
          if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
          const k = j * W + i;
          const o = k * 3;
          pos[o] = P[0].x * w0 + P[1].x * w1 + P[2].x * w2;
          pos[o + 1] = P[0].y * w0 + P[1].y * w1 + P[2].y * w2;
          pos[o + 2] = P[0].z * w0 + P[1].z * w1 + P[2].z * w2;
          const nx = N[0].x * w0 + N[1].x * w1 + N[2].x * w2;
          const ny = N[0].y * w0 + N[1].y * w1 + N[2].y * w2;
          const nz = N[0].z * w0 + N[1].z * w1 + N[2].z * w2;
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          nrm[o] = nx / nl;
          nrm[o + 1] = ny / nl;
          nrm[o + 2] = nz / nl;
          ts[k] = texel;
        }
      }
    }
  }
  // THE GUTTERS: an empty texel next to a full one borrows it, twice over.
  for (let pass = 0; pass < GUTTER_PX; pass++) {
    const was = ts.slice();
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const k = j * W + i;
        if (was[k] > 0) continue;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di;
          const jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
          const n = jj * W + ii;
          if (was[n] <= 0) continue;
          ts[k] = was[n];
          pos.copyWithin(k * 3, n * 3, n * 3 + 3);
          nrm.copyWithin(k * 3, n * 3, n * 3 + 3);
          break;
        }
      }
    }
  }
  return { key, W, H, pos, nrm, ts, rects: [] };
}

/**
 * ONE PIECE, A FEW DRAW CALLS. A piece of gear is built from many small
 * parts — a spiked pad is a cap, a lame, two rims, five rivets, three
 * spikes and three collars, twice — and every one was its own draw call
 * (and every paintable one its own copy of the paint canvas), on every
 * fighter in the room. Once the atlas is laid, the parts are merged into
 * one mesh per finish, baked into the piece's own frame: the paintable
 * primer (smooth, and faceted where a part is flat-shaded), and each trim.
 * The atlas UVs, the paint tags and the map ride through the merge, so
 * paint and THE MAGNET see one surface where there were twenty.
 */
export function mergePiece(root: Group): void {
  root.updateMatrixWorld(true);
  const inv = new Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, { mesh: Mesh; geos: BufferGeometry[] }>();
  const done: Mesh[] = [];
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || Array.isArray(m.material)) return;
    const mat = m.material as MeshStandardMaterial;
    const key = [
      m.userData.trim ? 'trim' : 'paint',
      mat.color.getHexString(),
      mat.roughness,
      mat.metalness,
      mat.flatShading,
      mat.side,
    ].join('|');
    let geo = m.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(new Matrix4().copy(inv).multiply(m.matrixWorld));
    geo.clearGroups();
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new BufferAttribute(new Float32Array(geo.getAttribute('position').count * 2), 2));
    const b = buckets.get(key);
    if (b) b.geos.push(geo);
    else buckets.set(key, { mesh: m, geos: [geo] });
    done.push(m);
  });
  if (done.length <= buckets.size) return; // nothing to gain
  for (const m of done) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  for (const { mesh, geos } of buckets.values()) {
    const merged = mergeGeometries(geos, false);
    if (!merged) continue;
    const out = new Mesh(merged, mesh.material);
    out.userData = { ...mesh.userData };
    out.castShadow = mesh.castShadow;
    out.receiveShadow = mesh.receiveShadow;
    root.add(out);
  }
  // The parts' groups (a wing's pivots) are empty now.
  const empty: Group[] = [];
  root.traverse((o) => {
    if (o !== root && !(o as Mesh).isMesh && o.children.length === 0) empty.push(o as Group);
  });
  for (const e of empty) e.removeFromParent();
}
