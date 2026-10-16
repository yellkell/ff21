/**
 * Articulated VR hands — machined: a coated steel chassis over bare-steel
 * knuckle axles, rubber grip pads on the palm side and an LED channel down
 * the back of every finger (tools/blender/hand.py builds the kit; the bake
 * lands in public/arena/hand/). Three joints a finger and three on a thumb
 * that turns in its own thenar mount, every segment's back end a half-round
 * nested inside the one before, so a closing fist shows real rounded
 * knuckles rather than boxes folding through each other.
 *
 * They start dark and BLOOM WHITE when the hand is active (trigger/grip
 * squeezed or a ball mid-return), reusing the same `setGloveLit` machinery
 * via userData.leds — the bloom is shaped by the kit's glow map, so the LED
 * channels burn hottest and the rubber barely warms. At rest the LEDs keep
 * a faint standby glow of their own.
 *
 * Knuckles point down local -Z, matching the old glove convention — the
 * grip/ray alignment and fireball anchors all carry over unchanged. The
 * kit is the LEFT hand; the right hand is the same parts under a mirrored
 * rig group, so every pose (curl about X, splay about Y) mirrors with it.
 *
 * THE KIT LOADS ONCE, on the first hand built. A hand built before it lands
 * stands in plain boxes on the same joints and is upgraded in place when it
 * arrives — same Meshes, same materials (so paint and skin survive), new
 * geometry and maps.
 *
 * THEY TAKE PAINT (avatar/paint.ts, part 'hand') on the PALM — the back
 * plate, the piece of you you look at all match and the piece the bay's ray
 * hits on the mirror. It has a material of its own (the paint canvas becomes
 * its map) and UVs of its own spanning the whole plate. The material's rest
 * colour is the canvas fill (`paintFill`, kept in step by applyAvatarSkin),
 * so an unpainted hand comes out of the bake exactly as it was built, and
 * the white bloom rides the emissive channel, untouched by any of it.
 *
 * The rest of the hand wears the kit's albedo, whose ALPHA says where the
 * skin's tone tints the coat (0) and where a surface keeps its own colour
 * (1: bare steel, rubber, LEDs, chipped edges) — so a skin recolours the
 * plating without painting the axles.
 */

import {
  Bone,
  BoxGeometry,
  BufferAttribute,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  SRGBColorSpace,
  TextureLoader,
  Vector3,
  type BufferGeometry,
  type Object3D,
  type Texture,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PALETTE } from '../config.js';

interface HandJoints {
  /** [knuckle, middle, tip] pivot triple per finger, index first. */
  fingers: [Bone, Bone, Bone][];
  thumb: [Bone, Bone, Bone];
}

export type HandIndex = 0 | 1;

export const HAND_VISUAL_SCALE = 1.18;

const HAND_FORWARD_AXIS = new Vector3(0, 0, 1);

export const HAND_ADDUCTION: [Quaternion, Quaternion] = [
  new Quaternion().setFromAxisAngle(HAND_FORWARD_AXIS, Math.PI / 2),
  new Quaternion().setFromAxisAngle(HAND_FORWARD_AXIS, -Math.PI / 2),
];

/** The half-relaxed pose a hand nobody drives rests in — [index, others,
 *  thumb] for setHandCurl. buildHand parks every hand here, and a dancer
 *  whose pose never learned the grip goes back to it. */
export const HAND_REST_CURL: readonly [number, number, number] = [0.25, 0.3, 0.45];

/** A full hand pose — what setHandPose drives every joint from. */
export interface HandPose {
  /** Per-finger curl, index first: 0 straight … 1 a closed fist. A little
   *  below 0 bends the knuckle back (a hand flung open to catch). */
  curl: readonly [number, number, number, number];
  /** Finger fan: 0 together … 1 splayed wide. */
  spread: number;
  /** Thumb flex: 0 alongside … 1 tucked across the fist. */
  thumb: number;
  /** Thumb lift: 1 = straight up off the grip (the finger gun's hammer). */
  thumbUp: number;
}

