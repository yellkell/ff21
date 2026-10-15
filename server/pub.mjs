/**
 * IRON BALLS PUB server — one shared room, up to 12 punters.
 *
 * Unlike the 1v1 bout relay (index.mjs) this server holds real state:
 *   - players and their latest poses, snapshotted to everyone at 20 Hz;
 *   - prop ownership: each pint glass / dart has at most one simulating
 *     owner; grabs are granted first-come (which is also how a mid-air
 *     CATCH transfers a throw to the catcher);
 *   - the darts leaderboard (per session — wiped when the pub empties);
 *   - the IRON SNAKE machine claim + its high score, persisted to
 *     server/pub-data.json so the house record survives restarts.
 *
 * Protocol: see src/pub/protocol.ts.
 *
 *   npm run server:pub        # alone, on :8788 (or PORT=...)
 *   npm run server            # inside THE ROOM SERVER (room.mjs), at /pub
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { WebSocketServer } from 'ws';
import { isMain, serve } from './mount.mjs';
import { DISCORD_CHANNEL_ID, DISCORD_TOKEN } from './discord.mjs';

const PORT = Number(process.env.PORT || 8788);
const MAX_PLAYERS = 12;
const TICK_MS = 50; // 20 Hz snapshots
// Glasses are ids 0-14 (the pub opens with 8 active; the barkeep brings the
// rest out one at a time), darts are ids 15-20. Mirrors src/pub/config.ts.
const GLASS_MAX = 8;
const GLASS_START = 0;
const DART_COUNT = 6;
const PROP_COUNT = GLASS_MAX + DART_COUNT;
const RESTOCK_MS = 14_000;

const DATA_FILE = join(dirname(fileURLToPath(import.meta.url)), 'pub-data.json');

// Accents handed out by join order — mirrors ACCENTS in src/pub/config.ts.
const ACCENTS = [
  0xff7a18, 0x4fb7ff, 0x7dff5a, 0xff4fd8, 0xffb000, 0x9f7bff,
  0x4dffc8, 0xe8352a, 0xf4f6fb, 0x5a8cff, 0xffe04d, 0xff8c5a,
];

// --- persisted state ---------------------------------------------------------
function loadData() {
  try {
    return JSON.parse(readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { snakeHi: { name: '—', score: 0 }, snakeBoard: [] };
  }
}

/** The Octa Hunt all-time board sent to clients — one row per player (their
 *  personal best), highest first, top 15, WITHOUT the private device id. */
function snakeBoardRows() {
  return data.snakeBoard.map(({ name, score }) => ({ name, score }));
}

// --- moderation -----------------------------------------------------------------
// An admin (yellkell) can remove a misbehaving punter from the browser admin
// panel (hold Z+A+P). A ban closes their socket — which also cuts their voice,
// since voice rides this same socket — and remembers their IP + client id so
// they can't just rejoin. The list persists with the rest of the pub data.
//
// Bans must carry ADMIN_TOKEN (set it in the Render service environment);
// without it the ban controls are inert, so a random punter can't wield them.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
// This name can never be banned, however it's typed (case/space-insensitive).
const PROTECTED_NAME = 'yellkell';

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || req.socket.remoteAddress || '';
}

function isBanned(ip, cid) {
  return (ip && data.bans.ips.includes(ip)) || (cid && data.bans.cids.includes(cid));
}
function saveData() {
  try {
    writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[iron-balls-pub] could not persist data:', err.message);
  }
}
const data = loadData();
if (!data.bans) data.bans = { ips: [], cids: [] };
if (!data.snakeBoard) data.snakeBoard = []; // Octa Hunt all-time top 15 (per player)

// --- the OCTA HUNT all-time board is no longer this relay's problem ---------
// It used to be. pub-data.json lives on Render's EPHEMERAL disk, wiped on every
// redeploy and cold start, which silently reset the all-time board overnight —
// so the relay mirrored the whole board into Firestore as a single document and
// restored it on boot. That worked, but it made the relay a writer of player
// records: one document holding everyone's scores, written by a machine nobody
// signs in to, in a collection whose rules had to be open for it to work at all.
//
// The client posts its own row now (src/pub/systems/DroneHuntSystem.ts →
// net/boards.ts, `pub-octahunt`), under its own uid, ratcheted by the security
// rules like every other board in the app. The wall poster reads that board
// directly. Two things follow: a solo session in an empty pub counts, which it
// never did before, and the board is the same one whichever region you drank in.
//
// What stays here is the LIVE board — who is in this pub right now and what
// they have scored this session — broadcast over the socket for the room. That
// is session state, it belongs on the wire, and the ephemeral disk suits it
// fine.

