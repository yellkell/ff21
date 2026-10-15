/**
 * NEON — a rain-soaked Tokyo back-street district, built in Blender
 * (blendercyber/scripts/v2) and baked down to unlit atlases, so each site
 * costs ~15 draws and no lights. Two SITES, like the desert's:
 *
 *   BACKSTREET  the lobby. A 5 m back alley: vending machines, the ramen
 *               stall, lanterns, the alley mouth opening onto hover traffic.
 *               You stand at its dead end with the menu in front of you.
 *   PLAZA       every fight. The square where four alleys meet, laid out
 *               around FIRE FIGHT's own furniture: the whole fireball cage
 *               (ARENA_BOUNDS) is open paving, the raid pit sits under open
 *               sky at [0, 0, -6] with the neon alley vista straight behind
 *               it, every prop lives between the cage and the shopfronts, and
 *               cables over the square stay above 12.5 m so a stage-V titan
 *               rises clear. It reads the same from every raid seat.
 *
 *   public/arena/neon/backstreet.glb   lobby district
 *   public/arena/neon/neon_plaza.glb   fight district
 *   public/arena/neon/vehicles.glb     the hover-traffic fleet (animated here)
 *   public/arena/neon/sky_dome.jpg     night sky (equirect)
 *   public/arena/neon/env_*.jpg        each site's own reflections for the wet ground/puddles
 *   public/draco/                      Draco decoders (vendored, no CDN)
 *   public/basis/                      KTX2/Basis transcoder (vendored): the atlases ship
 *                                      as UASTC KTX2 and stay GPU-compressed (ASTC on Quest)
 *
 * Colour: the atlases are tone-mapped (AgX) at bake time and the headset
 * renders with no tone mapping, so MeshBasic shows them 1:1.
 */

