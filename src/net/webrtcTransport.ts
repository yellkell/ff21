/**
 * Serverless multiplayer: Firebase Firestore does matchmaking + WebRTC
 * signaling, then ALL game traffic flows peer-to-peer over RTCDataChannels —
 * Firebase never sees a pose packet. This is the upgrade over relaying game
 * state through a realtime database (the curveball approach): one-time
 * signaling cost, then direct peer latency.
 *
 * Two channels:
 *   'pose' — unordered, no retransmits: a late pose is a useless pose.
 *   'evt'  — reliable, ordered: throws, hits, match state must all arrive.
 * Plus VOICE: both peers offer their microphone on the same connection;
 * the remote track is surfaced via onRemoteAudio and spatialised in
 * net/voice.ts. Mic denied? You still hear them (recvonly).
 *
 * Matchmaking (collection `rooms`, mode 'duel' or 'ranked'):
 *   - look for an open room; claim it with a transaction → you are the
 *     CALLEE (guest, side 1);
 *   - none open → create one and wait → you are the CALLER (host, side 0).
 *   Offer/answer ride on the room doc; ICE candidates ride the room's
 *   signalling path, `rooms/{id}/sig/duel/{caller|callee}` (net/rooms.ts).
 *   They used to ride `callerCandidates`/`calleeCandidates` straight under
 *   the room — the Firestore codelab shape — which the rules never opened, so
 *   every candidate was denied and silently dropped. The SDP is published
 *   before gathering finishes, so the trickle is the ONLY way the peers learn
 *   each other's addresses: that was every serverless duel failing to connect.
 *
 * THE THREE COLLECTIONS THIS USED TO USE — `lobbies` (public queue),
 * `privateLobbies` (5-digit codes) and `rankedRooms` (the server browser) —
 * are one collection now, told apart by `mode` and `visibility` (net/rooms.ts
 * explains why). One consequence is worth knowing: private duel codes and
 * private mesh codes finally share ONE code space, so a code can no longer
 * mean two different rooms depending on which screen you typed it into.
 */

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  type DocumentReference,
  type Firestore,
  type Unsubscribe,
} from 'firebase/firestore';
import { cloud, type Cloud } from './firebase.js';
import { CandidateLitter, candidatesCol, expiryMs, reapRoom, sweepSignals } from './rooms.js';
import { clockConfident, serverNow, syncServerClock } from './serverClock.js';
import { voiceAllowed } from './voiceRules.js';
import { ensureIceServers, iceConfig } from './iceConfig.js';
import type { PeerMessage } from './protocol.js';
import type { Transport, TransportEvents } from './transport.js';

/** A host lobby not SEEN (heartbeat) within this is an abandoned tab — skip it.
 *  Short, because a live host heartbeats every HOST_TICK_MS; this is just how
 *  long a ghost lingers before everyone ignores it. */
const LOBBY_FRESH_MS = 40 * 1000;
/** While waiting as a host: heartbeat our lobby AND re-scan for another host to
 *  pair with (so two simultaneous hosts don't deadlock). Kept short, and
 *  per-client jitter is added on top, so two players who JUST played each other
 *  — who re-enter the queue in lockstep and both become hosts — desynchronise
 *  and pair within a tick instead of sitting forever. */
const HOST_TICK_MS = 2_500;
/** Private codes live longer — you share one and wait for a friend to type it. */
const PRIVATE_FRESH_MS = 10 * 60 * 1000;
/** Give P2P this long to come up before declaring failure. */
const CONNECT_TIMEOUT_MS = 15_000;
/** How long a host waits for a claimer's ANSWER before re-opening its lobby.
 *  Claiming flips `open` to false, so a claimer who never answers (tab closed,
 *  mic prompt abandoned, headset slept) strands the host: nobody else can claim
 *  a closed lobby and the host has no timeout of its own — it just waits, for
 *  ever, while looking busy to everyone else. */
const CLAIM_ANSWER_MS = 20_000;

/** Back-compat window for a lobby from an OLDER client that has no `seen` field
 *  yet — fall back to createdAt so a mid-rollout peer can still be matched. */
const LOBBY_LEGACY_FRESH_MS = 2 * 60 * 1000;

