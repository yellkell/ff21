/**
 * The optional opaque ARENA BACKDROPS — the papercraft DESERT and the
 * dilapidated FACTORY (both ported/built in the spirit of yellkell/vrenv).
 * Builds each once, hidden, then shows the one matching `app.environment`
 * ('ar' | 'desert' | 'cove' | …) — a toggle that holds across the lobby, bot
 * bouts, quick matches and Aim Training because it's keyed off a setting.
 *
 * AR ↔ backdrop is a render switch, not a session switch: in immersive-AR
 * opaque geometry replaces the passthrough feed, so showing an opaque sky dome
 * (and clearing the frame opaque) paints the real room out; hiding it and
 * clearing transparent again brings passthrough back. No new "Enter VR" gesture.
 */

import { createSystem } from '@iwsdk/core';
import { Color, Fog, Vector3, type Object3D } from 'three';
import { app, type AppEnvironment } from '../menu/appState.js';
import { buildDesert, type Desert, type DesertSite } from '../arena/desert/index.js';
import { buildFactory, type Factory } from '../arena/factory/index.js';
import { buildSaltFlats, type SaltFlats } from '../arena/saltflats/index.js';
import { buildCove, type Cove } from '../arena/cove/index.js';
import { buildNeon, type Neon, type NeonSite } from '../arena/neon/index.js';
import { setFoeStageShown } from '../arena/arena.js';
import { Curtain } from '../experience/Curtain.js';
import { CONFIG } from '../arena/desert/config.js';

/** Crossing timings (s): down over where you stand, a beat of black, up on the other. */
const CROSS_FALL = 0.45;
const CROSS_HOLD = 0.15;
const CROSS_LIFT = 0.6;

/** A backdrop that is more than one place: the lobby stands in one site,
 *  the fights in another (NEON's backstreet → plaza, the desert's
 *  trailhead → flats / boneyard). */
type Site = NeonSite | DesertSite;

export class DesertSystem extends createSystem({}) {
  private desert?: Desert;
  private factory?: Factory;
  private saltflats?: SaltFlats;
  private saltFog?: Fog;
  /** THE COVE is built on first choice, not at boot, and bakes its sky a
   *  strip a frame; until it's ready the old backdrop stays up. */
  private cove?: Cove;
  /** NEON streams its districts on first choice; shown once they land. */
  private neon?: Neon;
  private eye = new Vector3();
  /** THE CROSSING between a sited backdrop's lobby and its fight ground
   *  (NEON: the BACKSTREET and the PLAZA; the DESERT: the trailhead and the
   *  flats or the boneyard): the black comes down over where you stand, the
   *  site is swapped behind it, and it lifts on the other one. Driven from
   *  update() on real session frames, keyed off app.state, so every way
   *  into or out of a match passes through it. */
  private curtain?: Curtain;
  private crossing: { phase: 'fall' | 'hold' | 'lift'; t: number; to: Site } | null = null;
  /** THE VEIL. Everything a match brings with it (the rival and their pad,
   *  a titan, the tutorial's orb, the scoreboards, the 3-2-1) is switched on
   *  the moment you pick it — while you're still standing in the lobby. So
   *  until the crossing has swapped the site behind full black, anything
   *  top-level that wasn't up in the lobby is held out of the render. It
   *  is hidden for ONE render at a time and put straight back afterwards
   *  (scene.onAfterRender), so the systems that own those things never see
   *  their own visibility change underneath them. */
  private lobbyShown = new Set<Object3D>();
  private veiled: Object3D[] = [];
  private applied: AppEnvironment | null = null;
  private time = 0;
  private desertSky = new Color(CONFIG.sky.horizon);

  init(): void {
    // Shadows compiled in once up front so flipping a backdrop on later never
    // forces a material recompile mid-session; with no sun in AR they're free.
    this.world.renderer.shadowMap.enabled = true;
    // Nothing that casts a shadow ever MOVES (only the static desert props do),
    // so the shadow map is identical every frame — render it once per backdrop
    // change instead of every frame. A real GPU saving with no visible change.
    this.world.renderer.shadowMap.autoUpdate = false;

    this.desert = buildDesert();
    this.scene.add(this.desert.root);
    this.factory = buildFactory();
    this.scene.add(this.factory.root);
    this.saltflats = buildSaltFlats();
    this.scene.add(this.saltflats.root);
    // The salt flats read as infinite by fogging the far pan into the horizon
    // band. Near start (30 m) is well beyond the fighters/platforms (≤3 m), so
    // only the distance hazes. Applied/cleared per backdrop in apply().
    this.saltFog = new Fog(this.saltflats.skyColor.getHex(), 30, 700);
    // Honour the saved choice on boot — except THE COVE and NEON, which
    // aren't ready yet: they start NOW (the landing waits on them, see
    // backdropReady) and update() applies each the frame it's ready.
    if (app.environment === 'neon') this.buildNeon();
    else if (app.environment === 'cove') this.buildCove();
    else this.apply(app.environment);

    const scene = this.scene;
    const after = scene.onAfterRender.bind(scene);
    scene.onAfterRender = (...args: Parameters<typeof scene.onAfterRender>) => {
      after(...args);
      this.unveil();
    };
  }

