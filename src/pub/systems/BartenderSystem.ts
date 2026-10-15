/**
 * UNIT-86 "THE LANDLORD" — the robot barkeep.
 *
 * Same iron-boxer chassis as everyone else (house amber trim), bolted to a
 * wheeled base that runs the aisle behind the bar. You can't interact with
 * him and he never stops working: he wipes the counter, pulls pints at the
 * taps (filling the glass under a proper pour stream), polishes glasses,
 * takes the odd breather leaning on the counter, and when the server
 * announces a restock (`glassOut`) he trundles a fresh pint over, holds it
 * out and sets it down right as the real prop lands (PUB.glassDeliverDelay
 * on the same broadcast clock) — up to the house limit of PUB.glassMax.
 * Back-to-back restocks queue, so every pint that lands gets walked over.
 *
 * He is pure theatre: entirely client-side, no networking, no collision.
 * The only synchronised part is the glass landing, and PropSystem times
 * that off the same broadcast every client received.
 */

import { createSystem } from '@iwsdk/core';
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { buildBoxer, type BoxerRig } from '../../avatar/boxer.js';
import { applyAvatarSkin, type AvatarSkin } from '../../avatar/skins.js';
import { PALETTE } from '../../config.js';
import { PUB } from '../config.js';
import { buildPintGlass, setGlassFill } from '../props.js';
import { bus, pub } from '../state.js';
import { retintRig } from './PubPlayerSystem.js';

type TaskKind = 'wipe' | 'pour' | 'polish' | 'deliver' | 'idle';

interface Task {
  kind: TaskKind;
  /** Where he stands (x along the aisle). */
  x: number;
  /** Seconds the task runs once he's in position. */
  duration: number;
  /** Deliver only: which glass slot he's heading for. */
  slot?: [number, number, number];
  /** Deliver only: animTime at which PropSystem lands the real prop — he
   *  holds the hand-off until then so the mime and the pint agree. */
  landAt?: number;
}

const WALK_SPEED = 1.1;
const DELIVER_SPEED = 2.6;
const AISLE_MIN = -2.35;
const AISLE_MAX = 2.35;
// His look: FF2 retired the animal roster, so UNIT-86 wears THE BLANK like
// everyone else (the palette below only matters to role-tagged geometry,
// which the blank deliberately has none of — he serves in factory white).
const BARTENDER_BEAR_SKIN: AvatarSkin = {
  id: 'blank',
  name: 'BLANK',
  chassis: 0x2a2113,
  trim: 0x120d08,
  accent: PALETTE.amber,
};

const _target = new Vector3();
const _punter = new Vector3();
/** Glove pose targets — the hands EASE toward these instead of teleporting. */
const REST: [Vector3, Vector3] = [new Vector3(-0.28, 1.02, -0.18), new Vector3(0.28, 1.02, -0.18)];

export class BartenderSystem extends createSystem({}) {
  private root!: Group;
  private rig!: BoxerRig;
  private carryGlass!: Group;
  private pourStream!: Mesh;

  private task: Task | null = null;
  private taskTimer = 0;
  private arrived = false;
  private animTime = 0;
  private bob = 0;
  private gloveTarget: [Vector3, Vector3] = [REST[0].clone(), REST[1].clone()];
  /** Restocks announced while he's already mid-delivery — walked in order. */
  private deliveries: Task[] = [];
  /** Rota memory, so he doesn't repeat a chore or re-wipe the same spot. */
  private lastKind: TaskKind | null = null;
  private lastX = 0;

  init(): void {
    this.buildBody();
    this.cleanupFuncs.push(
      bus.on('glassOut', (id) => {
        const slot = pub.refs!.glassSlots[id];
        if (!slot) return;
        const order: Task = {
          kind: 'deliver',
          x: slot[0],
          duration: 1.2, // recomputed on arrival against landAt
          slot,
          landAt: this.animTime + PUB.glassDeliverDelay,
        };
        // Drop whatever chore he was on — a customer needs a glass. But a
        // delivery already underway finishes first: back-to-back restocks
        // queue (both pints land, so both deserve the walk-over).
        if (this.task?.kind === 'deliver') this.deliveries.push(order);
        else this.setTask(order);
      }),
    );
  }

