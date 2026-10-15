/**
 * THE PAINT — the model, the wire, the locker and the bake (docs/paint.md).
 *
 * A LOOK is the base tone plus an ordered list of placed paint units —
 * stripes, dots, squares and triangles — each quantized to bytes by
 * construction (u, v, angle, len, wid all live in 0..255; colour and
 * variant are indices), so the caps ARE the validation and the same data
 * renders the same everywhere. This module owns:
 *
 *   - the Look model + localStorage persistence,
 *   - the wire form every room carries,
 *   - the locker (owned, unplaced units) and THE HAND (the unit on the ray),
 *   - the BAKE: each paint surface (meshes tagged `userData.paintPart`)
 *     gets a per-part canvas, base tone first, then every unit oldest
 *     first, uploaded ONCE as the material's map. A repaint happens only
 *     when the look changes; at runtime a painted fighter costs exactly
 *     what a blank costs.
 *
 * TRUE TO SIZE (THE CHART). The body's texture is not square on the body:
 * u runs round each ring by ANGLE, so the front of the shoulders spans
 * almost twice the metres per texel that its height does, the waist a
 * good deal less, and the skull pinches to nothing at the crown. A shape
 * drawn flat on that canvas came out stretched — dots as ovals, squares
 * as oblongs, a stripe fat in one place and thin in the next. So every
 * unit is now rasterized in METRES: each surface carries a chart of its
 * own geometry (ring size and arc length per v), every texel near a unit
 * is measured back to the unit's centre along the surface, and the shape
 * is a signed distance in those metres, antialiased by the texel's own
 * size. A dot is round wherever it lands, a stripe keeps its width round
 * the side, and a mark on the crown is a disc, not a smear. Gear and the
 * hands have no chart (their UVs are the generators' own) and keep the
 * flat canvas measure they always had.
 *
 * Front of the body sits at u = 0.75 (the lofts start on +x and wind
 * through −z at three-quarters).
 *
 * The bake keys off the material's own tone tag (`userData.paintTone`),
 * so a look bakes correctly onto the white body and the onyx body alike —
 * unpainted texels ARE the base tone.
 */

import { CanvasTexture, LinearFilter, Mesh, MeshStandardMaterial, SRGBColorSpace, type Object3D } from 'three';
import { BODY_IK, PAINT } from '../config.js';
import { BODY_RINGS, BODY_V_SPLIT, HEAD_SCALE } from './mannequin.js';
import type { GearMap } from './gearAtlas.js';

/**
 * The shapes. SPLOTCH is retired: nothing sells it, and a splotch anyone
 * already owns or wears reads as a DOT from now on (cleanUnit, loadInv) —
 * a clean mark where there was a smudge. TRIANGLE is the newest: the
 * simplest shape the kit was missing, and the one that points.
 */
export type PaintKind = 'stripe' | 'dot' | 'square' | 'triangle';
export const PAINT_KINDS: readonly PaintKind[] = ['stripe', 'dot', 'square', 'triangle'];
/** The paint surfaces: THE BLANK's head and its one body loft, the three
 *  GEAR slots (avatar/gear.ts), and YOUR HANDS (avatar/hands.ts) — the
 *  ones you punch with, which are the only part of you you look at all
 *  match. Every mesh of a worn piece shares its slot's canvas, so
 *  painting one pauldron paints its twin, and a hand's palm, fingers and
 *  cuff share one material, so a stripe lands on the whole hand — both of
 *  them. Legacy 'chest'/'pelvis' units fold into the body's v range on
 *  read, so paint made before the merge survives it. */
export type PaintPart = 'head' | 'body' | 'gearHead' | 'gearBody' | 'gearHands' | 'hand' | 'gearHandsR' | 'handR' | 'gearFace' | 'gearShoulders';
/** 'gearHands' is the LEFT hand's gear, 'gearHandsR' the right's (they
 *  were one surface, both hands wearing the same paint, until wire 6);
 *  'hand' is the LEFT hand itself and 'handR' the right (one surface
 *  until wire 7). 'gearFace' is a worn HEAD (avatar/heads.ts), and
 *  'gearShoulders' the SHOULDERS slot's pads (they were body gear, and
 *  painted on 'gearBody', until the slot split). */
export const PAINT_PARTS: readonly PaintPart[] = ['head', 'body', 'gearHead', 'gearBody', 'gearHands', 'hand', 'gearHandsR', 'handR', 'gearFace', 'gearShoulders'];

export interface PlacedPaint {
  kind: PaintKind;
  /** Index into PAINT.colours — the wire value, never a free RGB. */
  colour: number;
  /** Splotch silhouette roll (stripes: reserved for end-cap styles). */
  variant: number;
  part: PaintPart;
  /** Anchor + pose, all quantized 0..255 on the wire; floats 0..1 here. */
  u: number;
  v: number;
  /** Fraction of a full turn (0..1). */
  angle: number;
  /** Fractions of the part canvas (0..1). */
  len: number;
  wid: number;
}

export interface Look {
  paint: PlacedPaint[];
}

/* ── the store ────────────────────────────────────────────────────────── */

const KEY = 'ff2-look';
/** The saved look's shape. Before 2, a unit on GEAR meant "stamp on every
 *  mesh of the piece in its own UVs"; from 2 it is a decal placed on the
 *  gear atlas (avatar/gearAtlas.ts). Older gear units are kept as they
 *  were — flagged LEGACY_GEAR — so nobody's paint moves under them. */
const LOOK_VERSION = 5;

/** A gear surface: laid out by the atlas, painted as decals. */
export const isGearPart = (part: PaintPart): boolean =>
  part === 'gearHead' || part === 'gearBody' || part === 'gearHands' || part === 'gearHandsR' || part === 'gearFace' || part === 'gearShoulders';
/** `variant` bit: a gear unit placed before the atlas (see LOOK_VERSION). */
const LEGACY_GEAR = 0x80;
const markLegacy = (p: PlacedPaint): PlacedPaint => (isGearPart(p.part) ? { ...p, variant: p.variant | LEGACY_GEAR } : p);

/** Before the hands' gear was split (LOOK_VERSION 3, wire 6), one mark on
 *  'gearHands' was worn by BOTH hands — so an older look gets a copy of
 *  each on the right hand's surface, and reads exactly as it did. */
function splitHandGear(paint: PlacedPaint[]): PlacedPaint[] {
  const right = paint.filter((p) => p.part === 'gearHands').map((p) => ({ ...p, part: 'gearHandsR' as PaintPart }));
  return [...paint, ...right].slice(0, PAINT.maxUnits);
}

/** The same again for the hands themselves (LOOK_VERSION 4, wire 7): one
 *  mark on 'hand' was worn by both palms, so an older look gets a copy of
 *  each on the right palm's own surface. */
function splitHands(paint: PlacedPaint[]): PlacedPaint[] {
  const right = paint.filter((p) => p.part === 'hand').map((p) => ({ ...p, part: 'handR' as PaintPart }));
  return [...paint, ...right].slice(0, PAINT.maxUnits);
}

/** The pads were BODY gear until the SHOULDERS slot (LOOK_VERSION 5):
 *  their paint sat on 'gearBody'. If the body piece you were wearing was
 *  a pair of pads ('ff-gear', customization.ts), those marks move to the
 *  shoulders' own surface, so your pads keep their paint. (Anyone else's
 *  older look reads as it was — their pads just wear it bare.) */
const PADS_THAT_WERE_BODY = ['pauldrons', 'spikepads'];
function moveBodyPadPaint(paint: PlacedPaint[]): PlacedPaint[] {
  let worn = '';
  try {
    worn = localStorage.getItem('ff-gear') ?? '';
  } catch {
    /* nothing saved — nothing to move */
  }
  if (!worn.split(',').some((id) => PADS_THAT_WERE_BODY.includes(id))) return paint;
  return paint.map((p) => (p.part === 'gearBody' ? { ...p, part: 'gearShoulders' as PaintPart } : p));
}

/** Bumped on every look change — applyOwnSkins repaints when it moves. */
export const paintState = { version: 1 };

let current: Look | null = null;

