/**
 * Shared mutable app/match state — one plain singleton every system reads
 * and writes (the FIRE FIGHT `app` pattern). No framework, no events except
 * a couple of tiny queues ("buses") for cross-system one-shots.
 */

import { BOTS, GRADE, MUSIC, RING, type MoveKind } from '../config.js';
import { danceHue } from './profile.js';
import { mix, mulberry32 } from './rng.js';

export type Screen =
  | 'lobby' // the rave floor idles, menu up
  | 'countdown' // seats locked, music counting in
  | 'raid' // the set is live
  | 'podium' // set over — winner on high, board frozen
  | 'tour'; // the campaign screen: sets of nights

export interface Dancer {
  seat: number;
  kind: 'local' | 'bot' | 'remote';
  name: string;
  hue: number;
  /** Bot dodge chance (rolled from the seed; meaningless for humans). */
  skill: number;
  score: number;
  /** Consecutive dodges — the chain behind the HUD's ×N. (The field
   *  keeps its old name: it rides the score wire between clients.) */
  combo: number;
  bestCombo: number;
  dodges: number;
  perfects: number;
  /** Landings that clipped this dancer, all night — the grade's denominator
   *  along with `dodges`. */
  hits: number;
  /** Clipped landings BACK TO BACK. Any dodge wipes it; reaching
   *  GRADE.chainOut ends the night. Not a life count — a chain count. */
  missChain: number;
  alive: boolean;
  /** Song beat this dancer fell on (−1 while alive) — later = ranks higher. */
  elimAtBeat: number;
  /** 1-based live rank, recomputed by RankSystem. */
  rank: number;
  /** I-frames: landings before this song beat can't hurt this dancer. */
  invulnUntilBeat: number;
  /** Remote only: connection id on the relay. */
  netId?: number;
  /** A REAL PERSON's body (FF2's mannequin): their packed paint, packed
   *  gear and base tone off the wire. Empty for bots — the house's own
   *  couture figures are not painted. */
  look: string;
  gear: string;
  tone: string;
}

/** A one-shot the boss performs when a move starts telegraphing. */
export interface GestureCue {
  kind: MoveKind;
  chargeBeats: number;
  /** A follow-up strike inside a multi-landing move (seesaw halves,
   *  routine steps) — a quick jab/hook, not the full wind-up. */
  step?: boolean;
  /** Directional payload so the MC's body can ACT the move out: sweep entry
   *  side / seesaw-surge doomed side (platform-local sign). */
  side?: number;
  /** half-moves and gates: 0 = x split/column, 1 = z split/row. */
  axis?: number;
  /** gate only: the safe band's platform-local offset. */
  gapX?: number;
  /** beam only: THE X — the arms are thrown crossed. */
  crossed?: boolean;
  /** routine only: the whole corner sequence, so the boss can TEACH it —
   *  he points each one out in turn while the marks are still lit. */
  routine?: readonly number[];
  /** The landing this cue charges toward (song beats) — lets the MC time
   *  its strike snap without re-deriving the set-list. */
  dueBeat?: number;
}

/** A transient HUD flair (PERFECT! / HIT / NIGHT CLEARED). */
export interface Flair {
  text: string;
  tone: 'dodge' | 'perfect' | 'hit' | 'milestone' | 'info';
}

