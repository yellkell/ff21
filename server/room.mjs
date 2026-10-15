/**
 * THE ROOM SERVER — FIRE FIGHT 2's one relay process (DESIGN.md §3.3).
 *
 * Three relays, one port, told apart by path:
 *
 *   /rave   the rave's room relay: the club floor, THE BELL's clock and
 *           deal, the dumbwaiter, prop brokering, voice   (rave.mjs)
 *   /pub    the Iron Balls pub: punters, props, the bar TV (pub.mjs)
 *   /ff     the FIRE FIGHT duel relay: quick-match + message relay
 *           (index.mjs) — also answered at / for clients from before
 *           the paths existed
 *   /tv     THE CHANNEL: match casters in, web viewers out, the club's
 *           public floor when nothing is on, the bot's invite post (tv.mjs)
 *
 * Nothing about a relay changes by being mounted here: each keeps its
 * own rooms, clocks and heartbeat, and each still runs alone under its
 * own npm script (server:ff, server:rave, server:pub) on its old port.
 * The health page at / lists all three.
 *
 *   npm run server            # listens on :8787 (or PORT=…)
 */

import { isMain, serve } from './mount.mjs';
import { handleHttp as ffHttp, wss as ffWss } from './index.mjs';
import { handleHttp as pubHttp, wss as pubWss } from './pub.mjs';
import { handleHttp as raveHttp, wss as raveWss } from './rave.mjs';
import { handleHttp as tvHttp, wss as tvWss } from './tv.mjs';
import { handleHttp as bankHttp } from './bank.mjs';
import { discordWriteStatus } from './discord.mjs';

const PORT = Number(process.env.PORT || 8787);

const RELAYS = [
  { path: '/rave', name: 'dance-raid', http: raveHttp, wss: raveWss },
  { path: '/pub', name: 'iron-balls-pub', http: pubHttp, wss: pubWss },
  { path: '/ff', name: 'fire-fight', http: ffHttp, wss: ffWss },
  { path: '/tv', name: 'the-channel', http: tvHttp, wss: tvWss },
  // THE BANK: iron-dollars for money — HTTP only, no socket (bank.mjs).
  { path: '/bank', name: 'the-bank', http: bankHttp, wss: null },
];

/** Which relay a URL belongs to, and the URL with its prefix stripped
 *  (so a relay mounted at /pub still sees /token as /token). */
function route(url) {
  const path = url.split('?')[0];
  for (const relay of RELAYS) {
    if (path === relay.path || path.startsWith(`${relay.path}/`)) {
      const rest = url.slice(relay.path.length);
      return { relay, url: rest.startsWith('/') || rest === '' ? rest || '/' : `/${rest}` };
    }
  }
  return null;
}

function handleHttp(req, res) {
  const hit = route(req.url ?? '/');
  if (hit) {
    req.url = hit.url;
    req.mountPath = hit.relay.path; // so a relay can spell its own links
    hit.relay.http(req, res);
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ room: 'fire-fight-2', relays: RELAYS.map((r) => ({ path: r.path, name: r.name })), discord: discordWriteStatus() }));
}

if (isMain(import.meta.url)) {
  // The last line of defence. Every relay and the bank share this process,
  // so one throw nobody caught — a malformed message, a Firestore blip in an
  // async handler — used to end every live match and stop the bank. Log it
  // and keep serving: a relay's state is per-room and a bad message's room
  // is the one that pays, not the town.
  process.on('unhandledRejection', (err) => console.error('[room] unhandled rejection', err));
  process.on('uncaughtException', (err) => console.error('[room] uncaught exception', err));

  const server = serve({
    port: PORT,
    http: handleHttp,
    // The root upgrade path is the duel relay's, for clients that dial
    // the port bare.
    wss: ffWss,
    onListen: () => console.log(`[room] FIRE FIGHT 2 room server on :${PORT} — ${RELAYS.map((r) => r.path).join(' ')}`),
  });
  server.removeAllListeners('upgrade');
  server.on('upgrade', (req, socket, head) => {
    const hit = route(req.url ?? '/');
    const wss = hit ? hit.relay.wss : ffWss;
    if (!wss) {
      socket.destroy(); // an HTTP-only relay (the bank) has no socket side
      return;
    }
    if (hit) req.url = hit.url;
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
}
