/**
 * RAVE RAID, MOUNTED — the whole rave (the venue, the course behind its
 * west door, the foyer and the set) as an experience inside FIRE FIGHT 2's
 * own world, entered and left under a curtain with the XR session never
 * ending.
 *
 * Until now the rave was a PAGE: the arena's ARCADE button ended the
 * session and hopped to rave.html, which put the player back on a flat
 * browser page with a button to press. A change of page is a change of
 * session, and there is no fade that hides that. The pub had already shown
 * the way out (pub/experience.ts): build the second world in the SAME
 * World, keep its systems registered, and pause them — the join is then a
 * black curtain and nothing else.
 *
 * What this mounts is exactly rave/main.ts's system list, minus the title
 * card (the arena has its own boot intro and you are already inside). The
 * rave's systems are untouched: they key on `match.screen` and the room
 * gate (`inRoom()`) as they always did, and this module only ever sets
 * those two things and starts or stops the update loops.
 *
 * THE VENUE is the rave's club: FIRE FIGHT's CLUB tab lands you on its
 * floor, in the public room if the relay is up and in the ROOM OF ONE if
 * it isn't (net/session.ts). The ARCADE tab's RAVE RAID lands you in the
 * foyer at the board. Both are one place with two doors.
 */

import type { World } from '@iwsdk/core';
import { Color } from 'three';
import { VOID_BG } from './arena/voidkit.js';
import { stopAmbient, stopSet } from './audio/music.js';
import { raveBridge } from './bridge.js';
import { conductor } from './course/conductor.js';
import { course } from './course/state.js';
import { installRaveDevHook } from './devHook.js';
import { toLobby, toTour } from './game/flow.js';
import { backToClub, cancelPublicFloor, leaveRoom, net, openPublicFloor } from './net/session.js';
import { ArcadeSystem } from './systems/ArcadeSystem.js';
import { ArenaSystem } from './systems/ArenaSystem.js';
import { AvatarSystem } from './systems/AvatarSystem.js';
import { ChoreoSystem } from './systems/ChoreoSystem.js';
import { ClubBallSystem } from './systems/ClubBallSystem.js';
import { ClubMirrorSystem } from './systems/ClubMirrorSystem.js';
import { ClubCastSystem } from './systems/ClubCastSystem.js';
import { ClubPropsSystem } from './systems/ClubPropsSystem.js';
import { ClubSocialSystem } from './systems/ClubSocialSystem.js';
import { ClubSystem } from './systems/ClubSystem.js';
import { ClubTeleportSystem } from './systems/ClubTeleportSystem.js';
import { CourseFrameSystem } from './systems/CourseFrameSystem.js';
import { CoursePlatformSystem } from './systems/CoursePlatformSystem.js';
import { CourseSystem, courseView } from './systems/CourseSystem.js';
import { CourseVoidSystem } from './systems/CourseVoidSystem.js';
import { CourseRidersSystem } from './systems/CourseRidersSystem.js';
import { CourseWayfindSystem } from './systems/CourseWayfindSystem.js';
import { DiscoSystem } from './systems/DiscoSystem.js';
import { GoopliathSystem } from './systems/GoopliathSystem.js';
import { HudSystem } from './systems/HudSystem.js';
import { McSystem } from './systems/McSystem.js';
import { MenuSystem } from './systems/MenuSystem.js';
import { MusicSystem } from './systems/MusicSystem.js';
import { NetworkSystem } from './systems/NetworkSystem.js';
import { PlayerSystem } from './systems/PlayerSystem.js';
import { RankSystem } from './systems/RankSystem.js';

/** Where an entry lands: the venue's floor, or the foyer at the board. */
export type RavePlace = 'club' | 'foyer';

export interface RaveExperience {
  enter(place: RavePlace): void;
  leave(): void;
  readonly active: boolean;
  /** Where you are in the rave right now (for the probe and the host). */
  readonly place: RavePlace | null;
}

const mounted = new WeakMap<World, RaveExperience>();
const VOID = new Color(VOID_BG);

