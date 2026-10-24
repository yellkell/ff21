/** FF2 lobby: player intent owns the top level; game families live under PLAY.
 * See docs/menu-research.md for the audit, evidence and navigation contract.
 * The three existing VR panels retain their physical sizes and ray targets.
 *
 * THE RAIL (back from the Meta Quest build): the slab's tabs are CAREER ·
 * VERSUS · RAVE RAID · CLUB, the left wing's RANKINGS · NEWS, the right
 * wing's LOCKER · STORE and a settings cog. PRACTICE and SOCIAL are gone —
 * AIM TRAINING (SHOOT BACK beside it) and the TUTORIAL replay are VERSUS
 * modes, and so are CUSTOM GAMES and the CO-OP RAID. RAVE RAID and CLUB are
 * doors: one press walks you in. ACTIVITY is off the strip; its counts ride
 * the doors they belong to (the queue on QUICK MATCH, squads on CO-OP RAID,
 * the club's head count on CLUB). The menus never say "bots".
 */

import type { Menu, MenuAction, MenuPanel, PanelId } from './menu.js';
import { renderNewsPage } from './menu.js';
import { Panel, KIT, type PanelButton, type PanelOpts } from '../ui/kit/panel.js';
import { font } from '../ui/kit/fonts.js';
import { app } from './appState.js';
import { coins } from './wallet.js';
import { PLATFORMS_OPEN } from '../avatar/skins.js';
import { leaderboard, setLeaderboardTab } from '../net/leaderboard.js';
import { gazette } from '../net/gazette.js';
import { ladderFace } from './ladder.js';
import { settingsFace } from './settingsFace.js';
import { CARD_H, CARD_W, CHIP_H, CHIP_W, profileCardFace, profileChipFace } from './profilePop.js';
import { GAME_TITLE, warmRoomServer } from '../config.js';
import { prefetchVenue } from '../rave/club/venue.js';
import { CAMP_W, CAREER_BOTTOM, CAREER_TOP, careerFace } from './campaignFace.js';

/** One face of a wrap panel: everything Panel.paint needs. */
interface Face {
  title: string;
  body?: (g: CanvasRenderingContext2D, hover: string | null) => void;
  buttons: PanelButton[];
}

/** A kit panel wearing FF1's MenuPanel contract. `onClick` receives every
 *  pressed button id (a local namespace id or a real MenuAction) —
 *  defining MenuPanel.click keeps MenuSystem's pre-tutorial gate in front
 *  while letting the owner route ids itself. Exported: the paint bay (and
 *  every future kit modal) rides the same adapter. */
export class KitMenuPanel implements MenuPanel {
  readonly kit: Panel;
  readonly mesh;
  click?: (u: number, v: number) => boolean;
  /** A face with a slider sets this (MenuSystem.addModal): the scrub hook
   *  MenuSystem feeds the hit's UV every frame the trigger is held. */
  drag?: (u: number, v: number, grabbed?: boolean) => boolean;

  constructor(
    readonly id: PanelId,
    wM: number,
    hM: number,
    pxW: number,
    pxH: number,
    private face: () => Face,
    onClick?: (id: string) => void,
    opts: PanelOpts = {},
  ) {
    this.kit = new Panel(wM, hM, pxW, pxH, opts);
    this.mesh = this.kit.mesh;
    this.mesh.name = `menu-panel:${id}`;
    if (onClick) {
      this.click = (u: number, v: number): boolean => {
        const id = this.kit.buttonAt(u, v);
        if (!id) return false;
        this.kit.press(id);
        onClick(id);
        return true; // MenuSystem clicks the relay + redraws all panels
      };
    }
  }

  redraw(hoverAction: MenuAction | null): void {
    const f = this.face();
    this.kit.paint(f.title, f.body ?? (() => {}), f.buttons, hoverAction);
  }

  hitTest(u: number, v: number): MenuAction | null {
    return this.kit.buttonAt(u, v) as MenuAction | null;
  }

