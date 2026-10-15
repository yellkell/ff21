/**
 * MATCH UI — the fight cards, painted with the MENU's own holo glass
 * (ui/kit/holo.ts) so the bout reads like the neon district it is fought
 * in: a see-through blue-black pane with scanlines and a diagonal sheen,
 * a lit edge tube, the "on" light bar, magenta corner brackets, Rajdhani
 * at the menu's weights. On a card the TUBE is the fighter's colour —
 * the edge, the rail down its left side, the light bar, the bar and the
 * round cells all burn in it, so whose card you are reading is one glance.
 *
 * Every fighter in the bout gets a CARD: a YOU / ALLY / RIVAL tag, their
 * callsign, a big numeric health readout, a skewed SEGMENTED health bar
 * with a DAMAGE TRAIL (a magenta ghost of what they just lost, flaring
 * white on the hit and easing away behind the live level), the rounds
 * they hold as lit cells, and the two states a glance has to catch — LOW
 * (the bar, its bloom and the number go red and pulse; a LOW label
 * breathes) and OUT (the card dims; the dim is the word). A hit tears the
 * glass: its edge flares white on a cyan / magenta chromatic split, a few
 * scan rows glitch bright and the fighter's colour spills off the rim.
 *
 * WHERE THE CARDS HANG depends on the format:
 *
 *   1V1   the classic pair — YOURS left, THEIRS right — over the rival's
 *         pad, with the CLOCK between.
 *   2V2   your column (you, your ally above) and theirs, each column with
 *         its TEAM total under the lower card. A stacked bout RE-HANGS the
 *         whole board: the cards shrink and sit a little lower so the two
 *         in a column never cross, and the verdict lifts clear of the top
 *         card instead of landing across it.
 *   FFA   the north rival keeps the right-hand card, but the fighters on
 *         the east and west pads wear their cards OVER THEIR OWN PADS,
 *         turned to face you — so the fighter you are looking at is the
 *         one whose health you read — and a STANDINGS strip over the
 *         plaque ranks all four by rounds taken, then by health.
 *
 * The neon verdict plates (KO, TIME, DRAW…) float above everything; a
 * verdict with no plate is set in GLITCH type (white on a chromatic split).
 *
 * Every board is a canvas texture and a canvas redraw + upload is the most
 * expensive UI op we have, so each board fingerprints what it drew and
 * skips when nothing it shows has changed. The parts of a card that MOVE
 * on a hit — the health bar with its damage trail, and the flash round the
 * glass — are not on the canvas at all: they are two small shader quads
 * over it (CardFx), driven by uniforms, so a landed hit costs one canvas
 * redraw (the new number) instead of one every frame while the trail eases
 * away. That per-frame redraw + 1.5 MB texture upload, on both cards at
 * once, was a big part of the stutter on every hit.
 *
 * In Aim Training the left card becomes your score/streak readout and the
 * right card shows the dodge bar + time.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  Color,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  ShaderMaterial,
  type Scene,
} from 'three';
import { ARENA_GAP, winTargetFor } from '../config.js';
import { localLayout } from '../combat/layout.js';
import type { MatchState } from '../combat/matchState.js';
import { app, training } from '../menu/appState.js';
import { UI } from './industrial.js';
import { font, fontsReady } from './kit/fonts.js';
import { KIT } from './kit/panel.js';
import { glitchText, holoGlass, neonBar, neonCell, readoutTicks, rgbOf } from './kit/holo.js';
import { countdownArt } from './countdownArt.js';
import { drawContentPlate as drawPlateArt } from './plateArt.js';
import { verdictArt } from './verdictArt.js';

const W = 880;
const H = 420;

// Visible cap height (canvas px) for the art plates, measured from the opaque
// WORD/digit so they read at a consistent size regardless of each PNG's
// transparent padding. Words (FIGHT / KNOCKOUT / WIN) share one height; the
// countdown digits share a slightly smaller one so FIGHT still lands biggest.
// Clamped by PLATE_MARGIN so the whole glyph always stays on the board.
const WORD_PLATE_H = 357;
const NUMBER_PLATE_H = 300;
const PLATE_MARGIN = 26;

/** Below this fraction a fighter is LOW: the bar goes red and pulses, and
 *  a LOW label breathes under it. */
const LOW_HP = 0.25;
/** The damage trail holds for this long after a hit, then eases away. */
const TRAIL_HOLD = 0.28;
const TRAIL_RATE = 0.9; // fraction per second
/** The rim flash on a hit. */
const FLASH_SECONDS = 0.36;
/** The clock turns hazard amber, then red and pulsing, this close to zero. */
const CLOCK_WARN = 20;
const CLOCK_HOT = 10;

interface Board {
  mesh: Mesh;
  ctx: CanvasRenderingContext2D;
  tex: CanvasTexture;
  w: number;
  h: number;
  /** A fighter card's live health bar + hit flash (cards only). */
  fx?: CardFx;
  /**
   * Content fingerprint of the last draw. Boards are asked to refresh every
   * frame but a canvas redraw + GPU texture upload is the single most
   * expensive UI op we have — so each draw skips when nothing changed.
   */
  key?: string;
}

/** One fighter's HUD readout. */
export interface FighterHud {
  /** LOCAL slot (0 = you) — the card's identity across frames. */
  slot: number;
  name: string;
  /** CSS colour for the bar/name (team tint). */
  neon: string;
  /** current / max health, 0..1. */
  hpFrac: number;
  /** current health, in points, for the readout. */
  hp: number;
  /** round wins to light as pips. */
  pips: number;
  /** Team id (0 = your team) — your team stacks left, the rest stack right. */
  team: number;
  /** Still standing this round. */
  alive: boolean;
}

