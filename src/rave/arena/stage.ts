/**
 * A sculpted nightclub riser: smoked lacquer, luminous glass and the
 * light show's crown lamps (arena/disco.ts) round the rim.
 *
 * The deck top is one clean sheet of smoked lacquer. No rings in it: the
 * painted teal pool in the middle and the six cyan footlight discs inside
 * the rim read as circles inside circles, and the footlights never lined
 * up with the laser lamps anyway. The glow lives at the edges now — the
 * bullnose, the fascia, the underlight — and the DJ stands on the dark.
 *
 * THE RIM IS PART OF THE LASER SHOW. The bullnose, the glass fascia and
 * their halo share one shader (rimMaterial) that DiscoSystem drives off
 * the same cue as every beam (lightshow.ts), through driveRim():
 *
 *   - the eight crown lamps spill their light along the glass either side
 *     of them, in their beams' own colour and brightness — so the chase,
 *     the act-0 rests and the hit all happen on the rim too;
 *   - the look's own pattern runs round it: the WAVE rolls round in step
 *     with the beams rising, the CHASE head laps it, MIRROR splits it into
 *     the sleeve's two colours swinging left against right, SWEEP slides
 *     stripes with the swing;
 *   - over a phrase's last bar a band races from your side round to the
 *     far side, where the beams are gathering on the record, and the
 *     downbeat's hit flashes the whole ring.
 *
 * It's cut into 96 LED segments so it reads as a fixture, not a glow. At
 * rest it holds the DJ's own colour (the MC's wardrobe hue), and the show
 * is laid over that at the pre-ducked energy — so a telegraph on your
 * deck drops it back to the DJ's colour.
 */
import {
  AdditiveBlending, CircleGeometry, Color, CylinderGeometry, Group,
  LatheGeometry, Mesh, MeshStandardMaterial, ShaderMaterial,
  TorusGeometry, Vector2,
} from 'three';
import { RING } from '../config.js';

/** The crown lamps the rim is fed by (disco.ts fires from these angles). */
export const RIM_LAMPS = 8;

function rimUniforms() {
  return {
    uBase: { value: new Color(0x20bfd5) },
    uA: { value: new Color(0xff2ad5) },
    uB: { value: new Color(0x4fe3ff) },
    uLamp: { value: new Float32Array(RIM_LAMPS * 3) },
    uGain: { value: 0 },
    uBeat: { value: 0 },
    uHit: { value: 0 },
    uGather: { value: 0 },
    uSwing: { value: 0 },
    uHead: { value: 0 },
    uDir: { value: 1 },
    uWave: { value: 0 },
    uChase: { value: 0 },
    uMirror: { value: 0 },
    uSweep: { value: 0 },
  };
}

/** The rim's shader. `halo` makes the soft additive sleeve round the glass. */
function rimMaterial(uniforms: ReturnType<typeof rimUniforms>, halo: boolean): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    defines: halo ? { HALO: 1 } : {},
    vertexShader: /* glsl */ `
      varying float vAng;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        // The light show's angle: 0 behind the DJ (−z), pi toward you.
        vAng = atan(wp.x - c.x, -(wp.z - c.z));
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uA;
      uniform vec3 uB;
      uniform vec3 uLamp[${RIM_LAMPS}];
      uniform float uGain;
      uniform float uBeat;
      uniform float uHit;
      uniform float uGather;
      uniform float uSwing;
      uniform float uHead;
      uniform float uDir;
      uniform float uWave;
      uniform float uChase;
      uniform float uMirror;
      uniform float uSweep;
      varying float vAng;
      const float TAU = 6.2831853;
      float adist(float a, float b) { return abs(mod(a - b + 3.14159265, TAU) - 3.14159265); }
      void main() {
        float a = vAng;
        vec3 show = vec3(0.0);
        // The lamps' light, spilling along the glass either side of each.
        for (int i = 0; i < ${RIM_LAMPS}; i++) {
          float d = adist(a, (float(i) + 0.5) / ${RIM_LAMPS}.0 * TAU);
          show += uLamp[i] * exp(-d * d * 14.0) * 0.45;
        }
        // WAVE: rolls round in step with the beams rising.
        show += uA * uWave * pow(0.5 + 0.5 * sin(uBeat / 4.0 * TAU - a), 3.0) * 0.9;
        // CHASE: the head laps the ring, a tail behind it.
        float behind = mod(uDir * (uHead - a), TAU);
        show += uB * uChase * exp(-behind * 1.4) * 1.1;
        // MIRROR: left against right, swinging.
        float side = a > 0.0 ? 1.0 : -1.0;
        show += mix(uB, uA, step(0.0, side)) * uMirror * (0.15 + 0.6 * max(0.0, uSwing * side));
        // SWEEP: stripes sliding with the swing.
        float stripe = 0.5 + 0.5 * sin(a * 6.0 + uSwing * 3.0);
        show += mix(uA, uB, stripe) * uSweep * 0.6 * stripe * stripe;
        // THE GATHER: a band racing from your side round to the far side.
        float to = adist(a, 0.0);
        float band = exp(-pow((to - 3.14159265 * (1.0 - uGather)) * 3.0, 2.0)) * step(0.001, uGather);
        show += mix(uA, vec3(1.0), 0.4) * (band * 1.3 + uGather * 0.2);
        // THE HIT.
        show += mix(uA, vec3(1.0), 0.6) * uHit * 1.3;
        // 96 LED segments, a hair of dark between.
        float sf = fract(a / TAU * 96.0);
        float seg = smoothstep(0.0, 0.1, sf) * smoothstep(1.0, 0.9, sf);
        vec3 c = (uBase * 0.25 + show * uGain) * mix(0.25, 1.0, seg);
        #ifdef HALO
          c *= 0.09;
        #endif
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`,
    ...(halo ? { transparent: true, blending: AdditiveBlending, depthWrite: false } : {}),
  });
}

