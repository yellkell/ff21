/**
 * ladder-brief.mjs — the Gasket Gazette's "wire report".
 *
 * Reads the live ladder (Firestore `players`), every run board, and the
 * snapshot left by the LAST published edition (`gazette/_snapshot`), works
 * out what changed since — who played, who climbed, which records fell, which
 * feats nobody has done yet — and prints a compact JSON brief to stdout.
 *
 * It writes NOTHING. The scheduled Claude task writes the day's edition from
 * this brief (docs/gasket-gazette.md); `publish-gazette.mjs` then files it
 * AND rolls the snapshot forward. Run: `node scripts/ladder-brief.mjs`.
 *
 * The ladder only stores running totals (no per-match log), so "games played"
 * is inferred from the XP delta — every bout, win or lose, banks ~25 XP
 * (see src/config.ts PROGRESSION), so gamesApprox = round(ΔXP / 25).
 */

import { initializeApp } from 'firebase/app';
import { collection, doc, getDoc, getDocs, getFirestore, limit, orderBy, query } from 'firebase/firestore';

// Public web config (an identifier, not a secret — same as src/net/firebaseConfig.ts).
const firebaseConfig = {
  apiKey: 'AIzaSyD7jbazGQc4wiPBUzQSMwO6W7nMcMtaJzQ',
  authDomain: 'flappy-ff9f6.firebaseapp.com',
  projectId: 'flappy-ff9f6',
  storageBucket: 'flappy-ff9f6.firebasestorage.app',
  messagingSenderId: '777089145974',
  appId: '1:777089145974:web:560584da7691e495ab1357',
};

const XP_PER_GAME = 25; // PROGRESSION.matchPlay — a bout banks ~25 XP win or lose
const ACTIVE_WINDOW_MS = 26 * 60 * 60 * 1000; // "played recently" — a touch over a day

// src/config.ts SEASON — keep in step (this script is plain node and can't
// import the TS config).
const SEASON_EPOCH = Date.UTC(2026, 6, 6);
const SEASON_DAYS = 90;
const seasonIndex = (now) => Math.max(1, 1 + Math.floor((now - SEASON_EPOCH) / (SEASON_DAYS * 86_400_000)));

/* ── the run boards (mirrors src/net/boards.ts runBoard / runBoardsFor) ── */

const TIERS = ['normal', 'hard', 'blazing'];
const FAMILIES = [
  { id: 'speedrun', label: 'SPEEDRUN', hc: true, legacy: null },
  { id: 'raid', label: 'TITAN RAID', hc: true, legacy: 'ff2-raid-time' },
  { id: 'goopliath', label: 'GOOPLIATH RAID', hc: false, legacy: 'ff2-goopliath-time' },
];

/** A clear's weight: difficulty first, hardcore breaking the tie. */
const featRank = (tier, hardcore) => (TIERS.indexOf(tier) + 1) * 2 + (hardcore ? 1 : 0);

/** "TITAN RAID · BLAZING · HARDCORE" */
const featName = (family, tier, hardcore) =>
  `${family.label} · ${tier.toUpperCase()}${hardcore ? ' · HARDCORE' : ''}`;

/** The run clock as the game prints it (src/campaign/campaignState.ts fmtRunTime). */
function fmtRunTime(seconds) {
  const s = Math.max(0, seconds);
  const m = Math.floor(s / 60);
  const ss = String(Math.floor(s % 60)).padStart(2, '0');
  const tenths = Math.floor((s * 10) % 10);
  return `${m}:${ss}.${tenths}`;
}

const db = getFirestore(initializeApp(firebaseConfig));

/** Read the top players by cumulative XP, with the fields the paper cares about. */
async function readPlayers() {
  const snap = await getDocs(query(collection(db, 'players'), orderBy('xp', 'desc'), limit(50)));
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      uid: d.id,
      name: x.name ?? '???',
      xp: x.xp ?? 0,
      score: x.score ?? 0,
      duo: x.duo ?? 0,
      ffa: x.ffa ?? 0,
      updatedAt: x.updatedAt?.toMillis?.() ?? 0,
    };
  });
}

/** The top of the CURRENT season's ranked ladder. */
async function readSeasonLadder(season) {
  try {
    const field = `score_s${season}`;
    const snap = await getDocs(query(collection(db, 'players'), orderBy(field, 'desc'), limit(10)));
    return snap.docs
      .map((d) => ({ name: d.data().name ?? '???', points: d.data()[field] ?? 0 }))
      .filter((r) => r.points > 0);
  } catch {
    return [];
  }
}

/** The standings captured when the last edition was filed (or null on day one). */
async function readSnapshot() {
  const snap = await getDoc(doc(db, 'gazette', '_snapshot'));
  if (!snap.exists()) return null;
  const data = snap.data();
  const byUid = {};
  for (const p of data.players ?? []) byUid[p.uid] = p;
  // Previous XP-rank, for climb detection.
  const prevRank = {};
  [...(data.players ?? [])].sort((a, b) => b.xp - a.xp).forEach((p, i) => (prevRank[p.uid] = i + 1));
  return { byUid, prevRank, capturedAt: data.capturedAt ?? null, edition: data.edition ?? 0 };
}

