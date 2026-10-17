/**
 * THE PODIUM's plinth, in the neon district's language (arena/neon): the
 * drum your blank turns on beside the YOU wing — gunmetal, a cyan seam run
 * under its lip in segments, a magenta foot line, and a dark deck etched
 * with a turntable dial that keeps a slow turn of its own against the
 * podium's. Subtle on purpose: display furniture, lit just enough to read
 * against the alley, never a sign.
 *
 * Same envelope as the drum it replaces (0.42 m top, 0.48 m foot, deck at
 * 0.177 m), so the blank stands where it always stood. Everything is drawn
 * once; the only per-frame work is a rotation and two opacities.
 */

import {
  AdditiveBlending,
  type BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** The district's two neons (arena/neon's street lights). */
const CYAN = 0x2fd8ff;
const PINK = 0xff3a8c;

const TOP_R = 0.42;
const FOOT_R = 0.48;
const DRUM_H = 0.16;
/** The drum's radius at height y (0 = foot, DRUM_H = lip). */
const drumR = (y: number): number => FOOT_R + (TOP_R - FOOT_R) * (y / DRUM_H);

export interface Plinth {
  group: Group;
  dial: Mesh;
  seam: MeshBasicMaterial;
  foot: MeshBasicMaterial;
  t: number;
}

/** A band hugging the drum's taper between heights y0 and y1, cut into
 *  `n` lit segments with dark gaps between them. */
function band(y0: number, y1: number, n: number, fill: number, lift = 0.0015): BufferGeometry {
  const arc = (Math.PI * 2) / n;
  const parts = [];
  for (let k = 0; k < n; k++) {
    // As finely cut round as the drum (48), so no chord dips inside it.
    const segs = Math.max(4, Math.ceil((96 * fill) / n));
    const g = new CylinderGeometry(drumR(y1) + lift, drumR(y0) + lift, y1 - y0, segs, 1, true, k * arc, arc * fill);
    g.translate(0, (y0 + y1) / 2, 0);
    parts.push(g);
  }
  return n === 1 ? parts[0] : (mergeGeometries(parts) ?? parts[0]);
}

/** The deck's etching: a turntable dial, a few traces, one pink arc. */
function dialTexture(): CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const R = S / 2;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S, S);
  g.translate(R, R);
  const cyan = (a: number): string => `rgba(47,216,255,${a})`;
  const pink = (a: number): string => `rgba(255,58,140,${a})`;
  const ring = (r: number, w: number, style: string): void => {
    g.beginPath();
    g.arc(0, 0, r * R, 0, Math.PI * 2);
    g.lineWidth = w;
    g.strokeStyle = style;
    g.stroke();
  };
  // The rim and the dial's ticks: every sixth one long, like a deck's.
  ring(0.965, 3, cyan(0.5));
  for (let k = 0; k < 96; k++) {
    const a = (k / 96) * Math.PI * 2;
    const long = k % 6 === 0;
    const r0 = (long ? 0.86 : 0.895) * R;
    const r1 = 0.935 * R;
    g.beginPath();
    g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
    g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
    g.lineWidth = long ? 2.5 : 1.5;
    g.strokeStyle = cyan(long ? 0.42 : 0.22);
    g.stroke();
  }
  ring(0.8, 1.5, cyan(0.16));
  ring(0.6, 1.5, cyan(0.12));
  // The one hot note: a pink arc on the inner track, and its tick.
  g.beginPath();
  g.arc(0, 0, 0.7 * R, -0.5, 0.65);
  g.lineWidth = 5;
  g.strokeStyle = pink(0.6);
  g.stroke();
  g.beginPath();
  g.arc(0, 0, 0.7 * R, 0.75, 0.82);
  g.stroke();
  // Circuit traces out from the hub: right-angled runs with a pad at the end.
  g.lineWidth = 2;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const traces: Array<[number, number, number, number]> = [
    // [start angle, start r, turn r, end angle]
    [0.35, 0.18, 0.42, 0.62],
    [1.9, 0.18, 0.34, 1.6],
    [2.6, 0.18, 0.48, 2.95],
    [3.9, 0.18, 0.38, 4.3],
    [5.2, 0.18, 0.5, 5.0],
  ];
  for (const [a0, r0, r1, a1] of traces) {
    g.beginPath();
    g.moveTo(Math.cos(a0) * r0 * R, Math.sin(a0) * r0 * R);
    g.lineTo(Math.cos(a0) * r1 * R, Math.sin(a0) * r1 * R);
    g.arc(0, 0, r1 * R, a0, a1, a1 < a0);
    g.lineTo(Math.cos(a1) * (r1 + 0.08) * R, Math.sin(a1) * (r1 + 0.08) * R);
    g.strokeStyle = cyan(0.2);
    g.stroke();
    g.beginPath();
    g.arc(Math.cos(a1) * (r1 + 0.08) * R, Math.sin(a1) * (r1 + 0.08) * R, 4, 0, Math.PI * 2);
    g.fillStyle = cyan(0.35);
    g.fill();
  }
  // The hub.
  ring(0.18, 2, cyan(0.3));
  ring(0.1, 1.5, cyan(0.18));
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildPlinth(): Plinth {
  const group = new Group();
  group.name = 'podium-plinth';
  const gunmetal = new MeshStandardMaterial({ color: 0x111318, metalness: 0.85, roughness: 0.3 });

  const drum = new Mesh(new CylinderGeometry(TOP_R, FOOT_R, DRUM_H, 48), gunmetal);
  drum.position.y = DRUM_H / 2;
  group.add(drum);

  // The deck: a dark lid, its face the etched dial.
  const lid = new Mesh(new CylinderGeometry(0.425, 0.425, 0.018, 48), new MeshStandardMaterial({ color: 0x0c0d11, metalness: 0.7, roughness: 0.4 }));
  lid.position.y = 0.168;
  group.add(lid);
  const dial = new Mesh(
    new CircleGeometry(0.415, 64),
    new MeshStandardMaterial({ color: 0x0b0c10, metalness: 0.5, roughness: 0.35, emissive: 0xffffff, emissiveMap: dialTexture(), emissiveIntensity: 0.9 }),
  );
  dial.rotation.x = -Math.PI / 2;
  dial.position.y = 0.1775;
  group.add(dial);

  // The seam under the lip, in cyan segments, and the pink line at the foot.
  const lit = (color: number, opacity: number): MeshBasicMaterial =>
    new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false });
  const seam = lit(CYAN, 0.75);
  group.add(new Mesh(band(0.128, 0.134, 12, 0.86), seam));
  const foot = lit(PINK, 0.55);
  group.add(new Mesh(band(0.012, 0.016, 1, 1), foot));

  return { group, dial, seam, foot, t: 0 };
}

/** The dial's own slow turn (against the podium's) and the neons' breath. */
export function tickPlinth(p: Plinth, delta: number): void {
  p.t += delta;
  p.dial.rotation.z += delta * 0.18;
  const breath = 0.5 + 0.5 * Math.sin(p.t * 1.3);
  p.seam.opacity = 0.62 + 0.18 * breath;
  p.foot.opacity = 0.45 + 0.15 * (1 - breath);
}
