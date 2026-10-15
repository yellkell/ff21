/**
 * THE CHANNEL — FIRE FIGHT 2's television relay (stats.html's TV tab).
 *
 * Every bout, brawl and raid is a show, and this is the transmitter. The
 * headset RUNNING a match (the bot bout's one player, a duel's host, the
 * mesh's authority seat, the raid host) opens a CHANNEL here and pushes a
 * small top-down FRAME five times a second — where every fighter stands,
 * their hands, their health, the balls in the air, the round clock, the
 * titan. Viewers on the web tune in and get the frames of whatever is on.
 * When nothing is on air the channel peeps into THE CLUB instead: the
 * rave relay's public floor (who's dancing where, the ball if one is up),
 * and if the club is dark it says so.
 *
 * The relay never simulates anything and never reads a frame — it is a
 * size-capped opaque blob it fans out. It only decides WHAT'S ON:
 * live people over raids over solo bouts over the club, newest first.
 *
 * THE DISCORD BOT (discord.mjs) is the announcer: a channel that stays up
 * past a few seconds posts LIVE with the TV link; when it ends it posts
 * the final. Bot bouts play on the TV but never make the paper.
 *
 * Wire (JSON over WebSocket at /tv):
 *   caster → { t:'cast', kind, title, names[] }  open (or re-title) my channel
 *            { t:'f', f }                           a frame (~5 Hz, ≤ 12 KiB)
 *            { t:'end', result? }                   sign off (a close does too)
 *   viewer → { t:'watch' }                          send me the guide + what's on
 *            { t:'tune', id|null }                  pin a channel (null = auto)
 *   relay  → { t:'on-air', id }                     to the caster
 *            { t:'guide', channels, featured, club } to every viewer on change
 *            { t:'f', id, kind, f }                 the tuned channel's frame
 *            { t:'club', f }                        the club, when that's on
 *
 * HTTP:  GET /guide            what's on, as JSON (the stats page's first paint)
 *        POST /invite          { code, mode, name, open } → the bot posts the
 *                              room's join link (the lobby's SHARE button)
 *
 *   npm run server            # inside THE ROOM SERVER (room.mjs), at /tv
 *   node server/tv.mjs        # alone, on :8790 (or PORT=…)
 */

import { WebSocketServer } from 'ws';
import { isMain, serve } from './mount.mjs';
import { discordConfigured, discordWriteStatus, finalCard, inviteCard, liveCard, postDiscord } from './discord.mjs';
import { clubSnapshot } from './rave.mjs';

const PORT = Number(process.env.PORT || 8790);
/** A channel with no frame for this long has gone dark (a headset died). */
const CHANNEL_TTL_MS = 6000;
/** Frames are small; anything bigger is a mistake or an attack. */
const FRAME_MAX = 12 * 1024;
/** A PICTURE is a 640x360 JPEG in base64 (src/config.ts VIDEO) — around
 *  27 KB in practice. The cap is generous enough for a busy scene and mean
 *  enough that nobody streams video of something else through here. */
const VIDEO_MAX = 96 * 1024;
/** No picture for this long and the channel is a diagram again. */
const VIDEO_TTL_MS = 4000;

/**
 * THE CLUB'S PICTURE. The club is not a channel — it has no caster and no
 * result, and the relay draws it for itself out of the poses every member
 * is already sending. So the picture rides ALONGSIDE that feed rather than
 * turning the floor into a channel: whoever holds the room sends frames
 * here, and viewers peeping at the club get the render instead of the map.
 *
 * The first sender holds it (the host — there is only ever one of them)
 * and nobody else can talk over it while it's fresh. When they leave, the
 * picture goes stale, the map comes back and the next host can take over —
 * which is why the socket is kept beside the frame.
 */
let clubVideo = null;
const clubFresh = () => !!clubVideo && Date.now() - clubVideo.at < VIDEO_TTL_MS;
/** The club feed's rate — it's people walking about, not a fight. */
const TICK_MS = 250;
/** A channel must hold this long before the bot calls it LIVE — a mis-tap
 *  that backs straight out to the lobby is not news. */
const LIVE_POST_DELAY_MS = 8000;
/** Which kinds make the paper. Solo bouts play on the TV only. */
const POST_KINDS = new Set(['1v1', '2v2', 'ffa', 'raid']);
const KINDS = new Set(['1v1', '2v2', 'ffa', 'raid', 'solo']);
/** What's on: people over raids over solo, then the freshest. */
const PRIORITY = { '1v1': 3, '2v2': 3, ffa: 3, raid: 2, solo: 1 };
/** One invite per room, one per IP every so often — the bot is not a horn. */
const INVITE_IP_GAP_MS = 20_000;
const INVITE_CODE_GAP_MS = 5 * 60_000;
/** Any socket can open a channel, so the LIVE posts get a ceiling of their
 *  own: a script opening channels in a loop can't turn the bot into a horn. */