  tick(delta: number, pulse: number): void {
    this.kit.tick(delta, pulse);
  }
}

/* ── the wrap's tab state ─────────────────────────────────────────────── */

export type CenterTab = 'career' | 'versus' | 'club';
export type TownTab = 'ladder' | 'news';
export type YouTab = 'you' | 'store' | 'settings';

/** Which tab each panel is on. */
export const wrapNav = {
  // The slab opens on the CAREER: the titan line-up is the first thing up.
  center: 'career' as CenterTab,
  // The wing opens on the PAPER: the day's edition — or the welcome, for a
  // newcomer — is the first thing on the wall, not a chip count.
  town: 'news' as TownTab,
  you: 'you' as YouTab,
};

/** Put the slab on the CAREER tab (campaign bouts return here, win or
 *  lose; the legacy open-campaign action lands here too). */
export function showCampaign(): void {
  wrapNav.center = 'career';
  app.duelView = 'root';
}

/* ── shared bits ──────────────────────────────────────────────────────── */

const sealed = (): boolean => !app.tutorialDone;
const SEAL_SUB = 'sealed — run the tutorial';
const TAB_Y = 36;
const TAB_H = 76;

function note(text: string, y: number, W: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = font(500, 24);
    g.fillStyle = KIT.faint;
    g.fillText(text, W / 2, y);
  };
}

/** A sub-face's name, right-aligned in the tab strip (FIGHT › PRIVATE). */
function crumb(text: string, W: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.font = font(600, 26);
    g.letterSpacing = '3px';
    g.fillStyle = KIT.faint;
    g.fillText(text, W - 52, TAB_Y + TAB_H / 2 - 2);
    g.letterSpacing = '0px';
  };
}

const both =
  (...fns: Array<((g: CanvasRenderingContext2D, hover: string | null) => void) | undefined>) =>
  (g: CanvasRenderingContext2D, hover: string | null): void => {
    for (const f of fns) f?.(g, hover);
  };

/* Center: Career, Versus, Rave Raid and the Club. */

const CW = 1536; // canvas
const M = 96; // margin
const WIDE = CW - M * 2; // 1344
const COL = 656; // half column
const C2 = M + COL + 32; // right column x
const COL3 = (WIDE - 48) / 3; // a third column (VERSUS's grid)
const col3 = (i: number): number => M + i * (COL3 + 24);

const clubUp = (): boolean => wrapNav.center === 'club';
/** CAREER, RAVE RAID and CLUB are shut while sealed or while a search runs. */
const doorShut = (): boolean => sealed() || app.state === 'queueing';

function centerTabs(): PanelButton[] {
  // Sealed, the slab is the tutorial's face whichever tab was last up: VERSUS wears it.
  const on = sealed() ? 'versus' : wrapNav.center;
  return [
    { id: 'wrap:tab-career', label: 'CAREER', tab: true, x: 420, y: TAB_Y, w: 210, h: TAB_H, selected: on === 'career', disabled: doorShut() },
    { id: 'wrap:tab-fight', label: 'VERSUS', tab: true, x: 640, y: TAB_Y, w: 220, h: TAB_H, selected: on === 'versus' },
    { id: 'wrap:tab-rave', label: 'RAVE RAID', tab: true, x: 870, y: TAB_Y, w: 270, h: TAB_H, disabled: doorShut() },
    { id: 'wrap:tab-club', label: 'CLUB', tab: true, x: 1150, y: TAB_Y, w: 180, h: TAB_H, selected: on === 'club', disabled: doorShut(), badge: !sealed() && app.pubCount > 0 },
  ];
}

const BACK: PanelButton = { id: 'wrap:back', label: 'BACK', x: M, y: 888, w: 320, h: 84, small: true };

