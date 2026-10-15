/**
 * THE TITAN KITS — the arcade titans as Blender built them
 * (tools/blender/titans/*.py → public/arena/titans/<style>.glb), assembled
 * into the same TitanRig the procedural builder makes, so CampaignSystem
 * drives a kit titan exactly as it drove the boxes: same joints, same lamp
 * materials, same hitboxes (the lamp origins ARE the weak points).
 *
 * The GLB carries the skeleton as empties (TITAN › CHEST, HEAD, ARM_i ›
 * ELBOW_i › WRIST_i › HAND_i › DIGIT_i_k, WING_i › WINGWRIST_i, EYEFX) in
 * the machine's unit frame; every position is scaled by BossDef.scale here,
 * because the game keeps the root at scale 1 (raids rescale the def, not
 * the root) and armGuard reads the bones' local lengths as metres.
 *
 * QUEST BUDGET: a titan is ~25 parts in ~10 materials — hung off its joints
 * as meshes that was 150+ draws. Instead every non-lamp surface becomes ONE
 * skinned mesh per material over a skeleton whose bones sit at the rig's
 * joints (each vertex bound 100% to the joint its part rode), the trick the
 * MC's suit uses: rigid plates, a draw per material. The lamps the game
 * pulses (eyes, core, low, shoulders) stay meshes of their own, because they
 * scale about their own centres.
 *
 * Materials named in the Blender file are the contract: `visor core low
 * shoulder_0/1 pod_0/1` are this rig's driven glows; `glow*` are static
 * lamps lit in the titan's accent; everything else ships as authored, its
 * baked ambient occlusion riding the vertex colours.
 */

import {
  Bone,
  BufferAttribute,
  type BufferGeometry,
  Group,
  type Material,
  Matrix4,
  Mesh,
  type MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  type Object3D,
  Skeleton,
  SkinnedMesh,
  SphereGeometry,
  Float32BufferAttribute,
  Uint16BufferAttribute,
  Vector3,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BossDef, TitanArm, TitanDigit, TitanRig, TitanStyle } from './bosses.js';
import { titanSkin, type TitanSkinId } from '../materials/titanSkin.js';

/** Chassis that have a Blender kit. */
const KIT_STYLES: readonly TitanStyle[] = ['hook', 'piston', 'vulture', 'fortress', 'king'];

const kits = new Map<TitanStyle, Object3D>();
let loading: Promise<void> | null = null;
/** THE TRIDENT VULTURE and GOLIATH wield (tools/blender/trident.py): its
 *  white-hot core and coloured halo, in trident space. */
let tridentDrawing: { core: BufferGeometry; halo: BufferGeometry } | null = null;

/** The Blender trident's drawing, once loaded (null: the procedural one). */
export function titanTrident(): { core: BufferGeometry; halo: BufferGeometry } | null {
  return tridentDrawing;
}

/**
 * Start loading every titan kit. Called at boot, so the loads ride the
 * door's wait (bootLoad.ts counts every GLTF in flight); a kit that fails
 * just leaves that titan on the procedural builder.
 */
export function preloadTitans(): Promise<void> {
  loading ??= (() => {
    const loader = new GLTFLoader().setDRACOLoader(new DRACOLoader().setDecoderPath('draco/'));
    const weapon = loader
      .loadAsync('arena/titans/trident.glb')
      .then((gltf) => {
        gltf.scene.updateMatrixWorld(true);
        const take = (name: string): BufferGeometry | null => {
          let geo: BufferGeometry | null = null;
          gltf.scene.getObjectByName(name)?.traverse((o) => {
            const m = o as Mesh;
            if (!geo && m.isMesh) geo = m.geometry.clone().applyMatrix4(m.matrixWorld);
          });
          return geo;
        };
        const core = take('TRIDENT_CORE');
        const halo = take('TRIDENT_HALO');
        if (core && halo) tridentDrawing = { core, halo };
      })
      .catch(() => {
        /* no Blender trident — the procedural one stands in */
      });
    return Promise.all([
      weapon,
      ...KIT_STYLES.map((style) =>
        loader
          .loadAsync(`arena/titans/${style}.glb`)
          .then((gltf) => {
            gltf.scene.updateMatrixWorld(true);
            kits.set(style, gltf.scene);
          })
          .catch(() => {
            /* no kit for this one — the boxes stand in */
          }),
      ),
    ]).then(() => undefined);
  })();
  return loading;
}

