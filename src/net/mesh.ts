/**
 * Arcade mesh networking facade (2v2 / FFA). Kept Firebase-free so it can be
 * imported synchronously by the gameplay systems without dragging the Firebase
 * bundle into the main chunk — the heavy Firestore + WebRTC half lives in
 * meshImpl.ts and is loaded lazily the first time you queue an arcade brawl.
 * Completely separate from the 1v1 transports, so the duel is untouched.
 *
 * The facade owns the shared, mutable state the gameplay reads each frame
 * (inbox of {seat,msg}, my seat, room occupancy, whether the room is full);
 * the impl writes into it. NOTE: the mesh is built without a live multi-client
 * test rig — it type-checks/builds but expect to validate it against real
 * peers. It never runs for the duel or bot bouts.
 */

import type { ArcadeMode, Difficulty } from '../config.js';
import type { PeerMessage } from './protocol.js';

export interface MeshInbox {
  seat: number;
  msg: PeerMessage;
}

interface MeshImplApi {
  hostLobby(mode: ArcadeMode, name: string): Promise<void>;
  joinLobby(mode: ArcadeMode, roomId: string, name: string, watch?: boolean): Promise<boolean>;
  hostPrivate(mode: ArcadeMode, name: string): Promise<string>;
  joinPrivate(code: string, name: string, watch?: boolean): Promise<ArcadeMode | null>;
  setRaidHardcore(v: boolean): void;
  setRaidGoopliath(v: boolean): void;
  setRaidDifficulty(v: Difficulty): void;
  startLobby(): void;
  send(msg: PeerMessage): void;
  dropSeat(seat: number): void;
  close(): void;
}

class Mesh {
  /** {seat,msg} received since the last drain — MeshSystem empties it. */
  inbox: MeshInbox[] = [];
  /** My canonical seat in the room (0 = host). */
  mySeat = 0;
  /** FIGHTERS this mode seats. The room's `seats` array runs longer than
   *  this — the tail is the AUDIENCE (config.AUDIENCE_SEATS). */
  capacity = 0;
  /** I hold a WATCHER seat: dealt to the match with the squad, but onto
   *  the audience ground rather than a platform (DESIGN §3.2). */
  watching = false;
  /** Seat → the watchers' live poses and hands-up (MeshSystem fills it;
   *  AudienceSystem puts bodies on the terrace, the crowd bed reads the
   *  roar). Fighters keep this too — the terrace is the show's other half. */
  watchers = new Map<number, { x: number; y: number; z: number; qx: number; qy: number; qz: number; qw: number; roar: number; at: number }>();
  /** Seat → member id ('' = still empty); mirrors the room doc. */
  occupants: string[] = [];
  /** Seat → that player's callsign, learned from their `iam` message (empty
   *  until it arrives). The HUD reads this so brawlers show real names, not
   *  the bot-bout 'ALLY'/'BOT' placeholders. */
  names: string[] = [];
  /** Seat → that player's chosen cosmetics (avatar/platform skin ids + custom
   *  colour), learned from the same `iam` message. OpponentSystem dresses
   *  every mesh fighter (raid squadmates, FFA/2v2 rivals) from this, so
   *  people wear what they actually chose instead of bot randoms. */
  cosmetics: ({ av?: string; pf?: string; avc?: number; avl?: number; lk?: string; gr?: string } | undefined)[] = [];
  /** Seat → that peer's remote voice stream, set by the impl on `ontrack`. */
  voice = new Map<number, MediaStream>();
  /** True once every seat is filled by a human. */
  full = false;
  /** Room closed to new joiners — full, or the host locked a short-handed FFA. */
  locked = false;
  joined = false;
  /** Lobby state, mirrored live from the room doc. `hardcore` and `goopliath`
   *  are raid-only (2v2/ffa leave them false); `started` flips for every mode
   *  at launch. */
  raidHardcore = false;
  /** RAID: this lobby fights GOOPLIATH instead of running the titans. */
  raidGoopliath = false;
  /** RAID: the difficulty the host has set for the run (mirrored to all). */
  raidDifficulty: Difficulty = 'normal';
  started = false;
  /** Status sink for the lobby panel. */
  onStatus: (s: string) => void = () => {};

  private impl: MeshImplApi | null = null;

