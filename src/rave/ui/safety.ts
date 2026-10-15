/**
 * THE SAFETY CONSOLE — who you can hear, and the switches to stop hearing
 * them. One implementation, two homes.
 *
 * It was born on the club floor's SOCIAL panel, which was fine while the
 * only place you shared air with people was the club. But a room OUTLIVES
 * its sets: the voices keep going when the record drops, pinned to each
 * dancer's platform out on the ring. A dancer who turns unpleasant halfway
 * through a song was, until now, someone you had to finish the song with —
 * the controls to shut them up were three screens away on a floor you'd
 * left. So the console moved here, and the mid-set pause card grew a copy.
 *
 * Both panels get the same rows in the same order with the same buttons,
 * because a safety control that looks different depending on where you are
 * is one you have to learn twice.
 *
 * MUTE and BLOCK are strictly local (src/club/social.ts); the mic and the
 * voice-chat master switch are this headset's own (src/club/voice.ts).
 */

import { hueToColor } from '../config.js';
import { socialBlocked, socialMuted, toggleSocialBlock, toggleSocialMute } from '../club/social.js';
import {
  isSpeaking,
  isVoiceCapturing,
  isVoiceMuted,
  setVoiceEnabled,
  toggleVoiceMuted,
  voiceEnabled,
} from '../club/voice.js';
import { memberHue, net } from '../net/session.js';
import { font } from './fonts.js';
import { UI, type PanelButton } from './panel.js';

/** Where the console sits on its host panel's canvas. */
export interface SafetyLayout {
  /** Left edge of the name column. */
  left: number;
  /** Right edge of the BLOCK button — the console's right margin. */
  right: number;
  /** Top of the first row. */
  y: number;
  rowH?: number;
}

export interface SafetyRow {
  idx: number;
  name: string;
}

const BTN_W = 136;
const BTN_GAP = 14;
const ROW_H = 58;

/** Everyone in the room but you, capped, plus how many didn't fit. */
export function safetyRoster(max: number): { rows: SafetyRow[]; more: number } {
  const all = net.members.filter((m) => m.idx !== net.myIdx);
  return {
    rows: all.slice(0, max).map((m) => ({ idx: m.idx, name: m.name })),
    more: Math.max(0, all.length - Math.min(all.length, max)),
  };
}

/**
 * Repaint key for everything the console draws. Includes the SPEAKING
 * state, which the club's panel used to leave out — so its presence dots
 * only ever lit when something else on the panel happened to change, and a
 * room could hold the floor in silence as far as the desk was concerned.
 */
export function safetyKey(rows: SafetyRow[], more: number): string {
  const people = rows
    .map(
      (r) =>
        `${r.name}|${socialMuted(r.name) ? 1 : 0}${socialBlocked(r.name) ? 1 : 0}` +
        `${net.gamePlayers.has(r.idx) ? 'R' : ''}${isSpeaking(String(r.idx)) ? '~' : ''}`,
    )
    .join(';');
  return (
    `${people}#${more}#${voiceEnabled() ? 1 : 0}#${isVoiceMuted() ? 1 : 0}#${isVoiceCapturing() ? 1 : 0}` +
    // The crown is drawn into a row, so a coronation has to repaint it.
    `#${net.crownIdx ?? ''}`
  );
}

/** MUTE and BLOCK, one pair per dancer, right-aligned in the layout. */
export function safetyButtons(rows: SafetyRow[], layout: SafetyLayout): PanelButton[] {
  const rowH = layout.rowH ?? ROW_H;
  const blockX = layout.right - BTN_W;
  const muteX = blockX - BTN_GAP - BTN_W;
  const out: PanelButton[] = [];
  rows.forEach((r, i) => {
    const y = layout.y + i * rowH;
    out.push({
      id: `mute:${r.name}`,
      label: socialMuted(r.name) ? 'MUTED' : 'MUTE',
      tone: socialMuted(r.name) ? UI.danger : undefined,
      x: muteX,
      y,
      w: BTN_W,
      h: 50,
      small: true,
    });
    out.push({
      id: `block:${r.name}`,
      label: socialBlocked(r.name) ? 'BLOCKED' : 'BLOCK',
      tone: socialBlocked(r.name) ? UI.danger : undefined,
      x: blockX,
      y,
      w: BTN_W,
      h: 50,
      small: true,
    });
  });
  return out;
}

/**
 * Your own mic line and the voice-chat master switch, stacked at `y`.
 *
 * `music` is the CLUB FLOOR's record switch, and it is optional because
 * only the floor has one: pass it and VOICE CHAT shares its line with
 * MUSIC as a pair — the two things you HEAR in that room, read at a
 * glance, which is what makes "turn the music down so we can chat" one
 * decision instead of two. Out on the ring there is no floor record to
 * hush (the set owns the air), so the mid-set card omits it and VOICE
 * CHAT takes the full width on its own.
 */
