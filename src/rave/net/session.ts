/**
 * Online session — thin client for the room relay (server/index.mjs).
 *
 * The deterministic-choreography model keeps this tiny: the server's only
 * real jobs are seats, the seed, and a shared "beat 0 lands in N ms". After
 * that the wire carries poses (10 Hz) and score reports (3 Hz); every client
 * runs the identical show from the seed. Empty seats become groupies,
 * identical on every client.
 *
 * THE CLUB made the room a PLACE, so the session now carries a social layer
 * too — and a room OUTLIVES its sets:
 *
 *  - While the room is on the club floor (hosting/joined), everyone streams
 *    a club pose ('cp', world space, keyed by member idx) and binary VOICE
 *    frames ride the same socket (see src/club/voice.ts for the format).
 *  - 'start' flips the room to a live set; when the set resolves the host
 *    sends 'end' and everyone lands back in the club together, same code,
 *    same members, ready to go again. Leaving is a button, not a side
 *    effect of the music stopping.
 *  - The host can leave without folding the party: the relay promotes the
 *    longest-standing member and tells them with a fresh 'room' message.
 *
 * Join by code — four DIGITS, typed on the board's keypad — or by URL:
 * ?room=4096&name=YELL.
 */

import { NET, seatHue, serverUrl } from '../config.js';
import { raveBridge } from '../bridge.js';
import { bellView, isFightMode, type BellMode, type DealtMember, type FightDeal } from '../club/bell.js';
import { CURRENCY, DIFFICULTY_ORDER } from '../../config.js';
import { addCoins, coins } from '../../menu/wallet.js';
import { audioContext, ensureAudio } from '../audio/sfx.js';
import { clearVoiceSpeakers, removeVoiceSpeaker, stopVoiceCapture } from '../club/voice.js';
import { startRaid } from '../game/flow.js';
import { dancerAtSeat, match } from '../game/state.js';
import { clearClubPoses, clearCoursePoses, clubPoses, coursePoses, remotePoses } from './poses.js';

export type NetPhase = 'off' | 'connecting' | 'hosting' | 'joined' | 'live' | 'error';

/** Room codes are DIGITS. Four of them — the thing you shout across a
 *  room or type into a phone — and a numeric alphabet gives 10,000 codes
 *  where the old eight letters gave 4,096, on a pad everybody already
 *  knows how to use. */
export const CODE_ALPHABET = '0123456789';

export interface LobbyMember {
  name: string;
  /** Stable relay member index — club poses and voice are keyed by it. */
  idx: number;
  /** THE BODY (FF2): their packed paint, packed gear and base tone — the
   *  mannequin they wear in the arena, worn here too. Absent from an older
   *  relay, or from a dancer who has never touched the bay. */
  lk?: string;
  gr?: string;
  tn?: string;
  /** The colour they picked (hue 0..1), or null for "whatever my slot says".
   *  It rides the wire so a choice made in the foyer follows its dancer onto
   *  the club floor; an older relay simply never sends it. */
  hue?: number | null;
}

/** THE BALL, while it hangs: who sent it up, on what song, where it floats,
 *  when it fires (local performance.now ms), and who has touched in. */
export interface BallState {
  callerIdx: number;
  callerName: string;
  /** What the ball calls: the record, or one of the arena's fights. */
  mode: BellMode;
  /** A fight's arena room code (empty for a rave). */
  code: string;
  track: string;
  /** The caller's difficulty — the whole ring dances one chart. */
  diff: number;
  /** A titan raid called HARDCORE (no healing between titans). */
  hardcore: boolean;
  pos: [number, number, number];
  firesAt: number;
  joins: Set<number>;
}

export const net = {
  phase: 'off' as NetPhase,
  /** A ROOM OF ONE. The venue is a place before it is a party: with no
   *  relay to be had (offline, a dev serve with no server up, a relay
   *  that never answered) the floor still opens, for you alone, with the
   *  dumbwaiter served off a clock in this file rather than the relay's.
   *  Every club system reads inRoom(), which is true here too. */
  solo: false,
  code: '',
  members: [] as LobbyMember[],
  isHost: false,
  /** Is this a PUBLIC room (strangers may walk in) or a private one behind
   *  its four digits? The floor reads the same either way; the difference
   *  is only whether the code is a door or just an address. */
  isPublic: false,
  /** My own relay member index (−1 until the room hands it over). */
  myIdx: -1,
  /** The raid-summoning ball currently in the air, or null. */
  ball: null as BallState | null,
  /** THE BELL dealt me to the arena: I am away on a fight, still a member
   *  of this room, and the floor is where I come home to. Walking out of
   *  the venue under the curtain must NOT leave the room while this is
   *  set, and walking back in must not join it again. */
  dealtAway: false,
  /** Members currently away playing a set (the floor sees them out). */
  gamePlayers: new Set<number>(),
  /** THE CROWN: member idx of the last club raid's winner, worn on their
   *  figure across the floor until their NEXT game (or they leave the
   *  room). null = bare heads. The relay owns it; clients only wear it. */
  crownIdx: null as number | null,
  error: '',
  rttMs: 0,
  /** Bumped on any lobby change so menus know to repaint. */
  dirty: 0,
};

/** Member idx → ring seat for the CURRENT set (filled by 'start') — how
 *  voice finds a dancer's platform while the raid is live. */
export const seatByIdx = new Map<number, number>();

let ws: WebSocket | null = null;

/** Am I on the club floor — in a relay room, or the room of one? The one
 *  gate every club system reads (ClubSystem, teleport, mirror, props, the
 *  course door…), so a solo night and a full one agree on what "the floor
 *  is open" means. */