/** A lobby dead for THIS long gets deleted by whoever scans past it. Ghosts
 *  (crashed tabs, killed browsers — nothing client-side ran close()) used to
 *  pile up for ever, and the claim scan reads only the first `limit()` docs in
 *  id order: once ten ghosts sorted ahead of every live lobby, every searcher
 *  saw nothing but ghosts, skipped them all, hosted their own lobby — and
 *  NOBODY EVER PAIRED again (the August '26 "quick match is dead" outage).
 *  Reaping keeps the collection tiny so live lobbies always fit in the scan.
 *  Much longer than the freshness window, so a client whose clock probe failed
 *  can mis-judge liveness without vandalising a real host's lobby. */
const GHOST_REAP_MS = 10 * 60 * 1000;

function millis(v: unknown): number | undefined {
  return (v as { toMillis?: () => number } | undefined)?.toMillis?.();
}

/** Is this lobby a LIVE host? A current client heartbeats `seen`, so trust it
 *  strictly (ghosts go stale in seconds). A pre-heartbeat client has no `seen`,
 *  so fall back to createdAt for the rollout. */
function lobbyFresh(data: Record<string, unknown> | undefined, now: number): boolean {
  const seen = millis(data?.seen);
  if (typeof seen === 'number') return now - seen <= LOBBY_FRESH_MS;
  return now - (millis(data?.createdAt) ?? 0) <= LOBBY_LEGACY_FRESH_MS;
}

/** Long past any freshness window — a ghost worth reaping (see GHOST_REAP_MS).
 *  A doc with neither stamp is malformed and counts as long dead. */
function lobbyLongDead(data: Record<string, unknown> | undefined, now: number): boolean {
  const last = millis(data?.seen) ?? millis(data?.createdAt) ?? 0;
  return now - last > GHOST_REAP_MS;
}

/**
 * The shared connection (net/firebase.ts) — the same app, sign-in and uid the
 * leaderboard and the club use. Every entry point below opens it before it
 * touches Firestore, because under the current rules an unauthenticated write
 * is not a slow write, it is a denied one.
 */
let live: Cloud | null = null;

async function openCloud(): Promise<Cloud> {
  live ??= await cloud();
  if (!live) throw new Error('no connection');
  return live;
}

/** The open connection — openCloud() first, always awaited by the caller. */
function need(): Cloud {
  if (!live) throw new Error('cloud not open');
  return live;
}

function db(): Firestore {
  return need().db;
}

/** This headset's uid — who a room is hosted by. */
function uid(): string {
  return live?.uid ?? '';
}

/** The one rooms collection. */
function rooms(): ReturnType<typeof collection> {
  return collection(db(), 'rooms');
}

/** One side's ICE candidates for a duel — under the room's `sig/duel` doc,
 *  the one place the rules let both halves of a handshake write. */
function duelCandidates(room: DocumentReference, side: 'caller' | 'callee') {
  return candidatesCol(need(), room.id, 'duel', side);
}

/** A scan of the OPEN public rooms of one mode. Equality filters only, so
 *  Firestore serves it by merging single-field indexes. */
function openRooms(mode: 'duel' | 'ranked') {
  return query(
    rooms(),
    where('mode', '==', mode),
    where('visibility', '==', 'public'),
    where('open', '==', true),
    limit(25),
  );
}

/** How long a room's lease runs. Private codes get read out over voice chat,
 *  typed wrong and typed again, so they outlive a queue lobby by a lot. */
const PUBLIC_LEASE_MS = 90 * 1000;

/**
 * The fields the rules insist on: what kind of room this is, who holds it, and
 * when it stops counting. `expiresAt` is not bookkeeping — a leaked room sorts
 * ahead of live ones in a limit()ed scan, and enough of them is exactly the
 * August '26 outage where nobody ever paired.
 */
function roomFields(mode: 'duel' | 'ranked', visibility: 'public' | 'private') {
  const now = Date.now();
  return {
    mode,
    visibility,
    host: uid(),
    at: now,
    // A TIMESTAMP: a TTL policy ignores a numeric field entirely (net/rooms.ts).
    expiresAt: new Date(now + (visibility === 'private' ? PRIVATE_FRESH_MS : PUBLIC_LEASE_MS)),
  };
}

/** A heartbeat: push the lease out, and keep `seen` for the freshness window. */
function beatFields(visibility: 'public' | 'private') {
  const now = Date.now();
  return {
    seen: serverTimestamp(),
    at: now,
    expiresAt: new Date(now + (visibility === 'private' ? PRIVATE_FRESH_MS : PUBLIC_LEASE_MS)),
  };
}

