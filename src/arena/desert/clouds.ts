/**
 * Dusk clouds: each is a handful of soft, slightly ragged SPRITES layered
 * into one drifting mass — underlit from the horizon, dark against the
 * violet. (They used to be faceted paper blobs; the sprite reads as vapour
 * at any distance and costs the same handful of draws.) They cast no
 * shadow. Their travel band runs wider than the placed spread and each
 * cloud fades out near the far edge and back in after it wraps, so a
 * cloud dissolves into the haze and re-forms rather than snapping across
 * the sky — the wrap is never seen.
 */

import { type Group as GroupT, Group, Sprite, type SpriteMaterial } from 'three';
import { CONFIG } from './config.js';
import { makeRng } from './paper.js';
import { softSprite } from './textures.js';

export interface CloudDrift {
  obj: Group;
  mat: SpriteMaterial;
  speed: number;
  bound: number; // wrap point (x), out past the placed spread
  fade: number; // width of the fade band at each edge
}

const smooth = (t: number): number => t * t * (3 - 2 * t);
const FULL = 0.82; // resting opacity — never quite solid

/** A mass of overlapping soft puffs sharing one (fade-able) material. */
function makeCloud(rng: () => number, mat: SpriteMaterial): Group {
  const g = new Group();
  const puffs = 4 + ((rng() * 3) | 0);
  for (let i = 0; i < puffs; i++) {
    const w = 6 + rng() * 7;
    const s = new Sprite(mat);
    s.scale.set(w, w * (0.42 + rng() * 0.2), 1);
    s.position.set((rng() - 0.5) * 11, (rng() - 0.5) * 2.2, (rng() - 0.5) * 5);
    g.add(s);
  }
  return g;
}

/** Drop drifting clouds into the sky; returns their drift handles. */
export function buildClouds(parent: GroupT): CloudDrift[] {
  const rng = makeRng(CONFIG.terrain.seed * 17 + 5);
  const { count, heightMin, heightMax, spread, drift } = CONFIG.clouds;
  const bound = spread + 50; // wrap well outside the visible band
  const fade = 48; // fade band sits beyond the placed clouds
  const clouds: CloudDrift[] = [];
  for (let i = 0; i < count; i++) {
    const mat = softSprite(CONFIG.palette.cloud, FULL);
    const cloud = makeCloud(rng, mat);
    const y = heightMin + rng() * (heightMax - heightMin);
    cloud.position.set((rng() * 2 - 1) * spread, y, (rng() * 2 - 1) * spread);
    parent.add(cloud);
    clouds.push({ obj: cloud, mat, speed: drift * (0.6 + rng() * 0.9), bound, fade });
  }
  return clouds;
}

/** Drift the clouds along the wind, fading them out/in across the wrap. */
export function animateClouds(clouds: CloudDrift[], delta: number): void {
  for (const c of clouds) {
    c.obj.position.x += c.speed * delta;
    if (c.obj.position.x > c.bound) c.obj.position.x = -c.bound;
    c.mat.opacity = FULL * smooth(Math.min(1, Math.max(0, (c.bound - Math.abs(c.obj.position.x)) / c.fade)));
  }
}
