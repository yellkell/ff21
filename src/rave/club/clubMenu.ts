/**
 * THE CLUB MENU — the floor's console (right Ⓐ) in the lobby's one menu
 * FORMAT, back from the Meta Quest build (ff2meta Rave/Club/ClubMenu.cs):
 * THE BOARD (menu/board.ts) in the club's own colours, its LED cyan and
 * violet over a violet-black pane.
 *
 *   ┌ THE CLUB ──────────────────────────── room chip · ID chip ┐
 *   │ 01 THE ROOM ▌ │ everyone on the floor, MUTE · BLOCK        │
 *   │ 02 DISCO BALL │ FIGHT · RAVE list │ data plate │ one CTA     │
 *   │ 03 SOUND      │ mic, voice chat, the music switch            │
 *   │ 04 LEAVE      │ the door                                     │
 *   └───────────────┴──────────────────────────────────────────────┘
 *
 * The old desk was one tall panel with two leaves flying out of it (the
 * record list off the ♪ row, the tier list off the titan raid's); on the
 * board each section is a rail tab and the leaves live inline in DISCO BALL
 * (THE BELL, renamed on the Quest build). A row is its name and a one-word
 * status; the plate shows only what's real. What every control does is the
 * desk's own — ClubSocialSystem keeps the actions; this module only lays
 * out and paints. Board px throughout; a tab's face is laid out in the
 * content region's own px (PlayPage's grid) and shifted onto the board.
 */

import { KIT, type PanelButton } from '../../ui/kit/panel.js';
import { font } from '../../ui/kit/fonts.js';
import { CLUB_LOOK, CONTENT, RailMarker, drawHeaderRule, drawRail, drawStatusChip, drawWordmark, line, railButtons, type RailTab } from '../../menu/board.js';
import { CTA, LIST_W, PLATE, dataPlate, listRow } from '../../menu/playPage.js';
import { DIFFICULTY as RAVE_DIFFICULTY, hueToColor } from '../config.js';
import { trackById, tracksFor } from '../audio/tracks.js';
import { memberHue, net } from '../net/session.js';
import { clubMusicOn, socialBlocked, socialMuted } from './social.js';
import { isSpeaking, isVoiceCapturing, isVoiceMuted, voiceEnabled } from './voice.js';
import { bellView, FIGHTS, fightLabel, type BellMode } from './bell.js';
import { match } from '../game/state.js';
import { profileHue, profileName } from '../game/profile.js';
import { coins } from '../../menu/wallet.js';
import { app } from '../../menu/appState.js';
import { DIFFICULTY as TIERS, DIFFICULTY_ORDER } from '../../config.js';
import { difficultyUnlocked } from '../../campaign/campaignState.js';
import { runLineup } from '../../campaign/bosses.js';

export type ClubTab = 'room' | 'bell' | 'sound' | 'leave';
export type FightMode = Exclude<BellMode, 'rave'>;

/** Everything the board needs that isn't the room's own state. */
export interface ClubMenuState {
  tab: ClubTab;
  /** DISCO BALL's two tabs: FIGHT (an arena fight) or RAVE (a record). */
  bellTab: 'fight' | 'rave';
  /** FIGHT is only on offer where a host can open an arena room. */
  fights: boolean;
  fight: FightMode;
  hardcore: boolean;
  calling: boolean;
  callError: string;
  songScroll: number;
}

const CW = CONTENT.w;
const LX = 0;
const LW = LIST_W;
const ROW_Y0 = 140;
const ROW_H = 48;
const ROW_PITCH = 56;
export const SONG_VISIBLE = 12;
const SONG_Y0 = 240;
const SONG_PITCH = 50;
const SONG_ROW_H = 44;
const TIER_Y0 = 410;
const TIER_PITCH = 50;
const TIER_H = 44;
const ID = { x: 1280, y: 34, w: 340, h: 58 };
/** How long the disco ball's last take rides the ID chip. */
const TAKE_MS = 20_000;

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;
const micLive = (): boolean => !isVoiceMuted() && isVoiceCapturing();

