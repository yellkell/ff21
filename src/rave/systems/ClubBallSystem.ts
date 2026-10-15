/**
 * ClubBallSystem — the raid-summoning ball, live on the floor.
 *
 * Watches net.ball: when somebody sends one up, the mirror ball appears at
 * their spot, spins, bobs, and wears its countdown plate (seconds, song,
 * caller, who's touched in — one orbiting pip per dancer in their colour).
 * Reach a hand within touching distance and the plate's edge warms; pull
 * the trigger (or squeeze) and you're ON — again, and you're out. The
 * caller's touch calls it off. The relay owns the clock: when it fires,
 * 'start' whisks the touchers to the ring and 'ball-off' clears the floor.
 *
 * Touch is deliberately PHYSICAL (walk up, reach out) — calling a raid is
 * a social act, and the walk to the ball is the RSVP.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Group, Vector3 } from 'three';
import * as sfx from '../audio/sfx.js';
import { BALL_TOUCH_RADIUS, ballAnchor, buildBallVisual, type BallVisual } from '../club/ball.js';
import { seatHue } from '../config.js';
import { match } from '../game/state.js';
import { course } from '../course/state.js';
import { cancelBall, joinBall, memberHue, net, inRoom } from '../net/session.js';

const _hand = new Vector3();
const _cam = new Vector3();

/** The descent's clock (s) — the winch pays out, the cable bounces. */
const DESCEND_SECONDS = 1.0;
/** The hoist's clock (s) — spooled back up into the dark. */
const ASCEND_SECONDS = 0.7;
/** How deep inside a slab the ball starts (and finishes) hidden — a hair
 *  over its own radius, so it emerges through the ceiling rather than
 *  popping into the air below it. The eclipse's `bare` anchor has no slab
 *  to hide in and uses 0. */
const SLAB_HIDE = 0.28;
/** The cable runs this far past the anchor plane — into the slab (hiding
 *  its cut end), or up to the eclipse's underside where the ball hangs
 *  off the fixture itself. */
const CABLE_OVERRUN = 0.32;
/** Under-damped spring 0 → 1: shoots past the end of the travel, dips
 *  back, settles — the bounce of a winched cable reaching its stop, twice
 *  inside the descent window. */
const spring = (p: number): number => 1 - Math.exp(-4.6 * p) * Math.cos(9.0 * p);

export class ClubBallSystem extends createSystem({}) {
  private holder = new Group();
  private visual: BallVisual | null = null;
  private clock = 0;
  private wasReach = false;
  private lastPaintKey = '';
  /** The ball's life on the floor: winched down → hanging → hoisted away. */
  private anim: 'descend' | 'hang' | 'ascend' = 'descend';
  private animT = 0;
  /** The local ceiling the cable is anchored to (see ballAnchor). */
  private anchorY = 0;
  /** Where the descent begins and the hoist ends (hidden in the slab, or
   *  flush under the eclipse). */
  private startY = 0;
  /** Height the hoist started from (the bob leaves y mid-wave). */
  private ascendFrom = 0;

  init(): void {
    this.holder.name = 'raid-ball-holder';
    this.scene.add(this.holder);
  }

