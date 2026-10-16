/**
 * Top-level app state — the lobby vs. an active bout vs. Aim Training.
 *
 *  - 'menu'     : standing on your platform at the floating menu, choosing.
 *  - 'queueing' : you pressed 1V1 QUICK MATCH; waiting for the relay server
 *                 to pair you with another boxer.
 *  - 'playing'  : a bout is live, vs the bot (`mode: 'bot'`) or a real
 *                 opponent over the wire (`mode: 'net'`).
 *  - 'training' : Aim Training — pop-up targets, optional return fire.
 *
 * MenuSystem and NetworkSystem own the transitions; the combat systems read
 * `state`/`mode` to know when and what to simulate.
 */

export type AppState = 'menu' | 'queueing' | 'playing' | 'training';
/** 'campaign' = an ARCADE titan bout: CampaignSystem drives the opponent (no
 *  pose bus, no bot, no net) and GameStateSystem stands down. */
export type AppMode = 'bot' | 'net' | 'campaign';
export type { ArcadeMode } from '../config.js';
import type { ArcadeMode, Difficulty } from '../config.js';
import { DIFFICULTY_ORDER } from '../config.js';

/** The player's last-picked run difficulty, remembered across sessions and
 *  clamped to a valid tier on load. */
function loadDifficulty(): Difficulty {
  try {
    const v = localStorage.getItem('ff-difficulty');
    if (v && (DIFFICULTY_ORDER as string[]).includes(v)) return v as Difficulty;
  } catch {
    /* private mode — default */
  }
  return 'normal';
}
/** The arena backdrop: bare AR passthrough, the papercraft desert, the salt
 *  flats, THE COVE (sundown on Tidewater's beach), or the (shelved) factory. */
export type AppEnvironment = 'ar' | 'desert' | 'saltflats' | 'cove' | 'factory' | 'neon';
/** Set once the NEON UPDATE has moved this device's saved arena to NEON. */
const NEON_UPDATE_KEY = 'ff-env-neon-update';

export interface LifetimeStats {
  wins: number;
  losses: number;
  trainingBest: number;
  ballsThrown: number;
  hitsLanded: number;
}

/**
 * The glove accent is the HOUSE EMBER for everyone — ≈0.07 at neutral
 * lightness. It was a pair of locker sliders once; the tracks are gone, so
 * these are the only values the accent ever takes (they still ride the wire
 * in every pose packet, so rivals paint your hands the same as you do).
 */
export const DEFAULT_ACCENT_HUE = 0.07;
export const DEFAULT_ACCENT_LIGHT = 0.5;

/** Per-fist ball attachment: [left, right], each 0 none / 1 split / 2 grow / 3 shrink. */
function loadBallAttach(): [number, number] {
  const raw = localStorage.getItem('ff-ballattach');
  const parts = (raw ?? '').split(',').map((s) => parseInt(s, 10));
  const clamp = (n: number): number => (Number.isFinite(n) && n >= 0 && n <= 3 ? n : 0);
  return [clamp(parts[0]), clamp(parts[1])];
}

/** Per-fist 'Arc' toggle — when on, that fist's ball curves along the punch.
 *  (The UI now offers ONE curve tick in the loadout's ADVANCED face and
 *  writes both fists together, but the per-fist storage stays: the pub's
 *  FightSystem and old saves read the same 'ff-ballarc' pair.) */
function loadBallArc(): [boolean, boolean] {
  const parts = (localStorage.getItem('ff-ballarc') ?? '').split(',');
  return [parts[0] === '1', parts[1] === '1'];
}

/** CURVE STRENGTH (0.1..1): scales how hard an ARC throw banks. */
function loadCurveStrength(): number {
  const n = parseFloat(localStorage.getItem('ff-curvestrength') ?? '');
  return Number.isFinite(n) ? Math.min(1, Math.max(0.1, n)) : 1;
}

/** Show your OWN torso in a bout — off = clearer view when looking down
 *  (your head is already unseen; this extends that to the body). Rivals
 *  always see your body either way. */
function loadShowBody(): boolean {
  return localStorage.getItem('ff-showbody') !== '0';
}

function loadStats(): LifetimeStats {
  try {
    const raw = localStorage.getItem('ff-stats');
    if (raw) return { wins: 0, losses: 0, trainingBest: 0, ballsThrown: 0, hitsLanded: 0, ...JSON.parse(raw) };
  } catch {
    /* fresh start */
  }
  return { wins: 0, losses: 0, trainingBest: 0, ballsThrown: 0, hitsLanded: 0 };
}

