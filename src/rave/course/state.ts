/**
 * The course's own state. One mutable singleton, the house pattern
 * (game/state.ts): systems are the only writers of their own fields,
 * everyone may read.
 *
 * `course` is the bit the CLUB cares about — while `active` is true the hall
 * is not the room you're in, so every club system stands down and the rig
 * belongs to the frame of reference out on the circuit.
 */

import { COURSE_ORIGIN } from './config.js';

export interface PlatformState {
  anchor: { x: number; y: number; z: number };
  moving: boolean;
  departIn: number; // bars until this dwell ends (Infinity when static/moving)
  aligned: boolean; // anchor within alignEps of the live rig
}

/** Where the crossing is up to. `in`/`out` are the black; the club and the
 *  void swap under it, never in front of you. */
export type CoursePhase = 'off' | 'in' | 'riding' | 'out' | 'back';

export const course = {
  phase: 'off' as CoursePhase,
  /** THE COURSE OWNS THE ROOM. The club's systems all read this. */
  active: false,
  /** 0 = clear, 1 = full black (the crossing's own curtain). */
  fade: 0,
  /** Where in the club to put you down when you come back out. */
  exit: { x: 0, z: 0, yaw: 0 },
  /** Laps closed, all night — the door keeps a tally worth walking back for. */
  laps: 0,
  /** Have you ever been through? (The panel says more the first time.) */
  visited: false,
  /** The real room measured short of the 2 × 2 m the circuit is authored
   *  for — the void says so on a panel rather than quietly rescaling. */
  roomWarn: null as { w: number; d: number } | null,
};

export const G = {
  transport: {
    bars: 0, // continuous bar time since the crossing
    barPhase: 0,
    beat: 0, // integer beat within bar
  },
  rig: { x: 0, y: 0, z: 0 }, // pose of the play-area origin, course-local (yaw always 0)
  tracked: 0, // platform index that owns the frame of reference
  handovers: 0,
  slips: 0, // departures stood through — the miss that replaced the slide
  body: { x: 0, y: 1.7, z: 0 }, // head in play-area coordinates
  platforms: [] as PlatformState[],
  wayfind: {
    targetIndex: -1,
    targetAligned: false,
    /** 0 on the way out … 1 stepping home: how lit THE GATE is. */
    homeward: 0,
  }, // route-next platform
  /** Clean steps in a row. It buys nothing but light — which is the point. */
  flow: 0,
  energy: 0.8,
  /** The ground you own is counting itself out: the void ducks for it. */
  groundLeaving: false,
  /** The deck that just left without you, and how long its burn has to
   *  run. A miss is audible (the thud) and now visible: the ground that
   *  went flares red where it went. */
  slipAt: -1,
  slipFlash: 0,
  ghosts: false, // the authoring overlay toggle
};

/** Wipe the ride back to the start line. Called every time the door opens. */
export function resetRide(): void {
  G.transport.bars = 0;
  G.transport.barPhase = 0;
  G.transport.beat = 0;
  G.tracked = 0;
  G.handovers = 0;
  G.slips = 0;
  G.flow = 0;
  G.energy = 0.8;
  G.groundLeaving = false;
  G.slipAt = -1;
  G.slipFlash = 0;
  G.wayfind.targetIndex = -1;
  G.wayfind.targetAligned = false;
  G.wayfind.homeward = 0;
}

/**
 * A platform's position in WORLD terms, for a sound to come from.
 *
 * Anchors are course-local (the root is parked at COURSE_ORIGIN, 300 m under
 * the club) while the audio listener is glued to the camera in world space, so
 * a panner handed a raw anchor would sit a fixed 300 m below the ear and be
 * silent. One conversion, in one place, so no call site has to remember it.
 */
export function platformSoundAt(index: number): { x: number; y: number; z: number } | undefined {
  const a = G.platforms[index]?.anchor;
  if (!a) return undefined;
  return { x: a.x + COURSE_ORIGIN.x, y: a.y + COURSE_ORIGIN.y, z: a.z + COURSE_ORIGIN.z };
}