export function inRoom(): boolean {
  return net.solo || net.phase === 'hosting' || net.phase === 'joined';
}
let pingTimer: number | null = null;
let myHue: number | null = null;
let myName = 'DANCER';
/** THE BODY this headset dances in — packed paint, packed gear, base tone
 *  (see setDancerBody). Sent with every greeting and on every change. */
let myBody: { lk: string; gr: string; tn: string } = { lk: '', gr: '', tn: 'white' };

function send(obj: unknown): void {
  if (net.solo) {
    const m = obj as Record<string, unknown>;
    if (typeof m.t === 'string' && m.t.startsWith('prop')) soloProp(m);
    return;
  }
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function connect(onOpen: () => void): void {
  teardown('');
  net.phase = 'connecting';
  net.dirty++;
  try {
    ws = new WebSocket(serverUrl());
  } catch {
    net.phase = 'error';
    net.error = 'relay unreachable';
    net.dirty++;
    return;
  }
  ws.binaryType = 'arraybuffer'; // voice frames ride as binary beside the JSON
  ws.onopen = () => {
    onOpen();
    // A light ping keeps RTT fresh for the start-time compensation.
    pingTimer = window.setInterval(() => send({ t: 'ping', t0: performance.now() }), 2000);
  };
  ws.onerror = () => {
    if (net.phase === 'connecting') {
      net.phase = 'error';
      net.error = 'relay unreachable';
      net.dirty++;
    }
  };
  ws.onclose = () => {
    if (net.phase !== 'off' && net.phase !== 'error') {
      net.phase = 'error';
      net.error = 'connection lost';
      net.dirty++;
    }
    stopPing();
    stopVoiceCapture();
    clearVoiceSpeakers();
    clearClubPoses();
  clearCoursePoses();
  };
  ws.onmessage = (ev) => {
    // Binary payloads are voice frames; everything else is JSON room traffic.
    if (typeof ev.data !== 'string') {
      handleVoiceFrame(ev.data as ArrayBuffer);
      return;
    }
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(ev.data) as Record<string, unknown>;
    } catch {
      return;
    }
    handle(msg);
  };
}

function stopPing(): void {
  if (pingTimer !== null) {
    clearInterval(pingTimer);
    pingTimer = null;
  }
}

function teardown(reason: string): void {
  stopPing();
  net.solo = false;
  net.dealtAway = false;
  window.clearTimeout(soloServeTimer);
  soloServeTimer = 0;
  if (ws) {
    ws.onclose = null;
    ws.onmessage = null;
    ws.close();
    ws = null;
  }
  net.phase = reason ? 'error' : 'off';
  net.error = reason;
  net.code = '';
  net.members = [];
  net.isHost = false;
  net.isPublic = false;
  net.myIdx = -1;
  net.ball = null;
  net.gamePlayers = new Set();
  net.crownIdx = null;
  net.dirty++;
  seatByIdx.clear();
  stopVoiceCapture();
  clearVoiceSpeakers();
  clearClubPoses();
  clearCoursePoses();
}

/** A voice frame off the wire: [1-byte id length][ascii sender id][pcm]. */
function handleVoiceFrame(buf: ArrayBuffer): void {
  if (!voiceHook || buf.byteLength < 2) return;
  const bytes = new Uint8Array(buf);
  const idLen = bytes[0];
  if (buf.byteLength < 1 + idLen + 8) return;
  let id = '';
  for (let i = 0; i < idLen; i++) id += String.fromCharCode(bytes[1 + i]);
  voiceHook(id, buf.slice(1 + idLen));
}

/** ClubSocialSystem routes inbound frames to the spatial speakers. */
let voiceHook: ((id: string, frame: ArrayBuffer) => void) | null = null;
export function onVoice(fn: (id: string, frame: ArrayBuffer) => void): void {
  voiceHook = fn;
}

/** Everything the relay says about drinks (see server/index.mjs, DRINKS). */
export type PropWire =
  | { t: 'serve'; id: number }
  | {
      t: 'props';
      props: {
        id: number;
        holder: number | null;
        mode: string;
        pos: number[] | null;
        quat: number[] | null;
        full: boolean;
      }[];
    }
  | { t: 'prop-grab'; id: number; idx: number }
  | { t: 'prop-release'; id: number; idx: number }
  | { t: 'prop'; id: number; idx: number; d: number[] }
  | { t: 'prop-rest'; id: number; idle?: boolean; pos?: number[]; quat?: number[] };

/** ClubPropsSystem keeps the shared glasses true to the wire. */
let propHook: ((msg: PropWire) => void) | null = null;
export function onProp(fn: (msg: PropWire) => void): void {
  propHook = fn;
}

