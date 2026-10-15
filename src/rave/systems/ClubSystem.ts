/**
 * ClubSystem — keeper of the venue's places. The law of the land: where
 * you are is what you're doing.
 *
 *  1. THE FOYER — the menu place, and a piece of THE VOID: a floating
 *     neon-edged platform in the set's own abstract space (pylons, slow
 *     hexes, drifting shards, a horizon with no land), with the board and
 *     the MC. The club's door is the board's MULTIPLAYER seat.
 *  2. THE CLUB — the social place, the warm human room between the voids.
 *     Host or join and the hall swaps in around you — dance floor, eclipse
 *     chandelier, bar, booths, terrace, still room — with your room-mates
 *     live in it (ClubSocialSystem) and teleport movement
 *     (ClubTeleportSystem).
 *  3. THE SET — the game place. The ball fires (or a solo set starts),
 *     both rooms pack away, and the raid takes over — wrapped in the void
 *     environment (DiscoSystem's business).
 *
 * This system builds both interiors once, swaps them per frame, and keeps
 * whichever is open breathing:
 *
 *  - club: the room PHASES with the
 *    music, leaning into the kick; the moon brightens on the bar; the
 *    LED dance floor plays the record that's on; the bar's
 *    ribbed glass pulses slow; candles flicker on one shared flame; the
 *    DJ console blinks; the still room's lamp breathes at rest.
 *  - foyer: the pylons roll a slow wave, the hexes turn, shards drift.
 *
 * Fog belongs to whoever's place is up — this system owns it for the foyer
 * and club and never clobbers the set's (DiscoSystem's) fog.
 *
 * THE STILL ROOM's law is enforced here: step through its door and the
 * club's music drops to a muffled thud through the wall (setAmbientDuck
 * takes the level down AND the top end off), voices untouched.
 */

import { createSystem } from '@iwsdk/core';
import { FogExp2, type Scene } from 'three';
import { ambientBeat, ambientRunning, ambientTrackId, setAmbientDuck } from '../audio/music.js';
import { TRACKS } from '../audio/tracks.js';
import { VOID_BG } from '../arena/voidkit.js';
import { buildClub, buildFoyer, type ClubRefs, type FoyerRefs } from '../club/build.js';
import { CLUB } from '../club/config.js';
import { stepRefs } from '../club/step.js';
import { stageShow } from '../club/stageShow.js';
import { course } from '../course/state.js';
import { match } from '../game/state.js';
import { inRoom } from '../net/session.js';

export class ClubSystem extends createSystem({}) {
  private club: ClubRefs | null = null;
  private foyer: FoyerRefs | null = null;
  private clubFog = new FogExp2(0x0b0810, 0.008); // light: the baked venue carries its own depth
  private foyerFog = new FogExp2(VOID_BG, 0.026);
  private fogOwned: 'club' | 'foyer' | null = null;
  private clock = 0;
  private duckTarget = 1;

  init(): void {
    this.club = buildClub(this.scene, this.world.renderer);
    this.club.root.visible = false;
    this.foyer = buildFoyer(this.scene);
    this.foyer.root.visible = false;
  }

