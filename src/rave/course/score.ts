/**
 * THE CIRCUIT — a closed parkour lap through the void. Out to the east on a
 * runner, up a lift to the mezzanine, a shuttle across it with a turn in
 * the ride, a second lift to the sky, across THE SKYWALK at height, down
 * the elevator, home on the west runner — and THE GATE on the home pad
 * lights the way back. Ride it and it puts you back exactly where it
 * picked you up, which is the whole point of a course you reach through a
 * door.
 *
 * The authoring discipline is the movement repo's, unchanged: each platform
 * claims squares of the 3×3 play-area grid (research/03 §2.2) and moves its
 * ANCHOR — the rig pose that pins it to its claim — along a bar-quantized
 * loop. Consecutive platforms share an anchor at handover, so every
 * traversal is a pair of opposed real steps netting to zero (research/03
 * §2.1), and the lap is geometrically closed: the last step home repays the
 * first step out. `validateScore()` keeps the ghost-overlay discipline
 * executable — routed handovers must share a stop anchor, and no two
 * platforms may ever park decks on the same world spot.
 *
 * What the raid's set-lists have and this doesn't: landings. No beam, no
 * rail, no seesaw, no surge, no gate, no sweep. Those are the GOOPLIATH's
 * words and he is not out here — the floor does all the talking, and the
 * only answer it ever wants is a step.
 */

import { GRID } from './config.js';

export type Sq = readonly [number, number]; // [col +east, row +south], -1..1
export type V3 = { x: number; y: number; z: number };
export type Edge = 'N' | 'S' | 'E' | 'W';

export interface PathKey {
  bar: number;
  a: V3;
}

export interface PlatformSpec {
  id: string;
  claim: Sq[];
  keys: PathKey[]; // static platforms: one key; loops close back to keys[0].a
  loopBars?: number;
  gaps: { sq: Sq; edge: Edge }[]; // fence openings where a step is authored
}

export interface FenceSeg {
  x: number;
  z: number;
  edge: Edge;
}

export const v3 = (x: number, y: number, z: number): V3 => ({ x, y, z });
export const sqOffset = (sq: Sq): { x: number; z: number } => ({
  x: sq[0] * GRID.pitch,
  z: sq[1] * GRID.pitch,
});

const EDGES: Edge[] = ['N', 'S', 'E', 'W'];
const EDGE_DIR: Record<Edge, Sq> = {
  N: [0, -1],
  S: [0, 1],
  E: [1, 0],
  W: [-1, 0],
};

/* ── Anchors ──────────────────────────────────────────────────────────────
 * VOIDSTEP 2. The lap still circles the arena's centre and still takes the
 * free vertical dimension (research/03 §3), but it takes it TWICE and it
 * takes it faster: east on a runner, up a half storey, a shuttle across the
 * mezzanine on the diagonal, up again to the sky, THE SKYWALK south across
 * the void at height, an elevator straight down the west side, and the
 * runner home. Every machine dwells two bars and rides two bars at 128 —
 * a catch is a decision made in under four seconds, and a miss costs a
 * loop (fifteen seconds), never a life.
 *
 * Every machine sits five bars behind the one before it: when yours docks
 * at the far end, the next is docked for one more bar and gone the bar
 * after — which is the snap. The ferry alone keeps three-bar dwells; it is
 * the set piece, and you are allowed to look at the view. */

const H = v3(0, 0, 0); // home, where the door puts you down
const E1 = v3(2.6, 0, -1.2); // east landing
const E2 = v3(2.6, 1.9, -4.4); // the first lift's berth: the mezzanine, east
const N3 = v3(0.6, 1.9, -6.4); // the shuttle's berth: the mezzanine, north
const N4 = v3(-2.4, 3.8, -7.0); // the second lift's berth: the sky, north-west
const S5 = v3(-2.4, 3.8, -1.6); // the skywalk's south berth
const W6 = v3(-2.4, 0, -1.6); // the elevator's foot, back on the floor

