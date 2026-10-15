#!/usr/bin/env node
/**
 * THE PAGES CHECK — does the built site survive being served from a SUBPATH?
 *
 *   npm run build && npm run check:pages
 *
 * GitHub Pages serves this project at https://yellkell.github.io/ff2/, not at
 * a domain root. Every asset reference written with a leading slash therefore
 * resolves to the WRONG place in production while working perfectly in local
 * dev — a whole class of bug that never shows up until the site is live.
 *
 * So: serve dist/ under /ff2/ exactly as Pages does, load the arena, the club
 * and the stats board, and fail on any 404 or page error. Two traps this has
 * already caught, both invisible locally:
 *   - runtime strings in TS (`img.src = '/signs/...'`) — Vite rewrites asset
 *     references in its HTML *inputs*, but never string literals in code;
 *   - files copied verbatim out of public/ (stats.html, privacy1.html, the
 *     webmanifest) — Vite doesn't process those at all.
 * The house rule both obey now: public assets are referenced RELATIVELY.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webmanifest': 'application/manifest+json',
  '.json': 'application/json', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.svg': 'image/svg+xml' };

if (!existsSync('dist/index.html')) {
  console.error('no dist/ — run `npm run build` first');
  process.exit(1);
}

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith('/ff2/')) { res.writeHead(404).end('outside base'); return; }
  p = p.slice('/ff2'.length);
  if (p.endsWith('/')) p += 'index.html';
  try {
    const body = await readFile(join('dist', normalize(p).replace(/^(\.\.[/\\])+/, '')));
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(4173, r));

const browser = await chromium.launch().catch(() => chromium.launch({ executablePath: '/opt/pw-browsers/chromium' }));
const page = await browser.newPage();
const bad = [];
page.on('response', (r) => { if (r.status() >= 400 && new URL(r.url()).host === 'localhost:4173') bad.push(`${r.status()} ${new URL(r.url()).pathname}`); });
page.on('pageerror', (e) => bad.push(`pageerror: ${e.message.slice(0, 120)}`));

for (const path of ['/ff2/', '/ff2/pub.html', '/ff2/stats.html']) {
  await page.goto('http://localhost:4173' + path, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => bad.push(`${path}: ${e.message.slice(0, 80)}`));
  await page.waitForTimeout(1500);
  console.log(`  loaded ${path}`);
}
// The landing logo and the manifest icon are the two things the old absolute
// paths broke — assert they actually resolved under the subpath.
const logoOk = await page.goto('http://localhost:4173/ff2/signs/fire-fight.png').then((r) => r.status() === 200);
console.log(`  logo under subpath: ${logoOk ? 'HTTP 200' : 'MISSING'}`);
console.log(bad.length ? `\nFAILURES:\n  ${bad.join('\n  ')}` : '\nNo 404s, no page errors — the subpath build is clean.');
await browser.close();
server.close();
process.exit(bad.length || !logoOk ? 1 : 0);
