/**
 * THE BLANK — FIRE FIGHT 2's mannequin body (DESIGN.md §5.1), the polish
 * pass: smooth, symmetrical, basic, uniform.
 *
 * One body, TWO base tones — you start ALL WHITE ('blank') or ALL BLACK
 * ('onyx'), picked on the locker's COLOUR tab, and everything past that is
 * the paint system's job. Each tone is its own skin id riding the existing
 * skin machinery, so the pick syncs to rivals and squadmates over the same
 * wire every FF1 skin used.
 *
 * THE CONSTRUCTION RULES (each one answers a real complaint):
 *  - ONE material per body. No trim tone, no joint rubber, no seam bands —
 *    a uniform shell, so nothing can read as "parts".
 *  - ONE SURFACE, FULL STOP. The whole body — neck, shoulders, chest,
 *    waist, hips and taper — is a single LOFT: a stack of elliptical rings
 *    stitched into one indexed mesh with smooth shared-vertex normals.
 *    Chest and pelvis used to be two lofts the IK moved independently, so
 *    the waist visibly opened and closed; there is now no joint there to
 *    come apart. Symmetry is by construction (every ring is centred).
 *  - NO BULGE below the hips. The pelvis loft is monotonic after its
 *    widest ring: hips, then a smooth unbroken taper to a rounded tip.
 *    (The hitbox never bulged — it ends at the BODY_IK pelvis sphere —
 *    and now the body's silhouette says the same thing.)
 *  - The head is a bare egg and NOTHING else: the neck belongs to the body
 *    now, and the head floats clear above it. A head carrying its own neck
 *    drags that neck through its own shoulders on every look-behind; cut
 *    apart, the joint cannot bind, and only the head has to move.
 *
 * Materials carry NO role/accent tags: recolours, the hue wheel and
 * setAvatarAccent all leave the base tones alone. Front faces −z. The
 * BODY_IK hitbox spheres never change — the blank stays exactly as
 * hittable as everything before it, and the visual runs INSIDE them.
 */

import {
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
} from 'three';
import { BODY_IK } from '../config.js';

export type BlankTone = 'white' | 'onyx';

/** The two factory finishes. WHITE is a soft matte porcelain; ONYX keeps a
 *  little sheen and metal so a black body still draws its silhouette from
 *  the room's light instead of vanishing into a dark arena. */
function toneMat(tone: BlankTone): MeshStandardMaterial {
  // No userData.role / accent: immune to applyAvatarSkin + setAvatarAccent.
  return tone === 'white'
    ? new MeshStandardMaterial({ color: 0xf4f2ee, roughness: 0.72, metalness: 0.02 })
    : new MeshStandardMaterial({ color: 0x17171a, roughness: 0.4, metalness: 0.3 });
}

/** The skin id each tone answers to (skinTag drives applyAvatarSkin's
 *  show-one-body toggle, exactly like the FF1 roster did). */
export function toneSkinId(tone: BlankTone): string {
  return tone === 'white' ? 'blank' : 'onyx';
}

function tagged(tone: BlankTone): Group {
  const g = new Group();
  g.userData.skinTag = toneSkinId(tone);
  g.visible = false;
  return g;
}

/** One elliptical cross-section of a loft: centred at x=0 (mirror symmetry
 *  by construction), `w`/`d` are half-width/half-depth at height `y`.
 *  `z` shifts the ring fore/aft — the neck-root rings lean FORWARD to meet
 *  the head, which the IK deliberately hangs ahead of the spine. */
export interface Ring {
  y: number;
  w: number;
  d: number;
  z?: number;
}

const SEG = 36;

/**
 * Stitch rings into ONE smooth closed surface: shared vertices ring to
 * ring, capped flat top and bottom, normals computed over the whole
 * indexed mesh so the shading rolls continuously — no crossing primitives,
 * no visible seams, mirror-symmetric on both axes by construction.
 */
