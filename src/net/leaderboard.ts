/**
 * Firebase-backed leaderboards, riding the same Firestore project that does
 * matchmaking (collection `players`, one doc per anonymous player id).
 *
 * Two boards:
 *  - 1V1: ranks SCORE — a real win banks a flat +20, a practice win over the
 *    bot a token +2; losers lose NOTHING. A HIDDEN per-player ELO (K=32) still
 *    moves on every REAL result (rival-quality signal for matchmaking) but no
 *    longer weights the score, and the bot has no rating to move.
 *  - AIM TRAINING: personal-best run scores.
 *
 * Identity is a localStorage uuid with a derived IRON-XXXX callsign — no
 * sign-in. Firestore + firebase/app load lazily so lobby/bot players who
 * never go online don't pay for the bundle. Needs Firestore rules opening
 * the `players` collection (same hackathon-grade shape as `lobbies`).
 */

import { FIREBASE_ENABLED, cloud, cloudNote, cloudUid, type Cloud } from './firebase.js';
import { boardRows, fetchBoard, postScore, runBoardsFor, runPostBoards, type BoardRow } from './boards.js';
import { xpForArcade, xpForBot, xpForCampaign, xpForMatch, xpForTraining, xpForTutorial } from '../menu/progression.js';
import { myPackedLook } from '../avatar/paint.js';
import { customization, myPackedGear } from '../menu/customization.js';
import { addCoins } from '../menu/wallet.js';
import { CURRENCY, LADDER, seasonIndex, seasonScoreField, TV, type ArcadeMode, type Difficulty } from '../config.js';

export interface LbRow {
  /** The player's doc id — identifies them when their row is clicked. */
  uid: string;
  name: string;
  value: number;
  /** This row is YOU — the UI highlights it. */
  me: boolean;
  /** Cumulative XP — drives the rank badge on every board + the profile. */
  xp: number;
  /** RANKED ladder points, for the profile card. (Raw ELO is a hidden
   *  matchmaking signal and never leaves this module for display.) */
  score: number;
  /** Season honours: counts per trophy — first/second/third/top10/top25. */
  awards: Partial<Record<SeasonAward, number>>;
  /** Highest campaign-gauntlet clear: 0 none · 1 normal · 2 hard · 3 blazing. */
  gauntletBest: number;
  /** Highest gauntlet clear done HARDCORE (same tiers) — when it matches the
   *  badge's tier, the profile glyph burns red. */
  gauntletBestHc: number;
  /** Highest raid clear, same tiers. */
  raidBest: number;
  /** Highest hardcore raid clear. */
  raidBestHc: number;
  /** Highest GOOPLIATH-raid clear, same tiers. (The tide has no hardcore —
   *  one long fight — so the drop never reddens.) */
  goopBest: number;
  /** The player's self-written note, shown on their profile. */
  note: string;
  /** Their packed paint look (avatar/paint.ts wire form; '' = unpainted) —
   *  the profile card renders the painting behind the name from this. */
  look: string;
  /** Their base tone ('blank' | 'onyx'), for the banner's ground. */
  tone: string;
  /** Their worn gear, packed (avatar/gear.ts) — the profile card names it. */
  gear: string;
  /** The deck they fight on (a PLATFORM_SKINS id) — the gazette names it. */
  pad: string;
}

/** The season-end honours, best first. */
export type SeasonAward = 'first' | 'second' | 'third' | 'top10' | 'top25';
export const SEASON_AWARDS: SeasonAward[] = ['first', 'second', 'third', 'top10', 'top25'];

/** The score boards (BATTLE's 1v1 / 2v2 / ffa, XP), the ARCADE boards (AIM
 *  training plus the two PvE RUN-TIME boards) and a synthetic PROFILE face. */
export type LeaderboardTab =
  | 'ranked'
  | 'xp'
  | 'training'
  | 'duo'
  | 'ffa'
  | 'gauntlet'
  | 'raid'
  | 'goopliath'
  | 'profile';
/** Score/count boards (one numeric value per PLAYER doc). */
type DataTab = 'ranked' | 'xp' | 'training' | 'duo' | 'ffa';
/** RUN-TIME boards — each row is one completed RUN (a squad + a clock), not a
 *  player. One tab per mode — GOOPLIATH raids race their own clock (one long
 *  fight is a different race from a five-titan run, so they never share a
 *  board with titan raids). Behind each tab sit its boards (difficulty ×
 *  hardcore), and the tab's view (runView) picks one tier's clock to race;
 *  EASY runs never rank at all. */
export type RunTab = 'gauntlet' | 'raid' | 'goopliath';
const RUN_TABS: RunTab[] = ['gauntlet', 'raid', 'goopliath'];
/**
 * The boards behind a run tab: every FEAT board of that run family — one per
 * difficulty, and one per difficulty for HARDCORE — plus the legacy mixed
 * board where there is one (boards.ts runBoard has the why). They are all
 * `-time` boards, which is not cosmetic: firestore.rules reads that suffix
 * to decide which way the ratchet turns.
 */
function runBoards(tab: RunTab): string[] {
  return runBoardsFor(tab);
}

/** One entry on a run board: the whole squad (one name for a solo gauntlet,
 *  up to five for a raid), the run's cumulative fight-time clock, and the
 *  feat's markers (difficulty + hardcore) for the row symbols. */