  private buildBody(): void {
    this.root = new Group();
    this.root.name = 'unit-86-the-landlord';
    const aisleZ = PUB.bar.aisleZ;
    this.root.position.set(0, 0, aisleZ);
    this.root.rotation.y = Math.PI; // face the room (+z) — front is local −z

    // The boxer chassis in house amber, posed standing (no IK here: the
    // torso pieces are parked at fixed heights on the wheeled base).
    this.rig = buildBoxer(1, BARTENDER_BEAR_SKIN.id); // house BEAR only — no other skins
    retintRig(this.rig.all, PALETTE.amber);
    // Reveal the BEAR skin across the WHOLE rig — head AND torso. The body
    // is per-skin tagged and starts hidden, so skinning the head alone
    // leaves him a floating head over the base with no body.
    for (const part of this.rig.all) applyAvatarSkin(part, BARTENDER_BEAR_SKIN);
    this.rig.head.position.set(0, 1.52, 0);
    // The body plants at the HIPS (its rings are hip-local) — set low enough
    // that its neck stops clear of the floating head, same as a player's.
    this.rig.body.position.set(0, 0.88, 0);
    this.root.add(this.rig.head, this.rig.torso);
    for (const glove of this.rig.gloves) this.root.add(glove);
    this.restGloves();

    // No legs — a wheeled service base, very robot wars.
    const column = new Mesh(
      new CylinderGeometry(0.09, 0.16, 0.72, 8),
      new MeshStandardMaterial({ color: PALETTE.gunmetal, metalness: 0.85, roughness: 0.4 }),
    );
    column.position.y = 0.46;
    this.root.add(column);
    const skirtMat = new MeshStandardMaterial({
      color: PALETTE.gunmetalDark,
      metalness: 0.8,
      roughness: 0.5,
    });
    const base = new Mesh(new CylinderGeometry(0.22, 0.26, 0.1, 10), skirtMat);
    base.position.y = 0.08;
    this.root.add(base);
    for (const side of [-1, 1]) {
      const wheel = new Mesh(new SphereGeometry(0.045, 8, 6), skirtMat);
      wheel.position.set(side * 0.12, 0.045, 0);
      this.root.add(wheel);
    }
    // Hazard stripe across the base — he's plant machinery, technically.
    const stripe = new Mesh(
      new CylinderGeometry(0.225, 0.225, 0.025, 10),
      new MeshStandardMaterial({
        color: PALETTE.amber,
        emissive: PALETTE.amber,
        emissiveIntensity: 0.5,
      }),
    );
    stripe.position.y = 0.135;
    this.root.add(stripe);

    // The pint he carries while pouring/delivering.
    this.carryGlass = buildPintGlass();
    this.carryGlass.visible = false;
    this.carryGlass.position.set(0, -0.06, -0.1);
    this.rig.gloves[0].add(this.carryGlass);

    // Pour stream: a thin amber column under the active tap.
    this.pourStream = new Mesh(
      new CylinderGeometry(0.006, 0.009, 0.22, 6),
      new MeshStandardMaterial({
        color: 0xc97a1e,
        emissive: 0x8a4a10,
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.8,
      }),
    );
    this.pourStream.visible = false;
    pub.refs!.root.add(this.pourStream);

    pub.refs!.root.add(this.root);
  }

  update(delta: number): void {
    this.animTime += delta;
    if (!this.task) this.pickNextTask();
    const task = this.task!;

    // --- roll along the aisle toward the task spot ------------------------------
    const speed = task.kind === 'deliver' ? DELIVER_SPEED : WALK_SPEED;
    const dx = task.x - this.root.position.x;
    let rolling = false;
    if (!this.arrived) {
      if (Math.abs(dx) > 0.04) {
        rolling = true;
        // Ease off as he closes in — no hard stop at the mark.
        const step = Math.sign(dx) * Math.min(Math.abs(dx), Math.max(0.25, Math.min(speed, Math.abs(dx) * 3)) * delta);
        this.root.position.x += step;
        this.bob += delta * 6;
        this.root.position.y = Math.abs(Math.sin(this.bob)) * 0.011;
      } else {
        this.arrived = true;
        // A delivery holds the reach until the shared broadcast clock lands
        // the real pint (PropSystem), so the hand-off and the prop agree —
        // he used to mime it and wander off ~3 s before the glass appeared.
        if (task.kind === 'deliver' && task.landAt !== undefined) {
          this.taskTimer = Math.max(0.45, task.landAt - this.animTime);
          task.duration = this.taskTimer;
        }
      }
    }

    // Face down the aisle while rolling (wheels first, not a sideways glide),
    // then swing back square to the room once he's parked at the job.
    const yawTarget = rolling ? Math.PI + Math.sign(dx) * (Math.PI / 2) : Math.PI;
    this.root.rotation.y += (yawTarget - this.root.rotation.y) * Math.min(1, delta * 6);

    // --- act -------------------------------------------------------------------
    if (this.arrived) {
      this.taskTimer -= delta;
      this.animateTask(task, delta);
      if (this.taskTimer <= 0) this.finishTask(task);
    }

    if (this.arrived) {
      this.root.position.y -= this.root.position.y * Math.min(1, delta * 8);
    }

    // Hands flow between work poses instead of snapping.
    const k = Math.min(1, delta * 7);
    this.rig.gloves[0].position.lerp(this.gloveTarget[0], k);
    this.rig.gloves[1].position.lerp(this.gloveTarget[1], k);

    // Head: glance at the nearest punter, otherwise mind the bar.
    this.aimHead(delta);
  }

