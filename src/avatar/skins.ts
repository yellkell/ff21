/**
 * Pickable skins for the avatar and the platform — pure visuals, applied by
 * recolouring role-tagged materials (boxer.ts / arena.ts tag every material
 * with `userData.role`). Hitboxes are never touched.
 *
 * Three launch skins per slot (blue / red / one more) plus a locked
 * COMING SOON chip. The rival's picks arrive in the `iam` message and are
 * applied to their rig/pad; bot bouts keep the team-blue default look.
 */

import { Color, Mesh, MeshStandardMaterial, type Object3D, SRGBColorSpace } from 'three';
import { PALETTE } from '../config.js';
import { deckLook, type DeckStyle } from '../arena/decks.js';

export interface AvatarSkin {
  id: string;
  name: string;
  locked?: boolean;
  /** Panel steel. */
  chassis: number;
  /** Dark trim pieces. */
  trim: number;
  /** Visor / reactor / trim glow. */
  accent: number;
  /** Sleeker silhouette — FF1's PANTHER trait, unused since THE BLANK
   *  became the only body. Kept so old saved/wire skin ids still parse. */
  slim?: boolean;
  /** Shop price in coins. Omitted = free / owned from the start. */
  price?: number;
}

export interface PlatformSkin {
  id: string;
  name: string;
  locked?: boolean;
  /** What the deck is MADE OF (arena/decks.ts) — the skin's identity. The
   *  shop sells materials now, not tints: charred oak, pale ash, quarried
   *  slate, veined marble, black glass, river ice, jade, gold leaf. */
  deck: DeckStyle;
  /** The neon tube round the edge — the light the deck stands in. */
  neon: number;
  /** The corner screws' metal (TRIM): iron, brass, chrome, gold. */
  trim: number;
  /** Shop price in coins. Omitted = free / owned from the start. */
  price?: number;
  /** Earned, never sold: how this skin is won (shown on its shop tile in
   *  place of a price; tapping it there does nothing until it's yours). */
  earnedBy?: string;
  /** One line for the tile. */
  blurb: string;
  /** Which SHELF of the PLATFORMS board it stands on (menu/lockerFace.ts):
   *  the woods, the stones, the forge. Earned pads stand on HONOURS
   *  whatever this says — see platformShelf(). */
  shelf?: DeckShelf;
}

/** The PLATFORMS board's shelves: seventeen pads on one board crushed the
 *  tiles (the GEAR board learned the same lesson with its slots), so the
 *  catalogue is shelved by what a deck is made of, plus the trophy shelf. */
export type DeckShelf = 'timber' | 'stone' | 'forge' | 'honours';
export const DECK_SHELVES: ReadonlyArray<[DeckShelf, string]> = [
  ['timber', 'TIMBER'],
  ['stone', 'STONE'],
  ['forge', 'FORGE'],
  ['honours', 'HONOURS'],
];

/** The shelf a pad stands on: earned pads are HONOURS, the rest say. */
export function platformShelf(skin: PlatformSkin): DeckShelf {
  return skin.earnedBy ? 'honours' : skin.shelf ?? 'stone';
}

/** The corner screws' metals. */
export const TRIM = {
  brass: 0xc9a86a,
  iron: 0x4a4c52,
  chrome: 0xd8dde6,
  gold: 0xf1c75a,
} as const;

/** Platform skins owned from the start (no purchase needed). */
export const FREE_PLATFORMS = ['ember', 'azure', 'inferno'];
/** Avatar skins owned from the start — the rest are shop unlocks. */
export const FREE_AVATARS = ['blank', 'onyx'];

export const AVATAR_SKINS: AvatarSkin[] = [
  // THE BLANK — the only body in town (DESIGN.md §5.1). FF2 retired the
  // FF1 animal-skin roster outright: everyone is born the same primer
  // mannequin, and identity comes from attachments and paint, never from
  // a catalogue of bodies. Saved FF1 picks and remote peers' old skin ids
  // all resolve here through avatarSkin()'s fallback.
  // The palette fields only paint its SHOP TILE — the body's materials are
  // untagged, so it stays primer no matter what the recolour machinery does.
  { id: 'blank', name: 'YOU', chassis: 0xf4f2ee, trim: 0xd8d5cf, accent: 0xf4f2ee },
  // …and its midnight twin: the same body in factory black. The base tone
  // is the ONE choice the body itself offers — everything else is paint.
  { id: 'onyx', name: 'THE ONYX', chassis: 0x17171a, trim: 0x0c0c0e, accent: 0x8f8f98 },
];

