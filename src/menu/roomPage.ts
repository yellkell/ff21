/**
 * THE ROOMS page — back from the Meta Quest build (ff2meta
 * UI/Menu/RoomPage.cs): the arcade lobby (the room browser and the squad
 * room for 2V2, FFA and the CO-OP RAID — lobbyFace.ts) and the CUSTOM
 * GAMES / RANKED screens (the room shape, the code keypad, the hosting
 * card, the ranked room list) are no longer a floating modal and the old
 * slab faces: every one of them is a page of THE BOARD, hosted where
 * VERSUS sits, in the PLAY page's own format — a // kicker and a list on
 * the left, a recessed plate on the right, one CTA under it, and ‹ BACK
 * (or LEAVE / CANCEL) bottom-left. The rail stays up around it. Every
 * button keeps the action id it had, so MenuSystem doesn't change.
 *
 * The web keeps what a page address buys it and the headset build has no
 * use for: the invite band carries the QR, the join link and SHARE ON
 * DISCORD beside the code.
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app } from './appState.js';
import { mesh } from '../net/mesh.js';
import { myStats } from '../net/leaderboard.js';
import { tierForXp } from './progression.js';
import { DIFFICULTY, DIFFICULTY_ORDER, type ArcadeMode } from '../config.js';
import { difficultyUnlocked } from '../campaign/campaignState.js';
import { drawQr } from '../ui/qr.js';
import { inviteLink, inviteShare } from './lobbyFace.js';
import { kicker } from './board.js';
import { CTA, LIST_W, PLATE, dataPlate, listRow } from './playPage.js';

const LIST_Y0 = 66;
const BACK_W = 300;
const WATCH_W = 120;
const GOOP_GREEN = '#36e05a';
const CAP: Record<ArcadeMode, number> = { '1v1': 2, '2v2': 4, ffa: 4, raid: 5 };
const MODE_NAME: Record<ArcadeMode, string> = { '1v1': '1V1', '2v2': '2V2', ffa: 'FREE FOR ALL', raid: 'CO-OP RAID' };

const css = (hex: number): string => `#${hex.toString(16).padStart(6, '0')}`;

interface Page {
  title: string;
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

/** Is a room screen up? The arcade lobby anywhere; the CUSTOM GAMES /
 *  RANKED flows under VERSUS. */
export function roomWanted(onVersus: boolean): boolean {
  return app.lobbyMode !== null || (onVersus && app.duelView !== 'root');
}

export function roomPageFace(hoverOf: (id: string) => number): Page {
  if (app.lobbyMode) return app.lobbyView === 'lobby' ? squadRoom(app.lobbyMode) : browser(app.lobbyMode, hoverOf);
  switch (app.duelView) {
    case 'keypad':
      return keypad();
    case 'hosting':
      return hosting();
    case 'browser':
      return ranked(hoverOf);
    default:
      return shape(hoverOf);
  }
}

/* ── the house parts ──────────────────────────────────────────────────── */

const back = (id: string, label = '‹ BACK', tone?: string): PanelButton => ({ id, label, small: true, tone, x: 0, y: CTA.y, w: BACK_W, h: CTA.h });

const cta = (id: string, label: string, open: boolean, tone?: string): PanelButton => ({
  id,
  label,
  primary: open && !tone,
  disabled: !open,
  tone,
  px: 40,
  ...CTA,
});

/** A line of plain status at the foot of the plate. */
function plateNote(g: CanvasRenderingContext2D, text: string, loud = false): void {
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(loud ? 700 : 500, loud ? 24 : 20);
  g.fillStyle = loud ? KIT.accent : KIT.dim;
  g.fillText(text, PLATE.x + PLATE.w / 2, PLATE.y + PLATE.h - 34, PLATE.w - 60);
}

