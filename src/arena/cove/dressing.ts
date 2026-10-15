/**
 * THE COVE's dressing: sea stacks and shore boulders, the jungle canopy on
 * the hills and headlands, and where every palm stands.
 *
 * Layout law (the same as the desert's): nothing stands inside the arena
 * clearing, nothing rises between you and the rival, and the near palms
 * that frame the view stand OUTSIDE |x| ≈ 17 m, clear of every mode's
 * pads and of a titan's reach. The palms behind you throw their shadows
 * forward across the sand (the sun is at your back).
 */

import {
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
  BufferGeometry,
  Float32BufferAttribute,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeRng, valueNoise2D } from '../desert/paper.js';
import { CLEARING, SEA_Y, shoreZ } from './shape.js';
import { clearingWeight, groundY, hillRock } from './terrain.js';
import type { PalmSpot } from './palms.js';
import { outdoor } from './outdoor.js';

const rn = valueNoise2D(makeRng(0x70c), 32);

/** A weathered volcanic rock: an icosphere pushed about by noise, stretched
 *  to (sx, sy, sz), wet-dark below the tide line. */
function rockGeometry(seed: number, sx: number, sy: number, sz: number, at: Vector3, yaw: number, detail = 3): BufferGeometry {
  const g = new IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new Vector3();
  const cols: number[] = [];
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  // volcanic basalt, cool grey — the same stone as the hill faces
  const light = new Color().setRGB(0.3, 0.3, 0.3, SRGBColorSpace);
  const dark = new Color().setRGB(0.15, 0.15, 0.16, SRGBColorSpace);
  const moss = new Color().setRGB(0.2, 0.28, 0.12, SRGBColorSpace);
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n =
      rn(v.x * 1.7 + seed, v.z * 1.7 + v.y * 0.8) * 0.6 +
      rn(v.x * 4.1 - seed, v.y * 4.1 + v.z) * 0.3 +
      rn(v.z * 9.0 + seed * 2, v.x * 9.0 - v.y) * 0.1;
    // flat-ish top and a tidal notch low down: sea stacks are undercut
    const notch = Math.exp(-(((v.y + 0.55) / 0.18) ** 2)) * 0.12;
    const r = 0.75 + n * 0.5 - notch;
    v.multiplyScalar(r);
    v.y = v.y > 0.6 ? 0.6 + (v.y - 0.6) * 0.55 : v.y;
    v.set(v.x * sx, v.y * sy, v.z * sz).applyQuaternion(q).add(at);
    p.setXYZ(i, v.x, v.y, v.z);
    const wetK = Math.min(1, Math.max(0, (SEA_Y + 1.1 - v.y) / 1.2));
    c.copy(light).lerp(dark, 0.35 + (1 - n) * 0.3);
    if (v.y - at.y > sy * 0.45) c.lerp(moss, 0.45 * n);
    c.lerp(dark, wetK * 0.85);
    cols.push(c.r, c.g, c.b);
  }
  g.setAttribute('color', new Float32BufferAttribute(cols, 3));
  g.computeVertexNormals();
  return g;
}

