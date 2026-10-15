/**
 * The big in-world round countdown: "3… 2… 1… FIGHT" hanging huge in the air
 * over the middle of the arena — between the platforms, not just on the HUD.
 *
 * It mirrors `match.message` (every mode's match brain — local, 1v1 net,
 * mesh — funnels its countdown through that string), so this system never
 * needs to know whose clock is authoritative. Each new figure POPS in
 * slightly oversized and settles as it fades up; anything that isn't a
 * countdown beat ("KO", "YOU WIN", scores…) hides the board, which keeps the
 * dramatic endgame text on the HUD where it can be read while moving.
 */

import { createSystem } from '@iwsdk/core';
import { AdditiveBlending, CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { localLayout } from '../combat/layout.js';
import { match } from '../combat/matchState.js';
import { app } from '../menu/appState.js';
import { countdownArt } from '../ui/countdownArt.js';
import { drawContentPlate } from '../ui/plateArt.js';

/** The messages that belong to the countdown ritual — drawn with the same
 *  neon-metal plate PNGs the HUD scoreboard uses (countdownArt), with these
 *  colours as the stencil fallback for the frames before a plate decodes. */
const BEAT_STYLE: Record<string, { fill: string; glow: string }> = {
  '3': { fill: '#f4f6fb', glow: 'rgba(170,225,255,0.95)' },
  '2': { fill: '#f4f6fb', glow: 'rgba(170,225,255,0.95)' },
  '1': { fill: '#ffb62e', glow: 'rgba(255,150,30,0.95)' },
  FIGHT: { fill: '#ff3b1e', glow: 'rgba(255,60,20,0.95)' },
};

/** The aura tint behind each beat — the HUD plates' reads: 3 and 2 arc-light
 *  blue, 1 hot amber, FIGHT danger red. */
const BEAT_ACCENT: Record<string, number> = {
  '3': 0x9fd4ff,
  '2': 0x9fd4ff,
  '1': 0xffb62e,
  FIGHT: 0xff3b1e,
};

function easeOutCubic(x: number): number {
  return 1 - Math.pow(1 - x, 3);
}

export class CountdownSystem extends createSystem({}) {
  private board!: Mesh;
  private glow!: Mesh;
  private canvas!: HTMLCanvasElement;
  private texture!: CanvasTexture;
  private shown = ''; // the message currently drawn on the canvas
  private beatStart = 0; // performance.now() when the current figure landed

  init(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 1024;
    this.canvas.height = 512;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.minFilter = LinearFilter;
    // ~1.8 m wide in the air — reads across the arena without filling the
    // gap between the fighters (the old 2.6 m plate loomed).
    this.board = new Mesh(
      new PlaneGeometry(1.82, 0.91),
      new MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }),
    );
    // Above the fireball pass (core renderOrder 1 / corona 2): the plate
    // writes no depth, so a ball BEHIND it that drew later used to paint
    // straight over the 3-2-1-FIGHT. Depth testing still lets a ball in
    // FRONT of the plate occlude it correctly.
    this.board.renderOrder = 5;
    this.board.visible = false;
    this.scene.add(this.board);

    // The accent aura behind the plate — the HUD verdict's soft radial glow,
    // rebuilt at arena size. A child of the board, so the slam-in spring
    // carries it; its own scale adds the impact swell on top.
    const glowCanvas = document.createElement('canvas');
    glowCanvas.width = glowCanvas.height = 128;
    const g = glowCanvas.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.32)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const glowTex = new CanvasTexture(glowCanvas);
    glowTex.minFilter = LinearFilter;
    this.glow = new Mesh(
      new PlaneGeometry(2.52, 1.47),
      new MeshBasicMaterial({
        map: glowTex,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this.glow.position.z = -0.03;
    // Just under the board (renderOrder is scene-global, not hierarchical):
    // the aura draws right before the plate, after the fireballs — at its old
    // -1 the balls painted over it too.
    this.glow.renderOrder = 4;
    this.board.add(this.glow);
  }

  update(): void {
    const msg = match.message;
    const style = BEAT_STYLE[msg];
    const active = app.state === 'playing' && !!style;
    this.board.visible = active;
    if (!active) {
      this.shown = '';
      return;
    }

    // "Has the plate decoded yet" folds into the redraw key, so the stencil
    // fallback swaps out for the PNG the moment it's ready (same trick as
    // the HUD scoreboard).
    const art = countdownArt(msg);
    const key = `${msg}|${art ? 'art' : 'txt'}`;
    if (key !== this.shown) {
      const newBeat = !this.shown.startsWith(`${msg}|`);
      this.shown = key;
      if (newBeat) this.beatStart = performance.now(); // slam on a new figure, not the art swap-in
      this.draw(msg, art, style.fill, style.glow);
    }

    // Hang over the centre of the bout: the mean of every platform in MY
    // frame (1v1 → mid-gap, FFA → the cross centre, 2v2 → between the lines),
    // turned upright to face me.
    const roster = localLayout();
    let cx = 0;
    let cz = 0;
    for (const seat of roster) {
      cx += seat.pos[0];
      cz += seat.pos[2];
    }
    cx /= roster.length;
    cz /= roster.length;

    // The HUD verdict's animation, at arena scale: each figure SLAMS in with
    // a quick overshoot that springs to rest, then breathes; the aura flashes
    // bright on arrival and decays into a steady pulse in the beat's colour.
    const now = performance.now();
    const t = (now - this.beatStart) / 1000;
    const spring = 1 + 0.6 * Math.exp(-t * 8) * Math.cos(t * 17);
    const breathe = 1 + 0.02 * Math.sin(now * 0.0042);
    this.board.position.set(cx, 1.75 + 0.012 * Math.sin(now * 0.0032), cz);
    this.board.rotation.set(0, Math.atan2(-cx, -cz), 0); // +z normal turned to face the origin (me)
    this.board.scale.setScalar(Math.max(0.25, spring * breathe));
    (this.board.material as MeshBasicMaterial).opacity = 1;

    const glowMat = this.glow.material as MeshBasicMaterial;
    glowMat.color.setHex(BEAT_ACCENT[msg] ?? 0xffffff);
    const intro = easeOutCubic(Math.min(1, t / 0.25));
    const flash = 0.55 * Math.exp(-t * 5);
    const pulse = 0.26 + 0.12 * Math.sin(now * 0.005);
    glowMat.opacity = Math.min(0.95, intro * pulse + flash);
    this.glow.scale.setScalar(1 + 0.18 * Math.exp(-t * 6) + 0.05 * Math.sin(now * 0.005));
  }

  private draw(text: string, art: HTMLImageElement | null, fill: string, glow: string): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 1024, 512);
    if (art) {
      // The HUD's neon-metal plate, sized by its visible glyph: digits tall,
      // the FIGHT word wide.
      drawContentPlate(ctx, art, 1024, 512, text.length > 2 ? 310 : 440, 24);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `900 ${text.length > 2 ? 240 : 400}px 'Arial Black', system-ui, sans-serif`;
      ctx.lineWidth = 26;
      ctx.strokeStyle = 'rgba(10,11,14,0.95)';
      ctx.strokeText(text, 512, 268);
      ctx.fillStyle = fill;
      ctx.shadowColor = glow;
      ctx.shadowBlur = 46;
      ctx.fillText(text, 512, 268);
    }
    this.texture.needsUpdate = true;
  }
}