export interface RunRow {
  /** Who posted the row (each raider posts their own). */
  uid: string;
  names: string[];
  seconds: number;
  /** 'normal' | 'hard' | 'blazing' (legacy rows read as normal). */
  difficulty: Difficulty;
  hardcore: boolean;
  /** My callsign is on this run — the UI highlights it. */
  me: boolean;
}

/**
 * How a run board is being looked at: one difficulty's FASTEST clears, the
 * clock alone deciding. `hc` narrows it to hardcore runs. (There used to be
 * a FEATS view — everyone's hardest clear, hardest first — and it's gone:
 * every board is a plain race against the clock now.)
 */
export type RunViewTier = 'normal' | 'hard' | 'blazing';
export const RUN_VIEW_TIERS: RunViewTier[] = ['normal', 'hard', 'blazing'];

/**
 * Build a run board's VIEW from every row its boards returned.
 *
 * The same run lands on more than one board (its tier board, its hardcore
 * board, the legacy mixed board) and every raider posts their own copy, so
 * the raw pile is full of repeats. Per player, keep their fastest run on the
 * view's tier; then fold raiders who posted the SAME run into one squad row.
 */
function buildRunView(raw: RunRow[], tier: RunViewTier, hc: boolean): RunRow[] {
  const pool = raw.filter((r) => (!hc || r.hardcore) && r.difficulty === tier);
  const best = new Map<string, RunRow>();
  for (const r of pool) {
    const cur = best.get(r.uid);
    if (!cur || r.seconds < cur.seconds) best.set(r.uid, r);
  }
  const squads = new Map<string, RunRow>();
  for (const r of best.values()) {
    const key = `${[...r.names].sort().join('|')}#${r.seconds}#${r.difficulty}#${r.hardcore}`;
    const cur = squads.get(key);
    if (cur) cur.me = cur.me || r.me;
    else squads.set(key, { ...r });
  }
  return [...squads.values()].sort((a, b) => a.seconds - b.seconds).slice(0, LEADERBOARD_FETCH_LIMIT);
}

const LEADERBOARD_FETCH_LIMIT = 50;
/** Rows the lobby board shows at once — the full top 10, no scrolling needed
 *  to take in the ladder; ranks 11+ (up to the fetch limit) reveal on scroll.
 *  The menu panel imports this so what's drawn and what scroll clamps to agree. */
export const LEADERBOARD_VISIBLE_ROWS = 10;

/** Live leaderboard state the lobby panel reads each redraw. */
export const leaderboard = {
  // PROFILE is the panel's landing face — your own card first, boards a tap away.
  tab: 'profile' as LeaderboardTab,
  ranked: [] as LbRow[],
  xp: [] as LbRow[],
  training: [] as LbRow[],
  duo: [] as LbRow[],
  ffa: [] as LbRow[],
  gauntlet: [] as RunRow[],
  raid: [] as RunRow[],
  goopliath: [] as RunRow[],
  /** Every row the run tabs' boards returned, before the view is applied. */
  runRaw: { gauntlet: [], raid: [], goopliath: [] } as Record<RunTab, RunRow[]>,
  /** How the run tabs are being looked at (shared by all three). */
  runView: { tier: 'normal' as RunViewTier, hc: false },
  scroll: {
    ranked: 0,
    xp: 0,
    training: 0,
    duo: 0,
    ffa: 0,
    gauntlet: 0,
    raid: 0,
    goopliath: 0,
  } as Record<DataTab | RunTab, number>,
  status: FIREBASE_ENABLED ? 'loading…' : 'leaderboard offline',
  /** Whose profile the PROFILE face shows; null = your own. */
  viewRow: null as LbRow | null,
};

/** The current rival's claim about themselves (peer `iam` message). `look`
 *  is their packed paint (validated only when unpacked for the bake). */
export const rival = { name: 'RIVAL', elo: 1000, avatarSkin: '', platformSkin: '', avColor: -1, avLight: 0.5, look: '', gear: '' };

const ELO_K = 32;

const profile = {
  id: '',
  name: '',
  score: 0, // the CURRENT season's ladder points
  elo: 1000,
  training: 0,
  duo: 0,
  ffa: 0,
  xp: 0,
  note: '',
  awards: {} as Partial<Record<SeasonAward, number>>,
  /** Last season index whose final standings we've claimed honours for. */
  awardedThrough: 0,
  gauntletBest: 0,
  gauntletBestHc: 0,
  raidBest: 0,
  raidBestHc: 0,
  goopBest: 0,
};

/** Your own profile as a board row (for the PROFILE face when viewing self). */
export function myProfileRow(): LbRow {
  return {
    uid: profile.id,
    name: profile.name,
    value: profile.score,
    me: true,
    xp: profile.xp,
    score: profile.score,
    awards: profile.awards,
    gauntletBest: profile.gauntletBest,
    gauntletBestHc: profile.gauntletBestHc,
    raidBest: profile.raidBest,
    raidBestHc: profile.raidBestHc,
    goopBest: profile.goopBest,
    note: profile.note,
    look: myPackedLook(),
    tone: customization.avatar,
    gear: myPackedGear(),
          pad: customization.platform,
  };
}

export function myNote(): string {
  return profile.note;
}

/** Save the typed profile note — sanitised to the keyboard alphabet, max 48. */
export function setPlayerNote(raw: string): void {
  const note = raw.replace(/[^A-Z0-9\- ]/gi, '').replace(/\s+/g, ' ').trim().slice(0, 48);
  profile.note = note;
  writeMine({ note });
  if (leaderboard.viewRow?.me) leaderboard.viewRow.note = note;
  void refreshLeaderboard(true);
}

