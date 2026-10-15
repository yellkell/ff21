/**
 * ArcadeSystem — the club's arcade room: four cabinets along the back wall,
 * every one of them playable. SUPER OCTAGON (the light-gun wave shooter)
 * and PEBBLES (the swap-to-match puzzle) stand two of each, alternating;
 * the games themselves live in club/games/, this system runs the room.
 *
 *  - AIM: each hand's ray, raycast onto the cabinet screens; the hit UV
 *    becomes that hand's point in the screen's canvas pixels.
 *  - START: step up, aim at a machine's glass, pull the trigger. One run at
 *    a time per headset — the machine you're playing is the only one that
 *    runs a game loop.
 *  - LEAVE: wander off mid-run and you've walked away from the machine; the
 *    run ends and posts what it earned.
 *
 * COST, on purpose: only the machine you're playing repaints every frame
 * (one 384×300 texture upload, the same budget the single cabinet always
 * had). The others idle on attract screens at 2 Hz each, round-robin so at
 * most ONE screen uploads on any frame, and only while you're in the room
 * — outside it the arcade does no raycasts and no painting at all.
 *
 * The wall board rides both ledgers for each game: local top-8 in this
 * headset, and the world board as a pseudo-chart ('superoctagon',
 * 'pebbles'; same Firestore collection, same fail-soft rules as the songs —
 * offline it just shows the house list). It cycles between the two games
 * while you're in the room, and turns to the one you just played. Other
 * dancers see the attract screens (a spectator stream needs relay verbs the
 * wire doesn't carry yet — honest limitation, not an accident).
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Raycaster, Vector3, type Object3D } from 'three';
import {
  ARCADE_TITLES,
  arcadeBook,
  arcadeRefs,
  recordArcadeRun,
  SCREEN_H,
  SCREEN_W,
  type ArcadeGameId,
  type ArcadeRefs,
} from '../club/arcade.js';
import { CLUB } from '../club/config.js';
import { HANDS, type CabinetGame, type Pointers } from '../club/games/game.js';
import { OctagonGame } from '../club/games/octagon.js';
import { PebblesGame } from '../club/games/pebbles.js';
import { profileName } from '../game/profile.js';
import { match } from '../game/state.js';
import { course } from '../course/state.js';
import { refreshWorldBoard, scores, submitWorldScore, worldBoard } from '../net/scores.js';
import { inRoom } from '../net/session.js';
import { font, onFontsReady } from '../ui/fonts.js';
import { UI } from '../ui/panel.js';

/** GAME OVER lingers this long, then the cabinet frees itself. */
const DEAD_HOLD = 3.6;
/** Stand-close gate: a cabinet starts for you within this of its foot. */
const REACH = 2.7;
/** Wander this far mid-game and you've walked away from the machine. */
const ABANDON = 2.6;
/** Each idle cabinet's attract repaint period. */
const ATTRACT_PERIOD = 0.5;
/** The wall board turns to the other game this often. */
const BOARD_CYCLE = 8;
/** "In the arcade": inside the room's walls, plus this much (the doorway). */
const ROOM_MARGIN = 0.6;

const BOARD_GAMES: readonly ArcadeGameId[] = ['octagon', 'pebbles'];

export class ArcadeSystem extends createSystem({}) {
  private ray = new Raycaster();
  private games: CabinetGame[] = [];
  private screens: Object3D[] = [];
  /** Per hand: which cabinet's glass the laser is on, and where. */
  private hits: Record<'left' | 'right', { cab: number; at: [number, number] } | null> = { left: null, right: null };
  private pointers: Pointers = {
    left: { at: null, down: false, up: false },
    right: { at: null, down: false, up: false },
  };
  /** The cabinet this headset is playing (or holding GAME OVER on), or -1. */
  private active = -1;
  private deadT = 0;
  private clock = 0;
  private attractT = 0;
  private attractNext = 0;
  private boardT = 0;
  private boardGame: ArcadeGameId = 'octagon';
  private lastBoardKey = '';
  private lastScoresDirty = -1;

