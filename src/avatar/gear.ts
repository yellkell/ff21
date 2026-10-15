/**
 * GEAR — the attachments shop (DESIGN.md §5.2: "shapes, never colour").
 *
 * Coins buy SHAPES that bolt onto THE BLANK: crests, antennae, horns and
 * halos for the head; pauldrons, SPIKED PADS and a WARLORD's flamed domes
 * for the shoulders; a chestplate, a TAIL, a CAPE and a belt for the body;
 * knuckle spikes and cuffs for the hands. Every piece
 * can be seen worn, front and back, on one sheet: `npm run gear:gallery`
 * (tools/gear-gallery.mjs, with the dev server up). (A COLLAR and a dorsal
 * RIDGE were sold for a while and withdrawn — the collar never sat right
 * on the loft, and the ridge was a 24 mm strip laid along the spine using
 * the loft's half-depths while ignoring the forward LEAN of its upper
 * rings, so the top of it sank inside the back and the rest was too thin
 * to find. Both ids are retired, not reused: an old save still naming one
 * just wears nothing on the body, because cleanGear drops what the
 * catalogue no longer knows.) Every
 * piece is sold in the body's own primer — white on a blank, black on an
 * onyx — so identity still comes from what you bolt on and what you paint,
 * never from a catalogue of colours. Gear is PURELY VISUAL: it parents to
 * the rig's head / body / glove groups and the BODY_IK hitboxes never
 * move, so a horned fighter is exactly as hittable as a bare one.
 *
 * One piece per SLOT (head · body · hands · face · shoulders — face is THE
 * HEADS, FF1's animals worn in place of the skull, avatar/heads.ts; the
 * shoulders hang off the body group beside the body piece). The equipped
 * set is up to five ids, packed for the wire as a short comma-joined
 * string that every receiver re-validates against this catalogue (unknown
 * id → dropped, one per slot, hard length cap) — the same fail-soft law as
 * THE PAINT's look.
 *
 * Local frames (see avatar/mannequin.ts + avatar/hands.ts): the HEAD group
 * sits at the head centre, front −z, skull radius BODY_IK.headRadius; the
 * BODY group is planted at the hips, +y up, front −z — BODY_RINGS are
 * HALF-extents: the shoulder line at y≈0.395 spans ±0.252, the chest at
 * y≈0.29 is ±0.166 wide and ±0.10 deep, the waist pinch at y≈0.13 is
 * ±0.09 by ±0.074; each HAND group has its palm at the origin, fingers
 * toward −z, the cuff toward +z.
 */

import { BoxGeometry, BufferGeometry, CapsuleGeometry, CatmullRomCurve3, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, IcosahedronGeometry, LatheGeometry, Mesh, MeshStandardMaterial, type Object3D, Quaternion, Shape, SphereGeometry, TorusGeometry, TubeGeometry, Vector2, Vector3 } from 'three';
import { BODY_IK, PAINT } from '../config.js';
import { BODY_RINGS, EGG_SCALE, HEAD_SCALE, type BlankTone } from './mannequin.js';
import { atlasGear, mergePiece } from './gearAtlas.js';
import { HEAD_FIT, HEAD_PIECES, PIECE_FIT } from './heads.js';

/** 'face' is THE HEADS (avatar/heads.ts): a whole head worn in place of
 *  the bare skull. It came after the other three, so it packs after them —
 *  the wire is slot-ordered, and an older reader simply drops an id it
 *  doesn't know. 'shoulders' came last of all: the pads were BODY pieces,
 *  so a pair of pauldrons and a cape could never be worn together. They
 *  are their own slot now, packed last; an older reader still takes a
 *  pauldron as its body piece (it knows the id), and drops the rest. */
export type GearSlot = 'head' | 'body' | 'hands' | 'face' | 'shoulders';
export const GEAR_SLOTS: readonly GearSlot[] = ['head', 'body', 'hands', 'face', 'shoulders'];

export interface GearDef {
  id: string;
  name: string;
  slot: GearSlot;
  /** Coins. */
  price: number;
  /** One line for the tile. */
  blurb: string;
}

/** The catalogue — ids are wire-stable, never renamed. */
export const GEAR: GearDef[] = [
  // ── head ──────────────────────────────────────────────────────────────
  { id: 'crest', name: 'CREST', slot: 'head', price: 60, blurb: 'a dorsal fin, nose to nape' },
  { id: 'antennae', name: 'ANTENNAE', slot: 'head', price: 60, blurb: 'twin whips off the temples' },
  { id: 'horns', name: 'HORNS', slot: 'head', price: 90, blurb: 'a ram\'s pair, curled round' },
  { id: 'halo', name: 'HALO', slot: 'head', price: 150, blurb: 'a ring that floats, no wire' },
  { id: 'mohawk', name: 'MOHAWK', slot: 'head', price: 120, blurb: 'a row of spikes over the crown' },
  { id: 'visorband', name: 'VISOR BAND', slot: 'head', price: 80, blurb: 'a wraparound band across the eyes' },
  // ── body ──────────────────────────────────────────────────────────────
  // (PAULDRONS was the first body piece; it keeps its place in the list —
  // the store's tile ids are the catalogue indices — but wears on the
  // SHOULDERS now.)
  { id: 'pauldrons', name: 'PAULDRONS', slot: 'shoulders', price: 100, blurb: 'plates on both shoulders' },
  { id: 'chestplate', name: 'CHESTPLATE', slot: 'body', price: 120, blurb: 'one plate over the heart' },
  { id: 'tail', name: 'TAIL', slot: 'body', price: 140, blurb: 'swept back off the spine, tip flicked up' },
  { id: 'belt', name: 'BELT', slot: 'body', price: 60, blurb: 'a band round the waist, buckled' },
  // ── hands ─────────────────────────────────────────────────────────────
  { id: 'cuffs', name: 'CUFFS', slot: 'hands', price: 60, blurb: 'a ring at each wrist' },
  { id: 'knuckles', name: 'KNUCKLES', slot: 'hands', price: 120, blurb: 'four spikes over the fist' },
  { id: 'gauntlets', name: 'GAUNTLETS', slot: 'hands', price: 180, blurb: 'a plate over the back of each hand' },
  // ── the second wave — APPENDED, because the store's tile ids are the
  // catalogue indices and the probes (tools/wrap-check.mjs) know CUFFS as
  // the tenth. A new piece goes on the end, never in among its slot. ──
  { id: 'crown', name: 'CROWN', slot: 'head', price: 240, blurb: 'a circlet, six points rising' },
  { id: 'antlers', name: 'ANTLERS', slot: 'head', price: 200, blurb: "a stag's pair, branched" },
  { id: 'wings', name: 'WINGS', slot: 'body', price: 320, blurb: 'swept plates off the shoulder blades' },
  { id: 'claws', name: 'CLAWS', slot: 'hands', price: 200, blurb: 'three talons over the knuckles' },
  // ── the third wave (appended, as ever) ──
  { id: 'spikepads', name: 'SPIKED PADS', slot: 'shoulders', price: 220, blurb: 'layered plates, three spikes a side' },
  // ── the fourth wave ──
  { id: 'vcrest', name: 'V-CREST', slot: 'head', price: 180, blurb: 'twin blades in a V off a brow emblem' },
  { id: 'earfins', name: 'EAR FINS', slot: 'head', price: 140, blurb: 'swept fins at the temples' },
  { id: 'thrusters', name: 'THRUSTERS', slot: 'body', price: 300, blurb: 'a jet pack, two lit nozzles' },
  { id: 'wristblades', name: 'WRIST BLADES', slot: 'hands', price: 220, blurb: 'a blade along each forearm' },
  // ── THE HEADS: FIRE FIGHT 1's animals, back on the blank (avatar/heads.ts).
  // Each replaces the bare skull; ids are the FF1 animals, never the old
  // skin ids (cobalt, crimson…), so nothing from the retired roster aliases.
  { id: 'bear', name: 'BEAR', slot: 'face', price: 400, blurb: 'a domed skull, a short deep muzzle' },
  { id: 'panther', name: 'PANTHER', slot: 'face', price: 400, blurb: 'all cheek, a slanted stare, whiskers' },
  { id: 'eagle', name: 'EAGLE', slot: 'face', price: 450, blurb: 'a hooked beak under a scowling brow' },
  { id: 'knight', name: 'KNIGHT', slot: 'face', price: 350, blurb: 'a great helm, a cross at the sight' },
  { id: 'stallion', name: 'STALLION', slot: 'face', price: 450, blurb: 'a long face, a swept mane' },
  { id: 'wolf', name: 'WOLF', slot: 'face', price: 450, blurb: 'a long muzzle, ears up, a ruff' },
  { id: 'frog', name: 'FROG', slot: 'face', price: 300, blurb: 'a wide flat grin, eyes up top' },
  { id: 'bunny', name: 'BUNNY', slot: 'face', price: 350, blurb: 'tall ears, buck teeth' },
  // ── the fifth wave: THE SHOULDERS get a shelf of their own, and the body
  // two pieces that hang where the pads used to crowd it. ──
  { id: 'warlord', name: 'WARLORD', slot: 'shoulders', price: 380, blurb: 'great domes, a rolled rim, flames rising' },
  { id: 'epaulets', name: 'EPAULETS', slot: 'shoulders', price: 160, blurb: 'dress boards, a fringe over the arm' },
  { id: 'gladiator', name: 'GLADIATOR', slot: 'shoulders', price: 240, blurb: 'one arm armoured, lames stepping down' },
  { id: 'cape', name: 'CAPE', slot: 'body', price: 260, blurb: 'hung from the shoulders, pleated' },
  { id: 'tabard', name: 'TABARD', slot: 'body', price: 200, blurb: 'a panel front and back, cinched' },
  // ── the sixth wave ──
  { id: 'bastion', name: 'BASTION', slot: 'shoulders', price: 280, blurb: 'great smooth domes, a ridge, two tiers' },
];

export function gearDef(id: string): GearDef | undefined {
  return GEAR.find((g) => g.id === id);
}

/** Hard caps: the wire string and what it may carry. */
// Five slots' longest ids joined run to ~50 characters; every relay caps
// the gear string at 64 to match.
const WIRE_MAX = 64;

/**
 * Validate a set of gear ids (any order, any junk) down to at most one KNOWN
 * id per slot, in slot order. Everything the wire brings goes through here.
 */
export function cleanGear(ids: readonly string[] | string | undefined | null): string[] {
  const list = typeof ids === 'string' ? (ids.length > WIRE_MAX ? [] : ids.split(',')) : Array.isArray(ids) ? ids : [];
  const bySlot = new Map<GearSlot, string>();
  for (const raw of list) {
    if (typeof raw !== 'string') continue;
    const def = gearDef(raw.trim());
    if (!def || bySlot.has(def.slot)) continue;
    bySlot.set(def.slot, def.id);
  }
  return GEAR_SLOTS.map((s) => bySlot.get(s)).filter((v): v is string => !!v);
}

/** The wire form: comma-joined slot-ordered ids ('' = bare). */
export function packGear(ids: readonly string[]): string {
  return cleanGear(ids).join(',');
}

/* ── the shapes ──────────────────────────────────────────────────────── */

/** The body's own primer — gear is sold uncoloured, and it matches the
 *  blank it's bolted to (white or onyx). No role tags: immune to every
 *  recolour, like the body itself. */
function primer(tone: BlankTone): MeshStandardMaterial {
  // The body's tone, one finish up: SATIN where the body is matte (white)
  // or gloss where it's satin (onyx). Same colour, so paint and tone
  // still rule; different sheen, so a plate laid on the body reads as a
  // plate and not as a lump of the body.
  return tone === 'white'
    ? new MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.38, metalness: 0.08, envMapIntensity: 1.2 })
    : new MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.22, metalness: 0.45, envMapIntensity: 1.3 });
}

/** THE TRIM — the one other finish a piece may carry: gunmetal on the
 *  white blank, pale steel on the onyx, for a visor's glass, a gauntlet's
 *  ridges. Not a paint surface: the bake leaves it
 *  its own colour, so a dark slit stays dark across a primer plate
 *  instead of vanishing into it. */
function trim(tone: BlankTone): MeshStandardMaterial {
  return tone === 'white'
    ? new MeshStandardMaterial({ color: 0x24262c, roughness: 0.28, metalness: 0.75, envMapIntensity: 1.2 })
    : new MeshStandardMaterial({ color: 0xc8c4bc, roughness: 0.3, metalness: 0.6, envMapIntensity: 1.2 });
}

/** Mark a mesh as trim: it keeps its own material through the paint bake. */
function asTrim<T extends Mesh>(m: T): T {
  m.userData.trim = true;
  return m;
}

/**
 * THE GLOW — the third finish, and the only colour gear carries that the
 * wearer didn't paint: their own ACCENT, the hue they picked for their
 * fighter. One element per piece takes it — a halo's lip, a visor's slit,
 * a feeler's bulbs, a pad's rim — lit, not painted. Tagged
 * `accent: 'glow'`, so setAvatarAccent (avatar/boxer.ts) sets it with the
 * rest of the rig, and applyGear lights a freshly built piece in whatever
 * accent its rig already wears. Never a paint surface.
 */
const GLOW_DEFAULT = 0xff7a18;
function glow(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color: GLOW_DEFAULT, emissive: GLOW_DEFAULT, emissiveIntensity: 1.15, roughness: 0.35, metalness: 0 });
  m.userData.accent = 'glow';
  return m;
}

/** Mark a mesh as glow: lit in the accent, left alone by the paint bake. */
function asGlow<T extends Mesh>(m: T): T {
  m.userData.trim = true;
  m.userData.glow = true;
  return m;
}

