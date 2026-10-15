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
import { BOTS, CHOREO, GRADE, MOVES, SCORE, TRIDENT, countInBeatsFor, type MoveKind } from '../config.js';
import * as sfx from '../audio/sfx.js';
import { breakBeats, trackById } from '../audio/tracks.js';
import { platformRoot } from '../arena/arena.js';
import { StrikeFx } from '../choreo/strikes.js';
import {
  beamTelegraph,
  xTelegraph,
  donutTelegraph,
  gateTelegraph,
  halfTelegraph,
  novaTelegraph,
  quadTelegraph,
  railTelegraph,
  sweepTelegraph,
  AFTERBURN_SEC,
  type Telegraph,
} from '../choreo/telegraphs.js';
import { generateSetlist, type SetMove, type Zone } from '../choreo/setlist.js';
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
}

/** Read-only window for other systems (bot movement mirrors the judging) —
 *  plus dev hooks: `__gdr.choreo.dropTrident(form)` throws THE TRIDENT NOW
 *  so it can be seen without waiting for the set-list to roll one. */
export const choreoView: {
  zones: readonly LiveZone[];
  /** Dev: throw THE TRIDENT now in form `form` (TRIDENT.forms index). */
  dropTrident?: (form?: number) => void;
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
      // The form (the trident's colour) and THIS blow's quarters, so the
      // DJ conjures the right weapon and swings each strike at its ground.
      return { form: zone.form, hit: zone.hit };
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
  /** Landed telegraphs burning out (the danger kit's afterburn): the mark
   *  ignites white-hot on its landing and fades, instead of vanishing. */
  private burning: { tg: Telegraph; age: number }[] = [];
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
    // Dev: throw THE TRIDENT right now in one form. Harmless outside a
    // live set.
    choreoView.dropTrident = (form = 0) => {
      if (!match.playing || !Number.isFinite(match.beat)) return;
      const tele = match.beat + 0.25;
      const land = tele + MOVES.trident.chargeBeats;
      const f = Math.max(0, Math.min(TRIDENT.forms.length - 1, form));
      const [a, b] = TRIDENT.forms[f].pairs;
      const steps = 4;
      this.begin({
        index: 9000 + this.devDrops++,
        kind: 'trident',
        telegraphBeat: tele,
        landBeat: land,
        act: 2,
        landings: Array.from({ length: steps }, (_, step) => ({
          beat: land + step * CHOREO.tridentStepBeats,
          zone: { kind: 'quad' as const, hit: step % 2 ? b : a, form: f, step, steps },
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
          // The combination's disc is the donut's one small disc (setlist.ts
          // serves the same), so the drop rehearses the real move.
          { beat: land, zone: { kind: 'donut', innerR: CHOREO.donutInnerR } },
        ],
      });
    };
  }

  private strikesRoot(): void {
    // StrikeFx spawns under platform roots; nothing to pre-build.
  }

  private rebuild(): void {
    this.generation = match.generation;
    for (const z of this.zones) z.tg?.dispose();
    this.endBurns();
    this.zones = [];
    this.nextMove = 0;
    this.lastBar = -1;
    this.landedSfx.clear();
    this.cuedSteps.clear();
    this.ended = false;
    // A record's bans: the ones it always carries, plus the ones that only
    // hold on an authored campaign night.
    const record = trackById(match.trackId);
    const banned: MoveKind[] = [...(record?.banned ?? []), ...(match.tour ? (record?.tourBanned ?? []) : [])];
    // THE TRIDENT is the DJ's own weapon: on the nights the goop runs the
    // set there is no hand to conjure it in, so the chart never calls it.
    if (match.bossKind === 'goop') banned.push('trident');
    // mountTrack settled the chart's clock (and match.doubleTime with it)
    // from the same shared inputs every client holds, so a room's charts
    // agree on the pace as surely as they agree on the seed.
    this.doubleTime = match.doubleTime;
    // And its breaks: the chart rests wherever the record drops out.
    const breaks = record ? breakBeats(record, countInBeatsFor(match.bpm), match.bpm) : [];
    this.setlist = generateSetlist(match.seed, match.phrases, banned, match.difficulty, this.doubleTime, breaks);
  }

  private endBurns(): void {
    for (const b of this.burning) b.tg.dispose();
    this.burning = [];
  }

  update(delta: number): void {
    this.strikes.update(delta);

    // The afterburn runs on real time, like the strikes it sits under.
    if (this.burning.length) {
      const now = performance.now() / 1000;
      this.burning = this.burning.filter((b) => {
        b.age += delta;
        if (b.age >= AFTERBURN_SEC) {
          b.tg.dispose();
          return false;
        }
        b.tg.update(1 + b.age / AFTERBURN_SEC, now);
        return true;
      });
    }

    const inSet = match.screen === 'countdown' || match.screen === 'raid';
    if (!inSet) {
      if (this.zones.length) {
        for (const z of this.zones) z.tg?.dispose();
        this.zones = [];
      }
      this.endBurns();
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
      if (beat >= z.dueBeat) this.resolve(z);
    }
    this.zones = this.zones.filter((z) => !z.resolved);
    choreoView.zones = this.zones;

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
      // (The FINE show — strike volumes and sparks — is resolve()'s call,
      // near decks only.)
      const parent = platformRoot(dancer.seat);
      if (!parent) continue;
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
            : landing.zone.kind === 'quad' && landing.zone.step > 0 && landing.zone.step < landing.zone.steps - 1
              ? landing.beat // THE TRIDENT: after the first blow's tell, a blow's quarters show only as it lands — read the DJ
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
        // THE TRIDENT keeps the floor dark: every blow's pane is invisible
        // until it lands, then burns its quarters in the afterburn. The
        // LAST blow's pane also carries the chalk quarter lines and opens
        // with the move, so the split is lit the whole way through. The
        // FIRST blow is the one tell: it opens with the move too, its
        // quarters lit in the weapon's colour — after that, know the pattern.
        const tg = quadTelegraph(
          OCTAGON_HALF_WIDTH,
          OCTAGON_HALF_DEPTH,
          zone.hit,
          zone.step === zone.steps - 1,
          zone.step === 0 ? (TRIDENT.forms[zone.form]?.color ?? null) : null,
        );
        tg.group.position.y = 0.048;
        return tg;
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
        // The head's quarter burns — unless it is within a lip of a line
        // whose far side lives (the head reaching safe ground is the dodge).
        const q = (x >= 0 ? 1 : 0) | (z >= 0 ? 2 : 0);
        if (!((zone.hit >> q) & 1)) return false;
        const lip = CHOREO.tridentLip;
        if (Math.abs(x) < lip && !((zone.hit >> (q ^ 1)) & 1)) return false;
        if (Math.abs(z) < lip && !((zone.hit >> (q ^ 2)) & 1)) return false;
        return true;
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
    // The mark doesn't vanish on the landing — it ignites and burns out.
    if (z.tg) this.burning.push({ tg: z.tg, age: 0 });
    z.tg = null;

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
          sfx.tridentStrike();
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
        this.strikes.trident(parent, z.zone.hit, z.zone.form);
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
        }
      }
      if (d.kind === 'bot') sfx.koSplat();
    }
  }

}
