/**
 * THE ROUTINE's blocks — the DOWN language, upside down.
 *
 * In DOWN (yellkell.github.io/down) neon polyhedra surge UP through the
 * deck and every wave leaves one quadrant safe. Here the same bodies come
 * from ABOVE: for each routine step, the three quarters you weren't taught
 * get a spinning neon polyhedron descending on a beat-locked path — dark
 * core, additive body shell, blazing wireframe edges, a glow halo — with a
 * telegraph ring on the deck that brightens and tightens under it as it
 * closes. The landing IS the downbeat: the block crushes to the deck,
 * flashes its quarter, throws sparks, and sinks away. The quarter you
 * learned stays bare.
 *
 * The judge is untouched (stand committed in the taught corner at the
 * tick); this module is the danger made VISIBLE — you can watch your death
 * coming the whole way down, which is exactly what the old goo slabs
 * (spawned a frame before impact) never gave anyone.
 *
 * One instance per (seat, step) zone, parented to the platform root and
 * driven by ChoreoSystem: `update(beat)` flies everything off the shared
 * clock, `land()` fires the crush, `dispose()` cleans up.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  DodecahedronGeometry,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  TetrahedronGeometry,
  type Object3D,
} from 'three';
import { CHOREO, OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH, PALETTE } from '../config.js';
import { glowSprite } from '../materials/glow.js';
import { mix, mulberry32 } from '../game/rng.js';

/** Where a block spawns above the deck, and where its centre crushes to. */
const SPAWN_Y = 7.5;
const CRUSH_Y = 0.3;

/** The DOWN shape set, shared by every block in every raid. */
interface ShapeSet {
  body: BufferGeometry;
  edges: BufferGeometry;
}
let shapes: ShapeSet[] | null = null;
function shapeSet(): ShapeSet[] {
  if (shapes) return shapes;
  const bodies = [
    new TetrahedronGeometry(1),
    new OctahedronGeometry(1),
    new DodecahedronGeometry(1),
    new IcosahedronGeometry(1),
  ];
  shapes = bodies.map((body) => ({ body, edges: new EdgesGeometry(body) as unknown as BufferGeometry }));
  return shapes;
}
const ringGeo = new RingGeometry(0.2, 0.27, 28);

interface FallingBlock {
  group: Group;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
  shellMat: MeshBasicMaterial;
  wireMat: LineBasicMaterial;
  x: number;
  z: number;
  spinX: number;
  spinZ: number;
}

export class RoutineBlockfall {
  readonly root = new Group();
  private blocks: FallingBlock[] = [];
  private dropStart: number;
  private due: number;
  private landed = false;
  private landAge = 0;

  /**
   * `safeCorner` is the quarter that lives; the other three get blocks.
   * `seed`+ids keep every client's shapes/spins identical — the fall is
   * part of the show, and the show is deterministic.
   */
  constructor(
    parent: Object3D,
    safeCorner: number,
    dueBeat: number,
    seed: number,
    moveIdx: number,
    step: number,
    dropBeats = CHOREO.routineDropBeats,
  ) {
    this.due = dueBeat;
    this.dropStart = dueBeat - dropBeats;
    this.root.visible = false;
    parent.add(this.root);

    const rng = mulberry32(mix(mix(seed, 0xb10c), moveIdx * 31 + step));
    const kit = shapeSet();
    // The danger speaks hazard amber→red, like every other telegraph — the
    // disco's magenta/cyan never marks a landing.
    const colors = [PALETTE.amber, 0xff7a2a, PALETTE.danger];

    let n = 0;
    for (let corner = 0; corner < 4; corner++) {
      if (corner === safeCorner) continue;
      const x = ((corner & 1 ? 1 : -1) * OCTAGON_HALF_WIDTH) / 2;
      const z = ((corner & 2 ? 1 : -1) * OCTAGON_HALF_DEPTH) / 2;
      const color = colors[n % colors.length];
      const shape = kit[Math.floor(rng() * kit.length)];
      const radius = 0.3 + rng() * 0.1;

      const group = new Group();
      group.position.set(x, SPAWN_Y, z);
      group.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);

      // Dark core so the bright edges have something solid to sit against.
      const core = new Mesh(shape.body, new MeshBasicMaterial({ color: 0x0a0508 }));
      core.scale.setScalar(radius * 0.82);
      group.add(core);
      // Additive body shell — a lit, glowing volume, not a dim wire.
      const shellMat = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.26,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const shell = new Mesh(shape.body, shellMat);
      shell.scale.setScalar(radius);
      group.add(shell);
      const wireMat = new LineBasicMaterial({
        color,
        transparent: true,
        opacity: 1,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const wire = new LineSegments(shape.edges, wireMat);
      wire.scale.setScalar(radius * 1.04);
      group.add(wire);
      group.add(glowSprite(color, radius * 3.6, 0.7));
      this.root.add(group);

      // The deck ring under it — brightens and tightens as the block closes.
      const ringMat = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const ring = new Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(x, 0.06, z);
      this.root.add(ring);

      this.blocks.push({
        group,
        ring,
        ringMat,
        shellMat,
        wireMat,
        x,
        z,
        spinX: (0.8 + rng() * 1.4) * (rng() > 0.5 ? 1 : -1),
        spinZ: 0.6 + rng() * 1.2,
      });
      n++;
    }
  }

  /** Fly everything off the shared song clock. Call every frame. */
  update(beat: number, delta: number): void {
    if (this.landed) {
      // The crush: squash flat, flare the ring wide, fade everything out.
      this.landAge += delta;
      const k = Math.min(1, this.landAge / 0.45);
      for (const b of this.blocks) {
        b.group.scale.y = Math.max(0.12, 1 - k * 1.1);
        b.group.scale.x = b.group.scale.z = 1 + k * 0.35;
        b.group.position.y = Math.max(0.08, CRUSH_Y - k * 0.2);
        b.shellMat.opacity = 0.26 * (1 - k);
        b.wireMat.opacity = 1 - k;
        b.ringMat.opacity = 0.9 * (1 - k);
        b.ring.scale.setScalar(1 + k * 2.2);
      }
      return;
    }

    // Beat-locked descent: 0 at dropStart, 1 (deck) exactly at the due beat.
    const t = (beat - this.dropStart) / Math.max(0.001, this.due - this.dropStart);
    if (t < 0) return;
    this.root.visible = true;
    const fall = Math.min(1, Math.max(0, t));
    // Slightly eased-in so the last half-beat reads fastest — a drop, not
    // an elevator.
    const y = SPAWN_Y - (SPAWN_Y - CRUSH_Y) * fall * fall;
    for (const b of this.blocks) {
      b.group.position.y = y;
      b.group.rotation.x += b.spinX * delta;
      b.group.rotation.z += b.spinZ * delta;
      // DOWN's ring law: brightens as the shape closes in.
      b.ringMat.opacity = 0.12 + fall * 0.75;
      b.ring.scale.setScalar(1.9 - fall * 0.9);
    }
  }

  /** The downbeat: freeze the fall into the crush. */
  land(): void {
    this.landed = true;
    this.landAge = 0;
    this.root.visible = true;
  }

  /** True once the crush has fully played out. */
  get spent(): boolean {
    return this.landed && this.landAge > 0.5;
  }

  dispose(): void {
    this.root.removeFromParent();
    // Shared geometries stay cached; only the per-block materials die.
    for (const b of this.blocks) {
      b.shellMat.dispose();
      b.wireMat.dispose();
      b.ringMat.dispose();
    }
    this.blocks = [];
  }
}
