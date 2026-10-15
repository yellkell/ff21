/**
 * Rocks of the desert (ported from yellkell/vrenv, rebuilt for DESERT 2.1).
 *
 * THE MESAS are cut from ONE stratigraphy (strata.ts): the bed table the
 * skin paints is the bed table the lathe steps by, so every ledge on the
 * face is a bed boundary and every shale seam is a recess. A mesa is a
 * TABLE — a hard caprock overhanging the beds under it, on a concave
 * TALUS apron of its own rubble — and its plan is never a circle: lobed,
 * elongated, fluted down the cliff by the wind. Buttes and spires stand
 * between the tables. The colour is in the skin; the vertex colour is
 * shading (a seam in shadow, the talus dusted with sand, a cast per mesa).
 *
 * THE BOULDERS are sandstone blocks, not potatoes: a sphere pushed toward
 * a rounded block, lumped by noise, then CLEAVED — a few random planes cut
 * flat faces into it — and flat-shaded so the facets read as fracture.
 * Four shapes, four instanced draws; they come in clusters (a big one and
 * its fallen pieces), sunk a third into the sand and tilted, wearing a
 * boulder hide of grain and cracks rather than the cliff's beds.
 * Everything is hazed (haze.ts), so distance does the rest.
 */

import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  type Group as GroupT,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  Object3D,
  Vector3,
} from 'three';
import { CONFIG } from './config.js';
import { makeRng, valueNoise2D } from './paper.js';
import { hazed } from './haze.js';
import { boulderMat, mesaSkin, skinned, tileNoise } from './textures.js';
import { desertHeight } from './terrain.js';
import { collapseStatic } from '../merge.js';
import { bedAt, capBed, TILE_M } from './strata.js';
import { claimSpot, freeSpot } from './occupancy.js';

const P = CONFIG.palette;
const dummy = new Object3D();
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const smoothstep = (a: number, b: number, x: number): number => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/* ── boulders ────────────────────────────────────────────────────────── */

interface BoulderShape {
  geo: BufferGeometry;
  /** Half-height of the shape at scale 1 (it spans −squash..+squash). */
  squash: number;
}

/** A sandstone block: sphere → rounded block → lumps → cleavage planes. */
function boulderShape(rng: () => number): BoulderShape {
  const geo = new IcosahedronGeometry(1, 3);
  const noise = valueNoise2D(rng, 8);
  const cuts: Array<{ n: Vector3; d: number }> = [];
  const nCuts = 3 + ((rng() * 4) | 0);
  for (let i = 0; i < nCuts; i++) {
    cuts.push({ n: new Vector3(rng() * 2 - 1, rng() * 1.4 - 0.4, rng() * 2 - 1).normalize(), d: 0.55 + rng() * 0.3 });
  }
  const squash = 0.62 + rng() * 0.3;
  const boxy = 0.25 + rng() * 0.35;
  const pos = geo.attributes.position;
  const p = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    const u = Math.atan2(p.z, p.x) / (Math.PI * 2) + 0.5;
    const v = p.y * 0.5 + 0.5;
    // Toward a rounded block: blend the sphere toward its cube projection.
    const m = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
    p.multiplyScalar(1 - boxy + boxy / m);
    // Weathered lumps.
    p.multiplyScalar(1 + (noise(u * 4, v * 4) - 0.5) * 0.36 + (noise(u * 12, v * 12) - 0.5) * 0.08);
    p.y *= squash;
    // Cleavage: anything past a plane is pushed back onto it — a flat face.
    for (const c of cuts) {
      const s = p.dot(c.n) - c.d;
      if (s > 0) p.addScaledVector(c.n, -s);
    }
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  pos.needsUpdate = true;
  // Sand-blasted feet a shade paler and dustier, exposed tops a shade
  // darker where the varnish takes.
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = clamp01((pos.getY(i) / squash) * 0.5 + 0.5);
    const l = 0.86 + t * 0.14 - Math.max(0, t - 0.75) * 0.5;
    col[i * 3] = l;
    col[i * 3 + 1] = l * (0.97 + t * 0.03);
    col[i * 3 + 2] = l * 0.94;
  }
  geo.setAttribute('color', new Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return { geo, squash };
}

