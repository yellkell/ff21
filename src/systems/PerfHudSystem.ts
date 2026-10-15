/**
 * A head-locked frame-time readout, for when "it feels laggy" needs a number.
 *
 * Off unless the page is opened with ?perf=1 — nothing is built, no cost.
 *
 * What it tells you, and how to read it:
 *
 *  - FPS / ms      the frame INTERVAL. Quest 3 runs 72 Hz by default, so 13.9
 *                  ms is the budget. Anything consistently above it means the
 *                  headset is reprojecting the last frame to cover the miss —
 *                  which is what puts your real room in the edges of your
 *                  vision when you turn your head. That symptom IS this number.
 *  - worst         slowest frame in the last two seconds. A good average with
 *                  a terrible worst is a hitch (a shader compiling, a texture
 *                  uploading), not a fill-rate problem.
 *  - draws / tris  what the scene is asking for. If these barely move between
 *                  a smooth view and a stuttering one, the cost is PER PIXEL
 *                  (fill rate), not per object.
 *  - progs         compiled shader programs. If this climbs mid-fight,
 *                  something is triggering recompiles — every jump is a hitch.
 *
 * The quickest experiment it enables: look straight at GOOPLIATH, read the
 * number, then look away so he leaves your view and read it again. His mesh
 * skips frustum culling, so looking away costs him nothing but his pixels —
 * the difference between the two readings is exactly what the gel is worth.
 */

import { createSystem } from '@iwsdk/core';
import {
  CanvasTexture,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  Vector3,
} from 'three';
import { app } from '../menu/appState.js';
import { throwProbe } from '../debug/throwProbe.js';

/** ?perf=1 (or a bare ?perf) turns the readout on. */
export function perfHudRequested(): boolean {
  const p = new URLSearchParams(location.search);
  return p.has('perf') && p.get('perf') !== '0';
}

export const PANEL_W = 512;
export const PANEL_H = 272;

export interface PerfStats {
  /** Mean frame INTERVAL over the last repaint window, milliseconds. */
  avgMs: number;
  /** Slowest frame in the last two seconds, milliseconds. */
  worstMs: number;
  draws: number;
  triangles: number;
  programs: number;
  environment: string;
  /** Last curveball's measured swing, or null if none thrown recently. */
  curve: { raw: number; handSpeed: number; curl: number } | null;
}

/** Paint one readout. Exported so the visual test scene draws the real panel
 *  rather than a lookalike. */
export function drawPerfPanel(ctx: CanvasRenderingContext2D, s: PerfStats): void {
  const fps = 1000 / Math.max(s.avgMs, 0.001);
  // 72 Hz is the Quest default; past its budget the headset is reprojecting.
  const budget = 1000 / 72;
  const over = s.avgMs > budget * 1.05;

  ctx.clearRect(0, 0, PANEL_W, PANEL_H);
  ctx.fillStyle = 'rgba(8, 10, 14, 0.82)';
  ctx.fillRect(0, 0, PANEL_W, PANEL_H);
  ctx.strokeStyle = over ? '#ff4a26' : '#3ad17a';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, PANEL_W - 6, PANEL_H - 6);

  ctx.textBaseline = 'top';
  ctx.fillStyle = over ? '#ff8a5c' : '#8affb4';
  ctx.textAlign = 'left';
  ctx.font = 'bold 62px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(`${fps.toFixed(0)} fps`, 22, 18);
  ctx.textAlign = 'right';
  ctx.font = 'bold 34px ui-monospace, Menlo, Consolas, monospace';
  ctx.fillText(`${s.avgMs.toFixed(1)} ms`, PANEL_W - 22, 44);

  const count = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#c8d2e0';
  ctx.font = '30px ui-monospace, Menlo, Consolas, monospace';
  const rows = [
    `worst ${s.worstMs.toFixed(1)} ms  budget ${budget.toFixed(1)}`,
    `draws ${s.draws}  tris ${count(s.triangles)}`,
    `progs ${s.programs}  env ${s.environment}`,
  ];
  rows.forEach((line, i) => ctx.fillText(line, 22, 104 + i * 40));

  // Last curve throw: what the swing actually measured. CURL is tuned against
  // exactly these two inputs, so this is the line that says whether the band
  // is set where real punches land.
  if (s.curve) {
    ctx.fillStyle = s.curve.curl > 0 ? '#ffd479' : '#7d879a';
    ctx.font = '28px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillText(
      `raw ${s.curve.raw.toFixed(1)}  hand ${s.curve.handSpeed.toFixed(1)}  bend ${s.curve.curl.toFixed(2)}`,
      22,
      224,
    );
  }
}

