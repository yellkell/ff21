/**
 * CoursePlatformSystem — the ground itself: quantized travel, decks, and the
 * whole countdown grammar.
 *
 * With no landings out here the floor is the only thing that ever speaks, so
 * it speaks in the club's own colours — CYAN is ground you may step on, AMBER
 * is ground counting itself out, RED is ground in motion and the burn of a
 * step you missed. Red is not decoration: a deck that is travelling cannot be
 * boarded (the handover gate refuses it), so one painted like a docked deck
 * would be a hazard you can't see, which is the one thing the floor is never
 * allowed to be.
 *
 * It says all of it three ways at once, and none of them can be hidden by the
 * angle you happen to be standing at:
 *
 *   1. CORNER POSTS, one extinguished per beat — vertical, so they read
 *      edge-on, from below, and over the fences. They belong to the
 *      warning: a deck that is simply yours to stand on has none, so the
 *      ground you walk is a clean square and a post going UP is itself
 *      the first beat of the news;
 *   2. RIMS that WRAP the deck edge rather than sitting on top of it —
 *      INLAID, their top under the face, so the warning survives being
 *      looked at from the side without a kerb to step over;
 *   3. the DECK FACE washing amber — the instruction on the surface you are
 *      already looking at, which is where the club puts its telegraphs too
 *      (research/01 §3).
 *
 * THE MACHINE (VOIDSTEP 2's second pass): a deck is not a tile, it is a
 * thing that carries you across nothing, and it looks like one. Gunmetal
 * face with an ETCH of circuit traces lit from inside in the state colour;
 * a two-step keel underneath with VENTS on its flanks that burn when it
 * drives; an UNDERGLOW spilling onto the void's glass; a SCAN LINE sweeping
 * the face once a bar so every docked deck keeps the beat in your eye. All
 * of it is per-instance colour on shared banks — the whole circuit is nine
 * draws, and its reflection SHARES the live instance buffers (banks.ts), so
 * it hangs over its own image the whole way round for one extra draw per
 * bank.
 */

import { createSystem } from '@iwsdk/core';
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { COLOR, COUNTDOWN, GRID, SLIP_FLASH } from '../course/config.js';
import { conductor } from '../course/conductor.js';
import { Bank, mirrorBank, shadedBoxGeometry } from '../course/banks.js';
import { registerDim } from '../course/dimmer.js';
import { deckTexture, etchTexture, glowTexture, patternTexture } from '../course/textures.js';
import {
  anchorAt,
  dwellInfo,
  endpointsOf,
  fencesOf,
  INDEX,
  PLATFORMS,
  sqOffset,
} from '../course/score.js';
import { course, G, platformSoundAt } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { courseView } from './CourseSystem.js';
import { FLOOR_Y } from './CourseVoidSystem.js';

const EDGE_OFF: Record<string, [number, number, number, number]> = {
  // cx, cz, sx, sz for a rim strip on each edge of a tile
  N: [0, -1, 1, 0],
  S: [0, 1, 1, 0],
  E: [1, 0, 0, 1],
  W: [-1, 0, 0, 1],
};
const FILL_ORDER = ['N', 'E', 'S', 'W'] as const;
const POST_CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

interface TileSlot {
  platform: number;
  ox: number;
  oz: number;
  deck: number;
  /** The lit traces on the face — the deck's own neon. */
  etch: number;
  /** The machine's body under the deck, two steps of it — dark steel at
   *  rest, an engine when the deck is travelling. */
  keel: [number, number];
  /** Slots in the keel's flanks that burn when it drives. */
  vents: number[];
  /** The bloom under the whole machine, on the void's glass. */
  glow: number;
  /** The line that sweeps the face once a bar. */
  scan: number;
  rims: Record<string, number>;
  posts: number[];
}

