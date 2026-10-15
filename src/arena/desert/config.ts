/**
 * Papercraft western desert — art-direction knobs. Ported from the `vrenv`
 * Paper Frontier project (yellkell/vrenv, claude/papercraft-desert): a low-sun
 * desert of folded-paper dunes, layered mesas, saguaro cacti and rolling
 * tumbleweeds, dropped in behind FIRE FIGHT's platforms as an optional arena.
 *
 * Almost every "feeling" of the scene is a number in here.
 */

export const CONFIG = {
  /** Overall art direction — DESERT 2.0: golden hour dying into night
   *  (DESIGN.md §6.1). Darker, richer, the arena the brightest thing for
   *  miles; same sign, same skull, same tumbleweeds. */
  mood: {
    /** Sun height: 0 = on the horizon (long shadows), 1 = overhead. */
    sunElevation: 0.045,
    exposure: 0.86,
    haze: 0.55,
    viewDistance: 1500,
  },

  /** AERIAL PERSPECTIVE (haze.ts): the far layer — sand, mesas, boulders —
   *  melts toward the sky band with distance, hot toward the sun and cool
   *  away from it. `near`/`far` in metres bound the ramp, `max` is how much
   *  of the band a thing at `far` becomes, and `lift` is the height (m) at
   *  which the haze has thinned to under half — so the skyline's caps keep
   *  their edge while their feet sit in the dust. */
  haze: {
    near: 28,
    far: 150,
    max: 0.9,
    lift: 48,
  },

  /** The dusk sky (the inward-facing dome): a blood-orange band dying on
   *  one horizon, deep violet overhead, early stars above it. */
  sky: {
    top: '#131b34', // deep violet-navy — night arriving overhead
    horizon: '#d95f2b', // the blood-orange band where the sun is dying
    dusk: '#5b3648', // the horizon AWAY from the sun: dusty mauve, night's side
    bottom: '#3c2029', // dark earth glow below the horizon
    intensity: 1.0,
  },

  /** Image-based lighting tint — the last warm light, over cooling ground. */
  ibl: {
    sky: '#d98a5c',
    ground: '#241b26',
    intensity: 0.62,
  },

  /** The dusk palette: everything a step darker and richer, the pale
   *  things (bone, dust) left bright so they CATCH the dying light. */
  palette: {
    sandLight: '#a9805c',
    sandDark: '#5a3b2f',
    /** Scree at a mesa's foot — the apron the cliff stands on. */
    scree: '#4e2e23',
    sun: '#ff7c38',
    rockStrata: ['#73382a', '#9b5a3c', '#b4744d', '#6a3025', '#8a4a35', '#a8664a'],
    boulder: ['#8a5236', '#74432c', '#9a7a55', '#7d6a58', '#a06a48'],
    cactus: '#5f8a4c',
    cactusDark: '#4a6e3c',
    flower: '#b04c62',
    tumbleweed: ['#7c6339', '#69512c', '#8f774f'],
    wood: '#5c3820',
    bone: '#e8ddc4',
    agave: '#5c7346',
    cloud: '#6b4038', // underlit from the horizon, dark against the violet
    dust: ['#8a6f4e', '#77603f', '#816d4c'],
    bird: '#0b0a10', // near-black; rendered unlit so it reads as a silhouette
  },

  /** Early stars, thickening away from the horizon band. */
  stars: {
    count: 420,
    minElevation: 0.14, // none in the orange band
    radius: 780, // just inside the 800 sky dome
  },

  /** The folded-paper ground. */
  terrain: {
    seed: 23,
    size: 240, // width of the desert (meters)
    segments: 128, // vertex density (smooth dunes want more to roll over)
    duneHeight: 4.2,
    flatRadius: 14, // level clearing around the platforms
    platformReveal: 0.14, // lower the clearing so the platform slabs read as raised
  },

  /** Scattered boulders + the big horizon mesas. */
  rocks: {
    /** Boulders come in clusters — a block and its fallen pieces — from
     *  `variants` cleaved shapes (one instanced draw each). */
    clusters: 26,
    variants: 4,
    mesas: 7,
    /** Buttes and spires between the mesas — the remnants the wind left
     *  when it took the rest of the table. Narrower, some taller. */
    buttes: 5,
    mesaRingMin: 78,
    mesaRingMax: 112,
  },

  /** Cacti. */
  cacti: {
    saguaro: 11,
    barrel: 8,
    pricklyPear: 7,
    clearRadius: 9, // keep clear of the platforms
  },

  /** Rolling plants — wind blows them mostly along +X. */
  tumbleweeds: {
    count: 9,
    windSpeed: 2.6,
    radius: 0.55,
  },

  /** Splayed agave rosettes that sway in the wind near the clearing. */
  agave: {
    count: 15,
    clearRadius: 7,
    spread: 46, // kept mid-ground so distant sand stays clean
  },

  /** Slow paper clouds drifting above the mesas. */
  clouds: {
    count: 6,
    heightMin: 36,
    heightMax: 58,
    spread: 110,
    drift: 0.55, // base x-speed (m/s)
  },

  /** Occasional dust devils that spin up, wander and dissipate. */
  dustDevils: {
    maxActive: 2,
    firstAt: 9, // seconds after the desert first shows
    intervalMin: 16,
    intervalMax: 30,
    fieldHalf: 92,
  },

  /**
   * Vulture-like birds circling high and far off, surveying their territory.
   * Kept few, small, distant and spread around the compass so you only catch
   * one now and then if you look up — never the whole flock at once.
   */
  vultures: {
    count: 3,
    wingspan: 4.8,
    centerMin: 95, // orbit-centre distance from the arena
    centerMax: 165,
    radiusMin: 26, // how wide each lazy loop is
    radiusMax: 46,
    heightMin: 46, // soaring altitude
    heightMax: 80,
    omegaMin: 0.05, // angular speed (rad/s) — a slow loop is ~1–2 minutes
    omegaMax: 0.1,
    bank: 0.34, // roll into the turn (rad)
    bobAmp: 4.5, // gentle vertical drift on the thermals (m)
    // Each bird soars for a spell, glides down out of sight to rest, then
    // climbs back up. Staggered per bird so the sky thins and refills rather
    // than emptying all at once — you won't always have one overhead.
    soarMin: 28, // seconds aloft before going to rest
    soarMax: 55,
    restMin: 30, // seconds perched out of sight
    restMax: 64,
    glide: 7, // seconds to spiral down to rest / climb back up
  },
} as const;
