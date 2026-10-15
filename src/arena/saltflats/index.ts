/**
 * SALT FLATS — an open dusk backdrop, deliberately built LIGHT. The sense of
 * scale is a cheap gradient sky + a flat pan fogging into the horizon, so there
 * is almost no geometry and near-zero overdraw (the opposite of the enclosed
 * OLD FACTORY, which paid for a double-sided shell + a fistful of point lights).
 *
 * Perf note: the pan fills half the view, so its PER-PIXEL shader is the whole
 * scene's biggest fragment cost. It's a MeshLambertMaterial (cheap diffuse +
 * shadow + fog), NOT MeshStandardMaterial — no per-pixel image-based lighting
 * or specular across the whole floor, which is what made it heavy on Quest.
 *
 * Cost budget, roughly one draw call each:
 *   - a gradient sky dome (one ShaderMaterial, like the desert),
 *   - one ground plane (Lambert, vertex-coloured, fogged into the horizon),
 *   - a sun disc + halo (paper discs),
 *   - a single-ribbon mountain silhouette (one unlit, fog-exempt draw call),
 *   - 3 lights total (sun + ambient + hemi), no point lights.
 *
 * Same render-switch trick as the desert: the opaque dome paints out AR
 * passthrough. Nothing moves, so update() is a no-op.
 */

