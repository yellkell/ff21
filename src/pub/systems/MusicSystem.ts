/**
 * The pub JUKEBOX — server-synced local songs.
 *
 * Songs live in src/pub/songs (drop in `.mp3` files, see songs.ts). The pub
 * server holds ONE track the whole room shares (pub.music, −1 = off). Walk up
 * to the cabinet and pull the trigger to cycle off → track 0 → 1 → … → off;
 * that asks the server, which broadcasts the choice to everyone, so the room
 * always hears the same thing (and late joiners catch whatever's on).
 *
 * Playback rides ONE shared MusicTrack (WebAudio, uncached so cycling the
 * catalogue never piles decoded songs into Quest memory) — NEVER an <audio>
 * element: an audible media element trips Meta Browser's media-session crash
 * (see musicTrack.ts), and since the launch-music fix the jukebox would be
 * the session's FIRST media element — the coin-drop crash. The selected song
 * plays ONCE and then stops — it does NOT loop; feed another coin to start
 * the NEXT track. We roll the track's `volume` with distance to the cabinet
 * and duck it while anyone's talking — the walk-up "louder up close" feel.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three';
import { MusicTrack } from '../../audio/musicTrack.js';
import { uiClick } from '../../audio/sfx.js';
import { JUKEBOX } from '../config.js';
import { TRACKS } from '../songs.js';
import { pubSendRaw } from '../net.js';
import { bus, pub } from '../state.js';
import { anyPubVoiceSpeaking } from '../voice/playback.js';

const HANDS = ['left', 'right'] as const;

const _cam = new Vector3();
const _box = new Vector3();
const _aim = new Vector3();
const _rayO = new Vector3();
const _rayDir = new Vector3();
const _toJuke = new Vector3();
const _q = new Quaternion();

// The jukebox is "actionable" exactly when a hand's AIM CONE falls on it —
// the same forgiving touch-cone cue the grabbable props (beer, darts) use,
// rather than mere proximity. Matched to PropSystem's range-grab cone.
const JUKE_AIM_MAX = 1.6; // how far you can stand and still aim at it (m)
const JUKE_AIM_CONE_COS = Math.cos((32 * Math.PI) / 180);
const JUKE_AIM_Y = 1.1; // aim at the cabinet body, not its floor-level origin

const MARQUEE_SCROLL_SPEED = 70; // px/s a too-long title scrolls across the screen

/** Late-join grace: joining a room with a song ON used to fire the full-song
 *  fetch + decode straight into the middle of the pub scene load — a memory
 *  spike that could kill the tab on Quest ("couldn't join while a song was
 *  playing"). Adopting the room's station waits this long after the system
 *  boots so the scene lands first; a local coin (a live gesture in a loaded
 *  scene) skips the wait. */
const JOIN_MUSIC_SETTLE_MS = 10_000;

export class MusicSystem extends createSystem({}) {
  /** The one shared player — src swaps per station, dropping the old decode. */
  private audio: MusicTrack | null = null;
  /** Track currently playing locally (−1 = off) — mirrors pub.music. */
  private station = -1;
  /** A play() the browser blocked (autoplay policy) — retry on the next trigger. */
  private pendingPlay = false;
  /** Playback state of the active track, for the marquee readout. */
  private signal: 'connecting' | 'live' | 'nosignal' = 'connecting';
  /** True once the current track has played to its end — stopped, waiting on a
   *  coin to start the NEXT track (the pointer stays on the finished track). */
  private ended = false;
  /** True while a hand is close enough to interact — the cabinet flares up. */
  private lit = false;
  // --- marquee (LED screen) state ---
  /** Big line: the track title (or a prompt when off). */
  private marqueeMain = 'JUKEBOX';
  /** Small line beneath it: status / track count. */
  private marqueeSub = 'pull trigger to play';
  /** Horizontal scroll offset (px) used only when the title overruns the screen. */
  private marqueeScroll = 0;
  /** Set by the last render: does the main line overflow (and so scroll)? */
  private marqueeScrolls = false;
  /** When the system booted — the late-join settle window counts from here. */
  private readonly bootAt = performance.now();
  /** A station adoption held back by the settle window (see setStation). */
  private settleTimer: ReturnType<typeof setTimeout> | null = null;