export interface MatchState {
  screen: Screen;
  /** What the countdown counts into. */
  after: 'raid';
  /** Bumped whenever the roster/seed/mode changes — systems that build
   *  things (arena, set-list, music) rebuild when they see a new number. */
  generation: number;
  /** Seats in the ring this match (RING.minSeats..maxSeats). */
  seats: number;
  /** My seat index (0 in solo; assigned by the relay online). */
  mySeat: number;
  seed: number;
  /** The record on the decks — its measured tempo IS match.bpm. */
  trackId: string;
  /** Lobby override: a track id to always play, or '' for seed shuffle. */
  preferredTrack: string;
  /** DIFFICULTY (0 easy · 1 normal · 2 hard · 3 expert) — the act floor for
   *  the whole song. EXPERT everywhere but the tour (DIFFICULTY.solo); a
   *  tour night sets its own, and the ball carries the caller's. */
  difficulty: number;
  bpm: number;
  /** Is this chart running EXPERT DOUBLE TIME? match.bpm is then 2× the
   *  record and match.beat counts the record's eighths. The danger keeps
   *  that clock; the SHOW dances to showBeat() below. */
  doubleTime: boolean;
  /** Total phrases in the current set — derived from the track's length. */
  phrases: number;
  /** Online only: AudioContext-clock time for beat 0 handed down by the
   *  relay sync (NaN = start whenever the music system likes). */
  beatZeroAt: number;
  players: Dancer[];

  /* ── the song clock (MusicSystem owns these) ── */
  playing: boolean;
  /** Continuous song position in beats (can be negative during count-in). */
  beat: number;
  /** Seconds per beat, cached from bpm. */
  beatLen: number;

  /* ── local dodge state (PlayerSystem owns these) ── */
  /** Calibrated standing head height (m). */
  standingHeight: number;
  /** Head position in MY platform space (origin = platform centre). */
  headX: number;
  headY: number;
  headZ: number;
  /** True while the head is below the duck line. */
  ducked: boolean;
  /** Live rhythm-swap streak (one hand up, one down, swap on the beat) —
   *  the glowstick sparks are its voice, the wedge's groove row its
   *  ledger. Never a word on screen. */
  grooveStreak: number;
  /** Points the CURRENT groove streak has paid so far — the HUD's combo
   *  tally. Resets with the streak, so it always reads "this run". */
  grooveScore: number;

  /* ── buses ── */
  gestures: GestureCue[];
  flairs: Flair[];


  /* ── the headliner ── */
  /** Who runs the stage this match: the MC most nights, the GOOP on
   *  finales. */
  bossKind: 'mc' | 'goop';
  /** Finale gel recolour (null = classic green). */
  goopTint: { shallow: number; deep: number; nucleus: number } | null;
  /** Finale opener: the MC is on stage for the count-in until the goop
   *  drops in and EATS him. */
  eatIntro: boolean;

  /* ── the tour (campaign) ── */
  /** Which night this raid is, or null for a free-play set. */
  tour: { set: number; song: number } | null;
  /** THE CREDITS ARE ROLLING. Set when the tour's last night is cleared and
   *  carried back to the map, where the board wears the credits card and the
   *  closing theme takes the decks. Cleared by dismissing it (or by walking
   *  out to the foyer). */
  credits: boolean;
  /** HOSTING, but not through the door yet: the board is showing the new
   *  room's code ("give this to your friends") and the foyer has to stay
   *  standing behind it. Both the board's own visibility and the club's
   *  swap-in read this, so the two can't disagree about where you are. */
  holdFoyer: boolean;
  /** The VR title card is up and still opaque. Nothing behind it may be
   *  clicked: the board is RIGHT THERE under the black, and a stray
   *  trigger during the show would fire a button nobody could see. Clears
   *  the moment the black starts lifting, so the menu is live as it fades
   *  in rather than a beat later. */
  introUp: boolean;

  /* ── online ── */
  online: boolean;
  roomCode: string;

  /* ── the one wallet (FF2) ── */
  /** Iron-dollars the last finished record paid into FIRE FIGHT's wallet
   *  (menu/wallet.ts) — the grade card names it. */
  coinsPaid: number;
}

