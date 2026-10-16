/**
 * THE CLUB — layout + tunables for RAVE RAID's home venue. (It has no
 * name — the sign over the stage is a moon, not a word.)
 *
 * The club is the room the menus live in (it replaces the bare green room)
 * and the SOCIAL FLOOR for online rooms: everyone in your room stands here
 * between sets, voices carried spatially, teleporting around the venue. When
 * the host drops the set the club packs away and the raid's void takes
 * the room; when the set resolves everyone lands back here together.
 *
 * The look is NEON INDUSTRIAL now that the venue is FIRE FIGHT's (DESIGN
 * §3.3): board-formed concrete, checker plate, galvanised steel, riveted
 * I-beams, black quilted vinyl, hazard amber — the deco plan and its craft
 * level kept, the wardrobe swapped, with saturated colour reserved for
 * light, drinks and signage. Its hero is still the ECLIPSE: concentric
 * suspended steel rings over the dance floor, cyan LED channels on their
 * undersides, slowly counter-rotating and phasing with the music, under a
 * lattice truss.
 *
 * Everything in metres, world space. You SPAWN at the origin — the same spot
 * the raid puts your platform — standing at the near edge of the dance
 * floor, facing the stage (−z). The menu board floats dead ahead.
 *
 * THE NEON DISTRICT EDITION. The venue is a basement club under the back
 * street, built in Blender and baked (public/club/neon_club.glb); this file
 * and that build read ONE layout (layout.json), so the walls you see and the
 * walls the teleport respects can't drift apart.
 *
 *   z = −12.5 ┌─ VOIDSTEP ─┬────── backstage ──────┬── MIRROR ─┐
 *             │ staff door │  LED wall · DJ booth  │ open bay  │
 *             ├─── door ───┤     ◠ stage ◠         │           │
 *             │ karaoke    │                       │  BAR      │
 *             │ pods       │     DANCE FLOOR       │  bottle   │
 *             │            │      ⊙ you spawn      │  wall     │
 *             ├─ STILL ROOM┤ ── landing ── ├ ARCADE ─────────┤
 *   z = +6    │ rain window│   stairs up ↑ │  game centre    │
 *             x = −12                                x = +12
 */

import LAYOUT from './layout.json';

/** A corner room: its box, and the doorway gap in the wall facing the floor. */
export interface ClubRoom {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  doorX0: number;
  doorX1: number;
  /** Which of the room's walls the door is in (the one facing the hall). */
  doorWall: 'north' | 'south';
}

