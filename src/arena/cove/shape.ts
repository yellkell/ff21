/**
 * THE COVE's ground truth — one analytic bay that exists TWICE, as JS (to
 * build the sand, rocks and palms) and as GLSL (so the sea knows how deep it
 * is under every pixel without a refraction pass).
 *
 * That twin is the whole trick of porting Tidewater's water to Quest. The
 * original (github.com/dgreenheck/tidewater, MIT) refracts a copy of the
 * opaque scene and marches the view ray to a 2048² heightmap; a headset
 * can't afford either. Here the seabed IS a formula of coast distance, so
 * the water shader traces the refracted ray to it in a handful of ALU ops
 * and the turquoise shallows fall out of the same Beer–Lambert absorption
 * Tidewater uses. The beach / seabed profile below is Tidewater's own
 * (TerrainData._base), cut down to the bay.
 *
 * Frame: the fight sits at the origin (you at z = 0 facing −z, as in every
 * FIRE FIGHT backdrop). The sea is AHEAD, the shoreline ~30 m out and
 * curving seaward on both flanks into two headlands; palms and jungle hills
 * rise BEHIND you. Sea level is below the arena floor: the pads stand on the
 * berm top of a real beach, so you look DOWN onto the water like you would
 * from the sand.
 */

import { Vector3 } from 'three';

/** Mean sea level (m). The arena floor (CLEARING.y) sits on the berm above it. */
export const SEA_Y = -1.57;
/** Where the waterline crosses x = 0. */
export const SHORE_Z = -30;
/** The lowered, levelled clearing the pedestals stand proud of — holds every
 *  mode's footprint (duel, 2v2, FFA, the raid arc out to z ≈ −12). */
export const CLEARING = { x: 0, z: -5.5, rx: 16, rz: 12.5, y: -0.15 };

/** Toward the sun: SUNDOWN, 1° over the sea — touching it — ahead and 28°
 *  to the right —
 *  off the rival's shoulder, never behind their head, so a fireball still
 *  reads against the sky while the glitter road runs in across the bay. */
export const SUN_DIR = new Vector3(0.4694, 0.01745, -0.8828).normalize();

/** Swell period (s). Long-period groundswell: slow, heavy sets. */
export const SWELL_PERIOD = 9.5;
/** Deep-water swell height (m, crest to trough) before shoaling. */
export const SWELL_H0 = 0.7;
/** Vertical run-up of the swash on the foreshore (m). */
export const RUNUP = 0.42;

/** The two headlands: [x, z, rx, rz, height]. East (right) is the rocky one
 *  with the sea stacks; west (left) the long jungle ridge. */
export const HEADLANDS: [number, number, number, number, number][] = [
  [262, -228, 120, 86, 44],
  [-300, -168, 130, 96, 30],
];

const sat = (x: number): number => Math.min(1, Math.max(0, x));
const smooth = (a: number, b: number, x: number): number => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/** Bay curvature — slightly tighter on the east so the bay is lopsided. */
function coastK(x: number): number {
  return 0.0018 + 0.00035 * Math.tanh(x / 80);
}

/** The waterline's z at x (mean sea level). The bay's arms reach seaward to
 *  the headlands and then fall back (the quartic fade), so the open ocean
 *  shows past both points instead of the bay closing into a lagoon. Two
 *  sines lay beach cusps along it. */
export function shoreZ(x: number): number {
  const q = x / 380;
  return (
    SHORE_Z -
    coastK(x) * x * x * Math.exp(-(q * q) * (q * q)) +
    1.4 * Math.sin(x * 0.047 + 0.3) +
    0.7 * Math.sin(x * 0.13 + 1.9)
  );
}

/** Signed distance from the waterline (m): > 0 at sea, < 0 inland. */
export function coastDist(x: number, z: number): number {
  const s = shoreZ(x + 0.5) - shoreZ(x - 0.5);
  return (shoreZ(x) - z) / Math.sqrt(1 + s * s);
}

/** How rocky the coast is here: 0 in the bay, 1 out on the headlands. */
export function rockSide(x: number): number {
  return smooth(150, 260, Math.abs(x));
}

/** Water depth below mean sea level at coast distance d (Tidewater's profile)
 *  with the outer bar that trips the breakers ~44 m out. */