function sealedFace(): Face {
  return {
    title: GAME_TITLE,
    body: () => {},
    buttons: [
      {
        id: 'start-tutorial',
        label: 'TUTORIAL',
        sub: 'the guided basics — start here',
        x: M, y: 190, w: WIDE, h: 240,
        primary: true,
      },
      { id: 'quick-match', label: 'QUICK MATCH', sub: SEAL_SUB, x: M, y: 480, w: COL, h: 190, disabled: true },
      { id: 'open-pub', label: 'THE CLUB', sub: SEAL_SUB, x: C2, y: 480, w: COL, h: 190, disabled: true },
    ],
  };
}

/** VERSUS: every way to fight — the 1v1s, the brawls, the co-op raid, and
 *  the practice that used to have a tab of its own. */
function versusFace(): Face {
  const queueing = app.state === 'queueing';
  const ROW = [160, 370, 580];
  const H = 180;
  const cell = (i: number, r: number): Pick<PanelButton, 'x' | 'y' | 'w' | 'h'> => ({ x: col3(i), y: ROW[r], w: COL3, h: H });
  const buttons: PanelButton[] = [
    queueing
      ? {
          id: 'cancel-queue',
          label: 'CANCEL SEARCH',
          sub: app.searching > 0 ? `${app.searching} in the queue` : 'searching…',
          ...cell(0, 0),
          tone: KIT.danger,
        }
      : {
          id: 'quick-match',
          label: 'QUICK MATCH',
          sub: app.onlyBots ? '1v1 against a rival' : app.searching > 0 ? `1v1 - ${app.searching} searching now` : '1v1 - fight now while finding a rival',
          ...cell(0, 0),
          primary: true,
        },
    {
      id: 'ranked-match',
      label: 'RANKED',
      sub: app.onlyBots ? 'Online play is off' : 'Competitive 1v1 rooms',
      ...cell(1, 0),
      disabled: app.onlyBots || queueing,
    },
    { id: 'private-open', label: 'CUSTOM GAMES', sub: 'Private rooms with a code', ...cell(2, 0), disabled: queueing },
    { id: 'arcade-2v2', label: '2V2', sub: 'Team battles', ...cell(0, 1), disabled: queueing },
    { id: 'arcade-ffa', label: 'FREE FOR ALL', sub: 'Every fighter for themselves', ...cell(1, 1), disabled: queueing },
    {
      id: 'open-raid',
      label: 'CO-OP RAID',
      sub: app.onlyBots ? 'Online play is off' : app.raidsOpen > 0 ? `${app.raidsOpen} squads forming` : 'Squad up against the titans',
      ...cell(2, 1),
      disabled: app.onlyBots || queueing,
    },
    { id: 'start-training', label: 'AIM TRAINING', sub: 'Target practice', ...cell(0, 2), disabled: queueing },
    // AIM TRAINING's one option, beside it (it was PRACTICE's toggle).
    { id: 'toggle-shootback', label: 'SHOOT BACK', sub: 'Aim training only', ...cell(1, 2), small: true, selected: app.shootBack, toggle: true },
    { id: 'start-tutorial', label: 'TUTORIAL', sub: 'Replay the guided basics', ...cell(2, 2), disabled: queueing },
  ];
  return {
    title: GAME_TITLE,
    body: () => {},
    buttons,
  };
}

function privateFace(): Face {
  const modes = [
    { id: 'private-mode-1v1' as MenuAction, label: '1V1', mode: '1v1', seats: '2 seats' },
    { id: 'private-mode-2v2' as MenuAction, label: '2V2', mode: '2v2', seats: '4 seats' },
    { id: 'private-mode-ffa' as MenuAction, label: 'FFA', mode: 'ffa', seats: '4 seats' },
  ];
  const buttons: PanelButton[] = modes.map((m, i) => ({
    id: m.id,
    label: m.label,
    sub: m.seats,
    x: C2 + (i % 2) * (COL / 2 + 16), y: 170 + Math.floor(i / 2) * 150, w: COL / 2 - 16, h: 130,
    small: true,
    selected: app.privateMode === m.mode,
  }));
  buttons.push(
    {
      id: 'private-create',
      label: 'CREATE CODE',
      sub: 'reserve a room of that shape',
      x: M, y: 170, w: COL, h: 190,
      primary: true,
    },
    {
      id: 'private-enter',
      label: 'ENTER A CODE',
      sub: 'join whatever your mate opened',
      x: M, y: 400, w: COL, h: 150,
    },
    { ...BACK, id: 'private-back' },
  );
  return {
    title: GAME_TITLE,
    body: crumb('CUSTOM GAMES', CW),
    buttons,
  };
}

