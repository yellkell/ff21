/**
 * GOOPLIATH tunables — the gel creature's own constants, vendored from GOOP
 * alongside the creature code (src/goopliath/). Everything here is in the
 * creature's NATIVE metre scale: the sim always runs man-sized (1.78 m tall)
 * and the whole rig is scaled up to boss size by its parent group, so these
 * numbers keep the exact wobble/dent/lump proportions of the original.
 *
 * Boss-fight tuning (hit counts, arena scale, seesaw cadence) lives with the
 * rest of the campaign constants in src/config.ts — this file is only the
 * body itself.
 */

/** The creature's body plan. */
export const CREATURE = {
  /** Head height when fully formed up into its fighting shape. */
  height: 1.78,
  /** Glob-mode dome: roughly this radius, this tall. */
  globRadius: 0.62,
  globHeight: 0.95,
  /** Smooth-min blend width — how gloopily the blobs fuse (bigger = soupier). */
  blend: 0.19,
  /** Max simultaneous knocked-out lumps in flight/resting on the floor.
   *  ZERO for the boss: torn-off globs flying at the player (and crawling
   *  home after) cost blobs in the march loop and frames on Quest — the
   *  body's own dents/jiggle carry the hit feedback. */
  maxLumps: 0,
  /** Max simultaneous impact dents (negative blobs carved by fireballs). */
  maxDents: 4,
  /** Seconds for glob -> boxer form-up (and back down). */
  formTime: 1.35,
};

/** Impact reception — what a hit does to the gel (in native creature space). */
export const PUNCH = {
  /** Impact speed (m/s) below this only nudges the surface, no "hit". */
  hitSpeed: 1.3,
  /** Impact speed that knocks a lump clean out of the body. */
  lumpSpeed: 2.5,
  /** Impulse scale from impact velocity into nearby blobs — how hard a hit
   *  physically shoves the gel. Cranked up so a hit visibly ripples the body. */
  impulse: 1.5,
  /** Radius around the contact point that feels the hit — wide so the shove
   *  travels out across the surface as a ripple, not just a local poke. */
  splashRadius: 0.72,
  /** Seconds a dent crater lingers before the gel flows back in — long enough
   *  to read the impact wobble out. */
  dentLife: 0.62,
  /** Per-hand cooldown between scoring hits (unused by the boss, kept for the sim). */
  cooldown: 0.2,
  /** Damage per scoring hit (unused by the boss — Goopliath counts hits). */
  damage: 3.2,
  lumpBonus: 2.5,
  headBonus: 1.25,
  headRadius: 0.3,
};

/**
 * The gel moveset — kept for the sim/choreography layer. The boss fight
 * drives these limbs for flavour swings; damage to the player comes from the
 * campaign attack zones, not these contact numbers.
 */
export type AttackName =
  | 'jab'
  | 'cross'
  | 'hook'
  | 'uppercut'
  | 'overhand'
  | 'backfist'
  | 'roundhouse'
  | 'spinkick'
  | 'clap';

export interface AttackSpec {
  telegraph: number;
  strike: number;
  recover: number;
  damage: number;
  /** Contact distance from the striking blob to the target at apex. */
  hitRadius: number;
}

export const ATTACKS: Record<AttackName, AttackSpec> = {
  jab: { telegraph: 0.5, strike: 0.13, recover: 0.35, damage: 6, hitRadius: 0.42 },
  cross: { telegraph: 0.74, strike: 0.17, recover: 0.55, damage: 10, hitRadius: 0.45 },
  hook: { telegraph: 0.7, strike: 0.2, recover: 0.5, damage: 12, hitRadius: 0.45 },
  uppercut: { telegraph: 0.74, strike: 0.18, recover: 0.55, damage: 13, hitRadius: 0.45 },
  overhand: { telegraph: 0.88, strike: 0.22, recover: 0.6, damage: 14, hitRadius: 0.48 },
  backfist: { telegraph: 0.9, strike: 0.34, recover: 0.6, damage: 15, hitRadius: 0.5 },
  roundhouse: { telegraph: 0.86, strike: 0.26, recover: 0.65, damage: 14, hitRadius: 0.5 },
  spinkick: { telegraph: 0.98, strike: 0.36, recover: 0.72, damage: 17, hitRadius: 0.55 },
  clap: { telegraph: 1.0, strike: 0.22, recover: 0.62, damage: 16, hitRadius: 0.52 },
};

/** Gel look. Colours are linear-ish hex fed straight into the shader. */
export const GEL_LOOK = {
  /** Shallow (thin-edge) tint — backlit lime. */
  shallowColor: 0x8cff70,
  /** Deep-body tint — dark bottle-green. */
  deepColor: 0x14602f,
  /** Inner nucleus glow — the denser "organ" slime in the middle. */
  nucleusColor: 0x36e05a,
  /** Eye flash colour during an attack telegraph. */
  telegraphColor: 0xffb03a,
  /** Raymarch step cap (the single biggest perf knob on Quest). */
  maxSteps: 22,
  /** Surface wobble amplitude at rest / when agitated. The agitated figure is
   *  turned up so a fresh hit sets the whole surface roiling. */
  wobble: 0.010,
  wobbleAgitated: 0.044,
};

/**
 * RAYMARCH — how the gel shader walks a ray to the surface. Pure performance
 * and robustness; none of it changes what the creature looks like except at
 * the very edge of the silhouette.
 *
 * The numbers come from replaying the shader's marcher on the CPU against a
 * 900-step ground-truth trace, over every attack silhouette the boss can
 * strike (jab / cross / uppercut / backfist / clap, telegraph and strike) x
 * five player vantage points x both step budgets.
 */
export const MARCH = {
  /**
   * Over-relaxation factor for the sphere trace (1 = plain full-distance
   * steps). A grazing ray — one skimming the underside of a raised fist —
   * creeps in ever-smaller steps and used to run its budget dry BEFORE
   * reaching the torso behind, which the shader then discarded: a hole
   * straight through the body. Stepping 1.2x the safe distance (backtracking
   * the one time it overshoots) clears a graze in a handful of steps.
   */
  omega: 1.2,
  /**
   * How far the surface-hit tolerance opens up by the LAST step of the
   * budget (metres, creature-native). Ramped cubically, so an early hit keeps
   * its exact silhouette and only a ray that is about to give up settles for
   * "close enough".
   */
  graze: 0.012,
  /**
   * Last-resort: a ray that spends its whole budget without ever leaving the
   * gel's neighbourhood shades its closest approach if it got within this.
   * The old shader applied a flat 0.09 to any ray that merely ran out of
   * steps, which fattened the whole silhouette by ~15%; gating it on "never
   * left the gel" lets this be tighter AND catch more.
   */
  mercy: 0.06,
  /**
   * How far each blob sphere is inflated for the march's bounding interval.
   * It has to contain everything the raw spheres don't: the chained
   * smooth-min bulges the isosurface outward wherever blobs fuse (measured at
   * up to 0.5x the blend width across the boss's poses) and the wobble adds
   * its full amplitude on top. Anything under-sized slices the webbing
   * between limbs clean off, so this keeps ~20% headroom over the worst
   * measured reach.
   */
  pad: (blend: number): number => blend * 0.55 + GEL_LOOK.wobbleAgitated + 0.02,
};
