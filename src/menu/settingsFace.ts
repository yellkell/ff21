/**
 * SETTINGS — a tab on the YOU wing (MENUS 2), kit-native: the two volume
 * tracks (scrubbed live by the trigger — MenuSystem reads the hit UV each
 * frame through `sfxVolFromU` / `musicVolFromU`), three breakers (mute
 * music · voice chat · hide all paint), REPORT A PROBLEM, and CREDITS as
 * a sub-face. Replaces the settings modal and its gear disc.
 */

import { KIT, type PanelButton } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { sfxVolume } from '../audio/sfx.js';
import { musicVolume } from '../audio/musicVolume.js';
import { isMusicMuted, menuMusicStatus } from '../audio/menuMusic.js';
import { voiceEnabled } from '../audio/voicePref.js';
import { paintHiddenAll } from '../avatar/paint.js';
import { app } from './appState.js';

const W = 832;
const M = 48;
const INNER = W - M * 2;
const SFX = { label: 150, track: 172 };
const MUSIC = { label: 272, track: 294 };
const TRACK_H = 60;
const ARENA = { label: 690, row: 714 };

/** True while the wing is showing the CREDITS face. */
let creditsOpen = false;
export function setCreditsOpen(open: boolean): void {
  creditsOpen = open;
}
export function isCreditsOpen(): boolean {
  return creditsOpen;
}

/** Flips after a report goes out so the button says it landed; leaving the
 *  tab resets it. */