export const app: {
  state: AppState;
  mode: AppMode;
  /** Network side: 0 = host (match authority), 1 = guest. */
  side: 0 | 1;
  /**
   * Active arena layout for the current bout. '1v1' is the classic duel (and
   * the lobby default); '2v2' and 'ffa' are the ARCADE brawls. Drives the
   * platform roster, combatant count and HUD.
   */
  arcade: ArcadeMode;
  /**
   * My CANONICAL seat in a networked arcade bout (0..N-1 in the shared
   * MODE_LAYOUT). 0 for bot bouts, the classic duel and the mesh host; a mesh
   * guest gets the seat matchmaking assigned. The local view is always rebuilt
   * with me at index 0 (see combat/layout.ts), so gameplay never sees this
   * directly — only the netcode's coordinate transforms do.
   */
  mySlot: number;
  /** Human-readable connection status for the lobby info panel. */
  netStatus: string;
  /**
   * THE CLUB's door, held. While the arena waits for the venue's floor to
   * answer (the room server sleeps on a free tier and takes up to a minute
   * to wake — experience/ClubExperienceManager holdForTheFloor) this is the
   * line the CLUB tab reads out. Empty when nobody is waiting.
   */
  venueStatus: string;
  /**
   * The guided BASICS TUTORIAL is running. It rides a normal vs-bot bout, but
   * a standalone TutorialSystem (the ONLY reader of this flag) layers pop-ups,
   * a half-health bot and a paced lesson script on top WITHOUT touching any
   * combat system. False in every normal bout, so the regular game is
   * untouched — set true only by the lobby's TUTORIAL button.
   */
  tutorial: boolean;
  /** While the tutorial owns the trigger — its whole opening beat, plus the
   *  single frame of any tutorial-console click — the fireballs hold off so
   *  a UI click never doubles as an ignite or a throw. TutorialSystem
   *  re-asserts it every frame; it can never outlive the frame that set it. */
  tutorialHoldFire: boolean;
  /** The tutorial's sparring bot stands as a statue — centred on his pad,
   *  facing the player, never strafing or winding up — until the throw beat
   *  names him ("See this rust bucket?"). Written only by TutorialSystem,
   *  read only by BotSystem; false in every normal bout. */
  tutorialBotFrozen: boolean;
  /** True once the tutorial has been RUN once (finished, win or lose — a
   *  forfeit doesn't count). Until then the lobby is sealed: only the
   *  tutorial, the Gazette, passthrough and settings answer (MenuSystem's
   *  pre-tutorial gate). Persisted as 'ff-tutorial-done'. */
  tutorialDone: boolean;
  /** Aim Training option: targets shoot back so you can train dodging. */
  shootBack: boolean;
  /** When on: never queue online — RANKED is disabled and QUICK/2V2/FFA drop
   *  straight onto bots with no matchmaking. */
  onlyBots: boolean;
  /** How many boxers are in the quick-match queue right now (−1 = unknown,
   *  e.g. before the matchmaker is reachable). Drives the 1V1 panel. */
  searching: number;
  /** Total punters across all pub regions right now (−1 = none reachable).
   *  Drives the pub door's headcount badge. */
  pubCount: number;
  /** Punter count per pub region id (for the EU/USA door picker). */
  pubRegionCounts: Record<string, number>;
  /**
   * I am in this bout as a WATCHER, not a fighter (DESIGN §3.2): dealt to
   * the match's place with the squad, standing on the audience ground
   * outside the cage line. No platform, no fireballs, nothing to hit — and
   * the fighters never hear my words, only the crowd (audio/crowd.ts).
   */
  spectating: boolean;
  /** Which face the lobby info panel shows: its doors, or the pub-region picker. */
  infoView: 'root' | 'pubpick';
  /** THE PAINT BAY is open over the lobby (modal, like customisation —
   *  the locker mirror stands beside it so placement is live). */
  paintBayOpen: boolean;
  /** THE READER: the paper held up large in front of you, a modal over the
   *  arc — opened by tapping the page on the TOWN wing. */
  readerOpen: boolean;
  /** Which titan is being fought while mode === 'campaign' (0-based stage). */
  campaignStage: number;
  /**
   * How the campaign is being played: one titan ('single'), the timed
   * back-to-back GAUNTLET RUN (health refills between titans), HARDCORE
   * (same run, no healing), the four-player RAID (always a full run), or
   * GOOPLIATH — the gel boss's own single long fight (sealed until the
   * gauntlet is cleared; raids swap to him via raidGoopliath instead).
   */
  campaignMode: 'single' | 'gauntlet' | 'hardcore' | 'raid' | 'goopliath';
  /**
   * Which arcade LOBBY modal is open over the lobby, or null when none. One
   * shared browser/seats/voice modal now serves every networked arcade mode:
   * '2v2', 'ffa' (launch into a live mesh brawl) and 'raid' (launch into the
   * co-op titan run). null = closed. Replaces the old raid-only flag.
   */
  lobbyMode: ArcadeMode | null;
  /** Which face the lobby modal shows: the room browser, or a joined squad. */
  lobbyView: 'browser' | 'lobby';
  /** Open rooms for the browser (live from lobbyWatch, for `lobbyMode`). */
  lobbyRooms: { id: string; host: string; count: number; cap: number; hardcore: boolean; goopliath: boolean }[];
  /** The launched raid runs hardcore (host's lobby toggle, stamped at start). */
  raidHardcore: boolean;
  /** Raider count SNAPSHOT at raid launch (2–5) — boss pools and cadence
   *  scale off this, and it deliberately never shrinks mid-run: a disconnect
   *  must not deflate a boss the survivors are already fighting. */
  raidSize: number;
  /** The launched raid is the GOOPLIATH fight instead of the titan run
   *  (host's lobby breaker, stamped at start — same law as raidHardcore). */
  raidGoopliath: boolean;
  /** Difficulty for the current RUN (gauntlet/hardcore/raid). Single stages
   *  and the solo GOOPLIATH fight ignore it (always Normal). Persisted; a
   *  raid stamps the host's pick here at launch. */
  difficulty: Difficulty;
  /** Which backdrop the arena renders — held across every mode. */
  environment: AppEnvironment;
  /** Avatar-accent hue (0..1 around the colour wheel) — the house ember for
   *  everyone now that the locker's tracks are gone; still wired so pose
   *  packets keep carrying it. */
  accentHue: number;
  /** Avatar-accent lightness (0..1, 0.5 = neutral) — see accentHue. */
  accentLight: number;
  /** Ball attachment per fist: [left, right] (0 none/1 split/2 grow/3 shrink). */
  ballAttach: [number, number];
  /** Per-fist 'Arc' toggle [left, right]: the ball curves along the punch.
   *  The ADVANCED face writes both together — see loadBallArc for why the
   *  pair survives. */
  ballArc: [boolean, boolean];
  /** CURVE STRENGTH (0.1..1): scales how hard an ARC throw banks. */
  curveStrength: number;
  /** Show your OWN torso in a bout (rivals always see it regardless). */
  showBody: boolean;
  /**
   * Which face the 1V1 panel shows: the mode list, the private-match flow, or
   * the RANKED server browser ('browser'). Hosting/joining stays on 'browser' —
   * your own room shows in the list (unclickable) while you wait.
   */
  duelView: 'root' | 'private' | 'hosting' | 'keypad' | 'browser';
  /** Open ranked rooms for the server browser (live from rankedWatch). */
  rankedRooms: { id: string; host: string }[];
  /** How many raid squads are forming right now (−1 = unknown). Drives the
   *  RAID button's live badge, like rankedRooms does for RANKED. */
  raidsOpen: number;
  /** While hosting a ranked room, its doc id — so the browser marks our own row
   *  and leaves it unclickable. Empty when we're not hosting. */
  rankedRoomId: string;
  /** While waiting in a ranked room: are we the host (true) or a joiner (false)? */
  rankedHost: boolean;
  /** We entered the current bout from the ranked browser — return there after. */
  fromRanked: boolean;
  /**
   * This duel came out of the QUICK MATCH queue, so it runs best of three
   * (MATCH.winTargetQuick) rather than the best of five ranked and private
   * matches keep. Set by the net client's matchmaking entry points, which are
   * the only ways a duel can begin, so it always agrees with the pool the bout
   * actually came from — and therefore with the opponent, who came from the
   * same pool. See MATCH.winTargetQuick for why that matters.
   */
  quickDuel: boolean;
  /** The 5-digit code shown while hosting a private match. */
  privateCode: string;
  /**
   * Format the private-match host has picked, chosen BEFORE the code is
   * reserved: '1v1' runs the ordinary duel over the 1v1 transport, while '2v2'
   * and 'ffa' open a coded room on the arcade mesh. A joiner never needs this —
   * the code itself carries its room's mode (see mesh.joinPrivate).
   */
  privateMode: ArcadeMode;
  /** Digits typed on the join keypad (up to 5). */
  codeEntry: string;
  stats: LifetimeStats;
} = {
  state: 'menu',
  mode: 'bot',
  tutorial: false,
  tutorialHoldFire: false,
  tutorialBotFrozen: false,
  tutorialDone: loadTutorialDone(),
  side: 0,
  arcade: '1v1',
  mySlot: 0,
  netStatus: 'not connected',
  venueStatus: '',
  // Off unless the player has explicitly switched it on.
  shootBack: localStorage.getItem('ff-shootback') === '1',
  // BOTS ONLY has no toggle on the menu for now, so it starts off — a
  // player who'd switched it on isn't left locked out of ranked and raids.
  onlyBots: false,
  searching: -1,
  pubCount: -1,
  pubRegionCounts: {},
  spectating: false,
  infoView: 'root',
  paintBayOpen: false,
  readerOpen: false,
  campaignStage: 0,
  campaignMode: 'single',
  lobbyMode: null,
  lobbyView: 'browser',
  lobbyRooms: [],
  raidHardcore: false,
  raidGoopliath: false,
  raidSize: 4,
  difficulty: loadDifficulty(),
  environment: ((): AppEnvironment => {
    // THE NEON UPDATE: everyone — returning boxers with an old arena saved
    // included — opens once in NEON, in the back street. The marker makes it
    // one-shot, so a pick made in SETTINGS » ARENA after that sticks.
    try {
      if (localStorage.getItem(NEON_UPDATE_KEY) !== '1') {
        localStorage.setItem(NEON_UPDATE_KEY, '1');
        localStorage.setItem('ff-env', 'neon');
        return 'neon';
      }
    } catch {
      return 'neon';
    }
    const e = localStorage.getItem('ff-env');
    // After that we honour whatever the player last chose — including bare
    // AR. The OLD FACTORY backdrop is shelved, so anyone who had it equipped
    // lands in NEON too.
    if (e === 'desert' || e === 'saltflats' || e === 'cove' || e === 'neon' || e === 'ar') return e;
    return 'neon';
  })(),
  accentHue: DEFAULT_ACCENT_HUE,
  accentLight: DEFAULT_ACCENT_LIGHT,
  ballAttach: loadBallAttach(),
  ballArc: loadBallArc(),
  curveStrength: loadCurveStrength(),
  showBody: loadShowBody(),
  duelView: 'root',
  rankedRooms: [],
  raidsOpen: -1,
  rankedRoomId: '',
  rankedHost: false,
  fromRanked: false,
  quickDuel: false,
  privateCode: '',
  privateMode: '1v1',
  codeEntry: '',
  stats: loadStats(),
};

