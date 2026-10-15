/**
 * THE CLUB — the venue, neon district edition: a basement club under the
 * back street. (Regulars still just call it the club; the sign over the
 * stairs is a moon, not a word.)
 *
 * The ROOM is baked: built in Blender (blendercyber scripts/v2/build_club.py)
 * around layout.json — the same layout config.ts hands the teleport and the
 * walls — lit in Cycles and baked to unlit atlases (public/club/
 * neon_club.glb), with the polished concrete floor kept as glossy PBR that
 * reflects the room's own panorama. One GLB, a dozen draw calls, no lights
 * needed to see it.
 *
 * What stays in code is the LIVE layer — the things that move, glow on the
 * beat, or hand refs to a system: the floor
 * inlay (ClubSystem), the DJ's working surface, the bottle wall's breath,
 * the still room's andon, the MIRROR's pane and figures (ClubMirrorSystem),
 * SUPER OCTAGON's screen and board (ArcadeSystem), THE STEP's void and
 * threshold (CourseSystem) — plus a few real lights for the people in it.
 */

import {
  AdditiveBlending,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  EquirectangularReflectionMapping,
  Group,
  HemisphereLight,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  Vector3,
  type Material,
  type Object3D,
  type Scene,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { PALETTE, hueToColor } from '../config.js';
import { glowTexture } from '../materials/glow.js';
import { SpectrumSet } from '../arena/spectrum/set.js';
import { VOID_BG } from '../arena/voidkit.js';
import { buildLedFloor, type LedFloor } from './ledFloor.js';
import { CLUB, DECOR } from './config.js';
import { collapseStatic } from './merge.js';
import { registerArcade } from './arcade.js';
import { registerStep } from './step.js';
import { adoptLedWall, loadDjGear } from './stageShow.js';
import { font, onFontsReady } from '../ui/fonts.js';


/** The FOYER — the menu place. Not an antechamber of the club anymore but
 *  a piece of THE VOID (the set's own space, see arena/voidkit.ts): a
 *  floating platform in reactive darkness. The club's door is a button on
 *  the board, not a thing in the room. */
export interface FoyerRefs {
  root: Group;
  /** The world around the platform (SPECTRUM) — ClubSystem plays it off the lobby loop. */
  env: SpectrumSet;
}

/** Everything the systems animate or query — kept out of the static bake. */
export interface ClubRefs {
  root: Group;
  /** The live LED tile dance floor (ledFloor.ts). */
  ledFloor: LedFloor;
  /** The backlit ribbed glass behind the bar (slow breathing). */
  barBackMat: MeshStandardMaterial;
  /** Every candle flame in the room shares this sprite material (flicker). */
  candleMat: SpriteMaterial;
  /** The still room's lamp (breathes very slowly — a resting pulse). */
  stillLampMat: MeshStandardMaterial;
  /** The DJ console's fader glow (bar-synced blink). */
  consoleMat: MeshBasicMaterial;
}

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

/** A box with its transform applied. */
function box(
  parent: Object3D,
  mat: MeshStandardMaterial | MeshBasicMaterial,
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  ry = 0,
): Mesh {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  if (ry) m.rotation.y = ry;
  parent.add(m);
  return m;
}

/** An elegant canvas sign plane (unlit, so it reads in any gloom). */
function signPlane(w: number, h: number, px: number, draw: (g: CanvasRenderingContext2D, W: number, H: number) => void): Mesh {
  const c = document.createElement('canvas');
  c.width = px;
  c.height = Math.round((px * h) / w);
  const g = c.getContext('2d')!;
  draw(g, c.width, c.height);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  // The venue is built before the house woff2s land — re-ink the signage
  // the moment the real glyphs arrive (first paint used the fallback).
  onFontsReady(() => {
    g.clearRect(0, 0, c.width, c.height);
    draw(g, c.width, c.height);
    tex.needsUpdate = true;
  });
  const mesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  mesh.renderOrder = 6;
  return mesh;
}

/* ═════════════════════════════ THE BUILD ═════════════════════════════════ */

/** Where the baked venue ships (blendercyber build_club.py → bake_v2.py). */
const VENUE = 'club/';

/**
 * THE VENUE — the baked basement club (neon_club.glb): every wall, floor,
 * fitting and sign, lit in Cycles and baked to unlit atlases, plus the
 * polished floor as glossy PBR that reflects the room's own panorama. It
 * streams in after the live layer is already standing, so the systems that
 * need refs (mirror, step, arcade) never wait on the network.
 */
function loadVenue(root: Group, renderer: WebGLRenderer | null): void {
  const draco = new DRACOLoader().setDecoderPath('draco/');
  const loader = new GLTFLoader().setDRACOLoader(draco);
  if (renderer) loader.setKTX2Loader(new KTX2Loader().setTranscoderPath('basis/').detectSupport(renderer));
  const neonMats: MeshBasicMaterial[] = [];
  let env: Texture | null = null;
  const glossy: MeshStandardMaterial[] = [];
  new TextureLoader().load(VENUE + 'env_club.jpg', (t) => {
    t.mapping = EquirectangularReflectionMapping;
    t.colorSpace = SRGBColorSpace;
    env = t;
    venueEnv.map = t;
    for (const m of wantsVenueEnv) {
      m.envMap = t;
      m.envMapIntensity = 1.3;
      m.needsUpdate = true;
    }
    for (const m of glossy) {
      m.envMap = t;
      m.needsUpdate = true;
    }
  });
  loader.load(VENUE + 'neon_club.glb', (gltf) => {
    const venue = gltf.scene;
    venue.name = 'venue';
    venue.traverse((o: Object3D) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const ud = o.userData ?? {};
      if (ud.iwsdk === 'live') {
        // The LED wall face: the game paints it (club/ledwall.ts) — keep the
        // geometry and its UVs, drop the placeholder material.
        mesh.name = `live-${ud.live}`;
        if (ud.live === 'ledwall') adoptLedWall(mesh);
        return;
      }
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      const mat = mesh.material as Material & MeshBasicMaterial;
      if (ud.blending === 'additive') {
        mat.blending = AdditiveBlending;
        mat.depthWrite = false;
        mat.transparent = true;
        mesh.renderOrder = 10;
      }
      if (ud.iwsdk === 'neon') neonMats.push(mat);
      const sm = mesh.material as MeshStandardMaterial;
      if (sm.isMeshStandardMaterial) {
        sm.envMapIntensity = 0.85;
        if (env) sm.envMap = env;
        else glossy.push(sm);
      }
    });
    root.add(venue);
    venueNeon.mats = neonMats;
    mirrorTwin(venue);
  });
}