function handle(msg: Record<string, unknown>): void {
  switch (msg.t) {
    case 'room': {
      // Join-time, OR a mid-session battlefield promotion: the host left and
      // the relay handed this club to us.
      const wasLive = net.phase === 'live';
      net.phase = wasLive ? 'live' : msg.host ? 'hosting' : 'joined';
      net.isHost = Boolean(msg.host);
      net.isPublic = Boolean(msg.open);
      net.code = String(msg.code ?? net.code);
      if (Number.isFinite(Number(msg.idx))) net.myIdx = Number(msg.idx);
      // VOIDSTEP's clock, pinned. The relay says how long its course has been
      // running; we note the local instant that corresponds to bar zero, plus
      // half the round trip for the flight time of the answer. From here the
      // bar count is a pure function of the local clock, which is what lets
      // people walk on and off the course at any time and still see the same
      // platform in the same place.
      {
        const courseMs = Number(msg.courseMs);
        if (Number.isFinite(courseMs)) courseZeroAt = performance.now() - courseMs - net.rttMs / 2;
      }
      net.dirty++;
      break;
    }
    case 'roster': {
      const members = (msg.players as LobbyMember[]) ?? [];
      // Anyone who vanished takes their voice and club figure with them.
      const still = new Set(members.map((m) => m.idx));
      for (const old of net.members) {
        if (!still.has(old.idx)) {
          removeVoiceSpeaker(String(old.idx));
          clubPoses.delete(old.idx);
          coursePoses.delete(old.idx);
        }
      }
      net.members = members;
      net.dirty++;
      break;
    }
    case 'ball-up': {
      // Somebody sent the ball up — it hangs for `ms`, then fires.
      const joins = Array.isArray(msg.joins) ? (msg.joins as number[]).filter((n) => Number.isFinite(n)) : [];
      net.ball = {
        callerIdx: Number(msg.idx),
        callerName: String(msg.name ?? ''),
        mode: typeof msg.mode === 'string' && isFightMode(msg.mode) ? msg.mode : 'rave',
        code: typeof msg.code === 'string' ? msg.code : '',
        track: typeof msg.track === 'string' ? msg.track : '',
        diff: Number.isFinite(Number(msg.diff)) ? Number(msg.diff) : 1,
        hardcore: msg.hc === true,
        pos:
          Array.isArray(msg.pos) && msg.pos.length === 3
            ? [Number(msg.pos[0]), Number(msg.pos[1]), Number(msg.pos[2])]
            : [0, 1.5, -1.5],
        firesAt: performance.now() + Number(msg.ms ?? 60_000),
        joins: new Set(joins),
      };
      net.dirty++;
      break;
    }
    case 'ball-join': {
      if (!net.ball) break;
      const idx = Number(msg.idx);
      if (msg.in === false) net.ball.joins.delete(idx);
      else net.ball.joins.add(idx);
      net.dirty++;
      break;
    }
    case 'ball-off':
      net.ball = null;
      net.dirty++;
      break;
    case 'game': {
      // Who is away on the ring right now (empty = the floor is whole).
      const players = Array.isArray(msg.players) ? (msg.players as number[]) : [];
      net.gamePlayers = new Set(players.filter((n) => Number.isFinite(n)));
      net.dirty++;
      break;
    }
    case 'crown': {
      // The relay crowned (or bared) a head. Guarded by type, not Number():
      // a JSON null must read as "nobody", never as member 0.
      const idx = msg.idx;
      net.crownIdx = typeof idx === 'number' && Number.isFinite(idx) ? idx : null;
      net.dirty++;
      break;
    }
    case 'start': {
      net.ball = null;
      // The bell dealt me out: remember the wallet, so the homecoming can
      // say what the trip paid (backToClub).
      bellView.balanceAtDeal = coins.balance;
      if (typeof msg.mode === 'string' && isFightMode(msg.mode)) {
        // THE BELL rang for a FIGHT with me on it. The relay has dealt the
        // roster; the arena room it names is where the fight happens, and
        // the host carries me there. I stay a member here, away, until I
        // come home through backToClub().
        const people = (list: unknown): DealtMember[] =>
          Array.isArray(list)
            ? list
                .filter((p) => p && Number.isFinite(Number((p as { idx: unknown }).idx)))
                .map((p) => ({ idx: Number((p as { idx: unknown }).idx), name: String((p as { name?: unknown }).name ?? '') }))
            : [];
        const deal: FightDeal = {
          mode: msg.mode,
          // The tier rides as an index; an older relay sends none → NORMAL.
          difficulty: DIFFICULTY_ORDER[Number(msg.diff)] ?? 'normal',
          hardcore: msg.hc === true,
          code: typeof msg.code === 'string' ? msg.code : '',
          role: msg.role === 'watcher' ? 'watcher' : 'fighter',
          callerIdx: Number(msg.callerIdx),
          mine: Number(msg.callerIdx) === net.myIdx,
          solo: msg.solo === true,
          fighters: people(msg.fighters),
          watchers: people(msg.watchers),
          seed: Number(msg.seed ?? 1),
        };
        net.phase = 'live';
        net.dealtAway = true;
        net.dirty++;
        if (raveBridge.dealToFight) raveBridge.dealToFight(deal);
        else backToClub(); // nowhere to cross to — the floor keeps me
        break;
      }
      // The ball fired with ME on it: seed + seats + my ring seat + the
      // player seat map + a shared "beat 0 in N ms" (RTT-compensated).
      const players =
        (msg.players as { seat: number; name: string; idx?: number; you?: boolean; lk?: string; gr?: string; tn?: string }[]) ?? [];
      const humans = new Map<number, { name: string; netId?: number; look?: string; gear?: string; tone?: string }>();
      seatByIdx.clear();
      let mySeat = 0;
      for (const p of players) {
        if (Number.isFinite(Number(p.idx))) seatByIdx.set(Number(p.idx), p.seat);
        if (p.you) mySeat = p.seat;
        // The deal carries their body, so the ring is dressed on arrival.
        else humans.set(p.seat, { name: p.name, netId: p.idx, look: p.lk, gear: p.gr, tone: p.tn });
      }
      const startInMs = Number(msg.startInMs ?? 5000) - net.rttMs / 2;
      ensureAudio();
      const ctx = audioContext();
      const beatZeroAt = ctx ? ctx.currentTime + Math.max(0.5, startInMs / 1000) : undefined;
      net.phase = 'live';
      net.dirty++;
      startRaid({
        seats: Number(msg.seats ?? players.length),
        seed: Number(msg.seed ?? 1),
        mySeat,
        humans,
        beatZeroAt,
        online: true,
        // The host's record (empty = everyone derives the same one from the
        // seed). Either way the whole room lands on one song — and on the
        // caller's difficulty, so every deck runs the identical chart.
        trackId: typeof msg.track === 'string' ? msg.track : undefined,
        difficulty: Number.isFinite(Number(msg.diff)) ? Number(msg.diff) : undefined,
      });
      match.roomCode = net.code;
      break;
    }
    case 'p': {
      const seat = Number(msg.seat);
      const d = msg.d as number[];
      if (!Array.isArray(d) || d.length < 10) break;
      remotePoses.set(seat, {
        hx: d[0], hy: d[1], hz: d[2], hyaw: d[3],
        lx: d[4], ly: d[5], lz: d[6],
        rx: d[7], ry: d[8], rz: d[9],
        // Appended, and defaulted: a frame from before the neck existed
        // decodes as a dancer who simply isn't nodding.
        hpitch: d[10] ?? 0, hroll: d[11] ?? 0,
        t: performance.now(),
      });
      break;
    }
    case 'xp': {
      // A room-mate out on VOIDSTEP (course world space, keyed by idx).
      const idx = Number(msg.idx);
      const d = msg.d as number[];
      if (!Number.isFinite(idx) || !Array.isArray(d) || d.length < 10) break;
      coursePoses.set(idx, {
        hx: d[0], hy: d[1], hz: d[2], hyaw: d[3],
        lx: d[4], ly: d[5], lz: d[6],
        rx: d[7], ry: d[8], rz: d[9],
        hpitch: d[10] ?? 0, hroll: d[11] ?? 0,
        t: performance.now(),
      });
      break;
    }
    case 'cp': {
      // A room-mate moving through the club (world space, keyed by idx).
      const idx = Number(msg.idx);
      const d = msg.d as number[];
      if (!Number.isFinite(idx) || !Array.isArray(d) || d.length < 10) break;
      // Appended, and defaulted: a frame from before the hands turned
      // carries no quaternions, and the figure falls back to the guess.
      const quat = (o: number): [number, number, number, number] | undefined =>
        d.length >= o + 4 && d[o + 3] !== 0 ? [d[o], d[o + 1], d[o + 2], d[o + 3]] : undefined;
      // …and the fingers' squeeze rides after the turn: a frame from
      // before the hands closed leaves them at rest.
      const grip = (o: number): [number, number] | undefined => (d.length >= o + 2 ? [d[o], d[o + 1]] : undefined);
      clubPoses.set(idx, {
        hx: d[0], hy: d[1], hz: d[2], hyaw: d[3],
        lx: d[4], ly: d[5], lz: d[6],
        rx: d[7], ry: d[8], rz: d[9],
        // Appended, and defaulted: a frame from before the neck existed
        // decodes as a dancer who simply isn't nodding.
        hpitch: d[10] ?? 0, hroll: d[11] ?? 0,
        lq: quat(12),
        rq: quat(16),
        lg: grip(20),
        rg: grip(22),
        t: performance.now(),
      });
      break;
    }
    case 's': {
      const seat = Number(msg.seat);
      const d = msg.d as ScoreWire;
      const dancer = dancerAtSeat(seat);
      if (dancer && dancer.kind === 'remote' && d) {
        dancer.score = d.score;
        dancer.combo = d.combo;
        dancer.bestCombo = Math.max(dancer.bestCombo, d.combo);
        // Dodges and hits ride along so every client can grade every
        // dancer at the podium without asking anyone.
        dancer.dodges = d.dodges;
        dancer.hits = d.hits;
        dancer.perfects = d.perfects;
        if (dancer.alive && !d.alive) {
          dancer.alive = false;
          dancer.elimAtBeat = Number.isFinite(d.elim) ? d.elim : match.beat;
        }
      }
      break;
    }
    case 'left': {
      const seat = Number(msg.seat);
      const dancer = dancerAtSeat(seat);
      if (dancer && dancer.kind === 'remote' && dancer.alive) {
        // A vanished dancer leaves the floor mid-song.
        dancer.alive = false;
        dancer.elimAtBeat = Number.isFinite(match.beat) ? match.beat : 0;
      }
      remotePoses.delete(seat);
      const idx = Number(msg.idx);
      if (Number.isFinite(idx)) {
        removeVoiceSpeaker(String(idx));
        clubPoses.delete(idx);
        coursePoses.delete(idx);
        seatByIdx.delete(idx);
      }
      net.dirty++;
      break;
    }
    case 'serve':
    case 'props':
    case 'prop-grab':
    case 'prop-release':
    case 'prop':
    case 'prop-rest':
      // Drinks traffic goes straight to the glasses (ClubPropsSystem).
      propHook?.(msg as unknown as PropWire);
      break;
    case 'pong': {
      const t0 = Number(msg.t0);
      if (Number.isFinite(t0)) net.rttMs = performance.now() - t0;
      break;
    }
    case 'err':
      teardown(String(msg.m ?? 'room error'));
      break;
  }
}