// ---------------------------------------------------------------------------
// The layout (three's hand space). Mirrors tools/blender/hand.py — used only
// until the kit lands, which carries the exact pivots itself.
// ---------------------------------------------------------------------------

/** Knuckle pivots, index first, and each finger's [prox, mid, dist] lengths. */
const FINGER_PIVOTS: readonly [number, number, number][] = [
  [0.0282, 0.001, -0.0452],
  [0.0093, 0.0012, -0.047],
  [-0.0095, 0.0008, -0.0458],
  [-0.0282, -0.0004, -0.0418],
];
const FINGER_LENGTHS: readonly [number, number, number][] = [
  [0.031, 0.02, 0.018],
  [0.034, 0.022, 0.019],
  [0.032, 0.021, 0.018],
  [0.025, 0.017, 0.016],
];
const THUMB_PIVOT: readonly [number, number, number] = [0.0275, -0.006, 0.019];
const THUMB_LENGTHS: readonly [number, number, number] = [0.025, 0.021, 0.019];

// Joint ranges (radians) at a full curl of 1: knuckle, middle, tip — a real
// fist folds the middle joint furthest and the tip least.
const CURL_RANGE: readonly [number, number, number] = [1.45, 1.6, 1.1];
const THUMB_RANGE: readonly [number, number, number] = [0.75, 0.6, 0.7];
/** Thumb up: the base joint lifts this far (and turns a hair) to stand the
 *  thumb straight up off a controller held in HAND_ADDUCTION's grip. */
const THUMB_UP_LIFT = 0.9;
const THUMB_UP_TURN = -0.05;
/** Radians of splay per finger-width away from the hand's centre line. */
const SPREAD_RANGE = 0.13;

// ---------------------------------------------------------------------------
// The kit
// ---------------------------------------------------------------------------

interface HandKit {
  geo: Map<string, BufferGeometry>;
  /** Every moving part of the frame fused into one skinned geometry in the
   *  rest pose, each vertex bound wholly to its part's bone (BONE_ORDER). */
  skinGeo: BufferGeometry;
  pos: Map<string, Vector3>;
  quat: Map<string, Quaternion>;
  maps: Record<'albedo' | 'orm' | 'nrm' | 'emit' | 'palmOrm' | 'palmNrm' | 'palmEmit', Texture>;
}

const KIT_BASE = 'arena/hand/';

/**
 * ONE DRAW CALL A FRAME. The frame's seventeen rigid parts would be
 * seventeen draw calls a hand — on Quest, with four hands in a bout and a
 * pub full of punters, that's the budget gone. So they ride ONE skinned mesh
 * instead: every joint is a bone, every vertex is welded (weight 1) to its
 * part's bone, and the GPU does the rest. The palm stays its own mesh — it
 * carries THE PAINT's canvas, and it never moves against the root anyway.
 */
const BONE_ORDER = [
  'HAND_ROOT',
  ...[0, 1, 2, 3].flatMap((i) => [0, 1, 2].map((s) => `F${i}_${s}`)),
  'THUMB_MOUNT',
  'T_0',
  'T_1',
  'T_2',
];
/** Which bone each frame part rides (the rest are their own joint's). */
const PART_BONE: Record<string, string> = { PALM_FRAME: 'HAND_ROOT', WRIST: 'HAND_ROOT' };
let kit: HandKit | null = null;
let kitLoading = false;
/** Hands built before the kit landed — upgraded (then forgotten) when it does. */
const waiting = new Set<Group>();

