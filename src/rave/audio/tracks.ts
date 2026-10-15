/**
 * THE RECORD BOX — the real tracks, and everything the game needs to dance
 * to them.
 *
 * Every number here was MEASURED from the files themselves, not guessed:
 *
 *  - `bpm`      : onset-flux autocorrelation, then phase-locked across the
 *                 whole track at 0.005 BPM resolution. Four of these land on
 *                 exact integers (a DAW grid); three genuinely sit a hair
 *                 under, and using the rounded value visibly drifts off the
 *                 kick by the last third — so the fractions stay.
 *  - `downbeat` : seconds from file start to BAR 1 BEAT 1 (a 4-beat energy
 *                 vote picks which beat of the bar is the downbeat). This is
 *                 the one number a human ear might want to nudge: if a set
 *                 ever feels like it lands on the 2 instead of the 1, move
 *                 this by ±(60/bpm) and nothing else changes.
 *  - `lufs`     : EBU R128 integrated loudness (ffmpeg ebur128). The spread
 *                 across these masters is 7.6 dB — swag comes in at −15.7
 *                 while sakupened is slammed to −8.1 — so every track is
 *                 gain-matched to TARGET_LUFS at playback. Nothing is ever
 *                 re-encoded; it's a gain node.
 *
 * Adding a track: drop the file in src/assets/music/, run
 * `npm run analyze -- <file>`, paste the row it prints, done. Roles decide
 * where it plays; move a track between roles freely.
 *
 * CHECK THE TEMPO IT GIVES YOU. The analyser's octave fold only looks
 * between 100 and 180 BPM, so a record whose true beat falls outside that
 * comes back as whatever fraction of the grid autocorrelated best —
 * ORIGINAL arrived as 63.333, a third of its real 190 lattice.
 * `tools/octave-check` scores the candidates against the onsets, and
 * `tools/track-check` audits the whole box against the files it describes.
 */

import sakupenedUrl from '../assets/music/sakupened.mp3';
import swagUrl from '../assets/music/swag.mp3';
import combatUrl from '../assets/music/combat.m4a';
import targetUrl from '../assets/music/target.m4a';
import captureUrl from '../assets/music/capture.m4a';
import loopUrl from '../assets/music/loop.m4a';
import moneyUrl from '../assets/music/money.m4a';
import breakcoreUrl from '../assets/music/breakcore.mp3';
import infectionUrl from '../assets/music/infection.m4a';
import unityUrl from '../assets/music/unity.m4a';
import dynastyUrl from '../assets/music/dynasty.mp3';
import spreadUrl from '../assets/music/spread.m4a';
import morningUrl from '../assets/music/morning.mp3';
import assembleUrl from '../assets/music/assemble.m4a';
import chillUrl from '../assets/music/chill.m4a';
import discoballUrl from '../assets/music/discoball.mp3';
import eclipseUrl from '../assets/music/eclipse.mp3';
import vfallUrl from '../assets/music/vfall.mp3';
import giveitUrl from '../assets/music/giveit.m4a';
import voneUrl from '../assets/music/vone.m4a';
import fusionUrl from '../assets/music/fusion.mp3';
import futurevibeUrl from '../assets/music/futurevibe.mp3';
import braineaterUrl from '../assets/music/braineater.mp3';
import creditsUrl from '../assets/music/credits.mp3';
import defenseUrl from '../assets/music/defense.m4a';
import awakeningUrl from '../assets/music/awakening.m4a';
import passionUrl from '../assets/music/passion.m4a';
import finalUrl from '../assets/music/final.m4a';
import overtimeUrl from '../assets/music/overtime.m4a';
import bringitonUrl from '../assets/music/bringiton.m4a';
import eraseUrl from '../assets/music/erase.m4a';
import indecisiveUrl from '../assets/music/indecisive.m4a';
import climbUrl from '../assets/music/climb.m4a';
import type { MoveKind } from '../config.js';

/** Where a record is allowed to play. 'credits' is a role of one: the
 *  campaign's closing theme, kept out of the shuffle and out of the foyer
 *  rotation so the first time anyone hears it is the night they finish. */
export type TrackRole = 'raid' | 'lobby' | 'club' | 'credits';