/* THE TURNS. A machine may only ever leave a seam, or arrive at one, moving
 * along that seam's normal: a deck departing on the diagonal clips the
 * corner of the tile it was moored against by a few centimetres — a
 * collision the old stop-only check could never see and the sweep below
 * refuses. So every machine whose berths aren't in line rides an L: out
 * along one axis to a waypoint, then along the other. The corner is a
 * beat in the ride, and the ride is better for it. */
const A1 = v3(2.6, 0, 0); // runner-out: east along the floor, then north
const M2 = v3(0.6, 1.9, -4.4); // shuttle: west across the mezzanine, then north
const P3 = v3(0.6, 3.8, -7.0); // lift2: up and north first, then west along the sky
const R4 = v3(-2.4, 0, 0); // runner-home: south off the elevator's foot, then east

export const ANCHORS = { H, E1, E2, N3, N4, S5, W6 };

const C: Sq = [0, 0];
const E: Sq = [1, 0];
const W: Sq = [-1, 0];
const NC: Sq = [0, -1];
const NE: Sq = [1, -1];
const NW: Sq = [-1, -1];
const SC: Sq = [0, 1];
const SE: Sq = [1, 1];
const SW: Sq = [-1, 1];

/** A machine's loop: docked `near` from bar t, two bars there, two bars
 *  out, two bars at `far`, two bars back — eight in all. */
const shuttleLoop = (t: number, near: V3, far: V3): Pick<PlatformSpec, 'keys' | 'loopBars'> => ({
  keys: [
    { bar: t, a: near },
    { bar: t + 2, a: near },
    { bar: t + 4, a: far },
    { bar: t + 6, a: far },
    { bar: t + 8, a: near },
  ],
  loopBars: 8,
});

/** The same eight bars with a TURN in each ride: a bar to the waypoint,
 *  a bar on to the berth. */
const cornerLoop = (t: number, near: V3, turn: V3, far: V3): Pick<PlatformSpec, 'keys' | 'loopBars'> => ({
  keys: [
    { bar: t, a: near },
    { bar: t + 2, a: near },
    { bar: t + 3, a: turn },
    { bar: t + 4, a: far },
    { bar: t + 6, a: far },
    { bar: t + 7, a: turn },
    { bar: t + 8, a: near },
  ],
  loopBars: 8,
});

