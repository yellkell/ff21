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
 * THE STREET SET (STREET_FRAME / _BASE / _EDGE / _LED) is the other dress:
 * a cast-iron frame, a concrete plinth to the road, a galvanised edge and a
 * line of light in a groove — worn instead of the machined pieces wherever
 * the site is a street (setPadStreet: the neon district).
 *
 * Because the kit's pieces wear each pad's OWN role materials, applyPlatform-
 * Skin / tintPlatform keep working untouched: a skin that recolours the trim
 * recolours the bezel and the bolts; a team tint lights the vents with the rim.
 */
import { DoubleSide, Group, MeshStandardMaterial, type Material, type Mesh, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { applyNativeHides } from './nativePads.js';

export interface PadParts {
  group: Group;
  slab: Mesh;
  bolts: Object3D;
  hazard: Object3D;
  rim: Object3D;
  slabMat: Material;
  trimMat: Material;
  coreMat: Material;
  /** The kit's two dresses, once it has landed (setPadStreet picks one). */
  machined?: Group;
  street?: Group;
  /** THE STREET PADS (nativePads.ts): the modelled skin this pad wears, its
   *  sets built so far (kept hidden after), and whether the standard deck,
   *  frame and tube are hidden under one. */
  nativeId?: string | null;
  nativeSets?: Map<string, Object3D>;
  nativeBuilding?: Set<string>;
  nativeHid?: boolean;
}

/** The street set's own surfaces, finished once (shared by every clone):
 *  glTF carries a scan as texture × factor only, so the street's tones are
 *  set here — wet dark concrete, cold galvanising, black cast iron — and
 *  the grime baked into vertex colour is switched on. */
const STREET_TONE: Record<string, [number, number, number, number, number]> = {
  //                  colour r, g, b, roughness, environment light
  'street-concrete': [0.075, 0.075, 0.082, 1.0, 0.3], // wet: dark, and it takes the neon
  'street-galv': [0.26, 0.27, 0.3, 0.75, 0.6],
  'street-iron': [0.13, 0.125, 0.125, 0.85, 0.45],
};
function finishStreet(root: Object3D): void {
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !o.name.startsWith('STREET_')) return;
    const m = mesh.material as MeshStandardMaterial;
    const tone = STREET_TONE[m.name];
    if (!tone || m.userData.toned) return;
    m.userData.toned = true;
    m.color.setRGB(tone[0], tone[1], tone[2]);
    m.roughness = tone[3];
    // The site's panorama lights a whole lit street's worth into anything
    // pale; a pad standing IN that street takes only a share of it.
    m.envMapIntensity = tone[4];
    if (mesh.geometry.getAttribute('color')) m.vertexColors = true;
    m.needsUpdate = true;
  });
}

/** Whether pads wear the STREET set (a road site: the neon district). */
let streetOn = false;

function wearStreet(p: PadParts): void {
  if (!p.machined || !p.street) return;
  p.machined.visible = !streetOn;
  p.street.visible = streetOn;
  // The bezel's neon tube goes with the bezel: in the street the light is
  // the line in the plinth's groove; and the plinth itself is the concrete.
  p.rim.visible = !streetOn;
  const plinth = p.group.getObjectByName('stage-plinth');
  if (plinth && streetOn) plinth.visible = false;
  // A modelled pad (nativePads.ts) keeps the frame and tube it hides hidden.
  applyNativeHides(p);
}

/** Dress every pad (now and when the kit lands) for a road, or not. */
export function setPadStreet(on: boolean): void {
  streetOn = on;
  for (const p of pads) wearStreet(p);
}

const pads: PadParts[] = [];

/** The deck's UVs are metres centred on the pad (pad_kit.py) — but glTF
 *  stores V as 1 − v, which put every deck's centre a metre off (CHAMPION's
 *  medallion and the street's iron plate off on a corner). Undone once. */
function unflipDeckUv(deck: Mesh): void {
  if (deck.userData.uvFixed) return;
  deck.userData.uvFixed = true;
  const uv = deck.geometry.getAttribute('uv');
  if (!uv) return;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
  uv.needsUpdate = true;
}

let kit: Object3D | null = null;
let loading = false;
let steel: MeshStandardMaterial | null = null;

/** Every pad ever built (the street re-lays the undressed ones). */
export function allPads(): readonly PadParts[] {
  return pads;
}

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
        finishStreet(kit);
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
    unflipDeckUv(deck);
    p.slab.geometry = deck.geometry;
    p.slab.position.y = 0; // the kit deck is authored at its true height (top +0.015)
  }
  const machined = new Group();
  machined.name = 'pad-machined';
  for (const name of ['PAD_BEZEL', 'PAD_BOLTS', 'PAD_SKIRT', 'PAD_VENTS']) {
    const src = kit.getObjectByName(name);
    if (!src) continue;
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    c.traverse((n) => {
      const mesh = n as Mesh;
      if (mesh.isMesh) mesh.material = roleOf(mesh.material as Material);
    });
    machined.add(c);
  }
  p.group.add(machined);
  // THE STREET SET: concrete, galvanised steel and cast iron wear their own
  // scanned materials; only the groove's light takes the pad's colour.
  const street = new Group();
  street.name = 'pad-street';
  for (const name of ['STREET_FRAME', 'STREET_BASE', 'STREET_EDGE', 'STREET_LED']) {
    const src = kit.getObjectByName(name);
    if (!src) continue;
    const c = src.clone(true);
    c.position.set(0, 0, 0);
    if (name === 'STREET_LED') {
      // The strip faces into its groove; light it from both sides.
      p.coreMat.side = DoubleSide;
      c.traverse((n) => {
        const mesh = n as Mesh;
        if (mesh.isMesh) mesh.material = p.coreMat;
      });
    }
    street.add(c);
  }
  p.group.add(street);
  p.machined = machined;
  p.street = street;
  wearStreet(p);
  p.bolts.visible = false; // the kit's socket heads replace the studs
  // The neon drops into the bezel's channel (1.7 cm down, a hair inboard):
  // a lit groove in machined steel rather than a tube sat on the corner.
  p.rim.position.y -= 0.029;
  p.rim.scale.set(p.rim.scale.x * 0.994, p.rim.scale.y, p.rim.scale.z * 0.994);
  // The kick-band paints INSIDE the bezel now (the frame owns the outer 7 cm).
  p.hazard.scale.multiplyScalar(0.92);
  p.hazard.position.y += 0.006;
}
