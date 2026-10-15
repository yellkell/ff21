/**
 * ARCADE HUD — floating text and bare bars, no plates. The campaign speaks
 * in as few words as possible:
 *
 *  - the titan's NAME (and the run clock) floating over the gap, with a
 *    slim segmented health bar under it — dark-souls style;
 *  - YOUR health as one small ember bar low in front of you;
 *  - a big centre TITLE for the beats (WARNING · the name reveal · FIGHT ·
 *    TITAN FELLED · SCRAPPED), one optional sub-line, nothing else.
 *
 * Everything is a transparent canvas texture in the neon district's own
 * hand (ui/kit/holo.ts), the same one the fight cards and the menus use:
 * Rajdhani set in GLITCH type (a lit word on a cyan / magenta chromatic
 * split) and bars of skewed neon cells — signage hanging in the street,
 * not a billboard.
 */

import {
  CanvasTexture,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  type Scene,
} from 'three';
import { ARENA_GAP } from '../config.js';
import { UI } from './industrial.js';
import { font, fontsReady } from './kit/fonts.js';
import { KIT } from './kit/panel.js';
import { glitchText, neonBar, neonCell } from './kit/holo.js';
import { countdownArt } from './countdownArt.js';
import { drawContentPlate } from './plateArt.js';

interface TextPlane {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  w: number;
  h: number;
  /** What's currently drawn, so identical redraw calls cost nothing. */
  key: string;
}

export interface CampaignHud {
  setVisible(v: boolean): void;
  /** The floating nameplate: titan name + optional run clock. */
  setBoss(name: string, accent: string, clock: string): void;
  /** The two bare bars (fractions 0..1). Boss bar wears the accent. */
  setBars(bossFrac: number, playerFrac: number, accent: string): void;
  /** RAID: the other raiders' names + bars (empty array hides the readout). */
  setSquad(rows: Array<{ name: string; frac: number }>): void;
  /** Big centre beat: title + one optional sub-line. Empty title clears. */
  title(text: string, sub: string, accent?: string): void;
}

/** The largest px (≤ `px`, ≥ 24) at which `text` fits `maxW` in this weight. */
function fitType(ctx: CanvasRenderingContext2D, text: string, px: number, maxW: number, track: number, weight: 600 | 700 = 700): number {
  let size = px;
  for (;;) {
    ctx.font = font(weight, size);
    ctx.letterSpacing = `${track}px`;
    const fits = ctx.measureText(text).width <= maxW;
    ctx.letterSpacing = '0px';
    if (fits || size <= 24) return size;
    size -= 4;
  }
}

/** One line of Rajdhani, tracked, with a dark drop so it reads over a lit street. */
function line(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, weight: 600 | 700, px: number, colour: string, track: number, align: CanvasTextAlign = 'center'): void {
  ctx.save();
  ctx.font = font(weight, px);
  ctx.letterSpacing = `${track}px`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.8)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function makeText(scene: Scene, w: number, h: number, meters: number): TextPlane {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(meters, meters * (h / w)),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 50;
  scene.add(mesh);
  return { mesh, ctx, tex, w, h, key: '' };
}