export const PLATFORMS: PlatformSpec[] = [
  {
    // The alpha and the omega: leave stepping east, return stepping east
    // off the west runner. The lap's ledger closes here at centre, and THE
    // GATE on the pad's south edge is the door home, lit by how far round
    // the route you are.
    id: 'home',
    claim: [C, SC],
    keys: [{ bar: 0, a: H }],
    gaps: [
      { sq: C, edge: 'E' },
      { sq: C, edge: 'W' },
    ],
  },
  {
    id: 'runner-out',
    claim: [E],
    ...cornerLoop(0, H, A1, E1),
    gaps: [{ sq: E, edge: 'W' }],
  },
  {
    // Two tiles: arrive on C, walk north, board the lift east off NC. The
    // internal +N is repaid by the −N step off the lift at the top.
    id: 'east-step',
    claim: [C, NC],
    keys: [{ bar: 0, a: E1 }],
    gaps: [
      { sq: C, edge: 'E' },
      { sq: NC, edge: 'E' },
    ],
  },
  {
    // The first climb: north and up half a storey to the mezzanine.
    id: 'lift',
    claim: [NE],
    ...shuttleLoop(5, E1, E2),
    gaps: [{ sq: NE, edge: 'W' }],
  },
  {
    // The mezzanine, east: land on NC off the lift, walk south, board the
    // shuttle moored south of C.
    id: 'mezz',
    claim: [NC, C],
    keys: [{ bar: 0, a: E2 }],
    gaps: [
      { sq: NC, edge: 'E' },
      { sq: C, edge: 'S' },
    ],
  },
  {
    // THE SHUTTLE — west across the mezzanine's gap, a turn, then north:
    // the one ride on the lap that changes direction under you. Nothing
    // else on this storey.
    id: 'shuttle',
    claim: [SC],
    ...cornerLoop(10, E2, M2, N3),
    gaps: [{ sq: SC, edge: 'N' }],
  },
  {
    // The mezzanine, north: off the shuttle onto C, north to NC, and the
    // second lift waits west of that.
    id: 'north-step',
    claim: [C, NC],
    keys: [{ bar: 0, a: N3 }],
    gaps: [
      { sq: C, edge: 'S' },
      { sq: NC, edge: 'W' },
    ],
  },
  {
    // The second climb: up and north to the sky, then west along it.
    id: 'lift2',
    claim: [NW],
    ...cornerLoop(15, N3, P3, N4),
    gaps: [
      { sq: NW, edge: 'E' },
      { sq: NW, edge: 'S' },
    ],
  },
  {
    // The sky, north-west: off the lift onto W, east to C, and the ferry is
    // moored south of you.
    id: 'sky',
    claim: [W, C],
    keys: [{ bar: 0, a: N4 }],
    gaps: [
      { sq: W, edge: 'N' },
      { sq: C, edge: 'S' },
    ],
  },
  {
    // THE SKYWALK — the set piece: a two-tile ferry riding straight south
    // across the void at height, the mirror floor a storey and a half
    // below, the shuttle's storey passing under it. Three-bar dwells: the
    // only place on the lap you are given time to look.
    id: 'skywalk',
    claim: [SC, SE],
    keys: [
      { bar: 20, a: N4 },
      { bar: 23, a: N4 },
      { bar: 26, a: S5 },
      { bar: 29, a: S5 },
      { bar: 32, a: N4 },
    ],
    loopBars: 12,
    gaps: [
      { sq: SC, edge: 'N' },
      { sq: SC, edge: 'W' },
    ],
  },
  {
    // The sky, south: off the ferry WEST onto SW (its lane stays clear —
    // it comes in from the north and would run straight through a tile
    // ahead of it), north to W, and the elevator waits north of that.
    id: 'sky-south',
    claim: [SW, W],
    keys: [{ bar: 0, a: S5 }],
    gaps: [
      { sq: SW, edge: 'E' },
      { sq: W, edge: 'N' },
    ],
  },
  {
    // THE ELEVATOR — straight down, 3.8 m in two bars. The floor comes up
    // to meet you.
    id: 'drop',
    claim: [NW],
    ...shuttleLoop(26, S5, W6),
    gaps: [
      { sq: NW, edge: 'S' },
      { sq: NW, edge: 'E' },
    ],
  },
  {
    // The floor, west: off the elevator onto NC, south to C, and the runner
    // home is moored west of that.
    id: 'west-step',
    claim: [NC, C],
    keys: [{ bar: 0, a: W6 }],
    gaps: [
      { sq: NC, edge: 'W' },
      { sq: C, edge: 'W' },
    ],
  },
  {
    id: 'runner-home',
    claim: [W],
    ...cornerLoop(31, W6, R4, H),
    gaps: [{ sq: W, edge: 'E' }],
  },
];

export const INDEX: Record<string, number> = {};
PLATFORMS.forEach((p, i) => (INDEX[p.id] = i));

export const HOME_INDEX = INDEX['home'];

/** The route, in order. Wayfinding walks this. */
export const ROUTE: string[] = [
  'home',
  'runner-out',
  'east-step',
  'lift',
  'mezz',
  'shuttle',
  'north-step',
  'lift2',
  'sky',
  'skywalk',
  'sky-south',
  'drop',
  'west-step',
  'runner-home',
  'home',
];

/** The turn: from this leg on, the route is heading HOME, and THE GATE on
 *  the home pad lights by how much of the way back is done. */
export const ROUTE_TURN = ROUTE.indexOf('skywalk');

/** 0 on the way out … 1 stepping home: how lit the gate is for a body on
 *  route index `at` (−1 = off the route). */
export function homeward(at: number): number {
  if (at < 0 || at <= ROUTE_TURN) return 0;
  return Math.min(1, (at - ROUTE_TURN) / (ROUTE.length - 1 - ROUTE_TURN));
}

/* ── Evaluation ─────────────────────────────────────────────────────────── */

const smooth = (t: number): number => t * t * (3 - 2 * t);

