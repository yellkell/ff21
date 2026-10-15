/**
 * ChoreoSystem — the raid itself. Runs the deterministic set-list against
 * the live beat clock:
 *
 *   telegraphBeat → hazard shapes bloom on EVERY live platform at once,
 *   filling as the landing approaches (the fill IS the countdown), while the
 *   GOOPLIATH winds up the matching gesture on the centre stage;
 *
 *   landBeat → the zones detonate on the downbeat: strike FX on every deck,
 *   one shared sound, and a judgement per dancer — the local player by their
 *   real tracked body, the groupies by seeded rolls every client computes
 *   identically, the remote humans by their own report (never guessed here).
 *
 * Also owns the score/combo/miss-chain bookkeeping and the end of the set
 * (song out; or one dancer left standing, which decides a tour night or a
 * club ring but never cuts a solo record short).
 */

import { createSystem } from '@iwsdk/core';
import { BOTS, CHOREO, GRADE, MOVES, SCORE, countInBeatsFor, type MoveKind } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { breakBeats, trackById } from '../audio/tracks.js';
import { platformRoot } from '../arena/arena.js';
import { RoutineBlockfall } from '../choreo/blockfall.js';
import { StrikeFx } from '../choreo/strikes.js';
import {
  beamTelegraph,
  xTelegraph,
  donutTelegraph,
  gateTelegraph,
  halfTelegraph,
  novaTelegraph,
  quarterTelegraph,
  railTelegraph,
  routineMarksTelegraph,
  sweepTelegraph,
  type Telegraph,
} from '../choreo/telegraphs.js';
import { chartChargeBeats, generateSetlist, type SetMove, type Zone } from '../choreo/setlist.js';
import { grooveView } from './PlayerSystem.js';
import { finishRaid } from '../game/flow.js';
import { roll } from '../game/rng.js';
import { seatBearing, seatIsNear } from '../game/ring.js';
import {
  aliveCount,
  barBeats,
  dancerAtSeat,
  match,
  pushFlair,
  setEndBeat,
  type Dancer,
  type GestureCue,
} from '../game/state.js';
import {
  OCTAGON_HALF_DEPTH,
  OCTAGON_HALF_WIDTH,
} from '../config.js';

export interface LiveZone {
  moveIdx: number;
  landingIdx: number;
  seat: number;
  zone: Zone;
  kind: MoveKind;
  act: number;
  tgStartBeat: number;
  dueBeat: number;
  tg: Telegraph | null;
  probed: boolean;
  wasInside: boolean;
  resolved: boolean;
  /** THE ROUTINE's falling blocks (per seat, per step) — the DOWN-style
   *  descent that made the move readable. Lives past resolve for its crush. */
  blocks?: RoutineBlockfall;
}

/** Read-only window for other systems (bot movement mirrors the judging) —
 *  plus a dev hook: `__gdr.choreo.dropRoutine()` injects a routine NOW so the
 *  blockfall can be seen without waiting for the set-list to roll one. */
export const choreoView: {
  zones: readonly LiveZone[];
  dropRoutine?: () => void;
  /** Dev: throw THE TRAP now — both side rails on one beat. */
  dropTrap?: () => void;
  /** Dev: throw THE TWIN AND ITS RETURN now — a shoulder-to-shoulder pair
   *  taking one half, then the mirrored pair a bar later. axis 0 = lateral
   *  beams (across and back), axis 1 = rails (front/back); `side` picks
   *  which half goes up first. */
  dropTwin?: (axis?: 0 | 1, side?: 1 | -1) => void;
  /** Dev: throw DUCK DONUT now — the blade and the closing rim together. */
  dropDuckDonut?: () => void;
  /** Dev: throw THE X now — two diagonal beams crossing dead centre. */
  dropX?: () => void;
  /** Dev: drop a gate now (axis 1 = the horizontal cousin, a clear row). */
  dropGate?: (axis?: 0 | 1) => void;
  /** Dev: throw THE PIE now at `bearing` (world radians). */
  dropNova?: (bearing?: number) => void;
  /** Dev: march THE WAVE now (axis 1 = front/back; back=false skips the turn). */
  dropWave?: (axis?: 0 | 1, back?: boolean) => void;
} = { zones: [] };

const HEAD_R = 0.1; // projected head radius for floor-zone tests