interface Placement {
  x: number;
  y: number;
  z: number;
  s: number;
  ry: number;
  tx: number;
  tz: number;
  colour: Color;
}

let shapeCache: BoulderShape[] | null = null;

/** The cleaved shapes, made once and shared by the dunes and the talus. */
function boulderShapes(): BoulderShape[] {
  if (!shapeCache) {
    const rng = makeRng(CONFIG.terrain.seed * 7 + 1);
    shapeCache = Array.from({ length: CONFIG.rocks.variants }, () => boulderShape(rng));
  }
  return shapeCache;
}

/** Fallen blocks the mesas leave on their aprons (buildMesas fills this;
 *  buildBoulders draws them with the dunes' boulders). Far-layer coords. */
const scree: Array<{ x: number; y: number; z: number; s: number }> = [];

/** Boulders strewn across the dunes in clusters — four cleaved shapes,
 *  four draws, sunk into the sand and tilted — and the blocks on the
 *  mesas' aprons, in the same draws. */
export function buildBoulders(parent: GroupT): void {
  const rng = makeRng(CONFIG.terrain.seed * 7 + 5);
  const { clusters, variants } = CONFIG.rocks;
  const half = CONFIG.terrain.size / 2 - 8;
  const cols = P.boulder.map((c) => new Color(c));
  const shapes = boulderShapes();
  const mat = hazed(boulderMat('#ffffff', { repeat: [2, 1], bumpScale: 0.05 }));
  mat.flatShading = true;
  mat.vertexColors = true;
  const per: Placement[][] = shapes.map(() => []);
  // The talus blocks: what fell off the cliff, lying on the slope below it.
  for (const b of scree) {
    const v = (rng() * variants) | 0;
    per[v].push({ x: b.x, y: b.y - b.s * shapes[v].squash * 0.35, z: b.z, s: b.s, ry: rng() * Math.PI * 2, tx: (rng() - 0.5) * 0.7, tz: (rng() - 0.5) * 0.7, colour: cols[(rng() * cols.length) | 0] });
  }
  for (let c = 0; c < clusters; c++) {
    // Mostly one or two; now and then a pile.
    const n = 1 + ((rng() * rng() * 4) | 0);
    const big = 0.6 + rng() * rng() * 2.4;
    // Never inside the clearing (a boulder at your elbow reads as litter),
    // and never inside a mesa — the pile claims its ground for the plants.
    const [cx, cz] = freeSpot(() => {
      let x = 0;
      let z = 0;
      do {
        x = (rng() * 2 - 1) * half;
        z = (rng() * 2 - 1) * half;
      } while (Math.hypot(x, z) < 20);
      return [x, z];
    }, big * (n > 1 ? 2.6 : 1.2));
    for (let k = 0; k < n; k++) {
      const v = (rng() * variants) | 0;
      const s = k === 0 ? big : big * (0.25 + rng() * 0.45);
      const a = rng() * Math.PI * 2;
      const r = k === 0 ? 0 : big * (0.9 + rng() * 1.3);
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const sink = 0.25 + rng() * 0.25; // fraction of its height in the sand
      const y = desertHeight(x, z) + s * shapes[v].squash * (1 - 2 * sink);
      per[v].push({ x, y, z, s, ry: rng() * Math.PI * 2, tx: (rng() - 0.5) * 0.4, tz: (rng() - 0.5) * 0.4, colour: cols[(rng() * cols.length) | 0] });
    }
  }
  per.forEach((list, v) => {
    if (!list.length) return;
    const mesh = new InstancedMesh(shapes[v].geo, mat, list.length);
    if (v === 0) mesh.name = 'boulders'; // the harness's close-up handle
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    list.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.scale.setScalar(b.s);
      dummy.rotation.set(b.tx, b.ry, b.tz);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, b.colour);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    parent.add(mesh);
  });
}

