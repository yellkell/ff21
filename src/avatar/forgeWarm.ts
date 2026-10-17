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
 *
 * A program is cut for the scene it is drawn in as well: its fog, its
 * lights. The warm-up ran before the arena had set its fog, so every piece
 * worn after still compiled its own, fogged, programs — and threw them
 * away when it came off. So the warm rigs are compiled again whenever the
 * scene's cut changes (a canary in the scene notices: its own program
 * changes with it), and a piece taken off hands its programs to the keeper
 * (shaderKeep.ts) rather than deleting them.
 */

import { BufferGeometry, type Camera, Float32BufferAttribute, Group, type Material, Mesh, MeshStandardMaterial, type Object3D, type Scene, type WebGLRenderer } from 'three';
import { buildBoxer } from './boxer.js';
import { DEFAULT_FRAME, FRAMES, framesReady, loadForgeGear } from './forge.js';
import { applyGear } from './gear.js';
import { applyLook } from './paint.js';
import { holdPrograms, keepPrograms } from './shaderKeep.js';

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
  keepPrograms(renderer);
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
    holdPrograms(materialsOf(group));
    kept.push(group);
    watchScene(renderer, camera, scene, group);
  } catch (err) {
    console.warn('[forge] shader warm-up skipped', err);
  }
}

function materialsOf(root: Object3D): Material[] {
  const out: Material[] = [];
  root.traverse((o) => {
    const m = (o as Mesh).material;
    if (m) out.push(...(Array.isArray(m) ? m : [m]));
  });
  return out;
}

/**
 * THE CANARY: one lit, fogged material on a triangle of no size, drawn
 * every frame and writing nothing. When the scene's fog or lights change,
 * three.js gives it a new program like every other lit material — and that
 * is the cue to compile the warm rigs again, in the background, for the
 * scene as it now is.
 */
function watchScene(renderer: WebGLRenderer, camera: Camera, scene: Scene, group: Group): void {
  const mat = new MeshStandardMaterial({ colorWrite: false, depthWrite: false });
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('normal', new Float32BufferAttribute(new Float32Array(9), 3));
  geo.setAttribute('uv', new Float32BufferAttribute(new Float32Array(6), 2));
  const canary = new Mesh(geo, mat);
  canary.name = 'forge-warm-canary';
  canary.frustumCulled = false;
  let seen: unknown = null;
  let busy = false;
  const rewarm = (): void => {
    if (busy) return;
    busy = true;
    const at = seen;
    window.setTimeout(() => {
      renderer
        .compileAsync(group, camera, scene)
        .then(() => holdPrograms(materialsOf(group)))
        .catch(() => {})
        .finally(() => {
          busy = false;
          if (seen !== at) rewarm(); // it changed again while compiling
        });
    }, 0);
  };
  canary.onBeforeRender = (r): void => {
    const prog = (r.properties.get(mat) as { currentProgram?: unknown }).currentProgram;
    if (!prog || prog === seen) return;
    seen = prog;
    rewarm();
  };
  scene.add(canary);
}