  update(delta: number): void {
    const inClub =
      (match.screen === 'lobby' || match.screen === 'tour') &&
      inRoom() &&
      !course.active;
    const ballUp = inClub && net.ball !== null;

    // A resolving ball (called off, or fired without me) is HOISTED back
    // into the ceiling instead of blinking out — but only while I'm still
    // on the floor to watch it go. Being whisked to the ring, or walking
    // out, clears it the old instant way.
    if (!ballUp && this.visual && inClub && this.anim !== 'ascend') {
      this.anim = 'ascend';
      this.animT = 0;
      this.ascendFrom = this.visual.group.position.y;
      // The recall's rising magnetic pull IS the winch spooling it home.
      sfx.recall();
    }
    const ascending = !ballUp && this.visual !== null && inClub && this.anim === 'ascend';
    this.holder.visible = ballUp || ascending;

    if (!ballUp && !ascending) {
      if (this.visual) {
        this.visual.dispose();
        this.visual = null;
        this.lastPaintKey = '';
      }
      return;
    }
    const state = net.ball;

    // A fresh ball over a still-rising husk (called off and re-called in
    // one breath): the old visual finishes nothing — the new one takes over.
    if (this.visual && ballUp && this.anim === 'ascend') {
      this.visual.dispose();
      this.visual = null;
      this.lastPaintKey = '';
    }
    if (!this.visual) {
      this.visual = buildBallVisual();
      this.holder.add(this.visual.group);
      this.anim = 'descend';
      this.animT = 0;
      if (state) {
        // OUT OF THE CEILING: the cable anchors to whatever is overhead —
        // the slab, the dome's tread, a corner room's cap, or the eclipse
        // itself — and the ball starts hidden inside it (or flush under
        // the fixture, which has no slab to hide in).
        const a = ballAnchor(state.pos[0], state.pos[2]);
        this.anchorY = a.y;
        this.startY = a.y + (a.bare ? 0 : SLAB_HIDE);
        this.visual.group.position.set(state.pos[0], this.startY, state.pos[2]);
      }
      // The descent announces itself with the falling whoosh and its WHOOMP.
      sfx.throwWhoosh();
    }
    const v = this.visual;

    // Life: slow spin, the glimmer, and the phase's own motion.
    this.clock += delta;
    this.animT += delta;
    v.ball.rotation.y += delta * 0.9;
    v.twinkle(delta);

    if (this.anim === 'descend' && state) {
      // THE DROP: winched down out of the ceiling to its hang height on an
      // under-damped spring — the cable overshoots its stop, dips, and
      // settles, the bounce of a real ball reaching the end of its travel.
      const p = Math.min(1, this.animT / DESCEND_SECONDS);
      const k = spring(p);
      v.group.position.set(state.pos[0], this.startY + (state.pos[1] - this.startY) * k, state.pos[2]);
      if (p >= 1) this.anim = 'hang';
    } else if (this.anim === 'ascend') {
      // THE HOIST: spooled back up to where it came from, gathering speed —
      // ease-in, the winch taking up slack — and gone into the dark.
      const p = Math.min(1, this.animT / ASCEND_SECONDS);
      v.group.position.y = this.ascendFrom + (this.startY - this.ascendFrom) * p * p;
      if (p >= 1) {
        v.dispose();
        this.visual = null;
        this.lastPaintKey = '';
        return;
      }
    } else if (state) {
      // Hanging: the gentle bob.
      v.group.position.set(state.pos[0], state.pos[1] + Math.sin(this.clock * 1.3) * 0.03, state.pos[2]);
    }

    // THE CABLE always reaches its anchor — through the descent, the bob
    // and the hoist alike, the ball hangs FROM the ceiling it came out of.
    v.setCable(this.anchorY + CABLE_OVERRUN - v.group.position.y - 0.24);

    // The plate faces whoever looks, wherever the ball is on its way.
    this.camera.getWorldPosition(_cam);
    v.plate.rotation.y = Math.atan2(_cam.x - v.group.position.x, _cam.z - v.group.position.z);
    if (!state) return; // hoisted away — nothing left to touch or read

    // Touch: either hand close to the ball's heart.
    let inReach = false;
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.gripSpaces?.[hand]?.object3D ?? this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!obj) continue;
      obj.getWorldPosition(_hand);
      if (_hand.distanceTo(v.group.position) > BALL_TOUCH_RADIUS) continue;
      inReach = true;
      const gp = this.input.xr.gamepads[hand];
      if (gp?.getButtonDown(InputComponent.Trigger) || gp?.getButtonDown(InputComponent.Squeeze)) {
        this.touch();
        this.buzz(hand);
      }
    }
    if (inReach && !this.wasReach) sfx.uiHover();
    this.wasReach = inReach;
    const scale = inReach ? 1.1 : 1;
    v.ball.scale.set(scale, scale, scale);

    // The plate: repaint when the second, the joins, or my state changes.
    const seconds = Math.ceil(Math.max(0, state.firesAt - performance.now()) / 1000);
    const mine = state.callerIdx === net.myIdx;
    const joined = state.joins.has(net.myIdx);
    const joinIdxs = [...state.joins].sort((a, b) => a - b);
    const key = `${seconds}|${joinIdxs.join(',')}|${mine}|${joined}|${inReach}|${state.hardcore ? 1 : 0}`;
    if (key !== this.lastPaintKey) {
      this.lastPaintKey = key;
      const nameOf = (idx: number): string => net.members.find((m) => m.idx === idx)?.name ?? `#${idx}`;
      v.paint({
        seconds,
        mode: state.mode,
        hardcore: state.hardcore,
        trackId: state.track,
        callerName: state.callerName || nameOf(state.callerIdx),
        joinNames: joinIdxs.map(nameOf),
        mine,
        joined,
        inReach,
      });
      // Pips wear each dancer's own colour, same as their figure across the
      // floor — a slot's neon only stands in for someone who never picked.
      v.setPips(joinIdxs.map((idx) => {
        const m = net.members.find((mm) => mm.idx === idx);
        return m ? memberHue(m) : seatHue(idx);
      }));
    }
  }

  /** My hand met the ball: join, leave, or (caller) wave it away. */
  private touch(): void {
    const state = net.ball;
    if (!state) return;
    sfx.uiClick();
    if (state.callerIdx === net.myIdx) {
      cancelBall();
      return;
    }
    joinBall(!state.joins.has(net.myIdx));
  }

  /** A short haptic tick — the ball answers the hand that touched it. */
  private buzz(hand: 'left' | 'right'): void {
    const session = (this.world as { session?: XRSession | null }).session;
    if (!session?.inputSources) return;
    for (const src of session.inputSources) {
      if (src.handedness !== hand) continue;
      const actuator = (
        src.gamepad as { hapticActuators?: readonly { pulse?: (i: number, ms: number) => void }[] } | undefined
      )?.hapticActuators?.[0];
      try {
        actuator?.pulse?.(0.4, 50);
      } catch {
        /* garnish */
      }
    }
  }
}