/* ── public api ─────────────────────────────────────────────────────────── */

export function setDancerName(name: string): void {
  myName = name.trim().slice(0, 12).toUpperCase() || 'DANCER';
}

/**
 * Hand the session the colour this headset dances in (null = the slot's).
 *
 * It travels with the greeting that opens or joins a room — and, if a room
 * is already standing, straight down the wire, since the board is reachable
 * from the foyer with a room open and the club floor should never show a
 * dancer a colour they've stopped wearing.
 *
 * Only the COLOUR updates this way, not the name: the club's mute and block
 * lists are keyed by name, so a rename that propagated would shrug off a
 * block. Renaming stays a between-rooms act.
 */
export function setDancerHue(hue: number | null): void {
  const next = hue === null || !Number.isFinite(hue) ? null : ((hue % 1) + 1) % 1;
  if (next === myHue) return;
  myHue = next;
  if (net.phase === 'hosting' || net.phase === 'joined' || net.phase === 'live') {
    send({ t: 'hue', hue: myHue });
  }
}

export function dancerName(): string {
  return myName;
}

/**
 * Hand the session the BODY this headset wears — FIRE FIGHT's mannequin:
 * the packed paint, the packed gear and the base tone.
 *
 * ONE TOWN: the fighter you met in the arena is the dancer beside you here,
 * so the body travels the way the colour does — with the greeting that
 * opens or joins a room, and again down the wire the moment it changes,
 * since the bay is reachable with a room already standing.
 */
