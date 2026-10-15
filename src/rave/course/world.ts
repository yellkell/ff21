/**
 * THE COURSE'S ROOT — one Group every course system hangs its build from,
 * parked a long way under the club (COURSE_ORIGIN). CourseSystem is the one
 * that puts it in the scene and turns it on and off; everybody else just
 * asks for it, so build order between the systems doesn't matter.
 *
 * Same seam as arena.ts: a registry rather than an import cycle.
 */

import { Group } from 'three';

let root: Group | null = null;

export function courseRoot(): Group {
  if (!root) {
    root = new Group();
    root.name = 'the-course';
    root.visible = false;
  }
  return root;
}