function isDataTab(tab: LeaderboardTab): tab is DataTab {
  return tab === 'ranked' || tab === 'xp' || tab === 'training' || tab === 'duo' || tab === 'ffa';
}

export function isRunTab(tab: LeaderboardTab): tab is RunTab {
  return tab === 'gauntlet' || tab === 'raid' || tab === 'goopliath';
}

export function leaderboardRows(tab: LeaderboardTab = leaderboard.tab): LbRow[] {
  return isDataTab(tab) ? leaderboard[tab] : [];
}

/** The rows of a run board (empty for any non-run tab). */
export function runRows(tab: LeaderboardTab = leaderboard.tab): RunRow[] {
  return isRunTab(tab) ? leaderboard[tab] : [];
}

/** Rows currently on the active board — either shape, for scroll clamping. */
function activeRowCount(tab: LeaderboardTab): number {
  if (isDataTab(tab)) return leaderboard[tab].length;
  if (isRunTab(tab)) return leaderboard[tab].length;
  return 0;
}

/** Current scroll offset for the active board (0 on the profile face). */
export function boardScroll(): number {
  const t = leaderboard.tab;
  return isDataTab(t) || isRunTab(t) ? leaderboard.scroll[t] : 0;
}

export function clampLeaderboardScroll(tab: DataTab | RunTab): void {
  const max = Math.max(0, activeRowCount(tab) - LEADERBOARD_VISIBLE_ROWS);
  leaderboard.scroll[tab] = Math.max(0, Math.min(max, leaderboard.scroll[tab]));
}

/** Index of MY first (best) row on a board — −1 when I'm not on it. */
function myRowIndex(tab: DataTab | RunTab): number {
  const rows: Array<{ me: boolean }> = leaderboard[tab];
  return rows.findIndex((r) => r.me);
}

export function setLeaderboardTab(tab: LeaderboardTab): void {
  leaderboard.tab = tab;
  if (isDataTab(tab) || isRunTab(tab)) {
    // Open WHERE YOU ARE: a board you've scored on lands scrolled to your row
    // (a few ranks of context above it), not to a top 10 you may not be in.
    // Inside the top 10 (or off the board) it opens at the top as ever, and
    // the jump only happens on the SWITCH — scrolling after that is yours.
    const mine = myRowIndex(tab);
    leaderboard.scroll[tab] = mine >= 0 ? Math.max(0, mine - 4) : 0;
    clampLeaderboardScroll(tab);
  }
}

/** Re-apply the run view to all three run tabs (after a fetch or a filter). */
function applyRunViews(): void {
  for (const tab of RUN_TABS) {
    // The tide has no hardcore: HC ONLY means nothing on GOOPLIATH's board.
    leaderboard[tab] = buildRunView(leaderboard.runRaw[tab], leaderboard.runView.tier, leaderboard.runView.hc && tab !== 'goopliath');
    clampLeaderboardScroll(tab);
  }
}

/** Change how the run boards are looked at — a difficulty, and
 *  whether to show hardcore runs only. Lands where you are, as a tab switch does. */
export function setRunView(view: Partial<{ tier: RunViewTier; hc: boolean }>): void {
  Object.assign(leaderboard.runView, view);
  applyRunViews();
  if (isRunTab(leaderboard.tab)) setLeaderboardTab(leaderboard.tab);
}

/** Open a player's profile face (null = your own). */
export function setProfileView(row: LbRow | null): void {
  leaderboard.viewRow = row;
  leaderboard.tab = 'profile';
}

export function scrollLeaderboard(delta: number): boolean {
  const tab = leaderboard.tab;
  if (!isDataTab(tab) && !isRunTab(tab)) return false;
  const before = leaderboard.scroll[tab];
  leaderboard.scroll[tab] += delta;
  clampLeaderboardScroll(tab);
  return leaderboard.scroll[tab] !== before;
}

export function myName(): string {
  return profile.name;
}

export function myElo(): number {
  return profile.elo;
}

/** My own board numbers, for the panel footer. */
export function myStats(): { name: string; score: number; training: number; xp: number; elo: number } {
  return {
    name: profile.name,
    score: profile.score,
    training: profile.training,
    xp: profile.xp,
    elo: profile.elo,
  };
}

function localId(): string {
  try {
    let id = localStorage.getItem('ff-player-id');
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem('ff-player-id', id);
    }
    return id;
  } catch {
    return crypto.randomUUID(); // storage unavailable — session-only identity
  }
}

/** Has this player typed a callsign yet? (Keyboard pops only while false.) */
export function hasCustomName(): boolean {
  try {
    return !!localStorage.getItem('ff-player-name');
  } catch {
    return true; // storage broken — never nag
  }
}

/**
 * Save the typed callsign — once, shared by BOTH boards (training submits
 * and 1v1s). Sanitised to the keyboard's own alphabet, max 12 chars.
 */
export function setPlayerName(raw: string): void {
  const name = raw.replace(/[^A-Z0-9\- ]/gi, '').trim().toUpperCase().slice(0, 12);
  if (!name) return;
  try {
    localStorage.setItem('ff-player-name', name);
    // When the player typed THIS name — a rename filed for the account on the
    // doc (renameTo/renameAt, below) only wins over a local name that is
    // OLDER than the filing.
    localStorage.setItem('ff-player-name-at', String(Date.now()));
  } catch {
    /* keep it for this session at least */
  }
  profile.name = name;
  writeMine({}); // writeMine always carries the name
  void refreshLeaderboard(true);
}

