/**
 * The big in-world round countdown: "3… 2… 1… FIGHT" hanging huge in the air
 * over the middle of the arena — between the platforms, not just on the HUD.
 *
 * Drawn in RAVE RAID's count-in hand (rave/ui/hud.ts paintCount) — GLITCH
 * TYPE, the figure in the count-in's magenta over the cyan / magenta
 * chromatic split — at about two-thirds of the old neon signs' size, over a
 * faint magenta glow. Each new figure lands with a light slam; no tube
 * flicker. (Backported from the Quest build, which asked for it: "we much
 * prefer the style of the rave raid 3 2 1 countdown".)
 *
 * It mirrors `match.message` (every mode's match brain — local, 1v1 net,
 * mesh — funnels its countdown through that string), so this system never
 * needs to know whose clock is authoritative. Anything that isn't a
 * countdown beat ("KO", "YOU WIN", scores…) hides the board, which keeps the
 * endgame text on the HUD (ui/scoreboard.ts, the same hand).
 */

import { createSystem } from '@iwsdk/core';
import { AdditiveBlending, CanvasTexture, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import { localLayout } from '../combat/layout.js';
import { match } from '../combat/matchState.js';
import { app } from '../menu/appState.js';
import { font, fontsReady } from '../ui/kit/fonts.js';
import { COUNT_INK, glitchText } from '../ui/kit/holo.js';

/** The count-in ink's faint halo round the glyphs. */
const COUNT_HALO = 'rgba(255,42,213,0.45)';

/** The beats of the ritual. */
const BEATS = new Set(['3', '2', '1', 'FIGHT']);

/** Canvas size (px) of the board. */
const CW = 1024;
const CH = 512;

export class CountdownSystem extends createSystem({}) {
  private board!: Mesh;
  private glow!: Mesh;
  private canvas!: HTMLCanvasElement;
  private texture!: CanvasTexture;
  private shown = ''; // the redraw key currently on the canvas
  private beat = ''; // the figure currently up
  private beatStart = 0; // performance.now() when the current figure landed

  init(): void {
    this.canvas = document.createElement('canvas');
    this.canvas.width = CW;
    this.canvas.height = CH;
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

    // A slight magenta glow behind the figure — a child of the board, so the
    // slam carries it; its own scale fits it to a digit or the FIGHT word.
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
      new PlaneGeometry(1.7, 0.95),
      new MeshBasicMaterial({
        map: glowTex,
        color: COUNT_INK,
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        opacity: 0,
      }),
    );
    this.glow.position.z = -0.03;
    // Just under the board (renderOrder is scene-global, not hierarchical):
    // the glow draws right before the plate, after the fireballs.
    this.glow.renderOrder = 4;
    this.board.add(this.glow);
  }

  update(): void {
    const msg = match.message;
    const active = app.state === 'playing' && BEATS.has(msg);
    this.board.visible = active;
    if (!active) {
      this.shown = '';
      this.beat = '';
      return;
    }

    const now = performance.now();
    if (msg !== this.beat) {
      this.beat = msg;
      this.beatStart = now; // slam on a new figure
    }
    // "Are the fonts in yet" folds into the redraw key, so the fallback face
    // swaps for Rajdhani the moment it lands (same trick as the HUD).
    const key = `${msg}|${fontsReady() ? 1 : 0}`;
    if (key !== this.shown) {
      this.shown = key;
      this.draw(msg);
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

    // A light slam on each figure (the count-in itself just cuts), then a
    // slow breathe; the glow flashes on arrival and settles faint.
    const t = (now - this.beatStart) / 1000;
    const spring = 1 + 0.22 * Math.exp(-t * 9) * Math.cos(t * 17);
    const breathe = 1 + 0.015 * Math.sin(now * 0.0042);
    this.board.position.set(cx, 1.75 + 0.012 * Math.sin(now * 0.0032), cz);
    this.board.rotation.set(0, Math.atan2(-cx, -cz), 0); // +z normal turned to face the origin (me)
    this.board.scale.setScalar(Math.max(0.25, spring * breathe));
    const on = Math.min(1, t / 0.06);
    (this.board.material as MeshBasicMaterial).opacity = on;

    const glowMat = this.glow.material as MeshBasicMaterial;
    glowMat.opacity = on * (0.13 + 0.03 * Math.sin(now * 0.004) + 0.18 * Math.exp(-t * 6));
    const word = msg.length > 2;
    this.glow.scale.set(word ? 0.8 : 0.4, word ? 0.5 : 0.6, 1);
  }

  private draw(text: string): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, CW, CH);
    // Digits tall (the count-in's proportions), the FIGHT word fitted wide.
    let px = 250;
    if (text.length > 2) {
      px = 200;
      while (px > 60) {
        ctx.font = font(700, px);
        if (ctx.measureText(text).width <= CW - 300) break;
        px -= 2;
      }
    }
    glitchText(ctx, text, CW / 2, CH / 2, px, COUNT_HALO, { ink: COUNT_INK });
    this.texture.needsUpdate = true;
  }
}
