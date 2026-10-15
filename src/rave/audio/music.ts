/**
 * THE DECKS — real-file music playback and the beat clock the whole game
 * runs on.
 *
 * The clock contract is unchanged from the synth days: something declares
 * "game beat 0 happens at AudioContext time T", and every system (telegraph
 * starts, landings, the GOOPLIATH's bounce, the lights) derives its timing
 * from `beatNow()`. What's new is that T is now pinned to a real recording:
 *
 *     beat 0  =  file start  +  track.downbeat  +  countIn beats
 *
 * Because an AudioBufferSourceNode plays at exactly 1.0 rate off the audio
 * hardware clock, the only error left is tempo precision — measured to
 * ±0.005 BPM, i.e. under 10 ms of drift across a four-minute set.
 *
 * Signal chain (per slot):  source → track gain (LUFS match) → music bus
 * (user volume) → limiter → out. The limiter is the safety net that lets a
 * −8 LUFS master and a −15.7 LUFS master share one mix without either
 * disappearing or clipping.
 *
 * If a file can't be decoded — a browser without AAC, a bad network — the
 * synthesised set from techno.ts takes over at the same BPM and the game
 * carries on. Nobody gets a silent raid.
 */

import { audioContext, ensureAudio, sfxOut } from './sfx.js';
import * as synth from './techno.js';
import { beatLenOf, trackGain, type Track } from './tracks.js';

const MUSIC_VOL_KEY = 'gdr-music-vol';

export type SetState = 'off' | 'loading' | 'scheduled' | 'playing' | 'synth';

export interface SetOptions {
  track: Track;
  /** The CHART tempo the beat clock runs at. Defaults to the track's
   *  measured tempo; EXPERT hands in the doubled clock for slow records
   *  (see config.chartBpm) — the file plays untouched either way, only the
   *  grid the game counts on changes. */
  bpm?: number;
  /** Beats of count-in before game beat 0 (the "get ready" bars). */
  countInBeats: number;
  /** Set length in beats — the last landing lives before this. */
  endBeat: number;
  /** Seeds the fallback synth if the file won't decode. */
  seed: number;
  /** Musical intensity 0..3 for a beat (drives the fallback synth only). */
  actAt: (beat: number) => number;
  /** Online: the shared AudioContext time for beat 0. */
  beatZeroAt?: number;
  /**
   * Loop the record (rehearsals, which run until you clear them and can
   * outlast the song). The loop is cut to a whole number of BARS from the
   * first downbeat, so the audio re-enters exactly in phase and the beat
   * clock — which just keeps counting — stays true.
   */
  loop?: boolean;
}

let musicVol = ((): number => {
  try {
    const n = parseFloat(localStorage.getItem(MUSIC_VOL_KEY) ?? '');
    return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0.6;
  } catch {
    return 0.6;
  }
})();

const buffers = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();

let bus: GainNode | null = null;
let limiter: DynamicsCompressorNode | null = null;

/** The live set slot. */
let setSrc: AudioBufferSourceNode | null = null;
let setGain: GainNode | null = null;
let setTrack: Track | null = null;
let beatZero = 0;
let beatLen = 0.5;
let state: SetState = 'off';
let setToken = 0; // guards against a slow decode landing after a new start

/** The lobby loop slot. */
let ambSrc: AudioBufferSourceNode | null = null;
let ambGain: GainNode | null = null;
let ambTrack: Track | null = null;
let ambZero = 0;
let ambToken = 0;
let ambBase = 0;
let ambDuck = 1;
/** THE QUIET FLOOR — the club's own music switch (SOCIAL panel, right Ⓐ).
 *  A mute here closes the room loop's FADER and nothing else: the record
 *  keeps spinning, so ambientBeat() keeps publishing and the eclipse, the
 *  ball, the DJ and every dancer on the floor keep their pulse. Everyone
 *  else in the room can still hear it — this is a local preference, the
 *  same law as MUTE and BLOCK — so a hushed headset must not stop the
 *  party it is standing in. */
let ambMuted = false;
/** The still room's door, as a filter: the muffle stage the loop runs
 *  through so a duck sounds like a wall and not like a volume knob. */
let ambMuffle: BiquadFilterNode | null = null;
/** The rotation: the records the room trades between, and where it is. */
let ambSet: Track[] = [];
let ambIdx = 0;
let ambKey = '';

export function musicVolume(): number {
  return musicVol;
}

export function setMusicVolume(v: number): void {
  musicVol = Math.min(1, Math.max(0, v));
  try {
    localStorage.setItem(MUSIC_VOL_KEY, String(musicVol));
  } catch {
    /* storage may be unavailable */
  }
  if (bus) bus.gain.value = musicVol;
  synth.setMusicVolume(musicVol);
}