function loadKit(): void {
  if (kitLoading) return;
  kitLoading = true;
  const tex = new TextureLoader().setPath(KIT_BASE);
  const load = (file: string, srgb = false): Promise<Texture> =>
    tex.loadAsync(file).then((t) => {
      t.flipY = false; // glTF UVs: v runs down the image
      if (srgb) t.colorSpace = SRGBColorSpace;
      t.anisotropy = 4;
      return t;
    });
  Promise.all([
    new GLTFLoader().loadAsync(KIT_BASE + 'hand.glb'),
    load('hand_albedo.webp', true),
    load('hand_orm.webp'),
    load('hand_nrm.webp'),
    load('hand_emit.webp'),
    load('palm_orm.webp'),
    load('palm_nrm.webp'),
    load('palm_emit.webp'),
  ])
    .then(([gltf, albedo, orm, nrm, emit, palmOrm, palmNrm, palmEmit]) => {
      const k: HandKit = {
        geo: new Map(),
        skinGeo: null as unknown as BufferGeometry,
        pos: new Map(),
        quat: new Map(),
        maps: { albedo, orm, nrm, emit, palmOrm, palmNrm, palmEmit },
      };
      gltf.scene.traverse((o) => {
        k.pos.set(o.name, o.position.clone());
        k.quat.set(o.name, o.quaternion.clone());
        const m = o as Mesh;
        if (m.isMesh) {
          (m.material as MeshStandardMaterial).dispose();
          k.geo.set(o.name, m.geometry);
        }
      });
      k.skinGeo = buildSkinGeometry(gltf.scene, k.geo);
      kit = k;
      for (const h of waiting) upgrade(h);
      waiting.clear();
    })
    .catch((err) => {
      // No kit: the box hands stand as they are — fully playable, plainer.
      console.warn('[hands] kit failed to load; keeping box hands', err);
      waiting.clear();
    });
}

/** Fuse the frame's parts, each moved to its rest place in hand space,
 *  into one geometry skinned rigidly to BONE_ORDER. */
function buildSkinGeometry(scene: Object3D, geo: Map<string, BufferGeometry>): BufferGeometry {
  scene.updateMatrixWorld(true);
  const pieces: BufferGeometry[] = [];
  for (const [name, g] of geo) {
    if (name === 'PALM') continue;
    const node = scene.getObjectByName(name);
    if (!node) continue;
    const piece = (g.index ? g.toNonIndexed() : g.clone()).applyMatrix4(node.matrixWorld);
    for (const a of Object.keys(piece.attributes)) {
      if (a !== 'position' && a !== 'normal' && a !== 'uv') piece.deleteAttribute(a);
    }
    const bone = BONE_ORDER.indexOf(PART_BONE[name] ?? name);
    const n = piece.attributes.position.count;
    const idx = new Uint16Array(n * 4);
    const w = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) {
      idx[v * 4] = Math.max(0, bone);
      w[v * 4] = 1;
    }
    piece.setAttribute('skinIndex', new BufferAttribute(idx, 4));
    piece.setAttribute('skinWeight', new BufferAttribute(w, 4));
    pieces.push(piece);
  }
  const merged = mergeGeometries(pieces, false);
  if (!merged) throw new Error('hand kit: parts would not merge');
  return merged;
}

/** Fit a built hand with the kit, in place: the palm's geometry and maps,
 *  the joints' exact pivots, and the frame's one skinned mesh in place of
 *  the stand-in boxes. */
function upgrade(hand: Group): void {
  const k = kit;
  const parts = hand.userData.parts as Map<string, Mesh> | undefined;
  if (!k || !parts || hand.userData.machined) return;
  hand.userData.machined = true;
  const palm = parts.get('PALM');
  if (palm) palm.geometry = k.geo.get('PALM') ?? palm.geometry;
  for (const [name, mesh] of parts) if (name !== 'PALM') mesh.removeFromParent();

  // Pivots: every joint sits where its kit node does. Bind at REST: the
  // hand may already be posed, so its rotations step aside while the
  // skeleton takes its measure, then come back.
  const bones = hand.userData.bones as Map<string, Bone>;
  const saved = new Map<Bone, Quaternion>();
  for (const [name, b] of bones) {
    const p = k.pos.get(name);
    if (p) b.position.copy(p);
    saved.set(b, b.quaternion.clone());
    const q = name === 'THUMB_MOUNT' ? k.quat.get(name) : undefined;
    if (q) b.quaternion.copy(q);
    else b.quaternion.identity();
  }
  const [mat, palmMat] = hand.userData.leds as [MeshStandardMaterial, MeshStandardMaterial];
  const rig = bones.get('HAND_ROOT')!.parent!;
  const frame = new SkinnedMesh(k.skinGeo, mat);
  frame.name = 'HAND_FRAME';
  // Hands live within arm's reach of the camera; skipping the cull saves
  // re-skinning a bounding sphere every time the fingers move.
  frame.frustumCulled = false;
  rig.add(frame);
  hand.updateMatrixWorld(true);
  frame.bind(new Skeleton(BONE_ORDER.map((n) => bones.get(n)!)), frame.matrixWorld);
  for (const [b, q] of saved) {
    if (b.name !== 'THUMB_MOUNT') b.quaternion.copy(q);
  }

  fitMaps(mat, k.maps.albedo, k.maps.orm, k.maps.nrm, k.maps.emit);
  fitMaps(palmMat, null, k.maps.palmOrm, k.maps.palmNrm, k.maps.palmEmit);
}