/**
 * The connection is no longer this module's to open. `net/firebase.ts` holds
 * the one app, the one anonymous sign-in and the one uid, shared with RAVE
 * RAID and the club — which is what lets a security rule say "this row is
 * yours" instead of the old `allow read, write: if true`.
 *
 * The shape (`fs` + `db`) is unchanged, so every call site below still reads
 * the same; what moved is who opens it and under whose name.
 */
async function firestore(): Promise<Cloud | null> {
  const c = await cloud();
  if (!c) leaderboard.status = cloudNote() || 'leaderboard offline';
  return c;
}

// Becomes true once the boot load has settled (doc fetched, created, or the
// attempt failed) — so `profile.xp` is real, not the pre-load 0. The promotion
// celebration waits for this before baselining, or a cloud load looks like an
// instant promotion on every login.
let loaded = false;

/** Has the boot profile load settled? (XP is real, not the pre-load 0.) */
export function profileReady(): boolean {
  return loaded;
}

/** Load (or create) my player doc, then pull both boards. Call once at boot. */
export function initLeaderboard(): void {
  profile.id = localId();
  let stored: string | null = null;
  try {
    stored = localStorage.getItem('ff-player-name');
  } catch {
    /* fall through to the derived callsign */
  }
  profile.name = stored ?? `IRON-${profile.id.replace(/-/g, '').slice(0, 4).toUpperCase()}`;
  void (async () => {
    const h = await firestore();
    if (!h) {
      loaded = true; // no cloud — local-only play, baseline off the current XP
      return;
    }
    // ADOPT THE AUTH UID as the player id. The localStorage uuid above is a
    // placeholder that keeps offline play working and gives the derived
    // callsign something to chew on; once the cloud is open, the anonymous
    // uid is who you are. It has to be: the security rules identify a row by
    // its document name matching request.auth.uid, so a doc keyed by a
    // client-invented uuid is a doc nobody is allowed to write.
    profile.id = h.uid;
    try {
      const ref = h.fs.doc(h.db, 'players', profile.id);
      const snap = await h.fs.getDoc(ref);
      const season = seasonIndex();
      if (snap.exists()) {
        const d = snap.data();
        // Ladder points are PER SEASON: read the live season's bank. A new
        // season SOFT-RESETS — your previous final carries over capped at
        // LADDER.seasonCarryCap, so the summit restarts within reach (season
        // 1 seeds from the pre-season lifetime score the same way). The doc
        // self-migrates so the season board sees the old guard.
        const banked = d[seasonScoreField(season)] as number | undefined;
        const prevFinal =
          season === 1 ? ((d.score as number) ?? 0) : ((d[seasonScoreField(season - 1)] as number) ?? 0);
        profile.score = banked ?? Math.min(LADDER.seasonCarryCap, prevFinal);
        if (banked === undefined && profile.score > 0) {
          writeMine({ [seasonScoreField(season)]: profile.score, score: profile.score });
        }
        // INACTIVITY DECAY, applied lazily: every full decayDays-block since
        // the last ranked bout hands back decayLp (floored at 0). The anchor
        // advances by exactly the blocks charged, so idle time never
        // double-bills and a mid-block return keeps its partial credit.
        {
          const dayMs = 86_400_000;
          let anchor = (d.lastPlayedAt as number) ?? 0;
          if (!anchor) {
            anchor = Date.now();
            writeMine({ lastPlayedAt: anchor });
          }
          const blocks = Math.floor((Date.now() - anchor) / (LADDER.decayDays * dayMs));
          if (blocks > 0) {
            profile.score = Math.max(0, profile.score - blocks * LADDER.decayLp);
            writeMine({
              [seasonScoreField(season)]: profile.score,
              score: profile.score,
              lastPlayedAt: anchor + blocks * LADDER.decayDays * dayMs,
            });
          }
        }
        profile.elo = (d.elo as number) ?? 1000;
        profile.training = (d.training as number) ?? 0;
        profile.duo = (d.duo as number) ?? 0;
        profile.ffa = (d.ffa as number) ?? 0;
        profile.xp = (d.xp as number) ?? 0;
        profile.note = (d.note as string) ?? '';
        profile.awards = (d.awards as Partial<Record<SeasonAward, number>>) ?? {};
        profile.awardedThrough = (d.awardedThrough as number) ?? season - 1;
        profile.gauntletBest = (d.gauntletBest as number) ?? 0;
        profile.gauntletBestHc = (d.gauntletBestHc as number) ?? 0;
        profile.raidBest = (d.raidBest as number) ?? 0;
        profile.raidBestHc = (d.raidBestHc as number) ?? 0;
        profile.goopBest = (d.goopBest as number) ?? 0;
        // Seed the look-mirror key so an unchanged look never re-writes; the
        // syncLookMirror() below then catches up a look painted offline.
        mirroredLook = `${(d.tone as string) ?? ''}|${(d.look as string) ?? ''}`;
        // A rename FILED FOR this account rides `renameTo`/`renameAt` — doc
        // fields the client's ordinary writes never touch, so a correction
        // survives however many times an old build's name re-sync (below)
        // stamps the stale callsign back over `name`. Adopt it unless the
        // player has typed a NEWER name themselves. (This is what lets a
        // rename be repaired server-side at all: `name` alone can't carry a
        // correction, because every client write re-asserts the local name.)
        {
          const renameTo = d.renameTo as string | undefined;
          const renameAt = (d.renameAt as number) ?? 0;
          let localAt = 0;
          try {
            localAt = parseInt(localStorage.getItem('ff-player-name-at') ?? '0', 10) || 0;
          } catch {
            /* no stamp readable — treat the local name as old */
          }
          if (renameTo && renameTo !== profile.name && localAt < renameAt) {
            profile.name = renameTo;
            try {
              localStorage.setItem('ff-player-name', renameTo);
              localStorage.setItem('ff-player-name-at', String(Date.now()));
            } catch {
              /* session-only adoption — re-adopts next boot */
            }
          }
        }
        // A locally renamed player syncs the doc's stale callsign.
        if ((d.name as string) !== profile.name) writeMine({});
        // Seasons that closed since our last visit: claim any honours.
        void claimSeasonAwards(season);
      } else {
        profile.awardedThrough = season - 1;
        await h.fs.setDoc(ref, {
          name: profile.name,
          score: 0,
          elo: 1000,
          training: 0,
          duo: 0,
          ffa: 0,
          xp: 0,
          note: '',
          awards: {},
          awardedThrough: season - 1,
          gauntletBest: 0,
          gauntletBestHc: 0,
          raidBest: 0,
          raidBestHc: 0,
          goopBest: 0,
          look: myPackedLook(),
          tone: customization.avatar,
          gear: myPackedGear(),
          pad: customization.platform,
          lastPlayedAt: Date.now(),
          updatedAt: h.fs.serverTimestamp(),
        });
        mirroredLook = `${customization.avatar}|${myPackedLook()}|${myPackedGear()}|${customization.platform}`;
      }
    } catch {
      leaderboard.status = 'leaderboard unreachable';
    }
    loaded = true; // XP is now real (or the load failed) — safe to baseline
    syncLookMirror(); // a look painted since the doc's last visit catches up
    void refreshLeaderboard(true);
  })();
}