  /** The chosen backdrop is whole: built, streamed in, baked. */
  get backdropReady(): boolean {
    if (app.environment === 'neon') return !!this.neon?.ready;
    if (app.environment === 'cove') return !!this.cove?.ready;
    return true;
  }

  /** 0..1 toward backdropReady, where the backdrop can say. */
  get backdropProgress(): number {
    if (app.environment === 'neon') return this.neon?.progress ?? 0;
    if (app.environment === 'cove') return this.cove?.ready ? 1 : 0;
    return 1;
  }

  private buildNeon(): void {
    if (this.neon) return;
    this.neon = buildNeon(this.world.renderer);
    this.scene.add(this.neon.root);
  }

  private buildCove(): void {
    if (this.cove) return;
    this.cove = buildCove();
    this.scene.add(this.cove.root);
  }

  update(delta: number): void {
    this.time += delta;
    // Normally a no-op: the last render already put the veil back. Only a
    // frame that never reached the renderer leaves anything hidden here.
    this.unveil();
    if (app.environment === 'cove' && !this.cove?.ready) {
      this.buildCove();
      this.cove!.bake(this.world.renderer);
    } else if (app.environment === 'neon' && !this.neon?.ready) {
      this.buildNeon();
    } else if (app.environment !== this.applied) this.apply(app.environment);
    // THE SITES: the desert walks you between its three clearings by what
    // you're doing (arena/desert/sites.ts) — the trailhead to wait at, the
    // flats to box on, the boneyard where titans are broken. While it's on
    // screen the crossing carries you (below); off screen it just follows,
    // so it's already on the right site whenever it's chosen.
    if (this.desert && !(app.environment === 'desert' && this.applied === 'desert')) {
      const site = this.siteFor();
      if (this.desert.site !== site) this.desert.setSite(site);
    }
    this.cross(delta);
    if (app.environment === 'desert') this.desert?.update(delta, this.time);
    else if (app.environment === 'factory') this.factory?.update(delta, this.time);
    else if (app.environment === 'saltflats') this.saltflats?.update(delta, this.time);
    else if (app.environment === 'cove' && this.applied === 'cove') this.cove?.update(delta, this.time);
    else if (app.environment === 'neon' && this.applied === 'neon') {
      this.neon?.update(delta, this.time, this.world.camera.getWorldPosition(this.eye));
    }
    // A match is switched on the moment it's picked, but it belongs to the
    // fight ground: until the crossing has carried you there, hold its
    // things (and everyone else's pads) back.
    const fighting = app.state === 'playing' || app.state === 'training';
    const site = this.placeSite();
    const away = fighting && site !== null && site !== this.wantSite();
    setFoeStageShown(!away);
    if (away) this.veil();
    else if (!fighting && !this.crossing) this.noteLobby();
  }

  /** Remember what stands in the lobby (top level), at rest there. */
  private noteLobby(): void {
    this.lobbyShown.clear();
    for (const root of [this.scene, this.world.getActiveRoot()]) {
      for (const c of root.children) if (c.visible) this.lobbyShown.add(c);
    }
  }

  /** Hold everything the lobby didn't have out of THIS frame's render. */
  private veil(): void {
    for (const root of [this.scene, this.world.getActiveRoot()]) {
      for (const c of root.children) {
        if (!c.visible || this.lobbyShown.has(c)) continue;
        c.visible = false;
        this.veiled.push(c);
      }
    }
  }

  private unveil(): void {
    if (this.veiled.length === 0) return;
    for (const c of this.veiled) c.visible = true;
    this.veiled.length = 0;
  }

  /** Which desert site the current activity stands in: every campaign
   *  fight (solo or raid) is the boneyard, every other bout and Aim
   *  Training the flats, and the lobby — including a raid room's seats
   *  and browser — the trailhead. */
  private siteFor(): DesertSite {
    if (app.state === 'playing' && app.mode === 'campaign') return 'boneyard';
    if (app.state === 'playing' || app.state === 'training') return 'flats';
    return 'trailhead';
  }