/** The accent a rig piece (or any ancestor) was last lit in, if any. */
function accentOf(o: Object3D): number | null {
  for (let p: Object3D | null = o; p; p = p.parent) {
    if (typeof p.userData.accentColor === 'number') return p.userData.accentColor as number;
  }
  return null;
}

/**
 * A tube along a spline whose radius tapers from `r0` at the first point to
 * `r1` at the last — the shape of a horn, a tusk, a whip. three's own
 * TubeGeometry is constant-radius, so this walks a Catmull-Rom curve
 * through `pts`, builds a ring of `sides` vertices at each of `segs`
 * stations (Frenet frames, so the rings follow the bend), caps both ends,
 * and lays UVs u = round the ring, v = along the length so THE PAINT's
 * stripes and dots wrap it like any other piece.
 */
function taperedTube(pts: Vector3[], r0: number, r1: number, segs: number, sides: number): BufferGeometry {
  const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  const p = new Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, p);
    // Ease the taper: fat for the first half, then thinning to the point.
    const k = t < 0.5 ? (t / 0.5) * 0.22 : 0.22 + ((t - 0.5) / 0.5) * 0.78;
    const r = r0 + (r1 - r0) * k;
    const n = frames.normals[i];
    const b = frames.binormals[i];
    for (let j = 0; j <= sides; j++) {
      const a = (j / sides) * Math.PI * 2;
      const cx = Math.cos(a) * r;
      const cy = Math.sin(a) * r;
      pos.push(p.x + n.x * cx + b.x * cy, p.y + n.y * cx + b.y * cy, p.z + n.z * cx + b.z * cy);
      uv.push(j / sides, t);
    }
  }
  // Winding: a Frenet ring runs N → B, and T × dp/dθ points INTO the
  // tube — so the quads are wound the other way round to face out. (They
  // were inside out until the cacti were built on the same loft: a closed
  // tube still shows its far inner wall, so the horns kept their shape,
  // but every normal pointed in and the light sat on the wrong side.)
  const ring = sides + 1;
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < sides; j++) {
      const a = i * ring + j;
      const c = a + ring;
      idx.push(a, a + 1, c, a + 1, c + 1, c);
    }
  }
  // Caps: a centre vertex at each end fanned to its ring.
  const capRoot = pos.length / 3;
  curve.getPointAt(0, p);
  pos.push(p.x, p.y, p.z);
  uv.push(0.5, 0);
  for (let j = 0; j < sides; j++) idx.push(capRoot, j + 1, j);
  const capTip = pos.length / 3;
  curve.getPointAt(1, p);
  pos.push(p.x, p.y, p.z);
  uv.push(0.5, 1);
  const last = segs * ring;
  for (let j = 0; j < sides; j++) idx.push(capTip, last + j, last + j + 1);
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const R = BODY_IK.headRadius;
const UP = new Vector3(0, 1, 0);
const FWD = new Vector3(0, 0, 1);

/* ── the detail kit ──────────────────────────────────────────────────── */
//
// What turns a primitive into a piece of kit: a place it is MOUNTED (a
// collar, a boss, a hinge), EDGES that catch the light (a bevel, a rolled
// rim), and SMALL PARTS in the trim (rivets, bands, studs). Trim is never
// a paint surface, so none of this spends the piece's canvas.

/** The skull the head pieces are modelled on (the old egg, EGG_SCALE ×
 *  R, centred R/20 above the head's origin — mannequin.ts); applyGear
 *  stretches the piece onto the skull it actually gets. */
const EGG = { a: 0.84 * R, b: 1.08 * R, c: 0.93 * R, y0: 0.05 * R };

/** Where a ray from the skull's centre along `dir` leaves it, and the
 *  surface normal there. */
function eggPoint(dir: Vector3): { p: Vector3; n: Vector3 } {
  const d = dir.clone().normalize();
  const t = 1 / Math.sqrt((d.x / EGG.a) ** 2 + (d.y / EGG.b) ** 2 + (d.z / EGG.c) ** 2);
  const p = d.multiplyScalar(t).add(new Vector3(0, EGG.y0, 0));
  const n = new Vector3(p.x / EGG.a ** 2, (p.y - EGG.y0) / EGG.b ** 2, p.z / EGG.c ** 2).normalize();
  return { p, n };
}

/** A point on the skull's midline, `th` radians from the brow (front, −z)
 *  up over the crown to the nape (π, +z), with its normal and the
 *  direction along the midline toward the back. */
function eggMid(th: number): { p: Vector3; n: Vector3; back: Vector3 } {
  const at = eggPoint(new Vector3(0, Math.sin(th), -Math.cos(th)));
  const next = eggPoint(new Vector3(0, Math.sin(th + 0.01), -Math.cos(th + 0.01)));
  return { ...at, back: next.p.sub(at.p).normalize() };
}

/** Orient an object's +y along `dir`. */
function aim(o: Object3D, dir: Vector3): void {
  o.quaternion.setFromUnitVectors(UP, dir.clone().normalize());
}

/** A rivet (a low dome) in the trim, at `at`, domed along `n`. */
/** THE BODY'S SKIN at height `y` (hip-local, BODY_RINGS interpolated as
 *  the loft interpolates them): half-width, half-depth, fore/aft centre —
 *  or null above the neck, where there is no body to meet. */
function skinAt(y: number): { w: number; d: number; z: number } | null {
  const R = BODY_RINGS;
  return y > R[0].y || y < R[R.length - 1].y ? null : bodyRing(y);
}

/**
 * SEAT a body piece ON the body: bake the mesh's placement into its
 * geometry (body-local — body gear hangs at the body group's origin), and
 * push every vertex that falls inside the loft, or within `gap` of it,
 * straight out from the spine to `gap` above the skin. The outside of the
 * piece keeps its shape; only what would have been buried is moved, so
 * the piece meets the body instead of vanishing into it.
 */
function seatOnBody(mesh: Mesh, gap: number): void {
  mesh.updateMatrix();
  const geo = mesh.geometry;
  geo.applyMatrix4(mesh.matrix);
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.scale.set(1, 1, 1);
  const pos = geo.getAttribute('position');
  const v = new Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    if (seatPoint(v, gap)) pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

/** seatOnBody's push for ONE body-local point, in place — so a rim or a
 *  strap laid along a seated edge can follow it. True if it moved. */
function seatPoint(v: Vector3, gap: number): boolean {
  const skin = skinAt(v.y);
  if (!skin) return false;
  const dz = v.z - skin.z;
  const q = Math.hypot(v.x / skin.w, dz / skin.d);
  const want = 1 + gap / ((skin.w + skin.d) / 2);
  // A SOFT floor (softplus), not a clamp: a clamp leaves a jagged notch
  // where the pushed and unpushed vertices meet along the rim; this
  // eases the piece onto the skin over a short band instead.
  const band = 0.07;
  if (q >= want + band * 5 || q < 1e-6) return false;
  const k = (want + band * Math.log1p(Math.exp((q - want) / band))) / q;
  v.set(v.x * k, v.y, skin.z + dz * k);
  return true;
}

function rivet(trimMat: MeshStandardMaterial, at: Vector3, n: Vector3, r: number): Mesh {
  const m = asTrim(new Mesh(new SphereGeometry(r, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), trimMat));
  m.position.copy(at);
  aim(m, n);
  return m;
}

/** A ring round a tube at `at`, its hole along `axis` — a band, a collar. */
function collar(trimMat: MeshStandardMaterial, at: Vector3, axis: Vector3, r: number, tube: number): Mesh {
  const m = asTrim(new Mesh(new TorusGeometry(r, tube, 6, 20), trimMat));
  m.position.copy(at);
  m.quaternion.setFromUnitVectors(FWD, axis.clone().normalize());
  return m;
}

/** The same curve and taper taperedTube builds from `pts`, sampled at `t`:
 *  the point, the tangent, the radius. */
function tubeAt(pts: Vector3[], r0: number, r1: number, t: number): { p: Vector3; tan: Vector3; r: number } {
  const curve = new CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  const k = t < 0.5 ? (t / 0.5) * 0.22 : 0.22 + ((t - 0.5) / 0.5) * 0.78;
  return { p: curve.getPointAt(t), tan: curve.getTangentAt(t), r: r0 + (r1 - r0) * k };
}

/** Trim bands round a tapered tube at each of `ts`. */
function tubeBands(trimMat: MeshStandardMaterial, pts: Vector3[], r0: number, r1: number, ts: number[], thick = 0.16, snug = 1.04): Mesh[] {
  return ts.map((t) => {
    const at = tubeAt(pts, r0, r1, t);
    return collar(trimMat, at.p, at.tan, at.r * snug, at.r * thick);
  });
}

/** A rounded rectangle, CCW in (r, y) — a lathe profile. */
function roundRectProfile(r0: number, r1: number, y0: number, y1: number, c: number): Vector2[] {
  const pts: Vector2[] = [];
  const arc = (cx: number, cy: number, a0: number): void => {
    for (let i = 0; i <= 3; i++) {
      const a = a0 + (i / 3) * (Math.PI / 2);
      pts.push(new Vector2(cx + Math.cos(a) * c, cy + Math.sin(a) * c));
    }
  };
  arc(r1 - c, y1 - c, 0); // outer top
  arc(r0 + c, y1 - c, Math.PI / 2); // inner top
  arc(r0 + c, y0 + c, Math.PI); // inner bottom
  arc(r1 - c, y0 + c, Math.PI * 1.5); // outer bottom
  pts.push(pts[0].clone());
  return pts;
}

/** A flat plate of outline `shape`, `depth` thick with eased edges, centred
 *  on its own thickness — flagged for the atlas's facing split. */
function plate(shape: Shape, depth: number, bevel: number, mat: MeshStandardMaterial): Mesh {
  const geo = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 12,
  });
  geo.translate(0, 0, -depth / 2);
  const m = new Mesh(geo, mat);
  m.userData.atlasSplit = true;
  return m;
}

/** Place `o` at `at` with its +z along `n` and its +y kept upright. */
function face(o: Object3D, at: Vector3, n: Vector3): void {
  o.position.copy(at);
  o.lookAt(at.clone().add(n));
}

/** An outline from a list of [x, y] points, straight segments. */
function outline(pts: Array<[number, number]>): Shape {
  const sh = new Shape();
  sh.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) sh.lineTo(x, y);
  sh.closePath();
  return sh;
}

/** A rounded rectangle outline, centred, w × h. */
function roundRect(w: number, h: number, c: number): Shape {
  const sh = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  sh.moveTo(x + c, y);
  sh.lineTo(x + w - c, y);
  sh.quadraticCurveTo(x + w, y, x + w, y + c);
  sh.lineTo(x + w, y + h - c);
  sh.quadraticCurveTo(x + w, y + h, x + w - c, y + h);
  sh.lineTo(x + c, y + h);
  sh.quadraticCurveTo(x, y + h, x, y + h - c);
  sh.lineTo(x, y + c);
  sh.quadraticCurveTo(x, y, x + c, y);
  return sh;
}

/** The body's ring at hip-local height y — the same surface the
 *  mannequin's loft draws (BODY_RINGS, linear between rings). */
function bodyRing(y: number): { w: number; d: number; z: number } {
  const R = BODY_RINGS; // top → down
  if (y >= R[0].y) return { w: R[0].w, d: R[0].d, z: R[0].z ?? 0 };
  for (let i = 0; i < R.length - 1; i++) {
    const a = R[i];
    const b = R[i + 1];
    if (y <= a.y && y >= b.y) {
      const f = (a.y - y) / (a.y - b.y);
      return { w: a.w + (b.w - a.w) * f, d: a.d + (b.d - a.d) * f, z: (a.z ?? 0) + ((b.z ?? 0) - (a.z ?? 0)) * f };
    }
  }
  const e = R[R.length - 1];
  return { w: e.w, d: e.d, z: e.z ?? 0 };
}

/**
 * ONE SHOULDER'S SHELL — the pad PAULDRONS and SPIKED PADS are both made
 * from: one smooth dome tipped down over the arm (the first cut's shape,
 * the one people liked), SEATED so whatever part of it would sit inside
 * the body eases out onto the skin (seatOnBody) — its inside edge rests on
 * the slope to the neck instead of diving into the trapezius. `k` scales
 * the dome; `spikes` drives three spikes up through it, each along the
 * dome's own normal from a trim collar: the big one off the top leaning
 * out over the arm, a smaller one fore and aft.
 */
function shellPad(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, s: 1 | -1, k: number, spikes: boolean): Group {
  const g = new Group();
  // The dome's half-extents (a sphere of 0.1 scaled 1.1 · 0.8 · 1.05).
  const a = 0.11 * k;
  const b = 0.08 * k;
  const c = 0.105 * k;
  const pad = new Mesh(new SphereGeometry(0.1, 48, 28, 0, Math.PI * 2, 0, Math.PI * 0.55), mat);
  pad.scale.set(a / 0.1, b / 0.1, c / 0.1);
  // A whisker further out and a touch less tipped than the first cut, so
  // there is less of it to seat — the shape reads the same. A bigger dome
  // rides a little higher so it grows up and out, not into the chest.
  pad.position.set(s * (0.222 + (k - 1) * 0.04), 0.385 + (k - 1) * 0.04, 0);
  pad.rotation.z = -s * 0.4;
  pad.updateMatrix();
  // Spike seats, found on the dome BEFORE it is seated: they are all high
  // on its outer face, which the seating leaves where it is.
  const seats: Array<{ p: Vector3; n: Vector3; len: number }> = [];
  if (spikes) {
    const spec: Array<[number, number, number, number]> = [
      // dome-local direction (x out over the arm, y up, z back), length
      [s * 0.05, 1, 0, 0.1],
      [s * 0.15, 0.85, -0.6, 0.07],
      [s * 0.15, 0.85, 0.6, 0.07],
    ];
    const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), pad.rotation.z);
    for (const [dx, dy, dz, len] of spec) {
      const dir = new Vector3(dx, dy, dz).normalize();
      const t = 1 / Math.sqrt((dir.x / a) ** 2 + (dir.y / b) ** 2 + (dir.z / c) ** 2);
      const p = dir.clone().multiplyScalar(t);
      const n = new Vector3(p.x / (a * a), p.y / (b * b), p.z / (c * c)).normalize().applyQuaternion(rot);
      seats.push({ p: p.applyQuaternion(rot).add(pad.position), n, len });
    }
  }
  seatOnBody(pad, 0.004);
  g.add(pad);
  for (const { p, n, len } of seats) {
    const q = new Quaternion().setFromUnitVectors(UP, n);
    const L = len * k;
    const spike = new Mesh(new ConeGeometry(0.014 * k, L, 16), mat);
    spike.quaternion.copy(q);
    spike.position.copy(p).addScaledVector(n, L / 2 - 0.003);
    g.add(spike);
    const collar = asTrim(new Mesh(new TorusGeometry(0.0155 * k, 0.0035 * k, 8, 20), trimMat));
    collar.quaternion.copy(q).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2));
    collar.position.copy(p).addScaledVector(n, 0.002);
    g.add(collar);
  }
  return g;
}