/* ── mesas ───────────────────────────────────────────────────────────── */

/** One mesa material for the whole ring — the colour lives in the skin
 *  (strata.ts beds), the shading in the vertices, so every mesa merges
 *  into a single draw. UVs are laid in metres (one tile = TILE_M), so
 *  the repeat stays at one. */
const MESA_MAT = ((): ReturnType<typeof skinned> => {
  const m = hazed(skinned(mesaSkin(), '#ffffff', { repeat: [1, 1], bumpScale: 0.32, roughness: 0.95, envMapIntensity: 0.3 }));
  m.vertexColors = true;
  return m;
})();

/** THE TALUS: the apron is rubble, not bedrock, so it wears the boulders'
 *  hide at a scree scale under a sand-dusted vertex colour — its own
 *  material, one more draw for the whole ring. */
const SCREE_MAT = ((): ReturnType<typeof skinned> => {
  const m = hazed(boulderMat('#ffffff', { repeat: [1, 1], bumpScale: 0.14, roughness: 0.96 }));
  m.vertexColors = true;
  return m;
})();

/** Metres of scree per texture tile on the apron. */
const SCREE_M = 3;

/**
 * A single mesa (or, `butte`, a narrow remnant): a lathe of ROWS rings
 * about the y axis. The profile is a concave talus apron under the cliff;
 * the cliff steps in and out BY BED (strata.ts) with the bed table
 * anchored so the top of the mesa is the top of its caprock; the plan is
 * lobed and elongated; the wind flutes the face into columns. UVs in
 * metres so the skin's beds sit at true scale and line up with the steps.
 */