const clamp01 = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/**
 * Fold a pre-merge v onto the merged body. The old CHEST occupied what is
 * now everything above the waist (v ≥ BODY_V_SPLIT) and the old PELVIS
 * everything below it, so each band is a straight rescale. Sizes are left
 * alone: the body is roughly twice the old chest's reach, so migrated
 * paint reads a little flatter — the position is what people recognise.
 */
function bandV(v: number, band: 'upper' | 'lower'): number {
  return band === 'upper' ? BODY_V_SPLIT + v * (1 - BODY_V_SPLIT) : v * BODY_V_SPLIT;
}

/** Validate one stored/received unit; null drops it (fail-soft). */
function cleanUnit(raw: unknown): PlacedPaint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  // A retired SPLOTCH comes back as a DOT of about the same reach (a
  // splotch's radius was 0.3 of its len, a dot's is 0.5).
  const splotch = r.kind === 'splotch';
  const kind = splotch ? 'dot' : (PAINT_KINDS as readonly unknown[]).includes(r.kind) ? (r.kind as PaintKind) : null;
  // 'chest'/'pelvis' are the pre-merge parts: fold them onto the body,
  // upper band and lower band, so a saved look keeps its picture.
  const legacy = r.part === 'chest' ? 'upper' : r.part === 'pelvis' ? 'lower' : null;
  const part = legacy ? 'body' : (PAINT_PARTS as readonly unknown[]).includes(r.part) ? (r.part as PaintPart) : null;
  const colour = typeof r.colour === 'number' ? Math.floor(r.colour) : -1;
  if (!kind || !part || colour < 0 || colour >= PAINT.colours.length) return null;
  return {
    kind,
    part,
    colour,
    variant: typeof r.variant === 'number' ? Math.floor(Math.abs(r.variant)) % 256 : 0,
    u: clamp01(r.u),
    v: legacy ? bandV(clamp01(r.v), legacy) : clamp01(r.v),
    angle: clamp01(r.angle),
    len: splotch ? clamp01(r.len) * 0.6 : clamp01(r.len),
    wid: clamp01(r.wid),
  };
}

export function myLook(): Look {
  if (current) return current;
  let paint: PlacedPaint[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as { v?: number; paint?: unknown[] };
    paint = (raw.paint ?? []).map(cleanUnit).filter((p): p is PlacedPaint => p !== null).slice(0, PAINT.maxUnits);
    if ((raw.v ?? 1) < 2) paint = paint.map(markLegacy);
    if ((raw.v ?? 1) < 3) paint = splitHandGear(paint);
    if ((raw.v ?? 1) < 4) paint = splitHands(paint);
    if ((raw.v ?? 1) < 5) paint = moveBodyPadPaint(paint);
  } catch {
    /* fresh body */
  }
  current = { paint };
  return current;
}

export function setLook(look: Look): void {
  current = { paint: look.paint.map(cleanUnit).filter((p): p is PlacedPaint => p !== null).slice(0, PAINT.maxUnits) };
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: LOOK_VERSION, paint: current.paint }));
  } catch {
    /* private mode — the look lives for the session */
  }
  paintState.version += 1;
}

export function clearLook(): void {
  setLook({ paint: [] });
}

/* ── the wire form (docs/paint.md §3, §5) ─────────────────────────────── */
//
// One unit is exactly 8 bytes, every field quantized by construction:
//
//   b0  kind (bits 0..2) | part index (bits 3..7 — see WIRE_PARTS)
//   b1  colour index          b2  variant
//   b3  u ·255   b4  v ·255   b5  angle ·255   b6  len ·255   b7  wid ·255
//
// A whole look is [format byte][units…], base64'd so it rides every
// JSON channel (the 1v1 `iam`, the mesh `iam`, the pub hello) as one short
// string — a maxed 64-unit look is 513 bytes / ~684 base64 chars, smaller
// than a single pose-packet burst. The receive side re-validates every
// unit through cleanUnit, so malformed or hostile data fails soft to the
// bare base tone — never to an error.

/**
 * FORMAT 4 — the TRIANGLE needed a fifth kind, so the kind takes three
 * bits and the part the five above them. Every older string still reads:
 *   v3 (four kinds, six parts): kind in bits 0..1, part in bits 2+;
 *   v2 (the merged body): kind in bit 0, part in bits 1+ over head/body;
 *   v1 (three lofts): the same layout over head/chest/pelvis — cleanUnit
 *      folds chest/pelvis onto the body's upper and lower bands.
 * A SPLOTCH in any of them reads as a dot (cleanUnit). So a look packed
 * before any of this still paints the fighter it was made for.
 */
const WIRE_FORMAT = 7;
/** Part order ON THE WIRE — append-only. */
// 'gearFace' (THE HEADS, avatar/heads.ts) is index 8: an older reader
// finds no part there and drops the unit — its fighter just wears the
// head bare, never the wrong paint. 'gearShoulders' is index 9 on the same
// law (the part takes five bits, so there is room for 32).
const WIRE_PARTS: PaintPart[] = ['head', 'body', 'gearHead', 'gearBody', 'gearHands', 'hand', 'gearHandsR', 'handR', 'gearFace', 'gearShoulders'];
/** Format 2's part order (the merged body, before gear was paintable). */
const WIRE_PARTS_V2: PaintPart[] = ['head', 'body'];
/** Format 1's part order, kept only to read looks packed before the merge. */
const WIRE_PARTS_V1 = ['head', 'chest', 'pelvis'];
/** Kind order on the wire — append-only; index 1 is the retired splotch,
 *  never written again but still read (as a dot). v1/v2 knew only the
 *  first two, in bit 0; v3 the first four, in bits 0..1. */
const WIRE_KINDS = ['stripe', 'splotch', 'dot', 'square', 'triangle'];
/** Longest base64 string unpackLook will even look at (a maxed look is ~700). */
const WIRE_MAX_CHARS = 1024;

const q255 = (n: number): number => Math.max(0, Math.min(255, Math.round(n * 255)));