/** A feather-blade outline, root at the origin, tip at +x (mirrored for
 *  s = −1): full near the root, tapering to a point that lifts a hair. */
function bladeShape(len: number, w: number, s: 1 | -1): Shape {
  const sh = new Shape();
  const X = (x: number): number => x * s;
  sh.moveTo(X(0), -w * 0.32);
  sh.quadraticCurveTo(X(len * 0.2), -w * 0.56, X(len * 0.62), -w * 0.34);
  sh.quadraticCurveTo(X(len * 0.9), -w * 0.18, X(len), w * 0.08);
  sh.quadraticCurveTo(X(len * 0.72), w * 0.5, X(len * 0.2), w * 0.5);
  sh.quadraticCurveTo(X(len * 0.04), w * 0.46, X(0), w * 0.3);
  sh.closePath();
  return sh;
}

type Builder = (mat: MeshStandardMaterial, side: 1 | -1, trim: MeshStandardMaterial, glow: MeshStandardMaterial) => Group;

const BUILDERS: Record<string, Builder> = {
  /* head — origin at the head centre, front −z. Modelled on the old EGG
   * skull, R×(0.84, 1.08, 0.93) (mannequin.ts EGG_SCALE); applyGear
   * stretches the whole piece onto whatever the skull is now. */
  crest: (mat, _side, trimMat, glowMat) => {
    // ONE FIN, sculpted: its foot follows the skull's midline from the
    // brow over the crown to the nape, its crest rises off the brow,
    // peaks behind the crown and sweeps down the back, and the back half
    // is SERRATED — a saw of teeth, not a smooth curve. A centimetre
    // thick with eased edges, standing on a rolled rail of trim. (It was
    // eleven boxes in a stepped row and read like a fan of cards.)
    const g = new Group();
    const N = 26;
    const th0 = 0.55;
    const th1 = 2.78;
    const foot: Vector3[] = [];
    const top: Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const { p, n } = eggMid(th0 + (th1 - th0) * t);
      foot.push(p.clone().addScaledVector(n, -0.04 * R));
      let h = R * (0.08 + 0.5 * Math.sin(Math.PI * Math.pow(t, 0.75)));
      // THE TEETH: every other station on the back half drops, and slips
      // back along the skull, so each tooth rakes toward the nape.
      const tooth = t > 0.4 && i % 2 === 1;
      if (tooth) h *= 0.7;
      const q = p.clone().addScaledVector(n, h);
      if (tooth) q.addScaledVector(eggMid(th0 + (th1 - th0) * t).back, 0.05 * R);
      top.push(q);
    }
    // The outline in the fin's own plane (x = z, y = y), foot then crest.
    const sh = new Shape();
    sh.moveTo(foot[0].z, foot[0].y);
    for (const q of top) sh.lineTo(q.z, q.y);
    for (let i = N; i >= 0; i--) sh.lineTo(foot[i].z, foot[i].y);
    const fin = plate(sh, R * 0.07, R * 0.014, mat);
    fin.rotation.y = -Math.PI / 2; // the plane's x onto z; its thickness across the head
    g.add(fin);
    const rail: Vector3[] = [];
    for (let i = 0; i <= N; i++) {
      const m = eggMid(th0 + ((th1 - th0) * i) / N);
      rail.push(m.p.addScaledVector(m.n, 0.012 * R));
    }
    g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(rail), 48, 0.05 * R, 8), trimMat)));
    // THE GLOW: a lit inlay run through the fin, below its teeth, showing
    // on both faces.
    const inlay: Vector3[] = [];
    for (let i = 2; i <= N - 2; i++) {
      const t = i / N;
      const { p, n } = eggMid(th0 + (th1 - th0) * t);
      inlay.push(p.clone().addScaledVector(n, R * (0.02 + 0.3 * Math.sin(Math.PI * Math.pow(t, 0.75)))));
    }
    g.add(asGlow(new Mesh(new TubeGeometry(new CatmullRomCurve3(inlay), 40, 0.062 * R, 6), glowMat)));
    return g;
  },
  antennae: (mat, _side, trimMat, glowMat) => {
    // A pair of FEELERS: each rises from a trim boss on the temple, a
    // tapered stalk that bows up, out and forward, banded twice in trim,
    // ending in a faceted bulb on a collar. (They were straight sticks
    // with a ball on the end.)
    const g = new Group();
    for (const s of [-1, 1] as const) {
      const { p, n } = eggPoint(new Vector3(s * 0.72, 0.66, -0.12));
      const boss = asTrim(new Mesh(new CylinderGeometry(0.1 * R, 0.13 * R, 0.08 * R, 16), trimMat));
      boss.position.copy(p).addScaledVector(n, 0.015 * R);
      aim(boss, n);
      g.add(boss);
      const pts = [
        p.clone().addScaledVector(n, 0.02 * R),
        p.clone().add(new Vector3(s * 0.14 * R, 0.36 * R, 0)),
        new Vector3(s * 0.98 * R, 1.25 * R, -0.1 * R),
        new Vector3(s * 1.18 * R, 1.72 * R, -0.32 * R),
      ];
      const r0 = 0.05 * R;
      const r1 = 0.02 * R;
      g.add(new Mesh(taperedTube(pts, r0, r1, 26, 10), mat));
      for (const band of tubeBands(trimMat, pts, r0, r1, [0.3, 0.62])) g.add(band);
      const tip = tubeAt(pts, r0, r1, 1);
      g.add(collar(trimMat, tip.p, tip.tan, 0.035 * R, 0.014 * R));
      const bulb = asGlow(new Mesh(new IcosahedronGeometry(0.13 * R, 1), glowMat)); // the lit bulbs
      bulb.position.copy(tip.p).addScaledVector(tip.tan, 0.1 * R);
      g.add(bulb);
    }
    return g;
  },
  horns: (mat, _side, _trimMat, glowMat) => {
    // THE RAM'S CURL. Each horn is ONE tapered tube along a spline: it
    // roots thick at the temple, climbs out and up, rolls BACK over the
    // ear, drops behind the jaw and sweeps FORWARD again so the point
    // ends level with the eye, just wide of the cheek — the full curl of
    // a ram seen side-on. Seven flat-shaded facets round, so it reads as
    // carved plate like the rest of the kit, not a smooth banana. (The
    // old pair were three stubby cylinders bent back like a bull's.)
    //
    // The wearer never SEES their own: applyGear skips the head slot on a
    // rig flagged first-person (below), and the arena never renders the
    // local head at all — a curl this size would otherwise hang in the
    // corner of both eyes for the whole bout.
    const g = new Group();
    const faceted = mat.clone();
    faceted.flatShading = true;
    for (const s of [-1, 1]) {
      const pts = [
        [0.7, 0.42, -0.02], // the root, on the temple
        [1.22, 0.92, 0.14], // out and up, thick
        [1.66, 1.02, 0.7], // rolling back over the ear
        [1.9, 0.5, 1.12], // the back of the curl, well wide of the skull
        [1.92, -0.22, 1.02], // dropping behind the jaw
        [1.82, -0.62, 0.5], // the low turn
        [1.8, -0.66, -0.2], // sweeping forward past the cheek
        [1.96, -0.48, -0.74], // the point, forward of the face, wide
        [2.08, -0.36, -1.02], // the tip lifting a hair
      ].map(([x, y, z]) => new Vector3(s * x * R, y * R, z * R));
      g.add(new Mesh(taperedTube(pts, R * 0.44, R * 0.05, 34, 7), faceted));
      // Two bands of trim just out from the root, where a horn is bound.
      for (const band of tubeBands(glowMat, pts, R * 0.44, R * 0.05, [0.13, 0.2], 0.09, 1.0)) g.add(band); // lit bindings
      // A boss where the horn meets the skull, so the root reads as seated.
      const boss = new Mesh(new SphereGeometry(R * 0.46, 9, 7), faceted);
      boss.position.copy(pts[0]);
      boss.scale.set(1, 0.9, 1.05);
      g.add(boss);
    }
    return g;
  },
  halo: (mat, _side, trimMat, glowMat) => {
    // A BAND of light's metal, not a wire: a flat ring with a rounded
    // section, tipped back a little, a lip of trim round its inside edge
    // and twelve studs round its top.
    const g = new Group();
    const r0 = 0.7 * R;
    const r1 = 0.9 * R;
    const ring = new Mesh(new LatheGeometry(roundRectProfile(r0, r1, -0.03 * R, 0.03 * R, 0.022 * R), 48), mat);
    g.add(ring);
    const lip = asGlow(new Mesh(new TorusGeometry(r0, 0.022 * R, 5, 48), glowMat)); // the lit inner edge
    lip.rotation.x = Math.PI / 2;
    g.add(lip);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const at = new Vector3(Math.sin(a) * (r0 + r1) * 0.5, 0.03 * R, Math.cos(a) * (r0 + r1) * 0.5);
      g.add(rivet(trimMat, at, UP, 0.03 * R));
    }
    g.position.y = R * 1.5;
    g.rotation.x = 0.15; // the front a touch higher: tipped back
    return g;
  },
  mohawk: (mat, _side, _trimMat, glowMat) => {
    // A row of BLADES down the midline: seven flattened spikes, thin side
    // to side and raked back, tallest over the crown, each set into a
    // rolled rail of trim. (They were round cones standing bolt upright.)
    const g = new Group();
    const th0 = 0.85;
    const th1 = 2.55;
    const rail: Vector3[] = [];
    for (let i = 0; i <= 20; i++) {
      const m = eggMid(th0 + ((th1 - th0) * i) / 20);
      rail.push(m.p.addScaledVector(m.n, 0.012 * R));
    }
    // The rail the blades are set in is the lit part.
    g.add(asGlow(new Mesh(new TubeGeometry(new CatmullRomCurve3(rail), 40, 0.06 * R, 8), glowMat)));
    const count = 7;
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const { p, n, back } = eggMid(th0 + 0.08 + (th1 - th0 - 0.16) * t);
      const h = R * (0.42 + 0.42 * Math.sin(Math.PI * (0.15 + 0.7 * t)));
      const dir = n.clone().addScaledVector(back, 0.5).normalize();
      const blade = new Mesh(new ConeGeometry(0.13 * R, h, 6), mat);
      blade.scale.set(0.38, 1, 1); // flat across the head, long fore and aft
      aim(blade, dir);
      blade.position.copy(p).addScaledVector(dir, h / 2 - 0.03 * R);
      g.add(blade);
    }
    return g;
  },
  visorband: (mat, _side, trimMat, glowMat) => {
    // A VISOR: a thick wraparound lens across the eyes — its section
    // swells in the middle and eases to rounded edges, so it has a real
    // edge to catch the light — hinged at each temple on a trim disc,
    // with a slit of dark glass across the front. (It was a flat strip
    // of cylinder that read as a headband.)
    const g = new Group();
    const arc = Math.PI * 1.1;
    const phi0 = Math.PI - arc / 2;
    const lens = [
      new Vector2(1.0 * R, -0.17 * R),
      new Vector2(1.045 * R, -0.12 * R),
      new Vector2(1.068 * R, 0),
      new Vector2(1.045 * R, 0.12 * R),
      new Vector2(1.0 * R, 0.17 * R),
      new Vector2(0.965 * R, 0.15 * R),
      new Vector2(0.955 * R, 0),
      new Vector2(0.965 * R, -0.15 * R),
      new Vector2(1.0 * R, -0.17 * R),
    ];
    const body = new Mesh(new LatheGeometry(lens, 48, phi0, arc), mat);
    g.add(body);
    // The slit is the lit part: the visor's eye.
    const glassMat = glowMat.clone();
    glassMat.side = DoubleSide;
    const glass = asGlow(new Mesh(new CylinderGeometry(1.071 * R, 1.071 * R, 0.085 * R, 44, 1, true, Math.PI - arc * 0.4, arc * 0.8), glassMat));
    g.add(glass);
    for (const phi of [phi0, phi0 + arc]) {
      const hinge = asTrim(new Mesh(new CylinderGeometry(0.15 * R, 0.15 * R, 0.07 * R, 20), trimMat));
      hinge.position.set(Math.sin(phi) * 1.0 * R, 0, Math.cos(phi) * 1.0 * R);
      aim(hinge, new Vector3(Math.cos(phi), 0, -Math.sin(phi)));
      g.add(hinge);
      const bolt = rivet(trimMat, hinge.position.clone().addScaledVector(new Vector3(Math.cos(phi), 0, -Math.sin(phi)), 0.035 * R), new Vector3(Math.cos(phi), 0, -Math.sin(phi)), 0.05 * R);
      g.add(bolt);
    }
    // Fitted to the egg's oval, sat just below the brow.
    g.scale.set(0.9, 1, 1.02);
    g.position.set(0, R * 0.1, -R * 0.02);
    return g;
  },

  /* body — origin at the hips, +y up, front −z, shoulders at (±0.126, 0.395) */
  pauldrons: (mat, _side, trimMat) => {
    // THE SHELLS: one smooth seated dome per shoulder (shellPad).
    const g = new Group();
    for (const s of [-1, 1] as const) g.add(shellPad(mat, trimMat, s, 1, false));
    return g;
  },
  chestplate: (mat, _side, trimMat, glowMat) => {
    const g = new Group();
    // A shell LOFTED over the chest's own profile (the body's ring table,
    // shoulder line to waist), pushed a whisker proud of the surface and
    // spanning the front ±62° — so it sits ON the body like a plate,
    // never pokes through it like a ball.
    const rows: Array<[number, number, number, number]> = [
      // y, half-width, half-depth, z-offset (BODY_RINGS, mannequin.ts)
      [0.2, 0.105, 0.082, 0],
      [0.23, 0.124, 0.09, 0],
      [0.29, 0.166, 0.1, 0],
      [0.35, 0.226, 0.098, 0],
      [0.385, 0.244, 0.09, 0],
      [0.41, 0.19, 0.08, -0.006],
    ];
    const cols = 12;
    const span = Math.PI * 0.6; // ±54°
    const pos: number[] = [];
    const idx: number[] = [];
    rows.forEach(([y, hw, hd, zo], r) => {
      for (let c = 0; c <= cols; c++) {
        const th = -span / 2 + (c / cols) * span;
        // Proud by 16 mm, a touch more at the centre so the plate crowns
        // and throws an edge shadow onto the body beneath it.
        const proud = 1 + 0.018 / hd + 0.06 * Math.cos(th);
        pos.push(Math.sin(th) * hw * proud, y, -Math.cos(th) * hd * proud + zo);
        if (r < rows.length - 1 && c < cols) {
          const i0 = r * (cols + 1) + c;
          const i1 = i0 + cols + 1;
          idx.push(i0, i1, i0 + 1, i0 + 1, i1, i1 + 1);
        }
      }
    });
    // The plate's THICKNESS: a second, inner skin 12 mm behind the outer
    // one, and a wall of quads joining their rims — a closed slab that
    // casts a real edge. Three islands for THE PAINT's atlas (outer skin,
    // inner skin, the walls on vertices of their own), each with UVs laid
    // across its grid, so the plate can be painted like any other piece.
    const inner: number[] = [];
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i];
      const y = pos[i + 1];
      const z = pos[i + 2];
      const len = Math.hypot(x, z) || 1;
      inner.push(x - (x / len) * 0.012, y, z - (z / len) * 0.012);
    }
    const n = pos.length / 3;
    const rowsN = rows.length;
    const gridUv: number[] = [];
    for (let r = 0; r < rowsN; r++) for (let c = 0; c <= cols; c++) gridUv.push(c / cols, r / (rowsN - 1));
    const all = [...pos, ...inner];
    const uvs = [...gridUv, ...gridUv];
    const outerTri = idx;
    const innerTri = idx.map((i) => i + n).reverse();
    // Side walls around the outline, each quad on four fresh vertices.
    const wallTri: number[] = [];
    let run = 0;
    const wall = (a0: number, a1: number): void => {
      const base = all.length / 3;
      for (const v of [a0, a1, a0 + n, a1 + n]) all.push(all[v * 3], all[v * 3 + 1], all[v * 3 + 2]);
      uvs.push(run, 0, run + 1, 0, run, 1, run + 1, 1);
      run += 1;
      wallTri.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    };
    for (let c = 0; c < cols; c++) {
      wall(c + 1, c); // bottom edge (y = rows[0])
      const top = (rowsN - 1) * (cols + 1);
      wall(top + c, top + c + 1); // top edge
    }
    for (let r = 0; r < rowsN - 1; r++) {
      wall(r * (cols + 1), (r + 1) * (cols + 1)); // left column
      wall((r + 1) * (cols + 1) + cols, r * (cols + 1) + cols); // right column
    }
    for (let i = uvs.length - run * 8; i < uvs.length; i += 2) uvs[i] /= run; // walls: one strip, 0..1
    const slab = new BufferGeometry();
    slab.setAttribute('position', new Float32BufferAttribute(all, 3));
    slab.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
    slab.setIndex([...outerTri, ...innerTri, ...wallTri]);
    slab.addGroup(0, outerTri.length, 0);
    slab.addGroup(outerTri.length, innerTri.length, 0);
    slab.addGroup(outerTri.length + innerTri.length, wallTri.length, 0);
    slab.computeVertexNormals();
    const slabMat = mat.clone();
    slabMat.side = DoubleSide; // the hand-wound slab must never cull itself away
    g.add(new Mesh(slab, slabMat));
    // The plate was the body's own white laid on the body's own white, and
    // read as nothing but its edge. A roll of TRIM round all four edges
    // draws its outline; the face stays clean — one open plate to paint.
    const along = (row: number | null, col: number | null, out: number): Vector3[] => {
      const pts: Vector3[] = [];
      const count = row !== null ? cols + 1 : rowsN;
      for (let i = 0; i < count; i++) {
        const v = row !== null ? row * (cols + 1) + i : i * (cols + 1) + (col as number);
        const x = pos[v * 3];
        const z = pos[v * 3 + 2];
        const len = Math.hypot(x, z) || 1;
        pts.push(new Vector3(x + (x / len) * out, pos[v * 3 + 1], z + (z / len) * out));
      }
      return pts;
    };
    // All four edges: a frame, so the plate's outline reads from any side.
    const edges: Vector3[][] = [along(0, null, 0.002), along(rowsN - 1, null, 0.002), along(null, 0, 0.002), along(null, cols, 0.002)];
    for (const pts of edges) {
      g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(pts), pts.length * 3, 0.0055, 6), trimMat)));
    }
    // THE CORE: a lit disc set into the plate over the sternum, in a trim
    // bezel — the plate's heart.
    const coreAt = along(3, null, 0.004)[cols / 2];
    const out = new Vector3(coreAt.x, 0, coreAt.z).normalize();
    const bezel = asTrim(new Mesh(new CylinderGeometry(0.024, 0.026, 0.006, 24), trimMat));
    bezel.position.copy(coreAt);
    aim(bezel, out);
    g.add(bezel);
    const core = asGlow(new Mesh(new CylinderGeometry(0.017, 0.017, 0.004, 24), glowMat));
    core.position.copy(coreAt).addScaledVector(out, 0.002);
    aim(core, out);
    g.add(core);
    return g;
  },
  tail: (mat, _side, _trimMat, glowMat) => {
    // A TAIL, where a dorsal ridge used to be. ONE tapered tube along a
    // spline (the horns' own taperedTube), rooted INSIDE the small of the
    // back so it grows out of the surface with no seam and no boss to
    // mark the join, swept back and down, and tapering all the way to a
    // POINT. Flat shaded, so the facets segment it like plate.
    //
    // The ridge it replaces was invisible in play. It sat a 24 mm strip
    // along the spine positioned from BODY_RINGS' half-depths alone —
    // but the upper rings carry a forward `z` lean (the trapezius meets
    // the neck ahead of the chest), so the top plates were placed behind
    // where the back actually is and the whole piece read as nothing.
    // A tail hangs off the silhouette instead, where it cannot hide.
    const g = new Group();
    const faceted = mat.clone();
    faceted.flatShading = true;
    const pts = [
      [0, 0.132, 0.040], // the root, sunk INSIDE the small of the back
      [0, 0.116, 0.108],
      [0, 0.076, 0.196],
      [0, 0.016, 0.280],
      [0, -0.054, 0.338],
      [0, -0.104, 0.380],
      [0, -0.108, 0.430], // the flick
      [0, -0.072, 0.466],
    ].map(([x, y, z]) => new Vector3(x, y, z));
    // 1.5 mm at the tip: a point at any distance you will ever see it from,
    // without the degenerate ring a true zero would leave for the normals.
    g.add(new Mesh(taperedTube(pts, 0.046, 0.0015, 34, 7), faceted));
    // Segmented by three bands of trim down its length, and tipped with a
    // flat BLADE — the devil's arrowhead — along the flick.
    for (const band of tubeBands(glowMat, pts, 0.046, 0.0015, [0.2, 0.38, 0.56], 0.14, 1.0)) g.add(band); // lit
    const tip = tubeAt(pts, 0.046, 0.0015, 0.97);
    const blade = new Mesh(new ConeGeometry(0.024, 0.06, 4), faceted);
    blade.scale.set(1, 1, 0.3);
    aim(blade, tip.tan);
    blade.position.copy(tip.p).addScaledVector(tip.tan, 0.024);
    g.add(blade);
    return g;
  },
  belt: (mat, _side, trimMat, glowMat) => {
    // A BAND round the waist, not a hoop: an open ring the shape of the
    // waist pinch itself (BODY_RINGS: ±0.090 by ±0.074 at y 0.13) set a
    // centimetre proud, flaring a touch to the hips, with a rolled edge
    // top and bottom and a buckle — a trim frame round a primer plate —
    // on the front. (It was a torus scaled to an ellipse: from anywhere
    // but square on it read as a hula hoop.)
    const g = new Group();
    const W = 0.101;
    const D = 0.085;
    const band = new Mesh(new CylinderGeometry(1, 1.035, 0.034, 56, 1, true), mat);
    band.scale.set(W, 1, D);
    band.position.y = 0.13;
    g.add(band);
    for (const [y, k] of [[0.147, 1.0], [0.113, 1.035]] as const) {
      const edge = new Mesh(new TorusGeometry(1, 0.0042 / W, 6, 56), mat);
      edge.rotation.x = Math.PI / 2;
      edge.scale.set(W * k, D * k, W);
      edge.position.y = y;
      g.add(edge);
    }
    const frame = asTrim(new Mesh(new BoxGeometry(0.042, 0.032, 0.008), trimMat));
    frame.position.set(0, 0.13, -D - 0.004);
    g.add(frame);
    const buckle = asGlow(new Mesh(new BoxGeometry(0.03, 0.02, 0.004), glowMat)); // the lit buckle
    buckle.position.set(0, 0.13, -D - 0.009);
    g.add(buckle);
    return g;
  },
  /* hands — palm at the origin, fingers −z, cuff +z (hands.ts) */
  cuffs: (mat, _side, trimMat, glowMat) => {
    // A BRACER round the wrist: a short band with a squared, rounded
    // section (lathed), flattened to the hand's own wrist, rolled edges of
    // trim either side and four rivets round its face. (It was a torus —
    // a bangle.)
    const g = new Group();
    const bracer = new Group();
    bracer.add(new Mesh(new LatheGeometry(roundRectProfile(0.039, 0.047, -0.014, 0.014, 0.004), 28), mat));
    for (const y of [-0.0125, 0.0125]) {
      const edge = asTrim(new Mesh(new TorusGeometry(0.0468, 0.0026, 5, 28), trimMat));
      edge.rotation.x = Math.PI / 2;
      edge.position.y = y;
      bracer.add(edge);
    }
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      const out = new Vector3(Math.sin(a), 0, Math.cos(a));
      bracer.add(asGlow(rivet(glowMat, out.clone().multiplyScalar(0.047), out, 0.0036))); // lit studs
    }
    bracer.rotation.x = Math.PI / 2; // the lathe's axis along the arm
    bracer.scale.set(1, 1, 0.62); // flattened top to bottom, like a wrist
    bracer.position.z = 0.085;
    g.add(bracer);
    return g;
  },
  knuckles: (mat, side, _trimMat, glowMat) => {
    // A KNUCKLE-DUSTER: a bar across the knuckles, a spike rising off it
    // over each, each spike set in a trim collar. (They were four cones
    // floating over the fingers.)
    const g = new Group();
    const bar = new Mesh(new CapsuleGeometry(0.0078, 0.062, 4, 12), mat);
    bar.rotation.z = Math.PI / 2;
    bar.position.set(0, 0.016, -0.046);
    g.add(bar);
    for (let i = 0; i < 4; i++) {
      const x = side * (0.0285 - i * 0.019);
      const spike = new Mesh(new ConeGeometry(0.0068, 0.03, 8), mat);
      spike.position.set(x, 0.016 + 0.0078 + 0.013, -0.046);
      g.add(spike);
      g.add(asGlow(collar(glowMat, new Vector3(x, 0.016 + 0.0074, -0.046), UP, 0.0072, 0.0019))); // lit collars
    }
    return g;
  },
  gauntlets: (mat, _side, trimMat, glowMat) => {
    // A GAUNTLET, not a tile balanced on the hand: a back plate hugging
    // the top of the palm (palm block is 0.078 × 0.024 × 0.09, top face
    // at y = 0.012), three knuckle ridges across its leading edge, and a
    // flared cuff round the wrist behind it.
    const g = new Group();
    // The back plate: a rounded rectangle with eased edges (it was a box).
    const back = plate(roundRect(0.084, 0.082, 0.014), 0.006, 0.0022, mat);
    back.rotation.x = -Math.PI / 2; // lying flat on the back of the hand
    back.position.set(0, 0.0165, 0.006);
    g.add(back);
    // Three ridges across its leading edge, rolled, not boxed.
    for (let i = 0; i < 3; i++) {
      const ridge = asGlow(new Mesh(new CapsuleGeometry(0.0036, 0.076, 3, 8), glowMat)); // lit ridges
      ridge.rotation.z = Math.PI / 2;
      ridge.position.set(0, 0.0235, -0.024 + i * 0.017);
      g.add(ridge);
    }
    // A rivet at each back corner.
    for (const x of [-0.033, 0.033]) g.add(rivet(trimMat, new Vector3(x, 0.0215, 0.036), UP, 0.0032));
    // The cuff: a short frustum open at both ends, wider toward the arm.
    // FITTED to the wrist: flattened top to bottom (its local z is the
    // hand's vertical once it is laid along the arm) so it hugs the
    // hand's own cuff box, 0.07 × 0.032, instead of hanging round it as
    // a dark hoop twice its height.
    const cuff = asTrim(new Mesh(new CylinderGeometry(0.04, 0.045, 0.03, 28, 1, true), trimMat));
    cuff.material = trimMat.clone();
    (cuff.material as MeshStandardMaterial).side = DoubleSide;
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0.0, 0.07);
    cuff.scale.set(1, 1, 0.5);
    g.add(cuff);
    return g;
  },
};

