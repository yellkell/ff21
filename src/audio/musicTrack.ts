/**
 * MusicTrack — a WebAudio-backed stand-in for the little slice of
 * HTMLAudioElement the music modules use (src/play/pause/loop/volume/
 * currentTime/paused/ended/onended). Long-form music used to ride plain
 * `new Audio(...)` elements; it now routes through the shared AudioContext.
 *
 * WHY: on Quest, an audible <audio> element activates Android's media-session
 * bridge, and Meta Browser's packaged-PWA launch path crashes in that bridge
 * (NullPointerException in MediaSessionImpl.mediaSessionStateChanged — the
 * whole browser process dies behind a "browser crashed" dialog). It only
 * bites once the origin has earned media-engagement autoplay — i.e. for
 * players who revisit often — because only then does the lobby track start
 * during the launch splash. WebAudio playback never registers a media
 * session, so music through here can't trigger it.
 *
 * Decoded buffers are cached per URL, so re-plays and src round-trips don't
 * refetch. Playback survives the same autoplay rules as before: if the
 * context can't run yet, the track just stays silent until it's unlocked.
 */

import { audioContext } from './sfx.js';

interface LoadedTrack {
  buffer: AudioBuffer;
  /** Seconds of silence at the head of the file. Playback starts here and
   *  loops back here — "Smoldering" ships with a 2s digital-silence lead-in
   *  that made every launch cue sound late (and punched a 2s hole into each
   *  loop), so the silent head is measured once at decode and skipped. */
  head: number;
}

const bufferCache = new Map<string, Promise<LoadedTrack | null>>();

/** Lo-fi decode rate: a full song decoded at the context's 48 kHz stereo is
 *  50–110 MB of PCM — a spike that can OOM a Quest tab (it did, when a pub
 *  late-join fired the jukebox decode into the middle of the scene load).
 *  24 kHz mono is ~an eighth of that, and through a pub jukebox it just
 *  sounds like a pub jukebox. */
const LOFI_RATE = 24000;

async function decodeTrack(url: string, lofi = false): Promise<LoadedTrack | null> {
  const ctx = audioContext();
  if (!ctx) return null;
  try {
    const res = await fetch(url);
    const bytes = await res.arrayBuffer();
    let buffer: AudioBuffer;
    if (lofi) {
      // Decode through a throwaway OfflineAudioContext pinned to LOFI_RATE, so
      // the decoder resamples down instead of handing us a 48 kHz giant, then
      // fold to mono. (An AudioBufferSourceNode resamples on playback, so the
      // main context plays the low-rate buffer transparently.)
      const octx = new OfflineAudioContext(1, 1, LOFI_RATE);
      buffer = mixdownMono(await octx.decodeAudioData(bytes));
    } else {
      buffer = await ctx.decodeAudioData(bytes);
    }
    return { buffer, head: firstAudibleSecond(buffer) };
  } catch {
    return null; // fetch/decode failed — the track just stays silent
  }
}

/** Average all channels into a fresh mono buffer (frees the stereo one). */
function mixdownMono(src: AudioBuffer): AudioBuffer {
  if (src.numberOfChannels === 1) return src;
  const out = new AudioBuffer({ length: src.length, sampleRate: src.sampleRate, numberOfChannels: 1 });
  const sum = out.getChannelData(0);
  for (let c = 0; c < src.numberOfChannels; c++) {
    const data = src.getChannelData(c);
    for (let i = 0; i < sum.length; i++) sum[i] += data[i];
  }
  const inv = 1 / src.numberOfChannels;
  for (let i = 0; i < sum.length; i++) sum[i] *= inv;
  return out;
}

