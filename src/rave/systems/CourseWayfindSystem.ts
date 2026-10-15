/**
 * CourseWayfindSystem — where to stand, and the ledger that closes the lap.
 *
 * Two signs, both on the ground, both wordless:
 *
 *   THE INVITATION — a breathing circle of light on the next tile of the
 *   route, whenever that ground is actually here and steppable. At the very
 *   start it sits on the home pad itself: begin here.
 *
 *   THE BERTH — dim corner brackets marking where the route's next machine
 *   will dock while it is still away, so you aim your body at ground that
 *   is COMING rather than ground that has gone.
 *
 *   THE ARROW — a chevron on the ground a step ahead of you, pointing at
 *   the invitation. The circuit only closes one way round, and a body
 *   stood on a deck with ground on both sides was picking the wrong one
 *   half the time: the invitation said WHERE, but from a few metres off
 *   two glowing tiles look alike. The chevron says WHICH WAY.
 *
 * The route is one ring — the circuit — so this system also keeps the lap
 * ledger: stepping home off the west runner closes it and rings the bell,
 * and CourseSystem takes that as the cue to open the door back to the club.
 */

import { createSystem } from '@iwsdk/core';
import { AdditiveBlending, BoxGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Shape, ShapeGeometry } from 'three';
import { glowTexture } from '../materials/glow.js';
import { COLOR, GRID, WAYFIND } from '../course/config.js';
import { conductor } from '../course/conductor.js';
import { Bank, shadedBoxGeometry } from '../course/banks.js';
import { registerDim } from '../course/dimmer.js';
import { endpointsOf, homeward, HOME_INDEX, INDEX, PLATFORMS, ROUTE, sqOffset } from '../course/score.js';
import { course, G, platformSoundAt } from '../course/state.js';
import { courseRoot } from '../course/world.js';
import { courseView } from './CourseSystem.js';

interface BerthSlot {
  platform: number;
  stop: { x: number; y: number; z: number };
  nubs: { idx: number; x: number; y: number; z: number }[];
}

export class CourseWayfindSystem extends createSystem({}) {
  private invitation!: Mesh;
  private invitationMat!: MeshBasicMaterial;
  /** THE ARROW: a chevron a step ahead of the body, turned toward the
   *  invitation. The group yaws; the chevron inside it lies flat. */
  private arrow!: Group;
  private arrowMat!: MeshBasicMaterial;
  private berths!: Bank;
  private berthSlots: BerthSlot[] = [];
  private lastTracked = 0;
  /** THE GATE — the door home, standing on the home pad's south edge. */
  private gatePane!: MeshBasicMaterial;
  private gateEdge!: MeshBasicMaterial;
  /** Bar time the lap closed at (−1 = still out), for the gate's flare. */
  private closedAt = -1;
  /** The invitation's tile in play-area coordinates, or null when the
   *  route's next ground isn't here — the dev window's step hint. */
  private next: { x: number; z: number } | null = null;