export interface Scoreboard {
  /**
   * Redraw the match boards. `fighters[0]` is always you; your team stacks up
   * the left column, every other fighter stacks up the right — so 1v1 reads as
   * the classic two boards and 2v2 adds bars on top. FFA hangs the east and
   * west fighters' cards over their own pads.
   */
  updateMatch(state: MatchState, fighters: FighterHud[]): void;
  /** Redraw boards in Aim Training mode. */
  updateTraining(hp: number, hpMax: number): void;
  setVisible(v: boolean): void;
}

/** Per-fighter animation memory: the trail, the last level, the flash. */
interface CardMotion {
  hp: number;
  trail: number;
  hitAt: number;
  seen: number;
}

/* ── the live overlays ─────────────────────────────────────────────────── */

/** The health bar on the card canvas (px): where the bar overlay sits. */
const BAR = { x: 64, y: 184, w: W - 128, h: 42 };
/** Room round the bar for its bloom and anti-aliasing (px). */
const BAR_PAD = 16;
/** The card's glass on the canvas (px): where the flash overlay traces. */
const GLASS = { x: 10, y: 10, w: W - 20, h: H - 20, r: 30 };
/** The verdict's hot second tube, as hex (three's Color won't take rgba). */
const HOT = '#ff3da6';

const SDF_GLSL = /* glsl */ `
  float sdRound(vec2 p, vec2 halfSize, float r) {
    vec2 q = abs(p) - halfSize + vec2(r);
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  }
  vec4 over(vec4 dst, vec3 c, float a) {
    float oa = a + dst.a * (1.0 - a);
    vec3 oc = (c * a + dst.rgb * dst.a * (1.0 - a)) / max(oa, 1e-4);
    return vec4(oc, oa);
  }
`;

const UV_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

/**
 * THE HEALTH READOUT, live: a skewed bar of twenty lit cells — the kit's
 * neon cell, leaning like every pip in the district — inside a thin tube
 * of the fighter's colour. The live level burns in that colour (red, and
 * pulsing, once LOW) with a glassy top light, a bloom spilling off it and
 * a white-hot leading edge; the damage trail is a magenta ghost of what
 * the hit just took, flaring white for an instant, then easing away.
 */