/** The keel's two steps and where the vents sit on the upper one. */
const KEEL_UPPER = { w: 0.78, h: 0.12, y: -0.16 };
const KEEL_LOWER = { w: 0.52, h: 0.1, y: -0.27 };
const VENT_SIDES: [number, number, number, number][] = [
  // cx, cz, sx, sz — a slot on each flank, lying along the flank
  [1, 0, 0, 1],
  [-1, 0, 0, 1],
  [0, 1, 1, 0],
  [0, -1, 1, 0],
];

/** The keel's colours: a machine at rest, one counting itself out, one
 *  under way — the same three words the rims speak, from underneath. */
const KEEL = { rest: 0x1a1826, warn: 0xffaa22, drive: 0xff2244 };

interface FenceSlot {
  platform: number;
  x: number;
  z: number;
  edge: string;
  rail: number;
  posts: [number, number];
}

export class CoursePlatformSystem extends createSystem({}) {
  private decks!: Bank;
  private etches!: Bank;
  private keels!: Bank;
  private vents!: Bank;
  private glows!: Bank;
  private scans!: Bank;
  private rims!: Bank;
  private posts!: Bank;
  private fences!: Bank;
  private tiles: TileSlot[] = [];
  private fenceSlots: FenceSlot[] = [];
  private ghostGroup!: Group;
  /** platform index → its first deck instance, for the colour read-back. */
  private firstDeck: number[] = [];
  private rigPattern!: Mesh;
  private lastBeat = -1;

