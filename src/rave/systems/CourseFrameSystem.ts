/**
 * CourseFrameSystem — the frame of reference, and the whole reason the door
 * exists.
 *
 * Every locomotion scheme answers one question: who owns the transform
 * between the player's real floor and the virtual world, and when may it
 * change? The club never moves it (teleport jumps it and hands it straight
 * back); the raid refuses to move it at all — my platform IS the world
 * origin. Out here it moves CONSTANTLY, and it belongs to whatever you are
 * standing on:
 *
 *     rig = anchor(tracked)
 *
 * One platform is tracked at a time. While it is tracked it is static
 * relative to your real floor, and the slice of virtual space your play area
 * maps to rides with it. Handover is GATED and CLEAN ONLY: tracking passes
 * to a platform exactly when its anchor already agrees with the live rig, so
 * the instant of the switch moves nothing at all (research/03 §2.3).
 *
 * What is deliberately absent is the sliding part. The movement repo's
 * earlier build carried Johansen's forced switch, where ground already
 * leaving takes the frame with it and a correction term drains over a
 * second — visibly sliding the platform back into place under your feet.
 * That slide is the one moment the world moves on its own, and it reads as
 * the game correcting you. Here the score authors every legal step onto
 * aligned ground, so the only way to be on departing un-tracked ground is to
 * have missed the step — and a miss should read as a miss. It is a SLIP: the
 * ground pulls away, the frame holds, the flow dies, the thud lands. The rig
 * has exactly one source of truth and no history.
 */

import { createSystem } from '@iwsdk/core';
import { COURSE_ORIGIN, GRID, RIG, SLIP_FLASH } from '../course/config.js';
import { conductor } from '../course/conductor.js';
import { anchorAt, PLATFORMS, sqOffset, v3 } from '../course/score.js';
import { course, G, platformSoundAt } from '../course/state.js';

export class CourseFrameSystem extends createSystem({}) {
  private candidate = -1;
  private candidateFrames = 0;
  private slipped = -1; // platform already charged for this departure
  private look = v3(0, 0, 0);
  private lookRig = v3(0, 0, 0);

  update(): void {
    if (!course.active) return;
    const rig = G.rig;
    const tracked = G.platforms[G.tracked];
    rig.x = tracked.anchor.x;
    rig.y = tracked.anchor.y;
    rig.z = tracked.anchor.z;
    // The course is built a storey under the club, so the rig the score
    // computes is course-local and the origin is added on the way out.
    this.player.position.set(
      rig.x + COURSE_ORIGIN.x,
      rig.y + COURSE_ORIGIN.y,
      rig.z + COURSE_ORIGIN.z,
    );

    // Alignment against the live rig, for every platform: may it take
    // tracking?
    for (const st of G.platforms) {
      st.aligned =
        Math.hypot(st.anchor.x - rig.x, st.anchor.z - rig.z) < RIG.alignEps &&
        Math.abs(st.anchor.y - rig.y) < RIG.alignEpsY;
    }

    // Whose tile owns the head? Tiles live where platforms actually are —
    // (anchor − rig) + claimed-square offset, in play-area coordinates.
    const hx = G.body.x;
    const hz = G.body.z;
    let owner = -1;
    let ownerDist = Infinity;
    for (let i = 0; i < PLATFORMS.length; i++) {
      const st = G.platforms[i];
      if (Math.abs(st.anchor.y - rig.y) > 1.2) continue; // a storey away is not ground
      const half = GRID.tile / 2 + (i === G.tracked ? RIG.trackedOutset : -RIG.tileInset);
      const ox = st.anchor.x - rig.x;
      const oz = st.anchor.z - rig.z;
      for (const sq of PLATFORMS[i].claim) {
        const o = sqOffset(sq);
        const dx = hx - (ox + o.x);
        const dz = hz - (oz + o.z);
        if (Math.abs(dx) <= half && Math.abs(dz) <= half) {
          const d = dx * dx + dz * dz;
          if (i === G.tracked) {
            owner = i;
            ownerDist = -1; // the tracked platform always wins its skirt
          } else if (ownerDist >= 0 && d < ownerDist) {
            owner = i;
            ownerDist = d;
          }
        }
      }
    }

    if (owner !== this.slipped) this.slipped = -1;

    if (owner === G.tracked || owner === -1) {
      // Standing your ground, or out over a seam: the frame holds.
      this.candidate = -1;
      this.candidateFrames = 0;
      return;
    }

    // Debounce ownership so a toe on the border can't thrash tracking.
    if (owner === this.candidate) this.candidateFrames++;
    else {
      this.candidate = owner;
      this.candidateFrames = 1;
    }
    if (this.candidateFrames < 3) return;

    const cand = G.platforms[owner];
    if (cand.aligned) {
      // Clean handover: the anchors agree, so the rig does not move.
      G.tracked = owner;
      G.handovers++;
      G.flow++;
      conductor.chime(G.flow, platformSoundAt(owner));
      this.candidate = -1;
      this.candidateFrames = 0;
      return;
    }

    // Unaligned ground under the feet. Incoming or leaving? Look a quarter
    // bar ahead. Either way THE FRAME HOLDS — incoming ground stays gated,
    // and leaving ground no longer drags the world: it slides out from
    // under you, and that is the slip.
    //
    // BOTH ends of that gap move. Looking ahead at the candidate alone was
    // wrong for STATIC ground: a landing deck's anchor never changes, so
    // `soon` came out identical to `now` and a body standing on the deck it
    // was riding INTO — a step taken a beat early, which is a step a player
    // should be allowed — was charged a slip for it. The rig follows the
    // tracked platform, so the closing has to be measured against where the
    // rig will be, not where it is.
    const now =
      Math.hypot(cand.anchor.x - rig.x, cand.anchor.z - rig.z) + Math.abs(cand.anchor.y - rig.y);
    const ahead = G.transport.bars + 0.25;
    anchorAt(PLATFORMS[owner], ahead, this.look);
    anchorAt(PLATFORMS[G.tracked], ahead, this.lookRig);
    const soon =
      Math.hypot(this.look.x - this.lookRig.x, this.look.z - this.lookRig.z) +
      Math.abs(this.look.y - this.lookRig.y);
    if (soon < now) return; // incoming: gated, no switch yet

    if (this.slipped !== owner) {
      this.slipped = owner;
      G.slips++;
      G.flow = 0;
      G.slipAt = owner;
      G.slipFlash = SLIP_FLASH;
      conductor.thud(platformSoundAt(owner));
    }
  }
}