/** Pack a look into its base64 wire string ('' = nothing to carry). */
export function packLook(look: Look): string {
  const units = look.paint.slice(0, PAINT.maxUnits);
  if (units.length === 0) return '';
  const bytes = new Uint8Array(1 + units.length * 8);
  bytes[0] = WIRE_FORMAT;
  units.forEach((p, i) => {
    const o = 1 + i * 8;
    bytes[o] = Math.max(0, WIRE_KINDS.indexOf(p.kind)) | (Math.max(0, WIRE_PARTS.indexOf(p.part)) << 3);
    bytes[o + 1] = Math.min(255, p.colour);
    bytes[o + 2] = p.variant % 256;
    bytes[o + 3] = q255(p.u);
    bytes[o + 4] = q255(p.v);
    bytes[o + 5] = q255(p.angle);
    bytes[o + 6] = q255(p.len);
    bytes[o + 7] = q255(p.wid);
  });
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Unpack a wire string back into a Look. ANYTHING wrong — not a string, too
 * long, bad base64, wrong format byte, truncated units, out-of-range fields —
 * quietly yields the bare base tone (docs/paint.md §5: late or bad data never
 * beats no data). Every surviving unit still passes cleanUnit.
 */
export function unpackLook(wire: unknown): Look {
  const bare: Look = { paint: [] };
  if (typeof wire !== 'string' || wire.length === 0 || wire.length > WIRE_MAX_CHARS) return bare;
  let bin: string;
  try {
    bin = atob(wire);
  } catch {
    return bare;
  }
  if (bin.length < 1 + 8 || (bin.length - 1) % 8 !== 0) return bare;
  const format = bin.charCodeAt(0);
  if (format < 1 || format > WIRE_FORMAT) return bare;
  const parts: readonly string[] = format === 1 ? WIRE_PARTS_V1 : format === 2 ? WIRE_PARTS_V2 : WIRE_PARTS;
  // FORMATS 5 and 6 are format 4's layout: 5 says the gear units are
  // atlas decals (a gear unit in anything older is flagged LEGACY_GEAR),
  // 6 that the hands' gear is split (older 'gearHands' marks are copied
  // onto the right hand too), 7 that the hands themselves are (the same
  // for 'hand').
  const kindBits = format >= 4 ? 7 : format === 3 ? 3 : 1;
  const partShift = format >= 4 ? 3 : format === 3 ? 2 : 1;
  const count = Math.min((bin.length - 1) / 8, PAINT.maxUnits);
  const paint: PlacedPaint[] = [];
  for (let i = 0; i < count; i++) {
    const o = 1 + i * 8;
    const b0 = bin.charCodeAt(o);
    const unit = cleanUnit({
      kind: WIRE_KINDS[b0 & kindBits], // out of range → undefined → dropped
      part: parts[b0 >> partShift],
      colour: bin.charCodeAt(o + 1),
      variant: bin.charCodeAt(o + 2),
      u: bin.charCodeAt(o + 3) / 255,
      v: bin.charCodeAt(o + 4) / 255,
      angle: bin.charCodeAt(o + 5) / 255,
      len: bin.charCodeAt(o + 6) / 255,
      wid: bin.charCodeAt(o + 7) / 255,
    });
    if (unit) paint.push(format < 5 ? markLegacy(unit) : unit);
  }
  const geared = format < 6 ? splitHandGear(paint) : paint;
  return { paint: format < 7 ? splitHands(geared) : geared };
}

let packedCache = { version: -1, wire: '' };

/** MY look, packed for the wire — cached per look version (the mesh `iam`
 *  rebroadcasts every 2 s; repacking each time would be pure waste). */
export function myPackedLook(): string {
  if (packedCache.version !== paintState.version) {
    packedCache = { version: paintState.version, wire: packLook(myLook()) };
  }
  return packedCache.wire;
}

/* ── HIDE PAINT (docs/paint.md §6) ────────────────────────────────────── */

const HIDE_KEY = 'ff2-hide-paint';

/** Bumped whenever a hide-paint preference flips — remote-rig bake keys fold
 *  this in so every painted body repaints on the spot. */
export const paintPrefs = { version: 1 };

let hideAll: boolean | null = null;

/** The global settings breaker: render EVERY other player's body bare.
 *  Strictly local, total defence; your own paint stays yours. */
export function paintHiddenAll(): boolean {
  if (hideAll === null) {
    try {
      hideAll = localStorage.getItem(HIDE_KEY) === '1';
    } catch {
      hideAll = false;
    }
  }
  return hideAll;
}

export function togglePaintHiddenAll(): void {
  hideAll = !paintHiddenAll();
  try {
    localStorage.setItem(HIDE_KEY, hideAll ? '1' : '0');
  } catch {
    /* session-only */
  }
  paintPrefs.version += 1;
}

/* ── the locker: owned, unplaced paint ────────────────────────────────── */

const INV_KEY = 'ff2-paint-inv';

/** Owned-but-unplaced unit counts, keyed `<kind>:<colour>`. Placing takes
 *  a unit out; lifting a placed unit puts it IN YOUR HAND, not back here —
 *  RETURN does that. Paint is never consumed (docs/paint.md §1). */
export const invState = { version: 1 };

let inv: Record<string, number> | null = null;

function loadInv(): Record<string, number> {
  if (inv) return inv;
  inv = {};
  let migrated = false;
  try {
    const raw = JSON.parse(localStorage.getItem(INV_KEY) ?? '{}') as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      // Every kind the shop has EVER sold reads back. (This read only
      // knew stripes and splotches, so every DOT and SQUARE anyone bought
      // vanished from the tray the next time the game started.)
      const m = /^(stripe|splotch|dot|square|triangle):(\d+)$/.exec(k);
      if (typeof v !== 'number' || v <= 0 || !m) continue;
      const colour = Number(m[2]);
      if (colour >= PAINT.colours.length) continue;
      // A retired SPLOTCH comes back as a DOT of its colour, one for one.
      const kind = m[1] === 'splotch' ? 'dot' : m[1];
      if (kind !== m[1]) migrated = true;
      const key = `${kind}:${colour}`;
      inv[key] = Math.min(999, (inv[key] ?? 0) + Math.floor(v));
    }
  } catch {
    /* empty locker */
  }
  if (migrated) saveInv();
  return inv;
}

function saveInv(): void {
  try {
    localStorage.setItem(INV_KEY, JSON.stringify(loadInv()));
  } catch {
    /* private mode */
  }
  invState.version += 1;
}

export function ownedCount(kind: PaintKind, colour: number): number {
  return loadInv()[`${kind}:${colour}`] ?? 0;
}

export function unitPrice(kind: PaintKind, colour: number): number {
  return PAINT.price[kind] * PAINT.tierMult[PAINT.tierOf(colour)];
}

/** Add one unit to the locker (a purchase or a grant). */
export function grantUnit(kind: PaintKind, colour: number): void {
  const store = loadInv();
  store[`${kind}:${colour}`] = (store[`${kind}:${colour}`] ?? 0) + 1;
  saveInv();
}

/** Take one unit out of the locker (into the hand). False if none owned. */
export function takeUnit(kind: PaintKind, colour: number): boolean {
  const store = loadInv();
  const k = `${kind}:${colour}`;
  if (!store[k]) return false;
  store[k] -= 1;
  if (!store[k]) delete store[k];
  saveInv();
  return true;
}

/** THE HAND — the one unit currently held on the ray in the bay, plus the
 *  live body-hover it would land on. MenuSystem drives this; the bay face
 *  reads it. */
export const bay = {
  held: null as PlacedPaint | null,
  /** Where the ray touches the body this frame (null = not on the body). */
  hover: null as { part: PaintPart; u: number; v: number } | null,
  version: 1,
};

/** A fresh unit's size, per kind — modest; the stick sizes it from here. */
const DEFAULT_LEN: Record<PaintKind, number> = { stripe: 0.3, dot: 0.12, square: 0.16, triangle: 0.16 };

/** Take a fresh unit from the locker into the hand (returns any held unit
 *  first). It keeps the pose of the last unit of its kind you placed, so a
 *  row of matching marks doesn't need re-sizing each time. */
export function handTake(kind: PaintKind, colour: number): boolean {
  if (bay.held) handReturn();
  if (!takeUnit(kind, colour)) return false;
  const last = lastPose[kind];
  bay.held = {
    kind,
    colour,
    variant: 0,
    part: 'body',
    u: 0.75,
    v: 0.5,
    angle: last?.angle ?? 0,
    len: last?.len ?? DEFAULT_LEN[kind],
    wid: last?.wid ?? (kind === 'stripe' ? 0.12 : 0.5),
  };
  bay.version += 1;
  return true;
}

/** The pose of the last unit of each kind placed (see handTake). */
const lastPose: Partial<Record<PaintKind, { angle: number; len: number; wid: number }>> = {};

/** Put the held unit back in the locker. */
export function handReturn(): void {
  if (!bay.held) return;
  grantUnit(bay.held.kind, bay.held.colour);
  bay.held = null;
  bay.version += 1;
}

/** Commit the held unit onto the body at the hovered spot. */
export function handPlace(part: PaintPart, u: number, v: number): boolean {
  if (!bay.held) return false;
  const look = myLook();
  if (look.paint.length >= PAINT.maxUnits) return false;
  const { kind, angle, len, wid } = bay.held;
  lastPose[kind] = { angle, len, wid };
  // A mark placed now is a fresh decal, whatever it was lifted as.
  setLook({ paint: [...look.paint, { ...bay.held, part, u, v, variant: 0 }] });
  bay.held = null;
  bay.version += 1;
  return true;
}

/**
 * Which placed unit is under (part, u, v): the TOPMOST one the point is
 * inside, measured on the surface in metres — else the nearest whose edge
 * is within a finger's width. -1 for none. A thin stripe is picked by its
 * outline, not by how far its centre is.
 */