import {
  AdditiveBlending,
  BackSide,
  Color,
  EquirectangularReflectionMapping,
  FogExp2,
  Group,
  Mesh,
  MeshBasicMaterial,
  PointLight,
  SphereGeometry,
  SRGBColorSpace,
  TextureLoader,
  type Material,
  type MeshStandardMaterial,
  type Object3D,
  type Texture,
  type Vector3,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { Traffic, BACKSTREET_LANES, PLAZA_LANES } from './traffic.js';
import { setStageRaised, STAGE_RAISE } from '../arena.js';
import { setStreetDecks } from '../../avatar/skins.js';

export type NeonSite = 'backstreet' | 'plaza';

export interface Neon {
  root: Group;
  /** Behind-everything clear colour and the haze's: wet violet night. */
  skyColor: Color;
  fog: FogExp2;
  /** True once both districts and the traffic have loaded. */
  readonly ready: boolean;
  readonly site: NeonSite;
  setSite(site: NeonSite): void;
  /** NEON is the active environment (plinths only stand in the plaza while it is). */
  setShown(on: boolean): void;
  /** `eye`: the viewer's world position (car halos + wet-road reflections face it). */
  update(delta: number, time: number, eye?: Vector3): void;
}

const BASE = 'arena/neon/';
const SKY = new Color(0x150a1c);

/** `renderer` lets the KTX2 loader pick the GPU's compressed format. */
export function buildNeon(renderer: WebGLRenderer): Neon {
  const root = new Group();
  root.name = 'neon';
  root.visible = false;
  const fog = new FogExp2(SKY.getHex(), 0.012);
  const sites: Record<NeonSite, Group> = { backstreet: new Group(), plaza: new Group() };
  sites.backstreet.name = 'neon-backstreet';
  sites.plaza.name = 'neon-plaza';
  root.add(sites.backstreet, sites.plaza);
  // THE STAGE: the plaza street sits STAGE_RAISE below the fight line, so
  // every deck (still y = 0 for combat) stands on a lit plinth above the wet
  // paving. The lobby keeps its feet on the alley floor.
  sites.plaza.position.y = -STAGE_RAISE;
  const neonMats: MeshBasicMaterial[] = [];
  const traffic: Partial<Record<NeonSite, Traffic>> = {};
  const envs: Partial<Record<NeonSite, Texture>> = {};
  let site: NeonSite = 'backstreet';
  let loaded = 0;

  // Fighters are lit PBR; tint them with the district without touching the
  // (unlit) streets: a pink key off the bar fronts, a cyan rim from the vista.
  const pink = new PointLight(0xff3a8c, 6, 18, 1.6);
  pink.position.set(-7, 4.5, -2);
  const cyan = new PointLight(0x2fd8ff, 5, 20, 1.6);
  cyan.position.set(5, 5, -11);
  sites.plaza.add(pink, cyan);
  const lobbyKey = new PointLight(0xff4fa0, 3, 10, 1.8);
  lobbyKey.position.set(-2, 3, -3);
  sites.backstreet.add(lobbyKey);

  const tex = new TextureLoader();
  tex.load(BASE + 'sky_dome.jpg', (t) => {
    t.mapping = EquirectangularReflectionMapping;
    t.colorSpace = SRGBColorSpace;
    const dome = new Mesh(
      new SphereGeometry(1400, 48, 24),
      new MeshBasicMaterial({ map: t, side: BackSide, fog: false, depthWrite: false }),
    );
    dome.renderOrder = -1;
    dome.name = 'neon-sky';
    root.add(dome);
  });

  const draco = new DRACOLoader().setDecoderPath('draco/');
  const ktx2 = new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setDRACOLoader(draco).setKTX2Loader(ktx2);

  const dress = (key: NeonSite, group: Group, file: string, envFile: string) => {
    let env: Texture | null = null;
    const wet: MeshStandardMaterial[] = [];
    tex.load(BASE + envFile, (t) => {
      t.mapping = EquirectangularReflectionMapping;
      t.colorSpace = SRGBColorSpace;
      env = t;
      envs[key] = t;
      traffic[key]?.setEnv(t);
      for (const m of wet) {
        m.envMap = t;
        m.needsUpdate = true;
      }
    });
    loader.load(BASE + file, (gltf) => {
      gltf.scene.traverse((o: Object3D) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        const ud = o.userData ?? {};
        const mat = mesh.material as Material & MeshBasicMaterial;
        if (ud.blending === 'additive') {
          mat.blending = AdditiveBlending;
          mat.depthWrite = false;
          mat.transparent = true;
          mat.fog = false;
          mesh.renderOrder = 10;
        }
        if (ud.iwsdk === 'neon') neonMats.push(mat);
        if (ud.iwsdk === 'neon' || ud.iwsdk === 'screen') mat.fog = false;
        if (ud.iwsdk === 'glass') {
          mat.transparent = true;
          mat.depthWrite = false;
          mesh.renderOrder = 5;
        }
        // The wet ground and puddles reflect THIS street, not the arena's
        // studio environment (which would wash the asphalt out grey).
        const sm = mesh.material as MeshStandardMaterial;
        if (sm.isMeshStandardMaterial) {
          sm.envMapIntensity = 0.9;
          if (env) sm.envMap = env;
          else wet.push(sm);
        }
      });
      group.add(gltf.scene);
      loaded++;
    });
  };
  dress('backstreet', sites.backstreet, 'backstreet.glb', 'env_backstreet.jpg');
  dress('plaza', sites.plaza, 'neon_plaza.glb', 'env_plaza.jpg');
  loader.load(BASE + 'vehicles.glb', (gltf) => {
    traffic.backstreet = new Traffic(sites.backstreet, gltf.scene, BACKSTREET_LANES, envs.backstreet);
    traffic.plaza = new Traffic(sites.plaza, gltf.scene, PLAZA_LANES, envs.plaza);
    loaded++;
  });

  let shown = false;
  const apply = () => {
    sites.backstreet.visible = site === 'backstreet';
    sites.plaza.visible = site === 'plaza';
    setStageRaised(shown && site === 'plaza');
    // The district's road: the house decks are laid as its cast-iron plate.
    setStreetDecks(shown);
  };
  apply();

  return {
    root,
    skyColor: SKY,
    fog,
    get ready() {
      return loaded >= 3;
    },
    get site() {
      return site;
    },
    setSite(s) {
      site = s;
      apply();
    },
    setShown(on) {
      shown = on;
      apply();
    },
    update(delta, time, eye) {
      // Mains buzz on the tubes, with the odd dropout.
      const k = 0.94 + 0.06 * Math.sin(time * 50) * Math.sin(time * 3.1) - (Math.sin(time * 0.7) > 0.995 ? 0.5 : 0);
      for (const m of neonMats) m.color.setScalar(k);
      traffic[site]?.update(Math.min(delta, 0.1), time, eye);
    },
  };
}