function fitMaps(m: MeshStandardMaterial, albedo: Texture | null, orm: Texture, nrm: Texture, emit: Texture): void {
  // The palm's map belongs to THE PAINT (its canvas); only the frame wears
  // the kit's albedo.
  if (albedo) m.map = albedo;
  m.aoMap = orm;
  m.roughnessMap = orm;
  m.metalnessMap = orm;
  m.roughness = 1; // the maps carry the finish now
  m.metalness = 1;
  m.normalMap = nrm;
  m.emissiveMap = emit;
  m.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

/** The LEDs' standby glow — a cold white, there before you squeeze. */
const LED_IDLE = new Color(0.55, 0.72, 1.0).multiplyScalar(0.55);

function handMaterial(frame: boolean): MeshStandardMaterial {
  const m = new MeshStandardMaterial({
    color: 0x15171c, // near-black steel at rest
    emissive: 0xffffff,
    emissiveIntensity: 0,
    metalness: 0.85,
    roughness: 0.35,
  });
  m.userData.role = 'hand';
  m.userData.paintFill = '#15171c'; // the rest steel — THE PAINT's canvas fill
  m.userData.baseIntensity = 0;
  m.userData.litIntensity = 1.9; // white-hot when active
  m.userData.baseColor = new Color(0x000000);
  m.userData.litColor = new Color(PALETTE.white);
  const idle = { value: LED_IDLE };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uLedIdle = idle;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 uLedIdle;\nvoid main() {')
      // The kit's glow map: R shapes the squeeze bloom, G is the LEDs'
      // standby glow, which burns whether or not the hand is lit.
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `
        #ifdef USE_EMISSIVEMAP
          vec4 glowMap = texture2D( emissiveMap, vEmissiveMapUv );
          totalEmissiveRadiance = totalEmissiveRadiance * glowMap.r + uLedIdle * glowMap.g;
        #endif`,
      );
    if (frame) {
      // UNTINT: the albedo's alpha keeps bare steel, rubber and LEDs their
      // own colour; everywhere else the skin's tone tints the coat.
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        /* glsl */ `
        #ifdef USE_MAP
          vec4 sampledDiffuseColor = texture2D( map, vMapUv );
          diffuseColor.rgb = mix( diffuseColor.rgb * sampledDiffuseColor.rgb, sampledDiffuseColor.rgb, sampledDiffuseColor.a );
        #endif`,
      );
    }
  };
  m.customProgramCacheKey = () => (frame ? 'ff2-hand-frame' : 'ff2-hand-palm');
  return m;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/** Stand-in box for a part until the kit lands: [w, h, length, z offset]. */
function placeholder(w: number, h: number, len: number): BufferGeometry {
  return new BoxGeometry(w, h, len).translate(0, 0, -len / 2);
}

/**
 * Build one hand. `side` mirrors it: +1 = left hand (thumb on +x),
 * -1 = right hand (thumb on -x).
 */