export function setDancerBody(lk: string, gr: string, tn: string): void {
  const next = { lk: lk.slice(0, 512), gr: gr.slice(0, 64), tn: tn === 'onyx' ? 'onyx' : 'white' };
  if (next.lk === myBody.lk && next.gr === myBody.gr && next.tn === myBody.tn) return;
  myBody = next;
  if (net.phase === 'hosting' || net.phase === 'joined' || net.phase === 'live') {
    send({ t: 'look', ...myBody });
  }
}

/** What this headset is currently wearing on the wire. */
export function dancerBody(): { lk: string; gr: string; tn: string } {
  return myBody;
}

/** The hue a room-mate wears on the club floor: the colour they chose, or
 *  their slot's if they never picked one (or the relay is too old to say). */
export function memberHue(m: LobbyMember): number {
  const h = m.hue;
  return h === null || h === undefined || !Number.isFinite(h) ? seatHue(m.idx) : ((h % 1) + 1) % 1;
}

export function hostRoom(): void {
  connect(() => send({ t: 'host', name: myName, hue: myHue, ...myBody }));
}

/** THE PUBLIC FLOOR: no code, no arranging — the relay drops you into
 *  whichever public room has the most people and still has space, or opens
 *  a fresh one if none does. The other door (host/join with a 4-digit
 *  code) is for a room you want to keep to your friends. */
export function enterPublicRoom(): void {
  connect(() => send({ t: 'public', name: myName, hue: myHue, ...myBody }));
}

export function joinRoom(code: string): void {
  connect(() => send({ t: 'join', code: code.toUpperCase(), name: myName, hue: myHue, ...myBody }));
}

export function leaveRoom(): void {
  teardown('');
}

/* ── THE PATIENT DOOR ───────────────────────────────────────────────────
 *
 * Getting onto the public floor against a host that may be ASLEEP.
 *
 * The room server is on Render's free tier, and a free instance sleeps
 * when idle and takes the better part of a minute to wake. While it is
 * waking it does not politely queue a WebSocket upgrade — it refuses it.
 * So the first attempt fails almost instantly, `net.phase` goes to
 * 'error', and the old floor logic read that one refusal as "no relay
 * here" and opened a ROOM OF ONE. The sixty seconds of patience it had
 * been given were never spent: a sleeping relay looks exactly like a dead
 * one for the first two hundred milliseconds, and that is the only look
 * anybody ever got.
 *
 * So: keep asking. An HTTP knock first (Render wakes on any request, and
 * a plain GET gets further than an upgrade against a cold router), then a
 * socket, and another every few seconds until either the floor answers or
 * the patience really is gone. A room of one is the last resort it was
 * always meant to be rather than the usual outcome.
 */

/** How often to look at what happened. */
const FLOOR_POLL_MS = 200;
/**
 * How many of those looks to take before opening a floor with nobody on
 * it. Three hundred is a minute of POLLING, which covers a cold start on
 * Render's free tier.
 *
 * Counted in TICKS rather than wall clock, and that is not a detail. The
 * first walk into the club BUILDS the rave — a lazy import, a venue and a
 * circuit — and that blocks the main thread for well over a second. A
 * deadline measured against the clock is therefore spent while the club is
 * still being assembled, so the first poll after the stall can find itself
 * already out of time and open a room of one against a relay that was
 * healthy the whole way through. Ticks cannot run while the thread is
 * blocked, so the patience measures attempts, which is what it is for.
 *
 * `?floorPatience=` shortens it (in milliseconds, converted here) so the
 * venue check can prove the room of one still happens without sitting
 * through a whole wake-up.
 */
const FLOOR_PATIENCE_TICKS = (() => {
  // Number(null) is ZERO, not NaN. Reading the missing parameter straight
  // into Number() therefore made the DEFAULT patience one tick — a fifth
  // of a second — so the club gave up on the relay instantly and opened a
  // room of one every single time, which is the exact failure the whole
  // function exists to prevent. The venue check never caught it because
  // the check passes ?floorPatience= explicitly: the only configuration
  // that was broken was the one nobody was testing. Ask for the string
  // first, and only then ask what number it is.
  const raw = new URLSearchParams(location.search).get('floorPatience');
  const ms = raw === null || raw === '' ? NaN : Number(raw);
  if (Number.isFinite(ms) && ms >= 0) return Math.max(1, Math.round(ms / FLOOR_POLL_MS));
  return 300;
})();
/** Readable by the venue check: the default is the case that shipped broken. */
export const __floorPatienceTicks = FLOOR_PATIENCE_TICKS;