  init(): void {
    // The reflections carry per-material clipping planes (course/banks.ts
    // mirrorBank), and three ignores those unless the renderer is told to
    // respect object-level clipping. The club's mirror sets the same flag
    // for itself; the circuit is a scene the club's mirror never enters,
    // so it has to ask on its own behalf. It costs nothing for the
    // materials that carry no planes, which is all of them but six.
    this.renderer.localClippingEnabled = true;
    const root = courseRoot();
    courseView.deckTint = (id) => {
      const pi = INDEX[id];
      const slot = pi === undefined ? undefined : this.firstDeck[pi];
      const a = this.decks?.mesh.instanceColor;
      if (slot === undefined || !a) return null;
      return { r: a.getX(slot), g: a.getY(slot), b: a.getZ(slot) };
    };
    G.platforms = PLATFORMS.map(() => ({
      anchor: { x: 0, y: 0, z: 0 },
      moving: false,
      departIn: Infinity,
      aligned: false,
    }));

    const box = shadedBoxGeometry();
    // A unit plane lying flat, for the layers that are only light.
    const flat = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    // The face is the dark half of the sign: gunmetal, tinted per instance
    // (the amber count-out, the red burn) — nothing on it glows by itself.
    const deckMat = new MeshBasicMaterial({ vertexColors: true, map: deckTexture() });
    // The etch is the lit half: traces, additive, pure instance colour.
    const etchMat = new MeshBasicMaterial({
      map: etchTexture(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    const keelMat = new MeshBasicMaterial({ vertexColors: true });
    const ventMat = new MeshBasicMaterial({});
    const glowMat = new MeshBasicMaterial({
      map: glowTexture(),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    const scanMat = new MeshBasicMaterial({});
    const rimMat = new MeshBasicMaterial({});
    const postMat = new MeshBasicMaterial({});
    const fenceMat = new MeshBasicMaterial({});
    registerDim(deckMat, 'scenery');
    registerDim(etchMat, 'ground');
    registerDim(keelMat, 'ground');
    registerDim(ventMat, 'ground');
    registerDim(glowMat, 'ground');
    registerDim(scanMat, 'ground');
    registerDim(rimMat, 'ground');
    registerDim(postMat, 'ground');
    registerDim(fenceMat, 'ground');

    let tileCount = 0;
    for (const p of PLATFORMS) tileCount += p.claim.length;

    this.decks = new Bank(box, deckMat, tileCount);
    this.etches = new Bank(flat, etchMat, tileCount);
    this.keels = new Bank(box, keelMat, tileCount * 2);
    this.vents = new Bank(box, ventMat, tileCount * 4);
    this.glows = new Bank(flat, glowMat, tileCount);
    this.scans = new Bank(box, scanMat, tileCount);
    this.rims = new Bank(box, rimMat, tileCount * 4);
    this.posts = new Bank(box, postMat, tileCount * 4);

    const fenceLists = PLATFORMS.map((p) => fencesOf(p));
    let fenceCount = 0;
    for (const l of fenceLists) fenceCount += l.length;
    this.fences = new Bank(box, fenceMat, fenceCount * 3);

    PLATFORMS.forEach((spec, pi) => {
      for (const sq of spec.claim) {
        const o = sqOffset(sq);
        const slot: TileSlot = {
          platform: pi,
          ox: o.x,
          oz: o.z,
          deck: this.decks.add(0, 0, 0, GRID.tile, 0.1, GRID.tile, 0xffffff),
          etch: this.etches.add(0, 0, 0, GRID.tile, 1, GRID.tile, COLOR.rimSafe),
          keel: [
            this.keels.add(0, 0, 0, GRID.tile * KEEL_UPPER.w, KEEL_UPPER.h, GRID.tile * KEEL_UPPER.w, KEEL.rest),
            this.keels.add(0, 0, 0, GRID.tile * KEEL_LOWER.w, KEEL_LOWER.h, GRID.tile * KEEL_LOWER.w, KEEL.rest),
          ],
          vents: [],
          glow: this.glows.add(0, 0, 0, GRID.tile * 2.0, 1, GRID.tile * 2.0, COLOR.rimSafe),
          scan: this.scans.add(0, 0, 0, 0.008, 0.006, GRID.tile * 0.9, COLOR.rimSafe),
          rims: {},
          posts: [],
        };
        for (let k = 0; k < 4; k++) {
          slot.vents.push(this.vents.add(0, 0, 0, 0.02, 0.03, 0.02, COLOR.rimSafe));
        }
        for (const e of FILL_ORDER) {
          slot.rims[e] = this.rims.add(0, 0, 0, 0.05, 0.09, 0.05, COLOR.rimSafe);
        }
        for (let k = 0; k < 4; k++) {
          slot.posts.push(
            this.posts.add(0, 0, 0, COUNTDOWN.postSize, COUNTDOWN.postIdle, COUNTDOWN.postSize, COLOR.rimSafe),
          );
        }
        if (this.firstDeck[pi] === undefined) this.firstDeck[pi] = slot.deck;
        this.tiles.push(slot);
      }
      for (const f of fenceLists[pi]) {
        this.fenceSlots.push({
          platform: pi,
          x: f.x,
          z: f.z,
          edge: f.edge,
          rail: this.fences.add(0, 0, 0, 1, 1, 1, COLOR.fence),
          posts: [
            this.fences.add(0, 0, 0, 1, 1, 1, COLOR.fence),
            this.fences.add(0, 0, 0, 1, 1, 1, COLOR.fence),
          ],
        });
      }
    });

    root.add(
      this.decks.mesh,
      this.keels.mesh,
      this.vents.mesh,
      this.rims.mesh,
      this.posts.mesh,
      this.fences.mesh,
      this.scans.mesh,
      this.etches.mesh,
      this.glows.mesh,
    );
    root.add(
      mirrorBank(this.decks, FLOOR_Y),
      mirrorBank(this.keels, FLOOR_Y, 0.3),
      mirrorBank(this.rims, FLOOR_Y, 0.22),
      mirrorBank(this.vents, FLOOR_Y, 0.3),
      mirrorBank(this.etches, FLOOR_Y, 0.45),
      mirrorBank(this.glows, FLOOR_Y, 0.5),
    );

    this.buildGhosts(root);
  }

  /**
   * THE GHOST OVERLAYS (research/03 §3): every platform stamped with the
   * play-area pattern crop of its claim, at every stop of its travel,
   * deduplicated where two machines share a berth. It is the authoring view
   * that made the score correct in the first place, and it costs one mesh
   * to leave in — so it stays, on a hold of the squeeze.
   */
  private buildGhosts(root: Group): void {
    const tex = patternTexture();
    const positions: number[] = [];
    const uvs: number[] = [];
    const index: number[] = [];
    let vi = 0;
    const half = GRID.pitch / 2;
    const seen = new Set<string>();
    const stamp = (a: { x: number; y: number; z: number }, sq: readonly [number, number]): void => {
      const key = `${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}:${sq[0]},${sq[1]}`;
      if (seen.has(key)) return;
      seen.add(key);
      const o = sqOffset(sq);
      const cx = a.x + o.x;
      const cz = a.z + o.z;
      const y = a.y + 0.012;
      const u0 = (sq[0] + 1) / 3;
      const v0 = 1 - (sq[1] + 2) / 3;
      positions.push(
        cx - half, y, cz - half,
        cx + half, y, cz - half,
        cx + half, y, cz + half,
        cx - half, y, cz + half,
      );
      uvs.push(u0, v0 + 1 / 3, u0 + 1 / 3, v0 + 1 / 3, u0 + 1 / 3, v0, u0, v0);
      index.push(vi, vi + 2, vi + 1, vi, vi + 3, vi + 2);
      vi += 4;
    };
    for (const spec of PLATFORMS) {
      for (const a of endpointsOf(spec)) {
        for (const sq of spec.claim) stamp(a, sq);
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(index);
    const endpointMesh = new Mesh(
      geo,
      new MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: DoubleSide,
      }),
    );

    const rp = GRID.pitch * 3;
    const rigGeo = new BufferGeometry();
    rigGeo.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([
          -rp / 2, 0, -rp / 2, rp / 2, 0, -rp / 2, rp / 2, 0, rp / 2, -rp / 2, 0, rp / 2,
        ]),
        3,
      ),
    );
    rigGeo.setAttribute('uv', new BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    rigGeo.setIndex([0, 2, 1, 0, 3, 2]);
    this.rigPattern = new Mesh(
      rigGeo,
      new MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.28,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.ghostGroup = new Group();
    this.ghostGroup.add(endpointMesh, this.rigPattern);
    this.ghostGroup.visible = false;
    root.add(this.ghostGroup);
  }

  update(dt: number): void {
    if (!course.active) return;
    const bar = G.transport.bars;
    const beatPulse = 0.75 + 0.25 * Math.cos(G.transport.barPhase * Math.PI * 8);

    for (let i = 0; i < PLATFORMS.length; i++) {
      const st = G.platforms[i];
      anchorAt(PLATFORMS[i], bar, st.anchor);
      const d = dwellInfo(PLATFORMS[i], bar);
      st.moving = d.moving;
      st.departIn = d.departIn;
    }

    // The ground you own counting itself out is the standing hazard on the
    // circuit, and the void ducks for it (CourseVoidSystem).
    G.groundLeaving = G.platforms[G.tracked]?.departIn <= 1;
    if (G.slipFlash > 0) G.slipFlash = Math.max(0, G.slipFlash - dt);

    // THE COUNTDOWN, out loud. On each beat, EVERY deck in its final dwell
    // bar ticks — from where it is, at a volume set by how close it is to
    // going and how close you are to it.
    //
    // It used to be one tick: the ground you own, or failing that the ground
    // you were being invited onto, and nothing else. That was a metronome
    // with no direction in it, and it told you about at most one deck when
    // the thing you actually want to know — walking a circuit by feel, half
    // of it behind you — is which way the floor is about to move. Now the
    // whole floor counts, quietly, and your ear picks the near one out.
    const beatNow = Math.floor(bar * 4);
    if (beatNow !== this.lastBeat) {
      this.lastBeat = beatNow;
      for (let idx = 0; idx < G.platforms.length; idx++) {
        const st = G.platforms[idx];
        if (st.departIn > 1) continue;
        conductor.tick(Math.ceil(st.departIn * 4), platformSoundAt(idx));
      }
    }

    for (const t of this.tiles) {
      const st = G.platforms[t.platform];
      const x = st.anchor.x + t.ox;
      const y = st.anchor.y;
      const z = st.anchor.z + t.oz;
      this.decks.set(t.deck, x, y - 0.05, z, GRID.tile, 0.1, GRID.tile);
      this.etches.set(t.etch, x, y + 0.004, z, GRID.tile, 1, GRID.tile);
      this.keels.set(t.keel[0], x, y + KEEL_UPPER.y, z, GRID.tile * KEEL_UPPER.w, KEEL_UPPER.h, GRID.tile * KEEL_UPPER.w);
      this.keels.set(t.keel[1], x, y + KEEL_LOWER.y, z, GRID.tile * KEEL_LOWER.w, KEEL_LOWER.h, GRID.tile * KEEL_LOWER.w);
      this.glows.set(t.glow, x, y + KEEL_LOWER.y - 0.09, z, GRID.tile * 2.0, 1, GRID.tile * 2.0);

      const warn = st.departIn <= 1;
      const fill = warn ? 1 - st.departIn : 0;
      // The burn of a missed step, on the deck that went without you.
      const burn = G.slipAt === t.platform ? G.slipFlash / SLIP_FLASH : 0;

      if (burn > 0) {
        this.decks.color(t.deck, COLOR.rimDanger, 0.35 + 0.65 * burn);
      } else if (warn) {
        this.decks.color(t.deck, COLOR.rimWarn, (0.1 + 0.5 * fill) * (0.7 + 0.45 * beatPulse));
      } else if (st.moving) {
        // IN MOTION — the gate refuses it, so stepping on is a miss. It
        // wears the same red a landing does in a set.
        this.decks.color(t.deck, COLOR.rimDanger, 0.16);
      } else {
        this.decks.color(t.deck, COLOR.deckTop);
      }

      // THE ENGINE. A deck under way is driven from below: its keel burns
      // the same red the rims wear, pulsing with the beat, so a machine
      // crossing the void reads as a machine and not as a tile sliding.
      // Counting out, it warms amber with the deck; at rest it is steel.
      for (const k of t.keel) {
        if (burn > 0) {
          this.keels.color(k, KEEL.drive, 0.5 + burn);
        } else if (warn) {
          this.keels.color(k, KEEL.warn, 0.25 + 0.4 * fill);
        } else if (st.moving) {
          this.keels.color(k, KEEL.drive, 0.7 + 0.5 * beatPulse);
        } else {
          this.keels.color(k, KEEL.rest);
        }
      }

      // THE ETCH: the traces on the face carry the state in light. Docked
      // and aligned they breathe cyan with the beat; counting out they
      // fill amber; under way and burnt they are red like everything else.
      if (burn > 0) {
        this.etches.color(t.etch, COLOR.rimDanger, 1.1 + burn);
      } else if (warn) {
        this.etches.color(t.etch, COLOR.rimWarn, (0.55 + 0.9 * fill) * (0.75 + 0.35 * beatPulse));
      } else if (st.moving) {
        this.etches.color(t.etch, COLOR.rimDanger, 0.7 + 0.4 * beatPulse);
      } else if (st.aligned) {
        this.etches.color(t.etch, COLOR.rimSafe, 0.95 + 0.3 * beatPulse);
      } else {
        this.etches.color(t.etch, COLOR.rimSafe, 0.6);
      }

      // THE VENTS in the keel's flanks: a machine at rest shows a cool
      // pilot glow; one under way blows red with the beat.
      for (let k = 0; k < 4; k++) {
        const [vcx, vcz, vsx, vsz] = VENT_SIDES[k];
        const half = (GRID.tile * KEEL_UPPER.w) / 2 + 0.004;
        this.vents.set(
          t.vents[k],
          x + vcx * half,
          y + KEEL_UPPER.y,
          z + vcz * half,
          vsx === 1 ? GRID.tile * 0.5 : 0.012,
          0.045,
          vsz === 1 ? GRID.tile * 0.5 : 0.012,
        );
        if (burn > 0) {
          this.vents.color(t.vents[k], COLOR.rimDanger, 1 + burn);
        } else if (warn) {
          this.vents.color(t.vents[k], COLOR.rimWarn, 0.6 + 0.8 * fill);
        } else if (st.moving) {
          this.vents.color(t.vents[k], COLOR.rimDanger, 1.1 + 0.7 * beatPulse);
        } else if (st.aligned) {
          this.vents.color(t.vents[k], COLOR.rimSafe, 0.7 + 0.2 * beatPulse);
        } else {
          this.vents.color(t.vents[k], COLOR.rimSafe, 0.32);
        }
      }

      // THE UNDERGLOW on the glass: the same light, spilt.
      if (burn > 0) {
        this.glows.color(t.glow, COLOR.rimDanger, 0.55 + 0.6 * burn);
      } else if (warn) {
        this.glows.color(t.glow, COLOR.rimWarn, 0.3 + 0.35 * fill);
      } else if (st.moving) {
        this.glows.color(t.glow, COLOR.rimDanger, 0.55 + 0.35 * beatPulse);
      } else if (st.aligned) {
        this.glows.color(t.glow, COLOR.rimSafe, 0.4 + 0.14 * beatPulse);
      } else {
        this.glows.color(t.glow, COLOR.rimSafe, 0.26);
      }

      // THE SCAN LINE: once a bar, west to east across every docked face,
      // so the whole circuit visibly keeps time — and twice a bar, in red,
      // across a machine under way.
      const sweep = st.moving ? (G.transport.barPhase * 2) % 1 : G.transport.barPhase;
      this.scans.set(
        t.scan,
        x + GRID.tile * (0.45 * (2 * sweep - 1)),
        y + 0.008,
        z,
        0.008,
        0.006,
        GRID.tile * 0.9,
      );
      if (burn > 0) {
        this.scans.color(t.scan, COLOR.rimDanger, 1.2);
      } else if (warn) {
        this.scans.color(t.scan, COLOR.rimWarn, 1.3);
      } else if (st.moving) {
        this.scans.color(t.scan, COLOR.rimDanger, 1.1);
      } else {
        this.scans.color(t.scan, COLOR.rimSafe, st.aligned ? 1.15 : 0.65);
      }

      // Rims wrap the deck edge — visible from the side and from below.
      // They are INLAID: their top sits 2 mm under the face rather than
      // standing proud of it, so a deck is a flat thing to walk on and a
      // multi-tile platform has no kerb across its middle. The wrap still
      // hangs down the edge, which is where it is read from.
      for (let e = 0; e < FILL_ORDER.length; e++) {
        const edge = FILL_ORDER[e];
        const [cx, cz, sx, sz] = EDGE_OFF[edge];
        const half = GRID.tile / 2 + 0.012;
        const idx = t.rims[edge];
        this.rims.set(
          idx,
          x + cx * half,
          y - 0.052,
          z + cz * half,
          sx === 1 ? GRID.tile + 0.06 : 0.055,
          0.1,
          sz === 1 ? GRID.tile + 0.06 : 0.055,
        );
        if (burn > 0) {
          this.rims.color(idx, COLOR.rimDanger, 0.6 + burn);
        } else if (warn) {
          // One quarter of the rim lights per beat gone — the wrap fills
          // like a clock face.
          const lit = (e + 1) / 4 <= fill + 0.001;
          this.rims.color(idx, lit ? COLOR.rimWarn : COLOR.rimSafe, lit ? 1.2 + beatPulse * 0.4 : 0.35);
        } else if (st.moving) {
          this.rims.color(idx, COLOR.rimDanger, 0.9 + 0.5 * beatPulse);
        } else if (st.aligned) {
          this.rims.color(idx, COLOR.rimSafe, 0.5 + 0.35 * beatPulse);
        } else {
          this.rims.color(idx, COLOR.rimSafe, 0.16);
        }
      }

      // Corner posts — the beat countdown no angle can hide. One dies per
      // beat of the final bar; departure is four dead posts. They belong to
      // the deck being BUSY and to nothing else: ground that is simply
      // yours to stand on carries none of them, so a docked deck is a clean
      // square instead of four raised nubs you step around. They stand UP
      // OUT of the face (base flush with it) the moment the deck counts
      // out, DRIVES, or burns — and going up is itself the first beat of
      // the news.
      //
      // The raise on `st.moving` was taken out for a while, on a reading of
      // "raised blocks on the grounded platforms" that turned out to be
      // about something else entirely: the reflection folding its keel up
      // through the deck face (course/banks.ts mirrorBank, and the world
      // -space clipping plane that now stops it). The posts were never the
      // complaint, the animation is the best thing the deck does, and it is
      // back where it was.
      const beatsLeft = warn ? Math.max(1, Math.ceil(st.departIn * 4)) : 0;
      const up = warn || st.moving || burn > 0;
      for (let k = 0; k < 4; k++) {
        const [pcx, pcz] = POST_CORNERS[k];
        const inset = GRID.tile / 2 - 0.04;
        const h = warn ? COUNTDOWN.postWarn : up ? COUNTDOWN.postIdle : 0;
        this.posts.set(
          t.posts[k],
          x + pcx * inset,
          y + h / 2,
          z + pcz * inset,
          up ? COUNTDOWN.postSize : 0,
          h,
          up ? COUNTDOWN.postSize : 0,
        );
        if (burn > 0) {
          this.posts.color(t.posts[k], COLOR.rimDanger, 0.5 + burn);
        } else if (warn) {
          this.posts.color(t.posts[k], COLOR.rimWarn, k < beatsLeft ? 1.35 + 0.5 * beatPulse : 0.08);
        } else if (st.moving) {
          this.posts.color(t.posts[k], COLOR.rimDanger, 0.5);
        } else if (st.aligned) {
          this.posts.color(t.posts[k], COLOR.rimSafe, 0.5 + 0.3 * beatPulse);
        } else {
          this.posts.color(t.posts[k], COLOR.rimSafe, 0.12);
        }
      }
    }

    for (const f of this.fenceSlots) {
      const st = G.platforms[f.platform];
      const [cx, cz, sx, sz] = EDGE_OFF[f.edge];
      const half = GRID.tile / 2;
      const x = st.anchor.x + f.x + cx * half;
      const y = st.anchor.y;
      const z = st.anchor.z + f.z + cz * half;
      this.fences.set(
        f.rail,
        x,
        y + 0.15,
        z,
        sx === 1 ? GRID.tile * 0.94 : 0.02,
        0.02,
        sz === 1 ? GRID.tile * 0.94 : 0.02,
      );
      const px = sx === 1 ? GRID.tile * 0.44 : 0;
      const pz = sz === 1 ? GRID.tile * 0.44 : 0;
      this.fences.set(f.posts[0], x - px, y + 0.08, z - pz, 0.026, 0.15, 0.026);
      this.fences.set(f.posts[1], x + px, y + 0.08, z + pz, 0.026, 0.15, 0.026);
    }

    this.ghostGroup.visible = G.ghosts;
    if (G.ghosts) this.rigPattern.position.set(G.rig.x, G.rig.y + 0.016, G.rig.z);
  }
}
