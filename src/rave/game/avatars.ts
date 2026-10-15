/**
 * The other dancers — couture rave mannequins, one per occupied platform.
 * One dark suit — TRUE near-black patent, not cloth dyed in the seat's
 * colour — with LIT sleeves and a lit midriff, dark gloss accessories
 * (helm, gauntlets, heeled boots) and hot neon trim at every seam. The
 * neon is real neon: the hottest elements (the scan-slit, the stick
 * blades, the soles, the jewellery) run WHITE at the core and hand their
 * hue to the halos and the lit cloth around them, the way a lit tube
 * actually reads — a white filament in a coloured bloom. The figure's
 * colour identity lives in what it WEARS and what it CARRIES, against a
 * body that stays black; colour-flooding the whole silhouette made every
 * dancer a one-hue toy, and the hierarchy (hot blades over lit jewellery
 * over glowing cloth over black leather) flattened into mud.
 * The body is shaped, not stacked: a cinched waist under a broad
 * shoulder yoke, hips that flow into the thighs, an elliptical
 * cross-section so the torso has a front, and a sculpted mannequin head —
 * tapered chin, full cranium, a wraparound glass visor carrying a hot
 * scan-slit. Four
 * style variants of neon hair (mohawk / twin blades / horn / twin spikes)
 * derive deterministically from the hue so a full ring isn't 24 clones.
 *
 * The rig is driven entirely from a HEAD position and two HAND targets —
 * exactly what VR actually knows about a person. Everything else is solved:
 * the hips hang under the head, two-bone arms bend at elbows whose pole
 * ADAPTS to the reach (a crossed hand folds its elbow down instead of
 * chicken-winging through the chest; a long thrust rolls it under the arm),
 * the glowsticks ride the forearm as POINTERS and twist with the body's
 * yaw, two-bone legs bend at solved KNEES (so crouching folds the figure
 * instead of telescoping it), and elimination melts the whole thing
 * floorward.
 *
 * YOU have no figure. The local player never sees their own body — your
 * platform shows only your controllers; the elegance is for everyone else's
 * view of you (and the groupies).
 *
 * Everything is authored in PLATFORM-LOCAL space and parented to the seat's
 * platform root, so rank lifts and eliminations carry the dancer with the
 * deck for free. All geometry is procedural and shared module-wide (unit
 * primitives + lathe profiles, cached by key); materials are per-rig (they
 * carry the seat colour and get mutated for hit-flash / elimination).
 */

import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import { hueToColor } from '../config.js';
import { glowSprite } from '../materials/glow.js';

export interface DancerPose {
  /** Head centre, platform-local. */
  hx: number;
  hy: number;
  hz: number;
  /** Head yaw (radians about +Y; 0 faces −Z, toward the stage), and the
   *  other two axes a real neck has: pitch (nodding, + is up) and roll
   *  (the tilt you do when you are listening). Applied YXZ, which is the
   *  order a head actually works in. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Hand targets, platform-local. */
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
  /** Hand ORIENTATION, as each controller's world quaternion — present
   *  when the wire carries it (the club floor does), absent on the ring.
   *  `w` of 0 (or missing) means unknown, and the figure falls back to
   *  pointing the fist along the forearm, which is how a palm held up
   *  came out as a wrist hanging down: the guess only ever knew where a
   *  hand WAS, never which way it faced. */
  lqx?: number;
  lqy?: number;
  lqz?: number;
  lqw?: number;
  rqx?: number;
  rqy?: number;
  rqz?: number;
  rqw?: number;
  /** Hand GRIP, as the controller's two analogue reads, 0 open … 1 closed:
   *  `t` the trigger (curls the index), `g` the grip (curls the rest) —
   *  see avatar/hands.ts setHandGrip. Present when the wire carries them
   *  (the club floor does), absent on the ring and on any frame from
   *  before the fingers moved; absent, the hand rests half-relaxed. */
  lt?: number;
  lg?: number;
  rt?: number;
  rg?: number;
  /** 0 dancing … 1 melted on the deck (eliminated). */
  slump: number;
}

/**
 * One drivable material plus the brightness the figure was AUTHORED at,
 * relative to `ACCENT_REST`. Callers drive one intensity for the whole rig
 * (alive / flashing / eliminated) and multiply by `gain`, so the trim
 * hierarchy — hot blades over lit jewellery over a glowing suit over dark
 * leather — survives every state instead of flattening to one temperature.
 */
export interface DancerAccent {
  mat: MeshStandardMaterial | MeshBasicMaterial;
  gain: number;
  /** True for everything that GLOWS — the neon trim (collar, belt, cuffs,
   *  seams, blades, visor slit, halos) AND the lit panels it is sewn to
   *  (sleeves, midriff, crest). False for the dark cloth and the darker
   *  accessories: bodice, trousers, helm, gauntlets, boots.
   *
   *  A caller repainting the figure for a state (the MC's warn amber)
   *  drives exactly the lit parts. Those are what a dancer across the
   *  arena actually sees change colour; recolouring the dark cloth as well
   *  turns the headliner into a different dancer mid-wind-up, which is not
   *  what "he is charging something" should look like. */
  neon: boolean;
  /** How hard this accent's CORE pulls toward white, 0..1. Real neon is a
   *  white filament in a coloured bloom: the hottest tiers (scan-slit,
   *  blades, soles, jewellery) whiten so they read as light SOURCES, and
   *  the hue survives in the halos and the lit cloth around them. Driving
   *  every tier at the pure seat colour is what made the old figure a
   *  one-hue toy — saturated-on-saturated has nowhere brighter to go.
   *  Repaints route through accentHex() so the hierarchy survives flash
   *  red and warn amber too. */
  hot: number;
}

const _tintC = new Color();
const _whiteC = new Color(0xffffff);
/** `base` pulled toward white by `hot` — the working half of accentHex. */
function hotHex(base: number, hot: number): number {
  return _tintC.setHex(base).lerp(_whiteC, hot).getHex();
}

/** Perceived luminance of a colour, straight off the hex channels. */
function lumaOf(hex: number): number {
  return (0.2126 * ((hex >> 16) & 0xff) + 0.7152 * ((hex >> 8) & 0xff) + 0.0722 * (hex & 0xff)) / 255;
}

/**
 * The colour an accent actually wears when a system drives it to `base`.
 * Every runtime repaint (seat colour, hit-flash red, the MC's warn amber)
 * goes through here instead of writing `base` raw, so a white-cored blade
 * stays white-cored in every state instead of collapsing back into the
 * flat tint the whitening exists to escape.
 */
export function accentHex(a: DancerAccent, base: number): number {
  return a.hot > 0 ? hotHex(base, a.hot) : base;
}