/* ── the second wave ─────────────────────────────────────────────────── */

const MORE_BUILDERS: Record<string, Builder> = {
  crown: (mat, _side, trimMat, glowMat) => {
    // A circlet on the brow — the band in the trim, so it reads as a ring
    // of metal round the skull — with six points rising off it, the one
    // dead ahead tallest, each leaning a touch outward.
    const g = new Group();
    // The band is a band — a short open ring a hair wider at its foot,
    // the shape of the brow it sits on — where it was a wire.
    const bandMat = trimMat.clone();
    bandMat.side = DoubleSide;
    const band = asTrim(new Mesh(new CylinderGeometry(R * 0.84, R * 0.89, R * 0.17, 44, 1, true), bandMat));
    band.position.y = R * 0.64;
    band.scale.set(0.9, 1, 1.02);
    g.add(band);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 - Math.PI / 2; // i = 0 sits at −z: the front
      const x = Math.cos(a) * R * 0.86 * 0.9;
      const z = Math.sin(a) * R * 0.86 * 1.02;
      const front = 0.5 - 0.5 * Math.sin(a);
      const h = R * (0.3 + front * 0.34);
      // Faceted like cut stone — four faces, not a round cone — and
      // seated on a stud of trim set into the band.
      const point = new Mesh(new ConeGeometry(R * 0.09, h, 4), mat);
      point.position.set(x, R * 0.66 + h * 0.46, z);
      point.rotation.set(Math.sin(a) * 0.22, Math.PI / 4 - a, -Math.cos(a) * 0.22, 'YXZ');
      g.add(point);
      const out = new Vector3(Math.cos(a) * 0.9, 0, Math.sin(a) * 1.02).normalize();
      g.add(asGlow(rivet(glowMat, new Vector3(x * 1.07, R * 0.62, z * 1.05), out, R * 0.055))); // a lit gem under each point
    }
    return g;
  },
  antlers: (mat, _side, trimMat) => {
    // A stag's pair: each a tapered beam off the temple, climbing up and
    // back and curling in at the tip, with a brow tine forward and a
    // second tine off the middle. Faceted like the horns.
    const g = new Group();
    const faceted = mat.clone();
    faceted.flatShading = true;
    const tube = (pts: number[][], s: number, r0: number, r1: number, segs: number): Mesh =>
      new Mesh(taperedTube(pts.map(([x, y, z]) => new Vector3(s * x * R, y * R, z * R)), r0 * R, r1 * R, segs, 6), faceted);
    for (const s of [-1, 1]) {
      const beam = [[0.66, 0.6, -0.08], [0.92, 1.05, 0.05], [1.15, 1.55, 0.3], [1.2, 2.05, 0.55], [1.02, 2.45, 0.82]];
      g.add(tube(beam, s, 0.16, 0.03, 22));
      // THE BURR: the knobbed ring where a real antler meets the skull.
      const burr = tubeBands(trimMat, beam.map(([x, y, z]) => new Vector3(s * x * R, y * R, z * R)), 0.16 * R, 0.03 * R, [0.05], 0.3, 1.12);
      for (const b of burr) g.add(b);
      g.add(tube([[0.82, 0.92, -0.02], [0.98, 1.22, -0.4], [1.02, 1.42, -0.7]], s, 0.09, 0.02, 12)); // the brow tine
      g.add(tube([[1.12, 1.5, 0.28], [1.45, 1.75, 0.15], [1.7, 2.05, 0.05]], s, 0.09, 0.02, 12)); // the second tine
    }
    return g;
  },
  wings: (mat, _side, _trimMat, glowMat) => {
    // Two fans of swept blades off the shoulder blades: three per side,
    // the longest on top, each pivoting at the blade and raked up, out
    // and back — a silhouette that reads from across the arena.
    const g = new Group();
    for (const s of [-1, 1] as const) {
      for (let i = 0; i < 3; i++) {
        const len = 0.36 - i * 0.06;
        // A BLADE, not a slat: full at the root, tapering to a lifted
        // point, a few millimetres thick with its edges eased.
        const blade = new ExtrudeGeometry(bladeShape(len, 0.08 - i * 0.012, s), {
          depth: 0.005,
          bevelEnabled: true,
          bevelThickness: 0.0015,
          bevelSize: 0.0015,
          bevelSegments: 1,
          curveSegments: 10,
        });
        blade.translate(0, 0, -0.0025);
        const plate = new Mesh(blade, mat);
        plate.userData.atlasSplit = true; // front and back faces paint apart
        const pivot = new Group();
        pivot.position.set(s * 0.11, 0.36 - i * 0.02, 0.09);
        // Roll lifts the plate; yaw sweeps it back (the back is +z). The
        // top plate stands nearly upright, the lower two fan out under it.
        pivot.rotation.set(0, -s * (0.55 + i * 0.22), s * (1.15 - i * 0.34));
        pivot.add(plate);
        g.add(pivot);
        // Each blade turns on a HINGE — a knuckle of trim at its root.
        g.add(asGlow(rivet(glowMat, pivot.position.clone(), new Vector3(s * 0.4, 0.2, 1), 0.012))); // lit hinges
      }
    }
    // THE MOUNT: a plate across the shoulder blades both fans hang from.
    const mount = plate(roundRect(0.2, 0.07, 0.03), 0.01, 0.003, mat);
    mount.position.set(0, 0.34, 0.108);
    g.add(mount);
    return g;
  },
  claws: (mat, _side, _trimMat, glowMat) => {
    // Three talons rooted on the knuckle line, reaching forward past the
    // fingers and hooking down to a point. The palm block's front face is
    // at z ≈ −0.045; the roots sit just inside it.
    const g = new Group();
    const faceted = mat.clone();
    faceted.flatShading = true;
    // The talons are MOUNTED: a trim bar across the knuckles they grow from.
    const mount = asGlow(new Mesh(new CapsuleGeometry(0.0065, 0.05, 3, 10), glowMat)); // lit
    mount.rotation.z = Math.PI / 2;
    mount.position.set(0, 0.015, -0.036);
    g.add(mount);
    for (const x of [-0.021, 0, 0.021]) {
      const pts = [
        [x, 0.014, -0.034],
        [x * 1.15, 0.03, -0.062],
        [x * 1.3, 0.022, -0.09],
        [x * 1.4, -0.004, -0.108],
        [x * 1.45, -0.03, -0.112],
      ].map(([px, py, pz]) => new Vector3(px, py, pz));
      g.add(new Mesh(taperedTube(pts, 0.009, 0.0012, 16, 6), faceted));
    }
    return g;
  },
};
/* ── the third wave ──────────────────────────────────────────────────── */