export interface RimDrive {
  /** The DJ's colour — what the rim holds at rest. */
  base: Color;
  /** The sleeve's two lead laser colours. */
  a: Color;
  b: Color;
  /** Per crown lamp: colour × brightness, flat rgb (disco.ts lamps). */
  lamps: Float32Array;
  /** The show's brightness over the base, 0..1, pre-ducked. */
  gain: number;
  beat: number;
  hit: number;
  gather: number;
  swing: number;
  head: number;
  /** +1 / −1: the chase's lap direction. */
  dir: number;
  /** How much of each look's pattern, 0..1. */
  wave: number;
  chase: number;
  mirror: number;
  sweep: number;
}

/** Set the rim for this frame (both the glass and its halo share these). */
export function driveRim(mat: ShaderMaterial, d: RimDrive): void {
  const u = mat.uniforms;
  (u.uBase.value as Color).copy(d.base);
  (u.uA.value as Color).copy(d.a);
  (u.uB.value as Color).copy(d.b);
  (u.uLamp.value as Float32Array).set(d.lamps);
  u.uGain.value = d.gain;
  u.uBeat.value = d.beat;
  u.uHit.value = d.hit;
  u.uGather.value = d.gather;
  u.uSwing.value = d.swing;
  u.uHead.value = d.head;
  u.uDir.value = d.dir;
  u.uWave.value = d.wave;
  u.uChase.value = d.chase;
  u.uMirror.value = d.mirror;
  u.uSweep.value = d.sweep;
}

export function buildStage() {
  const stage = new Group();
  stage.name = 'goop-stage';
  const r = RING.stageRadius;
  const topY = RING.stageHeight;
  const lacquer = new MeshStandardMaterial({
    color: 0x0e1220, roughness: 0.23, metalness: 0.58,
    emissive: 0x080c19, emissiveIntensity: 0.6,
  });
  const metal = new MeshStandardMaterial({ color: 0x363d58, metalness: 0.8, roughness: 0.26 });
  const rubber = new MeshStandardMaterial({ color: 0x171719, metalness: 0.05, roughness: 0.85 });
  // The rim's glass and its halo: one set of uniforms, two materials.
  const rimU = rimUniforms();
  const neon = rimMaterial(rimU, false);
  const haloMat = rimMaterial(rimU, true);
  // The underlight: DiscoSystem pulses it on the beat (it used to pulse
  // six footlight discs on the deck top).
  const footlightMat = new MeshStandardMaterial({
    color: 0xb0ffff, emissive: 0x20dfff, emissiveIntensity: 1.1,
    roughness: 0.26, metalness: 0.05,
  });

  const deck = new Mesh(new CircleGeometry(r - 0.035, 96), lacquer);
  deck.name = 'stage-smoked-deck';
  deck.rotation.x = -Math.PI / 2;
  deck.position.y = topY;
  stage.add(deck);

  const edge = new Mesh(new LatheGeometry([
    new Vector2(r - 0.10, topY - 0.13),
    new Vector2(r - 0.015, topY - 0.12),
    new Vector2(r + 0.015, topY - 0.085),
    new Vector2(r + 0.02, topY - 0.035),
    new Vector2(r, topY - 0.006),
    new Vector2(r - 0.035, topY),
  ], 96), metal);
  edge.name = 'stage-rolled-edge';
  stage.add(edge);

  // A thick rounded glass fascia, set between physical metal shoulders.
  const fascia = new Mesh(new LatheGeometry([
    new Vector2(r - 0.09, topY - 0.29),
    new Vector2(r - 0.015, topY - 0.26),
    new Vector2(r + 0.025, topY - 0.20),
    new Vector2(r - 0.015, topY - 0.14),
    new Vector2(r - 0.09, topY - 0.12),
  ], 96), neon);
  fascia.name = 'stage-neon-glass-fascia';
  stage.add(fascia);
  const base = new Mesh(new LatheGeometry([
    new Vector2(r - 0.35, 0.015), new Vector2(r - 0.12, 0.04),
    new Vector2(r - 0.06, 0.10), new Vector2(r - 0.09, topY - 0.29),
  ], 96), metal);
  base.name = 'stage-sculpted-base';
  stage.add(base);

  const tube = (radius: number, thickness: number, y: number, material: MeshStandardMaterial | ShaderMaterial) => {
    const mesh = new Mesh(new TorusGeometry(radius, thickness, 10, 96), material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    stage.add(mesh);
    return mesh;
  };
  // Continuous glass bullnose and a recessed blue underlight give the riser
  // real volume. Soft halos surround opaque cores instead of replacing them.
  tube(r - 0.025, 0.04, topY - 0.015, neon).name = 'stage-neon-bullnose';
  tube(r - 0.15, 0.025, 0.065, footlightMat).name = 'stage-recessed-underlight';
  tube(r - 0.035, 0.105, topY - 0.08, haloMat).name = 'stage-rim-halo';

  // Shallow access steps on the audience side make this a usable stage.
  for (let i = 0; i < 2; i++) {
    const height = (i + 1) * topY / 3;
    const radius = r + 0.44 - i * 0.20;
    const step = new Mesh(new CylinderGeometry(radius, radius, height, 32, 1, false,
      -0.23, 0.46), rubber);
    step.position.y = height / 2;
    step.name = 'stage-access-step';
    stage.add(step);
  }

  return { stage, footlightMat, rimMat: neon, topY, dispose: () => {} };
}