export const match: MatchState = {
  // The TOUR MAP is the main attraction — it's the first thing you see.
  screen: 'tour',
  after: 'raid',
  generation: 0,
  seats: RING.defaultSeats,
  mySeat: 0,
  seed: 1,
  trackId: '',
  preferredTrack: '',
  difficulty: 3, // DIFFICULTY.solo — EXPERT off the tour
  bpm: MUSIC.fallbackBpm,
  doubleTime: false,
  phrases: 8,
  beatZeroAt: NaN,
  players: [],
  playing: false,
  beat: -Infinity,
  beatLen: 60 / MUSIC.fallbackBpm,
  standingHeight: 1.65,
  headX: 0,
  headY: 1.65,
  headZ: 0,
  ducked: false,
  grooveStreak: 0,
  grooveScore: 0,
  gestures: [],
  flairs: [],
  bossKind: 'mc',
  goopTint: null,
  eatIntro: false,
  tour: null,
  credits: false,
  holdFoyer: false,
  introUp: false,
  online: false,
  roomCode: '',
  coinsPaid: 0,
};

export const me = (): Dancer | undefined => match.players[0] && match.players.find((p) => p.kind === 'local');

/** Beats in one bar / one phrase for the current track. */
export const barBeats = (): number => MUSIC.beatsPerBar;
export const phraseBeats = (): number => MUSIC.beatsPerBar * MUSIC.barsPerPhrase;

/** The set's final beat (landings stop here; the outro rides out after). */
export const setEndBeat = (): number => match.phrases * phraseBeats();

/** Build the dancer roster for a raid. `humans` maps seat → name for online
 *  play; every unlisted seat becomes a seeded goo-groupie. */
export function buildRoster(
  seats: number,
  seed: number,
  mySeat: number,
  humans?: Map<number, { name: string; netId?: number; look?: string; gear?: string; tone?: string }>,
): void {
  const rng = mulberry32(mix(seed, 0xb07));
  const players: Dancer[] = [];
  let bots = 0;
  for (let seat = 0; seat < seats; seat++) {
    const human = seat === mySeat ? { name: 'YOU' } : humans?.get(seat);
    // Bots wear plain service tags, numbered around the ring.
    const botName = human ? '' : `BOT${String(++bots).padStart(2, '0')}`;
    players.push({
      seat,
      kind: seat === mySeat ? 'local' : human ? 'remote' : 'bot',
      name: human?.name ?? botName,
      hue: danceHue(seat, seat === mySeat),
      skill: BOTS.skillMin + rng() * (BOTS.skillMax - BOTS.skillMin),
      score: 0,
      combo: 0,
      bestCombo: 0,
      dodges: 0,
      perfects: 0,
      hits: 0,
      missChain: 0,
      alive: true,
      elimAtBeat: -1,
      rank: seat + 1,
      invulnUntilBeat: -Infinity,
      netId: human && 'netId' in human ? human.netId : undefined,
      look: (human && 'look' in human ? human.look : '') ?? '',
      gear: (human && 'gear' in human ? human.gear : '') ?? '',
      tone: (human && 'tone' in human ? human.tone : '') ?? 'white',
    });
  }
  // Local player first in the array = convenient; seat order via .seat.
  players.sort((a, b) => (a.kind === 'local' ? -1 : b.kind === 'local' ? 1 : a.seat - b.seat));
  match.players = players;
}

export function dancerAtSeat(seat: number): Dancer | undefined {
  return match.players.find((p) => p.seat === seat);
}

/** THE RANK LAW, as a comparator: the living above the fallen; the living
 *  by score; the fallen by who lasted longest. RankSystem orders the board
 *  with it, and the club uses it to name the night's winner (the crown). */
export function standingOrder(a: Dancer, b: Dancer): number {
  if (a.alive !== b.alive) return a.alive ? -1 : 1;
  if (a.alive) return b.score - a.score || b.combo - a.combo || a.seat - b.seat;
  return b.elimAtBeat - a.elimAtBeat || b.score - a.score || a.seat - b.seat;
}

/** Who owned the night — rank 1 under the law above. */
export function nightWinner(): Dancer | undefined {
  return [...match.players].sort(standingOrder)[0];
}