const THIRD_BUILDERS: Record<string, Builder> = {
  spikepads: (mat, _side, trimMat) => {
    // SPIKED PADS: the PAULDRONS' shell a size up, three spikes driven
    // up through each dome from trim collars (shellPad) — the same shape
    // as the plain pair, so the two read as one family.
    const g = new Group();
    for (const s of [-1, 1] as const) g.add(shellPad(mat, trimMat, s, 1.14, true));
    return g;
  },
};

/* ── the fourth wave ─────────────────────────────────────────────────── */

const FOURTH_BUILDERS: Record<string, Builder> = {
  vcrest: (mat, _side, trimMat, glowMat) => {
    // A V-CREST — the kuwagata of a samurai's helm: a shield-shaped
    // EMBLEM on the brow, framed in trim with a lit gem at its heart, and
    // two long blades rising from behind it in a V, sweeping up and out
    // and leaning back with the brow.
    const g = new Group();
    const { p, n } = eggPoint(new Vector3(0, 0.36, -1));
    const brow = new Group();
    face(brow, p, n);
    g.add(brow);
    const shield: Array<[number, number]> = [
      [-0.17 * R, 0.13 * R], [0.17 * R, 0.13 * R], [0.15 * R, -0.05 * R], [0, -0.19 * R], [-0.15 * R, -0.05 * R],
    ];
    const emblem = plate(outline(shield), 0.05 * R, 0.012 * R, mat);
    emblem.position.z = 0.05 * R;
    brow.add(emblem);
    const frame = asTrim(plate(outline(shield.map(([x, y]) => [x * 1.2, y * 1.2 + 0.005 * R] as [number, number])), 0.03 * R, 0.008 * R, trimMat));
    frame.position.z = 0.025 * R;
    brow.add(frame);
    const gem = asGlow(plate(outline([[0, 0.07 * R], [0.06 * R, 0], [0, -0.08 * R], [-0.06 * R, 0]]), 0.02 * R, 0.006 * R, glowMat));
    gem.position.z = 0.09 * R;
    brow.add(gem);
    for (const s of [-1, 1] as const) {
      const sh = new Shape();
      sh.moveTo(s * 0.04 * R, 0.02 * R);
      sh.quadraticCurveTo(s * 0.42 * R, 0.22 * R, s * 1.02 * R, 1.38 * R); // the outer edge, out to the tip
      sh.quadraticCurveTo(s * 0.34 * R, 0.62 * R, s * 0.02 * R, 0.16 * R); // and back down the inner
      sh.closePath();
      const blade = plate(sh, 0.04 * R, 0.01 * R, mat);
      blade.position.z = 0.01 * R;
      brow.add(blade);
    }
    return g;
  },
  earfins: (mat, _side, trimMat, glowMat) => {
    // EAR FINS — a winged helm's: at each temple a fin of three swept
    // feathers, splayed out as they run back, on a trim boss with a lit hub.
    const g = new Group();
    for (const s of [-1, 1] as const) {
      const { p, n } = eggPoint(new Vector3(s, 0.14, 0.08));
      const boss = asTrim(new Mesh(new CylinderGeometry(0.16 * R, 0.19 * R, 0.07 * R, 20), trimMat));
      boss.position.copy(p).addScaledVector(n, 0.02 * R);
      aim(boss, n);
      g.add(boss);
      const hub = asGlow(new Mesh(new CylinderGeometry(0.08 * R, 0.08 * R, 0.02 * R, 16), glowMat));
      hub.position.copy(p).addScaledVector(n, 0.06 * R);
      aim(hub, n);
      g.add(hub);
      // The fin's outline in its own plane (x = back along the head, y = up).
      const feathers: Array<[number, number]> = [
        [-0.22 * R, 0.14 * R], [0.2 * R, 0.34 * R], [1.08 * R, 0.86 * R], [0.46 * R, 0.36 * R],
        [0.98 * R, 0.44 * R], [0.42 * R, 0.14 * R], [0.8 * R, 0.02 * R], [0.14 * R, -0.12 * R], [-0.2 * R, -0.06 * R],
      ];
      const fin = plate(outline(feathers), 0.05 * R, 0.012 * R, mat);
      fin.rotation.y = -Math.PI / 2; // the outline's x onto the head's z (back)
      const splay = new Group();
      splay.rotation.y = s * 0.32; // the back of the fin further out than its root
      splay.add(fin);
      splay.position.copy(p).addScaledVector(n, 0.07 * R);
      g.add(splay);
    }
    return g;
  },
  thrusters: (mat, _side, trimMat, glowMat) => {
    // THRUSTERS — a JET PACK between the shoulder blades: a bevelled
    // pack, two bell nozzles hung under it on trim necks, their throats
    // and lips LIT, and a pair of lit rails down its back.
    const g = new Group();
    const pack = plate(roundRect(0.15, 0.17, 0.028), 0.045, 0.006, mat);
    pack.position.set(0, 0.3, 0.13);
    g.add(pack);
    for (const x of [-0.045, 0.045]) {
      const rail = asGlow(new Mesh(new CapsuleGeometry(0.005, 0.12, 3, 8), glowMat)); // lit rails down the pack
      rail.position.set(x, 0.3, 0.16);
      g.add(rail);
      const neck = asTrim(new Mesh(new CylinderGeometry(0.012, 0.015, 0.03, 14), trimMat));
      neck.position.set(x, 0.205, 0.132);
      g.add(neck);
      const bell = new Mesh(
        new LatheGeometry(
          [
            new Vector2(0.014, 0.02), new Vector2(0.02, 0.0), new Vector2(0.03, -0.032), new Vector2(0.036, -0.046),
            new Vector2(0.031, -0.046), new Vector2(0.025, -0.032), new Vector2(0.016, 0.0), new Vector2(0.011, 0.02),
            new Vector2(0.014, 0.02),
          ],
          24,
        ),
        mat,
      );
      bell.position.set(x, 0.175, 0.132);
      g.add(bell);
      const core = asGlow(new Mesh(new CylinderGeometry(0.022, 0.022, 0.004, 20), glowMat)); // the lit throat
      core.position.set(x, 0.148, 0.132);
      g.add(core);
      const lip = asGlow(new Mesh(new TorusGeometry(0.0335, 0.003, 5, 24), glowMat)); // and a lit lip, seen from anywhere
      lip.rotation.x = Math.PI / 2;
      lip.position.set(x, 0.175 - 0.046, 0.132);
      g.add(lip);
    }
    return g;
  },
  wristblades: (mat, side, trimMat, glowMat) => {
    // WRIST BLADES — a blade along the outside of each forearm, rooted at
    // the wrist on a trim bracket and running forward past the knuckles,
    // with a lit line down its spine.
    const g = new Group();
    const x = -side * 0.05; // the little-finger side (the thumb is on +side)
    const sh = outline([[0.07, 0.013], [-0.02, 0.021], [-0.128, 0.0], [-0.03, -0.012], [0.07, -0.01]]);
    const blade = plate(sh, 0.004, 0.0012, mat);
    blade.rotation.y = -Math.PI / 2; // the outline's x onto the hand's z (the tip toward the fingers)
    blade.position.set(x, 0.004, 0);
    g.add(blade);
    const bracket = asTrim(new Mesh(new CapsuleGeometry(0.006, 0.03, 3, 8), trimMat));
    bracket.rotation.x = Math.PI / 2;
    bracket.position.set(x - side * 0.004, 0.002, 0.055);
    g.add(bracket);
    const spine = asGlow(new Mesh(new CapsuleGeometry(0.0042, 0.09, 3, 6), glowMat)); // proud of both faces
    spine.rotation.x = Math.PI / 2;
    spine.position.set(x, 0.006, -0.01);
    g.add(spine);
    return g;
  },
};

