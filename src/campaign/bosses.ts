/**
 * The ARCADE titans — five boss machines in the same 90s robot-wars language
 * as the duel boxer, but built at pit-crane scale, and each one a BESPOKE
 * machine with its own silhouette you can name from across the arena:
 *
 *  I   RUSTHOOK — the scrapyard derelict. Hunched, asymmetric, rust-brown:
 *      a dented drum of a head, mismatched shoulders, exposed rib struts,
 *      and its right arm ends in a giant crane HOOK on a chain link.
 *  II  PISTONKAISER — the foundry press. Anvil-flat crowned head, twin
 *      smokestacks glowing off the shoulders, riveted slab chest, and two
 *      massive rectangular HAMMER-BLOCK fists.
 *  III VULTURE — the executioner. A hooded narrow head with a hooked beak
 *      and ONE round eye (the beam's source), swept wing-plate
 *      pauldrons, a slim tapered trunk and talon-clawed hands.
 *  IV  JUGGERNAUT — the rolling fortress. Squat and WIDE: a dome head sunk
 *      between the shoulders, double-layered bolted chest plates, and a
 *      riveted armour skirt hanging like a tank's curtain.
 *  V   GOLIATH — the king. Near-black plate with gold trim, a five-spike
 *      CROWN, a tall crest, and oversized ceremonial gauntlets.
 *
 * Every rig keeps the same animation contract (head group, visor/eye
 * material, chest CORE, shoulder pod materials, two arm pivots + fists), so
 * CampaignSystem drives them all identically. Geometry + data only;
 * behaviour lives in CampaignSystem.
 */

import {
  BoxGeometry,
  type BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  Euler,
  Group,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  Quaternion,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Object3D,
} from 'three';
import { GOOPLIATH, PALETTE, RAID, type Difficulty } from '../config.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hazardTexture } from '../materials/hazard.js';
import { titanSkin, type TitanSkinId } from '../materials/titanSkin.js';

/**
 * 'volley' is the one attack aimed at YOU instead of the floor: the shoulder
 * pods spool up and hurl fireballs you can dodge — or BLOCK with a fist.
 * 'nova' is GOLIATH's alone: fire floods the WHOLE platform except one
 * marked safe wedge — the only telegraph in the game that says "stand HERE"
 * instead of "get out".
 */
export type AttackKind = 'slam' | 'sweep' | 'beam' | 'volley' | 'nova' | 'seesaw' | 'surge';

/**
 * How a titan's slam lands — its melee signature:
 *  - 'single' : one fist, one disc.
 *  - 'rehit'  : the SAME disc detonates again moments later — punishes
 *               rushing back into the crater (RUSTHOOK's patience test).
 *  - 'march'  : a drumline of discs stepping across the platform, each with
 *               its own countdown — move on the beat (PISTONKAISER's rhythm).
 */
export type SlamStyle = 'single' | 'rehit' | 'march';

/** Which bespoke chassis buildTitan assembles. 'goop' is the odd one out:
 *  GOOPLIATH is no machine — CampaignSystem builds the vendored gel creature
 *  (src/goopliath/) instead of a TitanRig, so buildTitan never sees it. */
export type TitanStyle = 'hook' | 'piston' | 'vulture' | 'fortress' | 'king' | 'goop';

/**
 * How a titan's weak points open up. No prompts — whatever is vulnerable
 * BLINKS (the visor tell on the head, the chest core, the low emblem):
 *  - 'both'      : head AND core are open the whole fight, any order.
 *  - 'alternate' : one point at a time; every landed hit flips head↔core.
 *  - 'double'    : two hits on the blinking point, then it swaps.
 *  - 'triple'    : the cycle adds the LOW BLOW — head → core → low → repeat.
 *  - 'crown'     : GOLIATH's five-point circuit — head → left shoulder →
 *                  core → right shoulder → low — walked THREE full loops to
 *                  kill (the health bar steps down per ring hit, so it is
 *                  exactly fifteen hits no matter what you throw).
 *  - 'body'      : GOOPLIATH's law — no weak points at all. His WHOLE BODY is
 *                  the hitbox (the gel's own distance field judges contact)
 *                  and every landed fireball steps the bar down one hit.
 */
export type WeakPattern = 'both' | 'alternate' | 'double' | 'triple' | 'crown' | 'body';

export interface BossDef {
  name: string;
  /** Signature glow colour — eye/visor, core, trims, telegraph strikes. */
  accent: number;
  /** Which bespoke chassis this titan wears. */
  style: TitanStyle;
  /** Rig size multiplier; the duel boxer is roughly scale 1. */
  scale: number;
  health: number;
  /** How far BEHIND the far platform centre the titan floats (metres). */
  zOffset: number;
  /** Seconds between attacks (random in [min, max]); shrinks per stage. */
  cooldownMin: number;
  cooldownMax: number;
  /** Telegraph charge time per attack kind — the dodge window. */
  charge: Record<AttackKind, number>;
  /** Attack roster weights; 0 = this titan never uses that attack. The
   *  SLAM (the ghost block dropping onto a disc) is 0 on every titan: it
   *  was cut from the bill after play, and the SEESAW took its weight on
   *  each machine. Its machinery stays in CampaignSystem (the dev probe
   *  can still force one). */
  weights: Record<AttackKind, number>;
  /** Fireballs per volley (see 'volley' — the blockable projectiles). */
  volleyCount: number;
  /** Parallel beam strips per beam attack. */
  beams: number;
  /** Lateral drift amplitude while idling (metres). */
  swayAmp: number;

  // --- signature mechanics: what makes THIS fight feel different ---
  slamStyle: SlamStyle;
  /** Detonations in a rehit/march pattern (1 for 'single'). */
  slamCount: number;
  /** Beam telegraphs TRACK the player and only lock late — dodge late.
   *  Off on every titan: the laser that chased you was cut from the bill
   *  (the machinery stays in CampaignSystem for a later one). */
  beamTracks: boolean;
  /** Enrage threshold as an HP fraction (0 = never): faster, angrier. */
  enrageAt: number;
  /** How its weak points open (see WeakPattern) — the blink says where. */
  weakPattern: WeakPattern;
  /**
   * Platform skin id worn by the pedestal this boss fights from, for the two
   * bosses whose ground IS part of their identity: GOLIATH's pit burns
   * (BLAZING), GOOPLIATH's floods (TIDEBREAKER). The deck is the fight's
   * calling card, so it is fixed to the boss and never depends on the
   * difficulty tier, the mode, or which skins the player has earned — those
   * same two pads are the trophies you win FOR beating them.
   *
   * Omitted = the plain house pedestal in danger red, like every other titan.
   */
  platform?: string;

  /**
   * THE MOVE GRAMMAR (campaign/grammar.ts; DESIGN.md §4): the RAVE RAID
   * vocabulary this titan has LEARNED, woven into its classic roster — the
   * same machine, deeper choreography. Weights pick alongside the classic
   * ones under one law book (never the same move twice, verbs damped, THE
   * FLOOR MANAGER); each kind still respects its escalation-act minimum
   * (GRAMMAR_ACT_MIN), so an easy bout stays the fight it always was and
   * the hard tiers meet the full vocabulary. Omitted = a titan that never
   * learned to dance (GOOPLIATH's gestures stay bespoke to the gel).
   */
  grammar?: Partial<Record<import('./grammar.js').GrammarKind, number>>;
  /** Seconds per grammar beat — this titan's pulse; every cascade (twin
   *  bounces, wave marches, recital steps, the donut's one-two) steps on
   *  multiples of it. Defaults to 0.5. */
  beat?: number;
  /** Telegraph charge (seconds) for grammar moves — the read length. The
   *  windup is sacred: escalation compresses gaps, never this. */
  grammarCharge?: number;
}

