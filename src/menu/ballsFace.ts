/**
 * THE BALL LOADOUT (MENUS 3) — what each fist throws, on the panel kit.
 *
 * Two rows, one per fist, three attachments each: SPLIT (into three),
 * GROW, SHRINK.
 * Tap one to arm that fist with it; tap it again to go back to a plain
 * ball. Below them, a line saying what the last one you touched does —
 * the panel teaches as you poke it.
 *
 * Behind the ADVANCED tab: the curve switch, how hard a curve bends (a
 * slider — BEND — scrubbed live by the trigger, like the wing's volume
 * tracks), and whether you can see your own body. All three are settings
 * about YOUR hands rather than about a bout, which is why they live here
 * and not in the wing's SETTINGS.
 *
 * Every click is self-contained — it mutates and persists app state and
 * nothing else — so the ids are local (`ball:*`) and `ballsClick` answers
 * them, the same contract the paint bay uses. The slider is the one
 * control a click can't settle: `ballsDrag` takes the hit's UV every frame
 * the trigger is held, from whichever host is showing the face.
 */

import { KIT, Panel, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app, saveBallArc, saveBallAttach, saveCurveStrength, saveShowBody } from './appState.js';
import { ATTACH } from '../config.js';

export const BALLS_W = 768;
export const BALLS_H = 768;
/** Where the face's content actually ends — the frame runs to BALLS_H, but
 *  a host blitting the bare face wants to crop the empty tail off. */
export const BALLS_CONTENT_H = 700;

const M = 56;
const INNER = BALLS_W - M * 2;
const GAP = 16;
const TILE_W = (INNER - GAP * 2) / 3;
const TILE_H = 132;
const ROW_L = 190;
const ROW_R = 378;
const DESC_Y = 546;
/** BEND, the ADVANCED face's slider: the label's line and the track under
 *  it, in the slot the −/+ pair used to hold. */
const BEND = { label: 328, track: 350 };
const TRACK_H = 60;
/** The knob can't go below this — a curve that doesn't bend isn't a curve. */
const BEND_MIN = 0.1;

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

const TYPES = [ATTACH.split, ATTACH.grow, ATTACH.shrink];
const ATTACHMENTS = [
  { name: 'SPLIT', color: KIT.info, desc: 'Splits into three on return — each a third the damage.' },
  { name: 'GROW', color: '#ff7a18', desc: 'Gets bigger on return with less damage.' },
  { name: 'SHRINK', color: KIT.accent, desc: 'Gets smaller on return for more damage.' },
];

/** Which face is up, and which attachment the description line is reading. */
const state = { advanced: false, reading: -1, version: 1 };

/** A repaint key — MenuSystem redraws the panel when this changes. */
export function ballsFaceKey(): string {
  return `${state.advanced}|${state.reading}|${app.ballAttach.join(',')}|${app.ballArc.join(',')}|${app.curveStrength}|${app.showBody}`;
}

