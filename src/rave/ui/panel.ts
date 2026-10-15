/**
 * Canvas panel kit — the menu surface language, raycast by the controller
 * lasers. One canvas per panel, and a hit-test maps a ray intersection's
 * UV back to the button under it.
 *
 * THE LOOK (the live-service discipline): quiet near-black glass, white-alpha
 * hairlines, and ONE accent that only marks what matters — the primary CTA,
 * the selected state, the active tab. Semantic colour lives in text and
 * status dots, never in button chrome. Glow is a budget, not a default:
 * the CTA and the under-halo carry it, everything else is matte. Weight and
 * tracking do the hierarchy work (see ui/fonts.ts).
 *
 * THE MOTION (why this class owns a tick): state changes ease instead of
 * snapping — hover in ~100 ms, out ~180 ms, a press flash decaying over
 * ~150 ms, open/close as a 4% scale + fade at the MESH level. Canvas
 * repaints (a full texture upload) happen only while one of those brief
 * transitions is actually running; at rest the texture is static and the
 * only living thing is the under-halo's opacity leaning into the beat —
 * material-level, upload-free.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { font, onFontsReady } from './fonts.js';

export interface PanelButton {
  id: string;
  label: string;
  sub?: string;
  disabled?: boolean;
  /** Canvas-space rect. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Smaller type for dense rows. */
  small?: boolean;
  /** Hit-testable but NOT drawn — the body paints its own visual (map
   *  nodes, custom widgets); label/sub are ignored. */
  ghost?: boolean;
  /** THE primary CTA — the one solid accent fill its screen is allowed. */
  primary?: boolean;
  /** Persistent selected state: accent edge-tick + accent hairline. */
  selected?: boolean;
  /** Semantic tint for the LABEL text only (danger/info/warn/positive) —
   *  the plate itself stays neutral. */
  tone?: string;
  /** A live value chip: not clickable, but styled as data, not as a dead
   *  button (the old `disabled` grey read as "broken"). */
  display?: boolean;
  /** Explicit label px when the two standard sizes don't fit (code slots). */
  px?: number;
}

export const UI = {
  /* Surfaces */
  panel: 'rgba(10,8,18,0.92)',
  well: 'rgba(0,0,0,0.32)',
  plate: 'rgba(255,255,255,0.045)',
  plateHover: 'rgba(255,255,255,0.09)',
  /* Hairlines */
  line: 'rgba(255,255,255,0.14)',
  lineHover: 'rgba(255,255,255,0.34)',
  lineFaint: 'rgba(255,255,255,0.10)',
  /* Text. The whites are WHITE — #f2f3f7 is a blue-grey that reads as
   *  dirty on a black panel, and the tiers under it were set at web
   *  contrast ratios. A headset panel is a small emissive rectangle in a
   *  dark room, not a page in an office: every tier here is a step
   *  brighter than its web equivalent, or the secondary type reads as
   *  disabled and the disabled type reads as absent. */
  text: '#ffffff',
  textHi: '#ffffff',
  dim: 'rgba(240,243,250,0.74)',
  faint: 'rgba(240,243,250,0.52)',
  disabled: 'rgba(240,243,250,0.36)',
  /* The accent — identity, selection, primacy. Nothing else. */
  accent: '#ff2ad5',
  accentDim: 'rgba(255,42,213,0.55)',
  accentFaint: 'rgba(255,42,213,0.10)',
  onAccent: '#16040f',
  /* Semantic roles (text + dots, never chrome) */
  positive: '#2be28a',
  info: '#6fc8ff',
  warn: '#ffb454',
  danger: '#ff5266',
};

/**
 * THE CYBER SKIN — the RAVE RAID board's dress (opt-in per panel; the club
 * consoles keep the glass). Same roles as UI, a different street: plates
 * are CUT, not rounded (a 45° chamfer on two opposite corners), the chrome
 * runs on a cold cyan hairline so the magenta accent still means "this one",
 * and the glass carries a fine scanline + grid weave baked into one pattern.
 * The one moving thing beyond the halo is a scan sweep — a separate additive
 * strip whose y slides down the board, so it costs no canvas upload either.
 */