function keypadFace(): Face {
  const draft = app.codeEntry.padEnd(5, '·').split('').join(' ');
  const buttons: PanelButton[] = [
    { id: 'code-draft', label: draft, sub: 'the code', x: M, y: 200, w: COL, h: 170, display: true, px: 72 },
    {
      id: 'kp-join',
      label: 'JOIN',
      x: M, y: 430, w: COL, h: 170,
      primary: app.codeEntry.length === 5,
      disabled: app.codeEntry.length < 5,
    },
    { ...BACK, id: 'private-back' },
  ];
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', ''];
  const kw = 200;
  const kh = 130;
  keys.forEach((k, i) => {
    if (!k) return;
    const id = k === '⌫' ? 'kp-del' : `kp-${k}`;
    buttons.push({
      id: id as MenuAction,
      label: k,
      x: C2 + (i % 3) * (kw + 24), y: 160 + Math.floor(i / 3) * (kh + 20), w: kw, h: kh,
      px: 44,
      disabled: k === '⌫' && app.codeEntry.length === 0,
    });
  });
  return { title: GAME_TITLE, body: crumb('ENTER CODE', CW), buttons };
}

function hostingFace(): Face {
  return {
    title: GAME_TITLE,
    body: both(crumb('CUSTOM GAMES', CW), note('the room launches itself once the seats fill', 700, CW)),
    buttons: [
      {
        id: 'code-live',
        label: app.privateCode ? app.privateCode.split('').join(' ') : 'RESERVING…',
        sub: 'your code — shout it, ping it, text it',
        x: M + 240, y: 240, w: WIDE - 480, h: 240,
        display: true,
        px: 110,
        tone: KIT.accent,
      },
      { ...BACK, id: 'private-back', label: 'CANCEL', tone: KIT.danger },
    ],
  };
}

function browserFace(): Face {
  const hostingOwn = app.rankedRoomId !== '';
  const rows = app.rankedRooms.slice(0, 5);
  const buttons: PanelButton[] = rows.map((r, i) => ({
    id: `ranked-join-${r.id}` as MenuAction,
    label: r.host,
    sub: r.id === app.rankedRoomId ? 'your room — holding the door' : 'open — step in',
    x: M, y: 160 + i * 136, w: 800, h: 118,
    small: true,
    disabled: r.id === app.rankedRoomId || hostingOwn,
    selected: r.id === app.rankedRoomId,
  }));
  buttons.push(
    hostingOwn || app.rankedHost
      ? { id: 'ranked-cancel', label: 'STAND DOWN', sub: 'close your room', x: 968, y: 160, w: 472, h: 170, tone: KIT.danger }
      : { id: 'ranked-host', label: 'HOST A ROOM', sub: 'your name on the board', x: 968, y: 160, w: 472, h: 170, primary: true },
    { ...BACK, id: 'ranked-back' },
  );
  return {
    title: GAME_TITLE,
    body: both(crumb('RANKED', CW), rows.length === 0 ? note('no open rooms — put your name up', 500, CW) : undefined),
    buttons,
  };
}

/** CAREER: THE CAREER itself (campaignFace.ts), scaled onto the slab under
 *  the tab strip — no sub-menu between you and the titans. The launch card
 *  and THE RACK still pop up on their own panel. */