export function aliveCount(): number {
  return match.players.reduce((n, p) => n + (p.alive ? 1 : 0), 0);
}

/**
 * The night's letter for one dancer — the thing you actually take home.
 *
 * It reads the SET, not the scoreboard: what share of the landings thrown
 * at you did you survive, and how many of those did you leave to the last
 * beat. Points reward flair and dancing; the grade rewards not being hit.
 *
 * Falling to the chain is an F no matter how clean the night was up to it —
 * you didn't finish the record, and the letter says so.
 */
export function gradeOf(d: Dancer): string {
  if (!d.alive) return GRADE.fail;
  const faced = d.dodges + d.hits;
  if (faced === 0) return GRADE.fail; // nothing danced, nothing earned
  const rate = d.dodges / faced;
  const perfectRate = d.perfects / faced;
  for (const cut of GRADE.cuts) {
    if (rate >= cut.rate && perfectRate >= cut.perfect) return cut.letter;
  }
  return GRADE.fail;
}

/** The share of landings survived, 0..1 — the grade's raw number. */
export function dodgeRate(d: Dancer): number {
  const faced = d.dodges + d.hits;
  return faced === 0 ? 0 : d.dodges / faced;
}

/** The beat of the RECORD itself — the clock the SHOW dances to. On an
 *  EXPERT double-time chart, match.beat runs at 2× the record (the chart
 *  grid rides the eighths) and the danger keeps that clock — but the MC's
 *  groove, the groupies' bob, the light rig, the count-in card and the
 *  player's own groove judge all pump to the record's real pulse, or a
 *  95 BPM strut would get a 190 BPM show and a DJ with a fork in a
 *  socket. Continuous, and negative through the count-in, exactly like
 *  match.beat. */
export function showBeat(): number {
  return match.doubleTime ? match.beat / 2 : match.beat;
}

export function pushFlair(text: string, tone: Flair['tone']): void {
  match.flairs.push({ text, tone });
  if (match.flairs.length > 6) match.flairs.shift();
}

/**
 * Where each NON-LOCAL dancer currently stands on their own deck
 * (platform-local x/z), written by AvatarSystem every frame — zone judges
 * read these. The local player's spot is match.headX/Z directly.
 */
export const liveSpots = new Map<number, { x: number; z: number }>();

/* ── tour progress (localStorage) ─────────────────────────────────────── */

import { TOUR, TOUR_KEY } from '../config.js';

