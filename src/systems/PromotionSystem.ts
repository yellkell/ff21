/**
 * The promotion celebration. When the player lands back in the lobby having
 * crossed into a higher Bronze→Overlord tier, a badge medallion erupts in
 * front of them: the old emblem charges with gathering embers, then BURSTS —
 * a white flash, an expanding shockwave ring, a fountain of fire and a
 * sunburst of light wheeling behind — and swaps to the new emblem, which
 * slams in with an overshoot and holds under a pulsing glow before fading.
 *
 * It all stands on a BACKING PLATE, and it has to. FIRE FIGHT is passthrough:
 * behind the medallion is the player's own lit room, and every celebratory
 * layer here — halo, sunburst, flash, shockwave — is additive, which is to
 * say it only adds light. Additive light over a bright room adds almost
 * nothing, so without something solid underneath the whole burst reads as a
 * faint ghost of itself with the sofa showing through it. The plate is the
 * kit's own smoked steel, near-opaque: it gives the fire a dark room to
 * happen in, and the emblem an edge to sit against.
 *
 * XP only changes during play/training (away from the menu). We wait for the
 * cloud profile to finish loading (profileReady) before reading any tier — the
 * pre-load XP is 0 (Bronze), so baselining too early makes the real XP arriving
 * a moment later look like a promotion on every login. Once it's loaded we
 * record the current tier silently, then play any time the live tier climbs
 * above what we last showed.
 */

import { createSystem } from '@iwsdk/core';
import {
  AdditiveBlending,
  CanvasTexture,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Texture,
} from 'three';
import { app } from '../menu/appState.js';
import { tierForXp, tierName } from '../menu/progression.js';
import { rankBadgeTexture, rankBadgeZoom } from '../menu/rankBadges.js';
import { myStats, profileReady } from '../net/leaderboard.js';
import { glowSprite } from '../materials/glow.js';
import { emberBurst, setEmberDrawOrder, spawnEmber } from '../fx/fire.js';
import { UI, fitStencilText, plate, stencilFont } from '../ui/industrial.js';
import * as sfx from '../audio/sfx.js';

const EMBER = 0xff7a18;
const _badgePos = new Vector3();

// A longer, weightier celebration: charge → BURST → a long proud hold → fade.
const CHARGE = 0.8;
const HOLD = 3.6;
const FADE = 1.1;
const TOTAL = CHARGE + HOLD + FADE;

/** How solid the backing plate gets — the whole burst's floor of contrast. */
const PLATE_OPACITY = 0.94;

/**
 * THE DRAW BAND. The kit's menu panels ride renderOrder 30 with depthWrite
 * off, on purpose — "menus must win the draw fight against transparent
 * scenery behind them" (ui/kit/panel.ts). The medallion erupts a foot in
 * FRONT of the lobby's centre slab (z -0.95 against the slab's -1.26), but
 * down in the single digits it lost that fight anyway: nothing in either
 * stack writes depth, so the slab simply painted over the whole celebration
 * and left a ghost of it bleeding through the panel. Hence a band of its
 * own, above the menus: for five seconds the promotion IS the view.
 */
const BAND = 40;

export class PromotionSystem extends createSystem({}) {
  private group?: Group;
  private backing?: Mesh;
  private glow?: Sprite;
  private rays?: Sprite;
  private flash?: Sprite;
  private ring?: Sprite;
  private badge?: Mesh;
  private label?: Mesh;
  private labelTex?: CanvasTexture;

  private shownTier = -1;
  private animating = false;
  private t = 0;
  private to = 0;
  private swapped = false;
  private emberTimer = 0;
  /** A dev-hook run: it must not move the real baseline, or a forced play
   *  would swallow the promotion the player actually earns next. */
  private forced = false;
  private plateOn = true;

