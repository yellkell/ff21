/**
 * The rave floor — a ring of octagonal dancer platforms around the
 * GOOPLIATH's centre stage, floating in THE VOID (the environment is
 * DiscoSystem's; we bring the furniture and the light).
 *
 * Rendered ME-RELATIVE: my platform is always at the world origin on my real
 * floor, the stage is dead ahead at (0,0,−R), and everyone else's platforms
 * are placed by the ring transform. Rank lifts (RankSystem) raise the top
 * ten above the floor — RELATIVE to my own tier, so my real floor never has
 * to move: when I'm champion the whole ring sits below me, and when I'm out
 * the leaders tower overhead.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Scene,
  Vector3,
} from 'three';
import {
  OCTAGON_VERTICES,
  PLATFORM,
  hueToColor,
  ringRadius,
} from '../config.js';
import { danceHue } from '../game/profile.js';
import { seatLocal } from '../game/ring.js';
import { glowSprite } from '../materials/glow.js';
import { octagonBand, octagonSlab } from './octagon.js';
import { buildStage } from './stage.js';
import { font } from '../ui/fonts.js';

export interface PlatformHandle {
  seat: number;
  /** Move THIS for rank lifts — everything on the platform rides along. */
  root: Group;
  /** The rim's additive HALO (elimination dim lives here). */
  rimMat: MeshBasicMaterial;
  /** The rim's solid tube core — the part that reads as a physical neon
   *  fixture. Dimmed alongside the halo when a dancer is out. */
  rimCoreMat: MeshBasicMaterial;
  slabMat: MeshStandardMaterial;
  /** The floating name tag — a PLANE, not a Sprite: sprites copy the
   *  camera's roll, so every head tilt tilted all the text. RankSystem
   *  yaws it toward the viewer each frame; it stays world-upright. */
  nameTag: Mesh;
  nameMat: MeshBasicMaterial;
  /** MY platform only: the column under the deck that makes the climb
   *  VISIBLE — its top hugs the slab, its base reaches the common floor
   *  (where the stage sits), so looking over your rim you SEE you're up.
   *  RankSystem stretches it to the live stage drop. */
  pedestal: Group | null;
  /** Current eased lift (RankSystem's scratch). */
  lift: number;
}

export interface Arena {
  root: Group;
  platforms: PlatformHandle[];
  /** The stage podium root (boss stands on top). */
  stage: Group;
  stageFootlightMat: MeshStandardMaterial;
  stageNeonMat: MeshStandardMaterial;
  stageHaloMat: MeshBasicMaterial;
  /** Stage top surface height (boss feet). */
  stageTopY: number;
  dispose(): void;
}

let current: Arena | null = null;

export function arena(): Arena | null {
  return current;
}

function nameTexture(text: string, colorCss: string): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 128;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 512, 128);
  g.font = font(700, 64);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = colorCss;
  g.shadowBlur = 26;
  g.fillStyle = colorCss;
  g.fillText(text, 256, 64, 480);
  g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.font = font(700, 58);
  g.fillText(text, 256, 64, 470);
  return new CanvasTexture(c);
}

function cssColor(hex: number): string {
  return `#${hex.toString(16).padStart(6, '0')}`;
}