export function createCampaignHud(scene: Scene): CampaignHud {
  const group = new Group();
  group.name = 'campaign-hud';

  // Nameplate + boss bar float over the gap, under the titan's chin height.
  const name = makeText(scene, 1024, 128, 1.7);
  name.mesh.position.set(0, 2.42, -ARENA_GAP * 0.72);
  const bossBar = makeText(scene, 768, 44, 1.35);
  bossBar.mesh.position.set(0, 2.26, -ARENA_GAP * 0.72);

  // Your bar: small, low, tilted up at you — a glance down, not a board.
  const playerBar = makeText(scene, 512, 40, 0.62);
  playerBar.mesh.position.set(0, 0.98, -1.1);
  playerBar.mesh.rotation.x = -0.55;

  // The RAID squad readout: the other raiders' names + slim bars, floating
  // off to your left where a glance takes them in without leaving the fight.
  // Tall enough for FOUR squadmates (a five-raider room).
  const squad = makeText(scene, 384, 296, 0.5);
  squad.mesh.position.set(-0.72, 1.22, -1.05);
  squad.mesh.rotation.y = 0.42;
  squad.mesh.visible = false;

  // The centre beat text, big and unmissable, mid-gap at eye height.
  const centre = makeText(scene, 1024, 300, 2.1);
  centre.mesh.position.set(0, 1.9, -ARENA_GAP * 0.6);

  // makeText parents to the scene; re-parent under the group so one
  // visibility flag rules them all.
  for (const t of [name, bossBar, playerBar, squad, centre]) group.add(t.mesh);
  group.visible = false;
  scene.add(group);

  return {
    setVisible(v) {
      group.visible = v;
    },

    setBoss(bossName, accent, clock) {
      const key = `${bossName}|${accent}|${clock}|${fontsReady() ? 1 : 0}`;
      if (key === name.key) return;
      name.key = key;
      const { ctx, w, h } = name;
      ctx.clearRect(0, 0, w, h);
      // The name in the titan's colour, lit, on the chromatic split, with a
      // skewed neon cell either side — a sign hung over the gap.
      const px = fitType(ctx, bossName, 64, w - 200, 10);
      const y = h / 2 - (clock ? 14 : 0);
      glitchText(ctx, bossName, w / 2, y, px, accent, { track: 10, ink: accent });
      ctx.font = font(700, px);
      ctx.letterSpacing = '10px';
      const half = ctx.measureText(bossName).width / 2;
      ctx.letterSpacing = '0px';
      neonCell(ctx, w / 2 - half - 52, y - 12, 30, 24, true, accent);
      neonCell(ctx, w / 2 + half + 18, y - 12, 30, 24, true, accent);
      if (clock) line(ctx, clock, w / 2, h - 22, 600, 30, KIT.dim, 4);
      name.tex.needsUpdate = true;
    },

    setBars(bossFrac, playerFrac, accent) {
      // Quantise so tiny per-frame drips don't force canvas uploads.
      const key = `${Math.round(bossFrac * 200)}|${accent}`;
      if (key !== bossBar.key) {
        bossBar.key = key;
        const { ctx, w, h } = bossBar;
        ctx.clearRect(0, 0, w, h);
        neonBar(ctx, 8, 8, w - 16, h - 16, bossFrac, accent, 24, 4);
        bossBar.tex.needsUpdate = true;
      }
      const pkey = String(Math.round(playerFrac * 200));
      if (pkey !== playerBar.key) {
        playerBar.key = pkey;
        const { ctx, w, h } = playerBar;
        ctx.clearRect(0, 0, w, h);
        neonBar(ctx, 8, 8, w - 16, h - 16, playerFrac, UI.emberBright, 16, 4);
        playerBar.tex.needsUpdate = true;
      }
    },

    setSquad(rows) {
      squad.mesh.visible = rows.length > 0;
      if (!rows.length) {
        squad.key = '';
        return;
      }
      const key = `${rows.map((r) => `${r.name}|${Math.round(r.frac * 100)}`).join(';')}|${fontsReady() ? 1 : 0}`;
      if (key === squad.key) return;
      squad.key = key;
      const { ctx, w } = squad;
      ctx.clearRect(0, 0, w, squad.h);
      rows.slice(0, 4).forEach((r, i) => {
        const y = 18 + i * 72;
        const down = r.frac <= 0;
        line(ctx, down ? `${r.name} · DOWN` : r.name, 10, y, 600, 26, down ? KIT.danger : KIT.text, 2, 'left');
        neonBar(ctx, 10, y + 16, w - 20, 18, Math.max(0, r.frac), down ? KIT.danger : UI.emberBright, 14, 3);
      });
      squad.tex.needsUpdate = true;
    },

    title(text, sub, accent = UI.emberBright) {
      // The FIGHT beat borrows the ring-countdown's neon FIGHT plate — the same
      // art regular matches show — instead of plain glitch type. Falls back to
      // the glitch word until the PNG has decoded (the decoded flag rides the
      // key, so a re-call upgrades text → art the instant it's ready).
      const fightArt = text === 'FIGHT' && !sub ? countdownArt('FIGHT') : null;
      const key = `${text}|${sub}|${accent}|${fightArt ? 'art' : 'txt'}|${fontsReady() ? 1 : 0}`;
      if (key === centre.key) return;
      centre.key = key;
      const { ctx, w, h } = centre;
      ctx.clearRect(0, 0, w, h);
      if (fightArt) {
        // Size the visible FIGHT glyph to ~⅔ the canvas height, centred.
        drawContentPlate(ctx, fightArt, w, h, Math.round(h * 0.66), 20);
      } else if (text) {
        // GLITCH type: the beat in white, lit by its accent, on the split.
        const px = fitType(ctx, text, 120, w - 80, 10);
        glitchText(ctx, text, w / 2, h / 2 - (sub ? 30 : 0), px, accent, { track: 10 });
        if (sub) line(ctx, sub, w / 2, h / 2 + 78, 600, 42, KIT.dim, 6);
      }
      centre.tex.needsUpdate = true;
    },
  };
}