function seaDepth(d: number, rock: number): number {
  let depth = d < 70 ? d * 0.05 : d < 260 ? 3.5 + (d - 70) * 0.06 : Math.min(14.9 + (d - 260) * 0.07, 85);
  depth *= 1 + 1.3 * rock;
  const bar = 0.55 * Math.exp(-(((d - 44) / 9) ** 2)) * (1 - rock);
  return depth - bar;
}

/** Height of the beach above sea level at inland distance e (Tidewater's
 *  foreshore → berm → dunes, steepened so the berm stands clear of the swash). */
function beachHeight(e: number): number {
  if (e < 12) return e * 0.1;
  if (e < 40) return 1.2 + (e - 12) * 0.012;
  if (e < 70) return 1.536 + (e - 40) * 0.045;
  return 2.886 + (e - 70) * 0.05;
}

/** A headland: a domed mound whose steep rim reads as sea cliff. */
function headlandHeight(x: number, z: number): number {
  let h = -1e9;
  for (const [hx, hz, rx, rz, H] of HEADLANDS) {
    const dx = (x - hx) / rx;
    const dz = (z - hz) / rz;
    const r2 = dx * dx + dz * dz;
    h = Math.max(h, H * (1 - r2) * 1.15 - 5);
  }
  return h;
}

/** The analytic ground (no noise): what the WATER believes is down there.
 *  The mesh adds dunes/hills/clearing inland, where no water ever reaches. */
export function baseGroundY(x: number, z: number): number {
  const d = coastDist(x, z);
  const rock = rockSide(x);
  const h = d >= 0 ? -seaDepth(d, rock) : beachHeight(-d);
  return SEA_Y + Math.max(h, headlandHeight(x, z));
}

/**
 * The same ground as GLSL. Keep it in lock-step with the functions above:
 * the sea's colour (its depth), the swash edge and the foam line all read
 * it, while the depth buffer uses the real mesh.
 */
export const SHAPE_GLSL = /* glsl */ `
#define SEA_Y ${SEA_Y.toFixed(4)}
float coveCoastK(float x) { return 0.0018 + 0.00035 * tanh(x / 80.0); }
float coveShoreZ(float x) {
  float q = x / 380.0;
  q *= q;
  return ${SHORE_Z.toFixed(1)} - coveCoastK(x) * x * x * exp(-q * q) + 1.4 * sin(x * 0.047 + 0.3) + 0.7 * sin(x * 0.13 + 1.9);
}
float coveCoastDist(vec2 xz) {
  float s = coveShoreZ(xz.x + 0.5) - coveShoreZ(xz.x - 0.5);
  return (coveShoreZ(xz.x) - xz.y) * inversesqrt(1.0 + s * s);
}
float coveRock(float x) { return smoothstep(150.0, 260.0, abs(x)); }
float coveSeaDepth(float d, float rock) {
  float depth = d < 70.0 ? d * 0.05 : (d < 260.0 ? 3.5 + (d - 70.0) * 0.06 : min(14.9 + (d - 260.0) * 0.07, 85.0));
  depth *= 1.0 + 1.3 * rock;
  float q = (d - 44.0) / 9.0;
  return depth - 0.55 * exp(-q * q) * (1.0 - rock);
}
float coveBeach(float e) {
  return e < 12.0 ? e * 0.1 : (e < 40.0 ? 1.2 + (e - 12.0) * 0.012 : 1.536 + (e - 40.0) * 0.045);
}
float coveHeadland(vec2 xz) {
${HEADLANDS.map(([hx, hz, rx, rz, H], i) => `  vec2 q${i} = (xz - vec2(${hx.toFixed(1)}, ${hz.toFixed(1)})) / vec2(${rx.toFixed(1)}, ${rz.toFixed(1)});
  float h${i} = ${H.toFixed(1)} * (1.0 - dot(q${i}, q${i})) * 1.15 - 5.0;`).join('\n')}
  return max(${HEADLANDS.map((_, i) => `h${i}`).join(', ')});
}
float coveGroundY(vec2 xz, float d) {
  float h = d >= 0.0 ? -coveSeaDepth(d, coveRock(xz.x)) : coveBeach(-d);
  return SEA_Y + max(h, coveHeadland(xz));
}
`;
