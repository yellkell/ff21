/**
 * Drives the transient effects: the pooled impact layers (flashes,
 * starbursts, shockwaves, spark streaks, ember chunks, damage numbers) and
 * the shared fire particle pools (embers + comet trails). Nothing here
 * creates or destroys an object at runtime — see fx/effects.ts for why.
 */

import { createSystem } from '@iwsdk/core';
import { initFirePools, updateFirePools } from '../fx/fire.js';
import { initImpactFx, updateImpactFx } from '../fx/effects.js';

export class FXSystem extends createSystem({}) {
  init(): void {
    initFirePools(this.scene);
    initImpactFx(this.scene);
  }

  update(delta: number): void {
    updateFirePools(delta);
    updateImpactFx(delta, this.world.camera);
  }
}
