/**
 * THE COVE's beach party: figures round every bonfire on the sand, dancing
 * with a neon glowstick in each fist — RAVE RAID's groupies (the house's
 * crowd language, rave/game/avatars.ts) come down to the beach at sundown.
 *
 * They're 45 m and more away, so they are SILHOUETTES, not rigs: a body,
 * a head and two arms as a handful of boxes, every figure in ONE instanced
 * draw, the dance done in the vertex shader (a bob on the beat, arms
 * pumping from the shoulder — some chill, some hands-up). The side facing
 * their fire is lit warm and flickering; the glowsticks are a second draw
 * that works out each fist from the same dance maths.
 */

import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  ShaderMaterial,
  SRGBColorSpace,
  AdditiveBlending,
  Uint32BufferAttribute,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng } from '../desert/paper.js';
import { outdoor } from './outdoor.js';
import { groundY } from './terrain.js';
import type { FireSpot } from './bonfires.js';

/** Shoulder pivot and arm length, figure-local (metres, at scale 1). */
const SHOULDER = new Vector3(0.23, 1.42, 0);
const ARM = 0.62;

/**
 * The dance, shared by the bodies and the sticks so a fist and its stick
 * never part: per figure a seed (from its position), a tempo, and a mood
 * (0 swaying at the fire .. 1 hands in the air).
 */
const DANCE = /* glsl */ `
uniform float uTime;
float danceSeed(vec2 at) { return fract(sin(dot(at, vec2(12.9898, 78.233))) * 43758.5453); }
float danceBeat(float seed) { return uTime * (2.1 + seed * 0.5) * 3.14159 + seed * 40.0; }
// how far this arm swings up from hanging (radians)
float armUp(float seed, float mood, float side) {
  float b = danceBeat(seed);
  float pump = 0.5 + 0.5 * sin(b + side * 0.6 * (1.0 - mood));
  float wave = 0.5 + 0.5 * sin(b * 0.25 + seed * 9.0 + side);
  return mix(0.18, 0.7, pump) * (1.0 - mood) + mix(1.9, 2.9, pump) * mood * mix(0.6, 1.0, wave);
}
float danceBob(float seed, float mood) {
  return abs(sin(danceBeat(seed))) * mix(0.02, 0.07, mood);
}
// an arm point (figure-local, hanging = (0, -len, 0) from the shoulder)
vec3 armPoint(vec3 r, float side, float up) {
  float a = side * up;
  float c = cos(a), s = sin(a);
  return vec3(side * ${SHOULDER.x.toFixed(3)}, ${SHOULDER.y.toFixed(3)}, 0.0) + vec3(c * r.x - s * r.y, s * r.x + c * r.y, r.z);
}
`;

/** One figure: legs, torso, head (part 0), left arm (1), right arm (2). */
function figureGeometry(): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, part: number): void => {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.deleteAttribute('uv');
    ng.setAttribute('aPart', new Float32BufferAttribute(new Array(ng.attributes.position.count).fill(part), 1));
    parts.push(ng);
  };
  const legL = new BoxGeometry(0.14, 0.86, 0.16);
  legL.translate(-0.1, 0.43, 0);
  const legR = new BoxGeometry(0.14, 0.86, 0.16);
  legR.translate(0.1, 0.43, 0);
  const torso = new BoxGeometry(0.4, 0.62, 0.22);
  torso.translate(0, 1.16, 0);
  const head = new IcosahedronGeometry(0.12, 1);
  head.translate(0, 1.6, 0);
  add(legL, 0);
  add(legR, 0);
  add(torso, 0);
  add(head, 0);
  for (const side of [-1, 1]) {
    // hanging from the shoulder pivot; the shader swings it up about z
    const arm = new BoxGeometry(0.1, ARM, 0.1);
    arm.translate(0, -ARM / 2, 0);
    arm.translate(side * SHOULDER.x, SHOULDER.y, 0);
    add(arm, side < 0 ? 1 : 2);
  }
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return g;
}

interface Dancer {
  x: number;
  y: number;
  z: number;
  yaw: number;
  scale: number;
  mood: number;
  hue: number;
  fire: FireSpot;
}