export function unitAt(part: PaintPart, u: number, v: number, map?: GearMap): number {
  const look = myLook();
  if (isGearPart(part)) return map ? gearUnitAt(look, part, u, v, map) : -1;
  const chart = chartOf(part);
  const slack = 0.035 * chart.S;
  let best = -1;
  let bestD = slack;
  for (let i = look.paint.length - 1; i >= 0; i--) {
    const p = look.paint[i];
    if (p.part !== part) continue;
    const [dx, dy] = chartOffset(chart, p.u, p.v, u, v);
    const d = unitSdf(p, dx, dy, chart.S);
    if (d <= 0) return i;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Lift the placed unit under (part, u, v) back into the hand. */
export function handLift(part: PaintPart, u: number, v: number, map?: GearMap): boolean {
  if (bay.held) return false;
  const i = unitAt(part, u, v, map);
  if (i < 0) return false;
  const paint = [...myLook().paint];
  const [unit] = paint.splice(i, 1);
  setLook({ paint });
  bay.held = unit;
  bay.version += 1;
  return true;
}

/** UNDO: the most recently placed unit comes off the body and back into
 *  the locker. (Placing appends and lifting removes, so the last unit in
 *  the look is always the newest mark.) */
export function undoLast(): boolean {
  const look = myLook();
  if (!look.paint.length) return false;
  const paint = [...look.paint];
  const unit = paint.pop()!;
  setLook({ paint });
  grantUnit(unit.kind, unit.colour);
  return true;
}

/** The tutorial's graduation gift: one stripe in the contrast tone, once. */
export function grantGraduationStripe(onyxBase: boolean): void {
  try {
    if (localStorage.getItem('ff2-grad-paint') === '1') return;
    localStorage.setItem('ff2-grad-paint', '1');
  } catch {
    /* still grant in-session */
  }
  grantUnit('stripe', onyxBase ? 0 : 1); // white on onyx, black on white
}

/* ── the chart: every surface measured in metres ──────────────────────── */
//
// A chart says, for one paint surface, what ring each row of its unwrap
// is: half-width w and half-depth d (u runs round it by angle: x = w·cos,
// z = d·sin + z0), and the ring's height h. From those, any texel can be
// measured back to a unit's centre ALONG the surface: across by the arc
// round its own ring, down by the arc of its own meridian — which differs
// round the body: the top of the shoulders is a steep slope at the front
// and nearly level at the sides, so height is measured column by column.
// `S` turns a unit's len/wid (0..1 on the wire) into metres.
//
// Gear and hands carry a unit chart (w = d = 1/2π, h = v, S = 1): the
// flat canvas measure they always had, since their UVs are whatever their
// generators laid out.

interface Chart {
  /** Metres that a len/wid of 1 spans on this surface. */
  S: number;
  /** Rows sampled at v = k / n, k = 0..n (v = 0 is the bottom). */
  n: number;
  w: Float32Array;
  d: Float32Array;
  h: Float32Array;
  z: Float32Array;
}

const CHART_ROWS = 256;

function newChart(S: number, n: number): Chart {
  return { S, n, w: new Float32Array(n + 1), d: new Float32Array(n + 1), h: new Float32Array(n + 1), z: new Float32Array(n + 1) };
}

function flatChart(): Chart {
  const c = newChart(1, 2);
  for (let k = 0; k <= c.n; k++) {
    c.w[k] = c.d[k] = 1 / (2 * Math.PI);
    c.h[k] = k / c.n;
  }
  return c;
}

/** THE BODY: the one loft, rings interpolated along its own v (which the
 *  loft laid by cumulative profile arc, mannequin.ts). */
function bodyChart(): Chart {
  const rings = BODY_RINGS;
  const arc: number[] = [0];
  for (let k = 1; k < rings.length; k++) {
    const a = rings[k - 1];
    const b = rings[k];
    arc.push(arc[k - 1] + Math.hypot(b.y - a.y, (b.w + b.d - (a.w + a.d)) / 2));
  }
  const total = arc[arc.length - 1] || 1;
  // A len of 1 is 0.9 m: close to what the old flat canvas made of a mark
  // on the chest, so a look painted before the chart keeps its scale.
  const c = newChart(0.9, CHART_ROWS);
  for (let k = 0; k <= c.n; k++) {
    const at = (1 - k / c.n) * total;
    let seg = 0;
    while (seg < rings.length - 2 && arc[seg + 1] < at) seg++;
    const t = Math.max(0, Math.min(1, (at - arc[seg]) / (arc[seg + 1] - arc[seg] || 1)));
    const r0 = rings[seg];
    const r1 = rings[seg + 1];
    c.w[k] = r0.w + (r1.w - r0.w) * t;
    c.d[k] = r0.d + (r1.d - r0.d) * t;
    c.h[k] = r0.y + (r1.y - r0.y) * t;
    c.z[k] = (r0.z ?? 0) + ((r1.z ?? 0) - (r0.z ?? 0)) * t;
  }
  return c;
}

/** THE SKULL: three's sphere unwrap (θ = (1 − v)·π down from the crown,
 *  φ = u·2π round) stretched into the egg. */
function headChart(): Chart {
  const r = BODY_IK.headRadius;
  const [sx, sy, sz] = HEAD_SCALE;
  const c = newChart(0.55, CHART_ROWS);
  for (let k = 0; k <= c.n; k++) {
    const th = (1 - k / c.n) * Math.PI;
    c.w[k] = sx * r * Math.sin(th);
    c.d[k] = sz * r * Math.sin(th);
    c.h[k] = sy * r * Math.cos(th);
  }
  return c;
}

const charts = new Map<PaintPart, Chart>();
function chartOf(part: PaintPart): Chart {
  let c = charts.get(part);
  if (!c) {
    c = part === 'body' ? bodyChart() : part === 'head' ? headChart() : flatChart();
    charts.set(part, c);
  }
  return c;
}

/** The ring at any v: [w, d, h, z]. */
function ringAt(c: Chart, v: number): [number, number, number, number] {
  const f = Math.max(0, Math.min(1, v)) * c.n;
  const k = Math.min(c.n - 1, Math.floor(f));
  const t = f - k;
  const L = (a: Float32Array): number => a[k] + (a[k + 1] - a[k]) * t;
  return [L(c.w), L(c.d), L(c.h), L(c.z)];
}

/** How fast the surface runs round a ring of (w, d), metres per unit u. */
const ringSpeed = (w: number, d: number, u: number): number => {
  const t = u * Math.PI * 2;
  return Math.PI * 2 * Math.sqrt(w * w * Math.sin(t) ** 2 + d * d * Math.cos(t) ** 2);
};

/** Where the surface point (u, ring) sits, in the ring's own plane + height. */
function surfacePoint(u: number, ring: [number, number, number, number]): [number, number, number] {
  const t = u * Math.PI * 2;
  return [Math.cos(t) * ring[0], ring[2], Math.sin(t) * ring[1] + ring[3]];
}

/** Arc round a ring from u0 to u1 the short way (signed, metres). */
function ringArc(w: number, d: number, u0: number, u1: number): number {
  let du = u1 - u0;
  du -= Math.round(du);
  const steps = 24;
  let sum = 0;
  for (let i = 0; i < steps; i++) sum += ringSpeed(w, d, u0 + (du * (i + 0.5)) / steps);
  return (sum / steps) * du;
}

/** Arc down the meridian at u from v0 to v1 (signed: + is downward). */
function meridianArc(c: Chart, u: number, v0: number, v1: number): number {
  const steps = 24;
  let sum = 0;
  let prev = surfacePoint(u, ringAt(c, v0));
  for (let i = 1; i <= steps; i++) {
    const p = surfacePoint(u, ringAt(c, v0 + ((v1 - v0) * i) / steps));
    sum += Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
    prev = p;
  }
  return v1 < v0 ? sum : -sum;
}

/** (u, v) measured from a unit's centre (u0, v0) on the surface, metres:
 *  across along the ring at v, down the meridian at u. */
function chartOffset(c: Chart, u0: number, v0: number, u: number, v: number): [number, number] {
  const [w, d] = ringAt(c, v);
  return [ringArc(w, d, u0, u), meridianArc(c, u, v0, v)];
}

/* ── the shapes, as signed distances (metres; x across, y down) ───────── */

/** The shape's extent in metres, by kind: [length, thickness]. */
function unitSize(p: PlacedPaint, S: number): [number, number] {
  switch (p.kind) {
    case 'stripe':
      return [Math.max(0.01, p.len * S), Math.max(0.004, p.wid * S * 0.35)];
    case 'dot':
      return [Math.max(0.006, p.len * S * 0.5), 0];
    case 'square':
      return [Math.max(0.01, p.len * S * 0.6), 0];
    default:
      return [Math.max(0.012, p.len * S * 0.75), 0];
  }
}

/** Distance from (dx, dy) — already measured from the unit's centre — to
 *  the unit's edge; ≤ 0 is inside. */
function unitSdf(p: PlacedPaint, dx: number, dy: number, S: number): number {
  const a = p.angle * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return shapeSdf(p.kind, unitSize(p, S), dx * c + dy * s, -dx * s + dy * c);
}

function shapeSdf(kind: PaintKind, size: [number, number], x: number, y: number): number {
  const L = size[0];
  if (kind === 'dot') return Math.sqrt(x * x + y * y) - L;
  if (kind === 'stripe') {
    // A capsule: rounded ends, the old roundRect's.
    const r = size[1] / 2;
    const qx = Math.max(Math.abs(x) - Math.max(L / 2 - r, 0), 0);
    return Math.sqrt(qx * qx + y * y) - r;
  }
  if (kind === 'square') {
    // Cut, not sprayed: a hair of corner radius.
    const rr = L * 0.06;
    const h = L / 2 - rr;
    const qx = Math.abs(x) - h;
    const qy = Math.abs(y) - h;
    const ox = Math.max(qx, 0);
    const oy = Math.max(qy, 0);
    return Math.sqrt(ox * ox + oy * oy) + Math.min(Math.max(qx, qy), 0) - rr;
  }
  // TRIANGLE: equilateral, point UP (y runs down), centred on its
  // centroid, the corners eased a touch so it reads as cut card.
  const rr = L * 0.05;
  const r = L / 2 - rr * 1.7;
  const k = 1.7320508;
  let px = Math.abs(x) - r;
  let py = -y + r / k;
  if (px + k * py > 0) {
    const nx = (px - k * py) / 2;
    py = (-k * px - py) / 2;
    px = nx;
  }
  px -= Math.max(-2 * r, Math.min(0, px));
  return -Math.sqrt(px * px + py * py) * Math.sign(py) - rr;
}

/** Half-extents of the shape's box before it is turned: [across, down]. */
function unitBox(p: PlacedPaint, S: number): [number, number] {
  const [L, T] = unitSize(p, S);
  switch (p.kind) {
    case 'stripe':
      return [L / 2, T / 2];
    case 'dot':
      return [L, L];
    case 'square':
      return [L / 2, L / 2];
    default:
      return [L / 2, L * 0.6];
  }
}

/** The farthest any part of the shape reaches from its centre. */
function unitReach(p: PlacedPaint, S: number): number {
  const [L, T] = unitSize(p, S);
  switch (p.kind) {
    case 'stripe':
      return L / 2 + T / 2;
    case 'dot':
      return L;
    case 'square':
      return L * 0.71;
    default:
      return L * 0.6;
  }
}

/* ── the raster ───────────────────────────────────────────────────────── */

/** A chart laid onto one canvas size: at every texel centre, X (arc
 *  round its ring from u = 0) and Y (arc down its column's meridian from
 *  the top), plus each row's circumference. Built once per part and size,
 *  kept for the session. */
interface Grid {
  part: PaintPart;
  W: number;
  H: number;
  x: Float32Array;
  y: Float32Array;
  c: Float32Array;
  /** The largest texel on the sheet, metres — the antialiasing margin. */
  maxTexel: number;
}

const grids = new Map<string, Grid>();
function gridOf(part: PaintPart, W: number, H: number): Grid {
  const key = `${part}|${W}x${H}`;
  let g = grids.get(key);
  if (g) return g;
  const chart = chartOf(part);
  const x = new Float32Array(W * H);
  const y = new Float32Array(W * H);
  const c = new Float32Array(H);
  const rings: [number, number, number, number][] = [];
  for (let j = 0; j < H; j++) rings.push(ringAt(chart, 1 - (j + 0.5) / H));
  let maxTexel = 0;
  for (let j = 0; j < H; j++) {
    const [w, d] = rings[j];
    let acc = 0;
    for (let i = 0; i < W; i++) {
      const sp = ringSpeed(w, d, (i + 0.5) / W) / W;
      x[j * W + i] = acc + sp / 2;
      acc += sp;
      if (sp > maxTexel) maxTexel = sp;
    }
    c[j] = acc;
  }
  const top = ringAt(chart, 1);
  for (let i = 0; i < W; i++) {
    const u = (i + 0.5) / W;
    let prev = surfacePoint(u, top);
    let acc = 0;
    for (let j = 0; j < H; j++) {
      const p = surfacePoint(u, rings[j]);
      const step = Math.hypot(p[0] - prev[0], p[1] - prev[1], p[2] - prev[2]);
      acc += step;
      y[j * W + i] = acc;
      prev = p;
      if (j > 0 && step > maxTexel) maxTexel = step;
    }
  }
  g = { part, W, H, x, y, c, maxTexel };
  grids.set(key, g);
  return g;
}

/** Y (down column i's meridian) at a fractional v. */
function yAt(g: Grid, i: number, v: number): number {
  const f = Math.max(0, Math.min(g.H - 1, (1 - v) * g.H - 0.5));
  const j = Math.min(g.H - 2, Math.floor(f));
  const t = f - j;
  const a = g.y[j * g.W + i];
  return a + (g.y[(j + 1) * g.W + i] - a) * t;
}

/** X at a fractional u in row j, wrapping past the seam. */
function xAt(g: Grid, j: number, u: number): number {
  const f = u * g.W - 0.5;
  const i = Math.floor(f);
  const t = f - i;
  const row = j * g.W;
  const C = g.c[j];
  const at = (k: number): number => (k < 0 ? g.x[row + k + g.W] - C : k >= g.W ? g.x[row + k - g.W] + C : g.x[row + k]);
  return at(i) + (at(i + 1) - at(i)) * t;
}

const rgbOf = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];

/**
 * Rasterize one unit into an RGBA buffer laid out on `g`. Every texel the
 * unit could reach is measured back to its centre along the surface and
 * covered by its signed distance, antialiased over the texel's own size.
 * `alpha` < 1 is the ghost: the held unit, not yet placed.
 */
function rasterUnit(data: Uint8ClampedArray, g: Grid, S: number, p: PlacedPaint, alpha = 1): void {
  const [cr, cg, cb] = rgbOf(PAINT.colours[p.colour] ?? 0xffffff);
  const reach = unitReach(p, S) + g.maxTexel * 1.5;
  const size = unitSize(p, S);
  const kind = p.kind;
  const a = p.angle * Math.PI * 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const { W, H, x: X, y: Y, c: Cs } = g;
  const ic = Math.min(W - 1, Math.max(0, Math.floor(p.u * W)));
  // The centre's own row on its own meridian; rows further than reach
  // (with slack for meridians that run longer than the centre's) are out.
  const yc = yAt(g, ic, p.v);
  // Each column's Y at the centre's v, computed once per column touched.
  const y0 = new Float32Array(W).fill(NaN);
  const shade = (j: number, i: number, dx: number): void => {
    const k = j * W + i;
    let yy = y0[i];
    if (yy !== yy) yy = y0[i] = yAt(g, i, p.v);
    const dy = Y[k] - yy;
    const lx = dx * ca + dy * sa;
    const ly = -dx * sa + dy * ca;
    const d = shapeSdf(kind, size, lx, ly);
    // Antialias over this texel: its width round the ring, its height
    // down the meridian.
    const tx = (i + 1 < W ? X[k + 1] : Cs[j] + X[j * W]) - X[k];
    const ty = j + 1 < H ? Y[k + W] - Y[k] : Y[k] - Y[k - W];
    const px = Math.max(tx, ty, 1e-5);
    const cov = Math.min(1, 0.5 - d / px) * alpha;
    if (cov <= 0) return;
    const o = k * 4;
    data[o] += (cr - data[o]) * cov;
    data[o + 1] += (cg - data[o + 1]) * cov;
    data[o + 2] += (cb - data[o + 2]) * cov;
  };
  // THE ROW BAND: the turned box, cut by this row, is an interval of dx.
  // Long thin shapes (a stripe down the spine) would otherwise scan a
  // disc as wide as they are long.
  const [ex, ey] = unitBox(p, S);
  const slack = g.maxTexel * 2 + reach * 0.04;
  const band = (dy: number): [number, number] => {
    let lo = -Infinity;
    let hi = Infinity;
    // |lx| ≤ ex, lx = dx·ca + dy·sa;  |ly| ≤ ey, ly = −dx·sa + dy·ca.
    const cut = (k: number, off: number, e: number): void => {
      if (Math.abs(k) < 1e-6) {
        if (Math.abs(off) > e + slack) lo = Infinity;
        return;
      }
      const a0 = (-e - slack - off) / k;
      const a1 = (e + slack - off) / k;
      lo = Math.max(lo, Math.min(a0, a1));
      hi = Math.min(hi, Math.max(a0, a1));
    };
    cut(ca, dy * sa, ex);
    cut(-sa, dy * ca, ey);
    return [lo, hi];
  };
  for (let j = 0; j < H; j++) {
    const dyc = Y[j * W + ic] - yc;
    if (Math.abs(dyc) > reach * 1.6) continue;
    const [lo, hi] = band(dyc);
    if (lo > hi) continue;
    const C = Cs[j];
    const row = j * W;
    const x0 = xAt(g, j, p.u);
    if (2 * reach >= C) {
      // The whole ring is in reach (a mark round the neck, the crown).
      for (let i = 0; i < W; i++) {
        let dx = X[row + i] - x0;
        dx -= Math.round(dx / C) * C;
        if (dx >= lo && dx <= hi) shade(j, i, dx);
      }
      continue;
    }
    // Otherwise walk out from the centre column each way until past the band.
    for (let s = 0; s < W; s++) {
      const ii = ic + s;
      const i = ii % W;
      const dx = X[row + i] + Math.floor(ii / W) * C - x0;
      if (dx > hi || dx > reach) break;
      if (dx >= lo) shade(j, i, dx);
    }
    for (let s = 1; s < W; s++) {
      const ii = ic - s;
      const i = ((ii % W) + W) % W;
      const dx = X[row + i] - (ii < 0 ? C : 0) - x0;
      if (dx < lo || dx < -reach) break;
      if (dx <= hi) shade(j, i, dx);
    }
  }
}

/** What a bare canvas is filled with before the units land: the BLANK's
 *  two primer tones. A surface whose rest colour is not a primer — the
 *  HANDS, which are dark steel and re-tint with the skin — carries its own
 *  fill on the material (`userData.paintFill`, avatar/hands.ts +
 *  avatar/skins.ts) so an unpainted one bakes out exactly as it was
 *  built. */
const TONE_FILL: Record<string, string> = { white: '#f4f2ee', onyx: '#17171a' };

/** Bake one part of a look into a fresh RGBA buffer, W × H. */
function bakePart(look: Look, part: PaintPart, fill: string, W: number, H: number): ImageData {
  const g = gridOf(part, W, H);
  const img = new ImageData(W, H);
  const [r, gg, b] = rgbOf(parseInt(fill.replace('#', ''), 16) || 0);
  // One word per texel (RGBA bytes, little-endian) — a fill, not a loop.
  new Uint32Array(img.data.buffer).fill(((255 << 24) | (b << 16) | (gg << 8) | r) >>> 0);
  const S = chartOf(part).S;
  for (const p of look.paint) if (p.part === part) rasterUnit(img.data, g, S, p);
  return img;
}

/* ── gear: decals on the atlas ────────────────────────────────────────── */
//
// A gear unit's (u, v) is the atlas texel the ray hit. Its centre is that
// texel's surface point, its plane the surface there; every texel whose
// surface point lies inside the shape's outline in that plane — and faces
// the same way, and is not on the far side of the piece — takes the ink.
// Sizes are metres: a len of 1 is GEAR_S.

const GEAR_S = 0.2;

/** The nearest texel with surface under it, or -1. */
function texelNear(map: GearMap, u: number, v: number): number {
  const i0 = Math.min(map.W - 1, Math.max(0, Math.floor(u * map.W)));
  const j0 = Math.min(map.H - 1, Math.max(0, Math.floor((1 - v) * map.H)));
  for (let r = 0; r <= 4; r++) {
    for (let dj = -r; dj <= r; dj++) {
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = i0 + di;
        const j = j0 + dj;
        if (i < 0 || j < 0 || i >= map.W || j >= map.H) continue;
        if (map.ts[j * map.W + i] > 0) return j * map.W + i;
      }
    }
  }
  return -1;
}