export const BOSSES: BossDef[] = [
  {
    name: 'RUSTHOOK',
    accent: PALETTE.coolFlame,
    style: 'hook',
    scale: 1.25,
    health: 210,
    zOffset: 0.2,
    cooldownMin: 2.6,
    cooldownMax: 3.6,
    charge: { slam: 1.9, sweep: 2.1, beam: 1.7, volley: 2.0, nova: 2.2, seesaw: 1.7, surge: 1.8 },
    weights: { slam: 0, sweep: 0, beam: 3, volley: 0, nova: 0, seesaw: 5, surge: 0 },
    volleyCount: 3,
    beams: 1,
    swayAmp: 0.4,
    slamStyle: 'rehit',
    slamCount: 2,
    beamTracks: false,
    enrageAt: 0,
    weakPattern: 'both',
    // The scrapyard learned the GATE: a fence of fire with one gap — the
    // junkyard's own move, and the plainest read in the new vocabulary.
    grammar: { gate: 3, lanes: 2 },
    beat: 0.56,
    grammarCharge: 2.1,
  },
  {
    name: 'PISTONKAISER',
    accent: PALETTE.amber,
    style: 'piston',
    scale: 1.5,
    health: 220,
    zOffset: 0.3,
    cooldownMin: 2.2,
    cooldownMax: 3.2,
    charge: { slam: 1.6, sweep: 1.9, beam: 1.6, volley: 1.9, nova: 2.2, seesaw: 1.7, surge: 1.8 },
    weights: { slam: 0, sweep: 3, beam: 2, volley: 0, nova: 0, seesaw: 4, surge: 2 },
    volleyCount: 3,
    beams: 1,
    swayAmp: 0.5,
    slamStyle: 'march',
    slamCount: 3,
    beamTracks: false,
    enrageAt: 0,
    weakPattern: 'alternate',
    // The foundry press learned the WAVE: its drumline slam was already a
    // march — now the whole deck marches (and the classic surge, weighted
    // above, rocks it lengthways).
    // The CROSS too (every titan past the scrapyard throws it): the arms
    // go out like wings and snap across the body as the side rails fire.
    grammar: { wave: 4, cross: 3 },
    beat: 0.5,
    grammarCharge: 2.0,
  },
  {
    name: 'VULTURE',
    accent: 0x7cff4a,
    style: 'vulture',
    scale: 1.8,
    health: 300,
    zOffset: 0.45,
    cooldownMin: 1.9,
    cooldownMax: 2.8,
    charge: { slam: 1.45, sweep: 1.7, beam: 1.55, volley: 1.7, nova: 2.2, seesaw: 1.7, surge: 1.8 },
    weights: { slam: 0, sweep: 4, beam: 4, volley: 2, nova: 0, seesaw: 3, surge: 0 },
    volleyCount: 4,
    beams: 1,
    swayAmp: 0.6,
    slamStyle: 'single',
    slamCount: 1,
    beamTracks: false,
    enrageAt: 0,
    weakPattern: 'double',
    // The executioner learned the CROSSFIRE — rails from the side emitters,
    // the lattice, THE TRAP's jaws — and throws THE X through the lanes.
    grammar: { cross: 4, lanes: 3 },
    beat: 0.5,
    grammarCharge: 1.9,
  },
  {
    name: 'JUGGERNAUT',
    accent: 0xb26bff,
    style: 'fortress',
    scale: 2.15,
    health: 380,
    zOffset: 0.6,
    cooldownMin: 1.6,
    cooldownMax: 2.4,
    charge: { slam: 1.3, sweep: 1.5, beam: 1.25, volley: 2.0, nova: 2.2, seesaw: 1.7, surge: 1.8 },
    weights: { slam: 0, sweep: 2, beam: 4, volley: 5, nova: 0, seesaw: 3, surge: 0 },
    volleyCount: 3,
    beams: 2,
    swayAmp: 0.45,
    slamStyle: 'single',
    slamCount: 1,
    beamTracks: false,
    enrageAt: 0,
    weakPattern: 'triple',
    // The rolling fortress learned to close its walls: row gates and the
    // donut's collapsing rim — ground that shrinks until you hold the middle.
    grammar: { gate: 3, donut: 3, cross: 3 },
    beat: 0.48,
    grammarCharge: 2.0,
  },
  {
    name: 'GOLIATH',
    accent: PALETTE.danger,
    style: 'king',
    scale: 2.6,
    health: 480,
    zOffset: 0.8,
    cooldownMin: 1.35,
    cooldownMax: 2.1,
    // nova carries an extra half-second of windup — rotating a whole squad
    // to one safe wedge needs more read time than a single dodge. The beam
    // (laser) cooks 0.4s longer than its raw pace too, for a fairer dodge on
    // the fastest titan's shot.
    charge: { slam: 1.15, sweep: 1.35, beam: 1.6, volley: 1.8, nova: 2.6, seesaw: 1.7, surge: 1.8 },
    weights: { slam: 0, sweep: 3, beam: 3, volley: 3, nova: 4, seesaw: 3, surge: 0 },
    volleyCount: 4,
    beams: 2,
    swayAmp: 0.35,
    slamStyle: 'march',
    slamCount: 2,
    beamTracks: false,
    enrageAt: 0.5,
    weakPattern: 'crown',
    platform: 'blazing',
    // The king learned it all — and being the king, he TEACHES: THE RECITAL
    // is his memory test, the wave his procession, and once in a blazing
    // night the COMBINATION (duckdonut) closes the show on the beat.
    // THE RECITAL was cut from the bill after a night on it (the machinery
    // stays in grammar.ts for the check and for a later bill).
    grammar: { wave: 3, donut: 2, cross: 3, duckdonut: 0.4 },
    beat: 0.46,
    grammarCharge: 1.9,
  },
];

/** Small-squad mercy: `mult` is a cadence multiplier tuned for FOUR raiders
 *  sharing the heat — each missing raider below four eases it back toward
 *  1.0 (solo pace), capped so a duo still fights a raid-tempo titan. */
function easeCadence(mult: number, raiders: number): number {
  const ease = Math.min(0.6, Math.max(0, 4 - raiders) * RAID.cooldownEase);
  return mult + (1 - mult) * ease;
}

/**
 * The RAID cut of a titan: EVERY raid stage is a giant — the smallest raid
 * machine starts at solo GOLIATH's size and each stage grows past that — with
 * a health pool sized to the squad (`healthPerRaider` × the launch raider
 * count, 2–5), and a cadence tuned per stage to how many raiders each swing
 * marks — stage I rotates one target and swings fast; stage III+ mark the
 * whole squad, so the pace eases back toward solo. Short squads get the
 * cadence eased toward solo too (easeCadence).
 */
export function raidBoss(def: BossDef, stage: number, raiders: number): BossDef {
  const charge = { ...def.charge };
  for (const k of Object.keys(charge) as AttackKind[]) charge[k] *= RAID.chargeMult;
  const cd = easeCadence(RAID.cooldownMult[stage] ?? RAID.cooldownMult[RAID.cooldownMult.length - 1] ?? 0.9, raiders);
  const goliath = BOSSES[BOSSES.length - 1]!;
  return {
    ...def,
    scale: goliath.scale * (1 + RAID.scaleStageStep * stage),
    health: Math.round(def.health * RAID.healthPerRaider * raiders),
    cooldownMin: def.cooldownMin * cd,
    cooldownMax: def.cooldownMax * cd,
    charge,
    // The grammar reads tighten on the same raid law as the classic charges.
    grammarCharge: def.grammarCharge === undefined ? undefined : def.grammarCharge * RAID.chargeMult,
  };
}

/**
 * GOOPLIATH — the living tide. Not a machine and not a gauntlet stage: the
 * gel creature from GOOP at titan scale, his own fight on both boards (the
 * sealed campaign entry beneath the line-up; the raid lobby's second
 * breaker). `health` is a HIT COUNT, not damage — his whole body is the
 * hitbox and every landed ball steps the bar one notch (weakPattern 'body').
 * The moveset: the horizontal sweep (with the full-turn lash in raids), the
 * eye beams, GOLIATH's safe-wedge nova — and the SEESAW, his alone:
 * one half of the platform floods, then the other, and the cascade grows
 * legs as he drains (GOOPLIATH.seesawStages).
 */
export const GOOPLIATH_DEF: BossDef = {
  name: 'GOOPLIATH',
  accent: 0x36e05a,
  style: 'goop',
  scale: GOOPLIATH.scaleCampaign,
  health: GOOPLIATH.hitsCampaign,
  zOffset: 0.9,
  // Deliberately unhurried openers for THE longest fight in the game — the
  // escalation comes from GOOPLIATH.finalHaste as his health drains, not
  // from a frantic opening.
  cooldownMin: 2.3,
  cooldownMax: 3.3,
  charge: { slam: 1.6, sweep: 1.7, beam: 1.75, volley: 1.8, nova: 2.6, seesaw: 1.8, surge: 1.8 },
  weights: { slam: 0, sweep: 3, beam: 3, volley: 3, nova: 3, seesaw: 5, surge: 0 },
  volleyCount: 4,
  beams: 2,
  swayAmp: 0, // the gel sim carries its own idle motion
  slamStyle: 'single',
  slamCount: 1,
  beamTracks: false,
  enrageAt: 0.35,
  weakPattern: 'body',
  platform: 'tidebreaker',
};

/**
 * One boss slot in a full RUN (gauntlet / hardcore / raid). Normally the run
 * is just the five titans; on BLAZING, GOOPLIATH slots in as the 2nd-to-last
 * boss — fought right before GOLIATH — so the hardest runs carry the living
 * tide too. (He is otherwise a standalone fight; see the sealed campaign
 * entry and the raid breaker.)
 */
export type RunStage = { kind: 'titan'; index: number } | { kind: 'goop' };

/** The boss order for a run at `difficulty`. Blazing is the only tier that
 *  differs — it wedges GOOPLIATH in before the king. */
export function runLineup(difficulty: Difficulty): RunStage[] {
  const titans: RunStage[] = BOSSES.map((_, i) => ({ kind: 'titan', index: i }));
  if (difficulty !== 'blazing') return titans;
  const last = titans.length - 1; // GOLIATH stays the finale
  return [...titans.slice(0, last), { kind: 'goop' }, titans[last]];
}

/** The RAID cut of GOOPLIATH: taller than any raid titan, one squad's worth
 *  of hits (`hitsPerRaider` × the launch raider count), and slightly
 *  snappier telegraphs (same laws as raidBoss, mercy included). */
export function goopliathBoss(raid: boolean, raiders = 4): BossDef {
  if (!raid) return GOOPLIATH_DEF;
  const charge = { ...GOOPLIATH_DEF.charge };
  for (const k of Object.keys(charge) as AttackKind[]) charge[k] *= RAID.chargeMult;
  const cd = easeCadence(0.85, raiders);
  return {
    ...GOOPLIATH_DEF,
    scale: GOOPLIATH.scaleRaid,
    health: GOOPLIATH.hitsPerRaider * raiders,
    cooldownMin: GOOPLIATH_DEF.cooldownMin * cd,
    cooldownMax: GOOPLIATH_DEF.cooldownMax * cd,
    charge,
  };
}

// --- rig ---------------------------------------------------------------------

/** One finger, talon or hook that CURLS: a hinge and its open/closed
 *  pitch about that hinge's x. */
export interface TitanDigit {
  node: Object3D;
  open: number;
  closed: number;
}

export interface TitanArm {
  /** Shoulder pivot — rotate to wind up and strike. */
  pivot: Group;
  /** THE ELBOW: a real joint under the upper arm; negative x folds the
   *  forearm forward/up (the same sign the shoulder raises with). */
  elbow: Group;
  /** THE WRIST at the forearm's end: negative x bends the hand back (a
   *  palm held out), positive forward (a chop, a baton's flick). */
  wrist: Group;
  /** The gauntlet / hook / talon hanging off the wrist. */
  fist: Group;
  /** Whatever on the hand can close — talons, fingers — for the curl. */
  digits: TitanDigit[];
  /** Rest pose captured at build time so animation can ease home. */
  restX: number;
  restZ: number;
}