/** How many ticks between attempts on a relay that refused. */
const FLOOR_RETRY_TICKS = 15;
let floorTimer = 0;

/**
 * Knock on the relay over HTTP. Fire and forget: the point is to make a
 * sleeping instance start waking, not to learn anything from the answer.
 */
export function warmRelay(): void {
  try {
    const http = serverUrl().replace(/^ws/, 'http').replace(/\/(ff|pub|rave|tv)$/, '');
    void fetch(http, { mode: 'no-cors', cache: 'no-store' }).catch(() => {});
  } catch {
    /* no relay configured, or fetch is unavailable — the socket still tries */
  }
}

/**
 * Walk onto the public floor, and keep trying while the host wakes up.
 * `stillWanted` is asked every tick so that walking back out of the club
 * stops the attempt rather than dropping a room on an empty venue.
 */
/*
 * There is deliberately NO navigator.onLine shortcut here. It reads false
 * in environments that are perfectly online (headless Chromium, for one,
 * which is how the venue check runs), and a false negative sends everybody
 * straight to a room of one — which is the exact failure this function was
 * written to stop. The patience window covers a genuinely offline headset
 * anyway: it waits, then opens the floor of one.
 */
/** Who is asking, right now: the latest caller's predicate, so an attempt
 *  already in flight answers to whoever most recently wanted the floor. */
let floorWanted: () => boolean = () => true;

export function openPublicFloor(stillWanted: () => boolean = () => true): void {
  floorWanted = stillWanted;
  // Already on the floor: nothing to open. The arena's CLUB door joins the
  // room BEFORE it drops its curtain (experience/ClubExperienceManager
  // holdForTheFloor), and the mount's own call lands a moment later — a
  // second greeting here would tear that socket down to open it again,
  // which is a flicker of foyer for the player and a leave-and-rejoin for
  // everyone else on the floor.
  if (inRoom()) return;
  // An attempt already in flight keeps going; it just answers to the new
  // caller from here on.
  if (floorTimer) return;
  warmRelay();
  enterPublicRoom();
  let ticks = 0;
  let lastTry = 0;
  const poll = (): void => {
    floorTimer = 0;
    if (!floorWanted()) return;
    if (inRoom()) return; // we are in — nothing more to do
    if (++ticks > FLOOR_PATIENCE_TICKS) {
      enterSoloFloor();
      return;
    }
    // A refusal is what a WAKING host looks like. Try it again.
    if (net.phase === 'error' && ticks - lastTry >= FLOOR_RETRY_TICKS) {
      lastTry = ticks;
      warmRelay();
      enterPublicRoom();
    }
    floorTimer = window.setTimeout(poll, FLOOR_POLL_MS);
  };
  floorTimer = window.setTimeout(poll, FLOOR_POLL_MS);
}

/** Stop trying (walking out of the club, or leaving the page). */
export function cancelPublicFloor(): void {
  window.clearTimeout(floorTimer);
  floorTimer = 0;
}

/* ── THE ROOM OF ONE ────────────────────────────────────────────────────── */

const SOLO_SERVE_MS = 1600; // the relay's own pace (server/rave.mjs SERVE_MS)
const SOLO_RETRY_MS = 900;
let soloServeTimer = 0;
/** The house's glass ledger while solo: what the relay would remember. */
const soloProps: Array<{ mode: 'idle' | 'pedestal' | 'held' | 'flight' | 'rest'; restedAt: number }> = [];

/**
 * Open the floor with nobody else on it. Same shape the relay hands a host
 * (idx 0, no code, a public-looking room), so nothing downstream has to
 * know — and the dumbwaiter runs off a local clock that speaks the wire's
 * own words back through the prop hook, so ClubPropsSystem serves, grants
 * and rests glasses exactly as it would with a relay brokering them.
 */
export function enterSoloFloor(): void {
  teardown('');
  net.solo = true;
  net.phase = 'off';
  net.myIdx = 0;
  net.isHost = true;
  net.isPublic = false;
  net.members = [{ idx: 0, name: myName, hue: myHue, ...myBody } as unknown as LobbyMember];
  net.dirty++;
  match.holdFoyer = false;
  soloProps.length = 0;
  armSoloServe(SOLO_SERVE_MS);
}

function armSoloServe(ms: number): void {
  window.clearTimeout(soloServeTimer);
  soloServeTimer = window.setTimeout(fireSoloServe, ms);
}

/** The relay's fireServe(), at home: a fresh glass first, else the one
 *  that has stood longest. */
function fireSoloServe(): void {
  soloServeTimer = 0;
  if (!net.solo || !propHook) return;
  const count = soloPoolSize();
  while (soloProps.length < count) soloProps.push({ mode: 'idle', restedAt: 0 });
  let id = soloProps.findIndex((p) => p && p.mode === 'idle');
  if (id < 0) {
    let oldest = Infinity;
    soloProps.forEach((p, i) => {
      if (p.mode === 'rest' && p.restedAt < oldest) {
        oldest = p.restedAt;
        id = i;
      }
    });
  }
  if (id < 0) {
    armSoloServe(SOLO_RETRY_MS);
    return;
  }
  soloProps[id].mode = 'pedestal';
  propHook({ t: 'serve', id });
}

/** ClubPropsSystem tells us its pool size once (it owns POOL). */
let soloPool = 6;
export function setPropPoolSize(n: number): void {
  soloPool = n;
}
function soloPoolSize(): number {
  return soloPool;
}

