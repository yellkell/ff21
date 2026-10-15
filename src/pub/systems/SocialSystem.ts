/**
 * The SOCIAL panel — the pub's safety console, and the Horizon Store's
 * social-app requirement made flesh. Press A (right controller) and a panel
 * rises in front of you (the arena's between-rounds loadout idiom: waist
 * height, lectern lean, yawed to face you) listing everyone in the room with
 * MUTE and BLOCK buttons per punter. Point a controller and pull the trigger.
 *
 *   MUTE   — their voice stops reaching you (they stay visible).
 *   BLOCK  — mute + their avatar and name tag vanish for you.
 *   PAINT  — their painting renders bare base tone for you (docs/paint.md §6).
 *   REPORT — file their packed look to the reports box, evidence included.
 *
 * All but REPORT are local-only and persist across visits by callsign
 * (src/pub/social). PubPlayerSystem applies the lists every frame; this
 * panel just edits them.
 */

import { createSystem, InputComponent } from '@iwsdk/core';
import { Quaternion, Raycaster, Vector3 } from 'three';
import { uiClick } from '../../audio/sfx.js';
import { sendPaintReport } from '../../net/leaderboard.js';
import { isVoiceMuted } from '../voice/capture.js';
import { Panel } from '../panel.js';
import { pub } from '../state.js';
import {
  socialBlocked,
  socialMuted,
  socialPaintHidden,
  toggleSocialBlock,
  toggleSocialMute,
  toggleSocialPaintHide,
} from '../social.js';

const HANDS = ['left', 'right'] as const;

const PANEL_W = 0.72; // widened for the paint switches (4 buttons per row)
const PANEL_H = 0.62;
const PX = 760; // canvas px per metre — crisp text at arm's length
const ROW_H = 52;
const ROWS_TOP = 96;
const BTN_W = 78;
const BTN_H = 38;
const BTN_GAP = 8;

const _head = new Vector3();
const _fwd = new Vector3();
const _o = new Vector3();
const _dir = new Vector3();
const _q = new Quaternion();

interface RowHit {
  name: string;
  kind: 'mute' | 'block' | 'paint' | 'report';
  x: number;
  y: number;
}

export class SocialSystem extends createSystem({}) {
  private panel!: Panel;
  private ray = new Raycaster();
  private hits: RowHit[] = [];
  private hover: string | null = null; // `${kind}:${name}`
  private paintKey = '';
  /** Callsigns whose paint you've already reported this visit. */
  private reported = new Set<string>();

  init(): void {
    this.panel = new Panel(PANEL_W, PANEL_H, PX);
    this.panel.mesh.visible = false;
    this.panel.mesh.rotation.order = 'YXZ';
    pub.refs!.root.add(this.panel.mesh);
  }

  update(): void {
    // A toggles the panel, arena-style. Placed fresh on each open.
    if (this.input.xr.gamepads.right?.getButtonDown(InputComponent.A_Button)) {
      this.panel.mesh.visible = !this.panel.mesh.visible;
      if (this.panel.mesh.visible) this.place();
      uiClick();
    }
    if (!this.panel.mesh.visible) return;

    // Pointer: either controller ray; trigger clicks the hovered button.
    let hover: string | null = null;
    for (const hand of HANDS) {
      const rayspace = this.player.raySpaces?.[hand];
      if (!rayspace) continue;
      rayspace.getWorldPosition(_o);
      rayspace.getWorldQuaternion(_q);
      _dir.set(0, 0, -1).applyQuaternion(_q).normalize();
      this.ray.set(_o, _dir);
      this.ray.far = 3;
      const hit = this.ray.intersectObject(this.panel.mesh, false)[0];
      if (!hit?.uv) continue;
      const x = hit.uv.x * PANEL_W * PX;
      const y = (1 - hit.uv.y) * PANEL_H * PX;
      const over = this.hitTest(x, y);
      if (!over) continue;
      hover = `${over.kind}:${over.name}`;
      if (this.input.xr.gamepads[hand]?.getButtonDown(InputComponent.Trigger)) {
        if (over.kind === 'mute') toggleSocialMute(over.name);
        else if (over.kind === 'block') toggleSocialBlock(over.name);
        else if (over.kind === 'paint') toggleSocialPaintHide(over.name);
        else if (!this.reported.has(over.name)) {
          // REPORT PAINT: their packed look IS the evidence — file it as-is.
          // Once per punter per visit; the button flips to SENT.
          this.reported.add(over.name);
          const punter = [...pub.punters.values()].find((p) => p.name === over.name);
          void sendPaintReport(over.name, punter?.lk ?? '');
        }
        uiClick();
      }
    }
    this.hover = hover;
    this.paint();
  }

  /** In front of you at waist height with the loadout panel's lectern lean. */
  private place(): void {
    this.player.head.getWorldPosition(_head);
    // Head-local -z is where you're looking (XR convention) — flattened.
    this.player.head.getWorldQuaternion(_q);
    _fwd.set(0, 0, -1).applyQuaternion(_q);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
    _fwd.normalize();
    const m = this.panel.mesh;
    m.position.set(_head.x + _fwd.x * 0.55, _head.y - 0.45, _head.z + _fwd.z * 0.55);
    m.rotation.set(-0.28, Math.atan2(_head.x - m.position.x, _head.z - m.position.z), 0);
    this.paintKey = ''; // fresh paint at the new spot
  }

