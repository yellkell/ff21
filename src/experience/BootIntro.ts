/**
 * Boot intro — the store-game opening ritual, shown once per page load, the
 * moment the XR session starts: black screen, "yellkell.com" fades in and out
 * (3s), the FIRE FIGHT neon fades in and out (3s), then the curtain drops in
 * a single frame — boom, you're at the menu and the lobby music is already
 * playing (main.ts starts the decode at launch and fires playback in onDone).
 *
 * Head-locked, same trick as LoadingOverlay: DOM isn't visible inside an
 * immersive session, so the cards are camera-attached planes over an
 * oversized black shade. Nothing is paused or hidden — the whole lobby keeps
 * building behind the shade, which is what makes the final cut instant.
 * Not skippable by design (it's six seconds, and the silence over the
 * publisher card is exactly where the music track finishes decoding).
 */

import {
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  Vector3,
  type PerspectiveCamera,
  type Scene,
} from 'three';
import { glowTexture } from '../materials/glow.js';
import { setBootIntroActive } from './introGate.js';

const CARD_SECONDS = 3;
const FADE_SECONDS = 0.5;
const TOTAL_SECONDS = CARD_SECONDS * 2;
/** Fire the music cue this far BEFORE the curtain drops: starting a WebAudio
 *  source carries a beat of output latency (context/hardware spin-up), so a
 *  cue on the cut itself lands audibly late. This lead makes sound and
 *  reveal hit together. (Timing is crash-safe by construction — the old
 *  launch crash was about <audio> elements touching Android's media-session
 *  bridge, and MusicTrack/WebAudio never goes near it at any start time.) */
const MUSIC_LEAD_SECONDS = 0.35;

/** Per-card fade envelope: 0.5s in, 2s hold, 0.5s out. */
function envelope(t: number): number {
  if (t <= 0 || t >= CARD_SECONDS) return 0;
  if (t < FADE_SECONDS) return t / FADE_SECONDS;
  if (t > CARD_SECONDS - FADE_SECONDS) return (CARD_SECONDS - t) / FADE_SECONDS;
  return 1;
}

function makeCard(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): {
  mesh: Mesh;
  material: MeshBasicMaterial;
  texture: CanvasTexture;
  redraw: (draw2: (ctx: CanvasRenderingContext2D, w: number, h: number) => void) => void;
} {
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 640;
  const ctx = canvas.getContext('2d')!;
  const render = (fn: (c: CanvasRenderingContext2D, w: number, h: number) => void): void => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    fn(ctx, canvas.width, canvas.height);
  };
  render(draw);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const material = new MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(2.08, 1.04), material);
  mesh.renderOrder = 10_001;
  return {
    mesh,
    material,
    texture,
    redraw: (draw2) => {
      render(draw2);
      texture.needsUpdate = true;
    },
  };
}

function drawPublisher(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const cx = w / 2;
  ctx.font = '500 118px system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(255,255,255,0.45)';
  ctx.shadowBlur = 30;
  ctx.fillText('yellkell.com', cx, h / 2 - 26);
  ctx.shadowBlur = 0;
  ctx.font = '400 30px system-ui, sans-serif';
  ctx.fillStyle = '#9aa0a8';
  ctx.fillText('P R E S E N T S', cx, h / 2 + 84);
}
/** The FIRE FIGHT mark — the committed neon sign art when available (fitted
 *  whole), else the banner's stencil colourway. The glow is
 *  NOT baked in here: live glowTexture planes breathe behind the card (the
 *  lobby banner's exact treatment), so the canvas carries lettering only. */
