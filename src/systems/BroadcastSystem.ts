/**
 * THE BROADCAST — one system that watches a bout from the outside and does
 * the two things the stat page needs (DESIGN.md §9):
 *
 *  THE TAPE: open net/telemetry.ts at the bell, sample your standing
 *     spot, notice rounds ending and the final off the match state, and
 *     close the tape with the result. The combat systems stamp the
 *     throws, hits and parries themselves at the moments they own.
 *
 * It never touches the sim: reads only, and everything it reads already
 * exists for the HUD. Runs after GameStateSystem so the match state it
 * reads is this frame's. A watcher on the terrace records nothing — they
 * didn't fight.
 *
 * IT NO LONGER BROADCASTS. This used to open a channel on the /tv relay
 * for every bout it ran — a pose frame five times a second and a rendered
 * picture three times a second — and FFTV carried the fight. That is off:
 * the channel FFTV shows is THE CLUB and nothing else now, which is a
 * decision about what the station is for rather than a limit of what it
 * can carry. The relay still understands channels and the stats page can
 * still draw one, so this is a few lines to put back if the fights should
 * be on television again.
 *
 * It also takes the broadcast's cost off the one person who could least
 * afford it. The picture was an extra render pass and a GPU readback
 * inside the frame of somebody being scored; the club's camera runs in a
 * room where nobody is fighting.
 */

import { createSystem, type Entity } from '@iwsdk/core';
import { Quaternion, Vector3 } from 'three';
import { app } from '../menu/appState.js';
import { match } from '../combat/matchState.js';
import { classicDuel, localLayout } from '../combat/layout.js';
import { opponents } from '../combat/opponentBus.js';
import { Combatant } from '../components/Combatant.js';
import { Health } from '../components/Health.js';
import { BallState, Fireball } from '../components/Fireball.js';
import { mesh } from '../net/mesh.js';
import { myName, rival } from '../net/leaderboard.js';
import { telemetry, type BoutKind } from '../net/telemetry.js';
import { titanView } from '../campaign/titanView.js';
import { TV } from '../config.js';

const _v = new Vector3();
const _rig = new Vector3();
const _q = new Quaternion();
const HANDS = ['left', 'right'] as const;
const r2 = (n: number): number => Math.round(n * 100) / 100;