export interface DancerRig {
  root: Group;
  /** Every drivable material (dim on elimination, flash on hit). */
  accents: DancerAccent[];
  baseColor: number;
  /** Solve the whole figure from head + hands. */
  pose(p: DancerPose): void;
  /**
   * THE CROWN — champagne brass, floating just over the head, turning
   * slowly. The club puts it on the last raid's winner and it stays on
   * until their next game. Built lazily on first wear (almost every rig
   * lives its whole life bareheaded), placed by pose(), and deliberately
   * OUTSIDE the accent list: a crown is gold whatever colour the dancer
   * wears, and it neither dims nor flashes with the suit.
   */
  setCrown(on: boolean): void;
  /**
   * DETAIL. `false` hides the jewellery and the joint-fillers — the
   * millimetre work that only exists for close range — leaving the
   * silhouette, the lit panels, the sticks and the halos: the parts that
   * actually carry a dancer across a room.
   *
   * A full ring is twenty-three other figures and they are the whole
   * frame; on a 24-seat ring seventeen of them stand more than ten metres
   * off, where an ear pip is smaller than a pixel. Costs nothing to solve
   * either way (pose() runs the same maths) — this is draw calls only.
   */
  setDetail(near: boolean): void;
  dispose(): void;
  /** Where COSTUME pieces hang (the MC's helmet, mantle and gauntlets —
   *  McSystem): the head; the YOKE, riding the shoulder line and turning
   *  with the chest (+y up the spine, the figure's front toward −z); and the
   *  two hands. Children added here are posed with the figure for free.
   *  (The house figures carry it; the players' blank doesn't.) */
  mount?: { head: Group; yoke: Group; handL: Group; handR: Group };
}

/* Figure proportions (metres) — deliberately long-limbed and narrow:
 * fashion-sketch legs (high hip line), slim arms, a small oval head. */
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const HEAD_R = 0.085;
const HEAD_DROP = 0.66; // head centre → hip line, standing (high hips = long legs)
const SHOULDER_W = 0.155; // half-width
const SHOULDER_DROP = 0.15; // head centre → shoulder line
const HIP_W = 0.082; // half-width
const ANKLE = 0.085; // ankle height — legs end here, boots own the rest
/* How far the neck goes before the head would bury itself in the chest or
 * snap round. A player CAN look straight down at their own boots; the
 * avatar stops short of that, because a rig with no spine has nowhere to
 * put the difference. */
const PITCH_MAX = 1.15;
const ROLL_MAX = 0.6;
/* The neck is a COLUMN THE HEAD SITS ON, not a strut stretched between the
 * chin and the chest. Aimed at the jaw it swung a full head-radius as you
 * nodded, which both leaned it far enough to lift its base clear of the
 * shoulder yoke and stretched it half as long again — a straw poked loosely
 * into the collar. So it aims at NECK_ROOT, deep enough inside the skull
 * that a nod barely moves it, and its base is driven NECK_SINK under the
 * yoke. Both ends are buried at every angle in the neck's range; the part
 * on show between collar and jaw leans a few degrees and holds its length. */
const NECK_ROOT = HEAD_R * 0.35;
const NECK_SINK = 0.055;
/* THE CROWN floats this far over the head CENTRE — clear of all four hair
 * crests at any nod (the horn stands nearly vertical under a full pitch,
 * tip ~0.175 up) and well under the club's name tags at +0.38. Floating
 * rather than worn because a circlet on the scalp would thread a different
 * crest on every hue — and a hovering crown reads as "champion" across a
 * whole dance floor, which is its entire job. */
const CROWN_RISE = 0.19;

/** Femur (and shin) while the figure stands — see legBone(). Sized just
 *  over half the standing hip→ankle span, so a dancer at rest STANDS UP
 *  STRAIGHT (a few centimetres of knee, not a permanent half-squat) and
 *  the fold is saved for an actual crouch. */
const LEG_BONE = 0.392;

/* The torso's CROSS-SECTION. A lathe is round, and a round torso is a
 * bottle; broad across the chest and slim front-to-back is what makes the
 * same profile read as a body. Applied to the bodice, the basque and their
 * rings — never to the limbs, which really are round. */
const TORSO_X = 1.18;
const TORSO_Z = 0.8;

/** The emissive intensity the systems drive accents to at rest; materials
 *  are authored here × their gain, so the dev preview matches the game.
 *  Exported so a caller holding some accents at rest (the MC's warn, which
 *  lights the glowing parts only) puts the cloth back where it started. */
export const ACCENT_REST = 1.1;
/** The suit is DARK — actually dark. It used to carry a fifth of the seat
 *  colour in its weave and under any real light that read as a figure DYED
 *  head to toe, not a black suit wearing neon: the whole contrast budget
 *  spent before the trim got a turn. Now it holds only a whisper of the
 *  hue — enough to stay a surface in a dark room — and the seat colour
 *  lives where it should: the lit panels, the trim, the blades. Bodice
 *  and trousers are still cut from this one cloth. */
const SUIT_GAIN = 0.09;
/** Helm, gauntlets and boots — black glass next to the suit's patent. */
const SHELL_GAIN = 0.07;
/** …and the LIT panels: sleeves, midriff, hair. A figure in head-to-toe
 *  black is a hole in a dark room, and a near-black arm with a glowing
 *  stick on the end of it reads as a DETACHED hand. Lighting exactly the
 *  sleeves, the waist and the crest keeps every stick visibly attached to
 *  the body swinging it, crowns the silhouette, and puts a bright band at
 *  the figure's own centre of motion — the part that sells a dance across
 *  thirty metres of arena. Nudged up now that the cloth around them is
 *  honestly black — the panels are the hue's home. */
const LIT_GAIN = 0.7;
/** The whitening tiers (see DancerAccent.hot). Jewellery warms toward
 *  white just enough to read lit; the flat cores — scan-slit, blades,
 *  soles, the horn's pip — run properly white-hot, and the halo sprites
 *  stay PURE hue (they are the bloom; whiten those and the figure's
 *  colour identity dies with them). */
const TRIM_HOT = 0.22;
const CORE_HOT = 0.58;

const UP = new Vector3(0, 1, 0);
const SIDES = [-1, 1] as const;
const _a = new Vector3();
const _b = new Vector3();
const _c = new Vector3();
const _neck = new Vector3();
const _dir = new Vector3();
const _mid = new Vector3();
const _hint = new Vector3();
const _fwd = new Vector3();
const _right = new Vector3();
const _target = new Vector3();
/* twoBone()'s outputs — read them before the next call. */
const _solved = new Vector3();
const _tip = new Vector3();
/* Owned by twoBone() alone — never aliased by the pose solve. */
const _chain = new Vector3();
const _bend = new Vector3();
const _q = new Quaternion();
const _yawQ = new Quaternion();
/** Pre-rotation that turns a torus (axis +Z) into a ring around +Y. */
const X90 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);

