#!/usr/bin/env node
/**
 * THE STATS SHELF CHECK — does the stats page list every raid record?
 *
 *   npm run check:stats-tracks
 *
 * public/stats.html is copied verbatim into the site (Vite never touches
 * it), so it can't import the record box and keeps its own RR_TRACKS list.
 * That copy fell behind once — PASSION and FINAL were on the shelf for a
 * day with no board on the page. This reads both files as text and fails
 * on any raid record the page is missing, any title that disagrees, or
 * any id the page lists that is no longer on the shelf. No browser, no
 * server: it runs in CI beside the typecheck.
 */
import { readFileSync } from 'node:fs';

const tracksSrc = readFileSync('src/rave/audio/tracks.ts', 'utf8');
const statsSrc = readFileSync('public/stats.html', 'utf8');

// Each TRACKS row opens with `  {` on its own line; comments inside a row
// never start a line with that, so splitting there is safe.
const body = tracksSrc.slice(tracksSrc.indexOf('export const TRACKS'));
const shelf = new Map();
for (const row of body.split(/\n  \{\n/).slice(1)) {
  const id = row.match(/\bid: '([^']+)'/)?.[1];
  const title = row.match(/\btitle: '([^']+)'/)?.[1];
  const roles = row.match(/\broles: \[([^\]]*)\]/)?.[1] ?? '';
  if (id && title && /'raid'/.test(roles)) shelf.set(id, title);
}

const listSrc = statsSrc.match(/const RR_TRACKS = \[([\s\S]*?)\];/)?.[1];
if (!listSrc) {
  console.error('FAIL  no RR_TRACKS list in public/stats.html');
  process.exit(1);
}
const page = new Map([...listSrc.matchAll(/\['([^']+)',\s*'([^']+)'\]/g)].map((m) => [m[1], m[2]]));

const fails = [];
for (const [id, title] of shelf) {
  if (!page.has(id)) fails.push(`missing from the stats page: ['${id}', '${title}']`);
  else if (page.get(id) !== title) fails.push(`title differs for ${id}: page '${page.get(id)}', shelf '${title}'`);
}
for (const id of page.keys()) if (!shelf.has(id)) fails.push(`on the stats page but not on the raid shelf: ${id}`);

if (shelf.size < 10) fails.push(`only read ${shelf.size} raid records out of tracks.ts — has its layout changed?`);
for (const f of fails) console.log(`  FAIL  ${f}`);
console.log(fails.length ? `\n${fails.length} FAILURE(S)` : `ALL PASS — ${shelf.size} raid records, all on the stats page`);
process.exit(fails.length ? 1 : 0);