export const CLUB = LAYOUT as unknown as {
  halfW: number;
  minZ: number;
  maxZ: number;
  /** Main ceiling; the dome over the dance floor steps up to domeH. */
  ceilH: number;
  domeH: number;
  /** The corner rooms' lower ceiling (the BALL's cable has to agree). */
  roomCeilH: number;
  /** The dance floor: a circle the raid ring roughly re-occupies. */
  floor: { x: number; z: number; r: number; tiles: { r0: number; edge: number; rings: number; tile: number } };
  /** THE HOUSE CAMERA FFTV peeps through (ClubCastSystem): bolted high in the
   *  south-east, looking across the floor at the stage. */
  cctv: { eye: { x: number; y: number; z: number }; look: { x: number; y: number; z: number } };
  spawn: { x: number; z: number };
  /** The stage drum (a half-disc against the LED wall), the DJ booth's
   *  footprint on it, and the LED wall standing behind. */
  stage: {
    z: number;
    r: number;
    h: number;
    desk: { z: number; halfW: number; halfD: number; top: number };
    ledWall: { z: number; halfW: number; top: number };
  };
  /** The bar along the east wall: counter FRONT face at `x`, standable top. */
  bar: { x: number; z0: number; z1: number; top: number; depth: number; backX: number };
  /** Karaoke pods down the west wall: table centres. */
  boothX: number;
  boothZs: number[];
  /** `northWallX`: where the north end wall stops — cut back short of the
   *  open front so THE STEP's door, just north of it, isn't walled off. */
  pods: { minX: number; frontX: number; minZ: number; maxZ: number; dividers: number[]; northWallX: number };
  /** The way in: a landing at the hall's south edge, stairs up to the alley. */
  /** The way out: a closed pair of doors in a lit portal on the south wall. */
  entrance: { halfW: number; h: number; depth: number; leafH: number; landingZ: number };
  /** THE STILL ROOM — the music ducks to a thud inside, the bar goes
   *  unheard, and talk on the far side of its wall is a murmur; voices in
   *  the room stay clear. */
  quiet: ClubRoom & {
    table: { x: number; z: number; half: number; y: number };
    window: { z0: number; z1: number; sill: number; top: number };
    lamp: { x: number; z: number };
  };
  /** THE ARCADE — the still room's loud opposite across the landing. SUPER
   *  OCTAGON's cabinet anchor (yaw: the way its screen faces), the wall board,
   *  and the three cabinets beside it in the same row (`kind`: the baked
   *  side art; `game`: what its live screen plays). */
  arcade: ClubRoom & {
    octagon: { x: number; z: number; yaw: number };
    board: { x: number; y: number; z: number; yaw: number };
    decor: { x: number; kind: string; game: 'octagon' | 'pebbles' }[];
  };
  /** THE MIRROR — a great glass on the north wall of an OPEN bay off the
   *  hall (no room around it: you walk up to it from the floor). The shell's
   *  north wall IS the glass plane; what you see in it is the hall itself,
   *  mirrored live through that plane, with everyone near you standing in it
   *  (ClubMirrorSystem). */
  mirror: {
    x: number;
    w: number;
    h: number;
    baseY: number;
    range: number;
    reflectRange: number;
    maxFigures: number;
    bay: { minX: number; maxX: number; maxZ: number };
  };
  /** THE STEP — the staff-only corridor with the VOIDSTEP portal in it.
   *  `facing`: which way the portal opens (+1: toward −z; −1: toward +z, the
   *  frame stands on the room's north wall). CourseSystem's threshold and
   *  the frame have to agree to the centimetre. */
  step: ClubRoom & { portalX: number; portalZ: number; portalW: number; portalH: number; reach: number; facing: 1 | -1 };
  /** The eclipse chandelier over the dance floor. */
  chandelier: { y: number; rings: { r: number; speed: number }[] };
};

/* ── the venue's palette: NEON INDUSTRIAL ────────────────────────────────
 * The keys are the deco wardrobe's — build.ts asks for `brass`, `velvet`,
 * `oak` in a hundred places and there is no reason to rename a hundred
 * places — but what the keys MEAN changed when the venue came over to FIRE
 * FIGHT (DESIGN §3.3): the fight-club language, gunmetal, hazard amber and
 * riveted steel, fused with the supper-club craft level, every edge with
 * thickness, saturated colour reserved for LIGHT. So `brass` is galvanised
 * steel now, `bronze` is gunmetal, `velvet` is deep red quilted velvet, `oak`
 * is painted plate, `plaster` is board-formed concrete — and the coves, the
 * signage and the rings burn neon. */
export const DECOR = {
  plaster: 0x3a3b40, // board-formed concrete
  plasterDeep: 0x2a2b30,
  oak: 0x2c2e33, // painted steel plate (was smoked oak)
  oakDark: 0x1e2024,
  brass: 0x9aa4ac, // galvanised steel (was champagne brass)
  brassDeep: 0x5e666d,
  bronze: 0x3b4048, // gunmetal (was oxidised bronze)
  /** RED VELVET, worn dark. The booths went from oxblood to a flat black
   *  vinyl when the venue came over to FIRE FIGHT, and the horseshoes lost
   *  something for it — a black seat in a black room is a silhouette, not a
   *  piece of furniture. This is the middle: unmistakably red under the
   *  club's neon, still dark enough that the coves and the rings stay the
   *  brightest things in the hall. The quilting's crowns and buttons do the
   *  rest; a velvet that reads as fabric needs a hue to catch light WITH. */
  velvet: 0x3a161c,
  velvetDeep: 0x1d0a0e,
  stone: 0x2e3035, // sealed concrete (was dark veined stone)
  candle: 0xffc678, // 2400 K practical — the one warmth kept
  gold: 0xffc23a, // THE SUN's own light: the stage burst's golden centre
  cove: 0xffb000, // HAZARD AMBER: the coves, the strips, the warnings
  face: 0xffd9ac, // 3200 K flattering key
  moon: 0xdff6ff, // the cyan-white the neon runs at
  /** The neon itself: cyan for the architecture's lines, magenta for the
   *  signage, both the rave's own (PALETTE). */
  neon: 0x4fb7ff,
  neonHot: 0xff2ad5,
  /** THE ONE RED IN THE HOUSE. Nothing in this building is allowed to
   *  wear it except a warning — so when the corner by THE STEP glows red,
   *  it means the thing it is hanging over. */
  danger: 0xff2233,
} as const;