function firstAudibleSecond(buffer: AudioBuffer): number {
  // Windowed RMS, not first-sample-over-threshold: real exports carry dither
  // and stray clicks in their "silent" head (Smoldering has a -66 dB blip in
  // its first quarter-second, followed by 1.5s of true zeros), so the head
  // ends at the first WINDOW with sustained energy, not the first hot sample.
  const data = buffer.getChannelData(0);
  const win = Math.max(1, Math.floor(buffer.sampleRate * 0.05));
  const threshold = 0.003; // window RMS ~-50 dBFS — music clears it, dither doesn't
  for (let s = 0; s < data.length; s += win) {
    const end = Math.min(s + win, data.length);
    let sum = 0;
    for (let i = s; i < end; i++) sum += data[i] * data[i];
    if (Math.sqrt(sum / (end - s)) > threshold) {
      return Math.max(0, s / buffer.sampleRate - 0.05); // keep a 50ms pre-roll
    }
  }
  return 0; // all-silent (or empty) — treat as headless
}

function loadBuffer(url: string): Promise<LoadedTrack | null> {
  let pending = bufferCache.get(url);
  if (!pending) {
    pending = decodeTrack(url);
    bufferCache.set(url, pending);
    // A FAILED decode is forgotten, not cached: the boot preload runs on a
    // young context over a headset's first fetches, and one dropped fetch
    // used to poison the cache for the whole session — every later play()
    // took the null and stayed silent. Now the next play() fetches again.
    void pending.then((loaded) => {
      if (loaded === null && bufferCache.get(url) === pending) bufferCache.delete(url);
    });
  }
  return pending;
}

export class MusicTrack {
  loop = false;
  onended: (() => void) | null = null;

  private _src = '';
  private _volume = 1;
  private _gain: GainNode | null = null;
  private _source: AudioBufferSourceNode | null = null;
  private _buffer: AudioBuffer | null = null;
  private _offset = 0; // paused/seek position within the buffer, seconds
  private _startedAt = 0; // ctx.currentTime when the current source began
  private _playing = false;
  private _ended = false;
  private _playSeq = 0; // invalidates in-flight play() decodes on pause/src swap
  /** Cached mode (default) keeps decoded buffers in the module-wide cache —
   *  right for the handful of score tracks that replay all session. Uncached
   *  mode holds ONE decode on the instance and drops it on src swap — for the
   *  jukebox, where songs are full-length and cycling through the catalogue
   *  must not pile hundreds of decoded MB onto a Quest. */
  private _cache = true;
  /** Lo-fi mode decodes at LOFI_RATE mono (see decodeTrack) — for the jukebox,
   *  where full-fidelity PCM was a Quest-killing memory spike. Only honoured
   *  uncached: the shared cache must stay one-shape-per-URL. */
  private _lofi = false;
  private _uncached: { url: string; pending: Promise<LoadedTrack | null> } | null = null;
  /** Where playback stands, for the settings readout. */
  private _status: 'idle' | 'loading' | 'failed' | 'suspended' | 'ready' = 'idle';

  get status(): string {
    const ctx = audioContext();
    if (ctx && ctx.state !== 'running' && this._playing) return 'suspended';
    return this._status;
  }

  constructor(src?: string, opts?: { cache?: boolean; lofi?: boolean }) {
    this._cache = opts?.cache !== false;
    this._lofi = opts?.lofi === true;
    if (src) this.src = src;
  }

  private load(url: string): Promise<LoadedTrack | null> {
    if (this._cache) return loadBuffer(url);
    if (this._uncached?.url !== url) this._uncached = { url, pending: decodeTrack(url, this._lofi) };
    return this._uncached.pending;
  }

  /** Kick (or join) the decode without playing: true = ready, false = failed.
   *  The element-era 'canplaythrough'/'error' readiness signal, as a promise. */
  preload(): Promise<boolean> {
    if (!this._src) return Promise.resolve(false);
    return this.load(this._src).then((loaded) => loaded !== null);
  }

  get src(): string {
    return this._src;
  }

