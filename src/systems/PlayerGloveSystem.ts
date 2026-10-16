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
 * THE FINGERS ARE SPRUNG, not set: each one chases its target on its own
 * spring, the pinky quickest, so a grab rolls shut little finger first and
 * lands with a hair of overshoot — a squeeze reads as a GRAB, not a switch.
 *
 *   READY TO CATCH  while your ball homes in, the hand opens and splays to
 *                   meet it, wider the nearer it gets…
 *   CATCH           …and snaps shut the instant it lands, with a flash.
 *   FINGER GUN      grip held, index finger OFF the trigger (Quest's
 *                   capacitive touch), and the index points straight down
 *                   the ray. Lift your thumb off the face buttons and it
 *                   stands up like a hammer; bring it down and the gun goes
 *                   BANG: the hammer falls, the hand kicks, sparks spit from
 *                   the muzzle and the controller thumps. Pure show — the
 *                   ball doesn't care.
 *   REST            a finger resting on the trigger rests curled round it;
 *                   a thumb lifted off the buttons lifts on the hand too.
 *
 * All of it is local — what other headsets see of your hands is still the
 * two analogue reads (setHandGrip) over the wire.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Quaternion, Vector3, type Group } from 'three';
import { setGloveLit } from '../avatar/boxer.js';
import { applyGear } from '../avatar/gear.js';
import { buildHand, HAND_ADDUCTION, handIndexTip, INDEX_TIP_LENGTH, setHandPose, type HandPose } from '../avatar/hands.js';
import { applyLook, myLook } from '../avatar/paint.js';
import { applyAvatarSkin } from '../avatar/skins.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { emberBurst } from '../fx/fire.js';
import { pulseHand } from '../input/haptics.js';
import { myAvatarSkin, myGear, myTone } from '../menu/customization.js';

const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

const _gripQ = new Quaternion();
const _rayQ = new Quaternion();
const _kickQ = new Quaternion();
const _ballPos = new Vector3();
const _handPos = new Vector3();
const _tip = new Vector3();
const UP = new Vector3(0, 1, 0);

/** The thumb's touch points: any of them touched = thumb down on the controller. */
const THUMB_PADS = [
  InputComponent.Thumbstick,
  InputComponent.A_Button,
  InputComponent.B_Button,
  InputComponent.X_Button,
  InputComponent.Y_Button,
  InputComponent.Thumbrest,
] as const;

/** Spring stiffness per finger (index first) — the pinky closes first. */
const FINGER_K = [210, 240, 265, 290];
/** Under-damped a touch: a grab lands with a little overshoot. */
const DAMPING = 0.62;
const THUMB_K = 230;
/** Recall: the hand starts opening when its ball is this close (m)… */
const CATCH_REACH = 1.6;

/** One sprung value. */
interface Spring {
  x: number;
  v: number;
}

function spring(s: Spring, target: number, k: number, dt: number): void {
  const c = 2 * DAMPING * Math.sqrt(k);
  // Semi-implicit Euler, sub-stepped: stable at a 72 Hz frame with k ~300.
  const n = dt > 1 / 90 ? 2 : 1;
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    s.v += (k * (target - s.x) - c * s.v) * h;
    s.x += s.v * h;
  }
}

interface HandState {
  curl: Spring[];
  spread: Spring;
  thumb: Spring;
  thumbUp: Spring;
  /** The gun's recoil kick (radians), sprung back to 0. */
  kick: Spring;
  /** Seconds left on the catch flash. */
  flash: number;
  wasReturning: boolean;
  /** The gun's hammer was up last frame (a thumb coming down fires it). */
  cocked: boolean;
  pose: HandPose & { curl: [number, number, number, number] };
}