export function anchorAt(spec: PlatformSpec, bar: number, out: V3): V3 {
  const keys = spec.keys;
  if (keys.length === 1 || !spec.loopBars) {
    const a = keys[0].a;
    out.x = a.x;
    out.y = a.y;
    out.z = a.z;
    return out;
  }
  const t0 = keys[0].bar;
  let t = ((bar - t0) % spec.loopBars) + t0;
  if (t < t0) t += spec.loopBars;
  for (let i = keys.length - 2; i >= 0; i--) {
    if (t >= keys[i].bar) {
      const k0 = keys[i];
      const k1 = keys[i + 1];
      const span = k1.bar - k0.bar;
      const f = span > 0 ? smooth((t - k0.bar) / span) : 0;
      out.x = k0.a.x + (k1.a.x - k0.a.x) * f;
      out.y = k0.a.y + (k1.a.y - k0.a.y) * f;
      out.z = k0.a.z + (k1.a.z - k0.a.z) * f;
      return out;
    }
  }
  const a = keys[0].a;
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

/** Loop-local bar time for a spec. */
function loopBar(spec: PlatformSpec, bar: number): number {
  if (!spec.loopBars) return bar;
  const t0 = spec.keys[0].bar;
  let t = ((bar - t0) % spec.loopBars) + t0;
  if (t < t0) t += spec.loopBars;
  return t;
}

/** Dwell state; departIn counts bars until this dwell ends. */
export function dwellInfo(
  spec: PlatformSpec,
  bar: number,
): { moving: boolean; departIn: number } {
  const keys = spec.keys;
  if (keys.length === 1 || !spec.loopBars) {
    return { moving: false, departIn: Infinity };
  }
  const t = loopBar(spec, bar);
  for (let i = keys.length - 2; i >= 0; i--) {
    if (t >= keys[i].bar) {
      const k0 = keys[i];
      const k1 = keys[i + 1];
      const still = k0.a.x === k1.a.x && k0.a.y === k1.a.y && k0.a.z === k1.a.z;
      if (!still) return { moving: true, departIn: Infinity };
      return { moving: false, departIn: k1.bar - t };
    }
  }
  return { moving: false, departIn: Infinity };
}

/** Every deck-tile edge grows a rail unless it is an authored gap or faces
 *  another tile of the same platform. Purely visual, prevents nothing
 *  (research/03 §2.4). */
export function fencesOf(spec: PlatformSpec): FenceSeg[] {
  const out: FenceSeg[] = [];
  const has = (c: number, r: number): boolean =>
    spec.claim.some((s) => s[0] === c && s[1] === r);
  for (const sq of spec.claim) {
    for (const edge of EDGES) {
      const d = EDGE_DIR[edge];
      if (has(sq[0] + d[0], sq[1] + d[1])) continue;
      if (spec.gaps.some((g) => g.sq[0] === sq[0] && g.sq[1] === sq[1] && g.edge === edge)) continue;
      const o = sqOffset(sq);
      out.push({ x: o.x, z: o.z, edge });
    }
  }
  return out;
}

/** The BERTHS of a platform's loop — the anchors it dwells at (two
 *  consecutive keys on one pose), which are the ghost/berth stops. A
 *  waypoint the machine turns at without stopping is not a berth: nothing
 *  docks there, so no brackets and no ghost are stamped on it. */
export function endpointsOf(spec: PlatformSpec): V3[] {
  const seen: V3[] = [];
  const same = (a: V3, b: V3): boolean => a.x === b.x && a.y === b.y && a.z === b.z;
  if (spec.keys.length === 1) return [spec.keys[0].a];
  for (let i = 0; i + 1 < spec.keys.length; i++) {
    const a = spec.keys[i].a;
    if (!same(a, spec.keys[i + 1].a)) continue;
    if (!seen.some((b) => same(a, b))) seen.push(a);
  }
  return seen;
}

/**
 * The ghost-overlay discipline, executable: every routed handover must share
 * a stop anchor, and no two platforms may ever park decks on the same world
 * spot. Called once at build — a circuit that doesn't tile is a bug in the
 * score, and it should say so on the way up rather than halfway round.
 */
export function validateScore(): void {
  const eps = 1e-6;
  const near = (a: V3, b: V3): boolean =>
    Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
  const stopsOf = (id: string): V3[] => endpointsOf(PLATFORMS[INDEX[id]]);

  const tilesOf = (spec: PlatformSpec): V3[] => {
    const out: V3[] = [];
    for (const a of endpointsOf(spec)) {
      for (const sq of spec.claim) {
        const o = sqOffset(sq);
        out.push(v3(a.x + o.x, a.y, a.z + o.z));
      }
    }
    return out;
  };
  for (let i = 0; i < PLATFORMS.length; i++) {
    for (let j = i + 1; j < PLATFORMS.length; j++) {
      for (const ta of tilesOf(PLATFORMS[i])) {
        for (const tb of tilesOf(PLATFORMS[j])) {
          if (near(ta, tb)) {
            throw new Error(
              `course: ${PLATFORMS[i].id} and ${PLATFORMS[j].id} park decks on the same spot (${ta.x.toFixed(2)}, ${ta.y.toFixed(2)}, ${ta.z.toFixed(2)})`,
            );
          }
        }
      }
    }
  }
  for (let i = 0; i + 1 < ROUTE.length; i++) {
    const ok = stopsOf(ROUTE[i]).some((sa) => stopsOf(ROUTE[i + 1]).some((sb) => near(sa, sb)));
    if (!ok) {
      throw new Error(
        `course: no shared stop between ${ROUTE[i]} and ${ROUTE[i + 1]} — the patterns don't tile`,
      );
    }
  }
  sweepScore();
}

/**
 * THE SWEEP. The stop check above says no two decks ever PARK on the same
 * spot; this says no two decks ever SHARE SPACE, parked or moving — the
 * whole loop is stepped a sixteenth of a bar at a time and every tile of
 * every platform is boxed against every other. A ferry that grazes an
 * elevator on its way past would be a collision you could only find by
 * riding into it, and the score should refuse to build long before that.
 *
 * Boxes are the tile's footprint (GRID.tile square) and its slab (0.1 m
 * high, plus a little for the machine's keel underneath), so decks on
 * different storeys are allowed to pass one over the other — that is the
 * skywalk crossing the shuttle's storey, and it is the point.
 */
export function sweepScore(): void {
  const lcm = (a: number, b: number): number => {
    const g = (x: number, y: number): number => (y ? g(y, x % y) : x);
    return (a * b) / g(a, b);
  };
  let span = 1;
  for (const p of PLATFORMS) if (p.loopBars) span = lcm(span, p.loopBars);
  const STEP = 1 / 16;
  const half = GRID.tile / 2 - 1e-4; // a shared seam is not an overlap
  const slab = 0.3; // deck slab + keel, vertically
  const a = v3(0, 0, 0);
  const b = v3(0, 0, 0);
  for (let bar = 0; bar < span; bar += STEP) {
    for (let i = 0; i < PLATFORMS.length; i++) {
      anchorAt(PLATFORMS[i], bar, a);
      for (let j = i + 1; j < PLATFORMS.length; j++) {
        anchorAt(PLATFORMS[j], bar, b);
        if (Math.abs(a.y - b.y) >= slab) continue;
        for (const sa of PLATFORMS[i].claim) {
          const oa = sqOffset(sa);
          for (const sb of PLATFORMS[j].claim) {
            const ob = sqOffset(sb);
            const dx = Math.abs(a.x + oa.x - (b.x + ob.x));
            const dz = Math.abs(a.z + oa.z - (b.z + ob.z));
            if (dx < half * 2 && dz < half * 2) {
              throw new Error(
                `course: ${PLATFORMS[i].id} and ${PLATFORMS[j].id} share space at bar ${bar.toFixed(2)} ` +
                  `(${(a.x + oa.x).toFixed(2)}, ${a.y.toFixed(2)}, ${(a.z + oa.z).toFixed(2)})`,
              );
            }
          }
        }
      }
    }
  }
}