export const PLATFORM_SKINS: PlatformSkin[] = [
  // ── free: the three you're born with ──────────────────────────────────
  { id: 'ember', name: 'SMOULDER', deck: 'charred', neon: PALETTE.ember, trim: TRIM.iron, shelf: 'timber', blurb: 'charred oak, still warm underfoot' },
  { id: 'azure', name: 'AZURE', deck: 'ash', neon: 0x4fb7ff, trim: TRIM.chrome, shelf: 'timber', blurb: 'pale ash boards under a cold tube' },
  { id: 'inferno', name: 'INFERNO', deck: 'redwood', neon: 0xff3b30, trim: TRIM.brass, shelf: 'timber', blurb: 'redwood, red light' },
  // ── the shop: materials, cheap to precious ────────────────────────────
  { id: 'walnut', name: 'WALNUT', deck: 'walnut', neon: 0xffb347, trim: TRIM.brass, price: 100, shelf: 'timber', blurb: 'dark figured boards, waxed' },
  { id: 'slate', name: 'SLATE', deck: 'slate', neon: 0x5ff2ff, trim: TRIM.iron, price: 150, shelf: 'stone', blurb: 'quarried flagstones, cleaved' },
  { id: 'marble', name: 'MARBLE', deck: 'marble', neon: 0xffd84a, trim: TRIM.brass, price: 250, shelf: 'stone', blurb: 'grey-white stone, dark veins' },
  { id: 'frost', name: 'FROST', deck: 'frost', neon: 0x8ae4ff, trim: TRIM.chrome, price: 400, shelf: 'stone', blurb: 'river ice, bubbles frozen in' },
  { id: 'obsidian', name: 'OBSIDIAN', deck: 'obsidian', neon: 0xb06bff, trim: TRIM.iron, price: 600, shelf: 'stone', blurb: 'black glass, rippled where it cooled' },
  { id: 'jade', name: 'JADE', deck: 'jade', neon: 0x7dffc2, trim: TRIM.brass, price: 800, shelf: 'stone', blurb: 'green stone with a cloud in it' },
  { id: 'bullion', name: 'BULLION', deck: 'bullion', neon: 0xfff1c9, trim: TRIM.gold, price: 2000, shelf: 'forge', blurb: 'gold leaf, laid square by square' },
  // ── THE FORGE and the quarry's back room: the second wave ─────────────
  { id: 'basalt', name: 'BASALT', deck: 'basalt', neon: 0xff6a3d, trim: TRIM.iron, price: 350, shelf: 'stone', blurb: 'cooled columns, six-sided' },
  { id: 'copper', name: 'COPPER', deck: 'copper', neon: 0x3fe0c8, trim: TRIM.brass, price: 300, shelf: 'forge', blurb: 'hammered copper, going green' },
  { id: 'magma', name: 'MAGMA', deck: 'magma', neon: 0xff7a18, trim: TRIM.iron, price: 1200, shelf: 'forge', blurb: 'black crust, fire in the cracks' },
  { id: 'meteorite', name: 'METEORITE', deck: 'meteorite', neon: 0x9fd8ff, trim: TRIM.chrome, price: 1500, shelf: 'forge', blurb: 'iron from the sky, acid-etched' },
  // ── earned, never sold ────────────────────────────────────────────────
  // CHAMPION: the first fell of GOLIATH, king of the titan gauntlet.
  { id: 'champion', name: 'CHAMPION', deck: 'lacquer', neon: 0xfff3cf, trim: TRIM.gold, earnedBy: 'FELL GOLIATH', blurb: 'crimson lacquer, gold inlay' },
  // TIDEBREAKER: fell GOOPLIATH with a raid squad — the pool still surges
  // across it (arena.ts keeps the tide FX under this id).
  { id: 'tidebreaker', name: 'TIDEBREAKER', deck: 'tide', neon: 0x5aff7a, trim: TRIM.iron, earnedBy: 'FELL RAID GOOPLIATH', blurb: 'wet green stone under the pool' },
  // BLAZING: clear any run or raid on the blazing breaker — the burning
  // rail and corner flame crowns stay (arena.ts).
  { id: 'blazing', name: 'BLAZING', deck: 'charred', neon: 0xff4a26, trim: TRIM.iron, earnedBy: 'WIN ON BLAZING', blurb: 'scorched boards under a burning rail' },
];