export interface Track {
  id: string;
  /** Shown on the lobby selector and the count-in card. */
  title: string;
  url: string;
  /** Measured tempo — fractions are deliberate (see the header). */
  bpm: number;
  /** Seconds to bar 1 beat 1. Game beat 0 = this + the count-in. */
  downbeat: number;
  /** File duration in seconds. */
  seconds: number;
  /** EBU R128 integrated loudness of the master. */
  lufs: number;
  roles: TrackRole[];
  /** Optional: begin playback this far into the file (skips an ambient
   *  intro). Must still sit on the grid — use downbeat + n×4 beats. */
  startAt?: number;
  /** Optional: move kinds this record never calls — the set-list generator
   *  skips them entirely. Same trackId on every client, so a ban never
   *  desyncs a room. */
  banned?: MoveKind[];
  /** Optional: move kinds banned only on a CAMPAIGN night. A tour night is
   *  authored — its record was chosen for the beat it plays in the story,
   *  and a ban there is staging. The same record on the SOLO shelf is just
   *  a record: you picked it, so you get the whole vocabulary. (Never
   *  desyncs a room either — online raids are never tour nights, so
   *  `match.tour` is null on every client in one.) */
  tourBanned?: MoveKind[];
  /** Optional: stretches where the record drops out, in file seconds —
   *  [last sound before the gap, first sound back]. The set-list books
   *  nothing across one: no telegraph opens and nothing lands until the
   *  music is back, so the floor rests with the song. */
  breaks?: [number, number][];
}

/**
 * Playback target. −14 LUFS keeps every master at or under unity gain except
 * the quietest, leaves headroom over the sfx bus, and (with the limiter in
 * music.ts) means no track can ever slam the mix.
 */
export const TARGET_LUFS = -14;