const LIVE_POST_MAX = 6;
const LIVE_POST_WINDOW_MS = 10 * 60_000;
/** When recent LIVE posts went out, oldest first. */
const livePosts = [];
/** The SHARE card's ceiling over everyone, per the same window. */
const INVITE_POST_MAX = 20;
const invitePosts = [];

/** id → { id, kind, title, names, since, frame, frameAt, ws, posted, live, ended } */
const channels = new Map();
/** viewer socket → { tuned: id | null, sawGuide: string } */
const viewers = new Map();
let nextId = 1;
let guideKey = '';

// The socket has to admit a PICTURE, which is several times a pose frame.
// The pose frame's own 12 KiB limit is enforced in onFrame instead — it
// used to be enforced here, by the transport refusing the message and
// killing the connection, which stopped being possible the moment video
// needed the ceiling raised.
export const wss = new WebSocketServer({ noServer: true, maxPayload: VIDEO_MAX + 8 * 1024 });
wss.on('error', (err) => console.error('[tv] server error', err));

function send(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  // A viewer on a bad line gets the NEWEST frame, not a replay of a stalled minute.
  if (ws.bufferedAmount > 256 * 1024 && (obj.t === 'f' || obj.t === 'club')) return;
  ws.send(JSON.stringify(obj), (err) => {
    if (err) ws.terminate();
  });
}

const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '');
const names = (v) => (Array.isArray(v) ? v.map((n) => text(n, 16)).filter(Boolean).slice(0, 6) : []);

/* ── what's on ─────────────────────────────────────────────────────────── */

/** Live channels, best first. */
export function lineup() {
  return [...channels.values()]
    .filter((c) => !c.ended)
    .sort((a, b) => (PRIORITY[b.kind] ?? 0) - (PRIORITY[a.kind] ?? 0) || b.since - a.since);
}

function featuredId() {
  return lineup()[0]?.id ?? null;
}

/** The guide: every channel's card, what auto-tune shows, and the club's size. */
export function guide() {
  const club = clubSnapshot();
  return {
    channels: lineup().map((c) => ({ id: c.id, kind: c.kind, title: c.title, names: c.names, since: c.since })),
    featured: featuredId(),
    club: { rooms: club.rooms.length, people: club.rooms.reduce((n, r) => n + r.members.length, 0) },
  };
}

function broadcastGuide(force = false) {
  const g = guide();
  const key = JSON.stringify(g);
  if (!force && key === guideKey) return;
  guideKey = key;
  for (const ws of viewers.keys()) send(ws, { t: 'guide', ...g });
}

/** What this viewer is watching right now: a pinned live channel, else the
 *  featured one, else the club. */
function watching(v) {
  if (v.tuned && channels.has(v.tuned) && !channels.get(v.tuned).ended) return v.tuned;
  return featuredId() ?? 'club';
}

/* ── the casters ───────────────────────────────────────────────────────── */

function openChannel(ws, msg) {
  let c = ws.channel ? channels.get(ws.channel) : null;
  const kind = KINDS.has(msg.kind) ? msg.kind : 'solo';
  const title = text(msg.title, 60) || kind.toUpperCase();
  if (!c || c.ended) {
    c = { id: String(nextId++), kind, title, names: names(msg.names), since: Date.now(), frame: null, frameAt: Date.now(), ws, posted: false, live: false, ended: false };
    channels.set(c.id, c);
    ws.channel = c.id;
    console.log(`[tv] channel ${c.id} on air — ${kind}: ${title}`);
  } else {
    c.kind = kind;
    c.title = title;
    c.names = names(msg.names);
  }
  send(ws, { t: 'on-air', id: c.id });
  broadcastGuide();
}

function endChannel(id, result) {
  const c = channels.get(id);
  if (!c || c.ended) return;
  c.ended = true;
  channels.delete(id);
  console.log(`[tv] channel ${id} off air — ${c.kind}: ${c.title}${result ? ` (${result})` : ''}`);
  if (c.live && discordConfigured()) void postDiscord(finalCard({ kind: c.kind, title: c.title, result: text(result, 200) }));
  broadcastGuide();
}

