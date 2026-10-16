/**
 * THE CLUB'S FINGER GUNS — the shared half of a gesture everyone on the
 * floor can see.
 *
 * Your own hands run the sprung hand (avatar/handDriver.ts) in
 * rave/systems/PlayerSystem.ts, which publishes what they're doing here as
 * one packed number per hand (touch + shots fired, packHandFlags). The
 * floor's pose stream (ClubSocialSystem.pumpClubPose) carries it to every
 * other headset, and the glass (ClubMirrorSystem) reads it straight off
 * this module. Every room-mate's figure runs the same sprung hand off what
 * their headset sent, so a hand that GRABS rolls shut little finger first
 * and a finger gun cocks its hammer and kicks on the BANG on every headset.
 *
 * The muzzle's sparks are one tracer field for the whole floor — yours and
 * everyone else's — hot metal off the fingertip, never glitter.
 */

import { Group, Vector3 } from 'three';
import { HAND_FLAGS_UNKNOWN } from '../../avatar/handDriver.js';
import { TracerField } from '../materials/tracers.js';

/** Your hands' packed touch + shots, [left, right] — PlayerSystem writes it
 *  every frame; unknown (never a gun) while a hand has no controller. */
export const myHandFlags: [number, number] = [HAND_FLAGS_UNKNOWN, HAND_FLAGS_UNKNOWN];

/** Enough for a whole room emptying both barrels at once. */
const MAX_SPARKS = 96;
/** A muzzle spit: few, fast, tight — a cap gun, not a firework. */
const SHOT_SPARKS = 7;
const SHOT_SPEED = 2.6;
const SHOT_SPREAD = 0.35;
const SHOT_LIFE = 0.28;
/** Hot brass. */
const SHOT_HEX = 0xffb347;

class MuzzleSparks {
  readonly root = new Group();
  private readonly field = new TracerField(MAX_SPARKS, {
    width: 0.004,
    streak: 0.022,
    maxLen: 0.09,
    gravity: 5,
    drag: 1.4,
    floorY: 0.02,
    hot: 0.3,
  });

  constructor() {
    this.root.name = 'finger-gun-sparks';
    this.root.add(this.field.mesh);
  }

  /** BANG at `muzzle` (world), spitting along `aim`. */
  shot(muzzle: Vector3, aim: Vector3): void {
    this.field.spray(muzzle.x, muzzle.y, muzzle.z, aim.x, aim.y, aim.z, SHOT_SPARKS, SHOT_SPEED, SHOT_SPREAD, SHOT_LIFE, SHOT_HEX);
  }

  update(dt: number): void {
    this.field.step(dt);
  }
}

/** The floor's one spark field — PlayerSystem parents and steps it. */
export const muzzleSparks = new MuzzleSparks();
