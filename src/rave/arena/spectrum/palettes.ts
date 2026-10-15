/**
 * SPECTRUM's record sleeves — every song dresses the whole set in its own
 * palette: the EQ wall's gradient, the vinyl's grooves, the ripples on the
 * glass, the horizon, the lasers (the light rig takes them too).
 *
 * PALETTE DISCIPLINE still rules (config.ts): amber→red and goo green are
 * the language of danger, so no sleeve may speak them. Everything here
 * lives in the blue · cyan · violet · magenta · pink · white half of the
 * wheel — which still leaves room for ice, dawn, vapour, ultraviolet,
 * royal, monochrome… a set that LOOKS like the record it's playing.
 *
 * Stops run low → high up the wall (and outer → inner on the record).
 */

export interface Palette {
  name: string;
  /** Four gradient stops, bottom of the wall to the top. */
  stops: [number, number, number, number];
  /** Peak-hold caps and the hottest highlights. */
  peak: number;
  /** Lasers, the tone arm, the playhead ring. */
  accent: number;
  /** The glow the sky holds just over the horizon. */
  horizon: number;
  /** Laser colours the light rig cycles through, bar by bar. */
  lasers: number[];
}

export const PALETTES: Record<string, Palette> = {
  synthwave: {
    name: 'SYNTHWAVE',
    stops: [0x2a1bff, 0x7a14ff, 0xe81cff, 0xff4fa8],
    peak: 0xffe6f6,
    accent: 0x4fe3ff,
    horizon: 0x5a10c8,
    lasers: [0xff2ad5, 0x4fe3ff, 0x9a4bff],
  },
  ice: {
    name: 'ICE',
    stops: [0x0a2cff, 0x1c7bff, 0x34d6ff, 0xc8f6ff],
    peak: 0xffffff,
    accent: 0xb7f3ff,
    horizon: 0x0d3fb8,
    lasers: [0x34d6ff, 0xffffff, 0x1c7bff],
  },
  ultraviolet: {
    name: 'ULTRAVIOLET',
    stops: [0x2b0a8f, 0x5b1cff, 0xa05bff, 0xe4ccff],
    peak: 0xffffff,
    accent: 0xd04bff,
    horizon: 0x3a0aa8,
    lasers: [0x8f3bff, 0xe4ccff, 0xd04bff],
  },
  vapor: {
    name: 'VAPOR',
    stops: [0x19c8ff, 0x5a8bff, 0xc45bff, 0xff7ad9],
    peak: 0xfff0fb,
    accent: 0xff7ad9,
    horizon: 0x2a5ad8,
    lasers: [0x19c8ff, 0xff7ad9, 0xffffff],
  },
  sakura: {
    name: 'SAKURA',
    stops: [0x6a1a9a, 0xd0308f, 0xff7ab8, 0xffd6ea],
    peak: 0xffffff,
    accent: 0xffb3d9,
    horizon: 0x7a1a7a,
    lasers: [0xff7ab8, 0xffffff, 0xd0308f],
  },
  abyss: {
    name: 'ABYSS',
    stops: [0x060f6a, 0x1438d8, 0x6a3cff, 0x2ee6ff],
    peak: 0xd8faff,
    accent: 0x2ee6ff,
    horizon: 0x0a1a8a,
    lasers: [0x2ee6ff, 0x6a3cff, 0x1438d8],
  },
  electric: {
    name: 'ELECTRIC',
    stops: [0x1a1aff, 0x8a1aff, 0xff1ac8, 0xffffff],
    peak: 0xffffff,
    accent: 0xffffff,
    horizon: 0x4a0ad8,
    lasers: [0xff1ac8, 0x1a1aff, 0xffffff],
  },
  noir: {
    name: 'NOIR',
    stops: [0x23232e, 0x6c6c84, 0xc8c8dc, 0xffffff],
    peak: 0xff2ad5,
    accent: 0xff2ad5,
    horizon: 0x2a2440,
    lasers: [0xffffff, 0xff2ad5, 0xc8c8dc],
  },
  aurora: {
    name: 'AURORA',
    stops: [0x1a2a9a, 0x2a8aff, 0x3ae8f0, 0xb88cff],
    peak: 0xf0fdff,
    accent: 0xb88cff,
    horizon: 0x123a9a,
    lasers: [0x3ae8f0, 0xb88cff, 0x2a8aff],
  },
};

/** Which sleeve each record wears. Anything unlisted gets one by its id. */
const SLEEVES: Record<string, keyof typeof PALETTES> = {
  sakupened: 'vapor',
  combat: 'electric',
  discoball: 'synthwave',
  loop: 'vapor',
  capture: 'abyss',
  morning: 'sakura',
  money: 'noir',
  target: 'ice',
  breakcore: 'electric',
  dynasty: 'abyss',
  spread: 'aurora',
  unity: 'vapor',
  assemble: 'electric',
  infection: 'ultraviolet',
  giveit: 'synthwave',
  vone: 'ice',
  fusion: 'aurora',
  braineater: 'ultraviolet',
  futurevibe: 'vapor',
  vfall: 'abyss',
  defense: 'ice',
  awakening: 'sakura',
  passion: 'sakura',
  final: 'noir',
  overtime: 'electric',
  bringiton: 'synthwave',
  erase: 'noir',
  indecisive: 'aurora',
  climb: 'ice',
  // the club's and the foyer's rotation (club/ledFloor.ts)
  chill: 'aurora',
  swag: 'synthwave',
  eclipse: 'ultraviolet',
  credits: 'sakura',
};

const KEYS = Object.keys(PALETTES);

export function paletteFor(trackId: string | null | undefined): Palette {
  if (!trackId) return PALETTES.synthwave;
  const key = SLEEVES[trackId];
  if (key) return PALETTES[key];
  let h = 0;
  for (let i = 0; i < trackId.length; i++) h = (h * 31 + trackId.charCodeAt(i)) >>> 0;
  return PALETTES[KEYS[h % KEYS.length]];
}
