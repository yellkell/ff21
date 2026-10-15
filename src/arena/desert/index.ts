/**
 * Assembles the whole papercraft desert (ported from yellkell/vrenv) under ONE
 * Group so FIRE FIGHT can show/hide it as a single unit — the optional arena
 * backdrop behind the platforms. Unlike the standalone project, the sky and
 * lighting live in this group too (a gradient sky dome instead of the global
 * DomeGradient/IBLGradient components), so toggling the group's visibility
 * flips between the desert and bare AR passthrough cleanly.
 *
 * The opaque sky dome is what hides passthrough: in immersive-AR, opaque
 * geometry replaces the camera feed, so an enclosing dome reads as full VR.
 */

import {
  AdditiveBlending,
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  Object3D,
  Points,
  PointsMaterial,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './paper.js';
import { buildTerrain } from './terrain.js';
import { buildBoulders, buildMesas } from './rocks.js';
import { buildCacti } from './cactus.js';
import { buildAgave } from './agave.js';
import { animateClouds, buildClouds, type CloudDrift } from './clouds.js';
import { animateVultures, buildVultures } from './birds.js';
import { DustField } from './dustdevil.js';
import { animateTumbleweeds, buildTumbleweeds, type Tumbleweed } from './tumbleweed.js';
import { buildSites, SITE_YAW, type DesertSite } from './sites.js';
import { useStands } from './audience.js';
import { bindHazeSky, setHazeSun } from './haze.js';
import { makeSun } from './sun.js';

export type { DesertSite } from './sites.js';

/** A plant that leans back and forth in the wind about its base. */
export interface Swayer {
  obj: Object3D;
  phase: number;
  amp: number;
  speed: number;
}

export interface Desert {
  /** Everything: terrain, sky, sun, props. Toggle `.visible` to show/hide. */
  root: Group;
  /** Which of the three SITES is standing (sites.ts). */
  site: DesertSite;
  /** Walk to another site: swaps the near dressing and turns the far layer
   *  (sky, sun, skyline) to that site's heading. */
  setSite(site: DesertSite): void;
  /** Advance the living parts — sway, clouds, tumbleweeds, dust devils. */
  update(delta: number, time: number): void;
}

/** A big inward-facing gradient sky sphere. The blood-orange band lives
 *  on ONE horizon — under the dying sun — and thins and cools to a dusty
 *  mauve as you turn away from it, so the sky has a direction and the
 *  night is already arriving behind you. */
function makeSkyDome(sunDir: Vector3): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new Color(CONFIG.sky.top) },
      horizon: { value: new Color(CONFIG.sky.horizon) },
      dusk: { value: new Color(CONFIG.sky.dusk) },
      bottom: { value: new Color(CONFIG.sky.bottom) },
      sun: { value: sunDir.clone() },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 top, horizon, dusk, bottom, sun;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        // How squarely this heading faces the dying sun: 1 under it, 0 behind you.
        float toward = 0.5 + 0.5 * dot(normalize(vec3(vDir.x, 0.0, vDir.z)), normalize(vec3(sun.x, 0.0, sun.z)));
        float t = pow(toward, 2.4);
        vec3 band = mix(dusk, horizon, t);
        // The band is tall and hot under the sun, low and cool away from it.
        float reach = 0.16 + 0.32 * t;
        vec3 c = h > 0.0
          ? mix(band, top, smoothstep(0.0, reach, h))
          : mix(band, bottom, smoothstep(0.0, -0.35, h));
        // THE SUN'S LIGHT IN THE AIR: a hot bloom close round it and a long warm
        // wash far out, both dying below the horizon line. This is what stops
        // the sun (sun.ts) being a sticker on the sky — the sky itself is lit.
        float s = max(dot(normalize(vDir), normalize(sun)), 0.0);
        float lit = smoothstep(-0.10, 0.04, h);
        c += vec3(1.0, 0.50, 0.20) * (0.34 * pow(s, 90.0) + 0.16 * pow(s, 14.0)) * lit;
        c += vec3(0.55, 0.12, 0.05) * 0.10 * pow(s, 3.0) * lit;
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const dome = new Mesh(new SphereGeometry(800, 32, 16), mat);
  dome.renderOrder = -1; // paint the sky first, everything draws over it
  dome.frustumCulled = false;
  return dome;
}

/** Early stars over the dying light: none in the orange band, thickening
 *  toward the zenith, each with its own brightness — one Points draw. */
