/**
 * The holo leaderboard over the stage that every dancer can read: live
 * rank, name, score, chain — on the district's HOLO GLASS (ui/kit/holo.ts),
 * the same see-through pane, lit edge tube and magenta brackets as the
 * match HUD, with a STANDINGS header in glitch type, a LIVE dot, the leader
 * in a gold rank cell and YOUR row banded in hot magenta.
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
import { ACCENT_RGB, HOLO_HOT_RGB, glitchText, holoGlass, neonCell, readoutTicks, skewCell } from '../../ui/kit/holo.js';
import { font } from './fonts.js';

const ACCENT = `rgb(${ACCENT_RGB})`;

const W = 768;
const H = 1024;

/** The board's centre over the stage (m) — RankSystem hangs it here. Its
 *  rows run from the top of the plane down, so they start ~7.1 m up (two
 *  thirds of a metre higher than when the mirror ball owned the top band)
 *  and a full 8-dancer board ends ~5.7 m: clear over the giant's head. */
export const BOARD_Y = 5.9;

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
  readonly canvas = document.createElement('canvas');
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

    // THE PANE — the district's holo glass, sized to the standings so a
    // four-dancer night isn't a tall empty slab. It hangs from the top of
    // the plane (the board's rows have always grown downward from there).
    const podium = rows.some((r) => r.grade);
    const head = 150;
    const rowH = Math.min(64, (H - head - 60) / Math.max(rows.length, 1));
    const paneH = head + rows.length * rowH + 40;
    holoGlass(g, 14, 14, W - 28, paneH, { r: 22, arm: 34, fill: 'rgba(5,8,20,0.62)', bloom: 1.2 });

    // Header: the word in glitch type, LIVE / FINAL on the right.
    glitchText(g, podium ? 'FINAL' : 'STANDINGS', 52, 72, 46, ACCENT, { align: 'left', track: 8, weight: 700 });
    g.save();
    g.font = font(700, 22);
    g.letterSpacing = '6px';
    g.textAlign = 'right';
    if (podium) {
      g.fillStyle = '#ffd75e';
      g.fillText('THE NIGHT', W - 50, 72);
    } else {
      // A live dot — the board is a feed, not a poster.
      g.fillStyle = '#ff2a55';
      g.shadowColor = '#ff2a55';
      g.shadowBlur = 12;
      g.beginPath();
      g.arc(W - 128, 72, 7, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.fillStyle = 'rgba(255,190,205,0.95)';
      g.fillText('LIVE', W - 50, 72);
    }
    g.restore();
    const rule = g.createLinearGradient(40, 0, W - 40, 0);
    rule.addColorStop(0, `rgba(${ACCENT_RGB},0.6)`);
    rule.addColorStop(1, `rgba(${HOLO_HOT_RGB},0.45)`);
    g.fillStyle = rule;
    g.fillRect(40, 106, W - 80, 2);
    readoutTicks(g, 40, 111, W - 80, `rgba(${ACCENT_RGB},0.2)`, 16);
    // Column captions.
    g.save();
    g.font = font(600, 18);
    g.letterSpacing = '5px';
    g.fillStyle = `rgba(${ACCENT_RGB},0.6)`;
    g.textAlign = 'left';
    g.fillText('RANK', 44, 134);
    g.fillText('DANCER', 150, 134);
    g.textAlign = 'right';
    g.fillText('SCORE', W - 168, 134);
    g.fillText(podium ? 'GRADE' : 'CHAIN', W - 40, 134);
    g.restore();

    rows.forEach((row, i) => {
      const y = head + i * rowH + rowH / 2;
      const dim = 'rgba(150,160,178,0.7)';
      // YOU: a lit band across the row, a hot bar at its edge.
      if (row.isMe) {
        g.save();
        skewCell(g, 30, y - rowH / 2 + 4, W - 60, rowH - 8, 14);
        g.fillStyle = `rgba(${HOLO_HOT_RGB},0.16)`;
        g.fill();
        g.lineWidth = 1.5;
        g.strokeStyle = `rgba(${HOLO_HOT_RGB},0.55)`;
        g.stroke();
        g.fillStyle = `rgb(${HOLO_HOT_RGB})`;
        g.shadowColor = `rgb(${HOLO_HOT_RGB})`;
        g.shadowBlur = 10;
        g.fillRect(30, y - rowH / 2 + 8, 5, rowH - 16);
        g.restore();
      } else if (i > 0) {
        g.fillStyle = `rgba(${ACCENT_RGB},0.08)`;
        g.fillRect(44, y - rowH / 2, W - 88, 1);
      }
      // Rank: a skewed cell — gold and lit for the leader.
      const lead = row.alive && row.rank === 1;
      const rw = 72;
      const rh = Math.min(42, rowH - 16);
      neonCell(g, 44, y - rh / 2, rw, rh, lead, '#ffd75e');
      g.save();
      g.font = font(700, Math.min(32, rh - 6));
      g.textAlign = 'center';
      g.fillStyle = lead ? 'rgba(20,12,0,0.95)' : row.alive ? '#eaf6ff' : dim;
      g.fillText(`${row.rank}`, 44 + rw / 2, y + 1);
      g.restore();
      // Name, in the dancer's own colour.
      g.save();
      g.font = font(600, 34);
      g.letterSpacing = '2px';
      g.textAlign = 'left';
      g.fillStyle = row.alive ? row.colorCss : dim;
      if (row.alive) {
        g.shadowColor = row.colorCss;
        g.shadowBlur = 8;
      }
      g.fillText(row.name.slice(0, 13), 150, y + 1, 330);
      g.restore();
      // Score.
      g.save();
      g.font = font(700, 36);
      g.letterSpacing = '1px';
      g.textAlign = 'right';
      g.fillStyle = row.alive ? '#ffffff' : dim;
      g.fillText(`${row.score}`, W - 168, y + 1);
      g.restore();
      // The chain (live) or the night's letter (podium).
      g.save();
      g.textAlign = 'center';
      const cx = W - 40 - 50;
      if (row.grade) {
        glitchText(g, row.grade, cx + 6, y + 1, 40, row.gradeCss ?? '#f0f3f8', { ink: row.gradeCss ?? '#f0f3f8', split: 2 });
      } else if (!row.alive) {
        g.font = font(700, 22);
        g.letterSpacing = '4px';
        g.fillStyle = 'rgba(255,60,90,0.75)';
        g.fillText('OUT', cx + 6, y + 1);
      } else {
        const hot = row.combo > 0;
        neonCell(g, cx - 42, y - 17, 96, 34, hot, '#ffb000');
        g.font = font(700, 28);
        g.fillStyle = hot ? 'rgba(24,12,0,0.95)' : `rgba(${ACCENT_RGB},0.4)`;
        g.fillText(`×${row.combo}`, cx + 6, y + 1);
      }
      g.restore();
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
