/**
 * Match flow — the only place screens change hands. These are plain state
 * mutations; the systems notice (`match.generation`, `match.screen`) and do
 * the physical work: MusicSystem drops the needle, ArenaSystem rebuilds the
 * ring, ChoreoSystem regenerates the set-list, RankSystem re-seats the board.
 *
 * The record decides the shape of the match: a track's measured tempo
 * becomes `match.bpm`, and its playable length becomes `match.phrases` — so
 * the set always ends with the song, and the escalation curve (act
 * boundaries are fractions of the set) stretches to fit whatever is on.
 */

import { DIFFICULTY, MUSIC, RING, TOUR, chartBpm, countInBeatsFor, nextMcVisit } from '../config.js';
import { pickRaidTrack, trackById, trackPhrases, type Track } from '../audio/tracks.js';
import { submitWorldScore } from '../net/scores.js';
import { addCoins } from '../../menu/wallet.js';
import { songCoins } from '../../config.js';
import { profileName } from './profile.js';
import { freshSeed } from './rng.js';
import {
  buildRoster,
  gradeOf,
  markTourNightCleared,
  match,
  recordSoloRun,
  recordTourGrade,
  setMenuMusic,
} from './state.js';

const phraseBeats = MUSIC.beatsPerBar * MUSIC.barsPerPhrase;

/** Apply a track to the match: tempo, set length, id. The tempo mounted is
 *  the CHART tempo — EXPERT runs slow records in double time — so
 *  startRaid settles the difficulty before the track goes on. */
function mountTrack(track: Track): void {
  const bpm = chartBpm(track.bpm, match.difficulty);
  match.trackId = track.id;
  match.bpm = bpm;
  match.doubleTime = bpm !== track.bpm;
  match.beatLen = 60 / bpm;
  match.phrases = trackPhrases(track, countInBeatsFor(bpm), phraseBeats, bpm);
  match.grooveStreak = 0;
}

export interface RaidOptions {
  seats?: number;
  seed?: number;
  mySeat?: number;
  /** Online: seat → who (unlisted seats become groupies). */
  humans?: Map<number, { name: string; netId?: number }>;
  /** Online: shared AudioContext-clock time for beat 0. */
  beatZeroAt?: number;
  online?: boolean;
  /** Force a track; otherwise the lobby preference, else a seeded pick. */
  trackId?: string;
  /** Force a difficulty (online: the caller's) — else this headset's. */
  difficulty?: number;
  /** A tour night: fixes the record, and the set's third night books the
   *  GOOP (recoloured, with the eat-the-MC opener). */
  tour?: { set: number; song: number };
}

/** Take the floor: a full raid set (solo vs groupies by default). */
export function startRaid(opts: RaidOptions = {}): void {
  const seats = Math.max(RING.minSeats, Math.min(RING.maxSeats, opts.seats ?? match.seats));
  match.seats = seats;
  match.mySeat = opts.mySeat ?? 0;
  match.seed = opts.seed ?? freshSeed();
  if (opts.difficulty !== undefined) match.difficulty = Math.max(0, Math.min(3, opts.difficulty));
  // THE CAMPAIGN CURVE: the tour is the one place below EXPERT. The road
  // teaches — EASY through the opening set, NORMAL through peak hours, HARD
  // after hours — and everywhere else is EXPERT (DIFFICULTY.solo).
  // (toLobby/toTour hand EXPERT back.)
  if (opts.tour) match.difficulty = Math.min(2, opts.tour.set);

  // The headliner: the MC runs most nights; the GOOP takes tour finales.
  const tourSet = opts.tour ? TOUR.sets[opts.tour.set] : undefined;
  const finale = Boolean(opts.tour && opts.tour.song === 2);
  match.tour = opts.tour ?? null;
  match.bossKind = finale ? 'goop' : 'mc';
  match.goopTint = finale ? (tourSet?.tint ?? null) : null;
  match.eatIntro = finale;

  // Track: a tour night's record is fixed; otherwise an explicit choice
  // (the host's, over the wire) wins; then this headset's lobby preference;
  // then a pick derived from the match seed — which every client computes
  // identically, so a shuffled room still agrees on the record without
  // anyone sending it.
  const chosen =
    (tourSet ? trackById(tourSet.songs[opts.tour!.song]) : undefined) ??
    (opts.trackId ? trackById(opts.trackId) : undefined) ??
    (match.preferredTrack ? trackById(match.preferredTrack) : undefined) ??
    pickRaidTrack(match.seed);
  mountTrack(chosen);
  // Campaign nights stay night-sized even on marathon records.
  if (opts.tour) match.phrases = Math.min(match.phrases, TOUR.maxPhrases);

  match.beatZeroAt = opts.beatZeroAt ?? NaN;
  match.online = opts.online ?? false;
  buildRoster(seats, match.seed, match.mySeat, opts.humans);
  match.after = 'raid';
  match.screen = 'countdown';
  match.playing = false;
  match.beat = -Infinity;
  match.generation++;
}