  /** The lowest still-occupied seat (dropped seats are masked out of
   *  `occupants`), or -1 before any occupancy is known. This is the match
   *  authority — it MIGRATES if the current host disconnects. */
  private lowestSeat(): number {
    for (let i = 0; i < this.occupants.length; i++) if (this.occupants[i]) return i;
    return -1;
  }

  /** The seat currently holding match authority (lowest live seat), or -1. */
  hostSeat(): number {
    return this.lowestSeat();
  }

  /** True while I hold match authority — normally seat 0, but if the host's
   *  headset dies I become authority the moment I'm the lowest live seat, so
   *  the bout doesn't freeze for everyone with no one running it. */
  isHost(): boolean {
    return this.joined && this.lowestSeat() === this.mySeat;
  }

  /** Open a fresh visible lobby of `mode` with me as host (2v2 / ffa / raid;
   *  never auto-joins — the browser is the front door). */
  async hostLobby(mode: ArcadeMode, name: string, onStatus?: (s: string) => void): Promise<void> {
    this.close();
    if (onStatus) this.onStatus = onStatus;
    const { MeshImpl } = await import('./meshImpl.js');
    this.impl = new MeshImpl(this);
    await this.impl.hostLobby(mode, name);
  }

  /** Claim a seat in a listed lobby. False = it filled/closed first. */
  async joinLobby(mode: ArcadeMode, roomId: string, name: string, onStatus?: (s: string) => void, watch = false): Promise<boolean> {
    this.close();
    if (onStatus) this.onStatus = onStatus;
    const { MeshImpl } = await import('./meshImpl.js');
    this.impl = new MeshImpl(this);
    return this.impl.joinLobby(mode, roomId, name, watch);
  }

  /**
   * Open a PRIVATE room of `mode` behind a 5-digit code — invite-only, so it
   * never shows in the room browser. Resolves with the code to share.
   */
  async hostPrivate(mode: ArcadeMode, name: string, onStatus?: (s: string) => void): Promise<string> {
    this.close();
    if (onStatus) this.onStatus = onStatus;
    const { MeshImpl } = await import('./meshImpl.js');
    this.impl = new MeshImpl(this);
    return this.impl.hostPrivate(mode, name);
  }

  /**
   * Claim a seat in a private room by code. Resolves with the room's own mode
   * (so the joiner lands in the right lobby without being told which format the
   * code was for), or null if the code is unknown, full or already launched.
   */
  async joinPrivate(code: string, name: string, onStatus?: (s: string) => void, watch = false): Promise<ArcadeMode | null> {
    this.close();
    if (onStatus) this.onStatus = onStatus;
    const { MeshImpl } = await import('./meshImpl.js');
    this.impl = new MeshImpl(this);
    return this.impl.joinPrivate(code, name, watch);
  }

  /** RAID host: flip the lobby's hardcore breaker (mirrored to everyone). */
  setRaidHardcore(v: boolean): void {
    this.impl?.setRaidHardcore(v);
  }

  /** RAID host: throw the FIGHT GOOPLIATH breaker (mirrored to everyone). */
  setRaidGoopliath(v: boolean): void {
    this.impl?.setRaidGoopliath(v);
  }

  /** RAID host: set the run difficulty (mirrored to everyone). */
  setRaidDifficulty(v: Difficulty): void {
    this.impl?.setRaidDifficulty(v);
  }

  /** Host: lock the lobby and launch — every member sees `started` flip. */
  startLobby(): void {
    this.impl?.startLobby();
  }

  /** Broadcast a game message to every connected peer (stamped with my seat). */
  send(msg: PeerMessage): void {
    this.impl?.send(msg);
  }

  /** Declare a seat dead — its peer went silent (pose-staleness backstop). */
  dropSeat(seat: number): void {
    this.impl?.dropSeat(seat);
  }

  cancel(): void {
    this.close();
  }

  private close(): void {
    this.impl?.close();
    this.impl = null;
    this.joined = false;
    this.full = false;
    this.locked = false;
    this.raidHardcore = false;
    this.raidGoopliath = false;
    this.raidDifficulty = 'normal';
    this.started = false;
    this.inbox.length = 0;
    this.mySeat = 0;
    this.occupants = [];
    this.names = [];
    this.cosmetics = [];
    this.voice.clear();
    this.watchers.clear();
    this.watching = false;
  }
}

/** Shared mutable state the impl writes and the systems read. */
export type MeshState = Mesh;

export const mesh = new Mesh();