/** The mirrored `${tone}|${look}` last written to (or read off) my doc —
 *  null until boot settles, so pre-load sync calls wait for the seed. */
let mirroredLook: string | null = null;

/**
 * THE RECORD (docs/paint.md P4): mirror my packed look + base tone onto my
 * player doc whenever they change, so the profile card, stats.html and the
 * gazette can show the painting behind the name. Cheap to call on every
 * repaint — it early-outs on the `${tone}|${look}` key and never writes
 * before the boot read has seeded it (the boot call above catches up).
 */
export function syncLookMirror(): void {
  if (!FIREBASE_ENABLED || mirroredLook === null || !profile.id) return;
  const key = `${customization.avatar}|${myPackedLook()}|${myPackedGear()}|${customization.platform}`;
  if (key === mirroredLook) return;
  mirroredLook = key;
  writeMine({ look: myPackedLook(), tone: customization.avatar, gear: myPackedGear(), pad: customization.platform });
}

let lastFetch = -Infinity;

/** Pull the top rows of both boards (throttled — `force` bypasses). */
export async function refreshLeaderboard(force = false): Promise<void> {
  if (!force && performance.now() - lastFetch < 20_000) return;
  lastFetch = performance.now();
  const h = await firestore();
  if (!h) return;
  const { fs, db } = h;
  try {
    const players = fs.collection(db, 'players');
    const pull = async (field: string): Promise<LbRow[]> => {
      const snap = await fs.getDocs(fs.query(players, fs.orderBy(field, 'desc'), fs.limit(LEADERBOARD_FETCH_LIMIT)));
      return snap.docs
        .map((d) => ({
          uid: d.id,
          name: (d.data().name as string) ?? '???',
          value: (d.data()[field] as number) ?? 0,
          me: d.id === profile.id,
          xp: (d.data().xp as number) ?? 0,
          score: (d.data().score as number) ?? 0,
          awards: (d.data().awards as Partial<Record<SeasonAward, number>>) ?? {},
          gauntletBest: (d.data().gauntletBest as number) ?? 0,
          gauntletBestHc: (d.data().gauntletBestHc as number) ?? 0,
          raidBest: (d.data().raidBest as number) ?? 0,
          raidBestHc: (d.data().raidBestHc as number) ?? 0,
          goopBest: (d.data().goopBest as number) ?? 0,
          note: (d.data().note as string) ?? '',
          look: (d.data().look as string) ?? '',
          tone: (d.data().tone as string) ?? 'blank',
          gear: (d.data().gear as string) ?? '',
          pad: (d.data().pad as string) ?? '',
        }))
        // Every board shows anyone who's banked anything. (RANKED is ladder
        // points now — per-season, and raw ELO stays hidden for matchmaking.)
        .filter((r) => r.value > 0);
    };
    // RUN boards: every FEAT board of the family, pulled together. Each
    // family is pulled in its OWN try so a rules gap or a cold board degrades
    // THOSE alone — the score boards, which hit the `players` collection,
    // keep working regardless.
    const pullRuns = async (tab: RunTab): Promise<RunRow[]> => {
      try {
        // Run boards are `boards/<id>/rows/{uid}` — ONE ROW PER PLAYER PER
        // BOARD, holding their fastest clear, and the RULES refuse a write
        // that isn't actually faster. So each board arrives deduplicated and
        // honest; what's left to do is lay the feat boards side by side.
        // buildRunView folds the repeats (one run lands on several boards,
        // and every raider posts their own copy) back into one row per feat.
        //
        // Not forced: a family is up to seven boards, and a 1v1 result has no
        // business re-reading all of them. Each board keeps its own minute of
        // cache, and a board you just posted to is marked stale by postScore,
        // so your own run still shows the moment it lands.
        const ids = runBoards(tab);
        await Promise.all(ids.map((id) => fetchBoard(id)));
        return ids.flatMap((id) =>
          boardRows(id).map((r: BoardRow) => ({
            uid: r.uid,
            names: Array.isArray(r.meta.names) ? (r.meta.names as unknown[]).map(String) : [r.name],
            seconds: r.value,
            difficulty: ((r.meta.difficulty as Difficulty) ?? 'normal') as Difficulty,
            // A hardcore board's rows are hardcore by where they live, even
            // if an old row forgot to say so in its meta.
            hardcore: !!r.meta.hardcore || id.endsWith('-hc-time'),
            me: r.isMe,
          })),
        );
      } catch {
        return leaderboard.runRaw[tab]; // keep whatever we last had
      }
    };
    const [rk, xp, tr, du, ff, gt, rd, gp] = await Promise.all([
      pull(seasonScoreField(seasonIndex())), // RANKED: the season in progress
      pull('xp'),
      pull('training'),
      pull('duo'),
      pull('ffa'),
      pullRuns('gauntlet'),
      pullRuns('raid'),
      pullRuns('goopliath'),
    ]);
    leaderboard.ranked = rk;
    leaderboard.xp = xp;
    leaderboard.training = tr;
    leaderboard.duo = du;
    leaderboard.ffa = ff;
    leaderboard.runRaw = { gauntlet: gt, raid: rd, goopliath: gp };
    applyRunViews();
    (['ranked', 'xp', 'training', 'duo', 'ffa'] as const).forEach(clampLeaderboardScroll);
    leaderboard.status = '';
  } catch {
    leaderboard.status = 'leaderboard unreachable';
  }
}

