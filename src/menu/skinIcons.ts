/**
 * Procedural emblems for the shop / locker tiles — so a skin reads as a picture,
 * not just a word. Avatars get an animal silhouette (the metallic-animal head
 * each skin's name comes from) and the KNIGHT a heraldic shield; platforms get
 * a little octagon pad swatch painted in their colours. All drawn into a canvas
 * 2D context, sized around a centre (cx, cy) and radius r.
 */

import type { PlatformSkin } from '../avatar/skins.js';
import type { DeckStyle } from '../arena/decks.js';
import type { GearDef } from '../avatar/gear.js';

function hex(n: number): string {
  return `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** The avatar emblem for a skin id, filled in `color`. */
export function drawAvatarIcon(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, r: number, color: string): void {
  void id; // one body in town — every avatar tile draws THE BLANK's bust
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineJoin = 'round';
  drawBust(ctx, cx, cy, r);
  ctx.restore();
}

/** THE BLANK's tile: a tailor's-dummy bust — featureless egg head over wide
 *  shoulders pinching to the thin waist. Deliberately the plainest icon on
 *  the shelf: the mannequin's whole pitch is what ISN'T there yet. */
function drawBust(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const x = (u: number): number => cx + u * r;
  const y = (v: number): number => cy + v * r;
  // Egg head.
  ctx.beginPath();
  ctx.ellipse(x(0), y(-0.62), r * 0.34, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
  // Shoulders → waist, one closed sweep.
  ctx.beginPath();
  ctx.moveTo(x(-0.95), y(0.12)); // left shoulder point
  ctx.quadraticCurveTo(x(-0.98), y(-0.18), x(-0.55), y(-0.2)); // deltoid
  ctx.quadraticCurveTo(x(0), y(-0.34), x(0.55), y(-0.2)); // clavicle line
  ctx.quadraticCurveTo(x(0.98), y(-0.18), x(0.95), y(0.12)); // right deltoid
  ctx.quadraticCurveTo(x(0.6), y(0.5), x(0.34), y(1.0)); // taper in
  ctx.lineTo(x(-0.34), y(1.0)); // the thin waist
  ctx.quadraticCurveTo(x(-0.6), y(0.5), x(-0.95), y(0.12));
  ctx.closePath();
  ctx.fill();
}









/** A platform's emblem: a little octagon pad in its colours (slab fill if it has
 *  a premium tint, else the neon), rimmed in the neon. */
export function drawPlatformIcon(ctx: CanvasRenderingContext2D, skin: PlatformSkin, cx: number, cy: number, r: number): void {
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  // The deck's MATERIAL as a swatch: boards, stone, glass, gold — the same
  // thing the tile is selling, at thumbnail size.
  ctx.save();
  ctx.clip();
  drawDeckSwatch(ctx, skin.deck, cx, cy, r);
  ctx.restore();
  ctx.lineWidth = Math.max(2, r * 0.16);
  ctx.strokeStyle = hex(skin.neon);
  ctx.shadowColor = hex(skin.neon);
  ctx.shadowBlur = r * 0.5;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // BLAZING wears its flame — the same leaning-tongue silhouette as the
  // leaderboard's blazing feat marker: an outer tongue in the pad's neon and
  // a hot amber core.
  if (skin.id === 'blazing') {
    const tongue = (h: number, colour: string): void => {
      const w = h * 0.62;
      const by = cy + r * 0.62; // flame base, tip reaching up
      ctx.beginPath();
      ctx.moveTo(cx, by);
      ctx.bezierCurveTo(cx - w * 0.55, by - h * 0.12, cx - w * 0.42, by - h * 0.55, cx - w * 0.1, by - h * 0.62);
      ctx.bezierCurveTo(cx - w * 0.28, by - h * 0.8, cx + w * 0.02, by - h * 0.9, cx + w * 0.08, by - h);
      ctx.bezierCurveTo(cx + w * 0.42, by - h * 0.68, cx + w * 0.55, by - h * 0.3, cx, by);
      ctx.closePath();
      ctx.fillStyle = colour;
      ctx.fill();
    };
    tongue(r * 1.3, hex(skin.neon));
    tongue(r * 0.72, '#ffb000');
  }
  // TIDEBREAKER wears GOOPLIATH's gel drop, dark-rimmed so it pops off the
  // bottle-green deck.
  if (skin.id === 'tidebreaker') {
    const d = r * 0.72;
    ctx.beginPath();
    ctx.moveTo(cx, cy - d);
    ctx.quadraticCurveTo(cx + 0.95 * d, cy + 0.1 * d, cx + 0.55 * d, cy + 0.55 * d);
    ctx.quadraticCurveTo(cx, cy + 0.98 * d, cx - 0.55 * d, cy + 0.55 * d);
    ctx.quadraticCurveTo(cx - 0.95 * d, cy + 0.1 * d, cx, cy - d);
    ctx.closePath();
    ctx.fillStyle = hex(skin.neon);
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.07);
    ctx.strokeStyle = 'rgba(6,20,12,0.8)';
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A GEAR tile's glyph: the slot's silhouette (a head, a torso, a fist) in
 * dim steel with the piece itself drawn over it in the tile's brass — the
 * shape you're buying, where it goes.
 */
export function drawGearIcon(ctx: CanvasRenderingContext2D, def: GearDef, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const dim = 'rgba(150,150,170,0.55)';
  const line = Math.max(2, r * 0.14);
  if (def.slot === 'face') {
    drawHeadGlyph(ctx, def.id, cx, cy, r, color);
    ctx.restore();
    return;
  }
  if (def.slot === 'head') {
    ctx.fillStyle = dim;
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.1, r * 0.5, r * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = line;
    ctx.beginPath();
    switch (def.id) {
      case 'vcrest':
        // The V off a brow emblem.
        for (const sgn of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + sgn * r * 0.04, cy - r * 0.32);
          ctx.quadraticCurveTo(cx + sgn * r * 0.28, cy - r * 0.55, cx + sgn * r * 0.62, cy - r * 1.05);
          ctx.quadraticCurveTo(cx + sgn * r * 0.22, cy - r * 0.62, cx + sgn * r * 0.02, cy - r * 0.42);
          ctx.closePath();
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.12, cy - r * 0.42);
        ctx.lineTo(cx + r * 0.12, cy - r * 0.42);
        ctx.lineTo(cx, cy - r * 0.24);
        ctx.closePath();
        ctx.fill();
        break;
      case 'earfins':
        // Swept fins off each temple.
        for (const sgn of [-1, 1]) {
          for (const [len, lift] of [[0.62, 0.55], [0.52, 0.3], [0.4, 0.08]] as const) {
            ctx.beginPath();
            ctx.moveTo(cx + sgn * r * 0.42, cy - r * 0.02);
            ctx.lineTo(cx + sgn * r * (0.42 + len), cy - r * lift);
            ctx.lineTo(cx + sgn * r * 0.46, cy + r * 0.12);
            ctx.closePath();
            ctx.fill();
          }
        }
        break;
      case 'crest':
        ctx.moveTo(cx - r * 0.4, cy - r * 0.35);
        ctx.quadraticCurveTo(cx, cy - r * 1.15, cx + r * 0.45, cy - r * 0.3);
        ctx.stroke();
        break;
      case 'antennae':
        for (const s of [-1, 1]) {
          ctx.moveTo(cx + s * r * 0.3, cy - r * 0.4);
          ctx.lineTo(cx + s * r * 0.62, cy - r * 1.05);
        }
        ctx.stroke();
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.arc(cx + s * r * 0.62, cy - r * 1.05, line * 0.9, 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      case 'horns':
        for (const s of [-1, 1]) {
          ctx.moveTo(cx + s * r * 0.35, cy - r * 0.35);
          ctx.quadraticCurveTo(cx + s * r * 0.95, cy - r * 0.5, cx + s * r * 0.75, cy - r * 1.05);
        }
        ctx.stroke();
        break;
      case 'halo':
        ctx.ellipse(cx, cy - r * 0.85, r * 0.55, r * 0.16, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      case 'mohawk':
        for (let i = -2; i <= 2; i++) {
          const x = cx + i * r * 0.18;
          ctx.moveTo(x - r * 0.08, cy - r * 0.45);
          ctx.lineTo(x, cy - r * 0.95 + Math.abs(i) * r * 0.12);
          ctx.lineTo(x + r * 0.08, cy - r * 0.45);
        }
        ctx.fill();
        break;
      case 'crown':
        // A circlet with six points: the band, then the zigzag of points.
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.5, cy - r * 0.42);
        ctx.lineTo(cx + r * 0.5, cy - r * 0.42);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.5, cy - r * 0.42);
        for (let i = 0; i < 5; i++) {
          const x0 = cx - r * 0.5 + i * r * 0.25;
          const tall = i === 2 ? r * 0.55 : r * 0.34;
          ctx.lineTo(x0 + r * 0.125, cy - r * 0.42 - tall);
          ctx.lineTo(x0 + r * 0.25, cy - r * 0.42);
        }
        ctx.closePath();
        ctx.fill();
        break;
      case 'antlers':
        for (const s of [-1, 1]) {
          ctx.moveTo(cx + s * r * 0.3, cy - r * 0.42);
          ctx.quadraticCurveTo(cx + s * r * 0.72, cy - r * 0.7, cx + s * r * 0.62, cy - r * 1.15);
          ctx.moveTo(cx + s * r * 0.44, cy - r * 0.6);
          ctx.lineTo(cx + s * r * 0.36, cy - r * 0.92);
          ctx.moveTo(cx + s * r * 0.64, cy - r * 0.82);
          ctx.lineTo(cx + s * r * 0.9, cy - r * 0.98);
        }
        ctx.stroke();
        break;
      default: {
        // visorband: a wraparound plate across the eyes, with its slit.
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.56, cy - r * 0.2);
        ctx.quadraticCurveTo(cx, cy - r * 0.34, cx + r * 0.56, cy - r * 0.2);
        ctx.lineTo(cx + r * 0.5, cy + r * 0.1);
        ctx.quadraticCurveTo(cx, cy + r * 0.22, cx - r * 0.5, cy + r * 0.1);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = Math.max(1.5, line * 0.4);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.4, cy - r * 0.06);
        ctx.quadraticCurveTo(cx, cy - r * 0.16, cx + r * 0.4, cy - r * 0.06);
        ctx.stroke();
      }
    }
  } else if (def.slot === 'body' || def.slot === 'shoulders') {
    ctx.fillStyle = dim;
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.62, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.62, cy - r * 0.55);
    ctx.lineTo(cx + r * 0.32, cy + r * 0.75);
    ctx.lineTo(cx - r * 0.32, cy + r * 0.75);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = line;
    ctx.beginPath();
    switch (def.id) {
      case 'pauldrons':
        for (const s of [-1, 1]) ctx.ellipse(cx + s * r * 0.58, cy - r * 0.5, r * 0.26, r * 0.18, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        break;
      case 'thrusters':
        // Two bells hung under a pack, off the body's shoulder.
        ctx.fillRect(cx + r * 0.3, cy - r * 0.5, r * 0.3, r * 0.42);
        for (const dx of [0.36, 0.54]) {
          ctx.beginPath();
          ctx.moveTo(cx + r * (dx - 0.04), cy - r * 0.06);
          ctx.lineTo(cx + r * (dx + 0.04), cy - r * 0.06);
          ctx.lineTo(cx + r * (dx + 0.09), cy + r * 0.14);
          ctx.lineTo(cx + r * (dx - 0.09), cy + r * 0.14);
          ctx.closePath();
          ctx.fill();
        }
        break;
      case 'spikepads':
        // The pads, with three spikes rising off each.
        for (const s of [-1, 1]) ctx.ellipse(cx + s * r * 0.58, cy - r * 0.48, r * 0.3, r * 0.2, 0, Math.PI, Math.PI * 2);
        ctx.fill();
        for (const s of [-1, 1]) {
          for (const [dx, h, w] of [[0.06, 0.5, 0.07], [-0.14, 0.32, 0.055], [0.26, 0.32, 0.055]] as const) {
            const bx = cx + s * r * (0.58 + dx);
            const by = cy - r * 0.6;
            ctx.beginPath();
            ctx.moveTo(bx - r * w, by);
            ctx.lineTo(bx + s * r * 0.1, by - r * h);
            ctx.lineTo(bx + r * w, by);
            ctx.closePath();
            ctx.fill();
          }
        }
        break;
      case 'chestplate':
        ctx.moveTo(cx - r * 0.3, cy - r * 0.35);
        ctx.lineTo(cx + r * 0.3, cy - r * 0.35);
        ctx.lineTo(cx + r * 0.22, cy + r * 0.15);
        ctx.lineTo(cx, cy + r * 0.3);
        ctx.lineTo(cx - r * 0.22, cy + r * 0.15);
        ctx.closePath();
        ctx.fill();
        break;
      case 'tail':
        // A tail: swept back and down off the body, tapering, tip flicked up.
        ctx.lineWidth = line * 1.6;
        ctx.moveTo(cx - r * 0.05, cy - r * 0.18);
        ctx.quadraticCurveTo(cx + r * 0.42, cy + r * 0.06, cx + r * 0.5, cy + r * 0.46);
        ctx.stroke();
        ctx.beginPath();
        ctx.lineWidth = line;
        ctx.moveTo(cx + r * 0.5, cy + r * 0.46);
        ctx.quadraticCurveTo(cx + r * 0.6, cy + r * 0.6, cx + r * 0.74, cy + r * 0.52);
        ctx.stroke();
        break;
      case 'wings':
        // Two fans of plates off the shoulders, raked up and out.
        for (const s of [-1, 1]) {
          for (let i = 0; i < 3; i++) {
            const len = r * (0.95 - i * 0.18);
            const a = -0.95 + i * 0.28;
            ctx.beginPath();
            ctx.moveTo(cx + s * r * 0.4, cy - r * 0.45 + i * r * 0.1);
            ctx.lineTo(cx + s * (r * 0.4 + Math.cos(a) * len), cy - r * 0.45 + i * r * 0.1 + Math.sin(a) * len);
            ctx.lineWidth = line * (1.5 - i * 0.3);
            ctx.stroke();
          }
        }
        break;
      case 'warlord':
        // Great domes, a dark rolled rim under each, flames off the crown.
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + s * r * 0.6, cy - r * 0.42, r * 0.36, r * 0.32, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          for (const [dx, h, lean] of [[-0.12, 0.34, 0.14], [0.06, 0.5, 0.26], [0.22, 0.34, 0.3]] as const) {
            const bx = cx + s * r * (0.6 + dx);
            const by = cy - r * 0.68;
            ctx.beginPath();
            ctx.moveTo(bx - r * 0.07, by);
            ctx.quadraticCurveTo(bx - r * 0.06, by - r * h * 0.7, bx + s * r * lean, by - r * h);
            ctx.quadraticCurveTo(bx + s * r * 0.02, by - r * h * 0.45, bx + r * 0.07, by);
            ctx.closePath();
            ctx.fill();
          }
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = Math.max(1.5, line * 0.5);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + s * r * 0.24, cy - r * 0.42);
          ctx.lineTo(cx + s * r * 0.96, cy - r * 0.42);
          ctx.stroke();
        }
        break;
      case 'bastion':
        // Great smooth domes, a ridge over each crown, a dark rim under.
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(cx + s * r * 0.6, cy - r * 0.42, r * 0.38, r * 0.36, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(cx + s * r * 0.64, cy - r * 0.34, r * 0.28, r * 0.12, 0, 0, Math.PI);
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = Math.max(1.5, line * 0.5);
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(cx + s * r * 0.22, cy - r * 0.42);
          ctx.lineTo(cx + s * r * 0.98, cy - r * 0.42);
          ctx.stroke();
          ctx.beginPath();
          ctx.ellipse(cx + s * r * 0.6, cy - r * 0.42, r * 0.1, r * 0.3, 0, Math.PI, Math.PI * 1.5, s < 0);
          ctx.stroke();
        }
        break;
      case 'epaulets':
        // Flat boards along the shoulders, a fringe off each point.
        for (const s of [-1, 1]) {
          ctx.beginPath();
          ctx.roundRect(s > 0 ? cx + r * 0.2 : cx - r * 0.78, cy - r * 0.66, r * 0.58, r * 0.14, r * 0.07);
          ctx.fill();
          ctx.lineWidth = Math.max(1.5, line * 0.4);
          for (let i = 0; i < 5; i++) {
            const x = cx + s * r * (0.6 + i * 0.05);
            ctx.beginPath();
            ctx.moveTo(x, cy - r * 0.54);
            ctx.lineTo(x, cy - r * 0.2);
            ctx.stroke();
          }
        }
        break;
      case 'gladiator':
        // ONE shoulder armoured — the fighter's left, the tile's right:
        // lames stepping down, and the guard standing off the top.
        ctx.lineWidth = line * 1.1;
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(cx + r * (0.54 + i * 0.04), cy - r * (0.4 - i * 0.12), r * 0.26, Math.PI * (1.25 - i * 0.12), Math.PI * (1.95 - i * 0.1));
          ctx.stroke();
        }
        ctx.fillRect(cx + r * 0.3, cy - r * 1.0, r * 0.1, r * 0.38);
        break;
      case 'cape':
        // Hung off the shoulders, flaring wider than the body as it falls.
        ctx.globalAlpha = 0.85;
        ctx.moveTo(cx - r * 0.5, cy - r * 0.52);
        ctx.lineTo(cx + r * 0.5, cy - r * 0.52);
        ctx.lineTo(cx + r * 0.8, cy + r * 0.92);
        ctx.lineTo(cx - r * 0.8, cy + r * 0.92);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.fillStyle = dim;
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.44, cy - r * 0.5);
        ctx.lineTo(cx + r * 0.44, cy - r * 0.5);
        ctx.lineTo(cx + r * 0.3, cy + r * 0.75);
        ctx.lineTo(cx - r * 0.3, cy + r * 0.75);
        ctx.closePath();
        ctx.fill();
        break;
      case 'tabard':
        // A panel down the middle, cinched at the waist, a device on it.
        ctx.moveTo(cx - r * 0.3, cy - r * 0.55);
        ctx.lineTo(cx + r * 0.3, cy - r * 0.55);
        ctx.lineTo(cx + r * 0.2, cy + r * 0.2);
        ctx.lineTo(cx + r * 0.26, cy + r * 0.95);
        ctx.lineTo(cx - r * 0.26, cy + r * 0.95);
        ctx.lineTo(cx - r * 0.2, cy + r * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - r * 0.38);
        ctx.lineTo(cx + r * 0.1, cy - r * 0.22);
        ctx.lineTo(cx, cy - r * 0.06);
        ctx.lineTo(cx - r * 0.1, cy - r * 0.22);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(cx - r * 0.24, cy + r * 0.17, r * 0.48, r * 0.07);
        break;
      case 'belt':
        ctx.moveTo(cx - r * 0.42, cy + r * 0.32);
        ctx.lineTo(cx + r * 0.42, cy + r * 0.32);
        ctx.stroke();
        ctx.fillRect(cx - r * 0.09, cy + r * 0.22, r * 0.18, r * 0.2);
        break;
    }
  } else {
    // A fist from above: the palm block and four fingers.
    ctx.fillStyle = dim;
    ctx.beginPath();
    ctx.roundRect(cx - r * 0.42, cy - r * 0.2, r * 0.84, r * 0.7, r * 0.12);
    ctx.fill();
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.roundRect(cx - r * 0.4 + i * r * 0.21, cy - r * 0.55, r * 0.17, r * 0.4, r * 0.06);
      ctx.fill();
    }
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = line;
    ctx.beginPath();
    switch (def.id) {
      case 'cuffs':
        ctx.moveTo(cx - r * 0.5, cy + r * 0.55);
        ctx.lineTo(cx + r * 0.5, cy + r * 0.55);
        ctx.stroke();
        break;
      case 'gauntlets':
        // The back plate over the fist, ridged, and the flared cuff.
        ctx.beginPath();
        ctx.roundRect(cx - r * 0.38, cy - r * 0.14, r * 0.76, r * 0.5, r * 0.08);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.5, cy + r * 0.44);
        ctx.lineTo(cx + r * 0.5, cy + r * 0.44);
        ctx.lineTo(cx + r * 0.58, cy + r * 0.72);
        ctx.lineTo(cx - r * 0.58, cy + r * 0.72);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth = Math.max(1.5, line * 0.4);
        for (let i = 0; i < 3; i++) {
          const y = cy - r * 0.02 + i * r * 0.14;
          ctx.beginPath();
          ctx.moveTo(cx - r * 0.3, y);
          ctx.lineTo(cx + r * 0.3, y);
          ctx.stroke();
        }
        break;
      case 'wristblades':
        // A blade along the outside of the fist, past the knuckles.
        ctx.moveTo(cx - r * 0.5, cy + r * 0.5);
        ctx.lineTo(cx - r * 0.42, cy - r * 0.2);
        ctx.lineTo(cx - r * 0.5, cy - r * 0.9);
        ctx.lineTo(cx - r * 0.6, cy - r * 0.15);
        ctx.lineTo(cx - r * 0.58, cy + r * 0.5);
        ctx.closePath();
        ctx.fill();
        break;
      case 'claws':
        // Three talons off the knuckle line, hooking forward and down.
        ctx.lineWidth = line * 1.2;
        for (let i = -1; i <= 1; i++) {
          const x = cx + i * r * 0.26;
          ctx.beginPath();
          ctx.moveTo(x, cy - r * 0.5);
          ctx.quadraticCurveTo(x + i * r * 0.12, cy - r * 1.05, x + i * r * 0.3 + r * 0.06, cy - r * 1.02);
          ctx.stroke();
        }
        break;
      case 'knuckles':
        for (let i = 0; i < 4; i++) {
          const x = cx - r * 0.31 + i * r * 0.21;
          ctx.moveTo(x - r * 0.07, cy - r * 0.5);
          ctx.lineTo(x, cy - r * 0.85);
          ctx.lineTo(x + r * 0.07, cy - r * 0.5);
        }
        ctx.fill();
        break;
      default: // gauntlets
        ctx.fillRect(cx - r * 0.34, cy - r * 0.08, r * 0.68, r * 0.42);
    }
  }
  ctx.restore();
}

/**
 * A HEADS tile's glyph (avatar/heads.ts): the head itself, face on, as a
 * solid in the tile's brass with its eyes cut dark — ears, snout and
 * silhouette are what tell a bear from a wolf at tile size.
 */
function drawHeadGlyph(ctx: CanvasRenderingContext2D, id: string, cx: number, cy: number, r: number, color: string): void {
  const hole = 'rgba(10,10,14,0.85)';
  const blob = (x: number, y: number, rx: number, ry: number, rot = 0): void => {
    ctx.beginPath();
    ctx.ellipse(cx + x * r, cy + y * r, rx * r, ry * r, rot, 0, Math.PI * 2);
    ctx.fill();
  };
  const tri = (pts: ReadonlyArray<readonly [number, number]>): void => {
    ctx.beginPath();
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(cx + x * r, cy + y * r) : ctx.moveTo(cx + x * r, cy + y * r)));
    ctx.closePath();
    ctx.fill();
  };
  const eyes = (dx: number, y: number, rx: number, ry: number, tilt = 0): void => {
    ctx.fillStyle = hole;
    blob(-dx, y, rx, ry, tilt);
    blob(dx, y, rx, ry, -tilt);
  };
  ctx.fillStyle = color;
  switch (id) {
    case 'bear':
      blob(-0.46, -0.52, 0.2, 0.2);
      blob(0.46, -0.52, 0.2, 0.2);
      blob(0, 0, 0.6, 0.56);
      blob(0, 0.3, 0.3, 0.24);
      eyes(0.22, -0.08, 0.07, 0.07);
      blob(0, 0.2, 0.12, 0.08);
      break;
    case 'panther':
      tri([[-0.55, -0.2], [-0.42, -0.8], [-0.12, -0.45]]);
      tri([[0.55, -0.2], [0.42, -0.8], [0.12, -0.45]]);
      blob(0, 0.02, 0.56, 0.5);
      eyes(0.22, -0.04, 0.1, 0.07, 0.35);
      blob(0, 0.2, 0.06, 0.04);
      break;
    case 'eagle':
      for (const x of [-0.18, 0, 0.18]) tri([[x - 0.1, -0.3], [x * 1.6, -0.95], [x + 0.1, -0.3]]);
      blob(0, -0.06, 0.46, 0.5);
      tri([[-0.18, 0.05], [0.18, 0.05], [0.06, 0.72], [-0.02, 0.8]]);
      eyes(0.24, -0.12, 0.09, 0.08, -0.3);
      break;
    case 'knight':
      ctx.fillRect(cx - r * 0.5, cy - r * 0.7, r * 1.0, r * 1.3);
      ctx.fillStyle = hole;
      ctx.fillRect(cx - r * 0.42, cy - r * 0.18, r * 0.84, r * 0.1);
      ctx.fillStyle = color;
      ctx.fillRect(cx - r * 0.08, cy - r * 0.62, r * 0.16, r * 1.14);
      break;
    case 'stallion':
      tri([[-0.3, -0.45], [-0.22, -0.92], [-0.06, -0.5]]);
      tri([[0.3, -0.45], [0.22, -0.92], [0.06, -0.5]]);
      blob(0, -0.2, 0.38, 0.36);
      tri([[-0.34, -0.1], [0.34, -0.1], [0.2, 0.72], [-0.2, 0.72]]);
      blob(0, 0.7, 0.24, 0.14);
      eyes(0.33, -0.2, 0.06, 0.08);
      break;
    case 'wolf':
      tri([[-0.5, -0.1], [-0.4, -0.9], [-0.08, -0.4]]);
      tri([[0.5, -0.1], [0.4, -0.9], [0.08, -0.4]]);
      blob(0, -0.02, 0.52, 0.44);
      tri([[-0.22, 0.1], [0.22, 0.1], [0.08, 0.66], [-0.08, 0.66]]);
      eyes(0.22, -0.1, 0.11, 0.045, 0.4);
      break;
    case 'frog':
      blob(-0.34, -0.42, 0.24, 0.22);
      blob(0.34, -0.42, 0.24, 0.22);
      blob(0, 0.06, 0.72, 0.42);
      eyes(0.34, -0.44, 0.13, 0.05);
      ctx.strokeStyle = hole;
      ctx.lineWidth = Math.max(1.5, r * 0.06);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.5, cy + r * 0.12);
      ctx.quadraticCurveTo(cx, cy + r * 0.34, cx + r * 0.5, cy + r * 0.12);
      ctx.stroke();
      break;
    default: // bunny
      for (const s of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(cx + s * r * 0.24, cy - r * 0.72, r * 0.12, r * 0.4, s * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      blob(0, 0.08, 0.5, 0.54);
      eyes(0.16, -0.02, 0.09, 0.13);
      ctx.fillStyle = color;
      blob(0, 0.34, 0.3, 0.18);
      ctx.fillStyle = hole;
      blob(0, 0.26, 0.06, 0.05);
      break;
  }
}

/** A thumbnail of a deck material (arena/decks.ts), drawn inside the pad's
 *  clipped octagon: plank seams for the woods, grout for slate, veins for
 *  marble, a gloss arc for glass and ice, leaf squares for gold. */
function drawDeckSwatch(ctx: CanvasRenderingContext2D, deck: DeckStyle, cx: number, cy: number, r: number): void {
  const fill = (c: string): void => {
    ctx.fillStyle = c;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  /**
   * A TIMBER DECK at thumbnail size. The old version was one flat colour
   * with evenly spaced lines over it, which is why every wood read as the
   * same brown disc. Four things make a board look like a board:
   *
   *  - boards are not all the same colour (alternating tone),
   *  - a seam is a dark cut with a LIT edge, which is what gives thickness,
   *  - grain runs along the board and stops at the seam, and
   *  - flat-sawn timber has CATHEDRAL figure — nested arches — while
   *    quarter-sawn is near-straight. That difference alone tells walnut
   *    from ash without reading the label.
   */
  const planks = (o: {
    base: string;
    alt: string;
    seam: string;
    lit: string;
    grain: string;
    figured?: boolean;
    sheen?: number;
  }): void => {
    const n = 4;
    const bw = (r * 2) / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = i % 2 ? o.alt : o.base;
      ctx.fillRect(cx - r + i * bw, cy - r, bw + 0.6, r * 2);
    }
    ctx.save();
    ctx.strokeStyle = o.grain;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = Math.max(1, r * 0.045);
    for (let i = 0; i < n; i++) {
      const mx = cx - r + i * bw + bw * 0.5;
      if (o.figured) {
        for (let k = 0; k < 3; k++) {
          const half = bw * (0.13 + k * 0.15);
          const top = cy - r * (0.05 + k * 0.34);
          ctx.beginPath();
          ctx.moveTo(mx - half, cy + r);
          ctx.bezierCurveTo(mx - half, top, mx + half, top, mx + half, cy + r);
          ctx.stroke();
        }
      } else {
        for (const d of [-0.22, 0.24]) {
          const gx = mx + bw * d;
          ctx.beginPath();
          ctx.moveTo(gx, cy - r);
          ctx.bezierCurveTo(gx + bw * 0.07, cy - r * 0.35, gx - bw * 0.07, cy + r * 0.35, gx, cy + r);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    for (let i = 1; i < n; i++) {
      const x = cx - r + i * bw;
      ctx.strokeStyle = o.seam;
      ctx.lineWidth = Math.max(1.4, r * 0.055);
      ctx.beginPath();
      ctx.moveTo(x, cy - r);
      ctx.lineTo(x, cy + r);
      ctx.stroke();
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = o.lit;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + Math.max(1.4, r * 0.055) * 0.8, cy - r);
      ctx.lineTo(x + Math.max(1.4, r * 0.055) * 0.8, cy + r);
      ctx.stroke();
      ctx.restore();
    }
    if (o.sheen) {
      // Wax catches the light across the boards, not along them.
      const g = ctx.createLinearGradient(cx - r, cy - r, cx + r * 0.4, cy + r);
      g.addColorStop(0, `rgba(255,236,205,${o.sheen})`);
      g.addColorStop(0.5, 'rgba(255,236,205,0)');
      ctx.fillStyle = g;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    }
  };

  /** A coloured light washing down the deck, as the pad's tube does. */
  const wash = (colour: string, strength: number): void => {
    const g = ctx.createLinearGradient(cx, cy - r, cx, cy + r);
    g.addColorStop(0, colour.replace('ALPHA', String(strength)));
    g.addColorStop(1, colour.replace('ALPHA', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  };
  switch (deck) {
    case 'oak':
      planks({ base: '#a8783f', alt: '#9c6d37', seam: '#4e3117', lit: '#caa06a', grain: '#7c5528' });
      break;
    case 'charred': {
      // SMOULDER: burnt oak carries ALLIGATOR CHAR — the crocodile-skin
      // crazing fire leaves — and the fire is still in the cracks. One
      // orange zigzag on brown said neither; this is the char net first in
      // the black it actually is, then the live cracks glowing through it.
      planks({ base: '#2b221c', alt: '#211a15', seam: '#0a0706', lit: '#54443a', grain: '#41352c' });
      // The crazing is a NET of fine cracks over the whole board — squares
      // the size of a fingernail — not a handful of long strokes. Jittered
      // off a fixed sine so it is irregular but identical every repaint.
      const jit = (i: number, j: number): number => Math.sin(i * 12.9898 + j * 78.233) * 0.42;
      const cells = 5;
      const step = (r * 2) / cells;
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(8,6,5,0.9)';
      ctx.lineWidth = Math.max(1, r * 0.038);
      for (let i = 1; i < cells; i++) {
        ctx.beginPath();
        for (let j = 0; j <= cells; j++) {
          const x = cx - r + i * step + jit(i, j) * step * 0.4;
          const y = cy - r + j * step;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.beginPath();
        for (let j = 0; j <= cells; j++) {
          const y = cy - r + i * step + jit(j, i) * step * 0.4;
          const x = cx - r + j * step;
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // Fire still down in a few of them. Short, thin and glowing — an
      // ember is the light in the crack, never a stroke laid over the top.
      ctx.save();
      ctx.shadowColor = '#ff6a12';
      ctx.shadowBlur = r * 0.3;
      ctx.strokeStyle = '#ff9a2e';
      ctx.lineWidth = Math.max(0.7, r * 0.02);
      for (const [i, j] of [[1, 1], [3, 2], [2, 4], [4, 3]] as Array<[number, number]>) {
        const y = cy - r + j * step + jit(i, j) * step * 0.4;
        ctx.beginPath();
        ctx.moveTo(cx - r + i * step, y);
        ctx.lineTo(cx - r + (i + 0.55) * step, y + jit(j, i) * step * 0.18);
        ctx.stroke();
      }
      ctx.restore();
      break;
    }
    case 'ash':
      // AZURE: pale ash, straight-grained, under a cold tube. The wash is
      // what makes it AZURE rather than a blank white disc.
      planks({ base: '#b7c2cb', alt: '#a7b3bd', seam: '#586570', lit: '#e6eef5', grain: '#7d8a95' });
      wash('rgba(64,170,255,ALPHA)', 0.5);
      break;
    case 'redwood':
      // INFERNO: redwood is a straight, open-grained timber — and then the
      // red tube over it takes it the rest of the way.
      planks({ base: '#752c1b', alt: '#622314', seam: '#280d06', lit: '#cf6d4c', grain: '#cc6a45' });
      wash('rgba(255,52,26,ALPHA)', 0.26);
      break;
    case 'walnut':
      // WALNUT is sold on its FIGURE and its wax: cathedral arches in a
      // warm chocolate, with a sheen across the boards. Flat brown with
      // stripes was indistinguishable from the charred deck.
      planks({
        base: '#5d3d2c', alt: '#4c3123', seam: '#211309', lit: '#9a6a49',
        grain: '#8a5c3c', figured: true, sheen: 0.2,
      });
      break;
    case 'slate': {
      fill('#6d7079');
      ctx.strokeStyle = '#2e3036';
      ctx.lineWidth = Math.max(1.5, r * 0.09);
      for (let i = -1; i <= 1; i += 2) {
        ctx.beginPath();
        ctx.moveTo(cx + i * r * 0.36, cy - r);
        ctx.lineTo(cx + i * r * 0.36, cy + r);
        ctx.moveTo(cx - r, cy + i * r * 0.36);
        ctx.lineTo(cx + r, cy + i * r * 0.36);
        ctx.stroke();
      }
      break;
    }
    case 'marble':
      fill('#dcd8d0');
      ctx.strokeStyle = '#8d8a90';
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r * 0.4);
      ctx.bezierCurveTo(cx - r * 0.3, cy - r * 0.6, cx, cy + r * 0.2, cx + r, cy + r * 0.1);
      ctx.moveTo(cx - r * 0.6, cy + r);
      ctx.bezierCurveTo(cx - r * 0.2, cy + r * 0.4, cx + r * 0.3, cy + r * 0.6, cx + r * 0.4, cy - r);
      ctx.stroke();
      break;
    case 'obsidian': {
      // Volcanic glass breaks CONCHOIDALLY — shell-shaped ripples spreading
      // from the point of fracture — and it takes a hard, linear specular
      // rather than a soft bloom. One faint arc on flat black was a smudge;
      // these two facts are the whole material.
      const gg = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      gg.addColorStop(0, '#221d2c');
      gg.addColorStop(0.55, '#0b0a0f');
      gg.addColorStop(1, '#191521');
      ctx.fillStyle = gg;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      const ox = cx - r * 0.5;
      const oy = cy + r * 0.85;
      ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(ox, oy, r * (0.45 + i * 0.38), -Math.PI * 0.94, -Math.PI * 0.06);
        ctx.strokeStyle = `rgba(198,180,255,${0.36 - i * 0.07})`;
        ctx.lineWidth = Math.max(1, r * (0.08 - i * 0.013));
        ctx.stroke();
      }
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.strokeStyle = '#efe8ff';
      ctx.lineWidth = Math.max(1.5, r * 0.085);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.74, cy - r * 0.36);
      ctx.lineTo(cx - r * 0.02, cy - r * 0.8);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'frost':
      fill('#cfe3ea');
      ctx.strokeStyle = 'rgba(70,110,140,0.6)';
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.beginPath();
      ctx.moveTo(cx - r * 0.8, cy + r * 0.5);
      ctx.lineTo(cx - r * 0.1, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.7, cy - r * 0.6);
      ctx.moveTo(cx - r * 0.1, cy - r * 0.1);
      ctx.lineTo(cx + r * 0.3, cy + r * 0.8);
      ctx.stroke();
      break;
    case 'jade':
      fill('#3f8a5f');
      ctx.strokeStyle = 'rgba(200,255,220,0.5)';
      ctx.lineWidth = Math.max(1.5, r * 0.12);
      ctx.beginPath();
      ctx.arc(cx + r * 0.2, cy - r * 0.2, r * 0.6, Math.PI * 0.6, Math.PI * 1.5);
      ctx.stroke();
      break;
    case 'bullion': {
      fill('#e2b34a');
      ctx.strokeStyle = 'rgba(120,80,10,0.5)';
      ctx.lineWidth = 1;
      for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.moveTo(cx + i * r * 0.5, cy - r);
        ctx.lineTo(cx + i * r * 0.5, cy + r);
        ctx.moveTo(cx - r, cy + i * r * 0.5);
        ctx.lineTo(cx + r, cy + i * r * 0.5);
        ctx.stroke();
      }
      break;
    }
    case 'lacquer':
      fill('#7a1418');
      ctx.strokeStyle = '#e8b652';
      ctx.lineWidth = Math.max(1.5, r * 0.08);
      ctx.beginPath();
      ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
      break;
    case 'tide':
      fill('#16402c');
      ctx.strokeStyle = 'rgba(90,255,122,0.35)';
      ctx.lineWidth = Math.max(1, r * 0.06);
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.2, r * (0.3 + i * 0.25), Math.PI * 1.1, Math.PI * 1.9);
        ctx.stroke();
      }
      break;
    case 'copper': {
      // Hammered: a field of dimples on warm metal, verdigris in the low corner.
      const gg = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      gg.addColorStop(0, '#d98a52');
      gg.addColorStop(1, '#8f4a2a');
      ctx.fillStyle = gg;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 4; j++) {
          const dx = cx - r * 0.75 + i * r * 0.5 + (j % 2) * r * 0.25;
          const dy = cy - r * 0.75 + j * r * 0.5;
          const d = ctx.createRadialGradient(dx - r * 0.05, dy - r * 0.05, 0, dx, dy, r * 0.2);
          d.addColorStop(0, 'rgba(60,25,10,0.45)');
          d.addColorStop(0.7, 'rgba(60,25,10,0.08)');
          d.addColorStop(1, 'rgba(255,200,150,0.25)');
          ctx.fillStyle = d;
          ctx.beginPath();
          ctx.arc(dx, dy, r * 0.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.fillStyle = 'rgba(70,170,150,0.7)';
      ctx.beginPath();
      ctx.ellipse(cx - r * 0.45, cy + r * 0.5, r * 0.5, r * 0.32, -0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(cx + r * 0.6, cy - r * 0.55, r * 0.28, r * 0.2, 0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'basalt': {
      // A honeycomb of dark columns, seamed.
      fill('#2c2c31');
      ctx.strokeStyle = '#0d0d10';
      ctx.lineWidth = Math.max(1.2, r * 0.07);
      const hr = r * 0.34;
      for (let row = -2; row <= 2; row++) {
        for (let col = -2; col <= 2; col++) {
          const hx = cx + col * hr * 1.73 + (row % 2 ? hr * 0.866 : 0);
          const hy = cy + row * hr * 1.5;
          ctx.beginPath();
          for (let k = 0; k < 6; k++) {
            const a = Math.PI / 6 + (k * Math.PI) / 3;
            const px = hx + Math.cos(a) * hr;
            const py = hy + Math.sin(a) * hr;
            if (k === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.closePath();
          ctx.fillStyle = (row + col) % 2 ? '#34343a' : '#26262b';
          ctx.fill();
          ctx.stroke();
        }
      }
      break;
    }
    case 'magma': {
      // Black crust, and the cracks lit from underneath.
      fill('#0c0a0a');
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      const cracks: number[][][] = [
        [[-0.9, -0.3], [-0.4, -0.1], [0.1, -0.4], [0.5, -0.2], [0.95, -0.5]],
        [[-0.4, -0.1], [-0.5, 0.4], [-0.1, 0.9]],
        [[0.1, -0.4], [0.3, 0.2], [0.8, 0.5], [0.9, 0.95]],
        [[0.3, 0.2], [-0.1, 0.5]],
      ];
      for (const [glowW, colour, w] of [
        [r * 0.28, 'rgba(255,90,20,0.35)', r * 0.16],
        [r * 0.1, '#ff6a1a', r * 0.07],
        [0, '#ffd27a', r * 0.028],
      ] as Array<[number, string, number]>) {
        ctx.shadowBlur = glowW;
        ctx.shadowColor = '#ff6a1a';
        ctx.strokeStyle = colour;
        ctx.lineWidth = Math.max(1, w);
        for (const c of cracks) {
          ctx.beginPath();
          c.forEach(([u, v], k) => (k === 0 ? ctx.moveTo(cx + u * r, cy + v * r) : ctx.lineTo(cx + u * r, cy + v * r)));
          ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }
    case 'meteorite': {
      // The Widmanstätten figure: three families of bright lamellae.
      const gg = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
      gg.addColorStop(0, '#8a8f99');
      gg.addColorStop(1, '#4d525c');
      ctx.fillStyle = gg;
      ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
      ctx.save();
      ctx.strokeStyle = 'rgba(225,232,245,0.7)';
      ctx.lineWidth = Math.max(1, r * 0.05);
      for (let k = 0; k < 3; k++) {
        const a = (k * Math.PI) / 3 + 0.3;
        const dx = Math.cos(a);
        const dy = Math.sin(a);
        for (let i = -3; i <= 3; i++) {
          const ox = cx + -dy * i * r * 0.3;
          const oy = cy + dx * i * r * 0.3;
          const len = r * (0.5 + ((i + k) % 3) * 0.35);
          ctx.beginPath();
          ctx.moveTo(ox - dx * len, oy - dy * len);
          ctx.lineTo(ox + dx * len, oy + dy * len);
          ctx.stroke();
        }
      }
      ctx.restore();
      break;
    }
  }
}