/** One board's rows, fastest first. A cold board or a closed rule → []. */
async function readBoard(id) {
  try {
    const snap = await getDocs(query(collection(db, 'boards', id, 'rows'), orderBy('value', 'asc'), limit(100)));
    return snap.docs.map((d) => {
      const x = d.data();
      const meta = x.meta ?? {};
      // `at` is a plain client clock (the rules type-check it at the door).
      const at = typeof x.at === 'number' ? x.at : (x.at?.toMillis?.() ?? 0);
      return {
        uid: d.id,
        name: x.name ?? '???',
        squad: Array.isArray(meta.names) ? meta.names.map(String) : [x.name ?? '???'],
        seconds: typeof x.value === 'number' ? x.value : null,
        difficulty: TIERS.includes(meta.difficulty) ? meta.difficulty : 'normal',
        hardcore: !!meta.hardcore || id.endsWith('-hc-time'),
        at,
      };
    });
  } catch {
    return [];
  }
}

/**
 * Every FEAT of a run family — one per (difficulty, hardcore) — with its
 * rows, fastest first, one per squad. The feat boards are read directly; the
 * legacy mixed board's rows are filed under their own feat, so runs from
 * before the boards split still count. Every raider posts their own copy of
 * a raid, so identical squad+clock rows fold into one.
 */
async function readFamily(family) {
  const feats = [];
  for (const tier of TIERS) {
    feats.push({ tier, hardcore: false, board: `ff2-${family.id}-${tier}-time` });
    if (family.hc) feats.push({ tier, hardcore: true, board: `ff2-${family.id}-${tier}-hc-time` });
  }
  const [legacy, ...lists] = await Promise.all([
    family.legacy ? readBoard(family.legacy) : Promise.resolve([]),
    ...feats.map((f) => readBoard(f.board)),
  ]);
  return feats.map((f, i) => {
    const pile = [
      ...lists[i],
      // A legacy row belongs to a plain tier board if it matches the tier
      // (any rules), and to a hardcore board only if it was hardcore.
      ...legacy.filter((r) => r.difficulty === f.tier && (!f.hardcore || r.hardcore)),
    ].filter((r) => r.seconds !== null);
    const seen = new Map();
    for (const r of pile.sort((a, b) => a.seconds - b.seconds)) {
      const key = `${[...r.squad].sort().join('|')}#${r.seconds}`;
      if (!seen.has(key)) seen.set(key, r);
    }
    return { family, ...f, rows: [...seen.values()] };
  });
}

const now = Date.now();
const season = seasonIndex(now);
const seasonEnds = SEASON_EPOCH + season * SEASON_DAYS * 86_400_000;
const [players, prev, ladder, ...families] = await Promise.all([
  readPlayers(),
  readSnapshot(),
  readSeasonLadder(season),
  ...FAMILIES.map(readFamily),
]);
const feats = families.flat();
// What counts as "since the last edition" — or, on day one, the last ~day.
const since = prev?.capturedAt?.toMillis?.() ?? now - ACTIVE_WINDOW_MS;

const rows = players.map((p, i) => {
  const before = prev?.byUid[p.uid];
  const xpDelta = before ? p.xp - before.xp : 0;
  const prevRank = prev?.prevRank[p.uid] ?? null;
  return {
    rank: i + 1,
    name: p.name,
    xp: p.xp,
    duoPoints: p.duo,
    ffaPoints: p.ffa,
    isNew: !before, // not in the last edition's snapshot — new to the ladder
    xpGained: xpDelta,
    gamesApprox: Math.max(0, Math.round(xpDelta / XP_PER_GAME)),
    // Climbs ONLY — the paper never names who slid down the board.
    rankChange: prevRank && prevRank > i + 1 ? prevRank - (i + 1) : null,
    activeRecently: p.updatedAt > 0 && now - p.updatedAt < ACTIVE_WINDOW_MS,
  };
});

const movers = rows.filter((r) => r.gamesApprox > 0 || r.activeRecently);
const totalGames = rows.reduce((s, r) => s + r.gamesApprox, 0);
const climbers = rows.filter((r) => (r.rankChange ?? 0) > 0).sort((a, b) => b.rankChange - a.rankChange);
const busiest = [...rows].sort((a, b) => b.gamesApprox - a.gamesApprox).filter((r) => r.gamesApprox > 0);