/* ── the records ──────────────────────────────────────────────────────── */

/** SHUFFLE, then the raid shelf alphabetically — the foyer's order. */
export function songRows(): Array<{ id: string; title: string; bpm: string }> {
  const pool = [...tracksFor('raid')].sort((a, b) => a.title.localeCompare(b.title));
  return [{ id: 'shuffle', title: 'SHUFFLE', bpm: '' }, ...pool.map((t) => ({ id: t.id, title: t.title, bpm: `${Math.round(t.bpm)} BPM` }))];
}

export function songTop(total: number, scroll: number): number {
  return Math.max(0, Math.min(scroll, total - SONG_VISIBLE));
}

/** The scroll that puts the cued record inside the window. */
export function revealCued(scroll: number): number {
  const rows = songRows();
  const at = rows.findIndex((r) => r.id === (match.preferredTrack || 'shuffle'));
  if (at < 0) return scroll;
  const max = Math.max(0, rows.length - SONG_VISIBLE);
  if (at < scroll) return Math.min(at, max);
  if (at >= scroll + SONG_VISIBLE) return Math.min(at - SONG_VISIBLE + 1, max);
  return scroll;
}

/* ── the shell ────────────────────────────────────────────────────────── */

/** Each tab is its name and a datum: the count, the ball's state, the mic's. */
function railTabs(): RailTab[] {
  const ball = net.ball ? 'UP' : net.gamePlayers.size > 0 ? 'OUT' : undefined;
  return [
    { id: 'tab-room', label: 'THE ROOM', sub: String(net.members.length) },
    { id: 'tab-bell', label: 'DISCO BALL', sub: ball },
    { id: 'tab-sound', label: 'SOUND', sub: !voiceEnabled() ? 'OFF' : micLive() ? 'LIVE' : 'MUTED' },
    { id: 'tab-leave', label: 'LEAVE', groupStart: true },
  ];
}

const roomText = (): string => (net.solo ? 'ROOM OF ONE' : net.code ? `ROOM ${net.code}` : 'PUBLIC FLOOR');

/** The ID chip: my name in my colour, the wallet, the disco ball's last take. */
function drawIdChip(g: CanvasRenderingContext2D): void {
  g.beginPath();
  g.roundRect(ID.x, ID.y, ID.w, ID.h, 12);
  g.fillStyle = line(CLUB_LOOK, 0.25 * 0.3 / CLUB_LOOK.lineA);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = line(CLUB_LOOK, 0.3);
  g.stroke();
  const me = net.members.find((m) => m.idx === net.myIdx);
  g.fillStyle = hex(hueToColor(me ? memberHue(me) : profileHue() ?? 0.55, 0.62));
  g.fillRect(ID.x + 16, ID.y + ID.h / 2 - 9, 18, 18);
  const cy = ID.y + ID.h / 2 + 1;
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(700, 24);
  g.letterSpacing = '1px';
  g.fillStyle = KIT.textHi;
  g.fillText(me?.name || profileName(), ID.x + 46, cy, 170);
  const take = bellView.lastPay > 0 && performance.now() - bellView.paidAt < TAKE_MS;
  g.textAlign = 'right';
  g.font = font(700, 22);
  g.letterSpacing = '0px';
  g.fillStyle = KIT.info;
  g.fillText(`$${coins.balance}`, ID.x + ID.w - 16, take ? cy - 10 : cy);
  if (take) {
    g.font = font(700, 15);
    g.fillStyle = KIT.accent;
    g.fillText(`+${bellView.lastPay}`, ID.x + ID.w - 16, cy + 14);
  }
}

/** A plain section label in faint caps (the club's kicker). */
function kick(g: CanvasRenderingContext2D, text: string, x: number, y: number): void {
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(600, 18);
  g.letterSpacing = '3px';
  g.fillStyle = KIT.faint;
  g.fillText(text, x, y);
  g.letterSpacing = '0px';
}

/* ── 01 THE ROOM: the safety console ──────────────────────────────────── */

