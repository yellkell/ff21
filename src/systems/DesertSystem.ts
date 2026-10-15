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
import { Color, Fog, Vector3 } from 'three';
import { app, type AppEnvironment } from '../menu/appState.js';
import { buildDesert, type Desert, type DesertSite } from '../arena/desert/index.js';
import { buildFactory, type Factory } from '../arena/factory/index.js';
import { buildSaltFlats, type SaltFlats } from '../arena/saltflats/index.js';
import { buildCove, type Cove } from '../arena/cove/index.js';
import { buildNeon, type Neon, type NeonSite } from '../arena/neon/index.js';
import { Curtain } from '../experience/Curtain.js';
import { CONFIG } from '../arena/desert/config.js';

/** NEON crossing timings (s): down over the street, a beat of black, up on the other. */
const NEON_FALL = 0.45;
const NEON_HOLD = 0.15;
const NEON_LIFT = 0.6;

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
  /** NEON's crossing between the BACKSTREET (lobby) and the PLAZA (every
   *  fight): the black comes down over the street you're in, the site is
   *  swapped behind it, and it lifts on the other one. Driven from update()
   *  on real session frames, keyed off app.state like the desert's sites,
   *  so every way into or out of a match passes through it. */
  private neonCurtain?: Curtain;
  private crossing: { phase: 'fall' | 'hold' | 'lift'; t: number; to: NeonSite } | null = null;
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
    // Honour the saved choice on boot — except THE COVE, which isn't built
    // yet: update() builds and bakes it, then applies it the frame it's ready.
    if (app.environment !== 'cove' && app.environment !== 'neon') this.apply(app.environment);
  }

  update(delta: number): void {
    this.time += delta;
    if (app.environment === 'cove' && !this.cove?.ready) {
      if (!this.cove) {
        this.cove = buildCove();
        this.scene.add(this.cove.root);
      }
      this.cove.bake(this.world.renderer);
    } else if (app.environment === 'neon' && !this.neon?.ready) {
      if (!this.neon) {
        this.neon = buildNeon(this.world.renderer);
        this.scene.add(this.neon.root);
      }
    } else if (app.environment !== this.applied) this.apply(app.environment);
    // THE SITES: the desert walks you between its three clearings by what
    // you're doing (arena/desert/sites.ts) — the trailhead to wait at, the
    // flats to box on, the boneyard where titans are broken. The swap rides
    // the state flip itself (the bout's own reset/entrance covers the cut),
    // and the frozen shadow map re-bakes once for the new dressing.
    const site = this.siteFor();
    if (this.desert && this.desert.site !== site) {
      this.desert.setSite(site);
      if (app.environment === 'desert') this.world.renderer.shadowMap.needsUpdate = true;
    }
    if (app.environment === 'desert') this.desert?.update(delta, this.time);
    else if (app.environment === 'factory') this.factory?.update(delta, this.time);
    else if (app.environment === 'saltflats') this.saltflats?.update(delta, this.time);
    else if (app.environment === 'cove' && this.applied === 'cove') this.cove?.update(delta, this.time);
    else if (app.environment === 'neon' && this.applied === 'neon') {
      this.crossNeon(delta);
      this.neon?.update(delta, this.time, this.world.camera.getWorldPosition(this.eye));
    }
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

  private crossNeon(delta: number): void {
    const neon = this.neon;
    if (!neon?.ready) return;
    const want = this.neonSiteFor();
    if (!this.crossing && want !== neon.site) this.crossing = { phase: 'fall', t: 0, to: want };
    const c = this.crossing;
    if (!c) return;
    this.neonCurtain ??= new Curtain(this.world.camera);
    c.to = want; // a launch cancelled mid-fall simply lands where it should
    c.t += delta;
    const ease = (t: number) => t * t * (3 - 2 * t);
    if (c.phase === 'fall') {
      this.neonCurtain.set(ease(Math.min(1, c.t / NEON_FALL)));
      if (c.t >= NEON_FALL) {
        neon.setSite(c.to);
        this.world.renderer.shadowMap.needsUpdate = true;
        c.phase = 'hold';
        c.t = 0;
      }
    } else if (c.phase === 'hold') {
      this.neonCurtain.set(1);
      if (c.t >= NEON_HOLD) {
        c.phase = 'lift';
        c.t = 0;
      }
    } else {
      this.neonCurtain.set(1 - ease(Math.min(1, c.t / NEON_LIFT)));
      if (c.t >= NEON_LIFT) {
        this.neonCurtain.set(0);
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
    if (env !== 'neon' && this.crossing) {
      this.crossing = null;
      this.neonCurtain?.set(0);
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
