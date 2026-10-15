/**
 * publish-gazette.mjs — files the finished edition.
 *
 * Usage:  node scripts/publish-gazette.mjs <article.json>
 *
 * Takes the day's finished edition (written by the scheduled Claude task
 * from the ladder brief — docs/gasket-gazette.md) and:
 *   1. writes it to Firestore `gazette/latest` with a bumped edition number
 *      and a publish timestamp — the lobby reads this and lights the red dot;
 *   2. rolls `gazette/_snapshot` forward to the CURRENT standings, so the
 *      next `ladder-brief.mjs` run diffs against today, not last week.
 *
 * The article JSON must have: headline, subhead, body. Optional: byline
 * (defaults to "The Gazette Desk"), dateline (auto-built if absent), and the
 * page's three sections — `stats` (BY THE NUMBERS), `records` (THE RECORD
 * BOOK) and `todo` (WHAT TO DO TODAY). Sizes match src/net/gazette.ts
 * GAZETTE_LIMITS, which is what the lobby page lays out.
 *
 * WRITES AS AN ADMIN, and has to. `gazette/latest` is what every player reads
 * on the lobby wall, so the security rules make it read-only to clients —
 * `allow write: if false` — and no web API key will get past that, by design.
 * The front page is not a thing a player gets to edit.
 *
 * So this script authenticates with a SERVICE ACCOUNT, which the Admin SDK
 * runs under and which the rules do not apply to. Point it at one with either:
 *
 *   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json   (a file), or
 *   FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'  (the JSON
 *                                                    itself — for CI secrets)
 *
 * Generate one in the Firebase console under Project settings → Service
 * accounts → Generate new private key. Never commit it.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const PROJECT_ID = 'flappy-ff9f6';

/** Resolve a service account from either supported source, or explain what's
 *  missing rather than failing with a bare PERMISSION_DENIED at the write. */
function credentials() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) {
    try {
      return cert(JSON.parse(inline));
    } catch {
      console.error('FIREBASE_SERVICE_ACCOUNT is set but is not valid JSON.');
      process.exit(1);
    }
  }
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    try {
      return cert(JSON.parse(readFileSync(path, 'utf8')));
    } catch {
      console.error(`GOOGLE_APPLICATION_CREDENTIALS points at ${path}, which could not be read as JSON.`);
      process.exit(1);
    }
  }
  console.error(
    [
      'No service account. The gazette is admin-written by design — the rules make',
      'gazette/latest read-only to clients. Set FIREBASE_SERVICE_ACCOUNT (the JSON)',
      'or GOOGLE_APPLICATION_CREDENTIALS (a path to it). See docs/gasket-gazette.md.',
    ].join('\n'),
  );
  process.exit(1);
}

const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/publish-gazette.mjs <article.json>');
  process.exit(1);
}

const article = JSON.parse(readFileSync(file, 'utf8'));
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
for (const field of ['headline', 'body']) {
  if (!article[field] || typeof article[field] !== 'string') fail(`article is missing a string "${field}"`);
}
if (article.headline.length > 70) fail(`headline is ${article.headline.length} characters — keep it under 70`);