function angDist(a: number, b: number): number {
  return Math.abs(((a - b + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
}

/** Which local-x side a sweep enters from — alternates deterministically so
 *  every client cuts the same way and back-to-back sweeps cross over. The
 *  TELEGRAPH mirrors to this too (its fill runs from the entry side), so the
 *  charge already tells a veteran which way the blade will travel. */
function sweepSide(moveIdx: number, landingIdx: number): 1 | -1 {
  return (moveIdx + landingIdx) % 2 === 0 ? 1 : -1;
}

/** The directional payload a gesture cue carries so the MC's body can ACT
 *  the move out (zones are platform-local and identical for every seat, so
 *  one giant's mime is honest for the whole ring). */
function cueDirection(kind: MoveKind, zone: Zone, moveIdx: number, landingIdx: number): Partial<GestureCue> {
  if (kind === 'wave') {
    // The march: the FIRST cue carries the start side so the MC's count
    // begins on the right hand; step cues stay silent on side and let his
    // steps counter walk the arm across.
    const axis = zone.kind === 'rail' ? 1 : 0;
    const at = zone.kind === 'rail' ? zone.z : zone.kind === 'lane' ? zone.x : 0;
    return landingIdx === 0 ? { side: Math.sign(at) || 1, axis } : { axis };
  }
  switch (zone.kind) {
    case 'lane':
      // THE X leads with a spun arm — the MC's sticks cross for it.
      return zone.yaw ? { crossed: true } : {};
    case 'sweep':
      return { side: sweepSide(moveIdx, landingIdx) };
    case 'half':
      return { side: zone.side, axis: zone.axis };
    case 'gate':
      return { gapX: zone.at, axis: zone.axis };
    case 'quad':
      // The whole routine travels with the cue: the boss teaches it by
      // pointing each corner out while the marks are still lit.
      return { routine: zone.routine };
    case 'rail':
      // Which rail threw it (so the MC shoots from that side), and whether
      // the near or far ground is the doomed one (so his body says which
      // way to move) — the surge's front/back grammar, borrowed.
      return { side: zone.from, axis: zone.z > 0 ? 1 : 0 };
    default:
      return {};
  }
}

export class ChoreoSystem extends createSystem({}) {
  private generation = -1;
  private setlist: SetMove[] = [];
  private nextMove = 0;
  /** Dev drops only: a unique move index per injected move. */
  private devDrops = 0;
  private zones: LiveZone[] = [];
  /** Blockfalls playing out their landing crush after their zone resolved. */
  private crushing: RoutineBlockfall[] = [];
  private strikes = new StrikeFx();
  private lastBar = -1;
  private landedSfx = new Set<string>();
  private cuedSteps = new Set<string>();
  private ended = false;
  /** Is this chart running EXPERT double time? Decides which pace tables
   *  the windows below read (set in rebuild, from the same shared inputs
   *  every client holds). */
  private doubleTime = false;

  init(): void {
    this.strikesRoot();
    // Dev: drop a routine RIGHT NOW (blockfall inspection without waiting
    // for the set-list to roll one). Harmless outside a live set.
    choreoView.dropRoutine = () => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const land = tele + MOVES.routine.chargeBeats;
      const routine = [0, 3, 1] as const;
      this.begin({
        index: 9000 + this.nextMove,
        kind: 'routine',
        telegraphBeat: tele,
        landBeat: land,
        act: 2,
        landings: routine.map((corner, step) => ({
          beat: land + step * CHOREO.routineStepBeats,
          zone: { kind: 'quad', corner, step, routine },
        })),
      });
    };
    choreoView.dropX = () => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const land = tele + MOVES.beam.chargeBeats;
      this.begin({
        index: 9800 + this.nextMove,
        kind: 'beam',
        telegraphBeat: tele,
        landBeat: land,
        act: 3,
        landings: [
          { beat: land, zone: { kind: 'lane', x: 0, halfW: CHOREO.beamXHalfW, yaw: Math.PI / 4 } },
          { beat: land, zone: { kind: 'lane', x: 0, halfW: CHOREO.beamXHalfW, yaw: -Math.PI / 4 } },
        ],
      });
    };
    choreoView.dropWave = (axis = 0, back = true) => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const land = tele + MOVES.wave.chargeBeats;
      const step = CHOREO.waveStepBeats[2];
      const stops = axis ? CHOREO.waveRailZ : CHOREO.waveLaneX;
      const at: number[] = [...stops].slice(0, -1); // exit = the far quarter
      const beats: number[] = at.map((_, i) => land + i * step);
      if (back) {
        const turnAt = beats[beats.length - 1] + step * 2 + CHOREO.waveTurnExtraBeats;
        [stops[3], stops[2], stops[1]].forEach((stop, i) => {
          at.push(stop);
          beats.push(turnAt + i * step);
        });
      }
      this.begin({
        index: 9950 + this.nextMove,
        kind: 'wave',
        telegraphBeat: tele,
        landBeat: land,
        act: 2,
        landings: at.map((stop, i) => ({
          beat: beats[i],
          zone: axis
            ? ({ kind: 'rail', z: stop, halfD: CHOREO.railHalfDepth, from: 1 } as const)
            : ({ kind: 'lane', x: stop, halfW: CHOREO.beamHalfWidth } as const),
        })),
      });
    };
    choreoView.dropNova = (bearing = 0.8) => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const land = tele + MOVES.nova.chargeBeats;
      this.begin({
        index: 9970 + this.nextMove,
        kind: 'nova',
        telegraphBeat: tele,
        landBeat: land,
        act: 2,
        landings: [
          { beat: land, zone: { kind: 'nova', bearing, halfAngle: CHOREO.novaHalfAngle } },
        ],
      });
    };
    choreoView.dropGate = (axis = 1) => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const land = tele + MOVES.gate.chargeBeats;
      this.begin({
        index: 9900 + this.nextMove,
        kind: 'gate',
        telegraphBeat: tele,
        landBeat: land,
        act: 2,
        landings: [
          { beat: land, zone: { kind: 'gate', at: axis ? 0.2 : 0.3, half: CHOREO.gateHalfW, axis } },
        ],
      });
    };
    choreoView.dropTrap = () => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const land = tele + MOVES.cross.chargeBeats;
      this.begin({
        index: 9600 + this.nextMove,
        kind: 'cross',
        telegraphBeat: tele,
        landBeat: land,
        act: 3,
        landings: [
          { beat: land, zone: { kind: 'rail', z: -CHOREO.railTrapZ, halfD: CHOREO.railHalfDepth, from: -1 } },
          { beat: land, zone: { kind: 'rail', z: CHOREO.railTrapZ, halfD: CHOREO.railHalfDepth, from: 1 } },
        ],
      });
    };
    choreoView.dropTwin = (axis = 0, side = 1) => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const kind = axis ? 'cross' : 'beam';
      const land = tele + MOVES[kind].chargeBeats;
      const back = land + CHOREO.twinReturnBeats;
      const inner = axis ? CHOREO.railTwinInner : CHOREO.beamTwinInner;
      const span = axis ? CHOREO.railHalfDepth : CHOREO.beamHalfWidth;
      const outer = inner + span * 2 + 0.02;
      const pair = (beat: number, s: number, from: 1 | -1) =>
        [inner, outer].map((at) => ({
          beat,
          zone: axis
            ? ({ kind: 'rail', z: s * at, halfD: span, from } as const)
            : ({ kind: 'lane', x: s * at, halfW: span } as const),
        }));
      this.begin({
        // A counter, not `nextMove`: two drops between set-list moves would
        // otherwise share an index, and the zone bookkeeping is keyed on it.
        index: 9500 + (this.devDrops++ % 100),
        kind,
        telegraphBeat: tele,
        landBeat: land,
        act: 3,
        landings: [...pair(land, side, 1), ...pair(back, -side, -1)],
      });
    };
    choreoView.dropDuckDonut = () => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const land = tele + MOVES.duckdonut.chargeBeats;
      this.begin({
        index: 9700 + this.nextMove,
        kind: 'duckdonut',
        telegraphBeat: tele,
        landBeat: land,
        act: 3,
        landings: [
          { beat: land, zone: { kind: 'sweep' } },
          // The combination's disc is expert's tight one wherever it deals
          // (setlist.ts serves the same), so the drop rehearses the real move.
          { beat: land, zone: { kind: 'donut', innerR: CHOREO.donutInnerRExpert } },
        ],
      });
    };
  }

  private strikesRoot(): void {
    // StrikeFx spawns under platform roots; nothing to pre-build.
  }

  private rebuild(): void {
    this.generation = match.generation;
    for (const z of this.zones) {
      z.tg?.dispose();
      z.blocks?.dispose();
    }
    for (const b of this.crushing) b.dispose();
    this.crushing = [];
    this.zones = [];
    this.nextMove = 0;
    this.lastBar = -1;
    this.landedSfx.clear();
    this.cuedSteps.clear();
    this.ended = false;
    // A record's bans: the ones it always carries, plus the ones that only
    // hold on an authored campaign night.
    const record = trackById(match.trackId);
    const banned = [...(record?.banned ?? []), ...(match.tour ? (record?.tourBanned ?? []) : [])];
    // mountTrack settled the chart's clock (and match.doubleTime with it)
    // from the same shared inputs every client holds, so a room's charts
    // agree on the pace as surely as they agree on the seed.
    this.doubleTime = match.doubleTime;
    // And its breaks: the chart rests wherever the record drops out.
    const breaks = record ? breakBeats(record, countInBeatsFor(match.bpm), match.bpm) : [];
    this.setlist = generateSetlist(match.seed, match.phrases, banned, match.difficulty, this.doubleTime, breaks);
  }

  update(delta: number): void {
    this.strikes.update(delta);

    const inSet = match.screen === 'countdown' || match.screen === 'raid';
    if (!inSet) {
      if (this.zones.length) {
        for (const z of this.zones) {
          z.tg?.dispose();
          z.blocks?.dispose();
        }
        this.zones = [];
      }
      if (this.crushing.length) {
        for (const b of this.crushing) b.dispose();
        this.crushing = [];
      }
      return;
    }
    if (this.generation !== match.generation) this.rebuild();
    if (!match.playing) return;

    const beat = match.beat;
    const time = performance.now() / 1000;

    // Survival trickle: every bar, every dancer still on the floor.
    if (match.screen === 'raid') {
      const bar = Math.floor(beat / barBeats());
      if (bar !== this.lastBar && beat >= 0) {
        this.lastBar = bar;
        for (const p of match.players) if (p.alive) p.score += SCORE.aliveBarBonus;
      }
    }

    // New telegraphs due?
    while (this.nextMove < this.setlist.length && this.setlist[this.nextMove].telegraphBeat <= beat) {
      const move = this.setlist[this.nextMove];
      // THE WAVE, aimed (solo only): too often the seed's coin flip put
      // the exit on the quarter the dancer already held, and the whole
      // out-leg asked nothing. Solo has one dancer, so the march can start
      // from THEIR side — first strike at their end, exit across the deck,
      // the crossing always a real crossing. Online charts stay pure seed:
      // every seat must agree with the one giant's mime.
      if (move.kind === 'wave' && !match.online) this.aimWave(move);
      this.begin(move);
      this.nextMove++;
    }

    // Follow-up gestures: a multi-landing move keeps the GOOPLIATH swinging
    // — every later landing gets its own quick strike cued a couple of beats
    // out, so the boss's body telegraphs the WHOLE cascade, not just its
    // opening. (Keyed per landing, not per seat — one giant, one swing.)
    const beatScale = this.doubleTime ? 2 : 1; // windows in the RECORD's beats
    for (const z of this.zones) {
      if (z.resolved || z.landingIdx === 0) continue;
      const lead = z.dueBeat - beat;
      if (lead > 2 * beatScale || lead <= 0) continue;
      const key = `${z.moveIdx}:${z.landingIdx}`;
      if (this.cuedSteps.has(key)) continue;
      this.cuedSteps.add(key);
      match.gestures.push({ kind: z.kind, chargeBeats: lead, step: true, ...cueDirection(z.kind, z.zone, z.moveIdx, z.landingIdx), dueBeat: z.dueBeat });
    }

    // THE ROUTINE CALLS NOTHING. It used to knock a beat ahead of every
    // step; it doesn't now, because the move is already telling you —
    // the taught marks carry their step numbers, and the blocks are
    // visibly falling for two beats before they land. The only sound it
    // makes is those blocks arriving (sfx.quadCrash, with the strikes
    // below), which is the event rather than a cue for it.

    // Advance live zones.
    for (const z of this.zones) {
      if (z.resolved) continue;
      const span = Math.max(0.001, z.dueBeat - z.tgStartBeat);
      const fill = Math.min(1, Math.max(0, (beat - z.tgStartBeat) / span));
      if (z.tg) {
        z.tg.update(fill, time);
        // A chained pie stays OFF the floor until its own window opens —
        // the next disc appears exactly as the previous one detonates, so
        // there is only ever ONE pie to read. (No-op for ordinary zones:
        // their window opens with the move's telegraph.)
        z.tg.group.visible = beat >= z.tgStartBeat;
        // The seesaw shows only the imminent pane and the one after — five
        // at once reads as noise, two reads as "THIS side now, THAT next".
        if (z.zone.kind === 'half') z.tg.group.visible = z.dueBeat - beat < 4.2;
      }
      // The perfect probe: were you still in the fire one beat out? "One
      // beat" means one beat OF THE RECORD — on a doubled grid that is
      // two chart beats, or a slow song's perfects would need twice the
      // reflexes of a fast one's.
      const probeBeats = this.doubleTime ? SCORE.perfectProbeBeats * 2 : SCORE.perfectProbeBeats;
      if (!z.probed && z.seat === match.mySeat && beat >= z.dueBeat - probeBeats) {
        z.probed = true;
        z.wasInside = this.touchesLocal(z);
      }
      // THE ROUTINE's blocks ride the same clock as everything else.
      z.blocks?.update(beat, delta);
      if (beat >= z.dueBeat) this.resolve(z);
    }
    this.zones = this.zones.filter((z) => !z.resolved);
    choreoView.zones = this.zones;

    // Landed blockfalls finish their crush, then go.
    for (const b of this.crushing) b.update(beat, delta);
    this.crushing = this.crushing.filter((b) => {
      if (!b.spent) return true;
      b.dispose();
      return false;
    });

    // End of the set.
    if (match.screen === 'raid' && !this.ended) {
      // The closer lands on the final downbeat. One bar lets its strike and
      // flair finish, then the result arrives — never two bars of empty
      // groove after an ending that has already happened.
      const songOver = beat >= setEndBeat() + barBeats();
      // THE FLOOR CLEARED — last dancer standing, so the night is decided.
      // It ends the record on THE TOUR and on a club ring, where outlasting
      // the room IS the win and everyone is waiting on the result.
      //
      // SOLO FREE PLAY is the exception: you went to the shelf and picked
      // that record to dance it, and the groupies falling early is their
      // business, not a reason to take the rest of your song away — with it
      // went the back half of the chart, the last stretch of your grade and
      // any run at the board. The set plays out; you dance it alone.
      const decided = match.online || match.tour !== null;
      const floorCleared = decided && match.seats > 1 && aliveCount() <= 1 && beat > 0;
      // GAME OVER: the chain took you out. On your own that's the end of
      // the record — go and read the letter, don't watch bots finish it.
      // With friends on the ring the set plays on and you spectate: their
      // night isn't over because yours is.
      const mine = match.players.find((p) => p.kind === 'local');
      const online = match.players.some((p) => p.kind === 'remote');
      const gameOver =
        !online && mine !== undefined && !mine.alive && beat >= mine.elimAtBeat + GRADE.overBeats;
      if (songOver || floorCleared || gameOver) {
        this.ended = true;
        finishRaid();
      }
    }
  }

  /** A move starts telegraphing: zones + shapes on every live platform, and
   *  the GOOPLIATH's wind-up gesture on the stage. */
  private begin(move: SetMove): void {
    const first = move.landings[0];
    // The wind-up is whatever the CHART says it is — a double-time move
    // stretches its read (see doubleTimePace.chargeBeats), and the MC's
    // gesture and the charge drone must span that same window, so both
    // are read off the move rather than the standard table.
    const chargeBeats = move.landBeat - move.telegraphBeat;
    match.gestures.push({
      kind: move.kind,
      chargeBeats,
      ...(first ? cueDirection(move.kind, first.zone, move.index, 0) : {}),
      dueBeat: first?.beat,
    });
    sfx.gooCharge(chargeBeats * match.beatLen * 0.9);

    // Same landing, same clock: build its GPU resources once for the ring.
    // Nova remains per seat because its safe wedge uses a world bearing.
    const sharedTelegraphs = new Map<string, Telegraph | null>();
    for (const dancer of match.players) {
      if (!dancer.alive) continue;
      // Remote platforms still get the show — judgement stays theirs.
      const parent = platformRoot(dancer.seat);
      if (!parent) continue;
      // ...but not the FINE show. A deck past seatIsNear() stands ten-plus
      // metres off, where the strike's props are a few pixels and its
      // sparks are sub-pixel; the telegraph pane still marks it, so the
      // ring still reads as one arena under one attack. Nothing here is
      // load-bearing: remote clients judge themselves and bots are judged
      // from positions, so what a far deck DRAWS changes no outcome.
      const near = seatIsNear(match.mySeat, dancer.seat, match.seats);
      move.landings.forEach((landing, landingIdx) => {
        let tg: Telegraph | null;
        const variant = landing.zone.kind === 'sweep' && dancer.seat === match.mySeat ? 'local' : 'ring';
        const sharedKey = `${landingIdx}:${variant}`;
        if (landing.zone.kind !== 'nova' && sharedTelegraphs.has(sharedKey)) {
          tg = sharedTelegraphs.get(sharedKey)?.fork() ?? null;
        } else {
          tg = this.buildTelegraph(landing.zone, dancer.seat, move.index, landingIdx);
          if (landing.zone.kind !== 'nova') sharedTelegraphs.set(sharedKey, tg);
        }
        if (tg) parent.add(tg.group);
        // Staged shapes open their own telegraph window instead of riding
        // the move's: a chained pie appears exactly as the last one goes
        // off, and the donut's ring waits for its opening laser to fire —
        // one shape to read at a time, always. THE WAVE is the deliberate
        // exception: every stop telegraphs on its own staggered fuse, so
        // the deck reads as a march building 1-2-3-4.
        //
        // "As the last one goes off" is read from the MOVE ITSELF — the
        // latest landing strictly before this one — rather than rebuilt
        // from the pacing constants, so it stays true whichever table
        // spaced the cascade (a double-time chart stretches these gaps;
        // see CHOREO.doubleTimePace).
        const prevFire = (beat: number): number => {
          let best = -Infinity;
          for (const l of move.landings) if (l.beat < beat && l.beat > best) best = l.beat;
          return Number.isFinite(best) ? best : move.telegraphBeat;
        };
        const tgStartBeat =
          move.kind === 'wave'
            ? landing.beat - chargeBeats // each stop runs the wave's own fuse, staggered
            : move.kind === 'routine' && landing.zone.kind === 'sweep'
              ? landing.beat - chartChargeBeats('sweep', this.doubleTime) // the swept routine: one blade per tick, staggered
              : landing.zone.kind === 'nova' && landingIdx > 0
                ? prevFire(landing.beat)
                : landing.zone.kind === 'donut' && landingIdx > 0
                  ? prevFire(landing.beat)
                  : // THE TWIN'S RETURN (beam or crossfire): the answering pair
                    // holds off the floor until the first pair actually fires,
                    // so you never read four strips at once — one shape, the
                    // crossing, then the next shape.
                    (move.kind === 'beam' || move.kind === 'cross') && landing.beat > move.landBeat
                    ? prevFire(landing.beat)
                    : move.telegraphBeat;
        // THE ROUTINE's danger is DOWN blocks descending from above — one
        // per doomed quarter, beat-locked so the landing is the downbeat.
        // Fifteen drawables a deck, the priciest thing an attack builds, so
        // the far ring reads its quarter marks and skips the masonry.
        const blocks =
          landing.zone.kind === 'quad' && near
            ? new RoutineBlockfall(
                parent,
                landing.zone.corner,
                landing.beat,
                match.seed,
                move.index,
                landing.zone.step,
                this.doubleTime ? CHOREO.doubleTimePace.routineDropBeats : CHOREO.routineDropBeats,
              )
            : undefined;
        this.zones.push({
          moveIdx: move.index,
          landingIdx,
          seat: dancer.seat,
          zone: landing.zone,
          kind: move.kind,
          act: move.act,
          tgStartBeat,
          dueBeat: landing.beat,
          tg,
          probed: false,
          wasInside: false,
          resolved: false,
          blocks,
        });
      });
    }
  }

  /** Rewrite a wave's stops so the march starts on the local dancer's side
   *  of the deck. The beat scaffold (stagger, the turn) is untouched — only
   *  which stop fires when: out over their three, exit far, back again. */
  private aimWave(move: SetMove): void {
    if (move.landings.length !== 6) return; // dev one-way drops stay as thrown
    const first = move.landings[0].zone;
    const axis = first.kind === 'rail' ? 1 : 0;
    const stops = axis ? CHOREO.waveRailZ : CHOREO.waveLaneX;
    const pos = axis ? match.headZ : match.headX;
    const ordered = pos >= 0 ? [...stops].reverse() : [...stops];
    const seq = [ordered[0], ordered[1], ordered[2], ordered[3], ordered[2], ordered[1]];
    move.landings.forEach((landing, i) => {
      if (landing.zone.kind === 'rail') landing.zone.z = seq[i];
      else if (landing.zone.kind === 'lane') landing.zone.x = seq[i];
    });
  }

  private buildTelegraph(zone: Zone, seat: number, moveIdx: number, landingIdx: number): Telegraph | null {
    switch (zone.kind) {
      case 'lane': {
        if (zone.yaw) {
          // THE X, drawn whole: both arms come as a ± yaw pair in one move,
          // so the POSITIVE arm carries the single combined pane (scrim,
          // union-edge rails, the knot) and its twin draws nothing. Two
          // spun strips used to double-blend at the crossing into a blob.
          // Judgement is untouched — both zones still cut their own lane.
          if (zone.yaw < 0) return null;
          const tg = xTelegraph(zone.halfW);
          tg.group.position.y = 0.05;
          return tg;
        }
        const tg = beamTelegraph(zone.halfW, OCTAGON_HALF_DEPTH * 2 + 0.8);
        // Strip runs down local −Z (toward the stage); origin at the near edge.
        tg.group.position.set(zone.x, 0.05, OCTAGON_HALF_DEPTH + 0.4);
        return tg;
      }
      case 'sweep': {
        const tg = sweepTelegraph(
          OCTAGON_HALF_WIDTH * 2 + 0.5,
          OCTAGON_HALF_DEPTH * 2 + 0.3,
          CHOREO.sweepY,
          CHOREO.sweepThickness,
          sweepSide(moveIdx, landingIdx),
          seat === match.mySeat,
        );
        return tg;
      }
      case 'half': {
        const halfW = (zone.axis ? OCTAGON_HALF_DEPTH : OCTAGON_HALF_WIDTH) + 0.35;
        const depth = (zone.axis ? OCTAGON_HALF_WIDTH : OCTAGON_HALF_DEPTH) * 2 + 0.3;
        const tg = halfTelegraph(zone.side, halfW, depth);
        tg.group.position.y = 0.05;
        // The z-split reuses the x-split pane a quarter-turn round; −90° so
        // the +x-authored pane lands on the +z half (see FIRE FIGHT's note).
        if (zone.axis) tg.group.rotation.y = -Math.PI / 2;
        return tg;
      }
      case 'gate': {
        const tg = gateTelegraph(OCTAGON_HALF_WIDTH, OCTAGON_HALF_DEPTH, zone.at, zone.half, zone.axis);
        tg.group.position.y = 0.05;
        return tg;
      }
      case 'rail': {
        const tg = railTelegraph(zone.halfD, OCTAGON_HALF_WIDTH * 2 + 0.8, zone.from);
        tg.group.position.set(0, 0.05, zone.z);
        return tg;
      }
      case 'nova': {
        const local = zone.bearing - seatBearing(seat, match.seats);
        const tg = novaTelegraph(CHOREO.novaRadius, local, zone.halfAngle);
        tg.group.position.y = 0.05;
        return tg;
      }
      case 'donut': {
        const tg = donutTelegraph(CHOREO.donutRadius, zone.innerR);
        tg.group.position.y = 0.05;
        return tg;
      }
      case 'quad': {
        // Two shapes across the whole move, and neither belongs to a single
        // step: the LESSON (hung on step one, so its fade rides that step's
        // charge and it is gone before the first block) and the QUARTER
        // LINES (hung on the last step, so they outlive every landing).
        // The steps in between draw nothing — that's the memory test.
        if (zone.step === 0) {
          const tg = routineMarksTelegraph(zone.routine, OCTAGON_HALF_WIDTH, OCTAGON_HALF_DEPTH);
          tg.group.position.y = 0.05;
          return tg;
        }
        if (zone.step === zone.routine.length - 1) {
          const tg = quarterTelegraph(OCTAGON_HALF_WIDTH, OCTAGON_HALF_DEPTH);
          tg.group.position.y = 0.048;
          return tg;
        }
        return null;
      }
    }
  }

  /** Does the local player's tracked body touch a zone RIGHT NOW? */
  private touchesLocal(live: LiveZone): boolean {
    const zone = live.zone;
    const x = match.headX;
    const z = match.headZ;
    switch (zone.kind) {
      case 'lane': {
        // A yawed lane (THE X's arm) judges on the perpendicular distance
        // to its own run — yaw 0 collapses to the plain |x − offset| test.
        const yaw = zone.yaw ?? 0;
        const perp = yaw ? Math.cos(yaw) * x - Math.sin(yaw) * z : x;
        return Math.abs(perp - zone.x) <= zone.halfW + HEAD_R * 0.7;
      }
      case 'rail':
        return Math.abs(z - zone.z) <= zone.halfD + HEAD_R * 0.7;
      case 'sweep':
        return !match.ducked;
      case 'half': {
        const along = zone.axis === 1 ? z : x;
        return along * zone.side > CHOREO.seesawSafeLip;
      }
      case 'gate':
        // Danger is everywhere EXCEPT the band — be in the gap.
        return Math.abs((zone.axis ? z : x) - zone.at) > zone.half;
      case 'donut':
        // Same forgiveness as the wedge: the head reaching the middle is
        // the dodge, heels or no heels.
        return Math.hypot(x, z) > zone.innerR + HEAD_R * 0.5;
      case 'quad': {
        // You have to be COMMITTED into the learned quarter — hovering on
        // the lines would otherwise satisfy every corner at once.
        const sx = zone.corner & 1 ? 1 : -1;
        const sz = zone.corner & 2 ? 1 : -1;
        return !(x * sx >= CHOREO.routineMargin && z * sz >= CHOREO.routineMargin);
      }
      case 'nova': {
        // Judged on the head alone, forgiving by design (reached the wedge =
        // safe, even if your heels trail).
        if (Math.hypot(x, z) < 0.12) return true; // dead centre is never safe ground
        const ang = Math.atan2(x, z);
        const local = zone.bearing - seatBearing(match.mySeat, match.seats);
        return angDist(ang, local) > zone.halfAngle;
      }
    }
  }

  private resolve(z: LiveZone): void {
    z.resolved = true;
    z.tg?.dispose();
    z.tg = null;
    if (z.blocks) {
      // The crush plays out past the zone's death, then disposes itself.
      z.blocks.land();
      this.crushing.push(z.blocks);
      z.blocks = undefined;
    }

    const parent = platformRoot(z.seat);
    const dancer = dancerAtSeat(z.seat);
    // Detonate in full only where it can be seen. The far ring's strike is
    // where the frame actually spikes — two dozen decks each newing a spark
    // pool that opts OUT of frustum culling, then integrating its particles
    // in JS and re-uploading the buffer every frame, all on the one beat
    // you most need the headset to hold framerate.
    if (parent && dancer?.alive && seatIsNear(match.mySeat, z.seat, match.seats)) {
      this.strikeFx(z, parent);
    }

    // One landing → one sound, however many platforms it hit.
    const key = `${z.moveIdx}:${z.landingIdx}`;
    if (!this.landedSfx.has(key)) {
      this.landedSfx.add(key);
      switch (z.zone.kind) {
        case 'lane':
          sfx.beamBlast();
          break;
        case 'sweep':
          sfx.sweepWhoosh();
          break;
        case 'half':
          sfx.floodCrash();
          break;
        case 'gate':
          sfx.gateSlam();
          break;
        case 'nova':
          sfx.novaBoom();
          break;
        case 'rail':
          sfx.railZap();
          break;
        case 'donut':
          sfx.donutSlam();
          break;
        case 'quad':
          sfx.quadCrash();
          break;
      }
    }

    if (!dancer || !dancer.alive) return;

    if (dancer.kind === 'local') {
      this.judgeLocal(z, dancer);
    } else if (dancer.kind === 'bot') {
      this.judgeBot(z, dancer);
    }
    // remote: their client judges; scores arrive on the wire.
  }

  private strikeFx(z: LiveZone, parent: NonNullable<ReturnType<typeof platformRoot>>): void {
    switch (z.zone.kind) {
      case 'lane':
        this.strikes.beam(parent, z.zone.x, z.zone.yaw ?? 0, z.zone.halfW);
        break;
      case 'sweep':
        this.strikes.sweep(parent, sweepSide(z.moveIdx, z.landingIdx));
        break;
      case 'half':
        this.strikes.halfFlood(parent, z.zone.side, z.zone.axis);
        break;
      case 'gate':
        this.strikes.gate(parent, z.zone.at, z.zone.half, z.zone.axis);
        break;
      case 'rail':
        this.strikes.rail(parent, z.zone.z, z.zone.halfD, z.zone.from);
        break;
      case 'donut':
        this.strikes.donut(parent, z.zone.innerR);
        break;
      case 'quad':
        // The blockfall IS the strike — its crush was armed in resolve().
        break;
      case 'nova': {
        const local = z.zone.bearing - seatBearing(z.seat, match.seats);
        this.strikes.nova(parent, local, z.zone.halfAngle);
        break;
      }
    }
  }

  private judgeLocal(z: LiveZone, d: Dancer): void {
    // Inside i-frames NOTHING is judged — no harm, no reward — exactly the
    // rule judgeBot has always played by. It used to skip only the harm:
    // the wave strip after the one that clipped you still paid a dodge,
    // revived the combo the hit had just killed, wiped the three-in-a-row
    // chain, and — if its probe had caught you "still inside" while you
    // were busy being hit — shouted PERFECT! over the HIT it came with.
    if (match.beat < d.invulnUntilBeat) return;
    if (this.touchesLocal(z)) {
      this.applyHit(z, d);
      return;
    }
    // Same-beat partners (a twin's second rail, the split, THE X, the
    // trap): the zones resolve in array order, so when the lane you ARE in
    // is judged after the lane you left, its i-frames come too late to
    // stop the phantom dodge. If any sibling landing on this same tick is
    // on you right now, the hit owns the whole moment — this zone judges
    // nothing.
    for (const other of this.zones) {
      if (other === z || other.resolved || other.seat !== z.seat) continue;
      if (match.beat >= other.dueBeat && this.touchesLocal(other)) return;
    }
    this.applyDodge(z, d, z.wasInside);
  }

  private judgeBot(z: LiveZone, d: Dancer): void {
    if (match.beat < d.invulnUntilBeat) return;
    const chance = Math.max(0.25, d.skill - z.act * BOTS.actPenalty);
    const dodged = roll(match.seed, 0xb0b, z.seat, z.moveIdx, z.landingIdx) < chance;
    if (!dodged) {
      this.applyHit(z, d);
      return;
    }
    const perfect = roll(match.seed, 0x9e4f, z.seat, z.moveIdx, z.landingIdx) < 0.12;
    this.applyDodge(z, d, perfect);
  }

  private applyDodge(_z: LiveZone, d: Dancer, perfect: boolean): void {
    d.combo += 1;
    d.bestCombo = Math.max(d.bestCombo, d.combo);
    d.dodges += 1;
    // One clean landing wipes the chain — the sudden death is three in a
    // ROW, never a budget of three across the night.
    d.missChain = 0;
    if (perfect) d.perfects += 1;
    const mult = 1 + SCORE.comboStep * Math.min(d.combo, SCORE.comboCap);
    d.score += Math.round(SCORE.base * mult * (perfect ? SCORE.perfectMult : 1));

    if (d.kind === 'local' && perfect) {
      // JUST THE WORD. The pop carried the chain's ×N for a while — the
      // multiplier the landing was paid at, climbing pop to pop — and it
      // was the wrong instrument for it: the pop is a half-second shout at
      // the edge of your eye while something is trying to kill you, and a
      // number there asks to be READ. The wedge already holds the chain
      // for whenever you want it. This says you rode the beat, and gets
      // out of the way.
      pushFlair('PERFECT!', 'perfect');
      sfx.perfectChime();
    }
  }

  private applyHit(z: LiveZone, d: Dancer): void {
    d.combo = 0;
    d.invulnUntilBeat = z.dueBeat + SCORE.invulnBeats;

    d.hits += 1;
    d.missChain += 1;
    const out = d.missChain >= GRADE.chainOut;
    if (d.kind === 'local') {
      // Just HIT — every time. The pop is a reflex, not a readout: the
      // chain marks on the wedge already count how close the end is, and
      // the wedge says SPECTATING the moment it arrives.
      pushFlair('HIT', 'hit');
      sfx.hitTaken();
      // And the impact knocks the rhythm out of your hands.
      grooveView.disrupt?.();
    }
    if (out) {
      d.alive = false;
      d.elimAtBeat = z.dueBeat;
      // Their outstanding telegraphs fold with them.
      for (const other of this.zones) {
        if (!other.resolved && other.seat === d.seat) {
          other.resolved = true;
          other.tg?.dispose();
          other.tg = null;
          other.blocks?.dispose();
          other.blocks = undefined;
        }
      }
      if (d.kind === 'bot') sfx.koSplat();
    }
  }

}