/** A decal's frame at texel k: origin, normal, and the turned across/down
 *  axes in the surface's plane ("up" is the piece's +y, or its front where
 *  the surface faces straight up or down). */
interface DecalFrame {
  o: [number, number, number];
  n: [number, number, number];
  x: [number, number, number];
  y: [number, number, number];
}

function decalFrame(map: GearMap, k: number, angle: number): DecalFrame {
  const o: [number, number, number] = [map.pos[k * 3], map.pos[k * 3 + 1], map.pos[k * 3 + 2]];
  const n: [number, number, number] = [map.nrm[k * 3], map.nrm[k * 3 + 1], map.nrm[k * 3 + 2]];
  let up: [number, number, number] = Math.abs(n[1]) > 0.92 ? [0, 0, -1] : [0, 1, 0];
  const d = up[0] * n[0] + up[1] * n[1] + up[2] * n[2];
  up = [up[0] - n[0] * d, up[1] - n[1] * d, up[2] - n[2] * d];
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  up = [up[0] / ul, up[1] / ul, up[2] / ul];
  // across = n × up; down = −up.
  const ac: [number, number, number] = [n[1] * up[2] - n[2] * up[1], n[2] * up[0] - n[0] * up[2], n[0] * up[1] - n[1] * up[0]];
  const a = angle * Math.PI * 2;
  const c = Math.cos(a);
  const s = Math.sin(a);
  // Turned the way unitSdf turns a body unit: lx = dx·c + dy·s, ly = −dx·s + dy·c.
  const x: [number, number, number] = [ac[0] * c - up[0] * s, ac[1] * c - up[1] * s, ac[2] * c - up[2] * s];
  const y: [number, number, number] = [-ac[0] * s - up[0] * c, -ac[1] * s - up[1] * c, -ac[2] * s - up[2] * c];
  return { o, n, x, y };
}

