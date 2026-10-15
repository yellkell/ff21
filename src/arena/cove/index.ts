/**
 * THE COVE — a slice of Tidewater's island (github.com/dgreenheck/tidewater
 * by Daniel Greenheck, MIT) with FIRE FIGHT standing on its beach.
 *
 * Tidewater is a WebGPU / WGSL engine with no three.js in it; FIRE FIGHT is
 * three.js WebGL on a headset. So nothing is dropped in: the LOOK is ported,
 * piece by piece, onto the cheapest machinery that holds it —
 *
 *   sky      the Rayleigh/Mie/ozone atmosphere + sunlit cumulus, raymarched
 *            ONCE into an HDR equirect over a few frames (sky.ts)
 *   sea      Tidewater's water optics over an analytic seabed and a
 *            closed-form surf model — shoaling, breaking on the bar, swash
 *            (water.ts, shape.ts)
 *   beach    Tidewater's foreshore/berm profile and coral-sand palette, wind
 *            ripples, the wet band (terrain.ts)
 *   palms    Tidewater's procedural coconut palm, leaflets cut per pixel
 *            (palms.ts)
 *   the rest sea stacks, shore boulders, the jungle canopy (dressing.ts)
 *
 * And then it's made FIRE FIGHT's: the sun going down over the sea ahead,
 * the beach party's bonfires burning up both arms of the bay, on the
 * headland cliff tops and back in the palms (bonfires.ts), a crowd dancing
 * round them with glowsticks (crowd.ts), tiki torches ringing the arena,
 * clouds drifting over, and the surf breaking in time with the waves you
 * can see (sound.ts).
 *
 * Like every backdrop it lives under ONE group, and like the desert its
 * opaque dome paints passthrough out. It is built LAZILY — only when the
 * cove is first chosen — and reports `ready` once its sky has finished
 * baking, so the switch never shows a half-painted sky.
 */

import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  SRGBColorSpace,
  type WebGLRenderer,
} from 'three';
import { createSkyBake, makeSkyDome, skyTime } from './sky.js';
import { buildSea } from './water.js';
import { buildTerrain } from './terrain.js';
import { buildPalms } from './palms.js';
import { buildCanopy, buildRocks, palmSpots } from './dressing.js';
import { buildBonfires, TORCH_POLE, type FireSpot } from './bonfires.js';
import { buildCrowd } from './crowd.js';
import { createCoveSound } from './sound.js';
import { groundY } from './terrain.js';
import { CLEARING, shoreZ, SUN_DIR } from './shape.js';

export interface Cove {
  root: Group;
  /** Behind-the-dome clear colour and the fog's: the horizon haze. */
  skyColor: Color;
  /** The aerial haze that melts the far sea and headlands into the sky. */
  fog: Fog;
  /** True once the sky bake is complete and the cove may be shown. */
  readonly ready: boolean;
  /** Advance the sky bake (one strip) — call every frame until `ready`. */
  bake(renderer: WebGLRenderer): boolean;
  update(delta: number, time: number): void;
}

/** Sun irradiance (the directional light) and sky irradiance (the
 *  hemisphere) — the water shader is fed the same numbers, so the sea and
 *  the sand agree on how bright the evening is. SUNDOWN: a low copper sun,
 *  a dusk-violet sky dome, warm bounce off the sand. */
const SUN_COLOR = new Color().setRGB(1.0, 0.42, 0.16, SRGBColorSpace);
const SUN_INTENSITY = 2.6;
const SKY_TOP = new Color().setRGB(0.5, 0.4, 0.5, SRGBColorSpace);
const SKY_GROUND = new Color().setRGB(0.6, 0.36, 0.24, SRGBColorSpace);
const HEMI_INTENSITY = 0.7;

/** The bonfires, all well outside the arena: [x, metres inland from the
 *  waterline at that x, size]. */