  private hitTest(x: number, y: number): RowHit | null {
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + BTN_W && y >= h.y && y <= h.y + BTN_H) return h;
    }
    return null;
  }

  private paint(): void {
    const punters = [...pub.punters.values()].sort((a, b) => a.name.localeCompare(b.name));
    const micMuted = isVoiceMuted();
    const key =
      punters
        .map(
          (p) =>
            `${p.name}|${socialMuted(p.name) ? 1 : 0}${socialBlocked(p.name) ? 1 : 0}${socialPaintHidden(p.name) ? 1 : 0}${this.reported.has(p.name) ? 1 : 0}`,
        )
        .join(';') + `#${this.hover ?? ''}#${micMuted ? 'm' : 'o'}`;
    if (key === this.paintKey) return;
    this.paintKey = key;

    const W = Math.round(PANEL_W * PX);
    this.hits = [];
    this.panel.draw((ctx, _w, h) => {
      void h;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      ctx.font = "700 34px 'Arial Narrow', system-ui, sans-serif";
      ctx.fillStyle = '#ffb000';
      ctx.fillText('PUNTERS', 24, 44);
      ctx.font = "600 17px 'Arial Narrow', system-ui, sans-serif";
      ctx.fillStyle = 'rgba(172,182,198,0.75)';
      ctx.fillText('mute · block hides them · paint bares their body · report files their look', 24, 74);

      // YOUR mic, top-right: the little glyph mirrors the left-Y mute so you
      // can always tell whether the room can hear you.
      const mx = W - 24 - 96;
      const on = !micMuted;
      ctx.strokeStyle = on ? '#ffb000' : '#e8352a';
      ctx.fillStyle = on ? '#ffb000' : '#e8352a';
      ctx.lineWidth = 3;
      // capsule + stand
      ctx.beginPath();
      ctx.roundRect(mx, 24, 14, 24, 7);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx + 7, 44, 13, 0.15, Math.PI - 0.15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(mx + 7, 57);
      ctx.lineTo(mx + 7, 64);
      ctx.moveTo(mx - 2, 64);
      ctx.lineTo(mx + 16, 64);
      ctx.stroke();
      if (!on) {
        // the slash
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(mx - 8, 18);
        ctx.lineTo(mx + 22, 68);
        ctx.stroke();
      }
      ctx.font = "800 16px 'Arial Narrow', system-ui, sans-serif";
      ctx.fillText(on ? 'MIC LIVE' : 'MIC MUTED', mx + 28, 36);
      ctx.fillStyle = 'rgba(172,182,198,0.7)';
      ctx.font = "600 15px 'Arial Narrow', system-ui, sans-serif";
      ctx.fillText('left Y flips', mx + 28, 56);

      if (!punters.length) {
        ctx.font = "600 22px 'Arial Narrow', system-ui, sans-serif";
        ctx.fillStyle = 'rgba(172,182,198,0.6)';
        ctx.fillText('nobody else in the pub right now', 24, ROWS_TOP + 30);
        return;
      }

      punters.forEach((p, i) => {
        const y = ROWS_TOP + i * ROW_H;
        if (y + ROW_H > PANEL_H * PX - 8) return; // 12-punter room always fits; belt & braces
        const muted = socialMuted(p.name);
        const hidden = socialBlocked(p.name);
        // Name in their accent, struck grey if blocked.
        ctx.textAlign = 'left';
        ctx.font = "700 24px 'Arial Narrow', system-ui, sans-serif";
        ctx.fillStyle = hidden ? 'rgba(172,182,198,0.45)' : `#${(p.accent & 0xffffff).toString(16).padStart(6, '0')}`;
        const name = p.name.slice(0, 12).toUpperCase();
        ctx.fillText(name, 24, y + ROW_H / 2);
        if (hidden) {
          const tw = ctx.measureText(name).width;
          ctx.strokeStyle = 'rgba(172,182,198,0.6)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(24, y + ROW_H / 2);
          ctx.lineTo(24 + tw, y + ROW_H / 2);
          ctx.stroke();
        }

        const button = (label: string, on: boolean, kind: RowHit['kind'], bx: number): void => {
          const by = y + (ROW_H - BTN_H) / 2;
          const hot = this.hover === `${kind}:${p.name}`;
          ctx.fillStyle = on ? 'rgba(232,53,42,0.28)' : hot ? 'rgba(32,36,44,0.95)' : 'rgba(22,25,31,0.9)';
          ctx.strokeStyle = on ? '#e8352a' : hot ? '#ffb000' : 'rgba(172,182,198,0.5)';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.roundRect(bx, by, BTN_W, BTN_H, 7);
          ctx.fill();
          ctx.stroke();
          ctx.textAlign = 'center';
          ctx.font = "800 17px 'Arial Narrow', system-ui, sans-serif";
          ctx.fillStyle = on ? '#ff6a5e' : hot ? '#ffb000' : 'rgba(232,236,242,0.9)';
          ctx.fillText(label, bx + BTN_W / 2, by + BTN_H / 2 + 1);
          this.hits.push({ name: p.name, kind, x: bx, y: by });
        };
        const noPaint = socialPaintHidden(p.name);
        const sent = this.reported.has(p.name);
        button(muted ? 'MUTED' : 'MUTE', muted, 'mute', W - 24 - BTN_W * 4 - BTN_GAP * 3);
        button(hidden ? 'BLOCKED' : 'BLOCK', hidden, 'block', W - 24 - BTN_W * 3 - BTN_GAP * 2);
        button(noPaint ? 'BARED' : 'PAINT', noPaint, 'paint', W - 24 - BTN_W * 2 - BTN_GAP);
        button(sent ? 'SENT' : 'REPORT', sent, 'report', W - 24 - BTN_W);
      });
    });
  }
}
