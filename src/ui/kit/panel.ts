/**
 * THE PANEL KIT — the menu surface language, ported whole from RAVE RAID
 * and dressed in FIRE FIGHT's colours. One canvas per panel, raycast by
 * the controller lasers; a hit-test maps a ray intersection's UV back to
 * the button under it.
 *
 * THE LOOK (the live-service discipline): quiet near-black glass with a
 * warm cast, white-alpha hairlines, and ONE accent — hazard amber — that
 * only marks what matters: the primary CTA, the selected state, the
 * active tab. Semantic colour lives in text and status dots, never in
 * button chrome. Glow is a budget, not a default: the CTA and the
 * under-halo carry it, everything else is matte. Weight and tracking do
 * the hierarchy work (see ui/kit/fonts.ts).
 *
 * THE MOTION (why this class owns a tick): state changes ease instead of
 * snapping — hover in ~100 ms, out ~180 ms, a press flash decaying over
 * ~150 ms, open/close as a 4% scale + fade at the MESH level. Canvas
 * repaints (a full texture upload) happen only while one of those brief
 * transitions is actually running; at rest the texture is static and the
 * only living thing is the under-halo's opacity leaning into `pulse` —
 * material-level, upload-free.
 *
 * One departure from the RAVE RAID original: the under-halo hangs as a
 * CHILD of the panel mesh rather than a sibling in a group, so a host
 * that manages visibility by writing `mesh.visible` directly (FF1's
 * MenuSystem does) hides the whole panel — glow included — in one flag.
 */

import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
} from 'three';
import { font, onFontsReady } from './fonts.js';
import { ACCENT_RGB, HOLO_HOT, holoGlass } from './holo.js';

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
   *  button (a `disabled` grey reads as "broken"). */
  display?: boolean;
  /** Explicit label px when the two standard sizes don't fit (code slots). */
  px?: number;
  /** A TAB in the strip across the panel's top (the Overwatch / Fortnite
   *  menu grammar): no plate — an uppercase label riding a shared
   *  baseline, the active one (`selected`) underlined in the accent, the
   *  hovered one growing its own underline in. Every face of a panel
   *  shows the same strip, so where you are is always one glance away. */
  tab?: boolean;
  /** A red pip on the label's shoulder — the unread mark (a fresh paper). */
  badge?: boolean;
  /** A BREAKER: the label sits left and a switch sits right — track and
   *  knob, the knob thrown to the accent side when `selected`. A plain
   *  selected plate reads as "this is the one I picked"; a breaker has
   *  to read as ON or OFF at a glance, from across the room. */
  toggle?: boolean;
}

/** Panel construction options. */
export interface PanelOpts {
  /** No glass, sheen, frame or brackets — the body paints its own
   *  chrome (a chip, a pop-out card). */
  bare?: boolean;
}

// The accent's triple and the holo's second tube live with the glass they
// paint (ui/kit/holo.ts); re-exported so callers keep one import.
export { ACCENT_RGB, HOLO_HOT };

export const KIT = {
  /* Surfaces — HOLO GLASS: a dark, see-through blue-black pane, so the
   * neon street (or the desert dusk) stays visible behind every menu. */
  panel: 'rgba(6,10,22,0.46)',
  well: 'rgba(0,8,20,0.38)',
  plate: 'rgba(120,230,255,0.06)',
  plateHover: 'rgba(120,230,255,0.15)',
  /* Hairlines — lit tube, not paint */
  line: 'rgba(90,230,255,0.30)',
  lineHover: 'rgba(140,245,255,0.75)',
  lineFaint: 'rgba(90,230,255,0.14)',
  /* Text — every tier a step brighter than its web equivalent: a headset
   * panel is a small emissive rectangle in a dark street, not a page. */
  text: '#ffffff',
  textHi: '#ffffff',
  dim: 'rgba(228,246,255,0.82)',
  faint: 'rgba(205,236,255,0.58)',
  disabled: 'rgba(205,236,255,0.34)',
  /* The accent — neon cyan. Identity, selection, primacy. Nothing else. */
  accent: '#3ff2ff',
  accentDim: `rgba(${ACCENT_RGB},0.6)`,
  accentFaint: `rgba(${ACCENT_RGB},0.12)`,
  onAccent: '#ffffff',
  /* Semantic roles (text + dots, never chrome) */
  positive: '#2be28a',
  info: '#6fc8ff',
  warn: '#ffb454',
  danger: '#ff5266',
};

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

export class Panel {
  readonly mesh: Mesh;
  private mat: MeshBasicMaterial;
  private glowMat: MeshBasicMaterial;
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  private buttons: PanelButton[] = [];
  private pxW: number;
  private pxH: number;