function drawMark(ctx: CanvasRenderingContext2D, w: number, h: number, logo: HTMLImageElement | null): void {
  const cx = w / 2;
  const cy = h / 2;

  if (logo && logo.complete && logo.naturalWidth > 0) {
    // The sign (tools/neon-logo.py) is pure emission on transparency — its
    // glow already fades to nothing, so it fits whole with no feathering.
    const k = Math.min(w / logo.naturalWidth, h / logo.naturalHeight);
    const width = logo.naturalWidth * k;
    const height = logo.naturalHeight * k;
    ctx.drawImage(logo, cx - width / 2, cy - height / 2, width, height);
    return;
  }

  ctx.font = "900 150px 'Arial Black', system-ui, sans-serif";
  const fire = ctx.createLinearGradient(0, cy - 75, 0, cy + 75);
  fire.addColorStop(0, '#fff3cf');
  fire.addColorStop(0.5, '#ffb054');
  fire.addColorStop(1, '#ff7a18');
  ctx.fillStyle = fire;
  ctx.shadowColor = 'rgba(255,122,24,0.9)';
  ctx.shadowBlur = 34;
  ctx.fillText('FIRE', cx - 235, cy);
  ctx.fillStyle = '#eef6ff';
  ctx.shadowColor = 'rgba(79,183,255,0.85)';
  ctx.shadowBlur = 26;
  ctx.fillText('FIGHT', cx + 250, cy);
  ctx.shadowBlur = 0;
}

function makeShade(): Mesh {
  const shade = new Mesh(
    // Oversized to cover the whole per-eye frustum (see LoadingOverlay).
    // transparent:true (at full opacity) is LOAD-BEARING: it moves the shade
    // into the transparent render pass, which three.js draws AFTER all opaque
    // geometry. An opaque shade gets painted over by every transparent object
    // in the live lobby behind it (glows, panels, fx) — the curtain must be
    // the last transparent draw (renderOrder 10k) to actually black out a
    // scene we intentionally never hide.
    new PlaneGeometry(20, 20),
    new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 1, depthTest: false, depthWrite: false }),
  );
  shade.position.z = -1.7;
  shade.renderOrder = 10_000;
  return shade;
}

/** The shade, raised early by raiseCurtain and handed to runBootIntro. */
let curtain: Mesh | null = null;

/**
 * Black the view out BEFORE the session is requested. The headset starts
 * presenting the moment the session opens, but main.ts only learns of it on
 * a timer poll — and Quest throttles timers — so a curtain raised on that
 * poll left the menu and the alley on screen for the first frames, THEN the
 * intro. Raised here, the very first XR frame is already black (and the
 * shade's program is compiled by the flat frames still drawing behind the
 * landing). runBootIntro takes it over.
 */
export function raiseCurtain(camera: PerspectiveCamera): void {
  if (curtain) return;
  curtain = makeShade();
  camera.add(curtain);
}

/**
 * Play the boot sequence on the given camera. Fires `onMusicCue` exactly once,
 * MUSIC_LEAD_SECONDS before the shade drops (and guaranteed no later than
 * teardown, whatever happens) — hang the lobby music on it.
 *
 * The SHADE is head-locked (a featureless black cover has to follow the view
 * so turning around never breaks the blackout — and being featureless, the
 * locking is imperceptible). The CARDS are WORLD-locked: planted once, ahead
 * of wherever the player faces as the session opens, so they hold still like
 * a cinema screen instead of riding head motion — head-locked content is a
 * VR-comfort anti-pattern.
 */
