import type { World } from '@iwsdk/core';
import { Color } from 'three';
import { customization, myPackedGear } from '../menu/customization.js';
import { myPackedLook } from '../avatar/paint.js';
import { FXSystem } from '../systems/FXSystem.js';
import { installAdminPanel } from './admin.js';
import { PUB, pubServerUrl } from './config.js';
import { buildPub } from './environment.js';
import { pubConnect, pubDisconnect } from './net.js';
import { Panel } from './panel.js';
import { bus, pub } from './state.js';
import { BartenderSystem } from './systems/BartenderSystem.js';
import { ClimbSystem } from './systems/ClimbSystem.js';
import { CoinSystem } from './systems/CoinSystem.js';
import { DartsSystem } from './systems/DartsSystem.js';
import { DroneHuntSystem } from './systems/DroneHuntSystem.js';
import { FightSystem } from './systems/FightSystem.js';
import { MusicSystem } from './systems/MusicSystem.js';
import { buildProps, PropSystem } from './systems/PropSystem.js';
import { PubPlayerSystem } from './systems/PubPlayerSystem.js';
import { SocialSystem } from './systems/SocialSystem.js';
import { TeleportSystem } from './systems/TeleportSystem.js';
import { TvSystem } from './systems/TvSystem.js';

export interface PubExperience {
  enter(): void;
  leave(): void;
}

const mounted = new WeakMap<World, PubExperience>();
const PUB_BACKGROUND = new Color(0x0c0d11);

function resolveName(): string {
  const param = new URLSearchParams(location.search).get('name');
  if (param) {
    localStorage.setItem('ibb-pub-name', param.slice(0, 14));
    return param.slice(0, 14);
  }
  const arena = localStorage.getItem('ff-player-name');
  if (arena) return arena.slice(0, 14);
  const stored = localStorage.getItem('ibb-pub-name');
  if (stored) return stored;
  const generated = `PUNTER-${Math.floor(100 + Math.random() * 900)}`;
  localStorage.setItem('ibb-pub-name', generated);
  return generated;
}

/**
 * Build the pub once and expose a lightweight enter/leave boundary. Keeping the
 * systems mounted avoids a second renderer and makes repeat visits cheap; their
 * update loops are paused whenever the arena is active.
 */
export function mountPubExperience(world: World): PubExperience {
  const existing = mounted.get(world);
  if (existing) return existing;

  pub.myName = resolveName();
  pub.refs = buildPub(world);
  buildProps(world);

  world.registerSystem(TeleportSystem);
  world.registerSystem(ClimbSystem);
  world.registerSystem(PubPlayerSystem);
  world.registerSystem(PropSystem);
  world.registerSystem(CoinSystem);
  world.registerSystem(DartsSystem);
  world.registerSystem(DroneHuntSystem);
  world.registerSystem(MusicSystem);
  world.registerSystem(TvSystem);
  world.registerSystem(FightSystem);
  world.registerSystem(BartenderSystem);
  world.registerSystem(SocialSystem);
  if (!world.hasSystem(FXSystem)) world.registerSystem(FXSystem);

  const teleport = world.getSystem(TeleportSystem)!;
  const climb = world.getSystem(ClimbSystem)!;
  const players = world.getSystem(PubPlayerSystem)!;
  const props = world.getSystem(PropSystem)!;
  const coins = world.getSystem(CoinSystem)!;
  const music = world.getSystem(MusicSystem)!;
  const pubSystems = [
    teleport,
    climb,
    players,
    props,
    coins,
    world.getSystem(DartsSystem)!,
    world.getSystem(DroneHuntSystem)!,
    music,
    world.getSystem(TvSystem)!,
    world.getSystem(FightSystem)!,
    world.getSystem(BartenderSystem)!,
    world.getSystem(SocialSystem)!,
  ];

  let fullNotice: Panel | null = null;
  const showFullNotice = (): void => {
    if (!fullNotice) {
      fullNotice = new Panel(1.5, 0.82, 384);
      fullNotice.setLines([
        { text: 'THE CLUB IS FULL', size: 58, colour: '#ffb000', bold: true },
        { text: '12 / 12 PUNTERS IN', size: 30 },
        { text: "You're in a quiet side room —", size: 26, colour: '#aeb6c2' },
        { text: 'come back when a stool frees up.', size: 26, colour: '#aeb6c2' },
      ]);
      fullNotice.mesh.position.set(PUB.spawn.x, 1.55, PUB.spawn.z - 1.3);
      pub.refs!.root.add(fullNotice.mesh);
    }
    fullNotice.mesh.visible = true;
  };
  bus.on('full', showFullNotice);
  bus.on('connected', () => {
    if (fullNotice) fullNotice.mesh.visible = false;
  });

  installAdminPanel();
  pub.refs.root.visible = false;
  players.setClubActive(false);
  for (const system of pubSystems) system.stop();

  let active = false;
  const experience: PubExperience = {
    enter(): void {
      if (active) return;
      active = true;
      if (fullNotice) fullNotice.mesh.visible = false;

      pub.refs!.root.visible = true;
      world.scene.background = PUB_BACKGROUND;
      world.renderer.setClearColor(PUB_BACKGROUND, 1);
      // Match the standalone club: its warm/cold fixtures light the room
      // directly. The arena's studio PMREM made the embedded room look washed
      // out, so it is isolated for the visit and restored by the manager.
      world.scene.environment = null;
      world.scene.environmentIntensity = 1;

      climb.resetMovement();
      teleport.enterClub();
      players.setClubActive(true);
      for (const system of pubSystems) system.play();

      pubConnect(
        pubServerUrl(),
        pub.myName,
        customization.avatar,
        customization.platform,
        customization.colorHue,
        customization.colorLight,
        myPackedLook(),
        myPackedGear(),
      );
    },

    leave(): void {
      if (!active) return;
      active = false;

      props.leaveClub();
      coins.leaveClub();
      music.leaveClub();
      players.setClubActive(false);
      teleport.leaveClub();
      climb.resetMovement();
      pubDisconnect();

      for (const system of pubSystems) system.stop();
      pub.refs!.root.visible = false;
    },
  };

  mounted.set(world, experience);
  return experience;
}
