/**
 * The holo leaderboard — free-floating ranking text over the stage that
 * every dancer can read: live rank, name, score, chain. NO PANEL: no glass,
 * no frame — every glyph wears a thick black outline instead, so the board
 * reads over the gel, the lasers and the void behind them all.
 * Canvas-drawn, redrawn only when the standings actually change,
 * billboarded by RankSystem.
 */

import {
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';
import { font } from './fonts.js';

const W = 768;
const H = 1024;

/** Heavy club lettering: thick near-black casing, then the colour. */
function ink(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  px: number,
  fill: string,
  align: CanvasTextAlign,
  maxWidth?: number,
): void {
  g.textAlign = align;
  g.font = font(700, px);
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.lineWidth = Math.max(6, px * 0.22);
  g.strokeStyle = 'rgba(0,2,6,0.96)';
  if (maxWidth) g.strokeText(text, x, y, maxWidth);
  else g.strokeText(text, x, y);
  g.fillStyle = fill;
  if (maxWidth) g.fillText(text, x, y, maxWidth);
  else g.fillText(text, x, y);
}

export interface BoardRow {
  rank: number;
  name: string;
  score: number;
  /** Live dodge chain — the amber ×n on the right. */
  combo: number;
  alive: boolean;
  isMe: boolean;
  colorCss: string;
  /** Final letter, podium only — the live board has no business grading
   *  a night that isn't over. */
  grade?: string;
  gradeCss?: string;
}

export class HoloBoard {
  readonly group = new Group();
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private mesh: Mesh;

  constructor() {
    this.canvas.width = W;
    this.canvas.height = H;
    this.tex = new CanvasTexture(this.canvas);
    this.mesh = new Mesh(
      new PlaneGeometry(1.9, 2.53),
      new MeshBasicMaterial({ map: this.tex, transparent: true, side: DoubleSide, depthWrite: false }),
    );
    this.mesh.renderOrder = 25; // above the gel, below the near menus
    this.group.add(this.mesh);
  }

  redraw(rows: BoardRow[]): void {
    const g = this.canvas.getContext('2d')!;
    g.clearRect(0, 0, W, H);
    g.textBaseline = 'middle';

    // The board carries NO header, live or podium — the rows are
    // self-evident (rank 1 in gold with a letter grade IS the finale) and
    // the title strip sat exactly where the mirror ball hangs, so anything
    // written there was half-eclipsed anyway. The canvas top stays empty
    // on purpose: that zone belongs to the ball.
    const top = 176;
    const rowH = Math.min(68, (H - top - 30) / Math.max(rows.length, 1));
    rows.forEach((row, i) => {
      const y = top + i * rowH + rowH / 2;
      const dim = 'rgba(165,168,178,0.85)';
      if (row.isMe) ink(g, '▶', 30, y, 26, '#ff2ad5', 'left');
      const rankFill = !row.alive ? dim : row.rank === 1 ? '#ffd75e' : row.rank <= 10 ? '#b9ffc4' : '#f0f3f8';
      ink(g, `${row.rank}`, 66, y, 38, rankFill, 'left');
      ink(g, row.name.slice(0, 13), 140, y, 38, row.alive ? row.colorCss : dim, 'left', 356);
      ink(g, `${row.score}`, W - 150, y, 38, row.alive ? '#ffffff' : dim, 'right');
      if (row.grade) {
        // The night's letter replaces the live chain — the chain was only
        // ever a live reading, and this is the reading that lasts.
        ink(g, row.grade, W - 34, y, 40, row.gradeCss ?? '#f0f3f8', 'right');
      } else {
        ink(g, row.alive ? `×${row.combo}` : 'OUT', W - 34, y, 28, row.alive && row.combo > 0 ? '#ffb000' : dim, 'right');
      }
    });

    this.tex.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).map?.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
  }
}