interface Content {
  buttons: PanelButton[];
  body: (g: CanvasRenderingContext2D) => void;
}

function roomFace(): Content {
  const all = net.members.filter((m) => m.idx !== net.myIdx);
  const MAX = 11;
  const members = all.slice(0, MAX);
  const more = Math.max(0, all.length - MAX);
  const ROW0 = 66;
  const PITCH = 66;
  const H = 54;
  const BTN_W = 150;
  const GAP = 14;
  const buttons: PanelButton[] = [];
  members.forEach((m, i) => {
    const y = ROW0 + i * PITCH;
    const mu = socialMuted(m.name);
    const bl = socialBlocked(m.name);
    buttons.push(
      { id: `mute:${m.name}`, label: mu ? 'MUTED' : 'MUTE', small: true, tone: mu ? KIT.danger : undefined, x: CW - BTN_W - GAP - BTN_W, y, w: BTN_W, h: H },
      { id: `block:${m.name}`, label: bl ? 'BLOCKED' : 'BLOCK', small: true, tone: bl ? KIT.danger : undefined, x: CW - BTN_W, y, w: BTN_W, h: H },
    );
  });
  return {
    buttons,
    body: (g) => {
      kick(g, 'ON THE FLOOR', 2, 22);
      const statusX = CW - BTN_W * 2 - GAP - 24;
      members.forEach((m, i) => {
        const y = ROW0 + i * PITCH;
        const hidden = socialBlocked(m.name);
        const away = net.gamePlayers.has(m.idx);
        g.beginPath();
        g.roundRect(0, y, CW - BTN_W * 2 - GAP - 12, H, 10);
        g.fillStyle = 'rgba(63,242,255,0.035)';
        g.fill();
        const cy = y + H / 2 + 1;
        const label = m.name.slice(0, 16);
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = font(600, 28);
        g.letterSpacing = '1px';
        g.fillStyle = hidden ? KIT.faint : hex(hueToColor(memberHue(m), 0.62));
        g.fillText(label, 26, cy);
        if (hidden) {
          const w = g.measureText(label).width;
          g.strokeStyle = 'rgba(172,182,198,0.6)';
          g.lineWidth = 2.5;
          g.beginPath();
          g.moveTo(26, cy);
          g.lineTo(26 + w, cy);
          g.stroke();
        }
        g.letterSpacing = '0px';
        const status = away ? 'RING' : net.crownIdx === m.idx ? 'CROWN' : null;
        if (status) {
          g.textAlign = 'right';
          g.font = font(600, 17);
          g.letterSpacing = '1.5px';
          g.fillStyle = KIT.warn;
          g.fillText(status, statusX, cy);
          g.letterSpacing = '0px';
        } else if (isSpeaking(String(m.idx))) {
          g.fillStyle = KIT.positive;
          g.beginPath();
          g.arc(statusX - 6, cy, 6, 0, Math.PI * 2);
          g.fill();
        }
      });
      g.textAlign = 'left';
      g.font = font(600, members.length ? 22 : 24);
      g.letterSpacing = members.length ? '1.5px' : '3px';
      if (more > 0) {
        g.fillStyle = KIT.dim;
        g.fillText(`+${more}`, 26, ROW0 + members.length * PITCH + 24);
      }
      if (members.length === 0) {
        g.fillStyle = KIT.faint;
        g.fillText('JUST YOU', 26, ROW0 + H / 2);
      }
      g.letterSpacing = '0px';
    },
  };
}

/* ── 02 DISCO BALL: what it calls, and the call ───────────────────────── */

/** Who a fight is against: everyone else on the ball by name, or RIVALS. */
function against(): string {
  const ball = net.ball;
  const names: string[] = [];
  if (ball) {
    if (ball.callerIdx !== net.myIdx) names.push(ball.callerName || nameOf(ball.callerIdx));
    for (const j of ball.joins) if (j !== net.myIdx) names.push(nameOf(j));
  }
  return names.length ? names.join(' · ') : 'RIVALS';
}