/* ── shared unit geometry, cached module-wide ──
 * 24 rigs can be live at once; every mesh here draws one of a small fixed
 * set of unit primitives, scaled per-mesh. Cached geometries are never
 * disposed by rigs (dispose() releases materials only). */
const geoCache = new Map<string, BufferGeometry>();
function cached(key: string, make: () => BufferGeometry): BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}
/** Unit-height cylinder authored base-at-origin along +Y (for align()).
 *  Twelve sides by default: at eight, every limb wore visible flats — and
 *  the MC wears this figure at 2.1×, where a flat is a plank. The
 *  geometry is module-shared, so the whole ring pays the difference once. */
function segGeo(rTop: number, rBottom: number, sides = 12): BufferGeometry {
  return cached(`seg:${rTop}:${rBottom}:${sides}`, () => {
    const g = new CylinderGeometry(rTop, rBottom, 1, sides);
    g.translate(0, 0.5, 0);
    return g;
  });
}
function sphereGeo(detail: 8 | 16): BufferGeometry {
  return cached(`sph:${detail}`, () => new SphereGeometry(1, detail, detail === 8 ? 6 : 12));
}
function boxGeo(): BufferGeometry {
  return cached('box', () => new BoxGeometry(1, 1, 1));
}
function torusGeo(r: number, tube: number): BufferGeometry {
  return cached(`tor:${r}:${tube}`, () => new TorusGeometry(r, tube, 10, 28));
}
function discGeo(): BufferGeometry {
  return cached('disc', () => new CircleGeometry(1, 24));
}
function hexGeo(): BufferGeometry {
  return cached('hex', () => new CylinderGeometry(0.5, 0.5, 1, 6));
}
/** Unit-height lathe (base at y=0, top at y=1) from (radius, height) pairs.
 *  Thirty-two segments: the lathes ARE the silhouette — skull, chest,
 *  hips — and sixteen put a hard crease down the middle of every one of
 *  them, which is most of why the old figure read as moulded plastic. */
function latheGeo(key: string, profile: number[][]): BufferGeometry {
  return cached(key, () => new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 32));
}
/** A curved band off a unit sphere — the visor glass and its slit.
 *  Authored spanning the +Z hemisphere (rotate π about Y to wear it on
 *  the face, which looks down −Z); scaled per-mesh to hug the skull. */
function visorGeo(key: string, phiLen: number, thetaStart: number, thetaLen: number): BufferGeometry {
  return cached(`visor:${key}`, () => {
    const g = new SphereGeometry(1, 28, 10, (Math.PI - phiLen) / 2, phiLen, thetaStart, thetaLen);
    return g;
  });
}
/** The glowstick blade: a rounded-tip baton, base at origin along +Y — a
 *  tube of light with body, where the old tapered spike read as a pencil
 *  line from three platforms away. */
function bladeGeo(): BufferGeometry {
  return cached('blade', () => {
    const g = new CapsuleGeometry(0.0115, 0.235, 4, 12);
    g.translate(0, 0.235 / 2 + 0.0115, 0);
    return g;
  });
}

/* The couture torso, two stacked lathes meeting at a cinched waist.
 * Radii are real metres (before the TORSO_X/Z cross-section); height is
 * unit, and align() stretches it to whatever the solve asks for. */
const BODICE = [
  // waist cinch → ribs → chest → SHOULDER YOKE → neck root.
  // An S, not a cone: lean through the ribs, filling late into the chest —
  // a straight taper reads as a funnel. The yoke is the widest ring in the
  // whole figure (shoulder balls need something to hang off) and closes
  // over the top as a trapezius DOME rather than a flat shelf.
  [0.03, 0.0],
  [0.043, 0.09],
  [0.053, 0.26],
  [0.064, 0.46],
  [0.073, 0.66],
  [0.077, 0.8],
  [0.073, 0.9],
  [0.06, 0.96],
  [0.042, 0.99],
  [0.028, 1.0],
  // …and SEALS at the axis. The profile used to stop at 0.028 and let the
  // neck plug the hole — but the yoke is squashed to TORSO_X/Z and the neck
  // is round, so either side of it the ellipse stayed open: two black
  // slots into the hollow chest, dead centre of the collar ring. From
  // above (THE CLIMB looks down on the MC all night) they read as the eye
  // holes of a second face. A closed cap costs sixteen triangles.
  [0, 1.0],
];
const BASQUE = [
  // hip line → flared basque → back up to the same 0.03 waist cinch.
  // Wide at the BOTTOM so the thighs emerge from inside the hips, and
  // never wider than the chest — hips that outrun the shoulders read as a
  // bulb on a stick.
  [0.054, 0.0],
  [0.065, 0.14],
  [0.066, 0.32],
  [0.057, 0.56],
  [0.041, 0.83],
  [0.03, 1.0],
];
/* The head, chin-up: a soft point at the jaw, cheekbones, a full cranium.
 * A scaled sphere is an egg on its side — widest at the equator with no
 * chin at all — and it reads as a lollipop on the neck. This profile is
 * the classic mannequin head: narrow below, weight above. */
const HEAD = [
  [0, 0],
  [0.028, 0.05],
  [0.048, 0.16],
  [0.06, 0.33],
  [0.067, 0.55],
  [0.066, 0.73],
  [0.057, 0.87],
  [0.04, 0.95],
  [0.021, 0.99],
  [0, 1.0],
];
/** Head height (m); the lathe above is unit-height like the others. */
const HEAD_H = 0.19;

/** Stretch a base-at-origin unit segment from `a` to `b`. */
function align(seg: Mesh, a: Vector3, b: Vector3, sx = 1, sz = 1): void {
  seg.position.copy(a);
  _dir.copy(b).sub(a);
  const len = Math.max(0.02, _dir.length());
  seg.scale.set(sx, len, sz);
  _q.setFromUnitVectors(UP, _dir.normalize());
  seg.quaternion.copy(_q);
}

/**
 * Solve a two-bone chain root → joint → tip. `hint` is the direction the
 * joint gets pushed toward; it is projected perpendicular to the chain
 * first, so an arm bends out-and-down and a knee bends forward no matter
 * how the chain is turned. The solved joint lands in `joint` and the
 * (possibly clamped) tip in `end` — placing meshes is the caller's job,
 * because arms hang DOWN from the shoulder while legs are built UP from the
 * floor and each wants its segments aligned its own way.
 */