  update(delta: number): void {
    const refs = arcadeRefs();
    if (!refs) return;
    if (!this.games.length) this.adopt(refs);

    const inClub =
      (match.screen === 'lobby' || match.screen === 'tour') &&
      inRoom() &&
      !course.active;
    if (!inClub) {
      // The club packed away mid-game (a set booked the floor): the run
      // ends quietly and the score still counts — you danced, it happened.
      if (this.active >= 0) {
        const game = this.games[this.active];
        if (game.phase === 'playing') this.post(game);
        game.phase = 'attract';
        this.active = -1;
      }
      return;
    }

    this.clock += delta;
    this.camera.getWorldPosition(_head);
    const here = this.inArcade(_head);
    // Out of the room with nothing running: the arcade costs nothing.
    if (!here && this.active < 0) return;

    this.readAim();

    if (this.active < 0) {
      this.tryStart();
    } else {
      const game = this.games[this.active];
      if (game.phase === 'playing') {
        if (_head.distanceTo(game.cab.pos) > ABANDON) {
          // Walked away mid-run — it ends and posts what it earned.
          this.finish(game);
        } else {
          this.fillPointers(this.active);
          if (game.step(delta, this.pointers)) this.finish(game);
          game.paint(this.clock);
        }
      } else {
        // dead: hold the score card, then free the machine.
        this.deadT += delta;
        if (this.deadT >= DEAD_HOLD) {
          game.phase = 'attract';
          this.active = -1;
          game.paint(this.clock);
        } else if (Math.floor(this.deadT * 8) !== Math.floor((this.deadT - delta) * 8)) {
          game.paint(this.clock); // blink cadence
        }
      }
    }

    if (here) {
      this.idleScreens(delta);
      this.boardT += delta;
      if (this.boardT >= BOARD_CYCLE) {
        this.boardT = 0;
        this.boardGame = BOARD_GAMES[(BOARD_GAMES.indexOf(this.boardGame) + 1) % BOARD_GAMES.length];
      }
    }
    this.paintBoardIfChanged(refs);
  }

  /** Build a game for every cabinet the club registered, and light them. */
  private adopt(refs: ArcadeRefs): void {
    this.games = refs.cabinets.map((cab) => (cab.game === 'pebbles' ? new PebblesGame(cab) : new OctagonGame(cab)));
    this.screens = refs.cabinets.map((c) => c.screen);
    const paintIdle = () => {
      for (const g of this.games) if (g.phase === 'attract') g.paint(this.clock);
    };
    paintIdle();
    onFontsReady(paintIdle);
  }

  private inArcade(p: Vector3): boolean {
    const A = CLUB.arcade;
    return (
      p.x >= A.minX - ROOM_MARGIN && p.x <= A.maxX + ROOM_MARGIN && p.z >= A.minZ - ROOM_MARGIN && p.z <= A.maxZ + ROOM_MARGIN
    );
  }

  /* ── aim ──────────────────────────────────────────────────────────────── */

  private readAim(): void {
    for (const hand of HANDS) {
      this.hits[hand] = null;
      const rayObj = this.world.playerSpaceEntities?.raySpaces?.[hand]?.object3D;
      if (!rayObj) continue;
      rayObj.getWorldPosition(_o);
      rayObj.getWorldDirection(_d).negate();
      this.ray.set(_o, _d);
      this.ray.far = 6;
      const hit = this.ray.intersectObjects(this.screens, false)[0];
      if (!hit || !hit.uv) continue;
      this.hits[hand] = {
        cab: this.screens.indexOf(hit.object),
        at: [hit.uv.x * SCREEN_W, (1 - hit.uv.y) * SCREEN_H],
      };
    }
  }

  /** This frame's lasers + trigger edges, as seen by cabinet `cab`. */
  private fillPointers(cab: number): void {
    for (const hand of HANDS) {
      const hit = this.hits[hand];
      const gp = this.input.xr.gamepads[hand];
      const p = this.pointers[hand];
      p.at = hit && hit.cab === cab ? hit.at : null;
      p.down = !!gp?.getButtonDown(InputComponent.Trigger);
      p.up = !!gp?.getButtonUp(InputComponent.Trigger);
    }
  }

  /* ── the run ──────────────────────────────────────────────────────────── */

  /** Step up, aim at a machine's glass, pull the trigger. */
  private tryStart(): void {
    for (const hand of HANDS) {
      const hit = this.hits[hand];
      if (!hit || !this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) continue;
      const game = this.games[hit.cab];
      if (_head.distanceTo(game.cab.pos) > REACH) continue;
      this.active = hit.cab;
      game.phase = 'playing';
      game.start();
      game.paint(this.clock);
      return;
    }
  }

  /** The run is over: post it, hold the card. */
  private finish(game: CabinetGame): void {
    this.post(game);
    game.phase = 'dead';
    this.deadT = 0;
    game.ended();
    game.paint(this.clock);
  }

  private post(game: CabinetGame): void {
    const score = game.score;
    if (score <= 0) return;
    const t = ARCADE_TITLES[game.id];
    recordArcadeRun(game.id, score, profileName());
    void submitWorldScore(t.track, 0, score, t.grade(score), profileName());
    refreshWorldBoard(t.track, 0);
    // Turn the wall to the game just played, and repaint it.
    this.boardGame = game.id;
    this.boardT = 0;
    this.lastBoardKey = '';
  }