/** How long the floor waits for a relay before opening as a room of one. */
/**
 * How long the floor waits for a relay before opening as a room of one —
 * counted in POLL TICKS, not wall clock. Building the hall blocks the main
 * thread for seconds on a cold entry, and a wall-clock deadline burns
 * through that block: the room of one would open before the socket ever
 * got a turn, stranding a player with a perfectly good relay. Ticks only
 * accrue while the page is answering, so this is five seconds of the app
 * actually being alive. A relay that REFUSES is not waited on at all — the
 * error phase short-circuits below.
 */

interface Pausable {
  play(): void;
  stop(): void;
}

export function mountRaveExperience(world: World, onLeaveToArena: () => void): RaveExperience {
  const existing = mounted.get(world);
  if (existing) return existing;

  // rave/main.ts's order, kept: player pose first, then the floor, then
  // everything that reads both; the teleport before the network pumps; the
  // course after the teleport so it has the last word on the rig.
  const classes = [
    PlayerSystem,
    ArenaSystem,
    ClubSystem,
    ClubTeleportSystem,
    CourseSystem,
    CoursePlatformSystem,
    CourseFrameSystem,
    CourseWayfindSystem,
    CourseVoidSystem,
    CourseRidersSystem,
    ClubSocialSystem,
    ClubMirrorSystem,
    ClubCastSystem,
    ClubBallSystem,
    ArcadeSystem,
    ClubPropsSystem,
    MusicSystem,
    ChoreoSystem,
    GoopliathSystem,
    McSystem,
    AvatarSystem,
    RankSystem,
    DiscoSystem,
    HudSystem,
    MenuSystem,
    NetworkSystem,
  ];
  const systems: Pausable[] = [];
  for (const c of classes as unknown as Array<Parameters<World['registerSystem']>[0]>) {
    if (!world.hasSystem(c)) world.registerSystem(c);
    systems.push(world.getSystem(c)! as unknown as Pausable);
  }
  for (const s of systems) s.stop();

  installRaveDevHook(() => world);
  raveBridge.leaveToArena = onLeaveToArena;

  let active = false;
  let place: RavePlace | null = null;

  /** Open the floor: the public room if the relay answers, the room of one
   *  if it doesn't (or says no). Either way the hall is up within a few
   *  seconds of the curtain lifting, and never a foyer you didn't ask for. */
  const openFloor = (): void => {
    // The patience, the retries and the room-of-one last resort all live in
    // net/session.ts now, because the OTHER door onto this floor — the
    // standalone page's own club button — needs exactly the same thing and
    // used to have none of it.
    openPublicFloor(() => active && place === 'club');
  };

  const experience: RaveExperience = {
    get active() {
      return active;
    },
    get place() {
      return place;
    },
    enter(where: RavePlace): void {
      if (active) return;
      active = true;
      place = where;
      // FULL VR: an opaque backdrop behind every place, as the page has.
      world.scene.background = VOID;
      world.renderer.setClearColor(VOID, 1);
      world.scene.environment = null;
      for (const s of systems) s.play();
      if (where === 'club') {
        toLobby();
        // THE BELL brought me home: I never left the room — the relay has
        // me down as away on a fight — so this is a homecoming, not a
        // join. Anything else is an arrival, and the floor opens for it.
        if (net.dealtAway) backToClub();
        else openFloor();
      } else {
        toTour();
        leaveRoom();
      }
    },
    leave(): void {
      if (!active) return;
      active = false;
      place = null;
      cancelPublicFloor();
      // Whatever was mid-flight goes quiet without a tail cut short: the
      // course's ride, the floor's record, a set on the decks.
      if (course.active) courseView.leave?.();
      // Dealt away by THE BELL, I stay a member of the room while I fight
      // (the floor sees me OUT, and I come home to it); otherwise walking
      // out of the venue is walking out of the room.
      if (!net.dealtAway) leaveRoom();
      stopAmbient(0.25);
      stopSet(0.25);
      conductor.stop();
      toTour();
      // The raid's law, honoured on the way out too: the rig returns to
      // identity, so the arena's platform is on the same real spot it was.
      world.player.position.set(0, 0, 0);
      world.player.rotation.set(0, 0, 0);
      for (const s of systems) s.stop();
    },
  };

  mounted.set(world, experience);
  return experience;
}