function loft(rings: readonly Ring[], mat: MeshStandardMaterial): Mesh {
  // SEG+1 columns per ring: the seam vertex is duplicated so u runs a
  // clean 0..1 around the body — THE PAINT bakes into these UVs, and a
  // shared seam vertex would smear the last column across the whole map.
  const cols = SEG + 1;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // v by cumulative profile arc, so paint stays even where rings crowd.
  const arc: number[] = [0];
  for (let k = 1; k < rings.length; k++) {
    const a = rings[k - 1];
    const b = rings[k];
    arc.push(arc[k - 1] + Math.hypot(b.y - a.y, ((b.w + b.d) - (a.w + a.d)) / 2));
  }
  const total = arc[arc.length - 1] || 1;
  rings.forEach((r, k) => {
    for (let s = 0; s < cols; s++) {
      const t = ((s % SEG) / SEG) * Math.PI * 2;
      pos.push(Math.cos(t) * r.w, r.y, Math.sin(t) * r.d + (r.z ?? 0));
      uv.push(s / SEG, 1 - arc[k] / total);
    }
  });
  for (let k = 0; k < rings.length - 1; k++) {
    const a0 = k * cols;
    const b0 = (k + 1) * cols;
    for (let s = 0; s < SEG; s++) {
      // Wound so faces point OUTWARD (rings run top→down): a culled-inward
      // body renders its own interior — the paint looked like it was on
      // the wrong side of the world until this flipped.
      idx.push(a0 + s, b0 + s + 1, b0 + s, a0 + s, a0 + s + 1, b0 + s + 1);
    }
  }
  // Flat caps close the tube (the end rings are small, so the cap is a
  // sliver — the averaged normals round it off rather than crease it).
  const top = pos.length / 3;
  pos.push(0, rings[0].y, rings[0].z ?? 0);
  uv.push(0.5, 1);
  const bottom = top + 1;
  pos.push(0, rings[rings.length - 1].y, rings[rings.length - 1].z ?? 0);
  uv.push(0.5, 0);
  for (let s = 0; s < SEG; s++) {
    idx.push(top, s, s + 1);
    const l0 = (rings.length - 1) * cols;
    idx.push(bottom, l0 + s + 1, l0 + s);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return new Mesh(geo, mat);
}

/**
 * THE HEAD — a bare egg, and nothing else.
 *
 * The neck used to ride in here so it followed every nod; it now belongs to
 * the body (see BODY_RINGS), and the head floats clear above it. That is
 * the point: a head that carries its own neck swings the neck through the
 * shoulders every time you look over your shoulder, and no amount of
 * leaning the stub back hides it. Disconnected, the joint can never bind —
 * and a floating head is a mannequin's honest silhouette anyway.
 */
/**
 * The skull's stretch of a sphere of BODY_IK.headRadius (x, y, z). It was
 * an EGG — 0.84 wide, 1.08 tall, 0.93 deep: narrow and long, so the head
 * read as a lightbulb on a neck. It is nearly round now, a whisker
 * narrower side to side than front to back so it still has a face. THE
 * PAINT's chart (avatar/paint.ts) measures the skull from this, the head
 * GEAR is refitted to it (avatar/gear.ts, EGG_SCALE), and the neck seat
 * (boxer.ts) sits under it.
 */
export const HEAD_SCALE: readonly [number, number, number] = [0.94, 1.0, 0.97];
/** The egg the head gear was modelled on, kept so applyGear can refit it
 *  to whatever HEAD_SCALE is now. */
export const EGG_SCALE: readonly [number, number, number] = [0.84, 1.08, 0.93];

export function buildMannequinHead(tone: BlankTone): Group {
  const r = BODY_IK.headRadius;
  const g = tagged(tone);

  const skull = new Mesh(new SphereGeometry(r, 28, 22), toneMat(tone));
  skull.scale.set(HEAD_SCALE[0], HEAD_SCALE[1], HEAD_SCALE[2]);
  skull.position.y = r * 0.05;
  skull.userData.paintPart = 'head'; // THE PAINT bakes into this mesh's map
  skull.userData.paintTone = tone;
  g.add(skull);

  return g;
}

/**
 * THE BODY — ONE piece, from the neck to the tip.
 *
 * Chest and pelvis used to be two lofts on two groups the IK placed
 * separately: the chest leaned along the spine, the hips only yawed, so the
 * waist opened and closed as you moved and the join was a permanent seam
 * you could see from across the arena. They are now a SINGLE loft on a
 * single group — neck, shoulders, chest, waist, hips and taper stitched
 * into one indexed surface with shared normals — so there is no waist joint
 * to come apart, because there is no joint.
 *
 * Rings are in HIP-LOCAL space (y = 0 is the pelvis hitbox centre, where
 * solveTorso plants the body), ordered top → down. The hitbox spheres are
 * untouched: BODY_IK still puts chest and pelvis where it always did, and
 * this surface runs inside them.
 */
export const BODY_RINGS: readonly Ring[] = [
  // THE NECK — a short column rising from the shoulders, stopping CLEAR of
  // the head's underside (~0.516 hip-local when standing). It leans forward
  // (−z) because the IK deliberately hangs the spine behind the head.
  { y: 0.488, w: 0.048, d: 0.043, z: -0.058 },
  { y: 0.470, w: 0.058, d: 0.050, z: -0.045 },
  { y: 0.450, w: 0.080, d: 0.062, z: -0.028 },
  { y: 0.425, w: 0.165, d: 0.078, z: -0.010 }, // trapezius spreading
  // THE SHOULDER LINE — widest ring on the body; the brief's wide shoulders.
  { y: 0.395, w: 0.252, d: 0.090 },
  { y: 0.350, w: 0.232, d: 0.098 },
  { y: 0.290, w: 0.166, d: 0.100 }, // chest
  { y: 0.230, w: 0.124, d: 0.090 },
  // THE WAIST — thin, and the one place the two old lofts used to meet.
  { y: 0.175, w: 0.094, d: 0.077 },
  { y: 0.130, w: 0.090, d: 0.074 }, // the pinch  ← BODY_WAIST_RING
  { y: 0.075, w: 0.105, d: 0.086 },
  { y: 0.020, w: 0.126, d: 0.100 },
  { y: -0.020, w: 0.132, d: 0.104 }, // THE HIP LINE — widest below the waist
  // NO BULGE: monotonic from here to a rounded tip, nothing widens again.
  { y: -0.080, w: 0.115, d: 0.092 },
  { y: -0.140, w: 0.078, d: 0.065 },
  { y: -0.195, w: 0.040, d: 0.035 },
  { y: -0.230, w: 0.014, d: 0.013 },
];

/** Index of the pinch ring — the old chest/pelvis boundary. THE PAINT reads
 *  it to fold looks painted on the two old parts into this one surface. */
const BODY_WAIST_RING = 9;

/**
 * Where the old chest/pelvis boundary lands in the merged surface's v.
 * The loft lays v by cumulative arc from the top (v = 1) to the tip
 * (v = 0), so everything the old CHEST carried lives above this line and
 * everything the old PELVIS carried below it — which is exactly what
 * avatar/paint.ts needs to replay a look packed before the merge.
 */
export const BODY_V_SPLIT = ((): number => {
  let arc = 0;
  const at: number[] = [0];
  for (let k = 1; k < BODY_RINGS.length; k++) {
    const a = BODY_RINGS[k - 1];
    const b = BODY_RINGS[k];
    arc += Math.hypot(b.y - a.y, (b.w + b.d - (a.w + a.d)) / 2);
    at.push(arc);
  }
  return 1 - at[BODY_WAIST_RING] / (arc || 1);
})();

/** The whole body, one surface. */
export function buildMannequinBody(tone: BlankTone): Group {
  const g = tagged(tone);
  const body = loft(BODY_RINGS, toneMat(tone));
  body.userData.paintPart = 'body';
  body.userData.paintTone = tone;
  g.add(body);
  return g;
}