export function saveStats(): void {
  try {
    localStorage.setItem('ff-stats', JSON.stringify(app.stats));
  } catch {
    /* storage unavailable — stats stay in-memory */
  }
}

export function saveOnlyBots(): void {
  try {
    localStorage.setItem('ff-onlybots', app.onlyBots ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function saveShootBack(): void {
  try {
    localStorage.setItem('ff-shootback', app.shootBack ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function saveDifficulty(): void {
  try {
    localStorage.setItem('ff-difficulty', app.difficulty);
  } catch {
    /* ignore */
  }
}

function loadTutorialDone(): boolean {
  try {
    // `?tutorial=done` clears the gate (and `?tutorial=reset` puts it back) so
    // a playtest headset can reach RANKED/RAID/2V2 without running the basics
    // first — there's no console or keyboard on a Quest to poke localStorage
    // with. It WRITES the flag, so the rest of the session (and every later
    // launch) behaves exactly like a boxer who really did clear the tutorial.
    const param = new URLSearchParams(location.search).get('tutorial');
    if (param === 'done' || param === 'reset') {
      localStorage.setItem('ff-tutorial-done', param === 'done' ? '1' : '0');
    }
    return localStorage.getItem('ff-tutorial-done') === '1';
  } catch {
    return false;
  }
}

export function saveTutorialDone(): void {
  try {
    localStorage.setItem('ff-tutorial-done', app.tutorialDone ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function saveEnvironment(): void {
  try {
    localStorage.setItem('ff-env', app.environment);
  } catch {
    /* ignore */
  }
}

export function saveBallAttach(): void {
  try {
    localStorage.setItem('ff-ballattach', `${app.ballAttach[0]},${app.ballAttach[1]}`);
  } catch {
    /* ignore */
  }
}

export function saveBallArc(): void {
  try {
    localStorage.setItem('ff-ballarc', `${app.ballArc[0] ? 1 : 0},${app.ballArc[1] ? 1 : 0}`);
  } catch {
    /* ignore */
  }
}

export function saveCurveStrength(): void {
  try {
    localStorage.setItem('ff-curvestrength', app.curveStrength.toFixed(2));
  } catch {
    /* ignore */
  }
}

export function saveShowBody(): void {
  try {
    localStorage.setItem('ff-showbody', app.showBody ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Live Aim Training session numbers (TrainingSystem writes, UI reads). */
export const training = {
  active: false,
  score: 0,
  hits: 0,
  thrown: 0,
  streak: 0,
  bestStreak: 0,
  timeLeft: 0,
  /** Set when a run ends so the UI can show the result. */
  lastScore: 0,
};