// --- room state ---------------------------------------------------------------
/** id → { ws, name, accent, head, left, right } */
const players = new Map();
/** id → { kind, holder, mode, pos, quat } */
const props = new Map();
for (let i = 0; i < PROP_COUNT; i++) {
  props.set(i, {
    id: i,
    kind: i < GLASS_MAX ? 'glass' : 'dart',
    holder: null,
    mode: 'rest',
    pos: null,
    quat: null,
    // Darts are always out; glasses past the opening 8 wait in the back.
    active: i >= GLASS_MAX || i < GLASS_START,
  });
}
const board = new Map(); // playerId → { name, accent, score, darts }
let snakePlayer = null;
// Jukebox station the whole room shares (−1 = off). Flipped at the cabinet by
// any punter; reset when the pub empties. Mirrors JUKEBOX in src/pub/config.ts.
let music = -1;
// Songs are bundled client-side now (src/pub/songs), so the count is dynamic;
// this is just a sanity cap on the index a client may select.
const MUSIC_STATIONS = 64;
let nextId = 1;
let joinCount = 0;

// --- fight hall lifecycle -------------------------------------------------------
// Best of 5 (first to WIN_TARGET round wins), mirroring the arena's MATCH:
//   idle → (both corners claimed) starting (3-2-1) → fighting
//   round ends on a KO (hp 0) or when ROUND_TIME runs out (higher hp wins)
//   → roundOver (a breather) → starting (3-2-1) → next round's fighting …
//   until someone reaches 3 → over → idle. Fighters report their own hp
//   (victim-authoritative, like the arena); the server rules on the lifecycle.
// Keep these in sync with FIGHT in src/pub/config.ts.
const HP_MAX = 100;
const WIN_TARGET = 3; // round wins to take the match (best of 5)
const ROUND_TIME = 60; // seconds per round
const START_COUNTDOWN = 3; // pre-round 3-2-1 countdown, before EVERY round
const ROUND_OVER_DELAY = 5; // seconds of round-result breather between rounds
const MATCH_OVER_DELAY = 6; // seconds of match-result pause
const fight = {
  phase: 'idle',
  sides: [null, null],
  hp: [HP_MAX, HP_MAX],
  score: [0, 0],
  round: 1,
  roundTimer: 0,
  winner: null,
};
let fightTimer = null;
let lastTimerSent = -1;

function fightNet() {
  return {
    phase: fight.phase,
    sides: fight.sides,
    hp: fight.hp,
    score: fight.score,
    round: fight.round,
    roundTimer: fight.roundTimer,
    winner: fight.winner,
  };
}

function broadcastFight() {
  lastTimerSent = Math.ceil(fight.roundTimer);
  broadcast({ t: 'fight', fight: fightNet() });
}

function resetFight() {
  clearTimeout(fightTimer);
  fightTimer = null;
  fight.phase = 'idle';
  fight.sides = [null, null];
  fight.hp = [HP_MAX, HP_MAX];
  fight.score = [0, 0];
  fight.round = 1;
  fight.roundTimer = 0;
  fight.winner = null;
}

/** Both corners claimed → fresh match: zero the card, then round 1's countdown. */
function startMatch() {
  fight.score = [0, 0];
  fight.winner = null;
  startRound(1);
}

/** Open a round on a 3-2-1 countdown ('starting'). The round-clock tick rolls
 *  it into the bell (beginRound) when it reaches zero — so EVERY round, not
 *  just the first, gets the countdown. */
function startRound(roundNum) {
  clearTimeout(fightTimer);
  fightTimer = null;
  fight.round = roundNum;
  fight.phase = 'starting';
  fight.hp = [HP_MAX, HP_MAX];
  fight.roundTimer = START_COUNTDOWN;
  fight.winner = null;
  broadcastFight();
}

