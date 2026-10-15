/**
 * Laser beams through haze — one instanced draw for a whole rig.
 *
 * Every beam is a camera-facing ribbon, not a cylinder: two triangles a
 * strip, turned in the vertex shader to face your eye along the beam's own
 * axis. Across the ribbon a white-hot core sits inside a soft coloured
 * glow; along it the light is brightest at the lens and thins into the
 * haze, with a slow drift of smoke running down it. That is what a laser
 * looks like in a club — the old glowing rods read as poles.
 *
 * A beam never draws thinner than a pixel or so: far ones are widened to
 * `minAngle` of your view and dimmed to match, so 140 m of laser across
 * the sky stays a line instead of shimmering in and out between pixels.
 *
 * Additive, no depth write, no fog — the void's black is the haze.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  InstancedMesh,
  PlaneGeometry,
  Points,
  PointsMaterial,
  ShaderMaterial,
  type Vector3,
} from 'three';
import { glowTexture } from '../materials/glow.js';

export interface BeamStyle {
  /** Half-width of the glow, metres. */
  width: number;
  /** Metres over which the beam thins into the haze (1/e). */
  fade: number;
  /** Metres of hot lens glow at the emitter. */
  hot?: number;
  /** The narrowest a beam may look, radians of view. */
  minAngle?: number;
  /** How much the smoke drift modulates the beam, 0..1. */
  haze?: number;
  /** Lengthwise segments (long beams near the eye need a few). */
  segments?: number;
}

const _c = new Color();

export class LaserBeams {
  readonly mesh: InstancedMesh;
  readonly material: ShaderMaterial;
  private readonly width: number;
  private readonly m: Float32Array;

  constructor(count: number, style: BeamStyle) {
    const geo = new PlaneGeometry(2, 1, 1, style.segments ?? 6);
    geo.translate(0, 0.5, 0);
    this.width = style.width;
    this.material = new ShaderMaterial({
      uniforms: {
        uGain: { value: 1 },
        uTime: { value: 0 },
        uFade: { value: style.fade },
        uHot: { value: style.hot ?? 2 },
        uMinAngle: { value: style.minAngle ?? 0.0014 },
        uHaze: { value: style.haze ?? 0.25 },
      },
      vertexShader: /* glsl */ `
        uniform float uMinAngle;
        varying vec3 vColor;
        varying float vX;
        varying float vAlong;
        varying float vT;
        varying float vThin;
        varying float vSeed;
        void main() {
          mat4 m = modelMatrix * instanceMatrix;
          vec3 o = (m * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          vec3 axisV = (m * vec4(0.0, 1.0, 0.0, 0.0)).xyz;
          float len = length(axisV);
          vec3 axis = axisV / max(len, 1e-5);
          float width = length((m * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          vec3 p = o + axisV * position.y;
          vec3 toCam = cameraPosition - p;
          float dist = max(length(toCam), 1e-4);
          vec3 side = cross(axis, toCam / dist);
          float sl = length(side);
          side = sl > 1e-3 ? side / sl : normalize(cross(axis, vec3(0.0, 0.0, 1.0)) + vec3(1e-4, 0.0, 0.0));
          float w = max(width, dist * uMinAngle);
          vThin = width / w;
          p += side * position.x * w;
          vX = position.x;
          vAlong = position.y * len;
          vT = position.y;
          #ifdef USE_INSTANCING_COLOR
            vColor = instanceColor;
          #else
            vColor = vec3(1.0);
          #endif
          vSeed = o.x * 0.37 + o.z * 0.11;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uGain;
        uniform float uTime;
        uniform float uFade;
        uniform float uHot;
        uniform float uHaze;
        varying vec3 vColor;
        varying float vX;
        varying float vAlong;
        varying float vT;
        varying float vThin;
        varying float vSeed;
        void main() {
          float x2 = vX * vX;
          float core = exp(-x2 * 26.0);
          float glow = exp(-x2 * 4.5) * (1.0 - x2);
          float peak = max(vColor.r, max(vColor.g, vColor.b));
          vec3 c = vColor * glow * 0.5 + (vColor + vec3(peak * 0.35)) * core;
          float along = exp(-vAlong / uFade) * (1.0 + 1.4 * exp(-vAlong / uHot));
          float smoke = 1.0 - uHaze + uHaze * (0.5 + 0.5 * sin(vAlong * 0.42 - uTime * 1.6 + vSeed));
          float tip = 1.0 - smoothstep(0.92, 1.0, vT);
          gl_FragColor = vec4(c * along * smoke * tip * vThin * uGain, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide, // the ribbon turns to face you, but never trust a winding
      fog: false,
    });
    this.mesh = new InstancedMesh(geo, this.material, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    for (let i = 0; i < count; i++) this.mesh.setColorAt(i, _c.setRGB(0, 0, 0));
    this.m = this.mesh.instanceMatrix.array as Float32Array;
    this.m.fill(0);
  }

  /**
   * Beam `i`: from `origin` along unit `dir` for `length` metres, in `color`
   * scaled by `gain` (additive — gain IS brightness). A dark beam collapses
   * to nothing so it costs no fill.
   */
  set(i: number, origin: Vector3, dir: Vector3, length: number, color: Color, gain: number, width = this.width): void {
    const e = this.m;
    const o = i * 16;
    if (gain < 0.004 || length <= 0) {
      e.fill(0, o, o + 16);
      return;
    }
    // Any vector across the beam does: the shader only reads its length.
    let px = -dir.z;
    let pz = dir.x;
    let pl = Math.hypot(px, pz);
    if (pl < 1e-4) {
      px = 1;
      pz = 0;
      pl = 1;
    }
    e[o] = (px / pl) * width;
    e[o + 1] = 0;
    e[o + 2] = (pz / pl) * width;
    e[o + 3] = 0;
    e[o + 4] = dir.x * length;
    e[o + 5] = dir.y * length;
    e[o + 6] = dir.z * length;
    e[o + 7] = 0;
    e[o + 8] = 0;
    e[o + 9] = 0;
    e[o + 10] = 1;
    e[o + 11] = 0;
    e[o + 12] = origin.x;
    e[o + 13] = origin.y;
    e[o + 14] = origin.z;
    e[o + 15] = 1;
    this.mesh.setColorAt(i, _c.copy(color).multiplyScalar(gain));
  }

  /** Push this frame's beams to the GPU; `dt` drifts the smoke. */
  commit(dt: number): void {
    this.material.uniforms.uTime.value += dt;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  set gain(v: number) {
    this.material.uniforms.uGain.value = v;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

/**
 * The lenses: a hot point of light at every emitter, one Points draw for
 * the rig. They flare with their beams, so a fan reads as coming FROM
 * somewhere — and on the phrase's hit the whole ring of them goes off.
 */
export class LaserFlares {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;

  constructor(count: number, size: number) {
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new BufferAttribute(this.col, 3));
    this.points = new Points(
      geo,
      new PointsMaterial({
        size,
        map: glowTexture(),
        vertexColors: true,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
  }

  set(i: number, at: Vector3, color: Color, gain: number): void {
    this.pos[i * 3] = at.x;
    this.pos[i * 3 + 1] = at.y;
    this.pos[i * 3 + 2] = at.z;
    this.col[i * 3] = color.r * gain;
    this.col[i * 3 + 1] = color.g * gain;
    this.col[i * 3 + 2] = color.b * gain;
  }

  commit(): void {
    const g = this.points.geometry;
    (g.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (g.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as PointsMaterial).dispose();
  }
}
