/**
 * DANCE STANCES — the GOOPLIATH's pose vocabulary, written for the club.
 *
 * The FIRE FIGHT styles this replaces were boxing guards: subtle weight
 * shifts a fight-reader could parse. A dancefloor needs SILHOUETTES — poses
 * you can name from across the ring while four metres of gel snaps between
 * them on the bar. Same mechanism as the fight styles (per-anchor deltas
 * over the BOXER pose, eased by GelCreature.styleEase), much bigger shapes.
 *
 * Deltas are creature-local metres at man-scale; the parent group scales
 * them to boss size. The creature faces +Z (toward whoever's watching), so
 * −z pulls a fist back toward the body, +y throws it skyward.
 *
 * Radius scales matter as much as offsets: a pointing fist swells 1.3× so
 * the gesture reads as a gesture, not a stray blob.
 */

import { A } from '../../goopliath/poses.js';
import type { StylePoseDelta } from '../../goopliath/styles.js';

export interface DanceStance {
  name: string;
  pose: ReadonlyArray<StylePoseDelta>;
}

/** Saturday-night point: right fist to the sky, left on the hip, hips
 *  thrown the other way. The classic. */
const POINT_R: DanceStance = {
  name: 'point-r',
  pose: [
    [A.FIST_R, 0.12, 0.95, -0.28, 1.3],
    [A.ELBOW_R, 0.04, 0.56, -0.14, 1.05],
    [A.SHOULDER_R, 0.03, 0.14, -0.02, 1.08],
    [A.FIST_L, 0.03, -0.44, -0.24, 1.05],
    [A.ELBOW_L, -0.08, -0.2, -0.12, 1.0],
    [A.HEAD, -0.05, 0.03, 0, 1.0],
    [A.NECK, -0.03, 0.02, 0, 1.0],
    [A.CHEST_L, -0.05, 0.01, 0, 1.0],
    [A.CHEST_R, -0.04, 0.01, 0, 1.0],
    [A.BELLY, -0.05, 0, 0, 1.0],
    [A.HIP_L, -0.07, 0, 0, 1.05],
    [A.HIP_R, -0.07, 0, 0, 1.05],
    [A.KNEE_R, 0.03, 0.02, 0.02, 1.0],
  ],
};

/** The mirror. */
const POINT_L: DanceStance = {
  name: 'point-l',
  pose: [
    [A.FIST_L, -0.12, 0.9, -0.32, 1.3],
    [A.ELBOW_L, -0.04, 0.56, -0.14, 1.05],
    [A.SHOULDER_L, -0.03, 0.14, -0.02, 1.08],
    [A.FIST_R, -0.03, -0.4, -0.2, 1.05],
    [A.ELBOW_R, 0.08, -0.2, -0.12, 1.0],
    [A.HEAD, 0.05, 0.03, 0, 1.0],
    [A.NECK, 0.03, 0.02, 0, 1.0],
    [A.CHEST_L, 0.04, 0.01, 0, 1.0],
    [A.CHEST_R, 0.05, 0.01, 0, 1.0],
    [A.BELLY, 0.05, 0, 0, 1.0],
    [A.HIP_L, 0.07, 0, 0, 1.05],
    [A.HIP_R, 0.07, 0, 0, 1.05],
    [A.KNEE_L, -0.03, 0.02, 0.02, 1.0],
  ],
};

/** Both arms thrown high and wide — the crowd-hyping rave Y. */
const RAVE_Y: DanceStance = {
  name: 'rave-y',
  pose: [
    [A.FIST_L, -0.3, 0.76, -0.38, 1.22],
    [A.FIST_R, 0.28, 0.84, -0.34, 1.22],
    [A.ELBOW_L, -0.1, 0.5, -0.16, 1.05],
    [A.ELBOW_R, 0.1, 0.52, -0.16, 1.05],
    [A.SHOULDER_L, -0.04, 0.12, -0.02, 1.05],
    [A.SHOULDER_R, 0.04, 0.12, -0.02, 1.05],
    [A.HEAD, 0, 0.05, -0.05, 1.0],
    [A.CHEST_L, -0.02, 0.05, -0.02, 1.02],
    [A.CHEST_R, 0.02, 0.05, -0.02, 1.02],
    [A.BELLY, 0, 0.03, -0.02, 0.98],
  ],
};

