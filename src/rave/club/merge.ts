/**
 * Static-geometry merge helper — collapses a subtree of many small meshes into
 * one mesh per distinct material LOOK, baked into the subtree's local space.
 * (Vendored from Iron Balls Boxing's arena/merge.ts, where it bakes the pub;
 * here it bakes the club.)
 *
 * The club is built from hundreds of individual meshes — fluted pilasters,
 * bottles, stools, cornice runs, railing posts — each its own draw call, and
 * none of it ever moves. So we bake them down once: the GPU draws the exact
 * same triangles, materials and positions — pixel for pixel identical — but
 * as a handful of big batches instead of hundreds of little ones.
 *
 * Materials are keyed by their visible properties (not object identity), so
 * per-instance materials still merge into one batch. Anything that can't
 * merge (multi-material meshes, invisible nodes, non-mesh nodes) is left in
 * place untouched, and the caller exempts LIVE objects — animated parts,
 * raycast targets, canvas panels — with the `skip` predicate.
 */

import { type BufferGeometry, Float32BufferAttribute, Matrix4, Mesh, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type AnyMaterial = Material & {
  color?: { getHexString(): string };
  emissive?: { getHexString(): string };
  emissiveIntensity?: number;
  roughness?: number;
  metalness?: number;
  flatShading?: boolean;
  envMapIntensity?: number;
  depthWrite?: boolean;
  map?: { uuid: string } | null;
  roughnessMap?: { uuid: string } | null;
  bumpMap?: { uuid: string } | null;
  emissiveMap?: { uuid: string } | null;
};

/** A stable key for "these materials render identically", so meshes built
 *  with their own material instances still share one merged batch. */
function materialKey(m: Material): string {
  const s = m as AnyMaterial;
  return [
    m.type,
    s.color?.getHexString?.() ?? '',
    s.emissive?.getHexString?.() ?? '',
    s.emissiveIntensity ?? '',
    s.roughness ?? '',
    s.metalness ?? '',
    s.flatShading ?? '',
    s.envMapIntensity ?? '',
    m.side,
    m.transparent,
    m.opacity,
    s.depthWrite ?? '',
    // Never merge two different textures together.
    s.map?.uuid ?? '',
    s.roughnessMap?.uuid ?? '',
    s.bumpMap?.uuid ?? '',
    s.emissiveMap?.uuid ?? '',
  ].join('|');
}

function hasTextures(m: Material): boolean {
  const s = m as AnyMaterial;
  return !!(s.map || s.roughnessMap || s.bumpMap || s.emissiveMap);
}

interface Bucket {
  mat: Material;
  geos: BufferGeometry[];
}

/**
 * Merge every eligible descendant mesh of `root` into one mesh per material
 * look, baked into `root`'s local space, then reattach those merged meshes
 * directly under `root`. Meshes that can't merge stay exactly where they
 * were. Visually identical; far fewer draw calls.
 */
export function collapseStatic(root: Object3D, skip?: (o: Object3D) => boolean): void {
  root.updateMatrixWorld(true);
  const invRoot = new Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, Bucket>();
  const consumed: Mesh[] = [];

  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh || Array.isArray(m.material) || !m.geometry || !m.visible) return;
    if (skip?.(m)) return;
    const mat = m.material as Material;
    const key = materialKey(mat);
    let b = buckets.get(key);
    if (!b) {
      b = { mat, geos: [] };
      buckets.set(key, b);
    }
    // Clone, drop the index (so indexed + non-indexed primitives can mix), and
    // bake the mesh's transform — relative to root — into the vertices.
    let geo = m.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(new Matrix4().copy(invRoot).multiply(m.matrixWorld));
    geo.clearGroups();
    // Keep only the attributes every primitive shares, so the merge never trips.
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv') geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    // Attribute sets must MATCH inside a bucket or mergeGeometries returns
    // null and the whole batch vanishes. Textured materials keep uv (zeros if
    // the primitive never had any); untextured materials never read uv.
    if (hasTextures(mat)) {
      if (!geo.attributes.uv) {
        geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      }
    } else if (geo.attributes.uv) {
      geo.deleteAttribute('uv');
    }
    b.geos.push(geo);
    consumed.push(m);
  });

  for (const m of consumed) m.removeFromParent();
  pruneEmptyGroups(root);

  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    root.add(new Mesh(merged, b.mat));
  }
}

/** Remove GROUPS the merge left childless — only plain unnamed Groups:
 *  lights, sprites and named live nodes stay. */
function pruneEmptyGroups(o: Object3D): void {
  for (const c of [...o.children]) {
    pruneEmptyGroups(c);
    if ((c as { isGroup?: boolean }).isGroup && c.children.length === 0 && !c.name) {
      c.removeFromParent();
    }
  }
}
