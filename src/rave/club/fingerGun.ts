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
 * It is a gesture — how somebody holds their hand — so nothing leaves the
 * muzzle: no sparks, no flash, anywhere.
 */

import { HAND_FLAGS_UNKNOWN } from '../../avatar/handDriver.js';

/** Your hands' packed touch + shots, [left, right] — PlayerSystem writes it
 *  every frame; unknown (never a gun) while a hand has no controller. */
export const myHandFlags: [number, number] = [HAND_FLAGS_UNKNOWN, HAND_FLAGS_UNKNOWN];
