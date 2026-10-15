/**
 * THE DISCORD BOT's WRITE PATH (DESIGN.md §8.2).
 *
 * The pub relay has polled a channel with a bot token for years (the bar
 * TV). This is the other direction: the same bot POSTS — a bell rung in
 * the club, a room hosted from the lobby, a match going LIVE on THE
 * CHANNEL, a final score. One module so the token lives in one place
 * and every post rides one queue, paced under Discord's rate limit and
 * backed off on a 429.
 *
 * Configure on the host (Render):
 *   DISCORD_BOT_TOKEN    the bot's token — the bot must be in the server
 *                        with Send Messages (and Embed Links) on the channel
 *   DISCORD_CHANNEL_ID   the channel to post into (defaults to the pub's)
 *   PUBLIC_URL           where the game is served, for the links in posts
 *                        (default https://ff2.web.app)
 *
 * Nothing here is required: with no token every post resolves false and
 * the games run exactly as before. GET / on the room server reports the
 * state under `discord`.
 */

export const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
export const DISCORD_CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || '1515843357060894762';
export const PUBLIC_URL = (process.env.PUBLIC_URL || 'https://ff2.web.app').replace(/\/+$/, '');

/** Minimum gap between two posts. Discord allows ~5/5 s per channel; one
 *  a second and a bit keeps a burst of bells well under it. */
const POST_GAP_MS = 1300;
/** A queue longer than this drops the OLDEST — stale news is no news. */
const QUEUE_MAX = 12;

const queue = [];
let draining = false;
let lastPostAt = 0;
let posted = 0;
let failed = 0;
let status = DISCORD_TOKEN ? 'ready' : 'off (no DISCORD_BOT_TOKEN)';

export function discordConfigured() {
  return Boolean(DISCORD_TOKEN);
}

/** What GET / shows: is the bot armed, how many posts went out, the last error. */
export function discordWriteStatus() {
  return { configured: discordConfigured(), channel: DISCORD_CHANNEL_ID, posted, failed, queued: queue.length, status };
}

/** The join link a room mints (DESIGN §8.1): one scheme for every code.
 *  A five-digit arena code boots the arena straight into the room; the
 *  club's four-digit room codes open the rave page's floor. */
export function joinLink(code) {
  const c = String(code ?? '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
  if (!c) return PUBLIC_URL + '/';
  return c.length === 4 ? `${PUBLIC_URL}/rave.html?room=${c}` : `${PUBLIC_URL}/?join=${c}`;
}

/** The TV's own link — THE CHANNEL on the stats page. */
export function tvLink() {
  return `${PUBLIC_URL}/stats.html#tv`;
}

/**
 * Queue one message. `payload` is a Discord create-message body — pass
 * `{ content }` or `{ embeds: [...] }`. Resolves true once it has been
 * accepted by Discord, false if the bot is off or the post failed.
 */
export function postDiscord(payload) {
  if (!DISCORD_TOKEN) return Promise.resolve(false);
  return new Promise((resolve) => {
    if (queue.length >= QUEUE_MAX) queue.shift()?.resolve(false);
    queue.push({ payload, resolve });
    void drain();
  });
}

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (queue.length) {
      const wait = lastPostAt + POST_GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      const job = queue.shift();
      lastPostAt = Date.now();
      job.resolve(await sendOnce(job.payload));
    }
  } finally {
    draining = false;
  }
}

async function sendOnce(payload, attempt = 0) {
  if (typeof fetch !== 'function') {
    status = 'error: this Node has no global fetch (need Node 18+)';
    return false;
  }
  try {
    const res = await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${DISCORD_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status === 429 && attempt < 2) {
      // Discord says how long; obey it once or twice, then give the post up.
      let retry = 2;
      try {
        retry = Number((await res.json())?.retry_after) || 2;
      } catch {
        /* no body — the default holds */
      }
      status = `rate limited — retrying in ${retry}s`;
      await sleep(retry * 1000 + 100);
      return sendOnce(payload, attempt + 1);
    }
    if (!res.ok) {
      failed += 1;
      const hint =
        res.status === 401 ? 'bad token'
        : res.status === 403 ? 'bot lacks Send Messages / Embed Links on the channel'
        : res.status === 404 ? 'channel id not found'
        : '';
      status = `http ${res.status}${hint ? ` — ${hint}` : ''}`;
      return false;
    }
    posted += 1;
    status = `ok — ${posted} posted`;
    return true;
  } catch (err) {
    failed += 1;
    status = `error: ${err?.message || err}`;
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── the house style: one embed shape for every card ──────────────────── */

const MODE_LABEL = { '1v1': '1V1', '2v2': '2V2', ffa: 'FFA', raid: 'TITAN RAID', rave: 'RAVE', solo: 'SOLO' };
const AMBER = 0xffb02e;
const MAGENTA = 0xff3df0;
const RED = 0xff4b3e;

export function modeLabel(mode) {
  return MODE_LABEL[mode] ?? String(mode ?? '').toUpperCase();
}

/** A card: bold title, a line or two, an optional link row, house colour. */
export function card({ title, lines = [], url, color = AMBER, footer }) {
  const embed = { title: String(title).slice(0, 240), color };
  const body = lines.filter(Boolean).join('\n');
  if (body) embed.description = body.slice(0, 2000);
  if (url) embed.url = url;
  if (footer) embed.footer = { text: String(footer).slice(0, 120) };
  return { embeds: [embed] };
}

/** THE BELL rang in the club: who, what, how to get in, how long is left. */
export function bellCard({ name, mode, hardcore, code, clubCode, seconds, floor }) {
  const fight = mode !== 'rave';
  const link = fight ? joinLink(code) : joinLink(clubCode);
  return card({
    title: fight ? `🔔 ${name} rang the bell — ${modeLabel(mode)}${hardcore ? ' · HARDCORE' : ''}` : `💿 ${name} put a record on`,
    lines: [
      fight ? `Touch in from the club floor, or join the arena room from here:` : `Join the floor and touch the ball:`,
      link,
      seconds ? `The ball hangs for **${seconds}s**.` : '',
      floor ? `${floor} on the floor.` : '',
    ],
    url: link,
    color: fight ? AMBER : MAGENTA,
    footer: 'FIRE FIGHT 2 · THE CLUB',
  });
}

/** A room hosted from the lobby, shared on purpose (the SHARE button). */
export function inviteCard({ name, mode, code, open }) {
  const link = joinLink(code);
  return card({
    title: `🥊 ${name} is holding a ${modeLabel(mode)} room`,
    lines: [`Code **${code}** — ${open ? `${open} seat${open === 1 ? '' : 's'} open` : 'seats open'}.`, link],
    url: link,
    footer: 'FIRE FIGHT 2 · type the code on the lobby keypad, or tap the link in your headset',
  });
}

/** THE CHANNEL: a match went live. */
export function liveCard({ kind, title, names }) {
  const link = tvLink();
  return card({
    title: `🔴 LIVE — ${modeLabel(kind)}: ${title}`,
    lines: [names?.length ? names.join(' · ') : '', `Watch it on THE CHANNEL: ${link}`],
    url: link,
    color: RED,
    footer: 'FIRE FIGHT 2 · THE CHANNEL',
  });
}

/** THE CHANNEL: how it ended. */
export function finalCard({ kind, title, result }) {
  return card({
    title: `🏁 FINAL — ${modeLabel(kind)}: ${title}`,
    lines: [result || ''],
    url: tvLink(),
    footer: 'FIRE FIGHT 2 · THE CHANNEL',
  });
}
