# The Gasket Gazette

The game's daily newspaper. Every day a scheduled Claude task reads the
boards and files an edition: what happened, the records on the boards, and
**what readers can go and do today**. It lands on the NEWS tab of the lobby's
left wing, which wears a **red dot** until you've read the latest edition.

It used to be written in character, by a sheriff who hated the players, in
a beach-town vocabulary that renamed everything in the game. That's gone.
The paper keeps its name and its newsprint look, and now it just tells people
what's going on and what they can do about it.

## The page

Top to bottom, the lobby lays out:

| Section | Field | What it is |
| --- | --- | --- |
| Headline | `headline` | The day's biggest fact, under 70 characters. Capitals on the page. |
| Subhead | `subhead` | One sentence that adds to the headline, not a repeat of it. |
| **By the numbers** | `stats[]` | Up to 4 `{ value, label }` figures: `{ "value": "37", "label": "games played" }`. |
| Body | `body` | 2–4 short paragraphs, blank-line separated. |
| Byline | `byline` | Defaults to "The Gazette Desk". |
| **The record book** | `records[]` | Up to 6 `{ feat, time, who }`: the hardest clears on the boards. |
| **What to do today** | `todo[]` | 1–5 `{ title, text }`: things a reader can go and do. At least one is required. |

Sizes (enforced by `scripts/publish-gazette.mjs`, mirrored by
`src/net/gazette.ts` `GAZETTE_LIMITS`): stat label 24 / value 12; record
feat 40 / time 12 / who 60; todo title 36 / text 180.

A newcomer's first visit shows the built-in **welcome edition**
(`WELCOME_EDITION` in `src/net/gazette.ts`), a guide to every mode, what it
pays and where the scores go. It also stands in whenever nothing has been filed.

## The style guide

**Write like a good sports desk.** Plain, specific, short sentences.
Name the players (callsigns in capitals, as the game shows them), give the
numbers, say why it matters. Skip the gimmick voice, the invented vocabulary
and the in-jokes. Use the game's own names for things: ranked, 2v2, free for
all, speedrun, titan raid, GOOPLIATH, hardcore, blazing, the club, the store.

**Lead with the most impressive thing.** A harder feat beats a faster time.
A first-ever BLAZING HARDCORE raid clear is the headline even if it took
twenty minutes; a quicker NORMAL speedrun is a paragraph further down. The
order of impressiveness is difficulty first (BLAZING > HARD > NORMAL), then
HARDCORE (no healing between bosses) above the same difficulty without it.

**Every edition tells people what they can do.** `todo` is the point of the
paper. Make each item concrete and reachable from the menu, and give the
path where it helps (`VERSUS › CO-OP RAID`). The lobby's paths are CAREER
(the campaign), VERSUS › QUICK MATCH / RANKED / CUSTOM GAMES / 2V2 / FREE FOR
ALL / CO-OP RAID / AIM TRAINING / TUTORIAL, RAVE RAID, CLUB, RANKINGS, NEWS,
LOCKER › CUSTOMIZE and STORE. The menus never say "bots". Good sources, all in
the brief:

