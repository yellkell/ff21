/**
 * THE COVE's sound: the sea, the palms, the crickets coming up at dusk, and
 * the fires crackling.
 *
 * The recordings are Tidewater's CC0 set (src/assets/cove/CREDITS.md), and
 * so is the idea that makes them sing: the surf isn't a loop, it is TIMED
 * TO THE WAVES YOU CAN SEE. The same closed-form swell that shapes the sea
 * (water.ts) says when a crest trips on the bar and when its bore runs up
 * the sand, so a crash sounds as each wave breaks out there and the swash
 * hisses up and drains back at your end of the beach — at three points
 * along it, so the sets roll across the bay.
 *
 * Everything rides FIRE FIGHT's own AudioContext and SFX fader (sfxOut),
 * positioned with PannerNodes the same way the tutor's voice is. The fire
 * crackle is synthesised: short band-passed noise pops, per fire, at random.
 *
 * It only sounds while the cove is actually on screen: DesertSystem feeds
 * `update(time, active)`; if updates stop (the arena systems pause for a
 * club visit) a watchdog fades it out.
 */

import { audioContext, sfxOut } from '../../audio/sfx.js';
import surfFarUrl from '../../assets/cove/surf_far.ogg?url';
import surfCrashUrl from '../../assets/cove/surf_crash.ogg?url';
import surfWashUrl from '../../assets/cove/surf_wash.ogg?url';
import surfBackwashUrl from '../../assets/cove/surf_backwash.ogg?url';
import cricketsUrl from '../../assets/cove/crickets.ogg?url';
import palmsUrl from '../../assets/cove/palms.ogg?url';
import { SEA_Y, SWELL_PERIOD, shoreZ } from './shape.js';
import type { FireSpot } from './bonfires.js';

/** Tidewater's slice tables (soundBank.js): [start, duration] seconds. */
const CRASH: [number, number][] = [[0.08, 3.254], [3.414, 2.504], [5.998, 2.554], [8.632, 1.304], [10.016, 2.804], [12.9, 2.204], [15.184, 2.749]];
const WASH: [number, number][] = [[0.08, 1.404], [1.564, 2.054], [3.698, 1.504], [5.282, 1.354], [6.716, 1.904], [8.7, 1.154]];
const BACKWASH: [number, number][] = [[0.08, 1.804], [1.964, 1.904], [3.948, 3.804], [7.832, 2.254], [10.166, 2.394], [12.64, 2.404]];

const OMEGA = (2 * Math.PI) / SWELL_PERIOD;
/** JS twins of water.ts's coveTau / coveAlong — keep them in step. */
function tau(d: number): number {
  d = Math.max(d, 0);
  let t = 2.857 * Math.sqrt(Math.min(d, 70));
  if (d > 70) t += 10.64 * (Math.sqrt(3.5 + 0.06 * Math.min(d - 70, 190)) - 1.8708);
  if (d > 260) t += (d - 260) / 12;
  return t;
}
function along(x: number): number {
  return 0.011 * x + 1.3 * Math.sin(x * 0.0085 + 0.7) + 0.5 * Math.sin(x * 0.031);
}
/** Where on its cycle the swell is at coast distance d (0..1, 0 = crest). */
function cycle(time: number, x: number, d: number): number {
  const th = OMEGA * (time + tau(d)) + along(x);
  return ((th / (2 * Math.PI)) % 1 + 1) % 1;
}
/** How big this wave of the set is (the same set envelope the sea uses). */
function setK(time: number, x: number, d: number): number {
  const th = OMEGA * (time + tau(d)) + along(x);
  return 0.78 + 0.22 * Math.sin(th / 6.3 + x * 0.004);
}

/** Three listening points along the beach: the sets roll across the bay. */
const SURF_X = [-42, 4, 48];
/** The bar the waves break on (coast distance, m). */
const BAR = 44;

interface Bank {
  far: AudioBuffer;
  crash: AudioBuffer;
  wash: AudioBuffer;
  backwash: AudioBuffer;
  crickets: AudioBuffer;
  palms: AudioBuffer;
  noise: AudioBuffer;
}

export interface CoveSound {
  update(time: number, delta: number, active: boolean): void;
}