/** Bell: full health, clock reset, live. */
function beginRound() {
  fight.phase = 'fighting';
  fight.hp = [HP_MAX, HP_MAX];
  fight.roundTimer = ROUND_TIME;
  fight.winner = null;
  broadcastFight();
}

/** A round was decided (KO, time, or draw): score it, then the next round or the match. */
function endRound(winnerSide) {
  if (winnerSide !== null && winnerSide !== 0 && winnerSide !== 1) return;
  fight.winner = winnerSide === null ? null : fight.sides[winnerSide];
  if (winnerSide !== null) {
    fight.score[winnerSide] += 1;
    if (fight.score[winnerSide] >= WIN_TARGET) {
      endMatch(fight.sides[winnerSide]);
      return;
    }
  }
  fight.phase = 'roundOver';
  broadcastFight();
  clearTimeout(fightTimer);
  fightTimer = setTimeout(() => {
    if (fight.sides[0] && fight.sides[1]) startRound(fight.round + 1);
  }, ROUND_OVER_DELAY * 1000);
}

function endMatch(winnerId) {
  fight.phase = 'over';
  fight.winner = winnerId;
  broadcastFight();
  clearTimeout(fightTimer);
  fightTimer = setTimeout(() => {
    resetFight();
    broadcastFight();
  }, MATCH_OVER_DELAY * 1000);
}

function leaveFight(id) {
  const side = fight.sides.indexOf(id);
  if (side === -1) return;
  if (fight.phase === 'fighting' || fight.phase === 'starting' || fight.phase === 'roundOver') {
    // Walked off / disconnected mid-bout: forfeit the whole match.
    endMatch(fight.sides[side === 0 ? 1 : 0]);
  } else if (fight.phase === 'idle') {
    fight.sides[side] = null;
    broadcastFight();
  }
}

// Round clock + pre-round countdown: tick while a round is live (higher hp wins
// on time-out) AND while the 3-2-1 counts down (ring the bell at zero).
setInterval(() => {
  if (fight.phase === 'fighting') {
    fight.roundTimer = Math.max(0, fight.roundTimer - 0.25);
    if (fight.roundTimer <= 0) {
      endRound(fight.hp[0] === fight.hp[1] ? null : fight.hp[0] > fight.hp[1] ? 0 : 1);
    } else if (Math.ceil(fight.roundTimer) !== lastTimerSent) {
      broadcastFight(); // push the clock only when the displayed second changes
    }
  } else if (fight.phase === 'starting') {
    fight.roundTimer = Math.max(0, fight.roundTimer - 0.25);
    if (fight.roundTimer <= 0) {
      if (fight.sides[0] && fight.sides[1]) beginRound();
    } else if (Math.ceil(fight.roundTimer) !== lastTimerSent) {
      broadcastFight(); // push the countdown second so clients show 3 → 2 → 1
    }
  }
}, 250);

const ZERO_POSE = [0, 0, 0, 0, 0, 0, 1];

/** A PoseTuple off the wire: position + quaternion, seven numbers. */
const isPose = (v) => Array.isArray(v) && v.length === 7 && v.every((n) => typeof n === 'number');

// --- voice routing --------------------------------------------------------------
// Spatial voice rides this same socket as binary PCM frames. The server fans
// each frame out to the WHOLE room — fighters and crowd alike always hear
// everyone (the open pub never goes quiet, even mid-bout). Spatial falloff in
// the client keeps distant voices distant.
function relayVoice(senderId, payload) {
  if (!players.has(senderId)) return;
  const idBuf = Buffer.from(senderId, 'ascii');
  const out = Buffer.concat([Buffer.from([idBuf.length]), idBuf, payload]);
  for (const [rid, r] of players) {
    if (rid === senderId) continue;
    if (r.ws.readyState === r.ws.OPEN && r.ws.bufferedAmount <= MAX_BUFFERED) r.ws.send(out, { binary: true });
  }
}

/** Past this much unsent data a punter is on bad Wi-Fi: the pose firehose
 *  (snapshots, voice) is dropped for them rather than queued, so one slow
 *  socket can't grow the relay's memory until it dies (see index.mjs). */