export const TRACKS: Track[] = [
  {
    id: 'sakupened',
    title: 'SAKUPENED',
    url: sakupenedUrl,
    bpm: 133.964,
    downbeat: 1.7848,
    seconds: 154.02,
    lufs: -8.1,
    roles: ['raid'],
  },
  {
    id: 'combat',
    title: 'COMBAT',
    url: combatUrl,
    bpm: 135.0,
    downbeat: 0.4909,
    seconds: 186.67,
    lufs: -13.2,
    // A quick-raid record: it gave PEAK HOURS up to DISCO BALL, and MONEY
    // holds the slot it briefly took back.
    roles: ['raid'],
  },
  {
    id: 'discoball',
    title: 'DISCO BALL',
    url: discoballUrl,
    bpm: 109.965,
    downbeat: 2.1295,
    seconds: 126.62,
    lufs: -12.6,
    // The night after the first goop falls: PEAK HOURS opens on the strut —
    // the tour's victory lap before COMBAT kicks the doors in. (The first
    // analysis locked the shuffle's dotted lattice and called it 73.33 —
    // exactly 2/3 of the real grid; the kicks sit on 110.) No sweeps ON THE
    // TOUR: the groove is the point of that night. Take it to SOLO and the
    // blade comes with it — your pick, your problem.
    roles: ['raid'],
    tourBanned: ['sweep'],
  },
  {
    id: 'loop',
    title: 'LOOP',
    url: loopUrl,
    bpm: 150.0,
    downbeat: 1.2523,
    seconds: 225.6,
    lufs: -11.2,
    roles: ['raid'],
  },
  {
    id: 'capture',
    title: 'CAPTURE',
    url: captureUrl,
    bpm: 117.0,
    downbeat: 1.0663,
    seconds: 225.64,
    lufs: -15.0,
    roles: ['raid'],
  },
  {
    id: 'morning',
    title: 'MORNING',
    url: morningUrl,
    bpm: 96.665,
    downbeat: 0.8239,
    seconds: 112.65,
    lufs: -11.1,
    roles: ['raid'],
    // The tour's opening night: short, fun, and called MORNING — the night
    // starts here. Everyone stays on their feet.
    banned: ['sweep'],
  },
  {
    id: 'money',
    title: 'MONEY',
    url: moneyUrl,
    bpm: 97.994,
    downbeat: 0.6094,
    seconds: 173.88,
    lufs: -14.5,
    // Back on the tour: PEAK HOURS slot 2, holding the swagger before
    // DYNASTY. (First measured 78.4 — the 4/5 lattice of the real pulse;
    // the 98 grid scores double.) The tour night swaggers, it doesn't duck
    // — but on the SOLO shelf it ducks like everything else.
    roles: ['raid'],
    tourBanned: ['sweep'],
  },
  {
    id: 'target',
    title: 'TARGET',
    url: targetUrl,
    bpm: 91.0,
    downbeat: 0.0406,
    seconds: 253.19,
    lufs: -9.5,
    roles: ['raid'],
  },
  {
    id: 'breakcore',
    title: 'BREAKCORE',
    url: breakcoreUrl,
    bpm: 174.0,
    downbeat: 1.6347,
    seconds: 130.61,
    lufs: -8.3,
    // The endgame record: pure 174 DnB grid (phase-locked measurement said
    // 174.005 — one analyser step off the integer, 4 ms over the file).
    roles: ['raid'],
  },
  {
    id: 'dynasty',
    title: 'DYNASTY',
    url: dynastyUrl,
    bpm: 155.0,
    downbeat: 1.5444,
    seconds: 139.2,
    lufs: -9.6,
    // PEAK HOURS' closer: the magenta goop's record.
    roles: ['raid'],
  },
  {
    id: 'spread',
    title: 'SPREAD',
    url: spreadUrl,
    bpm: 150.0,
    downbeat: 1.2523,
    seconds: 244.81,
    lufs: -13.1,
    // A proper fight record — it took UNITY's night on the tour. Its groove
    // proper starts six bars in, so a set skips straight to it (still on
    // the grid: downbeat + 6 bars at 150).
    startAt: 10.8523,
    roles: ['raid'],
  },
  {
    id: 'unity',
    title: 'UNITY',
    url: unityUrl,
    bpm: 117.0,
    downbeat: 0.0464,
    seconds: 299.49,
    lufs: -13.8,
    // The five-minute journey — its ambient open is skipped so a set
    // drops straight into the groove (bar 7 on the grid). SPREAD took its
    // tour night; it plays on for quick raids and the seeded shuffle.
    startAt: 12.3542,
    roles: ['raid'],
  },
  {
    id: 'assemble',
    title: 'ASSEMBLE',
    url: assembleUrl,
    bpm: 125.0,
    // The record opens with about six seconds of near-silent riser (−55 dB
    // climbing to −30) and then SLAMS in at 5.804 s — a transient sharp
    // enough to see, jumping 18 dB inside 5 ms. Both the whole-file and the
    // body-only tempo passes put a beat within 2 ms of it, so the drop is
    // the honest anchor: bar 1 beat 1 is the slam, and startAt puts the
    // needle down right on it. The riser never plays.
    downbeat: 5.8043,
    startAt: 5.8043,
    seconds: 263.04,
    // The hottest master in the box, hotter even than sakupened.
    lufs: -7.5,
    roles: ['raid'],
  },
  {
    id: 'infection',
    title: 'INFECTION',
    url: infectionUrl,
    bpm: 138.0,
    downbeat: 0.7308,
    seconds: 222.61,
    lufs: -10.9,
    roles: ['raid'],
  },
  {
    id: 'giveit',
    title: 'GIVE IT TO ME',
    url: giveitUrl,
    bpm: 112.0,
    downbeat: 1.3849,
    seconds: 240.01,
    lufs: -14.2,
    // AFTER HOURS opens on this now, in INFECTION's old seat. The night
    // starts a good deal lower than it used to (112 against 138) and the
    // step up to SPREAD is the biggest on the tour — which is the point of
    // a last set: the room walks in, then the floor runs away with it.
    roles: ['raid'],
  },
  {
    id: 'vone',
    // Titled ORIGINAL on the shelf; the id stays 'vone' because the
    // leaderboards and the cued-song preference are keyed on it.
    title: 'ORIGINAL',
    url: voneUrl,
    bpm: 95.0,
    downbeat: 1.5708,
    seconds: 179.37,
    lufs: -10.8,
    // The analyser called this one 63.333 and it is nothing of the sort.
    // The onsets sit on a 190 lattice — 63.333 is a third of it, and the
    // octave fold only ever looks between 100 and 180, so nothing rescued
    // it. 95 is the half of 190 you can actually dance: every beat lands on
    // a real onset (88% of them carry one), while 190 itself would ask for
    // three hand-swaps a second and the groove would never pay out.
    roles: ['raid'],
  },
  {
    id: 'fusion',
    title: 'FUSION',
    url: fusionUrl,
    bpm: 122.0,
    downbeat: 1.963,
    seconds: 90.67,
    lufs: -8.1,
    // The shortest record in the box at 1:30 — a five-phrase sprint, and
    // the tightest grid of the four (confidence 7.4, the best reading of
    // any record here).
    roles: ['raid'],
  },
  {
    id: 'braineater',
    title: 'BRAIN EATER',
    url: braineaterUrl,
    bpm: 149.959,
    downbeat: 0.7716,
    seconds: 95.74,
    lufs: -9.1,
    roles: ['raid'],
  },
  {
    id: 'credits',
    title: 'CREDITS',
    url: creditsUrl,
    bpm: 70.0,
    downbeat: 3.4248,
    seconds: 154.03,
    lufs: -10.4,
    // THE CLOSING THEME. Its own role, so the shuffle can't reach it and
    // the foyer never spins it: it plays once, over the credits, on the
    // night the tour is finished.
    roles: ['credits'],
  },
  {
    id: 'chill',
    title: 'CHILL',
    url: chillUrl,
    bpm: 125.001,
    downbeat: 1.4922,
    seconds: 232.32,
    lufs: -8.9,
    // The club's record now — CHILL holds the social floor whenever an
    // online room is up, and the chandelier phases to it. Never a raid
    // record: the club deserves a house sound no set ever borrows.
    //
    // It opens the club rotation rather than looping alone: FUTURE VIBE sits
    // directly below and takes the decks when this one runs out. Order here
    // IS the running order — tracksFor keeps the array's sequence and the
    // rotation always starts at its first record.
    roles: ['club'],
  },
  {
    id: 'futurevibe',
    title: 'FUTURE VIBE',
    url: futurevibeUrl,
    bpm: 93.984,
    downbeat: 0.9577,
    seconds: 147.54,
    lufs: -14.2,
    // The club's SECOND record: CHILL plays through, then this takes over,
    // and the two trade all night the way the foyer's pair do. Sitting after
    // CHILL in this array is what puts it second. It keeps its raid seat too
    // — a house record the floor can also book is fine; only CHILL is held
    // back from the shelf.
    roles: ['raid', 'club'],
  },
  {
    id: 'vfall',
    // Titled BREAKCORE V4 on the shelf; the id stays 'vfall' for the same
    // reason ORIGINAL keeps 'vone' — stored scores and picks key on it.
    title: 'BREAKCORE V4',
    url: vfallUrl,
    bpm: 165.015,
    downbeat: 2.5048,
    seconds: 125.23,
    lufs: -9.4,
    // Fast techno, and the chart finally says so. The first analysis
    // called it 66.006 — not half-time but a 2/5 lattice of the real grid
    // (66.006 × 5/2 = 165.015, which out-scores 66, 110 AND 132 on the
    // kick evidence). One of the quickest records on the SOLO shelf now.
    roles: ['raid'],
  },
  {
    id: 'defense',
    title: 'DEFENSE',
    url: defenseUrl,
    bpm: 125.996,
    downbeat: 1.4693,
    seconds: 287.62,
    lufs: -8.6,
    // The tightest grid in the box — confidence 7.62, a shade past FUSION's
    // 7.4 — and the fraction is real: 126 flat scored more than half a
    // percent worse on the same onsets, so the four thousandths stay.
    //
    // Twenty-two seconds of stripped intro before the record drops. The
    // beat is there the whole way (sparse and clean, which is why the grid
    // reads so well), but it sits 9 dB under the body, so a set that opened
    // on it would chart a chorus of ghosts. The drop is a +9.1 dB step at
    // 22.430 s and bar 12 lands 8 ms from it — the closest a needle drop
    // has ever come to a bar line here, so the whole intro goes.
    startAt: 22.4223,
    roles: ['raid'],
  },
  {
    id: 'awakening',
    title: 'AWAKENING',
    url: awakeningUrl,
    bpm: 165.0,
    downbeat: 0.9537,
    seconds: 245.82,
    lufs: -17.4,
    // 165 on the nose, a hair off BREAKCORE V4's 165.015 — the two fastest
    // records in the box are now the same tempo by accident.
    //
    // The loosest reading here at confidence 2.70, and it earns that: the
    // record spends half a minute arriving. `octave-check` still calls 165
    // the beat rather than a half of 330 (its off-beats run 0.72 of the
    // on-beats, under the 0.8 that would mean a doubling), and once the
    // groove is up the grid reads 4× the track mean — as locked as anything
    // on the fast shelf. It is the WAY IN that is soft, not the record.
    //
    // So the needle skips it. The pulse is 1.1–1.3× mean for fourteen bars,
    // climbs from bar 14 and is fully up by bar 20 — which is also where the
    // level first comes within 3 dB of the body. That's the drop, 30 s in.
    startAt: 30.0446,
    // The quietest master in the box by 1.7 dB, which pushes the spread
    // across the shelf to 9.9 dB. Gain-matching lifts it +3.4 dB and its
    // true peak (−1.4 dBFS) goes just over on a maxed music slider — which
    // is what the limiter on the music bus is for, and SWAG and GIVE IT TO
    // ME already ask it the same favour.
    roles: ['raid'],
  },
  {
    id: 'passion',
    title: 'PASSION',
    url: passionUrl,
    bpm: 125.996,
    downbeat: 1.8886,
    seconds: 231.97,
    lufs: -8.6,
    // The raw reading is 63 and the record isn't that slow: its onsets sit
    // on a 252 lattice (63 × 4), and 63, 84 and 126 all autocorrelate off
    // it. The drums run half-time — one heavy kick a bar, which is also
    // what the downbeat vote locks onto (3× any other slot) — but the
    // pulse the floor dances is 126, and a 63 chart would be a waiting
    // room. Same four-thousandths-under grid as DEFENSE, and the fraction
    // outscored 126 flat, so it stays. No intro to skip: it's up from the
    // first second.
    roles: ['raid'],
  },
  {
    id: 'final',
    title: 'FINAL',
    url: finalUrl,
    bpm: 126.0,
    downbeat: 0.0481,
    seconds: 300.95,
    lufs: -7.8,
    // Read 63 at first, like PASSION, off the same 252 lattice — but here
    // the kick settles it: four on the floor at 126, off-beats nearly empty
    // (0.23 of the on-beats). The full band phase-locks half a beat later,
    // on the off-beat hats; the kick is the beat, so the kick's phase wins.
    // The longest record in the box at five minutes, and it starts on the
    // one — bar 1 beat 1 is 48 ms in.
    roles: ['raid'],
  },
  {
    id: 'overtime',
    title: 'OVERTIME',
    url: overtimeUrl,
    bpm: 145.0,
    downbeat: 0.049,
    seconds: 220.15,
    lufs: -10.5,
    // The autocorrelation's loudest peak is 73 — the half-time kick — but
    // the phase lock is three times stronger at 145 and holds flat end to
    // end (145.000 and 145.005 tie; the grid is a DAW's integer). Eighths
    // ride the hats on every half-beat. The heaviest kick votes the one,
    // and the one is the first thing in the file: sound starts 45 ms in,
    // the same encoder lead-in as FINAL, so bar 1 beat 1 sits at 49 ms
    // (calibrated against FINAL's and SAKUPENED's measured downbeats). No
    // intro to skip.
    roles: ['raid'],
  },
  {
    id: 'bringiton',
    title: 'BRING IT ON',
    url: bringitonUrl,
    bpm: 89.995,
    downbeat: 2.656,
    seconds: 237.34,
    lufs: -14.2,
    // The lattice is 180 (hats on every half-beat) and the kick lands every
    // other beat of 90, so the question is which octave the floor dances.
    // 180 would put one kick in every four beats; 90 is the pulse, the same
    // call ORIGINAL got at 95 off its 190. Both halves of the file lock at
    // 89.995 and 90.000, and the fraction outscores 90 flat on the full
    // file (17.5 against 15.8), so it stays. The downbeat vote splits
    // between the two kick slots, and the section entries settle it: every
    // big entry (beats 15, 47 and 111 counted from the first kick) lands on
    // the same one of them.
    //
    // It opens on ten and a half seconds of near-silent intro, 13 dB under
    // the body, then SLAMS in out of digital silence (−66 dB to −14 inside
    // 20 ms) at 10.668 s, which is 12 ms after bar 4. So the needle drops on
    // bar 4, the same treatment ASSEMBLE and DEFENSE get, and the intro
    // never plays.
    startAt: 10.6564,
    roles: ['raid'],
  },
  {
    id: 'erase',
    title: 'ERASE',
    url: eraseUrl,
    bpm: 126.0,
    downbeat: 0.0495,
    seconds: 293.33,
    lufs: -8.1,
    // Autocorrelation's loudest peak is 63 again — PASSION and FINAL's 252
    // lattice — but the kick settles it the way it did for FINAL: four on
    // the floor at 126, the off-eighths nearly empty (2 dB of attack
    // against 18 on the beat). 126.000 flat wins the phase lock on the
    // whole file and on each half, so no fraction this time. Sound starts
    // 49 ms in (the same AAC lead-in as FINAL and OVERTIME) and bar 1 beat
    // 1 is the first thing in the file. Every big section entry, the +6.6
    // dB drop at 217 s included, lands on a sixteen-beat line counted from
    // it. The first four bars sit 3 dB under the body with the kick
    // already going, so there's no intro to skip.
    roles: ['raid'],
  },
  {
    id: 'indecisive',
    title: 'INDECISIVE',
    url: indecisiveUrl,
    bpm: 118.0,
    downbeat: 0.9924,
    seconds: 310.1,
    lufs: -13.9,
    // 118 flat, and it is not close: the phase lock scores 6.3× the track
    // mean there against 3.9 for the next candidate (94.4), and each half of
    // the file locks to 118 on its own (117.995 and 118.000, inside one
    // analyser step). Kick starts measured across the body drift under 2 ms
    // end to end at 118, and several ms either way at 117.995 or 118.005, so
    // the grid is a DAW integer.
    //
    // The downbeat is the break. At 30.9 s the record cuts to digital
    // silence and comes back in at 35.569 s, going from nothing to −4 dB
    // inside 10 ms. That return is the honest anchor (downbeat + 17 bars),
    // and the body's kick vote and the two-bar level swaps near the end
    // (every 8 beats from 234.9 s) all land on the same slot of the bar. The
    // sparse intro's heavy hit falls on the 4, as a pull into each bar.
    // Kick onsets sit about 10 ms behind this grid, which is inside the
    // slack BRING IT ON already takes.
    //
    // It plays from the head, intro and all, and the floor rests through
    // the gap: nothing telegraphs or lands between the last sound before it
    // and the slam back in.
    breaks: [[30.8954, 35.5687]],
    roles: ['raid'],
  },
  {
    id: 'climb',
    title: 'CLIMB',
    url: climbUrl,
    bpm: 128.0,
    downbeat: 0.0,
    seconds: 232.61,
    lufs: -18.5,
    // The phase lock's loudest reading is 64, a half-time accent, but the
    // kick settles it the way it did for FINAL: four on the floor at 128,
    // and nothing on the off-beats (0.04 of the on-beats). Kick starts sit
    // within 2 ms of a 128.000 grid end to end and drift either way at
    // ±0.005, so the grid is a DAW integer.
    //
    // It is a bounce from bar 1: the grid starts at the very first sample.
    // The chopped intro and outro prove it (each chop comes back on a beat
    // of that grid, the last one 225.469 s in, exactly beat 481), and every
    // big section change lands on a sixteen-beat line counted from zero.
    // The chops are a fifth of a second long, so it carries no breaks.
    //
    // The quietest master in the box, 1.1 dB under AWAKENING. Gain-matching
    // lifts it +4.5 dB, which puts its true peak (−3.9 dBFS) just over full
    // scale on a maxed music slider, so the music-bus limiter catches it the
    // same as AWAKENING. (It arrived as Climb.wav, but the file inside is
    // AAC in an MP4 box, so it goes in as .m4a with no re-encode.)
    roles: ['raid'],
  },
  {
    id: 'swag',
    title: 'SWAG',
    url: swagUrl,
    bpm: 91.974,
    downbeat: 2.1661,
    seconds: 127.01,
    lufs: -15.7,
    // The soft one — it holds the room before the drop instead of fighting
    // it. (Its groove proper starts around 17.8 s; the lobby loop just rides
    // the whole thing, intro and all.)
    roles: ['lobby'],
  },
  {
    id: 'eclipse',
    title: 'ECLIPSE',
    url: eclipseUrl,
    bpm: 70.0,
    downbeat: 3.4248,
    seconds: 154.03,
    lufs: -10.4,
    // CHILL took the club; ECLIPSE joins the foyer rotation — it plays
    // second, after SWAG, and the pair trade all night. Never a raid
    // record: at this tempo the ring would be a waiting room.
    roles: ['lobby'],
  },
];