const BAR_FRAG = /* glsl */ `
  uniform vec2 uSize;
  uniform float uPad, uFrac, uTrail, uFlash, uAlpha, uLow, uTime;
  uniform vec3 uColor, uDanger;
  varying vec2 vUv;
  ${SDF_GLSL}
  const float SKEW = 0.45; // run per rise — the kit's cell lean
  const float CELLS = 20.0;
  const float GAP = 4.0;
  void main() {
    vec2 hs = uSize * 0.5;
    vec2 px = (vUv - 0.5) * (uSize + 2.0 * uPad);
    // Unshear into the bar's own frame; hb is the upright half-size.
    vec2 q = vec2(px.x - px.y * SKEW, px.y);
    vec2 hb = vec2(hs.x - hs.y * SKEW, hs.y);
    float d = sdRound(q, hb, 2.0);
    float inside = clamp(0.5 - d, 0.0, 1.0);
    float len = 2.0 * hb.x;
    float x01 = (q.x + hb.x) / len;
    float cellW = len / CELLS;
    float c = fract(x01 * CELLS) * cellW;
    float cell = clamp(min(c, cellW - c) - GAP * 0.5 + 0.5, 0.0, 1.0) * inside;
    vec3 tone = mix(uColor, uDanger, uLow);
    float pulse = uLow * (0.5 + 0.5 * sin(uTime * 6.3));
    // The dark tube: every cell faintly lit, so the empty run still reads.
    vec4 col = over(vec4(0.0), vec3(0.47, 0.9, 1.0), 0.07 * cell);
    float lw = len * clamp(uFrac, 0.0, 1.0);
    if (uFrac > 0.0) {
      float fd = sdRound(q - vec2(-hb.x + lw * 0.5, 0.0), vec2(lw * 0.5, hb.y), 2.0);
      // The bloom, out into the pad round the bar.
      col = over(col, tone, (0.38 + 0.3 * pulse) * exp(-max(fd, 0.0) / 6.0) * (1.0 - inside));
      float fill = clamp(0.5 - fd, 0.0, 1.0) * cell;
      float down = (hs.y - px.y) / uSize.y; // 0 at the top edge, 1 at the foot
      vec3 lit = mix(tone, vec3(1.0), 0.42 * clamp(1.0 - down / 0.45, 0.0, 1.0));
      lit *= mix(1.0, 0.78, clamp((down - 0.5) * 2.0, 0.0, 1.0));
      col = over(col, mix(lit, vec3(1.0), 0.22 * pulse), fill);
    }
    // The trail: what the hit just took — white on the hit, then magenta.
    float ghost = clamp((x01 - uFrac) * len + 0.5, 0.0, 1.0) * clamp((uTrail - x01) * len + 0.5, 0.0, 1.0);
    vec3 burn = mix(vec3(1.0, 0.24, 0.65), vec3(1.0), uFlash);
    col = over(col, burn, (0.5 + 0.45 * uFlash) * ghost * cell);
    // The leading edge, white-hot where the level stands.
    if (uFrac > 0.0 && uFrac < 1.0) {
      col = over(col, vec3(1.0), 0.95 * clamp(2.5 - abs(q.x - (-hb.x + lw)), 0.0, 1.0) * inside);
    }
    // The tube round the whole run.
    col = over(col, tone, mix(0.4, 0.85, uLow) * clamp(1.3 - abs(d), 0.0, 1.0));
    gl_FragColor = vec4(col.rgb, col.a * uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/**
 * THE HIT FLASH, live: the glass TEARS — the fighter's colour washes the
 * pane, a few scan rows glitch bright, the edge flares white on a cyan /
 * magenta chromatic split and a glow in the fighter's colour spills off
 * the rim — then all of it settles. Only drawn while a flash is up.
 */
const RIM_FRAG = /* glsl */ `
  uniform vec2 uSize, uGlass;
  uniform float uRadius, uFlash, uAlpha, uTime;
  uniform vec3 uColor;
  varying vec2 vUv;
  ${SDF_GLSL}
  float hash(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec2 px = (vUv - 0.5) * uSize;
    vec2 hg = uGlass * 0.5;
    float d = sdRound(px, hg, uRadius);
    float inside = clamp(0.5 - d, 0.0, 1.0);
    vec4 col = over(vec4(0.0), uColor, 0.10 * uFlash * inside);
    // Glitch rows: a few scan bands tear bright, reshuffled 24 times a second.
    float tear = step(0.84, hash(floor(px.y / 9.0) * 7.13 + floor(uTime * 24.0)));
    col = over(col, vec3(1.0), 0.16 * uFlash * tear * inside);
    float halo = d > 0.0 ? exp(-d / 4.0) : exp(d / 16.0) * 0.5;
    col = over(col, uColor, 0.8 * uFlash * halo);
    // The chromatic split: the edge doubled in cyan and magenta, then white.
    float w = 1.0 + 2.0 * uFlash;
    float off = 6.0 * uFlash;
    float dc = sdRound(px + vec2(off, 0.0), hg, uRadius);
    float dm = sdRound(px - vec2(off, 0.0), hg, uRadius);
    col = over(col, vec3(0.25, 0.95, 1.0), 0.7 * uFlash * clamp(w - abs(dc), 0.0, 1.0));
    col = over(col, vec3(1.0, 0.24, 0.65), 0.7 * uFlash * clamp(w - abs(dm), 0.0, 1.0));
    col = over(col, vec3(1.0), 0.75 * uFlash * clamp(w - abs(d), 0.0, 1.0));
    gl_FragColor = vec4(col.rgb, col.a * uAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

interface CardFx {
  bar: Mesh;
  barMat: ShaderMaterial;
  rim: Mesh;
  rimMat: ShaderMaterial;
}

/** Hang the live bar + flash over a card board (sized to its plane). */
function addCardFx(board: Board, wMeters: number, hMeters: number): void {
  const sx = wMeters / W;
  const sy = hMeters / H;
  const barMat = new ShaderMaterial({
    uniforms: {
      uSize: { value: [BAR.w, BAR.h] },
      uPad: { value: BAR_PAD },
      uFrac: { value: 1 },
      uTrail: { value: 1 },
      uFlash: { value: 0 },
      uAlpha: { value: 1 },
      uLow: { value: 0 },
      uTime: { value: 0 },
      uColor: { value: new Color() },
      uDanger: { value: new Color(KIT.danger) },
    },
    vertexShader: UV_VERT,
    fragmentShader: BAR_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const bar = new Mesh(new PlaneGeometry((BAR.w + 2 * BAR_PAD) * sx, (BAR.h + 2 * BAR_PAD) * sy), barMat);
  bar.position.set((BAR.x + BAR.w / 2 - W / 2) * sx, (H / 2 - (BAR.y + BAR.h / 2)) * sy, 0.002);
  bar.renderOrder = 1;
  const rimMat = new ShaderMaterial({
    uniforms: {
      uSize: { value: [W, H] },
      uGlass: { value: [GLASS.w, GLASS.h] },
      uRadius: { value: GLASS.r },
      uFlash: { value: 0 },
      uAlpha: { value: 1 },
      uTime: { value: 0 },
      uColor: { value: new Color() },
    },
    vertexShader: UV_VERT,
    fragmentShader: RIM_FRAG,
    transparent: true,
    depthWrite: false,
  });
  const rim = new Mesh(new PlaneGeometry(wMeters, hMeters), rimMat);
  rim.position.z = 0.003;
  rim.renderOrder = 2;
  rim.visible = false;
  board.mesh.add(bar, rim);
  board.fx = { bar, barMat, rim, rimMat };
}

/** Drive a card's live overlays for this frame. */
function setCardFx(fx: CardFx, neon: string, frac: number, trail: number, flash: number, low: boolean, dim: boolean, now: number): void {
  const alpha = dim ? 0.5 : 1;
  // Seconds, wrapped so a long session never costs the shader precision.
  const time = (now / 1000) % 1000;
  const b = fx.barMat.uniforms;
  b.uFrac.value = Math.max(0, frac);
  b.uTrail.value = Math.max(frac, trail);
  b.uFlash.value = flash;
  b.uLow.value = low ? 1 : 0;
  b.uAlpha.value = alpha;
  b.uTime.value = time;
  (b.uColor.value as Color).set(neon);
  fx.bar.visible = true;
  fx.rim.visible = flash > 0.002;
  if (fx.rim.visible) {
    const r = fx.rimMat.uniforms;
    r.uFlash.value = flash;
    r.uAlpha.value = alpha;
    r.uTime.value = time;
    (r.uColor.value as Color).set(neon);
  }
}

/** Hide a card's overlays (the card is showing something that isn't a fighter). */
function hideCardFx(fx: CardFx | undefined): void {
  if (!fx) return;
  fx.bar.visible = false;
  fx.rim.visible = false;
}

function makeBoard(wMeters: number, hMeters: number, cw = W, ch = H, srgb = true): Board {
  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d')!;
  ctx.textBaseline = 'middle';
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  // Painted in sRGB, like the menu's panels — untagged, the glass came out
  // a washed grey-brown instead of the kit's near-black.
  if (srgb) tex.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(
    new PlaneGeometry(wMeters, hMeters),
    new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
  );
  return { mesh, ctx, tex, w: cw, h: ch };
}

/** Draw an art plate centred on the centre board, sized so its VISIBLE glyph
 *  (not the padded frame) is `targetH` tall — but never larger than the board's
 *  safe area, so the whole glyph always stays on screen (nothing chopped). */
function drawContentPlate(ctx: CanvasRenderingContext2D, img: HTMLImageElement, targetH: number): void {
  drawPlateArt(ctx, img, W, H, targetH, PLATE_MARGIN);
}

function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function verdictAccent(message: string): string {
  if (message.includes('LOSE') || message === 'LOSS' || message === "KO'D") return KIT.danger;
  // Match the neon plate art: the countdown digits 3 & 2 glow cyan, 1 glows
  // red (like FIGHT); the verdict plates (KO / TIME / DRAW) and the glitch
  // WIN are cyan neon, so their auras sit under them cleanly.
  if (message === '3' || message === '2') return KIT.accent;
  if (message === '1' || message === 'FIGHT') return KIT.danger;
  if (message === 'KO' || message === 'WIN' || message === 'YOU WIN' || message === 'TIME' || message === 'DRAW')
    return KIT.accent;
  return HOT;
}

/** Soft additive aura that sits behind the verdict and pulses with it. A
 *  radial-gradient sprite — animated purely by transform/opacity/colour, so it
 *  never costs a canvas redraw. */
function makeVerdictGlow(): Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const g = canvas.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.32)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new CanvasTexture(canvas);
  tex.minFilter = LinearFilter;
  const mesh = new Mesh(
    new PlaneGeometry(3.0, 1.7),
    new MeshBasicMaterial({
      map: tex,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      opacity: 0,
    }),
  );
  mesh.visible = false;
  return mesh;
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;

/* ── the card ─────────────────────────────────────────────────────────── */

/** Largest px (≤ max, ≥ min) at which `text` fits `maxW` in this weight. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number, max: number, min: number, weight: 500 | 600 | 700, track = 0): number {
  for (let px = max; px > min; px -= 2) {
    ctx.font = font(weight, px);
    ctx.letterSpacing = `${track}px`;
    if (ctx.measureText(text).width <= maxW) return px;
  }
  return min;
}

/** Tracked text (the menu sets hierarchy with weight and letter-spacing). */
function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, weight: 500 | 600 | 700, px: number, colour: string, track = 0, align: CanvasTextAlign = 'left'): void {
  ctx.font = font(weight, px);
  ctx.letterSpacing = `${track}px`;
  ctx.textAlign = align;
  ctx.fillStyle = colour;
  ctx.fillText(text, x, y);
  ctx.letterSpacing = '0px';
}

/** THE CARD'S GLASS — the kit's holo pane with its edge tube, light bar
 *  and rail burning in the fighter's colour. (A hit's flash rides the
 *  card's live overlay, not the canvas.) */
function cardGlass(ctx: CanvasRenderingContext2D, neon: string, dim: boolean): void {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (dim) ctx.globalAlpha = 0.5;
  holoGlass(ctx, GLASS.x, GLASS.y, GLASS.w, GLASS.h, { r: GLASS.r, edge: rgbOf(neon), fill: KIT.panel, arm: 26, ticks: false });
  // The RAIL: a lit tube down the left edge, clear of the corner brackets.
  ctx.fillStyle = neon;
  ctx.shadowColor = neon;
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.roundRect(26, 76, 6, H - 152, 3);
  ctx.fill();
  ctx.restore();
}

/** Rounds held: a row of skewed cells, lit in the team colour per round taken. */
function scorePips(ctx: CanvasRenderingContext2D, x: number, y: number, won: number, target: number, color: string): void {
  for (let i = 0; i < target; i++) neonCell(ctx, x + i * 66, y - 12, 54, 24, i < won, color);
}

/** The small holo pill the clock sits in (between the two cards). */
function clockGlass(ctx: CanvasRenderingContext2D, w: number, edge: string): void {
  holoGlass(ctx, 56, 34, w - 112, 136, { r: 20, edge: rgbOf(edge), fill: KIT.panel, arm: 16, ticks: false, inner: false, bloom: 0.7 });
}

/* ── the board ────────────────────────────────────────────────────────── */

export function createScoreboard(scene: Scene): Scoreboard {
  const group = new Group();
  group.name = 'scoreboards';

  // The classic pair hangs side by side behind/above the rival's pad,
  // barely angled inward — read your card and theirs without turning.
  const BOARD_Y = 2.18; // lifted clear of the far platform's sight line
  const BOARD_Z = -ARENA_GAP - 1.1;
  const CARD_W = 1.5;
  const CARD_H = 0.72;
  const card = (w: number, h: number): Board => {
    const b = makeBoard(w, h);
    addCardFx(b, w, h);
    return b;
  };
  const left = card(CARD_W, CARD_H); // YOU — ember
  left.mesh.position.set(-1.0, BOARD_Y, BOARD_Z);
  left.mesh.rotation.y = 0.18;
  const right = card(CARD_W, CARD_H); // primary opponent — blue
  right.mesh.position.set(1.0, BOARD_Y, BOARD_Z);
  right.mesh.rotation.y = -0.18;

  // The columns: a teammate above your card, extra opponents above theirs.
  // A card's readout runs the FULL height of its plate — name and health at
  // the top, bar and pips below — so the step has to clear the whole card,
  // not just its margin. (It used to be 0.56 against a 0.72 card: the upper
  // card's rim cut straight through the lower one's name and number.)
  const extraLeft = card(CARD_W, CARD_H);
  extraLeft.mesh.rotation.y = 0.18;
  const extraRightA = card(CARD_W, CARD_H);
  extraRightA.mesh.rotation.y = -0.18;
  const extraRightB = card(CARD_W, CARD_H);
  extraRightB.mesh.rotation.y = -0.18;

  // FFA: PAD CARDS for the fighters on the flanking pads, hung over their
  // own platforms and turned to face you (placed per bout from the layout).
  const padCards = [card(1.2, 0.58), card(1.2, 0.58)];
  const extras = [extraLeft, extraRightA, extraRightB, ...padCards];
  for (const e of extras) e.mesh.visible = false;

  // THE ROUND PLAQUE — round, first-to, and the clock, floating in the slot
  // between the two cards.
  const plaque = makeBoard(0.62, 0.36, 352, 204);
  plaque.mesh.position.set(0, BOARD_Y + 0.14, BOARD_Z);

  // FFA STANDINGS — a strip over the plaque ranking the four (hidden while
  // a verdict is up: the verdict owns that air).
  const standings = makeBoard(1.56, 0.53, 704, 240);
  standings.mesh.position.set(0, BOARD_Y + 0.66, BOARD_Z);
  standings.mesh.visible = false;

  // Headline strip (KO, YOU WIN...) floating just above the boards.
  // Sized to the canvas aspect so the stencil type renders undistorted.
  // (The verdict board keeps its old untagged texture: its art plates were
  // tuned against it.)
  const centre = makeBoard(2.2, 1.05, W, H, false);
  const CENTRE_Y = 3.06;
  const CENTRE_Z = -ARENA_GAP - 1.15;
  centre.mesh.position.set(0, CENTRE_Y, CENTRE_Z);
  centre.mesh.renderOrder = 12;

  // The accent aura behind the verdict.
  const glow = makeVerdictGlow();
  glow.position.set(0, CENTRE_Y, CENTRE_Z - 0.04);
  glow.renderOrder = 11;
  const glowColor = new Color();

  /**
   * THE HANG — where everything sits, in one of two shapes.
   *
   * CLASSIC (1v1, FFA) is the pair at full size with the verdict just over
   * them. STACKED (2v2, or any bout that puts two cards in a column) shrinks
   * the cards, drops the row a little and steps the column by a clear card
   * height, then lifts the verdict above the top card — so nothing in the
   * bout is read through anything else.
   */
  interface Hang {
    /** The lower row's height. */
    y: number;
    /** Rise from one card in a column to the next. */
    step: number;
    cardScale: number;
    centreY: number;
    centreScale: number;
  }
  const HANG: Record<'classic' | 'stacked', Hang> = {
    classic: { y: BOARD_Y, step: 0.62, cardScale: 1, centreY: CENTRE_Y, centreScale: 1 },
    stacked: { y: 2.04, step: 0.63, cardScale: 0.8, centreY: 3.5, centreScale: 0.8 },
  };
  let hang: Hang = HANG.classic;
  let hangKey = '';
  /** Re-hang the boards (a no-op unless the shape actually changed). */
  const setHang = (stacked: boolean): void => {
    const key = stacked ? 'stacked' : 'classic';
    if (key === hangKey) return;
    hangKey = key;
    hang = stacked ? HANG.stacked : HANG.classic;
    const { y, step, cardScale } = hang;
    for (const [b, sign, row] of [
      [left, -1, 0],
      [right, 1, 0],
      [extraLeft, -1, 1],
      [extraRightA, 1, 1],
      [extraRightB, 1, 2],
    ] as const) {
      b.mesh.position.set(sign * 1.0, y + row * step, BOARD_Z);
      b.mesh.scale.setScalar(cardScale);
    }
    plaque.mesh.position.set(0, y + 0.14, BOARD_Z);
    standings.mesh.position.set(0, y + 0.66, BOARD_Z);
    centre.mesh.position.y = hang.centreY;
    glow.position.y = hang.centreY;
  };
  setHang(false);

  group.add(
    left.mesh,
    right.mesh,
    extraLeft.mesh,
    extraRightA.mesh,
    extraRightB.mesh,
    padCards[0].mesh,
    padCards[1].mesh,
    plaque.mesh,
    standings.mesh,
    glow,
    centre.mesh,
  );
  scene.add(group);

  const motion = new Map<number, CardMotion>();
  let lastReset = -1;

  /** Advance a fighter's trail and flash (live: they drive uniforms, not the canvas). */
  const advance = (f: FighterHud, now: number): { trail: number; flash: number } => {
    let m = motion.get(f.slot);
    if (!m) {
      m = { hp: f.hpFrac, trail: f.hpFrac, hitAt: -10, seen: now };
      motion.set(f.slot, m);
    }
    const dt = Math.min(0.1, Math.max(0, (now - m.seen) / 1000));
    m.seen = now;
    if (f.hpFrac < m.hp - 0.001) {
      m.hitAt = now;
      // The trail waits at the old level; a second hit inside the hold keeps
      // the higher of the two so the whole loss stays on show.
      m.trail = Math.max(m.trail, m.hp);
    } else if (f.hpFrac > m.hp + 0.001) {
      m.trail = f.hpFrac; // healed / refilled: nothing to mourn
    }
    m.hp = f.hpFrac;
    if (m.trail > f.hpFrac && now - m.hitAt > TRAIL_HOLD * 1000) {
      m.trail = Math.max(f.hpFrac, m.trail - TRAIL_RATE * dt);
    }
    // Unquantised: these drive the live overlay's uniforms, never the canvas.
    const flash = Math.max(0, 1 - (now - m.hitAt) / (FLASH_SECONDS * 1000));
    return { trail: m.trail, flash: flash * flash };
  };

  // --- verdict animation (transform/opacity only — no canvas redraws) -------
  let verdictMsg = '';
  let verdictStart = 0;
  const glowMat = glow.material as MeshBasicMaterial;

  const animateVerdict = (message: string): void => {
    const now = performance.now();
    if (message !== verdictMsg) {
      verdictMsg = message;
      verdictStart = now;
    }
    if (!message) {
      centre.mesh.scale.setScalar(hang.centreScale);
      centre.mesh.position.y = hang.centreY;
      glow.visible = false;
      return;
    }
    const t = (now - verdictStart) / 1000;
    // Slam in: a quick overshoot that springs to rest, then a slow breathe.
    const spring = 1 + 0.6 * Math.exp(-t * 8) * Math.cos(t * 17);
    const breathe = 1 + 0.02 * Math.sin(now * 0.0042);
    centre.mesh.scale.setScalar(Math.max(0.25, spring * breathe * hang.centreScale));
    centre.mesh.position.y = hang.centreY + 0.012 * Math.sin(now * 0.0032);

    // Aura: a bright impact flash on arrival decaying into a steady pulse.
    glow.visible = true;
    glowColor.set(verdictAccent(message));
    glowMat.color.copy(glowColor);
    const intro = easeOutCubic(Math.min(1, t / 0.25));
    const flash = 0.55 * Math.exp(-t * 5);
    const pulse = 0.26 + 0.12 * Math.sin(now * 0.005);
    glowMat.opacity = Math.min(0.95, intro * pulse + flash);
    glow.scale.setScalar(spring * (1 + 0.18 * Math.exp(-t * 6) + 0.05 * Math.sin(now * 0.005)));
  };

  /** THE ROUND PLAQUE. */
  const drawPlaque = (state: MatchState, now: number): void => {
    const secs = Math.max(0, Math.ceil(state.roundTimer));
    const live = state.phase === 'playing';
    const hot = live && secs <= CLOCK_HOT;
    const warn = live && secs <= CLOCK_WARN;
    const text = state.phase === 'countdown' ? 'READY' : fmtTime(state.roundTimer);
    const key = `p|${text}|${state.round}|${hot ? 'h' : warn ? 'w' : ''}|${fontsReady() ? 1 : 0}`;
    // The hot clock's pulse rides the mesh, not the canvas.
    plaque.mesh.scale.setScalar(hot ? 1 + 0.05 * Math.sin(now * 0.012) : 1);
    if (plaque.key === key) return;
    plaque.key = key;
    const { ctx, tex, w, h } = plaque;
    ctx.clearRect(0, 0, w, h);
    ctx.textBaseline = 'middle';
    // The clock in a small holo pill, its tube cyan, then amber and red as
    // the round runs out; the round it belongs to tagged above the digits.
    // Sized to the gap between the two cards (the board is 0.62 m; the
    // gap ~0.5 m), so the pill never laps a card's edge.
    const colour = hot ? KIT.danger : warn ? KIT.warn : KIT.accent;
    clockGlass(ctx, w, colour);
    label(ctx, `ROUND ${state.round}`, w / 2, 68, 600, 20, KIT.faint, 5, 'center');
    ctx.shadowColor = colour;
    ctx.shadowBlur = 16;
    const px = text === 'READY' ? 44 : 76;
    label(ctx, text, w / 2, 116, 700, px, live && (hot || warn) ? colour : KIT.text, text === 'READY' ? 6 : 2, 'center');
    ctx.shadowBlur = 0;
    tex.needsUpdate = true;
  };

  /** THE CARD — one fighter. */
  const drawCard = (board: Board, f: FighterHud, target: number, now: number, teamTotal?: string, tagAs?: string): void => {
    const { trail, flash } = advance(f, now);
    const low = f.alive && f.hpFrac < LOW_HP && f.hpFrac > 0;
    const dim = !f.alive;
    const hp = Math.max(0, Math.round(f.hp));
    // The bar, its trail and the hit flash are live — uniforms, every frame.
    if (board.fx) setCardFx(board.fx, f.neon, f.hpFrac, trail, flash, low, dim, now);
    // The LOW label breathes at ~1 Hz, quantised to four steps a beat.
    const lowPhase = low ? Math.round((0.5 + 0.5 * Math.sin(now * 0.0063)) * 3) / 3 : 0;
    // Who this is to you: the tag rides the card's own tube colour.
    const tag = tagAs ?? (f.slot === 0 ? 'YOU' : f.team === 0 ? 'ALLY' : 'RIVAL');
    const key = `c|${f.name}|${f.neon}|${tag}|${hp}|${f.pips}|${target}|${f.alive ? 1 : 0}|${low ? 1 : 0}|${lowPhase}|${teamTotal ?? ''}|${fontsReady() ? 1 : 0}`;
    if (board.key === key) return;
    board.key = key;
    const { ctx, tex } = board;
    cardGlass(ctx, f.neon, dim);
    ctx.save();
    if (dim) ctx.globalAlpha = 0.5;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = f.neon;
    ctx.shadowBlur = 10;
    label(ctx, tag, 64, 64, 700, 22, f.neon, 7);
    // The callsign, left; the health number, right — white, red when LOW —
    // each lit by a breath of the fighter's colour.
    const namePx = fitText(ctx, f.name, W - 420, 56, 30, 600, 2);
    ctx.shadowBlur = 12;
    label(ctx, f.name, 64, 120, 600, namePx, KIT.text, 2);
    const hpInk = low ? KIT.danger : KIT.text;
    ctx.shadowColor = low ? KIT.danger : f.neon;
    ctx.shadowBlur = 18;
    label(ctx, String(hp), W - 64, 108, 700, 104, hpInk, 1, 'right');
    ctx.shadowBlur = 0;
    ctx.font = font(700, 104);
    ctx.letterSpacing = '1px';
    const numW = ctx.measureText(String(hp)).width;
    ctx.letterSpacing = '0px';
    label(ctx, 'HP', W - 64 - numW - 14, 130, 600, 24, KIT.faint, 4, 'right');
    // (The health bar is the live overlay, over BAR.) Readout ticks, then the rounds row.
    readoutTicks(ctx, 64, 252, W - 128, KIT.lineFaint);
    if (target > 0) {
      label(ctx, 'ROUNDS', 64, 330, 600, 24, KIT.faint, 5);
      scorePips(ctx, 210, 330, f.pips, target, f.neon);
    }
    if (!f.alive) {
      ctx.shadowColor = KIT.danger;
      ctx.shadowBlur = 12;
      label(ctx, 'OUT', W - 64, 330, 700, 36, KIT.danger, 7, 'right');
    } else if (low) {
      ctx.globalAlpha = 0.55 + 0.45 * lowPhase;
      ctx.shadowColor = KIT.danger;
      ctx.shadowBlur = 14;
      label(ctx, 'LOW', W - 64, 330, 700, 36, KIT.danger, 7, 'right');
    } else if (teamTotal) {
      label(ctx, teamTotal, W - 64, 330, 600, 28, KIT.dim, 4, 'right');
    }
    ctx.restore();
    tex.needsUpdate = true;
  };

  /** THE STANDINGS strip (FFA): everyone, ranked. */
  const drawStandings = (fighters: FighterHud[], target: number): void => {
    const ranked = fighters
      .slice()
      .sort((a, b) => b.pips - a.pips || Number(b.alive) - Number(a.alive) || b.hpFrac - a.hpFrac);
    const key = `st|${ranked.map((f) => `${f.name}:${f.pips}:${f.alive ? 1 : 0}:${Math.round(f.hpFrac * 20)}`).join(',')}|${target}|${fontsReady() ? 1 : 0}`;
    if (standings.key === key) return;
    standings.key = key;
    const { ctx, tex, w, h } = standings;
    ctx.clearRect(0, 0, w, h);
    holoGlass(ctx, 8, 8, w - 16, h - 16, { r: 20, fill: KIT.panel, arm: 16, ticks: false });
    ctx.textBaseline = 'middle';
    ctx.shadowColor = KIT.accent;
    ctx.shadowBlur = 10;
    label(ctx, 'STANDINGS', 40, 42, 700, 20, KIT.accent, 6);
    ctx.shadowBlur = 0;
    if (target > 0) label(ctx, `FIRST TO ${target}`, w - 40, 42, 600, 18, KIT.faint, 4, 'right');
    const rowH = (h - 96) / Math.max(1, ranked.length);
    ranked.forEach((f, i) => {
      const y = 66 + rowH * i + rowH / 2;
      const ink = f.alive ? KIT.text : KIT.disabled;
      label(ctx, String(i + 1).padStart(2, '0'), 44, y, 700, 24, ink, 1);
      ctx.globalAlpha = f.alive ? 1 : 0.35;
      neonCell(ctx, 76, y - 11, 16, 22, true, f.neon);
      ctx.globalAlpha = 1;
      const px = fitText(ctx, f.name, 290, 26, 18, 600, 1);
      label(ctx, f.name, 104, y, 600, px, ink, 1);
      if (!f.alive) {
        ctx.font = font(600, px);
        ctx.letterSpacing = '1px';
        const nameW = ctx.measureText(f.name).width;
        ctx.letterSpacing = '0px';
        label(ctx, 'OUT', 104 + nameW + 16, y, 700, 18, KIT.danger, 4);
      }
      for (let p = 0; p < target; p++) neonCell(ctx, 410 + p * 30, y - 6, 24, 12, p < f.pips, f.neon);
      neonBar(ctx, 520, y - 6, 150, 12, f.hpFrac, f.hpFrac < LOW_HP ? KIT.danger : f.neon, 10, 3);
    });
    tex.needsUpdate = true;
  };

  const drawCentre = (message: string, sub: string): void => {
    // Two flavours of art: the countdown plates (3/2/1/FIGHT) and the verdict
    // plates (KO/KO'D/WIN). Everything else is stencilled. "Is the art decoded
    // yet" folds into the key so the first frame after a cold load swaps the
    // text fallback out for the image.
    const cd = countdownArt(message);
    const vd = cd ? null : verdictArt(message);
    const key = `c|${message}|${sub}|${cd ? 'cd' : vd ? 'vd' : 'txt'}|${fontsReady() ? 1 : 0}`;
    if (centre.key === key) return;
    centre.key = key;
    const { ctx, tex } = centre;
    ctx.clearRect(0, 0, W, H);
    if (cd && message !== 'FIGHT') {
      // Countdown digit (3/2/1): sized by its VISIBLE glyph to a consistent
      // height so the count reads evenly, whatever padding each PNG carries.
      drawContentPlate(ctx, cd, NUMBER_PLATE_H);
    } else if (cd || vd) {
      // Word plates — FIGHT (countdown) and KNOCKOUT / WIN (verdict) — sized by
      // the VISIBLE word to a shared cap height so all three read consistently.
      drawContentPlate(ctx, (cd ?? vd) as HTMLImageElement, WORD_PLATE_H);
    } else if (message) {
      // No art plate: GLITCH type — the word in the menu's headline face,
      // white, tracked wide, lit by its accent on a cyan / magenta split.
      const accent = verdictAccent(message);
      const px = fitText(ctx, message, W - 120, message.includes('YOU') ? 120 : 150, 44, 700, 8);
      const midY = sub ? 188 : 216;
      ctx.textBaseline = 'middle';
      glitchText(ctx, message, W / 2, midY, px, accent, { track: 8 });
      if (sub) label(ctx, sub, W / 2, 304, 600, 40, KIT.dim, 5, 'center');
    }
    tex.needsUpdate = true;
  };

  /** Draw a fighter onto a board (or hide it when there's no fighter). */
  const setCard = (board: Board, f: FighterHud | undefined, target: number, now: number, teamTotal?: string): void => {
    if (!f) {
      board.mesh.visible = false;
      return;
    }
    board.mesh.visible = true;
    drawCard(board, f, target, now, teamTotal);
  };

  /** Hang a pad card over a fighter's own platform, facing me. */
  const placePadCard = (board: Board, slot: number): void => {
    const p = localLayout()[slot]?.pos;
    if (!p) return;
    board.mesh.position.set(p[0], 2.05, p[2]);
    // A plane's face is +Z; turn it to look back at the origin.
    board.mesh.rotation.y = Math.atan2(-p[0], -p[2]);
  };

  return {
    updateMatch(state, fighters) {
      const now = performance.now();
      const target = winTargetFor(app.arcade, app.quickDuel);
      // A fresh round: trails and flashes start clean.
      if (state.resetCount !== lastReset) {
        lastReset = state.resetCount;
        motion.clear();
      }
      drawPlaque(state, now);
      const you = fighters[0];
      const allies = fighters.filter((f, i) => i > 0 && f.team === 0);
      const enemies = fighters.filter((f) => f.team !== 0);
      const ffa = app.arcade === 'ffa';
      const total = (team: number): string | undefined => {
        if (app.arcade !== '2v2') return undefined;
        const mine = fighters.filter((f) => f.team === team);
        return `TEAM ${Math.max(0, Math.round(mine.reduce((s, f) => s + f.hp, 0)))}`;
      };

      // A column of two is what crowds the board: 2v2, or anything that
      // stacks. FFA never stacks — its flankers wear their own pad cards.
      setHang(!ffa && (!!allies[0] || !!enemies[1]));

      if (ffa) {
        // The north pad's fighter (across the gap, straight ahead) keeps the
        // right-hand card; the flanking pads wear their own.
        const layout = localLayout();
        const ahead = (f: FighterHud): boolean => Math.abs(layout[f.slot]?.pos[0] ?? 0) < 0.5;
        const north = enemies.find(ahead);
        const flank = enemies.filter((f) => f !== north);
        setCard(left, you, target, now);
        setCard(right, north, target, now);
        setCard(extraLeft, undefined, target, now);
        setCard(extraRightA, undefined, target, now);
        setCard(extraRightB, undefined, target, now);
        flank.slice(0, 2).forEach((f, i) => {
          placePadCard(padCards[i], f.slot);
          setCard(padCards[i], f, target, now);
        });
        for (let i = flank.length; i < 2; i++) padCards[i].mesh.visible = false;
      } else {
        // Your team (the ally in 2v2) stacks above your card; everyone else
        // (the opponents) stacks up the right column.
        setCard(left, you, target, now, total(0));
        setCard(extraLeft, allies[0], target, now);
        setCard(right, enemies[0], target, now, enemies[0] ? total(enemies[0].team) : undefined);
        setCard(extraRightA, enemies[1], target, now);
        setCard(extraRightB, enemies[2], target, now);
        for (const c of padCards) c.mesh.visible = false;
      }

      // The loser gets no verdict popup — a plain LOSS / YOU LOSE shows nothing,
      // and a knockout loss (KO'D) is suppressed the same way: only the winner
      // ever sees a verdict plate (WIN, or the dramatic KNOCKOUT). The KO'D token
      // still rides the wire so a guest who lands the KO flips it back to KO.
      // The 3-2-1-FIGHT ritual is NOT a HUD verdict any more: it plays out
      // in-world between the platforms (CountdownSystem, with this same
      // slam + glow) — showing it in both places read as clutter.
      const suppressed =
        state.message === 'LOSS' ||
        state.message === 'YOU LOSE' ||
        state.message === "KO'D" ||
        state.message === '3' ||
        state.message === '2' ||
        state.message === '1' ||
        state.message === 'FIGHT';
      const verdict = suppressed ? '' : state.message;
      drawCentre(verdict, '');
      animateVerdict(verdict);
      // FFA standings own the air over the plaque whenever the verdict doesn't.
      standings.mesh.visible = ffa && !verdict;
      if (standings.mesh.visible) drawStandings(fighters, target);
    },

    updateTraining(hp, hpMax) {
      // Aim Training uses just the two classic boards — at full size, on
      // the classic hang, whatever format the last bout left behind.
      setHang(false);
      const now = performance.now();
      left.mesh.visible = true;
      right.mesh.visible = true;
      for (const e of extras) e.mesh.visible = false;
      standings.mesh.visible = false;
      plaque.mesh.scale.setScalar(1);
      const clockKey = `t|${fmtTime(training.timeLeft)}|${fontsReady() ? 1 : 0}`;
      if (plaque.key !== clockKey) {
        plaque.key = clockKey;
        const { ctx, tex, w } = plaque;
        ctx.clearRect(0, 0, w, plaque.h);
        ctx.textBaseline = 'middle';
        clockGlass(ctx, w, KIT.accent);
        label(ctx, 'AIM', w / 2, 68, 600, 20, KIT.faint, 5, 'center');
        ctx.shadowColor = KIT.accent;
        ctx.shadowBlur = 16;
        label(ctx, fmtTime(training.timeLeft), w / 2, 116, 700, 76, KIT.text, 2, 'center');
        ctx.shadowBlur = 0;
        tex.needsUpdate = true;
      }
      // Left card: score + streak — no health on it.
      hideCardFx(left.fx);
      const best = Math.max(app.stats.trainingBest, training.score);
      const key = `t|${training.score}|${training.streak}|${best}|${fontsReady() ? 1 : 0}`;
      if (left.key !== key) {
        left.key = key;
        const { ctx, tex } = left;
        cardGlass(ctx, UI.emberBright, false);
        ctx.textBaseline = 'middle';
        ctx.shadowColor = UI.emberBright;
        ctx.shadowBlur = 10;
        label(ctx, 'AIM TRAINING', 64, 64, 700, 22, UI.emberBright, 7);
        ctx.shadowBlur = 18;
        label(ctx, String(training.score), 64, 170, 700, 124, KIT.text, 2);
        ctx.shadowBlur = 0;
        readoutTicks(ctx, 64, 252, W - 128, KIT.lineFaint);
        ctx.shadowColor = KIT.accent;
        ctx.shadowBlur = 10;
        label(ctx, `STREAK ×${training.streak}`, 64, 330, 600, 30, KIT.accent, 4);
        ctx.shadowBlur = 0;
        label(ctx, `BEST ${best}`, W - 64, 330, 600, 30, KIT.dim, 4, 'right');
        tex.needsUpdate = true;
      }
      // Right card: dodge readout (health only matters with shoot-back on).
      const frac = app.shootBack ? hp / hpMax : 1;
      drawCard(right, { slot: 1, name: 'DODGE', neon: UI.cool, hpFrac: frac, hp: app.shootBack ? hp : hpMax, pips: 0, team: 1, alive: true }, 0, now, undefined, 'DRILL');
      drawCentre('', '');
      animateVerdict('');
    },

    setVisible(v) {
      group.visible = v;
    },
  };
}