export interface TitanRig {
  root: Group;
  head: Group;
  /** The eye/visor glow — blinks while the HEAD is a live weak point. */
  visorMat: MeshStandardMaterial;
  /** The eye lamp meshes themselves — they SCALE-pulse with the head blink
   *  (like the core does) so the tell reads even where colour alone won't. */
  eyes: Mesh[];
  /** Beam charge flare: a glow orb over the eye, hidden until a laser cooks;
   *  CampaignSystem swells it with the charge so the wind-up reads. */
  eyeFx: Mesh;
  core: Mesh;
  /** The chest core glow — blinks while the CORE is a live weak point. */
  coreMat: MeshStandardMaterial;
  /** The LOW-BLOW emblem on the pelvis (JUGGERNAUT's third target). */
  low: Mesh;
  /** Its glow — blinks while the low blow is the live weak point. */
  lowMat: MeshStandardMaterial;
  /** VULTURE's wings (empty on every other chassis): shoulder group + wrist
   *  kink per side, so the entrance can spread them and settle to mantled. */
  wings: { group: Group; wrist: Group; side: number }[];
  /** Shoulder emblems [left, right] — GOLIATH's crown circuit stops. */
  shoulders: [Mesh, Mesh];
  /** Their glows — blink while that shoulder is the live weak point. */
  shoulderMats: [MeshStandardMaterial, MeshStandardMaterial];
  podMats: [MeshStandardMaterial, MeshStandardMaterial];
  arms: [TitanArm, TitanArm];
  /** Key world-frame heights (root at y=0): head centre and core centre. */
  headY: number;
  coreY: number;
  /** Full height, for the rise-from-the-pit intro. */
  height: number;
  dispose(): void;
}

/** Per-style paint: chassis steel + dark trim (accent glows come from defs). */
// (A shade lighter than they were flat: the skins multiply over the paint
// and average a little under white, and the trims were so near black that
// no grain could show on them.)
const STYLE_PAINT: Record<TitanStyle, { chassis: number; trim: number }> = {
  hook: { chassis: 0x6b5236, trim: 0x3d3021 }, // oxidised rust-brown
  piston: { chassis: 0x5a606b, trim: 0x353a44 }, // foundry iron
  vulture: { chassis: 0x3b4333, trim: 0x262c21 }, // olive plumage steel
  fortress: { chassis: 0x433a52, trim: 0x2d2640 }, // bruised violet plate
  king: { chassis: 0x1c1d23, trim: 0x131419 }, // near-black royal plate
  goop: { chassis: 0x14602f, trim: 0x0a2e18 }, // bottle-green gel (never built as a rig)
};

const GOLD = 0xd9a832;

/** Which procedural skin each chassis wears (materials/titanSkin.ts). */
const STYLE_SKIN: Partial<Record<TitanStyle, TitanSkinId>> = {
  hook: 'rust',
  piston: 'forged',
  vulture: 'plumage',
  fortress: 'armour',
  king: 'royal',
};

/** Many small copies of one shape (track links, chain links) as ONE mesh's
 *  geometry — a row of thirty parts costs one draw, not thirty. Each entry
 *  is a position and an optional rotation. */
function repeated(geo: BufferGeometry, at: Array<[number, number, number, number?, number?, number?]>): BufferGeometry {
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const parts = at.map(([x, y, z, rx = 0, ry = 0, rz = 0]) => {
    m.compose(new Vector3(x, y, z), q.setFromEuler(new Euler(rx, ry, rz)), one);
    return geo.clone().applyMatrix4(m);
  });
  const merged = mergeGeometries(parts) ?? geo.clone();
  parts.forEach((g) => g.dispose());
  geo.dispose();
  return merged;
}

/** A stencilled word for a plate — off-white paint, sprayed and scuffed,
 *  on a transparent card the plate shows through. */
function stencil(text: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 160;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(232,226,210,0.92)';
  g.font = '900 128px Impact, "Arial Black", sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 84);
  // The stencil's bridges and the wear: knock holes out of the paint.
  g.globalCompositeOperation = 'destination-out';
  g.fillRect(0, 78, 256, 7);
  for (let i = 0; i < 260; i++) {
    g.fillStyle = `rgba(0,0,0,${0.3 + Math.random() * 0.7})`;
    g.fillRect(Math.random() * 256, Math.random() * 160, 1 + Math.random() * 5, 1 + Math.random() * 3);
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * THE FINISH — the pass that takes a titan off the drawing board. Every
 * part above is authored as a plain box or cylinder (the numbers stay
 * readable that way); this runs once over the finished rig:
 *
 *  - every box becomes a BEVELLED box, the same size — the edges catch a
 *    highlight instead of cutting off hard, and the machine stops reading
 *    as blocks;
 *  - every cylinder of eight sides or more gets enough of them to read as
 *    round (tiny parts — bolts, claws, spikes — keep their few);
 *  - every plate (not the glows, not the gold) wears the machine's SKIN,
 *    its UVs scaled to the part's size so a small plate and a big one
 *    carry the same grain.
 *
 * Geometry sizes never change, so the pivots, the hitboxes and every
 * animation keep their numbers.
 */
function finishTitan(root: Group, style: TitanStyle, s: number): void {
  const skinId = STYLE_SKIN[style];
  const skin = skinId ? titanSkin(skinId) : null;
  const tile = 0.32 * s; // world metres per repeat of the skin
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const g = m.geometry;
    let su = 1;
    let sv = 1;
    if (g instanceof BoxGeometry) {
      const { width, height, depth } = g.parameters;
      const r = Math.min(width, height, depth) * 0.22;
      m.geometry = new RoundedBoxGeometry(width, height, depth, 2, r);
      g.dispose();
      su = sv = Math.max(width, height, depth) / tile;
    } else if (g instanceof CylinderGeometry) {
      const p = g.parameters;
      if (p.radialSegments >= 8 && p.radialSegments < 20) {
        m.geometry = new CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, 20, p.heightSegments, p.openEnded, p.thetaStart, p.thetaLength);
        g.dispose();
      }
      su = (Math.PI * (p.radiusTop + p.radiusBottom)) / tile;
      sv = p.height / tile;
    }
    const mat = m.material as MeshStandardMaterial;
    if (!skin || !mat.isMeshStandardMaterial || mat.emissiveIntensity >= 0.15 || mat.transparent || mat.map) return;
    const uv = m.geometry.getAttribute('uv');
    if (uv) {
      const k = [Math.max(0.35, su), Math.max(0.35, sv)];
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * k[0], uv.getY(i) * k[1]);
      uv.needsUpdate = true;
    }
    // The accent's faint self-glow on a plate stays a hint: on RUSTHOOK's
    // dark rust it was outshining the paint and the steel read ice-blue.
    mat.emissiveIntensity *= 0.3;
    mat.map = skin.map;
    mat.roughnessMap = skin.roughnessMap;
    mat.roughness = 1;
    mat.metalnessMap = skin.metalnessMap;
    mat.metalness = 1;
    mat.bumpMap = skin.bumpMap;
    mat.bumpScale = skin.bumpScale * 3;
    mat.needsUpdate = true;
  });
}

function steelMat(color: number, emissive = 0, intensity = 0): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive,
    emissiveIntensity: intensity,
    metalness: 0.9,
    roughness: 0.34,
  });
}

function glowMat(color: number, intensity = 1.4): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.3,
  });
}

/**
 * Assemble a titan at `def.scale`. The root group sits at world (0,0,z) with
 * y=0 at the arena floor; CampaignSystem parents it to the scene, sinks it
 * for the intro rise, and drives the pivots/materials from there. All five
 * styles share one skeleton (head / chest+core / pods / two arm pivots) so
 * the animation contract never changes — everything AROUND the skeleton is
 * bespoke per machine.
 */