/* ── the fifth wave: THE SHOULDERS' own shelf, and two hung body pieces ── */

/** A point on a dome of half-extents (a, b, c) along dome-local `dir`,
 *  and its normal, carried through the dome's placement (tipped `tip`
 *  about z, then moved to `at`) — where a fin or a stud is seated. */
function domePoint(a: number, b: number, c: number, tip: number, at: Vector3, dir: Vector3): { p: Vector3; n: Vector3 } {
  const rot = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), tip);
  const d = dir.clone().normalize();
  const t = 1 / Math.sqrt((d.x / a) ** 2 + (d.y / b) ** 2 + (d.z / c) ** 2);
  const p = d.multiplyScalar(t);
  const n = new Vector3(p.x / (a * a), p.y / (b * b), p.z / (c * c)).normalize().applyQuaternion(rot);
  return { p: p.applyQuaternion(rot).add(at), n };
}

/** A FLAME TONGUE: root `w` wide on the origin, rising `h` and licking
 *  over to `lean`·h at the tip (toward +x, mirrored by `s`), with a second,
 *  smaller lick breaking off its outer edge half way up. */
function flameShape(h: number, w: number, lean: number, s: 1 | -1): Shape {
  const X = (x: number): number => x * s;
  const tip: [number, number] = [lean * h, h];
  const notch: [number, number] = [lean * h * 0.42 + w * 0.12, h * 0.56];
  const tip2: [number, number] = [lean * h * 0.55 + w * 0.62, h * 0.64];
  const sh = new Shape();
  sh.moveTo(X(-w / 2), 0);
  sh.quadraticCurveTo(X(-w * 0.62), h * 0.7, X(tip[0]), tip[1]);
  sh.quadraticCurveTo(X(lean * h * 0.62 + w * 0.12), h * 0.74, X(notch[0]), notch[1]);
  sh.quadraticCurveTo(X(lean * h * 0.5 + w * 0.42), h * 0.5, X(tip2[0]), tip2[1]);
  sh.quadraticCurveTo(X(w * 0.78), h * 0.28, X(w / 2), 0);
  sh.closePath();
  return sh;
}

/**
 * ONE WARLORD PAD — the great pauldron of the old raid-boss paladins: a
 * deep, round steel dome (rounder and a size up on the PAULDRONS' shell,
 * seated the same way), a heavy ROLLED RIM of trim round its whole edge,
 * a crest of three FLAME TONGUES rising off the crown and licking out over
 * the arm, and a pair of lit studs fore and aft. The dome is the paint
 * surface; the rim and the flames are the trim that frames it.
 */
function warlordPad(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial, s: 1 | -1, bastion = false): Group {
  const g = new Group();
  // BASTION (below) is this pad with the fire taken out: a touch rounder
  // and fuller, so it reads as a smooth great dome and not a bare warlord.
  const a = bastion ? 0.126 : 0.13;
  const b = bastion ? 0.112 : 0.108;
  const c = bastion ? 0.124 : 0.122;
  const theta = Math.PI * 0.6; // the dome runs a little past its equator
  const tip = -s * 0.44;
  const at = new Vector3(s * 0.234, 0.378, 0);
  const pad = new Mesh(new SphereGeometry(0.1, 48, 28, 0, Math.PI * 2, 0, theta), mat);
  pad.scale.set(a / 0.1, b / 0.1, c / 0.1);
  pad.position.copy(at);
  pad.rotation.z = tip;
  pad.updateMatrix();
  // THE RIM: the dome's own open edge, found before the dome is seated
  // and then pushed out exactly as its vertices will be (a tube's width
  // further), so the roll stays on the edge where the edge meets the body.
  const rimR = 0.011;
  const rim: Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const phi = (i / 64) * Math.PI * 2;
    const v = new Vector3(-0.1 * Math.cos(phi) * Math.sin(theta), 0.1 * Math.cos(theta), 0.1 * Math.sin(phi) * Math.sin(theta)).applyMatrix4(pad.matrix);
    seatPoint(v, 0.004 + rimR);
    rim.push(v);
  }
  const on = (x: number, y: number, z: number): { p: Vector3; n: Vector3 } => domePoint(a, b, c, tip, at, new Vector3(s * x, y, z));
  seatOnBody(pad, 0.004);
  g.add(pad);
  g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(rim, true, 'centripetal'), 128, rimR, 8, true), trimMat)));
  // THE FLAMES: three tongues standing on the crown, broad face to the
  // front (the silhouette you see across the arena), the middle one the
  // tallest. Each is stood up a little off the dome's own normal (which
  // is tipped out over the arm) and licks outward at its tip — so the
  // crest rises, then sweeps out, like the ones in the old raids.
  const flames: Array<[number, number, number, number, number]> = bastion
    ? []
    : [
        // dome-local seat (x out, y up, z back), height, how far stood up
        [0.05, 1, -0.55, 0.1, 0.2],
        [0.2, 1, 0, 0.14, 0.26],
        [0.05, 1, 0.55, 0.1, 0.2],
      ];
  for (const [x, y, z, h, up] of flames) {
    const { p, n } = on(x, y, z);
    const fin = asTrim(plate(flameShape(h, 0.058, 0.42, s), 0.007, 0.0022, trimMat));
    fin.rotation.z = Math.atan2(-n.x, n.y) + s * up;
    fin.position.copy(p).addScaledVector(n, -0.016);
    g.add(fin);
  }
  if (bastion) {
    // THE RIDGE: a rolled band of trim over the crown, brow to back,
    // following the dome's own surface — the one line on a smooth shell.
    const ridge: Vector3[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = -1.25 + (i / 24) * 2.5;
      const { p, n } = on(0.12, Math.cos(t), Math.sin(t));
      ridge.push(p.addScaledVector(n, 0.004));
    }
    g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(ridge), 64, 0.0075, 8), trimMat)));
    // A rounded TIER under the rim, primer like the dome, stepping down
    // over the arm, its lower edge piped in trim so it reads as a plate.
    const [r, a0, a1, depth] = [0.108, -0.1, -0.68, 0.22];
    const at = new Vector3(s * 0.218, 0.352, 0);
    const tier = lame(mat, r - 0.014, r, a0, a1, depth, s);
    tier.position.copy(at);
    g.add(tier);
    const edge: Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const z = (i / 16 - 0.5) * depth * 0.96;
      const t = z / (depth / 2);
      const k = 1 - 0.24 * Math.min(1, t * t);
      edge.push(new Vector3(at.x + s * Math.cos(a1) * (r - 0.004) * k, at.y + Math.sin(a1) * (r - 0.004) * k, z));
    }
    g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(edge), 32, 0.0045, 6), trimMat)));
  } else {
    // THE SKIRT: a lame of trim tucked under the rim on the outside,
    // flaring down over the top of the arm — the dome's lower tier.
    const skirt = asTrim(lame(trimMat, 0.1, 0.11, -0.05, -0.95, 0.19, s));
    skirt.position.set(s * 0.222, 0.35, 0);
    g.add(skirt);
  }
  // THE STUDS: two lit bosses on the dome's front and back faces.
  for (const z of [-0.72, 0.72]) {
    const { p, n } = on(0.5, 0.7, z);
    g.add(asGlow(rivet(glowMat, p, n, 0.014)));
  }
  return g;
}

/**
 * ONE EPAULET — the dress board: a flat plate laid along the slope of the
 * shoulder from the neck to the point, piped round in trim, ending in a
 * rolled CRESCENT over the point of the shoulder with a FRINGE of bullion
 * hanging off it, and a lit button at the neck end. Stiff, as a board is:
 * it bridges the shoulder rather than wrapping it.
 */
function epaulet(mat: MeshStandardMaterial, trimMat: MeshStandardMaterial, glowMat: MeshStandardMaterial, s: 1 | -1): Group {
  const g = new Group();
  const L = 0.172;
  const W = 0.112;
  const T = 0.015;
  // The board's own frame: its shape plane is the group's XY (x along the
  // board, outward at +s), thickness along z; the group lays it flat on
  // the slope of the shoulder.
  g.quaternion
    .setFromAxisAngle(new Vector3(0, 0, 1), -s * 0.3)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2));
  g.position.set(s * 0.186, 0.434, -0.004);
  // The outline: square at the neck, rounded at the point.
  const sh = new Shape();
  const x0 = -L / 2;
  const x1 = L / 2;
  const hw = W / 2;
  const X = (x: number): number => x * s;
  sh.moveTo(X(x0), -hw * 0.8);
  sh.lineTo(X(x1 - hw), -hw);
  sh.absarc(X(x1 - hw), 0, hw, s > 0 ? -Math.PI / 2 : (Math.PI * 3) / 2, s > 0 ? Math.PI / 2 : Math.PI / 2, s < 0);
  sh.lineTo(X(x0), hw * 0.8);
  sh.closePath();
  g.add(plate(sh, T, 0.003, mat));
  // The piping: a roll of trim round the whole outline, on its top face.
  const pipe = sh.getSpacedPoints(64).map((q) => new Vector3(q.x, q.y, T / 2 + 0.002));
  pipe.pop();
  g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(pipe, true), 96, 0.0032, 6, true), trimMat)));
  // THE CRESCENT: a half-roll round the rounded end, primer, fat.
  const cr = new Mesh(new TorusGeometry(hw * 0.84, 0.015, 10, 28, Math.PI * 1.1), mat);
  cr.position.set(X(x1 - hw), 0, T / 2 + 0.008);
  cr.rotation.z = s > 0 ? -Math.PI * 0.55 : Math.PI * 0.45;
  g.add(cr);
  // THE FRINGE: bullion strands hung off the crescent. The board's frame
  // is tipped, so each strand is aimed at the body's DOWN (the group's
  // inverse turns it into board-local), to hang plumb.
  const down = new Vector3(0, -1, 0).applyQuaternion(g.quaternion.clone().invert());
  const strands = 17;
  for (let i = 0; i < strands; i++) {
    const ang = -Math.PI * 0.48 + (i / (strands - 1)) * Math.PI * 0.96;
    const root = new Vector3(X(x1 - hw) + s * Math.cos(ang) * hw * 0.92, Math.sin(ang) * hw * 0.92, T / 2 + 0.002);
    const len = 0.066 + 0.01 * Math.cos(ang);
    const strand = asTrim(new Mesh(new CylinderGeometry(0.0042, 0.0052, len, 6), trimMat));
    aim(strand, down);
    strand.position.copy(root).addScaledVector(down, len / 2);
    g.add(strand);
  }
  // THE BUTTON at the neck end, lit.
  g.add(asGlow(rivet(glowMat, new Vector3(X(x0 + 0.018), 0, T / 2 + 0.001), FWD, 0.011)));
  return g;
}

/** One LAME of a laminated guard: a band of plate curved over the arm
 *  (an annular arc of `r0`..`r1` from angle `a0` down to `a1`, 0 = out
 *  over the arm, mirrored by `s`) and `depth` long fore and aft, its ends
 *  drawn in so it reads as a shell, not a length of pipe. */
function lame(mat: MeshStandardMaterial, r0: number, r1: number, a0: number, a1: number, depth: number, s: 1 | -1): Mesh {
  const sh = new Shape();
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    if (i === 0) sh.moveTo(s * Math.cos(a) * r1, Math.sin(a) * r1);
    else sh.lineTo(s * Math.cos(a) * r1, Math.sin(a) * r1);
  }
  for (let i = N; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / N;
    sh.lineTo(s * Math.cos(a) * r0, Math.sin(a) * r0);
  }
  sh.closePath();
  const geo = new ExtrudeGeometry(sh, { depth, steps: 10, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 4 });
  geo.translate(0, 0, -depth / 2);
  const pos = geo.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getZ(i) / (depth / 2);
    const k = 1 - 0.24 * Math.min(1, t * t);
    pos.setXY(i, pos.getX(i) * k, pos.getY(i) * k);
  }
  geo.computeVertexNormals();
  const m = new Mesh(geo, mat);
  m.userData.atlasSplit = true;
  return m;
}

