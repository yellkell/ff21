/**
 * THE STAGE, HELD — is the fight's ground in front of you yet?
 *
 * Picking a bout flips app.state at once, but on a sited backdrop (NEON's
 * backstreet → plaza, the desert's trailhead → flats) you're still standing
 * in the lobby while the curtain comes down over it (systems/DesertSystem).
 * Anything with an opening ceremony — a titan's klaxon and entrance, the
 * 3-2-1 — asks here first, and keeps its clock at zero until the black
 * starts lifting on the new place, so the whole show plays where you can
 * see it.
 *
 * A function, not a flag: the asker may run earlier in the frame than the
 * crossing does, on the very frame the state flipped, and must still get
 * this frame's answer.
 */

let probe: () => boolean = () => false;

/** DesertSystem installs the live answer. */
export function setStageGate(fn: () => boolean): void {
  probe = fn;
}

/** True while a match is up but you haven't arrived at its ground. */
export function stageHeld(): boolean {
  return probe();
}