  /** Headless probe (tools/promo-check.mjs): play the celebration on demand,
   *  and see it with and without its backing plate — the plate is the whole
   *  reason this FX reads at all over passthrough, so a probe needs both.
   *  Re-asserted every frame rather than installed at init: the wrap owns
   *  (and rebuilds) the __ff2 namespace during lobby boot, so an init-time
   *  install would be clobbered. */
  private installHook(): void {
    const w = window as unknown as { __ff2?: Record<string, unknown> };
    if ((w.__ff2 ??= {}).promo) return;
    w.__ff2.promo = {
      play: (from: number, to: number): void => {
        this.forced = true;
        this.start(from, to);
      },
      plate: (on: boolean): void => {
        this.plateOn = on;
      },
      playing: (): boolean => this.animating,
      /** Seconds into the current run — lets a probe grab an exact beat. */
      at: (): number => (this.animating ? this.t : -1),
    };
  }

  update(delta: number): void {
    this.installHook();
    if (this.animating) {
      this.run(delta);
      return;
    }
    if (app.state !== 'menu') return;
    // Wait for the cloud profile to finish loading before we read a tier —
    // otherwise the baseline is the pre-load XP (0 = Bronze) and the real XP
    // arriving a moment later reads as a promotion on every single login.
    if (!profileReady()) return;

    const cur = tierForXp(myStats().xp).index;
    if (this.shownTier < 0) {
      this.shownTier = cur; // first sighting — establish the baseline silently
      return;
    }
    if (cur > this.shownTier) this.start(this.shownTier, cur);
  }

  private start(from: number, to: number): void {
    this.build();
    const tex = rankBadgeTexture(from);
    const mat = this.badge!.material as MeshBasicMaterial;
    if (!tex) {
      this.shownTier = to; // art not decoded yet — skip gracefully
      return;
    }
    mat.map = tex;
    mat.opacity = 1;
    mat.needsUpdate = true;
    this.badge!.scale.setScalar(rankBadgeZoom(from));

    this.to = to;
    this.drawLabel(tierName(to));
    this.group!.position.set(0, 1.62, -0.95);
    this.group!.scale.setScalar(0.001);
    this.group!.visible = true;
    (this.backing!.material as MeshBasicMaterial).opacity = 0;
    this.glow!.material.opacity = 0;
    this.rays!.material.opacity = 0;
    (this.rays!.material as SpriteMaterial).rotation = 0;
    this.flash!.material.opacity = 0;
    this.ring!.material.opacity = 0;
    this.t = 0;
    this.swapped = false;
    this.emberTimer = 0;
    this.animating = true;
    // The fire comes up into the band with everything else, or the plate it
    // is supposed to be pouring off would paint it out.
    setEmberDrawOrder(BAND + 2);
    sfx.roundBell();
  }