function onFrame(ws, msg, rawLen) {
  const c = ws.channel ? channels.get(ws.channel) : null;
  if (!c || c.ended) return;
  // A pose frame this big is a mistake or an attack — it is numbers, and a
  // bout's worth of them is a couple of kilobytes. The caster loses its
  // channel and its socket, which is what the transport used to do before
  // the ceiling went up to let pictures through.
  if (rawLen > FRAME_MAX) {
    endChannel(c.id, '');
    ws.channel = null;
    try {
      ws.terminate();
    } catch {
      /* already gone */
    }
    return;
  }
  if (!msg.f || typeof msg.f !== 'object') return;
  c.frame = msg.f;
  c.frameAt = Date.now();
  const out = JSON.stringify({ t: 'f', id: c.id, kind: c.kind, f: c.frame });
  for (const [ws2, v] of viewers) {
    if (watching(v) !== c.id || ws2.readyState !== ws2.OPEN) continue;
    if (ws2.bufferedAmount > 256 * 1024) continue;
    ws2.send(out, () => {});
  }
}

/**
 * A picture of the club floor, from whoever holds the room. Forwarded to
 * everyone peeping at the club, and kept so the next viewer sees it at
 * once. It never keeps anything "on air": the club is on whenever there
 * are people on it, picture or no picture.
 */
function onClubVideo(ws, msg, bytes) {
  if (bytes > VIDEO_MAX) return;
  if (typeof msg.d !== 'string' || !msg.d) return;
  // The picture stays with whoever is sending it: a second socket can't
  // talk over a live feed, only take over once it has gone stale.
  if (clubFresh() && clubVideo.ws !== ws) return;
  clubVideo = { d: msg.d, at: Date.now(), ws };
  const out = JSON.stringify({ t: 'cv', d: msg.d });
  for (const [vws, v] of viewers) {
    if (watching(v) !== 'club') continue;
    if (vws.readyState === vws.OPEN && vws.bufferedAmount < 256 * 1024) vws.send(out, () => {});
  }
}

/** Is this channel's picture still worth forwarding? */
function fresh(c) {
  return !!c.video && Date.now() - c.videoAt < VIDEO_TTL_MS;
}

/**
 * A PICTURE from the caster: one JPEG, forwarded to everyone watching that
 * channel and kept so a viewer tuning in has something the same instant.
 *
 * It is deliberately NOT part of the channel's liveness: `frameAt` (the
 * pose frame) is what keeps a channel on air, so a headset that cannot
 * make pictures — or stops being able to mid-bout — televises the diagram
 * instead of going dark.
 */
function onVideo(ws, msg, bytes) {
  const c = ws.channel && channels.get(ws.channel);
  if (!c) return;
  if (bytes > VIDEO_MAX) return;
  if (typeof msg.d !== 'string' || !msg.d) return;
  c.video = msg.d;
  c.videoAt = Date.now();
  const out = JSON.stringify({ t: 'v', id: c.id, d: c.video });
  for (const [vws, v] of viewers) {
    if (watching(v) !== c.id) continue;
    // A viewer who cannot keep up gets the next one instead of a backlog.
    if (vws.readyState === vws.OPEN && vws.bufferedAmount < 256 * 1024) vws.send(out, () => {});
  }
}

/* ── the tick: expiry, the LIVE post, the club feed ────────────────────── */

setInterval(() => {
  const now = Date.now();
  for (const c of [...channels.values()]) {
    if (now - c.frameAt > CHANNEL_TTL_MS) {
      endChannel(c.id, 'signal lost');
      continue;
    }
    if (!c.posted && POST_KINDS.has(c.kind) && now - c.since >= LIVE_POST_DELAY_MS) {
      c.posted = true;
      while (livePosts.length && now - livePosts[0] > LIVE_POST_WINDOW_MS) livePosts.shift();
      if (discordConfigured() && livePosts.length < LIVE_POST_MAX) {
        livePosts.push(now);
        c.live = true; // its FINAL follows only a LIVE that actually went out
        void postDiscord(liveCard({ kind: c.kind, title: c.title, names: c.names }));
      }
    }
  }
  // The club, for whoever is watching it (auto-tuned with nothing on air,
  // or pinned there). One snapshot per tick, however many viewers.
  let clubOut = null;
  for (const [ws, v] of viewers) {
    if (watching(v) !== 'club') continue;
    if (!clubOut) clubOut = JSON.stringify({ t: 'club', f: clubSnapshot() });
    if (ws.readyState === ws.OPEN && ws.bufferedAmount < 256 * 1024) ws.send(clubOut, () => {});
  }
  // The guide changes when the club's headcount does, too.
  broadcastGuide();
}, TICK_MS);

