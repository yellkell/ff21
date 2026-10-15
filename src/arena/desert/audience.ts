/**
 * AUDIENCE GROUND (DESIGN §3.2, phase 6) — the terraces the watchers stand
 * on: standing tiers outside the cage line, in the dark beyond the
 * fighters' light, with clean sightlines onto the platforms.
 *
 * A BANK is an arc of two stepped tiers — dark steel risers on a plate
 * floor, a rail along each tier's lip on stanchions, the rail's cap a
 * hazard-amber strip that reads across the flats — placed by the sites
 * (sites.ts) on the flanks of each fighting site, where the cage wall
 * (config.ARENA_BOUNDS) ends. Empty until the audience travels with the
 * squad; the ground is here first so the arenas are designed around the
 * watchers from the start.
 */

import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, Object3D } from 'three';
import { collapseStatic } from '../merge.js';

const STEEL = new MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.72, metalness: 0.55 });
const PLATE = new MeshStandardMaterial({ color: 0x232228, roughness: 0.82, metalness: 0.35 });
const RAIL = new MeshStandardMaterial({ color: 0x4a4d57, roughness: 0.38, metalness: 0.85 });
const CAP = new MeshStandardMaterial({ color: 0xffb02e, emissive: 0xff9a1a, emissiveIntensity: 0.55, roughness: 0.5, metalness: 0.2 });

/** A standing spot on a terrace: where a watcher's feet go, and the way
 *  they are turned to face the fight. */
export interface Stand {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

const STANDS = new Map<string, Stand[]>();
let active: Stand[] = [];

/** A site registers the spots its banks offer as they are built. */
export function registerStands(site: string, stands: Stand[]): void {
  STANDS.set(site, stands);
}

/** The desert points this at the site the fight is actually on. */
export function useStands(site: string): void {
  active = STANDS.get(site) ?? [];
}

/** The spots the current site's terraces offer, front row first. */
export function audienceStands(): Stand[] {
  return active;
}

export interface BankSpec {
  /** Arc centre (the thing the terrace looks at). */
  cx: number;
  cz: number;
  /** Radius of the front tier's lip from the centre. */
  radius: number;
  /** Arc span (radians about +y, 0 = +z), first tier's lip. */
  a0: number;
  a1: number;
  /** Ground height under a world point. */
  ground: (x: number, z: number) => number;
}

const TIERS = 2;
const TIER_RISE = 0.48;
const TIER_DEPTH = 1.5;
const SEG_ARC = 2.1; // metres of lip per riser segment
const RAIL_H = 1.02;

/** The standing spots one bank offers: a row per tier, spread along the
 *  arc a stride back from its rail, each turned to face the centre. Front
 *  tier first — the best seats are handed out first. */
export function bankStands(spec: BankSpec): Stand[] {
  const stands: Stand[] = [];
  const span = spec.a1 - spec.a0;
  for (let tier = 0; tier < TIERS; tier++) {
    const r = spec.radius + tier * TIER_DEPTH;
    const n = Math.max(2, Math.round((span * r) / (SEG_ARC * 1.4)));
    const rise = TIER_RISE * (tier + 1);
    for (let i = 0; i < n; i++) {
      const a = spec.a0 + ((i + 0.5) / n) * span;
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      // A stride back from the rail so the rail is in front of you, and
      // standing ON the plate (riser + its lip).
      const stride = r + TIER_DEPTH * 0.62;
      const x = spec.cx + sx * stride;
      const z = spec.cz + sz * stride;
      // Face the middle of the fight: the rig's forward is −z at yaw 0.
      stands.push({ x, y: spec.ground(x, z) + rise + 0.05, z, yaw: Math.atan2(-sx, -sz) + Math.PI });
    }
  }
  return stands;
}

/** One terrace bank: risers, floor plates, rails, amber caps. */
export function buildBank(spec: BankSpec): Group {
  const root = new Group();
  root.name = 'audience-bank';
  const statics = new Group();
  const span = spec.a1 - spec.a0;
  for (let tier = 0; tier < TIERS; tier++) {
    const r = spec.radius + tier * TIER_DEPTH;
    const n = Math.max(3, Math.round((span * r) / SEG_ARC));
    const rise = TIER_RISE * (tier + 1);
    for (let i = 0; i < n; i++) {
      const a = spec.a0 + ((i + 0.5) / n) * span;
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      const x = spec.cx + sx * (r + TIER_DEPTH / 2);
      const z = spec.cz + sz * (r + TIER_DEPTH / 2);
      const gy = spec.ground(x, z);
      const w = (span * (r + TIER_DEPTH / 2)) / n + 0.02;
      // The riser: a dark steel block the tier stands on.
      const riser = new Mesh(new BoxGeometry(w, rise, TIER_DEPTH), STEEL);
      riser.position.set(x, gy + rise / 2, z);
      riser.rotation.y = a;
      statics.add(riser);
      // The plate the watchers stand on — a shade lighter, a lip proud.
      const plate = new Mesh(new BoxGeometry(w + 0.04, 0.05, TIER_DEPTH + 0.06), PLATE);
      plate.position.set(x, gy + rise + 0.025, z);
      plate.rotation.y = a;
      statics.add(plate);
      // The rail on the lip: stanchion + bar + the amber cap.
      const lx = spec.cx + sx * (r + 0.08);
      const lz = spec.cz + sz * (r + 0.08);
      const post = new Mesh(new CylinderGeometry(0.02, 0.024, RAIL_H, 8), RAIL);
      post.position.set(lx, gy + rise + RAIL_H / 2, lz);
      statics.add(post);
      const bar = new Mesh(new BoxGeometry(w, 0.05, 0.06), RAIL);
      bar.position.set(lx, gy + rise + RAIL_H, lz);
      bar.rotation.y = a;
      statics.add(bar);
      const cap = new Mesh(new BoxGeometry(w * 0.92, 0.012, 0.03), CAP);
      cap.position.set(lx, gy + rise + RAIL_H + 0.032, lz);
      cap.rotation.y = a;
      statics.add(cap);
      // A kick rail halfway down, so the lip reads as a barrier.
      const kick = new Mesh(new BoxGeometry(w, 0.03, 0.04), RAIL);
      kick.position.set(lx, gy + rise + RAIL_H * 0.5, lz);
      kick.rotation.y = a;
      statics.add(kick);
    }
  }
  collapseStatic(statics);
  root.add(statics);
  return root;
}

/**
 * The flanks of a fighting site: two banks facing the arena's centre from
 * either side (±x), each spanning `halfSpan` radians about the side's
 * bearing, their front lips `radius` from the centre.
 */
export function buildFlankBanks(
  cx: number,
  cz: number,
  radius: number,
  halfSpan: number,
  ground: (x: number, z: number) => number,
): { banks: Object3D[]; stands: Stand[] } {
  const banks: Object3D[] = [];
  const stands: Stand[] = [];
  for (const bearing of [Math.PI / 2, -Math.PI / 2]) {
    const spec: BankSpec = { cx, cz, radius, a0: bearing - halfSpan, a1: bearing + halfSpan, ground };
    banks.push(buildBank(spec));
    stands.push(...bankStands(spec));
  }
  // Alternate the two flanks so the first few watchers fill both sides
  // rather than crowding one — a terrace with everyone at one end reads
  // as a queue, not a crowd.
  const half = stands.length / 2;
  const woven: Stand[] = [];
  for (let i = 0; i < half; i++) {
    woven.push(stands[i], stands[half + i]);
  }
  return { banks, stands: woven.filter(Boolean) };
}
