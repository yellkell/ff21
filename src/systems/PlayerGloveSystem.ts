/**
 * Your boxing gloves: an articulated steel hand locked to each controller
 * grip wherever you are in the arena — bout, training, the menus and the
 * terrace alike — wearing your skin and YOUR PAINT (avatar/paint.ts, part
 * 'hand'). The fists are aimed along the controller's POINTING ray (not the
 * tilted grip pose, which left the knuckles facing the ceiling), so in the
 * menus the laser leaves from the knuckles, and their LEDs flare while you
 * squeeze trigger or grip. The moulded controller models are never drawn:
 * the hands ARE the controllers. Tracked hands are your actual hands, so a
 * steel one only shows over a controller.
 *
 * THE FINGERS ARE SPRUNG (avatar/handDriver.ts — the same hand every
 * other steel hand runs, so a grab or a finger gun is one gesture
 * everywhere):
 *
 *   READY TO CATCH  while your ball homes in, the hand opens and splays to
 *                   meet it, wider the nearer it gets…
 *   CATCH           …and snaps shut the instant it lands, with a flash.
 *   FINGER GUN      grip held, index finger OFF the trigger, thumb up for
 *                   the hammer and down and the hand kicks. A gesture —
 *                   no sparks, no buzz, and the ball doesn't care.
 *
 * All of it is local — what other headsets see of your hands is still the
 * two analogue reads (setHandGrip) over the wire.
 */

import { createSystem } from '@iwsdk/core';
import { Quaternion, Vector3, type Group } from 'three';
import { setGloveLit } from '../avatar/boxer.js';
import { applyGear } from '../avatar/gear.js';
import { readHand, SprungHand, type HandInput } from '../avatar/handDriver.js';
import { buildHand, HAND_ADDUCTION, setHandPose } from '../avatar/hands.js';
import { applyLook, myLook } from '../avatar/paint.js';
import { applyAvatarSkin } from '../avatar/skins.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { myAvatarSkin, myGear, myTone } from '../menu/customization.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

const _gripQ = new Quaternion();
const _rayQ = new Quaternion();
const _kickQ = new Quaternion();
const _ballPos = new Vector3();
const _handPos = new Vector3();
const UP = new Vector3(0, 1, 0);

/** Recall: the hand starts opening when its ball is this close (m)… */
const CATCH_REACH = 1.6;

interface HandState {
  hand: SprungHand;
  input: HandInput;
  /** Seconds left on the catch flash. */
  flash: number;
  wasReturning: boolean;
}

function newState(): HandState {
  return {
    hand: new SprungHand(),
    input: { trig: 0, sq: 0, trigTouch: true, thumbDown: true },
    flash: 0,
    wasReturning: false,
  };
}

