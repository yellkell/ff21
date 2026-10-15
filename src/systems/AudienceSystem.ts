/**
 * THE AUDIENCE (DESIGN §3.2) — watchers travel with the squad, and the
 * terrace is a real place with real people on it.
 *
 * Two jobs, one for each side of the rail:
 *
 *  - IF I AM WATCHING: plant this headset on the audience ground. The
 *    bout is dealt to me exactly as it is to a fighter (same mesh, same
 *    poses, same fireballs), but my slot is the sentinel outside every
 *    layout (config.WATCHER_SLOT), so every seat renders where the arena
 *    actually put it and nothing is standing at my own origin. My rig is
 *    moved out to a stand on the terrace, ONCE, on the frame the bout
 *    starts — after that the ground is mine to look around from. My own
 *    platform goes away; I am not a fighter and there is nothing under my
 *    feet but the plate.
 *
 *  - EITHER WAY: put BODIES on the terrace. Every watcher streams a head
 *    (MeshSystem's `watch` frames), and each one gets a CROWD FIGURE at
 *    the rail (arena/desert/crowdFigure.ts): a low-poly silhouette, not
 *    another fighter — the crowd reads as a crowd because it is simpler
 *    than the show. Its arms rise with the roar on the wire, which is what
 *    makes the roar mean something: when the terrace goes up, the fighters
 *    can see it go up.
 *
 * The watchers' WORDS never reach a fighter (MeshSystem.mayHear); their
 * NOISE always does (audio/crowd.ts). That split is the pillar.
 */

import { createSystem } from '@iwsdk/core';
import { Quaternion, Vector3 } from 'three';
import { app } from '../menu/appState.js';
import { mesh } from '../net/mesh.js';
import { audienceStands, type Stand } from '../arena/desert/audience.js';
import { buildCrowdFigure, type CrowdFigure } from '../arena/desert/crowdFigure.js';

const _pos = new Vector3();
const _quat = new Quaternion();

/** How many terrace bodies we are willing to build (the seats a room keeps
 *  for watchers — one rig each, and no more). */
const MAX_BODIES = 8;

/** Headless read of where the audience actually is. */
export const audienceView = {
  /** My stand, or null when I'm not watching. */
  mine: null as Stand | null,
  /** How many bodies are on the terrace right now. */
  bodies: 0,
};


export class AudienceSystem extends createSystem({}) {
  private bodies = new Map<number, CrowdFigure>();
  private planted = false;
  private stand: Stand | null = null;

  update(delta: number): void {
    const watching = app.spectating && app.state === 'playing';
    if (watching && !this.planted) this.takeMyStand();
    if (!watching && this.planted) this.leaveMyStand();
    this.dressTerrace(delta);
    audienceView.mine = this.stand;
    audienceView.bodies = this.bodies.size;
  }

  /** Which spot on the terrace is mine: my seat's place in the watcher band,
   *  wrapped into however many stands this site offers. */
  private myStand(): Stand | null {
    const stands = audienceStands();
    if (stands.length === 0) return null;
    const w = Math.max(0, mesh.mySeat - mesh.capacity);
    return stands[w % stands.length];
  }

  private takeMyStand(): void {
    const stand = this.myStand();
    if (!stand) return; // this site grew no terraces — stay where you are
    this.planted = true;
    this.stand = stand;
    const player = this.world.player;
    player.position.set(stand.x, stand.y, stand.z);
    player.rotation.y = stand.yaw;
    // Nothing under a watcher's feet: the pedestal belongs to fighters.
    const pad = this.world.scene.getObjectByName('player-platform');
    if (pad) pad.visible = false;
  }

  private leaveMyStand(): void {
    this.planted = false;
    this.stand = null;
    const player = this.world.player;
    player.position.set(0, 0, 0);
    player.rotation.y = 0;
    const pad = this.world.scene.getObjectByName('player-platform');
    if (pad) pad.visible = true;
  }

  /** A crowd figure at the rail for every watcher on the wire. */
  private dressTerrace(delta: number): void {
    // Nobody left on the terrace (bout over, room gone) — strike the set.
    if (mesh.watchers.size === 0 && this.bodies.size > 0) {
      for (const [seat] of this.bodies) this.drop(seat);
      return;
    }
    for (const [seat, w] of mesh.watchers) {
      if (seat === mesh.mySeat) continue; // you never see your own body
      let body = this.bodies.get(seat);
      if (!body) {
        if (this.bodies.size >= MAX_BODIES) continue;
        body = buildCrowdFigure(seat);
        body.root.name = 'terrace-watcher';
        this.world.scene.add(body.root);
        this.bodies.set(seat, body);
      }
      body.root.visible = true;
      _pos.set(w.x, w.y, w.z);
      _quat.set(w.qx, w.qy, w.qz, w.qw);
      // The head is theirs; the body hangs under it, and the arms go up
      // with their hands-up roar.
      body.pose(_pos, _quat, w.roar, delta);
    }
    // Anyone the wire dropped takes their body with them.
    for (const [seat] of this.bodies) {
      if (!mesh.watchers.has(seat)) this.drop(seat);
    }
  }

  private drop(seat: number): void {
    const body = this.bodies.get(seat);
    if (!body) return;
    body.dispose();
    this.bodies.delete(seat);
  }
}