function twoBone(
  root: Vector3,
  tip: Vector3,
  upper: number,
  lower: number,
  hint: Vector3,
  joint: Vector3,
  end: Vector3,
  slack = 0.015,
): void {
  _chain.copy(tip).sub(root);
  // Out of reach: bring the tip in to full extension rather than snapping.
  // `slack` keeps a chain off its own dead-straight singularity — worth it
  // for an arm at full stretch, but a leg pays for it in permanent knee
  // bend, and a foot that floats a centimetre off its target is worse than
  // a straight one, so legs pass 0.
  const d = Math.min(upper + lower - slack, Math.max(0.05, _chain.length()));
  _chain.normalize();
  end.copy(root).addScaledVector(_chain, d);

  const along = (d * d + upper * upper - lower * lower) / (2 * d);
  const push = Math.sqrt(Math.max(0.0004, upper * upper - along * along));
  _bend.copy(hint).addScaledVector(_chain, -hint.dot(_chain));
  if (_bend.lengthSq() < 1e-6) _bend.set(-_chain.y, _chain.x, 0); // hint parallel to the chain
  _bend.normalize();
  joint.copy(root).addScaledVector(_chain, along).addScaledVector(_bend, push);
}

/**
 * Bone length for a hip→ankle span. A FIXED femur while the figure stands,
 * so a crouch bends the knee instead of telescoping the leg; stretched for
 * players taller than the reference figure (the floor term, which keeps a
 * constant sliver of bend at any height); and folded down inside a deep
 * melt, where a full-length femur would fire the knees out sideways.
 *
 * The floor is barely over half the span — with twoBone's slack at 0 for
 * legs that is all it takes to keep the ankle exactly on its target, and
 * the knee then sits a few centimetres proud instead of the ten it used
 * to, which is the difference between standing and half-squatting.
 */
function legBone(span: number): number {
  return Math.max(span * 0.5 + 0.004, Math.min(LEG_BONE, span * 0.62 + 0.12));
}

/** How finely the hue is diced to pick a crest — one step is far too small
 *  a colour change to see, which is what lets the dev preview line up all
 *  four crests without disturbing its hue spread. */
export const STYLE_STEP = 1 / 4096;

/** Style variant 0..3 — a pure function of the hue, so every client agrees. */
export function styleVariant(hue: number): number {
  const h = ((hue % 1) + 1) % 1;
  return Math.floor(h * 4096) % 4;
}

