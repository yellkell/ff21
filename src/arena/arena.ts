/**
 * Builds the static arena for FIRE FIGHT, styled like a 90s UK robot-wars
 * pit: diamond-plate pedestal slabs with hazard-amber kick-bands, bolted
 * corner studs and a thin team-colour rim glow. The environment is intentionally
 * just the two platforms floating in your passthrough room:
 *  - a slab pedestal beneath YOU (ember rim) — underfoot, Blaston-style,
 *  - a matching pedestal across the gap for the opponent (blue rim),
 *  - the FIRE FIGHT title plate hung high behind the opponent (lobby only),
 *  - warm key lighting so the steel and fire read with some form.
 *
 * The guardian-style rim barrier is built and driven by BoundarySystem.
 * These are plain Three.js objects parented under `world.scene` — static
 * set-dressing. Dynamic, interactive objects become ECS entities.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PointLight,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector3,
  type Object3D,
} from 'three';
import type { World } from '@iwsdk/core';
import {
  ARENA_GAP,
  OCTAGON_VERTICES,
  PALETTE,
  PLATFORM,
  RAID_RING_RADIUS,
  teamColor,
} from '../config.js';
import { MAX_OPPONENTS } from '../combat/opponentBus.js';
import { localLayout } from '../combat/layout.js';
import { app } from '../menu/appState.js';
import { hazardTexture } from '../materials/hazard.js';
import { deckLook, streetDecks } from './decks.js';
import { octagonSlab } from './octagon.js';
import { createTitleBanner } from './banner.js';
import { registerPad } from './padKit.js';

/**
 * Set dressing that is IDENTICAL on every pedestal — the hazard stripes and
 * the corner studs are never recoloured by a skin (applyPlatformSkin only
 * touches the 'slab'/'neon-core'/'neon-halo' roles), so one texture, one
 * material and one geometry can serve all seven pads instead of each pad
 * minting its own. hazardTexture() builds a fresh canvas + GPU upload on every
 * call, so this is the difference between one stripe texture and dozens.
 */
let hazardMat: MeshBasicMaterial | undefined;
let boltGeo: CylinderGeometry | undefined;

/**
 * Just proud of the slab's bevelled top face. The extrude BEVEL overhangs, so
 * the real deck surface is at +0.015, NOT y=0 — anything laid on the deck has
 * to clear that or it renders inside the steel and is never seen.
 */
const DECK_TOP = 0.02;

/**
 * The rim path: the octagon outline with every corner eased into a short arc,
 * so a tube swept along it reads as ONE piece of bent glass. Real neon IS bent
 * tubing — it has no mitred corners — which is why the rim used to give itself
 * away: eight straight bars butt-jointed at 45° leave a visible notch at every
 * vertex, and square bars leave eight of them.
 */
function rimPath(corner = 0.045): Vector3[] {
  const pts: Vector3[] = [];
  const n = OCTAGON_VERTICES.length;
  const at = (i: number): Vector3 => {
    const [x, z] = OCTAGON_VERTICES[((i % n) + n) % n];
    return new Vector3(x, PLATFORM.rimLift, z);
  };
  for (let i = 0; i < n; i++) {
    const cur = at(i);
    const prev = at(i - 1);
    const next = at(i + 1);
    // Never eat more than half of either adjoining edge.
    const r = Math.min(corner, cur.distanceTo(prev) / 2, cur.distanceTo(next) / 2);
    const a = cur.clone().lerp(prev, r / cur.distanceTo(prev)); // arc start
    const b = cur.clone().lerp(next, r / cur.distanceTo(next)); // arc end
    pts.push(a);
    // Quadratic Bézier a → cur → b: the bend itself.
    for (const t of [0.35, 0.65]) {
      const u = 1 - t;
      pts.push(
        new Vector3(
          u * u * a.x + 2 * u * t * cur.x + t * t * b.x,
          PLATFORM.rimLift,
          u * u * a.z + 2 * u * t * cur.z + t * t * b.z,
        ),
      );
    }
    pts.push(b);
  }
  return pts;
}

/** Shared rim tube geometry — every pad wears the same octagon, so the two
 *  sweeps are built once and only the MATERIALS differ per platform. */
let rimCoreGeo: TubeGeometry | undefined;
let rimHaloGeo: TubeGeometry | undefined;

