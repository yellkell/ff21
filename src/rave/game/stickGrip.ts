/**
 * THE GRIP — a steel hand closed round a glowstick.
 *
 * Through a set your hands are the quick match's steel hands (avatar/
 * hands.ts) holding the sticks, not a pair of sticks floating where the
 * controllers were. The stick still leads — it hangs off the pointing ray
 * and keeps its tilt, shake and pour (rave/systems/PlayerSystem.ts) — and
 * the hand is fitted to it every frame: turned thumb-side up along the
 * stick's axis (HAND_ADDUCTION, the same turn a fight's fist takes round a
 * controller), and slid so the fist's bore sits on the tube.
 *
 * Pure — no system, no world — so grip-preview.html can pose the same hand
 * round the same stick for screenshots.
 */

import { Vector3, type Group, type Object3D } from 'three';
import { HAND_ADDUCTION, HAND_VISUAL_SCALE, type HandPose } from '../../avatar/hands.js';

/** Where the closed fist's bore runs, in the hand's own (unscaled) space:
 *  under the palm (−Y), just behind the knuckle line (−Z). The bore's axis
 *  is the hand's X — index to pinky — which HAND_ADDUCTION stands up. */
export const GRIP_BORE = new Vector3(0, -0.03, -0.034);

/** How far down the stick's axis the fist closes, from the tube's centre
 *  (metres, the stick's own space): low on the tube, so most of the light
 *  stands up out of the top of the fist. */
export const GRIP_ALONG = -0.075;

/** The closed hand: fingers wrapped round a 46 mm cased tube, not a full
 *  fist (that drives them through it), the thumb laid over the top. */
export const GRIP_POSE: HandPose = {
  curl: [0.74, 0.8, 0.84, 0.88],
  spread: 0,
  thumb: 0.62,
  thumbUp: 0,
};

const _bore = new Vector3();

/**
 * Fit `glove` round `stick`. Both must hang off the same parent (the ray
 * space): the hand takes the stick's turn and the fist's bore lands on its
 * axis. `side` 0 = left, 1 = right.
 */
export function gripStick(glove: Group, stick: Object3D, side: 0 | 1, centreY: number): void {
  glove.quaternion.copy(stick.quaternion).multiply(HAND_ADDUCTION[side]);
  _bore.copy(GRIP_BORE).multiplyScalar(HAND_VISUAL_SCALE).applyQuaternion(glove.quaternion);
  glove.position
    .set(0, centreY + GRIP_ALONG, 0)
    .applyQuaternion(stick.quaternion)
    .add(stick.position)
    .sub(_bore);
}