export function buildHand(side: 1 | -1): Group {
  const hand = new Group();
  hand.scale.setScalar(HAND_VISUAL_SCALE);
  // The gear slot rides the group itself (avatar/gear.ts applyGear reads
  // it), not its name: the rig calls this 'opponent-glove-left', the arena
  // renames your own 'player-glove-left', the pub leaves it nameless — and
  // a pair of CUFFS has to land on all three.
  hand.userData.gearSlot = 'hands';
  hand.userData.gearSide = side;

  // The kit is a left hand: the right one is it in a mirror.
  const rig = new Group();
  rig.scale.x = side;
  hand.add(rig);

  // Two materials, one look: the frame (fingers, knuckles, wrist) on one,
  // the PALM on its own so it can carry paint without the fingers wearing
  // a copy of it. Both bloom, both take the skin.
  const mat = handMaterial(true);
  const palmMat = handMaterial(false);
  hand.userData.leds = [mat, palmMat]; // setGloveLit drives the white bloom

  const parts = new Map<string, Mesh>();
  const bones = new Map<string, Bone>();
  const part = (name: string, geo: BufferGeometry, m: MeshStandardMaterial, parent: Object3D): Mesh => {
    const mesh = new Mesh(geo, m);
    mesh.name = name === 'PALM' ? name : `${name}-box`;
    parent.add(mesh);
    parts.set(name, mesh);
    return mesh;
  };
  const bone = (name: string, parent: Object3D): Bone => {
    const b = new Bone();
    b.name = name;
    parent.add(b);
    bones.set(name, b);
    return b;
  };

  // THE PAINT SURFACE: the back of the hand. Each palm is its own surface:
  // the right hand (side −1, the gear atlas's convention too) paints as
  // 'handR'.
  const palm = part('PALM', new BoxGeometry(0.078, 0.024, 0.09), palmMat, rig);
  palm.userData.paintPart = side === -1 ? 'handR' : 'hand';
  // The skeleton: a root bone at the hand's origin, every joint under it.
  // Until the kit lands, stand-in boxes ride the bones as plain meshes.
  const root = bone('HAND_ROOT', rig);
  part('PALM_FRAME', new BoxGeometry(0.07, 0.006, 0.008).translate(0, 0, -0.045), mat, root);
  part('WRIST', new BoxGeometry(0.06, 0.028, 0.036).translate(0, 0, 0.072), mat, root);

  const fingers: [Bone, Bone, Bone][] = [];
  for (let i = 0; i < 4; i++) {
    const chain: Bone[] = [];
    let parent: Object3D = root;
    const w = 0.016 - (i === 3 ? 0.0015 : 0);
    for (let s = 0; s < 3; s++) {
      const name = `F${i}_${s}`;
      const joint = bone(name, parent);
      if (s === 0) joint.position.set(...FINGER_PIVOTS[i]);
      else joint.position.set(0, 0, -FINGER_LENGTHS[i][s - 1]);
      const len = FINGER_LENGTHS[i][s];
      part(name, placeholder(w * 0.94 ** s, 0.017 * 0.94 ** s, len), mat, joint);
      chain.push(joint);
      parent = joint;
    }
    fingers.push(chain as [Bone, Bone, Bone]);
  }

  // Thumb: a fixed mount (lean, dip and roll), then three joints.
  const mount = bone('THUMB_MOUNT', root);
  mount.position.set(...THUMB_PIVOT);
  mount.rotation.set(-0.3, -0.6, 0.5);
  const thumb: Bone[] = [];
  let tParent: Object3D = mount;
  for (let s = 0; s < 3; s++) {
    const name = `T_${s}`;
    const joint = bone(name, tParent);
    // The base joint turns about its own up axis before it lifts.
    joint.rotation.order = 'YXZ';
    if (s > 0) joint.position.set(0, 0, -THUMB_LENGTHS[s - 1]);
    part(name, placeholder(0.017 * 0.94 ** s, 0.017 * 0.94 ** s, THUMB_LENGTHS[s]), mat, joint);
    thumb.push(joint);
    tParent = joint;
  }

  hand.userData.joints = { fingers, thumb: thumb as [Bone, Bone, Bone] } satisfies HandJoints;
  hand.userData.parts = parts;
  hand.userData.bones = bones;

  if (kit) upgrade(hand);
  else {
    waiting.add(hand);
    loadKit();
  }

  // Hands that nobody drives (remote punters, the barkeep, the mirror)
  // rest in a natural half-relaxed pose instead of rigor-mortis flat.
  setHandCurl(hand, ...HAND_REST_CURL);
  return hand;
}