const CAREER_Y = 136; // just under the tab strip
const CAREER_S = Math.min(WIDE / (CAMP_W - 128), (972 - CAREER_Y) / (CAREER_BOTTOM - CAREER_TOP));
const CAREER_DX = (CW - CAMP_W * CAREER_S) / 2;
const CAREER_DY = CAREER_Y - CAREER_TOP * CAREER_S;

function careerTabFace(): Face {
  const f = careerFace();
  const s = CAREER_S;
  return {
    title: GAME_TITLE,
    body: (g, hover) => {
      g.save();
      g.translate(CAREER_DX, CAREER_DY);
      g.scale(s, s);
      f.body(g, hover);
      g.restore();
    },
    buttons: f.buttons.map((b) => ({ ...b, x: CAREER_DX + b.x * s, y: CAREER_DY + b.y * s, w: b.w * s, h: b.h * s })),
  };
}

/** THE CLUB: its tab is a door (one press knocks — see installWrap), and
 *  this face is what stands behind it while the house wakes, or for a
 *  second knock if you come home and want back in. */
function clubFace(): Face {
  // THE DOOR, HELD. ENTER CLUB no longer drops the curtain at once: the
  // arena first gets the venue's floor to answer — the room server sleeps
  // on a free tier and can take most of a minute to wake — and only then
  // crosses, so the black lifts on the club and never on the rave's foyer
  // (experience/ClubExperienceManager holdForTheFloor). While it waits,
  // this board says so, and the button is not a button.
  const waiting = app.venueStatus !== '';
  return {
    title: GAME_TITLE,
    body: !waiting && app.pubCount > 0 ? note(`${app.pubCount} in the club right now`, 650, CW) : () => {},
    buttons: [
      {
        id: 'open-pub',
        label: waiting ? 'WAKING THE HOUSE' : 'ENTER CLUB',
        sub: waiting ? app.venueStatus : 'Hang out, meet players and explore the venue',
        // A button the size of the board reads as the board. This is a
        // button: the same height as the ones on every other face, sitting
        // in the same first-row slot, just wider because it's alone.
        x: (CW - COL) / 2, y: 240, w: COL, h: 240,
        primary: !waiting,
        // While the door is held it is a live readout, not a dead button
        // (the kit's `disabled` grey reads as broken; `display` reads as
        // data) — and the kit already refuses presses on a display chip.
        display: waiting,
        tone: waiting ? KIT.accent : undefined,
      },
    ],
  };
}

function centerFace(): Face {
  let face: Face;
  if (sealed()) face = sealedFace();
  else if (clubUp()) face = clubFace();
  else if (wrapNav.center === 'career') face = careerTabFace();
  else {
    switch (app.duelView) {
      case 'private':
        face = privateFace();
        break;
      case 'keypad':
        face = keypadFace();
        break;
      case 'hosting':
        face = hostingFace();
        break;
      case 'browser':
        face = browserFace();
        break;
      default:
        face = versusFace();
    }
  }
  return { ...face, buttons: [...centerTabs(), ...face.buttons] };
}

/* Left wing: Rankings and News. */

const LW = 832;

function townTabs(): PanelButton[] {
  const lock = sealed();
  return [
    { id: 'wrap:tab-ladder', label: 'RANKINGS', tab: true, x: 36, y: TAB_Y, w: 260, h: TAB_H, selected: wrapNav.town === 'ladder' && !lock, disabled: lock },
    // The pip says "a new edition you haven't seen" — pointless while the
    // paper is the very thing on the wing (MenuSystem marks it read there).
    { id: 'wrap:tab-news', label: 'NEWS', tab: true, x: 306, y: TAB_Y, w: 190, h: TAB_H, selected: wrapNav.town === 'news' || lock, badge: gazette.unread && wrapNav.town !== 'news' },
  ];
}

