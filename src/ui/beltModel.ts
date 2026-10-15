/**
 * THE BELT, IN THE HAND — a championship belt (campaign/belts.ts) built in
 * 3D for the moment you win it: held up over the wreck of the last titan.
 * FIRE FIGHT FLUX's neon-tube belt (fff ui/belt.ts), rebuilt solid:
 *
 *   the STRAP     a band bowed back at the ends as if round a waist, wearing
 *                 the painted leather (ui/beltArt.ts paintStrap) — tooling,
 *                 stitching, snaps, keeper and tip;
 *   the PLATES    real slabs of polished metal, extruded from the same
 *                 outlines the painting uses, bevelled, each faced with its
 *                 painted enamel and emblem, seated on the strap's curve;
 *   the STONE     a faceted gem standing proud of the centre plate, lit
 *                 from inside, with a halo.
 *
 * About 0.85 m across, facing +z. `flare` pulses the stone and the paint's
 * own light (the award's heartbeat).
 */

import {
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Shape,
  SRGBColorSpace,
  type Material,
  type Sprite,
} from 'three';
import type { Belt } from '../campaign/belts.js';
import { glowSprite } from '../materials/glow.js';
import {
  paintCenterPlate,
  paintSidePlate,
  paintStrap,
  plateOutline,
  sideOutline,
  SIDE_PLATES,
  SIDE_SIZE,
  STRAP_HALF_H,
  STRAP_HALF_W,
  type PathSink,
} from './beltArt.js';

/** Metres per belt unit (the painting is 1000 units across). */
const S = 0.00085;
const W = STRAP_HALF_W * 2 * S;
/** How far the ends bow back. */
const BOW = 0.13;
/** The strap texture's half height in belt units (keeper overhang included). */
const STRAP_TEX_H = STRAP_HALF_H + 12;
/** The centre plate's painted square, ±this many units (flames included). */
const PLATE_TEX_R = 285;
const SLAB = 0.007;
const BEVEL = 0.0025;

/** The strap's surface at x (metres): how far back it bows. */
const bow = (x: number): number => -BOW * ((2 * x) / W) ** 2;
/** …and the yaw that lays a plate flat along it there. */
const lie = (x: number): number => -Math.atan((-8 * BOW * x) / (W * W));

/** Painted surfaces take the light at this: the arena's studio environment
 *  and no tone mapping clip a pale belt (ivory, polished gold) to white at
 *  full albedo. */
const ALBEDO = 0xc8c8c8;

/** Paint into a fresh canvas `w`×`h` px whose centre is the belt-unit origin,
 *  `scale` px per unit. */
