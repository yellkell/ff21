/**
 * FLOP — the parts of a Forge piece that swing as you move (docs/forge.md):
 * a bunny's ears, a pair of antennae, a tail, a cape's hem, an epaulet's
 * fringe.
 *
 * A FLOP is a part of a piece exported as its own mesh(es) ("shell@ear_l",
 * "trim@ear_l"…) with a spec in the Forge manifest: a PIVOT (where it is
 * fixed), a DIR (root → tip, at rest), a LEN and its spring. Each one is
 * a single particle — the TIP — hung on a spring to where the tip would be
 * if the part were rigid. When the wearer moves, turns or stops, the rest
 * point moves and the tip lags, overshoots and settles: the swing. The
 * tip's offset becomes a rotation about the pivot, applied in the vertex
 * shader and graded from nothing at the root to all of it at the tip, so a
 * part BENDS rather than hinges.
 *
 * Purely visual and purely local: every headset simulates every flop it
 * can see from the rig's own motion, so nothing rides the wire. It runs in
 * onBeforeRender — a flop off-screen costs nothing — and once per frame
 * (a stereo frame renders twice). The paint, the bay and every raycast
 * see the part at rest.
 */

import { type Material, type Mesh, Matrix3, type MeshStandardMaterial, Vector3 } from 'three';

export interface FlopSpec {
  pivot: [number, number, number];
  dir: [number, number, number];
  len: number;
  /** Spring stiffness (1/s²) and damping (1/s): low damping is floppy. */
  stiff?: number;
  damp?: number;
  /** The most it swings, radians. */
  swing?: number;
  /** A direction (the part's own frame) the tip may never swing toward —
   *  a cape's hem never swings forward into the wearer's back. */
  block?: [number, number, number];
}

/** One simulated part: shared by every mesh (shell, trim, glow) of it. */
export interface FlopState {
  spec: FlopSpec;
  pivot: Vector3;
  dir: Vector3;
  block: Vector3 | null;
  /** The bend, as a rotation vector in the part's own frame (the uniform). */
  rot: { value: Vector3 };
  tip: Vector3;
  vel: Vector3;
  last: number;
  live: boolean;
}

export function flopState(spec: FlopSpec): FlopState {
  return {
    spec,
    pivot: new Vector3(...spec.pivot),
    dir: new Vector3(...spec.dir).normalize(),
    block: spec.block ? new Vector3(...spec.block).normalize() : null,
    rot: { value: new Vector3() },
    tip: new Vector3(),
    vel: new Vector3(),
    last: 0,
    live: false,
  };
}

const _rest = new Vector3();
const _d = new Vector3();
const _m3 = new Matrix3();
const _acc = new Vector3();

/** Advance one flop to now, from the world transform of a mesh of it. */
function step(s: FlopState, mesh: Mesh): void {
  const now = performance.now();
  const dt = (now - s.last) / 1000;
  if (s.live && dt < 0.002) return; // the other eye of this frame
  s.last = now;
  _rest.copy(s.dir).multiplyScalar(s.spec.len).add(s.pivot).applyMatrix4(mesh.matrixWorld);
  if (!s.live || dt > 0.25) {
    // First sight (or back from off-screen): start at rest, still.
    s.tip.copy(_rest);
    s.vel.set(0, 0, 0);
    s.rot.value.set(0, 0, 0);
    s.live = true;
    return;
  }
  const k = s.spec.stiff ?? 140;
  const c = s.spec.damp ?? 5.5;
  const n = Math.min(8, Math.ceil(dt / (1 / 120)));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    _acc.copy(_rest).sub(s.tip).multiplyScalar(k).addScaledVector(s.vel, -c);
    s.vel.addScaledVector(_acc, h);
    s.tip.addScaledVector(s.vel, h);
  }
  // The tip's lag, in the part's own frame, as a rotation of DIR toward it.
  _d.copy(s.tip).sub(_rest);
  _m3.setFromMatrix4(mesh.matrixWorld).invert();
  _d.applyMatrix3(_m3);
  _d.addScaledVector(s.dir, -_d.dot(s.dir));
  if (s.block) {
    const into = _d.dot(s.block);
    if (into > 0) _d.addScaledVector(s.block, -into);
  }
  const r = s.rot.value.copy(s.dir).cross(_d).divideScalar(s.spec.len);
  const max = s.spec.swing ?? 0.6;
  const a = r.length();
  if (a > max) {
    r.multiplyScalar(max / a);
    s.vel.multiplyScalar(0.6); // it hit its stop
  }
}

const VERT_HEAD = /* glsl */ `
uniform vec3 uFlopPivot;
uniform vec3 uFlopDir;
uniform float uFlopLen;
uniform vec3 uFlopRot;
vec3 flopTurn(vec3 v, vec3 at) {
  float t = clamp(dot(at - uFlopPivot, uFlopDir) / uFlopLen, 0.0, 1.0);
  vec3 r = uFlopRot * (t * t * (1.5 - 0.5 * t));
  float a = length(r);
  if (a < 1e-5) return v;
  vec3 k = r / a;
  return v * cos(a) + cross(k, v) * sin(a) + k * dot(k, v) * (1.0 - cos(a));
}
`;

/**
 * Make `mesh` bend with flop `s`. Call AFTER the mesh has its final
 * material (a material clone does not carry onBeforeCompile); the first
 * mesh given a state drives its simulation.
 */
export function installFlop(mesh: Mesh, s: FlopState, drive: boolean): void {
  const mat = mesh.material as MeshStandardMaterial;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer): void => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uFlopPivot = { value: s.pivot };
    shader.uniforms.uFlopDir = { value: s.dir };
    shader.uniforms.uFlopLen = { value: s.spec.len };
    shader.uniforms.uFlopRot = s.rot;
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', `${VERT_HEAD}\nvoid main() {`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n\tobjectNormal = flopTurn(objectNormal, position);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed = uFlopPivot + flopTurn(transformed - uFlopPivot, position);');
  };
  const key = (mat as Material).customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = (): string => `${key?.() ?? ''}|flop`;
  mat.needsUpdate = true;
  // (The kit pads a flop mesh's bounds by its reach, so the bend never
  // carries it out of its own culling sphere.)
  if (drive) mesh.onBeforeRender = (): void => step(s, mesh);
}