/** How far off the plane (metres) a texel may be and still take the mark:
 *  enough to wrap a curved piece, not enough to reach its far side. */
const decalDepth = (reach: number): number => reach * 0.6 + 0.004;

function rasterGearUnit(data: Uint8ClampedArray, map: GearMap, p: PlacedPaint, alpha = 1): void {
  if (p.variant & LEGACY_GEAR) return rasterLegacyGear(data, map, p, alpha);
  const c = texelNear(map, p.u, p.v);
  if (c < 0) return;
  const f = decalFrame(map, c, p.angle);
  const size = unitSize(p, GEAR_S);
  const reach = unitReach(p, GEAR_S);
  const r2 = (reach + 0.004) ** 2;
  const depth = decalDepth(reach);
  const [cr, cg, cb] = rgbOf(PAINT.colours[p.colour] ?? 0xffffff);
  const { pos, nrm, ts } = map;
  for (let k = 0; k < ts.length; k++) {
    const t = ts[k];
    if (t <= 0) continue;
    const dx = pos[k * 3] - f.o[0];
    const dy = pos[k * 3 + 1] - f.o[1];
    const dz = pos[k * 3 + 2] - f.o[2];
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (Math.abs(dx * f.n[0] + dy * f.n[1] + dz * f.n[2]) > depth) continue;
    const facing = nrm[k * 3] * f.n[0] + nrm[k * 3 + 1] * f.n[1] + nrm[k * 3 + 2] * f.n[2];
    if (facing < 0.1) continue;
    const lx = dx * f.x[0] + dy * f.x[1] + dz * f.x[2];
    const ly = dx * f.y[0] + dy * f.y[1] + dz * f.y[2];
    const d = shapeSdf(p.kind, size, lx, ly);
    const cov = Math.min(1, 0.5 - d / t) * alpha * Math.min(1, facing * 5);
    if (cov <= 0) continue;
    const o = k * 4;
    data[o] += (cr - data[o]) * cov;
    data[o + 1] += (cg - data[o + 1]) * cov;
    data[o + 2] += (cb - data[o + 2]) * cov;
  }
}

/** A gear mark made before the atlas: stamped flat on EVERY island in its
 *  own UVs, as it always was, so an old look reads the same. */