  update(delta: number): void {
    const club = this.club;
    const foyer = this.foyer;
    if (!club || !foyer) return;

    const menuRoom = match.screen === 'lobby' || match.screen === 'tour';
    // `holdFoyer`: the room is open but its host is still reading their
    // code off the board. The doors stay shut until they walk through.
    const social = inRoom() && !match.holdFoyer;
    // THE WEST DOOR is a fourth place, and it takes the whole hall with it:
    // through THE STEP the club is not a room you can see from, so it packs
    // away exactly the way it does when a set books the floor.
    const wantClub = menuRoom && social && !course.active;
    const wantFoyer = menuRoom && !social;

    if (club.root.visible !== wantClub) club.root.visible = wantClub;
    if (foyer.root.visible !== wantFoyer) foyer.root.visible = wantFoyer;

    // Fog handoff: claim it for our place, release it ONLY if it's ours —
    // the set's void fog is DiscoSystem's and must never be stomped here.
    const want: 'club' | 'foyer' | null = wantClub ? 'club' : wantFoyer ? 'foyer' : null;
    if (want !== this.fogOwned) {
      const scene = this.scene as Scene;
      if (want === null) {
        if (scene.fog === this.clubFog || scene.fog === this.foyerFog) scene.fog = null;
      } else {
        scene.fog = want === 'club' ? this.clubFog : this.foyerFog;
      }
      this.fogOwned = want;
    }
    // The room loop keeps spinning (everything on the floor pulses to it),
    // but out on the course you should hear the course: the hall's record
    // goes to nothing rather than to a murmur, because through that door
    // there is no wall left for it to come through.
    const duck = course.active ? 0 : 1;
    if (!wantClub && this.duckTarget !== duck) {
      this.duckTarget = duck;
      setAmbientDuck(duck);
    }

    if (!wantClub && !wantFoyer) return;

    this.clock += delta;
    const t = this.clock;

    // Beat: the lobby loop publishes one whenever it's running.
    const beat = Number.isFinite(match.beat) ? match.beat : t / 0.86;
    const beatFrac = beat - Math.floor(beat);
    const pulse = Math.max(0, 1 - beatFrac * 2.4); // crests on the kick, dies fast

    if (wantFoyer) {
      // The world around the platform is SPECTRUM playing the lobby loop:
      // its wall is the loop's spectrum, its record the loop going round.
      const amb = ambientRunning() ? ambientBeat() : NaN;
      const fb = Number.isFinite(amb) ? amb : beat;
      const id = ambientTrackId();
      foyer.env.update(delta, fb, 0, 0.55, {
        trackId: id ?? 'swag',
        title: TRACKS.find((tr) => tr.id === id)?.title ?? 'NEON DISTRICT',
        progress: ((fb / 256) % 1 + 1) % 1,
      });
    }

    if (wantClub) {
      // The shared candle flame flickers wherever it burns.
      club.candleMat.opacity = 0.74 + Math.sin(t * 12.7) * 0.07 + Math.sin(t * 29.3) * 0.05;

      // ── the LED dance floor plays the record that's on ────────────────
      const amb = ambientRunning() ? ambientBeat() : NaN;
      club.ledFloor.update(delta, Number.isFinite(amb) ? amb : beat, ambientTrackId());

      // ── the bar wall, slow and low ────────────────────────────────────
      club.barBackMat.emissiveIntensity = 0.4 + Math.sin(t * 0.5) * 0.07 + pulse * 0.05;

      // ── the DJ console blinks along; the decks turn, the LED wall plays ──
      club.consoleMat.color.setScalar(0.35 + pulse * 0.65);
      stageShow.update(delta, t, beat, pulse);

      // ── the still room's resting pulse ────────────────────────────────
      club.stillLampMat.emissiveIntensity = 1.0 + Math.sin(t * 0.9) * 0.22;

      // ── THE STEP's door, breathing ────────────────────────────────────
      // The one thing in the west corner is awake whether or not you're
      // near it: the pane swells slowly and sits a few millimetres in and
      // out of its frame, so the void behind it reads as depth rather than
      // as a picture. CourseSystem takes the levels over as you approach.
      const step = stepRefs();
      if (step) {
        const swell = 0.5 + 0.5 * Math.sin(t * 0.7);
        step.portalMat.color.setScalar(0.72 + swell * 0.28);
        step.portal.position.z = CLUB.step.portalZ + Math.sin(t * 0.45) * 0.004;
      }

      // ── THE STILL ROOM's hush ─────────────────────────────────────────
      const Q = CLUB.quiet;
      const inside =
        match.headX >= Q.minX && match.headX <= Q.maxX && match.headZ >= Q.minZ && match.headZ <= Q.maxZ;
      // Properly quiet, not just turned down: at 0.1 the club was still in
      // the room with you. The muffle rides this same number, so the low
      // setting is a wall's worth of both.
      const target = inside ? 0.03 : 1;
      if (target !== this.duckTarget) {
        this.duckTarget = target;
        setAmbientDuck(target);
      }
    }
  }
}
