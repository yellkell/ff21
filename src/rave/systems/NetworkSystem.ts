/**
 * NetworkSystem — the online pumps. While a networked set is live it streams
 * my pose (10 Hz, platform-local: head + hands + head yaw/pitch/roll) and my score line
 * (3 Hz, or instantly on a life change) to the room; the session module
 * applies everything inbound.
 *
 * A room OUTLIVES its sets now — the club is where it lives between them —
 * so the end of a set doesn't end the session: it folds back to the club
 * floor (backToClub), same members, same code. Bailing out mid-set (right
 * Ⓐ) tells the room you're done dancing first, so your figure folds on
 * everyone else's ring instead of freezing mid-move. LEAVE is a button on
 * the board, and the only thing that actually hangs up.
 */

import { createSystem, Quaternion, Vector3 } from '@iwsdk/core';
import { Euler } from 'three';
import { NET, PODIUM } from '../config.js';
import { toLobby } from '../game/flow.js';
import { match, me, nightWinner, type Screen } from '../game/state.js';
import { backToClub, net, sendPose, sendScore } from '../net/session.js';

const _v = new Vector3();
const _q = new Quaternion();
/** YXZ = the order a neck actually works in: swivel, then nod, then tilt. */
const _e = new Euler(0, 0, 0, 'YXZ');

export class NetworkSystem extends createSystem({}) {
  private poseT = 0;
  private scoreT = 0;
  private lastHits = -1;
  private prevScreen: Screen | '' = '';
  private podiumT = 0;

  update(delta: number): void {
    const screen = match.screen;
    const menuRoom = screen === 'lobby' || screen === 'tour';

    // An online podium DEPOSITS you back on the club floor by itself once
    // the reading's done — nobody should have to find a button to go home.
    if (screen === 'podium' && net.phase === 'live') {
      this.podiumT += delta;
      if (this.podiumT >= PODIUM.holdSeconds) toLobby();
    } else {
      this.podiumT = 0;
    }

    // Back on the club floor with a live session? The set is over for me —
    // fold the session back to the room, not out of it. A direct raid →
    // menu jump is a mid-set BAIL: report myself down first so my dancer
    // folds on every other ring (a podium exit is a clean set end).
    // (Not while THE BELL has me dealt away to a fight: that is 'live' on
    // the club floor for the two frames the curtain takes to fall, and it
    // is the arena's set, not this wire's — backToClub comes with me.)
    if (net.phase === 'live' && menuRoom && !net.dealtAway) {
      const d = me();
      if ((this.prevScreen === 'raid' || this.prevScreen === 'countdown') && d?.alive) {
        sendScore({
          score: d.score,
          combo: d.combo,
          dodges: d.dodges,
          hits: d.hits,
          perfects: d.perfects,
          alive: false,
          elim: Number.isFinite(match.beat) ? match.beat : 0,
        });
      }
      // THE CROWN's claim rides home with a RESOLVED set only (the walk
      // out led through the podium): the winner's member idx — my own if
      // the night was mine, null if a groupie took it. A bail names
      // nobody; whoever finishes the record will.
      let winner: number | null | undefined;
      if (this.prevScreen === 'podium') {
        const w = nightWinner();
        winner =
          w?.kind === 'local' ? net.myIdx : w?.kind === 'remote' ? (w.netId ?? null) : null;
      }
      backToClub(winner);
    }
    this.prevScreen = screen;

    if (net.phase !== 'live' || !match.playing) return;

    this.poseT -= delta;
    if (this.poseT <= 0) {
      this.poseT = 1 / NET.poseRateHz;
      this.pumpPose();
    }

    const d = me();
    if (!d) return;
    this.scoreT -= delta;
    // A hit jumps the queue — the ring should see a clip the instant it
    // lands, not up to a third of a second later.
    const hitLanded = d.hits !== this.lastHits;
    if (this.scoreT <= 0 || hitLanded) {
      this.scoreT = 1 / NET.scoreRateHz;
      this.lastHits = d.hits;
      sendScore({
        score: d.score,
        combo: d.combo,
        dodges: d.dodges,
        hits: d.hits,
        perfects: d.perfects,
        alive: d.alive,
        elim: d.elimAtBeat,
      });
    }
  }

  private pumpPose(): void {
    const headObj = this.playerHeadEntity?.object3D;
    if (!headObj) return;
    headObj.getWorldQuaternion(_q);
    // In YXZ the Y term IS the old atan2(-f.x, -f.z) for any pitch short of
    // straight up, so d[3] still means exactly what it always meant and a
    // client that never learned about pitch keeps reading it correctly.
    _e.setFromQuaternion(_q, 'YXZ');

    const d: number[] = [match.headX, match.headY, match.headZ, _e.y];
    for (const hand of ['left', 'right'] as const) {
      const obj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (obj) {
        obj.getWorldPosition(_v);
        d.push(_v.x, _v.y, _v.z);
      } else {
        // No controller tracked — park the hand at the hip.
        d.push(hand === 'left' ? -0.25 : 0.25, Math.max(0.6, match.headY - 0.6), -0.1);
      }
    }
    // Nod and tilt ride on the tail (d[10], d[11]) so the frame stays
    // backwards-compatible: short frames from an old client decode to 0.
    d.push(_e.x, _e.z);
    sendPose(d);
  }
}