function makeMesa(rng: () => number, height: number, butte: boolean): Group {
  const baseR = butte ? height * (0.14 + rng() * 0.12) : height * (0.36 + rng() * 0.18);
  const apron = butte ? 0.4 + rng() * 0.1 : 0.24 + rng() * 0.08; // fraction of height that is talus
  const flare = butte ? 1.9 : 1.35 + rng() * 0.2; // foot radius over cliff radius
  const elong = 1 + rng() * 0.8; // the plan, longer one way
  const RAD = 64;
  const ROWS = Math.max(40, Math.round(height / 0.35));
  const plan = tileNoise(rng, 3, 1);
  const plan2 = tileNoise(rng, 7, 1);
  const flute = tileNoise(rng, 16, 3);
  const grain = tileNoise(rng, 40, 12);
  const lumps = tileNoise(rng, 10, 4);
  const cap = capBed();
  const cast = 0.9 + rng() * 0.2; // per-mesa brightness
  const warm = (rng() - 0.5) * 0.1; // per-mesa hue lean
  const dust = new Color(P.sandLight).lerp(new Color('#ffffff'), 0.25); // the talus, sand-dusted
  const pale = new Color('#fff2dc');
  const uRep = Math.max(1, Math.round((Math.PI * 2 * baseR * elong) / TILE_M));
  const uRepScree = Math.max(1, Math.round((Math.PI * 2 * baseR * elong * flare) / SCREE_M));
  const apronTop = apron * height;
  // The bed table, anchored: the top of the mesa is the top of the caprock.
  const vAt = (y: number): number => cap.v1 - (height - y) / TILE_M;
  // The first row on or above the apron's top: the cliff's rows start here
  // and the talus's end here, so the two meshes share that ring.
  const seamRow = Math.ceil((apronTop / height) * ROWS);

  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idxCliff: number[] = [];
  const idxTalus: number[] = [];
  const screeLocal: Array<{ x: number; y: number; z: number; s: number }> = [];
  const W = RAD + 1;
  for (let i = 0; i <= ROWS; i++) {
    const y01 = i / ROWS;
    const y = y01 * height;
    for (let j = 0; j <= RAD; j++) {
      const u = j / RAD;
      const ang = u * Math.PI * 2;
      const shape = 1 + (plan(u, 0) - 0.5) * 0.5 + (plan2(u, 0) - 0.5) * 0.12;
      let rr: number;
      let shade: number;
      if (i < seamRow) {
        // The talus: concave, steepening as it meets the cliff, lumpy —
        // big slumps of rubble with grain over them.
        const t = 1 - y / apronTop;
        rr = 1 + (flare - 1) * t * t * (0.55 + 0.45 * t);
        const lump = lumps(u, y01) - 0.5;
        const lump2 = lumps(u * 3 + 0.2, y01 * 3) - 0.5;
        rr += (lump * 0.22 + lump2 * 0.06) * (0.3 + 0.7 * t) + (grain(u, y01) - 0.5) * 0.04;
        shade = 1 + lump * 0.4 + lump2 * 0.15;
      } else {
        const bed = bedAt(vAt(y));
        const taper = 1 - 0.05 * ((y - apronTop) / (height - apronTop));
        rr = (1 - bed.inset) * taper;
        // Fluting — columns down the face, deepest in the massive beds.
        const fl = flute(u, y01 * 0.9) - 0.5;
        rr += fl * (bed.hard ? 0.16 : 0.08) + (grain(u, y01) - 0.5) * 0.03;
        // The fillet where the cliff meets its apron.
        rr = 1 + (rr - 1) * smoothstep(0, height * 0.05, y - apronTop);
        // A recessed bed sits in shadow; a proud one catches the light.
        shade = (1 - bed.inset * 3) * (bed.hard ? 1.05 : 1) * (1 + fl * 0.35);
      }
      const r = baseR * rr * shape;
      pos.push(Math.cos(ang) * r * elong, y, Math.sin(ang) * r);
      // The cliff's UVs are in bed tiles; the talus's in scree tiles.
      if (i < seamRow) uv.push(u * uRepScree, y / SCREE_M);
      else uv.push(u * uRep, vAt(y));
      // Colour: shading over the skin's own colour; the talus is the
      // cliff's own rock, broken, under a dusting of the sand it fell on.
      let cr = cast * shade * (1 + warm);
      let cg = cast * shade;
      let cb = cast * shade * (1 - warm);
      if (i < seamRow) {
        const t = 1 - y / apronTop;
        const rock = new Color(P.rockStrata[(Math.floor(u * 4 + y01 * 3) + 1) % P.rockStrata.length]).multiplyScalar(1.05);
        cr = rock.r * shade * (1 - t * 0.22) + dust.r * shade * t * 0.22;
        cg = rock.g * shade * (1 - t * 0.22) + dust.g * shade * t * 0.22;
        cb = rock.b * shade * (1 - t * 0.22) + dust.b * shade * t * 0.22;
        // Now and then, a block that fell off the cliff lies here.
        if (i > 1 && i < seamRow - 1 && j < RAD && rng() < 0.012) {
          const s = 0.5 + rng() * rng() * 1.6;
          screeLocal.push({ x: Math.cos(ang) * r * elong, y, z: Math.sin(ang) * r, s });
        }
      }
      if (y01 > 0.985) {
        cr = cr * 0.6 + pale.r * 0.4;
        cg = cg * 0.6 + pale.g * 0.4;
        cb = cb * 0.6 + pale.b * 0.4;
      }
      col.push(cr, cg, cb);
    }
  }
  for (let i = 0; i < ROWS; i++) {
    const into = i < seamRow ? idxTalus : idxCliff;
    for (let j = 0; j < RAD; j++) {
      const p = i * W + j;
      const q = p + W;
      into.push(p, q, p + 1, p + 1, q, q + 1);
    }
  }
  // The cap: a centre vertex fanned to the top ring, pale.
  const centre = pos.length / 3;
  pos.push(0, height, 0);
  uv.push(0.5, 0.5);
  col.push(cast * 0.6 + pale.r * 0.4, cast * 0.6 + pale.g * 0.4, cast * 0.6 + pale.b * 0.4);
  const top = ROWS * W;
  for (let j = 0; j < RAD; j++) idxCliff.push(centre, top + j + 1, top + j);

  // Two meshes over one vertex set: the cliff in the beds, the talus in
  // scree. The seam ring is in both, so there is no crack between them.
  const position = new Float32BufferAttribute(pos, 3);
  const uvs = new Float32BufferAttribute(uv, 2);
  const colours = new Float32BufferAttribute(col, 3);
  const mesa = new Group();
  for (const [indices, mat] of [
    [idxCliff, MESA_MAT],
    [idxTalus, SCREE_MAT],
  ] as Array<[number[], typeof MESA_MAT]>) {
    const geo = new BufferGeometry();
    geo.setAttribute('position', position);
    geo.setAttribute('uv', uvs);
    geo.setAttribute('color', colours);
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const part = new Mesh(geo, mat);
    part.castShadow = true;
    mesa.add(part);
  }
  mesa.rotation.y = rng() * Math.PI * 2;
  // The ground it takes (occupancy.ts): the foot of the talus at its widest
  // — the flare, plus the lumps on it, times the widest lobe of the plan,
  // times the elongation — and a step of clear sand beyond that.
  mesa.userData.footprint = baseR * (flare + 0.2) * 1.32 * elong + 1.5;
  mesa.userData.scree = screeLocal; // in the mesa's own frame; buildMesas places them
  return mesa;
}