/**
 * Post a finished RUN to its board, ranked by the lowest cumulative fight-time
 * clock. `names` is the whole squad (one name for a solo gauntlet, up to five
 * for a raid) and rides along as row detail — a run-time board is about who
 * you did it with as much as how fast.
 *
 * EVERY MEMBER POSTS, not just the host. Under the old append-only shape one
 * document was the squad's shared row, so the host filed it for the group and
 * anyone who ran with a host on a bad connection got nothing. A board of
 * personal bests has no such thing as a shared row: the run goes on YOUR row,
 * under your own uid, which is also the only row the rules will let you write.
 *
 * The write is unconditional — the RULES hold the ratchet, refusing anything
 * that doesn't beat your current best, so a slower run is quietly declined
 * rather than checked for first. No-op offline.
 */
export function reportRun(tab: RunTab, seconds: number, names: string[], difficulty: Difficulty, hardcore: boolean): void {
  if (difficulty === 'easy') return; // easy runs play, but never rank
  const clean = names.map((n) => String(n).slice(0, 12)).filter(Boolean).slice(0, 5);
  if (!clean.length) return;
  void (async () => {
    // Every FEAT board this run belongs on: its tier's board, its tier's
    // HARDCORE board when it was one, and the legacy mixed board for raids
    // (boards.ts runPostBoards). Each ratchets on its own, so a slow
    // hardcore clear keeps its place even when a faster plain run exists.
    const value = Math.max(0, Math.round(seconds * 10) / 10);
    const meta = { names: clean, difficulty, hardcore };
    const landed = await Promise.all(runPostBoards(tab, difficulty, hardcore).map((b) => postScore(b, value, profile.name, meta)));
    // Only re-read the boards when something actually changed on them. A
    // run that didn't beat any best leaves every board exactly as it was.
    if (landed.some(Boolean)) await refreshLeaderboard(true);
  })();
}

/** My anonymous id. The CLOUD's uid once it has opened — that is the one
 *  the rules check and the one every board row is named after — falling
 *  back to the local id offline, so a tape written before sign-in still
 *  carries something stable. */
export function myUid(): string {
  return cloudUid() || localId();
}

/**
 * THE TAPE (net/telemetry.ts): one `bouts` doc per recorded bout — the
 * heatmap grids, the timed events, the rounds. Fire-and-forget like a run
 * post; the LAB on stats.html reads them back.
 *
 * Every tape is LEASED (config.ts TV.keepDays). This is the only collection
 * in the project that grows without bound — a board keeps one row per player
 * however often they play, but a tape is a fresh document every bout — and a
 * Firestore TTL policy, which is what an expiry field is normally for, needs
 * the Blaze plan. On Spark the clients do the housekeeping instead, exactly
 * as presence and rooms already do: the reader filters on `expiresAt` so a
 * lapsed tape is invisible immediately, and the next headset to post one
 * bins a handful of the expired on its way past.
 */
export function reportBout(doc: Record<string, unknown>): void {
  void (async () => {
    const h = await firestore();
    if (!h) return;
    try {
      // `uid`, `at` and `expiresAt` are the rules' business, not the
      // caller's: the tape must be stamped with the uid that is actually
      // signed in, `at` must be a NUMBER (firestore.rules stamped()), and
      // `expiresAt` must be a TIMESTAMP or the reader's filter cannot
      // compare it (the same trap rooms fell into — see firestore.rules).
      const now = Date.now();
      await h.fs.addDoc(h.fs.collection(h.db, 'bouts'), {
        ...doc,
        uid: h.uid,
        at: now,
        expiresAt: new Date(now + TV.keepDays * 86_400_000),
      });
    } catch {
      /* unreachable — this tape stays in the headset */
    }
    void sweepBouts();
  })();
}