const _camPos = new Vector3();
const _camQ = new Quaternion();
const _offset = new Vector3();

export class PerfHudSystem extends createSystem({}) {
  private ctx?: CanvasRenderingContext2D;
  private mesh?: Mesh;
  private texture?: CanvasTexture;

  /** Frame intervals (ms) since the last repaint, plus a 2 s worst-case. */
  private samples: number[] = [];
  private worst = 0;
  private worstAge = 0;
  private repaintIn = 0;
  /** Seconds since boot, matched to FireballSystem's clock for probe staleness. */
  private clock = 0;

  init(): void {
    if (!perfHudRequested()) return;

    const canvas = document.createElement('canvas');
    canvas.width = PANEL_W;
    canvas.height = PANEL_H;
    this.ctx = canvas.getContext('2d') ?? undefined;

    this.texture = new CanvasTexture(canvas);
    this.texture.minFilter = LinearFilter;
    this.mesh = new Mesh(
      new PlaneGeometry(0.30, 0.30 * (PANEL_H / PANEL_W)),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false }),
    );
    // Draw last and ignore depth: a readout you can't see behind the boss is
    // no use during the exact fight you're measuring.
    this.mesh.renderOrder = 10_000;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }

  update(delta: number): void {
    const mesh = this.mesh;
    if (!mesh) return;

    this.clock += delta;
    const ms = delta * 1000;
    this.samples.push(ms);
    this.worstAge += delta;
    if (ms > this.worst || this.worstAge > 2) {
      this.worst = ms;
      this.worstAge = 0;
    }

    // Park it down and to the left of straight ahead — readable with a glance,
    // never over the boss or the incoming fireballs.
    this.world.camera.getWorldPosition(_camPos);
    this.world.camera.getWorldQuaternion(_camQ);
    _offset.set(-0.17, -0.16, -0.55).applyQuaternion(_camQ);
    mesh.position.copy(_camPos).add(_offset);
    mesh.quaternion.copy(_camQ);

    this.repaintIn -= delta;
    if (this.repaintIn > 0) return;
    this.repaintIn = 0.25; // 4 Hz — a number you can actually read
    this.paint();
    this.samples.length = 0;
  }

  private paint(): void {
    const ctx = this.ctx;
    if (!ctx || !this.samples.length) return;

    let total = 0;
    for (const s of this.samples) total += s;

    // renderer.info is reset per render() and systems update BEFORE the draw,
    // so these are last frame's counters — one frame stale, which is fine.
    const info = this.world.renderer.info;
    drawPerfPanel(ctx, {
      avgMs: total / this.samples.length,
      worstMs: this.worst,
      draws: info.render.calls,
      triangles: info.render.triangles,
      programs: info.programs?.length ?? 0,
      environment: app.environment,
      // Keep the last throw up for a few seconds so it survives the follow-through.
      curve:
        throwProbe.at >= 0 && this.clock - throwProbe.at < 4
          ? { raw: throwProbe.raw, handSpeed: throwProbe.handSpeed, curl: throwProbe.curl }
          : null,
    });

    if (this.texture) this.texture.needsUpdate = true;
  }
}