export class PlayerGloveSystem extends createSystem({
  balls: { required: [Fireball] },
}) {
  private gloves: Partial<Record<Hand, Group>> = {};

  /**
   * Your hands ARE the controllers, menus included: the moulded controller
   * models never draw. Done by UNPARENTING, not by `visible` — IWSDK's input
   * manager writes `visual.model.visible` every frame, so a flag set here
   * never sticks (the rave learned this first: rave/systems/PlayerSystem.ts).
   * Re-checked every frame, as a controller that reconnects rebuilds its
   * visual and hangs it back in the rig.
   */
  private hideControllers(): void {
    const pads = this.input?.xr?.visualAdapters?.controller;
    if (!pads) return;
    for (const hand of HANDS) pads[hand]?.visual?.model?.removeFromParent();
  }
  private states: Record<Hand, HandState> = { left: newState(), right: newState() };

  /** This hand's bound ball, if it's homing back to it. */
  private returningBall(hand: 0 | 1): { pos: Vector3 } | null {
    for (const e of this.queries.balls.entities) {
      if (
        (e.getValue(Fireball, 'owner') ?? 0) === 0 &&
        (e.getValue(Fireball, 'hand') ?? 0) === hand &&
        (e.getValue(Fireball, 'transient') ?? 0) === 0
      ) {
        if ((e.getValue(Fireball, 'state') ?? 0) !== BallState.Returning || !e.object3D) return null;
        e.object3D.getWorldPosition(_ballPos);
        return { pos: _ballPos };
      }
    }
    return null;
  }

  update(delta: number): void {
    this.hideControllers();
    const dt = Math.min(delta, 0.05);
    for (const hand of HANDS) {
      const grip = this.world.playerSpaceEntities.gripSpaces[hand]?.object3D;
      if (!grip) continue;
      const side = hand === 'left' ? 1 : -1;

      let glove = this.gloves[hand];
      if (!glove) {
        glove = buildHand(side);
        glove.name = `player-glove-${hand}`;
        applyAvatarSkin(glove, myAvatarSkin());
        // Dressed the moment it exists: a hand is built at the bell, long
        // after the locker last repainted anything, so it bakes its own
        // GEAR and look here — gear first, as fresh gear is a fresh paint
        // surface. (MenuSystem keeps it in step from then on — it finds
        // both hands by name whenever the look, the skin or the gear
        // moves.) Without the gear here, CUFFS bought in the store went on
        // the mirror and on your rival's view of you, and never on the
        // hands in front of your own face.
        applyGear(glove, myGear(), myTone());
        applyLook(glove, myLook());
        grip.add(glove);
        this.gloves[hand] = glove;
      }
      // A tracked hand is your real hand — no steel one over it.
      const show = !this.input.xr.isPrimary('hand', hand);
      glove.visible = show;
      if (!show) continue;
      const st = this.states[hand];

      // --- the controller's reads --------------------------------------
      const input = readHand(this.input.xr.gamepads[hand], st.input);
      const { trig, sq } = input;
      const fist = Math.max(trig, sq);

      // --- ready to catch: open and splay as the ball closes in ----------
      const ball = this.returningBall(hand === 'left' ? 0 : 1);
      const returning = ball !== null;
      input.open = 0;
      if (returning && fist < 0.5) {
        glove.getWorldPosition(_handPos);
        const near = 1 - Math.min(1, _handPos.distanceTo(ball.pos) / CATCH_REACH);
        input.open = Math.min(1, near * 1.4);
      }

      // --- the catch: snap shut, flash -----------------------------------
      if (st.wasReturning && !returning) {
        st.hand.snapShut();
        st.flash = 0.18;
      }
      st.wasReturning = returning;

      // --- spring everything toward its target, and BANG -----------------
      st.hand.step(input, dt);
      setHandPose(glove, st.hand.pose);

      // --- aim: knuckles down the pointing ray ---------------------------
      // Cancel the grip tilt, take the ray's orientation (the glove model
      // punches along its local -Z). The gun's kick lifts the muzzle — the
      // thumb side is up in this grip, which is +x on the left hand and
      // −x on the right (the rig mirrors it).
      const ray = this.world.playerSpaceEntities.raySpaces[hand]?.object3D;
      if (ray) {
        grip.getWorldQuaternion(_gripQ);
        ray.getWorldQuaternion(_rayQ);
        glove.quaternion.copy(_gripQ).invert().multiply(_rayQ).multiply(HAND_ADDUCTION[hand === 'left' ? 0 : 1]);
        if (Math.abs(st.hand.kick) > 1e-4) {
          glove.quaternion.multiply(_kickQ.setFromAxisAngle(UP, -side * st.hand.kick * 0.06));
        }
      }

      // --- the bloom ----------------------------------------------------
      // Trigger and grip are one action — either one ignites the fist. The
      // white bloom also stays hot through a RETURN: a tapped recall keeps
      // the hand visibly active until the ball is back in it, and a catch
      // flares it.
      const squeezing = trig > 0.5 || sq > 0.5;
      st.flash = Math.max(0, st.flash - dt);
      setGloveLit(glove, squeezing || returning || st.flash > 0, delta * (st.flash > 0 ? 2.5 : 1));
    }
  }
}
