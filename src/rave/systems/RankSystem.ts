/**
 * RankSystem — who's winning the set.
 *
 * The law: the living rank above the fallen; the living rank by score; the
 * fallen rank by who lasted longest. Lifts are ABSOLUTE: the top ten ride
 * raised platforms and the champion rides highest, whoever you are, so the
 * spectacle never switches off just because you happen to be winning.
 *
 * THE RISE: your own deck can never move — it is your real floor — so when
 * YOU carry a tier, the WORLD sinks instead: the stage eases down by your
 * lift and everything anchored to it follows (the giant, the light rig,
 * the whole void, the board, every other deck). The world stays coherent —
 * the glass floor drops WITH the decks, so nothing ever punches through
 * anything, every avatar keeps its full height, and a pedestal grows under
 * your own rim as the gap opens. It is deliberately the SLOWEST ease in
 * the game: a gentle swell you feel before you notice it.
 *
 * Eliminated decks dim instead of dropping. The holo board over the stage
 * carries the numbers.
 *
 * Also runs the podium: freeze the board, crown the winner, confetti, and
 * walk everyone back to the lobby.
 */

import { createSystem, Vector3 } from '@iwsdk/core';
import { GRADE, PLATFORM, PODIUM, RANK, hueToColor } from '../config.js';
import { arena } from '../arena/arena.js';
import { toLobby, toTour } from '../game/flow.js';
import { gradeOf, match, standingOrder, type Dancer } from '../game/state.js';
import { HoloBoard, type BoardRow } from '../ui/board.js';
import { discoRig } from './DiscoSystem.js';
import * as sfx from '../audio/sfx.js';

function standing(): Dancer[] {
  return [...match.players].sort(standingOrder);
}

function tierOf(d: Dancer | undefined): number {
  if (!d || !d.alive) return 0;
  if (d.rank === 1) return RANK.championLift;
  if (d.rank <= 10) return RANK.topTenLift;
  return 0;
}

export class RankSystem extends createSystem({}) {
  private board = new HoloBoard();
  private refreshT = 0;
  private lastHash = '';
  private podiumT = 0;
  private podiumDone = false;
  /** Accrued champion climb (m) — see RANK.climbPerSec. */
  private climb = 0;

  init(): void {
    this.scene.add(this.board.group);
  }

