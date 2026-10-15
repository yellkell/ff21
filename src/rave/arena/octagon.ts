/**
 * Geometry helpers for the octagonal platforms.
 */

import { ExtrudeGeometry, Path, Shape, type Vector2Tuple } from 'three';

/**
 * Build a flat octagon prism (a thin slab) from a clockwise list of outline
 * vertices in the floor plane. The resulting geometry lies in the XZ plane
 * with its top face at y = `thickness` and bottom at y = 0.
 */
export function octagonSlab(vertices: Vector2Tuple[], thickness = 0.08): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(vertices[0][0], vertices[0][1]);
  for (let i = 1; i < vertices.length; i++) {
    shape.lineTo(vertices[i][0], vertices[i][1]);
  }
  shape.closePath();

  const geo = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: true,
    bevelThickness: 0.015,
    bevelSize: 0.015,
    bevelSegments: 2,
  });
  // Shape is authored in XY; rotate so it lies flat in XZ (the floor).
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * A flat octagonal BAND — the outline as a solid frame, not a filled slab.
 * `inset` is the fraction of the octagon eaten by the hole (0.06 ≈ a 5 cm
 * neon tube on the dancer decks). This is what the platform rims are made
 * of: a band can be an opaque tube with a real edge, where the old filled
 * ghost-slab could only ever be a see-through film.
 */
export function octagonBand(
  vertices: Vector2Tuple[],
  inset: number,
  thickness = 0.02,
): ExtrudeGeometry {
  const shape = new Shape();
  shape.moveTo(vertices[0][0], vertices[0][1]);
  for (let i = 1; i < vertices.length; i++) {
    shape.lineTo(vertices[i][0], vertices[i][1]);
  }
  shape.closePath();

  // The hole walks the same outline shrunk toward the centroid, in reverse
  // winding so the triangulator reads it as a hole.
  const k = 1 - inset;
  const hole = new Path();
  const last = vertices.length - 1;
  hole.moveTo(vertices[last][0] * k, vertices[last][1] * k);
  for (let i = last - 1; i >= 0; i--) {
    hole.lineTo(vertices[i][0] * k, vertices[i][1] * k);
  }
  hole.closePath();
  shape.holes.push(hole);

  const geo = new ExtrudeGeometry(shape, {
    depth: thickness,
    bevelEnabled: false,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}