  // --- the work rota -----------------------------------------------------------

  private pickNextTask(): void {
    const rollKind = (): TaskKind => {
      const roll = Math.random();
      if (roll < 0.35) return 'wipe';
      if (roll < 0.62) return 'pour';
      if (roll < 0.85) return 'polish';
      return 'idle';
    };
    // Rota memory: the same chore twice running reads robotic — one reroll
    // breaks most streaks (a rare double is fine, a habit isn't).
    let kind = rollKind();
    if (kind === this.lastKind) kind = rollKind();
    // …and wiping/polishing returns to a FRESH stretch of counter.
    const awayFromLast = (): number => {
      let x = AISLE_MIN + Math.random() * (AISLE_MAX - AISLE_MIN);
      for (let tries = 0; tries < 4 && Math.abs(x - this.lastX) < 0.7; tries++) {
        x = AISLE_MIN + Math.random() * (AISLE_MAX - AISLE_MIN);
      }
      return x;
    };
    switch (kind) {
      case 'wipe':
        this.setTask({ kind, x: awayFromLast(), duration: 3.5 + Math.random() * 2 });
        break;
      case 'pour': {
        // A different tap from last time when the dice allow.
        let tap = PUB.tapXs[Math.floor(Math.random() * PUB.tapXs.length)];
        if (Math.abs(tap - this.lastX) < 0.1) tap = PUB.tapXs[Math.floor(Math.random() * PUB.tapXs.length)];
        this.setTask({ kind, x: tap, duration: 4.5 });
        break;
      }
      case 'polish':
        this.setTask({ kind, x: awayFromLast(), duration: 4 });
        break;
      default:
        // A breather right where he stands: elbows on the counter, minding
        // the room. Even a tireless robot landlord earns a lean.
        this.setTask({ kind: 'idle', x: this.root.position.x, duration: 2.5 + Math.random() * 2 });
        break;
    }
  }

  private setTask(task: Task): void {
    this.task = task;
    this.taskTimer = task.duration;
    this.arrived = false;
    this.pourStream.visible = false;
    this.lastKind = task.kind;
    this.lastX = task.x;
    this.restGloves(); // clear any wrist tilt the previous chore left behind
    // He carries a glass to the tap and on deliveries.
    this.carryGlass.visible = task.kind === 'pour' || task.kind === 'deliver' || task.kind === 'polish';
    // A pour STARTS empty and fills under the stream; anything else he
    // carries is already a full pint.
    setGlassFill(this.carryGlass, task.kind === 'pour' ? 0 : 1);
  }

  private finishTask(task: Task): void {
    if (task.kind === 'deliver') {
      // The real prop lands via PropSystem on the same broadcast clock —
      // his empty hand sells the hand-off.
      this.carryGlass.visible = false;
    }
    this.pourStream.visible = false;
    this.task = null;
    this.restGloves();
    // Queued restocks jump the rota — the next pint goes straight out.
    const next = this.deliveries.shift();
    if (next) this.setTask(next);
  }

  private restGloves(): void {
    // Knuckles toward the counter (local −z), hands at service height.
    this.gloveTarget[0].copy(REST[0]);
    this.gloveTarget[1].copy(REST[1]);
    this.rig.gloves[0].rotation.set(0, 0, 0);
    this.rig.gloves[1].rotation.set(0, 0, 0);
  }

