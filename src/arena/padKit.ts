/**
 * THE MACHINED PAD — the Blender-built fight pad (blendercyber scripts/v2/
 * pad_kit.py → public/store/pad_kit.glb) swapped onto every pedestal the
 * game builds: yours, the other fighters', the raid pit, the pub's.
 *
 * Every pad is born procedural (arena.ts makePlatform) so nothing waits on
 * the network; when the kit lands each one is UPGRADED in place:
 *
 *   PAD_DECK   replaces the slab's geometry — same metre UVs, so every deck
 *              style's tile lands exactly where it did; the slab keeps its
 *              own material (role 'slab'), so skins re-deck it as before.
 *   PAD_BEZEL  the machined frame with the rim's channel  → the pad's 'trim'
 *   PAD_BOLTS  socket heads in counterbores               → 'trim' + steel
 *   PAD_SKIRT  the ribbed pedestal fascia                 → steel + 'trim'
 *   PAD_VENTS  the lit vent slots                         → the pad's 'neon-core'
 *
 * Because the kit's pieces wear each pad's OWN role materials, applyPlatform-
 * Skin / tintPlatform keep working untouched: a skin that recolours the trim
 * recolours the bezel and the bolts; a team tint lights the vents with the rim.
 */
import { MeshStandardMaterial, type Group, type Material, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface PadParts {
  group: Group;
  slab: Mesh;
  bolts: Object3D;
  hazard: Object3D;
  rim: Object3D;
  slabMat: Material;
  trimMat: Material;
  coreMat: Material;
}

const pads: PadParts[] = [];
let kit: Object3D | null = null;
let loading = false;
let steel: MeshStandardMaterial | null = null;

/** Register a freshly built pad; it upgrades now if the kit is in, or when it lands. */
export function registerPad(p: PadParts): void {
  pads.push(p);
  if (kit) upgrade(p);
  else if (!loading) {
    loading = true;
    new GLTFLoader().load(
      'store/pad_kit.glb',
      (gltf) => {
        kit = gltf.scene;
        for (const q of pads) upgrade(q);
      },
      undefined,
      () => {
        /* no kit — the procedural pads stand as they are */
      },
    );
  }
}

function upgrade(p: PadParts): void {
  if (!kit || p.group.userData.machined) return;
  p.group.userData.machined = true;
  steel ??= new MeshStandardMaterial({ color: 0x090a0c, metalness: 0.8, roughness: 0.38 });
  const roleOf = (m: Material): Material => {
    switch (m.name) {
      case 'slab':
        return p.slabMat;
      case 'trim':
        return p.trimMat;
      case 'neon-core':
        return p.coreMat;
      default:
        return steel!;
    }
  };
  const deck = kit.getObjectByName('PAD_DECK') as Mesh | undefined;
  if (deck?.isMesh) {
    p.slab.geometry = deck.geometry;
    p.slab.position.y = 0; // the kit deck is authored at its true height (top +0.015)
  }
  for (const name of ['PAD_BEZEL', 'PAD_BOLTS', 'PAD_SKIRT', 'PAD_VENTS']) {
    const src = kit.getObjectByName(name);
    if (!src) continue;
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    c.traverse((n) => {
      const mesh = n as Mesh;
      if (mesh.isMesh) mesh.material = roleOf(mesh.material as Material);
    });
    p.group.add(c);
  }
  p.bolts.visible = false; // the kit's socket heads replace the studs
  // The neon drops into the bezel's channel (1.7 cm down, a hair inboard):
  // a lit groove in machined steel rather than a tube sat on the corner.
  p.rim.position.y -= 0.029;
  p.rim.scale.set(p.rim.scale.x * 0.994, p.rim.scale.y, p.rim.scale.z * 0.994);
  // The kick-band paints INSIDE the bezel now (the frame owns the outer 7 cm).
  p.hazard.scale.multiplyScalar(0.92);
  p.hazard.position.y += 0.006;
}