const MAX_BUFFERED = 512 * 1024;

function send(ws, msg) {
  if (ws.readyState !== ws.OPEN) return;
  if (msg.t === 'snap' && ws.bufferedAmount > MAX_BUFFERED) return;
  ws.send(JSON.stringify(msg));
}

function broadcast(msg, exceptId) {
  const raw = JSON.stringify(msg);
  for (const [id, p] of players) {
    if (id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(raw);
  }
}

function boardRows() {
  return [...board.entries()]
    .map(([id, v]) => ({ id, ...v }))
    .sort((a, b) => b.score - a.score);
}

function playerNet(id) {
  const p = players.get(id);
  return { id, name: p.name, accent: p.accent, av: p.av, pf: p.pf, avc: p.avc, avl: p.avl, lk: p.lk, gr: p.gr, head: p.head, left: p.left, right: p.right };
}

function releaseSnake(id) {
  if (snakePlayer === id) {
    snakePlayer = null;
    broadcast({ t: 'snake-player', id: null });
  }
}

function handleEvent(senderId, ev) {
  switch (ev.e) {
    case 'DART_HIT': {
      const p = players.get(senderId);
      const row = board.get(senderId) ?? { name: p.name, accent: p.accent, score: 0, darts: 0 };
      row.score += ev.score;
      row.darts += 1;
      board.set(senderId, row);
      broadcast({ t: 'ev', from: senderId, ev });
      broadcast({ t: 'board', rows: boardRows() });
      break;
    }
    case 'DARTS_RESET':
      board.clear();
      broadcast({ t: 'ev', from: senderId, ev });
      broadcast({ t: 'board', rows: [] });
      break;
    case 'FIGHT_HP': {
      const side = fight.sides.indexOf(senderId);
      if (side !== -1 && fight.phase === 'fighting') {
        fight.hp[side] = ev.hp;
        if (ev.hp <= 0) {
          endRound(fight.hp[0] <= 0 && fight.hp[1] <= 0 ? null : side === 0 ? 1 : 0); // the OTHER corner won the round
        } else {
          broadcastFight();
        }
      }
      break;
    }
    case 'SNAKE_OVER': {
      const me = players.get(senderId);
      const name = me?.name ?? '???';
      // Key the all-time board by the STABLE device id (cid), so one player's
      // many runs only ever hold ONE row — their personal best — and can't fill
      // the board. Fall back to the session id if a client sent no cid.
      const cid = me?.cid || senderId;
      if (typeof ev.score === 'number' && ev.score > 0) {
        const prev = data.snakeBoard.find((e) => e.cid === cid);
        if (prev) {
          if (ev.score > prev.score) { prev.score = ev.score; prev.name = name; }
        } else {
          data.snakeBoard.push({ cid, name, score: ev.score });
        }
        data.snakeBoard.sort((a, b) => b.score - a.score);
        data.snakeBoard = data.snakeBoard.slice(0, 15);
        // The single house record is just the top of the board now.
        data.snakeHi = { name: data.snakeBoard[0].name, score: data.snakeBoard[0].score };
        saveData();
        broadcast({ t: 'snake-board', board: snakeBoardRows() });
        broadcast({ t: 'snake-hi', hi: data.snakeHi });
      }
      releaseSnake(senderId);
      broadcast({ t: 'ev', from: senderId, ev }, senderId);
      break;
    }
    case 'LOOK': {
      // A mid-visit repaint: fold the fresh packed look into the player's
      // record (so late joiners get it in welcome/join) and relay it.
      const p = players.get(senderId);
      if (p) {
        p.lk = String(ev.lk || '').slice(0, 1024);
        if (ev.gr !== undefined) p.gr = String(ev.gr || '').slice(0, 64);
      }
      broadcast({ t: 'ev', from: senderId, ev }, senderId);
      break;
    }
    default:
      // SNAKE_STATE and friends: pure relay, skip the sender.
      broadcast({ t: 'ev', from: senderId, ev }, senderId);
  }
}

// --- voice is not brokered here ------------------------------------------------
// There used to be a LiveKit token minter in this spot: pub voice ran through
// an SFU, and the server signed short-lived JWTs so the API secret never
// reached a browser. Voice moved to plain Int16 PCM over THIS socket (see
// relayVoice below, and src/pub/voice/) — no SFU, no peer connections, nothing
// to configure — and the token route went on standing there, wired to nothing,
// with three secrets in the deploy environment keeping it company.
//
// Spatialisation is the client's job either way: each inbound frame is fed to
// its speaker's HRTF panner, which is the same graph the arena uses for a
// rival's voice.

// --- live Discord chat for the bar TV -------------------------------------------
// Poll a Discord channel via the bot REST API and relay new messages to the
// room; TvSystem paints them on the TV over the bar. The bot TOKEN stays HERE —
// clients only ever receive the rendered text. Configure on Render:
//   DISCORD_BOT_TOKEN   a bot token. The bot must be in the channel's server
//                       with the View Channel + Read Message History perms.
//   DISCORD_CHANNEL_ID  (optional) overrides the default channel below.
// The token and channel live in discord.mjs now (shared with the bot's
// WRITE path — the bell, the invites, THE CHANNEL's live cards).
const DISCORD_POLL_MS = 7000; // well within Discord's REST rate limits
const DISCORD_CACHE_MAX = 25; // recent history handed to each joiner
let discordCache = []; // chronological (oldest first)
let discordLastId = null;
/** Human-readable relay state, surfaced at GET / for quick diagnosis. */
let discordStatus = DISCORD_TOKEN ? 'starting' : 'off (no DISCORD_BOT_TOKEN)';
let lastLoggedStatus = '';

function setDiscordStatus(s) {
  discordStatus = s;
  if (s !== lastLoggedStatus) {
    lastLoggedStatus = s;
    console.log(`[iron-balls-pub] discord: ${s}`);
  }
}

function hslToRgbInt(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
  };
  return (f(0) << 16) | (f(8) << 8) | f(4);
}