export const CYBER = {
  panel: 'rgba(6,5,16,0.94)',
  cyan: '#00f0ff',
  cyanDim: 'rgba(0,240,255,0.55)',
  cyanLine: 'rgba(0,240,255,0.28)',
  cyanFaint: 'rgba(0,240,255,0.10)',
  /* Acid yellow: hazard marks only — never a label colour of its own. */
  hazard: '#fcee0a',
  /* The chamfer sizes: board frame, standard plate, small plate. */
  cutFrame: 34,
  cut: 14,
  cutSmall: 9,
};

/**
 * Trace a chamfered rect into the current path (begins a new path). `c` is
 * the cut; `all` cuts every corner, otherwise only top-left + bottom-right
 * (the house silhouette — it reads as a direction, a blade, not a box).
 */
export function chamfer(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  c: number,
  all = false,
): void {
  const k = Math.max(0, Math.min(c, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y);
  if (all) {
    g.lineTo(x + w - k, y);
    g.lineTo(x + w, y + k);
  } else g.lineTo(x + w, y);
  g.lineTo(x + w, y + h - k);
  g.lineTo(x + w - k, y + h);
  if (all) {
    g.lineTo(x + k, y + h);
    g.lineTo(x, y + h - k);
  } else g.lineTo(x, y + h);
  g.lineTo(x, y + k);
  g.closePath();
}

/** A row of hazard slashes inside (x, y, w, h) — the CTA's tail mark and the
 *  header's warning strip. Clipped to the box, so the slashes never spill. */
export function hazardStripes(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  pitch = 14,
): void {
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = color;
  for (let sx = x - h; sx < x + w; sx += pitch) {
    g.beginPath();
    g.moveTo(sx, y + h);
    g.lineTo(sx + pitch * 0.5, y + h);
    g.lineTo(sx + pitch * 0.5 + h, y);
    g.lineTo(sx + h, y);
    g.closePath();
    g.fill();
  }
  g.restore();
}

export type PanelSkin = 'glass' | 'cyber';

/* ── motion (research-tuned: M3/Carbon durations, VR-safe amplitudes) ── */
const HOVER_IN_S = 0.1;
const HOVER_OUT_S = 0.18;
const FLASH_S = 0.15;
const OPEN_S = 0.26;
const CLOSE_S = 0.16;
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeOutQuint = (t: number): number => 1 - (1 - t) ** 5;
const easeInQuad = (t: number): number => t * t;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

/** One shared soft-halo texture: a blurred rounded block, tinted per panel
 *  by material colour, opacity animated per frame (never re-uploaded). */
let haloTex: CanvasTexture | null = null;
function halo(): CanvasTexture {
  if (haloTex) return haloTex;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d')!;
  g.shadowColor = 'rgba(255,255,255,1)';
  g.shadowBlur = 46;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.beginPath();
  g.roundRect(58, 58, 140, 140, 26);
  g.fill();
  haloTex = new CanvasTexture(c);
  haloTex.colorSpace = SRGBColorSpace;
  return haloTex;
}

/** The cyber glass weave: 2px scanlines every 4px and a faint 48px grid,
 *  baked once into a pattern tile and shared by every cyber panel. */
let weaveTile: HTMLCanvasElement | null = null;
function weave(): HTMLCanvasElement {
  if (weaveTile) return weaveTile;
  const c = document.createElement('canvas');
  c.width = 48;
  c.height = 48;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < 48; y += 4) g.fillRect(0, y, 48, 2);
  g.fillStyle = 'rgba(0,240,255,0.035)';
  g.fillRect(0, 0, 48, 1);
  g.fillRect(0, 0, 1, 48);
  weaveTile = c;
  return c;
}

/** The scan sweep's strip: a soft cyan band with a bright leading edge,
 *  tinted by material colour like the halo. */
let sweepTex: CanvasTexture | null = null;
function sweep(): CanvasTexture {
  if (sweepTex) return sweepTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.8, 'rgba(255,255,255,0.35)');
  grad.addColorStop(0.97, 'rgba(255,255,255,1)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  sweepTex = new CanvasTexture(c);
  sweepTex.colorSpace = SRGBColorSpace;
  return sweepTex;
}