  private run(delta: number): void {
    if (app.state !== 'menu') {
      this.finish();
      return;
    }
    this.t += delta;
    const g = this.group!;
    const badgeMat = this.badge!.material as MeshBasicMaterial;
    const labelMat = this.label!.material as MeshBasicMaterial;
    const plateMat = this.backing!.material as MeshBasicMaterial;
    const plateK = this.plateOn ? PLATE_OPACITY : 0;
    const raysMat = this.rays!.material as SpriteMaterial;
    this.badge!.getWorldPosition(_badgePos);

    // The sunburst wheels the whole time it's visible.
    raysMat.rotation += delta * 0.7;
    const sinceSwap = this.t - CHARGE;

    if (this.t < CHARGE) {
      // Charge: the old emblem swells in, drawing a tightening spiral of embers.
      const k = this.t / CHARGE;
      g.scale.setScalar(this.easeOutBack(k));
      // The plate lands ahead of the light — the room goes dark, THEN it fills.
      plateMat.opacity = plateK * Math.min(1, k * 2);
      this.glow!.material.opacity = 0.45 * k;
      raysMat.opacity = 0.24 * k;
      labelMat.opacity = Math.max(0, k * 2 - 1);
      this.emberTimer -= delta;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.03;
        spawnEmber(_badgePos, 0.6, false);
      }
    } else if (!this.swapped) {
      // BURST: flash, shockwave, fire fountain, sunburst — swap to the new tier.
      this.swapped = true;
      g.scale.setScalar(1);
      const tex = rankBadgeTexture(this.to);
      if (tex) {
        badgeMat.map = tex;
        badgeMat.needsUpdate = true;
        this.badge!.scale.setScalar(rankBadgeZoom(this.to));
      }
      emberBurst(_badgePos, 70, false);
      emberBurst(_badgePos, 28, true);
      plateMat.opacity = plateK;
      this.glow!.material.opacity = 1;
      this.flash!.material.opacity = 1;
      this.ring!.material.opacity = 1;
      this.ring!.scale.setScalar(0.3);
      raysMat.opacity = 0.9;
      sfx.matchEnd(true);
      sfx.roundBell();
    } else if (this.t < CHARGE + HOLD) {
      // Hold: the new emblem slams in with an overshoot and rides a proud,
      // breathing pulse while the flash fades and the shockwave rolls out.
      const spring = 1 + 0.26 * Math.exp(-sinceSwap * 6) * Math.cos(sinceSwap * 15);
      const breathe = 1 + 0.03 * Math.sin(this.t * 4);
      g.scale.setScalar(Math.max(0.3, spring * breathe));
      plateMat.opacity = plateK;
      this.glow!.material.opacity = 0.75 + 0.25 * Math.sin(this.t * 8);
      raysMat.opacity = 0.85 + 0.15 * Math.sin(this.t * 6);
      // Impact flash decays fast; shockwave ring expands and fades over ~0.7 s.
      this.flash!.material.opacity = Math.max(0, 1 - sinceSwap / 0.35);
      const rk = Math.min(1, sinceSwap / 0.7);
      this.ring!.scale.setScalar(0.3 + rk * 1.7);
      this.ring!.material.opacity = (1 - rk) * 0.9;
      // A steady fountain of fire off the emblem for the whole hold.
      this.emberTimer -= delta;
      if (this.emberTimer <= 0) {
        this.emberTimer = 0.06;
        spawnEmber(_badgePos, 0.85, false);
      }
    } else if (this.t < TOTAL) {
      // Fade: everything lifts and dissolves.
      const k = (this.t - CHARGE - HOLD) / FADE;
      badgeMat.opacity = 1 - k;
      labelMat.opacity = 1 - k;
      plateMat.opacity = (1 - k) * plateK;
      this.glow!.material.opacity = (1 - k) * 0.5;
      raysMat.opacity = (1 - k) * 0.6;
      g.scale.setScalar(1 + k * 0.2);
    } else {
      this.finish();
    }
  }

  private finish(): void {
    this.animating = false;
    setEmberDrawOrder(0); // fire goes back into the world's own sort
    if (this.group) this.group.visible = false;
    if (this.forced) this.forced = false;
    else this.shownTier = this.to;
  }

  private build(): void {
    if (this.group) return;
    const group = new Group();
    group.name = 'promotion-fx';
    group.visible = false;

    // The backing plate, furthest back: the dark room the fire happens in.
    // Tall enough to carry the emblem AND the two lines of label under it,
    // and a little wider than the widest emblem (LEGENDARY/OVERLORD ride a
    // 1.4 zoom), so nothing of the medallion hangs off its own plate.
    const backing = new Mesh(
      new PlaneGeometry(0.78, 0.86),
      new MeshBasicMaterial({
        map: this.plateTexture(),
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: DoubleSide,
      }),
    );
    backing.position.set(0, -0.1, -0.05);
    backing.renderOrder = BAND;
    group.add(backing);

    // Sunburst rays wheeling behind the emblem.
    const rays = new Sprite(
      new SpriteMaterial({
        map: this.sunburstTexture(),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0,
      }),
    );
    rays.scale.setScalar(1.15);
    rays.position.z = -0.02;
    rays.renderOrder = BAND + 1;
    group.add(rays);

    const glow = glowSprite(EMBER, 0.95, 0);
    glow.renderOrder = BAND + 2;
    group.add(glow);

    // Square plane — the emblem art is 1:1, so no more horizontal squish.
    const badge = new Mesh(
      new PlaneGeometry(0.42, 0.42),
      new MeshBasicMaterial({ transparent: true, opacity: 1, depthWrite: false, side: DoubleSide }),
    );
    badge.position.z = 0.002;
    badge.renderOrder = BAND + 3;
    group.add(badge);

    // Swap flash + expanding shockwave ring, in front, additive.
    const flash = glowSprite(0xfff3cf, 1.4, 0);
    flash.position.z = 0.012;
    flash.renderOrder = BAND + 4;
    group.add(flash);

    const ring = new Sprite(
      new SpriteMaterial({
        map: this.ringTexture(),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        opacity: 0,
      }),
    );
    ring.position.z = 0.012;
    ring.renderOrder = BAND + 4;
    group.add(ring);

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 160;
    const labelTex = new CanvasTexture(canvas);
    labelTex.minFilter = LinearFilter;
    const label = new Mesh(
      new PlaneGeometry(0.52, 0.1625),
      new MeshBasicMaterial({ map: labelTex, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }),
    );
    label.position.set(0, -0.33, 0.002);
    label.renderOrder = BAND + 3;
    group.add(label);

    this.scene.add(group);
    this.group = group;
    this.backing = backing;
    this.glow = glow;
    this.rays = rays;
    this.flash = flash;
    this.ring = ring;
    this.badge = badge;
    this.label = label;
    this.labelTex = labelTex;
  }

  /** The smoked-steel backing plate, in the arena's own kit — chamfered,
   *  amber-edged, near-opaque so the passthrough room stops showing through
   *  the celebration. */
  private plateTexture(): Texture {
    const w = 512;
    const h = 564;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    // Inset by the edge glow's blur so the lit tubing isn't cropped.
    const pad = 16;
    plate(ctx, pad, pad, w - pad * 2, h - pad * 2, {
      cut: 34,
      fill: 'rgba(5,6,9,0.96)',
      stroke: UI.amberSoft,
    });
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    return tex;
  }

  /** A radiating sunburst of light spokes (amber → transparent), additive. */
  private sunburstTexture(): Texture {
    const size = 256;
    const c = size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const rays = 14;
    for (let i = 0; i < rays; i++) {
      ctx.save();
      ctx.translate(c, c);
      ctx.rotate((i / rays) * Math.PI * 2);
      const grad = ctx.createLinearGradient(0, 0, 0, -c);
      grad.addColorStop(0, 'rgba(255,243,207,0.9)');
      grad.addColorStop(0.55, 'rgba(255,176,0,0.32)');
      grad.addColorStop(1, 'rgba(255,176,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-7, 0);
      ctx.lineTo(7, 0);
      ctx.lineTo(0, -c);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    return tex;
  }

  /** A glowing annulus for the swap shockwave, additive. */
  private ringTexture(): Texture {
    const size = 128;
    const c = size / 2;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.62, 'rgba(255,255,255,0)');
    g.addColorStop(0.8, 'rgba(255,243,207,0.95)');
    g.addColorStop(0.92, 'rgba(255,176,0,0.4)');
    g.addColorStop(1, 'rgba(255,176,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new CanvasTexture(canvas);
    tex.minFilter = LinearFilter;
    return tex;
  }

  private drawLabel(tierName: string): void {
    const canvas = this.labelTex!.image as HTMLCanvasElement;
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, w, h);
    // No backing plate — the words float free over the flare, kept legible by a
    // heavy dark outline + a soft dark glow behind each glyph.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(4,5,8,0.9)';
    ctx.shadowBlur = 14;

    ctx.font = stencilFont(44);
    ctx.lineWidth = 9;
    ctx.strokeStyle = 'rgba(4,5,8,0.95)';
    ctx.strokeText('PROMOTED', w / 2, 48);
    ctx.fillStyle = UI.amber;
    ctx.fillText('PROMOTED', w / 2, 48);

    // Fit the tier name to width so a long one (LEGENDARY) never overflows.
    const px = fitStencilText(ctx, tierName, w - 72, 60, 28);
    ctx.font = stencilFont(px);
    ctx.lineWidth = 10;
    ctx.strokeStyle = 'rgba(4,5,8,0.95)';
    ctx.strokeText(tierName, w / 2, 114);
    ctx.fillStyle = UI.emberBright;
    ctx.fillText(tierName, w / 2, 114);
    ctx.shadowBlur = 0;
    this.labelTex!.needsUpdate = true;
  }

  private easeOutBack(k: number): number {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  }
}