function ctx(): AudioContext | null {
  ensureAudio();
  return audioContext();
}

function chain(c: AudioContext): GainNode {
  if (bus) return bus;
  bus = c.createGain();
  bus.gain.value = musicVol;
  limiter = c.createDynamicsCompressor();
  // A brick-ish safety limiter: the masters here span 9.9 dB and a couple
  // of them already clip their own true peak, so the mix gets a net.
  // AWAKENING is the reason the spread is that wide — at −17.4 LUFS the
  // gain match lifts it +3.4 dB, which puts its peak over on a full slider.
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.25;
  bus.connect(limiter);
  const out = sfxOut();
  limiter.connect(out ? out.context.destination : c.destination);
  return bus;
}

/**
 * THE MUSIC BUS itself — the user's music fader, ahead of the limiter.
 *
 * The course's kit (course/conductor.ts) is SYNTHESISED live rather than
 * played off a file, so it has nowhere to plug in through startSet; it hangs
 * here instead, which puts it behind the same slider as every record and
 * under the same safety limiter. Builds the chain on first ask, like the
 * decks do.
 */
export function musicBus(): GainNode | null {
  const c = ctx();
  return c ? chain(c) : null;
}

/** Fetch + decode a track (cached). Returns null if it can't be decoded. */
export function loadTrack(track: Track): Promise<AudioBuffer | null> {
  const hit = buffers.get(track.id);
  if (hit) return Promise.resolve(hit);
  const pending = loading.get(track.id);
  if (pending) return pending;

  const job = (async (): Promise<AudioBuffer | null> => {
    try {
      const c = ctx();
      if (!c) return null;
      const res = await fetch(track.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = await res.arrayBuffer();
      const buf = await c.decodeAudioData(bytes);
      buffers.set(track.id, buf);
      return buf;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`[music] ${track.id} unavailable — falling back to the synth`, err);
      return null;
    } finally {
      loading.delete(track.id);
    }
  })();
  loading.set(track.id, job);
  return job;
}

/** Warm a track so the drop is instant (called from the lobby). */
export function preload(track: Track): void {
  void loadTrack(track);
}

export function setPlaybackState(): SetState {
  return state;
}

export function setRunning(): boolean {
  return state === 'playing' || state === 'scheduled' || state === 'synth';
}

/** Continuous song position in beats — negative through the count-in. */
export function beatNow(): number {
  if (state === 'synth') return synth.beatNow();
  if (state === 'off' || state === 'loading') return -Infinity;
  const c = audioContext();
  const now = c ? c.currentTime : performance.now() / 1000;
  if (state === 'scheduled' && now >= beatZero - beatLen * 0.5) state = 'playing';
  return (now - beatZero) / beatLen;
}

/** AudioContext time of a song beat — for scheduling one-shots on the grid. */
export function timeOfBeat(beat: number): number {
  return beatZero + beat * beatLen;
}

export function currentTrack(): Track | null {
  return setTrack;
}

/**
 * Drop the needle. Resolves the "beat 0 at time T" contract immediately when
 * the track is already decoded; otherwise it loads first and schedules as
 * soon as it can (an online set keeps its dictated beat-zero and simply
 * starts mid-file if the decode ran long).
 */
export function startSet(opts: SetOptions): void {
  stopSet(0.12);
  const token = ++setToken;
  const track = opts.track;
  setTrack = track;
  beatLen = 60 / (opts.bpm ?? track.bpm);
  state = 'loading';

  const c = ctx();
  if (!c) {
    fallback(opts);
    return;
  }

  void loadTrack(track).then((buf) => {
    if (token !== setToken) return; // a newer set already started
    if (!buf) {
      fallback(opts);
      return;
    }
    const now = c.currentTime;
    const lead = 0.12;
    const fileZero = Math.max(track.downbeat, track.startAt ?? 0);
    // THE NEEDLE DROP. `startAt` is where the record actually begins for us —
    // the needle goes down THERE, so a long quiet intro is not something the
    // room waits through, it simply never plays. (Without a startAt this is
    // 0 and the file rolls from its head, exactly as before.)
    const skip = Math.max(0, Math.min(track.startAt ?? 0, Math.max(0, buf.duration - 1)));
    // Where beat 0 lands: dictated online, else as soon as we can play.
    const zero = opts.beatZeroAt ?? now + lead + fileZero - skip + opts.countInBeats * beatLen;
    // File position `skip` must be HEARD at (zero − (fileZero − skip) − countIn),
    // which keeps beat 0 exactly countIn beats after the file's own fileZero
    // however deep into the record the needle went down.
    const fileStart = zero - (fileZero - skip) - opts.countInBeats * beatLen;

    const gain = c.createGain();
    gain.gain.value = trackGain(track);
    gain.connect(chain(c));

    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    if (opts.loop) {
      // The AUDIO loops on the record's own bars, whatever clock the chart
      // runs — a doubled beat grid must never cut the music mid-bar.
      const bar = beatLenOf(track) * 4;
      const bars = Math.floor((buf.duration - track.downbeat) / bar);
      if (bars >= 4) {
        src.loop = true;
        src.loopStart = track.downbeat;
        src.loopEnd = track.downbeat + bars * bar;
      }
    }
    if (fileStart >= now + 0.02) {
      src.start(fileStart, skip);
    } else {
      // Late (slow decode, or a late join): skip further into the file so the
      // grid stays exactly where the room agreed it would be.
      const offset = skip + (now + 0.02 - fileStart);
      if (offset < buf.duration) src.start(now + 0.02, offset);
      else return; // the set is already over — nothing to play
    }

    setSrc = src;
    setGain = gain;
    beatZero = zero;
    state = 'scheduled';
  });
}