/** The Gasket Gazette, blitted onto the wing: the page renders on its own
 *  portrait canvas (menu.ts) and lands here scaled to fit under the strip;
 *  the thumbstick scrolls the article while the pointer is on the wing. */
function newsFace(): Face {
  // Same 4:5 as the page itself, and short enough under the strip that the
  // caption beneath it lands inside the wing's canvas rather than off it.
  const PW = 680;
  const PH = 850;
  return {
    title: '',
    // The whole page is one press: tap it and THE READER holds it up large
    // in front of you (MenuSystem 'gazette-reader'). A ghost, so the page
    // draws as a page and not as a button with a page on it.
    buttons: [{ id: 'gazette-reader', label: '', ghost: true, x: (LW - PW) / 2, y: 124, w: PW, h: PH }],
    body: (g, hover) => {
      const page = renderNewsPage();
      g.save();
      g.shadowColor = hover === 'gazette-reader' ? 'rgba(63,242,255,0.6)' : 'rgba(0,0,0,0.55)';
      g.shadowBlur = hover === 'gazette-reader' ? 34 : 24;
      g.drawImage(page, (LW - PW) / 2, 124, PW, PH);
      g.restore();
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = font(500, 20);
      g.fillStyle = KIT.faint;
      g.fillText('tap the page to hold it up', LW / 2, 124 + PH + 22);
    },
  };
}

function townFace(): Face {
  let face: Face;
  if (wrapNav.town === 'ladder' && !sealed()) face = { title: '', ...ladderFace() };
  else face = newsFace();
  return { ...face, buttons: [...townTabs(), ...face.buttons] };
}

/* Right wing: Locker and Store, and the settings cog at the strip's end. */

const COG: PanelButton = { id: 'wrap:tab-settings', label: '', tab: true, x: 690, y: TAB_Y, w: 100, h: TAB_H };

/** The settings cog: eight teeth round a real hole (the glass shows
 *  through — evenodd, never a dark dot painted on), lit while open. */
function drawCog(g: CanvasRenderingContext2D, hover: string | null): void {
  const on = wrapNav.you === 'settings';
  const cx = COG.x + COG.w / 2;
  const cy = COG.y + COG.h / 2 - 2;
  const ROOT = 19;
  const TIP = 27;
  g.save();
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const teeth: Array<[number, number]> = [[ROOT, a - 0.36], [TIP, a - 0.2], [TIP, a + 0.2], [ROOT, a + 0.36]];
    teeth.forEach(([r, t], k) => {
      const x = cx + Math.cos(t) * r;
      const y = cy + Math.sin(t) * r;
      if (i === 0 && k === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    });
  }
  g.closePath();
  g.moveTo(cx + 8, cy);
  g.arc(cx, cy, 8, 0, Math.PI * 2);
  g.fillStyle = on ? KIT.textHi : hover === COG.id ? 'rgba(250,246,238,0.95)' : 'rgba(250,246,238,0.6)';
  g.fill('evenodd');
  if (on) {
    g.fillStyle = KIT.accent;
    g.beginPath();
    g.roundRect(cx - 30, COG.y + COG.h - 8, 60, 5, 2.5);
    g.fill();
  }
  g.restore();
}

function youTabs(): PanelButton[] {
  return [
    { id: 'wrap:tab-you', label: 'LOCKER', tab: true, x: 36, y: TAB_Y, w: 230, h: TAB_H, selected: wrapNav.you === 'you' },
    { id: 'wrap:tab-store', label: 'STORE', tab: true, x: 276, y: TAB_Y, w: 190, h: TAB_H, selected: wrapNav.you === 'store', disabled: sealed() },
    { ...COG, selected: wrapNav.you === 'settings' },
  ];
}