  /* Stored paint args, so transitions can repaint without the caller. */
  private title = '';
  private body: ((g: CanvasRenderingContext2D, hover: string | null) => void) | null = null;
  private hover: string | null = null;
  private bare: boolean;

  /* Transition state. */
  private hoverAmt = new Map<string, number>();
  private flashId: string | null = null;
  private flashAmt = 0;
  private shown = true;
  private showP = 1;
  private animating = false;

  constructor(widthM: number, heightM: number, pxW = 1024, pxH = 1024, opts: PanelOpts = {}) {
    this.pxW = pxW;
    this.pxH = pxH;
    this.bare = !!opts.bare;
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
    // Menus must win the draw fight against transparent scenery behind them.
    this.mesh.renderOrder = 30;

    // The under-halo: the panel's presence in a dark room, and the one
    // element allowed to lean into `pulse` (opacity only — no upload).
    this.glowMat = new MeshBasicMaterial({
      map: halo(),
      transparent: true,
      opacity: 0.12,
      side: DoubleSide,
      depthWrite: false,
      blending: AdditiveBlending,
      color: 0x3ff2ff,
    });
    const glow = new Mesh(new PlaneGeometry(widthM * 1.42, heightM * 1.56), this.glowMat);
    glow.renderOrder = 29;
    glow.position.z = -0.005;
    glow.visible = !this.bare;
    this.mesh.add(glow);

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
   *  Also the hover hand-off: eased highlights start/retarget here. The
   *  body is handed the hovered id so custom-drawn widgets (ladder rows,
   *  trophy chips) can answer the pointer too. */
  paint(
    title: string,
    body: (g: CanvasRenderingContext2D, hover: string | null) => void,
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
   *  widgets (rails, list rows) read this so THEIR highlights ease on the
   *  same clock as the kit's. */
  hoverOf(id: string): number {
    return this.hoverAmt.get(id) ?? 0;
  }

  /** Advance transitions. `pulse` is an ambience envelope (0..1) for the
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
    this.glowMat.opacity = (0.2 + 0.08 * pulse) * op;

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
    const s = 0.96 + 0.04 * easeOutQuint(p);
    this.mesh.scale.setScalar(s);
    this.mat.opacity = this.shown ? easeOutCubic(clamp01(p / 0.7)) : easeInQuad(p);
  }

  /* ── the painter ──────────────────────────────────────────────────────── */

  private draw(): void {
    const g = this.ctx();
    const W = this.pxW;
    const H = this.pxH;
    g.clearRect(0, 0, W, H);

    if (this.bare) {
      this.body?.(g, this.hover);
      for (const b of this.buttons) {
        if (b.ghost) continue;
        this.drawButton(g, b);
      }
      this.tex.needsUpdate = true;
      return;
    }

    // HOLO GLASS: the see-through pane, its lit edge, light bar, magenta
    // corner brackets and readout ticks (shared with the match UI).
    holoGlass(g, 6, 6, W - 12, H - 12, { fill: KIT.panel });

    // THE TAB STRIP: when a face carries tabs they own the title band — a
    // faint baseline the whole width, the brand (title) left-aligned as a
    // mark beside them, and the active tab's accent underline riding the
    // baseline. No tabs → the classic centred title.
    const tabs = this.buttons.filter((b) => b.tab);
    if (tabs.length) {
      const base = tabs[0].y + tabs[0].h - 4;
      g.fillStyle = KIT.lineFaint;
      g.fillRect(40, base, W - 80, 2);
      if (this.title) {
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = font(700, 34);
        g.letterSpacing = '4px';
        g.fillStyle = KIT.accent;
        g.fillText(this.title, 52, tabs[0].y + tabs[0].h / 2 - 2);
        g.letterSpacing = '0px';
      }
    } else if (this.title) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(700, 46);
      g.letterSpacing = '3px';
      g.fillStyle = KIT.textHi;
      g.fillText(this.title, W / 2, 78);
      g.letterSpacing = '0px';
    }

    this.body?.(g, this.hover);

    for (const b of this.buttons) {
      if (b.ghost) continue;
      this.drawButton(g, b);
    }

    this.tex.needsUpdate = true;
  }

  private drawButton(g: CanvasRenderingContext2D, b: PanelButton): void {
    const hov = this.hoverAmt.get(b.id) ?? 0;
    const flash = this.flashId === b.id ? easeOutCubic(this.flashAmt) : 0;
    const r = 18;

    // OWN the text state (bodies leave alignments behind).
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    const labelPx = b.px ?? (b.primary ? 40 : b.small ? 27 : 36);
    const labelY = b.y + b.h / 2 - (b.sub ? 16 : 0);
    const subY = b.y + b.h / 2 + 26;

    if (b.tab) {
      // A tab: label on the shared baseline, underline for the active one,
      // a growing underline for the hovered one, a press flash as a wash.
      const active = !!b.selected && !b.disabled;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2 - 2;
      if (flash > 0) {
        g.fillStyle = `rgba(${ACCENT_RGB},${(0.16 * flash).toFixed(3)})`;
        g.beginPath();
        g.roundRect(b.x, b.y, b.w, b.h, 12);
        g.fill();
      }
      g.font = font(700, b.px ?? 30);
      g.letterSpacing = '3px';
      g.fillStyle = b.disabled
        ? KIT.disabled
        : active
          ? KIT.textHi
          : `rgba(250,246,238,${(0.6 + 0.35 * hov).toFixed(3)})`;
      g.fillText(b.label, cx, cy, b.w - 16);
      const tw = Math.min(b.w - 16, g.measureText(b.label).width);
      g.letterSpacing = '0px';
      const uw = active ? tw + 8 : b.disabled ? 0 : (tw + 8) * hov;
      if (uw > 1) {
        g.fillStyle = active ? KIT.accent : KIT.accentDim;
        g.beginPath();
        g.roundRect(cx - uw / 2, b.y + b.h - 8, uw, 5, 2.5);
        g.fill();
      }
      if (b.badge) {
        g.beginPath();
        g.arc(cx + tw / 2 + 14, cy - 16, 7, 0, Math.PI * 2);
        g.fillStyle = KIT.danger;
        g.fill();
      }
      return;
    }

    if (b.display) {
      // A value chip: quiet plate, live text, no chrome.
      g.fillStyle = 'rgba(255,255,255,0.03)';
      g.beginPath();
      g.roundRect(b.x, b.y, b.w, b.h, r);
      g.fill();
      g.fillStyle = b.tone ?? KIT.text;
      g.font = font(600, labelPx);
      g.letterSpacing = '1.5px';
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(500, 21);
        g.fillStyle = KIT.dim;
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
      }
      return;
    }

    if (b.primary && !b.disabled) {
      // THE CTA — the screen's one solid fill, and its one glow.
      const grad = g.createLinearGradient(0, b.y, 0, b.y + b.h);
      // Lit holo glass rather than a solid slab: translucent cyan with a hot rim.
      grad.addColorStop(0, `rgba(${ACCENT_RGB},0.5)`);
      grad.addColorStop(1, 'rgba(18,150,214,0.28)');
      g.shadowColor = KIT.accentDim;
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
      // The lit rim — the tube that makes it the screen's one primary.
      g.save();
      g.shadowColor = KIT.accent;
      g.shadowBlur = 12 + 8 * hov;
      g.lineWidth = 2.5;
      g.strokeStyle = `rgba(${ACCENT_RGB},${(0.85 + 0.15 * hov).toFixed(3)})`;
      g.stroke();
      g.restore();
      g.fillStyle = KIT.onAccent;
      g.font = font(700, labelPx);
      g.letterSpacing = '2px';
      g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 32);
      g.letterSpacing = '0px';
      if (b.sub) {
        g.font = font(600, 22);
        g.fillStyle = 'rgba(34,19,2,0.8)';
        g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 32);
      }
      return;
    }

    if (b.toggle) {
      this.paintToggle(g, b, hov, flash, r, labelPx);
      return;
    }

    // Neutral plate (the default), selected, or disabled.
    const plateA = b.disabled ? 0.02 : 0.045 + 0.045 * hov;
    g.fillStyle = b.selected ? KIT.accentFaint : `rgba(255,255,255,${plateA.toFixed(3)})`;
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, r);
    g.fill();
    if (flash > 0) {
      g.fillStyle = `rgba(${ACCENT_RGB},${(0.2 * flash).toFixed(3)})`;
      g.fill();
    }
    g.lineWidth = 2;
    g.strokeStyle = b.disabled
      ? 'rgba(255,255,255,0.05)'
      : b.selected
        ? `rgba(${ACCENT_RGB},0.9)`
        : `rgba(255,255,255,${(0.1 + 0.2 * hov).toFixed(3)})`;
    g.stroke();

    // The edge tick: the accent's whole job on a resting screen.
    const tick = b.selected ? 1 : hov;
    if (tick > 0.02 && !b.disabled) {
      g.globalAlpha = tick;
      g.fillStyle = KIT.accent;
      g.beginPath();
      g.roundRect(b.x + 7, b.y + 12, 5, b.h - 24, 2.5);
      g.fill();
      g.globalAlpha = 1;
    }

    g.fillStyle = b.disabled ? KIT.disabled : (b.tone ?? KIT.text);
    g.font = font(600, labelPx);
    g.letterSpacing = '1.5px';
    g.fillText(b.label, b.x + b.w / 2, labelY, b.w - 28);
    g.letterSpacing = '0px';
    if (b.sub) {
      g.font = font(500, 21);
      g.fillStyle = b.disabled ? 'rgba(250,246,238,0.2)' : KIT.dim;
      g.fillText(b.sub, b.x + b.w / 2, subY, b.w - 28);
    }
    if (b.badge) {
      g.beginPath();
      g.arc(b.x + b.w - 16, b.y + 16, 7, 0, Math.PI * 2);
      g.fillStyle = KIT.danger;
      g.fill();
    }
  }

  /**
   * THE BREAKER. The plate itself stays neutral — no accent tint, no edge
   * tick — because the SWITCH is the whole state: a 78×38 track on the
   * right, dark when off with the knob parked left and dim, accent when
   * on with the knob thrown right and white. The label sits left in the
   * plate's own type, and a `sub` (if any) under it.
   */
  private paintToggle(g: CanvasRenderingContext2D, b: PanelButton, hov: number, flash: number, r: number, labelPx: number): void {
    const on = !!b.selected && !b.disabled;
    const plateA = b.disabled ? 0.02 : 0.045 + 0.045 * hov;
    g.fillStyle = `rgba(255,255,255,${plateA.toFixed(3)})`;
    g.beginPath();
    g.roundRect(b.x, b.y, b.w, b.h, r);
    g.fill();
    if (flash > 0) {
      g.fillStyle = `rgba(${ACCENT_RGB},${(0.2 * flash).toFixed(3)})`;
      g.fill();
    }
    g.lineWidth = 2;
    g.strokeStyle = b.disabled ? 'rgba(255,255,255,0.05)' : `rgba(255,255,255,${(0.1 + 0.2 * hov).toFixed(3)})`;
    g.stroke();

    // The switch.
    const tw = 78;
    const th = 38;
    const tx = b.x + b.w - 26 - tw;
    const ty = b.y + b.h / 2 - th / 2;
    g.fillStyle = on ? KIT.accent : 'rgba(255,255,255,0.08)';
    g.beginPath();
    g.roundRect(tx, ty, tw, th, th / 2);
    g.fill();
    if (!on) {
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,255,255,0.18)';
      g.stroke();
    }
    const kr = th / 2 - 5;
    const kx = on ? tx + tw - 5 - kr : tx + 5 + kr;
    g.fillStyle = on ? '#ffffff' : KIT.disabled;
    g.beginPath();
    g.arc(kx, ty + th / 2, kr, 0, Math.PI * 2);
    g.fill();

    // The word, so nobody has to know the convention.
    g.textAlign = on ? 'left' : 'right';
    g.textBaseline = 'middle';
    g.font = font(700, 16);
    g.letterSpacing = '2px';
    g.fillStyle = on ? KIT.accent : KIT.faint;
    g.fillText(on ? 'ON' : 'OFF', on ? tx - 12 - 30 : tx - 12, ty + th / 2);
    g.letterSpacing = '0px';

    // The label, left.
    g.textAlign = 'left';
    g.fillStyle = b.disabled ? KIT.disabled : (b.tone ?? KIT.text);
    g.font = font(600, labelPx);
    g.letterSpacing = '1.5px';
    const labelY = b.sub ? b.y + b.h / 2 - 12 : b.y + b.h / 2;
    g.fillText(b.label, b.x + 28, labelY, b.w - tw - 120);
    g.letterSpacing = '0px';
    if (b.sub) {
      g.font = font(500, 21);
      g.fillStyle = b.disabled ? 'rgba(250,246,238,0.2)' : KIT.dim;
      g.fillText(b.sub, b.x + 28, b.y + b.h / 2 + 16, b.w - tw - 120);
    }
    g.textAlign = 'center';
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
    // LAST pushed wins. A face lays its plate down first and the controls
    // on it after — the store's tile, then the BUY button grown on that
    // tile — and the ray has to land on whatever is on top. Searched front
    // to back, the tile answered for every press on its BUY: the press
    // re-tried-on what was already tried on, and nothing was ever bought.
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (b.disabled || b.display) continue;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.id;
    }
    return null;
  }

  /** A button's plate in canvas pixels, for the headless probes. */
  rectOf(id: string): { x: number; y: number; w: number; h: number } | null {
    const b = this.buttons.find((x) => x.id === id);
    return b ? { x: b.x, y: b.y, w: b.w, h: b.h } : null;
  }

  /** The button under a canvas pixel — the answer a ray landing there gets. */
  buttonAtPx(x: number, y: number): string | null {
    return this.buttonAt(x / this.pxW, 1 - y / this.pxH);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.mat.map?.dispose();
    this.mat.dispose();
    this.glowMat.dispose();
  }
}
