/**
 * THE SPECTRUM — what the record is doing right now, in bands, for the set
 * to wear (arena/spectrum/set.ts: the EQ wall, the vinyl's grooves, the
 * ripples on the glass).
 *
 * One AnalyserNode hangs off the music bus (music.ts) — behind the fader
 * and ahead of the limiter, so what you SEE is the record, gain-matched,
 * not the limiter's pumping. It's a tap: it has no output and changes
 * nothing you hear. Tapped lazily the first time a record is actually
 * playing (a set, or the club's rotation), so it never wakes an
 * AudioContext on its own.
 *
 * With no record playing (menus, the look-dev harness) the bands are
 * SYNTHESISED off the beat — kick in the bass, hats on the off-beat up top,
 * a moving mid — so the wall still dances in time.
 */
import { ambientRunning, musicBus, setRunning } from './music.js';

let analyser: AnalyserNode | null = null;
let fft: Float32Array<ArrayBuffer> | null = null;

/** Lowest / highest band centre, Hz — log-spaced between. */
const LO = 38;
const HI = 14000;
/** dB window mapped onto 0..1. */
const FLOOR_DB = -88;
const CEIL_DB = -24;

/** A record is on: a set, or the club's / foyer's ambient rotation. */
function playing(): boolean {
  return setRunning() || ambientRunning();
}

function tap(): AnalyserNode | null {
  if (analyser) return analyser;
  const bus = musicBus();
  if (!bus) return null;
  analyser = bus.context.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.5;
  bus.connect(analyser);
  fft = new Float32Array(analyser.frequencyBinCount);
  return analyser;
}

/**
 * Fill `out` (0..1 per band, bass first). Returns true when the bands are
 * the music's own, false when they were synthesised from `beat`. `live`
 * says music is on the bus that isn't a record (VOIDSTEP's live kit).
 */
export function readBands(out: Float32Array, beat: number, live = false): boolean {
  const n = out.length;
  const a = live || playing() ? tap() : null;
  if (a && fft) {
    a.getFloatFrequencyData(fft);
    const hzPerBin = a.context.sampleRate / a.fftSize;
    for (let b = 0; b < n; b++) {
      const f0 = LO * Math.pow(HI / LO, b / n);
      const f1 = LO * Math.pow(HI / LO, (b + 1) / n);
      const i0 = Math.max(1, Math.floor(f0 / hzPerBin));
      const i1 = Math.max(i0 + 1, Math.ceil(f1 / hzPerBin));
      let peak = -Infinity;
      for (let i = i0; i < i1 && i < fft.length; i++) if (fft[i] > peak) peak = fft[i];
      // Treble carries less energy per band in any real master; tilt it up
      // so the top of the wall moves as much as the bottom.
      const tilt = (b / n) * 14;
      out[b] = Math.min(1, Math.max(0, (peak + tilt - FLOOR_DB) / (CEIL_DB - FLOOR_DB)));
    }
    return true;
  }
  const fb = beat - Math.floor(beat);
  const kick = Math.exp(-fb * 7);
  const fo = beat + 0.5 - Math.floor(beat + 0.5);
  const off = Math.exp(-fo * 9);
  const bar = Math.floor(beat / 4);
  for (let b = 0; b < n; b++) {
    const x = b / (n - 1);
    const bass = kick * Math.pow(1 - x, 1.6) * 0.95;
    const hats = off * Math.pow(x, 1.4) * 0.75;
    const mid = (0.35 + 0.25 * Math.sin(beat * 1.7 + x * 9 + bar)) * Math.exp(-Math.pow((x - 0.45) / 0.3, 2));
    const grit = 0.12 * (0.5 + 0.5 * Math.sin(b * 12.9898 + beat * 7.1));
    out[b] = Math.min(1, 0.12 + bass + hats + mid * 0.7 + grit * (0.4 + kick * 0.6));
  }
  return false;
}