/** A stable, pleasant colour for an author from their id. */
function authorColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return hslToRgbInt((((h % 360) + 360) % 360) / 360, 0.62, 0.7);
}

/** Flatten a message to plain TV text: resolve mentions, strip markup, cap. */
function cleanDiscord(m) {
  let c = String(m.content || '');
  if (Array.isArray(m.mentions)) {
    for (const u of m.mentions) {
      const name = `@${u.global_name || u.username || 'user'}`;
      c = c.split(`<@${u.id}>`).join(name).split(`<@!${u.id}>`).join(name);
    }
  }
  c = c.replace(/<a?:(\w+):\d+>/g, ':$1:').replace(/<#\d+>/g, '#channel').replace(/<@&\d+>/g, '@role');
  c = c.replace(/\s+/g, ' ').trim();
  if (!c && Array.isArray(m.attachments) && m.attachments.length) c = '[image]';
  if (!c && Array.isArray(m.embeds) && m.embeds.length) c = '[link]';
  return c.length > 280 ? c.slice(0, 277) + '…' : c;
}

async function pollDiscord() {
  if (typeof fetch !== 'function') {
    setDiscordStatus('error: this Node has no global fetch (need Node 18+)');
    return;
  }
  try {
    const res = await fetch(
      `https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages?limit=20`,
      { headers: { Authorization: `Bot ${DISCORD_TOKEN}` } },
    );
    if (!res.ok) {
      const hint =
        res.status === 401 ? 'bad token'
        : res.status === 403 ? "bot not in the server, or missing View Channel / Read Message History"
        : res.status === 404 ? 'channel id not found (or bot cannot see it)'
        : res.status === 429 ? 'rate limited — backing off'
        : '';
      setDiscordStatus(`http ${res.status}${hint ? ` — ${hint}` : ''}`);
      return;
    }
    const arr = await res.json();
    if (!Array.isArray(arr)) {
      setDiscordStatus('error: unexpected response shape');
      return;
    }
    const mapped = arr
      .reverse() // the API returns newest-first → make it chronological
      .filter((m) => m && (m.type === 0 || m.type === 19)) // default + reply only
      .map((m) => ({
        id: m.id,
        author: String(m.author?.global_name || m.author?.username || '???').slice(0, 24),
        color: authorColor(String(m.author?.id || m.author?.username || '')),
        content: cleanDiscord(m),
        ts: Date.parse(m.timestamp || '') || Date.now(),
      }))
      .filter((m) => m.content);
    if (mapped.length === 0) {
      // Got messages but none had readable text — almost always the privileged
      // Message Content Intent being off (toggle it on the bot's page).
      const hadAny = arr.some((m) => m && (m.type === 0 || m.type === 19));
      setDiscordStatus(hadAny ? 'connected but messages have NO content — enable Message Content Intent' : 'connected — channel has no messages yet');
      return;
    }

    // New = anything with a higher snowflake than the last we relayed. (Robust to
    // edits/deletes; the first poll seeds the cache silently with no broadcast.)
    let newOnes = [];
    if (discordLastId) {
      const last = BigInt(discordLastId);
      newOnes = mapped.filter((m) => {
        try {
          return BigInt(m.id) > last;
        } catch {
          return false;
        }
      });
    }
    discordCache = mapped.slice(-DISCORD_CACHE_MAX);
    discordLastId = mapped[mapped.length - 1].id;
    setDiscordStatus(`ok — ${discordCache.length} cached`);
    if (newOnes.length) broadcast({ t: 'discord', messages: newOnes });
  } catch (err) {
    setDiscordStatus(`error: ${err?.message || err}`);
  }
}

if (DISCORD_TOKEN) {
  pollDiscord();
  setInterval(pollDiscord, DISCORD_POLL_MS);
  console.log(`[iron-balls-pub] discord chat relay ON — channel ${DISCORD_CHANNEL_ID}`);
} else {
  console.log('[iron-balls-pub] discord chat relay OFF — set DISCORD_BOT_TOKEN to light up the bar TV');
}

// --- wiring ---------------------------------------------------------------------
export function handleHttp(req, res) {
  const url = new URL(req.url, 'http://localhost');

  // The page is served from Firebase Hosting and the relay from Render, so a
  // browser reading this health page is doing it cross-origin.
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      pub: 'iron-balls-pub',
      punters: players.size,
      snakeHi: data.snakeHi,
      voice: 'pcm', // Int16 over this socket — see relayVoice
      // Quick Discord-relay diagnosis — open this URL in a browser to read it.
      discord: {
        configured: Boolean(DISCORD_TOKEN),
        channel: DISCORD_CHANNEL_ID,
        cached: discordCache.length,
        status: discordStatus,
      },
    }),
  );
}

