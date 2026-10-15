/**
 * The desert floor (ported from yellkell/vrenv, reworked for DESERT 2.0): a
 * plane pushed into rolling dunes, smooth-shaded, with the sand's own
 * light baked into the vertex colour — crests that face the dying sun
 * warm up, lee slopes cool down, and broad patches of coarser, darker
 * sand break the plane up long before the eye can find the texture's
 * repeat. A flat clearing around the origin keeps the FIRE FIGHT platforms
 * on level ground.
 *
 * `desertHeight(x, z)` is exported so rocks/cacti/tumbleweeds rest on the sand.
 */

import { Color, Float32BufferAttribute, type Group, Mesh, PlaneGeometry, Vector3 } from 'three';
import { CONFIG } from './config.js';
import { makeRng, valueNoise2D } from './paper.js';
import { hazed } from './haze.js';
import { sandSkin, skinned } from './textures.js';

const T = CONFIG.terrain;
const rng = makeRng(T.seed);
const noise = valueNoise2D(rng, 16);
/** The broad mottle: patches of darker, coarser sand across the dunes. */
const mottle = valueNoise2D(makeRng(T.seed * 5 + 2), 16);

/** Ground height at world (x, z). Lowered near the platforms, dunes beyond. */
export function desertHeight(x: number, z: number): number {
  const big = noise(x / 42 + 10, z / 42 + 10);
  const small = noise(x / 14 + 4, z / 14 + 4);
  const dune = (big - 0.45) * T.duneHeight + (small - 0.5) * T.duneHeight * 0.3;
  const d = Math.hypot(x, z);
  const falloff = Math.min(1, Math.max(0, (d - T.flatRadius) / T.flatRadius));
  const platformReveal = T.platformReveal * (1 - falloff);
  return dune * falloff - platformReveal;
}

/** Where the sun is, in the far layer's own frame (index.ts builds the same
 *  vector for the light; the terrain never turns relative to it). */
function sunDirection(): Vector3 {
  const e = CONFIG.mood.sunElevation * (Math.PI / 2);
  return new Vector3(0.35 * Math.cos(e), Math.sin(e), -0.94 * Math.cos(e)).normalize();
}

export function buildTerrain(parent: Group): void {
  const geo = new PlaneGeometry(T.size, T.size, T.segments, T.segments);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, desertHeight(pos.getX(i), pos.getZ(i)));
  pos.needsUpdate = true;
  geo.computeVertexNormals();

  // The baked light. The real sun is four degrees up and the dunes are
  // shallow, so the renderer's own shading barely tells a crest from a
  // hollow; this exaggerates the aspect so the dunes read as FORM — a
  // slope toward the sun a step warmer, a lee slope a step cooler and
  // bluer, the way sand at dusk actually goes.
  const light = new Color(CONFIG.palette.sandLight);
  const dark = new Color(CONFIG.palette.sandDark);
  const lee = new Color('#4a3a3e');
  const sun = sunDirection();
  const sunFlat = new Vector3(sun.x, 0.55, sun.z).normalize();
  const nrm = geo.attributes.normal;
  const colors: number[] = [];
  const tmp = new Color();
  const n = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
    // Height: hollows darker, crests lighter.
    const t = Math.min(1, Math.max(0, y / (T.duneHeight * 0.8) + 0.45));
    tmp.copy(dark).lerp(light, t);
    // Aspect: how squarely this bit of ground faces the sun.
    const facing = n.dot(sunFlat); // ~0.55 flat, more on a lit slope
    const aspect = Math.min(1, Math.max(0, (facing - 0.55) * 9));
    const shade = Math.min(1, Math.max(0, (0.55 - facing) * 9));
    tmp.lerp(light, aspect * 0.5).multiplyScalar(1 + aspect * 0.18);
    tmp.lerp(lee, shade * 0.45);
    // The broad mottle: coarser, darker patches, a few metres across.
    const m = mottle(x / 23 + 3, z / 23 + 7) - 0.5;
    tmp.multiplyScalar(1 + m * 0.22);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));

  // Wind-rippled sand under the dune colour: the skin's map is tint-neutral
  // (vertex colour carries the dusk tone), its bump gives the ground grain
  // and the ripples the low sun rakes across. Anisotropy 1 on purpose —
  // see textures.ts SkinOpts — and hazed, so the far edge of the plane
  // melts into the sky band instead of ending in a line.
  const mat = hazed(skinned(sandSkin(), '#e0cdb4', { repeat: [52, 52], roughness: 1, bumpScale: 0.1, anisotropy: 1 }));
  mat.vertexColors = true;

  const ground = new Mesh(geo, mat);
  ground.receiveShadow = true;
  parent.add(ground);
}