function youBoard(): Face {
  const lock = sealed();
  return {
    title: '',
    body: () => {},
    buttons: [
      // ONE door to the customization plate — LOCKER · STORE · PAINT are
      // its tabs — and one to who you are.
      { id: 'open-custom', label: 'CUSTOMIZE', sub: lock ? SEAL_SUB : 'Locker · Store · Paint', x: 96, y: 190, w: 640, h: 260, primary: !lock, disabled: lock },
      { id: 'profile-toggle', label: 'CAREER PROFILE', sub: 'Rank, XP, achievements and identity', x: 96, y: 500, w: 640, h: 150, small: true },
    ],
  };
}

function storeBoard(): Face {
  return {
    title: '',
    body: () => {},
    buttons: [
      { id: 'open-shop', label: 'BROWSE THE STORE', sub: PLATFORMS_OPEN ? 'Gear, platforms and paint' : 'Gear and paint', x: 96, y: 190, w: 640, h: 210 },
      { id: 'open-bank', label: 'BANK', sub: 'Top up or recover your purchases', x: 96, y: 450, w: 640, h: 150, small: true },
      { id: 'store-balance', label: `$ ${coins.balance}`, sub: 'iron-dollars available', x: 96, y: 650, w: 640, h: 110, small: true, display: true },
    ],
  };
}

function youFace(): Face {
  const face: Face = wrapNav.you === 'settings' ? { title: '', ...settingsFace() }
    : wrapNav.you === 'store' && !sealed() ? storeBoard() : youBoard();
  const body = face.body;
  return {
    ...face,
    body: (g, hover) => {
      body?.(g, hover);
      drawCog(g, hover);
    },
    buttons: [...youTabs(), ...face.buttons],
  };
}

/* ── the rig ──────────────────────────────────────────────────────────── */

export interface Wrap {
  /** Advance kit transitions (hover eases, press flashes, halo breath). */
  tick(delta: number): void;
}

declare global {
  interface Window {
    __ff2?: {
      wrap: {
        buttons: (id: string) => string[];
        live: (id: string) => string[];
        snap: (id: string) => string;
        act: (action: string) => void;
        redraw: () => void;
        nav: () => { center: CenterTab; town: TownTab; you: YouTab; club: boolean };
        visible: (id: string) => boolean;
      };
    };
  }
}

/**
 * Replace the legacy 'train' / 'duel' / 'info' plates with the wrap, in
 * place — same ids, same slots, same parent group — and hang THE PROFILE
 * chip + card above the right wing. Call once, right after `createMenu`.
 * `act` is MenuSystem.run — global ids go through it; the wrap's own
 * `wrap:*` tab navigation is handled here.
 */