/** A prop word from my own hands, answered by the house instead of the
 *  relay — the same grant, the same rest, the same next serve, answered
 *  SYNCHRONOUSLY. A relay applies the room's words in order, so a glass
 *  re-thrown after it settled sees its rest echo before its new flight;
 *  deferring the echo here (tried) let a stale rest land on top of a
 *  fresh throw and snap the glass back to the floor. */
function soloProp(msg: Record<string, unknown>): void {
  if (!propHook) return;
  const id = Number(msg.id);
  while (soloProps.length <= id) soloProps.push({ mode: 'idle', restedAt: 0 }); // no holes — findIndex walks them
  const p = soloProps[id];
  let echo: PropWire | null = null;
  switch (msg.t) {
    case 'prop-grab':
      if (p.mode === 'pedestal') armSoloServe(SOLO_SERVE_MS);
      p.mode = 'held';
      echo = { t: 'prop-grab', id, idx: 0 };
      break;
    case 'prop-release':
      p.mode = 'flight';
      echo = { t: 'prop-release', id, idx: 0 };
      break;
    case 'prop-rest':
      if (msg.idle) {
        p.mode = 'idle';
        echo = { t: 'prop-rest', id, idle: true };
      } else {
        p.mode = 'rest';
        p.restedAt = Date.now();
        echo = { t: 'prop-rest', id, pos: msg.pos as number[], quat: msg.quat as number[] };
      }
      break;
    default:
      break; // pose streams have nobody to reach
  }
  if (echo) propHook(echo);
}

/* ── THE BALL: how games start from the floor ──────────────────────────── */

/** Send the ball up at `pos` — my song pick and ring-size preference ride
 *  along. The relay owns the 60-second clock from here. */
export function callBall(
  pos: [number, number, number],
  call?: { mode: BellMode; code: string; diff?: number; hardcore?: boolean },
): void {
  if (net.solo) {
    soloCall(pos, call?.mode ?? 'rave', call?.diff, call?.hardcore === true);
    return;
  }
  if (net.phase !== 'hosting' && net.phase !== 'joined') return;
  if (call && call.mode !== 'rave') {
    // THE BELL: a fight rides the ball with the arena room it deals into —
    // and, for a TITAN RAID, the tier the caller picked on the desk (an
    // index into the arena's DIFFICULTY_ORDER, in the slot a record's chart
    // difficulty rides in).
    send({
      t: 'ball-up',
      mode: call.mode,
      code: call.code,
      track: match.preferredTrack,
      diff: call.diff ?? match.difficulty,
      hc: call.hardcore === true, // a titan raid's HARDCORE, the desk's toggle
      pos,
    });
    return;
  }
  // No seat count rides the ball. A club raid is sized by WHO TURNS UP —
  // the relay deals everyone who touched onto the smallest ring that fits
  // them and fills the rest with groupies. It used to carry `match.seats`,
  // which is this headset's SOLO ring: a leftover from the last solo set,
  // so two friends in a club room got dealt onto whatever size the host
  // last played alone.
  send({ t: 'ball-up', track: match.preferredTrack, diff: match.difficulty, pos });
}

/** Touch in (or step back out) of the hanging ball. */
export function joinBall(wantIn: boolean): void {
  if (net.solo) return; // a room of one has nobody else to touch in
  send({ t: 'ball-join', in: wantIn });
}

/** The caller waving their own ball away. */
export function cancelBall(): void {
  if (net.solo) {
    window.clearTimeout(soloBallTimer);
    soloBallTimer = 0;
    net.ball = null;
    net.dirty++;
    return;
  }
  send({ t: 'ball-off' });
}

/* ── THE BALL IN A ROOM OF ONE ─────────────────────────────────────── */

/** A solo ball hangs for this long before it deals you — long enough for
 *  the drop, the plate and the touch to read, short enough that nobody
 *  is watching a clock with nobody else to wait for. START skips it. */
const SOLO_BALL_MS = 15_000;
let soloBallTimer = 0;

/**
 * The relay's ball, at home. The floor opened without a relay and the
 * desk still says HOST — and it must mean it: the ball drops,
 * the plate counts, your touch calls it off, START (or the clock) deals
 * you exactly as the relay would have. A record deals a ring of one plus
 * groupies; a fight deals you into the arena against its own bots.
 */
function soloCall(pos: [number, number, number], mode: BellMode, diff?: number, hardcore = false): void {
  if (net.ball) return;
  window.clearTimeout(soloBallTimer);
  const me = net.members[0];
  net.ball = {
    callerIdx: 0,
    callerName: me?.name ?? '',
    mode,
    code: '',
    track: match.preferredTrack,
    diff: diff ?? match.difficulty,
    hardcore,
    pos,
    firesAt: performance.now() + SOLO_BALL_MS,
    joins: new Set(),
  };
  net.dirty++;
  soloBallTimer = window.setTimeout(fireSoloBall, SOLO_BALL_MS);
}

/** The solo ball's clock ran out (or START cut it): deal myself, through
 *  the same 'start' the relay would have sent. */