  /** The idle machines' attract loops: one repaint per tick, round-robin,
   *  so each screen refreshes every ATTRACT_PERIOD and no frame ever pays
   *  for more than one idle upload. */
  private idleScreens(delta: number): void {
    const n = this.games.length;
    this.attractT += delta;
    const tick = ATTRACT_PERIOD / n;
    if (this.attractT < tick) return;
    this.attractT = Math.min(this.attractT - tick, tick);
    for (let k = 0; k < n; k++) {
      const i = (this.attractNext + k) % n;
      if (this.games[i].phase !== 'attract') continue;
      this.games[i].paint(this.clock);
      this.attractNext = (i + 1) % n;
      return;
    }
  }

  /* ── the wall board ───────────────────────────────────────────────────── */

  private paintBoardIfChanged(refs: ArcadeRefs): void {
    if (scores.dirty !== this.lastScoresDirty) {
      this.lastScoresDirty = scores.dirty;
      this.lastBoardKey = '';
    }
    const id = this.boardGame;
    const title = ARCADE_TITLES[id];
    const world = worldBoard(title.track, 0);
    const local = arcadeBook(id);
    const rows =
      world.state === 'ready' && world.rows.length
        ? world.rows.map((r) => ({ s: r.score, n: r.name, me: r.isMe }))
        : local.map((r) => ({ s: r.s, n: r.n, me: false }));
    const source = world.state === 'ready' && world.rows.length ? 'worldwide' : 'this headset';
    const key = `${id}|${source}|${rows.map((r) => `${r.n}:${r.s}${r.me ? '*' : ''}`).join(',')}`;
    if (key === this.lastBoardKey) return;
    this.lastBoardKey = key;

    const g = refs.boardCanvas.getContext('2d')!;
    const BW = refs.boardCanvas.width;
    const BH = refs.boardCanvas.height;
    g.clearRect(0, 0, BW, BH);
    g.fillStyle = 'rgba(13,10,18,0.92)';
    g.beginPath();
    g.roundRect(4, 4, BW - 8, BH - 8, 18);
    g.fill();
    g.lineWidth = 2.5;
    g.strokeStyle = `${title.glow}73`;
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = title.ink;
    g.shadowColor = title.glow;
    g.shadowBlur = 10;
    g.font = font(700, 44);
    g.fillText(title.name, BW / 2, 58, BW - 48);
    g.shadowBlur = 0;
    g.font = font(600, 20);
    g.letterSpacing = '3px';
    g.fillStyle = 'rgba(233,236,244,0.5)';
    g.fillText('HIGH SCORES', BW / 2, 102);
    g.letterSpacing = '0px';
    g.fillStyle = UI.lineFaint;
    g.fillRect(36, 126, BW - 72, 2);

    if (!rows.length) {
      g.font = font(500, 24);
      g.fillStyle = 'rgba(233,236,244,0.55)';
      g.fillText('no scores yet', BW / 2, 200);
      g.font = font(500, 19);
      g.fillStyle = 'rgba(233,236,244,0.35)';
      g.fillText('the first name up is yours', BW / 2, 236);
    } else {
      rows.slice(0, 8).forEach((row, i) => {
        const y = 170 + i * 62;
        if (row.me) {
          g.fillStyle = `${title.glow}1f`;
          g.beginPath();
          g.roundRect(24, y - 24, BW - 48, 50, 10);
          g.fill();
        }
        g.textAlign = 'right';
        g.font = font(600, 22);
        g.fillStyle = 'rgba(233,236,244,0.4)';
        g.fillText(String(i + 1), 58, y);
        g.textAlign = 'left';
        g.font = font(600, 26);
        g.fillStyle = row.me ? '#ffffff' : '#f2f3f7';
        g.fillText(row.n || 'RAVER', 78, y, 250);
        g.textAlign = 'right';
        g.font = font(700, 28);
        g.fillStyle = row.me ? '#ffffff' : '#f2f3f7';
        g.fillText(row.s.toLocaleString('en-US'), BW - 40, y);
      });
    }

    g.textAlign = 'left';
    g.font = font(500, 17);
    g.fillStyle = 'rgba(233,236,244,0.35)';
    g.fillText(`${title.unit} · ${source}`, 36, BH - 34);

    refs.boardTex.needsUpdate = true;
  }
}

const _head = new Vector3();
const _o = new Vector3();
const _d = new Vector3();