/** How the OPPONENT looks when they haven't picked (bot bouts): team blue. */
export const OPPONENT_DEFAULT_AVATAR: AvatarSkin = {
  // An unskinned opponent (the bot) is a BLANK too — in FF2 everyone is
  // born the same primer mannequin; the palette here only matters to
  // role-tagged geometry, which the blank deliberately has none of.
  id: 'blank', name: '', chassis: 0x98948b, trim: 0x4e4b45, accent: PALETTE.coolFlame,
};
export const OPPONENT_DEFAULT_PLATFORM: PlatformSkin = {
  id: 'opp-default', name: '', deck: 'charred', neon: PALETTE.coolFlame, trim: TRIM.iron, blurb: '',
};

export function avatarSkin(id: string): AvatarSkin {
  const s = AVATAR_SKINS.find((x) => x.id === id);
  // An unknown/locked id falls back to THE BLANK — FF2's factory body.
  return s && !s.locked ? s : AVATAR_SKINS[0];
}

export function platformSkin(id: string): PlatformSkin {
  const s = PLATFORM_SKINS.find((x) => x.id === id);
  // Unknown — or one of FF1's retired tints (TOXIC, VOLT, XD…) — falls
  // back to SMOULDER, the house deck.
  return s && !s.locked ? s : PLATFORM_SKINS[0];
}

/**
 * A cohesive "tinted steel" palette from a single hue (0..1): a dark armour
 * body, a darker trim, and a vivid accent — so one colour repaints the WHOLE
 * suit yet still reads as forged metal lit from within, not a flat fill.
 */
export function colorPalette(hue: number, light = 0.5): { chassis: number; trim: number; accent: number } {
  const h = ((hue % 1) + 1) % 1;
  // light 0..1 (0.5 = neutral) shifts every tone's HSL lightness up or down.
  const dl = (light - 0.5) * 0.7;
  const cl = (l: number): number => Math.max(0.03, Math.min(0.95, l + dl));
  return {
    chassis: new Color().setHSL(h, 0.5, cl(0.16)).getHex(),
    trim: new Color().setHSL(h, 0.45, cl(0.08)).getHex(),
    accent: new Color().setHSL(h, 0.9, cl(0.56)).getHex(),
  };
}

/** A skin recoloured to a custom hue + lightness — keeps the SHAPE
 *  (id/name/slim), repaints the whole armour. */
export function tintSkin(base: AvatarSkin, hue: number, light = 0.5): AvatarSkin {
  return { ...base, ...colorPalette(hue, light) };
}

/** The skin to actually wear: the chosen shape, recoloured to `hue` when one is
 *  set (hue < 0 keeps the shape's own default palette). */
export function resolveAvatarSkin(id: string, hue: number, light = 0.5): AvatarSkin {
  const base = avatarSkin(id);
  return hue >= 0 && !base.locked ? tintSkin(base, hue, light) : base;
}

const _white = new Color(0xffffff);
const _hand = new Color();

/**
 * THE HANDS' CEILING — the one colour the fashion does not get to choose
 * freely. Your hands BLOOM WHITE when they're live (squeezed, or a ball
 * mid-return), and that tell is the game's most-read signal; a pale hand
 * has nowhere to bloom to. So a hand takes the skin's hue and saturation
 * but never more than a dark steel's lightness — the wardrobe still reads
 * on them, the squeeze still reads louder.
 */
// Measured in sRGB — the space a person's eye is in. The hands' resting
// steel (avatar/hands.ts, 0x15171c) sits at L≈0.10 there; this is the most
// a wardrobe may lift it — enough for a tinted steel to read as blue or
// rust, nowhere near enough to compete with the white bloom. (Working in
// three's linear space instead would make 0.14 land at a mid grey.)
const HAND_MAX_L = 0.22;
const _hsl = { h: 0, s: 0, l: 0 };
function handTone(chassis: number): number {
  _hand.setHex(chassis, SRGBColorSpace);
  _hand.getHSL(_hsl, SRGBColorSpace);
  if (_hsl.l <= HAND_MAX_L) return chassis;
  return _hand.setHSL(_hsl.h, _hsl.s, HAND_MAX_L, SRGBColorSpace).getHex(SRGBColorSpace);
}