function fireSoloBall(): void {
  soloBallTimer = 0;
  const ball = net.ball;
  if (!net.solo || !ball) return;
  const me = net.members[0];
  if (ball.mode === 'rave') {
    // The relay's ringFor(1): a full four-ring, the empty seats groupies.
    handle({
      t: 'start',
      seed: (Math.random() * 0xffffffff) >>> 0,
      seats: 4,
      track: ball.track,
      diff: ball.diff,
      startInMs: 5500,
      players: [{ seat: 0, name: me?.name ?? '', idx: 0, you: true }],
    });
    return;
  }
  handle({
    t: 'start',
    mode: ball.mode,
    code: '',
    diff: ball.diff,
    hc: ball.hardcore,
    role: 'fighter',
    callerIdx: 0,
    solo: true,
    fighters: [{ idx: 0, name: me?.name ?? '' }],
    watchers: [],
    seed: (Math.random() * 0xffffffff) >>> 0,
    startInMs: 5500,
    you: 0,
  });
}

/** The caller dropping the needle NOW rather than riding the clock down —
 *  a room whose dancers have all touched in has nothing left to wait for.
 *  Whoever is on the ball when this lands is who gets dealt; the relay
 *  runs the same deal the timeout would have. Caller-only, and the relay
 *  enforces that rather than trusting the button. */
export function startBall(): void {
  if (net.solo) {
    window.clearTimeout(soloBallTimer);
    fireSoloBall();
    return;
  }
  send({ t: 'ball-go' });
}

/**
 * A finished (or bailed) set folds back onto the club floor, NOT out of the
 * room: phase returns to hosting/joined and the relay is told this player
 * is home — when the last one is, the floor can raise the next ball.
 *
 * `winnerIdx` is THE CROWN's claim, sent only when the set actually
 * RESOLVED (walked out through the podium): the member idx of the night's
 * winner, or null when a groupie took it. Every client on the ring
 * computed the identical standings, so the relay believes the first
 * player home. A mid-set bail passes undefined — it names nobody, and a
 * player who finishes the record will.
 */
export function backToClub(winnerIdx?: number | null): void {
  if (net.phase !== 'live') return;
  net.phase = net.solo ? 'off' : net.isHost ? 'hosting' : 'joined';
  net.dealtAway = false;
  net.dirty++;
  // THE HOUSE PAYS on the way back in: the bell's bonus on top of whatever
  // the record, the fight or the raid paid out there — and the desk reads
  // the whole trip's take off the wallet's change since the deal.
  addCoins(CURRENCY.bell);
  if (bellView.balanceAtDeal >= 0) {
    bellView.lastPay = Math.max(0, coins.balance - bellView.balanceAtDeal);
    bellView.paidAt = performance.now();
    bellView.balanceAtDeal = -1;
  }
  send(winnerIdx === undefined ? { t: 'game-out' } : { t: 'game-out', winner: winnerIdx });
  remotePoses.clear();
  seatByIdx.clear();
}

export function sendPose(d: number[]): void {
  if (net.phase === 'live') send({ t: 'p', d });
}

/** My spot on the club floor (world space) — for the room-mates' view. */
/**
 * When this headset's course clock reads bar zero, in `performance.now()`
 * terms. Null until a room has told us — solo riders keep their own clock.
 */
let courseZeroAt: number | null = null;

/**
 * The room's VOIDSTEP bar count right now, or null when there is no room to
 * share a course with (solo, or the relay is an older build that doesn't send
 * `courseMs`). A solo rider falls back to a clock that starts when they cross,
 * which is what the course did for everybody before it had company.
 */
export function courseBars(barSeconds: number): number | null {
  if (courseZeroAt === null) return null;
  return (performance.now() - courseZeroAt) / 1000 / barSeconds;
}

/** Stream a VOIDSTEP pose (course world space). Same shape as a club pose. */
export function sendCoursePose(d: number[]): void {
  if (net.phase === 'hosting' || net.phase === 'joined') send({ t: 'xp', d });
}

export function sendClubPose(d: number[]): void {
  if (net.phase === 'hosting' || net.phase === 'joined') send({ t: 'cp', d });
}

/* ── DRINKS: the glasses' side of the wire (see PropWire) ──────────────── */


/** Ask the relay for glass `id` — the hand has already taken it on spec. */
export function sendPropGrab(id: number): void {
  if (inRoom()) send({ t: 'prop-grab', id });
}

/** The glass left my hand — mark it catchable; I still fly it. */
export function sendPropRelease(id: number): void {
  if (inRoom()) send({ t: 'prop-release', id });
}

/** Owner pose stream: [px,py,pz, qx,qy,qz,qw, full01] at ~20 Hz. */
export function sendPropPose(id: number, d: number[]): void {
  if (inRoom()) send({ t: 'prop', id, d });
}

/** My throw settled at pos/quat — or fell out of the world (nulls: idle). */
export function sendPropRest(id: number, pos: number[] | null, quat: number[] | null): void {
  if (!inRoom()) return;
  send(pos && quat ? { t: 'prop-rest', id, pos, quat } : { t: 'prop-rest', id, idle: true });
}

/** Ship one local voice frame to the room (binary; any connected phase). */
export function sendVoice(frame: ArrayBuffer): void {
  if (ws?.readyState === WebSocket.OPEN && net.phase !== 'off' && net.phase !== 'error') ws.send(frame);
}

/** The 3 Hz score line: enough for the live board AND the final grade. */
export interface ScoreWire {
  score: number;
  combo: number;
  dodges: number;
  hits: number;
  perfects: number;
  alive: boolean;
  elim: number;
}

export function sendScore(d: ScoreWire): void {
  if (net.phase === 'live') send({ t: 's', d });
}

/** Auto-join from a share link (?room=CADA&name=YELL). */
export function autoJoinFromUrl(): void {
  const params = new URLSearchParams(location.search);
  const name = params.get('name');
  if (name) setDancerName(name);
  const room = params.get('room');
  if (room && room.length === 4) joinRoom(room);
}

export const netConfigNote = NET;