/** Once per session: bin a bounded handful of tapes that have already
 *  lapsed. What a TTL policy would have done, done by whoever turns up. */
let sweptBouts = false;
async function sweepBouts(): Promise<void> {
  if (sweptBouts) return;
  sweptBouts = true;
  const h = await firestore();
  if (!h) return;
  try {
    const { collection, deleteDoc, getDocs, limit, orderBy, query, where } = h.fs;
    const snap = await getDocs(
      query(collection(h.db, 'bouts'), where('expiresAt', '<', new Date()), orderBy('expiresAt'), limit(TV.sweep)),
    );
    await Promise.all(snap.docs.map((d) => deleteDoc(d.ref).catch(() => {})));
  } catch {
    /* denied, offline, or nothing to do — the boards are unaffected */
  }
}

/** Clear-badge tier per difficulty (easy earns nothing — same as ranking). */
const CLEAR_TIER: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2, blazing: 3 };

/**
 * A full RUN was WON (gauntlet, titan raid, or Goopliath raid): raise that
 * family's profile badge to this difficulty's tier if it's the best yet.
 * Only the highest tier ever shows on the profile — blazing wears the flame.
 * A HARDCORE clear also raises its own high-water mark; when it matches the
 * badge's tier the glyph burns red. (Goopliath has no hardcore.)
 */
export function reportRunClear(kind: 'gauntlet' | 'raid' | 'goopliath', difficulty: Difficulty, hardcore = false): void {
  const tier = CLEAR_TIER[difficulty];
  const field = kind === 'gauntlet' ? 'gauntletBest' : kind === 'raid' ? 'raidBest' : 'goopBest';
  const patch: Record<string, number> = {};
  if (tier > profile[field]) {
    profile[field] = tier;
    patch[field] = tier;
  }
  if (hardcore && kind !== 'goopliath') {
    const hcField = kind === 'gauntlet' ? 'gauntletBestHc' : 'raidBestHc';
    if (tier > profile[hcField]) {
      profile[hcField] = tier;
      patch[hcField] = tier;
    }
  }
  if (Object.keys(patch).length) writeMine(patch);
}

/**
 * Season honours: every closed season we haven't evaluated yet gets one read
 * of its FROZEN final standings (the per-season score field never moves
 * again once the season ends); a top-25 finish self-awards the trophy.
 * Repeat honours stack — the profile chip shows ×N.
 */
async function claimSeasonAwards(current: number): Promise<void> {
  if (profile.awardedThrough >= current - 1) return;
  const h = await firestore();
  if (!h) return;
  const { fs, db } = h;
  try {
    const players = fs.collection(db, 'players');
    for (let s = Math.max(1, profile.awardedThrough + 1); s < current; s++) {
      const snap = await fs.getDocs(fs.query(players, fs.orderBy(seasonScoreField(s), 'desc'), fs.limit(25)));
      const rank = snap.docs.findIndex((d) => d.id === profile.id) + 1; // 0 = unplaced
      if (rank >= 1) {
        const key: SeasonAward = rank === 1 ? 'first' : rank === 2 ? 'second' : rank === 3 ? 'third' : rank <= 10 ? 'top10' : 'top25';
        profile.awards[key] = (profile.awards[key] ?? 0) + 1;
      }
    }
    profile.awardedThrough = current - 1;
    writeMine({ awards: profile.awards, awardedThrough: profile.awardedThrough });
  } catch {
    /* standings unreachable — we'll try again next launch */
  }
}

function writeMine(fields: Record<string, unknown>): void {
  void (async () => {
    const h = await firestore();
    if (!h) return;
    try {
      await h.fs.setDoc(
        h.fs.doc(h.db, 'players', profile.id),
        // `at` is a plain client clock and the rules insist on it — a
        // serverTimestamp() arrives as a sentinel, not a number, so it cannot
        // satisfy a type check written at the door. `updatedAt` stays as the
        // trustworthy one for anything that actually needs ordering.
        { name: profile.name, at: Date.now(), updatedAt: h.fs.serverTimestamp(), ...fields },
        { merge: true },
      );
    } catch {
      /* unreachable right now — the next result will try again */
    }
  })();
}

/**
 * A finished REAL 1v1: the public LADDER moves — a win pays LADDER.win plus
 * an upset bonus read off the (hidden) rating gap, a loss hands a little
 * back and never drags below zero. The raw ELO itself still moves both ways
 * underneath as the matchmaking signal, but it is never shown anywhere.
 */
export function reportResult(win: boolean, oppElo: number): void {
  // Upset bonus from the PRE-match gap: toppling a giant pays extra, farming
  // rookies pays less — the ladder carries a whiff of skill without the sting.
  const upset = Math.max(LADDER.upsetMin, Math.min(LADDER.upsetMax, Math.round((oppElo - profile.elo) / LADDER.upsetDiv)));
  profile.score = Math.max(0, profile.score + (win ? LADDER.win + upset : -LADDER.loss));
  const expected = 1 / (1 + Math.pow(10, (oppElo - profile.elo) / 400));
  profile.elo = Math.max(100, Math.round(profile.elo + ELO_K * ((win ? 1 : 0) - expected)));
  profile.xp += xpForMatch(win); // every real bout feeds the rank ladder
  addCoins(CURRENCY.perGame); // …and the coin wallet, alongside the XP
  // LP banks into the SEASON field (what the board ranks); `score` mirrors it
  // for older clients and the season seed. A ranked bout also re-anchors the
  // inactivity-decay clock.
  writeMine({
    [seasonScoreField(seasonIndex())]: profile.score,
    score: profile.score,
    elo: profile.elo,
    xp: profile.xp,
    lastPlayedAt: Date.now(),
  });
  void refreshLeaderboard(true);
}