function buildPlatform(seat: number, name: string, isMine: boolean): PlatformHandle {
  const root = new Group();
  root.name = `platform-${seat}`;

  const hue = danceHue(seat, isMine);
  const accent = hueToColor(hue, 0.6);

  // The slab: near-black glass so the neon owns it — with a whisper of the
  // seat's accent in the emissive so the deck never reads as a flat hole.
  const slabMat = new MeshStandardMaterial({
    color: 0x101318,
    metalness: 0.85,
    roughness: 0.3,
    emissive: new Color(accent).multiplyScalar(0.045),
  });
  const slab = new Mesh(octagonSlab(OCTAGON_VERTICES, PLATFORM.thickness), slabMat);
  slab.position.y = -PLATFORM.thickness;
  root.add(slab);

  // The rim, built like the real fixture it pretends to be: a SOLID tube
  // core (opaque, depth-writing — you cannot see through a neon tube) with
  // an additive halo band bleeding past it. The old rim was one filled
  // octagon ghost-blended over the whole deck, which is exactly why it
  // read as a see-through outline.
  const rimCoreMat = new MeshBasicMaterial({
    color: new Color(accent).lerp(new Color(0xffffff), 0.42),
    transparent: true, // opacity is animated on elimination; depth still writes
    opacity: 1,
  });
  const core = new Mesh(octagonBand(OCTAGON_VERTICES, 0.06, 0.02), rimCoreMat);
  core.position.y = PLATFORM.rimLift;
  root.add(core);

  const rimMat = new MeshBasicMaterial({
    color: accent,
    transparent: true,
    opacity: 0.9,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
  });
  const halo = new Mesh(octagonBand(OCTAGON_VERTICES, 0.12, 0.02), rimMat);
  halo.scale.set(1.045, 1.9, 1.045);
  halo.position.y = PLATFORM.rimLift - 0.012;
  root.add(halo);

  // Under-deck glow: a soft pool of the seat's colour hanging beneath the
  // slab. A platform floating in a void needs to LIGHT the void it floats
  // in, or it reads as a paper cutout.
  const under = glowSprite(accent, 2.6, 0.17);
  under.position.y = -0.55;
  root.add(under);

  // Floating name tag over the far rim (not for my own platform — I know).
  // A yaw-billboarded plane: it turns to face you but never rolls.
  const nameMat = new MeshBasicMaterial({
    map: nameTexture(name, cssColor(accent)),
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  });
  const nameTag = new Mesh(new PlaneGeometry(1.1, 0.28), nameMat);
  nameTag.position.set(0, 2.05, 0);
  nameTag.visible = !isMine;
  nameTag.renderOrder = 24; // over the gel, under the board
  root.add(nameTag);

  // EVERY deck carries a pedestal: a unit-height octagonal column (slightly
  // inset) with a neon foot ring, hidden until the ranks raise that deck.
  // RankSystem stretches it from the slab's underside down to the common
  // floor each frame — lifts are absolute now, so any deck but your own
  // can be up at any moment, and a raised slab with nothing under it reads
  // as a rendering bug rather than a podium.
  let pedestal: Group | null = null;
  {
    pedestal = new Group();
    pedestal.name = `pedestal-${seat}`;
    const column = new Mesh(
      octagonSlab(OCTAGON_VERTICES, 1),
      new MeshStandardMaterial({ color: 0x14181f, metalness: 0.85, roughness: 0.4 }),
    );
    column.scale.set(0.88, 1, 0.88);
    pedestal.add(column);
    const foot = new Mesh(
      octagonSlab(OCTAGON_VERTICES, 0.035),
      new MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: 0.7,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    foot.scale.set(0.95, 1, 0.95);
    pedestal.add(foot);
    pedestal.visible = false;
    root.add(pedestal);
  }

  return { seat, root, rimMat, rimCoreMat, slabMat, nameTag, nameMat, pedestal, lift: 0 };
}

/**
 * (Re)build the whole floor for a seat count. Call on entering the lobby and
 * whenever the roster's seat count changes.
 */
export function buildArena(scene: Scene, seats: number, mySeat: number, names: (seat: number) => string): Arena {
  current?.dispose();

  const root = new Group();
  root.name = 'rave-floor';

  // The void brings no light — we bring the club's.
  const hemi = new HemisphereLight(0xbfd4ff, 0x0c0a14, 0.75);
  root.add(hemi);
  const stageLight = new PointLight(0xd3e5ff, 4.5, 26, 1.6);
  stageLight.position.set(0, 3.8, 0);

  const platforms: PlatformHandle[] = [];
  const at = new Vector3();
  for (let seat = 0; seat < seats; seat++) {
    const handle = buildPlatform(seat, names(seat), seat === mySeat);
    const { yaw } = seatLocal(mySeat, seat, seats, at);
    handle.root.position.copy(at);
    handle.root.rotation.y = yaw;
    root.add(handle.root);
    platforms.push(handle);
  }

  const { stage, footlightMat, neonMat, haloMat, topY, dispose: disposeStage } = buildStage();
  // The practical wash travels with the riser when ranking lowers the room.
  stage.add(stageLight);
  stage.position.set(0, 0, -ringRadius(seats));
  root.add(stage);

  scene.add(root);

  const built: Arena = {
    root,
    platforms,
    stage,
    stageFootlightMat: footlightMat,
    stageNeonMat: neonMat,
    stageHaloMat: haloMat,
    stageTopY: topY,
    dispose() {
      root.removeFromParent();
      disposeStage();
      root.traverse((o) => {
        const m = o as Mesh;
        if (m instanceof InstancedMesh) m.dispose();
        m.geometry?.dispose?.();
        const mat = m.material as MeshBasicMaterial | MeshBasicMaterial[] | undefined;
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose?.();
      });
      if (current === built) current = null;
    },
  };
  current = built;
  return built;
}

/** The platform root for a seat (strike FX + telegraphs parent here). */
export function platformRoot(seat: number): Group | null {
  return current?.platforms.find((p) => p.seat === seat)?.root ?? null;
}
