/**
 * THE MC's COSTUME — the neon district headliner's kit, modelled in Blender
 * (blendercyber scripts/v2/dj_kit.py → public/club/mc_kit.glb) and worn over
 * the house dancer rig through its mounts (avatars.ts DancerRig.mount):
 *
 *   HELMET      on the head: a gunmetal shell, a wrap visor, ear cans with lit
 *               rings and a dorsal fin. The dancer's own head goes dark under it.
 *   MANTLE      on the yoke: a standing collar, layered shoulder plates, a
 *               harness with a lit buckle and the two-deck sigil on the back.
 *   GAUNTLET_*  on the hands: armour over the mitt, knuckle studs, lit cuffs.
 *
 * Every material named `glow_*` becomes one of the rig's ACCENTS (neon), so
 * the MC's wardrobe hue, the amber of a charging move and the authored
 * brightness hierarchy reach the costume exactly as they reach his sleeves.
 * Same kit in the club and on raid nights — it's him.
 */
import { MeshStandardMaterial, type Material, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ACCENT_REST, type DancerRig } from './avatars.js';
import { horizonEnv } from '../arena/voidSculpt.js';

const KIT_URL = 'club/mc_kit.glb';
let kit: Promise<Object3D> | null = null;

function loadKit(): Promise<Object3D> {
  kit ??= new Promise((resolve, reject) => {
    const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('draco/'));
    loader.load(KIT_URL, (gltf) => resolve(gltf.scene), undefined, reject);
  });
  return kit;
}

/** Dress a house rig as the MC. Safe to call before the kit has loaded —
 *  the pieces arrive when it does. */
/** Shared per source material, so every clone of a piece wears the same one. */
const dressed = new Map<Material, Material>();

/**
 * The kit's surfaces as the game needs them. glTF has no smoked glass, so
 * the visor exported as an opaque near-black pane over the lit band: it
 * becomes real smoke here, the band glowing through. And a fully metallic
 * dark gunmetal shows only what it reflects — with nothing to reflect it
 * read as a black hole: the shell becomes polished silver, metal and gloss
 * wear the neon horizon (the void's own light), and the near-blacks are
 * lifted enough to take a light.
 */
function dressSurface(m: Material): Material {
  const done = dressed.get(m);
  if (done) return done;
  let out: Material = m;
  const std = m as MeshStandardMaterial;
  if (std.isMeshStandardMaterial) {
    const c = std.clone();
    if (m.name.startsWith('visor_glass')) {
      c.color.setHex(0x0a0c12);
      c.transparent = true;
      c.opacity = 0.32;
      c.depthWrite = false;
      c.metalness = 0;
      c.roughness = 0.04;
    } else if (m.name.startsWith('gunmetal')) {
      // The shell, fin and armour: polished silver, so the stage's light
      // (and the visor's) runs over it instead of vanishing into it.
      c.color.setHex(0xc4c9d4);
      c.metalness = 0.9;
      c.roughness = 0.16;
    } else {
      const lum = c.color.r * 0.2126 + c.color.g * 0.7152 + c.color.b * 0.0722;
      if (lum < 0.06) c.color.multiplyScalar(Math.min(4, 0.06 / Math.max(lum, 0.005)));
    }
    if (c.metalness > 0.4 || c.roughness < 0.3 || c.transparent) {
      c.envMap = horizonEnv();
      c.envMapIntensity = 1.3;
    }
    c.needsUpdate = true;
    out = c;
  }
  dressed.set(m, out);
  return out;
}

export function dressMc(rig: DancerRig): void {
  const mount = rig.mount;
  if (!mount) return;
  loadKit()
    .then((src) => {
      const piece = (name: string): Object3D | null => {
        const o = src.getObjectByName(name);
        if (!o) return null;
        const c = o.clone(true);
        c.position.set(0, 0, 0); // authored in the mount's own frame
        c.traverse((n) => {
          const mesh = n as Mesh;
          if (!mesh.isMesh) return;
          const m = mesh.material as Material;
          if (!m.name.startsWith('glow_')) {
            mesh.material = dressSurface(m);
            return;
          }
          // One accent per piece-material, so the rig drives it like its own trim.
          const glow = new MeshStandardMaterial({
            color: 0x101218,
            emissive: rig.baseColor,
            emissiveIntensity: ACCENT_REST,
            metalness: 0.3,
            roughness: 0.4,
          });
          mesh.material = glow;
          rig.accents.push({ mat: glow, gain: 1, neon: true, hot: 0.35 });
        });
        return c;
      };
      const helmet = piece('HELMET');
      if (helmet) {
        for (const c of mount.head.children) c.visible = false; // the helmet IS his head now
        mount.head.add(helmet);
      }
      const mantle = piece('MANTLE');
      if (mantle) mount.yoke.add(mantle);
      const gl = piece('GAUNTLET_L');
      if (gl) mount.handL.add(gl);
      const gr = piece('GAUNTLET_R');
      if (gr) mount.handR.add(gr);
    })
    .catch(() => {
      /* no kit (offline / missing asset) — he performs in the house suit */
    });
}

