/**
 * THE FLOOR'S CAMERA — the club's half of FFTV's picture.
 *
 * FFTV peeps into the club when nothing else is on. Until now that peep
 * was a MAP: the relay draws the floor from the poses every member sends
 * anyway (server/rave.mjs clubSnapshot), which tells you how many people
 * are in and roughly where, and nothing whatever about what the room looks
 * like. This sends a picture of it instead.
 *
 * WHO SHOOTS: the HOST, and only the host — one transmitter per room, so
 * two headsets never fight over the feed and nobody who merely walked in
 * pays for television. A guest costs nothing beyond a boolean.
 *
 * WHERE IT LOOKS FROM: a FIXED mount, high on the east side, pointed
 * across the dance floor at the stage (club/config.ts CLUB.cctv). It is
 * the host's headset doing the rendering, but the shot is not theirs and
 * does not move with them — the same view of the same room whoever
 * happens to be holding it, and whoever is on the floor is in it.
 *
 * WHAT IT COSTS: one 256x144 render three times a second, fenced rather
 * than stalled (net/tvVideo.ts). The club is a far cheaper scene to shoot
 * than a bout and nobody in it is being scored, which is why the floor is
 * the right place to have tried this first.
 *
 * The picture never keeps the club "on air": the floor is on whenever there
 * are people on it. If this stops sending — the host leaves, an old headset
 * can't render to a target — the relay's map comes straight back.
 */

import { createSystem } from '@iwsdk/core';
import { Vector3 } from 'three';
import { VIDEO } from '../../config.js';
import { CLUB } from '../club/config.js';
import { captureFrame, cameraBroken, releaseCamera, tvCamera } from '../../net/tvVideo.js';
import { tvCast } from '../../net/tvCast.js';
import { inRoom, net } from '../net/session.js';

const _aim = new Vector3();

export class ClubCastSystem extends createSystem({}) {
  private shotT = 0;

  update(delta: number): void {
    // Guests, solo floors and broken contexts never shoot.
    if (!net.isHost || !inRoom() || net.solo || cameraBroken()) return;
    this.shotT -= delta;
    if (this.shotT > 0) return;
    this.shotT = 1 / VIDEO.hz;
    void this.shoot();
  }

  stop(): void {
    releaseCamera();
  }

  private async shoot(): Promise<void> {
    this.aim();
    const d = await captureFrame(this.renderer, this.scene);
    if (d) tvCast.clubVideo(d);
  }

  /**
   * Stand the house camera up. Fixed world-space position and target: the
   * club is built at the world origin and the rig moves inside it, so a
   * mount in world space stays bolted to the wall however anybody walks.
   */
  private aim(): void {
    const cam = tvCamera();
    const { eye, look } = CLUB.cctv;
    cam.position.set(eye.x, eye.y, eye.z);
    _aim.set(look.x, look.y, look.z);
    cam.lookAt(_aim);
    cam.updateMatrixWorld();
  }
}