/* ── teleport-only locomotion (the FIRE FIGHT club's system, carried over
 *    whole: arc + octagon marker + thumbstick-rolled facing + snap turn) ── */
export const TELEPORT = {
  engage: 0.5, // thumbstick magnitude that starts aiming
  release: 0.35, // …and below this on the way back, you go
  launchSpeed: 7.5, // m/s along the controller ray
  gravity: 9.8,
  arcPoints: 48,
  arcStep: 0.035, // seconds of simulated flight per arc sample
  snapAngle: (35 * Math.PI) / 180,
  snapEngage: 0.7,
  snapReset: 0.3,
  /** BACK on the stick is a short shuffle away from whatever you're facing,
   *  not a teleport arc. Aiming an arc behind your own feet meant turning
   *  round, throwing it, and turning back — three moves for the one thing
   *  you actually want at a bar, which is to be half a metre further off it.
   *  Probed at decreasing lengths so you can back right up against a wall
   *  instead of the flick doing nothing. */
  stepBack: [0.5, 0.34, 0.2],
} as const;

/** The arc + marker colours — GAMBLE FISH's, carried over with its marker
 *  (club/teleportMarker.ts): a good landing glows sea-glass, a refused one
 *  turns hazard red. (The old galvanised-steel puck went grey drawn as light.) */
export const TELEPORT_COLOURS = {
  ok: 0x5ee8d8,
  refused: 0xe8352a,
} as const;

