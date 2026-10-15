/**
 * THE RECITAL's blocks — RAVE RAID's "DOWN language, upside down", ported
 * for the ENCORE campaign: for each recital step, the three quarters the
 * note didn't name get a spinning neon polyhedron descending on a locked
 * clock — dark core, additive body shell, blazing wireframe edges, a glow
 * halo — with a telegraph ring on the deck brightening and tightening under
 * it as it closes. The landing IS the step's detonation: the block crushes
 * to the deck, flashes its quarter, and sinks away. The quarter you learned
 * stays bare.
 *
 * THE DANGER KIT (rave/choreo/telegraphs.ts): the blocks wear the one heat
 * ramp every attack wears — hazard amber at the top of the fall, danger
 * red as they arrive (the fall IS the fill), WHITE-HOT on the crush,
 * burning back out to red.
 *
 * The judge is untouched (stand committed in the called corner at the
 * tick); this module is the danger made VISIBLE. In the recital the fall
 * is SHORT and starts LOW (`spawnY`): the note is the warning, and a
 * block seen coming from the rafters would answer the memory test for
 * you. RAVE RAID drove it off the song's beat clock; here it flies on the
 * attack's own seconds (`update(now)` with the attack-local time),
 * landing exactly on the zone's due time.
 */

import {
  AdditiveBlending,
  BufferGeometry,
  Color,
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
  type SpriteMaterial,
  TetrahedronGeometry,
  type Object3D,
} from 'three';
import { OCTAGON_HALF_DEPTH, OCTAGON_HALF_WIDTH } from '../config.js';
import { HEAT } from '../rave/choreo/telegraphs.js';
import { glowSprite } from '../materials/glow.js';
import { mix, mulberry32 } from './grammar.js';

/** Where a block spawns above the deck, and where its centre crushes to. */
const SPAWN_Y = 7.5;
const CRUSH_Y = 0.3;

/** The DOWN shape set, shared by every block in every fight. */
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

const AMBER = new Color(HEAT.amber);
const DANGER = new Color(HEAT.danger);
const HOT = new Color(HEAT.hot);
const _heat = new Color();

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

interface FallingBlock {
  group: Group;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
  shellMat: MeshBasicMaterial;
  wireMat: LineBasicMaterial;
  glowMat: SpriteMaterial;
  spinX: number;
  spinZ: number;
}

export class RecitalBlockfall {
  readonly root = new Group();
  private blocks: FallingBlock[] = [];
  private dropStart: number;
  private due: number;
  private spawnY: number;
  private landed = false;
  private landAge = 0;

  /**
   * `safeCorner` is the quarter that lives; the other three get blocks.
   * `dueAt` is the attack-local second the step detonates; the fall starts
   * `dropSecs` before it. `seed`+step keep every client's shapes and spins
   * identical — the fall is part of the show, and the show is deterministic.
   */
  constructor(parent: Object3D, safeCorner: number, dueAt: number, dropSecs: number, seed: number, step: number, spawnY = SPAWN_Y) {
    this.due = dueAt;
    this.dropStart = dueAt - dropSecs;
    this.spawnY = spawnY;
    this.root.visible = false;
    parent.add(this.root);

    const rng = mulberry32(mix(mix(seed, 0xb10c), step * 31 + safeCorner));
    const kit = shapeSet();
    // Born amber; update() runs the heat ramp from there.
    const color = HEAT.amber;

    for (let corner = 0; corner < 4; corner++) {
      if (corner === safeCorner) continue;
      const x = ((corner & 1 ? 1 : -1) * OCTAGON_HALF_WIDTH) / 2;
      const z = ((corner & 2 ? 1 : -1) * OCTAGON_HALF_DEPTH) / 2;
      const shape = kit[Math.floor(rng() * kit.length)];
      const radius = 0.3 + rng() * 0.1;

      const group = new Group();
      group.position.set(x, spawnY, z);
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
      const glow = glowSprite(color, radius * 3.6, 0.7);
      group.add(glow);
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
        glowMat: glow.material,
        spinX: (0.8 + rng() * 1.4) * (rng() > 0.5 ? 1 : -1),
        spinZ: 0.6 + rng() * 1.2,
      });
    }
  }

  /** Fly everything off the attack clock. Call every frame. */
  update(now: number, delta: number): void {
    if (this.landed) {
      // The crush: squash flat, flare the ring wide, fade everything out.
      this.landAge += delta;
      const k = Math.min(1, this.landAge / 0.45);
      // Ignites white-hot on the crush, burns out to danger red.
      this.heat(_heat.copy(HOT).lerp(DANGER, smoothstep(0, 0.6, k)));
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

    // Clock-locked descent: 0 at dropStart, 1 (deck) exactly at the due tick.
    const t = (now - this.dropStart) / Math.max(0.001, this.due - this.dropStart);
    if (t < 0) return;
    this.root.visible = true;
    const fall = Math.min(1, Math.max(0, t));
    // Eased-in so the last stretch reads fastest — a drop, not an elevator.
    const y = this.spawnY - (this.spawnY - CRUSH_Y) * fall * fall;
    // The fall is the fill: amber charging, danger red as it arrives.
    this.heat(_heat.copy(AMBER).lerp(DANGER, smoothstep(0.55, 0.95, fall)));
    for (const b of this.blocks) {
      b.group.position.y = y;
      b.group.rotation.x += b.spinX * delta;
      b.group.rotation.z += b.spinZ * delta;
      // DOWN's ring law: brightens as the shape closes in.
      b.ringMat.opacity = 0.12 + fall * 0.75;
      b.ring.scale.setScalar(1.9 - fall * 0.9);
    }
  }

  /** Every block, its glow and its deck ring wear the ramp's colour now. */
  private heat(c: Color): void {
    for (const b of this.blocks) {
      b.shellMat.color.copy(c);
      b.wireMat.color.copy(c);
      b.glowMat.color.copy(c);
      b.ringMat.color.copy(c);
    }
  }

  /** The due tick: freeze the fall into the crush. */
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
      b.glowMat.dispose();
      b.ringMat.dispose();
    }
    this.blocks = [];
  }
}