/** Plain text at the list's head (an empty list says so). */
function listNote(g: CanvasRenderingContext2D, text: string, y: number, px: number, colour: string): void {
  g.textAlign = 'left';
  g.textBaseline = 'middle';
  g.font = font(500, px);
  g.fillStyle = colour;
  g.fillText(text, 26, y, LIST_W - 40);
}

/** Small caps tags in a row, left to right; returns where the next would go. */
function tags(g: CanvasRenderingContext2D, items: Array<[string, string]>, x: number, y: number): number {
  g.textAlign = 'left';
  g.font = font(700, 15);
  g.letterSpacing = '1.5px';
  for (const [t, c] of items) {
    g.fillStyle = c;
    g.fillText(t, x, y);
    x += g.measureText(t).width + 18;
  }
  g.letterSpacing = '0px';
  return x;
}

/* ── THE ROOM BROWSER (2V2 / FFA / CO-OP RAID) ────────────────────────── */

const ROOM_H = 64;
const ROOM_PITCH = 72;
const ROOMS_MAX = 7;

function browser(mode: ArcadeMode, hoverOf: (id: string) => number): Page {
  const raid = mode === 'raid';
  const rooms = app.lobbyRooms.slice(0, ROOMS_MAX);
  const rw = LIST_W - WATCH_W - 10;
  const buttons: PanelButton[] = [];
  rooms.forEach((room, i) => {
    const y = LIST_Y0 + i * ROOM_PITCH;
    // The row joins as a FIGHTER (when there is a seat); WATCH takes a place on the terrace.
    buttons.push(
      { id: `lobby-join-${room.id}`, label: '', ghost: true, disabled: room.count >= room.cap, x: 0, y, w: rw, h: ROOM_H },
      { id: `lobby-watch-${room.id}`, label: 'WATCH', small: true, px: 20, x: LIST_W - WATCH_W, y, w: WATCH_W, h: ROOM_H },
    );
  });
  if (!raid) buttons.push({ id: 'lobby-vsbots', label: 'FIGHT RIVALS NOW', small: true, x: PLATE.x + 30, y: PLATE.y + PLATE.h - 30 - 84 - 52, w: PLATE.w - 60, h: 84 });
  buttons.push(cta('lobby-host', raid ? 'HOST A RAID' : 'OPEN A ROOM', !app.onlyBots), back('lobby-close'));

  return {
    title: '',
    buttons,
    body: (g) => {
      kicker(g, raid ? 'OPEN RAIDS' : 'OPEN ROOMS', 2, 22);
      if (rooms.length === 0) {
        listNote(g, raid ? 'No raid squads are forming right now.' : 'No rooms are open right now.', LIST_Y0 + 30, 24, KIT.faint);
        listNote(g, raid ? 'Host one and others can join it.' : 'Open one and others can join it.', LIST_Y0 + 70, 20, KIT.disabled);
      }
      rooms.forEach((room, i) => {
        const y = LIST_Y0 + i * ROOM_PITCH;
        const full = room.count >= room.cap;
        listRow(g, { x: 0, y, w: rw, h: ROOM_H }, '', '', false, !full, full ? 0 : hoverOf(`lobby-join-${room.id}`));
        const host = (room.host || 'PLAYER').toUpperCase();
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = font(600, 24);
        g.letterSpacing = '1px';
        g.fillStyle = full ? KIT.dim : KIT.textHi;
        g.fillText(raid ? `${host}'S RAID` : `${host}'S ROOM`, 26, y + ROOM_H / 2 - 10, rw - 130);
        const t: Array<[string, string]> = [];
        if (room.goopliath) t.push(['GOOPLIATH', GOOP_GREEN]);
        if (room.hardcore) t.push(['HARDCORE', KIT.danger]);
        if (t.length === 0) t.push([full ? 'FULL · WATCH ONLY' : 'OPEN', full ? KIT.disabled : KIT.positive]);
        tags(g, t, 26, y + ROOM_H / 2 + 16);
        g.textAlign = 'right';
        g.font = font(700, 26);
        g.fillStyle = full ? KIT.danger : KIT.accent;
        g.fillText(`${room.count}/${room.cap}`, rw - 22, y + ROOM_H / 2);
      });

      const data: Array<{ label: string; value: string }> = [];
      if (mode === '2v2') data.push({ label: 'TEAMS', value: '2 V 2' });
      data.push({ label: raid ? 'SQUAD' : 'FIGHTERS', value: String(CAP[mode]) });
      data.push({ label: 'OPEN ROOMS', value: String(rooms.length) });
      dataPlate(g, MODE_NAME[mode], data);
      if (app.onlyBots) plateNote(g, 'Online play is off');
      else if (app.netStatus.endsWith('…')) plateNote(g, app.netStatus);
    },
  };
}

