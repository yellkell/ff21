/**
 * AERIAL PERSPECTIVE for the desert's far layer — the thing the mesas and
 * the sand were missing. A mesa a hundred metres off used to arrive at the
 * eye at full contrast and full saturation, painted with the same grain as
 * a boulder at your feet, and so read as a cardboard cut-out stood on the
 * plane rather than a mountain a walk away. Distance, in a real desert, is
 * air: every metre of it lifts the shadows toward the sky and drains the
 * colour toward the horizon.
 *
 * three's own `scene.fog` is one colour in every direction, and this sky
 * is not: blood-orange under the dying sun, dusty mauve behind you. So this
 * is a small directional fog injected into the far layer's materials only
 * (terrain, mesas, boulders) with onBeforeCompile — a sprite, a platform,
 * a fighter and the sun disc are never touched, and the mix happens after
 * tone mapping in the same space the sky dome writes its own colours, so
 * at full haze a mesa's foot and the band behind it are the SAME pixel.
 *
 * The haze also thins with height: a cap forty metres up keeps more of its
 * edge than the talus at the ground line, which is exactly how a real
 * skyline stands out of the dust.
 */

import { type Color, type Material, Vector3 } from 'three';
import { CONFIG } from './config.js';

/** The shared uniforms — one set, every hazed material reads them. */
export const HAZE = {
  sun: { value: new Vector3(0, 0, -1) },
  near: { value: CONFIG.haze.near },
  far: { value: CONFIG.haze.far },
  max: { value: CONFIG.haze.max },
  lift: { value: CONFIG.haze.lift },
  horizon: { value: null as unknown as Color },
  dusk: { value: null as unknown as Color },
};

/** Point the haze at the sky dome's own band colours, so the two agree. */
export function bindHazeSky(horizon: Color, dusk: Color): void {
  HAZE.horizon.value = horizon;
  HAZE.dusk.value = dusk;
}

/** Where the sun is in WORLD space right now: the far layer yaws per site
 *  (sites.ts SITE_YAW), so the band swings round and the haze must follow. */
export function setHazeSun(sunDir: Vector3, yaw: number): void {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  HAZE.sun.value.set(sunDir.x * c + sunDir.z * s, sunDir.y, -sunDir.x * s + sunDir.z * c);
}

/**
 * Give a material the haze. Works for MeshStandardMaterial (instanced or
 * not) — anything whose shader carries the standard chunk names.
 */
export function hazed<T extends Material>(mat: T): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    Object.assign(shader.uniforms, {
      hazeSun: HAZE.sun,
      hazeNear: HAZE.near,
      hazeFar: HAZE.far,
      hazeMax: HAZE.max,
      hazeLift: HAZE.lift,
      hazeHorizon: HAZE.horizon,
      hazeDusk: HAZE.dusk,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHazeW;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
        {
          vec4 hw = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            hw = instanceMatrix * hw;
          #endif
          vHazeW = (modelMatrix * hw).xyz;
        }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        varying vec3 vHazeW;
        uniform vec3 hazeSun;
        uniform float hazeNear, hazeFar, hazeMax, hazeLift;
        uniform vec3 hazeHorizon, hazeDusk;`,
      )
      .replace(
        '#include <fog_fragment>',
        /* glsl */ `#include <fog_fragment>
        {
          vec3 toEye = vHazeW - cameraPosition;
          float d = length(toEye);
          float f = smoothstep(hazeNear, hazeFar, d);
          // Thinner with height: the skyline stands out of the dust.
          f *= mix(1.0, 0.45, clamp(vHazeW.y / hazeLift, 0.0, 1.0));
          f *= hazeMax;
          // The band's colour on THIS bearing — hot toward the sun, cool away.
          vec2 dir = normalize(toEye.xz);
          float toward = 0.5 + 0.5 * dot(dir, normalize(hazeSun.xz));
          vec3 band = mix(hazeDusk, hazeHorizon, pow(toward, 2.4));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, band, f);
        }`,
      );
  };
  // The cache key must change with the injection, or three hands a hazed
  // material a plain material's compiled program.
  const baseKey = mat.customProgramCacheKey.bind(mat);
  mat.customProgramCacheKey = () => `${baseKey()}|haze`;
  return mat;
}