/** Low and wide: knees out, fists pumping at the hips, mass sunk — the
 *  stomp of the drop. */
const FLOOR_STOMP: DanceStance = {
  name: 'floor-stomp',
  pose: [
    [A.HEAD, 0, -0.26, 0.05, 1.02],
    [A.NECK, 0, -0.23, 0.04, 1.04],
    [A.CHEST_L, -0.04, -0.19, 0.03, 1.1],
    [A.CHEST_R, 0.04, -0.19, 0.03, 1.1],
    [A.BELLY, 0, -0.15, 0.02, 1.14],
    [A.PELVIS, 0, -0.12, 0, 1.08],
    [A.SHOULDER_L, -0.07, -0.19, 0.02, 1.1],
    [A.SHOULDER_R, 0.07, -0.19, 0.02, 1.1],
    [A.ELBOW_L, -0.14, -0.24, -0.08, 1.0],
    [A.ELBOW_R, 0.14, -0.24, -0.08, 1.0],
    [A.FIST_L, -0.26, -0.42, -0.26, 1.18],
    [A.FIST_R, 0.24, -0.34, -0.24, 1.18],
    [A.HIP_L, -0.06, -0.1, 0, 1.06],
    [A.HIP_R, 0.06, -0.1, 0, 1.06],
    [A.KNEE_L, -0.08, -0.08, 0.03, 1.12],
    [A.KNEE_R, 0.08, -0.09, 0.03, 1.12],
    [A.BASE_L, -0.1, 0, 0.02, 1.06],
    [A.BASE_R, 0.1, 0, 0.02, 1.06],
  ],
};

/** One fist framing the head, the other slung low across — angular,
 *  chin up, pure vogue. */
const VOGUE: DanceStance = {
  name: 'vogue',
  pose: [
    [A.FIST_L, -0.06, 0.5, -0.3, 1.15],
    [A.ELBOW_L, -0.16, 0.22, -0.16, 1.0],
    [A.SHOULDER_L, -0.04, 0.1, -0.02, 1.04],
    [A.FIST_R, -0.28, -0.32, -0.1, 1.1],
    [A.ELBOW_R, 0.04, -0.14, -0.14, 1.0],
    [A.HEAD, 0.08, 0.05, -0.03, 1.0],
    [A.NECK, 0.05, 0.02, -0.01, 1.0],
    [A.CHEST_L, 0.03, 0.02, 0, 1.0],
    [A.CHEST_R, 0.04, 0.02, 0, 1.0],
    [A.HIP_L, -0.08, 0, 0, 1.05],
    [A.HIP_R, -0.08, 0, 0, 1.05],
    [A.KNEE_R, 0.04, 0.03, 0.04, 1.0],
  ],
};

/** Elbows-up chicken-strut — fists tucked to the chest, elbows flared,
 *  head bobbing forward. The funky one. */
const STRUT: DanceStance = {
  name: 'strut',
  pose: [
    [A.FIST_L, 0.08, -0.06, -0.28, 1.08],
    [A.FIST_R, -0.1, -0.02, -0.26, 1.08],
    [A.ELBOW_L, -0.22, 0.14, -0.1, 1.08],
    [A.ELBOW_R, 0.22, 0.14, -0.1, 1.08],
    [A.SHOULDER_L, -0.05, 0.08, 0, 1.05],
    [A.SHOULDER_R, 0.05, 0.08, 0, 1.05],
    [A.HEAD, 0, -0.04, 0.1, 1.02],
    [A.NECK, 0, -0.03, 0.06, 1.0],
    [A.CHEST_L, -0.02, -0.02, 0.04, 1.04],
    [A.CHEST_R, 0.02, -0.02, 0.04, 1.04],
    [A.BELLY, 0, -0.03, 0.02, 1.06],
  ],
};

/**
 * The bar-to-bar combos: each 4-bar block picks one pair and alternates its
 * two shapes every bar. Pairs are built to OPPOSE (up/down, left/right,
 * tight/wide) so every bar visibly throws the mass somewhere new.
 */
export const DANCE_COMBOS: ReadonlyArray<readonly [DanceStance, DanceStance]> = [
  [POINT_L, POINT_R],
  [RAVE_Y, FLOOR_STOMP],
  [VOGUE, POINT_R],
  [FLOOR_STOMP, STRUT],
  [STRUT, RAVE_Y],
  [POINT_R, FLOOR_STOMP],
];
