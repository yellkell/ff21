/**
 * MusicSystem — the DJ. Drops the needle on the countdown, mirrors the beat
 * clock into shared state every frame, flips countdown → live when beat 0
 * arrives, and rides the lobby loop the rest of the time.
 *
 * The lobby loop matters more than it looks: it publishes its own beat, so
 * the mirror ball, the lasers and the GOOPLIATH's idle bounce are already
 * grooving before anyone starts a set. The club is never dead.
 */

import { createSystem } from '@iwsdk/core';
import { countInBeatsFor } from '../config.js';
import {
  ambientBeat,
  ambientRunning,
  beatNow,
  preload,
  setAmbientMuted,
  setPlaybackState,
  setRunning,
  startAmbient,
  startSet,
  stopAmbient,
  stopSet,
} from '../audio/music.js';
import { pickRaidTrack, trackById, tracksFor, voidstepShelf, type Track } from '../audio/tracks.js';
import { actOfBeat } from '../choreo/setlist.js';
import { clubMusicOn } from '../club/social.js';
import { campaignComplete, match, menuMusic, phraseBeats } from '../game/state.js';
import { inRoom } from '../net/session.js';
import { course } from '../course/state.js';

export class MusicSystem extends createSystem({}) {
  private generation = -1;
  /** This headset's VOIDSTEP order, shuffled once and kept. */
  private voidShelf: Track[] | null = null;
  private stoppedFor: typeof match.screen | '' = '';
  private warmed = false;

  update(): void {
    const screen = match.screen;

    // A fresh countdown generation → drop the needle.
    if (screen === 'countdown' && this.generation !== match.generation) {
      this.generation = match.generation;
      this.stoppedFor = '';
      stopAmbient(0.35);
      const track = trackById(match.trackId) ?? pickRaidTrack(match.seed);
      const total = match.phrases;
      // match.bpm is the CHART clock mountTrack settled (EXPERT doubles
      // slow records) — the set-list, the phrase count and this needle all
      // count the same grid.
      startSet({
        track,
        bpm: match.bpm,
        countInBeats: countInBeatsFor(match.bpm),
        endBeat: total * phraseBeats(),
        seed: match.seed,
        actAt: (beat) => actOfBeat(beat, total, match.difficulty),
        beatZeroAt: Number.isFinite(match.beatZeroAt) ? match.beatZeroAt : undefined,
        loop: false,
      });
      match.beatLen = 60 / match.bpm;
      match.playing = true;
    }

    const inSet = screen === 'countdown' || screen === 'raid';

    if (match.playing && inSet) {
      // Still decoding? Hold the countdown — the clock stays parked at −∞
      // and nothing (choreography, scoring) can run early.
      match.beat = setRunning() ? beatNow() : -Infinity;
      if (screen === 'countdown' && Number.isFinite(match.beat) && match.beat >= 0) {
        match.screen = match.after;
      }
    }

    // Lobby / podium: fade the set out once, bring the room loop up.
    if (!inSet) {
      if (this.stoppedFor !== screen) {
        this.stoppedFor = screen;
        // Always stop, including the LOADING state. Guarding this with
        // setRunning() let an abandoned decode complete in the menu and
        // start the set underneath the room music. Manual/menu exits cut
        // promptly; the podium keeps its deliberate musical tail.
        stopSet(screen === 'podium' ? 2.0 : 0.08);
        match.playing = false;
        this.generation = -1; // the next countdown always re-drops
      }
      // VOIDSTEP takes the decks off the club the moment you cross. You are
      // still nominally in the lobby out there (the course only runs from a
      // club room), so without this the hall's record would follow you
      // through the door into a place it has nothing to do with.
      //
      // The rotation is this headset's own shuffle (voidstepShelf) and it is
      // built ONCE, on the first crossing: rebuilding it per entry would
      // reshuffle every time you stepped back through the door, and a shelf
      // that reorders itself whenever you glance away is not a shelf.
      // startAmbient no-ops while its rotation is already spinning, so this
      // survives lap after lap and only changes record when one runs out.
      if (course.active) {
        this.voidShelf ??= voidstepShelf();
        setAmbientMuted(!clubMusicOn());
        // Quieter than the club's own record. Out here the sound that
        // MATTERS is the floor counting itself out, and a record is company
        // rather than the main event — it must never be the loudest thing
        // between you and a deck about to leave.
        if (this.voidShelf.length) startAmbient(this.voidShelf, 0.42);
        return;
      }

      if (screen === 'lobby' || screen === 'tour') {
        // The house sound: the foyer runs its ROTATION (SWAG opens, ECLIPSE
        // follows, and they trade all night); the moment a room has the
        // floor (hosting or joined — the SOCIAL night), CHILL takes the
        // decks and loops. startAmbient switches cleanly when the set
        // changes and no-ops while a rotation is mid-spin.
        // …unless THE CREDITS ARE ROLLING, in which case the closing theme
        // takes the decks over both of them. It's a rotation of one, so it
        // loops for as long as the card is up.
        //
        // And it can KEEP them. Finishing the tour hands over the closing
        // theme as the foyer's record for good; dismissing the card doesn't
        // interrupt it, because startAmbient no-ops when the rotation it's
        // handed is already spinning — the song just carries on playing over
        // the walk back to the map. SYSTEM can switch it back to the house
        // rotation, and only ever offers the choice to someone who earned
        // it. A room on the social floor still gets CHILL either way: the
        // reward is the MENU's music, not the club's.
        const social = inRoom();
        const closing = match.credits || (!social && menuMusic() === 'credits' && campaignComplete());
        const room = closing ? tracksFor('credits') : social ? tracksFor('club') : tracksFor('lobby');
        // THE MUSIC SWITCH belongs to the CLUB, not to the room loop as a
        // system: hush the floor to talk to your friends and the foyer's
        // house rotation still greets you on the way out, because that is
        // a different place with a different record on. The record keeps
        // spinning either way — see setAmbientMuted — so the floor never
        // stops dancing just because one headset stopped listening.
        setAmbientMuted(social && !clubMusicOn());
        if (room.length) startAmbient(room, closing ? 0.75 : social ? 0.7 : 0.55);
        // Warm the raid record while the room track holds the floor, so the
        // drop is instant when someone hits START.
        if (!this.warmed) {
          this.warmed = true;
          preload(trackById(match.preferredTrack) ?? pickRaidTrack(match.seed));
        }
        // The lights and the goop dance to the lobby loop.
        match.beat = ambientRunning() ? ambientBeat() : -Infinity;
      } else if (screen === 'podium') {
        match.beat = -Infinity;
      }
    } else {
      this.warmed = false;
    }
  }
}

export const musicDebug = { setPlaybackState };