export function buildRocks(): Mesh {
  const parts: BufferGeometry[] = [];
  const rng = makeRng(0x57ac);
  // the sea stacks off the east headland, and a lone one to the west
  const stacks: [number, number, number, number][] = [
    [196, -318, 10, 34],
    [224, -338, 6.5, 22],
    [176, -296, 4, 12],
    [240, -352, 3.5, 9],
    [-240, -272, 7, 19],
    [-222, -262, 3, 7],
  ];
  for (const [x, z, r, h] of stacks) {
    parts.push(rockGeometry(rng() * 50, r, h * 0.62, r * (0.8 + rng() * 0.4), new Vector3(x, SEA_Y - 2 + h * 0.3, z), rng() * 6));
  }
  // boulders half in the surf along both arms of the bay
  for (const side of [-1, 1]) {
    for (let i = 0; i < 7; i++) {
      const x = side * (48 + i * 16 + rng() * 10);
      const z = shoreZ(x) + (rng() - 0.6) * 10;
      const s = 1.2 + rng() * 2.4;
      const y = Math.max(groundY(x, z), SEA_Y - 1.5);
      parts.push(rockGeometry(rng() * 50, s * (1 + rng() * 0.5), s * 0.7, s, new Vector3(x, y, z), rng() * 6));
    }
  }
  // tumbled rock at the headland feet
  for (let i = 0; i < 26; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * (150 + rng() * 150);
    const z = shoreZ(x) - rng() * 40;
    const gy = groundY(x, z);
    if (gy < SEA_Y - 3) continue;
    const s = 2 + rng() * 5;
    parts.push(rockGeometry(rng() * 50, s * 1.2, s * 0.8, s, new Vector3(x, Math.max(gy, SEA_Y - 1), z), rng() * 6));
  }
  // crags on the hills: outcrops breaking through wherever the hill is bare
  let crags = 0;
  for (let i = 0; i < 1200 && crags < 90; i++) {
    const x = (rng() - 0.5) * 900;
    const z = shoreZ(x) + 95 + rng() * 420;
    const bare = hillRock(x, z);
    if (bare < 0.55 || rng() > bare) continue;
    const s = 3 + rng() * 9;
    const gy = groundY(x, z);
    parts.push(rockGeometry(rng() * 50, s * (0.8 + rng() * 0.5), s * (0.9 + rng() * 0.9), s, new Vector3(x, gy - s * 0.25, z), rng() * 6, 2));
    crags++;
  }
  const g = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  const mesh = new Mesh(g, outdoor(new MeshLambertMaterial({ vertexColors: true })));
  mesh.name = 'cove-rocks';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * The jungle's trees: broadleaf crowns standing out of the canopy skin —
 * on the ridgelines, where they make the skyline, and scattered down the
 * slopes. One instanced draw.
 *
 * A crown is built the way Tidewater builds its canopy: LEAF-CLUSTER CARDS.
 * ~50 small alpha-cut cards per tree, spread over four overlapping lobes,
 * each wearing a painted cluster of real leaf shapes (leafTexture). Behind
 * them sits a dark core, so a gap between cards shows shadowed depth rather
 * than sky. The cards carry SPHERICAL normals (out from their lobe), so a
 * crown lights as one rounded mass — sun-side bright, underside dark —
 * instead of as fifty flat squares.
 */
const LOBES: [number, number, number, number][] = [
  [0, 0, 0, 1],
  [0.62, -0.18, 0.28, 0.74],
  [-0.55, -0.12, -0.34, 0.72],
  [0.1, 0.42, -0.12, 0.66],
];

/** One cluster of broad, pointed leaves painted on a canvas (sRGB). The
 *  leaves at the back are drawn darker, the ones on top lighter, so each
 *  card already has some depth in it. */
function leafTexture(): CanvasTexture {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const rng = makeRng(0x1eaf);
  const N = 64;
  for (let i = 0; i < N; i++) {
    const depth = i / N; // 0 back .. 1 front
    // leaves radiate from the cluster's heart, denser toward the middle
    const ang = rng() * Math.PI * 2;
    const rad = Math.sqrt(rng()) * S * 0.33;
    const x = S / 2 + Math.cos(ang) * rad;
    const y = S / 2 + Math.sin(ang) * rad;
    const dir = ang + (rng() - 0.5) * 1.1;
    const len = S * (0.14 + rng() * 0.1);
    const wid = len * (0.34 + rng() * 0.14);
    const hue = 82 + rng() * 30;
    const sat = 42 + rng() * 22;
    const lit = 18 + depth * 20 + rng() * 8;
    g.save();
    g.translate(x, y);
    g.rotate(dir);
    // the blade: a pointed ellipse, stalk end at the origin
    g.beginPath();
    g.moveTo(0, 0);
    g.bezierCurveTo(len * 0.25, -wid * 0.6, len * 0.7, -wid * 0.55, len, 0);
    g.bezierCurveTo(len * 0.7, wid * 0.55, len * 0.25, wid * 0.6, 0, 0);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, `hsl(${hue}, ${sat}%, ${lit * 0.75}%)`);
    grad.addColorStop(0.6, `hsl(${hue}, ${sat}%, ${lit}%)`);
    grad.addColorStop(1, `hsl(${hue + 6}, ${sat - 6}%, ${lit * 1.1}%)`);
    g.fillStyle = grad;
    g.fill();
    // the midrib, and a light edge on the upper side
    g.strokeStyle = `hsla(${hue + 10}, 35%, ${lit + 14}%, 0.55)`;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(len * 0.92, 0);
    g.stroke();
    g.restore();
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function treeGeometry(): BufferGeometry {
  const rng = makeRng(0x7ee5);
  const pos: number[] = [];
  const nor: number[] = [];
  const uv: number[] = [];
  const kind: number[] = [];
  const up = new Vector3(0, 1, 0);
  const dir = new Vector3();
  const cn = new Vector3();
  const t1 = new Vector3();
  const t2 = new Vector3();
  const cen = new Vector3();
  const n = new Vector3();
  const corners: [number, number][] = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (const [lx, ly, lz, lr] of LOBES) {
    const lobe = new Vector3(lx, ly, lz);
    const count = Math.round(11 + 17 * lr * lr);
    for (let i = 0; i < count; i++) {
      // fibonacci over the lobe; the underside gets fewer cards
      const y = 1 - (2 * (i + 0.5)) / count;
      if (y < -0.55 && rng() < 0.5) continue;
      const r = Math.sqrt(1 - y * y);
      const phi = i * 2.39996 + rng() * 0.8;
      dir.set(Math.cos(phi) * r, y, Math.sin(phi) * r).normalize();
      cen.copy(dir).multiplyScalar(lr * (0.7 + rng() * 0.22)).add(lobe);
      // the card faces mostly outward, tilted at random
      cn.copy(dir).add(new Vector3(rng() - 0.5, rng() - 0.5, rng() - 0.5).multiplyScalar(0.9)).normalize();
      t1.crossVectors(cn, Math.abs(cn.y) > 0.9 ? new Vector3(1, 0, 0) : up).normalize();
      t2.crossVectors(cn, t1).normalize();
      const spin = rng() * Math.PI * 2;
      const cs = Math.cos(spin);
      const sn = Math.sin(spin);
      const size = lr * (0.95 + rng() * 0.4);
      const verts = corners.map(([u, v]) => {
        const a = u * cs - v * sn;
        const b = u * sn + v * cs;
        return new Vector3().copy(cen).addScaledVector(t1, a * size).addScaledVector(t2, b * size);
      });
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = verts[k];
        pos.push(p.x, p.y, p.z);
        // spherical normal: out from the lobe's heart, a touch of the card's own
        n.copy(p).sub(lobe).normalize().multiplyScalar(0.85).addScaledVector(cn, 0.15).normalize();
        nor.push(n.x, n.y, n.z);
        uv.push(corners[k][0] + 0.5, corners[k][1] + 0.5);
        kind.push(0);
      }
    }
  }
  const cards = new BufferGeometry();
  cards.setAttribute('position', new Float32BufferAttribute(pos, 3));
  cards.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  cards.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  cards.setAttribute('aKind', new Float32BufferAttribute(kind, 1));
  // the dark heart of each lobe: what you see between the cards
  const cores: BufferGeometry[] = [];
  for (const [lx, ly, lz, lr] of LOBES) {
    // low-poly: it only ever shows through the gaps
    const g = new IcosahedronGeometry(lr * 0.62, 0).toNonIndexed();
    g.translate(lx, ly, lz);
    g.setAttribute('aKind', new Float32BufferAttribute(new Array(g.attributes.position.count).fill(2), 1));
    cores.push(g);
  }
  const trunk = new CylinderGeometry(0.06, 0.11, 1.9, 6, 1, true).toNonIndexed();
  trunk.translate(0, -1.2, 0);
  trunk.setAttribute('aKind', new Float32BufferAttribute(new Array(trunk.attributes.position.count).fill(1), 1));
  const all = [cards, ...cores, trunk];
  const g = mergeGeometries(all);
  for (const p of all) p.dispose();
  return g;
}

function treeMaterial(): MeshLambertMaterial {
  const leaves = leafTexture();
  const mat = new MeshLambertMaterial({ color: 0xffffff, side: DoubleSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.leafTex = { value: leaves };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float aKind;
varying float vKind;
varying vec2 vLeafUv;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  vKind = aKind;
  vLeafUv = uv;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D leafTex;
varying float vKind;
varying vec2 vLeafUv;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  if (vKind < 0.5) {
    vec4 lt = texture2D(leafTex, vLeafUv);
    // mip levels average leaf and gap into half-alpha: lift alpha with the
    // level so a far crown stays full instead of thinning to nothing
    float lod = log2(max(length(fwidth(vLeafUv * 256.0)), 1.0));
    if (lt.a * (1.0 + lod * 0.45) < 0.5) discard;
    diffuseColor.rgb *= lt.rgb;
  } else if (vKind > 1.5) {
    diffuseColor.rgb *= vec3(0.01, 0.022, 0.008);   // the shadowed heart
  } else {
    diffuseColor.rgb = vec3(0.05, 0.04, 0.032);     // bark
  }`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
  // cards are two-sided but their normals are the CROWN's: never flip them
  normal = normalize(vNormal);`,
      );
  };
  mat.customProgramCacheKey = () => 'cove-tree-cards';
  return outdoor(mat);
}

export function buildCanopy(): InstancedMesh {
  const rng = makeRng(0xca40);
  const mats: Matrix4[] = [];
  const cols: Color[] = [];
  const q = new Quaternion();
  const s = new Vector3();
  const pos = new Vector3();
  // tints over the painted leaves: sunnier, bluer, darker stands
  const greens = [
    new Color(1.0, 1.0, 1.0),
    new Color(1.15, 1.1, 0.75),
    new Color(0.8, 0.9, 1.0),
    new Color(0.75, 0.8, 0.7),
    new Color(1.05, 0.95, 0.8),
  ];
  const tryPlace = (x: number, z: number, minAbove: number): void => {
    const y = groundY(x, z);
    if (y - SEA_Y < minAbove) return;
    if (clearingWeight(x, z) > 0) return;
    if (hillRock(x, z) > 0.4) return; // nothing grows on the bare faces
    const r = 3 + rng() * 4;
    q.setFromAxisAngle(new Vector3(0, 1, 0), rng() * 6.28);
    s.set(r * (0.9 + rng() * 0.3), r * (0.8 + rng() * 0.35), r * (0.9 + rng() * 0.3));
    pos.set(x, y + r * 1.25, z);
    mats.push(new Matrix4().compose(pos, q, s));
    cols.push(greens[Math.floor(rng() * greens.length)].clone().multiplyScalar(0.85 + rng() * 0.3));
  };
  // the hills behind the bay
  for (let i = 0; i < 520; i++) {
    const x = (rng() - 0.5) * 1300;
    const e = 90 + Math.pow(rng(), 0.8) * 480;
    const z = shoreZ(x) + e;
    if (z < 60 && Math.abs(x) < 70) continue; // leave the palm grove behind you open
    tryPlace(x, z, 4);
  }
  // the headlands
  for (let i = 0; i < 220; i++) {
    const side = rng() < 0.55 ? 1 : -1;
    const x = side * (140 + rng() * 260);
    const z = -120 - rng() * 230;
    tryPlace(x, z, 5);
  }
  const mesh = new InstancedMesh(treeGeometry(), treeMaterial(), mats.length);
  mats.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, cols[i]);
  });
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'cove-canopy';
  return mesh;
}

