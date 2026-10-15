/**
 * ArenaSystem — (re)builds the physical floor whenever the match generation
 * changes: N platforms for the current ring, named for the current roster,
 * the stage at the right radius. Everything else (avatars, telegraphs,
 * strikes, rank lifts) parents onto what this builds.
 */

import { createSystem } from '@iwsdk/core';
import { arena, buildArena } from '../arena/arena.js';
import { dancerAtSeat, match } from '../game/state.js';

export class ArenaSystem extends createSystem({}) {
  private generation = -1;

  init(): void {
    this.rebuild();
  }

  update(): void {
    if (this.generation !== match.generation) this.rebuild();
    // The club is packed away while you're in the menus — the green room is
    // its own space; the ring materialises when a set is booked.
    const menuRoom = match.screen === 'lobby' || match.screen === 'tour';
    const a = arena();
    if (a) a.root.visible = !menuRoom;
  }

  private rebuild(): void {
    this.generation = match.generation;
    buildArena(this.scene, match.seats, match.mySeat, (seat) => dancerAtSeat(seat)?.name ?? '');
  }
}