/** A ring of mesas out toward the horizon — the western silhouette —
 *  with buttes and spires standing between them. */
export function buildMesas(parent: GroupT): void {
  const rng = makeRng(CONFIG.terrain.seed * 13 + 3);
  const { mesas, buttes, mesaRingMin, mesaRingMax } = CONFIG.rocks;
  // Mesas never move and share one material, so the whole ring merges
  // down to a single draw.
  const ring = new Group();
  ring.name = 'mesas';
  const spots: Vector3[] = [];
  ring.userData.spots = spots; // where each stands (the harness's close-ups)
  for (let i = 0; i < mesas; i++) {
    const a = (i / mesas) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const r = mesaRingMin + rng() * (mesaRingMax - mesaRingMin);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const height = 16 + rng() * 26;
    const mesa = makeMesa(rng, height, false);
    mesa.position.set(x, desertHeight(x, z) - 1.5, z);
    spots.push(mesa.position.clone());
    claimSpot(x, z, mesa.userData.footprint as number);
    dropScree(mesa);
    ring.add(mesa);
  }
  for (let i = 0; i < buttes; i++) {
    const a = ((i + 0.5) / buttes) * Math.PI * 2 + (rng() - 0.5) * 0.9;
    const r = mesaRingMin * 0.86 + rng() * (mesaRingMax - mesaRingMin * 0.86);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const height = 9 + rng() * 16;
    const butte = makeMesa(rng, height, true);
    butte.position.set(x, desertHeight(x, z) - 1, z);
    claimSpot(x, z, butte.userData.footprint as number);
    dropScree(butte);
    ring.add(butte);
  }
  collapseStatic(ring);
  parent.add(ring);
}

/** Carry a mesa's fallen blocks from its own frame into the far layer's,
 *  for buildBoulders to draw. */
function dropScree(mesa: Group): void {
  const c = Math.cos(mesa.rotation.y);
  const s = Math.sin(mesa.rotation.y);
  for (const b of mesa.userData.scree as Array<{ x: number; y: number; z: number; s: number }>) {
    // +Y rotation: x' = x·cos + z·sin, z' = −x·sin + z·cos.
    scree.push({ x: mesa.position.x + b.x * c + b.z * s, y: mesa.position.y + b.y, z: mesa.position.z - b.x * s + b.z * c, s: b.s });
  }
}
