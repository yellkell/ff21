/**
 * The course's instancing kit: everything repeated is an InstancedMesh,
 * every animated glow is per-instance colour, and the reflection is a
 * flipped clone that RE-SHARES the source's live buffers — one extra draw
 * per bank, no second camera, no render target, no resolve (research/02 §3;
 * the club's own mirror trick, borrowed for ground that moves).
 *
 * The venue's GlowBank (arena/voidkit) is the static-placement cousin: it
 * parks its instances once and only ever re-tints them. The circuit's decks
 * MOVE every frame, so this bank keeps a write cursor and rewrites matrices
 * as freely as colours.
 */

import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Material,
  Matrix4,
  MeshBasicMaterial,
  Object3D,
  Plane,
  Quaternion,
  Vector3,
} from 'three';

/** A unit box with lighting baked into vertex colours — top lit, flanks mid,
 *  underside dark. Reads as lit geometry with zero real lights
 *  (research/02 §4). */
export function shadedBoxGeometry(): BoxGeometry {
  const geo = new BoxGeometry(1, 1, 1);
  const normals = geo.getAttribute('normal');
  const colors = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const ny = normals.getY(i);
    const nx = normals.getX(i);
    let v = 0.62; // ±z flanks
    if (ny > 0.5) v = 1.0;
    else if (ny < -0.5) v = 0.3;
    else if (Math.abs(nx) > 0.5) v = 0.48;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = v;
  }
  geo.setAttribute('color', new BufferAttribute(colors, 3));
  return geo;
}

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _e = new Object3D();
const _c = new Color();

export class Bank {
  readonly mesh: InstancedMesh;
  private cursor = 0;

  constructor(geometry: BufferGeometry, material: Material, capacity: number) {
    this.mesh = new InstancedMesh(geometry, material, capacity);
    this.mesh.instanceColor = new InstancedBufferAttribute(
      new Float32Array(capacity * 3).fill(1),
      3,
    );
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
  }

  /** Reserve the next instance slot; returns its index. */
  add(
    x: number,
    y: number,
    z: number,
    sx = 1,
    sy = 1,
    sz = 1,
    color = 0xffffff,
    rotY = 0,
  ): number {
    const i = this.cursor++;
    this.set(i, x, y, z, sx, sy, sz, rotY);
    this.color(i, color);
    this.mesh.count = this.cursor;
    return i;
  }

  set(i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rotY = 0): void {
    _p.set(x, y, z);
    _s.set(sx, sy, sz);
    if (rotY !== 0) {
      _e.rotation.set(0, rotY, 0);
      _q.copy(_e.quaternion);
    } else {
      _q.identity();
    }
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  color(i: number, c: number, intensity = 1): void {
    _c.setHex(c);
    _c.multiplyScalar(intensity);
    const a = this.mesh.instanceColor!;
    a.setXYZ(i, _c.r, _c.g, _c.b);
    a.needsUpdate = true;
  }
}

/**
 * The reflection of a live bank: the same instance buffers drawn upside
 * down under the black glass. It animates for free because the buffers are
 * shared; only the material darkens.
 *
 * AND IT IS CLIPPED TO THE FLOOR. A flip about a plane is only honest for
 * geometry that stands entirely above that plane, and the circuit's decks
 * do not: a deck carries a two-step KEEL hanging 270 mm under its face, so
 * a deck resting AT ground level has body below the mirror plane, and the
 * flip folds that body back UP through the deck. The visible result was
 * the exact opposite of what the machine is meant to say — the keel that
 * hangs so well under a deck in flight appeared as a stack of blocks
 * sitting ON TOP of every grounded deck, covering the face, the etch and
 * the scan line, and the two ground-level runners wore them the whole way
 * round the circuit.
 *
 * One world-space plane per reflection fixes it at the fragment: keep only
 * what is genuinely under the glass. A deck straddling the floor is cut
 * cleanly at the floor line rather than vanishing, and the reflection of
 * anything at height is untouched, which is where it was always right.
 */
const _floor = new Vector3();

export function mirrorBank(bank: Bank, floorY: number, dim = 0.34): Group {
  const src = bank.mesh;
  const clone = new InstancedMesh(src.geometry, src.material, 0);
  const mat = (src.material as MeshBasicMaterial).clone();
  mat.color.multiplyScalar(dim);
  // THE FLICKER AT THE EDGES. A deck docked at floor level straddles the
  // glass: its body runs from the face down to a tenth under, the glass
  // sits six centimetres under. Its reflection is folded about the glass
  // and clipped to what lies beneath it — and what lies beneath it is the
  // real deck's own lower flanks, at exactly the same x and z. Two opaque
  // faces in one plane, and the depth test flips between them pixel by
  // pixel as the head moves: the edges of every floor deck shimmered, and
  // with a second rider beside you there were twice as many to see. The
  // reflection is pushed a hair back in depth, so wherever the two share
  // a plane the real deck wins, every pixel, every frame; where they don't
  // — everything the mirror is actually for — nothing changes.
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = 1;
  mat.polygonOffsetUnits = 2;
  // Keep y < the floor. (A Plane keeps normal·p + constant > 0; with a
  // normal of -Y that reads -y + constant > 0.)
  //
  // The constant is the floor's WORLD height, and it is set per frame
  // rather than here, because a clipping plane is world-space and the
  // circuit is NOT at the world origin — it is built three hundred metres
  // under the club so the two rooms cannot see each other. A plane written
  // in the course's own coordinates says "keep everything below -0.06",
  // which is true of every fragment at -300 and clips precisely nothing.
  // That is a silent failure: the planes are all present and correct and
  // the reflection folds up through the deck exactly as before.
  const plane = new Plane(new Vector3(0, -1, 0), floorY);
  mat.clippingPlanes = [plane];
  clone.material = mat;
  // Share the live buffers; the count follows the source every frame.
  clone.instanceMatrix = src.instanceMatrix;
  clone.instanceColor = src.instanceColor;
  clone.frustumCulled = false;
  clone.onBeforeRender = (): void => {
    clone.count = src.count;
    // Where the floor has ended up this frame. Taking the point through the
    // parent's world matrix rather than reading a translation keeps it
    // right if the circuit is ever moved or scaled as a whole.
    const p = g.parent;
    if (p) {
      _floor.set(0, floorY, 0).applyMatrix4(p.matrixWorld);
      plane.constant = _floor.y;
    }
  };
  const g = new Group();
  g.scale.y = -1;
  g.position.y = 2 * floorY;
  g.add(clone);
  return g;
}
