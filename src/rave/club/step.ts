/**
 * THE STEP — the seam between the club's west door and the course behind it,
 * in the style of arcade.ts: the builder registers the live bits it made,
 * and CourseSystem (which owns the crossing) picks them up here rather than
 * reaching into the club's geometry.
 *
 * The room itself is static and bakes with the rest of the hall (build.ts,
 * buildStep). Three things stay live because they breathe: the void inside
 * the frame, the shimmer over it, and the threshold plate on the floor that
 * brightens as you come within a stride of going through.
 */

import type { Mesh, MeshBasicMaterial } from 'three';

export interface StepRefs {
  /** The pane of void standing in the frame — 'live-step-portal'. */
  portal: Mesh;
  portalMat: MeshBasicMaterial;
  /** The additive wash over it: the surface, moving. */
  shimmerMat: MeshBasicMaterial;
  /** The lit floor plate in front of the frame — the threshold itself. */
  plateMat: MeshBasicMaterial;
}

let refs: StepRefs | null = null;

export function registerStep(r: StepRefs): void {
  refs = r;
}

export function stepRefs(): StepRefs | null {
  return refs;
}
