/**
 * THE GASKET GAZETTE — the game's daily paper, pinned to the NEWS tab.
 *
 * A scheduled Claude task reads the boards every day and files an edition
 * into Firestore at `gazette/latest`: what happened (who climbed, which
 * records fell, the hardest clears), the numbers behind it, and — the part
 * that makes it worth opening — WHAT YOU CAN GO AND DO about it today. Plain
 * reporting in newspaper form; no character, no in-joke vocabulary
 * (docs/gasket-gazette.md has the style guide and the pipeline).
 *
 * This module is the lobby's reader: it pulls the latest edition, and tracks
 * whether THIS player has read it yet so the NEWS tab can wear a red
 * notification dot until they do. Rides the same Firestore project as
 * matchmaking + the leaderboard; loads firebase lazily like leaderboard.ts so
 * offline lobby players never pay for the bundle.
 */

import { FIREBASE_ENABLED, cloud, type Cloud } from './firebase.js';

/** A figure in the BY THE NUMBERS strip: "412" over "BOUTS FOUGHT". */
export interface GazetteStat {
  label: string;
  value: string;
}

/** A line in the RECORD BOOK: the feat, its clock, and who did it. */
export interface GazetteRecord {
  /** "TITAN RAID · BLAZING · HARDCORE" */
  feat: string;
  /** "14:02.3" */
  time: string;
  /** "VOLTAIRE · GRINDR · PUMPKIN" */
  who: string;
}

/** An item in WHAT TO DO TODAY: a short title and one or two sentences. */
export interface GazetteTodo {
  title: string;
  text: string;
}

export interface GazetteArticle {
  /** Monotonic edition number — drives the unread dot. */
  edition: number;
  /** "TUESDAY, JUNE 23" etc. */
  dateline: string;
  headline: string;
  subhead: string;
  /** The body copy; paragraphs split on blank lines. */
  body: string;
  byline: string;
  /** BY THE NUMBERS — up to four figures, under the headline. */
  stats: GazetteStat[];
  /** THE RECORD BOOK — the most impressive clears on the boards. */
  records: GazetteRecord[];
  /** WHAT TO DO TODAY — the things a reader can go and do next. */
  todo: GazetteTodo[];
}

/** Section sizes the page lays out (and the publisher enforces). */
export const GAZETTE_LIMITS = {
  stats: 4,
  records: 6,
  todo: 5,
  statLabel: 24,
  statValue: 12,
  recordFeat: 40,
  recordTime: 12,
  recordWho: 60,
  todoTitle: 36,
  todoText: 180,
};

/**
 * THE WELCOME EDITION — the paper a newcomer finds on the wall, written
 * into the build rather than filed by the presses, so it is there before
 * the first daily lands and stays there whenever the presses are quiet
 * (no edition filed yet, or a headset with no cloud). A guide to what the
 * game has in it, what each thing pays, and where the scores go. Edition 0,
 * so the first filed daily is still No. 1.
 */
export const WELCOME_EDITION: GazetteArticle = {
  edition: 0,
  dateline: 'THE NEW PLAYER EDITION',
  headline: 'YOUR GUIDE TO EVERYTHING YOU CAN DO',
  subhead: 'Every mode, what it earns you, and where your name goes when you win.',
  body: [
    'Every fight works the same way. Hold the trigger to spin up a fireball, swing and release to throw it, and pull the trigger again to call it home. A ball spinning in your hand is a shield: punch an incoming shot to block it. Step left and right to dodge, and pick an attachment (split, grow, shrink or curve) to change how your throws fly. The TUTORIAL under PRACTICE walks you through all of it and pays a one-off 50 coins when you finish.',
    'PLAY › VERSUS is where the real fights are. QUICK MATCH is a 1v1: you warm up against a bot while it looks for a real opponent. RANKED puts ladder points on the line: a win is worth 20 points plus a bonus for beating someone stronger, and a loss costs 8. Seasons run 90 days, and the top 25 at the close keep a trophy on their profile for good. 2V2 and FREE FOR ALL have ladders of their own, and CUSTOM GAMES sets up a private match with a code.',
    'PLAY › TITANS has the CAMPAIGN: five titans back to back, CHROMEHOOK, PISTONKAISER, VULTURE, JUGGERNAUT and GOLIATH. Beat them in one go and you unlock HARDCORE, the same run with no healing between bosses. CO-OP RAID sends a squad of two to five after the titans together, and GOOPLIATH is a raid boss of its own. Every full run is timed on NORMAL, HARD or BLAZING, and each difficulty, hardcore or not, keeps its own leaderboard under RANKINGS. EASY runs are for practice and never rank.',
    'PLAY › RAVE RAID is the rhythm mode, with a tour, solo tracks and multiplayer. SOCIAL › ENTER CLUB takes you to the club to hang out and meet other players, and games started from the club pay extra coins when you come back to the floor.',
    'Every game you finish pays 10 coins, win or lose. Spend them in the STORE on gear, heads and platforms, and paint your fighter however you like from the LOCKER. Some platforms can only be earned: CHAMPION for beating GOLIATH, TIDEBREAKER for beating GOOPLIATH in a raid, and BLAZING for a win on BLAZING.',
    'This paper comes out daily with who climbed, which records fell and what is worth playing next. A red dot on the NEWS tab means a new edition is in.',
  ].join('\n\n'),
  byline: 'The Gazette Desk',
  stats: [
    { label: 'TITANS TO BEAT', value: '5' },
    { label: 'RAID SQUAD SIZE', value: '2–5' },
    { label: 'COINS PER GAME', value: '10' },
    { label: 'DAYS PER SEASON', value: '90' },
  ],
  records: [],
  todo: [
    { title: 'Play the tutorial', text: 'PRACTICE › TUTORIAL. The basics, step by step, and 50 coins the first time through.' },
    { title: 'Warm up on aim training', text: 'PRACTICE › AIM TRAINING. Turn on SHOOT BACK when you want the targets to fire at you.' },
    { title: 'Head into the campaign', text: 'PLAY › TITANS › CAMPAIGN. Beat all five titans in one run to unlock HARDCORE and post your first time.' },
    { title: 'Try a quick match', text: 'PLAY › VERSUS › QUICK MATCH. Warm up against a bot while it finds you a real opponent.' },
    { title: 'Make your fighter yours', text: 'LOCKER › CUSTOMIZE to paint your body and try on gear before you buy it.' },
  ],
};