/** The set resolves — freeze the board, raise the champion, pop confetti. */
export function finishRaid(): void {
  if (match.screen !== 'raid') return;
  const me = match.players.find((p) => p.kind === 'local');
  match.coinsPaid = 0;
  if (me) {
    const grade = gradeOf(me);
    // THE ONE WALLET: every finished record pays iron-dollars into FIRE
    // FIGHT's wallet — solo, tour night or club ring alike — the flat
    // bout rate plus a little for a clean night (config.songCoins).
    match.coinsPaid = songCoins(grade);
    addCoins(match.coinsPaid);
    if (match.tour) {
      // A tour night is CLEARED by surviving it — the letter is for
      // bragging, and the map keeps the best one ever taken home.
      recordTourGrade(match.tour.set, match.tour.song, grade);
      // No pop for the clear: that strip says HIT and PERFECT and nothing
      // else. The grade card, the podium board and the map's fresh ✓ all
      // carry the news anyway.
      if (me.alive) {
        markTourNightCleared(match.tour.set, match.tour.song);
        // THE LAST NIGHT. Survive the final record of the final set and the
        // credits are due: the podium plays out as usual, and the map you
        // walk back to is wearing them.
        const last = TOUR.sets.length - 1;
        if (match.tour.set === last && match.tour.song === TOUR.sets[last].songs.length - 1) {
          match.credits = true;
          // The closing theme is the prize, and it starts collected: it keeps
          // the decks when the card comes down instead of the foyer snapping
          // back to the house rotation mid-song. SYSTEM has the switch from
          // now on if they'd rather have the old menu music back.
          setMenuMusic('credits');
        }
      }
    } else {
      // A finished set posts to the song's leaderboards — this headset's
      // book, and the world board. Solo sets always did; the club's raids
      // now count too: it is the same record at the same tempo, dodged
      // against the same landings (an online ring shares its seed, track
      // and difficulty), and a score set beside other people is no less a
      // score. Only the campaign keeps to its own map. The world post is
      // fire-and-forget: it must never hold up the podium, and a set
      // danced offline is still a set.
      recordSoloRun(match.trackId, match.difficulty, me.score, grade, profileName());
      void submitWorldScore(match.trackId, match.difficulty, me.score, grade, profileName());
    }
  }
  match.screen = 'podium';
}

/** The campaign clamps match.difficulty per set; leaving a night puts the
 *  floor back on EXPERT, the only difficulty off the tour. */
function restorePickedDifficulty(): void {
  match.difficulty = DIFFICULTY.solo;
}

/** The tour screen (the campaign of song sets). */
export function toTour(): void {
  match.screen = 'tour';
  match.playing = false;
  match.beat = -Infinity;
  match.doubleTime = false; // the foyer's records run their own clocks
  restorePickedDifficulty();
  match.generation++;
}

/** Back to the lobby floor. */
export function toLobby(): void {
  // Every arrival on the floor is a visit, and the MC dresses for it.
  if (match.screen !== 'lobby') nextMcVisit();
  match.screen = 'lobby';
  match.playing = false;
  match.beat = -Infinity;
  match.doubleTime = false; // the house records run their own clocks
  match.tour = null;
  match.credits = false; // walking out to the foyer ends the roll
  restorePickedDifficulty();
  match.generation++;
}
