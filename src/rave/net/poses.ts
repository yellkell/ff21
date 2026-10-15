/**
 * Remote pose store — the last head/hands sample per seat, in that seat's
 * own platform-local frame (which is exactly the space their avatar rig is
 * parented in, so AvatarSystem consumes these without any transform).
 */

export interface RemotePose {
  hx: number;
  hy: number;
  hz: number;
  /** Head yaw, pitch and roll. Yaw alone was enough while everyone was a
   *  silhouette across a ring; on the club floor, standing close enough to
   *  talk, a head that can only swivel left and right is unmistakably a
   *  puppet. Nodding, looking up at the decks, glancing down at a drink —
   *  that is most of what a face does in a conversation. */
  hyaw: number;
  hpitch: number;
  hroll: number;
  lx: number;
  ly: number;
  lz: number;
  rx: number;
  ry: number;
  rz: number;
  /** Each hand's world quaternion [x, y, z, w], when the frame carried
   *  one (club poses do; ring poses never have). */
  lq?: [number, number, number, number];
  rq?: [number, number, number, number];
  /** Each hand's grip as [trigger, grip], 0 open … 1 closed, when the
   *  frame carried it (club poses do since the fingers moved). */
  lg?: [number, number];
  rg?: [number, number];
  /** Wall-clock ms of arrival (stale poses freeze rather than glide). */
  t: number;
}

export const remotePoses = new Map<number, RemotePose>();

export function clearRemotePoses(): void {
  remotePoses.clear();
}

/**
 * CLUB poses — the same wire shape, different space and key: while a room
 * hangs out in the club (before/after a set) every member streams
 * head + hands in club WORLD space, keyed by their relay member idx (seats
 * don't exist yet). ClubSocialSystem embodies these.
 */
export const clubPoses = new Map<number, RemotePose>();

export function clearClubPoses(): void {
  clubPoses.clear();
}

/**
 * VOIDSTEP poses — head + hands in COURSE world space, keyed by relay member
 * idx, exactly like {@link clubPoses} but for the place through the club's
 * west door.
 *
 * World space is enough, and that is worth saying because it looks like it
 * shouldn't be. Out on the course each rider's play area is pinned to
 * whatever platform currently owns them, so two people are standing in two
 * different moving frames — which sounds like a pose has to say WHICH frame
 * it is in before anyone can place it. It doesn't: the circuit is authored,
 * not generated, so every client builds the identical course at the identical
 * coordinates, and a rider's head in course world space means the same thing
 * on every headset. The moving frames cancel out the moment you stop
 * describing a body relative to its own floor.
 *
 * What that DOES require is one shared clock — a platform has to be in the
 * same place at the same moment everywhere, or a rider reads as standing
 * beside their deck rather than on it. See `courseBars()` in net/session.ts.
 */
export const coursePoses = new Map<number, RemotePose>();

export function clearCoursePoses(): void {
  coursePoses.clear();
}