- an **open feat** nobody has cleared yet ("Nobody has beaten the titan raid
  on BLAZING HARDCORE. Get a squad of up to five together and take the first
  record.");
- a **thin board** where a podium place is there for the taking;
- the **season clock** ("Season 1 closes in 8 days. The top 25 keep a trophy.");
- a record that just fell and can be taken back;
- when it's quiet, the basics: the tutorial, aim training, the club.

**Don't send readers to RANKED.** Results from the ladder can be reported,
but `todo` never suggests a ranked fight. Point people at the campaign first
(`CAREER`), then QUICK MATCH (`VERSUS › QUICK MATCH`).

**The Quest Store notice is built in.** The NEWS page leads every edition with
a standing TOP STORY, FIRE FIGHT 2 IS NOW ON THE QUEST STORE, above the
edition's own headline, so an edition never needs to announce it.

**Never punch down.** The brief only reports climbers and clears. Nobody who
dropped places or lost is named. The game never records a failed run, so
don't imply one.

**Get the numbers right.** XP, ladder points and 2v2 / FFA points are
*points*, not match counts. The only games-played figure is `gamesApprox`,
and it's an estimate. Don't invent figures the brief doesn't give you.

**Quiet days still get an edition.** Lead with the standing records and the
season race, and make `todo` do the work: the open feats are always there.

### Example

```json
{
  "headline": "FIRST BLAZING HARDCORE TITAN RAID FALLS TO VOLTAIRE'S SQUAD",
  "subhead": "Four players beat all five titans with no healing between bosses, a feat nobody had managed.",
  "stats": [
    { "value": "37", "label": "games played" },
    { "value": "3", "label": "new records" },
    { "value": "8", "label": "days left in season" }
  ],
  "body": "VOLTAIRE, GRINDR, PUMPKIN and REDWOLF9 cleared the titan raid on BLAZING HARDCORE in 18:42.1, the first time anyone has finished it. Hardcore means no healing between bosses, so the squad went into GOLIATH carrying every hit from the four titans before him.\n\nOn the ranked ladder, REDWOLF9 climbed six places and now sits third for the season, 40 points behind the leader with eight days to play.\n\nThe NORMAL speedrun record changed hands twice. CRYSTALZACH holds it at 0:46.3.",
  "records": [
    { "feat": "TITAN RAID · BLAZING · HARDCORE", "time": "18:42.1", "who": "VOLTAIRE · GRINDR · PUMPKIN · REDWOLF9" },
    { "feat": "SPEEDRUN · HARD", "time": "2:10.8", "who": "YK1" },
    { "feat": "SPEEDRUN · NORMAL", "time": "0:46.3", "who": "CRYSTALZACH" }
  ],
  "todo": [
    { "title": "Take the first blazing speedrun", "text": "Nobody has finished the campaign on BLAZING. CAREER, set BLAZING, and the record is yours." },
    { "title": "Try a quick match", "text": "VERSUS › QUICK MATCH. You fight straight away while it finds you a real opponent." },
    { "title": "Get on the GOOPLIATH board", "text": "Only two squads have cleared GOOPLIATH on HARD. A third clear puts you on the podium." }
  ]
}
```

## How it fits together

```
 scheduled Claude task (daily)
   └─ /daily-gazette  (.claude/commands/daily-gazette.md)
        1. node scripts/ladder-brief.mjs    → reads Firestore `players`,
           every run board, diffs `gazette/_snapshot`, prints a JSON brief:
           climbers and the busiest (never fallers), the season race, the
           RECORD BOOK (the holder of every feat), clears since the last
           edition and where they placed, OPEN FEATS nobody has cleared and
           THIN BOARDS with a podium spot going
        2. Claude writes the edition to the style guide above
        3. node scripts/publish-gazette.mjs → validates it, writes
           `gazette/latest` (edition bumped, publish timestamp), rolls
           `_snapshot` forward, archives a copy under gazette-archive/

 game client (lobby)
   └─ src/net/gazette.ts   reads `gazette/latest`, tracks unread vs a
                           localStorage "seen edition"; the welcome edition
   └─ src/menu/menu.ts     lays out the front page
   └─ src/menu/wrap.ts     the NEWS tab (red dot) blits it
```

Because delivery is a **live Firestore doc** (not a committed file), a new
edition appears the next time a player lands in the lobby — no rebuild or
redeploy — which is what lets the tab show the "new edition" dot.

### Feats and the run boards

Every timed run is filed under a **feat**: mode × difficulty × hardcore.
Each feat has its own board (`src/net/boards.ts` `runBoard`), so a slow
BLAZING HARDCORE clear is never pushed off by a faster NORMAL one:

```
ff2-speedrun-<tier>-time      ff2-speedrun-<tier>-hc-time
ff2-raid-<tier>-time          ff2-raid-<tier>-hc-time
ff2-goopliath-<tier>-time
```

A hardcore run also posts to its tier's plain board. The legacy mixed boards
(`ff2-raid-time`, `ff2-goopliath-time`) are still written and read, filed
under each row's own feat, so older runs keep counting. The lobby's RANKINGS
› ARCADE boards and `stats.html` both open on a **FEATS** view (everyone's
hardest clear, hardest first) with per-difficulty and hardcore filters.

## Firestore data

- `gazette/latest` — the live edition the game reads:
  `{ edition, dateline, headline, subhead, body, byline, stats[], records[],
  todo[], publishedAt }`. (Editions filed before the rewrite also carry
  `mood` / `wanted` / `notice` / `weather`; the reader ignores them.)
- `gazette/_snapshot` — internal generator state: the ladder standings as of
  the last published edition, used to compute "what changed" for the next one.

### Credentials

The two halves of the task authenticate differently, and deliberately so.

**`ladder-brief.mjs` reads, and needs nothing.** Everything it touches is
world-readable under the shipped rules: `players`, `gazette/_snapshot`, and
every run board. It runs on the public web config.

**`publish-gazette.mjs` writes, and needs a service account.** `gazette/latest`
is what every player reads off the lobby wall, so the rules make it read-only
to clients (`allow write: if false`) — a web API key will not get past that,
which is the point. The publisher uses the Admin SDK instead, which service
accounts run under and the rules do not apply to.

Point it at a key with either:

```bash
export FIREBASE_SERVICE_ACCOUNT='{"type":"service_account", ...}'
```

or

```bash
export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
```

Generate one in the Firebase console under **Project settings → Service
accounts → Generate new private key**. It is a real credential — never commit
it, and prefer the env var over a file on a shared machine.

### The rules it relies on

Shipped in `firestore.rules`; nothing extra to add.

```
// The paper reads the ladder to write the edition. World-readable.
match /players/{uid} { allow read: if true; }

// The edition the game reads + the generator's snapshot state.
// Admin-written, client-read-only.
match /gazette/{doc} {
  allow read: if true;
  allow write: if false;
}

// The run boards the paper reports on. World-readable; a player may only
// write their OWN row, and only to improve it.
match /boards/{board}/rows/{uid} { allow read: if true; ... }
```

(Hackathon-grade, matching the existing `lobbies` / `arcadeRooms` rules —
tighten with App Check before a big public release.)

The Firebase web API key in the scripts is a public identifier, not a
secret (the same one shipped in `src/net/firebaseConfig.ts`); access is
governed entirely by these rules.

## Setting up the daily schedule

The article generation is meant to run as a **Claude scheduled task** (Claude
Code on the web). This repo ships everything the task needs; you wire the
schedule itself in the Claude Code web app:

1. Create a scheduled session/trigger on this repository (branch
   `claude/fire-fight-ui-gameplay-1zrr9b`, or wherever this lands).
2. Set it to run roughly once a day.
3. Set the prompt to: **`/daily-gazette`**
4. Make sure the environment's **network policy allows outbound HTTPS to
   Firebase/Google APIs** (the scripts read and write Firestore).

That's it — each run reads the ladder, writes the day's edition, and the dot
lights up for every player.

## Running it by hand

```
node scripts/ladder-brief.mjs            # see today's wire report
# ...write /tmp/gazette.json to the style guide above...
node scripts/publish-gazette.mjs /tmp/gazette.json
```
