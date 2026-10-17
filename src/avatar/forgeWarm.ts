/**
 * THE FORGE, warmed (docs/forge.md): every shader a Forge piece can need,
 * compiled once, in the background, and kept.
 *
 * Trying a piece on in the store, or wearing one from the locker, stalled
 * the frame: the new piece's materials needed GPU programs, and swapping
 * pieces disposed the old materials, so three.js threw their programs away
 * and the next pick compiled them all over again — 100–400 ms on a PC,
 * several times that on a headset. The variants are few (the tone × the
 * finish × whether the part flops, plus the frames and the face), so a
 * handful of hidden rigs wearing one piece of each kind, in both tones,
 * cover them all. They are compiled with compileAsync (the driver links in
 * parallel; nothing blocks) and KEPT, never disposed — so their programs
 * stay cached for every piece worn after.
 */

import { type Camera, Group, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { buildBoxer } from './boxer.js';
import { DEFAULT_FRAME, FRAMES, framesReady, loadForgeGear } from './forge.js';
import { applyGear } from './gear.js';
import { applyLook } from './paint.js';

/** One piece of every kind: flop or not, in every slot (shell, trim and
 *  glow all appear among them). */
const SETS: readonly (readonly string[])[] = [
  ['antennae', 'cape', 'pauldrons', 'gauntlets', 'wolf'],
  ['crown', 'belt', 'epaulets', 'claws', 'bunny'],
];

const kept: Object3D[] = [];
let started = false;

export async function warmForge(renderer: WebGLRenderer, camera: Camera, scene: Scene): Promise<void> {
  if (started) return;
  started = true;
  try {
    await framesReady();
    await Promise.all(SETS.flat().map((id) => loadForgeGear(id)));
    const group = new Group();
    group.name = 'forge-warm';
    // Each rig stands on a different frame too, so every frame's fit and
    // paint grid (built once per frame, then cached) is ready before the
    // locker's first frame tap — those cost 60–140 ms on first use.
    const frames = FRAMES.map((f) => f.id).filter((id) => id !== DEFAULT_FRAME);
    let n = 0;
    for (const tone of ['white', 'onyx'] as const) {
      for (const set of SETS) {
        const frame = frames[n++ % (frames.length + 1)];
        const wear = frame ? [...set, frame] : [...set];
        const rig = buildBoxer(0, tone === 'onyx' ? 'onyx' : 'blank');
        for (const piece of rig.all) {
          piece.visible = true;
          group.add(piece);
          applyGear(piece, wear, tone);
        }
      }
    }
    // The frames and the face land on their own clocks (their kits load on
    // first use): give them a moment, then paint and compile everything.
    await new Promise((r) => setTimeout(r, 1500));
    applyLook(group, { paint: [] });
    group.updateMatrixWorld(true);
    await renderer.compileAsync(group, camera, scene);
    kept.push(group);
  } catch (err) {
    console.warn('[forge] shader warm-up skipped', err);
  }
}