/**
 * A finished quick match vs the BOT: banks XP either way (win 15 / loss 5) so
 * the mode always rewards, plus token ladder points on a win. No ELO movement
 * — the bot has no rating.
 */
export function reportBotResult(win: boolean): void {
  if (win) profile.score += LADDER.botWin;
  profile.xp += xpForBot();
  addCoins(CURRENCY.perGame);
  writeMine({
    [seasonScoreField(seasonIndex())]: profile.score,
    score: profile.score,
    xp: profile.xp,
    lastPlayedAt: Date.now(),
  });
  void refreshLeaderboard(true);
}

/**
 * A finished arcade brawl (2v2 / FFA): bank a flat participation XP either
 * way, and move that mode's LADDER — a win pays (FFA a touch more, it's a
 * one-in-four), a loss hands a little back, floored at zero. Bot brawls pay
 * only the token bot rate on a win — practice charts, it doesn't climb.
 */
export function reportArcade(mode: ArcadeMode, win: boolean, vsBots = false): void {
  profile.xp += xpForArcade();
  addCoins(CURRENCY.perGame);
  const gain = vsBots
    ? win
      ? LADDER.botWin
      : 0
    : win
      ? mode === 'ffa'
        ? LADDER.ffaWin
        : LADDER.brawlWin
      : -LADDER.brawlLoss;
  const fields: Record<string, unknown> = { xp: profile.xp };
  if (mode === '2v2') {
    profile.duo = Math.max(0, profile.duo + gain);
    fields.duo = profile.duo;
  } else if (mode === 'ffa') {
    profile.ffa = Math.max(0, profile.ffa + gain);
    fields.ffa = profile.ffa;
  }
  writeMine(fields);
  void refreshLeaderboard(true);
}

/**
 * A finished ARCADE campaign titan bout. Pays the SAME flat rate as a quick
 * match vs the bot (XP + coins, win or lose) — except the FIRST time each
 * titan is felled, when both pay double. Campaign bouts are offline solo
 * fights, so nothing ticks the online score boards.
 */
export function reportCampaign(win: boolean, firstClear: boolean): void {
  const mult = win && firstClear ? 2 : 1;
  profile.xp += xpForCampaign() * mult;
  addCoins(CURRENCY.perGame * mult);
  writeMine({ xp: profile.xp });
  void refreshLeaderboard(true);
}

/** An Aim Training run ended — bank XP (every run) and a new personal best. */
export function reportTraining(score: number): void {
  const newBest = score > profile.training;
  profile.xp += xpForTraining();
  addCoins(CURRENCY.perGame);
  if (newBest) profile.training = score;
  writeMine({ training: profile.training, xp: profile.xp });
  void refreshLeaderboard(true);
}

/**
 * The tutorial GRADUATION — the one-time welcome payout (the caller guards
 * the one-time part via app.tutorialDone). Win or lose: running the whole
 * thing is the achievement, exactly like the unlock.
 */
export function reportTutorial(): void {
  profile.xp += xpForTutorial();
  addCoins(CURRENCY.tutorial);
  writeMine({ xp: profile.xp });
  void refreshLeaderboard(true);
}

/**
 * File a SAFETY REPORT — the settings-menu "report a problem" flow. The text
 * lands in the 'reports' Firestore collection with the reporter's callsign
 * and stable id attached (so repeat reports correlate and abuse of the box
 * itself is traceable). No addresses live in the client: delivery to a human
 * is the backend's business (read the collection in the console, or bolt the
 * Trigger Email extension onto it). Fire-and-forget — the game never blocks
 * on it, and with no cloud configured it just quietly does nothing.
 */
export async function sendReport(text: string): Promise<void> {
  const trimmed = text.trim().slice(0, 200);
  if (!trimmed) return;
  const h = await firestore();
  if (!h) return;
  try {
    await h.fs.addDoc(h.fs.collection(h.db, 'reports'), {
      text: trimmed,
      from: profile.name,
      // The rules check this against request.auth.uid, so it must be the
      // signed-in uid — profile.id still holds the local placeholder until
      // the cloud has finished opening.
      uid: h.uid,
      at: h.fs.serverTimestamp(),
    });
  } catch {
    /* offline or rules closed — the report is best-effort */
  }
}

/**
 * REPORT PAINT (docs/paint.md §6): file a report about a player's painting,
 * carrying their packed look verbatim — the evidence is included by
 * construction (~520 bytes at the cap), so a moderator can render exactly
 * what the reporter saw. Same create-only 'reports' collection, same
 * fire-and-forget rules as sendReport.
 */
export async function sendPaintReport(about: string, look: string): Promise<void> {
  const name = about.trim().slice(0, 24);
  if (!name) return;
  const h = await firestore();
  if (!h) return;
  try {
    await h.fs.addDoc(h.fs.collection(h.db, 'reports'), {
      subject: 'paint',
      about: name,
      look: look.slice(0, 1024),
      from: profile.name,
      uid: h.uid,
      at: h.fs.serverTimestamp(),
    });
  } catch {
    /* offline or rules closed — best-effort */
  }
}