  /** Which NEON site the current activity belongs in. */
  private neonSiteFor(): NeonSite {
    return app.state === 'playing' || app.state === 'training' ? 'plaza' : 'backstreet';
  }

  /** The site on screen, or null when the backdrop up is only one place
   *  (or isn't ready to be anywhere yet). */
  private placeSite(): Site | null {
    if (app.environment === 'neon' && this.applied === 'neon' && this.neon?.ready) return this.neon.site;
    if (app.environment === 'desert' && this.applied === 'desert' && this.desert) return this.desert.site;
    return null;
  }

  /** The site the current activity belongs in, for the backdrop on screen. */
  private wantSite(): Site {
    return app.environment === 'neon' ? this.neonSiteFor() : this.siteFor();
  }

  private setPlaceSite(site: Site): void {
    if (app.environment === 'neon') this.neon?.setSite(site as NeonSite);
    else this.desert?.setSite(site as DesertSite);
    // The frozen shadow map re-bakes once for the new dressing.
    this.world.renderer.shadowMap.needsUpdate = true;
  }

  private cross(delta: number): void {
    const site = this.placeSite();
    if (site === null) return;
    const want = this.wantSite();
    if (!this.crossing && want !== site) this.crossing = { phase: 'fall', t: 0, to: want };
    const c = this.crossing;
    if (!c) return;
    this.curtain ??= new Curtain(this.world.camera);
    c.to = want; // a launch cancelled mid-fall simply lands where it should
    c.t += delta;
    const ease = (t: number) => t * t * (3 - 2 * t);
    if (c.phase === 'fall') {
      this.curtain.set(ease(Math.min(1, c.t / CROSS_FALL)));
      if (c.t >= CROSS_FALL) {
        if (c.to !== site) this.setPlaceSite(c.to);
        c.phase = 'hold';
        c.t = 0;
      }
    } else if (c.phase === 'hold') {
      this.curtain.set(1);
      if (c.t >= CROSS_HOLD) {
        c.phase = 'lift';
        c.t = 0;
      }
    } else {
      this.curtain.set(1 - ease(Math.min(1, c.t / CROSS_LIFT)));
      if (c.t >= CROSS_LIFT) {
        this.curtain.set(0);
        this.crossing = null;
      }
    }
  }

  /** Re-assert the selected arena backdrop after an opaque club visit. */
  restoreEnvironment(): void {
    this.apply(app.environment);
  }

  /** Swap the backdrop: an opaque desert/saltflats/factory dome vs transparent AR passthrough. */
  private apply(env: AppEnvironment): void {
    this.applied = env;
    if (this.desert) this.desert.root.visible = env === 'desert';
    if (this.factory) this.factory.root.visible = env === 'factory';
    if (this.saltflats) this.saltflats.root.visible = env === 'saltflats';
    if (this.cove) this.cove.root.visible = env === 'cove';
    if (this.neon) {
      this.neon.root.visible = env === 'neon';
      this.neon.setShown(env === 'neon');
      // Arriving in NEON (boot, or a settings switch) lands straight on the
      // right site — the curtain is only for crossings while you're there.
      if (env === 'neon') this.neon.setSite(this.neonSiteFor());
    }
    if (this.desert && env === 'desert') this.desert.setSite(this.siteFor());
    // A crossing belongs to the backdrop it started in.
    if (this.crossing) {
      this.crossing = null;
      this.curtain?.set(0);
    }
    // Fog only where a backdrop melts into its horizon (the salt pan, the
    // cove's sea); cleared otherwise so it never tints the desert/AR.
    this.scene.fog =
      env === 'saltflats'
        ? this.saltFog ?? null
        : env === 'cove' && this.cove
          ? this.cove.fog
          : env === 'neon' && this.neon
            ? this.neon.fog
            : null;
    // Re-bake the (otherwise frozen) shadow map once to reflect the new backdrop.
    this.world.renderer.shadowMap.needsUpdate = true;

    const renderer = this.world.renderer;
    if (env === 'ar') {
      // Back to passthrough: transparent backdrop, transparent clear.
      this.scene.background = null;
      renderer.setClearAlpha(0);
    } else {
      // Opaque sky so passthrough is fully painted out behind the scene.
      this.scene.background =
        env === 'factory' && this.factory
          ? this.factory.skyColor
          : env === 'saltflats' && this.saltflats
            ? this.saltflats.skyColor
            : env === 'cove' && this.cove
              ? this.cove.skyColor
              : env === 'neon' && this.neon
                ? this.neon.skyColor
                : this.desertSky;
      renderer.setClearAlpha(1);
    }
  }
}