/** The loaded kit for a chassis, if it has one and it's in. */
export function titanKit(style: TitanStyle): Object3D | undefined {
  return kits.get(style);
}

const JOINT = /^(CHEST|HEAD|EYEFX|ARM_\d|ELBOW_\d|WRIST_\d|HAND_\d|DIGIT_\d_\d+|WING_\d|WINGWRIST_\d)$/;
const LAMP = /^(EYE_\d+|CORE|LOW|SHOULDER_[01])$/;

/** Surfaces shared by every rig built from a kit (never disposed), per
 *  source material and skin. */
const dressed = new Map<string, Material>();
const ids = new WeakMap<Material, number>();
let nextId = 0;

/** Each machine's METAL (materials/titanSkin.ts): GOLIATH's brushed royal
 *  plate, clean milled steel on the rest. */
const KIT_SKIN: Record<Exclude<TitanStyle, 'goop'>, TitanSkinId> = {
  hook: 'machined',
  piston: 'machined',
  vulture: 'machined',
  fortress: 'machined',
  king: 'royal',
};

/** Surfaces that keep their own finish: lettering, glass, rubber, the
 *  hazard paint, polished chrome. Everything else is the machine's plate. */
const BARE = /ink|glass|rubber|poly|hazard|chrome|cable/;

/** World metres per repeat of the skin, per unit of titan scale. */
const SKIN_TILE = 0.34;

/**
 * The arena renders UNTONEMAPPED under a strong environment (and the box
 * titans were dark, rough steel), so the Blender surfaces are calmed for it:
 * reflections at an eighth of the room's, coats off and their sheen cut back,
 * paint matte, polished metal roughened a touch and pale paint brought down
 * off white — or lacquer reads grey plastic and pearl ceramic blows out to
 * flat white in the neon.
 */
function dress(m: Material, skinId: TitanSkinId): Material {
  if (!ids.has(m)) ids.set(m, nextId++);
  const k = `${ids.get(m)}:${skinId}`;
  let out = dressed.get(k);
  if (!out) {
    out = m;
    const std = m as MeshStandardMaterial;
    if (std.isMeshStandardMaterial) {
      const c = std.clone();
      c.vertexColors = true;
      c.envMapIntensity = 0.12;
      const phys = c as MeshPhysicalMaterial;
      if (phys.isMeshPhysicalMaterial) {
        // Lacquer and coated paint: the arena's key lights threw a broad grey
        // sheen across them, so the coat goes and the sheen is cut back.
        phys.clearcoat = 0;
        phys.specularIntensity = 0.25;
        phys.roughness = Math.max(phys.roughness, 0.6);
      }
      if (c.metalness > 0.5) {
        c.roughness = Math.max(c.roughness, 0.32);
        c.envMapIntensity = 0.08;
      } else {
        c.roughness = Math.max(c.roughness, 0.55);
        const lum = c.color.r * 0.2126 + c.color.g * 0.7152 + c.color.b * 0.0722;
        if (lum > 0.2) c.color.multiplyScalar(0.2 / lum); // pale paint reads light grey, never white
      }
      // And the whole machine a step down: it stands in a dark alley.
      c.color.multiplyScalar(0.55);
      // THE METAL: the plate wears its machine's skin — the grain in the
      // colour, the roughness and the relief the alley's light catches —
      // and reads as worked metal rather than smooth plastic.
      if (!BARE.test(key(m)) && !c.transparent) {
        const skin = titanSkin(skinId);
        c.map = skin.map;
        c.roughnessMap = skin.roughnessMap;
        c.roughness = 1;
        c.bumpMap = skin.bumpMap;
        c.bumpScale = skin.bumpScale * 3;
        c.metalnessMap = skin.metalnessMap;
        c.metalness = Math.max(c.metalness, 0.7);
      }
      c.needsUpdate = true;
      out = c;
    }
    dressed.set(k, out);
  }
  return out;
}

function glow(color: number, intensity: number): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: intensity,
    metalness: 0.2,
    roughness: 0.3,
  });
}

/** Material name without the exporter's `.001` suffixes. */
const key = (m: Material): string => m.name.replace(/\.\d+$/, '');