// The page's sections. Each is a list of small objects with capped string
// fields — the same caps the lobby reader applies (src/net/gazette.ts
// GAZETTE_LIMITS), checked here so an over-long field is caught at the desk
// rather than silently clipped on the page.
const str = (v) => (typeof v === 'string' ? v.trim() : '');
function section(name, max, fields, required) {
  const v = article[name];
  if (v === undefined) return [];
  if (!Array.isArray(v)) fail(`"${name}" must be a list`);
  if (v.length > max) fail(`"${name}" has ${v.length} entries — the page fits ${max}`);
  return v.map((item, i) => {
    const row = {};
    for (const [k, cap] of Object.entries(fields)) {
      row[k] = str(item?.[k]);
      if (row[k].length > cap) fail(`${name}[${i}].${k} is ${row[k].length} characters — the page fits ${cap}`);
    }
    if (!row[required]) fail(`${name}[${i}] needs a "${required}"`);
    return row;
  });
}
const stats = section('stats', 4, { label: 24, value: 12 }, 'value');
const records = section('records', 6, { feat: 40, time: 12, who: 60 }, 'feat');
const todo = section('todo', 5, { title: 36, text: 180 }, 'title');
if (!todo.length) fail('an edition needs at least one WHAT TO DO TODAY item — telling readers what they can do is the point of the paper');
for (const old of ['mood', 'wanted', 'notice', 'weather']) {
  if (article[old] !== undefined) fail(`"${old}" belongs to the old Sheriff format and is no longer printed — see docs/gasket-gazette.md`);
}
const byline = str(article.byline).slice(0, 40) || 'The Gazette Desk';

const db = getFirestore(
  getApps().length ? getApps()[0] : initializeApp({ credential: credentials(), projectId: PROJECT_ID }),
);

// Bump the edition off whatever's currently live.
const latestSnap = await db.doc('gazette/latest').get();
const edition = ((latestSnap.exists && latestSnap.data().edition) || 0) + 1;

const today = new Date();
// Just the date — the page template already prints "GASKET COVE" in the
// masthead, so the dateline strip stays short.
const dateline =
  article.dateline ||
  today.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

await db.doc('gazette/latest').set({
  edition,
  dateline,
  headline: article.headline,
  subhead: article.subhead ?? '',
  body: article.body,
  byline,
  stats,
  records,
  todo,
  publishedAt: FieldValue.serverTimestamp(),
});

// Archive a copy to the repo (gazette-archive/) — Firestore only keeps `latest`,
// so this is the permanent record of every edition. Committed by the gazette task.
{
  const n = String(edition).padStart(3, '0');
  mkdirSync('gazette-archive', { recursive: true });
  const record = {
    edition,
    dateline,
    headline: article.headline,
    subhead: article.subhead ?? '',
    body: article.body,
    byline,
    stats,
    records,
    todo,
  };
  writeFileSync(`gazette-archive/no-${n}.json`, JSON.stringify(record, null, 2) + '\n');
  const numbers = stats.length ? `\n\n**By the numbers:** ${stats.map((s) => `${s.value} ${s.label.toLowerCase()}`).join(' · ')}` : '';
  const book = records.length
    ? `\n\n### The record book\n\n${records.map((r) => `- **${r.feat}** — ${r.time}${r.who ? ` — ${r.who}` : ''}`).join('\n')}`
    : '';
  const whatToDo = todo.length
    ? `\n\n### What to do today\n\n${todo.map((t, i) => `${i + 1}. **${t.title}.** ${t.text}`).join('\n')}`
    : '';
  const md = `# The Gasket Gazette — No. ${edition}\n\n**${dateline}**\n\n## ${record.headline}\n\n*${record.subhead}*${numbers}\n\n${record.body}\n\n— ${byline}${book}${whatToDo}\n`;
  writeFileSync(`gazette-archive/no-${n}.md`, md);
}

// Roll the snapshot forward to today's standings for tomorrow's diff.
const playersSnap = await db.collection('players').orderBy('xp', 'desc').limit(80).get();
const standings = playersSnap.docs.map((d) => {
  const x = d.data();
  return {
    uid: d.id,
    name: x.name ?? '???',
    xp: x.xp ?? 0,
    elo: x.elo ?? 1000,
    score: x.score ?? 0,
    duo: x.duo ?? 0,
    ffa: x.ffa ?? 0,
  };
});
await db.doc('gazette/_snapshot').set({
  edition,
  capturedAt: FieldValue.serverTimestamp(),
  players: standings,
});

console.log(`Filed edition No. ${edition} — "${article.headline}" (${standings.length} players snapshotted).`);
// Firestore's gRPC channel keeps the event loop alive; exit explicitly.
process.exit(0);