function makeStars(): Points {
  const { count, minElevation, radius } = CONFIG.stars;
  const rng = makeRng(CONFIG.terrain.seed * 7 + 1);
  const pos = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Bias the density upward: elevation from a squared roll.
    const elev = minElevation + (1 - minElevation) * Math.sqrt(rng());
    const phi = Math.asin(elev);
    const theta = rng() * Math.PI * 2;
    pos[i * 3] = Math.cos(phi) * Math.cos(theta) * radius;
    pos[i * 3 + 1] = Math.sin(phi) * radius;
    pos[i * 3 + 2] = Math.cos(phi) * Math.sin(theta) * radius;
    // Cool white with the odd warm one, fading toward the horizon band.
    const b = (0.35 + 0.65 * rng()) * Math.min(1, (elev - minElevation) * 6 + 0.25);
    const warm = rng() < 0.12;
    col[i * 3] = b * (warm ? 1 : 0.82);
    col[i * 3 + 1] = b * (warm ? 0.85 : 0.86);
    col[i * 3 + 2] = b * (warm ? 0.7 : 1);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  geo.setAttribute('color', new BufferAttribute(col, 3));
  const mat = new PointsMaterial({
    size: 2.4,
    sizeAttenuation: false,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const stars = new Points(geo, mat);
  stars.frustumCulled = false;
  return stars;
}

/**
 * HEAT HAZE: a thin additive band riding the horizon just inside the dome,
 * its alpha a slow ripple of two sines in u and v so the sun band and the
 * mesa feet appear to swim the way distance does over hot ground at dusk.
 * One draw, no render target, no refraction — the shimmer is in the light.
 */
function makeHaze(): { mesh: Mesh; mat: ShaderMaterial } {
  const mat = new ShaderMaterial({
    side: BackSide,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: {
      time: { value: 0 },
      tint: { value: new Color(CONFIG.sky.horizon) },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float time;
      uniform vec3 tint;
      varying vec2 vUv;
      void main() {
        // Strongest just above the ground line, gone a few degrees up.
        float band = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.25, 1.0, vUv.y));
        // Two slow, incommensurate ripples — a swim, never a hatch.
        float w = sin(vUv.x * 61.0 + time * 0.7 + sin(vUv.y * 9.0 + time * 0.4) * 2.0);
        float r = 0.5 + 0.5 * sin(vUv.x * 23.0 - time * 0.5 + w * 1.5);
        float a = band * (0.05 + 0.07 * r);
        gl_FragColor = vec4(tint * 1.3, a);
      }
    `,
  });
  // 560 m out, 70 m tall, its foot 8 m under the eye: elevation −0.8° → +6°.
  const geo = new CylinderGeometry(560, 560, 70, 72, 1, true);
  const mesh = new Mesh(geo, mat);
  mesh.position.y = 27;
  mesh.frustumCulled = false;
  return { mesh, mat };
}

/**
 * DUST MOTES in the arena's light: a cloud of tiny warm points drifting
 * through the volume the key light fills between the platforms, rising and
 * sinking on nothing, recycled at the box edges. They're what makes the
 * light cone a THING you're standing in, and they cost one draw.
 */
function makeMotes(): { points: Points; vel: Float32Array; box: { x: number; y0: number; y1: number; z0: number; z1: number } } {
  const box = { x: 2.6, y0: 0.15, y1: 3.1, z0: 1.4, z1: -4.8 };
  const n = 90;
  const rng = makeRng(CONFIG.terrain.seed * 17 + 5);
  const pos = new Float32Array(n * 3);
  const vel = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = (rng() * 2 - 1) * box.x;
    pos[i * 3 + 1] = box.y0 + rng() * (box.y1 - box.y0);
    pos[i * 3 + 2] = box.z1 + rng() * (box.z0 - box.z1);
    vel[i] = (rng() - 0.35) * 0.08; // mostly a slow rise
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(pos, 3));
  // A soft round sprite: a square point reads as snow, a fading disc as dust.
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const mat = new PointsMaterial({
    color: 0xffc89a,
    map: new CanvasTexture(c),
    size: 0.03,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.32,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const points = new Points(geo, mat);
  points.frustumCulled = false;
  return { points, vel, box };
}

export function buildDesert(): Desert {
  const root = new Group();
  root.name = 'desert-environment';
  root.visible = false;

  // THE FAR LAYER: everything that is "the desert" rather than "this
  // spot in it" — sky, stars, the sun and its light, the ground, mesas,
  // plants, weather. It turns as one to face each site (SITE_YAW), which
  // is how three clearings share one horizon and still feel like three
  // places. The sites' near dressing hangs off the root, un-turned.
  const far = new Group();
  far.name = 'desert-far';
  root.add(far);

  // A low warm sun — ambiguous sunrise/sunset, with long readable shadows.
  const e = CONFIG.mood.sunElevation * (Math.PI / 2);
  const sunDir = new Vector3(0.35 * Math.cos(e), Math.sin(e), -0.94 * Math.cos(e)).normalize();

  const dome = makeSkyDome(sunDir);
  far.add(dome);
  // The haze (haze.ts) fades the far layer into the SAME band colours the
  // dome paints, so a hazed mesa foot and the sky behind it agree.
  const domeU = (dome.material as ShaderMaterial).uniforms;
  bindHazeSky(domeU.horizon.value as Color, domeU.dusk.value as Color);
  far.add(makeStars());

  // The dying sun: deeper, lower, still the longest shadows in the game.
  const sun = new DirectionalLight(new Color('#ff8d4e'), 1.5);
  sun.position.copy(sunDir).multiplyScalar(55);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0004;
  const cam = sun.shadow.camera;
  cam.near = 8;
  cam.far = 140;
  cam.left = cam.bottom = -42;
  cam.right = cam.top = 42;
  cam.updateProjectionMatrix();
  far.add(sun);
  far.add(sun.target); // target sits at the origin → sun points at the platforms

  far.add(new AmbientLight(new Color('#332c4a'), 0.3)); // night creeping in
  far.add(new HemisphereLight(new Color(CONFIG.ibl.sky), new Color(CONFIG.ibl.ground), 0.55));

  // The dying sun on the horizon, swollen the way a sunset sun reads
  // (sun.ts): one clean disc, gold heart to ember rim, and a corona
  // bleeding into the glow the dome paints round it.
  const sunDisc = makeSun(sunDir);
  far.add(sunDisc.mesh);

  // The world itself.
  buildTerrain(far);
  buildMesas(far);
  buildBoulders(far);
  const swayers: Swayer[] = [...buildCacti(far), ...buildAgave(far)];
  const weeds: Tumbleweed[] = buildTumbleweeds(far);
  const clouds: CloudDrift[] = buildClouds(far);
  const vultures = buildVultures(far);
  const dust = new DustField(far);
  const haze = makeHaze();
  far.add(haze.mesh);
  // The motes hang in the ARENA's light, so they stay in the un-turned root.
  const motes = makeMotes();
  root.add(motes.points);

  // THE SITES: the trailhead, the flats, the boneyard.
  const sites = buildSites();
  for (const s of Object.values(sites)) root.add(s.root);

  const desert: Desert = {
    root,
    site: 'trailhead',
    setSite(site) {
      desert.site = site;
      useStands(site); // the terraces a watcher can stand on here
      far.rotation.y = SITE_YAW[site];
      setHazeSun(sunDir, SITE_YAW[site]); // the band swings round; so must the haze
      for (const [k, s] of Object.entries(sites)) s.root.visible = k === site;
    },
    update: (delta, time) => {
      for (const s of swayers) s.obj.rotation.z = Math.sin(time * s.speed + s.phase) * s.amp;
      animateClouds(clouds, delta);
      animateTumbleweeds(weeds, delta, time);
      animateVultures(vultures, time);
      dust.update(delta, time);
      sites[desert.site].update(delta, time);
      haze.mat.uniforms.time.value = time;
      // Drift the motes; recycle at the box faces so the cloud never thins.
      const mp = motes.points.geometry.attributes.position as BufferAttribute;
      const arr = mp.array as Float32Array;
      const { x: bx, y0, y1, z0, z1 } = motes.box;
      for (let i = 0; i < motes.vel.length; i++) {
        arr[i * 3 + 1] += motes.vel[i] * delta;
        arr[i * 3] += Math.sin(time * 0.35 + i * 0.7) * 0.04 * delta;
        arr[i * 3 + 2] += Math.cos(time * 0.27 + i * 1.3) * 0.04 * delta;
        if (arr[i * 3 + 1] > y1) arr[i * 3 + 1] = y0;
        else if (arr[i * 3 + 1] < y0) arr[i * 3 + 1] = y1;
        if (arr[i * 3] > bx) arr[i * 3] = -bx;
        else if (arr[i * 3] < -bx) arr[i * 3] = bx;
        if (arr[i * 3 + 2] > z0) arr[i * 3 + 2] = z1;
        else if (arr[i * 3 + 2] < z1) arr[i * 3 + 2] = z0;
      }
      mp.needsUpdate = true;
    },
  };
  desert.setSite('trailhead');
  return desert;
}