export class WebRtcTransport implements Transport {
  private pc: RTCPeerConnection | null = null;
  private evtChannel: RTCDataChannel | null = null;
  private poseChannel: RTCDataChannel | null = null;
  private lobbyRef: DocumentReference | null = null;
  private isCaller = false;
  private matched = false;
  private closed = false;
  private unsubs: Unsubscribe[] = [];
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private hostTimer: ReturnType<typeof setInterval> | null = null;
  /** Quick one-off cross-over scans fired just after we become a host. */
  private earlyScans: ReturnType<typeof setTimeout>[] = [];
  private micStream: MediaStream | null = null;
  /**
   * ICE candidates that arrived BEFORE the remote description was set. Adding
   * one early throws, and a Firestore snapshot never re-delivers an 'added',
   * so an unbuffered early candidate is lost for good — costing the pair a
   * connection path, or the whole connection when the lost one was the only
   * route that worked. The mesh (net/meshImpl.ts) has always buffered these;
   * the duel path was still dropping them.
   */
  private pendingCandidates: RTCIceCandidateInit[] = [];
  /** Already warned that a candidate write failed — see postCandidate. */
  private candidateWarned = false;
  /** The candidates WE wrote, deleted once the handshake is over. */
  private litter: CandidateLitter | null = null;
  /** The other side's candidate docs as they arrive — see the claim watch. */
  private theirCandidates: DocumentReference[] = [];
  /** Grace timer for a TRANSIENT 'disconnected' — see watchConnection. */
  private iceGraceTimer: ReturnType<typeof setTimeout> | null = null;
  /** Deadline for a claimer to actually answer — see runCallerOn. */
  private claimWatchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly events: TransportEvents) {}

  async queue(): Promise<void> {
    this.events.onStatus('matchmaking…');
    // Correct for device clock skew BEFORE judging any lobby's freshness — a
    // headset clock off by >LOBBY_FRESH_MS otherwise sees every live lobby as
    // stale and never matches (the "both searching, never pair" bug).
    await openCloud();
    await syncServerClock();
    if (this.closed) return;

    const claimed = await this.tryClaimLobby(openRooms('duel'));
    if (this.closed) return;
    if (!(await this.setupConnection())) return;

    if (claimed) {
      this.isCaller = false;
      await this.runCallee(claimed);
      // Opponent already on the line — the clock starts now.
      this.armConnectTimeout();
    } else {
      this.isCaller = true;
      const ref = await addDoc(rooms(), {
        open: true,
        createdAt: serverTimestamp(),
        seen: serverTimestamp(),
        ...roomFields('duel', 'public'),
      });
      if (this.closed) return;
      // Callers wait in the queue indefinitely; the clock starts when an
      // answer arrives (see runCallerOn).
      await this.runCallerOn(ref);
      if (this.closed) return;
      // While we wait: heartbeat our lobby AND re-scan for another waiting host
      // to pair with, so two simultaneous searchers don't both sit forever.
      this.startHostHeartbeat();
    }
  }

  /**
   * Host a private match: reserve a free 5-digit code (which IS the room's doc
   * id), publish an offer there, and wait. Resolves with the code.
   */
  async hostPrivate(): Promise<string> {
    this.events.onStatus('creating private match…');
    await openCloud();
    await syncServerClock();
    if (!(await this.setupConnection())) throw new Error('cancelled');
    this.isCaller = true;
    const code = await this.allocateCode();
    if (this.closed) throw new Error('cancelled');
    await this.runCallerOn(this.lobbyRef!);
    this.events.onStatus('waiting for your opponent…');
    return code;
  }

  /** Join a private match by code: claim its lobby and answer the host's offer. */
  async joinPrivate(code: string): Promise<void> {
    this.events.onStatus('joining…');
    await openCloud();
    await syncServerClock();
    const ref = doc(rooms(), code);
    // Claim it first (validates the code) so a bad code never prompts for mic.
    await runTransaction(db(), async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists()) throw new Error('code not found');
      // One code space now covers every private room in the app, so a code
      // that IS a room but isn't a duel is a real answer, not a miss — say so
      // rather than letting a raid code fail as "not found".
      if (snap.data()?.mode !== 'duel') throw new Error('that code is not a duel');
      if (snap.data()?.open !== true) throw new Error('match already started');
      const created = (snap.data()?.createdAt?.toMillis?.() as number | undefined) ?? 0;
      if (serverNow() - created > PRIVATE_FRESH_MS) throw new Error('code expired');
      txn.update(ref, { open: false, claimedAt: serverTimestamp() });
    });
    if (this.closed) return;
    if (!(await this.setupConnection())) return;
    this.isCaller = false;
    await this.runCallee(ref);
    this.armConnectTimeout();
  }

  /**
   * Host a PUBLIC ranked room, listed in the server browser: create an open
   * room tagged with your name, publish an offer, and wait for
   * a challenger to pick it out of the list. Heartbeats `seen` so a dropped
   * host ages out of everyone's browser. Resolves with the room's doc id once
   * it's live and waiting (you're the caller, side 0) — the browser uses that
   * id to mark your own row in the list.
   */
  async hostRanked(name: string): Promise<string> {
    this.events.onStatus('opening your server…');
    await openCloud();
    await syncServerClock();
    if (!(await this.setupConnection())) throw new Error('cancelled');
    this.isCaller = true;
    const ref = await addDoc(rooms(), {
      open: true,
      createdAt: serverTimestamp(),
      seen: serverTimestamp(),
      ...roomFields('ranked', 'public'),
      // `host` is the uid the rules check; the browser wants a NAME to show.
      hostName: name.slice(0, 14) || 'BOXER',
    });
    if (this.closed) throw new Error('cancelled');
    await this.runCallerOn(ref);
    if (this.closed) throw new Error('cancelled');
    // Keep the room fresh in the browser until a challenger claims it.
    this.startRankedHeartbeat();
    this.events.onStatus('waiting for an opponent…');
    return ref.id;
  }

  /** Join a listed ranked room by its doc id: claim it, then answer the host. */
  async joinRanked(id: string): Promise<void> {
    this.events.onStatus('joining…');
    await openCloud();
    await syncServerClock();
    const ref = doc(rooms(), id);
    // Claim it first so a full/stale room fails before we prompt for the mic.
    await runTransaction(db(), async (txn) => {
      const snap = await txn.get(ref);
      if (!snap.exists()) throw new Error('server not found');
      if (snap.data()?.open !== true) throw new Error('server already full');
      if (!lobbyFresh(snap.data(), serverNow())) throw new Error('server went stale');
      txn.update(ref, { open: false, claimedAt: serverTimestamp() });
    });
    if (this.closed) return;
    if (!(await this.setupConnection())) return;
    this.isCaller = false;
    await this.runCallee(ref);
    this.armConnectTimeout();
  }

  /**
   * While hosting a listed ranked room: heartbeat `seen` so a dropped host ages
   * out of the browser. No cross-over scan (unlike the public queue) — ranked
   * rooms are joined only by an explicit pick from the list, so two waiting
   * hosts never need to auto-pair.
   */
  private startRankedHeartbeat(): void {
    this.hostTimer = setInterval(() => {
      if (this.closed || this.matched || !this.lobbyRef) return;
      void updateDoc(this.lobbyRef, beatFields('public')).catch(() => {});
    }, HOST_TICK_MS);
  }

  /** Build the peer connection + voice. Returns false if cancelled meanwhile. */
  private async setupConnection(): Promise<boolean> {
    await ensureIceServers(); // fetch/refresh TURN creds before the PC is built
    if (this.closed) return false;
    this.pc = new RTCPeerConnection(iceConfig());
    this.watchConnection();
    await this.setupVoice();
    return !this.closed;
  }

  /**
   * Reserve a free 5-digit code as a private duel room; sets `lobbyRef`.
   *
   * The code space is now shared with every other kind of private room — a
   * mesh 2v2, a raid, a rave set — because they are all documents in `rooms`
   * keyed by their code. That is the point: a code used to be ambiguous
   * between two collections, and typing a raid code into the duel box got you
   * "not found" rather than the truth.
   */
  private async allocateCode(): Promise<string> {
    for (let attempt = 0; attempt < 8 && !this.closed; attempt++) {
      const code = String(Math.floor(Math.random() * 100000)).padStart(5, '0');
      const ref = doc(rooms(), code);
      try {
        const replaced = await runTransaction(db(), async (txn) => {
          const snap = await txn.get(ref);
          if (snap.exists()) {
            // A code is TAKEN while its room is still leased, whatever kind of
            // room that is — the lease is the one clock every room keeps.
            if (Date.now() < expiryMs(snap.data()?.expiresAt)) throw new Error('taken');
          }
          txn.set(ref, { open: true, createdAt: serverTimestamp(), ...roomFields('duel', 'private') });
          return snap.exists();
        });
        // Taking over an expired room: sweep what ITS handshakes left under
        // this code BEFORE ours starts — otherwise our guest drinks the last
        // pair's candidates, and a sweep run any later would take ours too.
        if (replaced) {
          await sweepSignals(need(), code).catch((err: unknown) => console.warn('[duel] sweep of a reused code failed', err));
        }
        this.lobbyRef = ref;
        return code;
      } catch {
        /* code collided or was taken — try another */
      }
    }
    throw new Error('could not allocate a code');
  }

  send(d: PeerMessage): void {
    if (!this.matched) return;
    // Poses ride the lossy fast lane; everything else must arrive.
    const channel = d.k === 'pose' && this.poseChannel?.readyState === 'open' ? this.poseChannel : this.evtChannel;
    if (channel?.readyState === 'open') {
      try {
        channel.send(JSON.stringify(d));
      } catch {
        /* channel mid-close; connection watcher will handle it */
      }
    }
  }

  close(): void {
    if (this.closed) return;
    const wasMatched = this.matched;
    this.closed = true;
    this.matched = false;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    if (this.hostTimer) clearInterval(this.hostTimer);
    this.hostTimer = null;
    this.clearIceGrace();
    this.clearClaimWatch();
    this.pendingCandidates.length = 0;
    this.litter?.sweep();
    for (const t of this.earlyScans) clearTimeout(t);
    this.earlyScans = [];
    for (const u of this.unsubs.splice(0)) u();
    for (const track of this.micStream?.getTracks() ?? []) track.stop();
    this.micStream = null;
    this.evtChannel?.close();
    this.poseChannel?.close();
    this.pc?.close();
    this.pc = null;
    // Best effort: tear down an unclaimed lobby so it can't strand others.
    if (this.lobbyRef && this.isCaller && !wasMatched) {
      void deleteDoc(this.lobbyRef).catch(() => {});
    }
    this.lobbyRef = null;
  }

  // --- voice -----------------------------------------------------------------

  /**
   * Offer the microphone on the peer connection (before any offer/answer is
   * created so the audio m-line is in the SDP), and surface the remote track.
   */
  private async setupVoice(): Promise<void> {
    const pc = this.pc!;
    pc.ontrack = (ev) => {
      if (ev.track.kind !== 'audio') return;
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      this.events.onRemoteAudio?.(stream);
    };
    try {
      this.micStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (this.closed) {
        for (const track of this.micStream.getTracks()) track.stop();
        this.micStream = null;
        return;
      }
      // Honour the voice rules: a disabled mic — the settings breaker, or a
      // RANKED bout (net/voiceRules.ts) — transmits nothing.
      for (const track of this.micStream.getAudioTracks()) track.enabled = voiceAllowed();
      for (const track of this.micStream.getTracks()) pc.addTrack(track, this.micStream);
    } catch {
      // Mic denied/unavailable — still set up to RECEIVE their voice.
      try {
        pc.addTransceiver('audio', { direction: 'recvonly' });
      } catch {
        /* no audio support at all — data channels still work */
      }
    }
  }

  // --- matchmaking -----------------------------------------------------------

  /** Try to claim the freshest open room; null means "be the caller". */
  private async tryClaimLobby(scan: ReturnType<typeof openRooms>): Promise<DocumentReference | null> {
    const open = await getDocs(scan);
    const now = serverNow();
    for (const snap of open.docs) {
      if (!lobbyFresh(snap.data(), now)) {
        // A ghost — skip it, and REAP it if it's long dead so ghosts can never
        // crowd live lobbies out of this scan again. Only with a
        // server-confirmed clock: a raw skewed clock must never delete.
        if (clockConfident() && lobbyLongDead(snap.data(), now)) reapRoom(need(), snap.id);
        continue;
      }
      try {
        await runTransaction(db(), async (txn) => {
          const fresh = await txn.get(snap.ref);
          if (!fresh.exists() || fresh.data()?.open !== true) throw new Error('claimed');
          txn.update(snap.ref, { open: false, claimedAt: serverTimestamp() });
        });
        return snap.ref; // claimed it — we're the callee
      } catch {
        continue; // somebody beat us to this one; try the next
      }
    }
    return null;
  }

  /** While hosting the public queue: every tick, keep our lobby fresh and look
   *  for another host to pair with. */
  private startHostHeartbeat(): void {
    // Pair two simultaneous hosts IMMEDIATELY, not after a full tick: two
    // players who just played re-enter the queue together, so both run
    // tryClaimLobby before either lobby exists and both fall through to hosting.
    // Scanning right now (rather than waiting HOST_TICK_MS) collapses the window
    // where they'd both sit waiting — the deadlock behind "just played, can't
    // find each other".
    void this.crossOverIfRivalHost();
    // A couple of quick follow-up scans cover the case where the rival's lobby
    // wasn't visible to our first scan yet (both created at the same instant),
    // so we pair in well under a second instead of waiting for a full tick.
    this.earlyScans = [700, 1600].map((ms) => setTimeout(() => void this.crossOverIfRivalHost(), ms));
    // Jitter the period per-client so two lockstep hosts don't keep heartbeating
    // and re-scanning in perfect step (which could resync them indefinitely).
    const period = HOST_TICK_MS + Math.floor(Math.random() * 1500);
    this.hostTimer = setInterval(() => {
      if (this.closed || this.matched || !this.lobbyRef) return;
      // Heartbeat: claimers ignore lobbies not SEEN recently, so a live host
      // stays claimable while an abandoned tab ages out fast.
      void updateDoc(this.lobbyRef, { seen: serverTimestamp() }).catch(() => {});
      void this.crossOverIfRivalHost();
    }, period);
  }

  /**
   * If another host is ALSO waiting, exactly ONE of the two must drop its lobby
   * and re-queue to claim the other — otherwise two people who searched at the
   * same instant (both found nothing, both became hosts) sit forever.
   *
   * The tiebreaker is the lobby document IDs: the host with the SMALLER id stays
   * put, the larger-id host crosses over. This is deliberately CLOCK-FREE. The
   * old code compared `createdAt`, but a just-created lobby's `serverTimestamp()`
   * reads back null (it's a pending write), so a host's own "createdAt" silently
   * became its LOCAL clock while it read rivals' as resolved SERVER stamps —
   * mixing two clocks. With any skew both peers could decide "not me", and they
   * deadlocked. Both peers see the same two ids identically, so id order picks
   * exactly one mover with no timestamps involved.
   */
  private async crossOverIfRivalHost(): Promise<void> {
    const open = await getDocs(openRooms('duel'));
    if (this.closed || this.matched || !this.lobbyRef) return;
    const now = serverNow();
    const myId = this.lobbyRef.id;
    for (const snap of open.docs) {
      if (snap.id === myId) continue;
      if (!lobbyFresh(snap.data(), now)) {
        if (clockConfident() && lobbyLongDead(snap.data(), now)) reapRoom(need(), snap.id);
        continue;
      }
      if (myId < snap.id) continue; // we hold the smaller id — we're the keeper, they cross to us
      // We're the larger id → drop our lobby and re-queue to claim theirs.
      if (this.hostTimer) {
        clearInterval(this.hostTimer);
        this.hostTimer = null;
      }
      const mine = this.lobbyRef;
      this.lobbyRef = null; // so close() doesn't try to delete it twice
      await deleteDoc(mine).catch(() => {});
      if (!this.closed && !this.matched) this.events.onRequeue?.();
      return;
    }
  }

  // --- caller (host, side 0) ---------------------------------------------------

  private async runCallerOn(lobbyRef: DocumentReference): Promise<void> {
    const pc = this.pc!;
    this.lobbyRef = lobbyRef;
    // The caller opens the channels; the callee receives them.
    this.adoptChannels(
      pc.createDataChannel('evt', { ordered: true }),
      pc.createDataChannel('pose', { ordered: false, maxRetransmits: 0 }),
    );

    const callerCandidates = duelCandidates(lobbyRef, 'caller');
    const calleeCandidates = duelCandidates(lobbyRef, 'callee');
    this.litter = new CandidateLitter(need());

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.postCandidate(callerCandidates, ev.candidate);
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await updateDoc(lobbyRef, { offer: { type: offer.type, sdp: offer.sdp } });
    this.events.onStatus('waiting for an opponent…');

    // Wait for the answer, then drink the callee's candidates.
    this.unsubs.push(
      onSnapshot(lobbyRef, (snap) => {
        const data = snap.data();
        const answer = data?.answer as RTCSessionDescriptionInit | undefined;
        if (answer) {
          this.clearClaimWatch();
          if (!pc.currentRemoteDescription) {
            this.events.onStatus('opponent found — connecting…');
            this.armConnectTimeout();
            void pc
              .setRemoteDescription(new RTCSessionDescription(answer))
              .then(() => this.flushCandidates())
              .catch(() => {});
          }
          return;
        }
        // Claimed (open flipped false) but not answered yet. Give them a
        // deadline: if no answer lands, put the lobby back on the market
        // rather than sitting here closed and unmatchable for ever.
        if (data?.open === false && !this.claimWatchTimer && !this.matched && !this.closed) {
          this.claimWatchTimer = setTimeout(() => {
            this.claimWatchTimer = null;
            if (this.closed || this.matched || !this.lobbyRef || pc.currentRemoteDescription) return;
            // The claimer is gone, and so is any use for the candidates it
            // left. Nobody else will ever delete them: their author is the
            // one side that isn't coming back to.
            for (const ref of this.theirCandidates.splice(0)) void deleteDoc(ref).catch(() => {});
            this.events.onStatus('waiting for an opponent…');
            void updateDoc(this.lobbyRef, { open: true, seen: serverTimestamp() }).catch(() => {});
          }, CLAIM_ANSWER_MS);
        }
      }),
    );
    this.drinkCandidates(calleeCandidates);
  }

  private clearClaimWatch(): void {
    if (this.claimWatchTimer) {
      clearTimeout(this.claimWatchTimer);
      this.claimWatchTimer = null;
    }
  }

  // --- callee (guest, side 1) ---------------------------------------------------

  private async runCallee(lobbyRef: DocumentReference): Promise<void> {
    const pc = this.pc!;
    this.lobbyRef = lobbyRef;
    const callerCandidates = duelCandidates(lobbyRef, 'caller');
    const calleeCandidates = duelCandidates(lobbyRef, 'callee');
    this.litter = new CandidateLitter(need());

    const channels: RTCDataChannel[] = [];
    pc.ondatachannel = (ev) => {
      channels.push(ev.channel);
      const evt = channels.find((c) => c.label === 'evt') ?? null;
      const pose = channels.find((c) => c.label === 'pose') ?? null;
      if (evt) this.adoptChannels(evt, pose);
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.postCandidate(calleeCandidates, ev.candidate);
    };

    this.events.onStatus('opponent found — connecting…');
    // The offer may land on the doc a beat after we claim it.
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('no offer')), 10_000);
      const unsub = onSnapshot(lobbyRef, (snap) => {
        const offer = snap.data()?.offer as RTCSessionDescriptionInit | undefined;
        if (!offer) return;
        clearTimeout(timeout);
        unsub();
        void (async () => {
          await pc.setRemoteDescription(new RTCSessionDescription(offer));
          this.flushCandidates(); // the host's trickle lands during this window
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await updateDoc(lobbyRef, { answer: { type: answer.type, sdp: answer.sdp } });
          resolve();
        })().catch(reject);
      });
      this.unsubs.push(unsub);
    });
    this.drinkCandidates(callerCandidates);
  }

  // --- plumbing -------------------------------------------------------------------

  /**
   * Publish one of our ICE candidates. A failure here is NOT noise to swallow:
   * a denied candidate write is a duel that cannot connect, and for as long as
   * this was `.catch(() => {})` a rules mismatch hid every one of them. Warn
   * once per connection, so rules drift shows up in the console without a
   * dozen copies of the same line.
   */
  private postCandidate(candidates: ReturnType<typeof collection>, cand: RTCIceCandidate): void {
    // Connected or closed: the route is settled, and a late candidate would
    // only be written to be deleted again.
    const litter = this.litter;
    if (!litter || litter.swept) return;
    void addDoc(candidates, cand.toJSON()).then((ref) => litter.add(ref), (err: unknown) => {
      if (this.candidateWarned) return;
      this.candidateWarned = true;
      console.warn(`[duel] ICE candidate write to ${candidates.path} failed — peers may not connect`, err);
    });
  }

  private drinkCandidates(candidates: ReturnType<typeof collection>): void {
    this.unsubs.push(
      onSnapshot(
        candidates,
        (snap) => {
          for (const change of snap.docChanges()) {
            if (change.type !== 'added') continue;
            this.theirCandidates.push(change.doc.ref);
            const cand = change.doc.data() as RTCIceCandidateInit;
            // Trickle-ICE race: until the remote description lands, addIceCandidate
            // throws and the candidate is gone for good. Buffer early arrivals and
            // flush them the moment the SDP is set.
            if (!this.pc?.remoteDescription) this.pendingCandidates.push(cand);
            else void this.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
          }
        },
        // Same reasoning as postCandidate: a denied listen means we never hear
        // the other side's addresses, so say so.
        (err) => console.warn(`[duel] ICE candidate listen on ${candidates.path} failed — peers may not connect`, err),
      ),
    );
  }

  /** Feed the buffered early candidates in, now that the remote SDP is set. */
  private flushCandidates(): void {
    for (const cand of this.pendingCandidates.splice(0)) {
      void this.pc?.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
    }
  }

  private adoptChannels(evt: RTCDataChannel, pose: RTCDataChannel | null): void {
    this.evtChannel = evt;
    this.poseChannel = pose;
    const onMsg = (ev: MessageEvent): void => {
      try {
        this.events.onMessage(JSON.parse(String(ev.data)) as PeerMessage);
      } catch {
        /* malformed packet — drop it */
      }
    };
    evt.onmessage = onMsg;
    if (pose) pose.onmessage = onMsg;
    evt.onopen = () => this.onConnected();
    evt.onclose = () => this.teardown('opponent left');
  }

  private onConnected(): void {
    if (this.matched || this.closed) return;
    this.matched = true;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.clearClaimWatch();
    if (this.hostTimer) {
      clearInterval(this.hostTimer);
      this.hostTimer = null;
    }
    // Signaling is done — the lobby doc has served its purpose, and so have
    // our candidates. Each side deletes only its OWN (see CandidateLitter);
    // the other side's are theirs to take away.
    if (this.lobbyRef && this.isCaller) void deleteDoc(this.lobbyRef).catch(() => {});
    this.litter?.sweep();
    this.theirCandidates = [];
    this.events.onMatched(this.isCaller ? 0 : 1);
  }

  /** How long a 'disconnected' peer gets to come back before we call it dead. */
  private static readonly ICE_GRACE_MS = 6_000;

  private watchConnection(): void {
    const pc = this.pc!;
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      // 'disconnected' is TRANSIENT: ICE routinely blips through it on a Wi-Fi
      // hiccup and recovers on its own a second later — Quest headsets do it
      // constantly. Tearing down here ended live bouts over nothing, which is
      // most of what "connection lost mid-fight" was. Only 'failed'/'closed'
      // are terminal; a disconnect gets a grace window to come back first.
      // (net/meshImpl.ts learned this already; the duel path hadn't.)
      if (state === 'connected') {
        this.clearIceGrace();
        return;
      }
      if (state === 'disconnected') {
        if (this.iceGraceTimer || this.closed) return;
        this.iceGraceTimer = setTimeout(() => {
          this.iceGraceTimer = null;
          if (this.closed) return;
          // 'completed' is an iceConnectionState, never a connectionState.
          if (this.pc?.connectionState === 'connected') return; // it came back
          this.teardown(this.matched ? 'connection lost' : "couldn't connect peer-to-peer");
        }, WebRtcTransport.ICE_GRACE_MS);
        return;
      }
      if (state === 'failed' || state === 'closed') {
        this.clearIceGrace();
        this.teardown(this.matched ? 'connection lost' : "couldn't connect peer-to-peer");
      }
    };
  }

  private clearIceGrace(): void {
    if (this.iceGraceTimer) {
      clearTimeout(this.iceGraceTimer);
      this.iceGraceTimer = null;
    }
  }

  private armConnectTimeout(): void {
    this.connectTimer = setTimeout(() => {
      if (!this.matched && !this.closed) {
        this.teardown("couldn't connect — still searching? try again");
      }
    }, CONNECT_TIMEOUT_MS);
  }

  private teardown(reason: string): void {
    if (this.closed) return;
    this.close();
    this.events.onClosed(reason);
  }
}