let reportSent = false;
export function markReportSent(): void {
  reportSent = true;
}
export function clearReportSent(): void {
  reportSent = false;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** UV.x on the wing → 0..1 along either volume track (same geometry). */
export function sfxVolFromU(u: number): number {
  return clamp01((u * W - M - 20) / (INNER - 40));
}
export function musicVolFromU(u: number): number {
  return sfxVolFromU(u);
}

export interface SettingsFace {
  body: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

const CREDITS: [string, string][] = [
  ['CREATED BY', 'yellkell'],
  ['VOICE ACTING', 'v0ltaVA'],
  ['OST', 'IBWildcat1998 & poopoodoodoo698'],
  ['CONSULTING', 'RedWolf9 & JKing123'],
  ['SPECIAL THANKS TO', 'JakeThePro, JFighter, CrystalZach, Xyfume,'],
  ['', 'fazeway851, GODLY, Yomamaokay,'],
  ['', 'The Blaston community'],
  ['', '& The developers of Blaston'],
  ['THE COVE', 'after Tidewater by Daniel Greenheck (MIT)'],
];

function creditsFace(): SettingsFace {
  return {
    buttons: [{ id: 'credits-back', label: 'BACK', x: W / 2 - 150, y: 880, w: 300, h: 84, small: true }],
    body: (g) => {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let y = 180;
      for (const [role, names] of CREDITS) {
        if (role) {
          g.font = font(700, 20);
          g.letterSpacing = '3px';
          g.fillStyle = KIT.faint;
          g.fillText(role, W / 2, y);
          g.letterSpacing = '0px';
          y += 34;
        }
        g.font = font(600, 28);
        g.fillStyle = KIT.text;
        g.fillText(names, W / 2, y);
        y += role ? 60 : 38;
      }
    },
  };
}

function drawTrack(g: CanvasRenderingContext2D, label: string, value: number, top: number, hot: boolean): void {
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  g.font = font(600, 26);
  g.letterSpacing = '2px';
  g.fillStyle = hot ? KIT.accent : KIT.dim;
  g.fillText(label, M, top);
  g.letterSpacing = '0px';
  g.textAlign = 'right';
  g.font = font(700, 26);
  g.fillStyle = KIT.text;
  g.fillText(`${Math.round(value * 100)}%`, W - M, top);
  // The track: a well, the filled portion in the accent, a knob.
  const ty = top + 22 + TRACK_H / 2 - 12;
  const x0 = M + 20;
  const tw = INNER - 40;
  g.fillStyle = KIT.well;
  g.beginPath();
  g.roundRect(x0, ty, tw, 24, 12);
  g.fill();
  g.lineWidth = 1.5;
  g.strokeStyle = hot ? KIT.lineHover : KIT.line;
  g.stroke();
  const fw = clamp01(value) * tw;
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
}

/** The SETTINGS tab's body + buttons (the wrap adds the tab strip). */
export function settingsFace(): SettingsFace {
  if (creditsOpen) return creditsFace();
  const third = (INNER - 2 * 20) / 3;
  const buttons: PanelButton[] = [
    { id: 'sfx-vol', label: '', ghost: true, x: M, y: SFX.track, w: INNER, h: TRACK_H },
    { id: 'music-vol', label: '', ghost: true, x: M, y: MUSIC.track, w: INNER, h: TRACK_H },
    { id: 'toggle-mute', label: 'MUTE MUSIC', x: M, y: 400, w: third, h: 96, small: true, selected: isMusicMuted() },
    { id: 'toggle-voice', label: 'VOICE CHAT', sub: 'never in ranked', x: M + third + 20, y: 400, w: third, h: 96, small: true, selected: voiceEnabled() },
    { id: 'toggle-hide-paint', label: 'HIDE PAINT', sub: 'everyone bare', x: M + 2 * (third + 20), y: 400, w: third, h: 96, small: true, selected: paintHiddenAll() },
    reportSent
      ? { id: 'settings-report', label: 'REPORT SENT ✓', x: M, y: 540, w: 360, h: 96, small: true, disabled: true }
      : { id: 'settings-report', label: 'REPORT A PROBLEM', sub: 'a player, a bug, anything harmful', x: M, y: 540, w: 360, h: 96, small: true, tone: KIT.danger },
    { id: 'settings-credits', label: 'CREDITS', x: W - M - 360, y: 540, w: 360, h: 96, small: true },
    // ARENA: where every fight is staged — it holds across the lobby, bouts
    // and training because it's a setting, not a room
    { id: 'env-desert', label: 'THE DESERT', sub: 'the dying sun', x: M, y: ARENA.row, w: third, h: 96, small: true, selected: app.environment === 'desert' },
    { id: 'env-cove', label: 'THE COVE', sub: 'sundown on the beach', x: M + third + 20, y: ARENA.row, w: third, h: 96, small: true, selected: app.environment === 'cove' },
    { id: 'env-neon', label: 'NEON PLAZA', sub: 'rain on the back streets', x: M + 2 * (third + 20), y: ARENA.row, w: third, h: 96, small: true, selected: app.environment === 'neon' },
  ];
  return {
    buttons,
    body: (g, hover) => {
      drawTrack(g, 'SOUND FX', sfxVolume(), SFX.label, hover === 'sfx-vol');
      drawTrack(g, 'MUSIC', musicVolume(), MUSIC.label, hover === 'music-vol');
      // The readout: one word on why the music is or isn't sounding —
      // MUTED, VOLUME AT ZERO, DECODE FAILED, AUDIO SUSPENDED, PLAYING —
      // so a silent headset can say which gate it is stuck behind.
      g.textAlign = 'left';
      g.font = font(600, 18);
      g.letterSpacing = '2px';
      g.fillStyle = KIT.faint;
      g.fillText(`LOBBY MUSIC · ${menuMusicStatus()}`, M + 20, MUSIC.track + 62);
      g.letterSpacing = '0px';
      g.font = font(600, 26);
      g.letterSpacing = '2px';
      g.fillStyle = hover === 'env-desert' || hover === 'env-cove' || hover === 'env-neon' ? KIT.accent : KIT.dim;
      g.fillText('ARENA', M, ARENA.label);
      g.letterSpacing = '0px';
      g.textAlign = 'center';
      g.font = font(500, 24);
      g.fillStyle = KIT.faint;
      g.fillText('audio · voice · arena · safety', W / 2, 940);
    },
  };
}