/* ── THE SQUAD ROOM ───────────────────────────────────────────────────── */

function squadRoom(mode: ArcadeMode): Page {
  const joined = mesh.joined;
  const host = joined && mesh.isHost();
  const cap = mesh.capacity || CAP[mode];
  const raid = mode === 'raid';
  const count = mesh.occupants.slice(0, cap).filter(Boolean).length;
  const full = count >= cap;
  const shortStart = mode === 'ffa' || raid;
  const shortReady = shortStart && count >= 2 && !full;
  const code = app.privateCode;
  const seatH = cap > 6 ? 50 : 60;
  const seatPitch = seatH + 8;

  // The plate's stack, top-down: the raid's breakers, then the invite band.
  const y0 = PLATE.y + 120;
  const diffY = y0 + 28;
  const breakY = diffY + 58 + 18;
  const TOGGLE_H = 64;
  const TOGGLE_GAP = 10;
  const inner = PLATE.w - 60;
  const bandY = raid ? breakY + 2 * TOGGLE_H + TOGGLE_GAP + 22 : PLATE.y + 140 + 2 * 56 - 10;
  const BAND_H = 132;

  const buttons: PanelButton[] = [];
  if (raid) {
    // The run's damage: the host picks, the squad watches it land.
    const chipW = (inner - 3 * 10) / 4;
    DIFFICULTY_ORDER.forEach((tier, i) => {
      const on = mesh.raidDifficulty === tier;
      buttons.push({
        id: `raiddiff-${tier}`,
        label: DIFFICULTY[tier].label,
        small: true,
        px: 18,
        selected: on,
        disabled: !host || !difficultyUnlocked(tier),
        tone: on ? css(DIFFICULTY[tier].accent) : undefined,
        x: PLATE.x + 30 + i * (chipW + 10),
        y: diffY,
        w: chipW,
        h: 58,
      });
    });
    buttons.push(
      { id: 'lobby-hardcore', label: 'HARDCORE', small: true, toggle: true, selected: mesh.raidHardcore, tone: mesh.raidHardcore ? KIT.danger : undefined, disabled: !host, x: PLATE.x + 30, y: breakY, w: inner, h: TOGGLE_H },
      { id: 'lobby-goopliath', label: 'FIGHT GOOPLIATH', small: true, toggle: true, selected: mesh.raidGoopliath, tone: mesh.raidGoopliath ? GOOP_GREEN : undefined, disabled: !host, x: PLATE.x + 30, y: breakY + TOGGLE_H + TOGGLE_GAP, w: inner, h: TOGGLE_H },
    );
  }
  if (code && host) {
    // SHARE: the bot posts this room's join link (once per room).
    if (inviteShare.code !== code) {
      inviteShare.code = code;
      inviteShare.state = '';
    }
    const st = inviteShare.state;
    buttons.push({
      id: 'lobby-discord',
      label: st === 'posted' ? 'POSTED' : st === 'sending' ? 'POSTING…' : st === 'failed' ? 'TRY AGAIN' : 'SHARE ON DISCORD',
      small: true,
      px: 18,
      disabled: st === 'sending' || st === 'posted',
      tone: st === 'posted' ? KIT.positive : undefined,
      x: PLATE.x + PLATE.w - 30 - 200,
      y: bandY + BAND_H - 52,
      w: 200,
      h: 44,
    });
  }
  buttons.push(
    shortStart ? cta('lobby-start', host ? 'START NOW' : 'WAITING FOR HOST', host && shortReady) : cta('lobby-start', full ? 'LAUNCHING…' : 'WAITING FOR PLAYERS', false),
    back('lobby-leave', 'LEAVE', KIT.danger),
  );

  return {
    title: '',
    buttons,
    body: (g) => {
      kicker(g, mesh.watching ? 'WATCHING' : 'YOUR SQUAD', 2, 22);
      for (let seat = 0; seat < cap; seat++) {
        const y = LIST_Y0 + seat * seatPitch;
        const taken = joined && !!mesh.occupants[seat];
        const isMe = joined && seat === mesh.mySeat;
        listRow(g, { x: 0, y, w: LIST_W, h: seatH }, '', '', isMe, taken, 0);
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = font(600, 24);
        g.letterSpacing = '1px';
        g.fillStyle = taken ? (isMe ? KIT.textHi : KIT.text) : KIT.disabled;
        g.fillText(taken ? mesh.names[seat] || `PLAYER ${seat + 1}` : 'OPEN SEAT', 26, y + seatH / 2 + 1, LIST_W - 220);
        const team = mode === '2v2' ? (seat < 2 ? 'TEAM A' : 'TEAM B') : null;
        g.textAlign = 'right';
        g.font = font(700, 16);
        g.letterSpacing = '1.5px';
        if (seat === 0 && taken) {
          g.fillStyle = KIT.accent;
          g.fillText(team ? `HOST · ${team}` : 'HOST', LIST_W - 20, y + seatH / 2 + 1);
        } else if (team) {
          g.fillStyle = seat < 2 ? KIT.info : KIT.warn;
          g.fillText(team, LIST_W - 20, y + seatH / 2 + 1);
        }
        g.letterSpacing = '0px';
      }

      const data: Array<{ label: string; value: string }> = [];
      if (!raid) {
        if (mode === '2v2') data.push({ label: 'TEAMS', value: '2 V 2' });
        data.push({ label: 'SEATED', value: `${count} / ${cap}` });
      }
      dataPlate(g, MODE_NAME[mode], data);
      if (raid) {
        g.textAlign = 'left';
        g.font = font(600, 18);
        g.letterSpacing = '1.5px';
        g.fillStyle = KIT.faint;
        g.fillText('DIFFICULTY', PLATE.x + 30, y0);
        g.letterSpacing = '0px';
      }

      // THE INVITE BAND: the QR a phone reads off the screen mirror, the
      // code a host reads out, the link under it.
      if (code) {
        g.beginPath();
        g.roundRect(PLATE.x + 30, bandY, inner, BAND_H, 14);
        g.fillStyle = 'rgba(255,255,255,0.03)';
        g.fill();
        g.lineWidth = 2;
        g.strokeStyle = KIT.lineFaint;
        g.stroke();
        const qr = BAND_H - 28;
        try {
          drawQr(g, inviteLink(code), PLATE.x + 44, bandY + 14, qr);
        } catch {
          /* a link too long for the encoder — the code and the text still stand */
        }
        const x0 = PLATE.x + 44 + qr + 20;
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.font = font(600, 16);
        g.letterSpacing = '1.5px';
        g.fillStyle = KIT.faint;
        g.fillText('INVITE CODE', x0, bandY + 26);
        g.font = font(700, 40);
        g.letterSpacing = '4px';
        g.fillStyle = KIT.info;
        g.fillText(code.split('').join(' '), x0, bandY + 66);
        g.font = font(500, 15);
        g.letterSpacing = '0px';
        g.fillStyle = KIT.faint;
        g.fillText(inviteLink(code).replace(/^https?:\/\//, ''), x0, bandY + BAND_H - 28, host ? PLATE.x + PLATE.w - 30 - 200 - 12 - x0 : inner - (x0 - PLATE.x - 30) - 14);
      }

      // What everyone is waiting for.
      const noun = raid ? 'raiders' : 'players';
      let line: string;
      if (!joined) line = app.netStatus && app.netStatus !== 'not connected' ? app.netStatus : 'Opening the room…';
      else if (mesh.started || full) line = 'Launching…';
      else line = shortStart ? `${count} of ${cap} ${noun} · the host can start at 2` : `${count} of ${cap} ${noun} · starts when every seat is filled`;
      if (joined && mesh.watchers.size > 0 && !full) line += ` · ${mesh.watchers.size} watching`;
      plateNote(g, line, joined && (full || mesh.started));
    },
  };
}

/* ── CUSTOM GAMES: the room's shape ───────────────────────────────────── */

const SHAPES: Array<{ id: string; key: ArcadeMode; label: string; seats: number }> = [
  { id: 'private-mode-1v1', key: '1v1', label: '1V1', seats: 2 },
  { id: 'private-mode-2v2', key: '2v2', label: '2V2', seats: 4 },
  { id: 'private-mode-ffa', key: 'ffa', label: 'FREE FOR ALL', seats: 4 },
];
const SHAPE_H = 48;
const SHAPE_PITCH = 56;

function shape(hoverOf: (id: string) => number): Page {
  const cur = SHAPES.find((s) => s.key === app.privateMode) ?? SHAPES[0];
  const buttons: PanelButton[] = SHAPES.map((s, i) => ({ id: s.id, label: s.label, ghost: true, x: 0, y: LIST_Y0 + i * SHAPE_PITCH, w: LIST_W, h: SHAPE_H }));
  buttons.push(
    { id: 'private-enter', label: 'ENTER A CODE', small: true, x: PLATE.x + 30, y: PLATE.y + PLATE.h - 30 - 84, w: PLATE.w - 60, h: 84 },
    cta('private-create', 'CREATE CODE', true),
    back('private-back'),
  );
  return {
    title: '',
    buttons,
    body: (g) => {
      kicker(g, 'ROOM TYPE', 2, 22);
      SHAPES.forEach((s, i) => listRow(g, { x: 0, y: LIST_Y0 + i * SHAPE_PITCH, w: LIST_W, h: SHAPE_H }, s.label, `${s.seats} SEATS`, s.key === cur.key, true, hoverOf(s.id)));
      dataPlate(g, 'CUSTOM GAMES', [
        { label: 'ROOM TYPE', value: cur.label },
        { label: 'SEATS', value: String(cur.seats) },
        { label: 'ACCESS', value: 'INVITE CODE' },
      ]);
    },
  };
}

/* ── CUSTOM GAMES: enter a code ───────────────────────────────────────── */

function keypad(): Page {
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', ''];
  const GAP = 16;
  const kw = (LIST_W - 2 * GAP) / 3;
  const kh = 112;
  const buttons: PanelButton[] = [];
  keys.forEach((k, i) => {
    if (!k) return;
    buttons.push({
      id: k === '⌫' ? 'kp-del' : `kp-${k}`,
      label: k,
      px: 44,
      disabled: k === '⌫' && app.codeEntry.length === 0,
      x: (i % 3) * (kw + GAP),
      y: LIST_Y0 + Math.floor(i / 3) * (kh + GAP),
      w: kw,
      h: kh,
    });
  });
  const full = app.codeEntry.length === 5;
  buttons.push(cta('kp-join', 'JOIN', full), back('private-back'));
  return {
    title: '',
    buttons,
    body: (g) => {
      kicker(g, 'ENTER CODE', 2, 22);
      dataPlate(g, 'JOIN A ROOM', []);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(700, 84);
      g.letterSpacing = '6px';
      g.fillStyle = full ? KIT.info : KIT.textHi;
      g.fillText(app.codeEntry.padEnd(5, '·').split('').join(' '), PLATE.x + PLATE.w / 2, PLATE.y + 300, PLATE.w - 60);
      g.letterSpacing = '0px';
      plateNote(g, "Enter the 5-digit code from the room's host.");
    },
  };
}

/* ── CUSTOM GAMES: hosting a code ─────────────────────────────────────── */

function hosting(): Page {
  const code = app.privateCode;
  const cur = SHAPES.find((s) => s.key === app.privateMode) ?? SHAPES[0];
  return {
    title: '',
    buttons: [cta('private-back', 'CANCEL', true, KIT.danger)],
    body: (g) => {
      kicker(g, 'CUSTOM GAMES', 2, 22);
      listNote(g, 'Share this code with the players you want to face.', LIST_Y0 + 30, 24, KIT.text);
      listNote(g, 'The room launches itself once the seats fill.', LIST_Y0 + 70, 20, KIT.faint);
      dataPlate(g, 'YOUR CODE', []);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(700, code ? 96 : 40);
      g.letterSpacing = code ? '8px' : '3px';
      g.fillStyle = code ? KIT.accent : KIT.dim;
      g.fillText(code ? code.split('').join(' ') : 'RESERVING…', PLATE.x + PLATE.w / 2, PLATE.y + 290, PLATE.w - 60);
      g.letterSpacing = '0px';
      g.textAlign = 'left';
      g.font = font(600, 18);
      g.letterSpacing = '1.5px';
      g.fillStyle = KIT.faint;
      g.fillText('ROOM TYPE', PLATE.x + 30, PLATE.y + 140 + 5 * 56);
      g.textAlign = 'right';
      g.font = font(700, 28);
      g.letterSpacing = '1px';
      g.fillStyle = KIT.textHi;
      g.fillText(cur.label, PLATE.x + PLATE.w - 30, PLATE.y + 140 + 5 * 56);
      g.letterSpacing = '0px';
    },
  };
}

/* ── RANKED: the room list ────────────────────────────────────────────── */

function ranked(hoverOf: (id: string) => number): Page {
  const hostingOwn = app.rankedRoomId !== '';
  const rows = app.rankedRooms.slice(0, ROOMS_MAX);
  const buttons: PanelButton[] = rows.map((r, i) => ({
    id: `ranked-join-${r.id}`,
    label: r.host,
    ghost: true,
    disabled: r.id === app.rankedRoomId || hostingOwn,
    x: 0,
    y: LIST_Y0 + i * ROOM_PITCH,
    w: LIST_W,
    h: ROOM_H,
  }));
  buttons.push(
    hostingOwn || app.rankedHost ? cta('ranked-cancel', 'STAND DOWN', true, KIT.danger) : cta('ranked-host', 'HOST A ROOM', !app.onlyBots),
    back('ranked-back'),
  );
  return {
    title: '',
    buttons,
    body: (g) => {
      kicker(g, 'OPEN ROOMS', 2, 22);
      if (rows.length === 0) listNote(g, 'No ranked rooms are open right now.', LIST_Y0 + 30, 24, KIT.faint);
      rows.forEach((r, i) => {
        const own = r.id === app.rankedRoomId;
        listRow(g, { x: 0, y: LIST_Y0 + i * ROOM_PITCH, w: LIST_W, h: ROOM_H }, r.host.toUpperCase(), own ? 'YOURS' : 'OPEN', own, !hostingOwn || own, hostingOwn ? 0 : hoverOf(`ranked-join-${r.id}`));
      });
      const xp = myStats().xp;
      dataPlate(g, 'RANKED', [
        { label: 'TIER', value: tierForXp(xp).name },
        { label: 'XP', value: xp.toLocaleString('en-US') },
      ]);
      if (hostingOwn || app.rankedHost) plateNote(g, 'Your room is open — holding the door.', true);
    },
  };
}