// Frames here are small JSON envelopes; `ws` would otherwise accept 100 MiB
// each, letting one punter park a huge allocation on the shared pub server.
export const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

// An 'error' event with no listener is re-thrown as an uncaught exception, so
// one ECONNRESET (a headset dropping off Wi-Fi) would take the whole pub down
// and everyone in it. Every socket needs a handler, and so does the server.
wss.on('error', (err) => console.error('[pub] server error', err));

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.on('error', () => ws.terminate());
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  const ip = clientIp(req);
  let myId = null;

  ws.on('message', (raw, isBinary) => {
    // Binary frames are spatial voice — fanned out to the whole room (open mic).
    if (isBinary) {
      if (myId) relayVoice(myId, raw);
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    // `null` parses and has no `.t` — reading it threw and took the whole
    // room server down (see index.mjs).
    if (!msg || typeof msg !== 'object') return;

    if (msg.t === 'hello') {
      if (myId) return;
      const cid = String(msg.cid || '').slice(0, 64);
      if (isBanned(ip, cid)) {
        send(ws, { t: 'banned' });
        ws.close(1008, 'banned');
        return;
      }
      if (players.size >= MAX_PLAYERS) {
        send(ws, { t: 'full' });
        ws.close(1013, 'pub full');
        return;
      }
      myId = `p${nextId++}`;
      const accent = ACCENTS[joinCount++ % ACCENTS.length];
      players.set(myId, {
        ws,
        ip,
        cid,
        name: String(msg.name || myId).slice(0, 14),
        accent,
        av: String(msg.av || '').slice(0, 16),
        pf: String(msg.pf || '').slice(0, 16),
        avc: Number.isFinite(msg.avc) ? msg.avc : -1, // custom armour hue (0..1) or -1
        avl: Number.isFinite(msg.avl) ? msg.avl : 0.5, // custom armour lightness (0..1)
        lk: String(msg.lk || '').slice(0, 1024), // packed paint look (clients re-validate)
        gr: String(msg.gr || '').slice(0, 64), // worn gear ids (clients re-validate)
        head: ZERO_POSE,
        left: ZERO_POSE,
        right: ZERO_POSE,
      });
      send(ws, {
        t: 'welcome',
        id: myId,
        accent,
        players: [...players.keys()].map(playerNet),
        props: [...props.values()],
        board: boardRows(),
        snakeHi: data.snakeHi,
        snakeBoard: snakeBoardRows(),
        snakePlayer,
        fight: fightNet(),
        music,
        discord: discordCache,
      });
      broadcast({ t: 'join', player: playerNet(myId) }, myId);
      console.log(`[iron-balls-pub] ${myId} (${players.get(myId).name}) in — ${players.size}/${MAX_PLAYERS}`);
      return;
    }

    if (!myId) return;
    const me = players.get(myId);

    switch (msg.t) {
      case 'pose':
        // Stored and rebroadcast to the whole room at 20 Hz, so only a real
        // pose tuple is kept — anything else (a 64 KB blob, say) would be
        // fanned out to every punter every tick.
        if (!isPose(msg.head) || !isPose(msg.left) || !isPose(msg.right)) break;
        me.head = msg.head;
        me.left = msg.left;
        me.right = msg.right;
        // Fast-path a FIGHTER's pose straight to their opponent, skipping the
        // 20 Hz snapshot tick: fighters stream at the arena's denser rate, and
        // dodges should read across the pit with no batching latency. The
        // crowd still gets everyone on the normal tick, and the client's snap
        // handler already takes partial lists, so old clients just work.
        if (fight.phase !== 'idle') {
          const side = fight.sides.indexOf(myId);
          if (side !== -1) {
            const foe = players.get(fight.sides[1 - side]);
            if (foe) send(foe.ws, { t: 'snap', poses: [[myId, msg.head, msg.left, msg.right]] });
          }
        }
        break;
      case 'grab': {
        const prop = props.get(msg.id);
        if (!prop) break;
        // Granted if free or mid-flight (a catch). A prop held in someone's
        // hand can't be wrestled away — the requester learns who has it.
        if (prop.holder === null || prop.mode === 'flight' || prop.holder === myId) {
          prop.holder = myId;
          prop.mode = 'held';
          broadcast({ t: 'grabbed', id: prop.id, holder: myId });
        } else {
          send(ws, { t: 'grabbed', id: prop.id, holder: prop.holder });
        }
        break;
      }
      case 'release': {
        const prop = props.get(msg.id);
        if (prop && prop.holder === myId) {
          prop.mode = 'flight';
          broadcast({ t: 'released', id: prop.id, holder: myId }, myId);
        }
        break;
      }
      case 'prop': {
        const prop = props.get(msg.id);
        if (prop && prop.holder === myId) {
          prop.pos = msg.pos;
          prop.quat = msg.quat;
          broadcast({ t: 'prop', id: prop.id, pos: msg.pos, quat: msg.quat }, myId);
        }
        break;
      }
      case 'settle': {
        const prop = props.get(msg.id);
        if (prop && (prop.holder === myId || prop.holder === null)) {
          prop.holder = null;
          prop.mode = 'rest';
          prop.pos = msg.pos;
          prop.quat = msg.quat;
          broadcast({ t: 'settled', id: prop.id, pos: msg.pos, quat: msg.quat }, myId);
        }
        break;
      }
      case 'claim-snake':
        if (snakePlayer === null || snakePlayer === myId) {
          snakePlayer = myId;
          broadcast({ t: 'snake-player', id: myId });
        } else {
          send(ws, { t: 'snake-player', id: snakePlayer });
        }
        break;
      case 'leave-snake':
        releaseSnake(myId);
        break;
      case 'claim-fight': {
        const side = msg.side === 1 ? 1 : 0;
        if (fight.phase === 'idle' && fight.sides[side] === null && !fight.sides.includes(myId)) {
          fight.sides[side] = myId;
          if (fight.sides[0] && fight.sides[1]) startMatch();
          else broadcastFight();
        } else {
          send(ws, { t: 'fight', fight: fightNet() });
        }
        break;
      }
      case 'leave-fight':
        leaveFight(myId);
        break;
      case 'music': {
        // Any punter may flip the room's station. Clamp to a real station or off.
        const s = Number.isInteger(msg.station) ? msg.station : -1;
        music = s >= 0 && s < MUSIC_STATIONS ? s : -1;
        broadcast({ t: 'music', station: music });
        break;
      }
      case 'admin-ban': {
        if (!ADMIN_TOKEN || msg.token !== ADMIN_TOKEN) {
          send(ws, {
            t: 'admin-result',
            ok: false,
            msg: ADMIN_TOKEN ? 'wrong admin key' : 'admin disabled — no ADMIN_TOKEN set on the server',
          });
          break;
        }
        const target = players.get(msg.id);
        if (!target) {
          send(ws, { t: 'admin-result', ok: false, msg: 'that punter has already left' });
          break;
        }
        if (String(target.name).trim().toLowerCase() === PROTECTED_NAME) {
          send(ws, { t: 'admin-result', ok: false, msg: `${target.name} can't be banned` });
          break;
        }
        if (target.ip && !data.bans.ips.includes(target.ip)) data.bans.ips.push(target.ip);
        if (target.cid && !data.bans.cids.includes(target.cid)) data.bans.cids.push(target.cid);
        saveData();
        send(target.ws, { t: 'banned' });
        target.ws.close(1008, 'banned'); // the close handler clears their seat + props
        send(ws, { t: 'admin-result', ok: true, msg: `banned ${target.name}` });
        console.log(`[iron-balls-pub] ADMIN ${myId} banned ${msg.id} (${target.name}) ip=${target.ip} cid=${target.cid}`);
        break;
      }
      case 'ev':
        handleEvent(myId, msg.ev);
        break;
    }
  });

  ws.on('close', () => {
    if (!myId) return;
    players.delete(myId);
    releaseSnake(myId);
    leaveFight(myId);
    // Drop anything they were holding or had in the air where it was last
    // seen — someone else can pick it up.
    for (const prop of props.values()) {
      if (prop.holder === myId) {
        prop.holder = null;
        prop.mode = 'rest';
        if (prop.pos) broadcast({ t: 'settled', id: prop.id, pos: prop.pos, quat: prop.quat });
      }
    }
    broadcast({ t: 'leave', id: myId });
    // Last one out: wipe the session chalkboard (the snake hi-score stays).
    if (players.size === 0) {
      board.clear();
      resetFight();
      music = -1; // the jukebox falls quiet for the next punter in

      for (const prop of props.values()) {
        prop.holder = null;
        prop.mode = 'rest';
        prop.pos = null;
        prop.quat = null;
        prop.active = prop.kind === 'dart' || prop.id < GLASS_START;
      }
    }
    console.log(`[iron-balls-pub] ${myId} out — ${players.size}/${MAX_PLAYERS}`);
  });
});

// The barkeep's restock round: while anyone is in, bring out one fresh
// glass every RESTOCK_MS until all 8 are on the floor. (Clients animate the
// robot walking it over; the glass lands on the bar a few seconds after this
// broadcast — see glassDeliverDelay in src/pub/config.ts.)
setInterval(() => {
  if (players.size === 0) return;
  const next = [...props.values()].find((p) => p.kind === 'glass' && !p.active);
  if (!next) return;
  next.active = true;
  broadcast({ t: 'glass-out', id: next.id });
}, RESTOCK_MS);

// 20 Hz pose snapshots (each recipient gets everyone but themselves).
setInterval(() => {
  if (players.size < 2) return;
  for (const [id, p] of players) {
    const poses = [];
    for (const [oid, o] of players) {
      if (oid !== id) poses.push([oid, o.head, o.left, o.right]);
    }
    send(p.ws, { t: 'snap', poses });
  }
}, TICK_MS);

// Heartbeat: cull dead sockets.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 10_000);

if (isMain(import.meta.url)) {
  serve({
    port: PORT,
    http: handleHttp,
    wss,
    onListen: () => console.log(`[iron-balls-pub] pub open on :${PORT} — hi-score ${data.snakeHi.score} (${data.snakeHi.name})`),
  });
}