export function installWrap(menu: Menu, act?: (action: MenuAction) => void): Wrap {
  /** Route one pressed id: local tab-nav, or the real dispatcher. */
  const dispatch = (id: string): void => {
    switch (id) {
      case 'wrap:tab-fight':
        wrapNav.center = 'versus';
        return;
      case 'wrap:tab-career':
      case 'wrap:tab-arcade': // legacy deep link: boss activities live in CAREER
        if (doorShut()) return;
        showCampaign();
        return;
      case 'wrap:tab-rave':
        // A door, not a tab: one press and you're in RAVE RAID's foyer.
        if (doorShut()) return;
        act?.('open-rave');
        return;
      case 'wrap:tab-club':
        // A door too. The slab turns to the club's face, which reads out
        // the wait while the house wakes (ClubExperienceManager
        // holdForTheFloor); a second knock while it's held does nothing.
        if (doorShut() || app.venueStatus !== '') return;
        wrapNav.center = 'club';
        warmRoomServer();
        // The hall is the slow part of the door (sixteen megabytes).
        prefetchVenue();
        act?.('open-pub');
        return;
      case 'wrap:tab-store':
        if (sealed()) return;
        act?.('settings-close');
        wrapNav.you = 'store';
        return;
      case 'wrap:tab-ladder':
        wrapNav.town = 'ladder';
        // The ladder opens onto a board, never a blank profile.
        if (leaderboard.tab === 'profile') setLeaderboardTab('ranked');
        return;
      case 'wrap:tab-news':
        act?.('open-gazette');
        return;
      case 'wrap:tab-you':
        act?.('settings-close');
        return;
      case 'wrap:tab-settings':
        act?.('open-settings');
        return;
      case 'wrap:back':
        return;
      default:
        if (['private-open', 'ranked-match', 'quick-match'].includes(id)) wrapNav.center = 'versus';
        act?.(id as MenuAction);
    }
  };

  const slab = new KitMenuPanel('train', 1.42, 0.95, CW, 1024, centerFace, dispatch);
  const town = new KitMenuPanel('duel', 0.74, 0.91, LW, 1024, townFace, dispatch);
  const you = new KitMenuPanel('info', 0.74, 0.91, LW, 1024, youFace, dispatch);
  const chip = new KitMenuPanel('profile', 0.62, (0.62 * CHIP_H) / CHIP_W, CHIP_W, CHIP_H, profileChipFace, dispatch, { bare: true });
  const card = new KitMenuPanel('profilecard', 0.62, (0.62 * CARD_H) / CARD_W, CARD_W, CARD_H, profileCardFace, dispatch, { bare: true });

  const y = 1.45;
  slab.mesh.position.set(0, y, -1.26);
  town.mesh.position.set(-1.02, y, -1.02);
  town.mesh.rotation.y = 0.58;
  you.mesh.position.set(1.02, y, -1.02);
  you.mesh.rotation.y = -0.58;
  // THE PROFILE: the chip rides just above the YOU wing's top edge; the
  // card drops out from under it, a hand's width in front of the wing.
  const yaw = -0.58;
  const nx = Math.sin(yaw);
  const nz = Math.cos(yaw);
  const chipH = (0.62 * CHIP_H) / CHIP_W;
  const cardH = (0.62 * CARD_H) / CARD_W;
  const wingTop = y + 0.455;
  chip.mesh.position.set(1.02, wingTop + 0.02 + chipH / 2, -1.02);
  chip.mesh.rotation.y = yaw;
  card.mesh.position.set(1.02 + nx * 0.05, wingTop + 0.01 - cardH / 2, -1.02 + nz * 0.05);
  card.mesh.rotation.y = yaw;
  card.mesh.renderOrder = 31; // over the wing, whatever the sort says
  card.mesh.visible = false;

  const panels = [slab, town, you, chip, card];
  for (const p of [slab, town, you]) {
    const i = menu.panels.findIndex((old) => old.id === p.id);
    if (i < 0) continue;
    const old = menu.panels[i];
    old.mesh.removeFromParent();
    menu.panels[i] = p;
    menu.group.add(p.mesh);
    p.redraw(null);
  }
  for (const p of [chip, card]) {
    menu.panels.push(p);
    menu.group.add(p.mesh);
    p.redraw(null);
  }

  const byId = (id: string): KitMenuPanel | undefined => panels.find((p) => p.id === id);
  window.__ff2 = {
    wrap: {
      buttons: (id) => byId(id)?.kit.buttonIds() ?? [],
      live: (id) => byId(id)?.kit.liveButtons() ?? [],
      snap: (id) => (byId(id)?.kit.ctx().canvas as HTMLCanvasElement | undefined)?.toDataURL('image/png') ?? '',
      act: (action) => {
        dispatch(action);
        for (const p of panels) p.redraw(null);
      },
      redraw: () => {
        for (const p of panels) p.redraw(null);
      },
      nav: () => ({ ...wrapNav, club: clubUp() }),
      visible: (id) => byId(id)?.mesh.visible ?? false,
    },
  };

  let clock = 0;
  return {
    tick(delta: number): void {
      clock += delta;
      const pulse = 0.5 + 0.5 * Math.sin((clock * 2 * Math.PI) / 6);
      for (const p of panels) p.tick(delta, pulse);
    },
  };
}