export function buildDancer(hue: number): DancerRig {
  const root = new Group();
  const color = hueToColor(hue, 0.6);
  const variant = styleVariant(hue);
  /* EQUAL CLOTH FOR EVERY SEAT. hueToColor hands every hue the same HSL
   * lightness, but the eye doesn't meter in HSL: a cyan or green suit at
   * the same emissive gain burned about four times the luminance of a red
   * or violet one — half the ring dressed in floodlights, the other half
   * in embers. The CLOTH gains normalise softly toward a reference
   * luminance (a soft exponent, so hue character survives while the
   * floodlighting doesn't). The neon tiers are exempt: their cores whiten,
   * which levels them already, and the halos must keep the pure hue at
   * full send or the figure's colour identity dies with them. */
  const dim = Math.min(1, Math.pow(0.34 / Math.max(0.05, lumaOf(color)), 0.65));
  const suitGain = SUIT_GAIN * dim;
  const shellGain = SHELL_GAIN * dim;
  const litGain = LIT_GAIN * dim;
  const accents: DancerAccent[] = [];
  const accent = <T extends MeshStandardMaterial | MeshBasicMaterial>(
    mat: T,
    gain: number,
    neon = false,
    hot = 0,
  ): T => {
    accents.push({ mat, gain, neon, hot });
    return mat;
  };

  /* ── the material families ──
   * The costume is CUT, not patchworked: bodice and trousers share one dark
   * cloth (that match is the whole point — a black top over glowing legs
   * reads as two different outfits), and the light lives in the sleeves and
   * the midriff, where the dancing is. The darks are authored a step darker
   * and glossier than they used to be — patent leather and black glass that
   * CATCH the room's light instead of soaking in the seat colour — because
   * every candela the body doesn't spend is contrast the neon gets to keep. */
  const suit = accent(
    new MeshStandardMaterial({
      color: 0x14161d,
      emissive: color,
      emissiveIntensity: ACCENT_REST * suitGain,
      metalness: 0.68,
      roughness: 0.34,
    }),
    suitGain,
  );
  // Sleeves and midriff — the same cloth, lit.
  const lit = accent(
    new MeshStandardMaterial({
      color: 0x1c202a,
      emissive: color,
      emissiveIntensity: ACCENT_REST * litGain,
      metalness: 0.6,
      roughness: 0.32,
    }),
    litGain,
    true,
  );
  // The accessories: helm, gauntlets, boots, sculpted hair, visor glass —
  // black gloss with just enough of the seat colour in it to stay a
  // surface rather than a silhouette-shaped hole.
  const shell = accent(
    new MeshStandardMaterial({
      color: 0x0f1117,
      emissive: color,
      emissiveIntensity: ACCENT_REST * shellGain,
      metalness: 0.92,
      roughness: 0.18,
    }),
    shellGain,
  );
  // Neon trim, two temperatures: standard (lit jewellery — collar, choker,
  // belt, cuffs, seams) warms a step toward white; flat (the scan-slit,
  // the blades, the soles) runs white at the core. Both authored already
  // whitened so a rig nobody repaints (the mirror, the club floor, the
  // dev catwalk) wears the same light as the ring.
  const neonStd = accent(
    new MeshStandardMaterial({
      color: 0x101218,
      emissive: hotHex(color, TRIM_HOT),
      emissiveIntensity: ACCENT_REST,
      metalness: 0.35,
      roughness: 0.4,
    }),
    1,
    true,
    TRIM_HOT,
  );
  const neonFlat = accent(new MeshBasicMaterial({ color: hotHex(color, CORE_HOT) }), 1, true, CORE_HOT);
  // Halo sprites join the accent list too (structurally a color-only
  // material), so eliminated dancers' glows die with them and hit flashes
  // tint the halos red. They stay PURE hue — the halo is the coloured
  // bloom the white cores live inside; it is where the figure's colour
  // identity survives the whitening.
  const glow = (size: number, opacity: number) => {
    const s = glowSprite(color, size, opacity);
    accent(s.material as unknown as MeshBasicMaterial, 1, true);
    return s;
  };

  /* The close-range-only meshes (see setDetail). Everything pushed here
   * is jewellery, a joint filler, or a seam — never a limb, a lit panel, a
   * stick or a halo, because those are the silhouette. */
  const fine: Mesh[] = [];
  const detail = (m: Mesh): Mesh => {
    fine.push(m);
    return m;
  };

  const M = (geo: BufferGeometry, mat: MeshStandardMaterial | MeshBasicMaterial): Mesh => new Mesh(geo, mat);
  const seg = (rt: number, rb: number, mat: MeshStandardMaterial): Mesh => M(segGeo(rt, rb), mat);

  /* ── head: sculpted dark skull, lit visor band, jewellery, crest ── */
  const head = new Group();
  // A head turns, then nods, then tilts — in that order. (The default XYZ
  // would pitch about the WORLD's x axis, so a dancer facing sideways would
  // nod their head over their own shoulder.)
  head.rotation.order = 'YXZ';
  const skull = M(latheGeo('head', HEAD), shell);
  // Narrower across than deep, like a head — and the lathe is authored
  // base-at-0, so it drops half its height to centre on the group origin.
  skull.scale.set(0.92, HEAD_H, 1.04);
  skull.position.y = -HEAD_H / 2;
  head.add(skull);
  // Visor: WRAPAROUND GLASS — a curved band hugging the skull ear to ear
  // (a sphere patch scaled to the skull's own ellipse, edges buried in the
  // temples so there is no floating rim), carrying the hot scan-slit as a
  // narrower curved ribbon a whisker proud of the glass. The old goggle
  // was two BOXES — a brick wearing a bar — and at the MC's 2.1× the flat
  // faces read as cardboard taped to the head. (A LIT band wrapping the
  // whole head was tried long ago and cut as a blindfold; this band is
  // dark glass, and only the slit burns.)
  const goggle = detail(M(visorGeo('goggle', Math.PI, Math.PI / 2 - 0.62, 1.08), shell));
  goggle.scale.set(0.064, 0.055, 0.072);
  goggle.position.y = 0.006;
  goggle.rotation.y = Math.PI; // authored facing +Z — turn to the face
  head.add(goggle);
  const visorSlit = M(visorGeo('slit', Math.PI * 0.6, Math.PI / 2 - 0.075, 0.165), neonFlat);
  visorSlit.scale.set(0.066, 0.055, 0.0735);
  visorSlit.position.y = 0.012;
  visorSlit.rotation.y = Math.PI;
  head.add(visorSlit);
  // Ear pips — the little jewellery that catches at close range: beads
  // riding the visor band at the temples, the goggle's own rivets.
  for (const side of [-1, 1]) {
    const pip = detail(M(sphereGeo(8), neonStd));
    pip.scale.setScalar(0.012);
    pip.position.set(side * 0.063, 0.004, -0.006);
    head.add(pip);
  }
  // Variant crest — deterministic from the hue. Hair carries neon: the
  // sweeps wear the lit cloth so the haircut is part of the costume's
  // signature, and the horn keeps a single hot pip at its tip.
  if (variant === 0) {
    // Swept mohawk: a main blade rising from the scalp, a trailing shard
    // down the back of the skull — both rooted inside the head.
    const fin = M(boxGeo(), lit);
    fin.scale.set(0.011, 0.105, 0.13);
    fin.position.set(0, 0.06, 0.012);
    fin.rotation.x = 0.4;
    head.add(fin);
    const tail = M(boxGeo(), lit);
    tail.scale.set(0.009, 0.06, 0.085);
    tail.position.set(0, 0.02, 0.082);
    tail.rotation.x = 1.0;
    head.add(tail);
  } else if (variant === 1) {
    // Side-swept twin blades — an undercut read, raked hard to one side.
    for (const [ox, oy, len, rake] of [
      [0.018, 0.055, 0.115, 0.55],
      [0.04, 0.035, 0.085, 0.75],
    ] as const) {
      const blade = M(boxGeo(), lit);
      blade.scale.set(0.01, len, 0.1);
      blade.position.set(ox, oy, 0.01);
      blade.rotation.z = -rake * 0.5;
      blade.rotation.x = rake;
      head.add(blade);
    }
  } else if (variant === 2) {
    // Swept horn crest: a flattened cone rooted in the crown — thin across,
    // deep front-to-back, so it reads as sculpted hair, not an antenna —
    // standing UP and raked back, with a neon pip riding its exact tip.
    // This one variant keeps its hair DARK: the single hot point at the top
    // is the whole silhouette, and lighting the cone loses it.
    const RAKE = 0.8;
    const LEN = 0.128;
    const spire = M(segGeo(0.004, 0.026), shell);
    spire.scale.set(0.5, LEN, 1.7);
    spire.position.set(0, 0.046, 0.02);
    spire.rotation.x = RAKE;
    head.add(spire);
    const tip = M(sphereGeo(8), neonFlat);
    tip.scale.setScalar(0.0075);
    tip.position.set(0, 0.046 + LEN * Math.cos(RAKE), 0.02 + LEN * Math.sin(RAKE));
    head.add(tip);
  } else {
    // Twin swept spikes: a matched pair of tapered cones off the crown,
    // raked back and splayed out — a V from the front, where the mohawk is
    // one centre blade and the twin blades both rake to the SAME side. All
    // four crests are edges, never volume; a rounded mass on this head
    // reads as a swelling, not a haircut.
    for (const side of [-1, 1]) {
      const spike = M(segGeo(0.003, 0.016), lit);
      spike.scale.set(0.7, 0.092, 1.5);
      spike.position.set(side * 0.028, 0.05, 0.014);
      spike.rotation.z = -side * 0.34;
      spike.rotation.x = 0.72;
      head.add(spike);
    }
  }
  head.add(glow(0.34, 0.34));
  root.add(head);

  /* ── torso: neck → bodice → basque, one sculpted line ──
   * Two lathes meet at the cinched waist under a neon belt; the collar and
   * choker bound the neck; a clavicle V and shoulder caps hang the arms.
   * Both lathes are squashed to TORSO_X/Z and TURNED WITH THE YAW — an
   * elliptical torso, unlike a round one, has a front. */
  // Tapered to CLEAR THE JAW at the top (the skull is only ~0.026 wide down
  // at the chin) and to ROOT IN THE YOKE at the bottom. The dome itself is
  // sealed (see BODICE) — the buried base is for the join, not a plug, so a
  // far dancer whose neck is culled with the detail set shows a closed
  // shoulder line instead of an open hatch.
  const neck = detail(seg(0.017, 0.034, suit));
  const bodice = M(latheGeo('bodice', BODICE), suit);
  const basque = M(latheGeo('basque', BASQUE), lit); // the lit midriff
  root.add(neck, bodice, basque);
  // The sternum seam — the garment's own centre line, riding the bodice so
  // it stretches and turns with the chest. Without it a one-colour suit is
  // a blank; with it the figure is wearing something.
  // Local z is scaled by TORSO_Z with the rest of the bodice, so the seam
  // is authored to sit a whisker outside the lathe's own front radius.
  const sternum = detail(M(boxGeo(), neonStd));
  sternum.scale.set(0.013, 0.34, 0.012);
  sternum.position.set(0, 0.6, -0.075);
  bodice.add(sternum);
  // …and the SPINE SEAM down the back — the same garment line, other side.
  // Around a ring everyone faces the stage, so half the room only ever
  // sees this figure from behind, and a back that is one unbroken black
  // panel reads as the unfinished side of a prop. One seam makes the rear
  // view tailoring too.
  const spine = detail(M(boxGeo(), neonStd));
  spine.scale.set(0.013, 0.3, 0.012);
  spine.position.set(0, 0.58, 0.075);
  bodice.add(spine);
  const collar = M(torusGeo(0.062, 0.009), neonStd);
  const choker = detail(M(torusGeo(0.033, 0.005), neonStd));
  const belt = M(torusGeo(0.04, 0.007), neonStd);
  collar.scale.set(TORSO_X, TORSO_Z, 1);
  belt.scale.set(TORSO_X, TORSO_Z, 1);
  root.add(collar, choker, belt);
  const yoke = new Group(); // costume mount: the shoulder line (see DancerRig.mount)
  root.add(yoke);
  // THE GORGET — a lit panel across the collar's throat. Seen from above
  // (THE CLIMB spends whole songs looking down on the MC), the dark yoke
  // under the glowing ring crushed to two near-black lobes either side of
  // the neck: a second face, eye holes in a bright outline, dead centre of
  // the figure. Filling the ring with the sleeves' lit cloth keeps that
  // view costume instead of cavity — and on the MC it burns warn amber
  // with the rest of the lit panels, so the tell reads from overhead too.
  // A child of the collar: it inherits the ellipse and rides every pose.
  const gorget = M(discGeo(), lit);
  gorget.scale.setScalar(0.058);
  gorget.rotation.x = Math.PI; // the X90 lay-flat points local +Z DOWN — flip to face the sky
  gorget.position.z = -0.004; // a shade proud of the ring's plane, clear of the yoke's crown
  collar.add(gorget);
  // Slim bones, fat end buried in the chest: at 0.021 the notch end rose
  // over the collar ring and chopped its front arc into bright/dark stripes.
  const clavL = detail(seg(0.014, 0.016, suit));
  const clavR = detail(seg(0.014, 0.016, suit));
  root.add(clavL, clavR);
  const capL = M(sphereGeo(16), lit);
  const capR = M(sphereGeo(16), lit);
  capL.scale.set(0.043, 0.036, 0.047);
  capR.scale.set(0.043, 0.036, 0.047);
  root.add(capL, capR);

  /* ── arms: shoulder → elbow → hand, solved each pose — LIT sleeves ── */
  const upperL = seg(0.03, 0.024, lit);
  const upperR = seg(0.03, 0.024, lit);
  const foreL = seg(0.024, 0.018, lit);
  const foreR = seg(0.024, 0.018, lit);
  root.add(upperL, upperR, foreL, foreR);
  const elbowL = detail(M(sphereGeo(16), lit));
  const elbowR = detail(M(sphereGeo(16), lit));
  elbowL.scale.setScalar(0.024);
  elbowR.scale.setScalar(0.024);
  // Named so headless probes (tools/arm-motion.mjs) can read the solve.
  elbowL.name = 'elbow-l';
  elbowR.name = 'elbow-r';
  foreL.name = 'fore-l';
  foreR.name = 'fore-r';
  capL.name = 'shoulder-l';
  capR.name = 'shoulder-r';
  root.add(elbowL, elbowR);

  /* ── hands: faceted gauntlet mitt + neon cuff + glowstick blade ── */
  const mkHand = (): Group => {
    const hand = new Group();
    const mitt = M(hexGeo(), shell);
    mitt.scale.set(0.075, 0.05, 0.095);
    mitt.position.set(0, 0.004, -0.028);
    mitt.rotation.x = -0.12;
    hand.add(mitt);
    const fingers = detail(M(boxGeo(), shell));
    fingers.scale.set(0.06, 0.017, 0.05);
    fingers.position.set(0, -0.012, -0.072);
    fingers.rotation.x = -0.5;
    hand.add(fingers);
    const cuff = detail(M(torusGeo(0.034, 0.0065), neonStd));
    cuff.rotation.x = Math.PI / 2;
    cuff.position.set(0, 0.008, -0.008);
    hand.add(cuff);
    // The glowstick: a rounded BATON of light rising out of the fist —
    // white-hot core, hue in the halo — with a short black collar where it
    // leaves the grip, so the stick reads held rather than impaled. (The
    // old blade was a tapered spike: a pencil line from three platforms
    // away, and a needle has no body for the light to live in.)
    const hilt = detail(M(segGeo(0.0135, 0.015), shell));
    hilt.scale.y = 0.055;
    hilt.position.y = -0.006;
    hand.add(hilt);
    const blade = M(bladeGeo(), neonFlat);
    blade.position.y = 0.012;
    hand.add(blade);
    hand.add(glow(0.3, 0.55));
    root.add(hand);
    return hand;
  };
  const handL = mkHand();
  const handR = mkHand();
  handL.name = 'hand-l';
  handR.name = 'hand-r';

  /* ── legs: hip → KNEE → ankle, with a piped seam down the shin ──
   * Two bones, not one: the old single taper telescoped on every crouch,
   * which is the one thing a leg never does. Both segments are aligned
   * UPWARD (ankle → knee → hip) so their local frames stay the right way
   * up and the piping rides the front of the calf. */
  const mkLeg = (): { thigh: Mesh; shin: Mesh; knee: Mesh } => {
    const thigh = seg(0.045, 0.034, suit); // full at the hip, narrow at the knee
    const shin = seg(0.031, 0.018, suit); // calf at the knee, slim at the ankle
    const knee = detail(M(sphereGeo(16), suit));
    knee.scale.set(0.032, 0.03, 0.032);
    const pipe = detail(M(segGeo(0.0055, 0.0055, 5), neonStd));
    pipe.position.set(0, 0.06, -0.021);
    pipe.scale.y = 0.85; // proportional: children inherit the align() stretch
    shin.add(pipe);
    root.add(thigh, shin, knee);
    return { thigh, shin, knee };
  };
  const legL = mkLeg();
  const legR = mkLeg();
  // Hip balls — the shoulder caps' trick at the other end of the torso.
  // The thighs root at HIP_W, outside the basque hem, and a bare capsule
  // top out there reads as a leg HUNG on the body rather than joined to
  // it. A ball at each hip point sockets the thigh whatever the leg is
  // doing, and its upper-inner quarter merges into the basque flare so
  // skirt -> hip -> thigh is one continuous line. Suit-coloured like the
  // knee: it belongs to the leg chain, not the lit midriff.
  const hipCapL = M(sphereGeo(16), suit);
  const hipCapR = M(sphereGeo(16), suit);
  hipCapL.scale.set(0.052, 0.046, 0.052);
  hipCapR.scale.set(0.052, 0.046, 0.052);
  root.add(hipCapL, hipCapR);

  /* ── boots: shaft + raked toe + chunky heel on a neon sole ── */
  const mkBoot = (): Group => {
    const boot = new Group(); // origin at the ankle, ANKLE above the floor
    // The shaft rises PAST the ankle so its collar swallows the shin's
    // bottom cap at any crouch angle — no daylight at the joint. Boots
    // themselves stay flat: the feet are planted, and a pitched sole either
    // floats or saws through the deck.
    const shaft = M(segGeo(0.028, 0.032), shell);
    shaft.scale.y = 0.089;
    shaft.position.y = -0.071;
    boot.add(shaft);
    const sole = M(boxGeo(), neonFlat);
    sole.scale.set(0.06, 0.015, 0.16);
    sole.position.set(0, -ANKLE + 0.0075, -0.025);
    boot.add(sole);
    const toe = detail(M(boxGeo(), shell));
    toe.scale.set(0.054, 0.036, 0.075);
    toe.position.set(0, -0.059, -0.072);
    toe.rotation.x = 0.16;
    boot.add(toe);
    const heel = detail(M(boxGeo(), shell));
    heel.scale.set(0.042, 0.05, 0.038);
    heel.position.set(0, -0.06, 0.042);
    boot.add(heel);
    root.add(boot);
    return boot;
  };
  const bootL = mkBoot();
  const bootR = mkBoot();

  /* ── THE CROWN, built only when won ──
   * Restrained Art Deco in the club's own champagne brass: a slim band, an
   * alternating rise of eight diamond-cut points, a hot pip on each tall
   * one, a soft gold halo. Its materials are its own (never accents): gold
   * is gold on every dancer, and dispose()'s traverse releases them. */
  let crown: Group | null = null;
  const buildCrown = (): Group => {
    const c = new Group();
    c.name = 'crown';
    const brass = new MeshStandardMaterial({
      color: 0x4a3a18,
      emissive: 0xd9a94a,
      emissiveIntensity: 0.85,
      metalness: 0.9,
      roughness: 0.28,
    });
    const hot = new MeshBasicMaterial({ color: 0xffe9a8 });
    const R = 0.052;
    const band = M(torusGeo(R, 0.0055), brass);
    band.quaternion.copy(X90);
    c.add(band);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const tall = i % 2 === 0;
      const point = M(segGeo(0.0012, 0.0062, 4), brass);
      point.scale.set(1, tall ? 0.05 : 0.028, 1);
      point.position.set(Math.sin(a) * R, 0.002, Math.cos(a) * R);
      c.add(point);
      if (tall) {
        const tip = M(sphereGeo(8), hot);
        tip.scale.setScalar(0.004);
        tip.position.set(Math.sin(a) * R, 0.054, Math.cos(a) * R);
        c.add(tip);
      }
    }
    c.add(glowSprite(0xffd24a, 0.22, 0.38));
    return c;
  };

  /** Solve one arm: elbow at an adaptive pole, hand riding the solved tip. */
  const solveArm = (
    side: -1 | 1,
    shoulder: Vector3,
    hand: Group,
    hx: number,
    hy: number,
    hz: number,
    upper: Mesh,
    fore: Mesh,
    elbow: Mesh,
  ): void => {
    _target.set(hx, hy, hz);
    // THE ELBOW POLE. The natural bend for a hand working at its own side
    // is out from THE BODY it belongs to — the body's own right axis, not
    // the world's +x (a fixed compass hint bent every turned dancer's arms
    // across their chest, and a mirror reflection got them backwards) —
    // and biased downward. But one hint cannot serve a whole dance
    // vocabulary: a hand CROSSED past the midline with its elbow still
    // pushed hard outward is a chicken wing with the upper arm sawing
    // through the chest, and a long forward thrust wants the elbow rolled
    // under the arm, not flared beside it. So the pole adapts,
    // continuously, from where the hand actually is in the body's frame:
    // crossing folds the elbow down-and-forward, reaching rolls it under.
    const relOut = ((hx - shoulder.x) * _right.x + (hz - shoulder.z) * _right.z) * side;
    const relFwd = (hx - shoulder.x) * _fwd.x + (hz - shoulder.z) * _fwd.z;
    const cross = Math.min(1, Math.max(0, (0.06 - relOut) / 0.3));
    const punch = Math.min(1, Math.max(0, (relFwd - 0.18) / 0.35));
    const out = side * (1 - 0.9 * cross) * (1 - 0.6 * punch);
    const fw = 0.35 * cross + 0.18 * punch;
    _hint.set(_right.x * out + _fwd.x * fw, -(0.7 + 0.15 * punch), _right.z * out + _fwd.z * fw);
    _hint.normalize();
    twoBone(shoulder, _target, UPPER_ARM, FOREARM, _hint, _solved, _tip);
    align(upper, shoulder, _solved);
    align(fore, _solved, _tip); // leaves _dir = the forearm's own direction
    elbow.position.copy(_solved);
    hand.position.copy(_tip);
    // THE STICK IS A POINTER. It rides the forearm's line with an upward
    // bias (a loose grip stands the stick up as the arm rises) and a
    // slight outward flare, and the fist twists with the body's yaw — so
    // a thrust aims the blade at what it is thrusting at, a raised stick
    // is a torch, a resting one hangs easy, and a dancer facing you no
    // longer grips their sticks in the same world direction as one facing
    // away. (The old constant quaternion pointed every stick on the floor
    // at the same patch of sky forever, whatever the arm was doing.)
    _hint.set(_dir.x + _right.x * side * 0.18, _dir.y + 0.8, _dir.z + _right.z * side * 0.18);
    _hint.normalize();
    hand.quaternion.setFromUnitVectors(UP, _hint).multiply(_yawQ);
  };

  const shoulderL = new Vector3();
  const shoulderR = new Vector3();
  const hip = new Vector3();
  const foot = new Vector3();

  const pose = (p: DancerPose): void => {
    // Melt: the whole solve runs on a squashed frame — head sinks, hips
    // sink faster, and the figure puddles.
    const melt = p.slump;
    const hy = p.hy * (1 - melt * 0.62);
    const hipY = Math.max(0.12, (p.hy - HEAD_DROP) * (1 - melt * 0.85));
    // The hips hang UNDER THE HEAD. They used to be scaled toward the
    // origin (`p.hx * 0.94`), which reads as a subtle lean only while the
    // origin is the body's own rest position — true on a platform, false
    // everywhere else. On the CLUB floor, where poses are world-space, a
    // dancer standing at x 6.6 got their hips dragged 0.4 m across the
    // room and their legs splayed out from under them; the mirror made it
    // impossible to miss, because you were finally looking at yourself.
    const hipX = p.hx;
    const hipZ = p.hz;

    head.position.set(p.hx, hy, p.hz);
    // `|| 0` also swallows a NaN from a half-built pose: a head that spins
    // to NaN takes its whole rig off screen, and a lost nod is cheaper.
    const clamp = (v: number, lim: number): number => Math.max(-lim, Math.min(lim, v || 0));
    // Melting overrides the neck: a folded dancer's head hangs, whatever
    // they were looking at on the way down.
    head.rotation.set(
      clamp(p.pitch, PITCH_MAX) * (1 - melt) + melt * 0.9,
      p.yaw,
      clamp(p.roll, ROLL_MAX) * (1 - melt) + melt * 0.35,
    );
    if (crown) {
      // The crown HOVERS: it rides the head's position (melting sinks it
      // with the skull) but never its nod or tilt — a floating halo stays
      // level — and turns slowly on its own stately clock. Placed even
      // while hidden, so putting it on is correct whatever the frame order.
      crown.position.set(p.hx, hy + CROWN_RISE, p.hz);
      crown.rotation.y = (performance.now() * 0.0006) % (Math.PI * 2);
    }

    const cos = Math.cos(p.yaw);
    const sin = Math.sin(p.yaw);
    // The body's own axes at this yaw (yaw 0 faces −Z, toward the stage).
    _right.set(cos, 0, -sin);
    _fwd.set(-sin, 0, -cos);
    _yawQ.setFromAxisAngle(UP, p.yaw);

    // Shoulder line under the head, turned with the yaw.
    const shY = hy - SHOULDER_DROP;
    shoulderL.set(p.hx - SHOULDER_W * cos, shY, p.hz + SHOULDER_W * sin);
    shoulderR.set(p.hx + SHOULDER_W * cos, shY, p.hz - SHOULDER_W * sin);

    // Torso line: neck → bodice (shoulder mid → waist) → basque (→ hips).
    // The neck's top rides INSIDE the skull (see NECK_ROOT) so it leans with
    // a nod without being dragged around by the chin, and its base is sunk
    // under the shoulder yoke so the join can never open up.
    _a.set(0, -NECK_ROOT, 0).applyEuler(head.rotation).add(head.position);
    _b.set((shoulderL.x + shoulderR.x) / 2, shY, (shoulderL.z + shoulderR.z) / 2);
    _neck.copy(_a).sub(_b);
    if (_neck.lengthSq() < 1e-6) _neck.set(0, 1, 0);
    _neck.normalize();
    _c.copy(_b).addScaledVector(_neck, -NECK_SINK);
    align(neck, _c, _a);
    // The choker rides the VISIBLE neck — a fixed way up from the collar,
    // not a fraction of a segment that now starts inside the chest.
    choker.position.copy(_b).addScaledVector(_neck, 0.05);
    choker.quaternion.copy(neck.quaternion).multiply(X90);
    _mid.set(hipX * 0.35 + _b.x * 0.65, hipY + (shY - hipY) * 0.42, hipZ * 0.35 + _b.z * 0.65);
    align(bodice, _mid, _b, TORSO_X, TORSO_Z);
    bodice.quaternion.multiply(_yawQ); // an elliptical torso has a FRONT
    _a.set(hipX, hipY, hipZ);
    align(basque, _a, _mid, TORSO_X, TORSO_Z);
    basque.quaternion.multiply(_yawQ);
    collar.position.copy(_b);
    collar.quaternion.copy(bodice.quaternion).multiply(X90);
    yoke.position.copy(_b);
    yoke.quaternion.copy(bodice.quaternion);
    belt.position.copy(_mid);
    belt.quaternion.copy(basque.quaternion).multiply(X90);

    // Clavicle V from the sternum notch out to each shoulder; caps pin the
    // arms to the torso at any pose angle. The notch sits LOW — a real
    // sternal notch is a few centimetres under the shoulder line — so the
    // bars rise to the shoulders entirely beneath the collar ring instead
    // of sawing through its front arc, and the V points at the sternum
    // seam it nearly touches.
    _c.set(_b.x - sin * 0.042, shY - 0.044, _b.z - cos * 0.042);
    align(clavL, _c, shoulderL);
    align(clavR, _c, shoulderR);
    capL.position.copy(shoulderL);
    capR.position.copy(shoulderR);
    capL.rotation.y = p.yaw;
    capR.rotation.y = p.yaw;

    // Arms.
    solveArm(-1, shoulderL, handL, p.lx, p.ly * (1 - melt * 0.6), p.lz, upperL, foreL, elbowL);
    solveArm(1, shoulderR, handR, p.rx, p.ry * (1 - melt * 0.6), p.rz, upperR, foreR, elbowR);

    // Legs: ankles plant a shade inside the hips (real legs converge), and
    // trail the body a touch. Knees bend FORWARD with a slight outward
    // splay, so a duck folds into a squat and the two never cross.
    for (const side of SIDES) {
      hip.set(hipX + _right.x * side * HIP_W, hipY, hipZ + _right.z * side * HIP_W);
      const spread = side * (HIP_W - 0.006);
      foot.set(hipX + _right.x * spread - _fwd.x * 0.02, ANKLE, hipZ + _right.z * spread - _fwd.z * 0.02);
      const bone = legBone(hip.distanceTo(foot));
      _hint.copy(_fwd).addScaledVector(_right, side * 0.32);
      const leg = side < 0 ? legL : legR;
      twoBone(hip, foot, bone, bone, _hint, _solved, _tip, 0);
      // Built from the floor up: shin ankle → knee, thigh knee → hip.
      align(leg.shin, _tip, _solved);
      align(leg.thigh, _solved, hip);
      leg.knee.position.copy(_solved);
      const boot = side < 0 ? bootL : bootR;
      boot.position.copy(_tip);
      boot.rotation.y = p.yaw;
      const hipCap = side < 0 ? hipCapL : hipCapR;
      hipCap.position.copy(hip);
      hipCap.rotation.y = p.yaw; // squashed spheres have a front
    }
  };

  // Park in a neutral stance so a rig never renders unsolved.
  pose({ hx: 0, hy: 1.52, hz: 0, yaw: 0, pitch: 0, roll: 0, lx: -0.3, ly: 1.0, lz: -0.1, rx: 0.3, ry: 1.0, rz: -0.1, slump: 0 });

  let detailed = true;
  return {
    root,
    accents,
    baseColor: color,
    pose,
    mount: { head, yoke, handL, handR },
    setCrown(on: boolean) {
      if (on && !crown) {
        crown = buildCrown();
        crown.visible = false; // parked off-origin only once pose() places it
        crown.position.set(0, -10, 0);
        root.add(crown);
      }
      if (crown) crown.visible = on;
    },
    setDetail(near: boolean) {
      if (near === detailed) return;
      detailed = near;
      for (const m of fine) m.visible = near;
    },
    dispose() {
      root.removeFromParent();
      // Geometry is module-shared (see geoCache) — release materials only.
      root.traverse((o) => {
        ((o as Mesh).material as MeshBasicMaterial | undefined)?.dispose?.();
      });
    },
  };
}