// ---------------------------------------------------------------------------
// Posing
// ---------------------------------------------------------------------------

/**
 * Pose every joint. Curl is NEGATIVE x rotation: knuckles point -Z and the
 * palm faces -Y, so fingers fold downward toward the palm (positive bent
 * them backwards — genuinely horrifying). A curl below 0 only ever reaches
 * the knuckle: a hand flung open bends back there, never at the tips.
 */
export function setHandPose(hand: Group, p: HandPose): void {
  const joints = hand.userData.joints as HandJoints | undefined;
  if (!joints) return;
  joints.fingers.forEach((f, i) => {
    const c = p.curl[i];
    const open = Math.min(c, 0);
    const close = Math.max(c, 0);
    f[0].rotation.x = -(close * CURL_RANGE[0] + open * 0.45);
    f[1].rotation.x = -close * CURL_RANGE[1];
    f[2].rotation.x = -close * CURL_RANGE[2];
    // Splay fans out from between middle and ring, and folds away as the
    // finger closes (a fist's fingers lie side by side).
    f[0].rotation.y = -(1.5 - i) * p.spread * SPREAD_RANGE * (1 - close * 0.85);
  });
  const t = joints.thumb;
  const up = p.thumbUp;
  const flex = p.thumb * (1 - up);
  t[0].rotation.set(-flex * THUMB_RANGE[0] + up * THUMB_UP_LIFT, up * THUMB_UP_TURN, 0);
  t[1].rotation.x = -flex * THUMB_RANGE[1] - up * 0.05;
  t[2].rotation.x = -flex * THUMB_RANGE[2];
}

const _pose: { curl: [number, number, number, number]; spread: number; thumb: number; thumbUp: number } = {
  curl: [0, 0, 0, 0],
  spread: 0,
  thumb: 0,
  thumbUp: 0,
};

/**
 * Pose the fingers: 0 = straight, 1 = full fist. `index` follows the
 * trigger, `others` the grip, `thumb` tucks across as either squeezes. The
 * ring and pinky close a touch ahead of the middle, as a real grip does.
 */
export function setHandCurl(hand: Group, index: number, others: number, thumb: number): void {
  _pose.curl[0] = index;
  _pose.curl[1] = others;
  _pose.curl[2] = Math.min(1, others * 1.04);
  _pose.curl[3] = Math.min(1, others * 1.08);
  _pose.spread = 0.25 * (1 - Math.max(index, others));
  _pose.thumb = thumb;
  _pose.thumbUp = 0;
  setHandPose(hand, _pose);
}

/**
 * Pose a hand from the two analogue reads a controller gives, 0 open … 1
 * closed: the TRIGGER curls the index, the GRIP curls the rest, each
 * borrowing a little of the other (a real fist never leaves one finger
 * straight), and the thumb tucks across as either closes. The one formula
 * behind the pub's punters and the club's dancers — so a fist you make is
 * the same fist in the glass and on every other headset. (Your own hands
 * run the springier version in PlayerGloveSystem.)
 */
export function setHandGrip(hand: Group, trigger: number, squeeze: number): void {
  setHandCurl(hand, Math.max(trigger, squeeze * 0.6), Math.max(squeeze, trigger * 0.45), 0.35 + Math.max(trigger, squeeze) * 0.55);
}

/** The index fingertip's pivot — where a finger gun's muzzle is. */
export function handIndexTip(hand: Group): Object3D | undefined {
  return (hand.userData.joints as HandJoints | undefined)?.fingers[0][2];
}

/** The index tip's length beyond its last pivot (hand-local, unscaled). */
export const INDEX_TIP_LENGTH = FINGER_LENGTHS[0][2];
