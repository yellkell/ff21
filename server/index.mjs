/**
 * FIRE FIGHT relay server — minimal WebSocket matchmaking + message relay.
 *
 * Protocol (JSON):
 *   client → server: {t:'queue'} | {t:'cancel'} | {t:'msg', d:{...}}
 *   server → client: {t:'waiting'} | {t:'matched', side:0|1}
 *                  | {t:'peer-left'} | {t:'msg', d:{...}}
 *
 * Quick-match pairs the two longest-waiting players into a room and relays
 * `msg` envelopes between them verbatim. No game logic lives here — the
 * clients rule on hits themselves (victim-authoritative) and the host client
 * owns the match state. That keeps this server tiny, stateless per message,
 * and trivially hostable anywhere Node runs.
 *
 *   npm run server:ff       # alone, on :8787 (or PORT=...)
 *   npm run server          # inside THE ROOM SERVER (room.mjs), at /ff
 *
 * Point clients at it with  ?server=wss://your-host:8787  (or ws:// in dev).
 */

import { WebSocketServer } from 'ws';
import { isMain, serve } from './mount.mjs';

const PORT = Number(process.env.PORT || 8787);

/** A friendly health/status endpoint for load balancers and curiosity. */
export function handleHttp(req, res) {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ game: 'fire-fight', queue: queue.length, rooms: rooms.size }));
}

/**
 * Frames are small JSON envelopes (a pose is ~150 bytes). `ws` defaults to a
 * 100 MiB cap, which lets one client park a huge allocation on the relay for
 * everybody else's bout; 64 KiB is miles above anything the game sends.
 */
const MAX_PAYLOAD = 64 * 1024;
/**
 * Stop relaying to a peer whose socket is backed up this far. A realtime game
 * wants the NEWEST state, not a faithful replay of a stalled minute — without
 * this, `send` queues without limit and a peer on bad Wi-Fi grows the relay's
 * memory until it dies.
 */
const MAX_BUFFERED = 512 * 1024;

export const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD });

// An 'error' event on a socket with no listener is re-thrown as an uncaught
// exception — a single ECONNRESET (a headset dropping off Wi-Fi mid-bout) took
// the whole relay down with it, and every live match with it. Same for the
// server itself.
wss.on('error', (err) => console.error('[fire-fight] server error', err));

/** Sockets waiting for an opponent, oldest first. */
let queue = [];
/** socket → { peer, room } for live bouts. */
const rooms = new Map();
let nextRoomId = 1;

function send(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  // Drop rather than queue for a backed-up peer (see MAX_BUFFERED). Match
  // control messages are cheap and rare, so let those through regardless —
  // it's the pose firehose that must yield.
  if (ws.bufferedAmount > MAX_BUFFERED && obj.t === 'msg') return;
  ws.send(JSON.stringify(obj), (err) => {
    if (err) ws.terminate();
  });
}

function leaveQueue(ws) {
  queue = queue.filter((q) => q !== ws);
}

function endRoom(ws, notifyPeer = true) {
  const entry = rooms.get(ws);
  if (!entry) return;
  rooms.delete(ws);
  rooms.delete(entry.peer);
  if (notifyPeer) send(entry.peer, { t: 'peer-left' });
}

function tryMatch() {
  while (queue.length >= 2) {
    const a = queue.shift();
    const b = queue.shift();
    if (a.readyState !== a.OPEN) {
      if (b) queue.unshift(b);
      continue;
    }
    if (b.readyState !== b.OPEN) {
      queue.unshift(a);
      continue;
    }
    const room = nextRoomId++;
    rooms.set(a, { peer: b, room });
    rooms.set(b, { peer: a, room });
    send(a, { t: 'matched', side: 0 }); // first in queue hosts
    send(b, { t: 'matched', side: 1 });
    console.log(`[fire-fight] room ${room} matched (queue ${queue.length})`);
  }
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  // Required: an unhandled socket 'error' crashes the process (see above).
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
    // `null`, a number or a bare string parse fine and have no `.t` to read:
    // without this, the text `null` threw here and took the whole room
    // server (every relay, and the bank) down with it.
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'queue':
        // Re-queueing from inside a room means this client left the bout
        // without telling us (a reload, say). Close the old room first, so the
        // stale peer is notified instead of talking to a socket that has
        // already moved on.
        if (rooms.has(ws)) endRoom(ws);
        if (!queue.includes(ws)) {
          queue.push(ws);
          send(ws, { t: 'waiting' });
          tryMatch();
        }
        break;
      case 'cancel':
        leaveQueue(ws);
        endRoom(ws);
        break;
      case 'msg': {
        const entry = rooms.get(ws);
        if (entry) send(entry.peer, { t: 'msg', d: msg.d });
        break;
      }
    }
  });

  ws.on('close', () => {
    leaveQueue(ws);
    endRoom(ws);
  });
});

// Heartbeat: cull dead sockets so queues and rooms never wedge.
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
  serve({ port: PORT, http: handleHttp, wss, onListen: () => console.log(`[fire-fight] relay listening on :${PORT}`) });
}