/** Where a teleport may land: floor rectangles + the height they stand at. */
export interface FloorArea {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

const Q = CLUB.quiet;
const A = CLUB.arcade;
const S = CLUB.step;
const MB = CLUB.mirror.bay;
const B = CLUB.bar;
const E = CLUB.entrance;
const P = CLUB.pods;

/** Karaoke-pod tabletop height. */
const BOOTH_TABLE_Y = 0.72;

/** How far inside the stage drum's radius a landing may stand — the lit
 *  nosing keeps the last fifteen centimetres to itself. */
const STAGE_STAND_R = CLUB.stage.r - 0.15;
/** The stage FACE, for the wall table: the drum's edge plus the nosing. */
const STAGE_FACE_R = CLUB.stage.r + 0.3;
/** The straight line the centre floor band stops at, in front of the drum. */
const STAGE_FACE_Z = CLUB.stage.z + STAGE_FACE_R;
/** Where the side wings stop to the north: the corner room's south wall
 *  (and, on the east, the mouth of the mirror bay). */
const WING_N = S.maxZ + 0.15;
/** Where the hall stops to the south: the still room / arcade north walls. */
const HALL_S = Q.minZ - 0.2;
/** The halls' inner edge either side: the pods' open fronts, the bar's front. */
const WEST_X = P.frontX + 0.15;
const EAST_X = B.x - 0.15;
/** The centre band's half-width (the stage drum plus its nosing). */
const MID = STAGE_FACE_R - 0.1;

/** Round a half-width DOWN to the nearest five centimetres. */
const down5 = (v: number): number => Math.floor(v * 20) / 20;

/**
 * THE STAGE DECK, as the half-drum it is: bands twenty centimetres deep
 * from the lip back, each as wide as the curve allows at its front edge,
 * split into two wings where the DJ booth stands.
 */
function stageBands(): FloorArea[] {
  const out: FloorArea[] = [];
  const y = CLUB.stage.h;
  const desk = CLUB.stage.desk;
  const deskFront = desk.z + desk.halfD;
  const deskBack = desk.z - desk.halfD;
  const deskHalfW = desk.halfW + 0.13;
  const back = CLUB.stage.z + 0.1;
  for (let zFront = CLUB.stage.z + STAGE_STAND_R - 0.05; zFront > back + 0.05; zFront -= 0.2) {
    const zBack = Math.max(zFront - 0.2, back);
    const d = zFront - CLUB.stage.z;
    const hw = down5(Math.sqrt(Math.max(0, STAGE_STAND_R * STAGE_STAND_R - d * d)));
    const atDesk = zBack < deskFront && zFront > deskBack;
    if (!atDesk) {
      if (hw >= 0.3) out.push({ minX: -hw, maxX: hw, minZ: zBack, maxZ: zFront, y });
    } else if (hw > deskHalfW + 0.2) {
      out.push({ minX: deskHalfW, maxX: hw, minZ: zBack, maxZ: zFront, y });
      out.push({ minX: -hw, maxX: -deskHalfW, minZ: zBack, maxZ: zFront, y });
    }
  }
  return out;
}

/** The floor either side of the drum's bulge, between the centre band's
 *  straight edge and the stage's actual curve. */
function crescentBands(x0: number, x1: number): FloorArea[] {
  const z = down5(CLUB.stage.z + Math.sqrt(Math.max(0, STAGE_FACE_R * STAGE_FACE_R - x0 * x0))) + 0.05;
  return [
    { minX: x0, maxX: x1, minZ: z, maxZ: STAGE_FACE_Z, y: 0 },
    { minX: -x1, maxX: -x0, minZ: z, maxZ: STAGE_FACE_Z, y: 0 },
  ];
}

/** A room's interior and the strip through its doorway. */
function roomAreas(r: ClubRoom, inset = 0.25): FloorArea[] {
  const door =
    r.doorWall === 'north'
      ? { minX: r.doorX0 + 0.05, maxX: r.doorX1 - 0.05, minZ: r.minZ - 0.6, maxZ: r.minZ + inset + 0.05, y: 0 }
      : { minX: r.doorX0 + 0.05, maxX: r.doorX1 - 0.05, minZ: r.maxZ - inset - 0.05, maxZ: r.maxZ + 0.6, y: 0 };
  return [{ minX: r.minX + inset, maxX: r.maxX - inset, minZ: r.minZ + inset, maxZ: r.maxZ - inset, y: 0 }, door];
}

export const TELEPORT_AREAS: FloorArea[] = [
  // ── STANDABLE FURNITURE first, so it wins the lookup over the floor.
  // THE BAR TOP — the one perch the whole hall can see.
  { minX: B.x + 0.15, maxX: B.x + B.depth - 0.12, minZ: B.z0 + 0.3, maxZ: B.z1 - 0.2, y: B.top },
  // THE STAGE, band by band, split round the DJ booth.
  ...stageBands(),
  // The pod tables.
  ...CLUB.boothZs.map((bz) => ({ minX: CLUB.boothX - 0.42, maxX: CLUB.boothX + 0.42, minZ: bz - 0.42, maxZ: bz + 0.42, y: BOOTH_TABLE_Y })),
  // The still room's low tea table.
  { minX: Q.table.x - Q.table.half, maxX: Q.table.x + Q.table.half, minZ: Q.table.z - Q.table.half, maxZ: Q.table.z + Q.table.half, y: Q.table.y },

  // ── THE FLOOR ──
  // Centre band: from the stage face to the entrance landing (the drum is
  // in the way of one big box, so the wings either side go deeper).
  { minX: -MID, maxX: MID, minZ: STAGE_FACE_Z, maxZ: E.landingZ, y: 0 },
  { minX: WEST_X, maxX: -MID, minZ: WING_N, maxZ: HALL_S, y: 0 },
  { minX: MID, maxX: EAST_X, minZ: WING_N, maxZ: HALL_S, y: 0 },
  // South of the wings, between the corner rooms and the landing.
  { minX: Q.maxX + 0.15, maxX: -MID, minZ: HALL_S, maxZ: E.landingZ, y: 0 },
  { minX: MID, maxX: A.minX - 0.15, minZ: HALL_S, maxZ: E.landingZ, y: 0 },
  // The landing in front of the doors.
  { minX: -E.halfW + 0.2, maxX: E.halfW - 0.2, minZ: E.landingZ, maxZ: CLUB.maxZ - 0.3, y: 0 },
  // The crescents beside the drum's bulge.
  ...crescentBands(0.8, 1.6),
  ...crescentBands(1.6, 2.4),
  ...crescentBands(2.4, MID),
  // Inside the karaoke pods (their dividers are walls below).
  { minX: P.minX + 0.25, maxX: P.frontX + 0.15, minZ: P.minZ + 0.2, maxZ: P.maxZ - 0.2, y: 0 },
  // The gap the half-length north end wall leaves: from THE STEP's door
  // south into the first pod and out to the hall.
  { minX: P.northWallX + 0.2, maxX: WEST_X, minZ: WING_N, maxZ: P.minZ + 0.25, y: 0 },
  // Behind the bar, and the ways round both its ends.
  { minX: B.x + B.depth + 0.2, maxX: B.backX - 0.2, minZ: B.z0 + 0.15, maxZ: B.z1 + 0.9, y: 0 },
  { minX: EAST_X, maxX: B.backX - 0.2, minZ: B.z1 + 0.15, maxZ: HALL_S, y: 0 },
  // THE MIRROR BAY: open floor from the stage's east flank to the glass,
  // north of the bar's end (stand up to 30 cm off the glass).
  { minX: MID, maxX: MB.maxX - 0.25, minZ: CLUB.minZ + 0.3, maxZ: B.z0 - 0.45, y: 0 },
  // The corridors flanking the stage, and backstage behind the LED wall.
  { minX: S.maxX + 0.15, maxX: -MID, minZ: CLUB.minZ + 0.25, maxZ: WING_N, y: 0 },
  { minX: -MID, maxX: MID, minZ: CLUB.minZ + 0.25, maxZ: CLUB.stage.ledWall.z - 0.2, y: 0 },
  // The four corner rooms, each with its doorway strip. THE STEP stops
  // short of the portal: the threshold is floor, the glass is not.
  ...roomAreas(Q),
  ...roomAreas(A),
  { minX: S.minX + 0.25, maxX: S.maxX - 0.25, minZ: S.portalZ + 0.18, maxZ: S.maxZ - 0.25, y: 0 },
  roomAreas(S)[1],
];

/** Floor height under a point, for arcs and rigs (0 if outside any area). */
/** Inside THE STILL ROOM's four walls (club world x/z) — where the hall's
 *  music, its bar and its talk only arrive through the wall. */
export function inStillRoom(x: number, z: number): boolean {
  const Q = CLUB.quiet;
  return x >= Q.minX && x <= Q.maxX && z >= Q.minZ && z <= Q.maxZ;
}

export function floorYAt(x: number, z: number): number {
  for (const a of TELEPORT_AREAS) {
    if (x >= a.minX && x <= a.maxX && z >= a.minZ && z <= a.maxZ) return a.y;
  }
  return 0;
}

/**
 * A wall a teleport may not arc THROUGH: the XZ segment [ax, az, bx, bz],
 * plus an optional SILL — the height at which it stops being a wall and
 * becomes something you're standing on top of.
 *
 * The bar counter is the case that needs it. It has to block hops straight
 * over it at floor level (walk round the south end to get behind), while
 * still letting you up ONTO it — and, once you're up there, back down
 * either side. A sill-less segment is solid at every height.
 */
export type WallSegment = [number, number, number, number, number?];

/** The stage's curved face as silled chords, west end to east end. */
function stageFaceChords(): WallSegment[] {
  const n = 8;
  const pt = (i: number): [number, number] => {
    const a = Math.PI - (i * Math.PI) / n; // west (π) round the front to east (0)
    return [Math.cos(a) * STAGE_FACE_R, CLUB.stage.z + Math.sin(a) * STAGE_FACE_R];
  };
  const out: WallSegment[] = [];
  for (let i = 0; i < n; i++) {
    const [ax, az] = pt(i);
    const [bx, bz] = pt(i + 1);
    out.push([ax, az, bx, bz, CLUB.stage.h]);
  }
  return out;
}

/** A corner room's inner walls: the side facing the hall's middle, and the
 *  door wall split around its doorway. (The shell provides the other two.) */
function roomWalls(r: ClubRoom): WallSegment[] {
  const inner = r.minX < 0 ? r.maxX : r.minX; // the side wall facing the centre
  const z = r.doorWall === 'north' ? r.minZ : r.maxZ;
  const [x0, x1] = r.minX < 0 ? [r.minX, r.maxX] : [r.minX, r.maxX];
  return [
    [inner, r.minZ, inner, r.maxZ],
    [x0, z, r.doorX0, z],
    [r.doorX1, z, x1, z],
  ];
}

/**
 * Solid walls a teleport may not arc THROUGH. Silled segments (the stage
 * face, the bar counter) stop being walls once you're standing on top.
 */
export const WALL_SEGMENTS: WallSegment[] = [
  // Hall shell — the south wall is whole: the way out is a closed door.
  [-CLUB.halfW, CLUB.minZ, CLUB.halfW, CLUB.minZ],
  [-CLUB.halfW, CLUB.maxZ, CLUB.halfW, CLUB.maxZ],
  [-CLUB.halfW, CLUB.minZ, -CLUB.halfW, CLUB.maxZ],
  [CLUB.halfW, CLUB.minZ, CLUB.halfW, CLUB.maxZ],
  // The four corner rooms.
  ...roomWalls(Q),
  ...roomWalls(A),
  ...roomWalls(CLUB.step),
  // The karaoke pods' dividers and end walls (their fronts stay open; the
  // north end wall stops short, clear of THE STEP's door).
  [P.minX, P.minZ, P.northWallX, P.minZ],
  ...[...P.dividers, P.maxZ].map((z): WallSegment => [P.minX, z, P.frontX + 0.3, z]),
  // The stage face (silled), the drum's flat back, and the LED wall.
  ...stageFaceChords(),
  [-CLUB.stage.r, CLUB.stage.z - 0.05, CLUB.stage.r, CLUB.stage.z - 0.05],
  [-CLUB.stage.ledWall.halfW, CLUB.stage.ledWall.z, CLUB.stage.ledWall.halfW, CLUB.stage.ledWall.z],
  // The bar counter line, silled at the worktop.
  [B.x, B.z0 - 0.4, B.x, B.z1, B.top],
];

/** Do segments AB and CD properly cross? (Collinear/endpoint touches don't
 *  count — grazing a doorway edge shouldn't block the hop.) */
function segmentsCross(
  ax: number, az: number, bx: number, bz: number,
  cx: number, cz: number, dx: number, dz: number,
): boolean {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number): number =>
    (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const d1 = o(cx, cz, dx, dz, ax, az);
  const d2 = o(cx, cz, dx, dz, bx, bz);
  const d3 = o(ax, az, bx, bz, cx, cz);
  const d4 = o(ax, az, bx, bz, dx, dz);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/**
 * Does the straight path (x0,z0)→(x1,z1) cross any solid wall?
 *
 * `atY` is the HIGHER of the two ends' floor heights — the height the hop
 * is really travelling at. A silled wall (the bar counter) stops being an
 * obstacle once you're at or above its top, which is what makes climbing
 * onto the counter legal without also opening the keeper's aisle to
 * anyone standing on the floor in front of it.
 */
export function crossesWall(x0: number, z0: number, x1: number, z1: number, atY = 0): boolean {
  return WALL_SEGMENTS.some(
    ([ax, az, bx, bz, sill]) =>
      (sill === undefined || atY < sill - 1e-6) && segmentsCross(x0, z0, x1, z1, ax, az, bx, bz),
  );
}

/* ── the social wire ────────────────────────────────────────────────────── */
export const CLUB_NET = {
  /** Club pose stream rate while you're on the floor (Hz). */
  poseRateHz: 12,
  /** Remote punter pose smoothing (exponential ease rate). */
  smoothing: 12,
} as const;

/** Localstorage keys for the club's social safety lists. */
export const SOCIAL_KEYS = {
  muted: 'gdr-muted',
  blocked: 'gdr-blocked',
  voice: 'gdr-voice',
  music: 'gdr-club-music',
} as const;