function place(fires: FireSpot[]): Dancer[] {
  const rng = makeRng(0xda9ce);
  const out: Dancer[] = [];
  for (const fire of fires) {
    const n = 6 + Math.floor(rng() * 4);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rng() * 0.5;
      const r = (2.3 + rng() * 1.4) * Math.max(0.9, fire.size);
      const x = fire.x + Math.cos(a) * r;
      const z = fire.z + Math.sin(a) * r;
      // most face the fire; a few turn out to the sea and the sunset
      const dx = fire.x - x;
      const dz = fire.z - z;
      const turn = rng() < 0.25 ? Math.PI + (rng() - 0.5) : (rng() - 0.5) * 0.6;
      out.push({
        x,
        y: groundY(x, z),
        z,
        yaw: Math.atan2(-dx, -dz) + turn,
        scale: 0.9 + rng() * 0.2,
        mood: rng() < 0.45 ? 0.7 + rng() * 0.3 : rng() * 0.35,
        hue: rng(),
        fire,
      });
    }
  }
  return out;
}

function bodies(dancers: Dancer[]): InstancedMesh {
  const geo = figureGeometry();
  const fireAt = new Float32Array(dancers.length * 3);
  const mood = new Float32Array(dancers.length);
  dancers.forEach((d, i) => {
    fireAt.set([d.fire.x, d.fire.y + 0.8 * d.fire.size, d.fire.z], i * 3);
    mood[i] = d.mood;
  });
  geo.setAttribute('aFire', new InstancedBufferAttribute(fireAt, 3));
  geo.setAttribute('aMood', new InstancedBufferAttribute(mood, 1));
  const mat = new MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = danceTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aPart;
attribute vec3 aFire;
attribute float aMood;
varying vec3 vFire;
varying vec3 vWP;
${DANCE}`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
  float dSeed = danceSeed(instanceMatrix[3].xz);
  float dSide = aPart < 1.5 ? -1.0 : 1.0;
  float dUp = aPart > 0.5 ? armUp(dSeed, aMood, dSide) : 0.0;
  if (aPart > 0.5) {
    float an = dSide * dUp;
    objectNormal = vec3(cos(an) * objectNormal.x - sin(an) * objectNormal.y, sin(an) * objectNormal.x + cos(an) * objectNormal.y, objectNormal.z);
  }`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  if (aPart > 0.5) {
    vec3 r = transformed - vec3(dSide * ${SHOULDER.x.toFixed(3)}, ${SHOULDER.y.toFixed(3)}, 0.0);
    transformed = armPoint(r, dSide, dUp);
  }
  transformed.y += danceBob(dSeed, aMood);
  // a hip sway, the body swinging over planted feet
  transformed.x += sin(danceBeat(dSeed) * 0.5) * 0.04 * (0.4 + aMood) * transformed.y;
  vFire = aFire;
  vWP = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
varying vec3 vFire;
varying vec3 vWP;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// firelight: the side facing their fire, warm and flickering
  {
    vec3 toF = vFire - vWP;
    float dF = length(toF);
    vec3 Lf = normalize((viewMatrix * vec4(toF / dF, 0.0)).xyz);
    float flick = 0.8 + 0.2 * sin(uTime * 11.0 + vFire.x) * sin(uTime * 6.3 + vFire.z);
    float k = max(dot(normal, Lf), 0.0) * flick * 6.0 / (1.0 + dF * dF * 0.35);
    outgoingLight += diffuseColor.rgb * vec3(1.0, 0.45, 0.14) * k;
  }
#include <opaque_fragment>`,
      );
  };
  mat.customProgramCacheKey = () => 'cove-dancer';
  const mesh = new InstancedMesh(geo, outdoor(mat), dancers.length);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const rng = makeRng(0xc107);
  // clothes: dark, a little colour — they're silhouettes against the sunset
  const cloth = [
    new Color().setRGB(0.3, 0.26, 0.24, SRGBColorSpace),
    new Color().setRGB(0.22, 0.26, 0.32, SRGBColorSpace),
    new Color().setRGB(0.36, 0.22, 0.2, SRGBColorSpace),
    new Color().setRGB(0.26, 0.3, 0.24, SRGBColorSpace),
  ];
  dancers.forEach((d, i) => {
    q.setFromAxisAngle(up, d.yaw);
    m.compose(new Vector3(d.x, d.y, d.z), q, new Vector3(d.scale, d.scale, d.scale));
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, cloth[Math.floor(rng() * cloth.length)]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false; // arms swing past the static bounds
  mesh.name = 'cove-dancers';
  return mesh;
}

/** The glowsticks: a neon bar in each fist, following the same dance. */
function sticks(dancers: Dancer[]): Mesh {
  const base: number[] = [];
  const dat: number[] = []; // yaw, scale, mood, side
  const hue: number[] = [];
  const corner: number[] = [];
  const idx: number[] = [];
  let v = 0;
  for (const d of dancers) {
    const c = new Color().setHSL(d.hue, 1, 0.55);
    for (const side of [-1, 1]) {
      for (const [cx, cy] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
        base.push(d.x, d.y, d.z);
        dat.push(d.yaw, d.scale, d.mood, side);
        hue.push(c.r, c.g, c.b);
        corner.push(cx, cy);
      }
      idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
      v += 4;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(base, 3));
  g.setAttribute('aDat', new Float32BufferAttribute(dat, 4));
  g.setAttribute('aHue', new Float32BufferAttribute(hue, 3));
  g.setAttribute('aCorner', new Float32BufferAttribute(corner, 2));
  g.setIndex(new Uint32BufferAttribute(idx, 1));
  const mat = new ShaderMaterial({
    uniforms: { uTime: danceTime },
    vertexShader: /* glsl */ `
      attribute vec4 aDat;
      attribute vec3 aHue;
      attribute vec2 aCorner;
      varying vec3 vHue;
      varying vec2 vC;
      ${DANCE}
      void main() {
        float yaw = aDat.x, sc = aDat.y, mood = aDat.z, side = aDat.w;
        float seed = danceSeed(position.xz);
        float up = armUp(seed, mood, side);
        // the fist, and the stick running on along the arm
        vec3 hand = armPoint(vec3(0.0, -${ARM.toFixed(3)}, 0.0), side, up);
        vec3 dir = normalize(hand - armPoint(vec3(0.0, -0.3, 0.0), side, up));
        hand.y += danceBob(seed, mood);
        hand.x += sin(danceBeat(seed) * 0.5) * 0.04 * (0.4 + mood) * hand.y;
        float cy = cos(yaw), sy = sin(yaw);
        mat3 R = mat3(cy, 0.0, -sy, 0.0, 1.0, 0.0, sy, 0.0, cy);
        vec3 H = position + R * (hand * sc);
        vec3 D = R * dir;
        vec3 toCam = normalize(cameraPosition - H);
        vec3 across = normalize(cross(D, toCam));
        // long and haloed: they have to carry 45 m and more
        vec3 p = H + D * (aCorner.y * 0.46 - 0.05) + across * aCorner.x * 0.17;
        vHue = aHue;
        vC = aCorner;
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vHue;
      varying vec2 vC;
      void main() {
        // a white-hot core down the stick, the neon bleeding out either side
        float core = exp(-vC.x * vC.x * 60.0);
        float halo = exp(-vC.x * vC.x * 5.0) * 0.75;
        float ends = smoothstep(0.0, 0.15, vC.y) * smoothstep(1.0, 0.8, vC.y);
        vec3 c = (vHue * (halo + core) + vec3(core) * 0.6) * ends * 1.6;
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 6;
  mesh.name = 'cove-glowsticks';
  return mesh;
}

const danceTime = { value: 0 };

export interface Crowd {
  meshes: Mesh[];
  update(time: number): void;
}

/** A party round each of `fires` (the beach and grove bonfires). */
export function buildCrowd(fires: FireSpot[]): Crowd {
  const dancers = place(fires);
  return {
    meshes: [bodies(dancers), sticks(dancers)],
    update(time) {
      danceTime.value = time;
    },
  };
}