  init(): void {
    courseView.nextStep = () => (this.next ? { ...this.next } : null);
    const root = courseRoot();
    this.invitationMat = new MeshBasicMaterial({
      map: glowTexture(),
      color: COLOR.rimSafe,
      transparent: true,
      opacity: 0.55,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.invitation = new Mesh(
      new PlaneGeometry(GRID.tile * 0.95, GRID.tile * 0.95),
      this.invitationMat,
    );
    this.invitation.rotation.x = -Math.PI / 2;
    this.invitation.visible = false;
    registerDim(this.invitationMat, 'ground');
    root.add(this.invitation);

    // The chevron: a flat ">" pointing along its group's −z, so yawing
    // the group is all it takes to aim it. Additive like the invitation,
    // so it reads as light on the ground and never as a solid.
    this.arrowMat = new MeshBasicMaterial({
      color: COLOR.rimSafe,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    registerDim(this.arrowMat, 'ground');
    const shape = new Shape();
    const L = GRID.tile * 0.34;
    const T = GRID.tile * 0.11;
    // A chevron drawn in the XY plane with its point at +y; the mesh is
    // then laid flat, which maps +y onto −z.
    shape.moveTo(0, L);
    shape.lineTo(L * 0.9, -L * 0.25);
    shape.lineTo(L * 0.9 - T, -L * 0.25 - T * 0.4);
    shape.lineTo(0, L - T * 1.6);
    shape.lineTo(-(L * 0.9 - T), -L * 0.25 - T * 0.4);
    shape.lineTo(-L * 0.9, -L * 0.25);
    shape.closePath();
    const chevron = new Mesh(new ShapeGeometry(shape), this.arrowMat);
    chevron.rotation.x = -Math.PI / 2;
    this.arrow = new Group();
    this.arrow.add(chevron);
    this.arrow.visible = false;
    root.add(this.arrow);

    // Every stop of every moving platform gets a set of corner nubs; per
    // frame only the route-relevant berth is shown.
    const moving = PLATFORMS.map((p, i) => ({ p, i })).filter(({ p }) => p.keys.length > 1);
    let cap = 0;
    for (const { p } of moving) cap += endpointsOf(p).length * p.claim.length * 4;
    const mat = new MeshBasicMaterial({});
    registerDim(mat, 'ground');
    this.berths = new Bank(shadedBoxGeometry(), mat, cap);
    for (const { p, i } of moving) {
      for (const stop of endpointsOf(p)) {
        const nubs: BerthSlot['nubs'] = [];
        for (const sq of p.claim) {
          const o = sqOffset(sq);
          for (const [cx, cz] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            const inset = GRID.tile / 2 - 0.02;
            const x = stop.x + o.x + cx * inset;
            const y = stop.y + 0.05;
            const z = stop.z + o.z + cz * inset;
            nubs.push({ idx: this.berths.add(x, y, z, 0.04, 0.1, 0.04, COLOR.rimSafe), x, y, z });
          }
        }
        this.berthSlots.push({ platform: i, stop, nubs });
      }
    }
    root.add(this.berths.mesh);
    this.buildGate(root);
  }

  /**
   * THE GATE. The way out was invisible: the lap closed and the black came
   * down. Now the door home is a thing you can see from the far side of
   * the void — a frame the size of THE STEP's own, standing at the south
   * edge of the home pad, dark on the way out and lit by how much of the
   * way back is done: a whisper from the ferry, a glow down the elevator,
   * full on the runner home, and a flare when you step through onto the
   * pad and the bell rings.
   */
  private buildGate(root: Group): void {
    const g = new Group();
    g.name = 'the-gate';
    const W = 1.3;
    const H = 2.1;
    const T = 0.08;
    // The frame stands just past the pad's south fence.
    g.position.set(0, 0, GRID.pitch + GRID.tile / 2 + 0.22);
    const steel = new MeshBasicMaterial({ color: 0x1a1826 });
    registerDim(steel, 'scenery');
    for (const sx of [-1, 1]) {
      const post = new Mesh(new BoxGeometry(T, H, T), steel);
      post.position.set(sx * (W / 2 + T / 2), H / 2, 0);
      g.add(post);
    }
    const lintel = new Mesh(new BoxGeometry(W + T * 2, T, T), steel);
    lintel.position.set(0, H + T / 2, 0);
    g.add(lintel);
    // The lit inner edge: a slim strip inside each post and the lintel.
    // NOT registered with the dimmer: applyDim() restores a registered
    // material's colour every frame, and this one's colour IS the level.
    this.gateEdge = new MeshBasicMaterial({ color: COLOR.rimSafe });
    for (const sx of [-1, 1]) {
      const strip = new Mesh(new BoxGeometry(0.02, H, 0.03), this.gateEdge);
      strip.position.set(sx * (W / 2 - 0.01), H / 2, 0);
      g.add(strip);
    }
    const top = new Mesh(new BoxGeometry(W, 0.02, 0.03), this.gateEdge);
    top.position.set(0, H - 0.01, 0);
    g.add(top);
    // The pane: the void's light, filling the frame as home comes closer.
    this.gatePane = new MeshBasicMaterial({
      map: glowTexture(),
      color: COLOR.rimSafe,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    registerDim(this.gatePane, 'ground');
    const pane = new Mesh(new PlaneGeometry(W * 1.15, H * 1.08), this.gatePane);
    pane.position.set(0, H / 2, 0.01);
    g.add(pane);
    root.add(g);
  }

  update(): void {
    if (!course.active) return;

    // THE LEDGER: arriving home off the west runner closes the circuit —
    // the last step east repays the first, and the body ends the lap
    // exactly where it began, which is why the door can be waiting there.
    if (G.tracked !== this.lastTracked) {
      if (G.tracked === HOME_INDEX && this.lastTracked === INDEX['runner-home']) {
        course.laps++;
        conductor.bell(course.laps, platformSoundAt(HOME_INDEX));
        this.closedAt = G.transport.bars;
      }
      this.lastTracked = G.tracked;
    }
    if (G.handovers === 0) this.closedAt = -1; // a fresh ride: the door is dark again

    const trackedId = PLATFORMS[G.tracked].id;
    let at = -1;
    for (let i = 0; i < ROUTE.length - 1; i++) {
      if (ROUTE[i] === trackedId) {
        at = i;
        break;
      }
    }

    // THE GATE: lit by how far home you are. Standing on the pad with the
    // lap closed is all the way home (the route's last entry, not its
    // first), and the door flares for a bar as the bell rings.
    const closed = this.closedAt >= 0;
    const lit = closed ? 1 : homeward(at);
    G.wayfind.homeward = lit;
    {
      const flare = closed ? Math.max(0, 1 - (G.transport.bars - this.closedAt) / 1.5) : 0;
      const breathe = 0.85 + 0.15 * Math.sin(G.transport.bars * Math.PI * 2);
      const level = Math.min(1, lit * breathe + flare * 0.8);
      this.gatePane.opacity = 0.03 + level * 0.62;
      this.gateEdge.color.setHex(COLOR.rimSafe).multiplyScalar(0.18 + level * 1.3);
    }
    const target = at >= 0 ? INDEX[ROUTE[at + 1]] : -1;
    G.wayfind.targetIndex = target;
    G.wayfind.targetAligned = target >= 0 && G.platforms[target].aligned;

    let invTile: { x: number; y: number; z: number } | undefined;
    if (G.handovers === 0) {
      invTile = { x: G.rig.x, y: G.rig.y, z: G.rig.z };
    } else if (target >= 0) {
      const st = G.platforms[target];
      if (st.aligned && !st.moving) {
        const spec = PLATFORMS[target];
        let best: { x: number; y: number; z: number } | undefined;
        let bestD = Infinity;
        for (const sq of spec.claim) {
          const o = sqOffset(sq);
          const px = st.anchor.x + o.x;
          const pz = st.anchor.z + o.z;
          const d = Math.hypot(px - (G.rig.x + G.body.x), pz - (G.rig.z + G.body.z));
          if (d < bestD) {
            bestD = d;
            best = { x: px, y: st.anchor.y, z: pz };
          }
        }
        invTile = best;
      }
    }
    // The same tile, in the coordinates a body actually stands in.
    this.next =
      invTile && G.handovers > 0
        ? { x: invTile.x - G.rig.x, z: invTile.z - G.rig.z }
        : null;

    if (invTile) {
      const urgent = target >= 0 && G.platforms[target].departIn <= 1;
      const breath =
        0.86 +
        0.14 * Math.sin((G.transport.bars / WAYFIND.breathBars) * Math.PI * 2 * (urgent ? 4 : 1));
      this.invitation.visible = true;
      this.invitation.position.set(invTile.x, invTile.y + 0.025, invTile.z);
      this.invitation.scale.setScalar(breath);
      this.invitationMat.color.setHex(urgent ? COLOR.rimWarn : COLOR.rimSafe);

      // THE ARROW: from where the body stands toward the invitation, laid
      // a step ahead on the body's own ground. Not on the home pad at the
      // start (the invitation IS under your feet then) and not once the
      // tile is close enough to be the ground you are looking at.
      const bx = G.rig.x + G.body.x;
      const bz = G.rig.z + G.body.z;
      const dx = invTile.x - bx;
      const dz = invTile.z - bz;
      const dist = Math.hypot(dx, dz);
      if (G.handovers > 0 && dist > GRID.tile * 0.9) {
        const step = Math.min(GRID.tile * 0.75, dist * 0.5);
        this.arrow.visible = true;
        this.arrow.position.set(bx + (dx / dist) * step, G.rig.y + 0.03, bz + (dz / dist) * step);
        this.arrow.rotation.y = Math.atan2(-dx, -dz);
        this.arrow.scale.setScalar(breath);
        this.arrowMat.color.setHex(urgent ? COLOR.rimWarn : COLOR.rimSafe);
      } else {
        this.arrow.visible = false;
      }
    } else {
      this.invitation.visible = false;
      this.arrow.visible = false;
    }

    // The berth: brackets only where the route's next machine will dock,
    // and only while it is away from that dock. Most of the time that is
    // NOWHERE — and an instanced bank with every instance parked off-world
    // still costs its draw call, so the whole bank goes dark instead.
    let anyBerth = false;
    for (const slot of this.berthSlots) {
      const st = G.platforms[slot.platform];
      const relevant =
        slot.platform === target &&
        !st.aligned &&
        Math.hypot(slot.stop.x - G.rig.x, slot.stop.z - G.rig.z) + Math.abs(slot.stop.y - G.rig.y) <
          1.2;
      anyBerth ||= relevant;
      const pulse = WAYFIND.berthPulse * (0.7 + 0.3 * Math.sin(G.transport.bars * Math.PI * 2));
      for (const n of slot.nubs) {
        if (relevant) {
          this.berths.set(n.idx, n.x, n.y, n.z, 0.04, 0.1, 0.04);
          this.berths.color(n.idx, COLOR.rimSafe, pulse);
        } else {
          // Parked, not merely hidden: a berth's nubs stand at fixed world
          // stops, so leaving them placed would light every dock the route
          // has ever used the next time the bank comes back on.
          this.berths.set(n.idx, n.x, -999, n.z, 0.0001, 0.0001, 0.0001);
        }
      }
    }
    this.berths.mesh.visible = anyBerth;
  }
}
