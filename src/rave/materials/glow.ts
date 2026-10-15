/**
 * Additive "glow" toolkit — a bloom-like look without full-screen
 * post-processing (fragile/expensive in stereo WebXR). Everything renders
 * additively with depthWrite off, so hot cores bleed soft halos.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
  type ColorRepresentation,
  type PointsMaterialParameters,
  type Texture,
} from 'three';

let _glowTex: Texture | undefined;

/** A soft radial falloff texture (white core → transparent edge), cached. */
export function glowTexture(): Texture {
  if (_glowTex) return _glowTex;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  _glowTex = new CanvasTexture(canvas);
  return _glowTex;
}

let _glintTex: Texture | undefined;

/**
 * A four-point lens glint — hot core, two thin crossing streaks, a faint
 * halo — the shape a real point of light leaves on a real lens. This is
 * THE particle texture for anything that sparkles: a bare (unmapped)
 * Points material renders literal SQUARES, which is exactly the retro
 * confetti look this game is not going for.
 */
export function glintTexture(): Texture {
  if (_glintTex) return _glintTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;
  g.globalCompositeOperation = 'lighter';
  // Faint halo.
  const halo = g.createRadialGradient(mid, mid, 0, mid, mid, mid);
  halo.addColorStop(0, 'rgba(255,255,255,0.30)');
  halo.addColorStop(0.35, 'rgba(255,255,255,0.10)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);
  // The two streaks: a radial gradient squashed flat, once per axis.
  for (const flip of [false, true]) {
    g.save();
    g.translate(mid, mid);
    if (flip) g.rotate(Math.PI / 2);
    g.scale(1, 0.07);
    const streak = g.createRadialGradient(0, 0, 0, 0, 0, mid);
    streak.addColorStop(0, 'rgba(255,255,255,0.95)');
    streak.addColorStop(0.4, 'rgba(255,255,255,0.35)');
    streak.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = streak;
    g.fillRect(-mid, -mid, size, size * 8);
    g.restore();
  }
  // Hot core.
  const core = g.createRadialGradient(mid, mid, 0, mid, mid, size * 0.09);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, size, size);
  _glintTex = new CanvasTexture(c);
  return _glintTex;
}

let _pipTex: Texture | undefined;

/**
 * The HUD pip: a lit disc inside the thick near-black casing every HUD
 * glyph wears, with a quiet halo past the ring — the ink language as a
 * particle texture. White where the light is, near-black where the casing
 * is, so a vertex colour multiplied in serves every state from full neon
 * down to cold slate with the one texture.
 */
export function pipTexture(): Texture {
  if (_pipTex) return _pipTex;
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const mid = size / 2;
  // The halo — the bloom a lit pip throws. Sits OUTSIDE the casing so an
  // unlit slate pip wears only a whisper of it.
  const halo = g.createRadialGradient(mid, mid, size * 0.28, mid, mid, mid);
  halo.addColorStop(0, 'rgba(255,255,255,0.42)');
  halo.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  halo.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);
  // The casing, then the disc.
  g.beginPath();
  g.arc(mid, mid, size * 0.3, 0, Math.PI * 2);
  g.fillStyle = 'rgba(2,3,8,0.97)';
  g.fill();
  g.beginPath();
  g.arc(mid, mid, size * 0.215, 0, Math.PI * 2);
  g.fillStyle = 'rgba(255,255,255,1)';
  g.fill();
  _pipTex = new CanvasTexture(c);
  return _pipTex;
}

/**
 * A PointsMaterial that multiplies its size by a per-particle `aSize`
 * attribute. The stock points pipeline draws every particle the SAME
 * size, which is the single biggest reason a cloud reads as confetti
 * rather than sparkle: real glitter is a population — dust, grains, and
 * the odd hero glint the lens actually caught. One injected multiply
 * keeps everything else stock (map, vertex colours, attenuation, the XR
 * paths) and the whole cloud stays one draw call. Geometry used with this
 * material MUST carry an `aSize` float attribute — an unbound attribute
 * reads 0 and the points vanish.
 */
export function sizedPointsMaterial(params: PointsMaterialParameters): PointsMaterial {
  const mat = new PointsMaterial(params);
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('uniform float size;', 'uniform float size;\nattribute float aSize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
  };
  return mat;
}

const _beamTex: (Texture | undefined)[] = [undefined, undefined];

/**
 * A vertical alpha ramp for light beams and cones — full-bright at the
 * SOURCE end, dissolving to nothing before the far end. This one texture is
 * most of the difference between "a glowing stick" and "a beam through
 * haze": a flat-opacity cylinder ends in mid-air as a hard 15-metre rod,
 * while a ramped one simply runs out of light.
 *
 * `sourceAtTop` picks which V end is the bright one: cones hang their apex
 * at V=1 (the ball), beams grow from their emitter at V=0.
 */
export function beamGradientTexture(sourceAtTop: boolean): Texture {
  const slot = sourceAtTop ? 1 : 0;
  const hit = _beamTex[slot];
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  // flipY (default) puts V=0 at the canvas BOTTOM.
  const grad = g.createLinearGradient(0, 128, 0, 0); // bottom → top = V0 → V1
  const stops: [number, number][] = [
    [0, 0.95],
    [0.3, 0.6],
    [0.62, 0.24],
    [0.88, 0.05],
    [1, 0],
  ];
  for (const [at, a] of stops) {
    grad.addColorStop(sourceAtTop ? 1 - at : at, `rgba(255,255,255,${a})`);
  }
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  const tex = new CanvasTexture(c);
  _beamTex[slot] = tex;
  return tex;
}

/** A camera-facing additive glow halo. */
export function glowSprite(color: ColorRepresentation, size: number, opacity = 1): Sprite {
  const sprite = new Sprite(
    new SpriteMaterial({
      map: glowTexture(),
      color: new Color(color),
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      opacity,
    }),
  );
  sprite.scale.setScalar(size);
  return sprite;
}