/** Where the palms stand: `near` (full detail, shadow-casting) and `far`. */
export function palmSpots(): { near: PalmSpot[]; far: PalmSpot[] } {
  const rng = makeRng(0x9a1f);
  const near: PalmSpot[] = [];
  const far: PalmSpot[] = [];
  const spot = (x: number, z: number, H: number, leanAz: number, lean: number): PalmSpot => ({
    x,
    y: groundY(x, z) - 0.05,
    z,
    H,
    leanAz,
    lean,
    curve: 0.3 + rng() * 0.6,
    yaw: rng() * 6.28,
    seed: rng(),
  });
  // THE FRAME: palms on both flanks of the clearing leaning out over the
  // sand toward the light and the sea — the tidewater postcard.
  const flank: [number, number, number, number, number][] = [
    // x, z, H, leanAz (0 = +x, −π/2 = −z), lean
    [-19, 1, 9.5, -1.95, 0.28],
    [-23.5, -9, 11, -2.2, 0.36],
    [-18.5, -17, 8, -1.75, 0.42],
    [-30, -3, 12.5, -2.0, 0.18],
    [20, -2, 10.5, -1.25, 0.3],
    [25, -12, 9, -0.95, 0.4],
    [30.5, 3, 12, -1.3, 0.16],
    [19.5, -19.5, 7.5, -1.5, 0.45],
  ];
  for (const [x, z, H, az, l] of flank) near.push(spot(x, z, H, az, l));
  // THE GROVE behind you: a loose fringe along the back of the beach
  let tries = 0;
  while (near.length < 34 && tries++ < 400) {
    const x = (rng() - 0.5) * 150;
    const z = 12 + rng() * 42 + Math.abs(x) * 0.12;
    if (clearingWeight(x, z) > 0.01) continue;
    if (Math.hypot(x, z) < 13) continue;
    if (near.some((p) => Math.hypot(p.x - x, p.z - z) < 5.5)) continue;
    near.push(spot(x, z, 8 + rng() * 5.5, rng() * 6.28, 0.05 + rng() * 0.2));
  }
  // far: along both arms of the beach and up through the jungle
  for (let i = 0; i < 260; i++) {
    const x = (rng() - 0.5) * 900;
    const onBeach = rng() < 0.55;
    const e = onBeach ? 34 + rng() * 40 : 80 + rng() * 380;
    const z = shoreZ(x) + e;
    if (Math.abs(x) < 80 && z < 70) continue; // the near grove owns that ground
    if (clearingWeight(x, z) > 0 || Math.hypot(x - CLEARING.x, z - CLEARING.z) < 40) continue;
    const y = groundY(x, z);
    if (y - SEA_Y < 1.3) continue;
    const leanAz = onBeach ? Math.atan2(shoreZ(x) - z, 0) + (rng() - 0.5) : rng() * 6.28;
    far.push({ x, y: y - 0.1, z, H: 9 + rng() * 6, leanAz, lean: onBeach ? 0.1 + rng() * 0.2 : rng() * 0.08, curve: 0, yaw: rng() * 6.28, seed: rng() });
  }
  return { near, far };
}