  /** Swapping the source stops playback and rewinds, like an element would.
   *  In uncached mode the old decode is dropped here (GC reclaims it). */
  set src(url: string) {
    if (url === this._src) return;
    this._playSeq += 1;
    this.stopSource();
    this._playing = false;
    this._ended = false;
    this._offset = 0;
    this._buffer = null;
    this._uncached = null;
    this._src = url;
    if (url) void this.load(url); // start decoding now so play() lands fast
  }

  get volume(): number {
    return this._volume;
  }

  set volume(v: number) {
    this._volume = v;
    if (this._gain) this._gain.gain.value = v;
  }

  get paused(): boolean {
    return !this._playing;
  }

  get ended(): boolean {
    return this._ended;
  }

  get currentTime(): number {
    const ctx = audioContext();
    if (this._playing && ctx && this._buffer) {
      const pos = this._offset + (ctx.currentTime - this._startedAt);
      const dur = this._buffer.duration;
      return this.loop && dur > 0 ? pos % dur : Math.min(pos, dur);
    }
    return this._offset;
  }

  set currentTime(seconds: number) {
    this._offset = seconds;
    this._ended = false;
    if (this._playing) {
      // Seek while playing: restart the (one-shot) source at the new spot.
      this.stopSource();
      this._playing = false;
      void this.play().catch(() => {
        /* decode failed — stays silent, same as the element path */
      });
    }
  }

  /** Like element.play(): flips `paused` immediately, resolves once running,
   *  rejects if the source can't be decoded. Autoplay blocking doesn't reject
   *  here — the context just stays suspended and the track starts on unlock. */
  play(): Promise<void> {
    this._ended = false;
    if (this._playing) return Promise.resolve();
    const ctx = audioContext();
    if (!ctx || !this._src) return Promise.reject(new Error('MusicTrack: no source/context'));
    if (ctx.state === 'suspended') void ctx.resume();
    this._playing = true;
    this._status = 'loading';
    const seq = ++this._playSeq;
    return this.load(this._src).then((loaded) => {
      if (seq !== this._playSeq) return; // paused or re-pointed mid-decode
      if (!loaded) {
        this._playing = false;
        this._status = 'failed';
        throw new Error('MusicTrack: decode failed');
      }
      this._status = 'ready';
      const { buffer, head } = loaded;
      this._buffer = buffer;
      if (!this._gain) {
        this._gain = ctx.createGain();
        this._gain.connect(ctx.destination);
      }
      this._gain.gain.value = this._volume;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = this.loop;
      if (this.loop && head > 0) {
        // Loop the audible span only — wrapping to 0 would replay the silent
        // head as a hole in the middle of the music.
        source.loopStart = head;
        source.loopEnd = buffer.duration;
      }
      let offset = buffer.duration > 0 ? this._offset % buffer.duration : 0;
      if (offset < head) offset = head; // never start inside the silent head
      source.onended = () => {
        // Manual stops detach first (stopSource), so this is a natural end.
        if (this._source !== source) return;
        this._source = null;
        this._playing = false;
        this._offset = 0;
        this._ended = true;
        this.onended?.();
      };
      source.connect(this._gain);
      source.start(0, offset);
      this._source = source;
      this._startedAt = ctx.currentTime;
      this._offset = offset;
    });
  }

  pause(): void {
    this._playSeq += 1; // abandon any play() still decoding
    if (!this._playing) return;
    const ctx = audioContext();
    if (this._source && ctx && this._buffer) {
      const dur = this._buffer.duration;
      let pos = this._offset + (ctx.currentTime - this._startedAt);
      if (this.loop && dur > 0) pos %= dur;
      this._offset = Math.min(pos, dur);
    }
    this.stopSource();
    this._playing = false;
  }

  private stopSource(): void {
    const source = this._source;
    if (!source) return;
    this._source = null; // detach BEFORE stop so onended sees a manual stop
    source.onended = null;
    try {
      source.stop();
    } catch {
      /* never started — nothing to stop */
    }
    source.disconnect();
  }
}