const SEEN_KEY = 'gg-seen-edition';
const WELCOME_KEY = 'gg-welcome-read';

function welcomeRead(): boolean {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    return false;
  }
}

/** Live gazette state the lobby reads each redraw. */
export const gazette = {
  article: null as GazetteArticle | null,
  status: FIREBASE_ENABLED ? 'loading…' : 'gazette offline',
  /** True while the latest edition is newer than the one this reader has seen. */
  unread: false,
  /**
   * A first visit reads the WELCOME EDITION whatever the presses have filed:
   * decided once, at boot, so the page does not swap out from under a
   * newcomer the moment the daily lands. From the next boot on, the daily
   * is the front page and the welcome only stands in when there is none.
   */
  welcomeFirst: !welcomeRead(),
};

/** The page on the wall right now: the daily, or the WELCOME EDITION —
 *  on a first visit, or whenever the presses have nothing filed. */
export function frontPage(): GazetteArticle | null {
  if (gazette.welcomeFirst) return WELCOME_EDITION;
  return gazette.article ?? (gazette.status === 'loading…' ? null : WELCOME_EDITION);
}

function seenEdition(): number {
  try {
    return parseInt(localStorage.getItem(SEEN_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * The shared connection (net/firebase.ts). The paper is world-readable, so this
 * would work without a sign-in — but sharing the one app and the one uid keeps
 * a single connection for the whole session rather than a second one just to
 * read the front page.
 */
async function firestore(): Promise<Cloud | null> {
  const c = await cloud();
  if (!c) gazette.status = 'gazette offline';
  return c;
}

/** A string field off the doc, capped — the page lays these out at fixed sizes. */
function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

/** A list field off the doc: each entry an object, each field a capped
 *  string, entries missing their `required` field dropped. Anything that
 *  isn't a list reads as empty — older editions carry none of these. */
function list<T>(v: unknown, max: number, fields: Record<keyof T & string, number>, required: keyof T & string): T[] {
  if (!Array.isArray(v)) return [];
  const out: T[] = [];
  for (const item of v) {
    if (!item || typeof item !== 'object') continue;
    const src = item as Record<string, unknown>;
    const row = {} as Record<string, string>;
    for (const [k, cap] of Object.entries(fields) as Array<[string, number]>) row[k] = str(src[k], cap);
    if (row[required]) out.push(row as T);
    if (out.length >= max) break;
  }
  return out;
}

let lastFetch = -Infinity;

/** Pull the latest edition (throttled — `force` bypasses the cooldown). */
export async function refreshGazette(force = false): Promise<void> {
  if (!force && performance.now() - lastFetch < 60_000) return;
  lastFetch = performance.now();
  const h = await firestore();
  if (!h) return;
  try {
    const snap = await h.fs.getDoc(h.fs.doc(h.db, 'gazette', 'latest'));
    if (!snap.exists()) {
      gazette.status = 'the presses are quiet';
      return;
    }
    const d = snap.data();
    const L = GAZETTE_LIMITS;
    gazette.article = {
      edition: (d.edition as number) ?? 0,
      dateline: (d.dateline as string) ?? '',
      headline: (d.headline as string) ?? '',
      subhead: (d.subhead as string) ?? '',
      body: (d.body as string) ?? '',
      byline: str(d.byline, 40) || 'The Gazette Desk',
      stats: list<GazetteStat>(d.stats, L.stats, { label: L.statLabel, value: L.statValue }, 'value'),
      records: list<GazetteRecord>(d.records, L.records, { feat: L.recordFeat, time: L.recordTime, who: L.recordWho }, 'feat'),
      todo: list<GazetteTodo>(d.todo, L.todo, { title: L.todoTitle, text: L.todoText }, 'title'),
    };
    gazette.unread = gazette.article.edition > seenEdition();
    gazette.status = '';
  } catch {
    gazette.status = 'gazette unreachable';
  }
}

/** Pull the latest edition once at boot. */
export function initGazette(): void {
  void refreshGazette(true);
}

/** Mark the current edition read — clears the lobby button's red dot. */
export function markGazetteRead(): void {
  // The welcome counts as read the first time the paper is looked at; it
  // keeps the wall for the rest of THIS visit (welcomeFirst is a boot-time
  // decision) and the daily takes over from the next.
  try {
    localStorage.setItem(WELCOME_KEY, '1');
  } catch {
    /* storage unavailable — the newcomer gets welcomed again next boot */
  }
  if (!gazette.article) return;
  try {
    localStorage.setItem(SEEN_KEY, String(gazette.article.edition));
  } catch {
    /* storage unavailable — the dot just stays until next boot */
  }
  gazette.unread = false;
}