  private animateTask(task: Task, delta: number): void {
    const t = this.animTime;
    switch (task.kind) {
      case 'wipe': {
        // Right glove sweeps circles over the counter top, wrist riding the
        // sweep — pressing INTO the counter, not floating over it.
        this.gloveTarget[1].set(
          0.2 + Math.cos(t * 3.2) * 0.16,
          1.06,
          -0.38 + Math.sin(t * 3.2) * 0.1,
        );
        this.rig.gloves[1].rotation.set(0.35, 0, Math.sin(t * 3.2) * 0.18);
        break;
      }
      case 'pour': {
        // Left glove holds the glass under the tap; right rests the handle,
        // tipped forward like it's holding the pull.
        this.gloveTarget[0].set(-0.08, 1.06, -0.42);
        this.gloveTarget[1].set(0.16, 1.32, -0.34);
        this.rig.gloves[1].rotation.x = -0.3;
        // Stream runs while the glass is under the spout (world space; the
        // glove's local offset mirrors through the root's 180° yaw).
        this.pourStream.visible = this.taskTimer > 0.8;
        this.pourStream.position.set(task.x + 0.08, 1.21, PUB.bar.aisleZ + 0.42);
        // The pint FILLS under the stream (it used to pour into an already
        // full glass), the head settling in the last beat after it shuts off.
        const fill = Math.max(0, Math.min(1, 1 - (this.taskTimer - 0.8) / Math.max(0.1, task.duration - 0.8)));
        setGlassFill(this.carryGlass, fill);
        break;
      }
      case 'polish': {
        // Glass in the left, right buffs it in little circles, wrist
        // twisting with the rag.
        this.gloveTarget[0].set(-0.12, 1.18, -0.28);
        this.gloveTarget[1].set(
          0.02 + Math.cos(t * 5) * 0.05,
          1.2 + Math.sin(t * 5) * 0.04,
          -0.3,
        );
        this.rig.gloves[1].rotation.set(0, 0, Math.sin(t * 5) * 0.3);
        break;
      }
      case 'deliver': {
        // Reach out quickly (~0.6 s), HOLD the pint over its slot while the
        // shared clock runs down, then dip to set it down as the prop lands.
        const elapsed = task.duration - this.taskTimer;
        const reach = Math.min(1, elapsed / 0.6);
        const setdown = this.taskTimer < 0.4 ? 1 - this.taskTimer / 0.4 : 0;
        this.gloveTarget[0].set(-0.1, 1.18 - setdown * 0.14, -0.3 - reach * 0.25);
        this.rig.gloves[0].rotation.x = reach * 0.25;
        break;
      }
      case 'idle': {
        // The lean: both hands settle low on the counter with a slow sway.
        // aimHead keeps him minding the room while he takes the breather.
        this.gloveTarget[0].set(-0.24, 1.05 + Math.sin(t * 1.1) * 0.008, -0.3);
        this.gloveTarget[1].set(0.3, 1.0 + Math.sin(t * 1.1 + 1.7) * 0.008, -0.16);
        break;
      }
    }
    void delta;
  }

  private aimHead(delta: number): void {
    let best: Vector3 | null = null;
    let bestD = 16; // only bother within 4 m
    this.camera.getWorldPosition(_punter);
    const dSelf = _punter.distanceToSquared(this.root.position);
    if (dSelf < bestD) {
      best = _target.copy(_punter);
      bestD = dSelf;
    }
    for (const p of pub.punters.values()) {
      _punter.set(p.head[0], p.head[1], p.head[2]);
      const d = _punter.distanceToSquared(this.root.position);
      if (d < bestD) {
        best = _target.copy(_punter);
        bestD = d;
      }
    }
    const head = this.rig.head;
    if (best) {
      // Yaw-only glance, eased, clamped so he never owl-necks.
      const local = this.root.worldToLocal(best.clone());
      let yaw = Math.atan2(-(local.x - head.position.x), -(local.z - head.position.z));
      yaw = Math.max(-1.1, Math.min(1.1, yaw));
      head.rotation.y += (yaw - head.rotation.y) * Math.min(1, delta * 5);
    } else {
      head.rotation.y -= head.rotation.y * Math.min(1, delta * 2);
    }
  }
}
