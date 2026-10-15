/**
 * THE BELT, IN THE HAND — a championship belt (campaign/belts.ts) built in
 * 3D for the moment you win it: held up over the wreck. FIRE FIGHT FLUX's
 * neon belt (fff ui/belt.ts), rebuilt with the painted neon of
 * ui/beltArt.ts:
 *
 *   the STRAP     a band bowed back at the ends as if round a waist,
 *                 wearing the painted strap — tinted glass, lit edges, the
 *                 dashed stitch tube, the keeper;
 *   the PLATES    slabs of dark glass, extruded from the same outlines the
 *                 painting uses and seated on the strap's curve, each faced
 *                 with its painted tubes and emblem;
 *   the STONE     a small crystal standing proud of the centre plate inside
 *                 a halo of its colour.
 *
 * The paint is unlit and untone-mapped: neon is light, not a surface the
 * arena's lamps should shade. About 0.85 m across, facing +z. `flare`
 * pulses it all (the award's heartbeat).
 */

import {
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Shape,
  SRGBColorSpace,
  type Material,
  type Sprite,
} from 'three';
import type { Belt } from '../campaign/belts.js';
import { glowSprite } from '../materials/glow.js';
import {
  paintAt,
  paintCenterPlate,
  paintSidePlate,
  paintStrapUnderPlates,
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
/** The strap texture's half height in belt units (the keeper overhangs). */
const STRAP_TEX_H = STRAP_HALF_H + 22;
/** The centre plate's painted square, ±this many units (flames included). */
const PLATE_TEX_R = 285;
/** Room round a side plate's painting for its glow. */
const SIDE_PAD = 22;
const SLAB = 0.006;
const BEVEL = 0.002;

/** The strap's surface at x (metres): how far back it bows. */
const bow = (x: number): number => -BOW * ((2 * x) / W) ** 2;
/** …and the yaw that lays a plate flat along it there. */
const lie = (x: number): number => -Math.atan((-8 * BOW * x) / (W * W));

/** Paint into a fresh canvas `w`×`h` px whose centre is the belt-unit origin,
 *  `px` pixels per unit. */
function painted(w: number, h: number, px: number, paint: (g: CanvasRenderingContext2D) => void): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.translate(w / 2, h / 2);
  g.scale(px, px);
  paintAt(px, () => paint(g));
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
  private readonly lit: MeshBasicMaterial[] = [];
  private readonly halo: Sprite;
  private readonly crystal: MeshBasicMaterial;

  constructor(belt: Belt) {
    this.belt = belt;
    this.root.name = `belt-${belt.id}`;

    // THE STRAP: a bowed band wearing the painted strap.
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
    const strapPx = 2048 / (STRAP_HALF_W * 2);
    const strapTex = painted(2048, Math.round(STRAP_TEX_H * 2 * strapPx), strapPx, (g) => paintStrapUnderPlates(g, belt));
    this.root.add(new Mesh(band, this.neon(strapTex)));

    // Dark glass for the plates: it catches the arena's reflections at its
    // edges, and the paint glows on top.
    const glass = new MeshStandardMaterial({
      color: 0x060a16,
      metalness: 0.4,
      roughness: 0.08,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });

    // THE SIDE PLATES, each a slab on the curve with its face on it.
    SIDE_PLATES.forEach((p, i) => {
      const { rx, ry } = SIDE_SIZE[p.kind];
      const x = p.x * S;
      const plate = new Group();
      plate.position.set(x, 0, bow(x) + 0.001);
      plate.rotation.y = lie(x);
      const slab = new ExtrudeGeometry(shapeOf((s) => sideOutline(s, p.kind, 0.98)), {
        depth: SLAB * 0.7,
        bevelEnabled: true,
        bevelThickness: BEVEL,
        bevelSize: BEVEL,
        bevelSegments: 2,
      });
      plate.add(new Mesh(slab, glass));
      const tw = (rx + SIDE_PAD) * 2;
      const th = (ry + SIDE_PAD) * 2;
      const px = 3;
      const tex = painted(Math.round(tw * px), Math.round(th * px), px, (g) => paintSidePlate(g, belt, p.kind, belt.sides[i]));
      const face = new Mesh(new PlaneGeometry(tw * S, th * S), this.neon(tex));
      face.position.z = SLAB * 0.7 + BEVEL + 0.0006;
      plate.add(face);
      this.root.add(plate);
    });

    // THE CENTRE PLATE: the big slab, its painted face, and the stone.
    const centre = new Group();
    centre.position.z = 0.002;
    const slab = new ExtrudeGeometry(shapeOf((s) => plateOutline(s, belt.plate, 0.98)), {
      depth: SLAB,
      bevelEnabled: true,
      bevelThickness: BEVEL,
      bevelSize: BEVEL,
      bevelSegments: 2,
    });
    centre.add(new Mesh(slab, glass));
    const plateTex = painted(1024, 1024, 1024 / (PLATE_TEX_R * 2), (g) => paintCenterPlate(g, belt));
    const face = new Mesh(new PlaneGeometry(PLATE_TEX_R * 2 * S, PLATE_TEX_R * 2 * S), this.neon(plateTex));
    face.position.z = SLAB + BEVEL + 0.0006;
    centre.add(face);

    // The stone: a brilliant's crown, table toward you, inside its halo.
    const r = 34 * S;
    const gem = new CylinderGeometry(r * 0.55, r, r * 0.5, 8, 1);
    gem.rotateX(Math.PI / 2);
    gem.rotateZ(Math.PI / 8);
    this.crystal = new MeshBasicMaterial({ color: belt.gem, transparent: true, opacity: 0.9, toneMapped: false });
    const crystal = new Mesh(gem, this.crystal);
    crystal.position.set(0, -4 * S, face.position.z + r * 0.25);
    centre.add(crystal);
    this.halo = glowSprite(belt.gem, r * 4, 0.45);
    this.halo.position.copy(crystal.position);
    this.halo.position.z += 0.004;
    centre.add(this.halo);
    this.root.add(centre);
  }

  /** The award's pulse, 0–1: the tubes brighten, the stone flares. */
  flare(k: number): void {
    for (const m of this.lit) m.color.setScalar(0.9 + 0.5 * k);
    this.crystal.color.set(this.belt.gem).multiplyScalar(1 + 0.6 * k);
    this.halo.material.opacity = 0.3 + 0.45 * k;
    this.halo.scale.setScalar(34 * S * 4 * (1 + 0.4 * k));
  }

  dispose(): void {
    this.root.removeFromParent();
    const mats = new Set<Material>();
    this.root.traverse((o) => {
      if ((o as Sprite).isSprite) return;
      const m = o as Mesh;
      m.geometry?.dispose();
      if (m.material) mats.add(m.material as Material);
    });
    for (const m of mats) {
      (m as MeshBasicMaterial).map?.dispose();
      m.dispose();
    }
    this.halo.material.dispose();
  }

  /** Painted neon: unlit, untone-mapped, see-through. */
  private neon(tex: CanvasTexture): MeshBasicMaterial {
    const m = new MeshBasicMaterial({
      map: tex,
      color: new Color(1, 1, 1),
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      toneMapped: false,
    });
    this.lit.push(m);
    return m;
  }
}