export interface BallsFace {
  title: string;
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

/** Route one `ball:*` id. Returns false for anything that isn't ours. */
export function ballsClick(id: string): boolean {
  if (!id.startsWith('ball:')) return false;
  const what = id.slice(5);
  if (what === 'advanced' || what === 'loadout') {
    state.advanced = what === 'advanced';
  } else if (what === 'curve') {
    const on = !(app.ballArc[0] || app.ballArc[1]);
    app.ballArc[0] = on;
    app.ballArc[1] = on;
    saveBallArc();
  } else if (what === 'body') {
    app.showBody = !app.showBody;
    saveShowBody();
  } else if (what === 'bend') {
    // The slider: a bare click carries no position, so it settles nothing —
    // `ballsDrag` (fed the hit's UV) is what moves it.
  } else {
    // ball:<side>-<slot> — arm that fist, or take the attachment off.
    const [side, slot] = what.split('-').map(Number);
    if (!Number.isFinite(side) || !Number.isFinite(slot)) return true;
    const type = TYPES[slot];
    state.reading = slot;
    app.ballAttach[side] = app.ballAttach[side] === type ? 0 : type;
    saveBallAttach();
  }
  state.version++;
  return true;
}

/**
 * THE BEND SLIDER, scrubbed: a hit's UV on the loadout canvas → the curve
 * strength, in 5% steps between BEND_MIN and 100%. Returns true when the
 * hit landed on the track (or `grabbed`: the trigger closed on the track
 * earlier and is still held, so the knob follows the ray wherever it has
 * wandered — up, down, past either end). False leaves the caller free to
 * treat the press as an ordinary click.
 */
export function ballsDrag(u: number, v: number, grabbed = false): boolean {
  if (!state.advanced) return false;
  const x = u * BALLS_W;
  const y = (1 - v) * BALLS_H;
  if (!grabbed && (x < M || x > M + INNER || y < BEND.track || y > BEND.track + TRACK_H)) return false;
  const t = clamp01((x - M - 20) / (INNER - 40));
  const next = Math.round((BEND_MIN + t * (1 - BEND_MIN)) * 20) / 20;
  if (next !== app.curveStrength) {
    app.curveStrength = next;
    saveCurveStrength();
    state.version++;
  }
  return true;
}

/** The slider's face: label left, the number right, a well with the filled
 *  run in the accent and a knob — the wing's volume tracks, in this
 *  panel's margins. */
function drawBendTrack(g: CanvasRenderingContext2D, hot: boolean): void {
  const value = app.curveStrength;
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = font(600, 26);
  g.letterSpacing = '2px';
  g.fillStyle = hot ? KIT.accent : KIT.dim;
  g.fillText('BEND', M, BEND.label);
  g.letterSpacing = '0px';
  g.textAlign = 'right';
  g.font = font(700, 26);
  g.fillStyle = KIT.text;
  g.fillText(`${Math.round(value * 100)}%`, BALLS_W - M, BEND.label);
  const ty = BEND.track + TRACK_H / 2 - 12;
  const x0 = M + 20;
  const tw = INNER - 40;
  g.fillStyle = KIT.well;
  g.beginPath();
  g.roundRect(x0, ty, tw, 24, 12);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = hot ? KIT.lineHover : KIT.line;
  g.stroke();
  // The knob's run is BEND_MIN..1: the left end IS the floor, not an empty
  // stretch the knob can never reach.
  const fw = clamp01((value - BEND_MIN) / (1 - BEND_MIN)) * tw;
  if (fw > 4) {
    g.fillStyle = KIT.accent;
    g.beginPath();
    g.roundRect(x0, ty, fw, 24, 12);
    g.fill();
  }
  g.beginPath();
  g.arc(x0 + fw, ty + 12, 18, 0, Math.PI * 2);
  g.fillStyle = hot ? '#ffffff' : KIT.text;
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = KIT.accent;
  g.stroke();
  // The one word the number needs.
  g.textAlign = 'left';
  g.font = font(600, 18);
  g.letterSpacing = '2px';
  g.fillStyle = KIT.faint;
  g.fillText('HOW HARD IT BENDS', x0, BEND.track + TRACK_H + 18);
  g.letterSpacing = '0px';
}

export function ballsFace(): BallsFace {
  // The tab grammar, here too: which face is up is a strip, not a button
  // parked on top of the panel's own name.
  const buttons: PanelButton[] = [
    { id: 'ball:loadout', label: 'FISTS', tab: true, x: 300, y: 30, w: 180, h: 70, selected: !state.advanced },
    { id: 'ball:advanced', label: 'ADVANCED', tab: true, x: 490, y: 30, w: 230, h: 70, selected: state.advanced },
  ];

  if (state.advanced) {
    const curve = app.ballArc[0] || app.ballArc[1];
    buttons.push(
      {
        id: 'ball:curve',
        label: 'CURVE',
        x: M, y: 170, w: INNER, h: 96,
        small: true,
        selected: curve,
        toggle: true,
      },
      // The slider's track: hit-testable (so the ray lights it and a press
      // over it is a scrub, not a click), painted by the body.
      { id: 'ball:bend', label: '', ghost: true, x: M, y: BEND.track, w: INNER, h: TRACK_H },
      {
        id: 'ball:body',
        label: 'SHOW MY BODY',
        x: M, y: 462, w: INNER, h: 96,
        small: true,
        selected: app.showBody,
        toggle: true,
      },
    );
    return {
      title: 'THE BALL',
      buttons,
      // No prose under the breakers: the switches say what they are, and
      // the one number that needs a word keeps its "how hard it bends".
      body: (g, hover) => drawBendTrack(g, hover === 'ball:bend'),
    };
  }

  for (const [side, rowY] of [[0, ROW_L], [1, ROW_R]] as const) {
    for (let i = 0; i < 3; i++) {
      buttons.push({
        id: `ball:${side}-${i}`,
        label: '',
        ghost: true,
        x: M + i * (TILE_W + GAP),
        y: rowY,
        w: TILE_W,
        h: TILE_H,
      });
    }
  }

  return {
    title: 'THE BALL',
    buttons,
    body: (g, hover) => {
      g.textBaseline = 'middle';
      for (const [side, rowY, label] of [
        [0, ROW_L, 'LEFT FIST'],
        [1, ROW_R, 'RIGHT FIST'],
      ] as const) {
        g.textAlign = 'left';
        g.font = font(700, 20);
        g.letterSpacing = '3px';
        g.fillStyle = KIT.faint;
        g.fillText(label, M, rowY - 24);
        g.letterSpacing = '0px';
        for (let i = 0; i < 3; i++) {
          const armed = app.ballAttach[side] === TYPES[i];
          const hot = hover === `ball:${side}-${i}`;
          const info = ATTACHMENTS[i];
          const x = M + i * (TILE_W + GAP);
          g.beginPath();
          g.roundRect(x, rowY, TILE_W, TILE_H, 16);
          g.fillStyle = armed ? KIT.accentFaint : hot ? KIT.plateHover : KIT.plate;
          g.fill();
          g.lineWidth = 2;
          g.strokeStyle = armed ? info.color : hot ? KIT.lineHover : KIT.line;
          g.stroke();
          drawAttachIcon(g, i, x + TILE_W / 2, rowY + 52, 26, info.color);
          g.textAlign = 'center';
          g.font = font(700, 24);
          g.fillStyle = armed ? info.color : KIT.text;
          g.fillText(info.name, x + TILE_W / 2, rowY + TILE_H - 26);
        }
      }

      // What the last one you touched actually does.
      g.beginPath();
      g.roundRect(M, DESC_Y, INNER, 130, 18);
      g.fillStyle = KIT.well;
      g.fill();
      g.textAlign = 'left';
      if (state.reading < 0) {
        g.font = font(500, 24);
        g.fillStyle = KIT.faint;
        g.fillText('tap an attachment to read what it does', M + 28, DESC_Y + 66);
      } else {
        const info = ATTACHMENTS[state.reading];
        g.font = font(700, 28);
        g.fillStyle = info.color;
        g.fillText(info.name, M + 28, DESC_Y + 42);
        g.font = font(500, 23);
        g.fillStyle = KIT.text;
        g.fillText(info.desc, M + 28, DESC_Y + 86, INNER - 56);
      }
    },
  };
}

/** The three attachment glyphs: a fork, a swelling ring, a shrinking one. */
function drawAttachIcon(g: CanvasRenderingContext2D, type: number, cx: number, cy: number, r: number, color: string): void {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = 3;
  if (type === 0) {
    // SPLIT: one ball forking into THREE — the count the attachment
    // actually throws (ATTACH.splitCount), so the glyph can't lie about it.
    g.beginPath();
    g.moveTo(cx - r, cy);
    g.lineTo(cx - r * 0.15, cy);
    g.stroke();
    for (const s of [-1, 0, 1]) {
      g.beginPath();
      g.moveTo(cx - r * 0.15, cy);
      g.lineTo(cx + r * 0.66, cy + s * r * 0.66);
      g.stroke();
      g.beginPath();
      g.arc(cx + r * 0.74, cy + s * r * 0.72, 5.5, 0, Math.PI * 2);
      g.fill();
    }
    return;
  }
  // GROW / SHRINK: a small ball and a big one, with a chevron between them
  // pointing the way the ball travels.
  //
  // The two balls are spaced so there is REAL GAP between them, and the
  // chevron is drawn floating in that gap. The old version ran a stub of
  // line out of the circle's own centre, which the big circle swallowed
  // all but a few pixels of — so what you saw was a teat on the disc
  // rather than an arrow between two of them.
  const small = r * 0.26;
  const big = r * 0.56;
  const grow = type === 1;
  const lead = grow ? small : big; // the ball on the left
  const trail = grow ? big : small;
  g.beginPath();
  g.arc(cx - r * 0.82, cy, lead, 0, Math.PI * 2);
  g.stroke();
  g.beginPath();
  g.arc(cx + r * 0.82, cy, trail, 0, Math.PI * 2);
  g.fill();

  // Dead centre of the gap: past the left ball's rim, short of the right's.
  const gapL = cx - r * 0.82 + lead;
  const gapR = cx + r * 0.82 - trail;
  const ax = (gapL + gapR) / 2;
  const h = r * 0.2;
  g.save();
  g.lineWidth = 2.5;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(ax - h * 0.5, cy - h);
  g.lineTo(ax + h * 0.5, cy);
  g.lineTo(ax - h * 0.5, cy + h);
  g.stroke();
  g.restore();
}

/* ── the panel, off screen ────────────────────────────────────────────── */

/**
 * THE SAME PANEL, ANYWHERE. The tutorial re-hosts the loadout on its own
 * in-arena console, and there must be exactly one of these: a second
 * hand-drawn copy is a copy that drifts. So the face is painted into an
 * off-screen kit panel and handed over as a canvas to blit — the trick the
 * TOWN wing's NEWS tab uses for the newspaper.
 */
let offscreen: Panel | null = null;
let offscreenBare: Panel | null = null;
/** The last one painted — the one a host's rays are actually pointing at.
 *  Both wear the same face, so either answers a hit the same way. */
let served: Panel | null = null;
function panel(bare = false): Panel {
  if (bare) {
    if (!offscreenBare) offscreenBare = new Panel(1, 1, BALLS_W, BALLS_H, { bare: true });
    return offscreenBare;
  }
  if (!offscreen) offscreen = new Panel(1, 1, BALLS_W, BALLS_H);
  return offscreen;
}

/**
 * Paint the loadout at its current state and hand back the canvas.
 *
 * `bare` drops the frame and the title, leaving the tab strip and the tiles
 * on transparent pixels — for a host that has a frame of its own and would
 * otherwise show a panel inside a panel (the A-button action panel).
 */
export function renderBallsPanel(hover: string | null, bare = false): HTMLCanvasElement {
  const p = panel(bare);
  const f = ballsFace();
  p.paint(f.title, f.body, f.buttons, hover);
  served = p;
  return p.ctx().canvas as HTMLCanvasElement;
}

/** UV on that canvas → the button under it (for a host doing its own rays). */
export function ballsHit(u: number, v: number): string | null {
  return (served ?? panel()).buttonAt(u, v);
}