const FIFTH_BUILDERS: Record<string, Builder> = {
  /* shoulders — the body group's frame (origin at the hips, front −z) */
  warlord: (mat, _side, trimMat, glowMat) => {
    // THE WARLORD: a pair of great flamed domes (warlordPad).
    const g = new Group();
    for (const s of [-1, 1] as const) g.add(warlordPad(mat, trimMat, glowMat, s));
    return g;
  },
  bastion: (mat, _side, trimMat, glowMat) => {
    // BASTION: the great round dome with no fire and no spikes — a ridge
    // over the crown, a heavy rim, two rounded tiers down the arm, lit
    // studs (warlordPad, bastion).
    const g = new Group();
    for (const s of [-1, 1] as const) g.add(warlordPad(mat, trimMat, glowMat, s, true));
    return g;
  },
  epaulets: (mat, _side, trimMat, glowMat) => {
    // EPAULETS: a dress board on each shoulder (epaulet).
    const g = new Group();
    for (const s of [-1, 1] as const) g.add(epaulet(mat, trimMat, glowMat, s));
    return g;
  },
  gladiator: (mat, _side, trimMat, glowMat) => {
    // THE GLADIATOR: ONE shoulder armoured, the other bare — the net-man's
    // guard. Four lames step down over the LEFT arm, each tucked under the
    // one above, riveted at both ends, and a flat GUARD stands up off the
    // top at the neck side, flared away from the head, with a lit boss.
    const g = new Group();
    const s = -1 as const; // the fighter's left (front is −z, so left is −x)
    const C = new Vector3(s * 0.196, 0.34, 0);
    const lames: Array<[number, number, number, number, number]> = [
      // radius (outer), start angle, end angle, depth, drop
      [0.09, 1.95, 0.4, 0.23, 0],
      [0.095, 1.45, 0.0, 0.216, 0.026],
      [0.1, 1.0, -0.38, 0.2, 0.052],
      [0.105, 0.56, -0.74, 0.182, 0.078],
    ];
    // Drawn bottom lame first: each is set a hair INSIDE the one above
    // (a smaller radius where they overlap) by stepping its centre out and
    // down the arm, so the upper plate laps over the lower.
    lames.forEach(([r1, a0, a1, depth, drop], i) => {
      const m = lame(mat, r1 - 0.014, r1, a0, a1, depth, s);
      m.position.set(C.x + s * drop * 0.55, C.y - drop, 0);
      m.position.x -= s * i * 0.002;
      seatOnBody(m, 0.004);
      g.add(m);
      // Rivets at both ends, mid-arc, on the drawn-in caps.
      const am = (a0 + a1) / 2;
      const rm = (r1 - 0.007) * 0.76;
      for (const zs of [-1, 1]) {
        const at = new Vector3(C.x + s * drop * 0.55 - s * i * 0.002 + s * Math.cos(am) * rm, C.y - drop + Math.sin(am) * rm, zs * (depth / 2 + 0.003));
        g.add(rivet(trimMat, at, new Vector3(0, 0, zs), 0.0065));
      }
    });
    // THE GUARD: a flat plate standing on the top lame at the neck side,
    // broad face to the side, its top edge a shallow arch, leaning out.
    const gw = 0.17;
    const gh = 0.1;
    const gsh = new Shape();
    gsh.moveTo(-gw * 0.4, 0);
    gsh.lineTo(gw * 0.4, 0);
    gsh.quadraticCurveTo(gw * 0.52, gh * 0.6, gw * 0.5, gh);
    gsh.quadraticCurveTo(0, gh * 1.25, -gw * 0.5, gh);
    gsh.quadraticCurveTo(-gw * 0.52, gh * 0.6, -gw * 0.4, 0);
    const guard = plate(gsh, 0.008, 0.0025, mat);
    guard.quaternion
      .setFromAxisAngle(new Vector3(0, 0, 1), -s * 0.26)
      .multiply(new Quaternion().setFromAxisAngle(UP, Math.PI / 2));
    guard.position.set(s * 0.15, 0.4, 0);
    g.add(guard);
    // Its edge rolled in trim, and the lit boss at its heart.
    const outN = new Vector3(s, 0, 0).applyAxisAngle(new Vector3(0, 0, 1), -s * 0.26);
    const edge = gsh.getSpacedPoints(48).map((q) => new Vector3(q.x, q.y, 0).applyQuaternion(guard.quaternion).add(guard.position));
    edge.pop();
    g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(edge, true), 72, 0.0036, 6, true), trimMat)));
    const boss = new Vector3(0, gh * 0.5, 0).applyQuaternion(guard.quaternion).add(guard.position).addScaledVector(outN, 0.0045);
    g.add(asGlow(rivet(glowMat, boss, outN, 0.013)));
    return g;
  },

  /* body */
  cape: (mat, _side, trimMat, glowMat) => {
    // A CAPE: one sheet hung from the back of the shoulder line, falling
    // past the tip of the body, flaring as it drops and billowing back
    // off the spine, laid in five soft PLEATS that deepen toward the hem,
    // the hem itself dipping at the middle. Seated (seatOnBody) so it
    // drapes over the shoulder blades instead of through them. A roll of
    // trim along its top edge, and a cord from each top corner over the
    // shoulder to a lit clasp at the collarbone.
    const g = new Group();
    const U = 24;
    const V = 26;
    const top = 0.405;
    const L = 0.64;
    const half = 0.165;
    const ring = bodyRing(top);
    const backAt = (x: number): number => ring.z + ring.d * Math.sqrt(Math.max(0, 1 - (x / ring.w) ** 2));
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let j = 0; j <= V; j++) {
      const v = j / V;
      for (let i = 0; i <= U; i++) {
        const u = i / U;
        const x0 = (u * 2 - 1) * half;
        const x = x0 * (1 + 0.5 * v);
        const pleat = 0.013 * (0.5 - 0.5 * Math.cos(u * Math.PI * 2 * 5)) * Math.min(1, v * 2.5);
        const z = backAt(x0) + 0.008 + 0.075 * Math.pow(v, 1.4) + pleat;
        const y = top - v * L - 0.035 * Math.sin(Math.PI * u) * v * v;
        pos.push(x, y, z);
        uv.push(u, 1 - v);
        if (i < U && j < V) {
          const a = j * (U + 1) + i;
          const c = a + U + 1;
          idx.push(a, a + 1, c, a + 1, c + 1, c);
        }
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    const clothMat = mat.clone();
    clothMat.side = DoubleSide; // one sheet, seen from both sides
    const cloth = new Mesh(geo, clothMat);
    seatOnBody(cloth, 0.006);
    g.add(cloth);
    // The yoke: a roll of trim along the seated top edge.
    const cpos = cloth.geometry.getAttribute('position');
    const yoke: Vector3[] = [];
    for (let i = 0; i <= U; i++) yoke.push(new Vector3().fromBufferAttribute(cpos, i).add(new Vector3(0, 0.002, 0.003)));
    g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(yoke), 64, 0.0055, 6), trimMat)));
    // The cords and the clasps.
    for (const s of [-1, 1] as const) {
      const corner = s < 0 ? yoke[0] : yoke[U];
      const x = s * 0.14;
      const front = bodyRing(0.4);
      const fz = front.z - front.d * Math.sqrt(Math.max(0, 1 - (x / front.w) ** 2));
      const cord = [
        corner.clone(),
        new Vector3(x * 1.05, 0.425, 0.035),
        new Vector3(x, 0.438, -0.012),
        new Vector3(x * 0.98, 0.422, -0.05),
        new Vector3(x * 0.95, 0.4, fz),
      ];
      for (const q of cord) seatPoint(q, 0.007);
      g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(cord), 32, 0.0045, 6), trimMat)));
      const clasp = cord[cord.length - 1].clone();
      const n = new Vector3(clasp.x * 0.3, 0.1, clasp.z - front.z).normalize();
      const bezel = asTrim(new Mesh(new CylinderGeometry(0.016, 0.018, 0.006, 20), trimMat));
      bezel.position.copy(clasp);
      aim(bezel, n);
      g.add(bezel);
      const gem = asGlow(new Mesh(new CylinderGeometry(0.011, 0.011, 0.004, 20), glowMat));
      gem.position.copy(clasp).addScaledVector(n, 0.003);
      aim(gem, n);
      g.add(gem);
    }
    return g;
  },
  tabard: (mat, _side, trimMat, glowMat) => {
    // A TABARD: a panel down the front and another down the back, broad
    // across the chest and narrowing to the waist, where a cord of trim
    // CINCHES them to the body, then falling free past the hips (hung from
    // the hip line, flaring a little), hemmed in trim on both sides and
    // the bottom. Two straps over the shoulders hold the panels together;
    // a lit lozenge in a trim frame sits on the chest, the house's device.
    const g = new Group();
    const rows = 30;
    const cols = 10;
    const yTop = 0.41;
    const yBot = -0.25;
    const HIP = -0.02;
    const hwAt = (y: number): number =>
      y > 0.3 ? 0.07 + (0.112 - 0.07) * ((y - 0.3) / (yTop - 0.3)) : y > 0.13 ? 0.066 + 0.004 * ((y - 0.13) / 0.17) : 0.066 + 0.026 * ((0.13 - y) / (0.13 - yBot));
    const clothMat = mat.clone();
    clothMat.side = DoubleSide;
    for (const sgn of [-1, 1] as const) {
      // sgn −1 = the front panel (−z), +1 = the back.
      const pos: number[] = [];
      const uv: number[] = [];
      const idx: number[] = [];
      for (let j = 0; j <= rows; j++) {
        const t = j / rows;
        const y = yTop + (yBot - yTop) * t;
        const ring = bodyRing(Math.max(y, HIP));
        const hang = y < HIP ? 0.028 * Math.pow((HIP - y) / (HIP - yBot), 1.4) : 0;
        const hw = hwAt(y);
        for (let i = 0; i <= cols; i++) {
          const x = (i / cols) * 2 * hw - hw;
          const xr = Math.min(0.97, Math.abs(x) / ring.w);
          const z = ring.z + sgn * (ring.d * Math.sqrt(1 - xr * xr) + 0.006 + hang);
          pos.push(x, y, z);
          uv.push(i / cols, 1 - t);
          if (i < cols && j < rows) {
            const a = j * (cols + 1) + i;
            const c = a + cols + 1;
            if (sgn < 0) idx.push(a, c, a + 1, a + 1, c, c + 1);
            else idx.push(a, a + 1, c, a + 1, c + 1, c);
          }
        }
      }
      const geo = new BufferGeometry();
      geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
      geo.setAttribute('uv', new Float32BufferAttribute(uv, 2));
      geo.setIndex(idx);
      const panel = new Mesh(geo, clothMat);
      seatOnBody(panel, 0.006);
      g.add(panel);
      // The hem: both sides and the bottom, one run of trim, a hair proud.
      const pp = panel.geometry.getAttribute('position');
      const at = (i: number, j: number): Vector3 => new Vector3().fromBufferAttribute(pp, j * (cols + 1) + i).add(new Vector3(0, 0, sgn * 0.0025));
      const hem: Vector3[] = [];
      for (let j = 0; j <= rows; j++) hem.push(at(0, j));
      for (let i = 1; i <= cols; i++) hem.push(at(i, rows));
      for (let j = rows - 1; j >= 0; j--) hem.push(at(cols, j));
      g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(hem, false, 'centripetal'), 160, 0.004, 6), trimMat)));
    }
    // The straps over the shoulders, panel top to panel top.
    for (const s of [-1, 1] as const) {
      const x = s * 0.104;
      const strap = [
        new Vector3(x, 0.405, -0.1),
        new Vector3(x, 0.43, -0.062),
        new Vector3(x, 0.45, -0.02),
        new Vector3(x, 0.43, 0.036),
        new Vector3(x, 0.405, 0.075),
      ];
      for (const q of strap) seatPoint(q, 0.008);
      g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(strap), 32, 0.0075, 6), trimMat)));
    }
    // The cinch at the waist pinch (BODY_RINGS: ±0.090 by ±0.074 at 0.13).
    const W = 0.098;
    const D = 0.083;
    const cinch = asTrim(new Mesh(new TorusGeometry(1, 0.0055 / W, 6, 56), trimMat));
    cinch.rotation.x = Math.PI / 2;
    cinch.scale.set(W, D, W);
    cinch.position.y = 0.13;
    g.add(cinch);
    // THE DEVICE: a lit lozenge in a trim frame on the chest.
    const chest = bodyRing(0.3);
    const devAt = new Vector3(0, 0.3, chest.z - chest.d - 0.006 - 0.004);
    const lozenge = (w: number, h: number): Shape => outline([[0, h / 2], [w / 2, 0], [0, -h / 2], [-w / 2, 0]]);
    const frame = asTrim(plate(lozenge(0.056, 0.074), 0.004, 0.0015, trimMat));
    face(frame, devAt, new Vector3(0, 0, -1));
    g.add(frame);
    const gem = asGlow(plate(lozenge(0.036, 0.05), 0.004, 0.0015, glowMat));
    face(gem, devAt.clone().add(new Vector3(0, 0, -0.003)), new Vector3(0, 0, -1));
    g.add(gem);
    return g;
  },
};

Object.assign(BUILDERS, MORE_BUILDERS, THIRD_BUILDERS, FOURTH_BUILDERS, FIFTH_BUILDERS);

/* ── the head variants: a piece re-made for one head ─────────────────── */
//
// Some head pieces can't be FITTED to some heads — no scale or tilt turns
// a wraparound visor into something a frog (eyes on turrets up top) or a
// horse (eyes on the sides of a long face) can wear. For those, the head
// wears its own cut of the piece: the same id, bought once, re-made for
// that animal. Built straight in the head's own frame (origin at the head
// centre, front −z, the head seated — avatar/heads.ts), so no refit.

