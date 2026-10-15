/**
 * The rave's dev/debug hook — drive the flow from the console (or a
 * headless test) without controllers: __gdr.startRaid({ seats: 8 }), or
 * walk the club with __gdr.net.host() + __gdr.rig(x, z, yaw).
 *
 * One module for both hosts: the standalone page (rave/main.ts) and the
 * arena that mounts the rave in-session (rave/experience.ts) install the
 * same window, so the probes read the same thing wherever the rave runs.
 */

import type { World } from '@iwsdk/core';
import { finishRaid, startRaid, toLobby, toTour } from './game/flow.js';
import { ambientMuted, ambientTrackId } from './audio/music.js';
import { mutedSpeakerIds } from './club/voice.js';
import { match } from './game/state.js';
import { arena } from './arena/arena.js';
import { choreoView } from './systems/ChoreoSystem.js';
import { menuView } from './systems/MenuSystem.js';
import { mcView } from './systems/McSystem.js';
import { socialView } from './systems/ClubSocialSystem.js';
import { propsView } from './systems/ClubPropsSystem.js';
import { teleportView } from './systems/ClubTeleportSystem.js';
import { courseView } from './systems/CourseSystem.js';
import { bellView } from './club/bell.js';
import { grooveView } from './systems/PlayerSystem.js';
import { introView } from './systems/IntroSystem.js';
import {
  callBall,
  cancelBall,
  hostRoom,
  joinBall,
  joinRoom,
  leaveRoom,
  net,
  setDancerHue,
  setDancerName,
  startBall,
} from './net/session.js';
import { clubPoses, coursePoses } from './net/poses.js';

declare global {
  interface Window {
    __gdr?: {
      startRaid: typeof startRaid;
      toLobby: typeof toLobby;
      toTour: typeof toTour;
      /** Drop the needle early: jump a live set straight to its grade. */
      endSet: typeof finishRaid;
      /** Draw calls / triangles this frame — the scenery's budget check. */
      info: () => { calls: number; triangles: number } | null;
      match: typeof match;
      arena: typeof arena;
      choreo: typeof choreoView;
      /** Fire a glowstick sparkle burst (heat 0..1) for tuning. */
      sparkle: (heat?: number) => void;
      /** What the controller models are doing (see grooveView.controllers). */
      pads: () => ReturnType<NonNullable<typeof grooveView.controllers>>;
      /** The live controller visual adapters — the only handle on the
       *  hide-for-a-song path off-device. */
      padAdapters: () => ReturnType<NonNullable<typeof grooveView.padAdapters>>;
      net: {
        host: typeof hostRoom;
        join: typeof joinRoom;
        leave: typeof leaveRoom;
        setName: typeof setDancerName;
        /** Repaint this headset — pushes to a room already standing. */
        setHue: typeof setDancerHue;
        state: typeof net;
        poses: typeof clubPoses;
        /** VOIDSTEP poses — who is out on the course, in course space. */
        coursePoses: typeof coursePoses;
      };
      /** THE BALL, drivable headlessly: call one, touch in, call it off. */
      club: { call: typeof callBall; touch: typeof joinBall; cancel: typeof cancelBall; go: typeof startBall };
      /** THE DRINKS: read the pool, or launch a glass on a known arc. */
      props: typeof propsView;
      /** The menus, drivable headlessly: board mode/hover, the pause card,
       *  the SOCIAL panel — the style-iteration hooks. */
      menu: typeof menuView & typeof socialView;
      /** Park the player rig at (x, z) facing `yaw` — headless club walks.
       *  `pitch`/`roll` tip the rig (and so the head that rides it) the way
       *  a neck would, for probing what the room sees of your head. */
      rig: (x: number, z: number, yaw?: number, y?: number, pitch?: number, roll?: number) => void;
      /** The live scene graph — headless probes walk it by name. */
      scene: () => import('three').Scene | null;
      /** The title card, for captures that need to know where the show is. */
      intro: typeof introView;
      /** THE MC's wardrobe: the hue and colour he is wearing this frame. */
      mc: typeof mcView;
      /** Voice speakers currently gated off (mute, block, or wrong room). */
      mutedVoices: typeof mutedSpeakerIds;
      /** Which record the room is spinning right now, by track id. */
      ambient: typeof ambientTrackId;
      /** Is this headset listening to it? (The floor's MUSIC switch — the
       *  record keeps spinning either way.) */
      ambientMuted: typeof ambientMuted;
      /** The club moves that resolve without an arc (step back, snap turn). */
      move: typeof teleportView;
      /** THE STEP: cross into the course and back without a doorway, and
       *  read the ride's ledger (tracked platform, laps, slips, handovers). */
      course: typeof courseView;
      bell: typeof bellView;
    };
  }
}
export function installRaveDevHook(getWorld: () => World | null): void {
  window.__gdr = {
    startRaid,
    toLobby,
    toTour,
    endSet: finishRaid,
    info: () => {
      const r = (getWorld() as unknown as { renderer?: { info: { render: { calls: number; triangles: number } } } } | null)
        ?.renderer;
      return r ? { calls: r.info.render.calls, triangles: r.info.render.triangles } : null;
    },
    match,
    arena,
    choreo: choreoView,
    sparkle: (heat = 1) => grooveView.burst?.(heat),
    pads: () => grooveView.controllers?.() ?? [],
    padAdapters: () => grooveView.padAdapters?.() ?? null,
    net: {
      host: hostRoom,
      join: joinRoom,
      leave: leaveRoom,
      setName: setDancerName,
      setHue: setDancerHue,
      state: net,
      poses: clubPoses,
      coursePoses,
    },
    club: { call: callBall, touch: joinBall, cancel: cancelBall, go: startBall },
    intro: introView,
    mc: mcView,
    mutedVoices: mutedSpeakerIds,
    ambient: ambientTrackId,
    ambientMuted,
    move: teleportView,
    course: courseView,
    /** THE BELL's house money, as the desk reads it (club/bell.ts). */
    bell: bellView,
    props: propsView,
    menu: new Proxy({} as typeof menuView & typeof socialView, {
      // The views are populated in each system's init — resolve lazily.
      get: (_t, key) =>
        (menuView as Record<string | symbol, unknown>)[key] ??
        (socialView as Record<string | symbol, unknown>)[key],
    }),
    rig: (x, z, yaw = 0, y = 0, pitch = 0, roll = 0) => {
      const w = getWorld();
      if (!w) return;
      w.player.position.set(x, y, z);
      // Same order the pose pumps decode in, so what you set is what the
      // room reads back.
      w.player.rotation.order = 'YXZ';
      w.player.rotation.set(pitch, yaw, roll);
    },
    scene: () =>
      (getWorld() as unknown as { scene?: import('three').Scene } | null)?.scene ?? null,
    };
}