export function voiceButtons(
  x: number,
  y: number,
  w: number,
  opts: { music?: boolean } = {},
): PanelButton[] {
  const on = voiceEnabled();
  const mic = !isVoiceMuted() && isVoiceCapturing();
  const withMusic = opts.music !== undefined;
  // Paired: two columns across the same span, with the console's own gap.
  const halfW = Math.floor((w - BTN_GAP) / 2);
  const out: PanelButton[] = [
    {
      id: 'mic',
      label: mic ? 'MIC LIVE — left Ⓨ mutes' : on ? 'MIC MUTED — left Ⓨ opens it' : 'MIC OFF',
      tone: mic ? UI.positive : UI.danger,
      x,
      y,
      w,
      h: 54,
      small: true,
    },
    {
      id: 'voice',
      label: on ? 'VOICE CHAT: ON' : 'VOICE CHAT: OFF',
      tone: on ? undefined : UI.danger,
      x,
      y: y + 62,
      w: withMusic ? halfW : w,
      h: 60,
      small: true,
    },
  ];
  if (withMusic) {
    out.push({
      id: 'music',
      label: opts.music ? 'MUSIC: ON' : 'MUSIC: OFF',
      // OFF is the LOUD state on this desk — a silenced floor is a thing
      // you did on purpose and want to see you did.
      tone: opts.music ? undefined : UI.danger,
      x: x + halfW + BTN_GAP,
      y: y + 62,
      w: halfW,
      h: 60,
      small: true,
    });
  }
  return out;
}

/** The name column: their colour, struck through when blocked, marked when
 *  they're away on the ring, dotted while they're holding the floor. */
export function drawSafetyRows(
  g: CanvasRenderingContext2D,
  rows: SafetyRow[],
  more: number,
  layout: SafetyLayout,
  emptyNote = 'nobody else in the room right now',
): void {
  const rowH = layout.rowH ?? ROW_H;
  const muteX = layout.right - BTN_W * 2 - BTN_GAP;
  rows.forEach((r, i) => {
    const y = layout.y + i * rowH + 25;
    const hidden = socialBlocked(r.name);
    const away = net.gamePlayers.has(r.idx);
    if (i > 0) {
      g.fillStyle = UI.lineFaint;
      g.fillRect(layout.left, y - 29, layout.right - layout.left - 8, 1.5);
    }
    g.font = font(600, 29);
    g.letterSpacing = '1px';
    const member = net.members.find((m) => m.idx === r.idx);
    g.fillStyle = hidden
      ? UI.faint
      : `#${hueToColor(member ? memberHue(member) : 0, 0.62).toString(16).padStart(6, '0')}`;
    // The reigning winner's row leads with the crown they're wearing.
    const label = (net.crownIdx === r.idx ? '👑 ' : '') + r.name.slice(0, 12);
    g.fillText(label, layout.left, y);
    g.letterSpacing = '0px';
    if (hidden) {
      const w = g.measureText(label).width;
      g.strokeStyle = 'rgba(172,182,198,0.6)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(layout.left, y);
      g.lineTo(layout.left + w, y);
      g.stroke();
    }
    if (away) {
      // Right-aligned into the gutter before MUTE rather than parked at a
      // fixed offset: the console lives on panels of different widths now,
      // and a fixed x that clears the buttons at 700px runs under them at
      // 600. The gutter is the thing that's actually constant.
      g.fillStyle = UI.warn;
      g.font = font(600, 19);
      g.letterSpacing = '1.5px';
      g.textAlign = 'right';
      g.fillText('ON THE RING', muteX - 18, y);
      g.textAlign = 'left';
      g.letterSpacing = '0px';
    } else if (isSpeaking(String(r.idx))) {
      // The presence dot: they're holding the floor right now.
      g.fillStyle = UI.positive;
      g.shadowColor = UI.positive;
      g.shadowBlur = 8;
      g.beginPath();
      g.arc(muteX - 44, y, 6, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
  });
  if (more > 0) {
    g.font = font(500, 21);
    g.fillStyle = UI.dim;
    g.fillText(`…and ${more} more in the room`, layout.left, layout.y + rows.length * rowH + 22);
  }
  if (!rows.length) {
    g.font = font(500, 24);
    g.fillStyle = UI.dim;
    g.fillText(emptyNote, layout.left, layout.y + 30);
  }
}

/** Apply a console click. True if the id belonged to the console. */
export function safetyClick(id: string): boolean {
  if (id === 'voice') {
    setVoiceEnabled(!voiceEnabled());
    return true;
  }
  if (id === 'mic') {
    toggleVoiceMuted();
    return true;
  }
  if (id.startsWith('mute:')) {
    toggleSocialMute(id.slice(5));
    return true;
  }
  if (id.startsWith('block:')) {
    toggleSocialBlock(id.slice(6));
    return true;
  }
  return false;
}