/** The synth takes the set at the same tempo and the same beat-zero rules. */
function fallback(opts: SetOptions): void {
  const track = opts.track;
  beatLen = 60 / (opts.bpm ?? track.bpm);
  beatZero = synth.startSet({
    bpm: opts.bpm ?? track.bpm,
    countInBeats: opts.countInBeats,
    endBeat: opts.endBeat,
    seed: opts.seed,
    actAt: opts.actAt,
    beatZeroAt: opts.beatZeroAt,
  });
  state = 'synth';
}

export function stopSet(fade = 0.5): void {
  setToken++;
  if (state === 'synth') synth.stopSet(fade);
  const c = audioContext();
  const src = setSrc;
  const gain = setGain;
  setTrack = null;
  state = 'off';
  if (!c || !src || !gain) {
    setSrc = null;
    setGain = null;
    return;
  }
  const now = c.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0.0001, now + fade);
  // Keep this fading slot addressable until its source actually stops. If a
  // player dismisses the podium early, the following menu transition can
  // shorten the old two-second tail instead of losing its handle and mixing
  // it under the foyer record.
  src.onended = () => {
    if (setSrc !== src) return;
    setSrc = null;
    setGain = null;
  };
  try {
    src.stop(now + fade + 0.05);
  } catch {
    /* already stopped */
  }
}

/* ── the lobby loop ─────────────────────────────────────────────────────── */

/**
 * The room is never dead: the house sound plays under the lobby and the
 * club at reduced level, and publishes its own beat so the mirror ball,
 * the lasers and the GOOPLIATH's idle bounce are already grooving before
 * anyone starts a set.
 *
 * Hand it ONE record and it loops the musical body seamlessly (the club's
 * behaviour). Hand it SEVERAL and the room runs a ROTATION: each record
 * plays through and the next takes the decks — the foyer's SWAG → ECLIPSE
 * trade. The published beat always belongs to whichever record is on.
 */
/** What the room loop's fader should read: its mastered level, times the
 *  still room's hush, times the music switch. */
function ambLevel(): number {
  return ambMuted ? 0 : ambBase * ambDuck;
}

export function startAmbient(tracks: Track | Track[], level = 0.55): void {
  const set = Array.isArray(tracks) ? tracks : [tracks];
  if (!set.length) return;
  const key = set.map((t) => t.id).join('>');
  if (key === ambKey && ambSrc) return; // this rotation already has the decks
  stopAmbient(0.3);
  ambKey = key;
  ambSet = set;
  ambIdx = 0;
  spinAmbient(level);
}

/** Put the rotation's current record on; single-record sets loop in place,
 *  longer sets hand the decks over when the record runs out. `hops` counts
 *  consecutive failed decodes so a broken record is skipped, not fatal —
 *  and a rotation of nothing but broken records gives up instead of
 *  spinning forever. */