export function runBootIntro(camera: PerspectiveCamera, scene: Scene, onMusicCue: () => void): void {
  setBootIntroActive(true); // park the menu's pointers behind the curtain
  // The curtain raised before the session (raiseCurtain), else a fresh one.
  const shade = curtain ?? makeShade();
  curtain = null;
  if (shade.parent !== camera) camera.add(shade);

  const pub = makeCard(drawPublisher);
  const logo = makeCard((ctx, w, h) => drawMark(ctx, w, h, null));

  // Swap in the handmade neon art once it decodes (fallback stays otherwise).
  const sign = new Image();
  sign.decoding = 'async';
  sign.onload = () => logo.redraw((ctx, w, h) => drawMark(ctx, w, h, sign));
  sign.src = 'signs/fire-fight.png'; // relative — see LoadingOverlay (subpath hosting)

  // The lobby banner's living glow, recreated behind the sign card: a wide
  // haze + a hot core (normal blending like banner.ts so it reads on the
  // void), breathing to MenuSystem.pulseBannerGlow's exact rhythm in the
  // tick loop below. Opacities start 0 and ride the card's fade envelope.
  // Draw order is explicit — shade 10000, haze 10001, core 10002, sign 10003.
  const GLOW_BASE = [0.5, 0.7] as const;
  const logoGlow = new Group();
  const glowMats: MeshBasicMaterial[] = [];
  const glowSpecs: Array<[number, number]> = [
    [3.0, 0xb0186e], // wide magenta haze
    [1.9, 0x1fa8c4], // cyan core
  ];
  for (const [size, color] of glowSpecs) {
    const mat = new MeshBasicMaterial({
      map: glowTexture(),
      color,
      transparent: true,
      opacity: 0,
      depthTest: false,
      depthWrite: false,
    });
    const plane = new Mesh(new PlaneGeometry(size, size), mat);
    plane.position.z = -0.06 + glowMats.length * 0.01;
    plane.renderOrder = 10_001 + glowMats.length;
    glowMats.push(mat);
    logoGlow.add(plane);
  }
  logo.mesh.renderOrder = 10_003;

  const logoGroup = new Group();
  logoGroup.add(logoGlow, logo.mesh);

  const root = new Group();
  root.add(pub.mesh, logoGroup);
  // Both cards sit at the group origin (only one is ever visible at a time);
  // the GROUP gets planted in front of the player's gaze. 1.35x compensates
  // the longer viewing distance (2.2m world vs the 1.65m head-locked sizing).
  root.scale.setScalar(1.35);
  scene.add(root);

  // Plant the cards ahead of the CURRENT gaze: eye-height, yaw-only forward
  // (a downward glance must not tilt the screen into the floor). Placed at
  // call time, then refined once ~0.15s in — the first session pose can lag
  // a frame or two, and the cards are still near-invisible that early.
  const placeCards = (): void => {
    const eye = new Vector3();
    camera.getWorldPosition(eye);
    const fwd = new Vector3();
    camera.getWorldDirection(fwd);
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1);
    fwd.normalize();
    root.position.copy(eye).addScaledVector(fwd, 2.2);
    root.lookAt(eye);
  };
  placeCards();
  let placementRefined = false;

  const started = performance.now();
  let finished = false;
  let cued = false;

  const cue = (): void => {
    if (cued) return;
    cued = true;
    onMusicCue();
  };

  const finish = (): void => {
    if (finished) return;
    finished = true;
    window.clearInterval(timer);
    setBootIntroActive(false); // curtain down — the menu takes its pointers back
    try {
      scene.remove(root);
      camera.remove(shade);
      for (const card of [pub, logo]) {
        card.mesh.geometry.dispose();
        card.material.dispose();
        card.texture.dispose();
      }
      shade.geometry.dispose();
      (shade.material as MeshBasicMaterial).dispose();
      for (const plane of logoGlow.children) (plane as Mesh).geometry.dispose();
      for (const mat of glowMats) mat.dispose(); // glowTexture stays — shared cache
    } finally {
      cue(); // whatever happens to the props, the music cue always fires
    }
  };

  const timer = window.setInterval(() => {
    const t = (performance.now() - started) / 1000;
    if (!placementRefined && t >= 0.15) {
      placementRefined = true;
      placeCards(); // first real XR pose is in by now; cards still ~invisible
    }
    if (t >= TOTAL_SECONDS - MUSIC_LEAD_SECONDS) cue();
    if (t >= TOTAL_SECONDS) {
      finish();
      return;
    }
    pub.material.opacity = envelope(t);
    const k = envelope(t - CARD_SECONDS);
    logo.material.opacity = k;
    // The lobby banner's breathing (MenuSystem.pulseBannerGlow): ~0.25 Hz
    // sine over scale and translucency, here gated by the card's fade.
    const pulse = 0.5 + 0.5 * Math.sin((performance.now() / 1000) * 1.6);
    const s = 0.93 + pulse * 0.14;
    logoGlow.scale.set(s, s, 1);
    const breathe = 0.72 + pulse * 0.5;
    glowMats[0].opacity = GLOW_BASE[0] * breathe * k;
    glowMats[1].opacity = GLOW_BASE[1] * breathe * k;
  }, 33);
}