export function trackById(id: string): Track | undefined {
  return TRACKS.find((t) => t.id === id);
}

export function tracksFor(role: TrackRole): Track[] {
  return TRACKS.filter((t) => t.roles.includes(role));
}

/**
 * Records VOIDSTEP will not play, whatever the shuffle says.
 *
 * AWAKENING and BRAIN EATER are both records that ARRIVE — they open on a
 * long held build and land somewhere. The course has no drop to land on: it
 * is a lap you walk at a constant 128 BPM, and a record that spends ninety
 * seconds promising something turns the whole circuit into a wait. Every
 * other record on the shelf will happily play from anywhere in itself.
 */
const VOIDSTEP_BANNED = new Set(['awakening', 'braineater']);

/**
 * The VOIDSTEP shelf, SHUFFLED — and shuffled per headset, not per room.
 *
 * This is the one piece of music in the building that is deliberately NOT
 * shared. A set is one record because everybody is dancing the same chart to
 * it, and the club floor is one record because a room hears the room. The
 * course is neither: it is a place people are walking through in different
 * directions at different points of a lap, and there is nothing to be in time
 * with except the floor's own 128 — which the conductor keeps underneath
 * regardless. So everyone gets their own record and their own order, the way
 * everyone out for a walk has their own headphones on.
 *
 * (Which also means it costs nothing to synchronise, and cannot desync.)
 */
