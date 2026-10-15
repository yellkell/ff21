/**
 * THE MC's SUIT — the neon district headliner, armoured head to toe. Built
 * in Blender from code (tools/blender/mc_suit.py → public/club/mc_suit.glb)
 * and worn over the house dancer rig through its mounts (avatars.ts
 * DancerRig.mount), one rigid piece per bone so nothing stretches:
 *
 *   HELMET        headphones worn as a face — smoked visor over a lit EQ,
 *                 chrome-rimmed cans with burning rings, swept fins.
 *   MANTLE        cuirass with a spinning-PLATTER emblem on the chest, lit
 *                 chevrons, a standing collar, two lit speaker cones and a
 *                 chrome spine on the back.
 *   PAULDRON_*    three layered shoulder plates, lit rims, a bicep band.
 *   VAMBRACE_*    armoured forearms with a lit stripe and an elbow cop.
 *   GAUNTLET_*    armour over the mitt, lit knuckle studs and cuff.
 *   FAULD         belt and chrome buckle, hip plates, and long split COAT
 *                 TAILS — the headliner's silhouette from behind.
 *   CUISSE_*      thigh plates and chrome knee cops.
 *   GREAVE_*      shin guards with lit slits.
 *   BOOT_*        platform stompers on lit soles.
 *
 * The house suit underneath stays: its lit sleeves and midriff burn
 * between the plates. Every `glow_*` material becomes one of the rig's
 * ACCENTS, so the wardrobe hue and the amber of a charging move reach the
 * armour exactly as they reach the sleeves — `glow_core` hottest,
 * `glow_trim` at the sleeves' level. The chest's PLATTER turns at 33⅓
 * (McSystem). Same suit in the club and on raid nights — it's him.
 */
