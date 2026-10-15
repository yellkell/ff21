/**
 * How a relay module stands on its own — or inside THE ROOM SERVER.
 *
 * Each relay (the FIRE FIGHT duel relay, the rave's room relay, the pub)
 * exports an HTTP handler and a `noServer` WebSocketServer, and nothing
 * else about it cares which socket it was reached through. Run directly,
 * a relay serves itself on its own port with serve(); imported by
 * room.mjs, the three share one port and are told apart by path.
 */

import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** True when `metaUrl`'s module is the one Node was asked to run. */
export function isMain(metaUrl) {
  try {
    return resolve(process.argv[1] ?? '') === fileURLToPath(metaUrl);
  } catch {
    return false;
  }
}

/** Serve one relay on its own port: every request to `http`, every
 *  upgrade to `wss`. */
export function serve({ port, http, wss, onListen }) {
  const server = createServer(http);
  // A client error with no listener is re-thrown as an uncaught exception.
  server.on('clientError', (_err, socket) => socket.destroy());
  server.on('upgrade', (req, socket, head) => {
    // A relay with no socket side (the bank) has nothing to upgrade to.
    if (!wss) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  server.listen(port, () => onListen?.(server));
  return server;
}