/**
 * Recolour an avatar (rig piece, whole torso, glove, the mirror…) to a skin.
 * Glove LEDs (materials carrying `litIntensity`) keep their TEAM colour —
 * the squeeze tell must stay readable whatever the fashion.
 */
export function applyAvatarSkin(root: Object3D, skin: AvatarSkin): void {
  if (skin.locked) return;
  root.traverse((o) => {
    // Per-skin ornament geometry (antennas, horns, plumes, winglets…):
    // each piece carries the id of the ONE skin it belongs to.
    if (o.userData?.skinTag) o.visible = o.userData.skinTag === skin.id;
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.userData?.role) return;
    switch (m.userData.role) {
      case 'chassis':
        m.color.setHex(skin.chassis);
        if (m.emissiveIntensity > 0 && m.userData.litIntensity === undefined) {
          m.emissive.setHex(skin.accent);
        }
        break;
      case 'trim':
        m.color.setHex(skin.trim);
        break;
      case 'hand': {
        // The hands tint to the skin's steel but stay DARK at rest, capped
        // by handTone — the white active bloom is owned by setGloveLit and
        // needs somewhere to bloom from.
        const tone = handTone(skin.chassis);
        m.color.setHex(tone, SRGBColorSpace);
        // THE PAINT bakes this tone as the hand's canvas fill, and takes
        // the material's tint over while it does (avatar/paint.ts) — so
        // the skin has to hand the new steel on rather than only setting
        // a colour the map may already have replaced.
        m.userData.paintFill = `#${tone.toString(16).padStart(6, '0')}`;
        break;
      }
      case 'glow':
        if (m.userData.litIntensity !== undefined) break; // team LED — leave it
        m.color.setHex(skin.accent);
        m.emissive.setHex(skin.accent);
        break;
    }
  });
  // (FF1's PANTHER used to slim the chest/pelvis group scales here. Both
  // groups are one body now and no surviving skin sets `slim`, so the
  // silhouette is the mannequin's own — see avatar/mannequin.ts.)
}

/**
 * Dress a platform in a skin: the deck's MATERIAL (maps, finish, glow —
 * arena/decks.ts), the corner screws' metal, the neon tube's colour, and
 * the per-skin FX (BLAZING's fire, TIDEBREAKER's pool) by their tag. The
 * deck textures are shared per style, so swapping skins never uploads.
 */
export function applyPlatformSkin(root: Object3D, skin: PlatformSkin): void {
  if (skin.locked) return;
  const look = deckLook(skin.deck);
  root.traverse((o) => {
    if (o.userData?.skinTag) o.visible = o.userData.skinTag === skin.id;
    const m = (o as Mesh).material as MeshStandardMaterial | undefined;
    if (!m || Array.isArray(m) || !m.userData?.role) return;
    switch (m.userData.role) {
      case 'slab':
        if (m.userData.deck !== skin.deck) {
          m.userData.deck = skin.deck;
          m.map = look.map;
          m.bumpMap = look.bump;
          m.emissiveMap = look.emissiveMap ?? null;
          // A two-material deck (CHAMPION's gold in lacquer) carries its
          // roughness and metalness per texel; the rest clear it.
          m.roughnessMap = look.finish ?? null;
          m.metalnessMap = look.finish ?? null;
          m.needsUpdate = true;
        }
        m.color.setHex(look.color);
        m.roughness = look.roughness;
        m.metalness = look.metalness;
        m.bumpScale = look.bumpScale;
        m.envMapIntensity = look.envMapIntensity;
        // A deck that burns or shines from within says so; otherwise the
        // faintest trace of the tube's colour, so the board edges read lit.
        m.emissive.setHex(look.emissive ?? skin.neon);
        m.emissiveIntensity = look.emissiveIntensity ?? 0.02;
        break;
      case 'trim':
        m.color.setHex(skin.trim);
        break;
      case 'neon-core':
        m.color.copy(new Color(skin.neon).lerp(_white, 0.45));
        break;
      case 'neon-halo':
        m.color.setHex(skin.neon);
        break;
    }
  });
}