import {
  Bone,
  type BufferGeometry,
  Float32BufferAttribute,
  Matrix4,
  MeshStandardMaterial,
  type Material,
  type Mesh,
  type Object3D,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { ACCENT_REST, type DancerMounts, type DancerRig } from './avatars.js';
import { horizonEnv } from '../arena/voidSculpt.js';

const KIT_URL = 'club/mc_suit.glb';
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
 * The suit's surfaces as the game needs them. The visor becomes real smoke,
 * the EQ glowing through. `chrome` is polished silver; `armor` is black
 * lacquer — and a dark metal shows only what it reflects, so with nothing
 * to reflect it reads as a hole in the stage: it is lifted a step and both
 * wear the neon horizon (the void's own light) as their reflection.
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
    } else if (m.name.startsWith('chrome')) {
      c.color.setHex(0xc4c9d4);
      c.metalness = 0.95;
      c.roughness = 0.14;
    } else if (m.name.startsWith('armor')) {
      c.color.setHex(0x1b1e27);
      c.metalness = 0.6;
      c.roughness = 0.24;
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

/** How hot each glow tier burns, against the rig's own accent gain — kept
 *  under the point where WARN's 2.6× drive clips amber to white, so the
 *  armour burns the tell's colour and not just brighter. */
function glowGain(name: string): number {
  return name.startsWith('glow_core') ? 1.1 : 0.8;
}

/** What McSystem keeps hold of once he's dressed. */
export interface McSuit {
  /** The record on his chest — turn it about local Z (null until the
   *  suit has loaded, or if it never does). */
  platter: Object3D | null;
}

/** Which mount each piece rides. */
const PIECES: [string, keyof DancerMounts][] = [
  ['HELMET', 'head'],
  ['MANTLE', 'yoke'],
  ['FAULD', 'pelvis'],
  ['PAULDRON_L', 'upperL'],
  ['PAULDRON_R', 'upperR'],
  ['VAMBRACE_L', 'foreL'],
  ['VAMBRACE_R', 'foreR'],
  ['GAUNTLET_L', 'handL'],
  ['GAUNTLET_R', 'handR'],
  ['CUISSE_L', 'thighL'],
  ['CUISSE_R', 'thighR'],
  ['GREAVE_L', 'shinL'],
  ['GREAVE_R', 'shinR'],
  ['BOOT_L', 'bootL'],
  ['BOOT_R', 'bootR'],
];

/** A piece-local geometry, ready to merge: its mesh's transform baked in
 *  (relative to the bone frame it rides) and every vertex bound fully to
 *  bone `bone`. */
function bound(mesh: Mesh, frame: Object3D, bone: number): BufferGeometry {
  _rel.copy(frame.matrixWorld).invert().multiply(mesh.matrixWorld);
  const g = mesh.geometry.clone().applyMatrix4(_rel);
  // Only what the suit's surfaces read: no UVs, no tangents.
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const wt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = bone;
    wt[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new Float32BufferAttribute(wt, 4));
  return g;
}
const _rel = new Matrix4();

/**
 * Dress a house rig as the MC. Safe to call before the suit has loaded —
 * the pieces arrive when it does.
 *
 * QUEST BUDGET: fifteen pieces in five materials were ~60 draw calls if
 * each hung off its mount as its own meshes. Instead the whole suit is
 * FIVE skinned meshes — one per material — over a sixteen-bone skeleton
 * whose bones ARE the rig's mounts (plus the chest platter): every vertex
 * is bound 100% to the bone of the piece it came from, so each plate rides
 * its limb rigidly, exactly as if it were parented there, for a single
 * draw per material.
 */
export function dressMc(rig: DancerRig): McSuit {
  const suit: McSuit = { platter: null };
  const mount = rig.mount;
  if (!mount) return suit;
  loadKit()
    .then((src) => {
      // One accent per glow tier: the rig drives two materials, not one per
      // bar of piping.
      const glows = new Map<string, MeshStandardMaterial>();
      const glowFor = (name: string): MeshStandardMaterial => {
        let glow = glows.get(name);
        if (!glow) {
          glow = new MeshStandardMaterial({
            color: 0x101218,
            emissive: rig.baseColor,
            emissiveIntensity: ACCENT_REST * glowGain(name),
            metalness: 0.3,
            roughness: 0.4,
          });
          glows.set(name, glow);
          rig.accents.push({ mat: glow, gain: glowGain(name), neon: true, hot: name === 'glow_core' ? 0.3 : 0.12 });
        }
        return glow;
      };
      src.updateMatrixWorld(true);
      const bones: Bone[] = [];
      const byMaterial = new Map<string, { mat: Material; parts: BufferGeometry[] }>();
      const take = (root: Object3D, bone: number, skip?: Object3D): void => {
        root.traverse((n) => {
          const mesh = n as Mesh;
          if (!mesh.isMesh) return;
          // A child node with its own bone (the platter) is taken separately.
          for (let p: Object3D | null = mesh; p && p !== root; p = p.parent) if (p === skip) return;
          const m = mesh.material as Material;
          const key = m.name.replace(/\.\d+$/, '');
          let slot = byMaterial.get(key);
          if (!slot) {
            slot = { mat: key.startsWith('glow_') ? glowFor(key) : dressSurface(m), parts: [] };
            byMaterial.set(key, slot);
          }
          slot.parts.push(bound(mesh, root, bone));
        });
      };
      for (const [name, at] of PIECES) {
        const piece = src.getObjectByName(name);
        if (!piece) continue;
        const bone = new Bone();
        mount[at].add(bone); // the piece's frame IS the mount's
        bones.push(bone);
        const platter = piece.getObjectByName('PLATTER');
        take(piece, bones.length - 1, platter);
        if (platter) {
          // The record turns about its own axis, riding the chest.
          const spin = new Bone();
          spin.position.copy(platter.position);
          spin.quaternion.copy(platter.quaternion);
          bone.add(spin);
          bones.push(spin);
          take(platter, bones.length - 1);
          suit.platter = spin;
        }
        // The helmet IS his head and the boots ARE his feet: the house
        // pieces under them go dark.
        if (at === 'head' || at === 'bootL' || at === 'bootR') for (const k of mount[at].children) if (k !== bone) k.visible = false;
      }
      // Out of the scene entirely (not just hidden — a detail toggle would
      // bring them back): nothing can see them inside the plate.
      for (const m of rig.underSuit ?? []) m.removeFromParent();
      // Identity inverses: each bone's frame is the frame its piece was
      // authored in, so a vertex rides its bone's world matrix as-is.
      const skeleton = new Skeleton(bones, bones.map(() => new Matrix4()));
      for (const { mat, parts } of byMaterial.values()) {
        const geo = mergeGeometries(parts);
        for (const p of parts) p.dispose();
        if (!geo) continue;
        const skin = new SkinnedMesh(geo, mat);
        skin.name = 'mc-suit';
        skin.bind(skeleton, new Matrix4());
        // Bounds would be the bind pose's; he never leaves the stage.
        skin.frustumCulled = false;
        rig.root.add(skin);
      }
    })
    .catch(() => {
      /* no suit (offline / missing asset) — he performs in the house suit */
    });
  return suit;
}