function rasterLegacyGear(data: Uint8ClampedArray, map: GearMap, p: PlacedPaint, alpha: number): void {
  const [cr, cg, cb] = rgbOf(PAINT.colours[p.colour] ?? 0xffffff);
  const a = p.angle * Math.PI * 2;
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  for (const [rx, ry, rw, rh] of map.rects) {
    const S = rw * map.W; // the island's cell was the whole canvas, once
    const size = unitSize(p, S);
    const reach = unitReach(p, S) + 1;
    const cx = (rx + p.u * rw) * map.W;
    const cy = (1 - (ry + p.v * rh)) * map.H;
    const x0 = Math.max(Math.floor(rx * map.W), Math.floor(cx - reach));
    const x1 = Math.min(Math.ceil((rx + rw) * map.W) - 1, Math.ceil(cx + reach));
    const y0 = Math.max(Math.floor((1 - ry - rh) * map.H), Math.floor(cy - reach));
    const y1 = Math.min(Math.ceil((1 - ry) * map.H) - 1, Math.ceil(cy + reach));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const dx = i + 0.5 - cx;
        const dy = j + 0.5 - cy;
        const d = shapeSdf(p.kind, size, dx * ca + dy * sa, -dx * sa + dy * ca);
        const cov = Math.min(1, 0.5 - d) * alpha;
        if (cov <= 0) continue;
        const o = (j * map.W + i) * 4;
        data[o] += (cr - data[o]) * cov;
        data[o + 1] += (cg - data[o + 1]) * cov;
        data[o + 2] += (cb - data[o + 2]) * cov;
      }
    }
  }
}

/** Bake one gear piece's canvas: the fill, then every unit on its part. */
function bakeGear(look: Look, part: PaintPart, fill: string, map: GearMap): ImageData {
  const img = new ImageData(map.W, map.H);
  const [r, g, b] = rgbOf(parseInt(fill.replace('#', ''), 16) || 0);
  new Uint32Array(img.data.buffer).fill(((255 << 24) | (b << 16) | (g << 8) | r) >>> 0);
  for (const p of look.paint) if (p.part === part) rasterGearUnit(img.data, map, p);
  return img;
}

/** unitAt for a gear surface: by the decal's outline in 3D, topmost first;
 *  an old stamped mark by its outline on the island under the point. */