function painted(w: number, h: number, scale: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.translate(w / 2, h / 2);
  g.scale(scale, scale);
  paint(g);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** A three.js Shape from a belt-art outline (units → metres, y up). */
function shapeOf(draw: (p: PathSink) => void): Shape {
  const s = new Shape();
  draw({
    moveTo: (x, y) => s.moveTo(x * S, -y * S),
    lineTo: (x, y) => s.lineTo(x * S, -y * S),
    quadraticCurveTo: (cx, cy, x, y) => s.quadraticCurveTo(cx * S, -cy * S, x * S, -y * S),
  });
  s.closePath();
  return s;
}

export class BeltModel {
  readonly root = new Group();
  readonly belt: Belt;
  private readonly faces: MeshStandardMaterial[] = [];
  private readonly gemMat: MeshPhysicalMaterial;
  private readonly halo: Sprite;
  private readonly lamp: PointLight;

  constructor(belt: Belt) {
    this.belt = belt;
    this.root.name = `belt-${belt.id}`;

    // THE STRAP: a bowed band wearing the painted leather.
    const n = 64;
    const h = STRAP_TEX_H * S;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const x = -W / 2 + (W * i) / n;
      pos.push(x, -h, bow(x), x, h, bow(x));
      uv.push(i / n, 0, i / n, 1);
      if (i < n) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3);
    }
    const band = new BufferGeometry();
    band.setAttribute('position', new Float32BufferAttribute(pos, 3));
    band.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    band.setIndex(idx);
    band.computeVertexNormals();
    const strapPx = 2048 / (STRAP_HALF_W * 2);
    const strapTex = painted(2048, Math.round(STRAP_TEX_H * 2 * strapPx), strapPx, (g) => paintStrap(g, belt));
    const leather = new MeshStandardMaterial({ map: strapTex, color: ALBEDO, roughness: 0.6, metalness: 0, envMapIntensity: 0.5, alphaTest: 0.5, side: DoubleSide });
    this.root.add(new Mesh(band, leather));

    const metal = new MeshStandardMaterial({ color: belt.metal.lo, metalness: 1, roughness: 0.32, envMapIntensity: 0.8 });

    // THE SIDE PLATES, I–IV, each a slab on the curve with its face on it.
    SIDE_PLATES.forEach((p, i) => {
      const { rx, ry } = SIDE_SIZE[p.kind];
      const x = p.x * S;
      const plate = new Group();
      plate.position.set(x, 0, bow(x) + 0.0015);
      plate.rotation.y = lie(x);
      const slab = new ExtrudeGeometry(shapeOf((s) => sideOutline(s, p.kind, 0.97)), {
        depth: SLAB * 0.7,
        bevelEnabled: true,
        bevelThickness: BEVEL * 0.7,
        bevelSize: BEVEL * 0.7,
        bevelSegments: 2,
      });
      plate.add(new Mesh(slab, metal));
      const pad = 14;
      const tw = (rx + pad) * 2;
      const th = (ry + pad) * 2;
      const px = 3;
      const tex = painted(Math.round(tw * px), Math.round(th * px), px, (g) => paintSidePlate(g, belt, p.kind, belt.sides[i]));
      const face = this.faceMaterial(tex);
      const decal = new Mesh(new PlaneGeometry(tw * S, th * S), face);
      decal.position.z = SLAB * 0.7 + BEVEL * 0.7 + 0.0006;
      plate.add(decal);
      this.root.add(plate);
    });

    // THE CENTRE PLATE: the big slab, its painted face, and the stone.
    const centre = new Group();
    centre.position.z = 0.002;
    const slab = new ExtrudeGeometry(shapeOf((s) => plateOutline(s, belt.plate, 0.97)), {
      depth: SLAB,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 3,
    });
    centre.add(new Mesh(slab, metal));
    const plateTex = painted(1024, 1024, 1024 / (PLATE_TEX_R * 2), (g) => paintCenterPlate(g, belt));
    const face = this.faceMaterial(plateTex);
    const decal = new Mesh(new PlaneGeometry(PLATE_TEX_R * 2 * S, PLATE_TEX_R * 2 * S), face);
    decal.position.z = SLAB + BEVEL + 0.0006;
    centre.add(decal);

    // The stone: a brilliant's crown, table toward you, standing proud.
    const r = 40 * S;
    const gem = new CylinderGeometry(r * 0.55, r, r * 0.55, 8, 1);
    gem.rotateX(Math.PI / 2);
    gem.rotateZ(Math.PI / 8);
    this.gemMat = new MeshPhysicalMaterial({
      color: belt.gem.core,
      emissive: belt.gem.core,
      emissiveIntensity: 0.4,
      metalness: 0,
      roughness: 0.04,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      flatShading: true,
    });
    const stone = new Mesh(gem, this.gemMat);
    stone.position.set(0, -8 * S, decal.position.z + r * 0.28);
    centre.add(stone);
    this.halo = glowSprite(belt.gem.glow, r * 3, 0.3);
    this.halo.position.copy(stone.position);
    this.halo.position.z += 0.004;
    centre.add(this.halo);
    this.root.add(centre);

    // Its own light, a little above and in front: metal needs something to
    // catch, whatever the arena's lighting is doing over the wreck.
    this.lamp = new PointLight(0xfff1dc, 1.1, 2.2, 2);
    this.lamp.position.set(0.12, 0.3, 0.55);
    this.root.add(this.lamp);
  }

  /** The award's pulse, 0–1: the stone flares, the paint brightens. */
  flare(k: number): void {
    this.gemMat.emissiveIntensity = 0.35 + 0.8 * k;
    this.halo.material.opacity = 0.18 + 0.3 * k;
    this.halo.scale.setScalar(40 * S * 3 * (1 + 0.3 * k));
    for (const f of this.faces) f.emissiveIntensity = 0.08 + 0.1 * k;
  }

  dispose(): void {
    this.root.removeFromParent();
    const mats = new Set<Material>();
    this.root.traverse((o) => {
      const m = o as Mesh;
      if (m.geometry && !(o as Sprite).isSprite) m.geometry.dispose();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => mats.add(x));
      else if (mat && !(o as Sprite).isSprite) mats.add(mat);
    });
    for (const m of mats) {
      (m as MeshStandardMaterial).map?.dispose();
      m.dispose();
    }
    this.halo.material.dispose();
  }

  /** A painted face: lit like metal and enamel, glowing a little on its own
   *  so the painting reads in a dark arena. */
  private faceMaterial(tex: CanvasTexture): MeshStandardMaterial {
    const m = new MeshStandardMaterial({
      map: tex,
      color: ALBEDO,
      emissiveMap: tex,
      emissive: 0xffffff,
      emissiveIntensity: 0.1,
      // The paint already carries its polish; a little reflection on top,
      // no more (the arena has no tone mapping to tame a hot highlight).
      metalness: 0.1,
      roughness: 0.5,
      envMapIntensity: 0.35,
      transparent: true,
      alphaTest: 0.02,
      depthWrite: false,
    });
    this.faces.push(m);
    return m;
  }
}
