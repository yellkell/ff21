/**
 * Static-geometry merge helper — collapses a subtree of many small meshes into
 * one mesh per distinct material LOOK, baked into the subtree's local space.
 *
 * The arenas are built from hundreds of individual papercraft meshes (cacti,
 * agave, mesas…) and every avatar from dozens of armour plates — each its own
 * draw call. Since none of them change shape after build, we bake them down
 * once: the GPU draws the exact same triangles, materials and positions —
 * pixel for pixel identical — but as a handful of big batches instead of
 * hundreds of little ones.
 *
 * Ways to use it:
 *  - on a single prop group that still needs to MOVE as a unit (a swaying
 *    plant, an avatar's head) — its sub-meshes collapse to a few, and the
 *    group keeps its transform so it still moves;
 *  - on a throwaway group holding many STATIC props — they all merge together,
 *    across props, into a few meshes for the whole field.
 *
 * Materials are keyed by their visible properties (not object identity), so the
 * per-instance materials the builders create still merge into one batch. The
 * key includes the recolour tags (userData.role / .accent) so skin and accent
 * re-tints keep working on the merged material exactly as they did on the
 * originals. Anything that can't merge (multi-material meshes, invisible
 * ornaments, non-mesh nodes) is left in place untouched, and a caller can
 * exempt LIVE objects — raycast targets, retint meshes, animated parts —
 * with the `skip` predicate.
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
  vertexColors?: boolean;
};

/** A stable key for "these materials render identically AND retint identically",
 *  so meshes built with their own material instances still share one merged
 *  batch — without ever fusing two materials a recolour would treat differently. */
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
    // A vertex-coloured material (the DESERT 2.0 mesas) needs its colour
    // attribute kept through the merge — never bucket it with plain meshes.
    s.vertexColors ?? '',
    // Never merge two different textures together.
    s.map?.uuid ?? '',
    s.roughnessMap?.uuid ?? '',
    s.bumpMap?.uuid ?? '',
    s.emissiveMap?.uuid ?? '',
    // Recolour channels (avatar skins / accents / glove LEDs) — materials that
    // retint differently must stay separate batches.
    m.userData?.role ?? '',
    m.userData?.accent ?? '',
    m.userData?.litIntensity ?? '',
  ].join('|');
}

function hasTextures(m: Material): boolean {
  const s = m as AnyMaterial;
  return !!(s.map || s.roughnessMap || s.bumpMap || s.emissiveMap);
}

interface Bucket {
  mat: Material;
  geos: BufferGeometry[];
  cast: boolean;
  recv: boolean;
}

/**
 * Merge every eligible descendant mesh of `root` into one mesh per material
 * look, baked into `root`'s local space, then reattach those merged meshes
 * directly under `root`. `root` keeps its own transform, so a group that
 * animates (a swaying plant, a carried head) still animates. Meshes that
 * can't merge stay exactly where they were. Visually identical; far fewer
 * draw calls.
 */
export function collapseStatic(root: Object3D, skip?: (o: Object3D) => boolean): void {
  root.updateMatrixWorld(true);
  const invRoot = new Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<string, Bucket>();
  const consumed: Mesh[] = [];

  root.traverse((o) => {
    const m = o as Mesh;
    // Skip multi-material meshes and anything hidden at build time (per-skin
    // ornaments waiting on their tag) — they keep their own draw call.
    if (!m.isMesh || Array.isArray(m.material) || !m.geometry || !m.visible) return;
    if (skip?.(m)) return;
    const mat = m.material as Material;
    const key = materialKey(mat);
    let b = buckets.get(key);
    if (!b) {
      b = { mat, geos: [], cast: false, recv: false };
      buckets.set(key, b);
    }
    // Clone, drop the index (so indexed + non-indexed primitives can mix), and
    // bake the mesh's transform — relative to root — into the vertices.
    let geo = m.geometry.clone();
    if (geo.index) geo = geo.toNonIndexed();
    geo.applyMatrix4(new Matrix4().copy(invRoot).multiply(m.matrixWorld));
    geo.clearGroups();
    // Keep only the attributes every primitive shares, so the merge never trips
    // — plus `color` when the material actually READS it (vertex-coloured
    // meshes render black without it).
    const wantsColor = !!(mat as AnyMaterial).vertexColors;
    for (const name of Object.keys(geo.attributes)) {
      if (name !== 'position' && name !== 'normal' && name !== 'uv' && !(name === 'color' && wantsColor)) geo.deleteAttribute(name);
    }
    if (!geo.attributes.normal) geo.computeVertexNormals();
    if (wantsColor && !geo.attributes.color) {
      // An uncoloured mesh in a vertex-colour bucket: paint it white so the
      // attribute sets still match and the material colour shows through.
      geo.setAttribute('color', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(1), 3));
    }
    // Attribute sets must MATCH inside a bucket or mergeGeometries returns
    // null and the whole batch vanishes. Textured materials keep uv — lofted
    // geometry without any gets zeros, which samples the same single texel
    // WebGL's default attribute did before the merge. Untextured materials
    // never read uv, so it's dropped for a clean match.
    if (hasTextures(mat)) {
      if (!geo.attributes.uv) {
        geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
      }
    } else if (geo.attributes.uv) {
      geo.deleteAttribute('uv');
    }
    b.geos.push(geo);
    b.cast ||= m.castShadow;
    b.recv ||= m.receiveShadow;
    consumed.push(m);
  });

  // Detach only what was merged; unmergeable nodes stay put. Then drop the
  // plain groups left empty so the scene graph doesn't carry dead weight.
  for (const m of consumed) m.removeFromParent();
  pruneEmptyGroups(root);

  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos, false);
    for (const g of b.geos) g.dispose();
    if (!merged) continue;
    merged.computeBoundingSphere();
    const mesh = new Mesh(merged, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    root.add(mesh);
  }
}

/** Remove GROUPS the merge left childless — but never a tagged ornament shell
 *  (skinTag visibility toggles need the node even while it's empty), and only
 *  plain Groups: lights, cameras and other childless leaf nodes stay. */
function pruneEmptyGroups(o: Object3D): void {
  for (const c of [...o.children]) {
    pruneEmptyGroups(c);
    if ((c as { isGroup?: boolean }).isGroup && c.children.length === 0 && !c.userData?.skinTag && !c.name) {
      c.removeFromParent();
    }
  }
}