function gearUnitAt(look: Look, part: PaintPart, u: number, v: number, map: GearMap): number {
  const k = texelNear(map, u, v);
  if (k < 0) return -1;
  const P = [map.pos[k * 3], map.pos[k * 3 + 1], map.pos[k * 3 + 2]];
  const N = [map.nrm[k * 3], map.nrm[k * 3 + 1], map.nrm[k * 3 + 2]];
  let best = -1;
  let bestD = 0.006;
  for (let i = look.paint.length - 1; i >= 0; i--) {
    const p = look.paint[i];
    if (p.part !== part) continue;
    let d = Infinity;
    if (p.variant & LEGACY_GEAR) {
      for (const [rx, ry, rw, rh] of map.rects) {
        if (u < rx || u > rx + rw || v < ry || v > ry + rh) continue;
        const S = rw * map.W;
        const a = p.angle * Math.PI * 2;
        const dx = ((u - rx) / rw - p.u) * S;
        const dy = -((v - ry) / rh - p.v) * S;
        // Pixels on the island, as metres at the texel's own size.
        d = shapeSdf(p.kind, unitSize(p, S), dx * Math.cos(a) + dy * Math.sin(a), -dx * Math.sin(a) + dy * Math.cos(a)) * map.ts[k];
        break;
      }
    } else {
      const c = texelNear(map, p.u, p.v);
      if (c < 0) continue;
      const f = decalFrame(map, c, p.angle);
      const dx = P[0] - f.o[0];
      const dy = P[1] - f.o[1];
      const dz = P[2] - f.o[2];
      if (N[0] * f.n[0] + N[1] * f.n[1] + N[2] * f.n[2] < 0.1) continue;
      if (Math.abs(dx * f.n[0] + dy * f.n[1] + dz * f.n[2]) > decalDepth(unitReach(p, GEAR_S))) continue;
      d = shapeSdf(p.kind, unitSize(p, GEAR_S), dx * f.x[0] + dy * f.x[1] + dz * f.x[2], dx * f.y[0] + dy * f.y[1] + dz * f.y[2]);
    }
    if (d <= 0) return i;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

interface PaintStore {
  canvas: HTMLCanvasElement;
  tex: CanvasTexture;
  /** The committed look's bake — the ghost draws over a copy of it. */
  base: ImageData | null;
  /** The ghost's working buffer, reused frame to frame. */
  scratch: ImageData | null;
  /** True while this canvas shows a ghost rather than `base`. */
  ghost: boolean;
}

function storeFor(mesh: Mesh, part: PaintPart): PaintStore {
  let store = mesh.userData.paintStore as PaintStore | undefined;
  if (!store) {
    const size = PAINT.canvas[part] ?? 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    // The body is seen edge-on round its sides; a little anisotropy keeps
    // the paint's edges from going to mush there.
    tex.anisotropy = 4;
    // A gear canvas is an atlas of little cells: mip levels would bleed
    // one cell into the next, so it filters flat.
    if (mesh.userData.paintMap) {
      tex.generateMipmaps = false;
      tex.minFilter = LinearFilter;
    }
    store = { canvas, tex, base: null, scratch: null, ghost: false };
    mesh.userData.paintStore = store;
  }
  return store;
}

/**
 * Bake `look` onto every paint surface under `root`. Cheap enough to call
 * on every look change; call it only then — never per frame (the ghost
 * has its own path, applyGhost).
 */
export function applyLook(root: Object3D, look: Look): void {
  const memo = new Map<string, ImageData>();
  root.traverse((o) => {
    const part = o.userData?.paintPart as PaintPart | undefined;
    if (!part) return;
    const mesh = o as Mesh;
    if (Array.isArray(mesh.material)) return;
    const mat = mesh.material as MeshStandardMaterial;
    const store = storeFor(mesh, part);
    const size = store.canvas.width;
    const tone = (mesh.userData.paintTone as string) ?? 'white';
    const fill = (mat.userData?.paintFill as string) ?? TONE_FILL[tone] ?? TONE_FILL.white;
    const map = mesh.userData.paintMap as GearMap | undefined;
    const key = `${part}|${fill}|${size}|${map?.key ?? ''}`;
    let img = memo.get(key);
    if (!img) {
      img = map ? bakeGear(look, part, fill, map) : bakePart(look, part, fill, size, size);
      memo.set(key, img);
    }
    store.base = img;
    store.ghost = false;
    store.canvas.getContext('2d')!.putImageData(img, 0, 0);
    const painted = look.paint.some((p) => p.part === part);
    // PAINT ON METAL. A near-mirror surface has almost no diffuse, so a
    // stripe laid on a hand's steel would read as a faint tint of a
    // reflection and nothing more. Where paint actually lands, the finish
    // steps toward one that can carry it — never past the surface's own
    // metalness, so a matte primer body is untouched — and steps back the
    // moment the last unit is lifted.
    const metal0 = (mesh.userData.paintMetal0 as number | undefined) ?? mat.metalness;
    mesh.userData.paintMetal0 = metal0;
    mat.metalness = painted ? Math.min(metal0, PAINT.metalness) : metal0;
    store.tex.needsUpdate = true;
    // The map carries ALL the colour now (base tone included), so the
    // material tint steps aside — sheen/roughness stay the tone's own.
    if (mat.map !== store.tex) {
      mat.map = store.tex;
      mat.color.set(0xffffff);
      mat.needsUpdate = true;
    }
  });
}

/** How solid the held unit reads before it is placed. */
const GHOST_ALPHA = 0.78;

/**
 * THE GHOST: show `unit` (the one in the hand) over the committed look on
 * the surfaces of its part under `root`, or wipe it (null). Only the
 * canvases of that one part are touched — a copy of the committed bake
 * plus one shape — so it is cheap enough to run every frame the ray moves,
 * where re-baking the whole look (every part, every unit) was not.
 * Surfaces still showing an old ghost get their committed bake back.
 */
export function applyGhost(root: Object3D, unit: PlacedPaint | null): void {
  root.traverse((o) => {
    const part = o.userData?.paintPart as PaintPart | undefined;
    if (!part) return;
    const store = o.userData.paintStore as PaintStore | undefined;
    if (!store?.base) return;
    const g2d = store.canvas.getContext('2d')!;
    if (unit && unit.part === part) {
      const W = store.canvas.width;
      const H = store.canvas.height;
      if (!store.scratch || store.scratch.width !== W) store.scratch = new ImageData(W, H);
      store.scratch.data.set(store.base.data);
      const map = o.userData.paintMap as GearMap | undefined;
      if (map) rasterGearUnit(store.scratch.data, map, unit, GHOST_ALPHA);
      else rasterUnit(store.scratch.data, gridOf(part, W, H), chartOf(part).S, unit, GHOST_ALPHA);
      g2d.putImageData(store.scratch, 0, 0);
      store.ghost = true;
      store.tex.needsUpdate = true;
    } else if (store.ghost) {
      g2d.putImageData(store.base, 0, 0);
      store.ghost = false;
      store.tex.needsUpdate = true;
    }
  });
}

/* ── the record (P4): the painting as a picture and as words ──────────── */
//
// The profile card (and anything else that shows a player's name) can show
// the painting BEHIND the name: a flat render of the front of the part they
// painted most, straight from the same bake the body uses — the banner IS
// their paint, not a swatch of it. And the gazette gets the look as WORDS:
// the palette's names for their most-used colours.

/** Bake one part of a look flat (no mesh) — the unwrap as a picture. */
function bakeFlat(look: Look, part: PaintPart, tone: 'white' | 'onyx', size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  canvas.getContext('2d')!.putImageData(bakePart(look, part, TONE_FILL[tone], size, size), 0, 0);
  return canvas;
}

const bannerCache = new Map<string, HTMLCanvasElement | null>();

/**
 * A banner of this look for a profile card: the FRONT of the most-painted
 * part (u 0.5..1 of the unwrap — the face you'd see squaring up to them),
 * mid-band of v so it reads as a chest, not a squashed whole loft. Null for
 * an unpainted look — the card stays clean. `tone` takes the skin id
 * ('blank'/'onyx'). Cached per look; the repaint-key discipline applies.
 */
export function paintBanner(wire: string, tone: string, w = 400, h = 120): HTMLCanvasElement | null {
  if (!wire) return null;
  const key = `${tone}|${w}x${h}|${wire}`;
  const hit = bannerCache.get(key);
  if (hit !== undefined) return hit;
  const look = unpackLook(wire);
  let out: HTMLCanvasElement | null = null;
  if (look.paint.length) {
    // The body if it carries any paint, else the head, else whatever gear
    // surface got painted — the banner shows the most-representative part.
    const counts: Partial<Record<PaintPart, number>> = {};
    for (const p of look.paint) counts[p.part] = (counts[p.part] ?? 0) + 1;
    const part: PaintPart = (counts.body ?? 0) > 0 ? 'body' : (counts.head ?? 0) > 0 ? 'head' : look.paint[0].part;
    const size = PAINT.canvas[part] ?? 256;
    const flat = bakeFlat(look, part, tone === 'onyx' ? 'onyx' : 'white', size);
    out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d')!.drawImage(flat, size * 0.5, size * 0.2, size * 0.5, size * 0.6, 0, 0, w, h);
  }
  if (bannerCache.size > 24) bannerCache.clear();
  bannerCache.set(key, out);
  return out;
}

/** The look as words — its most-used colours by the palette's own names,
 *  heaviest first (e.g. ['EMBER', 'CYAN', 'GOLD LEAF']). */
export function paintColourNames(wire: string, max = 3): string[] {
  const tally = new Map<number, number>();
  for (const p of unpackLook(wire).paint) tally.set(p.colour, (tally.get(p.colour) ?? 0) + 1);
  return [...tally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => PAINT.colourNames[c] ?? '')
    .filter((n) => n !== '');
}

/* ── the demo look (dev + probes: prove the pipeline makes cool art) ──── */

export function demoLook(): Look {
  const s = (part: PaintPart, u: number, v: number, angle: number, len: number, wid: number, colour: number): PlacedPaint => ({
    kind: 'stripe', part, u, v, angle, len, wid, colour, variant: 0,
  });
  const unit = (kind: PaintKind, part: PaintPart, u: number, v: number, angle: number, len: number, colour: number): PlacedPaint => ({
    kind, part, u, v, angle, len, wid: 0.5, colour, variant: 0,
  });
  return {
    paint: [
      // Twin racing stripes down the body's front (front = u 0.75).
      s('body', 0.72, 0.708, 0.25, 0.62, 0.085, 9), // ember
      s('body', 0.78, 0.708, 0.25, 0.62, 0.085, 9),
      s('body', 0.75, 0.708, 0.25, 0.66, 0.027, 1), // the black pin between
      // A gold sash crossing them.
      s('body', 0.75, 0.798, 0.12, 0.34, 0.053, 20),
      // Shoulder chevrons, cyan.
      s('body', 0.58, 0.904, 0.1, 0.16, 0.074, 11),
      s('body', 0.92, 0.904, 0.9, 0.16, 0.074, 11),
      // The visor band across the face, cyan over a magenta underline.
      s('head', 0.75, 0.56, 0.0, 0.4, 0.12, 11),
      s('head', 0.75, 0.49, 0.0, 0.34, 0.05, 10),
      // Hip dots — magenta and lime flanks, ember low on the front.
      unit('dot', 'body', 0.02, 0.258, 0, 0.25, 10),
      unit('dot', 'body', 0.48, 0.258, 0, 0.25, 13),
      unit('dot', 'body', 0.75, 0.141, 0, 0.18, 9),
      // A crown dot on the skull — round, however much the unwrap pinches.
      unit('dot', 'head', 0.75, 0.97, 0, 0.14, 20),
      // A signal-red DOT on the sternum, a black SQUARE spun 45° on the
      // belly, a volt TRIANGLE pointing down it, and a gold dot on
      // whatever's bolted to the head (so the gear surface is exercised).
      unit('dot', 'body', 0.75, 0.86, 0, 0.12, 19),
      unit('square', 'body', 0.75, 0.6, 0.125, 0.16, 1),
      unit('triangle', 'body', 0.75, 0.47, 0.5, 0.14, 17),
      unit('dot', 'gearHead', 0.5, 0.5, 0, 0.4, 20),
    ],
  };
}

/** Dev/test hook — rides the __ff2 namespace installed by the wrap. */
export function installPaintDevHook(): void {
  const hook = window.__ff2 as (typeof window.__ff2 & { paint?: unknown }) | undefined;
  if (!hook) return;
  hook.paint = {
    demo: (): void => setLook(demoLook()),
    clear: (): void => clearLook(),
    count: (): number => myLook().paint.length,
    set: (look: Look): void => setLook(look),
    // THE BAY, headless: the same ops the controllers drive.
    grant: (kind: PaintKind, colour: number): void => grantUnit(kind, colour),
    owned: (kind: PaintKind, colour: number): number => ownedCount(kind, colour),
    take: (kind: PaintKind, colour: number): boolean => handTake(kind, colour),
    place: (part: PaintPart, u: number, v: number): boolean => handPlace(part, u, v),
    lift: (part: PaintPart, u: number, v: number): boolean => handLift(part, u, v),
    /** Which placed unit (index) is under a point, or -1. */
    at: (part: PaintPart, u: number, v: number): number => unitAt(part, u, v),
    /** One part of the look baked flat, as a PNG data URL — probes eyeball
     *  the chart (round dots, even stripes) straight off the unwrap. */
    flat: (part: PaintPart, tone = 'white'): string => bakeFlat(myLook(), part, tone === 'onyx' ? 'onyx' : 'white', PAINT.canvas[part] ?? 256).toDataURL(),
    ret: (): void => handReturn(),
    undo: (): boolean => undoLast(),
    held: (): PlacedPaint | null => bay.held,
    // P3 wire verbs, for the headless channel probes.
    pack: (): string => myPackedLook(),
    unpack: (wire: unknown): Look => unpackLook(wire),
    hideAll: (): boolean => paintHiddenAll(),
    toggleHide: (): void => togglePaintHiddenAll(),
    // P4 record verbs: the look as words and as a banner (PNG data URL,
    // '' for an unpainted look — probes save it and eyeball the painting).
    names: (wire: string): string[] => paintColourNames(wire),
    banner: (wire: string, tone: string): string => paintBanner(wire, tone)?.toDataURL() ?? '',
  };
}