/**
 * Neon rim piping: a bright white-hot core tube running the whole rim, wrapped
 * in a fatter additive halo of the team colour — proper neon tubing, not a
 * one-pixel line. Two swept meshes for the entire ring, where this used to be
 * sixteen boxes per pedestal (112 across the seven).
 */
function makeNeonRim(color: number): Group {
  const rim = new Group();
  rim.name = 'rim-ring';
  const core = new MeshBasicMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.45),
  });
  core.userData.role = 'neon-core'; // skin recolour target (avatar/skins.ts)
  const halo = new MeshBasicMaterial({
    color: new Color(color),
    transparent: true,
    opacity: 0.4,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  halo.userData.role = 'neon-halo';
  if (!rimCoreGeo || !rimHaloGeo) {
    // 'centripetal' keeps the spline from overshooting at the bends — with the
    // default parameterisation the corners bulge outside the platform.
    const curve = new CatmullRomCurve3(rimPath(), true, 'centripetal');
    // 96 × 6 keeps the bends smooth at arm's length while trading ~15k extra
    // triangles across the seven pads for 98 fewer draw calls — the right way
    // round for a tile-based mobile GPU.
    rimCoreGeo = new TubeGeometry(curve, 96, 0.008, 6, true);
    rimHaloGeo = new TubeGeometry(curve, 96, 0.022, 6, true);
  }
  rim.add(new Mesh(rimCoreGeo, core));
  rim.add(new Mesh(rimHaloGeo, halo));
  return rim;
}

/**
 * The hazard-striped kick-band: an amber warning ring painted round the inside
 * of the rim. It belongs on a TITAN's ground, not a boxer's — on a fighter's
 * pad it just crowds the deck you stand on, but round a boss pedestal it reads
 * as the machine's own danger marking. Built on every pad and hidden by
 * default; setPlatformHazard turns it on for whichever pedestal is currently
 * carrying a boss (the raid pit always, slot 1 while a campaign titan is up).
 *
 * Built as ONE mitred ring rather than eight separate quads. Eight quads can't
 * meet cleanly at an octagon's corners — butted they leave a wedge of bare
 * steel at every vertex, overlapped they hang off the rim — so the ring is
 * offset properly instead: each corner vertex is the intersection of its two
 * inward-offset edge lines, which is a true mitre and keeps the band a constant
 * width the whole way round.
 *
 * Stripe density is baked into the UVs rather than into a per-edge
 * `texture.clone()` with its own `repeat`. That matters twice over: a clone
 * shares the image but is a separate GPU upload, so the old code pushed eight
 * copies of the same stripe texture per platform — 56 across the seven pads —
 * and `repeat` lives on the texture, so it could not follow a platform that was
 * SCALED. The raid pit is built at 2.4×, which stretched its stripes to two and
 * a half times everyone else's. UVs scale with the mesh; textures don't, so
 * `uvScale` compensates a known group scale and every pad stripes at one pitch.
 */
function makeHazardBand(uvScale = 1): Group {
  const band = new Group();
  band.name = 'hazard-band';
  // ONE shared texture + material for every pad.
  hazardMat ??= new MeshBasicMaterial({
    map: hazardTexture(),
    transparent: true,
    opacity: 0.85,
    side: DoubleSide,
  });
  const width = 0.075;
  const inset = 0.016; // hold the band clear of the neon tube's halo
  const n = OCTAGON_VERTICES.length;

  // Inward unit normal of every edge (edge i runs vertex i → i+1).
  const normals: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = OCTAGON_VERTICES[i];
    const [bx, bz] = OCTAGON_VERTICES[(i + 1) % n];
    const L = Math.hypot(bx - ax, bz - az);
    let nx = -(bz - az) / L;
    let nz = (bx - ax) / L;
    if (nx * ((ax + bx) / 2) + nz * ((az + bz) / 2) > 0) {
      nx = -nx;
      nz = -nz;
    }
    normals.push([nx, nz]);
  }
  /** Vertex `i` pushed `d` inward — where its two offset edge lines cross. */
  const mitre = (i: number, d: number): [number, number] => {
    const [px, pz] = normals[(i - 1 + n) % n]; // edge arriving at this vertex
    const [qx, qz] = normals[i]; // edge leaving it
    const [vx, vz] = OCTAGON_VERTICES[i];
    const det = px * qz - pz * qx;
    if (Math.abs(det) < 1e-6) return [vx + d * px, vz + d * pz]; // straight run
    const a = vx * px + vz * pz + d;
    const b = vx * qx + vz * qz + d;
    return [(a * qz - b * pz) / det, (px * b - qx * a) / det];
  };

  const outer = OCTAGON_VERTICES.map((_, i) => mitre(i, inset));
  const inner = OCTAGON_VERTICES.map((_, i) => mitre(i, inset + width));

  // u runs the perimeter, v across the width. Rounding the total tile count to
  // a whole number is what lets the stripes meet seamlessly at the wrap.
  let perim = 0;
  const run: number[] = [0];
  for (let i = 0; i < n; i++) {
    perim += Math.hypot(outer[(i + 1) % n][0] - outer[i][0], outer[(i + 1) % n][1] - outer[i][1]);
    run.push(perim);
  }
  const tiles = Math.max(1, Math.round(perim * uvScale * 6));

  const pos: number[] = [];
  const uvs: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const j = i % n;
    const u = (run[i] / perim) * tiles;
    pos.push(outer[j][0], DECK_TOP, outer[j][1]);
    uvs.push(u, 0);
    pos.push(inner[j][0], DECK_TOP, inner[j][1]);
    uvs.push(u, 1);
  }
  // Duplicate the seam ring (i === n) so the wrap gets u = tiles, not u = 0.
  for (let i = 0; i < n; i++) {
    const o = i * 2;
    idx.push(o, o + 2, o + 3, o, o + 3, o + 1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  band.add(new Mesh(geo, hazardMat));
  band.visible = false; // boss pedestals only — see setPlatformHazard
  return band;
}

/** Show/hide a pedestal's hazard kick-band. On for a boss's ground only. */
export function setPlatformHazard(pad: Object3D, on: boolean): void {
  const band = pad.getObjectByName('hazard-band');
  if (band) band.visible = on;
}

/** Corner screws at each rim vertex, holding the deck down. Their metal
 *  is the skin's TRIM (iron under charred oak, chrome under ice, gold
 *  under lacquer) — one material per pad so applyPlatformSkin can retint. */
function makeCornerBolts(): Group {
  const bolts = new Group();
  bolts.name = 'corner-bolts';
  boltGeo ??= new CylinderGeometry(0.028, 0.035, 0.035, 12);
  const boltMat = new MeshStandardMaterial({ color: 0x4a4c52, metalness: 0.92, roughness: 0.34 });
  boltMat.userData.role = 'trim';
  for (const [x, z] of OCTAGON_VERTICES) {
    const bolt = new Mesh(boltGeo, boltMat);
    bolt.position.set(x * 0.97, 0.018, z * 0.97);
    bolts.add(bolt);
  }
  return bolts;
}

/**
 * One boxer's pedestal — THE STAGE DECK. FF1's diamond-plate steel retired
 * with the sequel: the boards are now RAVE RAID's waxed oak (the club
 * stage's own planking, src/club/materials.ts), laid running toward your
 * foe, with brass corner screws and the team-neon glass tube ringing the
 * edge like stage lighting. Sunk so the top face sits at floor level (your
 * real floor IS the platform top). Skins still stain it: the 'slab' role
 * tints the boards, so GOLD RUSH is gilded planking and VOLT scorched black.
 */
/** THE STAGE: how far a fight deck stands above the street in sites that
 *  raise it (NEON's plaza drops its ground by this much and shows a plinth
 *  under every deck). Combat is untouched — the deck is still y = 0. */
export const STAGE_RAISE = 0.45;
const plinths: Object3D[] = [];
let plinthsOn = false;
/** Show / hide every deck's plinth (current and future). */
export function setStageRaised(on: boolean): void {
  plinthsOn = on;
  for (const p of plinths) p.visible = on;
}

let plinthMat: MeshStandardMaterial | null = null;
let plinthBodyGeo: BufferGeometry | null = null;
let plinthFootGeo: BufferGeometry | null = null;

function makePlinth(): Group {
  const plinth = new Group();
  plinth.name = 'stage-plinth';
  // Shared across every pad: one material, two geometries.
  plinthMat ??= new MeshStandardMaterial({ color: 0x15171d, metalness: 0.65, roughness: 0.38 });
  const scaled = (k: number) => OCTAGON_VERTICES.map(([x, z]) => [x * k, z * k] as [number, number]);
  // The street is STAGE_RAISE below the deck top; the deck itself is
  // PLATFORM.thickness deep, so the plinth fills the gap between them.
  plinthBodyGeo ??= octagonSlab(scaled(0.9), STAGE_RAISE - PLATFORM.thickness - 0.03);
  plinthFootGeo ??= octagonSlab(scaled(0.97), 0.04);
  const body = new Mesh(plinthBodyGeo, plinthMat);
  body.position.y = -STAGE_RAISE + 0.03;
  plinth.add(body);
  const foot = new Mesh(plinthFootGeo, plinthMat);
  foot.position.y = -STAGE_RAISE;
  plinth.add(foot);
  // No light at the foot: one lit seam in the bezel is the pad's colour —
  // a second band round the base read as a toy, not street furniture.
  plinth.visible = plinthsOn;
  plinths.push(plinth);
  return plinth;
}

export function makePlatform(color: number, groupScale = 1): Group {
  const group = new Group();
  group.add(makePlinth());

  // THE DECK is a MATERIAL (arena/decks.ts): the pedestal is born as the
  // house deck — SMOULDER's charred oak — and applyPlatformSkin swaps in
  // whatever the fighter wears: ash, slate, marble, black glass, gold leaf.
  // Every deck's maps are shared per style, so a skin change never uploads.
  const house = streetDecks() ? 'iron' : 'charred';
  const look = deckLook(house);
  const slabMat = new MeshStandardMaterial({
    color: look.color,
    map: look.map,
    bumpMap: look.bump,
    bumpScale: look.bumpScale,
    emissive: look.emissive ?? color,
    emissiveIntensity: look.emissiveIntensity ?? 0.02,
    metalness: look.metalness,
    roughness: look.roughness,
  });
  slabMat.envMapIntensity = look.envMapIntensity;
  slabMat.userData.role = 'slab';
  slabMat.userData.deck = house;
  const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness), slabMat);
  // Top face at the floor line, body glowing faintly below. NB the extrude
  // BEVEL overhangs both ends, so the actual top face sits at +bevel (0.015)
  // — anything painted on the deck must clear that, not y=0.
  slab.position.y = -PLATFORM.thickness;
  group.add(slab);

  // `groupScale` is the scale the CALLER will put on this group (the raid pit
  // stands at 2.4×). Stripe pitch is baked into UVs, which scale with the mesh,
  // so it has to be compensated here or the boss pad stripes 2.4× coarser than
  // every boxer's pad — which is exactly what it used to do.
  const hazard = makeHazardBand(groupScale);
  const bolts = makeCornerBolts();
  const rim = makeNeonRim(color);
  group.add(hazard, bolts, rim);
  // THE MACHINED PAD (padKit.ts): when the Blender kit lands this pad is
  // upgraded in place — bezel, socket bolts, skirt, lit vents — wearing its
  // own role materials, so skins and team tints carry straight over.
  registerPad({
    group,
    slab,
    bolts,
    hazard,
    rim,
    slabMat,
    trimMat: (bolts.children[0] as Mesh).material as MeshStandardMaterial,
    coreMat: (rim.children[0] as Mesh).material as MeshBasicMaterial,
  });

  // --- Per-skin FX (hidden; applyPlatformSkin shows one set by tag) ---
  // The tint-era ornaments — the XD grin, VOLT's bolt, SYNTHWAVE's grid,
  // INFERNO's fins, GOLD RUSH's medallion — are gone with their skins: a
  // deck is its MATERIAL now. What stays is the two earned pads' living
  // furniture, because those were never decoration: BLAZING burns and
  // TIDEBREAKER is still wet.

  // BLAZING: not merely a flame decal. The earned pad carries a white-hot
  // deck brand, a burning outer rail and an animated flame crown at every
  // lifting off the steel. The low effects stay outside the standing area, so
  // the silhouette reads as a trophy without filling the player's play space.
  const flameTongue = (h: number): Shape => {
    const w = h * 0.62;
    const s = new Shape();
    s.moveTo(0, 0);
    s.bezierCurveTo(-w * 0.55, h * 0.12, -w * 0.42, h * 0.55, -w * 0.1, h * 0.62);
    s.bezierCurveTo(-w * 0.28, h * 0.8, w * 0.02, h * 0.9, w * 0.08, h);
    s.bezierCurveTo(w * 0.42, h * 0.68, w * 0.55, h * 0.3, 0, 0);
    return s;
  };
  const FLAME_H = 1.15;
  const flame = new Group();
  flame.name = 'blazing-platform-fx';
  flame.userData.skinTag = 'blazing';
  flame.userData.platformFx = 'blazing';
  const outerMat = new MeshBasicMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.45),
    transparent: true,
    opacity: 0.82,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  outerMat.userData.role = 'neon-core';
  const outer = new Mesh(new ShapeGeometry(flameTongue(FLAME_H)), outerMat);
  outer.userData.fxRole = 'blazing-emblem';
  const coreMat = new MeshBasicMaterial({
    color: 0xffc21a,
    transparent: true,
    opacity: 0.88,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  }); // no role: fire's amber heart is never retinted
  const core = new Mesh(new ShapeGeometry(flameTongue(FLAME_H * 0.55)), coreMat);
  core.position.z = 0.001; // proud of the outer tongue
  core.userData.fxRole = 'blazing-emblem-core';
  const deckBrand = new Group();
  deckBrand.add(outer, core);
  deckBrand.rotation.x = -Math.PI / 2; // flat on deck, tip toward the foe
  deckBrand.position.set(0, DECK_TOP + 0.004, FLAME_H / 2);
  flame.add(deckBrand);

  const fireRailMat = outerMat.clone();
  fireRailMat.userData.role = 'neon-halo';
  fireRailMat.opacity = 0.42;
  const fireRail = new Mesh(new TorusGeometry(0.735, 0.027, 6, 56), fireRailMat);
  fireRail.rotation.x = Math.PI / 2;
  fireRail.position.y = DECK_TOP + 0.012;
  fireRail.userData.fxRole = 'blazing-rail';
  flame.add(fireRail);

  // Crown every corner with a two-tone lick of fire. Each crown is a vertical
  // double-sided mesh, readable from the pad opposite as well as from above.
  const jetOuterGeo = new ShapeGeometry(flameTongue(0.24));
  const jetCoreGeo = new ShapeGeometry(flameTongue(0.14));
  const jetCoreMat = coreMat.clone();
  OCTAGON_VERTICES.forEach(([x, z], i) => {
    // Every corner, all eight — the pad is a trophy, and crowning only the
    // alternate vertices left it looking half-lit from most angles rather
    // than deliberate.
    const jet = new Group();
    jet.position.set(x * 0.94, DECK_TOP, z * 0.94);
    jet.rotation.y = Math.atan2(x, z);
    jet.userData.fxRole = 'blazing-jet';
    jet.userData.fxPhase = i * 0.79;
    // CROSSED pair, not a single card. A flat flame is a flat flame: seen
    // edge-on it collapses to a sliver, and with eight of them round the rim
    // two or three are always near edge-on from wherever you stand. The second
    // card at 90° keeps every corner reading as fire from any angle.
    for (const yaw of [0, Math.PI / 2]) {
      const card = new Group();
      card.rotation.y = yaw;
      const shell = new Mesh(jetOuterGeo, outerMat);
      const heart = new Mesh(jetCoreGeo, jetCoreMat);
      heart.position.z = 0.003;
      card.add(shell, heart);
      jet.add(card);
    }
    flame.add(jet);
  });

  // No point light here (nor on TIDEBREAKER). A deck lamp is never just its
  // own shading cost: adding a light to the scene changes every lit material's
  // shader permutation, so wearing the pad recompiles the whole arena — a
  // hitch — and then charges for an extra light per pixel for as long as it is
  // worn. The emissive jets and embers carry the look on their own.
  flame.visible = false;
  group.add(flame);

  // TIDEBREAKER: a luminous pool, a rolling crest at every outline point and hanging
  // droplets. It should look as if GOOPLIATH is still alive beneath the slab,
  // not like somebody painted a green raindrop on ordinary diamond plate.
  const D = 0.52;
  const gel = new Shape();
  gel.moveTo(0, D); // pinched crown
  gel.quadraticCurveTo(0.95 * D, -0.1 * D, 0.55 * D, -0.55 * D);
  gel.quadraticCurveTo(0, -0.98 * D, -0.55 * D, -0.55 * D); // round belly
  gel.quadraticCurveTo(-0.95 * D, -0.1 * D, 0, D);
  const tide = new Group();
  tide.name = 'tidebreaker-platform-fx';
  tide.userData.skinTag = 'tidebreaker';
  tide.userData.platformFx = 'tidebreaker';
  const gelMat = new MeshBasicMaterial({
    color: new Color(color).lerp(new Color(0xffffff), 0.45),
    transparent: true,
    opacity: 0.78,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  gelMat.userData.role = 'neon-core';
  const drop = new Mesh(new ShapeGeometry(gel), gelMat);
  drop.rotation.x = -Math.PI / 2; // crown pointing at the foe
  drop.position.y = DECK_TOP + 0.006;
  drop.userData.fxRole = 'tide-emblem';
  tide.add(drop);

  const poolMat = new MeshBasicMaterial({
    color: 0x24ff9a,
    transparent: true,
    opacity: 0.18,
    side: DoubleSide,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  poolMat.userData.role = 'neon-halo';
  const pool = new Mesh(new CircleGeometry(0.62, 40), poolMat);
  pool.rotation.x = -Math.PI / 2;
  pool.position.y = DECK_TOP + 0.002;
  pool.userData.fxRole = 'tide-pool';
  tide.add(pool);

  for (let i = 0; i < 2; i++) {
    const ringMat = poolMat.clone();
    ringMat.opacity = 0.34;
    const ring = new Mesh(new TorusGeometry(0.35 + i * 0.18, 0.011, 5, 40), ringMat);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = DECK_TOP + 0.011 + i * 0.002;
    ring.userData.fxRole = 'tide-ring';
    ring.userData.fxPhase = i / 2;
    tide.add(ring);
  }

  const wave = new Shape();
  wave.moveTo(-0.17, 0);
  wave.bezierCurveTo(-0.09, 0.01, -0.06, 0.12, 0.02, 0.16);
  wave.bezierCurveTo(0.02, 0.09, 0.1, 0.05, 0.17, 0.06);
  wave.lineTo(0.17, 0);
  wave.closePath();
  const waveGeo = new ShapeGeometry(wave);
  OCTAGON_VERTICES.forEach(([x, z], i) => {
    const crest = new Mesh(waveGeo, gelMat);
    crest.position.set(x * 0.93, DECK_TOP, z * 0.93);
    crest.rotation.y = Math.atan2(x, z);
    crest.userData.fxRole = 'tide-crest';
    crest.userData.fxPhase = i * 0.73;
    tide.add(crest);
  });

  // Long luminous drops hang below alternate corners, giving the pad an
  // unmistakable profile even when the deck art is foreshortened.
  const dripGeo = new SphereGeometry(0.05, 8, 6);
  OCTAGON_VERTICES.forEach(([x, z], i) => {
    if (i % 4) return; // two opposing drips are enough to carry the silhouette
    const drip = new Mesh(dripGeo, gelMat);
    drip.position.set(x * 0.9, -PLATFORM.thickness - 0.07, z * 0.9);
    drip.scale.set(0.65, 1.75 + i * 0.04, 0.65);
    drip.userData.fxRole = 'tide-drip';
    drip.userData.fxPhase = i * 0.55;
    drip.userData.fxBaseY = drip.position.y;
    tide.add(drip);
  });
  tide.visible = false; // no point light — see BLAZING above
  group.add(tide);

  return group;
}

/** Recolour a platform's neon rim + slab emissive to a team tint. (Exported
 *  for CampaignSystem: GOOPLIATH's ground goes goop-green for his fights.) */
export function tintPlatform(group: Object3D, color: number): void {
  const core = new Color(color).lerp(new Color(0xffffff), 0.45);
  const tint = new Color(color);
  group.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      const role = (mat as MeshBasicMaterial).userData?.role;
      if (role === 'neon-core') (mat as MeshBasicMaterial).color.copy(core);
      else if (role === 'neon-halo') (mat as MeshBasicMaterial).color.copy(tint);
      else if (role === 'slab') (mat as MeshStandardMaterial).emissive.copy(tint);
    }
  });
}