const FIRES: [number, number, number][] = [
  [-66, 15, 1.0], //   left arm of the beach
  [84, 14, 1.1], //    right arm
  [-138, 19, 1.0], //  further down the left beach
  [132, 17, 0.9], //   under the east headland
  [212, 58, 1.8], //   signal fire on the east cliffs
  [-238, 48, 1.7], //  signal fire on the west ridge
  [-46, 66, 0.9], //   back in the palms, behind you (left)
  [62, 72, 0.9], //    back in the palms, behind you (right)
];

/** Tiki torches round the clearing's edge — the sides and behind you only:
 *  nothing flickers in the sector ahead, where the rival, the titans and
 *  every incoming fireball are. Angles from +x, counter-clockwise seen from
 *  above with −z (the sea) at −90°; the front 120° is left dark. */
function torchSpots(): FireSpot[] {
  const out: FireSpot[] = [];
  for (let deg = -30; deg <= 210.1; deg += 20) {
    const a = (deg * Math.PI) / 180;
    const x = CLEARING.x + Math.cos(a) * CLEARING.rx * 1.06;
    const z = CLEARING.z + Math.sin(a) * CLEARING.rz * 1.06; // sin −1 = the sea side
    const ground = groundY(x, z);
    out.push({ x, y: ground + TORCH_POLE, z, size: 0.2, torch: true, ground });
  }
  return out;
}

export function buildCove(quality = 1): Cove {
  const root = new Group();
  root.name = 'cove-environment';
  root.visible = false;

  const bake = createSkyBake(quality);
  root.add(makeSkyDome(bake));

  // ---- light
  const sun = new DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.position.copy(SUN_DIR).multiplyScalar(80);
  sun.target.position.set(0, 0, -4);
  sun.position.add(sun.target.position);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0003;
  sun.shadow.normalBias = 0.02;
  const cam = sun.shadow.camera;
  // the palms around you and the sand their shadows fall on
  cam.left = -48;
  cam.right = 48;
  cam.top = 48;
  cam.bottom = -48;
  cam.near = 5;
  cam.far = 240;
  cam.updateProjectionMatrix();
  root.add(sun, sun.target);
  const hemi = new HemisphereLight(SKY_TOP, SKY_GROUND, HEMI_INTENSITY);
  root.add(hemi);
  root.add(new AmbientLight(new Color().setRGB(0.42, 0.34, 0.5, SRGBColorSpace), 0.05));

  const sunE = SUN_COLOR.clone().multiplyScalar(SUN_INTENSITY);
  // the sky's irradiance on flat water: the hemisphere's upper half
  const skyE = SKY_TOP.clone().multiplyScalar(HEMI_INTENSITY * 0.92);

  // ---- the world
  const land = buildTerrain();
  root.add(land);
  const sea = buildSea(bake.atmosphere, bake.clouds, SUN_DIR, sunE, skyE);
  root.add(sea.mesh);
  root.add(buildRocks());
  root.add(buildCanopy());
  const spots = palmSpots();
  const palms = buildPalms(spots.near, spots.far, SUN_DIR, sunE);
  root.add(palms.near, palms.far);

  const spotsF: FireSpot[] = FIRES.map(([x, e, size]) => {
    const z = shoreZ(x) + e;
    return { x, y: groundY(x, z), z, size };
  });
  const torches = torchSpots();
  const fires = buildBonfires([...spotsF, ...torches]);
  root.add(...fires.meshes);
  // a party round every fire on the sand (not the cliff-top signal fires)
  const crowd = buildCrowd(spotsF.filter((f) => f.size < 1.5));
  root.add(...crowd.meshes);
  const sound = createCoveSound([...spotsF, ...torches]);

  // the haze: dusk mauve with the sunset's warmth in it
  const horizon = new Color().setRGB(0.6, 0.36, 0.26, SRGBColorSpace);
  const fog = new Fog(horizon, 120, 3400);

  return {
    root,
    skyColor: horizon,
    fog,
    get ready() {
      return bake.done;
    },
    bake(renderer) {
      return bake.step(renderer);
    },
    update(delta, time) {
      sea.update(time);
      palms.update(time);
      fires.update(time);
      crowd.update(time);
      skyTime.value = time;
      sound.update(time, delta, root.visible);
    },
  };
}