export function voidstepShelf(): Track[] {
  const shelf = TRACKS.filter((t) => !t.roles.includes('credits') && !VOIDSTEP_BANNED.has(t.id));
  // Fisher–Yates, once, on a copy.
  for (let i = shelf.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shelf[i], shelf[j]] = [shelf[j], shelf[i]];
  }
  return shelf;
}

/** Linear gain that brings a master to TARGET_LUFS. */
export function trackGain(track: Track): number {
  return Math.pow(10, (TARGET_LUFS - track.lufs) / 20);
}

/** Seconds per beat. */
export function beatLenOf(track: Track): number {
  return 60 / track.bpm;
}

/**
 * How much SET a track affords: game beat 0 sits `countInBeats` after the
 * first downbeat, and the last landing must leave a bar of room before the
 * file runs out. `bpm` is the CHART tempo (EXPERT doubles slow records) —
 * everything here is measured in chart beats, so a doubled clock affords
 * twice the phrases across the same seconds of music.
 */
export function trackPhrases(track: Track, countInBeats: number, beatsPerPhrase = 32, bpm = track.bpm): number {
  const beatLen = 60 / bpm;
  const zero = Math.max(track.downbeat, track.startAt ?? 0) + countInBeats * beatLen;
  const beats = (track.seconds - zero) / beatLen - beatsPerPhrase / 8; // tail guard
  return Math.max(2, Math.floor(beats / beatsPerPhrase));
}

/** A record's breaks on the CHART's beat grid (beat 0 sits `countInBeats`
 *  after the first downbeat, as in trackPhrases). Same track, same tempo,
 *  same count-in on every client, so a room's charts rest together. */
export function breakBeats(track: Track, countInBeats: number, bpm = track.bpm): [number, number][] {
  const beatLen = 60 / bpm;
  const zero = Math.max(track.downbeat, track.startAt ?? 0) + countInBeats * beatLen;
  return (track.breaks ?? []).map(([from, to]) => [(from - zero) / beatLen, (to - zero) / beatLen]);
}

/** Deterministic track pick for a seed — every client lands on the same set. */
export function pickRaidTrack(seed: number): Track {
  const pool = tracksFor('raid');
  return pool[seed % pool.length] ?? TRACKS[0];
}