const nameOf = (idx: number): string => net.members.find((m) => m.idx === idx)?.name ?? '—';

function bellFace(st: ClubMenuState, hoverOf: (id: string) => number): Content {
  const buttons: PanelButton[] = [];
  const fightTab = st.fights && st.bellTab === 'fight';
  const rows = songRows();
  const top = songTop(rows.length, st.songScroll);
  if (st.fights) {
    buttons.push(
      { id: 'tab-fight', label: 'FIGHT', small: true, selected: fightTab, x: LX, y: PLATE.y, w: LW / 2 - 8, h: 56 },
      { id: 'tab-rave', label: 'RAVE', small: true, selected: !fightTab, x: LX + LW / 2 + 8, y: PLATE.y, w: LW / 2 - 8, h: 56 },
    );
  }
  if (fightTab) {
    FIGHTS.forEach((f, i) => buttons.push({ id: `fight-${f.id}`, label: f.label, ghost: true, x: LX, y: ROW_Y0 + i * ROW_PITCH, w: LW, h: ROW_H }));
    if (st.fight === 'raid') {
      // THE TIER LIST, inline (the old desk's leaf off the raid's row), and HARDCORE.
      DIFFICULTY_ORDER.forEach((t, i) => {
        if (difficultyUnlocked(t)) buttons.push({ id: `tier:${t}`, label: TIERS[t].label, ghost: true, x: LX, y: TIER_Y0 + i * TIER_PITCH, w: LW, h: TIER_H });
      });
      buttons.push({ id: 'raidhc', label: 'HARDCORE', small: true, toggle: true, selected: st.hardcore, tone: st.hardcore ? KIT.danger : undefined, x: LX, y: TIER_Y0 + DIFFICULTY_ORDER.length * TIER_PITCH + 8, w: LW, h: 50 });
    }
  } else {
    // DIFFICULTY: every ball off the tour calls EXPERT — one plate.
    buttons.push({ id: 'expert', label: RAVE_DIFFICULTY.labels[RAVE_DIFFICULTY.solo], small: true, selected: true, display: true, x: LX, y: ROW_Y0, w: LW, h: ROW_H });
    // THE RECORDS, inline (the old desk's leaf off the ♪ row), a page at a time.
    rows.slice(top, top + SONG_VISIBLE).forEach((r, i) => buttons.push({ id: `song:${r.id}`, label: r.title, ghost: true, x: LX, y: SONG_Y0 + i * SONG_PITCH, w: LW - 60, h: SONG_ROW_H }));
    if (rows.length > SONG_VISIBLE) {
      buttons.push(
        { id: 'song:up', label: '▲', small: true, px: 20, disabled: top <= 0, x: LX + LW - 50, y: SONG_Y0, w: 50, h: 56 },
        { id: 'song:down', label: '▼', small: true, px: 20, disabled: top >= rows.length - SONG_VISIBLE, x: LX + LW - 50, y: SONG_Y0 + 64, w: 50, h: 56 },
      );
    }
  }

  // The call: one CTA under the plate (START + CALL IT OFF while my ball hangs).
  const ball = net.ball;
  const mine = ball !== null && ball.callerIdx === net.myIdx;
  const setOut = net.gamePlayers.size > 0;
  if (mine) {
    const sw = Math.round(CTA.w * 0.6);
    buttons.push(
      { id: 'start', label: 'START', primary: true, px: 40, x: CTA.x, y: CTA.y, w: sw, h: CTA.h },
      { id: 'cancel', label: 'CALL IT OFF', small: true, tone: KIT.danger, x: CTA.x + sw + 14, y: CTA.y, w: CTA.w - sw - 14, h: CTA.h },
    );
  } else {
    const busy = ball !== null || setOut || st.calling;
    buttons.push({
      id: 'call',
      label: ball ? 'UP' : setOut ? 'OUT' : st.calling ? 'OPENING' : 'HOST',
      sub: st.callError || undefined,
      primary: !busy,
      disabled: busy,
      px: 40,
      ...CTA,
    });
  }

  return {
    buttons,
    body: (g) => {
      kick(g, 'SELECT', 2, 22);
      if (fightTab) {
        FIGHTS.forEach((f, i) => listRow(g, { x: LX, y: ROW_Y0 + i * ROW_PITCH, w: LW, h: ROW_H }, f.label, '', st.fight === f.id, true, hoverOf(`fight-${f.id}`)));
        if (st.fight === 'raid') {
          kick(g, 'TIER', 2, TIER_Y0 - 26);
          DIFFICULTY_ORDER.forEach((t, i) => {
            const y = TIER_Y0 + i * TIER_PITCH;
            const open = difficultyUnlocked(t);
            listRow(g, { x: LX, y, w: LW, h: TIER_H }, TIERS[t].label, open ? '' : 'LOCKED', app.difficulty === t, open, open ? hoverOf(`tier:${t}`) : 0, { indent: 26 });
            g.fillStyle = open ? hex(TIERS[t].accent) : KIT.faint;
            g.beginPath();
            g.arc(LX + 36, y + TIER_H / 2, 6, 0, Math.PI * 2);
            g.fill();
          });
        }
      } else {
        kick(g, 'SELECT SONG', 2, SONG_Y0 - 26);
        const cur = match.preferredTrack || '';
        rows.slice(top, top + SONG_VISIBLE).forEach((r, i) => {
          listRow(g, { x: LX, y: SONG_Y0 + i * SONG_PITCH, w: LW - 60, h: SONG_ROW_H }, r.title, r.bpm, cur === (r.id === 'shuffle' ? '' : r.id), true, hoverOf(`song:${r.id}`), { statusTone: KIT.dim });
        });
      }

      // THE PLATE: what the disco ball would carry — or carries, while it hangs.
      const data: Array<{ label: string; value: string; tone?: string }> = [];
      let title: string;
      let tone: string;
      if (ball) {
        const rave = ball.mode === 'rave';
        title = rave ? `♪ ${trackById(ball.track)?.title ?? 'SHUFFLE'}` : fightLabel(ball.mode);
        tone = rave ? KIT.info : KIT.warn;
        const secs = Math.ceil(Math.max(0, ball.firesAt - performance.now()) / 1000);
        data.push({ label: 'DROPS', value: String(secs), tone: secs <= 10 ? KIT.warn : undefined });
        data.push({ label: 'HOST', value: ball.callerName || nameOf(ball.callerIdx) });
        data.push({ label: 'ON', value: String(ball.joins.size + 1) });
        if (!rave && ball.mode !== 'raid') data.push({ label: 'AGAINST', value: against() });
        if (!rave && ball.hardcore) data.push({ label: 'HARDCORE', value: 'ON', tone: KIT.danger });
      } else if (fightTab) {
        title = fightLabel(st.fight);
        tone = KIT.warn;
        if (st.fight === 'raid') {
          const tier = TIERS[app.difficulty];
          data.push({ label: 'TIER', value: tier.label, tone: hex(tier.accent) });
          // THE LINE-UP: the five titans — BLAZING wedges GOOPLIATH in before the king.
          const lineup = runLineup(app.difficulty);
          data.push({ label: 'BOSSES', value: String(lineup.length) });
          if (lineup.some((s) => s.kind === 'goop')) data.push({ label: 'GOOPLIATH', value: '+1', tone: '#36e05a' });
          data.push({ label: 'HARDCORE', value: st.hardcore ? 'ON' : 'OFF', tone: st.hardcore ? KIT.danger : KIT.dim });
        } else data.push({ label: 'AGAINST', value: against() });
      } else {
        const t = trackById(match.preferredTrack);
        title = `♪ ${t?.title ?? 'SHUFFLE'}`;
        tone = KIT.info;
        if (t) data.push({ label: 'BPM', value: String(Math.round(t.bpm)) });
        data.push({ label: 'DIFFICULTY', value: RAVE_DIFFICULTY.labels[RAVE_DIFFICULTY.solo] });
      }
      if (setOut && !ball) data.push({ label: 'OUT', value: String(net.gamePlayers.size), tone: KIT.warn });
      dataPlate(g, title, data, { titleTone: tone, look: CLUB_LOOK });
    },
  };
}