/** A board row as the paper prints it. */
const entry = (f, r, place) => ({
  feat: featName(f.family, f.tier, f.hardcore),
  time: fmtRunTime(r.seconds),
  who: r.squad.join(' · '),
  squadSize: r.squad.length,
  place, // 1 = the record for this feat
  entries: f.rows.length, // how many squads have cleared this feat at all
  // (A stamp before 2025 is a test row's, not a clock — leave it undated.)
  hoursAgo: r.at > Date.UTC(2025, 0, 1) ? Math.round((now - r.at) / 3_600_000) : null,
});

// THE RECORD BOOK: the holder of every feat that has one, hardest first.
const recordBook = feats
  .filter((f) => f.rows.length)
  .sort((a, b) => featRank(b.tier, b.hardcore) - featRank(a.tier, a.hardcore) || FAMILIES.indexOf(a.family) - FAMILIES.indexOf(b.family))
  .map((f) => entry(f, f.rows[0], 1));

// NEW SINCE THE LAST EDITION: every clear that landed on a feat board since,
// with where it placed. A place of 1 is a new record for that feat.
const newClears = feats
  .flatMap((f) => f.rows.map((r, i) => ({ f, r, place: i + 1 })).filter(({ r }) => r.at > since))
  .sort((a, b) => a.place - b.place || featRank(b.f.tier, b.f.hardcore) - featRank(a.f.tier, a.f.hardcore))
  .map(({ f, r, place }) => entry(f, r, place));

// OPEN FEATS: feats nobody has cleared yet, hardest first — a standing
// invitation, and the best material for WHAT TO DO TODAY.
const openFeats = feats
  .filter((f) => !f.rows.length)
  .sort((a, b) => featRank(b.tier, b.hardcore) - featRank(a.tier, a.hardcore))
  .map((f) => featName(f.family, f.tier, f.hardcore));

// THIN BOARDS: feats with only a handful of clears — a top-3 place is
// there for the taking.
const thinFeats = feats
  .filter((f) => f.rows.length > 0 && f.rows.length < 3)
  .map((f) => ({ feat: featName(f.family, f.tier, f.hardcore), entries: f.rows.length, recordTime: fmtRunTime(f.rows[0].seconds) }));

const brief = {
  date: new Date(now).toISOString().slice(0, 10),
  weekday: new Date(now).toLocaleDateString('en-US', { weekday: 'long' }),
  edition: (prev?.edition ?? 0) + 1,
  firstEdition: !prev,
  // Read this before quoting any number.
  legend: {
    note: 'xp, duoPoints and ffaPoints are POINT totals — NOT counts of matches played or won. The ONLY measure of how many games a player played is gamesApprox (per player) and summary.totalGamesApprox (overall), and even those are estimates inferred from XP gained. Never describe a points figure as a number of matches, wins or games.',
    gamesApprox: 'ESTIMATED games played since the last edition (round(xpGained / 25)) — THIS is the games-played figure',
    rankChange: 'places climbed on the XP ladder since the last edition. Climbs only — never report who dropped.',
    feats:
      'Every run is timed and filed under a FEAT: its mode (SPEEDRUN = the solo five-titan campaign run; TITAN RAID = a 2–5 player squad against the titans; GOOPLIATH RAID = a squad against GOOPLIATH), its difficulty (NORMAL < HARD < BLAZING) and, for speedrun and titan raid, HARDCORE (no healing between bosses). A harder feat is more impressive than a faster time on an easier one — always lead with the hardest feats. Times are cumulative fight time, M:SS.t.',
    recordBook: 'the record holder for every feat that has one, hardest feat first',
    newClears: 'clears that landed since the last edition and where they placed on their feat board (place 1 = a new record). Only VICTORIES are ever recorded.',
    openFeats: 'feats nobody has cleared yet, hardest first — great "be the first" suggestions',
    thinFeats: 'feats with fewer than three clears — a podium place is easy to take',
  },
  // A quiet day: nobody played and no run landed.
  nobodyPlayed: totalGames === 0 && movers.length === 0 && newClears.length === 0,
  season: {
    number: season,
    daysLeft: Math.max(0, Math.ceil((seasonEnds - now) / 86_400_000)),
    top: ladder.slice(0, 5), // ranked ladder points this season
    note: 'Seasons last 90 days. The top 25 at the close keep a trophy (1ST/2ND/3RD/TOP 10/TOP 25) on their profile.',
  },
  summary: {
    activePlayers: movers.length,
    totalGamesApprox: totalGames,
    newClears: newClears.length,
    newRecords: newClears.filter((c) => c.place === 1).length,
    newcomers: rows.filter((r) => r.isNew).map((r) => r.name),
    topClimber: climbers[0] ?? null,
    busiest: busiest[0] ?? null,
    xpLeader: rows[0] ?? null,
  },
  recordBook,
  newClears: newClears.slice(0, 15),
  openFeats,
  thinFeats,
  climbers: climbers.slice(0, 5),
  standings: rows.slice(0, 12),
};

process.stdout.write(JSON.stringify(brief, null, 2) + '\n');
// Firestore's gRPC channel keeps the event loop alive; exit explicitly.
process.exit(0);