  update(delta: number): void {
    const a = arena();
    if (!a) return;

    // The board floats over the stage — above the giant, under the ball —
    // riding the stage's rank-sink, facing me (every client's board faces
    // its own dancer: the holo conceit).
    this.board.group.position.set(a.stage.position.x, 5.6 + a.stage.position.y, a.stage.position.z);
    this.board.group.lookAt(_head.set(match.headX, match.headY, match.headZ));

    const inShow = match.screen === 'raid' || match.screen === 'podium';
    this.board.group.visible = inShow || match.screen === 'countdown';

    this.refreshT -= delta;
    if (this.refreshT <= 0) {
      this.refreshT = RANK.refresh;
      this.recompute();
    }

    // THE RISE: when I carry a tier the whole world eases down by it — the
    // stage sinks and the giant, rig, void and board all ride it. Slow on
    // purpose; a lift you feel, not a lurch. And THE CLIMB: every second
    // spent holding rank 1 accrues more rise, so a dominant night ends
    // with you looking DOWN on the giant. The accrual drains (through the
    // same gentle ease) the moment the lead is lost.
    const meDancer = match.players.find((p) => p.kind === 'local');
    const champion = inShow && match.screen === 'raid' && meDancer?.alive && meDancer.rank === 1;
    this.climb = champion
      ? Math.min(RANK.climbMax, this.climb + delta * RANK.climbPerSec)
      : Math.max(0, this.climb - delta * RANK.climbPerSec * 2);
    const meSink = inShow ? tierOf(meDancer) + (inShow && meDancer?.alive ? this.climb : 0) : 0;
    a.stage.position.y += (-meSink - a.stage.position.y) * Math.min(1, delta * RANK.riseLerp);
    const sunk = -a.stage.position.y; // the eased world drop, shared by all

    // Platform lifts — eased and ABSOLUTE against the world floor: leaders
    // ride their tier wherever you rank. Other decks sink with the world;
    // only MY deck is pinned (it is my real floor).
    for (const handle of a.platforms) {
      const d = match.players.find((p) => p.seat === handle.seat);
      const mine = d?.kind === 'local';
      const target = inShow && !mine ? tierOf(d) - sunk : 0;
      handle.lift += (target - handle.lift) * Math.min(1, delta * RANK.lerp);
      handle.root.position.y = handle.lift;
      // A raised deck shows its underside — the pedestal column fills the
      // gap down to the WORLD floor (which is `sunk` below my own), so
      // every deck above it stands on something. Mine included: the column
      // growing under your own rim is the rise made visible.
      if (handle.pedestal) {
        const span = Math.max(0.02, handle.lift + sunk);
        handle.pedestal.visible = span > 0.06;
        handle.pedestal.scale.y = span;
        handle.pedestal.position.y = -PLATFORM.thickness - span;
      }
      // Elimination dims the deck's neon — halo and tube core together
      // (the core is the solid fixture; a dead deck's tube goes cold too).
      const out = d && !d.alive;
      const rimTarget = out ? 0.12 : 0.9;
      handle.rimMat.opacity += (rimTarget - handle.rimMat.opacity) * Math.min(1, delta * 3);
      const coreTarget = out ? 0.2 : 1;
      handle.rimCoreMat.opacity += (coreTarget - handle.rimCoreMat.opacity) * Math.min(1, delta * 3);
      handle.nameMat.opacity = out ? 0.25 : 1;

      // Name tags YAW toward the viewer but never roll or pitch — a tilted
      // head must never tilt the room's text. World yaw minus the seat's
      // baked platform yaw gives the tag's local turn.
      handle.nameTag.getWorldPosition(_tag);
      handle.nameTag.rotation.y =
        Math.atan2(match.headX - _tag.x, match.headZ - _tag.z) - handle.root.rotation.y;
    }

    // Podium choreography.
    if (match.screen === 'podium') {
      if (!this.podiumDone) {
        this.podiumDone = true;
        this.podiumT = 0;
        discoRig()?.popConfetti();
        sfx.matchEnd(match.players.find((p) => p.kind === 'local')?.rank === 1);
      }
      this.podiumT += delta;
      if (this.podiumT > PODIUM.holdSeconds) {
        this.podiumDone = false;
        // A tour night walks you back to the MAP (your new ✓ is waiting);
        // free-play walks back to the green room's PLAY board.
        if (match.tour) toTour();
        else toLobby();
      }
    } else {
      this.podiumDone = false;
    }
  }

  private recompute(): void {
    const order = standing();
    order.forEach((d, i) => {
      d.rank = i + 1;
    });

    const hash =
      match.screen + order.map((d) => `${d.seat}:${d.score}:${d.combo}:${d.alive ? 1 : 0}`).join('|');
    if (hash === this.lastHash) return;
    this.lastHash = hash;

    const me = match.players.find((p) => p.kind === 'local');
    const podium = match.screen === 'podium';
    const rows: BoardRow[] = [];
    const top = order.slice(0, 10);
    for (const d of top) rows.push(this.row(d, podium));
    if (me && !top.includes(me)) rows.push(this.row(me, podium));

    // No header at all — no "🏆 FINAL", no subtitle. The winner is already
    // rank 1 in gold wearing the night's letter, and the title strip sat
    // right where the mirror ball hangs.
    this.board.redraw(rows);
  }

  private row(d: Dancer, podium: boolean): BoardRow {
    const grade = podium ? gradeOf(d) : undefined;
    return {
      rank: d.rank,
      name: d.name,
      score: d.score,
      combo: d.combo,
      alive: d.alive,
      isMe: d.kind === 'local',
      colorCss: `#${hueToColor(d.hue, 0.62).toString(16).padStart(6, '0')}`,
      grade,
      gradeCss: grade ? (GRADE.colors[grade] ?? '#f0f3f8') : undefined,
    };
  }
}

const _head = new Vector3();
const _tag = new Vector3();
