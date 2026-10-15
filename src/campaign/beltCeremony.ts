/**
 * THE BELT CEREMONY — the end of a winning RUN (gauntlet or hardcore, Normal
 * and up): as the last titan goes down, the run's championship belt
 * (campaign/belts.ts) rises in front of you, is held up turning in the light,
 * and stays there over the wreck until the line-up comes back. FIRE FIGHT
 * FLUX held its belts up over the console the same way (fff ConsoleSystem
 * stepAward); here it's the victory itself.
 *
 * Placed once, from where your head is when it starts — it doesn't follow
 * you around. CampaignSystem drives it (start / update / stop).
 */

import { type Camera, type Scene, Vector3 } from 'three';
import type { Belt } from './belts.js';
import { BeltModel } from '../ui/beltModel.js';

const _head = new Vector3();
const _fwd = new Vector3();
const ease = (t: number): number => t * t * (3 - 2 * t);

/** How far in front of you it's held, and how far below your eyes. */
const REACH = 0.95;
const DROP = 0.14;
/** Seconds: the rise, after the delay. */
const RISE = 1.1;

export class BeltCeremony {
  private model: BeltModel | null = null;
  private t = 0;
  private delay = 0;
  private placed = false;
  private yaw = 0;
  private readonly at = new Vector3();

  constructor(private readonly scene: Scene) {}

  /** Hold `belt` up after `delay` seconds (the killing blow's moment first). */
  start(belt: Belt, delay: number): void {
    this.stop();
    this.model = new BeltModel(belt);
    this.model.root.visible = false;
    this.scene.add(this.model.root);
    this.t = 0;
    this.delay = delay;
    this.placed = false;
  }

  get active(): boolean {
    return this.model !== null;
  }

  /** True once, the frame it first shows (for a sound or a card). */
  update(delta: number, camera: Camera): boolean {
    const m = this.model;
    if (!m) return false;
    this.t += delta;
    const t = this.t - this.delay;
    if (t < 0) return false;
    let revealed = false;
    if (!this.placed) {
      // In front of you, level, facing you.
      camera.getWorldPosition(_head);
      camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
      _fwd.normalize();
      this.at.copy(_head).addScaledVector(_fwd, REACH);
      this.at.y = _head.y - DROP;
      this.yaw = Math.atan2(-_fwd.x, -_fwd.z);
      this.placed = true;
      m.root.visible = true;
      revealed = true;
    }
    const k = ease(Math.min(1, t / RISE));
    m.root.position.copy(this.at);
    m.root.position.y += (k - 1) * 0.45 + 0.012 * Math.sin(t * 1.7) * k;
    m.root.scale.setScalar(0.25 + 0.75 * k);
    // A slow turn in the light, settling to face you.
    m.root.rotation.set(-0.12 * k, this.yaw + (1 - k) * 1.6 + 0.3 * Math.sin(t * 0.9) * k, 0);
    m.flare(0.35 + 0.65 * (1 - k) + 0.25 * Math.sin(t * 3) ** 2);
    return revealed;
  }

  stop(): void {
    this.model?.dispose();
    this.model = null;
  }
}