  /** Silence the jukebox when the shared app returns to the arena — and drop
   *  the decoded song (src = '') so the pub's memory goes back with you. */
  leaveClub(): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    this.audio?.pause();
    if (this.audio) this.audio.src = '';
    this.station = -1;
    this.pendingPlay = false;
    this.ended = false;
    this.setLit(false);
    this.drawMarquee();
  }

  init(): void {
    // The room (or another punter) chose a station: switch to match.
    this.cleanupFuncs.push(
      bus.on('music', (s) => this.setStation(s)),
      // A coin fed into the jukebox buys one pick — advance off → 0 → 1 → … → off.
      bus.on('coinInserted', (target) => {
        if (target === 'jukebox') this.flip();
      }),
    );
    // Adopt whatever's already on (if welcome landed before us).
    this.setStation(pub.music);
    this.drawMarquee(); // paint the screen once even if the station didn't change
  }

  update(delta: number): void {
    if (!this.player || !pub.refs) return;
    // Spin the fight-hall disco ball — always turning, a touch livelier with a
    // station on so it picks up when the music does.
    pub.refs.discoball.rotation.y += delta * (pub.music >= 0 ? 0.6 : 0.25);
    pub.refs.jukebox.getWorldPosition(_box); // floor centre — for distance volume
    this.camera.getWorldPosition(_cam);
    const jukeDist = Math.hypot(_cam.x - _box.x, _cam.z - _box.z);

    // Scroll a too-long title across the marquee — but ONLY when close enough to
    // read it. A long title was re-rendering + re-uploading the screen texture
    // EVERY frame from anywhere in the pub; gating on distance kills that waste
    // (you can't read a scrolling marquee from across the room anyway).
    if (this.marqueeScrolls && jukeDist < JUKEBOX.hearFar) {
      this.marqueeScroll += delta * MARQUEE_SCROLL_SPEED;
      this.renderMarquee();
    }

    _aim.copy(_box);
    _aim.y += JUKE_AIM_Y; // the point on the cabinet a hand aims at

    // Light the cabinet up when a hand's aim cone falls on it — the same
    // "you can interact with this" cue the grabbable props (beer, darts) give.
    const handAimed: Record<'left' | 'right', boolean> = { left: false, right: false };
    let aimed = false;
    for (const hand of HANDS) {
      const ray = this.player.raySpaces[hand];
      if (!ray) continue;
      ray.getWorldPosition(_rayO);
      ray.getWorldQuaternion(_q);
      _rayDir.set(0, 0, -1).applyQuaternion(_q).normalize();
      _toJuke.copy(_aim).sub(_rayO);
      const dist = _toJuke.length();
      if (dist < 1e-3 || dist > JUKE_AIM_MAX) continue;
      if (_toJuke.divideScalar(dist).dot(_rayDir) < JUKE_AIM_CONE_COS) continue;
      handAimed[hand] = true;
      aimed = true;
    }
    // Light up on aim OR while a coin is held at the slot (the INSERT COIN cue).
    this.setLit(aimed || pub.coinHover === 'jukebox');

    // Picking a track now costs a coin (see the coinInserted handler) — the
    // trigger is kept only to unblock a play() the autoplay policy stalled.
    let triggered = false;
    for (const hand of HANDS) {
      const gp = this.input.xr.gamepads[hand];
      if (gp?.getButtonDown(InputComponent.Trigger)) triggered = true;
    }
    if (this.pendingPlay && triggered) this.resume();

    // Distance volume + voice duck on the active station.
    const audio = this.station >= 0 ? this.audio : null;
    if (audio) {
      const fade = (JUKEBOX.hearFar - jukeDist) / (JUKEBOX.hearFar - JUKEBOX.hearNear);
      let vol = JUKEBOX.volume * Math.max(0, Math.min(1, fade));
      if (anyPubVoiceSpeaking()) vol *= JUKEBOX.duck;
      audio.volume = vol;
    }
  }

  /** Flare the whole cabinet's neon up (or back to rest) when in reach. */
  private setLit(on: boolean): void {
    if (on === this.lit) return;
    this.lit = on;
    const juke = pub.refs?.jukebox;
    if (!juke) return;
    juke.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const mat of mats) {
        const m = mat as MeshStandardMaterial;
        const base = m.userData?.baseGlow as number | undefined;
        if (typeof base === 'number') m.emissiveIntensity = base * (on ? 1.85 : 1);
      }
    });
  }

  /** Cycle off → 0 → 1 → … → off, tell the room, and apply locally right away. */
  private flip(): void {
    if (TRACKS.length === 0) return; // no songs committed yet — nothing to play
    const next = this.station + 1 >= TRACKS.length ? -1 : this.station + 1;
    uiClick();
    if (pub.online) pubSendRaw({ t: 'music', station: next });
    pub.music = next;
    this.applyStation(next); // a coin is a live gesture — no settle wait
  }

  /** Adopt station `s`, holding a song back through the late-join settle
   *  window (see JOIN_MUSIC_SETTLE_MS) so the decode never lands on top of
   *  the scene load. Off (−1) always applies at once. */
  private setStation(s: number): void {
    if (this.settleTimer !== null) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
    }
    const wait = JOIN_MUSIC_SETTLE_MS - (performance.now() - this.bootAt);
    if (s >= 0 && wait > 0) {
      this.settleTimer = setTimeout(() => {
        this.settleTimer = null;
        this.applyStation(pub.music); // the room may have flipped meanwhile
      }, wait);
      return;
    }
    this.applyStation(s);
  }

  /** Switch to `s` (−1 = off): stop the old song, start the new, redraw the marquee. */
  private applyStation(s: number): void {
    if (s === this.station) return;
    this.audio?.pause();
    this.station = s;
    this.pendingPlay = false;
    this.ended = false;
    this.signal = 'connecting';
    if (s >= 0 && s < TRACKS.length) {
      const audio = this.ensureAudio();
      audio.src = TRACKS[s].url; // swap drops the previous song's decode
      audio.currentTime = 0; // always start a freshly-picked track from the top
      audio.volume = 0; // the update loop sets the real level from distance
      this.startPlayback(s, audio);
    }
    this.drawMarquee();
  }

  /** Kick playback and map the outcome onto the marquee: a resolved play()
   *  is the old element's 'playing' event, a rejection its 'error'. */
  private startPlayback(s: number, audio: MusicTrack): void {
    audio.play().then(
      () => {
        if (s === this.station) this.setSignal('live');
      },
      (e: unknown) => {
        if (s === this.station) this.onPlayReject(e);
      },
    );
  }

  /** Retry a play() the autoplay policy blocked — driven by a fresh trigger gesture. */
  private resume(): void {
    this.pendingPlay = false;
    if (this.station >= 0 && this.audio) this.startPlayback(this.station, this.audio);
  }

  /** Tell an autoplay block (retry on a gesture) from a dead stream (show it). */
  private onPlayReject(e: unknown): void {
    if ((e as { name?: string })?.name === 'NotAllowedError') this.pendingPlay = true;
    else this.setSignal('nosignal');
  }

  private setSignal(s: 'connecting' | 'live' | 'nosignal'): void {
    if (this.signal === s) return;
    this.signal = s;
    this.drawMarquee();
  }

  private ensureAudio(): MusicTrack {
    if (!this.audio) {
      // Uncached (cycling the catalogue must not pile decodes up) AND lo-fi
      // (24 kHz mono) — full-fidelity PCM of a whole song was a Quest-killing
      // memory spike, and through a pub jukebox lo-fi IS the aesthetic.
      this.audio = new MusicTrack(undefined, { cache: false, lofi: true });
      this.audio.loop = false; // play once, then stop — a coin starts the next track
      this.audio.volume = 0;
      // Reached the end on its own: stop here (don't replay) and prompt for a
      // coin — the next one advances to the next track. (Manual stops/src
      // swaps never fire onended, so no station check is needed.)
      this.audio.onended = () => {
        this.ended = true;
        this.drawMarquee();
      };
    }
    return this.audio;
  }

  /** Work out what the marquee should say, reset the scroll, and paint it. */
  private drawMarquee(): void {
    if (TRACKS.length === 0) {
      this.marqueeMain = 'JUKEBOX';
      this.marqueeSub = 'add songs to src/pub/songs';
    } else if (this.station < 0) {
      this.marqueeMain = 'JUKEBOX';
      this.marqueeSub = 'insert coin to play';
    } else if (this.ended) {
      // Track finished — stopped, awaiting a coin for the next one.
      this.marqueeMain = 'JUKEBOX';
      this.marqueeSub = 'insert coin for next track';
    } else {
      this.marqueeMain = `♪ ${TRACKS[this.station].name}`;
      this.marqueeSub =
        this.signal === 'nosignal' ? "can't play — trigger to skip"
        : this.signal === 'connecting' ? 'loading…'
        : `track ${this.station + 1} of ${TRACKS.length}`;
    }
    this.marqueeScroll = 0;
    this.renderMarquee();
  }

  /**
   * Paint the marquee as a small amber LED screen set in the cabinet's steel
   * bezel: a big title line and a small status line. A title wider than the
   * screen scrolls (looping) instead of being shrunk to nothing.
   */
  private renderMarquee(): void {
    const panel = pub.refs?.jukeboxPanel;
    if (!panel) return;
    const danger = this.station >= 0 && this.signal === 'nosignal';
    panel.draw((ctx, w, h) => {
      // Dark LED screen inset within the steel plate.
      const m = 12;
      ctx.fillStyle = '#0b0f0d';
      ctx.fillRect(m, m, w - 2 * m, h - 2 * m);
      ctx.strokeStyle = 'rgba(255,176,0,0.4)';
      ctx.lineWidth = 2;
      ctx.strokeRect(m, m, w - 2 * m, h - 2 * m);

      const padX = m + 14;
      const screenW = w - 2 * padX;
      const mainY = h * 0.42;
      const subY = h * 0.74;

      // --- big title line (scrolls if it overruns) ---
      ctx.textBaseline = 'middle';
      ctx.font = "900 46px 'Arial Black', 'Arial Narrow', system-ui, sans-serif";
      const titleW = ctx.measureText(this.marqueeMain).width;
      ctx.save();
      ctx.beginPath();
      ctx.rect(padX, m, screenW, h - 2 * m);
      ctx.clip();
      ctx.fillStyle = '#ffb000';
      ctx.shadowColor = '#ff7a18';
      ctx.shadowBlur = 14;
      if (titleW <= screenW) {
        this.marqueeScrolls = false;
        ctx.textAlign = 'center';
        ctx.fillText(this.marqueeMain, w / 2, mainY);
      } else {
        // Loop two copies separated by a gap so it reads continuously.
        this.marqueeScrolls = true;
        const gap = 64;
        const period = titleW + gap;
        const off = ((this.marqueeScroll % period) + period) % period;
        ctx.textAlign = 'left';
        ctx.fillText(this.marqueeMain, padX - off, mainY);
        ctx.fillText(this.marqueeMain, padX - off + period, mainY);
      }
      ctx.restore();

      // --- small status line ---
      ctx.shadowBlur = 0;
      ctx.textAlign = 'center';
      ctx.font = "700 24px 'Arial Narrow', system-ui, sans-serif";
      ctx.fillStyle = danger ? '#ff5a4a' : 'rgba(174,182,194,0.9)';
      ctx.fillText(this.marqueeSub, w / 2, subY);
    });
  }
}