export class BroadcastSystem extends createSystem({
  combatants: { required: [Combatant, Health] },
  balls: { required: [Fireball] },
}) {
  private wasPlaying = false;
  private lastPhase = '';
  private phaseAt = 0;
  private lastScore: [number, number] = [0, 0];
  private sampleT = 0;
  private tapeKind: BoutKind = 'solo';

  init(): void {
    // Readable headlessly: what's rolling, what's on air.
    const hook = (window as unknown as { __ff2?: Record<string, unknown> }).__ff2;
    if (hook) {
      hook.broadcast = {
        tape: () => telemetry.peek(),
        frame: () => this.buildFrame(),
      };
    }
  }

  update(delta: number): void {
    const playing = app.state === 'playing' && !app.spectating && !app.tutorial;
    if (playing && !this.wasPlaying) this.begin();
    else if (!playing && this.wasPlaying) this.end();
    this.wasPlaying = playing;
    if (!playing) return;

    this.trackHead();
    if (app.mode !== 'campaign') this.watchRounds();

    this.sampleT -= delta;
    if (this.sampleT <= 0) {
      this.sampleT = 1 / TV.sampleHz;
      telemetry.sample(telemetry.head.x, telemetry.head.z);
    }

  }

  /* ── the bell and the final ─────────────────────────────────────────── */

  private begin(): void {
    this.tapeKind = this.kind();
    telemetry.begin({
      kind: this.tapeKind,
      net: app.mode === 'net',
      quick: app.mode === 'net' && app.arcade === '1v1' && app.quickDuel,
      ranked: app.mode === 'net' && app.fromRanked,
    });
    this.lastPhase = match.phase;
    this.phaseAt = performance.now();
    this.lastScore = [match.myScore, match.oppScore];
    this.sampleT = 0;
  }

  private end(): void {
    telemetry.setNames(this.names());
    if (app.mode === 'campaign') {
      if (titanView.name) telemetry.setBoss(titanView.name, titanView.stage);
      // A campaign bout that reached a verdict posts; a bail is no tape.
      if (titanView.outcome) telemetry.end(titanView.outcome === 'victory', []);
      else telemetry.abort();
      return;
    }
    if (match.phase === 'matchOver') {
      const duel = classicDuel();
      const win = duel ? match.myScore > match.oppScore : match.roundWinnerTeam === 0;
      const score = duel ? [match.myScore, match.oppScore] : match.teamScores.slice(0, 4);
      telemetry.end(win, score);
    } else {
      telemetry.abort();
      }
  }

  /** Round ends and the final, read off the match state — works for the
   *  authority and for a guest alike (a guest's `match` is the host's echo). */
  private watchRounds(): void {
    const phase = match.phase;
    if (phase === this.lastPhase) return;
    const was = this.lastPhase;
    this.lastPhase = phase;
    const dur = (performance.now() - this.phaseAt) / 1000;
    this.phaseAt = performance.now();
    if (was !== 'playing' || (phase !== 'roundOver' && phase !== 'matchOver')) return;
    const duel = classicDuel();
    let out: 'win' | 'loss' | 'draw';
    if (duel) {
      const [m0, o0] = this.lastScore;
      out = match.myScore > m0 ? 'win' : match.oppScore > o0 ? 'loss' : 'draw';
      this.lastScore = [match.myScore, match.oppScore];
    } else {
      out = match.roundWinnerTeam === 0 ? 'win' : match.roundWinnerTeam < 0 ? 'draw' : 'loss';
    }
    const res = match.message.includes('KO') ? 'ko' : 'time';
    const [me, them] = this.pools();
    telemetry.round(match.round, out, res, me, them, dur);
  }

  /* ── what to call it ────────────────────────────────────────────────── */

  private kind(): BoutKind {
    if (app.mode === 'campaign') return app.campaignMode === 'raid' ? 'raid' : app.campaignMode === 'gauntlet' || app.campaignMode === 'hardcore' ? 'gauntlet' : 'solo';
    if (app.mode === 'net') return app.arcade;
    return 'solo';
  }

  /** Every fighter's callsign in slot order, me first — the HUD's law. */
  private names(): string[] {
    const duel = classicDuel();
    return this.actives()
      .map((e) => {
        const slot = e.getValue(Combatant, 'slot') ?? 0;
        const team = e.getValue(Combatant, 'team') ?? 0;
        if (slot === 0) return myName();
        if (app.mode === 'campaign') {
          const seat = localLayout()[slot]?.canonical;
          return (seat != null && mesh.names[seat]) || `RAIDER ${slot + 1}`;
        }
        if (duel) return app.mode === 'net' ? rival.name || 'RIVAL' : 'BOT';
        if (app.mode === 'net') {
          const seat = localLayout()[slot]?.canonical;
          return (seat != null && mesh.names[seat]) || (team === 0 ? 'ALLY' : 'BOT');
        }
        return team === 0 ? 'ALLY' : 'BOT';
      })
      .map((n) => n.slice(0, 16));
  }

  /* ── the frame ──────────────────────────────────────────────────────── */

  private actives(): Entity[] {
    const out: Entity[] = [];
    for (const e of this.queries.combatants.entities) {
      if ((e.getValue(Combatant, 'active') ?? 0) === 1) out.push(e);
    }
    return out.sort((a, b) => (a.getValue(Combatant, 'slot') ?? 0) - (b.getValue(Combatant, 'slot') ?? 0));
  }

  /** [my pool, the other side's pool] as fractions of full. */
  private pools(): [number, number] {
    let me = 0;
    let them = 0;
    let themMax = 0;
    for (const e of this.actives()) {
      const hp = e.getValue(Health, 'current') ?? 0;
      const max = e.getValue(Health, 'max') ?? 100;
      if ((e.getValue(Combatant, 'slot') ?? 0) === 0) me = (hp / max) * 100;
      else if ((e.getValue(Combatant, 'team') ?? 0) !== 0) {
        them += hp;
        themMax += max;
      }
    }
    return [me, themMax ? (them / themMax) * 100 : 0];
  }

  /** My head, platform-local, kept fresh for the tape's hit stamps. */
  private trackHead(): void {
    const head = this.playerHeadEntity?.object3D;
    const rig = this.playerEntity?.object3D;
    if (!head) return;
    head.getWorldPosition(_v);
    if (rig) {
      rig.getWorldPosition(_rig);
      _v.sub(_rig);
    }
    telemetry.head.x = _v.x;
    telemetry.head.z = _v.z;
  }

  private buildFrame(): Record<string, unknown> {
    const duel = classicDuel();
    const layout = localLayout();
    const p: unknown[] = [];
    const names = this.names();
    const rig = this.playerEntity?.object3D;
    if (rig) rig.getWorldPosition(_rig);
    else _rig.set(0, 0, 0);
    const local = (v: Vector3): number[] => [r2(v.x - _rig.x), r2(v.y - _rig.y), r2(v.z - _rig.z)];
    this.actives().forEach((e, i) => {
      const slot = e.getValue(Combatant, 'slot') ?? 0;
      const team = e.getValue(Combatant, 'team') ?? 0;
      const hp = (e.getValue(Health, 'current') ?? 0) / (e.getValue(Health, 'max') ?? 100);
      const seat = layout[slot];
      const pl = seat ? [r2(seat.pos[0]), r2(seat.pos[2]), r2(seat.yaw)] : [0, 0, 0];
      let h: number[] = [0, 1.5, 0];
      let l: number[] = [-0.2, 1.1, -0.2];
      let r: number[] = [0.2, 1.1, -0.2];
      let yaw = 0;
      if (slot === 0) {
        const head = this.playerHeadEntity?.object3D;
        if (head) {
          head.getWorldPosition(_v);
          h = local(_v);
          head.getWorldQuaternion(_q);
          _v.set(0, 0, -1).applyQuaternion(_q);
          yaw = Math.atan2(-_v.x, -_v.z);
        }
        for (let hand = 0; hand < 2; hand++) {
          const grip = this.world.playerSpaceEntities.gripSpaces[HANDS[hand]]?.object3D;
          if (!grip) continue;
          grip.getWorldPosition(_v);
          if (hand === 0) l = local(_v);
          else r = local(_v);
        }
      } else {
        const pose = opponents[slot - 1];
        if (pose) {
          h = [r2(pose.headPos.x), r2(pose.headPos.y), r2(pose.headPos.z)];
          l = [r2(pose.handPos[0].x), r2(pose.handPos[0].y), r2(pose.handPos[0].z)];
          r = [r2(pose.handPos[1].x), r2(pose.handPos[1].y), r2(pose.handPos[1].z)];
          _v.set(0, 0, -1).applyQuaternion(pose.headQuat);
          yaw = Math.atan2(-_v.x, -_v.z);
        }
      }
      p.push({ n: names[i] ?? '', t: team, hp: Math.round(hp * 100) / 100, h, l, r, yaw: r2(yaw), pl });
    });

    const b: number[][] = [];
    for (const ball of this.queries.balls.entities) {
      const obj = ball.object3D;
      if (!obj) continue;
      const state = ball.getValue(Fireball, 'state') ?? 0;
      if (state === BallState.Dead || state === BallState.Hover) continue;
      obj.getWorldPosition(_v);
      b.push([ball.getValue(Fireball, 'owner') ?? 0, r2(_v.x - _rig.x), r2(_v.y - _rig.y), r2(_v.z - _rig.z), state, r2(ball.getValue(Fireball, 'radius') ?? 0.09)]);
    }

    const f: Record<string, unknown> = { p, b };
    if (app.mode === 'campaign') {
      f.ph = titanView.phase;
      f.boss = { n: titanView.name, hp: Math.round(titanView.hp * 100) / 100, st: titanView.stage, x: r2(titanView.x), y: r2(titanView.y), z: r2(titanView.z) };
      f.msg = titanView.outcome ? titanView.outcome.toUpperCase() : '';
    } else {
      f.ph = match.phase;
      f.rd = match.round;
      f.tm = Math.max(0, Math.round(match.roundTimer));
      f.sc = duel ? [match.myScore, match.oppScore] : match.teamScores.slice(0, 4);
      f.msg = match.message;
    }
    return f;
  }
}