/** Name of the platform mesh for an other-fighter slot (1 keeps the legacy id). */
export function platformName(slot: number): string {
  return slot === 1 ? 'opponent-platform' : `opponent-platform-${slot}`;
}

/**
 * Lay the platforms out for the current bout's LOCAL roster: the player pedestal
 * stays at the origin, each other-fighter pedestal moves to its slot (position +
 * facing yaw), recolours to its team tint and shows only if the bout uses it.
 */
export function applyArenaLayout(scene: Object3D): void {
  const roster = localLayout();
  for (let slot = 1; slot <= MAX_OPPONENTS; slot++) {
    const pad = scene.getObjectByName(platformName(slot));
    if (!pad) continue;
    const seat = roster[slot];
    if (seat) {
      pad.visible = true;
      pad.position.set(seat.pos[0], seat.pos[1], seat.pos[2]);
      pad.rotation.y = seat.yaw;
      tintPlatform(pad, teamColor(seat.team));
      // A re-seated pad is a BOXER's pad again until a titan claims it; the
      // campaign turns its own boss pedestal's band back on when it takes over.
      setPlatformHazard(pad, false);
    } else {
      pad.visible = false;
    }
  }
  // The RAID pit: a fifth, boss-tinted pedestal at the arc's focus. Every raid
  // seat faces the anchor from RAID_RING_RADIUS away, so it lands at
  // (0,0,-RAID_RING_RADIUS) in EVERY player's frame — dead ahead, far out.
  const pit = scene.getObjectByName('raid-boss-platform');
  if (pit) pit.visible = app.arcade === 'raid';
}

