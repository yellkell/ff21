/**
 * THE COURSE — every tunable for VOIDSTEP, the movement course behind the
 * club's west door.
 *
 * The grammar is the `movement` repo's (stepwell's Eye-of-the-Temple frame
 * of reference on a rhythm grid, simplified so nothing ever slides under
 * your feet). What did NOT come across is the attack vocabulary: the moves
 * are RAVE RAID's, they belong to the raid, and a course that throws beams
 * at you is a second raid rather than a second GAME. Out there the floor
 * is the only thing trying anything, and the only verb is the step.
 *
 * Numbers with a research pedigree cite their source note in the movement
 * repo's `research/`.
 */

export const GRID = {
  // Eye of the Temple's 3×3 grid over a 2×2 m play area (research/03 §2.2).
  pitch: 0.66,
  tile: 0.6, // deck tile edge; the 6 cm gap is the visual seam between squares
};

export const RIG = {
  // Handover is gated, not immediate (research/03 §2.3): a platform may take
  // tracking only when its anchor sits within alignEps of the live rig.
  // That is the WHOLE law. Ground already leaving never forces a switch and
  // never drags the world back into place under you — standing on departing
  // un-tracked ground is a SLIP, and a miss reads as a miss.
  alignEps: 0.025,
  alignEpsY: 0.04,
  // A tile owns the head only when the head is clearly inside it; the tracked
  // tile keeps a wider skirt so ownership can't flicker on the border.
  tileInset: 0.05,
  trackedOutset: 0.09,
};

export const MUSIC = {
  bpm: 128, // VOIDSTEP 2: two-bar dwells and two-bar rides want a tempo with snap
  beatsPerBar: 4,
};

export const COLOR = {
  deckTop: 0x262433, // gunmetal under the etch — dark enough that the traces own the face
  /** Docked ground you may step on. A TRUER BLUE than the club's cyan:
   *  out here the ground is the only thing that speaks, and it should not
   *  be saying it in the same voice as the hall's neon. Kept deep on
   *  purpose — every layer that wears it is ADDITIVE, and additive light
   *  clamps the blue channel first, so a paler blue turns back into cyan
   *  the moment the beat brightens it. */
  rimSafe: 0x2a62ff,
  /** Ground counting itself out — the amber half of the club's own
   *  amber→red telegraph language. */
  rimWarn: 0xffaa22,
  /** Ground IN MOTION, and the burn of a missed step. Red means the same
   *  thing here it means in a set: do not be on this. Ground that is
   *  travelling cannot be boarded — the handover gate refuses it — so a
   *  moving deck that looked as safe as a docked one would be a hazard you
   *  can't see, which is the one thing the floor is never allowed to be. */
  rimDanger: 0xff2244,
  // Fences whisper; rims speak (research/03 §2.4).
  fence: 0x33304e,
};

/** How long a missed step burns the deck that left without you. */
export const SLIP_FLASH = 0.5;

export const ENERGY = {
  // The void ducks while the ground you own is counting itself out, and
  // blooms as the ride stays clean. Danger never competes with scenery
  // (research/02 §6) — the club's own energy law, and out here the only
  // danger is the floor leaving.
  base: 0.8,
  ducked: 0.42,
  /** A missed step takes the room down with it for the length of the burn. */
  slipped: 0.18,
  flowBonus: 0.03,
  ease: 2.2, // 1/s toward target
};

export const PLAY_AREA = {
  // Fixed minimum, never adapted (research/03 §1, §8.4).
  //
  // 1.8 m is the floor you have to be able to STAND on, not the width of
  // the decks: the grid's outer tiles are centred at ±0.66 and are 0.6
  // across, so the ground spans 1.92 m — but every step the circuit asks
  // for lands you on a tile CENTRE, and 1.8 leaves a quarter of a metre of
  // real room beyond the furthest of them in each direction.
  requiredWidth: 1.8,
  requiredDepth: 1.8,
};

export const COUNTDOWN = {
  postIdle: 0.07,
  postWarn: 0.34,
  postSize: 0.05,
};

export const WAYFIND = {
  breathBars: 1,
  berthPulse: 0.35,
};

/** The circuit's ceiling — how high the skywalk rides. The drone root climbs
 *  +7 semitones over this span (research/01 §6, inverse locomotion's audio
 *  cousin, played the other way up). */
export const CLIMB = {
  top: 3.8,
};

/**
 * WHERE THE COURSE IS. The club and the void are both built in world space
 * and they would sit inside one another; a whole storey of nothing between
 * them costs no draw calls and buys the two places their own air. The door
 * is not a trick of the light — it really is somewhere else.
 */
export const COURSE_ORIGIN = { x: 0, y: -300, z: 0 };

/** How long the black holds while you cross (seconds each way). */
export const PHASE = {
  fadeOut: 0.42,
  fadeIn: 0.55,
};