const VARIANTS: Record<string, Record<string, Builder>> = {
  frog: {
    visorband: (mat, _side, trimMat, glowMat) => {
      // GOGGLES: a fat rolled rim round each eye turret's lit face, lit on
      // its inner edge, a bridge between them and a strap of trim round
      // the back of the head. The eyes still show through: no glass.
      const g = new Group();
      const eyeY = 0.05;
      const eyeZ = -0.094;
      const r = 0.037;
      for (const s of [-1, 1] as const) {
        const at = new Vector3(s * 0.08, eyeY, eyeZ);
        const face = new Vector3(s * 0.35, 0.15, -1).normalize(); // a touch outward and up
        const q = new Quaternion().setFromUnitVectors(FWD, face.clone().negate());
        const rim = new Mesh(new TorusGeometry(r, 0.0085, 10, 32), mat);
        rim.quaternion.copy(q);
        rim.position.copy(at);
        g.add(rim);
        const lit = asGlow(new Mesh(new TorusGeometry(r - 0.007, 0.0026, 6, 32), glowMat));
        lit.quaternion.copy(q);
        lit.position.copy(at).addScaledVector(face, 0.004);
        g.add(lit);
        // The strap, from the rim's outer edge down round the back of the
        // head where it is widest (measured on the frog: the top is short,
        // so a strap at eye height would float off the back of it).
        const strap = [
          new Vector3(s * 0.117, eyeY - 0.004, eyeZ + 0.018),
          new Vector3(s * 0.131, 0.024, -0.042),
          new Vector3(s * 0.147, 0.005, 0),
          new Vector3(s * 0.135, 0.004, 0.049),
          new Vector3(s * 0.108, 0.004, 0.091),
          new Vector3(s * 0.064, 0.004, 0.11),
          new Vector3(0, 0.004, 0.111),
        ];
        g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(strap), 32, 0.0055, 6), trimMat)));
      }
      // The bridge over the nose-line between the lenses.
      const bridge = [new Vector3(-0.045, eyeY + 0.004, eyeZ + 0.004), new Vector3(0, eyeY + 0.012, eyeZ - 0.002), new Vector3(0.045, eyeY + 0.004, eyeZ + 0.004)];
      g.add(new Mesh(new TubeGeometry(new CatmullRomCurve3(bridge), 16, 0.006, 8), mat));
      return g;
    },
    crown: (mat, _side, trimMat, glowMat) => {
      // THE FROG PRINCE's crown: a small circlet perched on the crown of
      // the head between the eyes, tipped at an angle — the head's own
      // crown, not a ring round a skull it doesn't have.
      const g = new Group();
      const cr = 0.04;
      const band = asTrim(new Mesh(new CylinderGeometry(cr, cr * 1.06, 0.018, 32, 1, true), trimMat));
      (band.material as MeshStandardMaterial).side = DoubleSide;
      g.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        const h = i === 0 ? 0.03 : 0.022;
        const point = new Mesh(new ConeGeometry(0.009, h, 4), mat);
        point.position.set(Math.cos(a) * cr, 0.009 + h / 2 - 0.002, Math.sin(a) * cr);
        point.rotation.set(Math.sin(a) * 0.18, Math.PI / 4 - a, -Math.cos(a) * 0.18, 'YXZ');
        g.add(point);
        const out = new Vector3(Math.cos(a), 0, Math.sin(a));
        g.add(asGlow(rivet(glowMat, new Vector3(Math.cos(a) * cr * 1.06, 0, Math.sin(a) * cr * 1.06), out, 0.0055)));
      }
      // On the flat of the head just behind the eyes (the plateau is at
      // 0.044–0.046 there), so it peeks up between them from the front.
      g.position.set(-0.008, 0.052, 0.036);
      g.rotation.set(-0.1, 0, 0.2); // tipped over to one side — worn at an angle
      return g;
    },
  },
  stallion: {
    visorband: (mat, _side, trimMat, glowMat) => {
      // BLINKERS: a cup beside and behind each eye (a racehorse's
      // blinkers — the eye sees forward, not back), riveted with a lit
      // stud, hung from a cheek strap that climbs to the poll behind the
      // ears. The horse already wears its bridle; these hang off it.
      const g = new Group();
      const cupR = 0.03;
      for (const s of [-1, 1] as const) {
        const eye = new Vector3(s * 0.066, -0.014, -0.063);
        // A shell of a sphere round the eye, open toward the front and
        // the face: the back and outer quarter of a ball, facing +x·s, +z.
        const cup = new Mesh(new SphereGeometry(cupR, 24, 14, 0, Math.PI, Math.PI * 0.18, Math.PI * 0.64), mat.clone());
        (cup.material as MeshStandardMaterial).side = DoubleSide;
        // phi 0..π sweeps +x round through +z to −x; turned so it sweeps
        // from the outer side round behind the eye.
        cup.rotation.y = s > 0 ? -Math.PI / 2 + 0.35 : Math.PI / 2 - 0.35 + Math.PI;
        cup.position.copy(eye).add(new Vector3(s * 0.006, 0, 0.004));
        g.add(cup);
        const stud = new Vector3(s * (0.066 + cupR * 0.95), -0.014, -0.063 + cupR * 0.2);
        g.add(asGlow(rivet(glowMat, stud, new Vector3(s, 0, 0.25).normalize(), 0.0065)));
        // Up the cheek from the cup's top and over the poll, hugging the
        // head (measured on the horse) rather than arching over the ears.
        const strap = [
          new Vector3(s * 0.086, 0.008, -0.054),
          new Vector3(s * 0.072, 0.028, -0.028),
          new Vector3(s * 0.058, 0.05, -0.006),
          new Vector3(s * 0.046, 0.075, 0),
          new Vector3(s * 0.024, 0.087, 0.002),
          new Vector3(0, 0.087, 0.002),
        ];
        g.add(asTrim(new Mesh(new TubeGeometry(new CatmullRomCurve3(strap), 32, 0.0045, 6), trimMat)));
      }
      return g;
    },
  },
};
for (const [id, build] of Object.entries(HEAD_PIECES)) BUILDERS[id] = (mat, _side, trimMat, glowMat) => build(mat, trimMat, glowMat);

/** The rig groups gear can hang off, by the names buildBoxer gives them —
 *  the head carries two slots: its GEAR (horns, crest…) and its FACE. */
const SLOTS_OF_NAME: Record<string, readonly GearSlot[]> = {
  'opponent-head': ['face', 'head'],
  'opponent-body': ['body', 'shoulders'],
  'opponent-glove-left': ['hands'],
  'opponent-glove-right': ['hands'],
};

/** The child each slot builds under its rig group ('gear' for the three
 *  that came first, so every probe that looks for it still finds it). */
const childName = (slot: GearSlot): string => (slot === 'face' ? 'gear-face' : slot === 'shoulders' ? 'gear-shoulders' : 'gear');

/**
 * Dress a rig (or any subtree holding rig pieces) in a gear set. Finds the
 * head / body / glove groups by name, and under each keeps ONE child named
 * `gear` rebuilt only when that slot's piece or the tone changes — so
 * repeated calls with the same set cost nothing. `tone` picks the primer.
 */
export function applyGear(root: Object3D, ids: readonly string[], tone: BlankTone): void {
  const set = cleanGear(ids);
  const want = new Map<GearSlot, string>();
  for (const id of set) {
    const d = gearDef(id);
    if (d) want.set(d.slot, id);
  }
  root.traverse((o) => {
    // By name for the rig's head and body; by the tag buildHand leaves for
    // any glove — your own gloves are renamed 'player-glove-*' by the
    // arena and left nameless by the pub, and neither got its cuffs.
    const tagged = o.userData.gearSlot as GearSlot | undefined;
    const slots = SLOTS_OF_NAME[o.name] ?? (tagged ? [tagged] : null);
    if (!slots) return;
    // THE WEARER'S OWN HEAD: gear on the head of a first-person rig
    // (userData.firstPerson — the arena's PlayerBodySystem flags its own
    // head) is never built. Your horns are for everyone else to see; from
    // inside the skull they would only sit in the edge of your vision —
    // and a whole bear's head would be all you saw.
    const fp = !!o.userData.firstPerson && slots.includes('face');
    const face = fp ? '' : (slots.includes('face') ? (want.get('face') ?? '') : '');
    for (const slot of slots) dressSlot(o, slot, fp ? '' : (want.get(slot) ?? ''), tone, face);
    // A worn head REPLACES the bare skull (the skull stays built — it is
    // the 'head' paint surface, and it comes back the moment the head
    // comes off).
    if (slots.includes('face')) {
      o.traverse((m) => {
        if (m.userData.paintPart === 'head') m.visible = !face;
      });
    }
  });
}

/** Build (or keep) one slot's piece under a rig group. */
function dressSlot(o: Object3D, slot: GearSlot, id: string, tone: BlankTone, face: string): void {
  const keyName = slot === 'face' ? 'faceKey' : slot === 'shoulders' ? 'shouldersKey' : 'gearKey';
  // The head gear is fitted to whatever face it sits on, so a new face is
  // a new fit.
  const key = slot === 'head' ? `${id}|${tone}|${face}` : `${id}|${tone}`;
  if (o.userData[keyName] === key) return;
  o.userData[keyName] = key;
  const old = o.getObjectByName(childName(slot));
  if (old) {
    old.removeFromParent();
    old.traverse((m) => {
      const mesh = m as Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        (mesh.material as MeshStandardMaterial).dispose?.();
      }
    });
  }
  // A head that wears its own cut of this piece (VARIANTS) builds that,
  // in its own frame: no skull refit, no HEAD_FIT.
  const variant = slot === 'head' && face ? VARIANTS[face]?.[id] : undefined;
  const build = variant ?? BUILDERS[id];
  if (!build) return;
  const side: 1 | -1 = (o.userData.gearSide as 1 | -1 | undefined) ?? (o.name.endsWith('-right') ? -1 : 1);
  const glowMat = glow();
  const accent = accentOf(o);
  if (accent !== null) {
    glowMat.color.set(accent);
    glowMat.emissive.set(accent);
  }
  const g = build(primer(tone), side, trim(tone), glowMat);
  g.name = childName(slot);
  g.userData.gear = id;
  // The head pieces were modelled on the old egg skull; refit them.
  if (slot === 'head' && !variant) g.scale.set(HEAD_SCALE[0] / EGG_SCALE[0], HEAD_SCALE[1] / EGG_SCALE[1], HEAD_SCALE[2] / EGG_SCALE[2]);
  // A PAINT SURFACE (avatar/paint.ts): the piece shares its slot's
  // canvas, laid out by THE GEAR ATLAS (avatar/gearAtlas.ts) — every
  // mesh and every face its own patch of it, so each pauldron, plate and
  // spike takes paint of its own, and a mark is placed in 3D where it
  // was aimed. Each mesh takes its own material (the bake sets a map per
  // mesh) and the piece is NOT collapsed — the merge would drop the UVs.
  // Each HAND's gear is its own surface — the right hand's is
  // 'gearHandsR' — so a pair of cuffs can be painted two ways.
  const part =
    slot === 'face'
      ? 'gearFace'
      : slot === 'head'
        ? 'gearHead'
        : slot === 'body'
          ? 'gearBody'
          : slot === 'shoulders'
            ? 'gearShoulders'
            : side === -1
              ? 'gearHandsR'
              : 'gearHands';
  const paintable: Mesh[] = [];
  g.traverse((m) => {
    const mesh = m as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = (mesh.material as MeshStandardMaterial).clone();
    // Trim keeps its own finish: no part tag, so the bake walks past it.
    if (mesh.userData.trim) return;
    mesh.userData.paintPart = part;
    mesh.userData.paintTone = tone;
    paintable.push(mesh);
  });
  // A variant is its own geometry, so its own atlas (the map is cached by key).
  const map = atlasGear(g, paintable, variant ? `${id}@${face}|${side}` : `${id}|${side}`, PAINT.canvas[part] ?? 256);
  for (const mesh of paintable) mesh.userData.paintMap = map;
  mergePiece(g); // a few draw calls per piece, not dozens (gearAtlas.ts)
  // …and onto a worn head's own skull (HEAD_FIT): every head piece was
  // modelled on the bare skull, and each animal's cranium is a different
  // size, shape and seat — a bear's is low and broad, a horse's small and
  // high between its ears, a frog's wide and flat. The fit maps the bare
  // skull onto the head's measured cranium, per axis, from a WRAPPER round
  // the piece: the piece keeps its own lift and tilt (a halo still floats
  // over the crown, a visor still sits at the brow), where the old fit
  // overwrote the piece's height with one lift and sent the halo through
  // the snout. Only AFTER the atlas: its map is measured in the piece's
  // frame and kept per piece, so it must be the same map whatever face the
  // piece first met — the mark rides out with the horn, the same mark on
  // every headset.
  const fit = slot === 'head' && !variant && HEAD_FIT[face] ? { rx: 0, ...HEAD_FIT[face], ...PIECE_FIT[face]?.[id] } : undefined;
  if (fit) {
    const w = new Group();
    w.name = g.name;
    w.userData.gear = id;
    g.name = '';
    delete g.userData.gear;
    w.scale.set(fit.s[0], fit.s[1], fit.s[2]);
    w.position.set(0, fit.y, fit.z);
    w.rotation.x = fit.rx;
    w.add(g);
    o.add(w);
    return;
  }
  o.add(g);
}

/** The gear a subtree is wearing right now (dev hooks / probes). */
export function wornGear(root: Object3D): string[] {
  const out: string[] = [];
  root.traverse((o) => {
    if ((o.name === 'gear' || o.name === 'gear-face' || o.name === 'gear-shoulders') && typeof o.userData.gear === 'string') out.push(o.userData.gear);
  });
  return out;
}