let foeStage: Group | null = null;
/** Show or hold back everyone else's ground (the opponents' pads, the raid
 *  pit) as a whole — their own visibility rules still apply underneath. */
export function setFoeStageShown(on: boolean): void {
  if (foeStage && foeStage.visible !== on) foeStage.visible = on;
}

export function buildArena(world: World): Object3D {
  const scene = world.scene;

  const arena = new Group();
  arena.name = 'arena';

  // Your pedestal: ember rim, underfoot.
  const mine = makePlatform(PALETTE.ember);
  mine.name = 'player-platform';
  arena.add(mine);

  // Everyone else's ground — the other fighters' pads and the raid pit — hangs
  // off one group, so a site can hold it back while it isn't the fight's yet
  // (setFoeStageShown: the neon district's backstreet, mid-crossing).
  const foes = new Group();
  foes.name = 'foe-stage';
  arena.add(foes);
  foeStage = foes;

  // The other fighters' pedestals — same shape, recoloured/placed per layout by
  // applyArenaLayout. Built once at the MAX roster size; spare slots stay hidden.
  for (let slot = 1; slot <= MAX_OPPONENTS; slot++) {
    const pad = makePlatform(PALETTE.coolFlame);
    pad.name = platformName(slot);
    pad.position.set(0, 0, -ARENA_GAP);
    pad.visible = false;
    foes.add(pad);
  }

  // The RAID pit pedestal — the titan's own ground at the arc's focus, worn in
  // danger red. Hidden outside raids (applyArenaLayout owns its visibility).
  // Stretched wide: every raid titan is GOLIATH-sized or bigger, so a
  // boxer-sized pad would read like a coaster under it.
  const pit = makePlatform(PALETTE.danger, 2.4);
  pit.name = 'raid-boss-platform';
  pit.position.set(0, 0, -RAID_RING_RADIUS);
  pit.scale.set(2.4, 1, 2.4);
  pit.visible = false;
  setPlatformHazard(pit, true); // the pit is only ever a titan's ground
  foes.add(pit);

  // "FIRE FIGHT" signage hung high behind the opponent.
  createTitleBanner(scene);

  // --- Lighting: warm-vs-cool so both fires and the steel read nicely ---
  arena.add(new HemisphereLight(0xcfd8e8, 0xffd9b0, 1.2));
  const key = new PointLight(PALETTE.flame, 7, 14);
  key.position.set(0, 3, -ARENA_GAP / 2);
  arena.add(key);

  scene.add(arena);
  // Start in the classic duel layout (slot 1 across the gap, the rest hidden).
  applyArenaLayout(scene);
  return arena;
}
