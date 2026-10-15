/**
 * The cove's surfaces are lit by the cove's own sun and sky ONLY.
 *
 * FIRE FIGHT keeps a studio RoomEnvironment on `scene.environment` so its
 * metalwork glints (arena/environment.ts). three r184 hands that to Lambert
 * materials too — as diffuse image-based light plus a multiply by its
 * reflection — and `envMapIntensity` doesn't gate it for Lambert, so a
 * beach under a sunset sky came out lit like a photo studio. Compiling the
 * env map out of these shaders is the only reliable off switch.
 */

import type { Material, WebGLProgramParametersWithUniforms } from 'three';

/** Strip scene.environment from a (Lambert) material's shaders; chains any
 *  onBeforeCompile already set. Call AFTER installing your own patch. */
export function outdoor<M extends Material>(mat: M): M {
  const prev = mat.onBeforeCompile.bind(mat);
  mat.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, renderer) => {
    prev(shader, renderer);
    shader.vertexShader = '#undef USE_ENVMAP\n' + shader.vertexShader;
    shader.fragmentShader = '#undef USE_ENVMAP\n' + shader.fragmentShader;
  };
  const key = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${key()}|outdoor`;
  return mat;
}
