/**
 * THE CURTAIN — how one place becomes another without anyone noticing the
 * join.
 *
 * A change of world inside a live XR session has exactly one honest form:
 * the black comes down, the world is swapped BEHIND it, the black lifts.
 * Nothing ever changes in front of your eyes. It is the same crossing THE
 * STEP makes between the club and the course (rave/systems/CourseSystem),
 * lifted out so the arena, the venue and the rave can all pass through it.
 *
 * Head-locked, a sphere rather than a plane so it covers the field however
 * you turn, `transparent` at full opacity so it draws after everything it
 * is hiding, and depth-less so nothing in the scene can poke through it.
 * The fade runs on real session frames (a page tab's rAF does not tick
 * inside an immersive session), which is why `to()` takes a frame source.
 */

import { BackSide, Mesh, MeshBasicMaterial, SphereGeometry, type Object3D } from 'three';

export class Curtain {
  readonly mesh: Mesh<SphereGeometry, MeshBasicMaterial>;

  constructor(private readonly camera: Object3D) {
    this.mesh = new Mesh(
      new SphereGeometry(6, 20, 14),
      new MeshBasicMaterial({
        color: 0x000000,
        side: BackSide,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.mesh.name = 'town-curtain';
    this.mesh.renderOrder = 9_500;
    this.mesh.visible = false;
    // Riding the camera, it is head-locked for free — and it never moves
    // relative to the eyes, which is what makes a featureless black
    // imperceptible as a thing that follows you.
    camera.add(this.mesh);
  }

  get opacity(): number {
    return this.mesh.material.opacity;
  }

  /** Snap to a level (0 clear … 1 black). */
  set(level: number): void {
    const v = Math.max(0, Math.min(1, level));
    this.mesh.material.opacity = v;
    this.mesh.visible = v > 0.002;
  }

  /**
   * Fade to `level` over `seconds`, one real frame at a time. Resolves when
   * it lands. The camera is re-asserted as the parent in case something
   * re-parented the scene graph in between (nothing should, but a curtain
   * that silently stopped following the head would be worse than useless).
   */
  async to(level: number, seconds: number, frame: () => Promise<void>): Promise<void> {
    if (this.mesh.parent !== this.camera) this.camera.add(this.mesh);
    const from = this.opacity;
    const target = Math.max(0, Math.min(1, level));
    if (seconds <= 0 || Math.abs(target - from) < 1e-3) {
      this.set(target);
      return;
    }
    const t0 = performance.now();
    for (;;) {
      await frame();
      const t = Math.min(1, (performance.now() - t0) / (seconds * 1000));
      // Ease in-out: the black arrives and leaves without a step.
      const e = t * t * (3 - 2 * t);
      this.set(from + (target - from) * e);
      if (t >= 1) break;
    }
  }
}