import {
  AmbientLight,
  BackSide,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { makePaperDouble, makeRng, valueNoise2D } from '../desert/paper.js';

export interface SaltFlats {
  root: Group;
  /** Fallback background colour behind the dome (the warm horizon band). */
  skyColor: Color;
  update(delta: number, time: number): void;
}

// Dusk / golden-hour palette.
const SKY_TOP = 0x172142; // deep indigo overhead
const SKY_HORIZON = 0xf3b072; // warm gold at eye level
const SKY_BOTTOM = 0x5c4f63; // muted dusk below the horizon
// Muted dusk-lit salt (NOT blazing white): a warm-pale crust on the swells, a
// cooler grey in the hollows. Vertex-coloured for tonal interest; the pan fades
// to the horizon via the scene fog.
const SALT_CREST = 0xcdc9c2; // warm pale on the rises
const SALT_HOLLOW = 0x8f898e; // cooler, dimmer in the dips
const MOUNTAIN = 0x2b2b47; // far dusky silhouettes

// The salt pan is gently sculpted so it isn't a dead-flat fill and so the
// fight platforms read as RAISED — the clearing around the origin is lowered
// (like the desert's platformReveal), leaving the pedestals standing proud.
const FLAT_RADIUS = 16; // level, lowered clearing around the platforms (m)
// Drop the clearing by a full pedestal thickness so the salt meets the slab's
// BASE and the whole pedestal stands proud (the arena/desert raised look);
// deeper than this and the salt sinks below the slab, reading as a saucer.
const PLATFORM_REVEAL = 0.15;
const SWELL_HEIGHT = 0.55; // amplitude of the slow salt swells farther out (m)

// The sun sits low over the FAR platform (−z), so it reads for a player facing
// their opponent. Everything warm keys off this direction.
const SUN_ELEV = 0.11; // fraction of a right-angle above the horizon
const SUN_AZ = new Vector3(0.18, 0, -0.98).normalize();

/** A big inward-facing gradient sky: indigo overhead → gold horizon → dusk floor. */
function makeSkyDome(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color(SKY_TOP) },
      horizon: { value: new Color(SKY_HORIZON) },
      bottom: { value: new Color(SKY_BOTTOM) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, bottom;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        // A tight warm band hugs the horizon, fading up to indigo and down to dusk.
        vec3 c = h > 0.0
          ? mix(horizon, top, smoothstep(0.0, 0.5, h))
          : mix(horizon, bottom, smoothstep(0.0, -0.25, h));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const dome = new Mesh(new SphereGeometry(800, 32, 16), mat);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

/** Slow salt swells + the lowered platform clearing. Near the origin the pan
 *  drops to −PLATFORM_REVEAL (a level basin) so the pedestals stand proud;
 *  farther out it rolls in gentle swells so it isn't a dead-flat sheet. */
const saltNoise = valueNoise2D(makeRng(0x5a17c0), 16);
function saltHeight(x: number, z: number): number {
  const swell =
    (saltNoise(x / 60 + 3, z / 60 + 3) - 0.5) * SWELL_HEIGHT +
    (saltNoise(x / 22 + 9, z / 22 + 9) - 0.5) * SWELL_HEIGHT * 0.35;
  const d = Math.hypot(x, z);
  const falloff = Math.min(1, Math.max(0, (d - FLAT_RADIUS) / FLAT_RADIUS));
  // Near platforms → flat, lowered clearing; farther out → the swells.
  return swell * falloff - PLATFORM_REVEAL * (1 - falloff);
}

/** The salt pan: a big plane pushed into gentle swells, vertex-coloured muted
 *  salt (crust on the rises, dimmer in the dips) so it reads with relief and
 *  isn't blown-out white. It looks infinite because the scene FOG melts its far
 *  reaches into the horizon band. Takes the platforms' (baked) shadow. */
function buildGround(parent: Group): void {
  const R = 750;
  const geo = new PlaneGeometry(R * 2, R * 2, 96, 96);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const crest = new Color(SALT_CREST);
  const hollow = new Color(SALT_HOLLOW);
  const tmp = new Color();
  const rng = makeRng(0x2b1e);
  const colors: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = saltHeight(x, z);
    pos.setY(i, y);
    // Tone by height (rises catch the light, hollows sit in shade) + a little
    // patchy jitter so the crust isn't uniform.
    const t = Math.min(1, Math.max(0, y / SWELL_HEIGHT + 0.5)) * (0.9 + rng() * 0.1);
    tmp.copy(hollow).lerp(crest, t);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  pos.needsUpdate = true;
  geo.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  // Lambert, not Standard: this plane fills half the view, so cheap per-pixel
  // diffuse (no IBL/specular) is the single biggest saving on Quest. Still lit
  // by the sun (relief on the swells), still takes the platforms' shadow, still
  // fogs into the horizon, still wears the muted vertex tone.
  const mat = new MeshLambertMaterial({ vertexColors: true, color: 0xffffff });
  const ground = new Mesh(geo, mat);
  // No receiveShadow: nothing in the salt flats casts a shadow (the platforms
  // and fighters don't castShadow — only the desert's props do), so sampling
  // the shadow map for every floor pixel would be pure waste on Quest.
  parent.add(ground);
}

/** A distant mountain range on the horizon — ONE ribbon of geometry: a ring
 *  wall whose base sits on the ground line and whose top edge zig-zags into
 *  peaks and valleys (layered noise). Flat unlit navy so it reads as a crisp
 *  silhouette against the glowing sky, dipping to a low valley under the sun so
 *  it rises over open flat. One draw call, no lighting, no fog. */
function buildMountains(parent: Group): void {
  const ring = 560;
  const N = 96; // ridge resolution around the horizon
  const rng = makeRng(0x9c33);
  const sunAngle = Math.atan2(SUN_AZ.x, SUN_AZ.z);
  // Per-point ridge height from layered sines + a little jitter.
  const ph1 = rng() * 6.28;
  const ph2 = rng() * 6.28;
  const ph3 = rng() * 6.28;
  const height = (a: number): number => {
    let h =
      42 +
      20 * Math.sin(a * 3 + ph1) +
      13 * Math.sin(a * 7 + ph2) +
      8 * Math.sin(a * 13 + ph3) +
      (rng() - 0.5) * 10;
    // Dip the range to a low ridge in a window around the sun.
    let da = a - sunAngle;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const dip = Math.min(1, Math.abs(da) / 0.7); // 0 at the sun → 1 outside the window
    h *= 0.18 + 0.82 * (dip * dip * (3 - 2 * dip));
    return Math.max(6, h);
  };

  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2;
    const sx = Math.sin(a) * ring;
    const sz = Math.cos(a) * ring;
    pos.push(sx, 0, sz); // base on the ground line
    pos.push(sx, height(a), sz); // jagged summit
  }
  for (let i = 0; i < N; i++) {
    const b0 = i * 2;
    const t0 = i * 2 + 1;
    const b1 = i * 2 + 2;
    const t1 = i * 2 + 3;
    idx.push(b0, b1, t1, b0, t1, t0); // two tris per segment
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new MeshBasicMaterial({ color: new Color(MOUNTAIN), side: DoubleSide, fog: false });
  parent.add(new Mesh(geo, mat));
}

export function buildSaltFlats(): SaltFlats {
  const root = new Group();
  root.name = 'saltflats-environment';
  root.visible = false;

  root.add(makeSkyDome());

  // A low warm sun keying the whole scene from over the far platform. It casts
  // NO shadow (nothing here casts one) — so no shadow-map pass for this
  // backdrop, and the floor never pays for shadow sampling.
  const e = SUN_ELEV * (Math.PI / 2);
  const sunDir = new Vector3(SUN_AZ.x * Math.cos(e), Math.sin(e), SUN_AZ.z * Math.cos(e)).normalize();
  const sun = new DirectionalLight(new Color('#ffcf9a'), 1.7);
  sun.position.copy(sunDir).multiplyScalar(60);
  root.add(sun, sun.target); // target at origin → sun points at the platforms

  root.add(new AmbientLight(new Color('#4a4668'), 0.4)); // cool dusk fill
  root.add(new HemisphereLight(new Color(SKY_HORIZON), new Color(SALT_CREST), 0.55));

  // Paper sun disc + halo low on the horizon.
  const halo = new Mesh(new CircleGeometry(52, 36), makePaperDouble('#ffca8a', 0.5));
  halo.position.copy(sunDir).multiplyScalar(602);
  halo.lookAt(0, halo.position.y, 0);
  root.add(halo);
  const disc = new Mesh(new CircleGeometry(30, 32), makePaperDouble('#ffe9c4', 1.2));
  disc.position.copy(sunDir).multiplyScalar(600);
  disc.lookAt(0, disc.position.y, 0);
  root.add(disc);

  buildGround(root);
  buildMountains(root);

  return {
    root,
    skyColor: new Color(SKY_HORIZON),
    update: () => {
      /* the flats are dead still — nothing to animate */
    },
  };
}