/** A part's geometry in its joint's frame, at the titan's scale, reduced to
 *  what the skinned surfaces read (position, normal, AO colour). */
function partGeometry(mesh: Mesh, host: Object3D, s: number): BufferGeometry {
  const rel = new Matrix4().copy(host.matrixWorld).invert().multiply(mesh.matrixWorld);
  const g = mesh.geometry.clone().applyMatrix4(rel);
  g.scale(s, s, s);
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
  // Skin coordinates, box-projected in the JOINT's frame (so the grain rides
  // the limb): each face takes the two axes its normal doesn't point down.
  {
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const inv = 1 / (SKIN_TILE * s);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const ax = Math.abs(nor.getX(i));
      const ay = Math.abs(nor.getY(i));
      const az = Math.abs(nor.getZ(i));
      const x = pos.getX(i) * inv;
      const y = pos.getY(i) * inv;
      const z = pos.getZ(i) * inv;
      if (ax >= ay && ax >= az) uv.set([z, y], i * 2);
      else if (ay >= az) uv.set([x, z], i * 2);
      else uv.set([x, y], i * 2);
    }
    g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  }
  // AO as plain float rgb (the exporter may hand over normalised bytes or
  // rgba), white where a part has none, so every part merges alike.
  const n = g.attributes.position.count;
  const src = g.getAttribute('color') as BufferAttribute | undefined;
  const rgb = new Float32Array(n * 3);
  // The bake's occlusion, softened: at full strength on top of the dark
  // finish every seam read as grime.
  for (let i = 0; i < n; i++) {
    rgb[i * 3] = src ? 0.45 + 0.55 * src.getX(i) : 1;
    rgb[i * 3 + 1] = src ? 0.45 + 0.55 * src.getY(i) : 1;
    rgb[i * 3 + 2] = src ? 0.45 + 0.55 * src.getZ(i) : 1;
  }
  g.setAttribute('color', new Float32BufferAttribute(rgb, 3));
  return g.index ? g.toNonIndexed() : g;
}

/**
 * Assemble a titan from its kit at `def.scale`. Same contract as the
 * procedural buildTitan: root at the floor, facing local −Z.
 */