/* ── sockets ───────────────────────────────────────────────────────────── */

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('error', () => ws.terminate());
  ws.on('pong', () => {
    ws.isAlive = true;
  });
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'cast':
        openChannel(ws, msg);
        break;
      case 'f':
        onFrame(ws, msg, raw.length);
        break;
      case 'v':
        onVideo(ws, msg, raw.length);
        break;
      case 'cv':
        onClubVideo(ws, msg, raw.length);
        break;
      case 'end':
        if (ws.channel) endChannel(ws.channel, text(msg.result, 200));
        ws.channel = null;
        break;
      case 'watch': {
        const v = { tuned: null };
        viewers.set(ws, v);
        send(ws, { t: 'guide', ...guide() });
        const on = watching(v);
        const c = channels.get(on);
        if (c?.frame) send(ws, { t: 'f', id: c.id, kind: c.kind, f: c.frame });
        if (c && fresh(c)) send(ws, { t: 'v', id: c.id, d: c.video });
        if (!c && on === 'club') {
          send(ws, { t: 'club', f: clubSnapshot() });
          if (clubFresh()) send(ws, { t: 'cv', d: clubVideo.d });
        }
        break;
      }
      case 'tune': {
        const v = viewers.get(ws);
        if (!v) break;
        v.tuned = typeof msg.id === 'string' && channels.has(msg.id) ? msg.id : null;
        const on = watching(v);
        const c = channels.get(on);
        if (c?.frame) send(ws, { t: 'f', id: c.id, kind: c.kind, f: c.frame });
        if (c && fresh(c)) send(ws, { t: 'v', id: c.id, d: c.video });
        break;
      }
      case 'ping':
        send(ws, { t: 'pong', t0: msg.t0 });
        break;
      default:
        break;
    }
  });
  ws.on('close', () => {
    viewers.delete(ws);
    if (ws.channel) endChannel(ws.channel, '');
    // The floor's camera walked out; the map takes over again.
    if (clubVideo && clubVideo.ws === ws) clubVideo = null;
  });
});

// Heartbeat: cull dead sockets so a vanished caster's channel goes dark.
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

/* ── HTTP: the guide, and the bot's invite post ────────────────────────── */

const inviteByIp = new Map();
const inviteByCode = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (typeof fwd === 'string' ? fwd.split(',')[0].trim() : '') || req.socket?.remoteAddress || '?';
}

function readJson(req, max = 2048) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > max) {
        resolve(null);
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'));
      } catch {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

/** The SHARE button's post: validated, throttled, then handed to the bot. */
export async function postInvite({ code, mode, name, open }, ip = '?') {
  const c = String(code ?? '').replace(/\D/g, '').slice(0, 5);
  if (c.length !== 5) return { posted: false, reason: 'bad code' };
  const m = ['1v1', '2v2', 'ffa', 'raid'].includes(mode) ? mode : '1v1';
  const who = text(name, 16) || 'A BOXER';
  const seats = Math.max(0, Math.min(9, Number(open) || 0));
  const now = Date.now();
  // Forget throttle entries once they can't refuse anything any more, so
  // the maps don't grow for as long as the process lives.
  for (const [k, at] of inviteByIp) if (now - at >= INVITE_IP_GAP_MS) inviteByIp.delete(k);
  for (const [k, at] of inviteByCode) if (now - at >= INVITE_CODE_GAP_MS) inviteByCode.delete(k);
  // The IP comes from a header a client can write, so there's a ceiling
  // over everyone too.
  while (invitePosts.length && now - invitePosts[0] > LIVE_POST_WINDOW_MS) invitePosts.shift();
  if (invitePosts.length >= INVITE_POST_MAX) return { posted: false, reason: 'slow down' };
  if (now - (inviteByIp.get(ip) ?? 0) < INVITE_IP_GAP_MS) return { posted: false, reason: 'slow down' };
  if (now - (inviteByCode.get(c) ?? 0) < INVITE_CODE_GAP_MS) return { posted: false, reason: 'already posted' };
  inviteByIp.set(ip, now);
  inviteByCode.set(c, now);
  invitePosts.push(now);
  if (!discordConfigured()) return { posted: false, reason: 'bot off' };
  const ok = await postDiscord(inviteCard({ name: who, mode: m, code: c, open: seats }));
  return { posted: ok, reason: ok ? '' : 'discord refused' };
}

export function handleHttp(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // The stats page and the headset both call cross-origin.
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'content-type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  if (url.pathname === '/guide') {
    json(res, 200, { ...guide(), discord: discordWriteStatus() });
    return;
  }
  if (url.pathname === '/invite' && req.method === 'POST') {
    void readJson(req).then(async (body) => {
      if (!body) return json(res, 400, { posted: false, reason: 'bad body' });
      json(res, 200, await postInvite(body, clientIp(req)));
    });
    return;
  }
  json(res, 200, { tv: 'the-channel', channels: channels.size, viewers: viewers.size, discord: discordWriteStatus() });
}

if (isMain(import.meta.url)) {
  serve({ port: PORT, http: handleHttp, wss, onListen: () => console.log(`[tv] THE CHANNEL transmitting on :${PORT}`) });
}