export function createCoveSound(fires: FireSpot[]): CoveSound {
  let bank: Bank | null = null;
  let loading = false;
  let master: GainNode | null = null;
  let started = false;
  let lastUpdate = 0;
  let watchdog = 0;
  const lastCycle = new Map<string, number>();

  const panner = (ctx: AudioContext, x: number, y: number, z: number, ref: number, rolloff = 1): PannerNode => {
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 10000;
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
    p.connect(master!);
    return p;
  };

  const load = async (ctx: AudioContext): Promise<void> => {
    loading = true;
    const get = async (url: string): Promise<AudioBuffer> => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    try {
      const [far, crash, wash, backwash, crickets, palms] = await Promise.all(
        [surfFarUrl, surfCrashUrl, surfWashUrl, surfBackwashUrl, cricketsUrl, palmsUrl].map(get),
      );
      // one second of white noise, shared by every crackle pop
      const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const ch = noise.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      bank = { far, crash, wash, backwash, crickets, palms, noise };
    } catch (e) {
      console.warn('[cove] sound failed to load', e);
    }
  };

  const loop = (ctx: AudioContext, buf: AudioBuffer, gain: number, at: PannerNode): void => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(at);
    // start somewhere in the loop so it never opens on its crossfade
    src.start(0, Math.random() * buf.duration);
  };

  const slice = (ctx: AudioContext, buf: AudioBuffer, table: [number, number][], gain: number, at: PannerNode, rate = 1): void => {
    const [start, dur] = table[Math.floor(Math.random() * table.length)];
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g).connect(at);
    src.start(0, start, dur);
  };

  /** Every loop and every fixed source, once the bank is decoded. */
  let surfPans: PannerNode[] = [];
  let barPans: PannerNode[] = [];
  let firePans: { p: PannerNode; rate: number; amp: number }[] = [];
  const start = (ctx: AudioContext, b: Bank): void => {
    started = true;
    // the sea's roar, wide across the bay ahead; the palms and the crickets behind
    // (kept LOW: it's the bed the wave-timed crashes and swashes sit on —
    // any louder and it reads as a constant hum)
    loop(ctx, b.far, 0.16, panner(ctx, -60, SEA_Y, -140, 40, 0.6));
    loop(ctx, b.far, 0.13, panner(ctx, 90, SEA_Y, -120, 40, 0.6));
    loop(ctx, b.palms, 0.16, panner(ctx, 0, 8, 30, 12, 0.5));
    loop(ctx, b.crickets, 0.3, panner(ctx, -25, 2, 45, 10, 0.5));
    loop(ctx, b.crickets, 0.22, panner(ctx, 40, 2, 55, 10, 0.5));
    surfPans = SURF_X.map((x) => panner(ctx, x, SEA_Y, shoreZ(x) + 1, 6));
    barPans = SURF_X.map((x) => panner(ctx, x, SEA_Y, shoreZ(x) - BAR, 14));
    // only fires you could hear crackle: the cliff-top signal fires are
    // hundreds of metres off, and every pop is a few nodes' worth of work
    firePans = fires
      .filter((f) => Math.hypot(f.x, f.z) < 130)
      .map((f) => ({
        p: panner(ctx, f.x, f.y + 0.4, f.z, f.torch ? 1.2 : 3.5),
        rate: f.torch ? 2 : 5 * f.size,
        amp: f.torch ? 0.35 : 0.9,
      }));
  };

  /** One crackle: a few ms of band-passed noise with a snap of an envelope. */
  const pop = (ctx: AudioContext, b: Bank, at: PannerNode, amp: number): void => {
    const src = ctx.createBufferSource();
    src.buffer = b.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 3200;
    bp.Q.value = 1.5 + Math.random() * 5;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    const len = 0.015 + Math.random() * 0.05;
    const peak = amp * (0.3 + Math.random() * 0.7) * (Math.random() < 0.08 ? 2.2 : 1); // the odd loud snap
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(bp).connect(g).connect(at);
    src.start(t, Math.random() * 0.9, len + 0.02);
  };

  /** Fade the whole cove in or out — only on a change: rescheduling the
   *  ramp every frame would make the gain jump. */
  let target = -1;
  const fade = (to: number, secs: number): void => {
    const ctx = audioContext();
    if (!ctx || !master || to === target) return;
    target = to;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setTargetAtTime(to, ctx.currentTime, secs / 3);
  };

  return {
    update(time, delta, active) {
      const ctx = audioContext();
      if (!ctx) return;
      if (!master) {
        master = ctx.createGain();
        master.gain.value = 0;
        master.connect(sfxOut() ?? ctx.destination);
      }
      lastUpdate = performance.now();
      if (!watchdog) {
        // the arena systems stop during a club visit: no updates → go quiet
        watchdog = window.setInterval(() => {
          if (performance.now() - lastUpdate > 400) fade(0, 0.8);
        }, 250);
      }
      if (!active) {
        fade(0, 1.2);
        return;
      }
      if (!bank) {
        if (!loading) void load(ctx);
        return;
      }
      if (!started) start(ctx, bank);
      fade(1, 2.5);
      if (ctx.state !== 'running') return;

      // ---- the surf, wave by wave
      SURF_X.forEach((x, i) => {
        // a crest trips on the bar: the crash
        const cb = cycle(time, x, BAR);
        const kb = `b${i}`;
        const pb = lastCycle.get(kb);
        if (pb !== undefined && cb < pb) {
          const big = setK(time, x, BAR);
          slice(ctx, bank!.crash, CRASH, 0.5 * big * big, barPans[i], 0.92 + Math.random() * 0.12);
        }
        lastCycle.set(kb, cb);
        // its bore arrives: the uprush, then the backwash a third of a period on
        const cs = cycle(time, x, 0);
        const ks = `s${i}`;
        const ps = lastCycle.get(ks);
        if (ps !== undefined) {
          if (cs < ps) slice(ctx, bank!.wash, WASH, 0.55 * setK(time, x, 0), surfPans[i]);
          if (ps < 0.34 && cs >= 0.34) slice(ctx, bank!.backwash, BACKWASH, 0.4, surfPans[i]);
        }
        lastCycle.set(ks, cs);
      });

      // ---- the fires
      for (const f of firePans) {
        let n = f.rate * delta;
        while (n > 0) {
          if (Math.random() < Math.min(1, n)) pop(ctx, bank!, f.p, f.amp);
          n -= 1;
        }
      }
    },
  };
}