export function kitTitan(def: BossDef, src: Object3D): TitanRig {
  const s = def.scale;
  const accent = def.accent;
  const titan = src.getObjectByName('TITAN') ?? src;
  titan.updateMatrixWorld(true);

  // ── the skeleton: every joint empty becomes a Group, at scale ───────────
  const root = new Group();
  root.name = `titan-${def.name.toLowerCase()}`;
  const joints = new Map<Object3D, Group>([[titan, root]]);
  const byName = new Map<string, Group>();
  const grow = (n: Object3D, into: Group): void => {
    for (const c of n.children) {
      if (!JOINT.test(c.name)) continue;
      const g = new Group();
      g.name = c.name;
      g.position.copy(c.position).multiplyScalar(s);
      g.userData = { ...c.userData };
      into.add(g);
      joints.set(c, g);
      byName.set(c.name, g);
      grow(c, g);
    }
  };
  grow(titan, root);
  // THE VISIBLE ARMS. CampaignSystem poses the arms above by easing two
  // shoulder angles and an elbow pitch — it reads its own last values back,
  // so those groups are left to it. But a pitch-and-roll shoulder with a
  // fixed hinge folds the forearm UP-AND-BEHIND the machine whenever the arm
  // is thrown out sideways (the seesaw, a sweep's wind-up). So the plates
  // ride a MIRROR of each arm instead, re-solved every frame (solve(), below)
  // as a two-bone reach to the very wrist the pose put down, its elbow
  // pushed out, down and back the way a real one points: same hand, same
  // telegraph, never a backward elbow. Wrist, hand and digits copy the pose.
  const shown = new Map<Object3D, Group>();
  const mirrorArm = (logical: Group, into: Group): Group => {
    const g = new Group();
    g.name = `${logical.name}_shown`;
    g.position.copy(logical.position);
    into.add(g);
    shown.set(logical, g);
    for (const c of logical.children) if (JOINT.test(c.name)) mirrorArm(c as Group, g);
    return g;
  };
  for (const i of [0, 1]) {
    const pivot = byName.get(`ARM_${i}`);
    if (pivot) mirrorArm(pivot, root);
  }
  const need = (name: string): Group => {
    const g = byName.get(name);
    if (!g) throw new Error(`titan kit ${def.style}: no ${name}`);
    return g;
  };

  // ── this rig's driven glows ─────────────────────────────────────────────
  const visorMat = glow(accent, 1.8);
  const coreMat = glow(accent, 0.25);
  const lowMat = glow(accent, 0.2);
  const shoulderMats: [MeshStandardMaterial, MeshStandardMaterial] = [glow(accent, 0.2), glow(accent, 0.2)];
  const podMats: [MeshStandardMaterial, MeshStandardMaterial] = [glow(accent, 0.2), glow(accent, 0.2)];
  // A lamp at rest is dark glass that only GLOWS; lit by the alley's key
  // lights in its full accent it read as a solid salmon disc.
  for (const m of [coreMat, lowMat, ...shoulderMats, ...podMats]) m.color.multiplyScalar(0.25);
  const glowHot = glow(accent, 1.4);
  const glowDim = glow(accent, 0.5);
  glowHot.color.setHex(0x0c0d11);
  glowDim.color.setHex(0x0c0d11);
  const driven: Record<string, MeshStandardMaterial> = {
    visor: visorMat,
    core: coreMat,
    low: lowMat,
    shoulder_0: shoulderMats[0],
    shoulder_1: shoulderMats[1],
    pod_0: podMats[0],
    pod_1: podMats[1],
  };
  const surface = (m: Material): Material => {
    const k = key(m);
    if (driven[k]) return driven[k];
    if (k.startsWith('glow')) return k === 'glow' ? glowHot : glowDim;
    return dress(m, KIT_SKIN[def.style as Exclude<TitanStyle, 'goop'>] ?? 'machined');
  };

  // ── parts: lamps stay meshes, the rest gathers per material ────────────
  const hostOf = (n: Object3D): Object3D => {
    for (let p: Object3D | null = n.parent; p; p = p.parent) if (p === titan || JOINT.test(p.name)) return p;
    return titan;
  };
  const bones = new Map<Object3D, number>();
  const boneList: Bone[] = [];
  const boneFor = (host: Object3D): number => {
    let b = bones.get(host);
    if (b === undefined) {
      const bone = new Bone();
      const j = joints.get(host)!;
      (shown.get(j) ?? j).add(bone);
      b = boneList.push(bone) - 1;
      bones.set(host, b);
    }
    return b;
  };
  const eyes: Mesh[] = [];
  let core: Mesh | null = null;
  let low: Mesh | null = null;
  const shoulders: Mesh[] = [];
  const slots = new Map<Material, BufferGeometry[]>();
  const owned: BufferGeometry[] = [];

  titan.traverse((n) => {
    const mesh = n as Mesh;
    if (!mesh.isMesh) return;
    // A lamp is its own node (multi-primitive nodes hang their meshes
    // under a group carrying the node's name).
    const lampNode = LAMP.test(mesh.name) ? mesh : mesh.parent && LAMP.test(mesh.parent.name) ? mesh.parent : null;
    const host = hostOf(lampNode ?? mesh);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (lampNode) {
      // Centred on its own origin (the kit put it there): geometry in the
      // lamp's frame, the mesh placed at the lamp's offset from its host.
      const g = partGeometry(mesh, lampNode, s);
      g.deleteAttribute('color');
      owned.push(g);
      const lamp = new Mesh(g, surface(mats[0]));
      lamp.name = lampNode.name;
      lamp.position
        .setFromMatrixPosition(lampNode.matrixWorld)
        .applyMatrix4(new Matrix4().copy(host.matrixWorld).invert())
        .multiplyScalar(s);
      joints.get(host)!.add(lamp);
      if (lampNode.name.startsWith('EYE_')) eyes.push(lamp);
      else if (lampNode.name === 'CORE') core = lamp;
      else if (lampNode.name === 'LOW') low = lamp;
      else shoulders[Number(lampNode.name.slice(-1))] = lamp;
      return;
    }
    const g = partGeometry(mesh, host, s);
    const bone = boneFor(host);
    const n4 = g.attributes.position.count;
    const idx = new Uint16Array(n4 * 4);
    const wt = new Float32Array(n4 * 4);
    for (let i = 0; i < n4; i++) {
      idx[i * 4] = bone;
      wt[i * 4] = 1;
    }
    g.setAttribute('skinIndex', new Uint16BufferAttribute(idx, 4));
    g.setAttribute('skinWeight', new Float32BufferAttribute(wt, 4));
    const mat = surface(mats[0]);
    const list = slots.get(mat) ?? [];
    list.push(g);
    slots.set(mat, list);
  });

  // Identity inverses: each bone sits at its joint with no offset, and the
  // parts were brought into their joint's frame above.
  const skeleton = new Skeleton(boneList, boneList.map(() => new Matrix4()));
  for (const [mat, parts] of slots) {
    const geo = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    if (!geo) continue;
    owned.push(geo);
    const skin = new SkinnedMesh(geo, mat);
    skin.name = 'titan-skin';
    skin.bind(skeleton, new Matrix4());
    skin.frustumCulled = false; // bounds would be the bind pose's
    root.add(skin);
  }

  // ── the beam flare, over the eye ────────────────────────────────────────
  const eyeFxMat = glow(accent, 2.4);
  eyeFxMat.transparent = true;
  eyeFxMat.opacity = 0.5;
  eyeFxMat.depthWrite = false;
  const eyeFxGeo = new SphereGeometry(0.088 * s, 14, 10);
  const eyeFx = new Mesh(eyeFxGeo, eyeFxMat);
  eyeFx.visible = false;
  (byName.get('EYEFX') ?? need('HEAD')).add(eyeFx);

  // ── arms in the rest pose CampaignSystem eases home to ─────────────────
  const arms = [0, 1].map((i) => {
    const side = i === 0 ? -1 : 1;
    const pivot = need(`ARM_${i}`);
    const elbow = need(`ELBOW_${i}`);
    const wrist = need(`WRIST_${i}`);
    const fist = need(`HAND_${i}`);
    const digits: TitanDigit[] = [];
    fist.traverse((d) => {
      if (/^DIGIT_\d_\d+$/.test(d.name)) digits.push({ node: d, open: Number(d.userData.open ?? 0), closed: Number(d.userData.closed ?? 0) });
    });
    digits.sort((a, b) => Number(a.node.name.split('_')[2]) - Number(b.node.name.split('_')[2]));
    pivot.rotation.x = 0.18;
    pivot.rotation.z = side * 0.14;
    elbow.rotation.x = 0.35; // ARM_REST's forward fold (gestures.ts)
    for (const d of digits) d.node.rotation.x = d.open + (d.closed - d.open) * 0.3;
    return { pivot, elbow, wrist, fist, digits, restX: 0.18, restZ: side * 0.14 } satisfies TitanArm;
  }) as [TitanArm, TitanArm];

  const wings: TitanRig['wings'] = [];
  for (const i of [0, 1]) {
    const group = byName.get(`WING_${i}`);
    const wrist = byName.get(`WINGWRIST_${i}`);
    if (group && wrist) wings.push({ group, wrist, side: i === 0 ? -1 : 1 });
  }

  // ── the reach solve for the visible arms ───────────────────────────────
  const _S = new Vector3();
  const _W = new Vector3();
  const _E = new Vector3();
  const _u = new Vector3();
  const _v = new Vector3();
  const _x = new Vector3();
  const _y = new Vector3();
  const _z = new Vector3();
  const _m = new Matrix4();
  const _inv = new Matrix4();
  const basis = (down: Vector3, pole: Vector3, out: Matrix4): void => {
    // Local −Y runs down the bone; local +Z (the plates' back) faces the
    // elbow's pole side.
    _y.copy(down).negate().normalize();
    _z.copy(pole).addScaledVector(_y, -pole.dot(_y));
    if (_z.lengthSq() < 1e-8) _z.set(0, 0, 1).addScaledVector(_y, -_y.z);
    _z.normalize();
    _x.crossVectors(_y, _z).normalize();
    out.makeBasis(_x, _y, _z);
  };
  // THE REACH (campaign/melee.ts): a world point each visible fist is put
  // ON, blended in by `w` — the strike's override of the posed wrist.
  const reach = [
    { at: new Vector3(), w: 0 },
    { at: new Vector3(), w: 0 },
  ];
  const _T = new Vector3();
  const _q = new Quaternion();
  const solveArm = (i: 0 | 1): void => {
    const arm = arms[i];
    const up = shown.get(arm.pivot)!;
    const fore = shown.get(arm.elbow)!;
    const side = i === 0 ? -1 : 1;
    const a = arm.elbow.position.length();
    const b = arm.wrist.position.length();
    _S.copy(arm.pivot.position);
    _inv.copy(root.matrixWorld).invert();
    _W.setFromMatrixPosition(arm.wrist.matrixWorld).applyMatrix4(_inv);
    const w = reach[i].w;
    if (w > 0) {
      // The wrist that puts the fist's centre on the target, the hand
      // straight down the line from the shoulder.
      _T.copy(reach[i].at).applyMatrix4(_inv);
      _u.subVectors(_T, _S).normalize();
      _T.addScaledVector(_u, -(arm.fist.position.length() + 0.06 * s));
      _W.lerp(_T, w);
    }
    _u.subVectors(_W, _S);
    const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, _u.length()));
    _u.normalize();
    // Out, down and back (root space; the face is −Z).
    _v.set(side * 0.8, -0.5, 0.35);
    _v.addScaledVector(_u, -_v.dot(_u));
    if (_v.lengthSq() < 1e-8) _v.set(0, 0, 1).addScaledVector(_u, -_u.z);
    _v.normalize();
    const cosA = (a * a + d * d - b * b) / (2 * a * d);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    _E.copy(_S).addScaledVector(_u, a * cosA).addScaledVector(_v, a * sinA);
    const pole = _v.clone();
    // Upper arm: shoulder → elbow.
    basis(_E.clone().sub(_S), pole, _m);
    up.quaternion.setFromRotationMatrix(_m);
    // Forearm: elbow → wrist, in the upper arm's frame.
    _W.copy(_S).addScaledVector(_u, d);
    basis(_W.clone().sub(_E), pole, _m);
    _m.premultiply(_inv.makeRotationFromQuaternion(up.quaternion).invert());
    fore.quaternion.setFromRotationMatrix(_m);
    // Wrist, hand and digits wear the pose's own angles.
    arm.wrist.traverse((n) => {
      const mirror = shown.get(n as Group);
      if (mirror) mirror.quaternion.copy(n.quaternion);
    });
    if (w > 0) {
      // A reaching hand goes in straight and SHUT: wrist and hand in line
      // with the forearm, every digit curled.
      _q.identity();
      shown.get(arm.wrist)!.quaternion.slerp(_q, w);
      shown.get(arm.fist)!.quaternion.slerp(_q, w);
      for (const dg of arm.digits) {
        const mirror = shown.get(dg.node as Group);
        if (mirror) mirror.rotation.x += (dg.closed - mirror.rotation.x) * w;
      }
    }
  };
  const _f = new Vector3();

  const head = need('HEAD');
  if (!core || !low || !shoulders[0] || !shoulders[1] || !eyes.length) throw new Error(`titan kit ${def.style}: missing a lamp`);
  root.updateMatrixWorld(true);
  const height = Number(titan.userData.height ?? 1.85) * s;

  return {
    root,
    head,
    visorMat,
    eyes,
    eyeFx,
    core,
    coreMat,
    low,
    lowMat,
    wings,
    shoulders: [shoulders[0], shoulders[1]],
    shoulderMats,
    podMats,
    arms,
    headY: head.position.y,
    coreY: new Vector3().setFromMatrixPosition((core as Mesh).matrixWorld).y,
    height,
    solve() {
      root.updateMatrixWorld(true);
      solveArm(0);
      solveArm(1);
    },
    reach,
    fistWorld(i, out) {
      // The visible fist's centre: a little way down the hand from its joint.
      const hand = shown.get(arms[i].fist) ?? arms[i].fist;
      hand.updateWorldMatrix(true, false);
      return out.copy(_f.set(0, -0.06 * s, 0)).applyMatrix4(hand.matrixWorld);
    },
    dispose() {
      for (const g of owned) g.dispose();
      eyeFxGeo.dispose();
      for (const m of [visorMat, coreMat, lowMat, glowHot, glowDim, eyeFxMat, ...shoulderMats, ...podMats]) m.dispose();
      root.removeFromParent();
    },
  };
}