function newState(): HandState {
  const s = (x = 0): Spring => ({ x, v: 0 });
  return {
    curl: [s(0.25), s(0.3), s(0.3), s(0.3)],
    spread: s(0.2),
    thumb: s(0.45),
    thumbUp: s(0),
    kick: s(0),
    flash: 0,
    wasReturning: false,
    cocked: false,
    pose: { curl: [0, 0, 0, 0], spread: 0, thumb: 0, thumbUp: 0 },
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
      const gp = this.input.xr.gamepads[hand];
      const trig = gp?.getButtonValue(InputComponent.Trigger) ?? 0;
      const sq = gp?.getButtonValue(InputComponent.Squeeze) ?? 0;
      // Touch sensing (Quest's capacitive trigger and face buttons). A pad
      // that can't sense touch reads as touched, so a plain controller
      // never sprouts a finger gun by accident.
      const touchKnown = !!gp;
      const trigTouch = !touchKnown || trig > 0.02 || (gp?.getButtonTouched(InputComponent.Trigger) ?? true);
      let thumbDown = !touchKnown;
      for (const pad of THUMB_PADS) if (gp?.getButtonTouched(pad)) thumbDown = true;

      const ball = this.returningBall(hand === 'left' ? 0 : 1);
      const returning = ball !== null;

      // --- targets -------------------------------------------------------
      const gun = sq > 0.55 && !trigTouch;
      const fist = Math.max(trig, sq);
      const others = Math.max(sq, trig * 0.45);
      // The index: on the trigger it rests round it; off it, it's free.
      let index = Math.max(trig, sq * 0.6);
      if (trigTouch && trig < 0.1) index = Math.max(index, 0.32);
      if (!trigTouch) index = Math.min(index, sq * 0.15);
      const curlT = [index, others, Math.min(1, others * 1.04), Math.min(1, others * 1.08)];
      let spreadT = 0.25 * (1 - fist);
      let thumbT = 0.35 + fist * 0.55;
      let thumbUpT = thumbDown ? 0 : 0.35 * (1 - fist);

      if (gun) {
        curlT[0] = 0;
        thumbUpT = thumbDown ? 0 : 1;
        thumbT = thumbDown ? 0.55 : 0;
        spreadT = 0;
      } else if (returning && fist < 0.5) {
        // Ready to catch: open and splay as the ball closes in.
        glove.getWorldPosition(_handPos);
        const near = 1 - Math.min(1, _handPos.distanceTo(ball.pos) / CATCH_REACH);
        const open = Math.min(1, near * 1.4);
        for (let i = 0; i < 4; i++) curlT[i] += (-0.12 - curlT[i]) * open;
        spreadT += (1 - spreadT) * open;
        thumbT += (0.05 - thumbT) * open;
        thumbUpT += (0.3 - thumbUpT) * open;
      }

      // --- the catch: snap shut, flash -----------------------------------
      if (st.wasReturning && !returning) {
        for (let i = 0; i < 4; i++) st.curl[i].v += 9 + i * 0.8;
        st.thumb.v += 6;
        st.spread.v -= 6;
        st.flash = 0.18;
      }
      st.wasReturning = returning;

      // --- BANG: a cocked hammer comes down ------------------------------
      const cocked = gun && st.thumbUp.x > 0.7;
      if (st.cocked && gun && thumbDown) {
        st.kick.v += 9;
        st.thumbUp.v -= 14;
        const tip = handIndexTip(glove);
        if (tip) {
          tip.localToWorld(_tip.set(0, 0, -INDEX_TIP_LENGTH - 0.004));
          emberBurst(_tip, 7);
        }
        pulseHand(this.world.session as never, hand, 0.55, 45);
      }
      st.cocked = cocked;

      // --- spring everything toward its target ---------------------------
      for (let i = 0; i < 4; i++) spring(st.curl[i], curlT[i], FINGER_K[i], dt);
      spring(st.spread, spreadT, 160, dt);
      spring(st.thumb, thumbT, THUMB_K, dt);
      spring(st.thumbUp, thumbUpT, THUMB_K, dt);
      spring(st.kick, 0, 180, dt);
      for (let i = 0; i < 4; i++) st.pose.curl[i] = Math.max(-0.2, Math.min(1.12, st.curl[i].x));
      st.pose.spread = Math.max(0, st.spread.x);
      st.pose.thumb = Math.max(0, Math.min(1.1, st.thumb.x));
      st.pose.thumbUp = Math.max(0, Math.min(1.05, st.thumbUp.x));
      setHandPose(glove, st.pose);

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
        if (Math.abs(st.kick.x) > 1e-4) {
          glove.quaternion.multiply(_kickQ.setFromAxisAngle(UP, -side * st.kick.x * 0.06));
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