export function clearedTourNights(): Set<string> {
  try {
    const raw = localStorage.getItem(TOUR_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function markTourNightCleared(set: number, song: number): void {
  const done = clearedTourNights();
  done.add(`${set}:${song}`);
  try {
    localStorage.setItem(TOUR_KEY, JSON.stringify([...done]));
  } catch {
    /* storage may be unavailable */
  }
}

/** Every night of every set that's actually for sale, cleared. The tour is
 *  over, the credits have rolled, and a couple of things open up. */
export function campaignComplete(): boolean {
  const done = clearedTourNights();
  for (let s = 0; s < TOUR.freeSets; s++) {
    for (let i = 0; i < TOUR.sets[s].songs.length; i++) if (!done.has(`${s}:${i}`)) return false;
  }
  return true;
}

/* ── the closing theme, kept (localStorage) ───────────────────────────────
 * Finish the tour and the record that played over the credits is yours: it
 * stays on the foyer's decks instead of handing back to the house rotation
 * when the card comes down. It's a preference, not a state — SYSTEM shows
 * the switch once the tour is done, and never before. */

const MENU_MUSIC_KEY = 'gdr-menu-music';

export type MenuMusic = 'original' | 'credits';

export function menuMusic(): MenuMusic {
  try {
    return localStorage.getItem(MENU_MUSIC_KEY) === 'credits' ? 'credits' : 'original';
  } catch {
    return 'original';
  }
}

export function setMenuMusic(choice: MenuMusic): void {
  try {
    localStorage.setItem(MENU_MUSIC_KEY, choice);
  } catch {
    /* storage may be unavailable */
  }
}

/** Night 1 of set 1 is always open; a night needs the previous night, and a
 *  set needs the whole set before it. */
export function tourNightUnlocked(set: number, song: number): boolean {
  if (set >= TOUR.freeSets) return false; // the teaser rows — not for sale yet
  const done = clearedTourNights();
  for (let s = 0; s < set; s++) {
    for (let i = 0; i < 3; i++) if (!done.has(`${s}:${i}`)) return false;
  }
  for (let i = 0; i < song; i++) if (!done.has(`${set}:${i}`)) return false;
  return true;
}

/* ── the record book (localStorage) ─────────────────────────────────────
 * Two ledgers, both strictly local to this headset:
 *  - TOUR GRADES: the best letter ever taken home from each campaign
 *    night (any difficulty) — the map wears them under its stops.
 *  - SOLO RUNS: per song × difficulty, the top scores of finished solo
 *    sets (bots only — online raids and campaign nights never post here)
 *    plus the best letter at that difficulty. The SOLO tab's leaderboard.
 */

const TOUR_GRADES_KEY = 'gdr-tour-grades';
const SOLO_KEY = 'gdr-solo';
/** Deep enough that the song page's scroll has something to do. */
const SOLO_TOP = 10;

/** Higher is better; unknown letters rank below F. */
export function gradeRank(letter: string): number {
  return ['F', 'C', 'B', 'A', 'S'].indexOf(letter);
}

function readStore<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeStore(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage may be unavailable */
  }
}

export function bestTourGrade(set: number, song: number): string | null {
  const book = readStore<Record<string, string>>(TOUR_GRADES_KEY);
  return book?.[`${set}:${song}`] ?? null;
}

export function recordTourGrade(set: number, song: number, grade: string): void {
  const key = `${set}:${song}`;
  const book = readStore<Record<string, string>>(TOUR_GRADES_KEY) ?? {};
  const prev = book[key];
  if (prev !== undefined && gradeRank(prev) >= gradeRank(grade)) return;
  book[key] = grade;
  writeStore(TOUR_GRADES_KEY, book);
}

export interface SoloRun {
  /** Final score. */
  s: number;
  /** The night's letter. */
  g: string;
  /** Who set it (the profile name when the run finished). */
  n: string;
}

interface SoloEntry {
  best: string;
  runs: SoloRun[];
}

const soloKey = (trackId: string, difficulty: number): string => `${trackId}:${difficulty}`;

/** The song's local leaderboard at one difficulty: best letter + top runs
 *  (score-sorted, capped). Empty runs = the chart is unclaimed. */
export function soloBoard(trackId: string, difficulty: number): { best: string | null; runs: SoloRun[] } {
  const book = readStore<Record<string, SoloEntry>>(SOLO_KEY);
  const entry = book?.[soloKey(trackId, difficulty)];
  return { best: entry?.best ?? null, runs: entry?.runs ?? [] };
}

/** Post a finished solo set. Keeps the top runs by score and the best
 *  letter by rank (they can disagree: a careful low-score set may out-grade
 *  a flashy one — both records deserve keeping). */
export function recordSoloRun(trackId: string, difficulty: number, score: number, grade: string, name: string): void {
  const key = soloKey(trackId, difficulty);
  const book = readStore<Record<string, SoloEntry>>(SOLO_KEY) ?? {};
  const entry = book[key] ?? { best: grade, runs: [] };
  if (gradeRank(grade) > gradeRank(entry.best)) entry.best = grade;
  entry.runs.push({ s: Math.round(score), g: grade, n: name });
  entry.runs.sort((a, b) => b.s - a.s);
  entry.runs.length = Math.min(entry.runs.length, SOLO_TOP);
  book[key] = entry;
  writeStore(SOLO_KEY, book);
}