/** The venue's reflection panorama, once loaded (the DJ gear wears it too). */
const venueEnv: { map: Texture | null } = { map: null };
/** Live-layer metals that should reflect the venue (the eclipse's chrome). */
const wantsVenueEnv: MeshStandardMaterial[] = [];

/** The venue's neon tubes, once loaded — ClubSystem buzzes them. */
export const venueNeon: { mats: MeshBasicMaterial[] } = { mats: [] };

export function buildClub(scene: Scene, renderer: WebGLRenderer | null = null): ClubRefs {
  const root = new Group();
  root.name = 'the-club';

  loadVenue(root, renderer);
  const ledFloor = buildLedFloor(root);
  const consoleMat = liveConsole(root);
  const barBackMat = liveBarGlow(root);
  const candleMat = new SpriteMaterial({
    map: glowTexture(),
    color: DECOR.candle,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    opacity: 0.85,
  });
  livePodCandles(root, candleMat);
  const stillLampMat = liveStill(root, candleMat);
  liveMirror(root);
  liveArcade(root);
  liveStep(root);
  liveLights(root);

  scene.add(root);
  return { root, ledFloor, barBackMat, candleMat, stillLampMat, consoleMat };
}

/* ── the DJ's kit on the baked booth (club/stageShow.ts): decks, mixer, laptop.
 *    The material the beat pulses (ClubRefs.consoleMat) lights its VU columns. */
function liveConsole(root: Group): MeshBasicMaterial {
  const meterMat = new MeshBasicMaterial({ color: 0x5dffa0, toneMapped: false });
  loadDjGear(root, meterMat, () => venueEnv.map);
  return meterMat;
}