export function buildTitan(def: BossDef): TitanRig {
  const s = def.scale;
  const accent = def.accent;
  const paint = STYLE_PAINT[def.style];
  const chassis = (e = 0, i = 0): MeshStandardMaterial => steelMat(paint.chassis, e, i);
  const dark = (): MeshStandardMaterial => steelMat(paint.trim);

  const root = new Group();
  root.name = `titan-${def.name.toLowerCase()}`;

  const squat = def.style === 'fortress';
  const hunched = def.style === 'hook';
  const hipY = 0.78 * s;
  const shoulderY = (squat ? 1.12 : 1.22) * s;
  const headY = (hunched ? 1.4 : squat ? 1.34 : 1.5) * s;

  // ── HEAD — bespoke per machine, the visor/eye glow shared ────────────────
  const head = new Group();
  const headR = 0.16 * s;
  const visorMat = glowMat(accent, 1.8);
  // Every eye lamp lands here so the head tell can SCALE-pulse them.
  const eyes: Mesh[] = [];

  switch (def.style) {
    case 'hook': {
      // A dented oil-drum head, tipped off-axis, with two big round lamp
      // EYES set proud of the drum — the blink tell has to read from across
      // the arena, and a thin slit never did.
      const drum = new Mesh(new CylinderGeometry(headR * 0.95, headR * 1.05, headR * 1.7, 10), chassis(accent, 0.05));
      drum.rotation.z = 0.12;
      head.add(drum);
      // A bent whip antenna — snapped in some forgotten bout, never fixed.
      const aerialLo = new Mesh(new CylinderGeometry(0.008 * s, 0.012 * s, headR * 0.9, 5), dark());
      aerialLo.position.set(headR * 0.55, headR * 1.05, headR * 0.2);
      aerialLo.rotation.z = -0.25;
      head.add(aerialLo);
      const aerialHi = new Mesh(new CylinderGeometry(0.006 * s, 0.008 * s, headR * 0.7, 5), dark());
      aerialHi.position.set(headR * 0.72, headR * 1.55, headR * 0.32);
      aerialHi.rotation.z = 1.15; // the kink — bent nearly flat
      aerialHi.rotation.x = 0.2;
      head.add(aerialHi);
      const dent = new Mesh(new BoxGeometry(headR * 1.4, 0.05 * s, headR * 0.9), dark());
      dent.position.set(headR * 0.2, headR * 0.75, 0);
      dent.rotation.z = -0.2;
      head.add(dent);
      for (const ex of [-1, 1]) {
        const socket = new Mesh(new CylinderGeometry(headR * 0.32, headR * 0.32, 0.03 * s, 10), dark());
        socket.rotation.x = Math.PI / 2;
        socket.position.set(ex * headR * 0.44, headR * 0.12 * ex * 0.5, -headR * 0.95); // crooked pair
        head.add(socket);
        const eye = new Mesh(new CylinderGeometry(headR * 0.24, headR * 0.24, 0.045 * s, 10), visorMat);
        eye.rotation.x = Math.PI / 2;
        eye.position.set(ex * headR * 0.44, headR * 0.12 * ex * 0.5, -headR * 1.03);
        head.add(eye);
        eyes.push(eye);
      }
      break;
    }
    case 'piston': {
      // An anvil: flat-topped block head with a heavy brow and two big
      // rectangular lamp EYES set proud of the face — the thin visor strip
      // it had before never read as a blink from across the arena.
      const anvil = new Mesh(new BoxGeometry(headR * 2.4, headR * 1.5, headR * 1.8), chassis(accent, 0.06));
      head.add(anvil);
      const horn = new Mesh(new BoxGeometry(headR * 0.9, headR * 0.9, headR * 0.8), dark());
      horn.position.set(headR * 1.5, headR * 0.1, 0);
      head.add(horn);
      // A furnace seam glowing along the anvil's base — the head runs HOT.
      const seam = new Mesh(new BoxGeometry(headR * 2.45, 0.02 * s, headR * 1.85), glowMat(accent, 0.8));
      seam.position.y = -headR * 0.68;
      head.add(seam);
      const brow = new Mesh(new BoxGeometry(headR * 2.5, 0.08 * s, headR * 0.5), dark());
      brow.position.set(0, headR * 0.5, -headR * 0.78);
      head.add(brow);
      for (const ex of [-1, 1]) {
        const socket = new Mesh(new BoxGeometry(headR * 0.9, headR * 0.52, 0.04 * s), dark());
        socket.position.set(ex * headR * 0.62, headR * 0.02, -headR * 0.92);
        head.add(socket);
        const eye = new Mesh(new BoxGeometry(headR * 0.64, headR * 0.34, 0.06 * s), visorMat);
        eye.position.set(ex * headR * 0.62, headR * 0.02, -headR * 0.99);
        head.add(eye);
        eyes.push(eye);
      }
      break;
    }
    case 'vulture': {
      // A hooded scavenger skull: narrow casque and ONE big round eye — the
      // source of the beam, so the tell reads at a glance. (No beak:
      // the old cone hung straight over the eye and hid the blink.)
      const hood = new Mesh(new CylinderGeometry(headR * 0.55, headR * 0.9, headR * 1.9, 8), chassis(accent, 0.06));
      hood.rotation.x = 0.28; // craned forward, watching you
      head.add(hood);
      // The half-beak: a short down-turned hook off the CHIN, well below the
      // eye so the blink stays clear — the executioner's profile in one cut.
      const beakRoot = new Mesh(new BoxGeometry(headR * 0.34, headR * 0.3, headR * 0.5), dark());
      beakRoot.position.set(0, -headR * 0.72, -headR * 0.85);
      beakRoot.rotation.x = 0.5;
      head.add(beakRoot);
      const beakTip = new Mesh(new CylinderGeometry(0.004 * s, headR * 0.16, headR * 0.55, 5), dark());
      beakTip.position.set(0, -headR * 1.0, -headR * 0.98);
      beakTip.rotation.x = Math.PI - 0.55; // point curls down-and-back
      head.add(beakTip);
      // The eye sits PROUD of the hood's rim — tucked inside the casque it
      // was invisible, and a blink nobody can see is no tell at all.
      const eye = new Mesh(new CylinderGeometry(headR * 0.42, headR * 0.42, 0.05 * s, 12), visorMat);
      eye.rotation.x = Math.PI / 2 + 0.28; // faces out along the craned hood
      eye.position.set(0, headR * 0.14, -headR * 1.12);
      head.add(eye);
      eyes.push(eye);
      const crest = new Mesh(new BoxGeometry(0.015 * s, headR * 0.9, headR * 1.4), dark());
      crest.position.y = headR * 1.0;
      crest.rotation.x = 0.28;
      head.add(crest);
      break;
    }
    case 'fortress': {
      // A low armoured dome, half-sunk — no neck, all bunker.
      const dome = new Mesh(new CylinderGeometry(headR * 1.15, headR * 1.3, headR * 1.1, 10), chassis(accent, 0.05));
      head.add(dome);
      const cap = new Mesh(new CylinderGeometry(headR * 0.6, headR * 1.1, headR * 0.55, 10), dark());
      cap.position.y = headR * 0.75;
      head.add(cap);
      // Periscope stub off the cap — the commander never opens the hatch.
      const scopeMast = new Mesh(new CylinderGeometry(headR * 0.12, headR * 0.12, headR * 0.6, 6), dark());
      scopeMast.position.set(headR * 0.45, headR * 1.2, headR * 0.1);
      head.add(scopeMast);
      const scopeHead = new Mesh(new BoxGeometry(headR * 0.3, headR * 0.22, headR * 0.42), dark());
      scopeHead.position.set(headR * 0.45, headR * 1.55, -headR * 0.02);
      head.add(scopeHead);
      const slot = new Mesh(new BoxGeometry(headR * 1.7, 0.03 * s, 0.03 * s), visorMat);
      slot.position.set(0, headR * 0.1, -headR * 1.05);
      head.add(slot);
      eyes.push(slot);
      // Bolt studs ringing the dome.
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const bolt = new Mesh(new BoxGeometry(0.03 * s, 0.03 * s, 0.03 * s), dark());
        bolt.position.set(Math.cos(a) * headR * 1.15, -headR * 0.3, Math.sin(a) * headR * 1.15);
        head.add(bolt);
      }
      break;
    }
    case 'king': {
      // The royal helm: tall eight-sided casque, gold five-spike crown.
      const helm = new Mesh(new CylinderGeometry(headR * 0.85, headR * 1.0, headR * 2.1, 8), chassis(accent, 0.08));
      head.add(helm);
      const band = new Mesh(new CylinderGeometry(headR * 0.95, headR * 0.95, 0.04 * s, 8), steelMat(GOLD, GOLD, 0.35));
      band.position.y = headR * 0.9;
      head.add(band);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const spike = new Mesh(new CylinderGeometry(0.005 * s, 0.024 * s, headR * 0.85, 4), steelMat(GOLD, GOLD, 0.4));
        spike.position.set(Math.cos(a) * headR * 0.78, headR * 1.35, Math.sin(a) * headR * 0.78);
        head.add(spike);
      }
      // A jewel set in the band under every spike, burning the king's colour.
      head.add(
        new Mesh(
          repeated(
            new SphereGeometry(0.019 * s, 10, 8),
            [0, 1, 2, 3, 4].map((i) => {
              const a = (i / 5) * Math.PI * 2;
              return [Math.cos(a) * headR * 0.97, headR * 0.9, Math.sin(a) * headR * 0.97] as [number, number, number];
            }),
          ),
          glowMat(accent, 1.3),
        ),
      );
      const visor = new Mesh(new BoxGeometry(headR * 1.5, 0.035 * s, 0.03 * s), visorMat);
      visor.position.set(0, 0.01 * s, -headR * 0.95);
      head.add(visor);
      eyes.push(visor);
      const jaw = new Mesh(new BoxGeometry(headR * 1.1, 0.05 * s, 0.06 * s), dark());
      jaw.position.set(0, -headR * 0.62, -headR * 0.72);
      head.add(jaw);
      // The war plume: a blade of royal fire rising through the crown's
      // circle — the king's colours flying over the helm.
      const plume = new Mesh(new BoxGeometry(0.02 * s, headR * 1.1, headR * 0.55), glowMat(accent, 1.1));
      plume.position.set(0, headR * 1.6, headR * 0.1);
      plume.rotation.x = -0.12; // swept back
      head.add(plume);
      break;
    }
  }
  // The beam CHARGE FLARE: a translucent glow orb mounted over the eye,
  // hidden until a laser cooks — CampaignSystem swells and throbs it with
  // the charge so the wind-up reads across the arena (the superheated eye
  // material alone never did).
  const eyeFxMat = glowMat(accent, 2.4);
  eyeFxMat.transparent = true;
  eyeFxMat.opacity = 0.5;
  eyeFxMat.depthWrite = false;
  const eyeFx = new Mesh(new SphereGeometry(headR * 0.55, 14, 10), eyeFxMat);
  eyeFx.visible = false;
  // Where each chassis mounts its eye/visor (head-local, in headR units).
  const EYE_ANCHOR: Record<TitanStyle, [number, number, number]> = {
    hook: [0, 0.06, -1.0],
    piston: [0, 0.02, -0.99],
    vulture: [0, 0.14, -1.12],
    fortress: [0, 0.1, -1.05],
    king: [0, 0.06, -0.95],
    goop: [0, 0.06, -0.95], // never built — the gel creature has real eyes
  };
  const [ax, ay, az] = EYE_ANCHOR[def.style];
  eyeFx.position.set(ax * headR, ay * headR, az * headR);
  head.add(eyeFx);

  head.position.set(0, headY, 0);
  root.add(head);

  // ── TORSO — shared frame, bespoke dressing ────────────────────────────────
  const chest = new Group();
  chest.position.y = shoulderY;
  // JUGGERNAUT carries extra beam: the fortress hull is built FAT — every
  // width below stretches by `wide`, so it reads as bulk, not scale.
  const wide = def.style === 'fortress' ? 1.22 : 1;
  const yokeW = (def.style === 'fortress' ? 0.86 : def.style === 'vulture' ? 0.56 : 0.62) * s;
  const yoke = new Mesh(new BoxGeometry(yokeW, 0.13 * s, 0.26 * s), chassis(accent, 0.05));
  yoke.position.y = 0.06 * s;
  chest.add(yoke);

  // Shoulders per style.
  const wings: TitanRig['wings'] = [];
  for (const side of [-1, 1]) {
    if (def.style === 'vulture') {
      // The WINGS — a real span, not pauldron trim: an inner spar out of the
      // shoulder, a wrist joint kinking the outer spar higher, and primaries
      // fanning off both, longest at the tip. Mantled up-and-back like a
      // raptor deciding whether you're worth the swoop.
      const wing = new Group();
      wing.position.set(side * 0.28 * s, 0.16 * s, 0.14 * s);
      wing.rotation.y = side * 0.35; // swept back off the shoulders
      wing.rotation.z = side * 0.5; // raised up-and-out
      chest.add(wing);
      const spar1 = new Mesh(new BoxGeometry(0.5 * s, 0.05 * s, 0.035 * s), chassis(accent, 0.04));
      spar1.position.x = side * 0.25 * s;
      wing.add(spar1);
      // Coverts: short overlapping plates shingled along the arm spar, the
      // way a real wing's small feathers cover the bones.
      wing.add(
        new Mesh(
          repeated(
            new BoxGeometry(0.075 * s, 0.1 * s, 0.014 * s),
            [0, 1, 2, 3].map((f) => [side * (0.07 + f * 0.1) * s, -0.02 * s, -0.022 * s, 0, 0, side * 0.35] as [number, number, number, number, number, number]),
          ),
          chassis(accent, 0.04),
        ),
      );
      for (let f = 0; f < 3; f++) {
        // Inner primaries hang off the arm spar, splaying slightly outward.
        const len = (0.3 + f * 0.06) * s;
        const rot = side * (0.08 + f * 0.1);
        const feather = new Mesh(new BoxGeometry(0.055 * s, len, 0.018 * s), dark());
        feather.position.set(side * (0.12 + f * 0.13) * s, -len / 2 + 0.02 * s, 0);
        feather.rotation.z = rot;
        wing.add(feather);
      }
      const wrist = new Group();
      wrist.position.x = side * 0.5 * s;
      wrist.rotation.z = side * 0.55; // the kink — outer wing reaches higher
      wing.add(wrist);
      wings.push({ group: wing, wrist, side });
      const joint = new Mesh(new CylinderGeometry(0.045 * s, 0.045 * s, 0.06 * s, 8), dark());
      joint.rotation.x = Math.PI / 2;
      wrist.add(joint);
      const spar2 = new Mesh(new BoxGeometry(0.44 * s, 0.04 * s, 0.03 * s), chassis(accent, 0.04));
      spar2.position.x = side * 0.22 * s;
      wrist.add(spar2);
      for (let f = 0; f < 4; f++) {
        // Outer primaries: the long blades, tipped in a dim ember of accent.
        const len = (0.42 + f * 0.09) * s;
        const rot = side * (0.12 + f * 0.11);
        const fx = side * (0.08 + f * 0.11) * s;
        const feather = new Mesh(new BoxGeometry(0.05 * s, len, 0.016 * s), dark());
        feather.position.set(fx, -len / 2 + 0.02 * s, 0);
        feather.rotation.z = rot;
        wrist.add(feather);
        const tip = new Mesh(new BoxGeometry(0.05 * s, 0.045 * s, 0.017 * s), glowMat(accent, 0.35));
        // Anchor the ember on the feather's far end: the blade pivots about
        // its centre, so the end lands at centre + R(rot)·(0, −len/2).
        tip.position.set(fx + Math.sin(rot) * (len / 2), -len / 2 + 0.02 * s - Math.cos(rot) * (len / 2) + 0.02 * s, 0);
        tip.rotation.z = rot;
        wrist.add(tip);
      }
    } else if (def.style === 'hook' && side === 1) {
      // RUSTHOOK's right shoulder is a bare stub — the armour fell off years ago.
      const stub = new Mesh(new BoxGeometry(0.14 * s, 0.1 * s, 0.2 * s), dark());
      stub.position.set(side * 0.34 * s, 0.08 * s, 0);
      chest.add(stub);
    } else {
      const padW = (def.style === 'fortress' ? 0.36 : 0.24) * s;
      const pad = new Mesh(new BoxGeometry(padW, 0.18 * s, 0.32 * s), dark());
      pad.position.set(side * 0.37 * wide * s, 0.08 * s, 0);
      pad.rotation.z = side * -0.22;
      chest.add(pad);
      const trimMat = def.style === 'king' ? steelMat(GOLD, GOLD, 0.35) : glowMat(accent, 0.5);
      const trim = new Mesh(new BoxGeometry(padW + 0.005 * s, 0.024 * s, 0.325 * s), trimMat);
      trim.position.set(side * 0.37 * wide * s, 0.175 * s, 0);
      trim.rotation.z = side * -0.22;
      chest.add(trim);
    }
  }

  // Trunk: slim for the vulture, slabbed for the fortress, wedge otherwise.
  const trunk = new Mesh(
    new CylinderGeometry((def.style === 'vulture' ? 0.2 : 0.26) * s, 0.14 * s, 0.55 * s, 8),
    chassis(accent, 0.04),
  );
  trunk.scale.z = 0.72;
  if (def.style === 'vulture') trunk.scale.x = 0.85;
  if (def.style === 'fortress') {
    trunk.scale.x = 1.35; // the hull barrels out
    trunk.scale.z = 0.85;
  }
  trunk.position.y = -0.2 * s;
  chest.add(trunk);

  if (def.style === 'fortress') {
    // Double-layered bolted front plates — the fortress doctrine made steel.
    for (const [w, h, z, y] of [
      [0.62, 0.3, -0.19, -0.02],
      [0.48, 0.24, -0.23, -0.3],
    ] as const) {
      const slab = new Mesh(new BoxGeometry(w * s, h * s, 0.04 * s), dark());
      slab.position.set(0, y * s, z * s);
      chest.add(slab);
    }
    // The hull's number, stencilled on the upper plate beside the core:
    // the fourth machine of the gauntlet, and it wants you to know it.
    const unit = new Mesh(
      new PlaneGeometry(0.15 * s, 0.094 * s),
      new MeshStandardMaterial({ map: stencil('IV'), transparent: true, roughness: 0.9, metalness: 0, depthWrite: false }),
    );
    unit.position.set(0.21 * s, 0.05 * s, -0.212 * s);
    unit.rotation.y = Math.PI; // the plate's front faces −z
    chest.add(unit);
  }
  if (def.style === 'hook') {
    // Exposed rib struts where the chest plate rusted away.
    for (const ry of [-0.08, -0.2, -0.32]) {
      const rib = new Mesh(new BoxGeometry(0.34 * s, 0.022 * s, 0.03 * s), dark());
      rib.position.set(0, ry * s, -0.16 * s);
      chest.add(rib);
    }
    // Mismatched salvage patches riveted on at whatever angle they fit —
    // nothing on this machine matches, that IS the machine.
    const patchMat = steelMat(0x6b5233); // brighter, newer rust — a fresh graft
    for (const [px, py, rot, w, h] of [
      [-0.18, -0.14, 0.3, 0.16, 0.12],
      [0.14, -0.3, -0.2, 0.13, 0.16],
    ] as const) {
      const patch = new Mesh(new BoxGeometry(w * s, h * s, 0.015 * s), patchMat);
      patch.position.set(px * s, py * s, -0.19 * s);
      patch.rotation.z = rot;
      chest.add(patch);
    }
    // A slack chain swinging from the bare shoulder stub: links faked with
    // alternating boxes, each a step further down-and-out.
    for (let i = 0; i < 4; i++) {
      const link = new Mesh(new BoxGeometry(0.035 * s, 0.05 * s, 0.02 * s), dark());
      link.position.set((0.36 + i * 0.025) * s, (0.0 - i * 0.055) * s, 0.06 * s);
      link.rotation.z = i % 2 ? 0.4 : 0.15;
      link.rotation.y = i % 2 ? 0.8 : 0.1;
      chest.add(link);
    }
    // An oil weep streaking down from the ribs.
    const weep = new Mesh(new BoxGeometry(0.05 * s, 0.28 * s, 0.008 * s), steelMat(0x14110c));
    weep.position.set(0.08 * s, -0.34 * s, -0.175 * s);
    chest.add(weep);
    // Every patch is riveted at its corners — crude, proud, uneven.
    const rivets: Array<[number, number, number]> = [];
    for (const [px, py, rot, w, h] of [
      [-0.18, -0.14, 0.3, 0.16, 0.12],
      [0.14, -0.3, -0.2, 0.13, 0.16],
    ] as const) {
      for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
        const lx = cx * (w / 2 - 0.016);
        const ly = cy * (h / 2 - 0.016);
        rivets.push([(px + lx * Math.cos(rot) - ly * Math.sin(rot)) * s, (py + lx * Math.sin(rot) + ly * Math.cos(rot)) * s, -0.2 * s]);
      }
    }
    const rivetGeo = new CylinderGeometry(0.01 * s, 0.012 * s, 0.012 * s, 6);
    chest.add(new Mesh(repeated(rivetGeo, rivets.map(([x, y, z]) => [x, y, z, Math.PI / 2])), steelMat(0x8a7560)));
    // A SALVAGE PLATE off some yard machine, bolted over the left pauldron
    // at whatever angle it fit — its hazard stripes half scoured away.
    const hz = hazardTexture('#c8961e');
    hz.repeat.set(2.2, 1.1);
    const salvage = new Mesh(
      new BoxGeometry(0.22 * s, 0.13 * s, 0.014 * s),
      new MeshStandardMaterial({ map: hz, metalness: 0.35, roughness: 0.85, color: 0xb9ab98 }),
    );
    salvage.position.set(-0.38 * s, 0.07 * s, -0.168 * s);
    salvage.rotation.z = 0.38;
    chest.add(salvage);
    // A SEVERED CABLE hanging from the bare right stub, still live: its
    // frayed end spits the accent.
    const cable = new Mesh(new CylinderGeometry(0.011 * s, 0.011 * s, 0.26 * s, 6), dark());
    cable.position.set(0.4 * s, -0.06 * s, -0.07 * s);
    cable.rotation.z = 0.25;
    chest.add(cable);
    const spark = new Mesh(new SphereGeometry(0.02 * s, 10, 8), glowMat(accent, 2.2));
    spark.position.set(0.432 * s, -0.188 * s, -0.07 * s);
    chest.add(spark);
  }
  if (def.style === 'piston') {
    // Riveted slab chest plate.
    const plate = new Mesh(new BoxGeometry(0.42 * s, 0.34 * s, 0.035 * s), dark());
    plate.position.set(0, -0.1 * s, -0.185 * s);
    chest.add(plate);
    for (const [bx, by] of [[-0.17, 0.03], [0.17, 0.03], [-0.17, -0.23], [0.17, -0.23]] as const) {
      const bolt = new Mesh(new CylinderGeometry(0.018 * s, 0.018 * s, 0.02 * s, 6), chassis());
      bolt.rotation.x = Math.PI / 2;
      bolt.position.set(bx * s, by * s, -0.2 * s);
      chest.add(bolt);
    }
    // Furnace grate: ember light leaking between louvres low on the plate —
    // the fire this press runs on, visible through its own chest.
    for (const gy of [-0.3, -0.36] as const) {
      const glowLine = new Mesh(new BoxGeometry(0.3 * s, 0.018 * s, 0.01 * s), glowMat(accent, 0.7));
      glowLine.position.set(0, gy * s, -0.195 * s);
      chest.add(glowLine);
      const bar = new Mesh(new BoxGeometry(0.32 * s, 0.02 * s, 0.02 * s), dark());
      bar.position.set(0, (gy + 0.028) * s, -0.2 * s);
      chest.add(bar);
    }
    // A boiler gauge riveted beside the core, needle frozen in the red.
    const gauge = new Mesh(new CylinderGeometry(0.05 * s, 0.05 * s, 0.025 * s, 10), steelMat(0x555a63));
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(0.17 * s, -0.12 * s, -0.21 * s);
    chest.add(gauge);
    const needle = new Mesh(new BoxGeometry(0.008 * s, 0.036 * s, 0.008 * s), glowMat(accent, 1.0));
    needle.position.set(0.155 * s, -0.105 * s, -0.225 * s);
    needle.rotation.z = -0.7; // pinned hard right
    chest.add(needle);
  }
  if (def.style === 'king') {
    // THE CHAIN OF OFFICE: heavy gold links slung shoulder to shoulder,
    // sagging across the chest above the core — worn, not bolted.
    // (Every link lies in the chest's plane, each overlapping the next: a
    // real chain's alternate links turn edge-on, and from the front that
    // read as a row of bars.)
    const links: Array<[number, number, number, number, number, number]> = [];
    const n = 19;
    for (let k = 0; k < n; k++) {
      const t = k / (n - 1);
      const x = (-0.3 + t * 0.6) * s;
      const y = (0.11 - Math.sin(t * Math.PI) * 0.09) * s;
      links.push([x, y, (-0.272 - (k % 2) * 0.006) * s, 0, 0, 0]);
    }
    chest.add(new Mesh(repeated(new TorusGeometry(0.02 * s, 0.0065 * s, 6, 14), links), steelMat(GOLD, GOLD, 0.3)));
    // A gold X braced behind the core — four arms on the true diagonals,
    // each running radially so the whole mark reads as one clean cross.
    for (const rot of [Math.PI / 4, (3 * Math.PI) / 4, -Math.PI / 4, (-3 * Math.PI) / 4]) {
      const strip = new Mesh(new BoxGeometry(0.14 * s, 0.018 * s, 0.012 * s), steelMat(GOLD, GOLD, 0.3));
      strip.position.set(Math.cos(rot) * 0.15 * s, -0.12 * s + Math.sin(rot) * 0.15 * s, -0.245 * s);
      strip.rotation.z = rot;
      chest.add(strip);
    }
  }
  if (def.style === 'vulture') {
    // Segmented vertebra neck craning the skull off the yoke — the head
    // floats on the shared skeleton, so these rings sell the connection.
    for (const [ny, nr] of [
      [0.14, 0.075],
      [0.22, 0.062],
    ] as const) {
      const ring = new Mesh(new CylinderGeometry(nr * s, (nr + 0.012) * s, 0.05 * s, 8), dark());
      ring.position.set(0, ny * s, -0.02 * s);
      chest.add(ring);
    }
    // THE RUFF: a collar of spiked feathers standing up behind the skull,
    // fanned wide and leaning back — the executioner's hood, raised.
    const ruff: Array<[number, number, number, number, number, number]> = [];
    const ruffTips: Array<[number, number, number, number, number, number]> = [];
    const quillLen = 0.3 * s;
    for (let i = -3; i <= 3; i++) {
      const rz = -i * 0.24;
      const x = i * 0.05 * s;
      // The quill is centred on its mount; its tip is half a length out.
      const cy = 0.2 * s + Math.cos(rz) * quillLen * 0.5 * Math.cos(0.4);
      const cz = 0.1 * s + quillLen * 0.5 * Math.sin(0.4);
      const cx = x - Math.sin(rz) * quillLen * 0.5;
      ruff.push([cx, cy, cz, -0.4, 0, rz]);
      ruffTips.push([x - Math.sin(rz) * quillLen, 0.2 * s + Math.cos(rz) * quillLen * Math.cos(0.4), 0.1 * s + quillLen * Math.sin(0.4), -0.4, 0, rz]);
    }
    chest.add(new Mesh(repeated(new BoxGeometry(0.05 * s, quillLen, 0.012 * s), ruff), dark()));
    chest.add(new Mesh(repeated(new BoxGeometry(0.044 * s, 0.035 * s, 0.013 * s), ruffTips), glowMat(accent, 0.35)));
    // The folded-wing cloak: long plates hanging down the BACK in a loose
    // fan — from behind it's all plumage, from the front all blade.
    for (let f = -2; f <= 2; f++) {
      const quill = new Mesh(new BoxGeometry(0.07 * s, (0.52 - Math.abs(f) * 0.07) * s, 0.018 * s), dark());
      quill.position.set(f * 0.085 * s, (-0.26 + Math.abs(f) * 0.04) * s, 0.16 * s);
      quill.rotation.z = f * 0.1;
      quill.rotation.x = -0.1; // flared just off the back
      chest.add(quill);
    }
    // The executioner keeps tallies: two scrap tags on a wire off the yoke.
    for (const [tx, ty, rot] of [
      [-0.2, -0.06, 0.15],
      [-0.16, -0.09, -0.3],
    ] as const) {
      const tag = new Mesh(new BoxGeometry(0.045 * s, 0.07 * s, 0.012 * s), steelMat(0x51584a));
      tag.position.set(tx * s, ty * s, -0.17 * s);
      tag.rotation.z = rot;
      chest.add(tag);
    }
  }

  // The CORE: a glowing octagonal heart set PROUD of the chest plate — the
  // weak point players hunt. Sits far enough forward that a ball reaches it
  // before the (invisible) body armour sphere can eat the throw.
  const coreMat = glowMat(accent, 0.25);
  const core = new Mesh(new CylinderGeometry(0.11 * s, 0.11 * s, 0.06 * s, 8), coreMat);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, -0.12 * s, -0.26 * s);
  chest.add(core);
  for (const dy of [-1, 1]) {
    const louvre = new Mesh(new BoxGeometry(0.3 * s, 0.035 * s, 0.03 * s), dark());
    louvre.position.set(0, (-0.12 + dy * 0.11) * s, -0.25 * s);
    chest.add(louvre);
  }
  root.add(chest);

  // ── Launcher pods riding the shoulders (they glow — and fire — during a
  //    volley: the blockable fireballs leave from here) ──────────────────────
  const podMats: [MeshStandardMaterial, MeshStandardMaterial] = [glowMat(accent, 0.2), glowMat(accent, 0.2)];
  podMats.forEach((mat, i) => {
    const side = i === 0 ? -1 : 1;
    if (def.style === 'piston') {
      // Smokestack exhausts, tipped back, ember-hot at the mouth.
      const stack = new Mesh(new CylinderGeometry(0.05 * s, 0.065 * s, 0.42 * s, 8), dark());
      stack.rotation.x = 0.35;
      stack.position.set(side * 0.3 * s, shoulderY + 0.3 * s, 0.1 * s);
      root.add(stack);
      const mouth = new Mesh(new CylinderGeometry(0.052 * s, 0.045 * s, 0.05 * s, 8), mat);
      mouth.rotation.x = 0.35;
      mouth.position.set(side * 0.3 * s, shoulderY + 0.5 * s, 0.17 * s);
      root.add(mouth);
    } else {
      const housing = new Mesh(new BoxGeometry(0.13 * s, 0.12 * s, 0.2 * s), dark());
      housing.position.set(side * 0.37 * wide * s, shoulderY + 0.2 * s, 0.02 * s);
      root.add(housing);
      const muzzle = new Mesh(new CylinderGeometry(0.035 * s, 0.045 * s, 0.1 * s, 8), mat);
      muzzle.rotation.x = Math.PI / 2.6; // tipped up-and-forward, mortar style
      muzzle.position.set(side * 0.37 * wide * s, shoulderY + 0.27 * s, -0.04 * s);
      root.add(muzzle);
    }
  });

  // ── Shoulder emblems: octagonal lamps set proud of each pauldron. Dim on
  //    most machines; GOLIATH's crown circuit blinks them as ring stops. ────
  const shoulderMats: [MeshStandardMaterial, MeshStandardMaterial] = [glowMat(accent, 0.2), glowMat(accent, 0.2)];
  // The king's crown-circuit shoulder stops run larger than the other
  // machines' vestigial lamps — they're targets you must hunt, so they read.
  const lampR = (def.style === 'king' ? 0.09 : 0.06) * s;
  const makeShoulderLamp = (i: 0 | 1): Mesh => {
    const side = i === 0 ? -1 : 1;
    const lamp = new Mesh(new CylinderGeometry(lampR, lampR, 0.055 * s, 8), shoulderMats[i]);
    lamp.rotation.x = Math.PI / 2;
    lamp.position.set(side * 0.38 * wide * s, shoulderY + 0.13 * s, -0.13 * s);
    root.add(lamp);
    return lamp;
  };
  const shoulders: [Mesh, Mesh] = [makeShoulderLamp(0), makeShoulderLamp(1)];

  // ── Pelvis + hover skirt: no legs — floating hands and iron, on brand ────
  const pelvis = new Mesh(new BoxGeometry(0.28 * wide * s, 0.18 * s, 0.22 * s), chassis(accent, 0.03));
  pelvis.position.y = hipY - 0.28 * s;
  root.add(pelvis);
  // The LOW-BLOW emblem: an octagonal lamp set proud of the belt plate.
  // Dim on most machines; JUGGERNAUT's weak-point cycle blinks it live.
  const lowMat = glowMat(accent, 0.2);
  const low = new Mesh(new CylinderGeometry(0.07 * s, 0.07 * s, 0.05 * s, 8), lowMat);
  low.rotation.x = Math.PI / 2;
  low.position.set(0, hipY - 0.28 * s, -0.14 * s);
  root.add(low);
  if (def.style === 'fortress') {
    // The armour curtain: a ring of riveted skirt plates.
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const plate = new Mesh(new BoxGeometry(0.17 * s, 0.2 * s, 0.025 * s), dark());
      plate.position.set(Math.cos(a) * 0.24 * s, hipY - 0.42 * s, Math.sin(a) * 0.24 * s);
      plate.rotation.y = -a + Math.PI / 2;
      plate.rotation.x = 0.12;
      root.add(plate);
    }
    // TREAD PODS flanking the skirt — it hovers like everything else, but
    // the fortress never stopped being a tank: road wheels in an armoured
    // sponson either side, tracks moulded as ridged blocks.
    for (const side of [-1, 1]) {
      const sponson = new Mesh(new BoxGeometry(0.18 * s, 0.2 * s, 0.46 * s), dark());
      sponson.position.set(side * 0.38 * s, hipY - 0.44 * s, 0.02 * s);
      root.add(sponson);
      for (let wIdx = 0; wIdx < 3; wIdx++) {
        const wheel = new Mesh(new CylinderGeometry(0.065 * s, 0.065 * s, 0.05 * s, 10), steelMat(0x241f2e));
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(side * 0.46 * s, hipY - 0.5 * s, (-0.14 + wIdx * 0.15) * s);
        root.add(wheel);
      }
      const guard = new Mesh(new BoxGeometry(0.05 * s, 0.05 * s, 0.5 * s), chassis(accent, 0.03));
      guard.position.set(side * 0.44 * s, hipY - 0.32 * s, 0.02 * s);
      root.add(guard);
      // THE TRACK: a run of cleated links over the road wheels and under
      // them — the fortress never stopped being a tank.
      const links: Array<[number, number, number]> = [];
      for (let k = 0; k < 8; k++) {
        const z = (-0.21 + k * 0.06) * s;
        links.push([side * 0.46 * s, hipY - 0.425 * s, z], [side * 0.46 * s, hipY - 0.575 * s, z]);
      }
      root.add(new Mesh(repeated(new BoxGeometry(0.07 * s, 0.022 * s, 0.05 * s), links), steelMat(0x2c2636)));
    }
    // The glacis: a clean raked front plate behind the curtain, no glow, no
    // trim — dark bow armour whose only statement is its rake.
    const glacis = new Mesh(new BoxGeometry(0.5 * s, 0.22 * s, 0.03 * s), dark());
    glacis.position.set(0, hipY - 0.4 * s, -0.2 * s);
    glacis.rotation.x = -0.35;
    root.add(glacis);
  }
  if (def.style === 'vulture') {
    // Tail plumage: three quills raked down-and-back off the hips.
    for (let f = -1; f <= 1; f++) {
      const quill = new Mesh(new BoxGeometry(0.05 * s, 0.36 * s, 0.016 * s), dark());
      quill.position.set(f * 0.08 * s, hipY - 0.42 * s, 0.16 * s);
      quill.rotation.x = 0.55; // swept back like a diving bird's tail
      quill.rotation.z = f * 0.16;
      root.add(quill);
    }
  }
  if (def.style === 'king') {
    // The war cape: long near-black plates hanging from the shoulder line
    // down past the hips, each tipped in gold — royalty you can count in
    // silhouette alone.
    for (let f = -2; f <= 2; f++) {
      const drop = (0.78 - Math.abs(f) * 0.06) * s;
      const plate = new Mesh(new BoxGeometry(0.11 * s, drop, 0.02 * s), steelMat(0x101014));
      plate.position.set(f * 0.115 * s, shoulderY - drop / 2 + 0.04 * s, 0.2 * s);
      plate.rotation.x = -0.08;
      plate.rotation.z = f * 0.05;
      root.add(plate);
      const tip = new Mesh(new BoxGeometry(0.11 * s, 0.035 * s, 0.022 * s), steelMat(GOLD, GOLD, 0.3));
      tip.position.set(f * 0.115 * s, shoulderY - drop + 0.05 * s, 0.2 * s);
      tip.rotation.x = -0.08;
      tip.rotation.z = f * 0.05;
      root.add(tip);
    }
    // Gold fringe ringing the hover skirt — even the exhaust wears trim.
    const fringe = new Mesh(new CylinderGeometry(0.165 * s, 0.14 * s, 0.035 * s, 8), steelMat(GOLD, GOLD, 0.3));
    fringe.position.y = hipY - 0.36 * s;
    root.add(fringe);
  }
  if (def.style === 'fortress') {
    // No dangling exhaust funnel on the fortress — a tapered spout under
    // that hull read like a spinning top. Instead a wide, shallow hover
    // PLENUM tucked between the sponsons: a flat tank belly with its glow
    // recessed underneath, so the bulk sits on a cushion, not a point.
    const plenum = new Mesh(new CylinderGeometry(0.26 * s, 0.28 * s, 0.1 * s, 10), dark());
    plenum.position.y = hipY - 0.5 * s;
    root.add(plenum);
    const cushion = new Mesh(new CylinderGeometry(0.21 * s, 0.19 * s, 0.045 * s, 10), glowMat(accent, 1.2));
    cushion.position.y = hipY - 0.56 * s;
    root.add(cushion);
  } else {
    const skirt = new Mesh(new CylinderGeometry(0.16 * s, 0.05 * s, 0.28 * s, 8), dark());
    skirt.position.y = hipY - 0.48 * s;
    root.add(skirt);
    const skirtGlow = new Mesh(new CylinderGeometry(0.09 * s, 0.05 * s, 0.06 * s, 8), glowMat(accent, 1.2));
    skirtGlow.position.y = hipY - 0.6 * s;
    root.add(skirtGlow);
  }

  // ── ARMS: shoulder pivots carrying girder arms, real elbows and wrists,
  //    and bespoke hands whose digits curl ───────────────────────────────
  const buildHand = (side: -1 | 1): { hand: Group; digits: TitanDigit[] } => {
    const hand = new Group();
    const digits: TitanDigit[] = [];
    if (def.style === 'hook' && side === 1) {
      // The crane HOOK: a chain link, a shank, and the big open J-hook.
      const link = new Mesh(new CylinderGeometry(0.05 * s, 0.05 * s, 0.05 * s, 8), dark());
      link.rotation.x = Math.PI / 2;
      hand.add(link);
      const shank = new Mesh(new CylinderGeometry(0.03 * s, 0.035 * s, 0.16 * s, 8), steelMat(paint.chassis));
      shank.position.y = -0.1 * s;
      hand.add(shank);
      // Hook belly: a half-torus faked with three angled boxes (keeps the
      // low-poly robot-wars look), plus the up-turned point.
      const seg = (): Mesh => new Mesh(new BoxGeometry(0.06 * s, 0.14 * s, 0.06 * s), chassis(accent, 0.06));
      const a1 = seg();
      a1.position.set(0, -0.24 * s, 0);
      hand.add(a1);
      const a2 = seg();
      a2.position.set(-0.07 * s, -0.32 * s, 0);
      a2.rotation.z = 1.1;
      hand.add(a2);
      const a3 = seg();
      a3.position.set(-0.15 * s, -0.26 * s, 0);
      a3.rotation.z = 2.4;
      hand.add(a3);
      const point = new Mesh(new CylinderGeometry(0.004 * s, 0.045 * s, 0.14 * s, 6), dark());
      point.position.set(-0.17 * s, -0.16 * s, 0);
      hand.add(point);
      // The hook swings on its link: the wrist rolls it, nothing curls.
      return { hand, digits };
    }
    if (def.style === 'piston') {
      // The HAMMER-BLOCK: one massive rectangular drop-forge fist.
      const block = new Mesh(new BoxGeometry(0.3 * s, 0.26 * s, 0.3 * s), chassis(accent, 0.06));
      hand.add(block);
      const face = new Mesh(new BoxGeometry(0.31 * s, 0.08 * s, 0.31 * s), dark());
      face.position.y = -0.16 * s;
      hand.add(face);
      const ring = new Mesh(new BoxGeometry(0.32 * s, 0.03 * s, 0.32 * s), glowMat(accent, 0.9));
      ring.position.y = 0.1 * s;
      hand.add(ring);
      // Forge bolts studding the striking face's rim.
      for (const [bx, bz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]] as const) {
        const bolt = new Mesh(new CylinderGeometry(0.025 * s, 0.025 * s, 0.03 * s, 6), steelMat(0x555a63));
        bolt.position.set(bx * s, -0.2 * s, bz * s);
        hand.add(bolt);
      }
      // Molten CRACKS across the block's face and flanks — the fist has hit
      // so much iron that its own is splitting, and the fire shows through.
      const crack = new BoxGeometry(0.075 * s, 0.009 * s, 0.006 * s);
      const cracks = new Mesh(
        repeated(crack, [
          [-0.05 * s, 0.02 * s, -0.152 * s, 0, 0, 0.5],
          [0.012 * s, -0.01 * s, -0.152 * s, 0, 0, -0.35],
          [0.07 * s, 0.03 * s, -0.152 * s, 0, 0, 0.9],
          [0.152 * s, -0.02 * s, 0.03 * s, 0, Math.PI / 2, 0.6],
          [-0.152 * s, 0.03 * s, -0.04 * s, 0, Math.PI / 2, -0.4],
        ]),
        glowMat(accent, 1.4),
      );
      hand.add(cracks);
      // A drop-forge has no fingers — the whole block is the fist.
      return { hand, digits };
    }
    if (def.style === 'vulture') {
      // Talons: three claw fingers curling from a slim wrist block — each on
      // its own hinge, so the hand really GRIPS and really SPREADS.
      const palm = new Mesh(new BoxGeometry(0.12 * s, 0.1 * s, 0.12 * s), chassis(accent, 0.05));
      hand.add(palm);
      for (let f = -1; f <= 1; f++) {
        const hinge = new Group();
        hinge.position.set(f * 0.05 * s, -0.04 * s, -0.03 * s);
        const claw = new Mesh(new CylinderGeometry(0.006 * s, 0.03 * s, 0.2 * s, 5), dark());
        claw.position.y = -0.1 * s;
        hinge.add(claw);
        hinge.rotation.x = -0.5;
        hand.add(hinge);
        digits.push({ node: hinge, open: -0.25, closed: -1.55 });
      }
      return { hand, digits };
    }
    // Fortress + king: the classic crane gauntlet (the king's wears gold cuffs).
    const block = new Mesh(new BoxGeometry(0.22 * s, 0.17 * s, 0.24 * s), chassis(accent, 0.06));
    hand.add(block);
    const plate = new Mesh(new BoxGeometry(0.23 * s, 0.06 * s, 0.09 * s), dark());
    plate.position.set(0, 0.075 * s, -0.1 * s);
    hand.add(plate);
    for (let i = 0; i < 4; i++) {
      const stud = new Mesh(new BoxGeometry(0.032 * s, 0.03 * s, 0.026 * s), glowMat(accent, 1.1));
      stud.position.set((-0.075 + i * 0.05) * s, 0.078 * s, -0.15 * s);
      hand.add(stud);
    }
    const cuffMat = def.style === 'king' ? steelMat(GOLD, GOLD, 0.35) : steelMat(paint.chassis);
    const cuff = new Mesh(new CylinderGeometry(0.085 * s, 0.11 * s, 0.11 * s, 8), cuffMat);
    cuff.rotation.x = Math.PI / 2;
    cuff.position.z = 0.14 * s;
    hand.add(cuff);
    // FOUR FINGERS and a thumb on the gauntlet, each two segments on a
    // knuckle hinge along the block's front edge: open they lie straight
    // out, curled they fold under the palm into the fist every punch used
    // to fake. The thumb rides the inner side and folds across.
    for (let i = 0; i < 4; i++) {
      const knuckle = new Group();
      knuckle.position.set((-0.075 + i * 0.05) * s, -0.04 * s, -0.12 * s);
      const seg1 = new Mesh(new BoxGeometry(0.038 * s, 0.04 * s, 0.09 * s), chassis(accent, 0.04));
      seg1.position.z = -0.045 * s;
      knuckle.add(seg1);
      const joint = new Group();
      joint.position.z = -0.09 * s;
      const seg2 = new Mesh(new BoxGeometry(0.034 * s, 0.036 * s, 0.075 * s), dark());
      seg2.position.z = -0.037 * s;
      joint.add(seg2);
      joint.rotation.x = -0.35;
      knuckle.add(joint);
      hand.add(knuckle);
      // The second segment curls about twice as far as the knuckle — a
      // finger folds from the tip in.
      digits.push({ node: knuckle, open: 0.05, closed: -1.35 });
      digits.push({ node: joint, open: -0.1, closed: -1.7 });
    }
    const thumbHinge = new Group();
    thumbHinge.position.set(-side * 0.12 * s, -0.02 * s, -0.04 * s);
    const thumb = new Mesh(new BoxGeometry(0.036 * s, 0.038 * s, 0.085 * s), chassis(accent, 0.04));
    thumb.position.z = -0.04 * s;
    thumbHinge.add(thumb);
    thumbHinge.rotation.y = side * 0.5;
    hand.add(thumbHinge);
    digits.push({ node: thumbHinge, open: -0.1, closed: -1.2 });
    return { hand, digits };
  };

  const arms = [0, 1].map((i) => {
    const side = (i === 0 ? -1 : 1) as -1 | 1;
    // THE SHOULDER: the pivot carrying the upper arm.
    const pivot = new Group();
    pivot.position.set(side * (yokeW / 2 + 0.15 * s), shoulderY + 0.04 * s, 0);
    const upper = new Mesh(new BoxGeometry(0.11 * s, 0.5 * s, 0.13 * s), chassis(accent, 0.03));
    upper.position.y = -0.25 * s;
    pivot.add(upper);
    if (def.style === 'piston') {
      // The drive piston riding each girder arm: sleeve up top, bright rod
      // below — the press's whole anatomy on display. Parented to the pivot
      // so it swings with every hammer stroke.
      const sleeve = new Mesh(new CylinderGeometry(0.045 * s, 0.045 * s, 0.22 * s, 8), dark());
      sleeve.position.set(side * 0.02 * s, -0.13 * s, -0.1 * s);
      pivot.add(sleeve);
      const rod = new Mesh(new CylinderGeometry(0.02 * s, 0.02 * s, 0.24 * s, 6), steelMat(0x8d949f));
      rod.position.set(side * 0.02 * s, -0.36 * s, -0.1 * s);
      pivot.add(rod);
      // HEAT VENTS down the outside of each girder: the press runs so hot
      // the arms breathe fire through their louvres.
      const vent = new BoxGeometry(0.008 * s, 0.014 * s, 0.085 * s);
      const vents = new Mesh(repeated(vent, [0, 1, 2, 3].map((k) => [side * 0.056 * s, (-0.1 - k * 0.045) * s, 0] as [number, number, number])), glowMat(accent, 1.1));
      pivot.add(vents);
    }
    // THE ELBOW: a real joint at the upper arm's end. Its cap is the old
    // barrel; an accent lamp peeks out either side of it, so the fold reads
    // from across the pit.
    const elbow = new Group();
    elbow.position.y = -0.5 * s;
    pivot.add(elbow);
    const elbowCap = new Mesh(new CylinderGeometry(0.075 * s, 0.075 * s, 0.15 * s, 8), dark());
    elbowCap.rotation.z = Math.PI / 2;
    elbow.add(elbowCap);
    const elbowLamp = new Mesh(new CylinderGeometry(0.04 * s, 0.04 * s, 0.17 * s, 8), glowMat(accent, 0.8));
    elbowLamp.rotation.z = Math.PI / 2;
    elbow.add(elbowLamp);
    // THE FOREARM, with the ram that drives it: a rod on the front face
    // reading as the hydraulic that folds the joint.
    const fore = new Mesh(new BoxGeometry(0.095 * s, 0.42 * s, 0.11 * s), chassis(accent, 0.03));
    fore.position.y = -0.21 * s;
    elbow.add(fore);
    const ram = new Mesh(new CylinderGeometry(0.016 * s, 0.016 * s, 0.3 * s, 6), steelMat(0x8d949f));
    ram.position.set(0, -0.2 * s, -0.07 * s);
    elbow.add(ram);
    // THE WRIST at the forearm's end, its own barrel, the hand hung off it.
    const wrist = new Group();
    wrist.position.y = -0.42 * s;
    elbow.add(wrist);
    const wristCap = new Mesh(new CylinderGeometry(0.05 * s, 0.05 * s, 0.12 * s, 8), dark());
    wristCap.rotation.z = Math.PI / 2;
    wrist.add(wristCap);
    const { hand: fist, digits } = buildHand(side);
    fist.position.y = -0.1 * s;
    wrist.add(fist);
    // Rest pose: hanging slightly out and forward, guard-ish, the elbow a
    // little bent (gestures.ts ARM_REST), the hand loose.
    pivot.rotation.x = 0.18;
    pivot.rotation.z = side * 0.14;
    elbow.rotation.x = 0.35; // ARM_REST's forward fold, through rigFold (gestures.ts)
    for (const d of digits) d.node.rotation.x = d.open + (d.closed - d.open) * 0.3;
    root.add(pivot);
    return { pivot, elbow, wrist, fist, digits, restX: 0.18, restZ: side * 0.14 } satisfies TitanArm;
  }) as [TitanArm, TitanArm];

  const height = headY + 0.35 * s;
  finishTitan(root, def.style, s);

  return {
    root,
    head,
    visorMat,
    eyes,
    eyeFx,
    core,
    coreMat,
    low,
    lowMat,
    wings,
    shoulders,
    shoulderMats,
    podMats,
    arms,
    headY,
    coreY: shoulderY - 0.12 * s,
    height,
    dispose() {
      root.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry) m.geometry.dispose();
        const mat = m.material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      });
      root.removeFromParent();
    },
  };
}