/* ── 03 SOUND and 04 LEAVE ────────────────────────────────────────────── */

function soundFace(): Content {
  const on = voiceEnabled();
  const H = 76;
  const PITCH = 92;
  return {
    buttons: [
      { id: 'mic', label: 'MIC', toggle: true, selected: micLive(), disabled: !on, x: 0, y: PLATE.y, w: CW, h: H },
      { id: 'voice', label: 'VOICE CHAT', toggle: true, selected: on, x: 0, y: PLATE.y + PITCH, w: CW, h: H },
      { id: 'music', label: 'MUSIC', toggle: true, selected: clubMusicOn(), x: 0, y: PLATE.y + PITCH * 2, w: CW, h: H },
    ],
    body: (g) => kick(g, 'SOUND', 2, 22),
  };
}

function leaveFace(): Content {
  return {
    buttons: [{ id: 'leave', label: 'LEAVE THE CLUB', tone: KIT.danger, px: 40, x: 0, y: PLATE.y, w: CW, h: CTA.h }],
    body: (g) => kick(g, 'THE DOOR', 2, 22),
  };
}

/* ── the board ────────────────────────────────────────────────────────── */

/** The whole board's face: the shell, and the open tab's content shifted
 *  into the content region. */
export function clubMenuFace(
  st: ClubMenuState,
  hoverOf: (id: string) => number,
  marker: RailMarker,
): { buttons: PanelButton[]; body: (g: CanvasRenderingContext2D) => void } {
  const tabs = railTabs();
  const c = st.tab === 'room' ? roomFace() : st.tab === 'bell' ? bellFace(st, hoverOf) : st.tab === 'sound' ? soundFace() : leaveFace();
  const buttons = [...railButtons(tabs), ...c.buttons.map((b) => ({ ...b, x: b.x + CONTENT.x, y: b.y + CONTENT.y }))];
  // The content's own hover lookups are by id, so the shift costs nothing there.
  return {
    buttons,
    body: (g) => {
      drawHeaderRule(g, CLUB_LOOK);
      drawWordmark(g, 'THE CLUB', CLUB_LOOK);
      drawRail(g, tabs, `tab-${st.tab}`, hoverOf, marker, CLUB_LOOK);
      const relay = !net.solo;
      drawStatusChip(g, ID.x, roomText(), relay ? KIT.positive : KIT.warn, relay, CLUB_LOOK);
      drawIdChip(g);
      g.save();
      g.translate(CONTENT.x, CONTENT.y);
      c.body(g);
      g.restore();
    },
  };
}

/** Everything the board draws, as one string: repaint only when it changes. */
export function clubMenuKey(st: ClubMenuState): string {
  const people = net.members
    .filter((m) => m.idx !== net.myIdx)
    .map((m) => `${m.name}|${socialMuted(m.name) ? 1 : 0}${socialBlocked(m.name) ? 1 : 0}${net.gamePlayers.has(m.idx) ? 'R' : ''}${isSpeaking(String(m.idx)) ? '~' : ''}`)
    .join(';');
  const ball = net.ball;
  const take = bellView.lastPay > 0 && performance.now() - bellView.paidAt < TAKE_MS;
  return [
    JSON.stringify(st),
    people,
    `${voiceEnabled()}${isVoiceMuted()}${isVoiceCapturing()}${clubMusicOn()}`,
    `${net.phase}${net.solo}${net.code}${net.crownIdx ?? ''}${match.preferredTrack}`,
    ball ? `B${ball.callerIdx}:${ball.joins.size}:${Math.ceil(Math.max(0, ball.firesAt - performance.now()) / 1000)}` : '',
    `${net.gamePlayers.size}#${coins.balance}#${take ? bellView.lastPay : 0}#${app.difficulty}`,
  ].join('#');
}