function spinAmbient(level: number, hops = 0): void {
  if (hops >= ambSet.length) return;
  const token = ++ambToken;
  const track = ambSet[ambIdx];
  ambTrack = track;

  const c = ctx();
  if (!c) return;
  void loadTrack(track).then((buf) => {
    if (token !== ambToken) return;
    if (!buf) {
      if (ambSet.length > 1) {
        ambIdx = (ambIdx + 1) % ambSet.length;
        spinAmbient(level, hops + 1);
      }
      return;
    }
    const gain = c.createGain();
    ambBase = trackGain(track) * level;
    // A record that comes on while the floor is hushed arrives silent —
    // the fader is set before the needle drops, never faded down after.
    gain.gain.value = ambLevel();
    // src → gain → muffle → the bus. Wide open out on the floor; closing
    // down to a thud when you step into the still room.
    const muffle = c.createBiquadFilter();
    muffle.type = 'lowpass';
    muffle.frequency.value = duckCutoff(ambDuck);
    muffle.Q.value = 0.4;
    gain.connect(muffle);
    muffle.connect(chain(c));
    ambMuffle = muffle;
    const src = c.createBufferSource();
    src.buffer = buf;
    if (ambSet.length === 1) {
      src.loop = true;
      // Loop the musical body, not the file: out of the last whole bar, back
      // to the first downbeat — so the groove never hiccups.
      const bar = beatLenOf(track) * 4;
      const bars = Math.floor((buf.duration - track.downbeat) / bar);
      src.loopStart = track.downbeat;
      src.loopEnd = track.downbeat + bars * bar;
    } else {
      src.onended = () => {
        // Only a natural run-out advances the rotation — a stopAmbient (or
        // a newer spin) has already bumped the token past this record.
        if (token !== ambToken) return;
        ambIdx = (ambIdx + 1) % ambSet.length;
        spinAmbient(level);
      };
    }
    src.connect(gain);
    const at = c.currentTime + 0.1;
    src.start(at);
    ambSrc = src;
    ambGain = gain;
    ambZero = at + track.downbeat;
  });
}

export function stopAmbient(fade = 0.4): void {
  ambToken++;
  ambKey = '';
  const c = audioContext();
  const src = ambSrc;
  const gain = ambGain;
  ambSrc = null;
  ambGain = null;
  ambMuffle = null;
  ambTrack = null;
  if (!c || !src || !gain) return;
  const now = c.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);
  gain.gain.linearRampToValueAtTime(0.0001, now + fade);
  try {
    src.stop(now + fade + 0.05);
  } catch {
    /* already stopped */
  }
}

export function ambientRunning(): boolean {
  return ambSrc !== null;
}

/** Which record the room is spinning (null between rotations) — the only way
 *  to tell from outside whether the foyer is on the house set or the
 *  closing theme. */
export function ambientTrackId(): string | null {
  return ambSrc && ambTrack ? ambTrack.id : null;
}

/** The lowpass corner that goes with a duck level: open at full, down to a
 *  through-the-wall thud when the room is hushed. */
function duckCutoff(mult: number): number {
  return 320 + Math.pow(Math.min(1, Math.max(0, mult)), 0.5) * 19680;
}

/**
 * Duck the room loop without stopping it — THE STILL ROOM's whole trick:
 * step through its door and the club's music falls away to a murmur (the
 * ClubSystem drives this from your head position). 1 = full level.
 *
 * Level ALONE never sounded like a quiet room, only like a quieter club —
 * what a wall actually does is eat the top end and leave you the kick. So
 * the duck drives a lowpass with it, and the still room finally sounds like
 * somewhere you stepped out to rather than somewhere with the volume down.
 */
export function setAmbientDuck(mult: number): void {
  ambDuck = Math.min(1, Math.max(0, mult));
  const c = audioContext();
  if (!c) return;
  if (ambGain) {
    ambGain.gain.cancelScheduledValues(c.currentTime);
    ambGain.gain.setTargetAtTime(ambLevel(), c.currentTime, 0.35);
  }
  if (ambMuffle) {
    ambMuffle.frequency.cancelScheduledValues(c.currentTime);
    ambMuffle.frequency.setTargetAtTime(duckCutoff(ambDuck), c.currentTime, 0.35);
  }
}

export function ambientMuted(): boolean {
  return ambMuted;
}

/**
 * Silence the room loop without taking it off the decks — the club's music
 * switch. Cutting the record instead would take the room's PULSE with it
 * (match.beat rides ambientBeat), freezing the eclipse, the ball and every
 * dancer mid-groove; a room with the music off should look exactly like a
 * room with the music on, because for everyone else it still is one.
 *
 * The fade is short enough to feel like a switch and long enough not to
 * click — a hard gain step on a live buffer pops.
 */
export function setAmbientMuted(on: boolean): void {
  if (on === ambMuted) return;
  ambMuted = on;
  const c = audioContext();
  if (!c || !ambGain) return;
  ambGain.gain.cancelScheduledValues(c.currentTime);
  ambGain.gain.setTargetAtTime(ambLevel(), c.currentTime, 0.06);
}

/** The lobby loop's beat position — the club's idle pulse. */
export function ambientBeat(): number {
  const c = audioContext();
  if (!ambSrc || !ambTrack || !c) return -Infinity;
  return (c.currentTime - ambZero) / beatLenOf(ambTrack);
}