/* ── the bottle wall's breathing glow (an additive veil over the baked glass) */
function liveBarGlow(root: Group): MeshStandardMaterial {
  const B = CLUB.bar;
  const mat = new MeshStandardMaterial({
    color: 0x000000,
    emissive: 0x4a2612,
    emissiveIntensity: 0.4,
    transparent: true,
    opacity: 0.5,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const veil = new Mesh(new PlaneGeometry(B.z1 - B.z0, 1.75), mat);
  veil.name = 'live-bar-back';
  veil.position.set(B.backX - 0.02, 1.875, (B.z0 + B.z1) / 2);
  veil.rotation.y = -Math.PI / 2;
  root.add(veil);
  return mat;
}

/* ── a candle on each karaoke table ───────────────────────────────────────── */
function livePodCandles(root: Group, candleMat: SpriteMaterial): void {
  const holder = new Group();
  holder.name = 'live-candle';
  for (const z of CLUB.boothZs) {
    const s = new Sprite(candleMat);
    s.scale.setScalar(0.22);
    s.position.set(CLUB.boothX - 0.2, 0.82, z + 0.15);
    holder.add(s);
  }
  root.add(holder);
}

/* ── THE STILL ROOM's andon: the lamp's breathing glow (the paper is baked) ─ */
function liveStill(root: Group, candleMat: SpriteMaterial): MeshStandardMaterial {
  const Q = CLUB.quiet;
  const lampMat = new MeshStandardMaterial({
    color: 0x000000,
    emissive: DECOR.candle,
    emissiveIntensity: 0.9,
    transparent: true,
    opacity: 0.35,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  const lamp = new Mesh(new BoxGeometry(0.31, 0.71, 0.31), lampMat);
  lamp.name = 'live-still-lamp';
  lamp.position.set(Q.lamp.x, 0.45, Q.lamp.z);
  root.add(lamp);
  const glowHolder = new Group();
  glowHolder.name = 'live-still-glow';
  const glow = new Sprite(candleMat);
  glow.scale.setScalar(1.1);
  glow.position.set(Q.lamp.x, 0.55, Q.lamp.z);
  glowHolder.add(glow);
  root.add(glowHolder);
  return lampMat;
}

/* ── THE MIRROR: an open glass on the north wall of the mirror bay. What you
 *    see in it is the HALL: the baked venue, mirrored through the glass plane
 *    (one clone sharing every geometry and material — three.js flips the
 *    winding for a negative scale), standing in the dark beyond the wall
 *    where nothing else is. It only draws while the glass is awake (you're
 *    near it: ClubMirrorSystem shows `haze`), so the hall is drawn twice only
 *    for whoever is looking. The figures are mirrored rigs, as before. ─── */
function liveMirror(root: Group): void {
  const M = CLUB.mirror;
  const wallZ = CLUB.minZ;
  const figures = new Group();
  figures.name = 'live-mirror-figures';
  figures.visible = false;
  root.add(figures);
  const haze = new Group();
  haze.name = 'live-mirror-haze';
  haze.visible = false;
  root.add(haze);
  // The GLASS: a clean silvered pane — near-black asleep across the room,
  // a whisper of tint awake (ClubMirrorSystem drives the opacity).
  const pane = new MeshBasicMaterial({ color: 0x05060c, transparent: true, opacity: 0.93, depthWrite: false });
  const glass = new Mesh(new PlaneGeometry(M.w, M.h), pane);
  glass.name = 'live-mirror-pane';
  glass.position.set(M.x, M.baseY + M.h / 2, wallZ + 0.012);
  root.add(glass);
  const sheen = new Mesh(
    new PlaneGeometry(M.w * 0.86, M.h * 0.86),
    new MeshBasicMaterial({ map: glowTexture(), color: 0x3a4358, transparent: true, opacity: 0.12, blending: AdditiveBlending, depthWrite: false }),
  );
  sheen.position.set(M.x - M.w * 0.18, M.baseY + M.h * 0.7, wallZ + 0.016);
  root.add(sheen);
  mirrorRefs.current = { pane, figures, haze };
}

/** The hall seen in the glass: the venue cloned and reflected through z = minZ. */
function mirrorTwin(venue: Object3D): void {
  const haze = mirrorRefs.current?.haze;
  if (!haze) return;
  const twin = venue.clone(true);
  twin.name = 'live-mirror-twin';
  twin.position.z = 2 * CLUB.minZ;
  twin.scale.z = -1;
  twin.traverse((o) => {
    o.matrixAutoUpdate = true; // the clone's meshes were frozen in the venue's frame
  });
  haze.add(twin);
}

/* ── THE ARCADE: SUPER OCTAGON's live screen + marquee on the baked cabinet,
 *    and the wall board. Cabinet-local frame: +z is the playing side. ──── */
function liveArcade(root: Group): void {
  const A = CLUB.arcade;
  const cab = new Group();
  cab.position.set(A.octagon.x, 0, A.octagon.z);
  cab.rotation.y = A.octagon.yaw;
  const marquee = signPlane(0.56, 0.2, 512, (g, sw, sh) => {
    g.fillStyle = '#0d0a14';
    g.fillRect(0, 0, sw, sh);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#ffd9f6';
    g.shadowColor = css(PALETTE.magenta);
    g.shadowBlur = 16;
    g.font = font(700, 64);
    g.letterSpacing = '4px';
    g.fillText('SUPER OCTAGON', sw / 2, sh / 2 + 2, sw - 24);
    g.letterSpacing = '0px';
    g.shadowBlur = 0;
  });
  marquee.name = 'live-octagon-marquee';
  marquee.position.set(0, 1.985, 0.279);
  cab.add(marquee);
  const tilt = Math.atan2(0.215 - 0.115, 1.78 - 1.2);
  const screenCanvas = document.createElement('canvas');
  screenCanvas.width = 384;
  screenCanvas.height = 300;
  const sg = screenCanvas.getContext('2d')!;
  sg.fillStyle = '#08060e';
  sg.fillRect(0, 0, 384, 300);
  const screenTex = new CanvasTexture(screenCanvas);
  screenTex.colorSpace = SRGBColorSpace;
  screenTex.minFilter = LinearFilter;
  const screen = new Mesh(new PlaneGeometry(0.52, 0.41), new MeshBasicMaterial({ map: screenTex }));
  screen.name = 'live-octagon-screen';
  screen.position.set(0, 1.505, 0.195);
  screen.rotation.x = -tilt;
  cab.add(screen);
  root.add(cab);

  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 512;
  boardCanvas.height = 736;
  const bg = boardCanvas.getContext('2d')!;
  bg.fillStyle = '#0d0a14';
  bg.fillRect(0, 0, 512, 736);
  const boardTex = new CanvasTexture(boardCanvas);
  boardTex.colorSpace = SRGBColorSpace;
  boardTex.minFilter = LinearFilter;
  const board = new Mesh(new PlaneGeometry(0.82, 1.18), new MeshBasicMaterial({ map: boardTex, transparent: true }));
  board.name = 'live-octagon-board';
  board.position.set(A.board.x - 0.03, A.board.y, A.board.z);
  board.rotation.y = A.board.yaw;
  root.add(board);
  // The room's real light for anyone standing in it (the room itself is baked).
  const glow = new PointLight(0xffcb96, 1.2, 5.5, 1.4);
  glow.position.set((A.minX + A.maxX) / 2, 2.1, (A.minZ + A.maxZ) / 2);
  root.add(glow);

  registerArcade({
    screen,
    screenCanvas,
    screenTex,
    boardCanvas,
    boardTex,
    cabinetPos: new Vector3(A.octagon.x, 0, A.octagon.z),
  });
}

/* ── THE STEP's live layer: the void in the frame, its shimmer, the lit
 *    threshold plate and the DANGER sign. The frame and the corridor are
 *    baked. `F` is the way the frame opens (layout: step.facing) — +1
 *    toward −z, −1 toward +z — and every "in front of the glass" offset
 *    runs along it, so the pane, the plate and CourseSystem's threshold
 *    test can't disagree about which side the room is on. ────────────── */
function liveStep(root: Group): void {
  const S = CLUB.step;
  const F = S.facing;
  const pz = S.portalZ;
  const yaw = F > 0 ? Math.PI : 0; // a plane's face points +z at yaw 0
  const portalMat = new MeshBasicMaterial({ map: voidPaneTexture(), toneMapped: false, depthWrite: true });
  const portal = new Mesh(new PlaneGeometry(S.portalW, S.portalH), portalMat);
  portal.name = 'live-step-portal';
  portal.position.set(S.portalX, S.portalH / 2, pz);
  portal.rotation.y = yaw;
  root.add(portal);
  const shimmerMat = new MeshBasicMaterial({
    map: glowTexture(),
    color: PALETTE.cyan,
    transparent: true,
    opacity: 0.16,
    blending: AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const shimmer = new Mesh(new PlaneGeometry(S.portalW, S.portalH), shimmerMat);
  shimmer.name = 'live-step-shimmer';
  shimmer.position.set(S.portalX, S.portalH / 2, pz - 0.015 * F);
  shimmer.rotation.y = yaw;
  root.add(shimmer);
  const plateMat = new MeshBasicMaterial({ color: PALETTE.cyan, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false });
  const sill = new Mesh(new PlaneGeometry(S.portalW, S.reach), plateMat);
  sill.name = 'live-step-sill';
  sill.rotation.x = -Math.PI / 2;
  sill.position.set(S.portalX, 0.016, pz - (S.reach / 2) * F);
  root.add(sill);
  // The doorway is the lamp: cold light coming THROUGH.
  const through = new PointLight(PALETTE.cyan, 1.5, 6.5, 1.5);
  through.position.set(S.portalX, 1.35, pz - 0.5 * F);
  root.add(through);
  // THE DANGER SIGN — hung from the low ceiling in front of the frame.
  const signY = 2.15;
  const signZ = pz - 0.34 * F;
  const signW = 1.16;
  const signH = 0.26;
  const danger = signPlane(signW - 0.08, signH - 0.06, 512, (g, sw, sh) => {
    g.clearRect(0, 0, sw, sh);
    const red = '#ff2233';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(700, Math.round(sh * 0.62));
    g.letterSpacing = '12px';
    g.shadowColor = red;
    g.shadowBlur = sh * 0.5;
    g.fillStyle = red;
    g.fillText('DANGER', sw / 2, sh / 2 + 1);
    g.shadowBlur = sh * 0.16;
    g.fillStyle = '#ffd9d9';
    g.fillText('DANGER', sw / 2, sh / 2 + 1);
    g.shadowBlur = 0;
    g.letterSpacing = '0px';
    g.strokeStyle = red;
    g.lineWidth = Math.max(2, sh * 0.07);
    g.lineCap = 'round';
    g.shadowColor = red;
    g.shadowBlur = sh * 0.3;
    for (let i = 0; i < 3; i++) {
      for (const side of [-1, 1] as const) {
        const x = sw / 2 + side * (sw * 0.36 + i * sh * 0.22);
        g.beginPath();
        g.moveTo(x - side * sh * 0.14, sh * 0.24);
        g.lineTo(x + side * sh * 0.06, sh / 2);
        g.lineTo(x - side * sh * 0.14, sh * 0.76);
        g.stroke();
      }
    }
    g.shadowBlur = 0;
  });
  danger.name = 'live-step-danger';
  danger.position.set(S.portalX, signY, signZ - 0.026 * F);
  danger.rotation.y = yaw;
  root.add(danger);
  for (const sx of [-1, 1] as const) {
    box(root, new MeshStandardMaterial({ color: 0x111116, metalness: 0.7, roughness: 0.4 }), 0.016, CLUB.roomCeilH - (signY + signH / 2), 0.016,
      S.portalX + sx * (signW / 2 - 0.08), (CLUB.roomCeilH + signY + signH / 2) / 2, signZ);
  }
  box(root, new MeshStandardMaterial({ color: 0x111116, metalness: 0.7, roughness: 0.4 }), signW, signH, 0.045, S.portalX, signY, signZ);
  registerStep({ portal, portalMat, shimmerMat, plateMat });
}

/* ── real lights: for the PEOPLE (avatars and props are lit PBR); the room
 *    itself is baked and ignores them. Few and cheap. ─────────────────── */
function liveLights(root: Group): void {
  root.add(new HemisphereLight(0x9a8cff, 0x0b0910, 0.85));
  const F = CLUB.floor;
  const key = new PointLight(0xff7ad8, 1.6, 16, 1.55);
  key.position.set(F.x, CLUB.ceilH + 0.3, F.z);
  root.add(key);
  const barLight = new PointLight(0xffc48a, 1.4, 11, 1.55);
  barLight.position.set(CLUB.bar.x - 0.5, 2.3, (CLUB.bar.z0 + CLUB.bar.z1) / 2);
  root.add(barLight);
  const stage = new PointLight(0x9a6bff, 1.6, 10, 1.6);
  stage.position.set(0, 3.2, CLUB.stage.desk.z + 1.5);
  root.add(stage);
}

/** What ClubMirrorSystem drives: the pane's smoke, the figures' room, the
 *  depth-haze and the recess key. Everything else about the mirror bakes. */
export interface MirrorRefs {
  /** The glass tint — near-opaque asleep, light smoke awake. */
  pane: MeshBasicMaterial;
  /** Where the system parents the mirrored rigs (inside the recess). */
  figures: Group;
  /** The translucent murk planes that swallow deep reflections. */
  haze: Group;
}

/** buildClub() → ClubMirrorSystem hand-off (same pattern as socialView:
 *  the builder runs long before any system's init sees the refs). */
export const mirrorRefs: { current: MirrorRefs | null } = { current: null };

function voidPaneTexture(): CanvasTexture {
  const W = 512;
  const Hh = 768;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = Hh;
  const g = c.getContext('2d')!;
  g.fillStyle = css(VOID_BG);
  g.fillRect(0, 0, W, Hh);

  // THE HORIZON SITS AT EYE HEIGHT. The pane stands on the floor and runs
  // to 2.1 m, so a horizon drawn down the middle of the canvas lands around
  // a metre off the ground and the whole view reads as a picture hung low
  // rather than as somewhere you could walk into. Put it where a real one
  // would be — level with the eyes of whoever is standing in front of it —
  // and most of the pane is the floor running away, which is exactly what
  // you see through a door.
  const horizon = Hh * 0.22;
  // The floor grid, converging on the horizon — the deep half of the view.
  g.strokeStyle = 'rgba(79,183,255,0.22)';
  g.lineWidth = 1.6;
  for (let i = -9; i <= 9; i++) {
    g.beginPath();
    g.moveTo(W / 2 + i * (W / 4), Hh);
    g.lineTo(W / 2 + i * 7, horizon);
    g.stroke();
  }
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    const y = horizon + (Hh - horizon) * t * t * t;
    g.globalAlpha = 0.55 - t * 0.4;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.globalAlpha = 1;

  // The far skyline: bars of light standing on the horizon, deterministic.
  let seed = 0x2f;
  const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 26; i++) {
    const x = rnd() * W;
    const h = 14 + rnd() * (horizon - 24);
    const w = 5 + rnd() * 16;
    g.fillStyle = 'rgba(12,10,20,0.95)';
    g.fillRect(x, horizon - h, w, h);
    g.fillStyle = i % 3 === 0 ? 'rgba(255,42,213,0.5)' : 'rgba(79,183,255,0.42)';
    g.fillRect(x, horizon - h, w, 2.5);
  }

  // The horizon band itself — the brightest line in the picture, because a
  // void with no horizon is just a dark room.
  const band = g.createLinearGradient(0, horizon - 60, 0, horizon + 16);
  band.addColorStop(0, 'rgba(176,107,255,0)');
  band.addColorStop(0.78, 'rgba(176,107,255,0.42)');
  band.addColorStop(1, 'rgba(255,42,213,0.12)');
  g.fillStyle = band;
  g.fillRect(0, horizon - 60, W, 76);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildFoyer(scene: Scene): FoyerRefs {
  const root = new Group();
  root.name = 'club-foyer';

  const R = 4.0; // platform radius (hex)

  // ── the platform: a dark gloss hex deck with a neon rim ───────────────
  const deck = new Mesh(
    new CylinderGeometry(R, R * 0.94, 0.3, 6),
    new MeshStandardMaterial({ color: 0x0b0a12, metalness: 0.85, roughness: 0.3 }),
  );
  deck.position.y = -0.15;
  root.add(deck);
  const rim = new Mesh(new TorusGeometry(R - 0.03, 0.035, 4, 6), new MeshStandardMaterial({
    color: 0x0c0b12,
    emissive: hueToColor(0.55, 0.55),
    emissiveIntensity: 1.2,
    metalness: 0.3,
    roughness: 0.4,
  }));
  rim.rotation.x = Math.PI / 2;
  rim.rotation.z = Math.PI / 6; // flats align with the deck's
  rim.position.y = 0.012;
  root.add(rim);

  // The platform is FLOATING, so its underside is half of what anyone sees
  // of it — give it a build: six radial ribs under the deck and a tapered
  // keel hanging below, lit along their lower edges.
  const structMat = new MeshStandardMaterial({ color: 0x090810, metalness: 0.8, roughness: 0.4 });
  const ribGlow = new MeshStandardMaterial({
    color: 0x0b0a12,
    emissive: hueToColor(0.75, 0.5),
    emissiveIntensity: 0.7,
    metalness: 0.3,
    roughness: 0.5,
  });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
    const rib = new Mesh(new BoxGeometry(0.2, 0.62, R * 1.68), structMat);
    rib.position.set(0, -0.52, 0);
    rib.rotation.y = a;
    root.add(rib);
    const lip = new Mesh(new BoxGeometry(0.07, 0.05, R * 1.62), ribGlow);
    lip.position.set(0, -0.83, 0);
    lip.rotation.y = a;
    root.add(lip);
  }
  const keel = new Mesh(new CylinderGeometry(R * 0.52, 0.18, 2.6, 6), structMat);
  keel.position.y = -2.0;
  root.add(keel);
  const keelTip = new Mesh(new CylinderGeometry(0.2, 0.02, 0.5, 6), ribGlow);
  keelTip.position.y = -3.4;
  root.add(keelTip);

  // Deck inlay: two hairline rings and a crown of radial ticks near the
  // rim. Near-field detail is what the eye actually audits — you stand on
  // this thing for the whole menu.
  for (const [ir, op] of [
    [R * 0.55, 0.4],
    [R * 0.82, 0.28],
  ] as const) {
    const ring = new Mesh(
      new RingGeometry(ir - 0.02, ir + 0.02, 72),
      new MeshBasicMaterial({
        color: hueToColor(0.55, 0.5),
        transparent: true,
        opacity: op,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.006;
    root.add(ring);
  }
  const tickMat = new MeshBasicMaterial({
    color: hueToColor(0.75, 0.5),
    transparent: true,
    opacity: 0.35,
    blending: AdditiveBlending,
    depthWrite: false,
  });
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const tick = new Mesh(new PlaneGeometry(0.045, i % 4 === 0 ? 0.34 : 0.17), tickMat);
    tick.rotation.set(-Math.PI / 2, 0, -a);
    tick.position.set(Math.sin(a) * (R * 0.9), 0.006, Math.cos(a) * (R * 0.9));
    root.add(tick);
  }

  // Two step-slabs trailing off behind the spawn — the way you "came in".
  for (const [sx, sy, sz, sr] of [
    [0.5, -0.5, 5.1, 0.9],
    [-0.4, -1.1, 6.3, 0.7],
  ] as const) {
    const slab = new Mesh(
      new CylinderGeometry(sr, sr * 0.9, 0.16, 6),
      new MeshStandardMaterial({ color: 0x0b0a12, metalness: 0.8, roughness: 0.35 }),
    );
    slab.position.set(sx, sy, sz);
    root.add(slab);
  }

  // ── the world around: SPECTRUM, the raid's own — its glass seven metres
  // below the platform, the EQ wall ringing the horizon, the record in the sky.
  const env = new SpectrumSet(root, { floorIn: 3 });
  env.root.name = 'live-foyer-spectrum';
  env.root.position.y = -7;
  env.setActive(true);

  // ── THE PORTAL: the moon-gate to the club floor ───────────────────────
  // A ring of light standing on the deck's north edge; its inner shimmer
  // breathes while the way is shut, flares while the relay is being rung,
  // and the room swap IS the passage.
  // (The TONIGHT bill that used to float off the east edge is gone — the
  // tour map on the board already tells that story, better.)

  // ── light: a cool wash + one soft key — the board does the reading ────
  root.add(new HemisphereLight(0x8a90c8, 0x05040a, 0.6));
  const key = new PointLight(0xc8d4ff, 1.2, 10, 1.6);
  key.position.set(0, 3.1, -1.4);
  root.add(key);

  scene.add(root);
  collapseStatic(root, (o) => {
    for (let n: Object3D | null = o; n; n = n.parent) {
      if (n.name.startsWith('live-')) return true;
      if (n === root) break;
    }
    return false;
  });

  return { root, env };
}