/** One pass of the sweep, top to bottom, then a rest before the next. */
const SWEEP_PERIOD_S = 7;
const SWEEP_RUN_S = 2.6;

export class Panel {
  readonly group = new Group();
  readonly mesh: Mesh;
  private mat: MeshBasicMaterial;
  private glowMat: MeshBasicMaterial;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private buttons: PanelButton[] = [];
  private pxW: number;
  private pxH: number;
  readonly skin: PanelSkin;
  private sweepMesh: Mesh | null = null;
  private sweepMat: MeshBasicMaterial | null = null;
  private sweepT = 0;
  private heightM: number;

  /* Stored paint args, so transitions can repaint without the caller. */
  private title = '';
  private body: ((g: CanvasRenderingContext2D) => void) | null = null;
  private hover: string | null = null;

  /* Transition state. */
  private hoverAmt = new Map<string, number>();
  private flashId: string | null = null;
  private flashAmt = 0;
  private shown = true;
  private showP = 1;
  private animating = false;

  constructor(widthM: number, heightM: number, pxW = 1024, pxH = 1024, skin: PanelSkin = 'glass') {
    this.skin = skin;
    this.heightM = heightM;
    this.pxW = pxW;
    this.pxH = pxH;
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.tex = new CanvasTexture(this.canvas);
    // Painted colours must survive to the eye: without the sRGB tag the
    // renderer re-encodes linear reads and every dark washes out.
    this.tex.colorSpace = SRGBColorSpace;
    this.mat = new MeshBasicMaterial({
      map: this.tex,
      transparent: true,
      side: DoubleSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new PlaneGeometry(widthM, heightM), this.mat);
    // Menus must win the draw fight against the (transparent, depth-less)
    // gel creature behind them.
    this.mesh.renderOrder = 30;
    this.group.add(this.mesh);

    // The under-halo: the panel's presence in a dark room, and the one
    // element allowed to lean into the beat (opacity only — no upload).
    this.glowMat = new MeshBasicMaterial({
      map: halo(),
      transparent: true,
      opacity: 0.12,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
      color: 0xff2ad5,
    });
    const glow = new Mesh(new PlaneGeometry(widthM * 1.42, heightM * 1.56), this.glowMat);
    glow.renderOrder = 29;
    glow.position.z = -0.005;
    this.group.add(glow);

    // The cyber skin's scan sweep: a thin additive strip riding just in
    // front of the glass, its y animated in tick() — material-level motion,
    // like the halo, so the canvas stays untouched at rest.
    if (skin === 'cyber') {
      this.sweepMat = new MeshBasicMaterial({
        map: sweep(),
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        depthWrite: false,
        blending: AdditiveBlending,
        color: 0x00f0ff,
      });
      this.sweepMesh = new Mesh(new PlaneGeometry(widthM * 0.985, heightM * 0.09), this.sweepMat);
      this.sweepMesh.renderOrder = 31;
      this.sweepMesh.position.z = 0.002;
      this.group.add(this.sweepMesh);
    }

    // First paint may land before the woff2s do — repaint on arrival.
    onFontsReady(() => {
      if (this.body || this.buttons.length) this.draw();
    });
  }

  ctx(): CanvasRenderingContext2D {
    return this.canvas.getContext('2d')!;
  }

  /** The ids currently painted on this panel — headless probes read it to
   *  ask what a card is offering without matching pixels. */
  buttonIds(): string[] {
    return this.buttons.map((b) => b.id);
  }

  /** Repaint: frame + title, then the caller's body, then the button set.
   *  Also the hover hand-off: eased highlights start/retarget here. */
  paint(
    title: string,
    body: (g: CanvasRenderingContext2D) => void,
    buttons: PanelButton[],
    hover: string | null,
  ): void {
    this.title = title;
    this.body = body;
    this.buttons = buttons;
    this.hover = hover;
    this.animating = true; // hover targets may have moved — let tick settle it
    this.draw();
  }

  /** Press feedback: a bright flash on `id`, decaying over ~150 ms. */
  press(id: string): void {
    this.flashId = id;
    this.flashAmt = 1;
    this.animating = true;
  }

  /** Open/close with the mesh-level fade+scale (canvas untouched).
   *  `snap` skips the transition (first-frame setup). */
  setShown(on: boolean, snap = false): void {
    if (this.shown === on && !snap) return;
    this.shown = on;
    if (snap) this.showP = on ? 1 : 0;
    this.applyShow();
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** Eased hover amount (0..1) for a button — bodies that paint their own
   *  widgets (the rail, the map nodes) read this so THEIR highlights ease
   *  on the same clock as the kit's. */
  hoverOf(id: string): number {
    return this.hoverAmt.get(id) ?? 0;
  }

  /** Advance transitions. `pulse` is the beat envelope (0..1) for the
   *  under-halo; call every frame — it's a no-op unless something moves. */
  tick(delta: number, pulse = 0): void {
    // Open/close.
    const dir = this.shown ? 1 : -1;
    const dur = this.shown ? OPEN_S : CLOSE_S;
    const p0 = this.showP;
    this.showP = clamp01(this.showP + (dir * delta) / dur);
    if (this.showP !== p0) this.applyShow();

    // The halo breathes with the room whenever the panel is up.
    const op = easeOutCubic(clamp01(this.showP / 0.7));
    this.glowMat.opacity = (0.15 + 0.07 * pulse) * op;
    if (this.sweepMesh && this.sweepMat) {
      this.sweepT = (this.sweepT + delta) % SWEEP_PERIOD_S;
      const run = this.sweepT / SWEEP_RUN_S;
      if (run < 1) {
        const h = this.heightM;
        this.sweepMesh.position.y = h * 0.45 - run * h * 0.9;
        // Fade in off the top edge and out before the bottom one.
        this.sweepMat.opacity = 0.11 * Math.sin(run * Math.PI) * op;
      } else this.sweepMat.opacity = 0;
    }

    if (!this.animating) return;

    // Hover eases + press flash decay → transient canvas repaints.
    let live = false;
    for (const b of this.buttons) {
      const want = this.hover === b.id && !b.disabled && !b.display ? 1 : 0;
      const at = this.hoverAmt.get(b.id) ?? 0;
      if (at === want) continue;
      const rate = want > at ? delta / HOVER_IN_S : delta / HOVER_OUT_S;
      const next = at < want ? Math.min(want, at + rate) : Math.max(want, at - rate);
      this.hoverAmt.set(b.id, next);
      if (next !== want) live = true;
    }
    if (this.flashAmt > 0) {
      this.flashAmt = Math.max(0, this.flashAmt - delta / FLASH_S);
      if (this.flashAmt > 0) live = true;
      else this.flashId = null;
    }
    // Drop hover state for buttons that left the set.
    for (const id of this.hoverAmt.keys()) {
      if (!this.buttons.some((b) => b.id === id)) this.hoverAmt.delete(id);
    }
    this.draw();
    this.animating = live;
  }

  private applyShow(): void {
    const p = this.showP;
    this.group.visible = p > 0.001;
    const s = 0.96 + 0.04 * easeOutQuint(p);
    this.group.scale.setScalar(s);
    this.mat.opacity = this.shown ? easeOutCubic(clamp01(p / 0.7)) : easeInQuad(p);
  }

  /* ── the painter ──────────────────────────────────────────────────────── */

  private draw(): void {
    const g = this.ctx();
    const W = this.pxW;
    const H = this.pxH;
    g.clearRect(0, 0, W, H);

    if (this.skin === 'cyber') this.drawCyberFrame(g, W, H);
    else this.drawGlassFrame(g, W, H);

    if (this.title) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(700, 46);
      g.letterSpacing = '3px';
      g.fillStyle = UI.textHi;
      g.fillText(this.title, W / 2, 78);
      g.letterSpacing = '0px';
    }

    this.body?.(g);

    for (const b of this.buttons) {
      if (b.ghost) continue;
      if (this.skin === 'cyber') this.drawCyberButton(g, b);
      else this.drawButton(g, b);
    }

    this.tex.needsUpdate = true;
  }

  private drawGlassFrame(g: CanvasRenderingContext2D, W: number, H: number): void {
    // Base glass.
    g.beginPath();
    g.roundRect(6, 6, W - 12, H - 12, 30);
    g.fillStyle = UI.panel;
    g.fill();

    // Top sheen — one soft gradient of depth, in place of the old border glow.
    g.save();
    g.clip();
    const sheen = g.createLinearGradient(0, 6, 0, 186);
    sheen.addColorStop(0, 'rgba(255,255,255,0.05)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sheen;
    g.fillRect(6, 6, W - 12, 180);
    g.restore();

    // Hairline frame.
    g.lineWidth = 2;
    g.strokeStyle = UI.line;
    g.stroke();

    // Corner brackets — the identity mark: an active scan, not a border.
    g.strokeStyle = UI.accentDim;
    g.lineWidth = 2.5;
    const arm = 24;
    g.beginPath();
    g.moveTo(18 + arm, 18);
    g.lineTo(18, 18);
    g.lineTo(18, 18 + arm);
    g.moveTo(W - 18 - arm, H - 18);
    g.lineTo(W - 18, H - 18);
    g.lineTo(W - 18, H - 18 - arm);
    g.stroke();
  }

  /** The cyber frame: cut glass, the weave, a cyan hairline with a brighter
   *  inner rule, magenta brackets on the two cut corners, notch tabs on the
   *  top and bottom edges and a tick ruler down the left — chrome that
   *  reads as hardware, all of it static (painted with the canvas). */
  private drawCyberFrame(g: CanvasRenderingContext2D, W: number, H: number): void {
    const C = CYBER.cutFrame;
    const x = 6;
    const y = 6;
    const w = W - 12;
    const h = H - 12;

    chamfer(g, x, y, w, h, C);
    g.fillStyle = CYBER.panel;
    g.fill();

    g.save();
    g.clip();
    // A cold wash from the top-left corner and a warm one from the bottom-
    // right: the two neons the board is lit by.
    const cool = g.createRadialGradient(x, y, 0, x, y, Math.max(W, H) * 0.7);
    cool.addColorStop(0, 'rgba(0,240,255,0.07)');
    cool.addColorStop(1, 'rgba(0,240,255,0)');
    g.fillStyle = cool;
    g.fillRect(x, y, w, h);
    const warm = g.createRadialGradient(x + w, y + h, 0, x + w, y + h, Math.max(W, H) * 0.6);
    warm.addColorStop(0, 'rgba(255,42,213,0.07)');
    warm.addColorStop(1, 'rgba(255,42,213,0)');
    g.fillStyle = warm;
    g.fillRect(x, y, w, h);
    const pat = g.createPattern(weave(), 'repeat');
    if (pat) {
      g.fillStyle = pat;
      g.fillRect(x, y, w, h);
    }
    g.restore();

    // Outer hairline, then a fainter inset rule — a double edge, like a bezel.
    chamfer(g, x, y, w, h, C);
    g.lineWidth = 2;
    g.strokeStyle = CYBER.cyanLine;
    g.stroke();
    chamfer(g, x + 9, y + 9, w - 18, h - 18, C - 4);
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(0,240,255,0.10)';
    g.stroke();

    // Magenta brackets riding the two cuts.
    g.strokeStyle = UI.accent;
    g.lineWidth = 3;
    g.shadowColor = UI.accentDim;
    g.shadowBlur = 10;
    g.beginPath();
    g.moveTo(x, y + C + 46);
    g.lineTo(x, y + C);
    g.lineTo(x + C, y);
    g.lineTo(x + C + 46, y);
    g.moveTo(x + w, y + h - C - 46);
    g.lineTo(x + w, y + h - C);
    g.lineTo(x + w - C, y + h);
    g.lineTo(x + w - C - 46, y + h);
    g.stroke();
    g.shadowBlur = 0;

    // Notch tabs: a short raised bar on the top edge (right of centre) and
    // the bottom edge (left of centre).
    g.fillStyle = CYBER.cyan;
    g.fillRect(W * 0.62, y - 1, Math.min(120, W * 0.12), 4);
    g.fillRect(W * 0.26, y + h - 3, Math.min(80, W * 0.08), 4);

    // The tick ruler: every 16 px down the left inset, every fourth long.
    g.fillStyle = 'rgba(0,240,255,0.22)';
    const r0 = y + C + 70;
    const r1 = Math.min(y + h - 40, r0 + 260);
    for (let ty = r0, i = 0; ty < r1; ty += 16, i++) {
      g.fillRect(x + 2, ty, i % 4 === 0 ? 10 : 5, 1.5);
    }
  }

  private drawButton(g: CanvasRenderingContext2D, b: PanelButton): void {
    const hov = this.hoverAmt.get(b.id) ?? 0;
    const flash = this.flashId === b.id ? easeOutCubic(this.flashAmt) : 0;
    const r = 18;

    // OWN the text state (bodies leave alignments behind).
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    // A sub-line needs room. The tall buttons stack label and sub about the
    // centre at fixed offsets; a LOW button (the desk's split CTA row) lays
    // both out by its height, with the fonts shrunk to fit, so "just you"
    // never hangs below the plate it belongs to.
    const compact = !!b.sub && b.h < 72;
    const labelPx0 = b.px ?? (b.primary ? 40 : b.small ? 27 : 36);
    const labelPx = compact ? Math.min(labelPx0, Math.round(b.h * 0.42)) : labelPx0;
    const subPx = compact ? Math.max(14, Math.round(b.h * 0.27)) : b.primary ? 22 : 21;
    const labelY = compact ? b.y + b.h * 0.36 : b.y + b.h / 2 - (b.sub ? 16 : 0);
    const subY = compact ? b.y + b.h * 0.74 : b.y + b.h / 2 + 26;

    if (b.display) {
      // A value chip: quiet plate, live text, no chrome.
      g.fillStyle = 'rgba(255,255,255,0.03)';
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, r);
      g.fill();
      g.fillStyle = b.tone ?? UI.text;
      g.font = font(600, labelPx);
      g.letterSpacing = '1.5px';
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(500, 21);
        g.fillStyle = UI.dim;
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
      }
      return;
    }

    if (b.primary && !b.disabled) {
      // THE CTA — the screen's one solid fill, and its one glow.
      const grad = g.createLinearGradient(0, b.y, 0, b.y + b.h);
      grad.addColorStop(0, '#ff3fdb');
      grad.addColorStop(1, '#df19b5');
      g.shadowColor = UI.accentDim;
      g.shadowBlur = 18 + 10 * hov + 12 * flash;
      g.fillStyle = grad;
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, r);
      g.fill();
      g.shadowBlur = 0;
      // A glassy top light gives the fill its dimension.
      const sheen = g.createLinearGradient(0, b.y, 0, b.y + b.h * 0.5);
      sheen.addColorStop(0, 'rgba(255,255,255,0.22)');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = sheen;
      g.fill();
      if (hov > 0 || flash > 0) {
        g.fillStyle = `rgba(255,255,255,${(0.14 * hov + 0.18 * flash).toFixed(3)})`;
        g.fill();
      }
      g.fillStyle = UI.onAccent;
      g.font = font(700, labelPx);
      g.letterSpacing = '2px';
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 32);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(600, subPx);
        g.fillStyle = 'rgba(24,4,17,0.8)';
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 32);
      }
      return;
    }

    // Neutral plate (the default), selected, or disabled.
    const plateA = b.disabled ? 0.02 : 0.045 + 0.045 * hov;
    g.fillStyle = b.selected ? UI.accentFaint : `rgba(255,255,255,${plateA.toFixed(3)})`;
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, r);
    g.fill();
    if (flash > 0) {
      g.fillStyle = `rgba(255,42,213,${(0.2 * flash).toFixed(3)})`;
      g.fill();
    }
    g.lineWidth = 2;
    g.strokeStyle = b.disabled
      ? 'rgba(255,255,255,0.05)'
      : b.selected
        ? 'rgba(255,42,213,0.9)'
        : `rgba(255,255,255,${(0.1 + 0.2 * hov).toFixed(3)})`;
    g.stroke();

    // The edge tick: the accent's whole job on a resting screen.
    const tick = b.selected ? 1 : hov;
    if (tick > 0.02 && !b.disabled) {
      g.globalAlpha = tick;
      g.fillStyle = UI.accent;
      g.beginPath();
      g.roundRect(b.x + 7, b.y + 12, 5, b.h - 24, 2.5);
      g.fill();
      g.globalAlpha = 1;
    }

    g.fillStyle = b.disabled ? UI.disabled : (b.tone ?? UI.text);
    g.font = font(600, labelPx);
    g.letterSpacing = '1.5px';
    g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
    g.letterSpacing = '0px';
    if (b.sub) {
      g.font = font(500, subPx);
      g.fillStyle = b.disabled ? 'rgba(233,236,244,0.2)' : UI.dim;
      g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
    }
  }

  /** The cyber edition of drawButton: same roles, cut plates. The CTA is a
   *  solid magenta blade with a cyan ghost a few px down-right (the split-
   *  channel misregister every neon sign in the genre has) and hazard
   *  slashes in its tail; a value chip is bracketed data; a disabled plate
   *  goes dashed instead of grey. */
  private drawCyberButton(g: CanvasRenderingContext2D, b: PanelButton): void {
    const hov = this.hoverAmt.get(b.id) ?? 0;
    const flash = this.flashId === b.id ? easeOutCubic(this.flashAmt) : 0;
    const cut = Math.min(b.h, b.w) < 70 ? CYBER.cutSmall : CYBER.cut;

    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const compact = !!b.sub && b.h < 72;
    const labelPx0 = b.px ?? (b.primary ? 40 : b.small ? 27 : 36);
    const labelPx = compact ? Math.min(labelPx0, Math.round(b.h * 0.42)) : labelPx0;
    const subPx = compact ? Math.max(14, Math.round(b.h * 0.27)) : b.primary ? 22 : 21;
    const labelY = compact ? b.y + b.h * 0.36 : b.y + b.h / 2 - (b.sub ? 16 : 0);
    const subY = compact ? b.y + b.h * 0.74 : b.y + b.h / 2 + 26;

    if (b.display) {
      // Data in brackets: a dim cyan well, corner ticks, no plate border.
      chamfer(g, b.x, b.y, b.w, b.h, cut);
      g.fillStyle = 'rgba(0,240,255,0.04)';
      g.fill();
      const a = Math.min(14, b.h / 3);
      g.strokeStyle = CYBER.cyanDim;
      g.lineWidth = 2;
      g.beginPath();
      g.moveTo(b.x + a, b.y + 1);
      g.lineTo(b.x + 1, b.y + 1);
      g.lineTo(b.x + 1, b.y + a);
      g.moveTo(b.x + b.w - a, b.y + b.h - 1);
      g.lineTo(b.x + b.w - 1, b.y + b.h - 1);
      g.lineTo(b.x + b.w - 1, b.y + b.h - a);
      g.stroke();
      g.fillStyle = b.tone ?? UI.text;
      g.font = font(600, labelPx);
      g.letterSpacing = '2px';
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(500, 21);
        g.fillStyle = UI.dim;
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
      }
      return;
    }

    if (b.primary && !b.disabled) {
      // The misregistered ghost first, then the blade over it.
      const off = 5 + 2 * hov;
      chamfer(g, b.x + off, b.y + off, b.w, b.h, cut);
      g.lineWidth = 2;
      g.strokeStyle = `rgba(0,240,255,${(0.55 + 0.35 * hov).toFixed(3)})`;
      g.stroke();

      const grad = g.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h);
      grad.addColorStop(0, '#ff4fe0');
      grad.addColorStop(1, '#d413aa');
      g.shadowColor = UI.accentDim;
      g.shadowBlur = 18 + 12 * hov + 12 * flash;
      chamfer(g, b.x, b.y, b.w, b.h, cut);
      g.fillStyle = grad;
      g.fill();
      g.shadowBlur = 0;
      g.save();
      g.clip();
      // Scanlines on the fill itself, so the blade reads as a lit sign.
      g.fillStyle = 'rgba(40,0,30,0.12)';
      for (let sy = b.y + 2; sy < b.y + b.h; sy += 4) g.fillRect(b.x, sy, b.w, 1.5);
      // Hazard slashes in the tail (tall CTAs only — a short one has no room).
      if (b.w >= 220 && b.h >= 56) {
        const sw = Math.min(110, b.w * 0.16);
        hazardStripes(g, b.x + b.w - sw - cut, b.y + b.h - 12, sw, 6, 'rgba(22,4,15,0.55)', 12);
      }
      if (hov > 0 || flash > 0) {
        g.fillStyle = `rgba(255,255,255,${(0.14 * hov + 0.2 * flash).toFixed(3)})`;
        g.fillRect(b.x, b.y, b.w, b.h);
      }
      g.restore();
      g.fillStyle = UI.onAccent;
      g.font = font(700, labelPx);
      g.letterSpacing = '4px';
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 40);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(600, subPx);
        g.letterSpacing = '1px';
        g.fillStyle = 'rgba(24,4,17,0.82)';
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 40);
        g.letterSpacing = '0px';
      }
      return;
    }

    // Neutral, selected or disabled: a cut plate.
    chamfer(g, b.x, b.y, b.w, b.h, cut);
    if (b.disabled) {
      g.fillStyle = 'rgba(255,255,255,0.015)';
      g.fill();
      g.setLineDash([6, 6]);
      g.lineWidth = 1.5;
      g.strokeStyle = 'rgba(0,240,255,0.14)';
      g.stroke();
      g.setLineDash([]);
    } else {
      g.fillStyle = b.selected
        ? 'rgba(255,42,213,0.13)'
        : `rgba(0,240,255,${(0.035 + 0.06 * hov).toFixed(3)})`;
      g.fill();
      if (flash > 0) {
        g.fillStyle = `rgba(255,42,213,${(0.24 * flash).toFixed(3)})`;
        g.fill();
      }
      g.lineWidth = 2;
      g.strokeStyle = b.selected ? UI.accent : `rgba(0,240,255,${(0.2 + 0.45 * hov).toFixed(3)})`;
      if (b.selected || hov > 0.02) {
        g.shadowColor = b.selected ? UI.accentDim : CYBER.cyanDim;
        g.shadowBlur = 10 * (b.selected ? 1 : hov);
      }
      g.stroke();
      g.shadowBlur = 0;
    }

    // The edge tick, slanted to match the cut.
    const tick = b.disabled ? 0 : b.selected ? 1 : hov;
    if (tick > 0.02 && b.h >= 36) {
      g.globalAlpha = tick;
      g.fillStyle = b.selected ? UI.accent : CYBER.cyan;
      const tx = b.x + 8;
      const t0 = b.y + Math.max(cut, 10);
      const t1 = b.y + b.h - 10;
      g.beginPath();
      g.moveTo(tx + 3, t0);
      g.lineTo(tx + 8, t0);
      g.lineTo(tx + 5, t1);
      g.lineTo(tx, t1);
      g.closePath();
      g.fill();
      g.globalAlpha = 1;
    }

    g.fillStyle = b.disabled ? UI.disabled : (b.tone ?? UI.text);
    g.font = font(600, labelPx);
    g.letterSpacing = '2px';
    g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
    g.letterSpacing = '0px';
    if (b.sub) {
      g.font = font(500, subPx);
      g.fillStyle = b.disabled ? 'rgba(233,236,244,0.2)' : UI.dim;
      g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
    }
  }

  /** What this panel is currently offering, by id — the pressable ones only
   *  (a value chip is not a button, and neither is something greyed out).
   *  Headless checks ask this instead of hunting for shapes in pixels. */
  liveButtons(): string[] {
    return this.buttons.filter((b) => !b.disabled && !b.display).map((b) => b.id);
  }

  /** UV (from a raycast hit) → button id, or null. */
  buttonAt(u: number, v: number): string | null {
    const x = u * this.pxW;
    const y = (1 - v) * this.pxH;
    for (const b of this.buttons) {
      if (b.disabled || b.display) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
    this.glowMat.dispose();
    this.sweepMesh?.geometry.dispose();
    this.sweepMat?.dispose();
  }
}
